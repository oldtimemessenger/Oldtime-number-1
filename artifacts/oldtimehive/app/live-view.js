import { icons as appIcons } from "./icons.js";

const LIVE_ICONS = {
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-1a6 6 0 0 1 12 0v1M16 5.5a3 3 0 0 1 0 5.8M18 14a5 5 0 0 1 3 4.6V21"/>',
  video: '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="m16 9 6-4v14l-6-4"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4zM22 2 11 13"/>',
  back: '<path d="m12 5-7 7 7 7M5 12h15"/>',
  flip: '<path d="M20 7h-4l3-3M4 17h4l-3 3M5 7a8 8 0 0 1 13-2l1 1M19 17a8 8 0 0 1-13 2l-1-1"/>',
  settings: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  cross: '<path d="m6 6 12 12M18 6 6 18"/>'
};

const liveIcon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${LIVE_ICONS[name] || ""}</svg>`;
const escText = (value, escapeHtml) => typeof escapeHtml === "function"
  ? escapeHtml(String(value ?? ""))
  : String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const displayName = person => person?.name || person?.username || "Member";
const avatarMarkup = (person, escapeHtml) => {
  const name = displayName(person);
  const safeUrl = person?.avatarUrl ? escText(person.avatarUrl, escapeHtml) : "";
  return safeUrl
    ? `<img class="live-avatar" src="${safeUrl}" alt="" loading="lazy">`
    : `<span class="live-avatar live-avatar-fallback" aria-hidden="true">${escText(name.trim().slice(0, 1).toUpperCase() || "M", escapeHtml)}</span>`;
};
const relativeTime = timestamp => {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
};

export function mountLiveView({ root, client, onClose, escapeHtml, logoUrl = "" }) {
  if (!root || !client) throw new Error("Live needs a screen root and a Live client.");
  let state = client.getState();
  let busy = false;
  let composerValue = "";
  let prelive = false;
  let preliveTitle = "";
  let destroyed = false;
  let transientNotice = "";
  let noticeTimeout = null;
  const unsubs = [];
  const heartTimeouts = new Set();
  let heartSequence = 0;
  let lastStageTap = 0;
  const esc = value => escText(value, escapeHtml);
  const friendlyError = (message, fallback) => {
    const text = String(message || "").trim();
    if (/xhr poll error|websocket error|transport error|failed to fetch|network error|socket hang up/i.test(text)) {
      return "Live connection failed. Check your connection and retry.";
    }
    if (/notallowederror|securityerror|permission denied/i.test(text)) {
      return "Camera or microphone access is blocked. Check permissions and retry.";
    }
    if (/notfounderror|devicesnotfounderror/i.test(text)) {
      return "No camera or microphone is available on this device.";
    }
    return text || fallback;
  };
  const logo = (className = "live-logo") => `<img class="${className}" src="${esc(logoUrl)}" alt="Oldtime" draggable="false">`;
  const brand = (className = "live-brand") => `<div class="${className}">${logo()}<span>LIVE</span></div>`;

  const call = async (method, ...args) => {
    if (busy || destroyed) return;
    busy = true;
    render();
    try {
      const result = await client[method](...args);
      state = client.getState();
      if (method === "startRoom") {
        prelive = false;
      }
      if (method === "share" && (result === "copied" || result === "shared")) {
        transientNotice = result === "copied" ? "Room link copied." : "Room shared.";
        clearTimeout(noticeTimeout);
        noticeTimeout = setTimeout(() => {
          transientNotice = "";
          if (!destroyed) render();
        }, 2400);
      }
    } catch (error) {
      state = client.getState();
      state = { ...state, error: friendlyError(error?.message, "Live could not complete this action. Try again.") };
    } finally {
      busy = false;
      render();
    }
  };

  const roomHostId = room => room?.host?.id;
  const localParticipant = room => (room?.participants || []).find(person => person.id === room?.currentUserId);
  const isHost = room => Boolean(room?.currentUserId && room.currentUserId === room?.host?.id);
  const isLoading = () => ["connecting", "joining", "starting", "loading", "reconnecting"].includes(state?.status);
  const initials = person => esc(displayName(person).trim().slice(0, 1).toUpperCase() || "M");

  function roomCard(room) {
    const host = room.host || {};
    const stageCount = Number.isFinite(room.stageCount) ? room.stageCount : (room.stage?.length || 0);
    const viewers = Number.isFinite(room.viewerCount) ? room.viewerCount : 0;
    return `<article class="live-room-card">
      <div class="live-room-card-topline"><span class="live-card-live"><i></i> LIVE</span><span class="live-card-watchers">${liveIcon("users")} ${viewers} watching</span></div>
      <div class="live-room-card-main">
        <div class="live-card-host-avatar">${avatarMarkup(host, escapeHtml)}</div>
        <div class="live-room-card-copy"><h2>${esc(room.title || "Live room")}</h2><span>${esc(displayName(host))}</span><small>${stageCount} ${stageCount === 1 ? "person" : "people"} on stage</small></div>
        <button type="button" class="live-button live-button-red" data-join-room="${esc(room.id)}">Join</button>
      </div>
    </article>`;
  }

  function discoveryMarkup() {
    const rooms = Array.isArray(state?.rooms) ? state.rooms : [];
    return `<section class="live-discovery">
      <header class="live-header">
        <button type="button" class="live-icon-button" data-close aria-label="Close Live">${liveIcon("close")}</button>
        ${brand()}
        <button type="button" class="live-button live-button-red live-create-trigger" data-open-create>Go live</button>
      </header>
      <main class="live-discovery-body">
        <section class="live-rooms-section" aria-labelledby="live-rooms-heading">
          <div class="live-section-heading"><div><h2 id="live-rooms-heading">Live rooms</h2></div><span class="live-room-total">${rooms.length}</span></div>
           ${isLoading() ? `<div class="live-loading" role="status" aria-label="Connecting to Live"><i></i><i></i><i></i><span>${esc(state.status === "starting" ? "Starting Live…" : state.status === "reconnecting" ? "Reconnecting…" : state.status === "joining" || state.status === "connecting" ? "Connecting…" : "Loading…")}</span></div>` :
            state?.error && !rooms.length ? `<div class="live-state-card live-error"><b>Unable to load Live rooms</b><p>${esc(friendlyError(state.error, "Check your connection and retry."))}</p><button class="live-button live-button-quiet" data-refresh>Retry</button></div>` :
              rooms.length ? `<div class="live-room-list">${rooms.map(roomCard).join("")}</div>` :
                   `<div class="live-empty"><h3>No live rooms right now</h3><button type="button" class="live-button live-button-red" data-open-create>Go live</button></div>`}
        </section>
      </main>
      ${state?.error && rooms.length ? `<div class="live-inline-error" role="alert">${esc(friendlyError(state.error, "Live could not refresh. Try again."))}</div>` : ""}
    </section>`;
  }

  function preliveMarkup() {
    const videoReady = state.localStream?.getVideoTracks().some(track => track.readyState === "live");
    const audioReady = state.localStream?.getAudioTracks().some(track => track.readyState === "live");
    const micOn = audioReady && state.localStream.getAudioTracks().some(track => track.enabled);
    return `<section class="live-prelive">
      <div class="live-preview-scene" data-video-slot="preview">
        <div class="live-preview-placeholder">
          ${logo("live-preview-logo")}
          <b>${busy && !videoReady ? "Opening camera…" : "Camera preview"}</b>
          <small>${state.error ? esc(friendlyError(state.error, "Camera unavailable. Check permissions and retry.")) : "Visible only to you."}</small>
          ${!videoReady && !busy ? `<button class="live-button live-button-quiet" type="button" data-preview-camera>Enable camera</button>` : ""}
        </div>
      </div>
      <div class="live-preview-shade" aria-hidden="true"></div>
      <div class="live-prelive-content">
         <header class="live-prelive-header">
          <button class="live-icon-button" type="button" data-cancel-preview aria-label="Close camera preview" ${state.status === "starting" ? "disabled" : ""}>${liveIcon("close")}</button>
          ${brand("live-prelive-brand")}
        </header>
        <div class="live-preview-state"><span class="live-preview-state-dot"></span><span>PREVIEW</span></div>
        <div class="live-prelive-spacer"></div>
        <nav class="live-preview-tools" aria-label="Camera controls">
          <button type="button" data-flip-camera ${!videoReady || busy ? "disabled" : ""}>${liveIcon("flip")}<span>Flip</span></button>
          <button type="button" data-toggle-preview-mic aria-pressed="${!!micOn}" ${!audioReady || busy ? "disabled" : ""}>${liveIcon("mic")}<span>${micOn ? "Mic on" : "Mic off"}</span></button>
        </nav>
        <form class="live-start-panel" data-live-title-form>
          <label class="live-start-title-label" for="live-title-input">Live title</label>
          <input id="live-title-input" name="title" maxlength="80" minlength="2" required placeholder="Add a title" autocomplete="off" value="${esc(preliveTitle)}">
          <button class="live-button live-button-red live-go-live" type="submit" ${!videoReady || busy ? "disabled" : ""}>${busy ? "Starting…" : "Go live"}</button>
        </form>
      </div>
    </section>`;
  }

  function personTile(person, room, local = false, primary = false) {
    return `<article class="live-person-tile ${primary ? "is-primary" : "is-guest"} ${local ? "is-local" : ""}">
      <div class="live-tile-video" data-video-slot="${esc(person.id)}"><div class="live-no-video">${avatarMarkup(person, escapeHtml)}<span>${esc(displayName(person))}</span></div></div>
      <div class="live-tile-label"><span>${esc(displayName(person))}${local ? " · You" : ""}</span><span class="live-presence ${person.muted ? "is-muted" : ""}">${person.muted ? "Muted" : "On mic"}</span></div>
      ${isHost(room) && person.role !== "host" && person.id !== roomHostId(room) ? `<button class="live-remove-person" type="button" data-remove-stage="${esc(person.id)}" aria-label="Remove ${esc(displayName(person))} from stage">Remove</button>` : ""}
    </article>`;
  }

  function commentMarkup(comment) {
    return `<article class="live-comment"><span class="live-comment-avatar">${initials(comment)}</span><div><div class="live-comment-heading"><b>${esc(comment.name || comment.username || "Member")}</b><small>${esc(relativeTime(comment.createdAt))}</small></div><p>${esc(comment.body || "")}</p></div></article>`;
  }

  function stageCommentMarkup(comment) {
    return `<article class="live-stage-comment"><span class="live-comment-avatar">${initials(comment)}</span><div><b>${esc(comment.name || comment.username || "Member")}</b><p>${esc(comment.body || "")}</p></div></article>`;
  }

  function stageRequestMarkup(request) {
    return `<div class="live-request-row"><span class="live-request-avatar">${initials(request)}</span><span class="live-request-person"><b>${esc(request.name || request.username || "Member")}</b><small>@${esc(request.username || "")}</small></span><button type="button" class="live-request-action live-accept" data-decide="${esc(request.id)}" data-accept="true" aria-label="Accept ${esc(request.name || "stage request")}">${liveIcon("check")}</button><button type="button" class="live-request-action live-reject" data-decide="${esc(request.id)}" data-accept="false" aria-label="Decline ${esc(request.name || "stage request")}">${liveIcon("cross")}</button></div>`;
  }

  function roomMarkup(room) {
    const participants = Array.isArray(room.participants) ? room.participants : [];
    const comments = Array.isArray(room.comments) ? room.comments : [];
    const requests = Array.isArray(room.requests) ? room.requests : [];
    const host = isHost(room);
    const me = localParticipant(room);
    const canCapture = me && (me.role === "host" || me.role === "guest");
    const audienceCount = Number.isFinite(room.viewerCount) ? room.viewerCount : 0;
    const stage = participants.filter(person => person.role === "host" || person.role === "stage" || person.role === "guest");
    const lead = stage.find(person => person.id === roomHostId(room) || person.role === "host") || room.host;
    const guests = stage.filter(person => person.id !== lead?.id);
    const invitation = state.pendingStageInvitation;
    const recentComments = comments.slice().sort((a, b) => {
      const aTime = Number(a.createdAt);
      const bTime = Number(b.createdAt);
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    }).slice(0, 3).reverse();
    return `<section class="live-room">
      <header class="live-room-header"><button class="live-icon-button" type="button" data-leave aria-label="Leave Live">${liveIcon("close")}</button><div class="live-room-title"><span class="live-live-pill">${logo("live-room-logo")} LIVE</span><h1>${esc(room.title || "Live room")}</h1><span class="live-room-hostline">${avatarMarkup(lead || room.host || {}, escapeHtml)}<span>${esc(displayName(lead || room.host || {}))}</span></span></div><div class="live-header-actions"><span class="live-viewer-badge">${liveIcon("users")} ${audienceCount}</span><button class="live-icon-button" type="button" data-share aria-label="Share Live">${appIcons.share}</button></div></header>
      ${state?.error ? `<div class="live-room-error" role="alert">${esc(friendlyError(state.error, "Live could not refresh. Try again."))}</div>` : ""}
      ${isLoading() ? `<div class="live-connection-status" role="status">${esc(state.status === "starting" ? "Starting Live…" : state.status === "reconnecting" ? "Reconnecting…" : state.status === "joining" || state.status === "connecting" ? "Connecting…" : "Loading…")}</div>` : ""}
      ${transientNotice ? `<div class="live-action-notice" role="status">${esc(transientNotice)}</div>` : ""}
      <main class="live-room-main">
        <section class="live-stage-area" aria-label="Live video">
          ${lead ? `<div class="live-stage-grid">${personTile(lead, room, lead.id === me?.id, true)}${guests.length ? `<div class="live-guest-strip" aria-label="Guests on stage">${guests.map(person => personTile(person, room, person.id === me?.id)).join("")}</div>` : ""}</div>` : `<div class="live-stage-empty">${logo("live-stage-logo")}<b>Waiting for host</b></div>`}
          ${recentComments.length ? `<div class="live-stage-comment-overlay" aria-label="Recent comments">${recentComments.map(stageCommentMarkup).join("")}</div>` : ""}
          ${host && requests.length ? `<section class="live-requests-overlay" aria-label="Stage requests"><span>${requests.length} request${requests.length === 1 ? "" : "s"} to join</span>${requests.map(stageRequestMarkup).join("")}</section>` : ""}
          ${invitation ? `<div class="live-invitation" role="status"><span><b>Stage invitation</b><small>Enable your mic and camera to join.</small></span><button type="button" class="live-button live-button-red" data-join-stage>Join</button><button type="button" class="live-button live-button-quiet" data-decline-stage>Decline</button></div>` : ""}
        </section>
        <aside class="live-room-sidebar">
          ${host && requests.length ? `<section class="live-panel live-requests"><div class="live-panel-heading"><span class="live-overline">AUDIENCE</span><h2>Stage requests <b>${requests.length}</b></h2></div><div class="live-request-list">${requests.map(stageRequestMarkup).join("")}</div></section>` : ""}
          <section class="live-panel live-comments-panel"><div class="live-panel-heading"><span class="live-overline">IN THE ROOM</span><h2>Comments <b>${comments.length}</b></h2></div>
             <div class="live-comments" data-comments>${comments.length ? comments.map(commentMarkup).join("") : `<div class="live-comments-empty"><span class="live-comment-rule"></span><p>No comments yet.</p></div>`}</div>
          </section>
        </aside>
      </main>
      <footer class="live-controls">
        <form class="live-comment-form" data-comment-form><input type="text" name="comment" maxlength="240" placeholder="Add a comment…" aria-label="Add a comment" autocomplete="off" ${busy ? "disabled" : ""}><button type="submit" aria-label="Send comment" ${busy ? "disabled" : ""}>${liveIcon("send")}</button></form>
        <div class="live-control-row">
          <div class="live-control-left">${canCapture ? `<button type="button" class="live-control ${me.muted ? "is-off" : ""}" data-toggle-mic aria-pressed="${!me.muted}">${liveIcon("mic")}<span>${me.muted ? "Unmute" : "Mute"}</span></button><button type="button" class="live-control ${me.cameraOn ? "" : "is-off"}" data-toggle-camera aria-pressed="${!!me.cameraOn}">${liveIcon("video")}<span>${me.cameraOn ? "Camera on" : "Camera off"}</span></button>` :
            invitation ? "" : `<button type="button" class="live-control live-request-stage" data-request-stage>${liveIcon("users")}<span>Request to join</span></button>`}</div>
          <div class="live-control-right"><button type="button" class="live-control live-heart" data-heart aria-label="Send a heart">${liveIcon("heart")}<span>Heart</span></button>${host ? `<button type="button" class="live-button live-end-button" data-end-room>End Live</button>` : `<button type="button" class="live-button live-leave-button" data-leave>Leave</button>`}</div>
        </div>
      </footer>
    </section>`;
  }

  function syncMedia() {
    const room = state?.room;
    const participants = Array.isArray(room?.participants) ? room.participants : [];
    const desired = new Map();
    const localStream = state?.localStream;
    const localUser = participants.find(person => person.id === room?.currentUserId);
    if (localStream && localUser) desired.set(String(localUser.id), { stream: localStream, local: true });
    else if (localStream && prelive) desired.set("preview", { stream: localStream, local: true });
    const remotes = state?.remoteStreams instanceof Map ? state.remoteStreams : new Map();
    for (const [userId, stream] of remotes) desired.set(String(userId), { stream, local: false });
    root.querySelectorAll("video[data-user-id]").forEach(video => {
      const id = video.dataset.userId;
      const wanted = desired.get(id);
      if (!wanted || video.parentElement?.dataset.videoSlot !== id) video.remove();
    });
    for (const [id, item] of desired) {
      const slot = root.querySelector(`[data-video-slot="${CSS.escape(id)}"]`);
      if (!slot) continue;
      let video = slot.querySelector(`video[data-user-id="${CSS.escape(id)}"]`);
      if (!video) {
        video = document.createElement("video");
        video.dataset.userId = id;
        video.autoplay = true;
        video.playsInline = true;
        video.muted = item.local;
        video.setAttribute("aria-label", item.local ? "Your live video preview" : "Live participant video");
        slot.querySelector(".live-no-video")?.remove();
        slot.querySelector(".live-preview-placeholder")?.remove();
        slot.append(video);
      }
      if (video.srcObject !== item.stream) video.srcObject = item.stream;
      video.muted = item.local;
      video.style.transform = item.local && state.cameraFacingMode === "user" ? "scaleX(-1)" : "";
      if (video.paused) video.play().catch(() => {});
    }
  }

  function render() {
    if (destroyed) return;
    state = state || {};
    const existingVideos = new Map([...root.querySelectorAll("video[data-user-id]")].map(video => [video.dataset.userId, video]));
    const existingHearts = [...root.querySelectorAll(".live-received-heart")];
    const oldComments = root.querySelector(".live-comments");
    const oldScrollTop = oldComments?.scrollTop || 0;
    const oldWasAtBottom = !oldComments || oldComments.scrollHeight - oldComments.clientHeight - oldComments.scrollTop <= 32;
    root.innerHTML = state.room ? roomMarkup(state.room) : prelive ? preliveMarkup() : discoveryMarkup();
    for (const [id, video] of existingVideos) {
      const slot = [...root.querySelectorAll("[data-video-slot]")].find(item => item.dataset.videoSlot === id);
      if (slot) {
        slot.querySelector(".live-no-video")?.remove();
        slot.querySelector(".live-preview-placeholder")?.remove();
        slot.append(video);
      } else {
        video.pause();
        video.srcObject = null;
        video.remove();
      }
    }
    const stage = root.querySelector(".live-stage-area");
    if (stage) existingHearts.forEach(heart => stage.append(heart));
    const commentInput = root.querySelector('[data-comment-form] input[name="comment"]');
    if (commentInput && composerValue) {
      commentInput.value = composerValue;
      commentInput.setSelectionRange(composerValue.length, composerValue.length);
    }
    syncMedia();
    const comments = root.querySelector(".live-comments");
    if (comments) {
      comments.scrollTop = oldWasAtBottom ? comments.scrollHeight : oldScrollTop;
    }
  }

  function refreshState() {
    if (destroyed) return;
    try { state = client.getState(); } catch (error) {
      state = { ...state, error: friendlyError(error?.message, "Live could not refresh. Check your connection and retry.") };
    }
    render();
  }

  function showReceivedHeart() {
    if (destroyed) return;
    const stage = root.querySelector(".live-stage-area");
    if (!stage) return;
    const heart = document.createElement("span");
    heart.className = "live-received-heart";
    heart.setAttribute("aria-hidden", "true");
    heart.style.setProperty("--heart-x", `${18 + (heartSequence++ % 5) * 14}%`);
    heart.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/></svg>';
    stage.append(heart);
    const timeout = setTimeout(() => {
      heart.remove();
      heartTimeouts.delete(timeout);
    }, 1500);
    heartTimeouts.add(timeout);
  }

  function dismissPreview() {
    prelive = false;
    try {
      client.stopPreview();
      state = client.getState();
    } catch (error) {
      state = { ...state, error: friendlyError(error?.message, "Camera preview could not be closed.") };
    }
    render();
  }

  root.addEventListener("click", event => {
    if (event.target.closest(".live-stage-area") && !event.target.closest("button")) {
      const now = Date.now();
      if (now - lastStageTap < 320) {
        lastStageTap = 0;
        void call("sendHeart");
      } else {
        lastStageTap = now;
      }
    }
    const button = event.target.closest("button");
    if (!button || !root.contains(button)) return;
    if (button.hasAttribute("data-close")) onClose?.();
    else if (button.hasAttribute("data-open-create")) {
      prelive = true;
      state.error = "";
      render();
      void call("startPreview");
    }
    else if (button.hasAttribute("data-cancel-preview")) {
      dismissPreview();
    }
    else if (button.hasAttribute("data-preview-camera")) void call("startPreview");
    else if (button.hasAttribute("data-flip-camera")) void call("flipCamera");
    else if (button.hasAttribute("data-toggle-preview-mic")) void call("togglePreviewMic");
    else if (button.hasAttribute("data-join-room")) void call("joinRoom", button.dataset.joinRoom);
    else if (button.hasAttribute("data-leave")) void call("leaveRoom");
    else if (button.hasAttribute("data-end-room")) void call("endRoom");
    else if (button.hasAttribute("data-refresh")) void call("listRooms");
    else if (button.hasAttribute("data-heart")) void call("sendHeart");
    else if (button.hasAttribute("data-request-stage")) void call("requestStage");
    else if (button.hasAttribute("data-toggle-mic")) void call("toggleMic");
    else if (button.hasAttribute("data-toggle-camera")) void call("toggleCamera");
    else if (button.hasAttribute("data-share")) void call("share");
    else if (button.hasAttribute("data-join-stage")) void call("joinStage");
    else if (button.hasAttribute("data-decline-stage")) void call("declineStage");
    else if (button.hasAttribute("data-remove-stage")) void call("removeStage", button.dataset.removeStage);
    else if (button.hasAttribute("data-decide")) void call("decideStage", button.dataset.decide, button.dataset.accept === "true");
  });

  root.addEventListener("submit", event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    if (form.matches("[data-live-title-form]")) {
      const title = String(new FormData(form).get("title") || "").trim();
      if (title.length < 2) {
        state = { ...state, error: "Add a short title before starting your Live." };
        render();
        return;
      }
      preliveTitle = title;
      void call("startRoom", title);
    } else if (form.matches("[data-comment-form]")) {
      const input = form.elements.comment;
      const body = String(input?.value || "").trim();
      if (!body) return;
      composerValue = "";
      void call("sendComment", body);
    }
  });
  root.addEventListener("input", event => {
    if (event.target.matches('[data-comment-form] input[name="comment"]')) composerValue = event.target.value;
    if (event.target.matches("#live-title-input")) preliveTitle = event.target.value;
  });
  const onKeydown = event => {
    if (event.key === "Escape") {
      if (prelive && state.status !== "starting") dismissPreview();
      else onClose?.();
    }
  };
  document.addEventListener("keydown", onKeydown);
  for (const eventName of ["state", "change", "rooms", "room", "status", "error", "media", "stage-invitation"]) {
    try {
      const unsubscribe = client.on(eventName, refreshState);
      if (typeof unsubscribe === "function") unsubs.push(unsubscribe);
    } catch { /* Client may expose only a subset of event names. */ }
  }
  try {
    const unsubscribe = client.on("heart", showReceivedHeart);
    if (typeof unsubscribe === "function") unsubs.push(unsubscribe);
  } catch { /* The Live client may not emit heart events in every context. */ }

  render();
  if (!state.room && !state.rooms?.length) void call("listRooms");
  return () => {
    destroyed = true;
    document.removeEventListener("keydown", onKeydown);
    clearTimeout(noticeTimeout);
    unsubs.forEach(unsubscribe => unsubscribe());
    heartTimeouts.forEach(timeout => clearTimeout(timeout));
    heartTimeouts.clear();
    root.querySelectorAll("video").forEach(video => { video.pause(); video.srcObject = null; video.remove(); });
    root.replaceChildren();
  };
}
