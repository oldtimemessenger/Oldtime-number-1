import { api } from "./store.js";
import { openBlastCreative } from "./blast-creative.js";
import { listBlastFriends, listBlastGroups } from "./blast-store.js";
import {
  createBlastVideoNote,
  deleteBlastMedia,
  getBlastVideoNoteLimits,
  saveBlastMedia
} from "./blast-video-note-store.js";

const COLORS = ["#ffffff", "#f4d35e", "#f28482", "#84a59d", "#5b8def"];
const LIMITS = getBlastVideoNoteLimits();
const composer = {
  blob: null,
  mediaType: "video",
  name: "Video note",
  duration: 0,
  previewUrl: "",
  caption: "",
  overlays: { strokes: [], labels: [] },
  color: "#ffffff",
  tool: "draw",
  channel: "feed",
  audience: "friends",
  groupId: "",
  recipientId: "",
  shareContext: { channel: "feed" },
  returnView: { name: "notes" }
};

const camera = {
  stream: null,
  recorder: null,
  chunks: [],
  timer: null,
  elapsed: 0,
  elapsedBeforePause: 0,
  segmentStartedAt: 0,
  facingMode: "user",
  cancelled: false,
  app: null
};

let observer;
let observedApp;

function timeLabel(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function getUser(id, ctx) {
  const user = api.user(id);
  return {
    name: user?.name || user?.username || "Oldtime member",
    username: user?.username || "member",
    avatar: user?.avatar || ""
  };
}

function safeNumber(value, fallback = 50) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : fallback;
}

function safeColor(color) {
  return COLORS.includes(color) ? color : "#ffffff";
}

function overlayMarkup(ctx) {
  const strokes = composer.overlays.strokes.map(stroke => {
    const points = stroke.points.map(point => `${safeNumber(point.x)},${safeNumber(point.y)}`).join(" ");
    if (stroke.points.length < 2) return "";
    return `<polyline points="${points}" fill="none" stroke="${safeColor(stroke.color)}" stroke-width="${Math.max(0.7, Math.min(7, Number(stroke.width) || 2.5))}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />`;
  }).join("");
  const labels = composer.overlays.labels.map(label => {
    const text = String(label.text || "").slice(0, 80);
    if (!text) return "";
    return `<text x="${safeNumber(label.x)}" y="${safeNumber(label.y)}" fill="${safeColor(label.color)}" font-size="${Math.max(2, Math.min(12, Number(label.size) || 6))}" text-anchor="middle" dominant-baseline="middle" paint-order="stroke fill" stroke="rgba(0,0,0,.65)" stroke-width="1.4" stroke-linejoin="round">${ctx.esc(text)}</text>`;
  }).join("");
  return strokes + labels;
}

function setCameraMessage(app, message, isError = false) {
  const status = app.querySelector("[data-bvn-camera-status]");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function stopStream() {
  camera.stream?.getTracks().forEach(track => track.stop());
  camera.stream = null;
}

function stopTimer() {
  clearInterval(camera.timer);
  camera.timer = null;
}

export function closeBlastNoteCamera(cancelled = true) {
  camera.cancelled = cancelled;
  stopTimer();
  if (camera.recorder && camera.recorder.state !== "inactive") {
    try { camera.recorder.stop(); } catch { /* recorder may already be stopping */ }
  }
  stopStream();
  camera.recorder = null;
}

function clearComposer() {
  closeBlastNoteCamera(true);
  if (composer.previewUrl) URL.revokeObjectURL(composer.previewUrl);
  composer.blob = null;
  composer.creativeProject = null;
  composer.mediaType = "video";
  composer.name = "Video note";
  composer.duration = 0;
  composer.previewUrl = "";
  composer.caption = "";
  composer.overlays = { strokes: [], labels: [] };
  composer.color = "#ffffff";
  composer.tool = "draw";
  composer.channel = "feed";
  composer.audience = "friends";
  composer.groupId = "";
  composer.recipientId = "";
  composer.shareContext = { channel: "feed" };
  composer.returnView = { name: "notes" };
}

function setDraftMedia(blob, name, duration, context = {}) {
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error("Choose a media file or record a video note first.");
  const mimeType = String(blob.type || "").toLowerCase().split(";")[0];
  const mediaType = mimeType.startsWith("image/") ? "image" : mimeType.startsWith("video/") ? "video" : "";
  if (!mediaType) throw new Error("Choose a supported photo or video.");
  if (composer.previewUrl) URL.revokeObjectURL(composer.previewUrl);
  composer.blob = blob;
  composer.mediaType = mediaType;
  composer.name = String(name || "Community media").slice(0, 120);
  composer.duration = mediaType === "video" ? Math.min(LIMITS.maxDurationSeconds, Number(duration) || 0) : 0;
  composer.previewUrl = URL.createObjectURL(blob);
  composer.caption = "";
  composer.overlays = { strokes: [], labels: [] };
  composer.color = "#ffffff";
  composer.tool = "draw";
  composer.shareContext = context.shareContext || { channel: "feed" };
  composer.returnView = context.returnView || { name: "notes" };
  composer.channel = composer.shareContext.channel === "chat" ? "chat" : "feed";
  composer.recipientId = composer.shareContext.recipientId || "";
  composer.audience = "friends";
  composer.groupId = "";
}

function startCameraWatch(app, ctx) {
  if (observedApp === app) return;
  observer?.disconnect();
  observedApp = app;
  observer = new MutationObserver(() => {
    if (ctx.getView()?.name === "note-camera" && !app.querySelector("[data-bvn-camera-root]")) {
      closeBlastNoteCamera(true);
    }
  });
  observer.observe(app, { childList: true, subtree: true });
}

function cameraPage(view, ctx) {
  const peerId = view.shareContext?.recipientId || "";
  const peer = peerId ? getUser(peerId, ctx) : null;
  return `<main class="bvn-camera-screen" data-bvn-camera-root>
    <header class="bvn-camera-top">
      <button class="bvn-camera-round" type="button" data-bvn-camera-cancel aria-label="Cancel">${ctx.icon("close")}</button>
      <time class="bvn-camera-timer" data-bvn-camera-timer>00:00</time>
      <button class="bvn-camera-round" type="button" data-bvn-camera-flip aria-label="Switch camera">${ctx.icon("flip")}</button>
    </header>
    <div class="bvn-camera-center">
      <div class="bvn-camera-lens"><video data-bvn-live-video autoplay muted playsinline aria-label="Camera preview"></video><span class="bvn-camera-ring" aria-hidden="true"></span></div>
      <p class="bvn-camera-status" data-bvn-camera-status aria-live="polite">Opening camera…</p>
      <p class="bvn-camera-recipient">${peer ? `Video note for ${ctx.esc(peer.name)}` : "Video note for your feed or a friend"}</p>
    </div>
    <footer class="bvn-camera-bottom">
      <button class="bvn-camera-library" type="button" data-bvn-camera-library>${ctx.icon("image")}<span>Library</span></button>
      <button class="bvn-record-button" type="button" data-bvn-record aria-label="Start video note recording"><span></span></button>
      <button class="bvn-camera-pause" type="button" data-bvn-camera-pause hidden>Pause</button>
      <div class="bvn-camera-mode"><span>PHOTO</span><b>VIDEO NOTE</b><span>60 SEC</span></div>
    </footer>
    <input class="bvn-hidden-file" data-bvn-camera-file type="file" accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm,video/quicktime,.jpg,.jpeg,.png,.webp,.avif,.mp4,.webm,.mov" aria-label="Choose a photo or video" />
  </main>`;
}

function shareDestination(ctx) {
  const friends = listBlastFriends();
  const groups = listBlastGroups();
  const feedFields = composer.audience === "group" ? (groups.length
    ? `<label class="bvn-field"><span>Group conversation</span><select class="blast-select" name="groupId" required>${groups.map(group => `<option value="${ctx.esc(group.id)}" ${group.id === composer.groupId ? "selected" : ""}>${ctx.esc(group.name)}</option>`).join("")}</select></label>`
    : `<p class="bvn-inline-notice">There are no group conversations available for this account.</p>`) : "";
  const friendOptions = friends.map(id => {
    const person = getUser(id, ctx);
    return `<option value="${ctx.esc(id)}" ${id === composer.recipientId ? "selected" : ""}>${ctx.esc(person.name)} · @${ctx.esc(person.username)}</option>`;
  }).join("");
  return `<section class="bvn-share-panel">
    <div class="bvn-section-label"><span>Share to</span></div>
    <div class="bvn-destination-tabs" role="group" aria-label="Share destination">
      <button type="button" class="${composer.channel === "feed" ? "is-active" : ""}" data-bvn-share-channel="feed" aria-pressed="${composer.channel === "feed"}">${ctx.icon("home")} Feed</button>
      <button type="button" class="${composer.channel === "chat" ? "is-active" : ""}" data-bvn-share-channel="chat" aria-pressed="${composer.channel === "chat"}">${ctx.icon("comment")} Private chat</button>
    </div>
    ${composer.channel === "feed" ? `<label class="bvn-field"><span>Who can see this?</span><select class="blast-select" name="audience">
      ${[["friends","Friends"],["group","Group conversation"],["only-me","Only me"]].map(([value, label]) => `<option value="${value}" ${composer.audience === value ? "selected" : ""}>${label}</option>`).join("")}
    </select></label>${feedFields}` : `<label class="bvn-field"><span>Send to a friend</span><select class="blast-select" name="recipientId" ${friends.length ? "required" : "disabled"}>
      <option value="">Choose a friend</option>${friendOptions}
    </select></label>${friends.length ? "" : `<p class="bvn-inline-notice">Add a friend before sending a private video note. <button type="button" class="bvn-inline-link" data-blast-nav="friends">Manage friends</button></p>`}`}
  </section>`;
}

function editorPage(ctx) {
  const media = composer.mediaType === "image"
    ? `<img src="${ctx.esc(composer.previewUrl)}" alt="Media being edited" />`
    : `<video src="${ctx.esc(composer.previewUrl)}" controls playsinline preload="metadata" aria-label="Video note preview"></video>`;
  return `<main class="bvn-editor-screen">
    <header class="bvn-editor-top"><button class="bvn-editor-close" type="button" data-bvn-discard aria-label="Discard note">${ctx.icon("close")}</button><div><span class="bvn-kicker">MAKE IT YOURS</span><h1>${composer.mediaType === "video" ? "Edit video note" : "Mark up a photo"}</h1></div><span class="bvn-editor-duration">${composer.mediaType === "video" ? timeLabel(composer.duration) : "PHOTO"}</span></header>
    <div class="bvn-editor-preview">
      <div class="bvn-editor-media">${media}<svg class="bvn-draw-layer" data-bvn-draw-layer viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Freehand drawing area">${overlayMarkup(ctx)}</svg></div>
    </div>
    <button type="button" class="bvn-share-submit" data-bvn-edit-studio>Edit in Creative Studio</button>
    <div class="bvn-editor-tools" hidden>
      <div class="bvn-tool-row">
        <button type="button" class="${composer.tool === "draw" ? "is-active" : ""}" data-bvn-editor-tool="draw">${ctx.icon("edit")} Draw</button>
        <button type="button" class="${composer.tool === "text" ? "is-active" : ""}" data-bvn-editor-tool="text">${ctx.icon("edit")} Place text</button>
        <button type="button" data-bvn-undo aria-label="Undo last mark">${ctx.icon("back")} Undo</button>
        <button type="button" data-bvn-clear>Clear</button>
      </div>
      <div class="bvn-color-row" aria-label="Markup color">${COLORS.map(color => `<button type="button" class="${composer.color === color ? "is-active" : ""}" data-bvn-color="${color}" style="--mark-color:${color}" aria-label="Use ${color}"></button>`).join("")}</div>
      <div class="bvn-text-tool">
        <input type="text" maxlength="80" data-bvn-text-overlay placeholder="Write on your media" aria-label="Text to place on media" />
      </div>
    </div>
    <form class="bvn-share-form" data-bvn-share-form>
      <label class="bvn-field"><span>Caption (optional)</span><textarea name="caption" maxlength="500" data-bvn-caption placeholder="Add a short note…">${ctx.esc(composer.caption)}</textarea></label>
      ${shareDestination(ctx)}
      <div class="bvn-editor-save-dock">
        <button class="bvn-share-submit" type="submit" ${composer.channel === "chat" && !listBlastFriends().length ? "disabled" : ""} data-testid="blast-video-note-send">${ctx.icon("send")} Save &amp; ${composer.channel === "chat" ? "send" : "share"} ${composer.mediaType === "video" ? "video note" : "photo note"}</button>
      </div>
    </form>
  </main>`;
}

export function renderBlastNoteComposer(view, ctx) {
  return view.name === "note-camera" ? ctx.page("Create a video note", "") : editorPage(ctx);
}

function bindCamera(view, ctx) {
  const app = ctx.app;
  camera.app = app;
  camera.cancelled = false;
  startCameraWatch(app, ctx);
  app.querySelector("[data-bvn-camera-cancel]")?.addEventListener("click", () => {
    const hasDraft = Boolean(composer.blob);
    if (hasDraft && !confirm("Discard the current video note draft?")) return;
    closeBlastNoteCamera(true);
    clearComposer();
    ctx.setView(view.returnView || composer.returnView || "notes");
  });
  app.querySelector("[data-bvn-camera-flip]")?.addEventListener("click", () => {
    if (camera.recorder && camera.recorder.state !== "inactive") return;
    camera.facingMode = camera.facingMode === "user" ? "environment" : "user";
    stopStream();
    startLiveCamera(app);
  });
  app.querySelector("[data-bvn-record]")?.addEventListener("click", () => {
    if (camera.recorder && camera.recorder.state !== "inactive") stopRecording(ctx);
    else startRecording(ctx);
  });
  app.querySelector("[data-bvn-camera-pause]")?.addEventListener("click", () => togglePause(app));
  app.querySelector("[data-bvn-camera-library]")?.addEventListener("click", () => app.querySelector("[data-bvn-camera-file]")?.click());
  app.querySelector("[data-bvn-camera-file]")?.addEventListener("change", event => {
    const file = event.currentTarget.files?.[0];
    if (file) openSelectedFile(file, view, ctx).catch(error => setCameraMessage(app, error.message, true));
    event.currentTarget.value = "";
  });
  if (view.openLibrary) {
    setTimeout(() => app.querySelector("[data-bvn-camera-file]")?.click(), 100);
  } else {
    startLiveCamera(app);
  }
}

async function startLiveCamera(app) {
  const video = app.querySelector("[data-bvn-live-video]");
  if (!video) return;
  if (camera.stream) {
    video.srcObject = camera.stream;
    await video.play().catch(() => {});
    setCameraMessage(app, "Ready when you are.");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraMessage(app, "Camera access needs a secure connection. Choose a saved video instead.", true);
    return;
  }
  const requestId = (camera.requestId || 0) + 1;
  camera.requestId = requestId;
  setCameraMessage(app, "Opening camera…");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: camera.facingMode }, width: { ideal: 720 }, height: { ideal: 720 } },
      audio: true
    });
    if (camera.requestId !== requestId || !video.isConnected) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    camera.stream = stream;
    video.srcObject = stream;
    await video.play().catch(() => {});
    setCameraMessage(app, "Ready when you are.");
  } catch (error) {
    const message = error?.name === "NotAllowedError"
      ? "Camera or microphone permission was denied. You can choose a saved clip instead."
      : error?.name === "NotFoundError"
        ? "No camera was found. Choose a saved clip instead."
        : error?.message || "Camera access is unavailable. Choose a saved clip instead.";
    setCameraMessage(app, message, true);
  }
}

function updateCameraTimer(app) {
  const seconds = Math.min(LIMITS.maxDurationSeconds, camera.elapsedBeforePause + (Date.now() - camera.segmentStartedAt) / 1000);
  camera.elapsed = seconds;
  const timer = app.querySelector("[data-bvn-camera-timer]");
  if (timer) timer.textContent = timeLabel(seconds);
  if (seconds >= LIMITS.maxDurationSeconds) stopRecording();
}

function recorderOptions() {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4"
  ];
  const mimeType = candidates.find(type => MediaRecorder.isTypeSupported?.(type));
  return mimeType ? { mimeType, videoBitsPerSecond: 1_600_000, audioBitsPerSecond: 96_000 } : { videoBitsPerSecond: 1_600_000, audioBitsPerSecond: 96_000 };
}

function startRecording(ctx) {
  const app = ctx.app;
  if (!camera.stream) {
    setCameraMessage(app, "Wait for camera access or choose a saved clip.", true);
    return;
  }
  if (typeof MediaRecorder === "undefined") {
    setCameraMessage(app, "Video recording is not supported in this browser. Choose a saved clip instead.", true);
    return;
  }
  try {
    camera.cancelled = false;
    camera.chunks = [];
    camera.elapsed = 0;
    camera.elapsedBeforePause = 0;
    const recorder = new MediaRecorder(camera.stream, recorderOptions());
    camera.recorder = recorder;
    recorder.ondataavailable = event => {
      if (event.data?.size) camera.chunks.push(event.data);
    };
    recorder.onerror = () => setCameraMessage(app, "Recording stopped because the browser reported a media error.", true);
    recorder.onstop = () => {
      stopTimer();
      const blob = new Blob(camera.chunks, { type: recorder.mimeType || "video/webm" });
      camera.recorder = null;
      stopStream();
      const recordButton = app.querySelector("[data-bvn-record]");
      if (recordButton) {
        recordButton.classList.remove("is-recording");
        recordButton.setAttribute("aria-label", "Start video note recording");
      }
      const pauseButton = app.querySelector("[data-bvn-camera-pause]");
      if (pauseButton) pauseButton.hidden = true;
      if (camera.cancelled) return;
      if (!blob.size) {
        setCameraMessage(app, "No video was recorded. Try again or choose a saved clip.", true);
        startLiveCamera(app);
        return;
      }
      try {
        setDraftMedia(blob, "Video note", camera.elapsed, {
          shareContext: ctx.getView()?.shareContext || { channel: "feed" },
          returnView: ctx.getView()?.returnView || { name: "notes" }
        });
        ctx.setView({ name: "note-editor" });
      } catch (error) {
        setCameraMessage(app, error.message, true);
      }
    };
    recorder.start(250);
    camera.segmentStartedAt = Date.now();
    const recordButton = app.querySelector("[data-bvn-record]");
    recordButton?.classList.add("is-recording");
    recordButton?.setAttribute("aria-label", "Stop recording");
    const pauseButton = app.querySelector("[data-bvn-camera-pause]");
    if (pauseButton) {
      pauseButton.hidden = false;
      pauseButton.textContent = "Pause";
    }
    setCameraMessage(app, "Recording…");
    camera.timer = setInterval(() => updateCameraTimer(app), 200);
  } catch (error) {
    setCameraMessage(app, error.message || "Could not start recording.", true);
  }
}

function stopRecording() {
  if (camera.recorder?.state === "recording") {
    camera.elapsed = Math.min(LIMITS.maxDurationSeconds, camera.elapsedBeforePause + (Date.now() - camera.segmentStartedAt) / 1000);
    camera.elapsedBeforePause = camera.elapsed;
    const timer = camera.app?.querySelector("[data-bvn-camera-timer]");
    if (timer) timer.textContent = timeLabel(camera.elapsed);
  }
  stopTimer();
  if (camera.recorder && camera.recorder.state !== "inactive") {
    try { camera.recorder.stop(); } catch { /* recorder may already be stopping */ }
  }
}

function togglePause(app) {
  const recorder = camera.recorder;
  const button = app.querySelector("[data-bvn-camera-pause]");
  if (!recorder || !button) return;
  if (recorder.state === "recording") {
    recorder.pause();
    camera.elapsedBeforePause += (Date.now() - camera.segmentStartedAt) / 1000;
    stopTimer();
    button.textContent = "Resume";
    setCameraMessage(app, "Recording paused.");
  } else if (recorder.state === "paused") {
    recorder.resume();
    camera.segmentStartedAt = Date.now();
    button.textContent = "Pause";
    setCameraMessage(app, "Recording…");
    camera.timer = setInterval(() => updateCameraTimer(app), 200);
  }
}

function durationFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = Number(video.duration);
      URL.revokeObjectURL(url);
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error("Could not read the video duration."));
      } else if (duration > LIMITS.maxDurationSeconds) {
        reject(new Error("Video notes must be 60 seconds or shorter."));
      } else {
        resolve(duration);
      }
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This video could not be opened."));
    };
    video.src = url;
  });
}

async function openSelectedFile(file, view, ctx) {
  const mime = String(file.type || "").toLowerCase().split(";")[0];
  const allowedImage = ["image/jpeg", "image/png", "image/webp", "image/avif"].includes(mime);
  const allowedVideo = ["video/mp4", "video/webm", "video/quicktime"].includes(mime);
  if (!allowedImage && !allowedVideo) throw new Error("Choose a JPEG, PNG, WebP, AVIF, MP4, WebM, or QuickTime file.");
  const duration = allowedVideo ? await durationFromBlob(file) : 0;
  setDraftMedia(file, file.name, duration, {
    shareContext: view.shareContext || { channel: "feed" },
    returnView: view.returnView || { name: "notes" }
  });
  ctx.setView({ name: "note-editor" });
}

function drawPoint(event, surface) {
  const bounds = surface.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100)),
    y: Math.max(0, Math.min(100, (event.clientY - bounds.top) / bounds.height * 100))
  };
}

function redrawOverlay(surface, ctx) {
  surface.innerHTML = overlayMarkup(ctx);
}

function bindEditor(ctx) {
  const app = ctx.app;
  const surface = app.querySelector("[data-bvn-draw-layer]");
  const form = app.querySelector("[data-bvn-share-form]");
  let activeStroke = null;

  app.querySelector("[data-bvn-discard]")?.addEventListener("click", () => {
    if (!confirm("Discard this video note draft?")) return;
    const returnView = composer.returnView || { name: "notes" };
    clearComposer();
    ctx.setView(returnView);
  });
  app.querySelectorAll("[data-bvn-editor-tool]").forEach(button => {
    button.onclick = () => {
      composer.tool = button.dataset.bvnEditorTool;
      app.querySelectorAll("[data-bvn-editor-tool]").forEach(item => item.classList.toggle("is-active", item === button));
      surface?.classList.toggle("is-text-tool", composer.tool === "text");
      const hint = app.querySelector(".bvn-text-tool small");
      if (hint) hint.textContent = composer.tool === "text" ? "Tap the media to place your text." : "Draw with your finger, mouse, or stylus.";
    };
  });
  app.querySelectorAll("[data-bvn-color]").forEach(button => {
    button.onclick = () => {
      composer.color = button.dataset.bvnColor;
      app.querySelectorAll("[data-bvn-color]").forEach(item => item.classList.toggle("is-active", item === button));
    };
  });
  app.querySelector("[data-bvn-undo]")?.addEventListener("click", () => {
    if (composer.overlays.strokes.length) composer.overlays.strokes.pop();
    else composer.overlays.labels.pop();
    if (surface) redrawOverlay(surface, ctx);
  });
  app.querySelector("[data-bvn-clear]")?.addEventListener("click", () => {
    composer.overlays = { strokes: [], labels: [] };
    if (surface) redrawOverlay(surface, ctx);
  });
  surface?.addEventListener("pointerdown", event => {
    if (composer.tool === "text") {
      const input = app.querySelector("[data-bvn-text-overlay]");
      const text = input?.value.trim();
      if (!text) {
        input?.focus();
        return;
      }
      const point = drawPoint(event, surface);
      composer.overlays.labels.push({ text: text.slice(0, 80), x: point.x, y: point.y, color: composer.color, size: 6 });
      if (input) input.value = "";
      redrawOverlay(surface, ctx);
      return;
    }
    surface.setPointerCapture(event.pointerId);
    activeStroke = { color: composer.color, width: 2.5, points: [drawPoint(event, surface)] };
    composer.overlays.strokes.push(activeStroke);
    redrawOverlay(surface, ctx);
  });
  surface?.addEventListener("pointermove", event => {
    if (!activeStroke) return;
    activeStroke.points.push(drawPoint(event, surface));
    redrawOverlay(surface, ctx);
  });
  const finishStroke = () => { activeStroke = null; };
  surface?.addEventListener("pointerup", finishStroke);
  surface?.addEventListener("pointercancel", finishStroke);

  app.querySelector("[data-bvn-caption]")?.addEventListener("input", event => {
    composer.caption = event.currentTarget.value;
  });
  app.querySelectorAll("[data-bvn-share-channel]").forEach(button => {
    button.onclick = () => {
      composer.channel = button.dataset.bvnShareChannel;
      ctx.refresh();
    };
  });
  form?.elements.audience?.addEventListener("change", event => {
    composer.audience = event.currentTarget.value;
    ctx.refresh();
  });
  form?.elements.groupId?.addEventListener("change", event => {
    composer.groupId = event.currentTarget.value;
  });
  form?.elements.recipientId?.addEventListener("change", event => {
    composer.recipientId = event.currentTarget.value;
  });
  form?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!composer.blob) {
      ctx.toast("Choose or record media first.");
      return;
    }
    if (!form.reportValidity()) return;
    const caption = String(form.elements.caption?.value || "").trim();
    const channel = composer.channel;
    const audience = String(form.elements.audience?.value || composer.audience);
    const groupId = String(form.elements.groupId?.value || composer.groupId);
    const recipientId = String(form.elements.recipientId?.value || composer.recipientId);
    const submit = form.querySelector("[data-testid='blast-video-note-send']");
    const submitLabel = submit?.textContent;
    if (submit) submit.disabled = true;
    try {
      const media = await saveBlastMedia(composer.blob, composer.name, (fraction, phase) => {
        if (!submit?.isConnected) return;
        const percent = Math.round(fraction * 100);
        submit.textContent = phase === "compressing" ? `Optimizing · ${percent}%` : `Uploading · ${percent}%`;
      });
      try {
        await createBlastVideoNote({
          channel,
          mediaId: media.id,
          duration: composer.duration,
          caption,
          overlays: composer.overlays,
          creativeProject: composer.creativeProject,
          audience,
          groupId,
          recipientId
        });
      } catch (error) {
        await deleteBlastMedia(media.id).catch(() => {});
        throw error;
      }
      const returnView = channel === "chat" ? { name: "chat", peerId: recipientId } : { name: "notes" };
      const itemLabel = composer.mediaType === "video" ? "Video note" : "Photo note";
      clearComposer();
      ctx.toast(`${itemLabel} saved.`);
      ctx.setView(returnView);
    } catch (error) {
      ctx.toast(error.message || "Could not save the video note.");
      if (submit?.isConnected) {
        submit.disabled = false;
        submit.textContent = submitLabel;
      }
    }
  });
  if (surface) surface.classList.toggle("is-text-tool", composer.tool === "text");
}

export function bindBlastNoteComposer(view, ctx) {
  const open=()=>openBlastCreative(ctx,{
    startCamera:view.name==="note-camera",initialProject:view.name==="note-editor"?composer.creativeProject:null,
    file:view.name==="note-editor"&&!composer.creativeProject?composer.blob:null,caption:composer.caption,
    onClose:()=>ctx.setView(view.returnView||composer.returnView||{name:"notes"}),
    onSaved:({blob,creativeProject,duration,caption})=>{
      setDraftMedia(blob,"Creative note",duration,{shareContext:view.shareContext||{channel:composer.channel,audience:composer.audience,groupId:composer.groupId,recipientId:composer.recipientId},returnView:view.returnView||composer.returnView});
      composer.creativeProject=creativeProject;composer.caption=caption;ctx.setView({name:"note-editor"});
    }
  });
  if(view.name==="note-camera")open();
  else {
    bindEditor(ctx);
    const legacySurface=ctx.app.querySelector("[data-bvn-draw-layer]");
    if(legacySurface)legacySurface.style.pointerEvents="none";
    ctx.app.querySelector("[data-bvn-edit-studio]")?.addEventListener("click",open);
  }
}

export function discardBlastNoteComposer() {
  clearComposer();
}

export function hasBlastNoteDraft() {
  return Boolean(composer.blob);
}
