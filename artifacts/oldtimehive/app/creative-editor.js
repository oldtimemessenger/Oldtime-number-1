import "./creative-editor.css";
import "./creative-overlay.css";
import { bindViewport, bindSheets } from "./creative-overlay.js";
import { api } from "./store.js";
import { bindMentionAutocomplete } from "./mention-autocomplete.js";
import { icon } from "./icons.js";
import { openEmojiPicker, closeEmojiPicker } from "./emoji.js";
import { renderCreativeEditor } from "./creative-editor-view.js";
import { createProject, createLayer, duplicateLayer, moveLayer, clamp, setProjectDuration, keepLayerInFrame, ProjectHistory, projectScenes } from "./creative-project.js";
import { mediaUrl, putLocalMedia } from "./local-media.js";
import { audioSource, audioTitle, savedAudio } from "./audio-library.js";
import { CreativeAssets, drawProject } from "./creative-renderer.js";
import { bindCreativeGestures } from "./creative-gestures.js";
import { commentSource, resolveCommentSource, validateProjectSources, validateProjectAudience, publishCreativeProject } from "./creative-content.js";
import { publishRenderedPost, originalPublicationMedia } from "./media-publication.js";
import { videoMime, canvasBlob, exportCreativeVideo } from "./creative-export.js";
import { bindInlineText } from "./creative-inline-text.js";
import { bindCreativeTools } from "./creative-editor-tools.js";
import { bindCreativePages } from "./creative-pages.js";
import { bindMediaEditor } from "./creative-media-editor.js";
import { initVideoEdit, syncVideoEdit } from "./creative-video-edit.js";
import { waitForVideoFrame } from "./remix-video.js";
import { createCameraStrip } from "./creative-camera-strip.js";
import { bindToolsTheme } from "./creative-controls-palette.js";
import { naturalZoom, cameraConstraints, captureFrame, zoomFromPinch, distance } from "./creative-capture-geometry.js";
import { bindCaptureModes } from "./creative-capture-modes.js";
import { openPlacePicker } from "./place-picker.js";
import { shouldAutoStartCamera } from "./creative-editor-startup.js";
import { projectOutputKind, matchingOriginal } from "./creative-output.js";
import { createPersonCutout } from "./remix-cutout.js";

let currentEditor = null;
export function closeCreativeEditor() { currentEditor?.(); }
export function openCreativeEditor({ postId, commentId, destination = "post", startCamera = false, mediaPicker = false, startShare = false, background = null, caption = "", location = "", visibility, esc, icons, toast = () => {}, onClose, onPosted, onSave, saveLabel = "Save", initialProject, editorVersion = "legacy" } = {}) {
  closeCreativeEditor();
  if (!["post", "community", "story"].includes(destination)) destination = "post";
  const openedInCommunity = destination === "community";
  let source;
  try { source = postId && commentId ? commentSource(postId, commentId) : null; }
  catch (error) { toast(error.message); return; }
  const ownerId = api.me()?.id;
  if (!ownerId) { toast("Sign in to create a remix."); return; }
  const project = createProject(source), assets = new CreativeAssets(), blobs = new Map();
  if(!source&&!initialProject&&!background?.media)project.background.color="#000000";
  if(initialProject)Object.assign(project,structuredClone(initialProject));
  project.audioTracks ||= [];
  const history = new ProjectHistory(project);
  const root = document.createElement("div"); root.innerHTML = renderCreativeEditor({ destination, hasSource: !!source, hasSaveHandler: !!onSave, esc, icons, editorVersion });
  document.body.appendChild(root);
  const editor = root.firstElementChild, q = name => root.querySelector("#ce-" + name), canvas = q("canvas");
  const mentionCleanup = bindMentionAutocomplete(q("caption"), { api });
  q("destination").value=destination;
  const unbindTheme=bindToolsTheme(editor);
  const mediaHost=document.createElement("div");mediaHost.setAttribute("aria-hidden","true");
  mediaHost.style.cssText="position:absolute;width:1px;height:1px;opacity:.01;pointer-events:none;overflow:hidden";
  root.append(mediaHost);assets.container=mediaHost;
  for(const [id,selector] of [["source-toggle",".ce-source"],["style-toggle","#ce-inspector"],["share-toggle",".ce-share"]]){
    q(id).setAttribute("aria-expanded","false");root.querySelector(selector).classList.add("is-collapsed");
  }
  const oldOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";
  const viewport = bindViewport({ editor });
  let selectedId = project.layers[0]?.id || null, time = 0, measurements = new Map(), raf;
  let closed = false, busy = false, recording = null, live = null, facing = "user", drawing = false, preview = false, playing = false,cameraMode="photo",cameraOpen=false;
  let playbackStart = 0, recordingStart = 0, inline, tools, pages, mediaTools, captureModes, previousCamera = null, captureTimer = null, cameraRequest = 0;
  let shutterHoldTimer = null, ignoreNextShutterClick = false;
  const soundPreview=document.createElement("audio");soundPreview.loop=true;soundPreview.preload="auto";
  let sheets=null,quoteReturn=null,quoteDraft=null,quoteCaption="";
  const replaceProject=value=>{for(const key of Object.keys(project))delete project[key];Object.assign(project,structuredClone(value));};
  const layer = () => project.layers.find(item => item.id === selectedId);
  const status = () => { /* Helper copy is intentionally not shown over the canvas. */ };
  const error = value => { q("error").textContent = value?.message || String(value || ""); };
  const syncShareDestinationButtons = () => {
    const selected = q("visibility").value === "close-friends"
      ? "close-friends"
      : q("destination").value === "story" ? "story" : "feed";
    root.querySelectorAll("[data-ce-share-destination]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.ceShareDestination === selected));
    });
    root.querySelectorAll("[data-ce-feed-visibility]").forEach(button =>
      button.setAttribute("aria-pressed", String(button.dataset.ceFeedVisibility === q("visibility").value)));
    q("feed-privacy").hidden=q("destination").value==="story"||q("visibility").value==="close-friends";
    const destinations = q("media-share-destinations");
    if (destinations) {
      const hasContent = !!project.background.media || project.layers.length > 0 || editor.classList.contains("is-quote");
      destinations.hidden = !!live || !hasContent || editor.classList.contains("is-create-v2") &&
        (q("destination").value === "story" || q("visibility").value === "close-friends");
    }
  };
  const render = at => {
    const size=project;
    if(canvas.width!==size.width)canvas.width=size.width;
    if(canvas.height!==size.height)canvas.height=size.height;
    editor.style.setProperty("--ce-ratio",`${size.width}/${size.height}`);
    editor.style.setProperty("--ce-ratio-num",size.width/size.height);
    editor.classList.toggle("is-typing",!!inline?.active());
    const wrap=root.querySelector(".ce-stage-wrap"),available=Math.max(80,wrap.clientHeight-root.querySelector(".ce-transport").offsetHeight-16);
    editor.style.setProperty("--ce-stage-width",`${Math.min(wrap.clientWidth-16,available*size.width/size.height)}px`);
    measurements = drawProject(canvas, project, assets, resolveCommentSource, at, preview || busy ? null : selectedId);
    if (!project.allowOutside && !drawing && !preview && !busy) {
      let moved = false;
      for (const item of project.layers) if(!item.subjectCutout)moved = keepLayerInFrame(item, measurements.get(item.id), project) || moved;
      if (moved) measurements = drawProject(canvas, project, assets, resolveCommentSource, at, selectedId);
    }
    inline?.sync();
  };
  let strip=null;
  const rememberBlob = blob => { const url = URL.createObjectURL(blob); blobs.set(url, blob); return url; };
  const activeSound=()=>project.audioTracks?.[0]||null;
  const syncSoundPreviewTime=value=>{
    const duration=soundPreview.duration;
    if(!soundPreview.src||!Number.isFinite(duration)||duration<=0)return;
    const target=value%duration;
    if(Math.abs(soundPreview.currentTime-target)>.35)soundPreview.currentTime=target;
  };
  const syncSoundControls=()=>{
    const title=q("sound-title");if(!title)return;
    const track=activeSound();
    title.textContent=track?.title||"Add sound";
    q("sound-chip").setAttribute("aria-label",track?`Sound: ${track.title}`:"Add sound");
    q("sound-volume-wrap").hidden=!track;
    q("sound-remove").hidden=!track;
    if(track&&q("sound-volume")&&document.activeElement!==q("sound-volume"))q("sound-volume").value=String(track.volume??.8);
    soundPreview.volume=Math.max(0,Math.min(1,Number(track?.volume??.8)));
    if(!track){
      soundPreview.pause();soundPreview.removeAttribute("src");delete soundPreview.dataset.creativeMedia;soundPreview.load();
    }else if(soundPreview.dataset.creativeMedia!==track.media){
      soundPreview.pause();soundPreview.removeAttribute("src");soundPreview.dataset.creativeMedia=track.media;
      void mediaUrl(track.media).then(url=>{
        if(closed||soundPreview.dataset.creativeMedia!==track.media)return;
        soundPreview.src=url;soundPreview.load();
        if(playing)void soundPreview.play().catch(()=>{});
      }).catch(failure=>{
        if(!closed&&soundPreview.dataset.creativeMedia===track.media&&q("sound-error"))q("sound-error").textContent=failure.message||"Couldn’t load that sound.";
      });
    }
    if(track&&!playing)syncSoundPreviewTime(time);
  };
  const exportAudioTracks=async scene=>Promise.all((scene.audioTracks||[]).map(async track=>({...track,media:await mediaUrl(track.media)})));
  const backgroundVideo = () => assets.get(project.background.media)?.tagName === "VIDEO" ? assets.get(project.background.media) : null;
  const stopLive = () => {
    for (const track of live?.getTracks() || []) track.stop();
    live = null; q("record").disabled = true; q("photo").disabled = true; q("flip").hidden = true;
    clearInterval(captureTimer); captureTimer=null;
  };
  const stopPlayback = () => { playing = false;if(!live)backgroundVideo()?.pause();soundPreview.pause();q("play").innerHTML = icon("play") || "Play"; };
  const refreshControls = () => {
    root.inert=busy;editor.setAttribute("aria-busy",String(busy));
    editor.classList.toggle("has-live-camera",!!live);
    editor.classList.toggle("is-camera-open",cameraOpen);editor.classList.toggle("is-camera-video",cameraMode==="video");editor.classList.toggle("is-capturing",!!recording);
    editor.classList.toggle("is-video-media",project.background.kind==="video"&&project.background.media!=="live-camera");
    q("empty").hidden=!!live||!!project.background.media||project.layers.length>0||editor.classList.contains("is-quote");
    q("photo").setAttribute("aria-pressed",String(cameraMode==="photo"));q("record").setAttribute("aria-pressed",String(cameraMode==="video"));
    q("shutter").setAttribute("aria-label",recording?"Stop recording video":cameraMode==="photo"?"Take photo":"Start recording video");
    const track=live?.getVideoTracks()[0],caps=track?.readyState==="live"?track.getCapabilities?.()||{}:{};
    q("flash").disabled=!caps.torch;q("zoom").disabled=!caps.zoom;
    q("publish").disabled = busy || !!live || !project.layers.length && !project.background.media;
    if(editor.classList.contains("is-quote")&&!project.layers.some(item=>item.kind==="text"&&item.text.trim()))q("publish").disabled=true;
    q("export").disabled = q("publish").disabled;
    const nextAction=q("next-action");if(nextAction)nextAction.disabled=q("publish").disabled;
    const cutoutSource=layer()?.kind==="image"?assets.get(layer().media):project.background.kind==="photo"?assets.get(project.background.media):null;
    const cutoutButton=root.querySelector('[data-ce-rail="remove-bg"]');if(cutoutButton)cutoutButton.disabled=busy||!!live||!cutoutSource;
    const trimButton=root.querySelector('[data-ce-rail="trim"]');if(trimButton)trimButton.disabled=busy||!!live||project.background.kind!=="video";
    if(q("save-exit")){
      q("save-exit").disabled=busy||!!recording||!!captureTimer;
      q("save-exit").title=recording?"Stop recording before saving.":"Return to the original composer.";
      q("save-exit").setAttribute("aria-describedby","ce-save-hint");
    }
    q("upload").disabled = busy || !!recording;
    q("camera").disabled = busy || !!recording;
    q("flip").disabled = busy || !!recording;
    q("record").disabled = q("photo").disabled = busy || !!recording || !!captureTimer;
    q("shutter").disabled = track?.readyState!=="live" || busy || !!captureTimer;
    q("pages").disabled=busy||!!live;q("remove-page").disabled=busy||!!live;
    q("undo").disabled = !!live || busy || !history.past.length;
    q("redo").disabled = !!live || busy || !history.future.length;
    q("preview").disabled = busy || !!recording;
    q("scrub").max = project.duration;
    q("empty").hidden = !!project.layers.length || !!project.background.media;
    q("time").textContent = `${time.toFixed(1)} / ${project.duration.toFixed(1)}s`;
    q("scrub").value = time;
    q("draw").setAttribute("aria-pressed", String(drawing));
    q("draw-controls").hidden = !drawing;
    mediaTools?.refresh();
    captureModes?.refresh();
    syncShareDestinationButtons();
    syncSoundControls();
    if((playing||recording||live)&&!raf)raf=requestAnimationFrame(tick);
  };
  const updateInspector = () => {
    const item = layer(); q("inspector").hidden = !item;
    tools?.refresh();
    if (!item) return;
    q("text-fields").hidden = item.kind !== "text";
    const editableSticker = item.kind === "sticker" && ["reaction","location","mention","hashtag","music","question","poll","emoji","custom-text"].includes(item.sticker);
    q("sticker-edit-fields").hidden = !editableSticker;
    q("sticker-edit-poll").hidden = !editableSticker || item.sticker !== "poll";
    q("sticker-edit-text").value = item.text || "";
    q("sticker-edit-choice-a").value = item.choices?.[0] || "Yes";
    q("sticker-edit-choice-b").value = item.choices?.[1] || "No";
    q("sticker-edit-accent").value = item.color || "#e5262f";
    q("sticker-edit-surface").value = item.background || "#f4f1ec";
    q("sticker-edit-help").textContent = "";
    for (const [name, value] of Object.entries({ text: item.text || "", font: item.font || "Manrope", align: item.align || "center",
      color: item.color || "#ffffff", background: item.background || "#17191d", opacity: item.opacity, scale: item.scale,
      rotation: item.rotation, start: item.startTime, end: item.endTime })) q(name).value = value;
    q("background-on").checked = !!item.backgroundOn;
    q("start").max = project.duration; q("end").max = project.duration;
  };
  const refreshLayers = () => {
    q("layer-list").replaceChildren();
    [...project.layers].reverse().forEach((item, index) => {
      const button = document.createElement("button"); button.type = "button";
      button.textContent = (item.locked ? "Locked · " : item.hidden ? "Hidden · " : "") + (item.kind === "comment" ? "Original comment" : item.kind === "text" ? item.text.slice(0, 24) || "Text" : item.kind === "image" ? item.subjectCutout?"Subject cutout":"Image / GIF" : item.kind === "drawing" ? "Drawing" : item.kind === "sticker" ? item.sticker : "Emoji");
      button.dataset.layerId = item.id; button.setAttribute("aria-selected", String(selectedId === item.id));
      button.onclick = () => { inline?.finish(); selectedId = item.id; drawing = false; if (time < item.startTime || time > item.endTime) seek(item.startTime); changed(); };
      button.ondblclick = () => inline.edit(item);
      q("layer-list").appendChild(button);
    });
  };
  const changed = (full = true) => {
    if (closed) return;
    if (full) { refreshLayers(); updateInspector(); pages?.refresh(); }
    refreshControls(); render(time);
  };
  const revealStickerEditor = item => {
    if(item?.kind!=="sticker")return;
    q("inspector").classList.remove("is-collapsed");
    q("style-toggle").setAttribute("aria-expanded","true");
  };
  const select = id => { if (id!==selectedId) inline?.finish(); selectedId = id; changed(); revealStickerEditor(project.layers.find(item=>item.id===id)); };
  const remove = () => { if(layer()?.locked)return; history.record(); inline?.finish(); project.layers = project.layers.filter(item => item.id !== selectedId); selectedId = null; changed(); };
  const seek = value => {
    stopPlayback(); time = clamp(value, 0, project.duration);
    const video = backgroundVideo(); if(video&&!live){if(project.background.videoEdit)syncVideoEdit(video,project.background,time);else video.currentTime=Math.min(time,Math.max(0,video.duration-.01));}
    syncSoundPreviewTime(time);
    refreshControls(); render(time);
  };
  const options = () => {
    q("inspector").classList.remove("is-collapsed");q("style-toggle").setAttribute("aria-expanded","true");changed();
    q("duplicate").scrollIntoView({block:"nearest",behavior:"smooth"});q("duplicate").focus({preventScroll:true});
  };
  const unbind = bindCreativeGestures(canvas, { project, measurements: () => measurements, time: () => time, selected: () => selectedId,
    select, changed, trash: q("trash"), remove, options, drawing: () => drawing ? { color: q("draw-color").value, width: Number(q("draw-width").value), opacity:Number(q("draw-opacity").value), mode:q("brush").value } : null,
    checkpoint:()=>history.record(), editText:item=>inline.edit(item),
    background:()=>{
      const media=project.background.media,item=media&&media!=="live-camera"&&!live&&!preview&&!busy&&!recording?assets.get(media):null;
      const w=item?.videoWidth||item?.naturalWidth||item?.width,h=item?.videoHeight||item?.naturalHeight||item?.height;
      return w&&h?{rect:{x:0,y:0,width:1,height:1,...project.background.crop},asset:{w,h}}:null;
    },
    setCrop:rect=>{project.background.crop={...rect};},
    preview: () => preview || busy || !!recording || !!captureTimer });
  const close = (posted = false) => {
    if (closed) return;
    closed = true; playing = false; soundPreview.pause();soundPreview.removeAttribute("src");soundPreview.load();cancelAnimationFrame(raf); mentionCleanup(); unbind();unbindTheme();mediaTools?.dispose();
    if (recording?.state !== "inactive") recording?.stop();
    stopLive(); closeEmojiPicker(); assets.dispose();
    strip?.dispose();
    for (const url of blobs.keys()) URL.revokeObjectURL(url);
    document.removeEventListener("keydown", keyboard); window.removeEventListener("pagehide", pagehide);
    window.removeEventListener("beforeunload",beforeunload);
    viewport.dispose(); sheets?.dispose(); document.body.style.overflow = oldOverflow;
    root.remove(); currentEditor = null;
    if (!posted) onClose?.();
  };
  currentEditor = close;
  const pagehide = () => close(true);
  window.addEventListener("pagehide", pagehide);
  const sceneHasContent=scene=>!!(scene&&(scene.layers?.some(item=>item.kind!=="text"||item.text?.trim())||
    scene.background?.media&&scene.background.media!=="live-camera"||scene.pages?.some(sceneHasContent)));
  const hasContent=()=>!!(sceneHasContent(project)||sceneHasContent(quoteReturn?.project)||sceneHasContent(quoteDraft)||
     previousCamera?.background.media||q("caption").value.trim());
  const beforeunload=event=>{if(!closed&&hasContent()){event.preventDefault();event.returnValue="";}};
  if (!editor.classList.contains("is-create-v2")) window.addEventListener("beforeunload",beforeunload);
  const hideExit=()=>{q("exit-dialog").hidden=true;editor.querySelectorAll(":scope > :not(#ce-exit-dialog)").forEach(node=>node.inert=false);q("exit-cancel").focus();};
  const showExit=()=>{
    if(editor.classList.contains("is-create-v2")){inline?.finish();close();return;}
    if(!hasContent()){close();return;}
    inline?.finish();q("exit-dialog").hidden=false;
    editor.querySelectorAll(":scope > :not(#ce-exit-dialog)").forEach(node=>node.inert=true);
    q("exit-cancel").focus();
  };
  const keyboard = event => {
    if (document.querySelector(".emoji-overlay")) return;
    if(!q("exit-dialog").hidden&&event.key==="Escape"){event.preventDefault();hideExit();return;}
    if(event.key==="Escape"){event.preventDefault();navigateBack();}
    if (event.key === "Tab") {
      const host=q("exit-dialog").hidden?root:q("exit-dialog");
      const controls = [...host.querySelectorAll("button,input,textarea,select")].filter(el => !el.disabled && !el.closest("[hidden]") && el.getClientRects().length);
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }
  };
  document.addEventListener("keydown", keyboard);
  q("close").onclick = () => {
    navigateBack();
  };
  q("back").onclick = () => navigateBack();
  q("exit-cancel").onclick=hideExit;
  q("exit-discard").onclick=()=>{if(!busy)close();};
  q("save-exit")?.addEventListener("click",()=>void saveAndExit());
  async function saveAndExit(){
    if(!onSave||busy||recording||captureTimer)return;
    inline.finish();pages.flush();
    if(!hasContent()){close();return;}
    ++cameraRequest;stopLive();cameraOpen=false;
    if(previousCamera){project.background=previousCamera.background;setProjectDuration(project,previousCamera.duration);previousCamera=null;}
    changed();await q("publish").onclick();
  }
  function navigateBack(){
    if(busy||recording||captureTimer)return;
    if(editor.classList.contains("is-create-v2")){inline?.finish();close();return;}
    if(cameraOpen){showExit();return;}
    if(sheets?.dismissAll())return;
    if(quoteReturn){
      inline.finish();quoteDraft=structuredClone(project);quoteCaption=q("caption").value;
      const saved=quoteReturn;quoteReturn=null;replaceProject(saved.project);
      previousCamera=null;selectedId=saved.selectedId;time=saved.time;
      history.past=saved.past;history.future=saved.future;
      editor.classList.remove("is-quote");q("title").textContent="Create";
      q("inline-text").setAttribute("aria-label","Text on media");
      q("destination").value=["post","community","story"].includes(saved.destination)?saved.destination:"post";syncDestinationChoice();q("caption").value=saved.caption;
      pages.reset();changed();
      if(saved.cameraOpen||!source&&!onSave&&!project.background.media)void camera();
      return;
    }
    if(inline?.active()){inline.finish();changed();return;}
    const openMenus=root.querySelectorAll("details[open]");
    if(openMenus.length){openMenus.forEach(menu=>menu.open=false);return;}
    if(!q("media-panel").hidden){q("media-close").click();return;}
    if(!cameraOpen&&!source&&!onSave){void camera();return;}
    showExit();
  }
  const loadSources = async () => {
    const current = source ? resolveCommentSource(source) : null;
    if (!current) return;
    const resources = [current.author.avatar, current.comment.attachment?.url].filter(Boolean);
    await Promise.all(resources.map(key => assets.load(key).catch(() => {})));
    if (!closed) changed(false);
  };
  const setBackground = async (file, kind) => {
    if (closed) return;
    previousCamera = null;
    const wasMirrored=!!project.background.mirror;
    const cameraEdits=project.background.media==="live-camera"?{crop:project.background.crop,adjustments:project.background.adjustments}:null;
    const value = typeof file === "string" && /^data:(image|video)\//.test(file) ? await (await fetch(file)).blob() : file;
    const media = typeof value === "string" ? value : rememberBlob(value);
    const item = await assets.load(media, kind === "video" ? "video" : "image");
    if (closed) return;
    stopPlayback();
    history.record(); stopLive();cameraOpen=false;
    project.background = { kind, media, color: q("canvas-color").value,...cameraEdits };
    if(kind==="photo")strip?.add(media);
    if(!cameraEdits||kind!=="video")delete project.background.mirror;else if(wasMirrored)project.background.mirror=true;
    setProjectDuration(project, kind === "video" ? Math.min(60, item.creativeDuration || item.duration) : 5);
    if(kind==="video")initVideoEdit(project.background,item.creativeDuration||item.duration);
    time = 0; changed(); status(kind === "video" ? "Video ready. Edit on screen or choose a tool below." : "Photo ready. Edit directly on screen.");
  };
  strip=createCameraStrip({host:q("camera-strip"),uploadHost:q("camera-gallery-slot"),onUpload:()=>{if(!busy&&!recording&&!captureTimer)q("upload").click();},
    onPick:async url=>{
      const blob=blobs.get(url);if(!blob||busy||recording||captureTimer)return;
      try{busy=true;inline?.finish();error("");refreshControls();
        await setBackground(blob,"photo");
      }catch(failure){error(failure);}finally{busy=false;if(!closed)changed();}
    }});
  q("upload").onchange = async event => {
    const files = [...event.target.files]; event.target.value = ""; if (!files.length) return;
    if (editor.classList.contains("is-quote")) {
      if (files.length !== 1 || !files[0].type.startsWith("image/")) {
        return error("Choose one supported photo for this quote.");
      }
      try {
        busy = true; inline.finish(); error(""); refreshControls();
        await setBackground(files[0], "photo");
        status("Photo added to quote. Adjust the text and share when ready.");
      } catch (failure) {
        error(failure);
      } finally {
        busy = false;
        if (!closed) changed();
      }
      return;
    }
    if(files.length>10)return error("Choose up to 10 photos or videos.");
    if (files.some(file=>!/^(image|video)\//.test(file.type))) return error("Choose supported photos or videos.");
    try {
      busy = true; inline.finish(); error(""); refreshControls(); await setBackground(files[0], files[0].type.startsWith("video/") ? "video" : "photo");
      for(const file of files.slice(1)){
        const media=rememberBlob(file),video=file.type.startsWith("video/"),asset=await assets.load(media,video?"video":"image");
        if(!video)strip?.add(media);
        const scene=createProject(source);scene.background={kind:video?"video":"photo",media,color:project.background.color};
        setProjectDuration(scene,video?asset.creativeDuration||asset.duration:5);pages.append(scene);
      }
      pages.flush();pages.refresh();root.querySelector(".ce-source").classList.add("is-collapsed");q("source-toggle").setAttribute("aria-expanded","false");
    }
    catch (failure) { error(failure); } finally { busy = false; if (!closed) changed(); }
  };
  const camera = async () => {
    if (closed || busy || recording) return;
    cameraOpen=true;refreshControls();
    if (!navigator.mediaDevices?.getUserMedia) return error("Camera is unavailable. Upload a photo or video instead.");
    try {
      error(""); const request=++cameraRequest;
      editor.classList.add("is-camera-pending");
      // Mobile cameras may not open the other lens while the first is active.
      if(live){backgroundVideo()?.pause();live.getTracks().forEach(track=>track.stop());refreshControls();}
      const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(facing));
      if (closed || request!==cameraRequest) { stream.getTracks().forEach(track => track.stop()); return; }
      if(!previousCamera)previousCamera={background:structuredClone(project.background),duration:project.duration};
      stopPlayback(); stopLive(); live = stream;
      const video = document.createElement("video"); video.playsInline = true; video.muted = true;video.setAttribute("playsinline","");video.srcObject = stream;mediaHost.append(video);await video.play();await waitForVideoFrame(video);
      if(closed||request!==cameraRequest){stream.getTracks().forEach(track=>track.stop());video.remove();return;}
      assets.items.set("live-camera", video);
      project.background = { kind: "video", media: "live-camera", color: "#17191d", mirror: facing === "user" };q("zoom").value=1;
      q("record").disabled = false; q("photo").disabled = false; q("flip").hidden = false; time = 0;
      const caps=stream.getVideoTracks()[0]?.getCapabilities?.()||{};
      q("flash").disabled=!caps.torch;q("zoom").disabled=!caps.zoom;
      if(caps.zoom){q("zoom").min=caps.zoom.min;q("zoom").max=caps.zoom.max;const z=naturalZoom(caps.zoom.min,caps.zoom.max);q("zoom").value=z;if(stream.getVideoTracks()[0].getSettings?.().zoom!==z)void stream.getVideoTracks()[0].applyConstraints({advanced:[{zoom:z}]}).catch(()=>{});}
      status("Tap the shutter for a photo. Press and hold to switch to video."); changed();
      root.querySelector(".ce-source").classList.add("is-collapsed");q("source-toggle").setAttribute("aria-expanded","false");
      editor.classList.remove("is-camera-pending");
    } catch (failure) {
      editor.classList.remove("is-camera-pending");
      stopLive(); if(previousCamera){project.background=previousCamera.background;setProjectDuration(project,previousCamera.duration);previousCamera=null;}
      error(failure.name === "NotAllowedError" ? "Allow camera access, or upload a file." : "Camera unavailable. Upload a photo or video instead."); changed();
    }
  };
  q("camera").onclick = camera;
  q("empty-camera")?.addEventListener("click", camera);
  q("empty-upload")?.addEventListener("click", () => q("upload").click());
  q("empty-text")?.addEventListener("click", () => root.querySelector('[data-ce-add="text"]')?.click());
  q("flip").onclick = () => { facing = facing === "user" ? "environment" : "user"; void camera(); };
  const countdown=action=>{
    const delay=Number(q("camera-timer").value);if(!delay){void action();return;}
    let remaining=delay;status(`Capturing in ${remaining}…`);
    captureTimer=setInterval(()=>{if(closed||!live){clearInterval(captureTimer);captureTimer=null;return;}remaining--;
      if(remaining<=0){clearInterval(captureTimer);captureTimer=null;void action();}else status(`Capturing in ${remaining}…`);
    },1000);refreshControls();
  };
  const pinch=new Map();let pinchStart=null;
  const zoomTo=value=>{const track=live?.getVideoTracks()[0];if(!track||q("zoom").disabled)return;q("zoom").value=value;void track.applyConstraints({advanced:[{zoom:value}]}).catch(()=>{});};
  canvas.addEventListener("pointerdown",e=>{if(!live||q("zoom").disabled||busy||captureTimer||!cameraOpen)return;pinch.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pinch.size===2){const [a,b]=[...pinch.values()];pinchStart={d:distance(a,b),z:Number(q("zoom").value)};}});
  canvas.addEventListener("pointermove",e=>{if(!pinch.has(e.pointerId))return;pinch.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pinch.size===2&&pinchStart){e.preventDefault();const [a,b]=[...pinch.values()];zoomTo(zoomFromPinch(pinchStart.z,pinchStart.d,distance(a,b),Number(q("zoom").min),Number(q("zoom").max)));}});
  const endPinch=e=>{pinch.delete(e.pointerId);if(pinch.size<2)pinchStart=null;};
  canvas.addEventListener("pointerup",endPinch);canvas.addEventListener("pointercancel",endPinch);
  q("flash").onclick=async()=>{
    const track=live?.getVideoTracks()[0];if(!track)return;
    const on=q("flash").getAttribute("aria-pressed")!=="true";
    try{await track.applyConstraints({advanced:[{torch:on}]});q("flash").setAttribute("aria-pressed",String(on));}catch{error("Flash is unavailable on this camera.");}
  };
  q("zoom").oninput=()=>{const track=live?.getVideoTracks()[0];if(track)void track.applyConstraints({advanced:[{zoom:Number(q("zoom").value)}]}).catch(()=>error("Zoom is unavailable on this camera."));};
  const capturePhoto=async()=>{
    const video=assets.get("live-camera");if(!live||!video?.videoWidth)return;
    try{busy=true;refreshControls();const photo=captureFrame(document.createElement("canvas"),video,project.width,project.height,facing);const blob=await canvasBlob(photo);
      await setBackground(blob,"photo");
    }catch(failure){error(failure);}finally{busy=false;if(!closed)changed();}
  };
  q("photo").onclick=()=>{if(recording||busy||captureTimer)return;cameraMode="photo";refreshControls();};
  q("record").onclick=()=>{if(recording||busy||captureTimer)return;cameraMode="video";refreshControls();};
  const recordVideo = async () => {
    if (recording) { recording.stop(); return; }
    if (!live || busy) return;
    try {
      busy=true;refreshControls();
      if(!live.getAudioTracks().length){
        try{const audio=await navigator.mediaDevices.getUserMedia({audio:true});if(closed||!live){audio.getTracks().forEach(track=>track.stop());return;}audio.getAudioTracks().forEach(track=>live.addTrack(track));}
        catch{error("Microphone unavailable. This video will be recorded without sound.");}
      }
      const chunks = [], recorder = new MediaRecorder(live, { mimeType: videoMime(), videoBitsPerSecond: 8_000_000 });
      busy=false;
      recording = recorder; recordingStart = performance.now();
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { error("Recording failed. Upload a video or try again."); recording = null; refreshControls(); };
      recorder.onstop = async () => {
        const duration = Math.min(60, (performance.now() - recordingStart) / 1000);
        recording = null; if (closed) return;
        busy = true; refreshControls();
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType }); if (!blob.size) throw new Error("The recording was empty.");
          await setBackground(blob, "video");
          // Some WebM recorders omit the container duration. Retain the measured recording duration.
          setProjectDuration(project,duration);
          const asset=backgroundVideo();if(asset)asset.creativeDuration=project.duration;
          delete project.background.videoEdit;initVideoEdit(project.background,project.duration);
          time=0;status("Recording ready. Preview it before sharing.");
        } catch (failure) { error(failure); }
        finally { busy = false; if (!closed) changed(); }
      };
      recorder.start(200);refreshControls();status("Recording underneath your layers…");
    } catch (failure) { busy=false;error(failure); recording = null; refreshControls(); }
  };
  q("shutter").onclick=()=>{
    if(ignoreNextShutterClick){ignoreNextShutterClick=false;return;}
    if(recording){if(recording.state!=="inactive")recording.stop();q("shutter").disabled=true;return;}
    if(!live||busy||captureTimer)return;
    countdown(cameraMode==="photo"?capturePhoto:recordVideo);
  };
  q("shutter").addEventListener("pointerdown",event=>{
    if(!cameraOpen||!live||busy||recording||captureTimer||event.button>0)return;
    clearTimeout(shutterHoldTimer);
    shutterHoldTimer=setTimeout(()=>{
      shutterHoldTimer=null;
      if(closed||!live||recording||busy)return;
      ignoreNextShutterClick=true;
      window.setTimeout(()=>{ignoreNextShutterClick=false;},750);
      captureModes?.select(cameraMode==="video"?"photo":"video");
      status("Video mode selected. Tap the shutter to start recording.");
    },450);
  });
  const cancelShutterHold=event=>{
    clearTimeout(shutterHoldTimer);
    shutterHoldTimer=null;
    if(event?.type==="pointercancel"||event?.type==="lostpointercapture")ignoreNextShutterClick=false;
  };
  q("shutter").addEventListener("pointerup",cancelShutterHold);
  q("shutter").addEventListener("pointercancel",cancelShutterHold);
  q("shutter").addEventListener("lostpointercapture",cancelShutterHold);
  const add = item => {
    inline?.finish(); history.record();
    item.endTime = project.duration; project.layers.push(item); selectedId = item.id; drawing = false; changed(); revealStickerEditor(item); return item;
  };
  inline = bindInlineText({ input:q("inline-text"),done:q("text-done"),canvas,project,layer,history,changed });
  tools = bindCreativeTools({root,q,project,layer,history,inline,add,changed,seek,setSelected:id=>{selectedId=id;}});
  pages = bindCreativePages({q,project,history,changed,seek,setSelected:id=>{selectedId=id;}});
  mediaTools=bindMediaEditor({root,editor,q,project,assets,history,changed,seek,time:()=>time,stop:stopPlayback,
    canEdit:()=>!busy&&!recording&&!captureTimer,inline,error});
  captureModes=bindCaptureModes({editor,q,changed,canEdit:()=>!busy&&!recording&&!captureTimer,alive:()=>!closed});
  sheets = bindSheets({ root, editor, q });
  root.querySelectorAll("[data-ce-add]").forEach(button => button.onclick = () => {
    const kind = button.dataset.ceAdd;
    if (kind === "text") { const item=add(createLayer("text",{text:"",color:project.background.kind==="color"?"#17191d":"#ffffff"})); inline.edit(item); }
    if (kind === "image") q("image-upload").click();
    if (kind === "sticker") {inline.finish();q("stickers").hidden=!q("stickers").hidden;}
    if (kind === "comment") {inline.finish();tools.populateComments();q("comments").hidden=!q("comments").hidden;}
    if (kind === "drawing") { drawing = !drawing; selectedId = null; changed(); status(drawing ? "Draw on the canvas. Turn Draw off to move your strokes as layers." : "Drawing finished."); }
    if (kind === "emoji") {
      openEmojiPicker(null, emoji => add(createLayer("emoji", { text: emoji, width: 210 })), { chat: true, selectOnly: true });
      document.querySelector(".emoji-overlay").style.zIndex = "2400";
    }
  });
  canvas.addEventListener("click",()=>{
    if(!editor.classList.contains("is-quote")||inline.active()||busy||preview)return;
    const item=layer()?.kind==="text"?layer():project.layers.find(value=>value.kind==="text"&&!value.locked);
    if(item){selectedId=item.id;inline.edit(item);changed(false);}
  });
  q("draw").onclick = () => { drawing = !drawing; selectedId = null; changed(); };
  q("image-upload").onchange = async event => {
    const file = event.target.files[0]; event.target.value = ""; if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) return error("Choose an image or GIF smaller than 10 MB.");
    try {
      const media = rememberBlob(file), image = await assets.load(media);
      if (closed) return;
      const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
      add(createLayer("image", { media, width: 480, height: 480 * height / width }));
    } catch (failure) { error(failure); }
  };
  for (const [name, property] of Object.entries({ text: "text", font: "font", align: "align", color: "color", background: "background", opacity: "opacity", scale: "scale", rotation: "rotation" })) {
    q(name).onfocus=()=>history.record();
    q(name).oninput = () => {
      const item = layer(); if (!item || busy || item.locked) return;
      item[property] = ["opacity", "scale", "rotation"].includes(name) ? Number(q(name).value) : q(name).value;
      changed(false);
      if (name === "text") refreshLayers();
    };
  }
  q("sticker-edit-text").onfocus=()=>history.record();
  q("sticker-edit-text").oninput=()=>{
    const item=layer();if(item?.kind!=="sticker"||item.locked)return;
    item.text=q("sticker-edit-text").value.slice(0,160);changed(false);refreshLayers();
  };
  for(const name of ["sticker-edit-choice-a","sticker-edit-choice-b"]){
    q(name).onfocus=()=>history.record();
    q(name).oninput=()=>{
      const item=layer();if(item?.kind!=="sticker"||item.sticker!=="poll"||item.locked)return;
      const choices=[q("sticker-edit-choice-a").value.trim().slice(0,40),q("sticker-edit-choice-b").value.trim().slice(0,40)];
      if(choices.every(Boolean)){item.choices=choices;q("sticker-edit-help").textContent="";changed(false);}
      else q("sticker-edit-help").textContent="Keep both answers filled in.";
    };
  }
  for(const [name,property] of [["sticker-edit-accent","color"],["sticker-edit-surface","background"]]){
    q(name).onfocus=()=>history.record();
    q(name).oninput=()=>{const item=layer();if(item?.kind!=="sticker"||item.locked)return;item[property]=q(name).value;changed(false);};
  }
  q("background-on").onchange = () => { if (layer()&&!layer().locked) {history.record();layer().backgroundOn = q("background-on").checked;} changed(false); };
  for (const name of ["start", "end"]) q(name).onchange = () => {
    const item = layer(); if (!item) return;
    if(item.locked)return;history.record();
    if (name === "start") item.startTime = clamp(q(name).value, 0, item.endTime - .1);
    else item.endTime = clamp(q(name).value, item.startTime + .1, project.duration);
    changed(); seek(Math.min(Math.max(time, item.startTime), item.endTime));
  };
  q("duplicate").onclick = () => { if(layer()?.locked)return;history.record();const copy = duplicateLayer(project, selectedId); if (copy) { selectedId = copy.id; changed(); } };
  q("delete").onclick = remove;
  q("forward").onclick = () => { if(layer()?.locked)return;history.record();moveLayer(project, selectedId, 1); changed(); };
  q("backward").onclick = () => { if(layer()?.locked)return;history.record();moveLayer(project, selectedId, -1); changed(); };
  q("canvas-color").onfocus=()=>history.record();
  q("canvas-color").oninput = () => { project.background.color = q("canvas-color").value; changed(false); };
  if(q("next-action"))q("next-action").onclick=()=>{
    if(onSave){q("publish").click();return;}
    inline.finish();
    q("publish").click();
  };
  if(q("final-share"))q("final-share").onclick=()=>q("publish").click();
  root.querySelectorAll("[data-ce-rail]").forEach(button=>button.onclick=()=>{
    const action=button.dataset.ceRail;
    if(action==="text"){
      if(cameraOpen){
        ++cameraRequest;stopLive();cameraOpen=false;
        if(previousCamera){
          project.background=previousCamera.background;
          setProjectDuration(project,previousCamera.duration);
          previousCamera=null;
        }else if(project.background.kind==="live-camera"){
          project.background={kind:"color",color:q("canvas-color").value,media:""};
        }
        changed();
      }
      root.querySelector('[data-ce-add="text"]').click();
    }
    if(action==="draw")q("draw").click();
    if(action==="trim")root.querySelector('[data-ce-media-tool="trim"]')?.click();
    if(action==="templates"){
      q("inspector").hidden=false;q("text-fields").hidden=false;
      q("inspector").classList.remove("is-collapsed");
      root.querySelector(".ce-panel").dataset.sheet="open";
      root.querySelector(".ce-presets")?.scrollIntoView({block:"nearest"});
    }
    if(action==="stickers")root.querySelector('[data-ce-add="sticker"]').click();
    if(action==="overlay")q("image-upload").click();
    if(action==="remove-bg")void removePersonBackground();
    if(action==="caption")q("share-toggle").click();
    if(action==="more"){
      const menu=root.querySelector(".ce-header-menu");
      if(menu)menu.open=!menu.open;
    }
    if(action==="canvas-color"){
      q("source-toggle").click();
      q("canvas-color").click();
    }
    if(action==="layers")q("layers-toggle").click();
  });
  if(q("sound-chip")){
    const soundPicker=q("sound-picker"),soundList=q("sound-list");
    const fillSavedSounds=()=>{
      soundList.replaceChildren();
      const library=savedAudio();
      if(!library.length){
        const empty=document.createElement("p");
        empty.textContent="Save a video’s sound to find it here.";
        soundList.append(empty);
        return;
      }
      for(const sound of library){
        const button=document.createElement("button");
        button.type="button";button.dataset.savedSoundId=sound.id;
        const title=document.createElement("span");title.textContent=sound.title;
        const author=document.createElement("small");author.textContent=sound.author||"Saved sound";
        button.append(title,author);soundList.append(button);
      }
    };
    const setSound=async({media,title,sourcePostId=null,previewUrl=null})=>{
      const preview=previewUrl||await mediaUrl(media);
      const track={id:`sound-${crypto.randomUUID()}`,media,title:String(title||"Sound").trim().slice(0,100),sourcePostId,volume:activeSound()?.volume??.8,offset:0,loop:true};
      history.record();project.audioTracks=[track];
      soundPreview.pause();soundPreview.dataset.creativeMedia=media;soundPreview.src=preview;soundPreview.load();
      soundPicker.hidden=true;q("sound-error").textContent="";
      changed();
    };
    q("sound-chip").onclick=()=>{
      inline?.finish();q("sound-error").textContent="";
      fillSavedSounds();soundPicker.hidden=!soundPicker.hidden;
      q("sound-chip").setAttribute("aria-expanded",String(!soundPicker.hidden));
      if(!soundPicker.hidden)q("sound-close").focus();
    };
    q("sound-close").onclick=()=>{soundPicker.hidden=true;q("sound-chip").setAttribute("aria-expanded","false");q("sound-chip").focus();};
    q("sound-upload-open").onclick=()=>q("sound-upload").click();
    q("sound-upload").onchange=async event=>{
      const file=event.target.files?.[0];event.target.value="";
      if(!file)return;
      if(!file.type.startsWith("audio/")&&!/\.(mp3|m4a|aac|wav|ogg|opus|flac|webm)$/i.test(file.name)){
        q("sound-error").textContent="Choose an audio file.";return;
      }
      try{
        const media=rememberBlob(file);
        await setSound({media,title:file.name.replace(/\.[^.]+$/,"")||"My sound",previewUrl:media});
      }catch(failure){q("sound-error").textContent=failure.message||"Couldn’t add that sound.";}
    };
    soundList.onclick=async event=>{
      const button=event.target.closest("[data-saved-sound-id]");if(!button)return;
      const post=api.post(button.dataset.savedSoundId),source=audioSource(post);
      if(!source?.media?.[0]){q("sound-error").textContent="That saved sound is no longer available.";return;}
      button.disabled=true;q("sound-error").textContent="";
      try{
        const media=source.media[0],previewUrl=await mediaUrl(media);
        if(closed)return;
        await setSound({media,previewUrl,title:audioTitle(post),sourcePostId:source.id});
      }catch(failure){q("sound-error").textContent=failure.message||"Couldn’t load that sound.";}
      finally{if(button.isConnected)button.disabled=false;}
    };
    q("sound-volume").onfocus=()=>history.record();
    q("sound-volume").oninput=()=>{
      const track=activeSound();if(!track)return;
      track.volume=Number(q("sound-volume").value);soundPreview.volume=track.volume;changed(false);
    };
    q("sound-remove").onclick=()=>{
      history.record();project.audioTracks=[];soundPreview.pause();soundPreview.removeAttribute("src");delete soundPreview.dataset.creativeMedia;soundPreview.load();soundPicker.hidden=true;changed();
    };
  }
  async function removePersonBackground(){
    const item=layer();
    const backgroundTarget=item?.kind!=="image"&&project.background.kind==="photo"&&project.background.media;
    if(item?.kind!=="image"&&!backgroundTarget)return error("Select a photo or image overlay first.");
    if(item?.locked)return error("Unlock this image before editing it.");
    const image=assets.get(backgroundTarget?project.background.media:item.media);
    if(!image)return error("The selected photo is not ready yet.");
    if(busy||recording||live)return;
    busy=true;refreshControls();error("");status("Preparing local person cutout…");
    let cutout;
    try{
      const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
      cutout=await createPersonCutout({still:true});
      const matte=await cutout.image(image);
      const work=document.createElement("canvas");work.width=width;work.height=height;
      const context=work.getContext("2d",{willReadFrequently:true});
      context.drawImage(image,0,0,width,height);
      context.globalCompositeOperation="destination-in";
      context.drawImage(matte,0,0,width,height);
      context.globalCompositeOperation="source-over";
      const blob=await new Promise((resolve,reject)=>work.toBlob(value=>value?resolve(value):reject(new Error("Could not create the transparent image.")),"image/png"));
      if(closed)return;
      history.record();
      const media=rememberBlob(blob);await assets.load(media,"image");
      if(backgroundTarget)project.background.media=media;else item.media=media;
      changed();
      status("Person cutout ready.");
    }catch(failure){error(failure);}
    finally{cutout?.close();busy=false;if(!closed)changed(false);}
  }
  q("preview").onclick = () => {
    inline.finish();
    preview = !preview; drawing = false; editor.classList.toggle("is-preview", preview); q("preview").setAttribute("aria-pressed", String(preview));
    q("preview").querySelector(".ce-lbl").textContent=preview?"Edit":"Preview";changed(false);
    if (preview) { seek(0); q("play").click(); }
  };
  q("scrub").oninput = () => { if (!live && !busy) seek(q("scrub").value); };
  q("play").onclick = async () => {
    if (live || busy) return;
    if (playing) { stopPlayback(); refreshControls(); return; }
    if (time >= project.duration - .05) time = 0;
    playbackStart = performance.now() - time * 1000; playing = true;
    const video = backgroundVideo();
    if(video){if(project.background.videoEdit)syncVideoEdit(video,project.background,time);else video.currentTime=time;video.muted=false;try{await video.play();}catch(failure){playing=false;error(failure);}}
    if(activeSound()&&soundPreview.src){
      syncSoundPreviewTime(time);
      try{await soundPreview.play();}catch{if(q("sound-error"))q("sound-error").textContent="Sound preview could not start. Tap Play to try again.";}
    }
    refreshControls();
  };
  q("publish").onclick = async () => {
    if (busy || live) return;
    inline.finish();
    pages.flush();
    const destination = q("destination").value;
    busy = true; stopPlayback(); refreshControls(); error(""); status("Saving your layers and media…");
    try {
      if(onSave){
        validateProjectSources(project);
        await onSave({project,blobs,ownerId,active:()=>!closed&&api.me()?.id===ownerId,caption:q("caption").value,
          preview:async()=>{
            await document.fonts.ready;
            // Blast's fallback media must not bake revocable source comments into pixels.
            const scene=structuredClone(project);scene.layers=scene.layers.filter(item=>item.kind!=="comment");
            const animated=projectOutputKind(scene,assets)==="video";
            return animated?exportCreativeVideo({canvas,video:backgroundVideo(),background:scene.background,duration:scene.duration,render:at=>drawProject(canvas,scene,assets,resolveCommentSource,at),alive:()=>!closed,audioTracks:await exportAudioTracks(scene)})
              :(drawProject(canvas,scene,assets,resolveCommentSource,time),canvasBlob(canvas));
          }});
        close(true);return;
      }
      if (api.authMode() !== "cloud") {
        throw new Error("Reconnect your online account before publishing. Nothing was saved on this device.");
      }
      if (["story", "post", "community"].includes(destination)) {
        validateProjectSources(project);
        if (destination !== "story") validateProjectAudience(project, q("visibility").value);
        if (api.me()?.id !== ownerId || closed) throw new Error("This editing session has ended.");
        await document.fonts.ready;
        const storyProject = structuredClone(project);
        const outputKind=projectOutputKind(storyProject,assets);
        const hasAddedSound=storyProject.audioTracks?.some(track=>track?.media);
        const original = destination !== "story"&&!hasAddedSound ? matchingOriginal(originalPublicationMedia(storyProject, blobs, assets.get(storyProject.background.media)),outputKind) : null;
        const scenes = projectScenes(storyProject);
        const carousel = destination !== "story" && outputKind==="photo" && scenes.length > 1 && scenes.length <= 10 &&
          scenes.every(scene => scene.background.kind==="photo" && scene.background.media);
        const animated = outputKind==="video";
        const rendered = [];
        if (carousel) {
          for (const scene of scenes) {
            drawProject(canvas, scene, assets, resolveCommentSource, 0);
            rendered.push(await canvasBlob(canvas));
          }
        }
        const mediaBlob = original || (carousel ? rendered[0] : animated
          ? await exportCreativeVideo({
              canvas, video: backgroundVideo(), background: storyProject.background,
              duration: storyProject.duration,
              render: at => drawProject(canvas, storyProject, assets, resolveCommentSource, at),
              alive: () => !closed && api.me()?.id === ownerId,
              audioTracks: await exportAudioTracks(storyProject),
            })
          : (drawProject(canvas, storyProject, assets, resolveCommentSource, 0), await canvasBlob(canvas)));
        if (!mediaBlob.size) throw new Error("The rendered Story is empty.");
        if (api.me()?.id !== ownerId || closed) throw new Error("This editing session has ended.");
        validateProjectSources(project);
        if (destination !== "story") validateProjectAudience(project, q("visibility").value);
        status(destination === "story" ? "Preparing Story upload…" : "Preparing post upload…");
        const shareToOtherFeed = destination !== "story" && q("other-feed").checked;
        const postDestination = destination === "community"
          ? (shareToOtherFeed ? "both" : "community")
          : (shareToOtherFeed ? "both" : "main");
        const item = destination === "story" ? await api.createCloudStory({
          text: q("caption").value,
          visibility: q("visibility").value,
          mediaBlob,
          onUploadProgress: (fraction, phase) => !closed && status(
            phase === "compressing" ? `Optimizing video to 720p · ${Math.round(fraction * 100)}%`
              : `Uploading Story · ${Math.round(fraction * 100)}%`,
          ),
        }) : await publishRenderedPost({
          blobs: carousel ? rendered : [mediaBlob],
          upload: (blob, onProgress) => putLocalMedia(blob, undefined, (fraction, phase) => {
            if (phase === "compressing") {
              if (!closed) status(`Optimizing video to 720p · ${Math.round(fraction * 100)}%`);
            } else {
              onProgress?.(fraction);
            }
          }),
          onProgress: ({ fraction, index, total }) => !closed && status(
            `Uploading post${total > 1 ? ` · ${index + 1} of ${total}` : ""} · ${Math.round(fraction * 100)}%`,
          ),
          createPost: (text, fields) => api.createCloudPost(text, { ...fields, destination: postDestination }),
          text: q("caption").value,
          visibility: q("visibility").value,
          place: storyProject.place || null,
          active: () => !closed && api.me()?.id === ownerId,
        });
        close(true);
        const story = destination === "story";
        toast(story ? "Story uploaded" : "Posted");
        onPosted?.(item?.id, story, !story && (openedInCommunity || destination === "community"));
        return;
      }
      const item = await publishCreativeProject(project, blobs, { destination, visibility: q("visibility").value,
        quote: editor.classList.contains("is-quote"),
        caption: q("caption").value, location:q("location").value, ownerId, active: () => !closed });
      const story = q("destination").value === "story"; close(true); toast(story ? "Added to your story" : "Posted"); onPosted?.(item.id, story, !story && (openedInCommunity || destination === "community"));
    } catch (failure) { if (!closed) { busy = false; error(failure); status("Your edit is still here. Nothing was published."); refreshControls(); } }
  };
  q("export").onclick = async () => {
    if (busy || live) return;
    inline.finish();
    busy = true; stopPlayback(); refreshControls(); error(""); status("Rendering your preview…");
    try {
      validateProjectSources(project); await document.fonts.ready;
      const animated = projectOutputKind(project,assets)==="video";
      const blob = animated ? await exportCreativeVideo({ canvas, video: backgroundVideo(),background:project.background, duration: project.duration, render: at => drawProject(canvas, project, assets, resolveCommentSource, at),
        alive: () => { if (closed) return false; try { validateProjectSources(project); return true; } catch { return false; } },audioTracks:await exportAudioTracks(project) }) : (drawProject(canvas, project, assets, resolveCommentSource, time), await canvasBlob(canvas));
      if (closed) return;
      const link = document.createElement("a"), url = URL.createObjectURL(blob);
      link.href = url; link.download = `old-time-remix.${blob.type.includes("mp4") ? "mp4" : blob.type.startsWith("video/") ? "webm" : "png"}`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
      status("Preview downloaded. Shared remixes keep editable layers and source links.");
    } catch (failure) { if (!closed) error(failure); }
    finally { busy = false; if (!closed) changed(); }
  };
  function tick(now) {
    raf=0;
    if (closed) return;
    if (recording) {
      time = Math.min(project.duration, (now - recordingStart) / 1000);
      if (now - recordingStart >= 60_000 && recording.state === "recording") recording.stop();
    } else if (playing) {
      time = Math.min(project.duration, (now - playbackStart) / 1000);
      syncVideoEdit(backgroundVideo(),project.background,time,true);
      if (time >= project.duration) stopPlayback();
    }
    if (!busy && (playing || recording || live)) render(time);
    q("scrub").value = time; q("time").textContent = `${time.toFixed(1)} / ${project.duration.toFixed(1)}s`;
    if(playing||recording||live)raf = requestAnimationFrame(tick);
  }
  q("caption").value=caption;q("location").value=location;
  {const loc=q("location");loc.readOnly=true;loc.placeholder="Add place";
   const pick=()=>openPlacePicker({value:project.place||(loc.value?{id:"custom:existing",label:loc.value,source:"custom"}:null),toast,
     onSelect:p=>{project.place=p;loc.value=p.label;},onRemove:()=>{project.place=null;loc.value="";}});
   loc.onclick=pick;loc.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();pick();}};}
  q("destination").value=["post","community","story"].includes(destination)?destination:"post";
  const syncDestinationChoice = () => {
    const selected = q("destination").value;
    q("other-feed-label").textContent = selected === "community" ? "Also share to Main feed" : "Also share to Community";
    q("other-feed-field").hidden = selected === "story" || !!onSave;
    q("location").closest("label").hidden = selected === "story";
    if (selected === "story") q("other-feed").checked = false;
    syncShareDestinationButtons();
  };
  q("destination").addEventListener("change", syncDestinationChoice);
  syncDestinationChoice();
  if(onSave){q("publish").textContent=saveLabel;q("next-action").textContent=saveLabel;q("destination").closest("label").hidden=true;q("visibility").closest("label").hidden=true;}
  q("visibility").value = visibility || (api.me().private ? "friends" : "public");
  syncShareDestinationButtons();
  root.querySelectorAll("[data-ce-share-destination]").forEach(button => {
    button.onclick = () => {
      const choice = button.dataset.ceShareDestination;
      if (choice === "story") {
        q("destination").value = "story";
        q("visibility").value = api.me().private ? "friends" : "public";
      } else if (choice === "close-friends") {
        q("destination").value = "story";
        q("visibility").value = "close-friends";
      } else {
        q("destination").value = "post";
        if (!["friends", "public"].includes(q("visibility").value)) {
          q("visibility").value = api.me().private ? "friends" : "public";
        }
      }
      syncDestinationChoice();
      changed();
    };
  });
  root.querySelectorAll("[data-ce-feed-visibility]").forEach(button => {
    button.onclick = () => {
      if (q("destination").value === "story") q("destination").value = "post";
      q("visibility").value = button.dataset.ceFeedVisibility;
      syncDestinationChoice();
      changed();
    };
  });
  syncShareDestinationButtons();
  if (source && !api.canSeePost(api.post(source.postId), null)) {
    q("visibility").value = api.post(source.postId).visibility === "close-friends" ? "close-friends" : "friends";
    status("The original is restricted. Your remix must use an audience that can view it.");
  }
  if(onSave){
    q("save-hint").textContent="Returns your edit to its original composer without sharing.";
    q("exit-description").textContent="Your edit will be returned to the original composer, or you can discard it. Nothing will be shared.";
  }
  changed(); void loadSources(); raf = requestAnimationFrame(tick); q("close").focus();
  if (startShare) q("share-toggle").click();
  void (async()=>{
    if(closed)return;
    if(initialProject){
      await Promise.all([project,...project.pages||[]].flatMap(scene=>[
        scene.background.media?assets.load(scene.background.media,scene.background.kind==="video"?"video":"image"):null,
        ...scene.layers.filter(item=>item.kind==="image").map(item=>assets.load(item.media))
      ]).filter(Boolean)).catch(error);
      if(!closed){pages.reset();changed();}
    }else{
      if(shouldAutoStartCamera({
        startCamera,
        hasSource: !!source,
        hasInitialProject: !!initialProject,
        hasBackground: !!background?.media,
        hasSaveHandler: !!onSave,
        preferMediaPicker: mediaPicker
      }))void camera();
      if(background?.media)await setBackground(background.media,background.kind).catch(error);
    }
  })();
  return { project, close };
}
