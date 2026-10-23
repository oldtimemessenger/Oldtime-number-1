import "./sports-mode.css";
import { sports, ACTIVITIES } from "./sports-engine.js";
import { sportsSocial } from "./sports-social.js";
import { ACT, routeGeometry, fitRoute, pathD, fmtDist, fmtDur, fmtPace, statRows, initials } from "./sports-card.js";
import { MapSlot, LiveMapSlot, exportSupported, animatedCard } from "./sports-map-ui.js";
import * as soc from "./sports-social-ui.js";
import { createSceneSelector } from "./sports-scenes.js";
import { ATTRIBUTION_LINES, ATTRIBUTION_URL } from "./sports-terrain.js";
import { canRenderFlyover } from "./sports-video.js";
import { POSITION_RED } from "./sports-marker.js";
import { iconPaths } from "./icons.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const label = t => ACTIVITIES.find(a => a.id === t)?.label || "Workout";
const I = {
  back: '<path d="M15 5l-7 7 7 7"/>', more: iconPaths.more,
  run: '<circle cx="14" cy="4.5" r="1.8"/><path d="M8 21l3-6 3 2 1 4M11 15l-1-5 4-2 2 4 3 1M10 10L7 12"/>',
  walk: '<circle cx="12" cy="4.5" r="1.8"/><path d="M12 8v6l-3 7M12 14l3 3 1 4M9 10l3-2 3 2"/>',
  cycle: '<circle cx="6" cy="16" r="3.6"/><circle cx="18" cy="16" r="3.6"/><path d="M6 16l4-8h5l3 8M10 8l4 8"/>',
  hike: '<path d="M2 20l7-12 4 6 3-4 6 10z"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>',
  pause: '<path d="M8 5v14M16 5v14"/>', play: '<path d="M7 4l13 8-13 8z"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  share: '<path d="M12 16V3m0 0L7 8m5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
  moon: '<path d="M20.4 15.5A8.5 8.5 0 0 1 8.5 3.6 8.5 8.5 0 1 0 20.4 15.5Z"/>',
};
const svg = (p, c = "") => `<svg class="sp-i ${c}" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const actIcon = id => svg(I[id] || I.run);
const colors = id => ACT[id] || ACT.run;
const mobileVideoDevice = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "") ||
  (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
const when = w => new Date(w.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

let dlg = null, resume = null, unsub = null, opener = null, opts = {}, ui = fresh(), menu = null, flipFrom = null, historyObserver = null;
const maps = new MapSlot();
const liveMap = new LiveMapSlot();
function fresh() { return { screen: "select", pick: null, busy: "", err: "", workout: null, confirm: null, zoom: { k: 1, x: 0, y: 0 }, view: "map", mapErr: "", vectorMapErr: "", mapTheme: "light", style: "vector", mapImg: null, mi: null, showOwner: true, hideEnds: true, consent: false, vcaption: "", videoCamera: "flyover", videoAspect: "portrait", videoQuality: "standard", videoSeconds: 30, videoSecondsAuto: true, videoOptionsOpen: false, replayBack: "history", video: null, progress: 0 }; }
const snap = () => sports.snapshot();
const live = () => { const a = snap().active; return a && a.status !== "finished" && a.status !== "completed" && !a.endedAt ? a : null; };
const owner = () => { const m = sportsSocial.viewer() || {}; return { name: m.name || m.username || "", username: m.username || "", avatar: m.avatar || "" }; };
const ownerOpt = () => ui.showOwner ? owner() : null;
const ownerAv = m => `<span class="sp-av lg" style="--c:#e630f5">${m.avatar ? `<img src="${esc(m.avatar)}" alt="" onerror="this.remove()">` : ""}<b>${esc(initials(m.name || m.username))}</b></span>`;
const clean = t => String(t ?? "")
  .replace(/Saved on this device\.?\s*Sign in to an online account for cloud backup\./gi, "Sign in to sync this activity with your account.")
  .replace(/Saved privately on this device\.?\s*An online account is needed for cloud backup\./gi, "Sign in to sync this activity with your account.");
const errHtml = () => ui.err ? `<p class="sp-err" role="alert">${esc(clean(ui.err))}</p>` : "";
const syncNote = w => w.synced === false
  ? "Transfer to your account is still pending. The earlier browser copy is kept until the transfer is verified."
  : "Saved to your account.";
const recordingNote = value => String(value).replaceAll("gps-gaps", "brief GPS interruptions").replaceAll("-", " ");
// Original generated activity imagery, bundled with the app.
const PHOTOS = { "run": new URL("./sports-assets/run.webp", import.meta.url).href, "run-2": new URL("./sports-assets/run-2.webp", import.meta.url).href, "run-3": new URL("./sports-assets/run-3.webp", import.meta.url).href, "walk": new URL("./sports-assets/walk.webp", import.meta.url).href, "walk-2": new URL("./sports-assets/walk-2.webp", import.meta.url).href, "walk-3": new URL("./sports-assets/walk-3.webp", import.meta.url).href, "cycle": new URL("./sports-assets/cycle.webp", import.meta.url).href, "cycle-2": new URL("./sports-assets/cycle-2.webp", import.meta.url).href, "cycle-3": new URL("./sports-assets/cycle-3.webp", import.meta.url).href, "hike": new URL("./sports-assets/hike.webp", import.meta.url).href, "hike-2": new URL("./sports-assets/hike-2.webp", import.meta.url).href, "hike-3": new URL("./sports-assets/hike-3.webp", import.meta.url).href };
// Scene mix stays stable during use and refreshes on a new sign-in.
const selectScenes = createSceneSelector();
function photoFor(id) {
  const m = sportsSocial.viewer() || {}, rev = Number(sportsSocial.authRevision?.() ?? 0) || 0;
  const scenes = selectScenes({ accountId: m.cloudAccountId || m.id || "", revision: rev });
  return PHOTOS[scenes[id]] || "";
}

soc.initSocialUi({ esc, label, actIcon, fmtPace, when, ownerAv,
  render: () => { if (ui.screen !== "replay" && ui.busy !== "export" && ui.busy !== "mapimg") render(); },
  onMissingWorkout: async id => {
    const saved = await sports.markSyncPending(id);
    if (saved && ui.workout?.id === id) ui.workout = saved;
    return !!saved;
  },
  root: () => dlg, history: () => snap().history || [],
  busy: () => ui.busy, errHtml, fail: m => { ui.err = m; render(); }, say: m => opts.toast?.(m), run: (k, f) => run(k, f), set: o => Object.assign(ui, o),
  ask: (c, f) => ask(c, f), go: (s, x, after) => { go(s, x); after?.(); } });

function ensureSub() { if (unsub) return; unsub = sports.subscribe(() => { syncResume(); if (dlg) update(); }); syncResume(); }
function syncResume() {
  const a = live();
  if (!a || dlg) { resume?.remove(); resume = null; return; }
  if (!resume) { resume = document.createElement("button"); resume.type = "button"; resume.className = "sp-resume"; resume.addEventListener("click", () => openSportsMode(opts)); document.body.appendChild(resume); }
  const s = a.summary || {}, paused = a.status === "paused";
  resume.innerHTML = `<span class="sp-dot ${paused ? "off" : ""}"></span><b>${esc(label(a.activityType))}</b><span>${fmtDur(s.activeSeconds)}</span><span>${fmtDist(s.distanceM)} km</span>`;
  resume.setAttribute("aria-label", `Reopen Sports. ${label(a.activityType)} ${paused ? "paused" : "recording"}, ${fmtDur(s.activeSeconds)}`);
}
export function openSportsMode(o = {}) {
  opts = { ...opts, ...o }; ensureSub();
  if (dlg) return;
  opener = document.activeElement;
  ui = Object.assign(fresh(), { screen: live() ? "record" : "select" });
  dlg = document.createElement("div");
  dlg.className = "sp"; dlg.setAttribute("role", "dialog"); dlg.setAttribute("aria-modal", "true"); dlg.setAttribute("aria-label", "Sports");
  dlg.addEventListener("click", onClick); dlg.addEventListener("input", onInput); dlg.addEventListener("change", onChange); dlg.addEventListener("keydown", onKey); dlg.addEventListener("submit", onSubmit);
  dlg.addEventListener("toggle", e => { if (e.target?.matches?.("[data-sp-video-options]")) ui.videoOptionsOpen = e.target.open; }, true);
  document.body.appendChild(dlg); document.body.classList.add("sp-open");
  syncResume(); render(); focusFirst();
}
function dropMedia() { maps.destroy(); liveMap.destroy(); if (ui.video?.url) URL.revokeObjectURL(ui.video.url); ui.video = null; if (ui.mapImg?.url) URL.revokeObjectURL(ui.mapImg.url); ui.mapImg = null; }
function closeUi() {
  if (!dlg) return;
  historyObserver?.disconnect(); historyObserver = null;
  closeMenu(); dropMedia(); dlg.remove(); dlg = null; document.body.classList.remove("sp-open"); syncResume();
  if (opener?.isConnected) opener.focus?.(); opener = null;
}
export function refreshSportsAccount() {
  void sports.accountChanged().catch(() => {});
  closeUi(); dropMedia(); soc.resetSocial(); ui = fresh(); resume?.remove(); resume = null; syncResume();
}
const focusFirst = () => requestAnimationFrame(() => (dlg?.querySelector("[data-autofocus]") || dlg?.querySelector(".sp-body button:not([disabled]),.sp-body input,.sp-head button"))?.focus());
function ensureMapTools(host) {
  if (!host?.isConnected || host.querySelector(".sp-map-tools")) return;
  const tools = document.createElement("div"); tools.className = "sp-map-tools";
  tools.innerHTML = `<button type="button" data-act="maplayers" aria-label="Map layers" title="Layers"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5"/></svg></button><button type="button" data-act="recenter" aria-label="Recenter map" title="Recenter"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/></svg></button>`;
  host.append(tools);
}
function ensureLiveMapTools(host) {
  if (!host?.isConnected) return;
  let tools = host.querySelector(".sp-live-map-tools");
  if (!tools) {
    tools = document.createElement("div"); tools.className = "sp-live-map-tools";
    tools.innerHTML = `<button type="button" data-act="live-theme" aria-pressed="false"></button><button type="button" data-act="recenter" aria-label="Recenter on your location" title="Recenter on your location">${svg(I.locate)}</button>`;
    host.append(tools);
  }
  const theme = tools.querySelector('[data-act="live-theme"]'), dark = ui.mapTheme === "dark";
  theme.innerHTML = svg(dark ? I.sun : I.moon);
  theme.setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} map theme`);
  theme.setAttribute("title", `Switch to ${dark ? "light" : "dark"} map theme`);
  theme.setAttribute("aria-pressed", String(dark));
}
function go(screen, extra = {}) {
  if (ui.screen === "replay") { if (ui.video?.url) URL.revokeObjectURL(ui.video.url); ui.video = null; if (ui.mapImg?.url) URL.revokeObjectURL(ui.mapImg.url); ui.mapImg = null; }
  Object.assign(ui, { screen, err: "", confirm: null, mapErr: "", ...(screen === "detail" ? { view: "map", style: "street" } : {}) }, extra); closeMenu(); render(); focusFirst();
}
function onKey(e) {
  if (e.key === "Escape") {
    if (dlg?.querySelector(".sp-layer-back")) { dlg.querySelector(".sp-layer-back").remove(); return; }
    if (menu) return closeMenu(); if (ui.confirm) { ui.confirm = null; return render(); } if (soc.sheetOpen()) { soc.closeSheet(); return render(); }
    return ROOT.includes(ui.screen) ? closeUi() : back();
  }
  if (e.key === "Tab") {
    const f = [...dlg.querySelectorAll('button:not([disabled]),input:not([type=hidden]),textarea,select,[tabindex="0"]')].filter(x => x.offsetParent);
    if (!f.length) return; const a = f[0], z = f.at(-1);
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  }
}
const ROOT = ["select", "record", "history", "achievements", "challenges"];
const BACK = { detail: "history", replay: "history", challenge: "challenges", create: "challenges" };
function back() {
  if (BACK[ui.screen]) return go(BACK[ui.screen]);
  if (ui.screen === "history" || ui.screen === "achievements" || ui.screen === "challenges") return go(live() ? "record" : "select");
  closeUi();
}
function closeMenu() { menu = null; dlg?.querySelector(".sp-menu")?.remove(); dlg?.querySelector("[data-act=menu]")?.setAttribute("aria-expanded", "false"); }
function tab(k) {
  if (k === "history") { go("history"); sports.loadHistory?.(); }
  else if (k === "achievements") { go("achievements"); soc.loadSummary(true); }
  else if (k === "challenges") { go("challenges"); soc.loadChallenges(true); }
  else go(live() ? "record" : "select");
}

const titles = { select: "Sports", record: "Recording", history: "History", detail: "Workout", achievements: "Achievements", challenges: "Challenges", challenge: "Challenge", create: "New challenge", replay: "Flyover" };
const TABS = [["record", "Record"], ["history", "History"], ["achievements", "Achievements"], ["challenges", "Challenges"]];
function header() {
  const root = ui.screen === "select" || ui.screen === "record" || ROOT.includes(ui.screen) && ui.screen !== "history" && ui.screen !== "achievements" && ui.screen !== "challenges";
  const cur = ui.screen === "select" ? "record" : ui.screen;
  const closeReplay = ui.screen === "replay";
  return `<header class="sp-head"><button type="button" class="sp-ibtn" data-act="${root ? "minimize" : "back"}" aria-label="${root ? "Back to Oldtime" : "Back"}">${svg(root ? I.close : I.back)}</button>
  <h2>${titles[ui.screen]}</h2>${closeReplay
    ? `<button type="button" class="sp-ibtn sp-close-flyover" data-act="close-replay" aria-label="Close flyover">${svg(I.close)}</button>`
    : `<div class="sp-menuwrap"><button type="button" class="sp-ibtn" data-act="menu" aria-haspopup="menu" aria-expanded="false" aria-label="More">${svg(I.more)}</button></div>`}</header>
  ${ROOT.includes(ui.screen) && ui.screen !== "record" ? `<nav class="sp-tabs" role="tablist" aria-label="Sports sections">${TABS.map(([k, t]) => `<button type="button" role="tab" aria-selected="${cur === k}" data-nav="${k}">${t}</button>`).join("")}</nav>` : ""}`;
}
function render(keepScroll) {
  if (!dlg) return;
  historyObserver?.disconnect(); historyObserver = null;
  const sc = keepScroll ? dlg.querySelector(".sp-body")?.scrollTop : 0;
  maps.destroy(); liveMap.destroy(); dlg.classList.toggle("sp-light", ui.screen === "select");
  const s = ui.screen, v = { select: selectView, record: recordView, history: historyView, detail: detailView, achievements: soc.viewAchievements, challenges: soc.viewChallenges, challenge: soc.viewChallenge, create: soc.viewCreate, replay: replayView }[s];
  dlg.innerHTML = `${header()}<main class="sp-body sp-${s}" aria-busy="${!!ui.busy}">${v()}</main>${ui.confirm ? confirmView() : ""}${soc.sheetHTML()}`;
  if (s === "record") ensureLiveMapTools(dlg.querySelector("#sp-map"));
  if (sc) dlg.querySelector(".sp-body").scrollTop = sc;
  if (s === "history" && snap().hasMore && !ui.busy && "IntersectionObserver" in window) {
    const more = dlg.querySelector('[data-act="more-history"]'), body = dlg.querySelector(".sp-body");
    if (more && body) {
      historyObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting) && !ui.busy) {
          void run("more-history", () => sports.loadMore());
        }
      }, { root: body, rootMargin: "240px 0px" });
      historyObserver.observe(more);
    }
  }
  if (s === "detail" && ui.view === "trace") bindRoute();
  if (s === "record") update();
  if (s === "detail" && ui.view === "map" || s === "replay") mountMap();
  if (s === "select") playFlip();
}
const limit = () => `<p class="sp-keep">Location tracking starts when you tap Start. Your live location is not shared with friends.</p><details class="sp-details"><summary>Recording and location details</summary><p>The web app records GPS while it is open. Background tracking depends on your device and location permissions; use the Oldtime app for supported lock-screen recording. Pausing stops GPS collection. Route sections without location readings are left unconnected to keep the activity record accurate. After sync, the activity appears in your account history and reports.</p><p>The map provider receives the displayed map area to load map tiles. Your live GPS location is not broadcast to friends. You choose whether to share a completed activity.</p><div data-r="credits"></div></details>`;

// ---------- selection ----------
function selectView() {
  const g = snap().gpsStatus, p = ui.pick, c = p ? colors(p) : null;
  return `<div class="sp-acts ${p ? "has-pick" : ""}" role="radiogroup" aria-label="Activity">${ACTIVITIES.map((a, i) => { const k = colors(a.id), on = p === a.id; return `<button type="button" role="radio" aria-checked="${on}" class="sp-tile t${i} ${on ? "sel" : ""}" data-pick="${a.id}" style="--ac:${k.c};--ak:${k.k}"><img src="${esc(photoFor(a.id))}" alt="" decoding="async" onerror="this.remove()"><span class="sp-tile-in">${actIcon(a.id)}<b>${esc(a.label)}</b><small>${esc(a.description)}</small></span></button>`; }).join("")}</div>
  ${p ? "" : `<p class="sp-hintline">Choose an activity to begin.</p>`}
  <section class="sp-launch ${p ? "on" : ""}" aria-hidden="${!p}"><div>
    <div class="sp-gps"><span class="sp-dot ${["ready", "active", "granted", "tracking", "recording"].includes(g) ? "" : "off"}"></span>GPS: ${esc(g || "not requested")}</div>
    ${snap().error ? `<p class="sp-err">${esc(clean(snap().error))} <button type="button" class="sp-link" data-act="start">Try again</button></p>` : ""}${errHtml()}
    <button type="button" class="sp-go" data-act="start" ${p ? "" : 'tabindex="-1"'} ${ui.busy ? "disabled" : ""}>${ui.busy === "start" ? "Starting" : `Start ${p ? esc(label(p)).toLowerCase() : ""}`}</button>${limit()}</div></section>`;
}
const captureFlip = () => { flipFrom = {}; dlg?.querySelectorAll(".sp-tile").forEach(t => { flipFrom[t.dataset.pick] = t.getBoundingClientRect(); }); };
function playFlip() {
  const f = flipFrom; flipFrom = null; if (!f || matchMedia("(prefers-reduced-motion:reduce)").matches) return;
  dlg.querySelectorAll(".sp-tile").forEach(t => {
    const a = f[t.dataset.pick]; if (!a) return; const b = t.getBoundingClientRect();
    if (!b.width || !b.height) return;
    t.animate([{ transformOrigin: "0 0", transform: `translate(${a.left - b.left}px,${a.top - b.top}px) scale(${a.width / b.width},${a.height / b.height})` }, { transformOrigin: "0 0", transform: "none" }], { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" });
    const inner = t.firstElementChild; inner?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 80, fill: "backwards" });
  });
}

// ---------- recording ----------
function recordView() {
  const a = live(); if (!a) return `<div class="sp-empty"><b>No active recording</b></div>`;
  const k = colors(a.activityType);
  return `<section class="sp-live" style="--ac:${k.c};--ak:${k.k}">
  <div class="sp-stage"><div id="sp-map" class="sp-map" data-live="map" aria-label="Live vector map">
    <div class="sp-map-wait" data-live="mapwait" role="status"><p data-live="maphint">Allow location when your workout starts. The map will center on your first accurate GPS fix.</p><button type="button" class="sp-sec sm" data-act="retrygps" hidden>Retry GPS</button><button type="button" class="sp-sec sm" data-act="maprety" hidden>Retry map</button></div>
  </div>
    <div class="sp-hud">
      <div><b data-live="time">0:00</b><small>Time</small></div>
      <div><b data-live="dist">0.00</b><small>Distance · km</small></div>
      <div><b data-live="pace">--</b><small>Pace · min/km</small></div>
      <div><b data-live="speed">--</b><small>Avg speed · km/h</small></div>
    </div></div>
   <div class="sp-live-top">${actIcon(a.activityType)}<b>${esc(label(a.activityType))}</b><span class="sp-state" data-live="state"></span></div>
   <div class="sp-live-alerts"><p class="sp-status" data-r="status">Waiting for location permission</p>
   <p class="sp-location-note">GPS records while this workout is active. Background tracking depends on your device and permissions.</p>
   <div class="sp-banner" data-live="banner" hidden></div>${errHtml()}
   <details class="sp-details sp-record-details"><summary>Location &amp; privacy</summary><p>Your live location isn’t shared. Pausing or saving stops GPS collection. Background tracking depends on device support and permissions; web recording may pause when the browser is backgrounded. Unconfirmed GPS gaps are left open in the route.</p></details></div>
  <div class="sp-ctl"><button type="button" class="sp-circle sec" data-act="discard" aria-label="Discard recording">${svg(I.close)}</button>
    <button type="button" class="sp-circle main" data-act="toggle" data-live="toggle" aria-label="Pause" ${ui.busy ? "disabled" : ""}>${svg(I.pause)}</button>
    <button type="button" class="sp-circle fin" data-act="finish" aria-label="Save activity" ${ui.busy ? "disabled" : ""}>${svg(I.stop)}</button></div>
   <div class="sp-ctl-l"><span>Discard</span><span data-live="tlabel">Pause</span><span>${ui.busy === "finish" ? "Saving" : "Save activity"}</span></div></section>`;
}
function gpsStatusText(a, st) {
  if (a.status === "paused") return "Paused · GPS tracking is off. Resume to continue recording.";
  if (st.gpsStatus === "denied") return "Location permission is off. Enable location for Oldtime in browser or iPhone settings, then retry.";
  if (st.gpsStatus === "unavailable") return "Location services aren’t available here. Check location access in your browser settings, then retry.";
  if (st.gpsStatus === "weak") return "GPS signal is still settling. Recording will use location points that meet the accuracy threshold.";
  if (st.gpsStatus === "gap") return "Reconnecting to GPS. Only confirmed location points are included in your route.";
  if (st.gpsStatus === "tracking") return `GPS connected · reported accuracy ±${Math.round(st.accuracyM ?? 0)} m · recording route points.`;
  return "Waiting for location permission and the first GPS reading.";
}
function mapHintText(a, st) {
  if (ui.vectorMapErr) return `Map preview unavailable. ${ui.vectorMapErr}`;
  if (a.status === "paused") return "Paused · GPS tracking is off.";
  if (st.gpsStatus === "denied") return "Location access is off. Enable location for Oldtime, then retry GPS.";
  if (st.gpsStatus === "unavailable") return "Location access isn’t available here. Check browser settings, then retry.";
  if (st.gpsStatus === "weak") return "Waiting for a clearer GPS reading. Lower-accuracy points are not added to the route.";
  if (st.gpsStatus === "gap") return "Reconnecting to GPS. The route will include only confirmed location points.";
  return "Allow location when prompted. The map centers on your first accurate GPS fix.";
}
function showMapError(host, message) {
  ui.vectorMapErr = message || "The map could not load.";
  host.classList.remove("loading");
  const wait = host.querySelector('[data-live="mapwait"]');
  wait?.removeAttribute("aria-busy");
  const hint = host.querySelector('[data-live="maphint"]');
  if (hint) hint.textContent = `Map preview unavailable. ${ui.vectorMapErr}`;
  const retry = host.querySelector('[data-act="maprety"]');
  if (retry) retry.hidden = false;
  const gpsRetry = host.querySelector('[data-act="retrygps"]');
  if (gpsRetry) gpsRetry.hidden = true;
  if (wait) wait.hidden = false;
}
async function mountLiveVectorMap(workout) {
  const host = dlg?.querySelector("#sp-map"); if (!host || !workout) return;
  const wait = host.querySelector('[data-live="mapwait"]');
  const hint = host.querySelector('[data-live="maphint"]');
  if (hint) hint.textContent = "Loading the custom vector street map…";
  wait?.setAttribute("aria-busy", "true"); if (wait) wait.hidden = false;
  host.classList.add("loading");
  try {
    await liveMap.mount(host, { workout, viewer: owner(), theme: ui.mapTheme });
    if (!host.isConnected || !liveMap.inst) return;
    host.classList.remove("loading");
    if (wait) { wait.hidden = true; wait.removeAttribute("aria-busy"); }
    liveMap.update(live() || workout, owner(), colors(workout.activityType).c);
  } catch (error) {
    liveMap.destroy();
    if (host.isConnected) showMapError(host, error?.message || "The map could not load.");
  }
}
function syncLiveVectorMap(workout, st) {
  const host = dlg?.querySelector("#sp-map"); if (!host || !workout) return;
  ensureLiveMapTools(host);
  if (liveMap.inst) {
    liveMap.update(workout, owner(), colors(workout.activityType).c);
    return;
  }
  if (liveMap.pending) return;
  const wait = host.querySelector('[data-live="mapwait"]');
  const hint = host.querySelector('[data-live="maphint"]');
  const gpsRetry = host.querySelector('[data-act="retrygps"]');
  const mapRetry = host.querySelector('[data-act="maprety"]');
  if (ui.vectorMapErr) { showMapError(host, ui.vectorMapErr); return; }
  if (mapRetry) mapRetry.hidden = true;
  const last = workout.points?.at(-1);
  if (last && Number.isFinite(last.lat ?? last.latitude) && Number.isFinite(last.lon ?? last.longitude) &&
      (!Number.isFinite(last.accuracy) || last.accuracy <= 50)) {
    void mountLiveVectorMap(workout);
    return;
  }
  if (hint) hint.textContent = mapHintText(workout, st);
  if (gpsRetry) gpsRetry.hidden = !(["denied", "unavailable", "gap"].includes(st.gpsStatus) && workout.status === "recording");
  if (wait) wait.hidden = false;
  host.classList.toggle("loading", st.gpsStatus === "locating");
}
function update() {
  if (!dlg) return;
  const a = live();
  if (ui.screen === "record") {
    if (!a) { if (!ui.busy) go("select"); return; }
    const s = a.summary || {}, q = k => dlg.querySelector(`[data-live=${k}]`), paused = a.status === "paused", st = snap();
    const set = (k, v) => { const n = q(k); if (n && n.textContent !== v) n.textContent = v; };
    set("dist", fmtDist(s.distanceM)); set("time", fmtDur(s.activeSeconds));
     set("pace", Number.isFinite(s.paceSecondsPerKm) ? fmtPace(s.paceSecondsPerKm) : "--");
     set("speed", Number.isFinite(s.speedKmh) ? s.speedKmh.toFixed(1) : "--");
    set("state", paused ? "Paused" : "Recording"); set("tlabel", paused ? "Resume" : "Pause");
    const tg = q("toggle"); if (tg) { tg.innerHTML = svg(paused ? I.play : I.pause); tg.setAttribute("aria-label", paused ? "Resume" : "Pause"); }
    dlg.querySelector(".sp-live")?.classList.toggle("paused", paused);
     const b = q("banner"), m = ui.err ? clean(ui.err) : st.error ? `Location update: ${clean(st.error)}` : paused ? "Paused. Resume to continue GPS tracking, or finish to add this activity to your history." : clean(st.warning) || (st.gpsStatus && !["ready", "active", "granted", "tracking", "recording"].includes(st.gpsStatus) ? `GPS: ${st.gpsStatus}` : "");
     if (b) { b.hidden = !m; if (b.textContent !== m) b.textContent = m; b.classList.toggle("bad", !!(st.error || ui.err)); }
    const status = dlg.querySelector('[data-r="status"]');
    if (status) status.textContent = gpsStatusText(a, st);
    syncLiveVectorMap(a, st);
  } else if (ui.screen === "history") { const l = dlg.querySelector(".sp-list"); if (l) l.outerHTML = histList(); }
}
function mapFallbackMarkup(workout) {
  const protectEnds = ui.screen === "replay" && ui.hideEnds;
  const geo = routeGeometry(workout, { trim: protectEnds });
  const hasRoute = !!geo.segments?.length;
  const fit = hasRoute ? fitRoute(geo, 24, 18, 352, 250) : null;
  const privacyTrimmed = protectEnds && !hasRoute && ["Too short to share a route privately.", "Nothing left after trimming route ends."].includes(geo.reason);
  const note = hasRoute
    ? "The map preview is unavailable. Your recorded GPS route is shown as a trace."
    : privacyTrimmed
      ? "This route is too short to keep both ends hidden. Turn off Auto-hide start & finish below to show the full route."
      : geo.reason === "No GPS route was recorded."
        ? "No GPS route was recorded for this activity. Your workout summary is still available."
        : ui.screen === "record"
          ? "The map preview will show your route after the first accurate GPS reading."
          : "The map preview is unavailable. Retry the map to view the route.";
  const trace = fit ? `<svg class="sp-map-fallback-trace" viewBox="0 0 400 286" role="img" aria-label="Recorded GPS route trace">
    <path d="${pathD(fit.segments)}" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${pathD(fit.segments)}" fill="none" stroke="#ed2339" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${fit.start.x}" cy="${fit.start.y}" r="13" fill="${POSITION_RED}" stroke="#fff" stroke-width="3"/>
    <circle cx="${fit.end.x}" cy="${fit.end.y}" r="13" fill="${POSITION_RED}" stroke="#fff" stroke-width="3"/>
  </svg>` : "";
  return `<div class="sp-map-fallback">${trace}<div class="sp-map-fallback-copy"><b>Map preview unavailable</b><span>${esc(note)}</span><button type="button" class="sp-sec sm" data-act="maprety">Retry map</button></div></div>`;
}
async function mountMap(wk) {
  const host = dlg?.querySelector("#sp-map"); if (!host) return;
  const workout = wk || (ui.screen === "record" ? live() : ui.workout); if (!workout) return;
  if (ui.mapErr) { host.innerHTML = mapFallbackMarkup(workout); return; }
  if (ui.screen === "record" && !(workout.points || []).length) return;
  host.innerHTML = ""; host.classList.add("loading");
  const status = dlg.querySelector("[data-r=status]"); if (status) status.textContent = "Loading map";
  maps.onError = e => { ui.mapErr = e?.message || String(e); if (dlg) { maps.destroy(); const h = dlg.querySelector("#sp-map"); if (h) mountMap(); } };
  maps.onFrame = paintFrame; maps.onMode = i => { ui.mi = i; paintReplay(); };
  try {
     const mounting = maps.mount(host, { workout, hideEnds: ui.screen === "replay" && ui.hideEnds, defaultSpeed: ui.screen === "replay" ? 8 : undefined, style: ui.screen === "replay" ? "vector" : "street", theme: ui.mapTheme,
      live: ui.screen === "record", overhead: ui.screen === "record" && ui.view === "trace" });
    if (ui.screen === "replay") paintReplay();
    await mounting;
    ensureMapTools(host);
  }
  catch (e) {
    if (ui.screen === "record" && e?.code === "no-route") { host.classList.remove("loading"); host.innerHTML = '<p class="sp-maphint">Waiting for GPS points</p>'; return; }
    ui.mapErr = e?.message || "The map preview could not start."; if (dlg?.querySelector("#sp-map")) mountMap(); return;
  }
  host.classList.remove("loading"); paintReplay();
}
function paintFrame(f) {
  if (!dlg || ui.screen !== "replay") return; ui.frame = f;
  const set = (k, v) => { const n = dlg.querySelector(`[data-r=${k}]`); if (n && n.textContent !== v) n.textContent = v; };
  set("time", fmtDur(f.elapsedMs / 1000)); set("dist", fmtDist(f.distanceM)); set("pace", ui.workout?.activityType === "cycle" ? "--" : fmtPace(f.paceSecondsPerKm));
  set("alt", f.gpsAltitudeM == null ? "--" : String(Math.round(f.gpsAltitudeM)));
  const sk = dlg.querySelector("#sp-seek"); if (sk && document.activeElement !== sk) sk.value = Math.round(f.progress * 1000);
}
function paintReplay() {
  if (!dlg || !["replay", "record", "detail"].includes(ui.screen)) return; const m = ui.mi || {};
  const q = k => dlg.querySelector(`[data-r=${k}]`), pb = dlg.querySelector("[data-act=rplay]");
  if (pb) { const prog = ui.frame?.progress || 0; pb.textContent = m.playing ? "Pause" : prog > 0 && prog < 1 ? "Resume" : "Play"; }
  dlg.querySelectorAll("[data-speed]").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.speed === m.speed)));
  const mode = m.mode || ui.style, im = m.imagery || null;
   if (ui.videoSecondsAuto && m.timelineDurationMs > 0) {
     ui.videoSeconds = Math.max(15, Math.min(120, Math.ceil((m.timelineDurationMs / 1000) / 2 / 15) * 15));
   }
   const durationSelect = dlg.querySelector("#sp-video-seconds");
   if (durationSelect) durationSelect.value = String(ui.videoSeconds);
   const videoSummary = q("video-summary");
   if (videoSummary) videoSummary.textContent = `Video options · 3D city flyover · ${ui.videoSeconds} sec · ${ui.videoAspect} · ${ui.videoQuality === "high" ? "1080p" : "720p"}`;
   const lengthNote = q("video-length-note");
   if (lengthNote) lengthNote.textContent = ui.videoSecondsAuto
     ? "Automatic length aims for a clear route reveal at a moderate pace. You can change it here. This changes export playback only; the on-screen preview speed stays the same."
     : "A longer export gives the route and camera more time. This changes export playback only; the on-screen preview speed stays the same.";
  const flyoverReady = canRenderFlyover(mode, im?.kind);
  dlg.querySelectorAll("[data-aspect]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.aspect === ui.videoAspect)));
  dlg.querySelectorAll("[data-quality]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.quality === ui.videoQuality)));
   const gapNotice = q("gapnotice");
   if (gapNotice) {
     gapNotice.hidden = !(m.estimatedGapCount > 0);
     gapNotice.textContent = m.estimatedGapCount > 0
       ? `${m.estimatedGapCount} short GPS gap${m.estimatedGapCount === 1 ? "" : "s"} estimated for the flyover. Dashed sections are not included in workout stats.`
       : "";
   }
   const privacyState = q("privacy-state");
   if (privacyState) privacyState.textContent = ui.hideEnds ? "On · hides 250 m from each end" : "Off · start and finish will appear in the video";
   const privacyWarning = q("privacy-warning");
   if (privacyWarning) privacyWarning.hidden = ui.hideEnds;
  ensureMapTools(dlg.querySelector("#sp-map"));
  dlg.querySelectorAll("[data-act=fullroute],[data-act=followroute]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.act === "followroute" ? !!m.follow : !m.follow)));
  dlg.querySelectorAll("[data-layer]").forEach(input => { if (m.layers) input.checked = !!m.layers[input.dataset.layer]; });
  const st = q("status");
  const imageExport = dlg.querySelector('[data-act="mapimg"]');
  if (imageExport) imageExport.disabled = !!ui.busy || maps.pending || mode !== ui.style || !maps.inst?.exportMapImage ||
    (mode === "vector" ? m.renderer !== "vector" : !im);
  const videoExport = dlg.querySelector('[data-act="export"]');
  const rendererReady = !maps.pending && mode === ui.style && !!maps.inst?.exportVideo && m.status === "ok" && m.renderer !== "none";
  if (videoExport) {
    videoExport.disabled = !!ui.busy || !rendererReady ||
      (mode === "vector" && m.renderer !== "vector") ||
      (ui.videoCamera === "flyover" && !flyoverReady);
    videoExport.textContent = maps.pending ? "Preparing route map…" :
      ui.busy === "export" ? (ui.videoCamera === "flyover" ? "Rendering flyover" : "Rendering video") :
      ui.video?.kind === "video" ? "Render again" :
      ui.videoCamera === "flyover" ? "Create flyover" : "Create video";
  }
  const quickShare = dlg.querySelector('[data-act="quick-share"]');
  if (quickShare) {
    quickShare.disabled = !!ui.busy;
    quickShare.querySelector("span").textContent = ui.busy === "export" ? "Creating flyover…" : "Share flyover";
  }
  const asked = ui.screen === "record" ? (ui.view === "map" ? "imagery" : "street") : ui.style;
   if (st) st.textContent = mode === "vector" ? (m.reason || `3D city · ${m.attribution?.text || "Map data"}`) : mode === "imagery" ? (im?.label || "Aerial imagery") : mode === "street" ? "Street map" : mode === "terrain" ? "Terrain relief under your GPS route" : asked !== mode && m.reason ? `Trace view. ${m.reason}` : "Trace view: your GPS route, not a map";
  const cr = q("credits");
  if (cr) {
    const links = (im?.links || []).filter(l => /^https:\/\//.test(l?.href || "")).map(l => `<a href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.label || "Source")}</a>`).join("");
    const vectorLinks = (m.attribution?.links || []).filter(l => /^https:\/\//.test(l?.href || ""))
      .map(l => `<a href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.label || "Source")}</a>`).join(" · ");
    cr.innerHTML = mode === "vector" ? `<b>Map credit</b><p>${esc(m.attribution?.text || "Map data provider")}</p>${vectorLinks}` : mode === "street" ? `<b>Map credit</b><p>${esc(m.credit || "OpenStreetMap contributors")}</p><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">openstreetmap.org/copyright</a>` : mode === "imagery" && (im?.credit || links) ? `<b>Imagery credit</b><p>${esc(im?.credit || "")}</p>${im?.detail ? `<p>${esc(im.detail)}</p>` : ""}${links}` : "";
  }
  const mapHost = dlg.querySelector("#sp-map");
  const failed = mode === "vector" && m.renderer !== "vector" && m.reason && !m.reason.startsWith("Loading");
  let failPanel = mapHost?.querySelector(".sp-vector-replay-error");
  if (failed && mapHost) {
    if (!failPanel) {
      failPanel = document.createElement("div");
      failPanel.className = "sp-maperr sp-vector-replay-error";
      failPanel.innerHTML = '<b>Map preview unavailable</b><span data-r="map-failure"></span><button type="button" class="sp-sec sm" data-act="mapretry">Retry map</button>';
      mapHost.append(failPanel);
    }
    failPanel.querySelector('[data-r="map-failure"]').textContent = m.reason;
    const retry = failPanel.querySelector('[data-act="mapretry"]');
    if (retry) { retry.disabled = maps.pending; retry.textContent = maps.pending ? "Finishing map setup…" : "Retry map"; }
  } else failPanel?.remove();
  const lm = dlg.querySelector(".sp-layers"); if (lm) lm.hidden = mode !== "street";
  const cl = dlg.querySelector("[data-r=creditline]"); if (cl) cl.hidden = mode === "stylized";
  const at = dlg.querySelector("[data-r=attr]");
  if (at) at.hidden = mode !== "terrain";
}

// ---------- history / detail ----------
function histList() {
  const st = snap(), h = st.history || [];
  if (st.loading && !h.length) return `<ul class="sp-list">${"<li class='sp-skel'></li>".repeat(3)}</ul>`;
  if (!h.length) return `<div class="sp-empty sp-list"><b>No workouts yet</b><span>Your completed activities will appear here.</span></div>`;
  return `<ul class="sp-list">${h.map(w => { const s = w.summary || {}, k = colors(w.activityType), id = esc(w.id), hasRoute = routeGeometry(w).segments.length > 0; return `<li class="sp-history-item"><button type="button" class="sp-row" data-open="${id}" style="--ac:${k.c}" aria-label="Open ${esc(label(w.activityType))}, ${esc(when(w))}">${actIcon(w.activityType)}<span><b>${esc(label(w.activityType))}</b><small>${esc(when(w))}</small></span><span class="sp-r"><b>${fmtDist(s.distanceM)} km</b><small>${fmtDur(s.activeSeconds)}${w.synced !== true ? ' <i class="sp-pend">Waiting to sync</i>' : ""}</small></span></button><button type="button" class="sp-history-share" data-open="${id}" ${hasRoute ? "" : "disabled"} aria-label="Create and share flyover for ${esc(label(w.activityType))}" title="${hasRoute ? "Create and share flyover" : "No recorded route to share"}">${svg(I.share)}<span>Flyover</span></button></li>`; }).join("")}</ul>`;
}
const historyView = () => `<p class="sp-note">Your activity history is private. Choose what you share.</p>${histList()}${snap().hasMore ? `<button type="button" class="sp-sec" data-act="more-history" ${ui.busy ? "disabled" : ""}>${ui.busy === "more-history" ? "Loading" : "Load more"}</button>` : ""}`;
function detailView() {
  const w = ui.workout; if (!w) return `<div class="sp-skel big"></div>`;
  const geo = routeGeometry(w), rows = statRows(w), s = w.summary || {}, k = colors(w.activityType), tg = soc.tagFor(w.id);
  return `<section class="sp-dhero" style="--ac:${k.c};--ak:${k.k}"><div class="sp-dhead">${actIcon(w.activityType)}<span><b>${esc(label(w.activityType))}</b><small>${esc(when(w))}</small></span></div>
  <div class="sp-stats">${rows.map(([l, v, u]) => `<div><small>${l}</small><b>${v}<i>${u}</i></b></div>`).join("")}</div></section>
  <div class="sp-viewsw wide" role="group" aria-label="Route view"><button type="button" data-view="map" aria-pressed="${ui.view === "map"}" ${geo.segments ? "" : "disabled"}>Map</button><button type="button" data-view="trace" aria-pressed="${ui.view === "trace"}">Trace</button></div>
  <section class="sp-route" aria-label="Route">${ui.view === "map" ? `<div id="sp-map" class="sp-map tall"></div><p class="sp-status" data-r="status"></p>` : geo.segments ? `<svg id="sp-svg" viewBox="0 0 400 300" role="img" aria-label="GPS route trace"><g id="sp-g"></g></svg>
    <div class="sp-zoom"><button type="button" class="sp-ibtn" data-act="zin" aria-label="Zoom in">+</button><button type="button" class="sp-ibtn" data-act="zout" aria-label="Zoom out">&minus;</button><button type="button" class="sp-ibtn t" data-act="zreset" aria-label="Reset view">1x</button></div>
    <p class="sp-cap">Route trace drawn from recorded GPS points. Not a map. Gaps are left open.</p>` : `<div class="sp-empty"><b>No route</b><span>${esc(geo.reason)}</span></div>`}</section>
  ${w.synced === false ? `<div class="sp-banner">${esc(syncNote(w))} <button type="button" class="sp-link" data-act="sync" ${ui.busy ? "disabled" : ""}>${ui.busy === "sync" ? "Syncing…" : "Sync now"}</button></div>` : ""}
  ${(s.flags || []).length ? `<p class="sp-note">Recording notes: ${esc(s.flags.map(recordingNote).join(", "))}.</p>` : ""}
  <div class="sp-tagrow">${soc.tagSummaryHTML(w.id, w.synced === true)}<button type="button" class="sp-link" data-act="tag" ${w.synced === true ? "" : "disabled"}>${tg ? "Edit" : "Challenge and people"}</button></div>${errHtml()}
  <div class="sp-actions"><button type="button" class="sp-go" data-act="replay" ${geo.segments ? "" : "disabled"}>Create &amp; share flyover</button></div>
  <button type="button" class="sp-link danger" data-act="delete" ${ui.busy ? "disabled" : ""}>Delete workout</button>`;
}
function bindRoute() {
  const svgEl = dlg.querySelector("#sp-svg"), g = dlg.querySelector("#sp-g"); if (!svgEl) return;
  const geo = routeGeometry(ui.workout), f = fitRoute(geo, 30, 30, 340, 240), z = ui.zoom, k = colors(ui.workout.activityType).c;
  g.innerHTML = `<path d="${pathD(f.segments)}" fill="none" stroke="${k}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  <circle cx="${f.start.x}" cy="${f.start.y}" r="13" fill="${POSITION_RED}" stroke="#fff" stroke-width="3"/><circle cx="${f.end.x}" cy="${f.end.y}" r="13" fill="${POSITION_RED}" stroke="#fff" stroke-width="3"/>`;
  const apply = () => g.setAttribute("transform", `translate(${z.x} ${z.y}) scale(${z.k})`); apply();
  const zoomAt = (k2, cx = 200, cy = 150) => { k2 = Math.min(12, Math.max(1, k2)); z.x = cx - (cx - z.x) * k2 / z.k; z.y = cy - (cy - z.y) * k2 / z.k; z.k = k2; if (k2 === 1) { z.x = 0; z.y = 0; } apply(); };
  svgEl._zoom = zoomAt;
  const pts = new Map(); let last = 0;
  svgEl.addEventListener("pointerdown", e => { svgEl.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { const [a, b] = [...pts.values()]; last = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
  svgEl.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId)) return; const r = svgEl.getBoundingClientRect(), sc = 400 / r.width, p = pts.get(e.pointerId);
    if (pts.size === 1) { z.x += (e.clientX - p[0]) * sc; z.y += (e.clientY - p[1]) * sc; apply(); }
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { const [a, b] = [...pts.values()], dd = Math.hypot(a[0] - b[0], a[1] - b[1]); if (last) zoomAt(z.k * dd / last, ((a[0] + b[0]) / 2 - r.left) * sc, ((a[1] + b[1]) / 2 - r.top) * sc); last = dd; }
  });
  const up = e => { pts.delete(e.pointerId); last = 0; }; svgEl.addEventListener("pointerup", up); svgEl.addEventListener("pointercancel", up);
  svgEl.addEventListener("wheel", e => { e.preventDefault(); const r = svgEl.getBoundingClientRect(); zoomAt(z.k * (e.deltaY < 0 ? 1.2 : .83), (e.clientX - r.left) * 400 / r.width, (e.clientY - r.top) * 300 / r.height); }, { passive: false });
}

// ---------- replay / video ----------
const LAYER_TOKENS = [["streets", "Road highlights"], ["route", "Your route"], ["pace", "Pace"], ["markers", "Markers"], ["collectibles", "Distance"], ["heat", "Your activity heat"]];
function layersMenu(m) {
  const l = m.layers || { route: true, markers: true, streets: true }, n = Number(m.collectedCount ?? 0);
  return `<details class="sp-details sp-layers"><summary>Layers</summary>${LAYER_TOKENS.map(([k, t]) => `<label class="sp-switch row"><input type="checkbox" data-layer="${k}" ${l[k] ? "checked" : ""}><span></span>${t}${k === "streets" && m.roadsStatus === "unavailable" ? " · unavailable" : ""}</label>`).join("")}
  <p class="sp-note">Distance tokens mark each 250 m of your measured route. ${n} reached.</p><button type="button" class="sp-sec sm" data-act="recenter">Recenter</button></details>`;
}
function dropExports() {
  if (ui.video?.url) URL.revokeObjectURL(ui.video.url); ui.video = null;
  if (ui.mapImg?.url) URL.revokeObjectURL(ui.mapImg.url); ui.mapImg = null;
  dlg?.querySelectorAll(".sp-output video.sp-video,.sp-output img.sp-video,.sp-output [data-act=vpublish],.sp-output [data-act=vdl],.sp-output [data-act=vnative],.sp-output [data-act=vshare],.sp-exp video.sp-video,.sp-exp img.sp-video,.sp-exp [data-act=ipublish],.sp-exp [data-act=idl],.sp-exp [data-act=inative]").forEach(n => n.remove());
  dlg?.querySelector(".sp-output")?.remove();
  dlg?.querySelectorAll(".sp-exp .sp-actions.two:empty").forEach(n => n.remove());
  const ex = dlg?.querySelector('[data-act="export"]'); if (ex && !ui.busy) ex.textContent = ui.videoCamera === "flyover" ? "Create flyover" : "Create route video";
}
function replayView() {
  const ok = exportSupported(), v = ui.video, m = ui.mi || {}, mode = m.mode || ui.style, busy = !!ui.busy;
  const videoCamera = "flyover";
  const w = ui.workout, s = w?.summary || {}, flags = s.flags || [];
  const info = w ? `<section class="sp-replay-info"><div class="sp-replay-summary"><span><b>${esc(label(w.activityType))}</b><small>${esc(when(w))}</small></span><strong>${fmtDist(s.distanceM)} km <small>· ${fmtDur(s.activeSeconds)}</small></strong></div>
    <div class="sp-replay-sync"><span>${esc(syncNote(w))}</span>${w.synced === false ? `<button type="button" class="sp-link" data-act="sync" ${busy ? "disabled" : ""}>${ui.busy === "sync" ? "Syncing…" : "Sync now"}</button>` : ""}</div>
    <details class="sp-details sp-workout-details"><summary>Workout details${flags.length ? ` · ${esc(flags.map(recordingNote).join(", "))}` : ""}</summary>
      <div class="sp-stats">${statRows(w).map(([l, v, u]) => `<div><small>${l}</small><b>${v}<i>${u}</i></b></div>`).join("")}</div>
      ${flags.length ? `<p class="sp-note">Recording notes: ${esc(flags.map(recordingNote).join(", "))}.</p>` : ""}
      <div class="sp-tagrow">${soc.tagSummaryHTML(w.id, w.synced === true)}<button type="button" class="sp-link" data-act="tag" ${w.synced === true ? "" : "disabled"}>Challenge and people</button></div>
      <button type="button" class="sp-link danger-link" data-act="delete">Delete workout</button>
    </details></section>` : "";
  return `<div class="sp-replay-map-wrap"><div id="sp-map" class="sp-map tall" aria-label="3D city route flyover"></div><span class="sp-flyover-tag">3D city · Cinematic flyover</span>
  <div class="sp-replay-map-footer"><div class="sp-replay-map-stats" aria-label="Workout progress">
    <div><b data-r="time">0:00</b><small>Time</small></div><div><b data-r="dist">0.00</b><small>km</small></div><div><b data-r="pace">--</b><small>${ui.workout?.activityType === "cycle" ? "km/h" : "min/km"}</small></div><div><b data-r="alt">--</b><small>GPS alt m</small></div>
  </div><button type="button" class="sp-replay-share" data-act="quick-share" ${busy ? "disabled" : ""} aria-label="Create and share this flyover">${svg(I.share)}<span>${busy === "export" ? "Creating flyover…" : "Share flyover"}</span></button></div></div>
  <section class="sp-replay-dock" aria-label="Flyover controls">
  ${info}
  <p class="sp-gap-legend" data-r="gapnotice" hidden></p>
  <div class="sp-privacy-panel" role="group" aria-label="Flyover route privacy">
    <div><b>Auto-hide start &amp; finish</b><small data-r="privacy-state">${ui.hideEnds ? "On · hides 250 m from each end" : "Off · start and finish will appear in the video"}</small></div>
    <label class="sp-switch row"><input type="checkbox" id="sp-hide" aria-label="Automatically hide the first and last 250 metres" ${ui.hideEnds ? "checked" : ""}><span></span></label>
  </div>
  <p class="sp-warn" data-r="privacy-warning" ${ui.hideEnds ? "hidden" : ""}>Your start and finish will be visible in this video.</p>
  <input type="range" id="sp-seek" class="sp-seek" min="0" max="1000" value="0" aria-label="Replay position">
  <div class="sp-ctl-row"><button type="button" class="sp-sec sm" data-act="rplay">Play</button><button type="button" class="sp-sec sm" data-act="rrestart">Restart</button>
   <span class="sp-viewsw" role="group" aria-label="Replay speed; default is 8x">${[1, 2, 4, 8].map(n => `<button type="button" data-speed="${n}" aria-pressed="${n === m.speed}">${n}x</button>`).join("")}</span></div>
  <div class="sp-ctl-row"><span class="sp-viewsw wide" role="group" aria-label="Replay camera"><button type="button" data-act="fullroute" aria-pressed="${!m.follow}">Full Route</button><button type="button" data-act="followroute" aria-pressed="${!!m.follow}">Follow Journey</button></span></div>
   <div class="sp-actions sp-replay-actions">${ok
    ? v?.kind === "video"
       ? `<button type="button" class="sp-go" data-act="vpublish" ${busy || !opts.onPublish ? "disabled" : ""}>${ui.busy === "publish" ? "Posting…" : "Post to main feed"}</button>`
       : `<button type="button" class="sp-go" data-act="export" ${busy ? "disabled" : ""}>${ui.busy === "export" ? "Creating flyover…" : videoCamera === "flyover" ? "Create flyover" : "Create route video"}</button>`
     : `<button type="button" class="sp-go" data-act="exportsvg" ${busy ? "disabled" : ""}>${v?.kind === "svg" ? "Refresh animated card" : "Create animated card"}</button>`}
      ${ok ? `<button type="button" class="sp-sec" data-act="exportsvg" ${busy ? "disabled" : ""}>${v?.kind === "svg" ? "Refresh animated card" : "Animated card"}</button>` : ""}
  </div>
    ${ok && v?.kind === "video" ? `<div class="sp-replay-secondary"><button type="button" class="sp-link" data-act="export" ${busy ? "disabled" : ""}>Create another flyover</button>${opts.onShare ? ` · <button type="button" class="sp-link" data-act="vshare" ${busy ? "disabled" : ""}>Create a post</button>` : ""}</div>` : ""}
   ${v ? `<section class="sp-output" aria-live="polite">${v.kind === "svg" ? `<img class="sp-video" src="${esc(v.url)}" alt="Animated route card preview"><button type="button" class="sp-sec" data-act="vdl">Download card</button>` : `<video class="sp-video" src="${esc(v.url)}" controls playsinline></video><p class="sp-note">Rendered ${/mp4/i.test(v.blob?.type || "") ? "MP4" : "WebM"} · available video format depends on this browser.</p>
     <div class="sp-actions two"><button type="button" class="sp-sec" data-act="vdl">Download video</button>${navigator.canShare ? `<button type="button" class="sp-sec" data-act="vnative">Share via device</button>` : ""}</div>`}</section>` : ""}
  ${mode === "street" && ui.style === "street" && m.layers ? layersMenu(m) : ""}
  <p class="sp-status" data-r="status"></p>
  <section class="sp-exp">
  ${errHtml()}<div class="sp-progress" ${ui.busy === "export" ? "" : "hidden"}><i style="width:${Math.round(ui.progress * 100)}%"></i></div>
  <details class="sp-details sp-video-options" data-sp-video-options ${ui.videoOptionsOpen ? "open" : ""}><summary data-r="video-summary">Video options · 3D city flyover · ${ui.videoSeconds} sec · ${ui.videoAspect === "portrait" ? "portrait" : "landscape"} · ${ui.videoQuality === "high" ? "1080p" : "720p"}</summary><div class="sp-video-settings">
  <div class="sp-ctl-row"><span class="sp-viewsw wide" role="group" aria-label="Video aspect ratio"><button type="button" data-aspect="portrait" aria-pressed="${ui.videoAspect === "portrait"}">9:16 portrait</button><button type="button" data-aspect="landscape" aria-pressed="${ui.videoAspect === "landscape"}">16:9 landscape</button></span></div>
  <div class="sp-ctl-row"><span class="sp-viewsw wide" role="group" aria-label="Video quality"><button type="button" data-quality="standard" aria-pressed="${ui.videoQuality === "standard"}">720p</button><button type="button" data-quality="high" aria-pressed="${ui.videoQuality === "high"}">1080p</button></span></div>
  <label class="sp-sel">Video length<select id="sp-video-seconds" aria-label="Export video length" ${busy ? "disabled" : ""}>${[15, 20, 30, 45, 60, 90, 120].map(n => `<option value="${n}" ${n === ui.videoSeconds ? "selected" : ""}>${n} seconds${n === ui.videoSeconds ? ui.videoSecondsAuto ? " · automatic" : " · selected" : ""}</option>`).join("")}</select></label>
  <p class="sp-note" data-r="video-length-note">${ui.videoSecondsAuto ? "Automatic length aims for a clear route reveal at a moderate pace. You can change it here." : "A longer export gives the route and camera more time."} This changes export playback only; the on-screen preview speed stays the same.</p>
   <p class="sp-note">The flyover follows your route at a close, low angle, circles once, then reveals the full route. 3D building detail appears where mapped heights are available. ${mobileVideoDevice() ? "1080p uses more phone memory and battery; 720p is the safer default." : ""}</p>
  <label class="sp-switch row"><input type="checkbox" id="sp-owner" ${ui.showOwner ? "checked" : ""}><span></span>Show my name</label>
  <textarea id="sp-vcap" class="sp-cap-in" rows="2" maxlength="280" placeholder="Caption">${esc(ui.vcaption)}</textarea>
  ${ok ? "" : `<p class="sp-note">Video export isn’t supported in this browser. Create an animated card instead.</p>`}
     </div></details>
  <details class="sp-details"><summary>Details</summary>
       <p>Recorded GPS points determine workout distance, pace and altitude. For a plausible signal interruption of up to two minutes, the flyover draws a dashed estimated connection between recorded points; that estimate is excluded from workout stats. Longer gaps, pauses, privacy cuts and implausible jumps remain unconnected.</p>
      <p>For reliable GPS tracking, keep location access enabled. Background tracking depends on your device and permissions; video export stops if you leave the app and can be started again when you return.</p>
  <div data-r="credits"></div>
   <div data-r="attr" hidden><b>Terrain credits</b><ul>${ATTRIBUTION_LINES.map(l => `<li>${esc(l)}</li>`).join("")}</ul><a href="${ATTRIBUTION_URL}" target="_blank" rel="noopener noreferrer">Full attribution</a></div></details></section>`;
}
const ext = b => /svg/.test(b.type) ? "svg" : /mp4/.test(b.type) ? "mp4" : "webm";
function setReplayError(message) {
  ui.err = message || "";
  const exp = dlg?.querySelector(".sp-exp");
  if (!exp) return;
  let alert = exp.querySelector(".sp-err");
  if (!message) { alert?.remove(); return; }
  if (!alert) {
    alert = document.createElement("p");
    alert.className = "sp-err";
    alert.setAttribute("role", "alert");
    const progress = exp.querySelector(".sp-progress");
    if (progress) progress.before(alert); else exp.append(alert);
  }
  alert.textContent = clean(message);
}
async function doExport() {
  const inst = maps.inst;
  const mode = ui.mi?.mode || ui.style;
  const ready = !!inst?.exportVideo && !maps.pending && ui.mi?.status === "ok" &&
    ui.mi?.renderer !== "none" && (ui.videoCamera !== "flyover" || canRenderFlyover(mode, ui.mi?.imagery?.kind));
  if (!ready) {
    setReplayError(maps.pending
      ? "The route map is still preparing. Wait for the map to finish before creating a video."
      : ui.mi?.reason && !ui.mi.reason.startsWith("Loading")
        ? ui.mi.reason
        : "The route map is not ready. Retry the map, then create the video.");
    paintReplay();
    return;
  }
  setReplayError(""); ui.busy = "export"; ui.progress = 0; dlg.classList.add("exporting");
  dlg.querySelector(".sp-progress")?.removeAttribute("hidden"); const go1 = dlg.querySelector("[data-act=export]"); if (go1) { go1.disabled = true; go1.textContent = ui.videoCamera === "flyover" ? "Rendering flyover" : "Rendering video"; }
  const shareButton = dlg.querySelector('[data-act="quick-share"]');
  if (shareButton) { shareButton.disabled = true; shareButton.querySelector("span").textContent = "Creating flyover…"; }
  const o = ownerOpt();
  try {
    const blob = await inst.exportVideo({ hideEnds: ui.hideEnds, workout: ui.workout, owner: o ? { name: o.name, username: o.username, avatar: o.avatar } : null, milestones: soc.earned().map(m => m.title).slice(0, 3), caption: ui.vcaption.trim(), cameraStyle: "flyover", aspect: ui.videoAspect, quality: ui.videoQuality, seconds: ui.videoSeconds,
      onPreview: canvas => {
        const exp = dlg?.querySelector(".sp-exp");
        if (!exp) return;
        canvas.className = "sp-video";
        canvas.setAttribute("aria-label", "Route video rendering preview");
        exp.querySelector(".sp-progress")?.before(canvas);
        canvas.scrollIntoView({ block: "center", behavior: "instant" });
      },
      onProgress: p => { ui.progress = p; const n = dlg?.querySelector(".sp-progress i"); if (n) n.style.width = Math.round(p * 100) + "%"; } });
    if (!blob) throw new Error("No video was produced.");
    if (ui.video?.url) URL.revokeObjectURL(ui.video.url);
    ui.video = { blob, kind: "video", url: URL.createObjectURL(blob) };
  } catch (e) { ui.err = e?.message || "Video export failed."; }
  ui.busy = ""; dlg?.classList.remove("exporting"); if (dlg && ui.screen === "replay") render(true);
}

async function shareGeneratedMedia() {
  const v = ui.video, w = ui.workout, cap = ui.vcaption.trim();
  if (!v) throw new Error("Create the flyover before sharing it.");
  const video = v.kind === "video";
  const name = `oldtime-${w.activityType}-flyover.${ext(v.blob)}`;
  if (opts.onShare) {
    const result = await opts.onShare({
      media: { type: video ? "video" : "photo", blob: v.blob, mime: v.blob.type, url: v.url },
      caption: cap,
      workout: w,
    });
    if (result === false) throw new Error("Could not open the post composer. Try again.");
    ui.video = null;
    closeUi();
    return;
  }
  if (navigator.canShare) return nativeShare(v.blob, name, cap);
  throw new Error("Sharing is not available here. Download the flyover to share it.");
}

async function createAndShareFlyover() {
  if (!exportSupported()) {
    setReplayError("Flyover video export isn’t supported in this browser. Use Animated card for a shareable route preview.");
    return;
  }
  if (ui.video?.kind !== "video") await doExport();
  if (ui.video?.kind === "video") await run("vshare", shareGeneratedMedia);
}

async function doMapImage() {
  const inst = maps.inst;
  if (!inst?.exportMapImage || maps.pending) {
    setReplayError(maps.pending ? "The route map is still preparing. Wait for it to finish before creating a map image." : "The map is not ready yet. Retry the map, then try again.");
    return;
  }
  setReplayError(""); ui.busy = "mapimg";
  const button = dlg?.querySelector('[data-act="mapimg"]');
  if (button) { button.disabled = true; button.textContent = "Rendering map image"; }
  try {
    const o = ownerOpt(), blob = await inst.exportMapImage({ owner: o ? { name: o.name, username: o.username, avatar: o.avatar } : null, caption: ui.vcaption.trim() });
    if (!blob) throw new Error("No map image was produced.");
    if (ui.mapImg?.url) URL.revokeObjectURL(ui.mapImg.url);
    ui.mapImg = { blob, url: URL.createObjectURL(blob) };
  } catch (e) { ui.err = e?.message || "Map export failed."; }
  ui.busy = ""; if (dlg && ui.screen === "replay") render(true);
}
function doSvg() {
  const o = ownerOpt(); ui.err = "";
  return animatedCard({ workout: ui.workout, owner: o ? { name: o.name, username: o.username } : null, caption: ui.vcaption.trim(), hideEnds: ui.hideEnds }).then(blob => {
    if (ui.video?.url) URL.revokeObjectURL(ui.video.url); ui.video = { blob, kind: "svg", url: URL.createObjectURL(blob) };
  }).catch(e => { ui.err = e?.message || "The animated card could not be created."; }).finally(() => { if (dlg && ui.screen === "replay") render(true); });
}
function confirmView() {
  const c = ui.confirm;
  return `<div class="sp-scrim"><div class="sp-confirm" role="alertdialog" aria-modal="true" aria-label="${esc(c.title)}"><b>${esc(c.title)}</b><p>${esc(c.text)}</p>
  <div class="sp-actions two"><button type="button" class="sp-sec" data-act="cancel" data-autofocus>Cancel</button><button type="button" class="${c.danger ? "sp-go danger" : "sp-go"}" data-act="confirm">${esc(c.ok)}</button></div></div></div>`;
}
const ask = (c, fn) => { ui.confirm = { ...c, fn }; render(true); focusFirst(); };
async function run(key, fn, { resetScrollOnTransition = false } = {}) {
  if (ui.busy) return;
  const startScreen = ui.screen;
  const keepLiveMap = ui.screen === "record";
  ui.busy = key; ui.err = "";
  if (keepLiveMap) {
    dlg?.querySelector(".sp-body")?.setAttribute("aria-busy", "true");
    dlg?.querySelectorAll(".sp-ctl button").forEach(button => { button.disabled = true; });
  } else render(true);
  try { await fn(); } catch (e) { ui.err = e?.message || "Something went wrong."; }
  ui.busy = "";
  if (dlg && keepLiveMap && ui.screen === "record") {
    dlg.querySelector(".sp-body")?.setAttribute("aria-busy", "false");
    dlg.querySelectorAll(".sp-ctl button").forEach(button => { button.disabled = false; });
    update();
  } else if (dlg) render(!resetScrollOnTransition || ui.screen === startScreen);
  if (dlg && ui.err) dlg.querySelector(".sp-err,.sp-banner")?.scrollIntoView?.({ block: "nearest" });
}

function onSubmit(e) { e.preventDefault(); if (e.target.id === "sp-cform") soc.submitCreate(); }
function onInput(e) {
  if (soc.onSocialInput(e)) return;
  if (e.target.id === "sp-seek") return maps.inst?.seek?.(e.target.value / 1000);
  if (e.target.id === "sp-vcap") ui.vcaption = e.target.value;
}
function onChange(e) {
  const t = e.target; if (soc.onSocialChange(e)) return;
  if (t.id === "sp-video-seconds") {
    if (ui.busy) { t.value = String(ui.videoSeconds); return; }
    ui.videoSeconds = Number(t.value); ui.videoSecondsAuto = false; dropExports(); paintReplay();
  }
  else if (t.id === "sp-owner") { ui.showOwner = t.checked; }
  else if (t.dataset?.layer) {
    const inst = maps.inst; if (ui.busy || !inst?.setLayers) { t.checked = !t.checked; return; }
    inst.setLayers({ ...(inst.getState().layers || {}), [t.dataset.layer]: t.checked }); dropExports();
    ui.mi = inst.getState(); paintReplay();
  }
  else if (t.id === "sp-hide") {
    if (ui.busy) { t.checked = ui.hideEnds; return; }
    ui.hideEnds = t.checked; ui.mapErr = "";
    if (ui.video?.url) URL.revokeObjectURL(ui.video.url); ui.video = null;
    if (ui.mapImg?.url) URL.revokeObjectURL(ui.mapImg.url); ui.mapImg = null;
    render(true);
  }
}
function onClick(e) {
  if (menu && !e.target.closest(".sp-menu,[data-act=menu]")) closeMenu();
  const el = e.target.closest("[data-act],[data-pick],[data-open],[data-nav],[data-view],[data-style],[data-speed],[data-video-camera],[data-aspect],[data-quality]"); if (!el || !dlg.contains(el) || el.disabled) return;
  const d = el.dataset;
  if (d.pick) { captureFlip(); ui.pick = d.pick; ui.err = ""; render(); dlg.querySelector(`[data-pick="${d.pick}"]`)?.focus(); return; }
  if (d.view) { if (ui.view === d.view) return; ui.view = d.view; ui.mapErr = ""; render(true); dlg.querySelector(`[data-view="${d.view}"]`)?.focus(); return; }
  if (d.speed) { maps.inst?.setSpeed?.(+d.speed); return; }
  if (d.videoCamera) { ui.videoCamera = "flyover"; ui.style = "vector"; paintReplay(); return; }
  if (d.aspect) { ui.videoAspect = d.aspect === "landscape" ? "landscape" : "portrait"; return paintReplay(); }
  if (d.quality) { ui.videoQuality = d.quality === "high" && !mobileVideoDevice() ? "high" : "standard"; return paintReplay(); }
  if (d.style) { ui.style = d.style; if (d.style === "terrain") ui.videoCamera = "map"; else if (d.style === "imagery") ui.videoCamera = "flyover"; dropExports(); Promise.resolve(maps.inst?.setStyle?.(d.style)).then(i => { if (i) { ui.mi = i; paintReplay(); } }); return; }
  if (d.open) return run("open", async () => {
    const w = await sports.detail(d.open);
    Object.assign(ui, {
      workout: w, zoom: { k: 1, x: 0, y: 0 }, view: "map", style: "vector",
      screen: "replay", replayBack: "history", videoCamera: "flyover",
      mapErr: "", mi: null, frame: null, video: null, mapImg: null,
      hideEnds: true, vcaption: ""
    });
    if (w.synced === true) soc.loadTags(d.open);
  }, { resetScrollOnTransition: true });
  if (d.nav) { closeMenu(); return d.nav === "close" ? closeUi() : tab(d.nav); }
  if (d.act?.startsWith("s:")) return soc.socialAct(d.act.slice(2), el);
  const svgEl = dlg.querySelector("#sp-svg");
  switch (d.act) {
    case "minimize": return closeUi();
    case "close-replay": return closeUi();
    case "back": return back();
    case "menu": return toggleMenu(el);
    case "start": if (!ui.pick) return; return run("start", async () => { ui.vectorMapErr = ""; await sports.start(ui.pick); ui.screen = "record"; ui.view = "map"; });
    case "toggle": return run("toggle", async () => { live()?.status === "paused" ? await sports.resume() : await sports.pause(); });
    case "finish": return run("finish", async () => {
      const w = await sports.finish();
      ui.workout = w;
      if (routeGeometry(w).segments.length) {
        Object.assign(ui, { screen: "replay", replayBack: "history", videoCamera: "flyover", style: "vector", mapErr: "", mi: null, frame: null, video: null, mapImg: null, hideEnds: true, vcaption: "", videoOptionsOpen: false });
        if (w.synced === true) soc.loadTags(w.id);
      } else {
        Object.assign(ui, { screen: "detail", view: "trace" });
      }
    }, { resetScrollOnTransition: true });
    case "discard": return ask({ title: "Discard recording?", text: "The recording and its GPS points will be permanently deleted.", ok: "Discard", danger: true }, () => run("discard", async () => { await sports.discard(); ui.screen = "select"; ui.pick = null; }));
    case "delete": return ask({ title: "Delete workout?", text: "This removes it from your private history.", ok: "Delete", danger: true }, () => run("delete", async () => { await sports.remove(ui.workout.id); ui.screen = "history"; ui.workout = null; }));
    case "sync": return run("sync", async () => { const id = ui.workout.id; await sports.sync(id); ui.workout = await sports.detail(id); await soc.loadTags(id, true); });
    case "replay": ui.replayBack = "history"; ui.mapErr = ""; ui.mi = null; ui.frame = null; ui.video = null; ui.videoCamera = "flyover"; ui.style = "vector"; ui.mapImg = null; ui.hideEnds = true; ui.vcaption = ""; ui.videoSecondsAuto = true; ui.videoSeconds = 30; ui.videoOptionsOpen = false; return go("replay");
    case "tag": return soc.openTag(ui.workout);
    case "maprety":
      if (ui.screen === "record") {
        ui.vectorMapErr = ""; liveMap.destroy();
        const host = dlg?.querySelector("#sp-map"), wait = host?.querySelector('[data-live="mapwait"]');
        if (wait) { wait.hidden = false; wait.setAttribute("aria-busy", "true"); }
        return syncLiveVectorMap(live(), snap());
      }
      ui.mapErr = ""; return render(true);
    case "mapretry": {
      const inst = maps.inst;
      if (maps.pending) return;
      if (!inst?.setStyle) { ui.mapErr = ""; return render(true); }
      return Promise.resolve(inst.setStyle("vector", { force: true })).then(info => {
        if (info) ui.mi = info;
        paintReplay();
      });
    }
    case "retrygps": return sports.retryGps();
    case "live-theme": {
      ui.mapTheme = ui.mapTheme === "dark" ? "light" : "dark";
      ensureLiveMapTools(dlg?.querySelector("#sp-map"));
      void liveMap.setTheme(ui.mapTheme);
      return;
    }
    case "rplay": return ui.mi?.playing ? maps.inst?.pause?.() : maps.inst?.replay?.();
    case "rrestart": return maps.inst?.restart?.();
    case "maplayers": {
      if (dlg.querySelector(".sp-layer-back")) return;
      const back = document.createElement("div"); back.className = "sp-layer-back";
      back.innerHTML = `<section class="sp-layer-panel" role="dialog" aria-modal="true" aria-label="Map layers"><header><b>Map layers</b><button type="button" class="sp-sec sm" data-act="layerclose" aria-label="Close map layers">Close</button></header>${layersMenu(ui.mi || {})}<p class="sp-layer-source">Road highlights show mapped streets, not crowd activity.</p></section>`;
      back.querySelector("details").open = true;
      back.onclick = e => { if (e.target === back) back.remove(); };
      dlg.append(back); back.querySelector("[data-act=layerclose]").focus(); return;
    }
    case "layerclose": dlg.querySelector(".sp-layer-back")?.remove(); return;
    case "fullroute": maps.inst?.setFollow?.(false); dropExports(); return;
    case "followroute": maps.inst?.setFollow?.(true); dropExports(); return;
    case "recenter": return ui.screen === "record" ? liveMap.recenter() : maps.inst?.resetView?.();
    case "rfit": return maps.inst?.fit?.();
    case "export": return doExport();
    case "exportsvg": return doSvg();
    case "mapimg": ui.videoOptionsOpen = true; return doMapImage();
    case "idl": return saveBlob(ui.mapImg.blob, `oldtime-${ui.workout.activityType}-map.jpg`);
    case "inative": return run("native", () => nativeShare(ui.mapImg.blob, "oldtime-map.jpg", ui.vcaption));
    case "ipublish": return ask({ title: "Share to public feed?", text: "Anyone can see this map and the route shown. Your workout history stays private.", ok: "Share" }, () => run("publish", async () => {
      const b = ui.mapImg.blob, tg = soc.tagFor(ui.workout.id);
      if (!opts.onPublish) throw new Error("Publishing is not available right now.");
      const r = await opts.onPublish({ workout: ui.workout, blob: b, mime: b.type || "image/jpeg", caption: ui.vcaption.trim(), media: { type: "image", blob: b, mime: b.type || "image/jpeg", url: ui.mapImg.url }, challengeId: tg?.challengeId || undefined, taggedUserIds: tg?.taggedUserIds || [] });
      if (r === false) throw new Error("Could not publish. Try again."); ui.mapImg = null; closeUi();
    }));
    case "vdl": return saveBlob(ui.video.blob, `oldtime-${ui.workout.activityType}-replay.${ext(ui.video.blob)}`);
    case "vnative": return run("native", () => nativeShare(ui.video.blob, `oldtime-replay.${ext(ui.video.blob)}`, ui.vcaption));
    case "quick-share": return createAndShareFlyover();
    case "vshare": return run("vshare", shareGeneratedMedia);
    case "vpublish": return ask({ title: "Post this flyover to Home?", text: "It will appear in the main feed and on your public profile. The video may show your route; your activity history remains private.", ok: "Post" }, () => run("publish", async () => {
      const b = ui.video.blob, tg = soc.tagFor(ui.workout.id);
      if (!opts.onPublish) throw new Error("Publishing is not available right now.");
      const r = await opts.onPublish({ workout: ui.workout, blob: b, mime: b.type, caption: ui.vcaption.trim(), media: { type: "video", blob: b, mime: b.type, url: ui.video.url }, challengeId: tg?.challengeId || undefined, taggedUserIds: tg?.taggedUserIds || [] });
      if (r === false) throw new Error("Could not publish. Try again."); ui.video = null; closeUi();
    }));
    case "zin": return svgEl?._zoom(ui.zoom.k * 1.5);
    case "zout": return svgEl?._zoom(ui.zoom.k / 1.5);
    case "zreset": return svgEl?._zoom(1);
    case "cancel": ui.confirm = null; return render(true);
    case "confirm": { const fn = ui.confirm.fn; ui.confirm = null; render(true); return fn(); }
    case "more-history": return run("more-history", () => sports.loadMore());
  }
}
function saveBlob(b, name) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function nativeShare(b, name, text) {
  const f = new File([b], name, { type: b.type });
  if (!navigator.canShare?.({ files: [f] })) throw new Error("Device sharing is not available for this file here.");
  try { await navigator.share({ files: [f], text: (text || "").trim() }); } catch (x) { if (x?.name !== "AbortError") throw x; }
}
function toggleMenu(btn) {
  if (menu) return closeMenu();
  const a = live(), items = [["record", a ? "Current recording" : "New activity"], ["history", "History"], ["achievements", "Achievements"], ["challenges", "Challenges"], ["close", a ? "Minimize, keep recording" : "Back to Oldtime"]];
  menu = document.createElement("div"); menu.className = "sp-menu"; menu.setAttribute("role", "menu");
  menu.innerHTML = items.map(([k, t]) => `<button type="button" role="menuitem" data-nav="${k}">${t}</button>`).join("");
  btn.parentElement.appendChild(menu); btn.setAttribute("aria-expanded", "true"); menu.querySelector("button")?.focus();
}
