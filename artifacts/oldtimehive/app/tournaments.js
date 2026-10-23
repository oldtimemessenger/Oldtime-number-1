import "./tournaments.css";
import * as A from "./tournaments-api.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nm = u => u?.displayName || u?.username || "Someone";
const isId = s => /^[0-9a-f-]{36}$/i.test(String(s || ""));
const HOST = { self: "Self-hosted", person: "Featuring a person", friend: "Friend challenge", team: "Team tournament", community: "Community" };
const STATUS = { awaiting_consent: "Awaiting consent", upcoming: "Upcoming", active: "Live", completed: "Completed", cancelled: "Cancelled" };
const TABS = [["overview", "Overview"], ["active", "Live"], ["upcoming", "Upcoming"], ["completed", "Completed"], ["community", "Community"], ["mine", "Mine"]];
let root, opener, S, timer, ticker, entranceTimer, inerted = [];

const av = u => `<span class="trn-av">${u?.avatarUrl ? `<img alt="" src="${esc(u.avatarUrl)}">` : esc(nm(u).slice(0, 1).toUpperCase())}</span>`;
const fmtFull = d => { try { return new Date(d).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
const fmt = d => { try { return new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
const dur = m => {
  const days = Math.floor(m / 1440), hours = Math.floor(m % 1440 / 60), minutes = m % 60;
  if (days && !hours && !minutes) return `${days} day${days === 1 ? "" : "s"}`;
  if (days) return `${days}d ${hours ? `${hours}h` : ""}${minutes ? ` ${minutes}m` : ""}`.trim();
  if (hours && !minutes) return `${hours} hour${hours === 1 ? "" : "s"}`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
};
const clock = ms => { if (ms <= 0) return "0m"; const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24); return d ? `${d}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : `${m}m`; };
const skew = () => S.skew || 0;
const now = () => Date.now() + skew();

export function closeTournaments() {
  if (!root) return;
  clearInterval(timer); clearInterval(ticker); clearTimeout(pt); clearTimeout(entranceTimer); timer = ticker = entranceTimer = null; inerted.forEach(el => { el.inert = false; }); inerted = []; S.dead = true; document.removeEventListener("visibilitychange", vis);
  root.remove(); root = null; document.body.classList.remove("trn-open");
  const o = opener; opener = null; S = null; o?.isConnected && o.focus?.();
}
export function openTournaments({ toast, initialId, onShare } = {}) {
  if (root) closeTournaments();
  opener = document.activeElement;
  let visited = false;
  try { visited = localStorage.getItem("oldtime-tournament-intro") === "seen"; localStorage.setItem("oldtime-tournament-intro", "seen"); } catch {}
  S = { toast: toast || (() => {}), view: "list", tab: "overview", loaded: { all: false, mine: false }, list: [], mine: [], more: { all: false, mine: false }, off: { all: 0, mine: 0 }, loading: true, err: "", t: null, id: null, busy: "", sheet: null, serr: "", seq: 0, createStep: 0, fastEntrance: visited, hasShownCards: false, standingsSeen: new Map(), victoryActive: false, victoryHandled: false };
  S.onShare = onShare;
  root = document.createElement("div"); root.className = "trn"; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Tournaments");
  root.innerHTML = `<div class="trn-entrance ${visited ? "fast" : ""}" role="status" aria-live="polite"><div class="trn-entrance-scene"><span class="trn-entrance-kicker">OLDTIME / MATCH READY</span><div class="trn-start-gates" aria-hidden="true"><span class="trn-lane trn-lane-a"><i><svg viewBox="0 0 40 44" focusable="false"><circle cx="27" cy="7" r="4" fill="currentColor"/><path d="m25 13-7 8 8 5m-8-5-8 1m12-7 8-5 6 4m-10 12-6 9m6-9 9 5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></i><b>01</b></span><span class="trn-start-mark"><i>3</i><i>2</i><i>1</i><b>GO</b></span><span class="trn-lane trn-lane-b"><i><svg viewBox="0 0 40 44" focusable="false"><circle cx="27" cy="7" r="4" fill="currentColor"/><path d="m25 13-7 8 8 5m-8-5-8 1m12-7 8-5 6 4m-10 12-6 9m6-9 9 5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></i><b>02</b></span></div><strong>THE ARENA<br>IS YOURS.</strong><span class="trn-entrance-rule"></span><span class="trn-entrance-caption">Your competition. Your community.</span></div><button class="trn-entrance-skip" data-a="intro-skip">Skip entrance</button></div><header class="trn-head"></header><main class="trn-body" id="trn-main" tabindex="-1"></main><div id="trn-sheet"></div>`;
  root.addEventListener("click", onClick); root.addEventListener("submit", onSubmit); root.addEventListener("input", onInput);
  root.addEventListener("keydown", e => {
    if (e.key === "Tab") { const box = root.querySelector(".trn-sheet") || (S.introActive ? root.querySelector(".trn-entrance") : root); const f = [...(box?.querySelectorAll("button,input,select,textarea,[href],[tabindex]:not([tabindex=\"-1\"])") || [])].filter(x => !x.disabled && !x.closest("[inert]") && x.offsetParent !== null); if (f.length) { const a = document.activeElement, i = f.indexOf(a); if (e.shiftKey && (i <= 0)) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); } } return; } if (e.key === "Escape") S.sheet ? closeSheet() : back(); });
  document.body.appendChild(root); document.body.classList.add("trn-open");
  document.addEventListener("visibilitychange", vis);
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  S.introActive = !reducedMotion;
  if (reducedMotion) root.querySelector(".trn-entrance")?.remove();
  else entranceTimer = setTimeout(dismissEntrance, visited ? 240 : 1680);
  timer = setInterval(poll, 12000); ticker = setInterval(tick, 1000);
  for (const el of [...document.body.children]) if (el !== root && !el.inert) { el.inert = true; inerted.push(el); }
  if (isId(initialId)) openDetail(initialId); else { head(); drawList(); load(true); }
  root.querySelector(reducedMotion ? ".trn-head .ib" : ".trn-entrance-skip")?.focus();
}
function dismissEntrance() {
  clearTimeout(entranceTimer); entranceTimer = null;
  const el = root?.querySelector(".trn-entrance");
  if (!el) return;
  if (S) S.introActive = false;
  el.classList.add("is-gone");
  setTimeout(() => el.remove(), 280);
  root?.querySelector(".trn-head .ib")?.focus();
}
const vis = () => { if (!document.hidden) poll(); };
function poll() { if (!root || document.hidden || S.busy || S.sheet) return; if (S.view === "list") load(true, true); else if (S.view === "detail") fetchDetail(true); }
const say = m => S.toast?.(m);
async function call(fn) { const st = S; const r = await fn(); if (S !== st || !root) throw new DOMException("closed", "AbortError"); return r; }
const aborted = e => e?.name === "AbortError";

function head() {
  const list = S.view === "list";
  root.querySelector(".trn-head").innerHTML = `<button class="ib" data-a="back" aria-label="${list ? "Close tournaments" : "Back"}">${list ? "&#10005;" : "&#8592;"}</button><h2>${S.view === "create" ? "New tournament" : "Tournaments"}</h2>${list ? `<button class="btn sm" data-a="new">Host one</button>` : ""}`;
}
const main = html => { const m = root.querySelector("#trn-main"), y = m.scrollTop; m.innerHTML = html; m.scrollTop = y; };
const errv = () => S.err ? `<div class="trn-err" role="alert"><span>${esc(S.err)}</span><button data-a="retry">Retry</button></div>` : "";

// ---------- list ----------
const SCOPES = { overview: ["all", "mine"], mine: ["mine"] };
async function pull(scope, reset, st) {
  const key = scope === "mine" ? "mine" : "list"; let rows = reset ? [] : S[key].slice(), off = reset ? 0 : S.off[scope], more = false, pages = 0;
  do {
    const r = await call(() => A.listTournaments(scope, off)); if (S !== st) return;
    if (r.serverNow) S.skew = new Date(r.serverNow) - Date.now();
    const got = r.tournaments || [], seen = new Set(rows.map(x => x.id)); rows = rows.concat(got.filter(x => !seen.has(x.id)));
    off += got.length; more = !!r.hasMore && got.length > 0; pages++;
  } while (reset && more && pages < 10);
  S[key] = rows; S.off[scope] = off; S.more[scope] = more; S.loaded[scope] = true;
}
async function load(reset, silent) {
  const st = S, n = ++S.seq, scopes = SCOPES[S.tab] || ["all"];
  if (!silent) { S.loading = true; S.err = ""; drawList(); }
  try { await Promise.all(scopes.map(sc => pull(sc, reset, st))); if (S === st && n === S.seq) S.err = ""; }
  catch (e) { if (aborted(e) || S !== st) return; if (!silent && n === S.seq) S.err = e.message; }
  if (S !== st || n !== S.seq) return; S.loading = false; if (S.view === "list") drawList();
}
const uniq = () => { const m = new Map(); for (const t of [...S.list, ...S.mine]) m.set(t.id, { ...m.get(t.id), ...t }); return [...m.values()]; };
const cdText = (st, s, e) => st === "active" ? "Ends in " + clock(new Date(e) - now()) : st === "upcoming" ? "Starts in " + clock(new Date(s) - now()) : st === "awaiting_consent" ? "Awaiting consent" : "";
function tick() { if (!root || document.hidden) return; root.querySelectorAll("[data-cd]").forEach(el => { el.textContent = cdText(el.dataset.st, el.dataset.s, el.dataset.e); }); }
function card(t, i, feat) {
  const lead = t.standings?.[0], pct = Math.min(100, lead?.percentage ?? 0), inv = t.myParticipation?.status === "invited";
  const action = inv ? "Review invitation" : t.canManage ? "Host view" : t.canJoin ? "Join competition" : "View arena";
  const category = String(t.category || "other").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return `<button class="trn-card trn-kind-${esc(t.hostingType)} trn-theme-${esc(t.coverTheme || "arena")} trn-category-${category} ${feat ? "feat" : ""}" data-open="${esc(t.id)}" style="animation-delay:${Math.min(i, 8) * 30}ms">
  <span class="trn-row"><span class="trn-tag ${esc(t.status)}">${esc(STATUS[t.status] || t.status)}</span><span class="trn-tag">${esc(HOST[t.hostingType] || t.hostingType)}</span>${t.visibility === "invite_only" ? `<span class="trn-tag">Invite only</span>` : ""}${inv ? `<span class="trn-tag active">Invitation</span>` : ""}</span>
  <b>${esc(t.title)}</b><span class="trn-meta">${esc(nm(t.host))} · ${t.participantCount} entered · goal ${esc(t.goal)} · <span data-cd data-st="${esc(t.status)}" data-s="${esc(t.startsAt)}" data-e="${esc(t.endsAt)}">${esc(cdText(t.status, t.startsAt, t.endsAt) || fmtFull(t.startsAt))}</span></span>
  <span class="trn-card-people">${(t.participants || []).filter(p => p.status === "accepted").slice(0, 4).map(p => av(p.user)).join("")}</span>
  ${lead ? `<span class="trn-meta">${esc(lead.score)} ${t.scoringMethod === "participant_entries" ? "entries" : "support points"} · ${Math.round(pct)}% of goal</span><span class="trn-bar" role="img" aria-label="Leader at ${Math.round(pct)} percent"><i style="width:${pct}%"></i></span>` : ""}
  <span class="trn-card-cta">${action}<span aria-hidden="true">↗</span></span></button>`;
}
function drawList() {
  root?.classList.remove("trn-game-mode");
  const all = uniq(), tab = S.tab, label = TABS.find(t => t[0] === tab)[1];
  const by = {
    active: all.filter(t => t.status === "active"),
    upcoming: all.filter(t => t.status === "upcoming" || t.status === "awaiting_consent"),
    completed: all.filter(t => t.status === "completed"),
    community: all.filter(t => t.hostingType === "community" && !["cancelled", "completed"].includes(t.status)),
    mine: S.mine
  };
  const invites = S.mine.filter(t => t.myParticipation?.status === "invited" && !["cancelled", "completed"].includes(t.status));
  const sec = (title, rows, carousel) => rows.length ? `<span class="trn-sec">${title}</span>${carousel ? `<div class="trn-rail">${rows.map((t, i) => card(t, i)).join("")}</div>` : rows.map((t, i) => card(t, i)).join("")}` : "";
  let body = "", total = 0;
  if (tab === "overview") {
    const live = by.active, feat = (live.length ? live : by.upcoming).slice().sort((a, b) => b.participantCount - a.participantCount)[0];
    total = all.length;
    body = (invites.length ? sec("Invitations for you", invites) : "") + (feat ? `<span class="trn-sec">Featured</span>${card(feat, 0, true)}` : "") + sec("Competing now", live, true) + sec("Upcoming", by.upcoming.filter(t => !invites.includes(t))) + sec("Community challenges", by.community) + sec("My tournaments", by.mine) + sec("Completed", by.completed);
  } else { const rows = by[tab]; total = rows.length; body = rows.map((t, i) => card(t, i)).join(""); }
  const scopes = SCOPES[tab] || ["all"], loaded = scopes.every(s => S.loaded[s]);
  const animateCards = !S.hasShownCards && all.length > 0;
  main(`<div class="trn-wrap ${animateCards ? "trn-list-entry" : ""}"><section class="trn-hero"><span class="eyebrow">Oldtime arena</span><h3>Make your<br>next move.</h3><p>Your people. Your competition. Challenge friends, build a team, and earn support—on your own time.</p><button class="btn" data-a="new">Create tournament</button></section>
  <div class="trn-tabs" role="group" aria-label="Tournament sections">${TABS.map(([k, l]) => `<button data-tab="${k}" aria-pressed="${tab === k}">${l}</button>`).join("")}</div>${errv()}
  ${body}${S.loading && !loaded ? `<div class="trn-skel"></div><div class="trn-skel"></div>` : ""}
  ${loaded && !total && !S.err ? `<div class="trn-empty"><svg viewBox="0 0 90 90" fill="none" stroke="#e5283f" stroke-width="2" aria-hidden="true"><path d="M25 15h40v22a20 20 0 0 1-40 0zM25 22H12c0 14 6 20 15 22M65 22h13c0 14-6 20-15 22M45 57v14M30 76h30"/></svg><b>The arena is quiet</b><p>${tab === "overview" ? "No tournaments are visible to you yet." : `Nothing under ${esc(label.toLowerCase())} right now.`} Host the first one.</p><button class="btn" data-a="new">Host a tournament</button></div>` : ""}
   ${scopes.some(s => S.more[s]) && !S.loading ? `<button class="btn sec" data-a="more">Load more</button>` : ""}</div>`);
  if (all.length) S.hasShownCards = true;
}

// ---------- detail ----------
function openDetail(id) { S.view = "detail"; S.id = id; S.t = null; S.err = ""; head(); drawDetail(); fetchDetail(); }
async function fetchDetail(silent) {
  const st = S, id = S.id;
  try { const t = await call(() => A.getTournament(id)); if (S !== st || S.id !== id) return; S.t = t; if (t.serverNow) S.skew = new Date(t.serverNow) - Date.now(); S.err = ""; }
  catch (e) { if (aborted(e) || S !== st) return; if (!silent || !S.t) S.err = e.message; }
  if (S.view === "detail") drawDetail();
}
function stand(r, t) {
  const me = t.myParticipation, meOk = me?.status === "accepted", parts = t.participants || [];
  const target = r.participantId ? parts.find(p => p.id === r.participantId && p.status === "accepted") : parts.find(p => p.teamId && p.teamId === r.teamId && p.status === "accepted");
  const own = meOk && (r.participantId ? (r.participantId === me.id || target?.userId === me.userId) : !!r.teamId && r.teamId === me.teamId);
  const sp = parts.find(p => p.id === t.mySupport?.participantId);
  const supported = !!sp && (r.participantId ? sp.id === r.participantId : !!r.teamId && sp.teamId === r.teamId);
  const pct = Math.min(100, r.percentage || 0);
  const can = t.canSupport && t.status === "active" && !t.mySupport && target && !own;
  const rowKey = `${t.id}:${r.teamId || r.participantId || r.name}`, previous = S.standingsSeen.get(rowKey);
  const changed = !!previous && (previous.score !== r.score || previous.rank !== r.rank);
  S.standingsSeen.set(rowKey, { score: r.score, rank: r.rank });
  return `<div class="trn-st ${changed ? "trn-score-changed" : ""}"><span class="rk">${r.rank}</span><span><b>${esc(r.name)}</b>${own ? ` <span class="trn-tag">${r.teamId ? "Your team" : "You"}</span>` : ""}${supported ? ` <span class="trn-tag active">Your support</span>` : ""}<br><span class="trn-meta">${r.members?.length ? r.members.map(m => esc(nm(m))).join(", ") + " / " : ""}${r.score} ${t.scoringMethod === "participant_entries" ? "entries" : "support"}${r.score === 1 ? "" : "s"}${own && t.status === "active" ? " / your own " + (r.teamId ? "team" : "entry") + " is not eligible for support" : ""}</span>${changed ? `<span class="trn-sr-only" aria-live="polite">Standing updated: ${esc(r.name)}, rank ${esc(r.rank)}, score ${esc(r.score)}.</span>` : ""}</span>
  ${can ? `<button class="btn sm" data-support="${esc(target.id)}" aria-label="Support ${esc(r.name)}" ${S.busy ? "disabled" : ""}>Support</button>` : "<span></span>"}<span class="bar trn-bar" role="img" aria-label="${Math.round(pct)} percent of goal"><i style="width:${pct}%"></i></span></div>`;
}
function isViewerWinner(t, results) {
  const me = t.myParticipation;
  if (t.status !== "completed" || !Array.isArray(t.finalResults) || me?.status !== "accepted" || !Array.isArray(results) || !me.userId) return false;
  return results.some(row => {
    if (Number(row.rank) !== 1) return false;
    if (me.teamId && row.teamId) return String(me.teamId) === String(row.teamId);
    if (row.participantId && me.id && String(row.participantId) === String(me.id)) return true;
    return (row.members || []).some(member => member.userId && String(member.userId) === String(me.userId));
  });
}
function victoryMoment(t, results) {
  const me = t.myParticipation;
  if (!isViewerWinner(t, results)) {
    if (S.victoryTournament !== t.id) { S.victoryTournament = t.id; S.victoryActive = false; S.victoryHandled = false; }
    return "";
  }
  const account = me.userId || me.id;
  if (!account) return "";
  const key = `oldtime-tournament-victory:${t.id}:${account}`;
  if (S.victoryTournament !== t.id) {
    S.victoryTournament = t.id;
    S.victoryHandled = false;
    S.victoryActive = false;
  }
  if (!S.victoryHandled) {
    let alreadySeen = false;
    try { alreadySeen = localStorage.getItem(key) === "seen"; } catch {}
    S.victoryHandled = true;
    if (!alreadySeen) {
      S.victoryActive = true;
      try { localStorage.setItem(key, "seen"); } catch {}
    }
  }
  if (!S.victoryActive) return "";
  const shared = results.filter(row => Number(row.rank) === 1).length > 1;
  return `<section class="trn-victory" aria-label="${shared ? "Shared victory" : "Victory lap"}" role="status" aria-live="polite"><div class="trn-victory-mark-wrap" aria-hidden="true"><svg viewBox="0 0 120 64" focusable="false"><ellipse class="trn-lap-track" cx="60" cy="32" rx="50" ry="20" pathLength="100"/><ellipse class="trn-lap-run" cx="60" cy="32" rx="50" ry="20" pathLength="100"/></svg><span>${shared ? "TIE" : "01"}</span></div><div class="trn-victory-copy"><span class="eyebrow">${shared ? "Shared victory" : "Victory lap"}</span><h4>${shared ? "You finished level at the top." : "You took first place."}</h4><p>${shared ? "The final standings confirm a tie for first." : "Your accepted entry is confirmed as the tournament winner."}</p></div><button type="button" class="trn-victory-dismiss" data-a="victory-dismiss" aria-label="Dismiss victory moment">Continue</button></section>`;
}
function faceOff(rows, t) {
  if (rows.length < 2 || !["active", "completed"].includes(t.status)) return "";
  const contenders = rows.slice(0, 2), exactDuel = rows.length === 2;
  S.progress ||= new Map();
  const progress = new Map();
  const personFor = row => {
    if (row.members?.length) return row.members[0];
    const p = (t.participants || []).find(x => x.id === row.participantId || x.teamId === row.teamId);
    return p?.user;
  };
  const competitor = (row, side) => {
    const key = `${t.id}:${row.teamId || row.participantId || row.name}`, value = Math.min(100, row.percentage || 0);
    const prior = S.progress.get(key), changed = prior != null && prior !== value;
    progress.set(key, value);
    return `<div class="trn-face-side ${side}">
    <div class="trn-face-avatar">${av(personFor(row))}</div>
    <span class="trn-face-rank">RANK ${esc(row.rank)}</span><b>${esc(row.name)}</b>
    ${row.members?.length > 1 ? `<span class="trn-face-members">${row.members.map(m => esc(nm(m))).join(" · ")}</span>` : ""}
    <strong class="trn-face-score">${esc(row.score)}</strong>
    <span class="trn-meta">${t.scoringMethod === "participant_entries" ? "entries" : "support points"}</span>
    <span class="trn-bar" role="img" aria-label="${Math.round(value)} percent of goal"><i data-progress="${value}" style="width:${changed ? prior : value}%"></i></span>
  </div>`;
  };
  const label = t.status === "active" ? exactDuel ? "LIVE FACE-OFF" : "LIVE LEADERS" : exactDuel ? "FINAL FACE-OFF" : "FINAL LEADERS";
  const html = `<section class="trn-faceoff ${t.status === "active" ? "is-live" : ""}" aria-label="${exactDuel ? "Two competitor face-off" : "Leading competitors"}">
    <div class="trn-face-heading"><span>${label}</span><span>${esc(cdText(t.status, t.startsAt, t.endsAt) || STATUS[t.status] || "")}</span></div>
    <div class="trn-face-grid">${competitor(contenders[0], "left")}<span class="trn-face-vs">${exactDuel ? "VS" : "LIVE"}</span>${competitor(contenders[1], "right")}</div>
    <div class="trn-face-goal"><span>GOAL <b>${esc(t.goal)}</b></span><span>DEADLINE <b>${esc(fmtFull(t.endsAt))}</b></span></div>
  </section>`;
  for (const [key, value] of progress) S.progress.set(key, value);
  return html;
}
function drawDetail() {
  const t = S.t; if (!t) return main(`<div class="trn-wrap">${errv() || '<div class="trn-skel"></div><div class="trn-skel"></div>'}</div>`);
  root.classList.toggle("trn-game-mode", t.status === "active");
  const openPanels = new Set([...root.querySelectorAll(".trn-more[open]")].map(panel => panel.dataset.panel).filter(Boolean));
  const activeElement = root.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = ["a", "support", "resend", "captain"].find(key => activeElement?.dataset?.[key]);
  const focusValue = focusKey ? activeElement.dataset[focusKey] : null;
  const focusPanel = activeElement?.closest(".trn-more")?.dataset.panel;
  const me = t.myParticipation, results = t.status === "completed" && t.finalResults ? t.finalResults : t.standings || [];
  const victory = victoryMoment(t, results);
  const left = cdText(t.status, t.startsAt, t.endsAt);
  const invited = me?.status === "invited", beforeStart = now() < new Date(t.startsAt).getTime();
  const canCancel = t.canManage && ["upcoming", "awaiting_consent"].includes(t.status) && beforeStart;
  const category = String(t.category || "other").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  main(`<div class="trn-wrap trn-detail trn-category-${category} ${t.status === "active" ? "trn-live" : ""}"><section class="trn-hero trn-theme-${esc(t.coverTheme || "arena")}">
    <span class="trn-row"><span class="trn-tag ${esc(t.status)}">${esc(STATUS[t.status] || t.status)}</span><span class="trn-tag">${esc(HOST[t.hostingType])}</span><span class="trn-tag">${esc(t.category)}</span><span class="trn-tag">${esc((t.visibility || "").replace("_"," "))}</span></span>
    <span class="eyebrow">Oldtime · competition ${esc(String(t.id).slice(0, 8))}</span><h3>${esc(t.title)}</h3><p>${esc(t.description || "")}</p>
    <p class="trn-hostline">${av(t.host)} <span>Hosted by <b>${esc(nm(t.host))}</b></span></p>
    ${t.status === "active" ? `<p class="trn-schedule"><b data-cd data-st="${esc(t.status)}" data-s="${esc(t.startsAt)}" data-e="${esc(t.endsAt)}">${esc(left)}</b> <span class="hint">remaining · server time</span></p>` : `<p class="trn-schedule">Starts ${esc(fmtFull(t.startsAt))}<br>Ends ${esc(fmtFull(t.endsAt))}<br><b data-cd data-st="${esc(t.status)}" data-s="${esc(t.startsAt)}" data-e="${esc(t.endsAt)}">${esc(left)}</b> <span class="hint">(server time)</span></p>`}
    <div class="trn-hero-stats"><span><b>${esc(t.participantCount)}</b><small>${t.maxParticipants ? `of ${esc(t.maxParticipants)} ` : ""}competitors</small></span><span><b>${esc(t.goal)}</b><small>${t.scoringMethod === "participant_entries" ? "entry goal" : "support goal"}</small></span></div>
  </section>
  ${errv()}
  ${victory}
  ${faceOff(results, t)}
  ${t.status === "awaiting_consent" ? `<div class="trn-box">This tournament remains private until the featured participant accepts. If they decline, it will not be published.</div>` : ""}
  ${invited ? `<div class="trn-box"><b>You are invited${me.role === "featured" ? " as the featured participant" : ""}.</b> Review the rules, schedule, and requirements before you decide. Accepting makes your participation visible.<div class="trn-actions"><button class="btn" data-a="join" ${S.busy ? "disabled" : ""}>Accept invitation</button><button class="btn sec" data-a="decline" ${S.busy ? "disabled" : ""}>Decline</button>${me.role === "featured" ? `<button class="btn sec" data-a="request-changes">Request changes</button>` : ""}</div></div>` : ""}
  ${me?.status === "change_requested" && me.role === "featured" ? `<div class="trn-box"><b>Your change request was sent.</b> ${esc(me.responseMessage || "")} The host can revise the details and send a new invitation.</div>` : ""}
  <div class="trn-actions">${t.canJoin && !invited ? `<button class="btn" data-a="join" ${S.busy ? "disabled" : ""}>${t.format === "team" ? "Choose team and join" : "Join"}</button>` : ""}<button class="btn sec" data-a="share">Share</button>${t.canInvite && !["completed", "cancelled"].includes(t.status) ? `<button class="btn sec" data-a="invite">Invite person</button>` : ""}${t.canManage && beforeStart && !["completed", "cancelled"].includes(t.status) ? `<button class="btn sec" data-a="edit-settings">Edit settings</button>` : ""}${me?.status === "accepted" && beforeStart && !t.canManage ? `<button class="btn sec" data-a="withdraw">Withdraw</button>` : ""}${canCancel ? `<button class="btn sec" data-a="cancel">Cancel tournament</button>` : ""}</div>
   ${t.mySupport ? `<p class="trn-meta">You have used your one support in this tournament.</p>` : ""}
   <span id="trn-results-heading" class="trn-sec" tabindex="-1">${t.status === "completed" ? "Final results" : "Standings"}</span>
  <div class="trn-stand">${results.length ? results.map(r => stand(r, t)).join("") : `<div class="trn-box">No accepted competitors yet.</div>`}</div>
   <details class="trn-more" data-panel="people"><summary>Participants &amp; teams <span>${t.participants?.length || 0}</span></summary>
   ${t.format === "team" && t.teams?.length ? `<span class="trn-sec">Teams</span><div class="trn-stand">${t.teams.map(team => {
    const roster = (t.participants || []).filter(p => p.teamId === team.id && p.status === "accepted");
    return `<div class="trn-box"><b>${esc(team.name)}</b><span class="trn-meta">Captain: ${esc(team.captain?.displayName || "Not assigned")}</span>
      ${t.canManage && beforeStart && roster.length ? `<label>Assign captain<select data-captain-select="${esc(team.id)}">${roster.map(p => `<option value="${esc(p.userId)}" ${p.userId === team.captainId ? "selected" : ""}>${esc(nm(p.user))}</option>`).join("")}</select></label><button class="btn sm" data-captain="${esc(team.id)}">Save captain</button>` : ""}</div>`;
  }).join("")}</div>` : ""}
   <div class="trn-stand">${(t.participants || []).map(p => `<div class="trn-st" style="grid-template-columns:34px 1fr auto"><span>${av(p.user)}</span><span>${esc(nm(p.user))}${p.role === "featured" ? ` <span class="trn-tag">Featured</span>` : ""}${p.role === "captain" ? ` <span class="trn-tag">Captain</span>` : ""}${p.responseMessage ? `<span class="trn-meta">Request: ${esc(p.responseMessage)}</span>` : ""}</span><span class="trn-tag">${esc(p.status)}</span>${t.canManage && p.status === "change_requested" ? `<button class="btn sm" data-resend="${esc(p.id)}">Revise &amp; resend</button>` : ""}</div>`).join("") || `<div class="trn-box">No participants yet.</div>`}</div></details>
   <details class="trn-more" data-panel="rules"><summary>Rules &amp; scoring</summary><div class="trn-box">${esc(t.rules || "No additional rules.")}\n${t.scoringMethod === "participant_entries" ? "Each accepted participant or team receives one entry point." : `Account-verified community support, up to one support per account. ${t.supportEnabled ? "Eligible signed-in users can support once." : "Support is disabled."}`} Scores and rules lock when the competition starts. Results are finalized at the scheduled end time.</div></details>
   <details class="trn-more" data-panel="activity"><summary>Tournament activity <span>${t.recentActivity?.length || 0}</span></summary><div class="trn-stand">${(t.recentActivity || []).map(a => `<div class="trn-box" style="padding:9px 12px">${a.actor ? esc(nm(a.actor)) : "Tournament"} / ${esc(String(a.action).replace(/_/g, " "))}<span class="trn-meta">${esc(fmt(a.createdAt))}</span></div>`).join("") || `<div class="trn-box">No activity recorded yet.</div>`}</div></details></div>`);
  for (const panel of openPanels) { const disclosure = root.querySelector(`.trn-more[data-panel="${panel}"]`); if (disclosure) disclosure.open = true; }
  if (focusKey) {
    const next = [...root.querySelectorAll(`[data-${focusKey}]`)].find(el => el.dataset[focusKey] === focusValue);
    if (next && !next.disabled) next.focus({ preventScroll: true });
    else root.querySelector("#trn-main")?.focus({ preventScroll: true });
  } else if (focusPanel) root.querySelector(`.trn-more[data-panel="${focusPanel}"] > summary`)?.focus({ preventScroll: true });
  requestAnimationFrame(() => root?.querySelectorAll(".trn-faceoff [data-progress]").forEach(el => { el.style.width = `${el.dataset.progress}%`; }));
}
async function doAct(key, fn, okMsg) {
  if (S.busy) return; const st = S; S.busy = key; S.err = ""; drawDetail();
  try { await call(fn); if (okMsg) say(okMsg); S.busy = ""; await fetchDetail(true); }
  catch (e) { if (aborted(e) || S !== st) return; S.busy = ""; S.err = e.message; drawDetail(); }
}

// ---------- sheets ----------
function setSheet(html) { const wasOpen = !!S.sheet; if (html && !wasOpen) S.sheetFrom = document.activeElement; S.sheet = html ? { open: 1 } : null; root.querySelectorAll(".trn-head,.trn-body").forEach(el => { el.inert = !!html; }); root.querySelector("#trn-sheet").innerHTML = html ? `<div class="trn-scrim" data-a="x"><div class="trn-sheet" role="dialog" aria-modal="true">${html}</div></div>` : ""; if (html) root.querySelector(".trn-sheet input,.trn-sheet select,.trn-sheet button")?.focus(); else if (wasOpen) { const f = S.sheetFrom; (f?.isConnected && f.focus ? f : root.querySelector("#trn-main")).focus(); } }
const closeSheet = () => { S.sheet = null; setSheet(""); };
function teamSheet() {
  const t = S.t;
  setSheet(`<b>Join ${esc(t.title)}</b>${t.format === "team" ? `<label>Team<select id="trn-team">${t.teams.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}</select></label>` : ""}<p class="trn-meta" id="trn-serr" role="alert"></p><button class="btn" data-a="joingo">Join tournament</button><button class="btn sec" data-a="x">Cancel</button>`);
}
function inviteSheet() {
  const t = S.t;
  S.pick = null;
  setSheet(`<b>Invite a registered person</b><form data-f="people"><label for="trn-q">Search by name or username<input id="trn-q" name="q" minlength="2" required></label><button class="btn sm">Search</button></form>${t.format === "team" ? `<label>Team<select id="trn-team">${t.teams.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}</select></label>` : ""}<div id="trn-res"></div><p class="trn-meta" id="trn-serr" role="alert"></p><button class="btn" data-a="sendinv" disabled>Send invitation</button><button class="btn sec" data-a="x">Close</button>`);
}
function requestChangesSheet() {
  setSheet(`<b>Request a change</b><p class="hint">Tell the organizer what needs to change. Your invitation stays private until you accept a revised version.</p>
    <form data-f="request-changes"><label>What would you like changed?<textarea name="message" minlength="5" maxlength="500" required></textarea></label>
    <p class="trn-meta" id="trn-serr" role="alert"></p><button class="btn">Send request</button><button class="btn sec" type="button" data-a="x">Cancel</button></form>`);
}
function editSettingsSheet() {
  const t = S.t, start = new Date(t.startsAt);
  const localStart = new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const duration = Math.round((new Date(t.endsAt) - start) / 60000);
  setSheet(`<b>Edit tournament settings</b><p class="hint">Changes are available until the scheduled start. Scoring and goal are then locked.</p>
    <form data-f="settings"><label>Name<input name="title" maxlength="100" value="${esc(t.title)}" required></label>
    <label>Description<textarea name="description" maxlength="2000" required>${esc(t.description)}</textarea></label>
    <label>Rules<textarea name="rules" maxlength="3000" required>${esc(t.rules)}</textarea></label>
    <label>Category<select name="category">${["sports","fitness","community","gaming","creative","learning","other"].map(v=>`<option value="${v}" ${v===t.category?"selected":""}>${v}</option>`).join("")}</select></label>
    <label>Cover style<select name="coverTheme">${["arena","ember","circuit","grid","spotlight"].map(v=>`<option value="${v}" ${v===t.coverTheme?"selected":""}>${v}</option>`).join("")}</select></label>
    <label>Visibility<select name="visibility">${["public","private","invite_only"].map(v=>`<option value="${v}" ${v===t.visibility?"selected":""}>${v.replace("_"," ")}</option>`).join("")}</select></label>
    <label>Open to participants<select name="openToParticipants"><option value="true" ${t.openToParticipants?"selected":""}>Yes</option><option value="false" ${!t.openToParticipants?"selected":""}>Invitation required</option></select></label>
    <label>Maximum participants<input name="maxParticipants" type="number" min="2" max="500" value="${t.maxParticipants ?? ""}" placeholder="No limit"></label>
    <label>Start time<input name="startsAt" type="datetime-local" value="${esc(localStart)}" required></label>
    <label>Duration in minutes<input name="durationMinutes" type="number" min="15" max="43200" value="${duration}" required></label>
    <label>Goal (points)<input name="goal" type="number" min="1" max="100000" value="${t.goal}" required></label>
    <label>Scoring<select name="scoringMethod">${["community_support","participant_entries"].map(v=>`<option value="${v}" ${v===t.scoringMethod?"selected":""}>${v==="community_support"?"Community support":"Participant entries"}</option>`).join("")}</select></label>
    <label><span><input name="supportEnabled" type="checkbox" value="true" ${t.supportEnabled?"checked":""} style="width:auto;min-height:auto;margin-right:8px">Allow community support</span></label>
    <p class="trn-meta" id="trn-serr" role="alert"></p><button class="btn">Save changes</button><button class="btn sec" type="button" data-a="x">Cancel</button></form>`);
}
function serr(m) { const e = root.querySelector("#trn-serr"); if (e) e.textContent = m || ""; }
async function share() {
  setSheet(`<b>Share tournament</b><p class="hint">People open the original tournament. Private invitations are still required.</p>${S.onShare ? `<button class="btn" data-a="share-feed">Post to your feed</button><button class="btn sec" data-a="share-story">Share to your story</button><button class="btn sec" data-a="share-messages">Send in Messages</button>` : ""}<button class="btn sec" data-a="share-external">Share link</button><button class="btn sec" data-a="x">Close</button>`);
}
async function externalShare() {
  const url = `${location.origin}${location.pathname}?tournament=${encodeURIComponent(S.id)}`;
  try { if (navigator.share) { await navigator.share({ title: S.t.title, url }); return; } } catch (e) { if (e?.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(url); say("Link copied"); } catch { setSheet(`<b>Copy this link</b><input readonly value="${esc(url)}" aria-label="Tournament link"><button class="btn sec" data-a="x">Close</button>`); root.querySelector(".trn-sheet input")?.select(); }
}

// ---------- create ----------
function createView() {
  S.view = "create"; head();
  main(`<div class="trn-wrap trn-wizard">
    <section class="trn-wizard-banner"><span class="eyebrow">Oldtime / Host a match</span><h3>Set the terms.<br>Meet at the line.</h3><p>A clear setup. A fair start. Your invitees decide for themselves.</p></section>
    <form data-f="create" novalidate class="trn-create-form">
      <section class="trn-create-stage">
        <span class="trn-sec">The essentials</span>
        <label>Tournament name<input name="title" maxlength="100" required placeholder="Give the match a name"></label>
        <label>What are you competing to do?<textarea name="description" rows="2" maxlength="2000" required placeholder="A short description"></textarea></label>
        <div class="trn-form-pair"><label>Format<select name="hostingType"><option value="self">Self-hosted</option><option value="person">Feature a person (with consent)</option><option value="friend">Friend challenge (with consent)</option><option value="team">Team tournament</option><option value="community">Community tournament</option></select></label><label>Category<select name="category"><option value="sports">Sports</option><option value="fitness">Fitness</option><option value="community" selected>Community</option><option value="gaming">Gaming</option><option value="creative">Creative</option><option value="learning">Learning</option><option value="other">Other</option></select></label></div>
        <div id="trn-extra"></div>
        <div class="trn-form-pair"><label>Goal (points)<input type="number" name="goal" min="1" max="100000" value="25" required></label><label>Duration in minutes<input type="number" name="durationMinutes" min="15" max="43200" value="1440" required></label></div>
        <label>Start time<input type="datetime-local" name="startsAt"><span class="hint">Optional. Leave blank to start now.</span></label>
        <details class="trn-more trn-advanced"><summary>Advanced settings <span>Scoring, access, rules &amp; arena</span></summary><div class="trn-advanced-fields">
          <label>Arena style<select name="coverTheme"><option value="arena">Grand arena</option><option value="ember">Ember court</option><option value="circuit">Circuit hall</option><option value="grid">Grid floor</option><option value="spotlight">Spotlight stage</option></select></label>
          <label>Scoring method<select name="scoringMethod"><option value="community_support">Account-verified community support</option><option value="participant_entries">One point per accepted entry</option></select><span class="hint">Scoring locks when the competition starts.</span></label>
          <label class="trn-check"><span><input type="checkbox" name="supportEnabled" value="true" checked>Allow eligible community members to support competitors</span></label>
          <label>Visibility<select name="visibility"><option value="public">Public</option><option value="private">Private to invited participants</option><option value="invite_only">Invitation only</option></select><span class="hint">Private competitions are visible only to the host and invited participants.</span></label>
          <label>Who can join?<select name="openToParticipants"><option value="true">Open to eligible participants</option><option value="false">Invitation required</option></select></label>
          <label>Maximum participants<input type="number" name="maxParticipants" min="2" max="500" placeholder="No limit"><span class="hint">Optional</span></label>
          <label>Competition rules<textarea name="rules" rows="3" maxlength="3000">The competition ends at the scheduled deadline. Scores are calculated automatically using the selected scoring method.</textarea></label>
        </div></details>
        <section class="trn-create-summary"><span class="trn-sec">Match summary</span><b id="trn-summary-title">Your tournament</b><span id="trn-summary-line">Community · 25 points · 1 day · Community support</span><p id="trn-consent-note">No one is added without consent. Invitees review the rules and schedule before deciding.</p></section>
      </section>
      <div class="trn-err" id="trn-cerr" role="alert" hidden></div>
      <div class="trn-wizard-actions"><button class="btn" type="submit" id="trn-go">Create tournament</button><button class="btn sec" type="button" data-a="back">Cancel setup</button></div>
    </form>
  </div>`);
  const saved = S.draft;
  if (saved) {
    const form = root.querySelector('[data-f="create"]');
    for (const [key, value] of Object.entries(saved)) {
      const field = form.elements.namedItem(key);
      if (!field) continue;
      if (field.type === "checkbox") field.checked = !!value;
      else if (key === "startsAt") { const d = value ? new Date(value) : null; field.value = d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""; }
      else if (key === "teamNames") field.value = Array.isArray(value) ? value.join("\n") : "";
      else field.value = value ?? "";
    }
    if (saved.teamNames && form.elements.namedItem("teams")) form.elements.namedItem("teams").value = saved.teamNames.join("\n");
    S.pickF = saved.featuredUserId || null;
    S.pickFName = saved.featuredUserName || "";
  } else {
    S.pickF = null; S.pickFName = "";
  }
  const hosting = saved?.hostingType || "self";
  formValue("hostingType", hosting);
  extra(hosting);
  if (saved?.advancedOpen) root.querySelector(".trn-advanced").open = true;
  if (S.pickF) { const chosen = root.querySelector("#trn-pchosen"); if (chosen) chosen.textContent = `Selected: ${S.pickFName || "participant"}`; }
  syncCreateControls(); updateCreateSummary();
}
function extra(type) {
  const el = root.querySelector("#trn-extra"); if (!el) return;
  const vs = root.querySelector("[name=visibility]");
  if (vs && type === "friend") vs.value = "invite_only";
  el.innerHTML = type === "person" || type === "friend" ? `<label>${type === "person" ? "Person to feature" : "Friend to challenge"}<input id="trn-pq" placeholder="Search by name or username" autocomplete="off"></label><div id="trn-pres"></div><p class="hint" id="trn-pchosen">Choose a person to invite. They must accept before publication.</p>`
    : type === "team" ? `<label>Team names (2–8)<textarea name="teams" rows="2" placeholder="Team North&#10;Team South"></textarea></label>` : "";
  syncCreateControls();
}
function updateCreateSummary() {
  const f = root?.querySelector('[data-f="create"]'); if (!f) return;
  const title = f.elements.namedItem("title").value.trim() || "Your tournament";
  const goal = f.elements.namedItem("goal").value || "25", minutes = Number(f.elements.namedItem("durationMinutes").value) || 1440;
  const method = f.elements.namedItem("scoringMethod").value === "participant_entries" ? "entry points" : "community support";
  const category = f.elements.namedItem("category").selectedOptions?.[0]?.textContent?.trim() || "Community";
  root.querySelector("#trn-summary-title").textContent = title;
  root.querySelector("#trn-summary-line").textContent = `${category} · ${goal} points · ${dur(minutes)} · ${method}`;
  const type = f.elements.namedItem("hostingType").value;
  root.querySelector("#trn-consent-note").textContent = ["person","friend"].includes(type) ? "The invited person receives a private invitation and must accept before the tournament is published." : "No one is added without consent. You can invite people after creation.";
  const button = root.querySelector("#trn-go");
  if (button && !S.busy) button.textContent = ["person","friend"].includes(type) ? "Create & send invitation" : "Create tournament";
}
function formValue(name, value) { const field = root?.querySelector(`[name="${name}"]`); if (field) field.value = value; }
function syncCreateControls() {
  const form = root?.querySelector('[data-f="create"]'); if (!form) return;
  const hosting = form.elements.namedItem("hostingType").value;
  const vis = form.elements.namedItem("visibility");
  if (hosting === "friend") vis.value = "invite_only";
  vis.disabled = hosting === "friend";
  const open = form.elements.namedItem("openToParticipants");
  open.disabled = vis.value !== "public" || hosting === "friend";
  if (open.disabled) open.value = "false";
  const support = form.elements.namedItem("supportEnabled");
  support.disabled = form.elements.namedItem("scoringMethod").value !== "community_support";
  if (support.disabled) support.checked = false;
}
let pt;
function onInput(e) {
  if (e.target.closest('[data-f="create"]')) updateCreateSummary();
  if (e.target.id !== "trn-pq") return;
  clearTimeout(pt); const q = e.target.value.trim(), st = S;
  if (q.length < 2) return void (root.querySelector("#trn-pres").innerHTML = "");
  pt = setTimeout(async () => {
    try { const r = await call(() => A.searchPeople(q)); if (S !== st) return; const el = root.querySelector("#trn-pres"); if (el) el.innerHTML = (r.users || []).map(u => `<button type="button" class="trn-person" data-pf="${esc(u.id)}" data-pn="${esc(nm(u))}" aria-pressed="${S.pickF === u.id}">${av(u)}<span>${esc(nm(u))} <span class="trn-meta">@${esc(u.username)}</span></span></button>`).join("") || `<p class="hint">No people found.</p>`; }
    catch (x) { if (!aborted(x)) { const el = root.querySelector("#trn-pres"); if (el) el.innerHTML = `<p class="hint" role="alert">${esc(x.message)}</p>`; } }
  }, 300);
}
async function onSubmit(e) {
  e.preventDefault(); const f = e.target, st = S;
  if (f.dataset.f === "people") {
    const q = f.q.value.trim(), res = root.querySelector("#trn-res"); res.innerHTML = `<div class="trn-skel" style="height:44px"></div>`;
    try { const r = await call(() => A.searchPeople(q)); S.users = r.users || []; res.innerHTML = S.users.map(u => `<button type="button" class="trn-person" data-pi="${esc(u.id)}" aria-pressed="false">${av(u)}<span>${esc(nm(u))} <span class="trn-meta">@${esc(u.username)}</span></span></button>`).join("") || `<p class="hint">No people found.</p>`; } catch (x) { if (!aborted(x)) res.innerHTML = ""; if (!aborted(x)) serr(x.message); }
    return;
  }
  if (f.dataset.f === "request-changes") {
    const message = new FormData(f).get("message")?.toString().trim() || "";
    const st = S; serr("");
    try { await call(() => A.requestTournamentChanges(S.id, message)); closeSheet(); say("Change request sent"); await fetchDetail(true); }
    catch (x) { if (!aborted(x) && S === st) serr(x.message); }
    return;
  }
  if (f.dataset.f === "settings") {
    const data = Object.fromEntries(new FormData(f));
    const start = new Date(data.startsAt), duration = Number(data.durationMinutes);
    if (!Number.isFinite(start.getTime()) || start.getTime() < Date.now() - 60000) return serr("Choose a future start time.");
    if (!(duration >= 15 && duration <= 43200)) return serr("Duration must be between 15 minutes and 30 days.");
    const payload = {
      title: data.title.trim(), description: data.description.trim(), rules: data.rules.trim(), category: data.category,
      coverTheme: data.coverTheme, visibility: data.visibility,
      openToParticipants: data.visibility === "public" && data.openToParticipants === "true",
      maxParticipants: data.maxParticipants ? Number(data.maxParticipants) : null,
      startsAt: start.toISOString(), durationMinutes: duration, goal: Number(data.goal),
      scoringMethod: data.scoringMethod, supportEnabled: data.scoringMethod === "community_support" && f.elements.namedItem("supportEnabled").checked,
    };
    const st = S; serr("");
    try { const updated = await call(() => A.updateTournament(S.id, payload)); S.t = updated; closeSheet(); say("Tournament settings updated"); drawDetail(); }
    catch (x) { if (!aborted(x) && S === st) serr(x.message); }
    return;
  }
  if (f.dataset.f !== "create" || S.busy) return;
  const v = Object.fromEntries(new FormData(f)), box = root.querySelector("#trn-cerr"), bad = m => { box.hidden = false; box.textContent = m; };
  const start = v.startsAt ? new Date(v.startsAt) : new Date();
  if (!Number.isFinite(start.getTime()) || start.getTime() < Date.now() - 60000) return bad("Choose a future start time, or leave it blank to start now.");
  const body = {
    title: (v.title || "").trim(), description: (v.description || "").trim(), rules: (v.rules || "").trim(),
    hostingType: v.hostingType, visibility: v.hostingType === "friend" ? "invite_only" : f.elements.namedItem("visibility").value,
    category: v.category, coverTheme: v.coverTheme, scoringMethod: v.scoringMethod,
    supportEnabled: f.elements.namedItem("supportEnabled").checked,
    openToParticipants: f.elements.namedItem("openToParticipants").value === "true",
    maxParticipants: v.maxParticipants ? Number(v.maxParticipants) : null,
    durationMinutes: Number(v.durationMinutes), startsAt: start.toISOString(), goal: Math.floor(+v.goal),
  };
  if (body.title.length < 3) return bad("Add a title with at least 3 characters."); if (body.description.length < 5) return bad("Add a description with at least 5 characters.");
  if (body.rules.length < 5) return bad("Add the competition rules.");
  if (!(body.goal >= 1 && body.goal <= 100000)) return bad("Goal must be between 1 and 100000.");
  if (!(body.durationMinutes >= 15 && body.durationMinutes <= 43200)) return bad("Duration must be between 15 minutes and 30 days.");
  if (body.maxParticipants != null && !(body.maxParticipants >= 2 && body.maxParticipants <= 500)) return bad("Participant cap must be between 2 and 500.");
  if (["person","friend"].includes(body.hostingType)) {
    if (!S.pickF) return bad("Choose the person to invite.");
    body.featuredUserId = S.pickF; body.featuredUserName = S.pickFName || "";
  }
  if (body.hostingType === "team") { const n = (v.teams || "").split("\n").map(x => x.trim()).filter(Boolean); if (n.length < 2 || n.length > 8) return bad("Enter 2 to 8 team names."); body.teamNames = n; }
  S.draft = body; publishDraft();
}
async function publishDraft() {
  if (S.busy || !S.draft) return;
  const st = S, body = { ...S.draft }; delete body.featuredUserName;
  S.busy = "create"; S.err = "";
  const button = root.querySelector("#trn-go");
  if (button) { button.disabled = true; button.textContent = "Creating…"; }
  const cancel = root.querySelector('.trn-wizard-actions [data-a="back"]');
  if (cancel) cancel.disabled = true;
  try {
    const t = await call(() => A.createTournament(body));
    S.busy = ""; S.draft = null; say(["person","friend"].includes(body.hostingType) ? "Invitation sent" : "Tournament created");
    S.list = []; openDetail(t.id); S.t = t; drawDetail();
  }
  catch (x) {
    if (aborted(x) || S !== st) return; S.busy = "";
    const error = root.querySelector("#trn-cerr"); if (error) { error.hidden = false; error.textContent = x.message; }
    const retry = root.querySelector("#trn-go"); if (retry) { retry.disabled = false; retry.textContent = "Try again"; }
    if (cancel) cancel.disabled = false;
  }
}

// ---------- events ----------
function back() {
  if (!root) return;
  if (S.busy === "create") return;
  if (S.view === "list") return closeTournaments();
  if (S.view === "create") { S.draft = null; S.createStep = 0; S.pickF = null; S.pickFName = ""; }
  S.view = "list"; S.t = null; S.err = ""; head(); drawList(); load(true);
}
async function onClick(e) {
  const t = e.target.closest("[data-a],[data-tab],[data-open],[data-support],[data-pf],[data-pi],[data-resend],[data-captain]"); if (!t) return; const d = t.dataset;
  if (d.a === "x" && e.target.closest(".trn-sheet") && !t.matches("button")) return;
  if (d.tab) { S.tab = d.tab; S.err = ""; drawList(); return load(true, !S.loading && (S.tab === "mine" ? S.mine : S.list).length > 0); }
  if (d.open) return openDetail(d.open);
  if (d.pf) { S.pickF = d.pf; S.pickFName = d.pn || ""; root.querySelectorAll("[data-pf]").forEach(b => b.setAttribute("aria-pressed", b.dataset.pf === d.pf)); root.querySelector("#trn-pchosen").textContent = "Selected: " + d.pn; return; }
  if (d.pi) { S.pick = d.pi; root.querySelectorAll("[data-pi]").forEach(b => b.setAttribute("aria-pressed", b.dataset.pi === d.pi)); root.querySelector('[data-a="sendinv"]').disabled = false; return; }
  if (d.support) return doAct("support", () => A.supportParticipant(S.id, d.support), "Support counted");
  if (d.resend) return doAct("resend", () => A.resendTournamentInvitation(S.id, d.resend), "Updated invitation sent");
  if (d.captain) {
    const select = root.querySelector(`[data-captain-select="${CSS.escape(d.captain)}"]`);
    if (!select?.value) return;
    return doAct("captain", () => A.assignTournamentCaptain(S.id, d.captain, select.value), "Team captain updated");
  }
  switch (d.a) {
    case "back": return back();
    case "intro-skip": return dismissEntrance();
    case "victory-dismiss": { S.victoryActive = false; S.victoryHandled = true; drawDetail(); root.querySelector("#trn-results-heading")?.focus({ preventScroll: true }); return; }
    case "x": return closeSheet();
    case "new": S.draft = null; S.createStep = 0; S.pickF = null; S.pickFName = ""; return createView();
    case "edit-settings": return editSettingsSheet();
    case "request-changes": return requestChangesSheet();
    case "retry": S.err = ""; return S.view === "detail" ? (drawDetail(), fetchDetail()) : load(true);
    case "more": return load(false);
    case "share": return share();
    case "share-external": return externalShare();
    case "share-feed":
    case "share-story":
    case "share-messages": {
      if (!S.onShare || S.busy) return;
      const state = S; S.busy = "share";
      try { await S.onShare({ destination: d.a.slice(6), href: `${location.origin}${location.pathname}?tournament=${encodeURIComponent(S.id)}` }); }
      catch (error) { if (S === state) { S.busy = ""; closeSheet(); S.err = error.message || "Sharing is unavailable. Please try again."; drawDetail(); } }
      return;
    }
    case "join": return S.t.format === "team" && S.t.canJoin && S.t.teams?.length ? teamSheet() : doAct("join", () => A.joinTournament(S.id), "Joined");
    case "joingo": { const team = root.querySelector("#trn-team")?.value, id = S.id; closeSheet(); return doAct("join", () => A.joinTournament(id, team), "Joined"); }
    case "decline": return doAct("decline", () => A.declineTournament(S.id), "Invitation declined");
    case "withdraw": setSheet(`<b>Withdraw from this tournament?</b><p class="hint">You can withdraw before it starts. After withdrawing, you cannot rejoin this competition.</p><button class="btn" data-a="withdraw-go">Withdraw</button><button class="btn sec" data-a="x">Keep my place</button>`); return;
    case "withdraw-go": { const id = S.id; closeSheet(); return doAct("withdraw", () => A.withdrawFromTournament(id), "You withdrew from the tournament"); }
    case "cancel": setSheet(`<b>Cancel this tournament?</b><p class="trn-meta">This cannot be undone.</p><button class="btn" data-a="cancelgo">Cancel tournament</button><button class="btn sec" data-a="x">Keep it</button>`); return;
    case "cancelgo": { const id = S.id; closeSheet(); return doAct("cancel", () => A.cancelTournament(id), "Tournament cancelled"); }
    case "invite": return inviteSheet();
    case "sendinv": { if (!S.pick) return; const st = S, team = root.querySelector("#trn-team")?.value; t.disabled = true; serr("");
      try { await call(() => A.inviteToTournament(S.id, S.pick, team)); closeSheet(); say("Invitation sent"); fetchDetail(true); } catch (x) { if (!aborted(x) && S === st) { t.disabled = false; serr(x.message); } } return; }
  }
}
root = null;
document.addEventListener("change", e => {
  if (!root || !root.contains(e.target)) return;
  if (e.target.name === "hostingType") { extra(e.target.value); updateCreateSummary(); }
  else if (["visibility","scoringMethod"].includes(e.target.name)) syncCreateControls();
  if (["category","coverTheme"].includes(e.target.name)) {
    const preview = root.querySelector(".trn-arena-preview"), form = root.querySelector('[data-f="create"]');
    if (preview && form) {
      preview.dataset.theme = form.elements.namedItem("coverTheme").value;
      preview.dataset.category = form.elements.namedItem("category").value;
    }
  }
  if (e.target.closest?.('[data-f="create"]')) updateCreateSummary();
});
