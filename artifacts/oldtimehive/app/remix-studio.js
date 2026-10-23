import "./audio-remix.css";
import { api, mutate } from "./store.js";
import { audioSource, audioTitle } from "./audio-library.js";
import { isLocalMedia, mediaUrl, putLocalMedia, migrateLocalMedia, deleteLocalMedia } from "./local-media.js";
import { defaultRemixState, applyLayout, snapLayer, drawRemix } from "./remix-compositor.js";
import { createPersonCutout } from "./remix-cutout.js";
import { startRemixRecording, releaseRemixAudio } from "./remix-recording.js";
import { renderRemixStudio } from "./audio-remix-view.js";
import { waitForVideoFrame } from "./remix-video.js";
import { mountRemixWorkspace } from "./remix-workspace.js";

function videoElement(container) {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous"; video.playsInline = true; video.muted = true; video.loop = true;
  video.autoplay=true;video.setAttribute("playsinline","");video.setAttribute("webkit-playsinline","");video.setAttribute("muted","");
  video.tabIndex=-1;container?.append(video);
  return video;
}
function loadVideo(video, url) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Couldn’t load this video.")), 20_000);
    video.onloadeddata = () => { clearTimeout(timer); resolve(video); };
    video.onerror = () => { clearTimeout(timer); reject(new Error("This video cannot be used. Choose a playable video file.")); };
    video.src = url; video.load();
  });
}
export async function openRemixStudio({ postId, mode = "remix", esc, icons, toast, onPosted }) {
  const owner = api.me()?.id, post = api.post(postId), source = audioSource(post);
  if (!owner || !source || (mode === "remix" && post.kind !== "video")) return toast("This audio or video is unavailable.");
  document.querySelectorAll(".remix-overlay").forEach(element => element.dispatchEvent(new Event("remix-close")));
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderRemixStudio({ post, mode, esc, icons });
  const root = wrapper.firstElementChild; document.body.append(root);
  const q = id => root.querySelector(`#${id}`);
  const sources=document.createElement("div");sources.setAttribute("aria-hidden","true");
  sources.style.cssText="position:absolute;left:0;top:0;width:1px;height:1px;opacity:.01;pointer-events:none;overflow:hidden";
  root.append(sources);
  const canvas = q("remix-canvas"), original = videoElement(sources), soundtrack = videoElement(sources);
  let self = null, liveStream = null, selfUrl = "", cutout = null, cutoutPending = null, selfRequest = 0, cutoutRequest=0;
  let closed = false, frame, recording = null, recorded = null, resultUrl = "", starting = false, originalReady = false;
  const state = defaultRemixState(mode), pointers = new Map();
  const updateRecord = () => { if (!closed) q("studio-record").disabled = !originalReady || !self || starting || Boolean(recording) || Boolean(recorded) || (q("studio-cutout").checked && !state.cutout); };
  const freezeEdit = frozen => {
    root.querySelectorAll(".rs-group input, .rs-group select, #studio-upload, #studio-camera").forEach(element => {
      if (element.id !== "studio-visibility") element.disabled = frozen;
    });
  };
  const oldOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";
  const valid = () => {const current=api.post(postId);return api.me()?.id === owner && current && api.canSeePost(current) && audioSource(current);};
  const error = failure => { if (!closed) q("studio-error").textContent = failure.message || String(failure); };
  const status = text => { if (!closed) q("studio-status").textContent = text; };
  const cleanupSelf = () => {
    selfRequest++;
    liveStream?.getTracks().forEach(track => track.stop()); liveStream = null;
    self?.pause(); if (self) {self.srcObject = null;self.remove();}
    if (selfUrl) URL.revokeObjectURL(selfUrl); selfUrl = "";
    self = null;
    if (!closed) q("studio-record").disabled = true;
  };
  const close = (force = false) => {
    if (closed || (!force && (recording || recorded) && !confirm("Discard this remix?"))) return;
    closed = true; cancelAnimationFrame(frame); recording?.stop();
    cleanupSelf(); original.pause(); soundtrack.pause();
    if (!recording) releaseRemixAudio(soundtrack);
    cutout?.close(); if (resultUrl) URL.revokeObjectURL(resultUrl);
    workspace.destroy();
    document.removeEventListener("keydown", keyboard);
    document.body.style.overflow = oldOverflow; root.remove();
  };
  const keyboard = event => {
    if (event.key === "Escape") { event.preventDefault(); if(workspace?.editingText)workspace.commitText();else close(); }
    if (event.key === "Tab") {
      const fields = [...root.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, [contenteditable=plaintext-only], video[controls]")].filter(item => !item.hidden && item.getClientRects().length>0);
      if (!event.shiftKey && document.activeElement === fields.at(-1)) { event.preventDefault(); fields[0]?.focus(); }
      else if (event.shiftKey && document.activeElement === fields[0]) { event.preventDefault(); fields.at(-1)?.focus(); }
    }
  };
  root.addEventListener("remix-close", () => close(true));
  root.querySelector("[data-studio-close]").onclick = () => close();
  document.addEventListener("keydown", keyboard);
  root.querySelector("[data-studio-close]").focus();
  const syncLayer = () => {
    const layer = state.layers[state.active];
    for (const key of ["x", "y", "size", "rotation", "shape", "border", "crop"]) q(`studio-${key}`).value = layer[key];
    q("studio-layer").value=state.active;
    for(const key of ["shape","border"])q(`studio-${key}`).disabled=["text","sticker"].includes(state.active);
    workspace?.sync();
  };
  let workspace;
  const ensureCutout = async (forceCpu=false) => {
    const attempt=++cutoutRequest,request=selfRequest;
    state.cutout = false;
    if (!q("studio-cutout").checked || !self) { updateRecord(); return; }
    const video=self;
    q("studio-error").textContent="";q("studio-retry-cutout").hidden=true;
    status("Preparing person cutout…"); q("studio-record").disabled = true;
    try {
      await waitForVideoFrame(video);
      if(closed||attempt!==cutoutRequest||request!==selfRequest)return;
      if(forceCpu){cutout?.close();cutout=null;cutoutPending=null;}
      cutoutPending ||= createPersonCutout({forceCpu});
      const ready = await cutoutPending;
      if (closed) { ready.close(); return; }
      if(attempt!==cutoutRequest||request!==selfRequest)return;
      cutout = ready;
      await ready.prepare?.(video);
      if (closed) { ready.close(); return; }
      if(attempt!==cutoutRequest||request!==selfRequest)return;
      state.cutout = q("studio-cutout").checked;
      status("Person cutout ready");
    } catch (failure) {
      if(closed||attempt!==cutoutRequest||request!==selfRequest)return;
      console.warn("Remix cutout initialization failed",failure);
      cutout?.close();cutout=null;
      cutoutPending = null; q("studio-cutout").checked = false;
      q("studio-retry-cutout").hidden=false;
      status("Your video is visible. Cutout is unavailable.");
      error(new Error("Cutout couldn’t start. Retry cutout, or edit and record with the video background visible."));
    } finally { updateRecord(); }
  };
  q("studio-record").disabled = true;
  q("studio-layout").value = state.layout;
  q("studio-cutout").checked = state.cutout;
  q("studio-layer").value = state.active;
  workspace=mountRemixWorkspace({root,canvas,state,onChange:()=>{syncLayer();recording?.levels();},canEdit:()=>!recorded&&!starting});
  q("studio-retry-cutout").onclick=()=>{q("studio-cutout").checked=true;void ensureCutout(true);};
  syncLayer();
  q("studio-layer").onchange = event => { state.active = event.target.value; syncLayer(); };
  q("studio-layout").onchange = event => {
    applyLayout(state, event.target.value); syncLayer();
    q("studio-cutout").checked = state.cutout;
    void ensureCutout();
  };
  for (const key of ["x", "y", "size", "rotation", "shape", "border", "crop"]) q(`studio-${key}`).oninput = event => {
    state.layers[state.active][key] = ["shape", "border"].includes(key) ? event.target.value : Number(event.target.value);
  };
  q("studio-divider").oninput = event => { state.divider = Number(event.target.value); };
  q("studio-snap").onchange = event => { snapLayer(state.layers[state.active], event.target.value); syncLayer(); };
  q("studio-cutout").onchange = () => void ensureCutout();
  for (const key of ["text", "sticker", "effect"]) q(`studio-${key}`).oninput = event => { state[key] = event.target.value; };
  q("studio-original-volume").oninput = event => { state.originalVolume = Number(event.target.value) / 100; recording?.levels(); };
  q("studio-me-volume").oninput = event => { state.meVolume = Number(event.target.value) / 100; recording?.levels(); };
  q("studio-offset").oninput = event => {
    state.offset = Number(event.target.value);
    if (recording) soundtrack.currentTime = Math.min(state.offset, Math.max(0, soundtrack.duration - .1));
  };
  const updatePointer = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width * 100, y: (event.clientY - rect.top) / rect.height * 100 };
  };
  let gesture = null;
  canvas.style.touchAction = "none";
  canvas.onpointerdown = event => {
    if(recorded||starting)return;
    canvas.setPointerCapture(event.pointerId); pointers.set(event.pointerId, updatePointer(event));
    const layer = state.layers[state.active], points = [...pointers.values()];
    gesture = points.length === 2
      ? { distance: Math.hypot((points[0].x-points[1].x)*canvas.width,(points[0].y-points[1].y)*canvas.height), angle:Math.atan2((points[1].y-points[0].y)*canvas.height,(points[1].x-points[0].x)*canvas.width),rotation:layer.rotation,size: layer.size }
      : { point: points[0], x: layer.x, y: layer.y };
  };
  canvas.onpointermove = event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, updatePointer(event));
    const layer = state.layers[state.active], points = [...pointers.values()];
    if (points.length === 2 && gesture?.distance) {
      layer.size = Math.max(15, Math.min(100, gesture.size * Math.hypot((points[0].x-points[1].x)*canvas.width,(points[0].y-points[1].y)*canvas.height) / gesture.distance));
      layer.rotation=Math.max(-180,Math.min(180,gesture.rotation+(Math.atan2((points[1].y-points[0].y)*canvas.height,(points[1].x-points[0].x)*canvas.width)-gesture.angle)*180/Math.PI));
    } else if (state.layout === "split" && ["original","me"].includes(state.active)) {
      state.divider = Math.max(20, Math.min(80, points[0].x)); q("studio-divider").value = state.divider;
    } else if (gesture?.point) {
      layer.x = Math.max(0, Math.min(100, gesture.x + points[0].x - gesture.point.x));
      layer.y = Math.max(0, Math.min(100, gesture.y + points[0].y - gesture.point.y));
      if (Math.abs(layer.x - 50) < 2) layer.x = 50;
      if (Math.abs(layer.y - 50) < 2) layer.y = 50;
    }
    syncLayer();
  };
  canvas.onpointerup = canvas.onpointercancel = event => {
    pointers.delete(event.pointerId);
    const point=[...pointers.values()][0],layer=state.layers[state.active];
    gesture=point?{point,x:layer.x,y:layer.y}:null;
  };
  q("studio-upload").onclick = () => q("studio-file").click();
  q("studio-file").onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("video/") || file.size > 80 * 1024 * 1024) return error(new Error("Choose a video smaller than 80 MB."));
    try {
      cleanupSelf(); const request = selfRequest, video = videoElement(sources);
      self = video; selfUrl = URL.createObjectURL(file); q("studio-error").textContent = "";
      await loadVideo(video, selfUrl); if (closed || request !== selfRequest) return;
      await video.play();await waitForVideoFrame(video); if (q("studio-cutout").checked) await ensureCutout();
      if (closed || request !== selfRequest) return;
      updateRecord(); status("Your video is ready. Drag or pinch yourself over the content.");
    } catch (failure) { error(failure); }
  };
  q("studio-camera").onclick = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires a supported browser and secure connection.");
      cleanupSelf();
      const request = selfRequest;
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 720 } }, audio: { echoCancellation: true, noiseSuppression: true } });
      if (closed || request !== selfRequest) { stream.getTracks().forEach(track => track.stop()); return; }
      liveStream = stream; self = videoElement(sources); self.srcObject = stream; await self.play();await waitForVideoFrame(self);
      if (q("studio-cutout").checked) await ensureCutout();
      if (closed || request !== selfRequest) return;
      updateRecord(); status("Camera ready. Record up to 60 seconds.");
    } catch (failure) { error(failure); }
  };
  const complete = blob => {
    recording = null;
    if (closed) { releaseRemixAudio(soundtrack); return; }
    recorded = blob; resultUrl = URL.createObjectURL(blob);
    q("studio-result").src = resultUrl; q("studio-result").hidden = false;
    q("studio-publish").disabled = false; q("studio-record").hidden = true;
    q("studio-retake").hidden = false; q("studio-stop").disabled = true;
    freezeEdit(true);
    workspace.sync();
    status("Recording ready. Review it before publishing.");
  };
  q("studio-record").onclick = async () => {
    if (starting || recording || !self) return;
    try {
      workspace.commitText();
      if (!valid()) throw new Error("The original post is no longer available.");
      starting = true; q("studio-record").disabled = true; q("studio-error").textContent = "";
      if (!originalReady) throw new Error("Wait for the original video to load.");
      if (state.cutout) await cutout?.prepare?.(self);
      canvas.getContext("2d").getImageData(0, 0, 1, 1);
      original.currentTime = 0; await original.play();
      recording = await startRemixRecording({ canvas, soundtrack, self, stream: liveStream, state, onDone: complete, onError: failure => { recording = null; error(failure); q("studio-record").disabled = false; } });
      if (closed) { recording.stop(); return; }
      q("studio-stop").disabled = false; q("studio-upload").disabled = true; q("studio-camera").disabled = true;
      status("Recording · up to 60 seconds. You can move layers while recording.");
    } catch (failure) { error(failure); q("studio-record").disabled = false; }
    finally { starting = false; }
  };
  q("studio-stop").onclick = () => { recording?.stop(); q("studio-stop").disabled = true; };
  q("studio-retake").onclick = () => {
    q("studio-result").pause(); q("studio-result").removeAttribute("src"); q("studio-result").hidden = true;
    if (resultUrl) URL.revokeObjectURL(resultUrl); resultUrl = ""; recorded = null;
    q("studio-publish").disabled = true; q("studio-record").hidden = false; freezeEdit(false); updateRecord();
    q("studio-retake").hidden = true; status("Ready for another take.");
    workspace.sync();
  };
  q("studio-publish").onclick = async () => {
    if (!recorded) return;
    let key;
    q("studio-publish").disabled = true;
    try {
      if (!valid()) throw new Error("The original post is no longer available.");
      const visibility = q("studio-visibility").value;
      if (visibility === "close-friends" && !(api.me().closeFriends || []).length) throw new Error("Add Close Friends before sharing with them.");
      const caption = q("studio-caption").value.trim(), id = `p-${crypto.randomUUID()}`;
      key = await putLocalMedia(recorded);
      if (!valid()) throw new Error("The original post is no longer available.");
      if (api.authMode() === "cloud") {
        if (mode === "remix" && !post.cloud) {
          throw new Error("Publish the original post to your account before remixing it online.");
        }
        if (!isLocalMedia(key)) throw new Error("The recorded video could not be prepared for upload.");
        await migrateLocalMedia(key, owner);
        const mediaId = key.slice("oldtime-media:".length);
        const cloudPost = await api.createCloudPost(caption, {
          visibility,
          destination: post.destination === "community" ? "community" : post.destination === "both" ? "both" : "main",
          mediaIds: [mediaId],
          ...(mode === "remix" ? { remixSourcePostId: post.id } : {}),
        });
        await deleteLocalMedia(key).catch(() => {});
        key = null;
        close(true);
        toast(mode === "remix" ? "Remix posted" : "Video posted");
        onPosted?.(cloudPost.id);
        return;
      }
      mutate(db => db.posts.unshift({
        id, author: owner, kind: "video", caption, tags: [...caption.matchAll(/#([a-z0-9_]+)/gi)].map(match => match[1].toLowerCase()),
        media: [key], sound: audioTitle(post), audioSourcePostId: source.id,
        remixOf: mode === "remix" ? post.id : null, remixLayout: structuredClone(state), visibility,
        likes: [], comments: [], saves: [], reposts: [], created: Date.now(), views: 0, shares: 0
      }));
      close(true); toast(mode === "remix" ? "Remix posted" : "Video posted"); onPosted?.(id);
    } catch (failure) {
      if (key) await deleteLocalMedia(key).catch(() => {});
      error(failure); if (!closed) q("studio-publish").disabled = false;
    }
  };
  const tick = time => {
    if (closed) return;
    if (!valid()) { close(true); toast("Original post unavailable"); return; }
    try {
      drawRemix(canvas, state, mode === "reuse" && state.layout === "solo" ? null : original, self, cutout, time);
      workspace.sync();
      if (pointers.size && !recording) {
        const ctx = canvas.getContext("2d"); ctx.strokeStyle = "#ffffff66"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(canvas.width / 2, 0); ctx.lineTo(canvas.width / 2, canvas.height);
        ctx.moveTo(0, canvas.height / 2); ctx.lineTo(canvas.width, canvas.height / 2); ctx.stroke();
      }
    } catch (failure) {
      if (recording) {
        recording.cancel(); recording = null; q("studio-stop").disabled = true;
        q("studio-upload").disabled = false; q("studio-camera").disabled = false;
        status("Recording stopped. Nothing was published.");
      }
      state.cutout = false; q("studio-cutout").checked = false;q("studio-retry-cutout").hidden=false;
      error(new Error("Background removal stopped. Retry it before recording.")); updateRecord();
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  if (mode === "remix") { state.cutout=false; void q("studio-camera").onclick(); }
  try {
    status("Loading original…");
    await Promise.all([loadVideo(original, await mediaUrl(mode === "reuse" ? source.media[0] : post.media[0])), loadVideo(soundtrack, await mediaUrl(source.media[0]))]);
    if (closed) return;
    soundtrack.muted = false;
    q("studio-offset").max = Math.max(0, Math.min(30, soundtrack.duration - .1));
    await original.play(); originalReady = true; updateRecord();
    if (!self) status(mode === "remix" ? "Allow your camera, or upload a video to appear over the content." : "Choose your camera or upload a video to begin.");
  } catch (failure) { error(failure); status("Original unavailable. Nothing has been recorded."); }
}
