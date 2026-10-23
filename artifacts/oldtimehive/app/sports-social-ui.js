// Achievements, challenges and account-picker views for the Sports overlay.
import { sportsSocial } from "./sports-social.js";
import { sports, ACTIVITIES } from "./sports-engine.js";
import { fmtDist, fmtDur, initials } from "./sports-card.js";

let C = null, gen = 0;
export const initSocialUi = ctx => { C = ctx; };
const blankPicker = () => ({ q: "", s: "idle", res: [], sel: [], msg: "" });
const blank = () => ({ sum: { s: "idle" }, ch: { s: "idle" }, detail: { s: "idle" }, cid: null, picker: blankPicker(), sheet: null, tags: {}, form: { name: "", description: "", activityType: "run", goalKm: "", days: "14", visibility: "invite_only" } });
let S = blank(), timer = 0;
export const resetSocial = () => { gen++; for (const k of Object.keys(tagLoad)) delete tagLoad[k]; clearTimeout(timer); S = blank(); };
export const social = () => S;
const esc = s => C.esc(s);
const COLORS = ["#e630f5", "#3a4bff", "#6bff8f", "#ff7a1a", "#c8ff2e"];
const hue = id => COLORS[[...String(id || "")].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
export const avatar = (p, size = "") => `<span class="sp-av ${size}" style="--c:${hue(p.id || p.userId || p.username)}">${esc(initials(p.displayName || p.name || p.username))}</span>`;
const nm = p => p.displayName || p.username || "Account";
const hours = s => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${m}m` : `${m}m`; };
const dayFmt = d => { const t = /^\d{4}-\d\d-\d\d$/.test(d) ? new Date(d + "T12:00:00") : new Date(d); return isNaN(t) ? "" : t.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); };
const when = c => {
  const now = Date.now(), a = Date.parse(c.startsAt), b = Date.parse(c.endsAt), day = 864e5;
  if (a > now) return `Starts in ${Math.ceil((a - now) / day)} d`;
  if (b < now) return "Ended " + new Date(b).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const d = Math.ceil((b - now) / day); return d <= 1 ? "Ends today" : `${d} days left`;
};
const bar = (v, t) => `<div class="sp-bar"><i style="width:${t > 0 ? Math.max(2, Math.min(100, v / t * 100)) : 0}%"></i></div>`;
const pending = (st, what, retry) => st.s === "loading" || st.s === "idle" ? `<div class="sp-skel big"></div><div class="sp-skel"></div>` : st.s === "error" ? `<div class="sp-empty"><b>Could not load ${what}</b><span>${esc(st.msg)}</span><button type="button" class="sp-sec" data-act="${retry}">Retry</button></div>` : "";
const taggable = c => c.status === "owner" || c.status === "joined" || (c.status === "ended" && (c.membershipStatus === "joined" || c.creatorId === meId()));
const meId = () => { const m = sportsSocial.viewer() || {}; return m.cloudAccountId || m.id; };
const msg = e => e?.message || "Something went wrong.";

export async function loadSummary(force) {
  if (S.sum.s === "loading" || (S.sum.s === "ready" && !force)) return;
  const g = gen; S.sum = { s: "loading" }; C.render();
  try { const data = await sportsSocial.summary(); if (g !== gen) return; S.sum = { s: "ready", data }; } catch (e) { if (g !== gen) return; S.sum = { s: "error", msg: msg(e) }; }
  C.render(true);
}
export async function loadChallenges(force) {
  if (S.ch.s === "loading" || (S.ch.s === "ready" && !force)) return;
  const g = gen; S.ch = { s: "loading" }; C.render();
  try { const data = await sportsSocial.challenges(); if (g !== gen) return; S.ch = { s: "ready", data }; } catch (e) { if (g !== gen) return; S.ch = { s: "error", msg: msg(e) }; }
  C.render(true);
}
async function loadDetail(id) {
  const g = gen; S.cid = id; S.detail = { s: "loading" }; C.render();
  try { const data = await sportsSocial.challenge(id); if (g !== gen) return; S.detail = { s: "ready", data }; } catch (e) { if (g !== gen) return; S.detail = { s: "error", msg: msg(e) }; }
  C.render(true);
}
export const earned = () => (S.sum.data?.milestones || []).filter(m => m.earned);
export const summaryReady = () => S.sum.s === "ready";
export const tagFor = id => S.tags[id] || null;
const tagLoad = {};
export async function loadTags(id, force) {
  if (!id) return; const cur = tagLoad[id];
  if (cur && (cur.s === "loading" || (!force && (cur.s === "ready" || cur.s === "error")))) return;
  tagLoad[id] = { s: "loading" }; const g = gen;
  try {
    const r = await sportsSocial.workoutTags(id); if (g !== gen) return;
    const people = r?.taggedPeople || [];
    if (r?.challenge || people.length) S.tags[id] = { challengeId: r.challenge?.id || "", challengeName: r.challenge?.name || "", taggedUserIds: people.map(p => p.userId), taggedPeople: people }; else delete S.tags[id];
    tagLoad[id] = { s: "ready" };
  } catch (e) {
    if (g !== gen) return;
    if (e.status === 404 && C.onMissingWorkout) {
      try {
        const recovered = await C.onMissingWorkout(id);
        if (g !== gen) return;
        tagLoad[id] = recovered ? { s: "local" } :
          { s: "error", msg: "This activity could not be loaded from your account. Refresh your activity list and try again." };
      } catch (recoveryError) {
        if (g !== gen) return;
        tagLoad[id] = { s: "error", msg: msg(recoveryError) };
      }
    } else tagLoad[id] = { s: "error", msg: msg(e) };
  }
  C.render(true);
}
const tagReady = w => w.synced === false || tagLoad[w.id]?.s === "ready";

// ---------- Achievements ----------
export function viewAchievements() {
  const st = S.sum, p = pending(st, "achievements", "s:sum"); if (p) return p;
  const d = st.data || {}, t = d.totals || {}, me = sportsSocial.viewer() || {};
  const ms = [...(d.milestones || [])].sort((a, b) => (b.earned ? 1 : 0) - (a.earned ? 1 : 0));
  const wk = d.weekly || [];
  return `<div class="sp-who">${C.ownerAv(me)}<span><b>${esc(me.name || me.username)}</b><small>@${esc(me.username || "")}</small></span></div>
  <div class="sp-panels"><div class="sp-pn mag"><small>Total time</small><b>${hours(t.activeSeconds)}</b></div><div class="sp-pn blu"><small>Distance</small><b>${fmtDist(t.distanceM)}<i>km</i></b></div>
  <div class="sp-pn mint"><small>Elevation</small><b>${Math.round(t.elevationGainM || 0)}<i>m</i></b></div><div class="sp-pn org"><small>Workouts</small><b>${t.workoutCount ?? 0}</b><em>${t.activeDays ?? 0} active days</em></div></div>
  ${(t.workoutCount || 0) === 0 ? `<div class="sp-empty"><b>Nothing recorded yet</b><span>Sync completed workouts to include them in account totals and achievements.</span></div>` : ""}
  ${wk.length ? `<h3 class="sp-h">Recent activity</h3><ul class="sp-list">${wk.map(x => `<li class="sp-row static"><span><b>${esc(dayFmt(x.day))}</b></span><span class="sp-r"><b>${(x.distanceM || 0) > 0 ? fmtDist(x.distanceM) + " km" : "Rest"}</b><small>${(x.activeSeconds || 0) > 0 ? hours(x.activeSeconds) : "--"}</small></span></li>`).join("")}</ul>` : ""}
  ${(d.personalBests || []).length ? `<h3 class="sp-h">Personal bests</h3><ul class="sp-list">${d.personalBests.map(b => `<li class="sp-row static">${C.actIcon(b.activityType)}<span><b>${esc(C.label(b.activityType))}</b><small>Longest ${b.longestDistanceM ? fmtDist(b.longestDistanceM) + " km" : "--"}</small></span><span class="sp-r"><b>${C.fmtPace(b.fastestPaceSecondsPerKm)}</b><small>fastest /km</small></span></li>`).join("")}</ul>` : ""}
  <h3 class="sp-h">Milestones</h3>${ms.length ? `<ul class="sp-list">${ms.map(m => `<li class="sp-ms ${m.earned ? "on" : ""}"><span class="sp-badge" aria-hidden="true"></span><span><b>${esc(m.title)}</b><small>${esc(m.description)}</small>${m.earned ? "" : bar(m.progress, m.target)}</span><em>${m.earned ? "Earned" : Math.min(100, Math.round((m.target > 0 ? m.progress / m.target : 0) * 100)) + "%"}</em></li>`).join("")}</ul>` : `<div class="sp-empty"><b>No milestones yet</b></div>`}`;
}

// ---------- Challenges ----------
const crow = (c, inv) => `<li><button type="button" class="sp-chal" data-act="s:open" data-id="${esc(c.id)}"><span class="sp-ct"><b>${esc(c.name)}</b><small>${esc(C.label(c.activityType))} · ${fmtDist(c.goalDistanceM)} km goal · ${esc(when(c))}</small></span>${inv ? `<em>Invited</em>` : c.status === "available" ? `<span class="sp-r"><b>Open</b><small>${c.memberCount ?? 0} joined</small></span>` : `<span class="sp-r"><b>${fmtDist(c.ownDistanceM || 0)} km</b><small>${c.memberCount ?? 0} joined</small></span>`}${inv || c.status === "available" ? "" : bar(c.ownDistanceM || 0, c.goalDistanceM)}</button></li>`;
export function viewChallenges() {
  const st = S.ch, p = pending(st, "challenges", "s:chs"); if (p) return p;
  const { challenges = [], invitations = [] } = st.data || {};
  return `<div class="sp-split"><p class="sp-note">Distance counts from workouts you tag to a challenge, inside its dates. No entry fees or prizes.</p><button type="button" class="sp-go sm" data-act="s:new">Create</button></div>
  ${invitations.length ? `<h3 class="sp-h">Invitations</h3><ul class="sp-list">${invitations.map(c => crow(c, true)).join("")}</ul>` : ""}
  <h3 class="sp-h">Your challenges</h3>${challenges.length ? `<ul class="sp-list">${challenges.map(c => crow(c)).join("")}</ul>` : `<div class="sp-empty"><b>No challenges yet</b><span>Create a distance goal and invite people, or accept an invitation.</span></div>`}`;
}
export function viewChallenge() {
  const st = S.detail, p = pending(st, "this challenge", "s:retry-detail"); if (p) return p;
  const { challenge: c, leaderboard = [], invites = [] } = st.data, me = sportsSocial.viewer() || {};
  const listed = (S.ch.data?.challenges || []).find(x => x.id === c.id), inv = (S.ch.data?.invitations || []).some(x => x.id === c.id), cs = c.status || listed?.status;
  const member = (cs === "owner" || cs === "joined") ? true : (inv || cs === "available" || cs === "invited" || c.membershipStatus === "invited") ? false : taggable({ ...c, status: cs, membershipStatus: c.membershipStatus ?? listed?.membershipStatus }), mine0 = c.creatorId === meId();
  const top = leaderboard.slice(0, 3), rest = leaderboard.slice(3), cols = ["mint", "mag", "org"];
  const mine = leaderboard.find(r => r.userId === meId());
  const active = Date.parse(c.endsAt) > Date.now() && cs !== "ended";
  return `<div class="sp-ch-hero"><small>${esc(C.label(c.activityType))} · ${esc(when(c))}</small><h2>${esc(c.name)}</h2>${c.description ? `<p>${esc(c.description)}</p>` : ""}
    <div class="sp-ch-g"><b>${fmtDist(c.ownDistanceM || 0)}</b><span>of ${fmtDist(c.goalDistanceM)} km</span></div>${bar(c.ownDistanceM || 0, c.goalDistanceM)}<small>${c.memberCount ?? 0} joined · ${c.visibility === "public" ? "Open" : "Invite only"}</small></div>
  <div class="sp-actions two">${member ? `<button type="button" class="sp-go" data-act="s:tagpick" ${active ? "" : "disabled"}>Tag a workout</button><button type="button" class="sp-sec" data-act="s:invite" ${active ? "" : "disabled"}>Invite people</button>` : `<button type="button" class="sp-go" data-act="s:join" ${C.busy() ? "disabled" : ""}>${C.busy() === "join" ? "Joining" : "Join challenge"}</button>`}</div>
  ${mine0 ? `<button type="button" class="sp-link danger" data-act="s:delchal">Delete challenge</button>` : ""}
  ${member ? `<p class="sp-note">Earlier workouts can be tagged, but only distance inside the challenge dates counts.</p>` : ""}
  ${C.errHtml()}
  <h3 class="sp-h">Leaderboard</h3>${leaderboard.length ? `<div class="sp-pod">${top.map((r, i) => `<div class="sp-pod-${i + 1} ${cols[i]}">${avatar({ id: r.userId, displayName: nm(r) }, "lg")}<b>${esc(nm(r))}</b><small>${fmtDist(r.distanceM)} km</small><em>${r.rank}</em></div>`).join("")}</div>
  ${mine && mine.rank > 3 ? `<div class="sp-row static me"><em class="sp-rk">${mine.rank}</em><span><b>You</b></span><span class="sp-r"><b>${fmtDist(mine.distanceM)} km</b></span></div>` : ""}
  <ul class="sp-list">${rest.map(r => `<li class="sp-row static ${r.userId === meId() ? "me" : ""}"><em class="sp-rk">${r.rank}</em>${avatar({ id: r.userId, displayName: nm(r) })}<span><b>${esc(nm(r))}</b><small>@${esc(r.username)}</small></span><span class="sp-r"><b>${fmtDist(r.distanceM)} km</b></span></li>`).join("")}</ul>` : `<div class="sp-empty"><b>No distance yet</b><span>Rankings appear once tagged workouts count.</span></div>`}
  ${invites.length ? `<h3 class="sp-h">Invited</h3><ul class="sp-list">${invites.map(i => `<li class="sp-row static">${avatar({ id: i.userId, displayName: nm(i) })}<span><b>${esc(nm(i))}</b><small>@${esc(i.username)}</small></span><span class="sp-r"><small>${esc(i.status)}</small></span></li>`).join("")}</ul>` : ""}`;
}
export function viewCreate() {
  const f = S.form;
  return `<form class="sp-form" id="sp-cform" novalidate>
  <label>Name<input id="cf-name" maxlength="60" value="${esc(f.name)}" data-form="name" autocomplete="off" data-autofocus></label>
  <label>Description<textarea data-form="description" rows="2" maxlength="240">${esc(f.description)}</textarea></label>
  <div class="sp-two"><label>Activity<select data-form="activityType">${ACTIVITIES.map(a => `<option value="${a.id}" ${f.activityType === a.id ? "selected" : ""}>${esc(a.label)}</option>`).join("")}</select></label>
  <label>Goal (km)<input data-form="goalKm" inputmode="decimal" value="${esc(f.goalKm)}" placeholder="50"></label></div>
  <div class="sp-two"><label>Length (days)<input data-form="days" inputmode="numeric" value="${esc(f.days)}"></label>
  <label>Who can join<select data-form="visibility"><option value="invite_only" ${f.visibility === "invite_only" ? "selected" : ""}>Invite only</option><option value="public" ${f.visibility === "public" ? "selected" : ""}>Open</option></select></label></div>
  <div><span class="sp-lab">Invite people</span>${pickerHTML()}</div>
  ${C.errHtml()}
  <button type="submit" class="sp-go" ${C.busy() ? "disabled" : ""}>${C.busy() === "create" ? "Creating" : "Create challenge"}</button></form>`;
}

// ---------- Picker ----------
export function pickerHTML() {
  return `<div class="sp-pick"><input type="search" data-pickq placeholder="Search people" value="${esc(S.picker.q)}" autocomplete="off" aria-label="Search people"><div data-pickchips class="sp-chips">${chips()}</div><div data-pickres class="sp-pickres">${results()}</div></div>`;
}
const chips = () => S.picker.sel.map(p => `<button type="button" class="sp-chip" data-act="s:unpick" data-id="${esc(p.id)}" aria-label="Remove ${esc(nm(p))}">${esc(nm(p))} <b aria-hidden="true">&times;</b></button>`).join("");
function results() {
  const p = S.picker; if (p.s === "loading") return `<div class="sp-skel"></div>`;
  if (p.s === "error") return `<p class="sp-err">${esc(p.msg)}</p>`;
  if (p.s === "idle") return `<p class="sp-note">Search by name or username.</p>`;
  if (!p.res.length) return `<p class="sp-note">No accounts found.</p>`;
  return p.res.map(r => { const on = p.sel.some(x => x.id === r.id); return `<button type="button" class="sp-row pick ${on ? "on" : ""}" role="checkbox" aria-checked="${on}" data-act="s:pick" data-id="${esc(r.id)}">${avatar({ id: r.id, displayName: nm(r) })}<span><b>${esc(nm(r))}</b><small>@${esc(r.username)}</small></span><em>${on ? "Added" : "Add"}</em></button>`; }).join("");
}
function paintPicker() { const d = C.root(); if (!d) return; const a = d.querySelector("[data-pickchips]"), b = d.querySelector("[data-pickres]"); if (a) a.innerHTML = chips(); if (b) b.innerHTML = results(); }
export function onSocialInput(e) {
  const t = e.target;
  if (t.dataset.form) { S.form[t.dataset.form] = t.value; return true; }
  if (t.dataset.pickq !== undefined) {
    const q = t.value; S.picker.q = q; clearTimeout(timer); const g = gen;
    if (q.trim().length < 2) { S.picker.s = "idle"; S.picker.res = []; paintPicker(); return true; }
    S.picker.s = "loading"; paintPicker();
    timer = setTimeout(async () => {
      try { const r = await sportsSocial.people(q.trim()); if (g !== gen || S.picker.q !== q) return; const me = meId(); S.picker.res = (r.profiles || []).filter(x => x.id !== me); S.picker.s = "ready"; }
      catch (x) { if (g !== gen || S.picker.q !== q) return; S.picker.s = "error"; S.picker.msg = msg(x); }
      paintPicker();
    }, 280);
    return true;
  }
  return false;
}
export const onSocialChange = e => { if (e.target.dataset.form) { S.form[e.target.dataset.form] = e.target.value; return true; } if (e.target.name === "tagch") { S.sheet.challengeId = e.target.value; return true; } return false; };

// ---------- Sheets ----------
export function sheetHTML() {
  const sh = S.sheet; if (!sh) return "";
  const close = `<button type="button" class="sp-ibtn" data-act="s:closesheet" aria-label="Close">&times;</button>`;
  if (sh.type === "invite") return `<div class="sp-scrim sheet"><div class="sp-sheet" role="dialog" aria-modal="true" aria-label="Invite people"><div class="sp-sh-h"><b>Invite people</b>${close}</div>${pickerHTML()}${C.errHtml()}<button type="button" class="sp-go" data-act="s:sendinvite" ${C.busy() ? "disabled" : ""}>${C.busy() === "invite" ? "Sending" : `Send invite${S.picker.sel.length > 1 ? "s" : ""}`}</button></div></div>`;
  if (sh.type === "wpick") { const h = C.history().filter(w => w.status === "completed"); return `<div class="sp-scrim sheet"><div class="sp-sheet" role="dialog" aria-modal="true" aria-label="Choose a workout"><div class="sp-sh-h"><b>Tag a workout</b>${close}</div>${h.length ? `<ul class="sp-list">${h.map(w => `<li><button type="button" class="sp-row" data-act="s:wchosen" data-id="${esc(w.id)}">${C.actIcon(w.activityType)}<span><b>${esc(C.label(w.activityType))}</b><small>${esc(C.when(w))}</small></span><span class="sp-r"><b>${fmtDist(w.summary?.distanceM)} km</b></span></button></li>`).join("")}</ul>` : `<div class="sp-empty"><b>No finished workouts</b></div>`}</div></div>`; }
  const w = sh.workout, chs = (S.ch.data?.challenges || []).filter(taggable);
  return `<div class="sp-scrim sheet"><div class="sp-sheet" role="dialog" aria-modal="true" aria-label="Challenge and people"><div class="sp-sh-h"><b>Challenge and people</b>${close}</div>
  <p class="sp-note">${esc(C.label(w.activityType))}, ${fmtDist(w.summary?.distanceM)} km. Only workouts inside the challenge dates count toward it.</p>
  ${S.ch.s === "loading" ? `<div class="sp-skel"></div>` : S.ch.s === "error" ? `<p class="sp-err">${esc(S.ch.msg)} <button type="button" class="sp-link" data-act="s:chs">Retry</button></p>` : chs.length ? `<fieldset class="sp-fs"><legend>Challenge</legend><label class="sp-rad"><input type="radio" name="tagch" value="" ${!sh.challengeId ? "checked" : ""}>None</label>${chs.map(c => `<label class="sp-rad"><input type="radio" name="tagch" value="${esc(c.id)}" ${sh.challengeId === c.id ? "checked" : ""}>${esc(c.name)}</label>`).join("")}</fieldset>` : `<p class="sp-note">No challenges you own or have joined.</p>`}
  <span class="sp-lab">Tag people</span>${pickerHTML()}${C.errHtml()}
  <button type="button" class="sp-go" data-act="s:savetag" ${C.busy() ? "disabled" : ""}>${C.busy() === "tag" ? "Saving" : "Save"}</button></div></div>`;
}
export async function openTag(workout, challengeId = "") {
  if (workout.synced !== true) return C.fail("Sync this activity to add challenge tags.");
  await loadTags(workout.id, true);
  if (tagLoad[workout.id]?.s === "local") return C.fail("This activity is waiting to sync. Sync it before editing challenge tags.");
  if (!tagReady(workout)) return C.fail("Challenge tags are unavailable right now. Try again to load them before making changes.");
  S.picker = blankPicker(); S.sheet = { type: "tag", workout, challengeId };
  const prev = S.tags[workout.id]; if (prev) { S.sheet.challengeId = prev.challengeId || challengeId; S.picker.sel = (prev.taggedPeople || []).map(p => ({ id: p.userId, username: p.username, displayName: p.displayName })); }
  C.render(); if (S.ch.s !== "ready") loadChallenges();
}
export function tagSummaryHTML(id, synced = true) {
  if (synced !== true) return `<span class="sp-note">Sync this activity to add challenge tags.</span>`;
  const ls = tagLoad[id];
  if (ls?.s === "error") return `<span class="sp-err">Could not load challenge tags: ${esc(ls.msg)} <button type="button" class="sp-link" data-act="s:retrytags" data-id="${esc(id)}">Try again</button></span>`;
  if (ls?.s === "loading") return `<span class="sp-note">Loading challenge tags…</span>`;
  const t = S.tags[id]; if (!t) return `<span class="sp-note">Not tagged.</span>`;
  return `<span class="sp-note">${t.challengeName ? "Counts toward " + esc(t.challengeName) + ". " : ""}${t.taggedPeople?.length ? "With " + t.taggedPeople.map(p => esc(nm(p))).join(", ") + "." : ""}</span>`;
}

// ---------- Actions ----------
export async function socialAct(act, el) {
  const id = el.dataset.id;
  switch (act) {
    case "retrytags": return loadTags(id, true);
    case "sum": return loadSummary(true);
    case "chs": return loadChallenges(true);
    case "retry-detail": return loadDetail(S.cid);
    case "new": S.picker = blankPicker(); return C.go("create");
    case "open": return C.go("challenge", {}, () => loadDetail(id));
    case "delchal": return C.ask({ title: "Delete this challenge?", text: "The challenge and its leaderboard are removed for everyone. Your workouts stay private in your history; they are only unlinked from this challenge.", ok: "Delete challenge", danger: true }, () => C.run("delchal", async () => { await sportsSocial.deleteChallenge(S.cid); S.ch.s = "idle"; S.detail = { s: "idle" }; S.cid = null; S.sheet = null; C.set({ screen: "challenges" }); loadChallenges(true); C.say("Challenge deleted"); }));
    case "join": return C.run("join", async () => { await sportsSocial.joinChallenge(S.cid); S.detail = { s: "ready", data: await sportsSocial.challenge(S.cid) }; S.ch.s = "idle"; loadChallenges(true); });
    case "invite": S.picker = blankPicker(); S.sheet = { type: "invite" }; return C.render();
    case "sendinvite": if (!S.picker.sel.length) return C.fail("Choose at least one person."); return C.run("invite", async () => { await sportsSocial.inviteChallenge(S.cid, S.picker.sel.map(p => p.id)); S.sheet = null; S.picker = blankPicker(); S.detail = { s: "ready", data: await sportsSocial.challenge(S.cid) }; C.say("Invitations sent"); });
    case "closesheet": S.sheet = null; return C.render();
    case "tagpick": S.sheet = { type: "wpick" }; return C.render();
    case "wchosen": { const w = C.history().find(x => x.id === id); if (w) openTag(w, S.cid); return; }
    case "pick": { const r = S.picker.res.find(x => x.id === id); if (!r) return; const i = S.picker.sel.findIndex(x => x.id === id); i < 0 ? S.picker.sel.push(r) : S.picker.sel.splice(i, 1); return paintPicker(); }
    case "unpick": S.picker.sel = S.picker.sel.filter(x => x.id !== id); return paintPicker();
    case "savetag": {
      const sh = S.sheet, ids = S.picker.sel.map(p => p.id);
      if (!tagReady(sh.workout)) return C.fail("Saved tags have not finished loading. Close this and retry.");
      if (!sh.challengeId && !ids.length) return C.fail("Choose a challenge or at least one person.");
      return C.run("tag", async () => {
        let w = sh.workout; if (w.synced === false) w = await sports.sync(w.id);
        const r = await sportsSocial.tagWorkout(w.id, { challengeId: sh.challengeId || null, taggedUserIds: ids });
        S.tags[w.id] = { challengeId: r.challenge?.id || sh.challengeId || "", challengeName: r.challenge?.name || "", taggedUserIds: ids, taggedPeople: r.taggedPeople || [] };
        S.sheet = null; S.picker = blankPicker(); S.ch.s = "idle"; C.say("Workout tagged");
        if (S.cid && S.detail.s === "ready") { try { S.detail = { s: "ready", data: await sportsSocial.challenge(S.cid) }; } catch {} }
      });
    }
  }
}
export async function submitCreate() {
  const f = S.form, km = Number(String(f.goalKm).replace(",", ".")), days = Math.round(Number(f.days));
  if (f.name.trim().length < 3) return C.fail("Use at least 3 characters for the challenge name.");
  if (!(km >= 1 && km <= 1000)) return C.fail("Enter a distance goal between 1 and 1,000 kilometres.");
  if (!(days >= 1 && days <= 90)) return C.fail("Length must be between 1 and 90 days.");
  return C.run("create", async () => {
    const d = await sportsSocial.createChallenge({ name: f.name.trim(), description: f.description.trim(), activityType: f.activityType, goalDistanceM: Math.round(km * 1000), durationDays: days, visibility: f.visibility, userIds: S.picker.sel.map(p => p.id) });
    S.form = blank().form; S.picker = blankPicker(); S.ch.s = "idle"; S.detail = { s: "ready", data: d }; S.cid = d.challenge.id; C.set({ screen: "challenge" }); loadChallenges(true);
  });
}
export const sheetOpen = () => !!S.sheet;
export const closeSheet = () => { S.sheet = null; };
