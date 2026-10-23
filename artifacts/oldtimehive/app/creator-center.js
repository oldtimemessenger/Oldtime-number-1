import "./creator-center.css";
import { api, requestCloudApi } from "./store.js";
import { icon } from "./icons.js";
import { syncCreatorOriginals } from "./creator-content-sync.js";

const TITLES = { "creator-center": "Creator Center", "blue-badge": "Blue Badge", announcements: "Announcements", "creator-admin": "Creator admin" };
export const CREATOR_TOOL_ROUTES = Object.freeze(Object.keys(TITLES));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BADGE_TTL = 60000;
let token = 0;
let shownSet = new Set();
let badgeCache = new Map();
let evalBusy = false;

export function resetCreatorScreenState() {
  token++; shownSet = new Set(); badgeCache = new Map(); evalBusy = false;
}

export function blueBadgeMarkup(cloudId, esc = String) {
  if (!UUID.test(String(cloudId || ""))) return "";
  return `<span class="ct-bb" role="img" aria-label="Blue Badge" data-ct-badge="${esc(String(cloudId).toLowerCase())}" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>`;
}

export async function hydrateBlueBadges(root) {
  if (!root?.querySelectorAll || typeof navigator !== "undefined" && navigator.onLine === false) return;
  const requestToken = token;
  const nodes = [...root.querySelectorAll("[data-ct-badge]")];
  const now = Date.now();
  const paint = () => nodes.forEach(n => {
    const hit = badgeCache.get(n.dataset.ctBadge);
    n.hidden = !(hit && hit.at + BADGE_TTL > Date.now() && hit.active === true);
  });
  paint();
  const need = [...new Set(nodes.map(n => n.dataset.ctBadge))].filter(id => UUID.test(id) && !(badgeCache.get(id)?.at + BADGE_TTL > now));
  for (let i = 0; i < need.length; i += 50) {
    const ids = need.slice(i, i + 50);
    try {
      const res = await requestCloudApi(`/api/creator/badges?userIds=${ids.join(",")}`);
      if (requestToken !== token) return;
      const seen = new Set();
      for (const b of Array.isArray(res?.badges) ? res.badges : []) {
        const id = String(b.userId || "").toLowerCase();
        if (ids.includes(id)) { seen.add(id); badgeCache.set(id, { active: b.active === true, at: Date.now() }); }
      }
      ids.filter(id => !seen.has(id)).forEach(id => badgeCache.set(id, { active: false, at: Date.now() }));
    } catch { /* stay hidden */ }
  }
  paint();
}

const money = c => `$${(Number(c) / 100).toFixed(2)}`;
const fmtDate = v => { const d = new Date(v); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(); };
const STATUS = {
  rising: "Building momentum", emerging: "Emerging", eligible: "Eligible, awaiting approval",
  approved: "Approved", "membership-required": "Activity met, Blue Badge membership needed", restricted: "Restricted"
};

export function renderCreatorScreen(view, ctx) {
  if (!TITLES[view]) view = "creator-center";
  const { shell, app, esc, navigate, back } = ctx;
  const my = ++token;
  const live = () => my === token && app.isConnected && app.querySelector(`[data-ct-view="${view}"]`);
  const toast = m => ctx.toast?.(m);
  let syncMessage = "";
  let archiveLimit = 20;
  const body = html => shell(`<main class="ct-wrap" data-ct-view="${view}">
    <header class="ct-head"><button type="button" class="ct-icon" data-ct-back aria-label="Back">${icon("back")}</button><h1>${esc(TITLES[view])}</h1><span></span></header>
     <nav class="ct-tabs" aria-label="Creator sections">${Object.keys(TITLES).filter(k => (k !== "creator-admin" || ctx.isAdmin)&&(k!=="creator-center"||ctx.accountType==="creator")).map(k => `<button type="button" data-ct-go="${k}" class="${k === view ? "on" : ""}">${esc(TITLES[k])}</button>`).join("")}</nav>
    <div id="ct-body">${html}</div></main>`, "dark");
  const bind = () => {
    app.querySelector("[data-ct-back]")?.addEventListener("click", () => back());
    app.querySelectorAll("[data-ct-go]").forEach(b => b.onclick = () => navigate(b.dataset.ctGo));
  };
  const mount = html => { if (!live()) return false; app.querySelector("#ct-body").innerHTML = html; return true; };
  const fail = (e, retry) => {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    const local = /sign in to an online/i.test(e?.message || "");
    const text = local ? "Sign in to an online account to use creator features." : offline ? "You are offline. Reconnect and try again." : e?.status === 403 ? "You do not have access to this page." : (e?.message || "Something went wrong.");
    if (!mount(`<div class="ct-card" role="alert"><p>${esc(text)}</p>${local ? "" : '<button type="button" class="ct-btn" data-ct-retry>Try again</button>'}</div>`)) return;
    app.querySelector("[data-ct-retry]")?.addEventListener("click", retry);
  };
  body(`<div class="ct-skel"></div><div class="ct-skel"></div><div class="ct-skel"></div>`);
  bind();
  const load = () => {
    if (view === "creator-center") return center();
    if (view === "blue-badge") return badge();
    if (view === "announcements") return announce();
    return admin();
  };

  async function center() {
    let d, archive;
    try { [d, archive] = await Promise.all([requestCloudApi("/api/creator/center"), requestCloudApi("/api/creator/content")]); } catch (e) { return fail(e, center); }
    if (!live()) return;
    if (d.isAdmin && !app.querySelector('[data-ct-go="creator-admin"]')) {
      app.querySelector(".ct-tabs").insertAdjacentHTML("beforeend", `<button type="button" data-ct-go="creator-admin">${esc(TITLES["creator-admin"])}</button>`);
      bind();
    }
    const reqs = Array.isArray(d.requirements) ? d.requirements : [];
    const s = d.stats || {};
    const pct = r => Math.max(0, Math.min(100, r.target ? (r.current / r.target) * 100 : r.met ? 100 : 0));
    const hist = Array.isArray(d.history) ? d.history : [];
    const miles = Array.isArray(d.milestones) ? d.milestones : [];
    mount(`<section class="ct-card"><span class="ct-eyebrow">Your level</span><div class="ct-level">${esc(d.level || "Newcomer")}</div>
      <p>${esc(STATUS[d.status] || "Status unavailable")}${d.approvedAt ? ` since ${esc(fmtDate(d.approvedAt))}` : ""}.</p>
      ${d.status === "approved" || d.status === "membership-required" ? `<p>Approved creators keep a valid Blue Badge membership active. ${d.membership?.active ? "Your membership is active." : "No active membership is on record."}</p>` : ""}
      <p class="ct-note">Creator recognition here does not include earnings or payouts.</p>
      <div class="ct-row"><button type="button" class="ct-btn" data-ct-eval>Refresh evaluation</button>${d.status === "membership-required" ? '<button type="button" class="ct-btn ghost" data-ct-go="blue-badge">Blue Badge</button>' : ""}</div><div id="ct-evmsg" role="status"></div></section>
      <section class="ct-card"><h2>Your verified originals</h2><p>Sync original text, photos, videos, Stories and community posts for creator credit. Media is copied to a private, owner-only archive; your audience and original on this device stay unchanged. Linked comment remixes and repeated content do not earn original credit.</p>
      <div class="ct-stats">${[["Text", d.contentBreakdown?.text], ["Photos", d.contentBreakdown?.photos], ["Videos", d.contentBreakdown?.videos], ["Stories", d.contentBreakdown?.stories], ["Community posts", d.contentBreakdown?.communityPosts]].map(([l,v]) => `<div><b>${esc(v ?? 0)}</b><span>${esc(l)}</span></div>`).join("")}</div>
      <button type="button" class="ct-btn" data-ct-sync>Sync my originals</button><div id="ct-syncmsg" role="status">${esc(syncMessage)}</div>
      ${archive.content.length ? `<h3>Synced originals</h3><p>Remove a synced original to remove its credit and delete its private media copies. Your local post or Story is not deleted.</p><ul>${archive.content.slice(0,archiveLimit).map(c => {
        const original = api.post(c.sourceId) || api.db().stories.find(s => s.id === c.sourceId);
        return `<li>${esc((original?.caption || original?.text || original?.kind || "Original content").slice(0,80))} — ${c.original ? "original recorded" : "known duplicate"} <button type="button" class="ct-btn ghost" data-ct-remove="${esc(c.id)}">Remove sync</button></li>`;
      }).join("")}</ul>${archive.content.length > archiveLimit ? '<button type="button" class="ct-btn ghost" data-ct-more>Show more</button>' : ""}` : ""}</section>
      <section class="ct-card"><h2>Progress</h2><p>Your activity score is ${esc(d.score)} / 100. Progress is not a promise of approval.</p>${reqs.length ? reqs.map(r => `<div class="ct-req"><div><span>${esc(r.label)}</span><b>${esc(r.current)} / ${esc(r.target)}</b></div><div class="ct-bar"><i style="width:${pct(r)}%" role="progressbar" aria-label="${esc(r.label)}" aria-valuenow="${Math.round(pct(r))}" aria-valuemin="0" aria-valuemax="100"></i></div><small>${r.met ? "Met" : "In progress"}</small></div>`).join("") : '<p>No requirements published yet.</p>'}<p class="ct-note">Qualifying text contains at least 20 characters and three words. Photo and video credit requires verified uploaded bytes. Repeated content and self-interactions do not count. Engagement comes from distinct accounts at least seven days old. Active days reflect posting and meaningful discussion, not simply opening the app.</p></section>
      <section class="ct-card"><h2>Your activity</h2><div class="ct-stats">${[["Account age (days)", s.accountAgeDays], ["Account identity complete (%)", s.profileCompletion], ["Original content", s.originalPosts], ["Active days", s.activeDays], ["Engagement received", s.engagementReceived], ["Other creators interacted with", s.communityInteractions]].map(([l, v]) => `<div><b>${esc(v ?? 0)}</b><span>${esc(l)}</span></div>`).join("")}</div><p class="ct-note">Account identity means your username, display name, and email. Other-creator interactions count real likes and meaningful comments on distinct established authors' persisted posts. Device-only comments and engagement totals do not count.</p></section>
      <section class="ct-card"><h2>Milestones</h2>${miles.length ? `<ul>${miles.map(m => `<li>${esc(m.title)} - ${m.reached ? "reached" : "not yet"}</li>`).join("")}</ul>` : '<p>No milestones to show yet.</p>'}</section>
      <section class="ct-card"><h2>History</h2>${hist.length ? `<ul>${hist.map(h => `<li>${esc(fmtDate(h.at))}: ${esc(STATUS[h.status] || h.status)}${h.reason ? ` (${esc(h.reason)})` : ""}</li>`).join("")}</ul>` : '<p>Nothing recorded yet.</p>'}</section>`);
    bind();
    app.querySelector("[data-ct-more]")?.addEventListener("click", () => { archiveLimit += 20; void center(); });
    app.querySelectorAll("[data-ct-remove]").forEach(button => button.onclick = async () => {
      button.disabled = true;
      try {
        const result = await requestCloudApi(`/api/creator/content/${encodeURIComponent(button.dataset.ctRemove)}`, { method: "DELETE" });
        syncMessage = result.cleanupPending ? "Credit removed. Private media deletion is queued for retry." : "Synced original and private media copies removed. The local original is unchanged.";
        if (live()) await center();
      } catch (error) { if (live()) { button.disabled = false; toast(error.message); } }
    });
    app.querySelector("[data-ct-sync]")?.addEventListener("click", async e => {
      const b = e.currentTarget; b.disabled = true;
      const say = message => { syncMessage = message; const n = app.querySelector("#ct-syncmsg"); if (n && live()) n.textContent = message; };
      try {
        const result = await syncCreatorOriginals(say);
        say(`${result.confirmed} synced; ${result.skipped} skipped; ${result.failed} not synced.${result.lastError ? ` ${result.lastError}` : ""}${result.remaining ? ` ${result.remaining} left for the next batch.` : ""} Originals stay on this device. Only server-verified content earns credit.`);
        if (live()) await center();
      } catch (error) { say(error.message); }
      finally { if (live()) b.disabled = false; }
    });
    app.querySelector("[data-ct-eval]")?.addEventListener("click", async e => {
      if (evalBusy) return;
      const button = e.currentTarget;
      evalBusy = true; button.disabled = true;
      const msg = txt => { const n = app.querySelector("#ct-evmsg"); if (n && live()) n.innerHTML = `<div class="ct-msg">${esc(txt)}</div>`; };
      try { await requestCloudApi("/api/creator/evaluate", { method: "POST", body: {} }); evalBusy = false; if (live()) { toast("Evaluation refreshed"); center(); } }
      catch (err) { evalBusy = false; if (live()) { button.disabled = false; msg(err.status === 429 ? "Evaluation was refreshed recently. Try again later." : err.message); } }
    });
  }

  async function badge() {
    let m;
    try { m = await requestCloudApi("/api/badge/membership"); } catch (e) { return fail(e, badge); }
    if (!live()) return;
    const st = ["none", "pending", "active", "canceled", "expired", "revoked", "billing-issue"].includes(m.status) ? m.status : (m.active ? "active" : "none");
    const on = m.active === true && (st === "active" || st === "canceled" || st === "billing-issue");
    const until = m.expiresAt ? fmtDate(m.expiresAt) : "";
    const store = m.store ? ` through ${esc(m.store)}` : "";
    const STATE = {
      none: ["Not a member", "You do not have a Blue Badge membership."],
      pending: ["Pending", "Awaiting store verification. No paid benefits are active until the store confirms your membership."],
      active: ["Active", `Verified${store}.${until ? ` Current period ends ${esc(until)}.` : ""}${m.autoRenews === true ? " Renews automatically." : m.autoRenews === false ? " Will not renew automatically." : ""}`],
      canceled: on ? ["Canceled, still active", `Your access continues until the verified expiration${until ? `, ${esc(until)}` : ""}. It will not renew.`] : ["Canceled", "Your membership was canceled and is no longer active."],
      expired: ["Expired", "Your membership has expired and is not active."],
      revoked: ["Revoked", "Your membership was revoked and is not active."],
      "billing-issue": on ? ["Billing issue", `The store reported a billing problem${until ? `. Access is verified until ${esc(until)}` : ""}. Update your payment method in your store account settings.`] : ["Billing issue", "The store reported a billing problem and your membership is not active. Update your payment method in your store account settings."]
    }[st];
    const d = m.distribution || {};
    const https = u => typeof u === "string" && /^https:\/\//i.test(u) ? u : null;
    const ios = https(d.iphoneUrl), and = https(d.androidUrl), opn = https(d.openUrl);
    const act = (url, label) => url ? `<a class="ct-btn ct-linkbtn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : `<button type="button" class="ct-btn" disabled>${esc(label)}</button>`;
    const terms = [`Planned standard price: ${money(m.standardPriceCents)} per month, billed monthly if subscriptions open.`];
    const ben = Array.isArray(m.benefits) ? m.benefits : [];
    mount(`<section class="ct-card ct-hero"><img class="ct-badge-art" src="${import.meta.env.BASE_URL}guide/membership.webp" alt="" width="320" height="160"><div><h2>Blue Badge membership</h2><p>${on ? "Your membership is based on a verified store purchase." : "A membership badge and benefits for Oldtime members."}</p></div></section>
      <section class="ct-card"><h2>${esc(STATE[0])}</h2><span class="ct-eyebrow">Your membership</span><p>${STATE[1]}</p>
      ${m.creatorMembershipRequired ? "<p>Approved creators must maintain a valid Blue Badge membership.</p>" : ""}</section>
      <section class="ct-card"><h2>Subscription availability</h2>
      <p>Apple and Google subscription billing is not connected yet. You cannot start or restore a subscription from this page.</p>
      <p class="ct-note">No payment will be taken here. Before subscriptions open, Oldtime will show the final store price, renewal terms and cancellation steps.</p>
      ${(!ios || !and || !opn) ? '<p class="ct-note">One or more mobile app links are not published yet.</p>' : `<div class="ct-row">${act(ios, "Download for iPhone")}${act(and, "Get it on Android")}${act(opn, "Open Oldtime")}</div>`}
      <div class="ct-row"><button type="button" class="ct-btn ghost" data-ct-notify ${m.interested ? "disabled" : ""}>${m.interested ? "You will be notified" : "Notify me"}</button></div><div id="ct-nmsg" role="status"></div></section>
      <section class="ct-card"><h2>Pricing</h2><ul>${terms.map(t => `<li>${t}</li>`).join("")}</ul></section>
      <section class="ct-card"><h2>Gifts and offers</h2><p>Membership gifting and the planned 50% discount on the next two eligible monthly charges after a gift are not available yet. No gift or discount will be created until purchases can be verified.</p></section>
      <section class="ct-card"><h2>Restore purchases</h2><p>Purchase restoration will be available after Apple and Google billing is configured. Existing membership status is shown only when a purchase has been verified by the server.</p></section>
      <section class="ct-card"><h2>Benefits</h2>${ben.length ? `${ben.map(b => `<details class="ct-more"><summary><span>${esc(b)}</span><i aria-hidden="true">&rsaquo;</i></summary><p>${on ? "Listed as part of your membership. Some benefits are planned and may not be operating yet." : "Listed as a planned membership benefit. It is not available to you until a membership is verified by the store, and some benefits may not be operating yet."}</p></details>`).join("")}<p class="ct-note">Some benefits are planned and not all are operating yet.</p>` : "<p>Benefits will be listed here once confirmed.</p>"}</section>
      <section class="ct-card"><h2>Questions</h2>${[["How do I get a Blue Badge?", "Subscriptions are not open yet. When available, app-store purchases will be verified by Oldtime before a badge is activated."], ["What does it cost?", "The planned standard price is " + money(m.standardPriceCents) + " per month. The store will show the final price and renewal terms before purchase."], ["Can I restore a purchase?", "Restoration is not available until Apple and Google billing are configured."], ["How do I cancel?", 'Cancel an active subscription in your app store account settings. Access continues until its verified expiration. Manage subscriptions on <a href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noopener noreferrer">Apple</a> or <a href="https://play.google.com/store/account/subscriptions" target="_blank" rel="noopener noreferrer">Google Play</a>. These links open the store and do not start a purchase.']].map(([q, a]) => `<details class="ct-more"><summary><span>${q}</span><i aria-hidden="true">&rsaquo;</i></summary><p>${a}</p></details>`).join("")}</section>`);
    bind();
    app.querySelector("[data-ct-notify]")?.addEventListener("click", async e => {
      const b = e.currentTarget; b.disabled = true;
      try { await requestCloudApi("/api/badge/interest", { method: "POST", body: {} }); if (live()) { b.textContent = "You will be notified"; toast("We will let you know"); } }
      catch (err) { if (live()) { b.disabled = false; app.querySelector("#ct-nmsg").innerHTML = `<div class="ct-msg err">${esc(err.message)}</div>`; } }
    });
  }

  async function announce() {
    let a, p;
    try { [a, p] = await Promise.all([requestCloudApi("/api/announcements"), requestCloudApi("/api/announcement-preferences")]); } catch (e) { return fail(e, announce); }
    if (!live()) return;
    const list = Array.isArray(a.announcements) ? a.announcements : [];
    const labels = { features: "New features", promotions: "Offers and promotions", creators: "Creator updates", communities: "Community updates" };
    mount(`<section class="ct-card"><h2>Inbox</h2>${list.length ? `<p>${esc(a.unreadCount)} new announcement${a.unreadCount === 1 ? "" : "s"}.</p>` : '<p class="ct-empty">Nothing new right now. Announcements stay rare and are never shown while you are posting or on a call.</p>'}</section>
      ${list.map(x => `<article class="ct-card" data-ct-ann="${esc(x.id)}"><span class="ct-eyebrow">${esc(x.category)}</span><h2>${esc(x.title)}</h2><p>${esc(x.description)}</p>
      <div class="ct-row">${x.primaryRoute ? `<button type="button" class="ct-btn" data-ct-act="${esc(x.id)}">${esc(x.primaryLabel || "Open")}</button>` : ""}
      ${x.optional ? `<span><button type="button" class="ct-btn ghost" data-ct-dis="not-now" data-id="${esc(x.id)}">Not now</button> <button type="button" class="ct-btn ghost" data-ct-dis="never" data-id="${esc(x.id)}">Never show</button></span>` : ""}</div></article>`).join("")}
      <section class="ct-card"><h2>What you hear about</h2>${Object.keys(labels).map(k => `<label class="ct-toggle"><span>${labels[k]}</span><input type="checkbox" data-ct-pref="${k}" ${p[k] ? "checked" : ""}></label>`).join("")}
      <p class="ct-note">Choosing Not now pauses an announcement for a cooldown. Never show removes it permanently.</p>
      <button type="button" class="ct-btn ghost" data-ct-reset>Reset dismissed announcements</button><div id="ct-amsg" role="status"></div></section>`);
    bind();
    const say = (t, err) => { const n = app.querySelector("#ct-amsg"); if (n && live()) n.innerHTML = `<div class="ct-msg ${err ? "err" : ""}">${esc(t)}</div>`; };
    list.forEach(x => { if (!shownSet.has(x.id)) { shownSet.add(x.id); requestCloudApi(`/api/announcements/${encodeURIComponent(x.id)}/event`, { method: "POST", body: { event: "shown" } }).catch(() => shownSet.delete(x.id)); } });
    app.querySelectorAll("[data-ct-act]").forEach(b => b.onclick = async () => {
      const x = list.find(i => i.id === b.dataset.ctAct);
      try { await requestCloudApi(`/api/announcements/${encodeURIComponent(x.id)}/event`, { method: "POST", body: { event: "action" } }); } catch { /* navigation still proceeds */ }
      if (live()) navigate(x.primaryRoute);
    });
    app.querySelectorAll("[data-ct-dis]").forEach(b => b.onclick = async () => {
      b.disabled = true;
      try { await requestCloudApi(`/api/announcements/${encodeURIComponent(b.dataset.id)}/dismiss`, { method: "POST", body: { choice: b.dataset.ctDis } }); if (live()) { app.querySelector(`[data-ct-ann="${CSS.escape(b.dataset.id)}"]`)?.remove(); toast("Preference saved"); } }
      catch (e) { b.disabled = false; say(e.message, true); }
    });
    app.querySelectorAll("[data-ct-pref]").forEach(c => c.onchange = async () => {
      const controls = [...app.querySelectorAll("[data-ct-pref]")];
      controls.forEach(control => control.disabled = true);
      p = { ...p, [c.dataset.ctPref]: c.checked };
      try { p = await requestCloudApi("/api/announcement-preferences", { method: "PUT", body: { features: !!p.features, promotions: !!p.promotions, creators: !!p.creators, communities: !!p.communities } }); say("Preferences saved"); if (live()) await announce(); }
      catch (e) { c.checked = !c.checked; p = { ...p, [c.dataset.ctPref]: c.checked }; say(e.message, true); }
      finally { controls.forEach(control => control.disabled = false); }
    });
    app.querySelector("[data-ct-reset]").onclick = async () => {
      try { await requestCloudApi("/api/announcements/reset", { method: "POST", body: {} }); shownSet = new Set(); if (live()) announce(); }
      catch (e) { say(e.message, true); }
    };
  }

  async function admin() {
    let c, analytics;
    try { [c, analytics] = await Promise.all([requestCloudApi("/api/creator/admin/config"), requestCloudApi("/api/creator/admin/analytics")]); } catch (e) { return fail(e, admin); }
    if (!live()) return;
    mount(`<section class="ct-card"><h2>Program activity</h2><div class="ct-stats">${[["Evaluated accounts", analytics.evaluatedAccounts], ["Approved creators", analytics.approvedCreators], ["Badge interest", analytics.interestedAccounts], ["Active memberships", analytics.activeMemberships], ["Announcement views", analytics.announcementViews], ["Announcement actions", analytics.announcementActions]].map(([label, value]) => `<div><b>${esc(value)}</b><span>${esc(label)}</span></div>`).join("")}</div><p class="ct-note">Views and actions are deduplicated per account, announcement and day. These totals do not include contact information.</p></section><section class="ct-card"><h2>Configuration</h2><p>Edit flags, thresholds, proposed prices, offer eligibility, published app links and campaigns as JSON. Set an openUrl only after native association files and device verification are complete. Changes are validated by the server. Billing and payouts cannot be enabled here.</p>
      <textarea class="ct-json" data-ct-json spellcheck="false" aria-label="Creator configuration JSON">${esc(JSON.stringify(c, null, 2))}</textarea>
      <div class="ct-row"><button type="button" class="ct-btn" data-ct-save>Save configuration</button><button type="button" class="ct-btn ghost" data-ct-reload>Discard changes</button></div><div id="ct-cmsg" role="status"></div></section>`);
    bind();
    const say = (t, err) => { const n = app.querySelector("#ct-cmsg"); if (n && live()) n.innerHTML = `<div class="ct-msg ${err ? "err" : ""}">${esc(t)}</div>`; };
    app.querySelector("[data-ct-reload]").onclick = admin;
    app.querySelector("[data-ct-save]").onclick = async e => {
      let parsed;
      try { parsed = JSON.parse(app.querySelector("[data-ct-json]").value); } catch (x) { return say(`Invalid JSON: ${x.message}`, true); }
      if (!parsed || typeof parsed !== "object" || !parsed.flags || !parsed.thresholds || !Array.isArray(parsed.campaigns)) return say("Config needs flags, thresholds and campaigns.", true);
      if ("billing" in parsed.flags || "payouts" in parsed.flags) return say("Billing and payout flags are not allowed.", true);
      const b = e.currentTarget; b.disabled = true;
      try { await requestCloudApi("/api/creator/admin/config", { method: "PUT", body: parsed }); if (live()) { say("Configuration saved."); toast("Configuration saved"); } }
      catch (x) { say(x.status === 403 ? "Admin access required." : x.message, true); }
      finally { b.disabled = false; }
    };
  }

  load();
}

export default renderCreatorScreen;
