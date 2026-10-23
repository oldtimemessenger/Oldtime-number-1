import "./account-professional.css";
import { api, requestCloudApi } from "./store.js";
import { icon } from "./icons.js";
import { illustration, artImg } from "./old-time-art.js";
import { bestPractices, inspiration } from "./tools-content.js";

const TITLES = { "account-type": "Account type", "personal-activity": "Your activity", "creator-studio": "Creator Studio", "business-dashboard": "Business dashboard", "monthly-recap": "Monthly recap", "best-practices": "Best practices", inspiration: "Inspiration" };
export const ACCOUNT_TOOL_ROUTES = Object.freeze(Object.keys(TITLES));
const CREATOR_CATS = ["Creator", "Artist", "Musician", "Public Figure", "Streamer", "Writer", "Athlete", "Community Leader"];
const BUSINESS_CATS = ["Business", "Local Service", "Retail", "Restaurant", "Brand", "Other"];
const DEFAULT = Object.freeze({ accountType: "personal", creatorCategory: null, businessCategory: null, website: "", location: "", contact: "", showCategory: false, showContact: false });
const METRICS = { views: "Views", profileVisits: "Profile visits", follows: "Follows", engagement: "Engagements" };
let cache = null, cacheOwner = null, loading = null, token = 0;

const owner = () => api.cloudAccountId?.() || null;
function setCache(v) { cache = { ...DEFAULT, ...v }; cacheOwner = owner(); try { window.dispatchEvent(new Event("oldtime-account-tools")); } catch { /* ignore */ } }
export function getAccountTools() { return cache && cacheOwner === owner() ? { ...cache } : { ...DEFAULT }; }
export function resetAccountTools() { cache = null; cacheOwner = null; loading = null; token++; }
export async function loadAccountTools() {
  const who = owner();
  if (!who) return { ...DEFAULT };
  if (loading && loading.who === who) return loading.p;
  const p = requestCloudApi("/api/account/professional").then(v => { if (owner() === who) setCache(v); return getAccountTools(); }).finally(() => { if (loading?.p === p) loading = null; });
  loading = { who, p };
  return p;
}

const nf = new Intl.NumberFormat();
const num = v => (v == null || Number.isNaN(Number(v)) ? "Not available" : nf.format(Number(v)));
const pct = v => (v == null ? "Not available" : `${(Number(v) * 100).toFixed(1)}%`);
const dur = ms => { if (ms == null) return "Not available"; const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };
const ymd = d => d.toISOString().slice(0, 10);
const shift = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return ymd(d); };
const fdate = v => { const d = new Date(v); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(); };

export function renderAccountToolsScreen(view, ctx) {
  if (!TITLES[view]) view = "account-type";
  const { shell, app, esc, navigate, back } = ctx;
  const my = ++token;
  const live = () => my === token && app.isConnected && app.querySelector(`[data-ap-view="${view}"]`);
  const who = owner();
  const ok = () => live() && owner() === who;
  const toast = m => ctx.toast?.(m);
  shell(`<main class="ap-wrap" data-ap-view="${view}"><header class="ap-head"><button type="button" class="ap-icon" data-ap-back aria-label="Back">${icon("back")}</button><h1>${esc(TITLES[view])}</h1><span></span></header><div id="ap-body"><div class="ap-skel"></div><div class="ap-skel"></div><div class="ap-skel"></div></div></main>`, "dark");
  const body = () => app.querySelector("#ap-body");
  app.querySelector("[data-ap-back]").onclick = () => back();
  const mount = h => { if (!ok()) return false; unmountCharts(); body().innerHTML = h; return true; };
  const unmountCharts = () => { const el = body(); if (el) el.querySelectorAll("[data-ap-chart]").forEach(c => chartMod?.unmountStudioChart(c)); };
  let chartMod = null;
  const fail = (e, retry, extra = "") => {
    const local = !who || /sign in to an online/i.test(e?.message || "");
    const t = local ? "Sign in to view your account data and engagement." : navigator.onLine === false ? "You are offline. Reconnect and try again." : e?.status === 403 ? "This account type does not have access to this page." : (e?.message || "Something went wrong.");
    if (!mount(`<div class="ap-card" role="alert"><p>${esc(t)}</p><div class="ap-row">${local ? "" : '<button type="button" class="ap-btn" data-ap-retry>Try again</button>'}${extra}<button type="button" class="ap-btn ghost" data-ap-nav="account-type">Account type</button></div></div>`)) return;
    app.querySelector("[data-ap-retry]")?.addEventListener("click", retry);
    app.querySelectorAll("[data-ap-nav]").forEach(b => b.onclick = () => navigate(b.dataset.apNav));
  };
  if (view === "account-type") typeScreen(); else if (view === "monthly-recap") recap(); else if (view === "best-practices" || view === "inspiration") guides(); else dashboard();

  async function typeScreen() {
    let t;
    try { t = await loadAccountTools(); } catch (e) { return fail(e, typeScreen); }
    if (!ok()) return;
    const draft = { ...t };
    let step = "form", err = "", busy = false;
    const opts = (list, cur) => `<option value="">Choose a category</option>${list.map(c => `<option ${c === cur ? "selected" : ""}>${esc(c)}</option>`).join("")}`;
    const desc = { personal: "For everyday sharing with friends and family.", creator: "For people building an audience. Adds Creator Studio insights.", business: "For businesses and brands. Adds a business dashboard and optional contact details." };
    const paint = () => {
      if (step === "confirm") {
        mount(`<section class="ap-card"><h2>Switch to ${esc(draft.accountType)}?</h2><ul><li>Switching is free.</li><li>Your identity, posts, follows, messages and privacy settings stay the same.</li><li>It does not grant a badge or monetization.</li><li>You keep one identity. You never need to create a new account.</li></ul>
          <div class="ap-err" role="alert">${esc(err)}</div><div class="ap-row"><button type="button" class="ap-btn" data-ap-ok ${busy ? "disabled" : ""}>${busy ? "Saving" : "Confirm switch"}</button><button type="button" class="ap-btn ghost" data-ap-edit ${busy ? "disabled" : ""}>Go back</button></div></section>`);
        app.querySelector("[data-ap-edit]").onclick = () => { step = "form"; err = ""; paint(); };
        app.querySelector("[data-ap-ok]").onclick = submit;
        return;
      }
      const ty = draft.accountType;
      mount(`<section class="ap-card"><h2>Choose how you use Oldtime</h2>${["personal", "creator", "business"].map(k => `<label class="ap-opt"><input type="radio" name="ap-type" value="${k}" ${ty === k ? "checked" : ""}><span><b>${k[0].toUpperCase() + k.slice(1)}</b><small>${desc[k]}</small></span></label>`).join("")}</section>
        ${ty === "creator" ? `<section class="ap-card"><label class="ap-lbl">Creator category<select class="ap-field" data-ap-f="creatorCategory">${opts(CREATOR_CATS, draft.creatorCategory)}</select></label><label class="ap-chk"><input type="checkbox" data-ap-c="showCategory" ${draft.showCategory ? "checked" : ""}> Show my category on my profile</label></section>` : ""}
        ${ty === "business" ? `<section class="ap-card"><label class="ap-lbl">Business category<select class="ap-field" data-ap-f="businessCategory">${opts(BUSINESS_CATS, draft.businessCategory)}</select></label>
          <label class="ap-lbl">Website (optional, https)<input class="ap-field" data-ap-f="website" inputmode="url" maxlength="200" value="${esc(draft.website)}" placeholder="https://"></label>
          <label class="ap-lbl">Location (optional)<input class="ap-field" data-ap-f="location" maxlength="100" value="${esc(draft.location)}"></label>
          <label class="ap-lbl">Contact (optional)<input class="ap-field" data-ap-f="contact" maxlength="120" value="${esc(draft.contact)}"></label>
          <label class="ap-chk"><input type="checkbox" data-ap-c="showContact" ${draft.showContact ? "checked" : ""}> Show contact details on my profile</label><label class="ap-chk"><input type="checkbox" data-ap-c="showCategory" ${draft.showCategory ? "checked" : ""}> Show my category on my profile</label></section>` : ""}
        ${ty === "personal" && (t.creatorCategory || t.businessCategory) ? '<p class="ap-note">Your professional details are kept and hidden while you are personal.</p>' : ""}
        <div class="ap-err" role="alert">${esc(err)}</div><button type="button" class="ap-btn" data-ap-next ${ty === t.accountType && JSON.stringify(draft) === JSON.stringify(t) ? "disabled" : ""}>${ty === t.accountType ? "Save changes" : "Continue"}</button>`);
      app.querySelectorAll("[name=ap-type]").forEach(r => r.onchange = () => { draft.accountType = r.value; err = ""; paint(); });
      app.querySelectorAll("[data-ap-f]").forEach(f => f.oninput = () => { draft[f.dataset.apF] = f.value || (/Category/.test(f.dataset.apF) ? null : ""); const n = app.querySelector("[data-ap-next]"); if (n) n.disabled = false; });
      app.querySelectorAll("[data-ap-c]").forEach(c => c.onchange = () => { draft[c.dataset.apC] = c.checked; const n = app.querySelector("[data-ap-next]"); if (n) n.disabled = false; });
      app.querySelector("[data-ap-next]").onclick = () => {
        err = validate();
        if (err) return paint();
        if (draft.accountType === t.accountType) return submit();
        step = "confirm"; paint();
      };
    };
    const validate = () => {
      if (draft.accountType === "creator" && !CREATOR_CATS.includes(draft.creatorCategory)) return "Choose a creator category.";
      if (draft.accountType === "business" && !BUSINESS_CATS.includes(draft.businessCategory)) return "Choose a business category.";
      if (draft.accountType === "business" && draft.website.trim() && !/^https:\/\/[^\s/]+\.[^\s]+$/i.test(draft.website.trim())) return "Website must be a valid https address.";
      return "";
    };
    async function submit() {
      busy = true; err = ""; if (step === "confirm") paint();
      const bodyData = { accountType: draft.accountType, creatorCategory: draft.creatorCategory, businessCategory: draft.businessCategory, website: draft.website.trim(), location: draft.location.trim(), contact: draft.contact.trim(), showCategory: !!draft.showCategory, showContact: !!draft.showContact };
      try {
        const res = await requestCloudApi("/api/account/professional", { method: "PUT", body: bodyData });
        if (owner() !== who) return;
        setCache(res);
        busy = false;
        if (live()) { toast("Account type updated"); navigate("settings"); }
      } catch (e) { busy = false; if (ok()) { err = e.message || "Could not save."; step = step === "confirm" ? "confirm" : "form"; paint(); } }
    }
    paint();
  }

  async function recap() {
    let t;
    try { t = await loadAccountTools(); } catch (e) { return fail(e, recap); }
    if (!ok()) return;
    const now = new Date(), y = now.getUTCFullYear(), m = now.getUTCMonth();
    const from = ymd(new Date(Date.UTC(y, m - 1, 1))), to = ymd(new Date(Date.UTC(y, m, 0)));
    const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
    let r;
    try { r = await requestCloudApi(`/api/analytics/me?mode=${t.accountType}&from=${from}&to=${to}&metric=views&page=1&type=all&sort=views`); } catch (e) { return fail(e, recap); }
    if (!ok()) return;
    const o = r.overview || {}, items = (r.content || []).slice(0, 3);
    const empty = !(Number(o.views) || Number(o.profileVisits) || Number(o.newFollowers) || Number(o.likes) || items.length);
    const late = r.trackingSince && r.trackingSince > new Date(to).getTime();
    mount(`<section class="ap-card ap-recap">${illustration("insights", "ap-tools-art")}<span class="ap-eyebrow">Last month</span><div class="ap-big">${esc(name)}</div><p class="ap-note">Measured for ${esc(from)} to ${esc(to)} (UTC).</p>${late ? '<p class="ap-note">Tracking began after this month, so there is nothing to compare.</p>' : ""}</section>
      ${empty ? '<section class="ap-card"><p class="ap-empty">No activity was measured last month. Post something this month and it will appear in next month\'s recap.</p></section>' : `<section class="ap-grid">${[["Views", num(o.views)], ["Profile visits", num(o.profileVisits)], ["New followers", num(o.newFollowers)], ["Likes", num(o.likes)], ["Comments", num(o.comments)], ["Shares", num(o.shares)]].map(([l, v]) => `<div class="ap-stat"><b>${esc(v)}</b><span>${l}</span></div>`).join("")}</section>
      <section class="ap-card"><h2>Most viewed</h2>${items.length ? items.map(i => `<div class="ap-item"><div><b>${esc(i.title || "Untitled")}</b><small>${esc(i.kind)} - ${esc(fdate(i.createdAt))}</small></div><div class="ap-mini"><span>${num(i.views)} views</span><span>${num(i.likes)} likes</span></div></div>`).join("") : '<p class="ap-empty">No individual content was measured.</p>'}</section>`}
      <button type="button" class="ap-btn ghost" data-ap-nav="${t.accountType === "personal" ? "personal-activity" : t.accountType === "creator" ? "creator-studio" : "business-dashboard"}">Open full dashboard</button>`);
    app.querySelectorAll("[data-ap-nav]").forEach(b => b.onclick = () => navigate(b.dataset.apNav));
  }

  async function guides() {
    let t = getAccountTools();
    try { t = await loadAccountTools(); } catch { /* guidance works without the type */ }
    if (!ok()) return;
    const list = view === "inspiration" ? inspiration() : bestPractices(t.accountType);
    mount(`<section class="ap-card">${illustration("insights", "ap-tools-art")}<p>${view === "inspiration" ? "Ideas built from features Oldtime already has. Nothing here is a prediction." : "Self-service guidance for your " + esc(t.accountType) + " account. These are general tips, not personal recommendations."}</p></section>
      ${list.map(a => `<details class="ap-guide"><summary>${artImg(a.art, "ap-guide-thumb", true)}<b>${esc(a.title)}</b><i aria-hidden="true">&rsaquo;</i></summary><p>${esc(a.body)}</p>${a.link ? `<button type="button" class="ap-btn small" data-ap-nav="${esc(a.link)}">${esc(a.label)}</button>` : ""}</details>`).join("")}`);
    app.querySelectorAll("[data-ap-nav]").forEach(b => b.onclick = () => navigate(b.dataset.apNav));
  }

  async function dashboard() {
    const mode = { "personal-activity": "personal", "creator-studio": "creator", "business-dashboard": "business" }[view];
    let tools;
    try { tools = await loadAccountTools(); } catch (e) { return fail(e, dashboard); }
    if (!ok()) return;
    if (tools.accountType !== mode) {
      const want = tools.accountType;
      mount(`<div class="ap-card"><p>${esc(TITLES[view])} is for ${esc(mode)} accounts. Your account is ${esc(want)}.</p><div class="ap-row"><button type="button" class="ap-btn" data-ap-nav="${want === "personal" ? "personal-activity" : want === "creator" ? "creator-studio" : "business-dashboard"}">Open the right dashboard</button><button type="button" class="ap-btn ghost" data-ap-nav="account-type">Account type</button></div></div>`);
      app.querySelectorAll("[data-ap-nav]").forEach(b => b.onclick = () => navigate(b.dataset.apNav));
      return;
    }
    const pro = mode !== "personal";
    const st = { days: 28, from: shift(27), to: ymd(new Date()), metric: "views", tab: "overview", type: "all", sort: "recent", page: 1, detail: null, contentScrollTop: 0 };
    let data = null, items = [], req = 0, rangeErr = "", more = false, loadingMore = false, moreObserver = null;
    const qs = () => `mode=${mode}&from=${st.from}&to=${st.to}&metric=${st.metric}&page=${st.page}&type=${st.type}&sort=${st.sort}`;
    async function fetchData(append) {
      if (append && loadingMore) return;
      if (!append) { moreObserver?.disconnect(); moreObserver = null; loadingMore = false; }
      if (append) loadingMore = true;
      const n = ++req;
      if (!append) { data = null; items = []; st.page = 1; paint(); }
      try {
        const r = await requestCloudApi(`/api/analytics/me?${qs()}`);
        if (n !== req || !ok()) return;
        data = r; items = append ? [...items, ...(r.content || [])] : (r.content || []); more = !!r.hasMore;
        if (append) loadingMore = false;
        paint();
      } catch (e) { if (n === req && ok()) fail(e, () => fetchData(false)); }
      finally { if (append) loadingMore = false; }
    }
    const loadNextPage = () => {
      if (loadingMore || !more || st.detail) return;
      st.page++;
      void fetchData(true);
    };
    const pill = (k, label, cur) => `<button type="button" class="${cur === k ? "on" : ""}" data-ap-set="${k}">${esc(label)}</button>`;
    const delta = v => v == null ? "No comparison yet" : `${v >= 0 ? "+" : ""}${Number(v).toFixed(1)}% vs previous period`;
    function paint() {
      moreObserver?.disconnect(); moreObserver = null;
      const scrollRootBefore = app.querySelector(".ap-wrap");
      const showingDetail = !!body()?.querySelector(".ap-post-insights");
      const scrollTop = st.detail
        ? (showingDetail ? scrollRootBefore?.scrollTop || 0 : 0)
        : (showingDetail ? st.contentScrollTop : scrollRootBefore?.scrollTop || 0);
      const screenHeader = app.querySelector(".ap-head");
      if (screenHeader) screenHeader.hidden = !!st.detail;
      const tabs = pro ? ["overview", "content", "audience", "growth", "earnings"] : ["overview", "content"];
      const head = st.detail ? "" : `<nav class="ap-tabs">${tabs.map(k => `<button type="button" data-ap-tab="${k}" class="${st.tab === k ? "on" : ""}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</nav>
        <div class="ap-range"><div class="ap-seg">${[7, 28, 90].map(d => `<button type="button" data-ap-days="${d}" class="${st.days === d ? "on" : ""}">${d} days</button>`).join("")}<button type="button" data-ap-days="0" class="${st.days === 0 ? "on" : ""}">Custom</button></div>
        ${st.days === 0 ? `<div class="ap-row"><label class="ap-lbl">From<input type="date" class="ap-field" data-ap-d="from" value="${st.from}" max="${ymd(new Date())}"></label><label class="ap-lbl">To<input type="date" class="ap-field" data-ap-d="to" value="${st.to}" max="${ymd(new Date())}"></label></div><div class="ap-err" role="alert">${esc(rangeErr)}</div>` : ""}</div>`;
      let main = "";
      if (st.detail) main = detailHtml();
      else if (st.mdetail && data) main = metricHtml();
      else if (!data) main = '<div class="ap-skel"></div><div class="ap-skel"></div><div class="ap-skel"></div>';
      else main = { overview: overviewHtml, content: contentHtml, audience: audienceHtml, growth: growthHtml, earnings: earningsHtml }[st.tab]();
      if (!mount(head + main)) return;
      const scrollRoot = app.querySelector(".ap-wrap");
      if (scrollRoot) scrollRoot.scrollTop = scrollTop;
      wire();
    }
    function card(label, v, extra = "") { return `<div class="ap-stat"><b>${esc(v)}</b><span>${esc(label)}</span>${extra ? `<small>${esc(extra)}</small>` : ""}</div>`; }
    const compact = v => (v == null ? "Not available" : new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(Number(v)));
    const ROWS = [["views", "Views", "views", "views"], ["profileVisits", "Profile visits", "profileVisits", "profileVisits"], ["newFollowers", "New followers", "follows", "newFollowers"], ["engagementRate", "Engagement rate", "engagement", "engagement"]];
    function insightsHtml(o) {
      return `<section class="ap-card ap-insights"><div class="ap-row"><h2>Insights</h2><span class="ap-range-label">${esc(fdate(st.from))} - ${esc(fdate(st.to))}</span></div>${ROWS.map(([k, l, m]) => `<button type="button" class="ap-line" data-ap-metric="${m}"><span>${l}</span><b>${k === "engagementRate" ? pct(o[k]) : compact(o[k])}</b><i aria-hidden="true">&rsaquo;</i></button>`).join("")}</section>`;
    }
    function toolsHtml() {
      const rows = [["monthly-recap", "Monthly recap", "See what you made happen last month.", "New"], ["best-practices", "Best practices", "Self-service guidance for your account type.", ""], ["inspiration", "Inspiration", "Ideas to try with Oldtime features.", ""], ["account-type", "Account type", "Switch between personal, creator and business.", ""]];
      return `<section class="ap-card ap-tools">${illustration("insights", "ap-tools-art")}<h2>Your tools</h2>${rows.map(([r, t, d, n]) => `<button type="button" class="ap-line ap-tool" data-ap-nav="${r}"><span><b>${t}</b><small>${d}</small></span>${n ? `<em class="ap-new">${n}</em>` : ""}<i aria-hidden="true">&rsaquo;</i></button>`).join("")}</section>`;
    }
    function metricHtml() {
      const o = data.overview || {}, c = data.comparison || {}, d = data.definitions || {};
      const row = ROWS.find(r => r[2] === st.metric) || ROWS[0];
      const val = row[0] === "engagementRate" ? pct(o[row[0]]) : num(o[row[0]]);
      const cmp = c[row[3]];
      const series = Array.isArray(data.series) ? data.series : [];
      const defKey = { views: "views", profileVisits: "profileVisits", engagement: "engagementRate" }[st.metric];
      return `<button type="button" class="ap-btn ghost small" data-ap-mclose>Back to insights</button><section class="ap-card"><span class="ap-eyebrow">${esc(row[1])}</span><div class="ap-big">${esc(val)}</div><p class="ap-note">${esc(fdate(st.from))} - ${esc(fdate(st.to))}. ${esc(delta(cmp))}</p>
        ${series.length ? '<div class="ap-chart" data-ap-chart role="img" aria-label="Line chart of this measure by day"></div>' : '<p class="ap-empty">No activity was recorded in this range.</p>'}
        ${defKey && d[defKey] ? `<p class="ap-note">${esc(d[defKey])}</p>` : ""}</section>`;
    }
    function overviewHtml() {
      const o = data.overview || {}, c = data.comparison || {}, d = data.definitions || {};
      const series = Array.isArray(data.series) ? data.series : [];
      return insightsHtml(o) + toolsHtml() + `<section class="ap-card"><div class="ap-row"><h2>${esc(METRICS[st.metric])} by day</h2><span class="ap-note">Tracking since ${esc(fdate(data.trackingSince) || "launch")}</span></div>
        <div class="ap-seg">${Object.keys(METRICS).map(k => pill(k, METRICS[k], st.metric)).join("")}</div>
        ${series.length ? '<div class="ap-chart" data-ap-chart role="img" aria-label="Line chart of selected metric by day"></div>' : '<p class="ap-empty">No activity was recorded in this range.</p>'}</section>
        <section class="ap-grid">${card("Views", num(o.views), delta(c.views))}${card("Profile visits", num(o.profileVisits), delta(c.profileVisits))}${card("Unique viewers", num(o.uniqueViewers))}${card("New followers", num(o.newFollowers), delta(c.newFollowers))}${card("Unfollows", num(o.unfollows))}${card("Net followers", num(o.netFollowers))}${card("Tracked followers", num(o.totalFollowers), "Follows recorded since tracking began")}${card("Likes", num(o.likes))}${card("Comments", num(o.comments))}${card("Shares", num(o.shares))}${card("Saves", num(o.saves))}${card("Engagement rate", pct(o.engagementRate), delta(c.engagement))}${o.watchTimeMs != null ? card("Watch time", dur(o.watchTimeMs)) + card("Average watch time", dur(o.averageWatchTimeMs)) + card("Completion rate", pct(o.completionRate)) : ""}</section>
        <details class="ap-guide ap-about"><summary><b>About these insights</b><i aria-hidden="true">&rsaquo;</i></summary><ul>${["views", "uniqueViewers", "engagementRate", "profileVisits"].filter(k => d[k]).map(k => `<li>${esc(d[k])}</li>`).join("")}</ul>${(data.unavailable || []).length ? `<p class="ap-note">Not available yet: ${esc(data.unavailable.join(", "))}.</p>` : ""}</details>`;
    }
    function contentHtml() {
      const types = ["all", "video", "photo", "text", "story", "blast"];
      return `<div class="ap-row"><label class="ap-lbl">Type<select class="ap-field" data-ap-sel="type">${types.map(t => `<option value="${t}" ${st.type === t ? "selected" : ""}>${t[0].toUpperCase() + t.slice(1)}</option>`).join("")}</select></label>
        <label class="ap-lbl">Sort<select class="ap-field" data-ap-sel="sort">${[["recent", "Most recent"], ["views", "Most views"], ["engagement", "Most engagement"]].map(([v, l]) => `<option value="${v}" ${st.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
        ${items.length ? items.map(i => `<article class="ap-item"><div><b>${esc(i.title || "Untitled")}</b><small>${esc(i.kind)} - ${esc(fdate(i.createdAt))}</small></div><div class="ap-mini"><span>${num(i.views)} views</span><span>${num(i.likes)} likes</span><span>${num(i.comments)} comments</span></div><button type="button" class="ap-btn ghost small" data-ap-insight="${esc(i.id)}">View Insights</button></article>`).join("") : '<p class="ap-empty">No content found for this range and filter.</p>'}
        ${more ? '<button type="button" class="ap-btn ghost" data-ap-more>Load more</button>' : ""}`;
    }
    function audienceHtml() {
      const a = data.audience || {}, act = Array.isArray(a.activity) ? a.activity : [];
      return `<section class="ap-card"><h2>When your audience is active</h2>${act.length ? '<div class="ap-chart" data-ap-chart role="img" aria-label="Bar chart of audience events by hour"></div><p class="ap-note">Events are summed across the selected days, in UTC, as reported by the server. Rows below the privacy minimum are left out.</p>' : '<p class="ap-empty">Not enough activity to show this without exposing individuals.</p>'}</section>
        <section class="ap-card"><h2>Demographics</h2><p>${a.demographicsAvailable ? "Available." : "Age, gender and location breakdowns are not collected, so none are shown."}</p></section>`;
    }
    function growthHtml() {
      const g = Array.isArray(data.growth) ? data.growth : [];
      return `<section class="ap-card"><h2>Growth notes</h2>${g.length ? `<ul>${g.map(x => `<li><b>${esc(x.text)}</b><br><small>${esc(x.reason)}</small></li>`).join("")}</ul>` : '<p class="ap-empty">No measured growth insights yet. They appear once there is enough data.</p>'}</section>`;
    }
    function earningsHtml() {
      const e = data.earnings || {};
      return `<section class="ap-card"><h2>Earnings</h2><p>${esc(e.reason || "Earnings are not available.")}</p><p class="ap-note">No balance is shown because no payouts exist.</p><button type="button" class="ap-btn ghost" data-ap-nav="blue-badge">Blue Badge membership</button></section>`;
    }
    function detailHtml() {
      const d = st.detail;
      if (d.error) return `<div class="ap-post-insights"><div class="ap-post-top"><button type="button" class="ap-post-back" data-ap-close aria-label="Back to content">${icon("back")}</button><div><span>CONTENT INSIGHTS</span><h2>Insights unavailable</h2></div></div><section class="ap-post-panel" role="alert"><p>${esc(d.error)}</p><button type="button" class="ap-btn ghost small" data-ap-close>Back to content</button></section></div>`;
      if (!d.item) return `<div class="ap-post-insights"><div class="ap-post-top"><button type="button" class="ap-post-back" data-ap-close aria-label="Back to content">${icon("back")}</button><div><span>CONTENT INSIGHTS</span><h2>Loading insights</h2></div></div><div class="ap-skel"></div><div class="ap-skel"></div></div>`;
      const i = d.item, ret = Array.isArray(i.retention) ? i.retention : [], src = Array.isArray(i.sources) ? i.sources : [];
      const isVideo = /video|reel|clip/i.test(String(i.kind || ""));
      const detailTabs = ["overview", "engagement", "audience"];
      const action = (name, label, value) => `<div class="ap-post-action">${icon(name)}<b>${esc(num(value))}</b><span>${esc(label)}</span></div>`;
      const summary = `<section class="ap-post-summary" aria-label="Post performance summary">
        ${card("Views", num(i.views))}
        ${card("Viewers", num(i.uniqueViewers))}
        ${isVideo ? card("Average watch", dur(i.averageWatchTimeMs)) : card("Profile visits", num(i.profileVisits))}
        ${card("Follows", num(i.follows))}
      </section>`;
      const engagement = `<section class="ap-post-panel"><div class="ap-post-section-heading"><div><span class="ap-eyebrow">Interaction</span><h2>Engagement</h2></div><span class="ap-range-label">${esc(fdate(st.from))} – ${esc(fdate(st.to))}</span></div>
        <div class="ap-post-actions">${action("heart", "Likes", i.likes)}${action("comment", "Comments", i.comments)}${action("share", "Shares", i.shares)}${action("bookmark", "Saves", i.saves)}</div>
        <div class="ap-post-engagement-total"><span>Total interactions</span><b>${esc(num((Number(i.likes) || 0) + (Number(i.comments) || 0) + (Number(i.shares) || 0) + (Number(i.saves) || 0)))}</b></div>
        ${i.views ? `<p class="ap-note">Interactions are reported counts for this content; no audience identities are shown.</p>` : '<p class="ap-empty">Engagement details will appear when activity is measured.</p>'}</section>`;
      const audience = `<section class="ap-post-panel"><div class="ap-post-section-heading"><div><span class="ap-eyebrow">Discovery</span><h2>Audience</h2></div></div>
        <div class="ap-post-audience-row"><span>Unique viewers</span><b>${esc(num(i.uniqueViewers))}</b></div>
        <div class="ap-post-audience-row"><span>Profile visits</span><b>${esc(num(i.profileVisits))}</b></div>
        <div class="ap-post-audience-row"><span>Follows</span><b>${esc(num(i.follows))}</b></div>
        <h3>Where views came from</h3>
        ${src.length ? `<div class="ap-post-sources">${src.map(s => `<div class="ap-post-source"><span>${esc(s.source)}</span><b>${esc(num(s.views))}</b><span class="ap-post-source-track" aria-hidden="true"><i style="--source-share:${Math.max(4, Math.min(100, (Number(s.views) / Math.max(1, ...src.map(row => Number(row.views) || 0))) * 100))}%"></i></span></div>`).join("")}</div>` : '<p class="ap-empty">Source details are not available for this post yet.</p>'}
        <p class="ap-note">Viewer identities and personal audience details are not shown.</p></section>`;
      let panel = "";
      if (d.tab === "engagement") panel = engagement;
      else if (d.tab === "audience") panel = audience;
      else panel = `${summary}${isVideo ? `<section class="ap-post-panel"><div class="ap-post-section-heading"><div><span class="ap-eyebrow">Video performance</span><h2>Watch retention</h2></div></div>${ret.length ? '<p class="ap-note">Share of measured playback starts that reached each watched-duration mark. This is time watched, not exact playhead position.</p><div class="ap-chart" data-ap-chart role="img" aria-label="Watched-duration retention by duration watched, 0 to 100 percent"></div>' : '<p class="ap-empty">Retention appears after at least 10 measured video starts.</p>'}</section>` : ""}
        <section class="ap-post-panel"><div class="ap-post-section-heading"><div><span class="ap-eyebrow">At a glance</span><h2>Engagement</h2></div><button type="button" class="ap-post-text-action" data-ap-detail-tab="engagement">See all</button></div><div class="ap-post-actions">${action("heart", "Likes", i.likes)}${action("comment", "Comments", i.comments)}${action("share", "Shares", i.shares)}${action("bookmark", "Saves", i.saves)}</div><div class="ap-post-engagement-total"><span>Total interactions</span><b>${esc(num((Number(i.likes) || 0) + (Number(i.comments) || 0) + (Number(i.shares) || 0) + (Number(i.saves) || 0)))}</b></div></section>`;
      return `<div class="ap-post-insights">
        <div class="ap-post-top"><button type="button" class="ap-post-back" data-ap-close aria-label="Back to content">${icon("back")}</button><div><span>CONTENT INSIGHTS</span><h2>${isVideo ? "Video insights" : "Post insights"}</h2></div><span class="ap-post-period">${esc(fdate(st.from))} – ${esc(fdate(st.to))}</span></div>
        <section class="ap-post-identity"><div class="ap-post-kind">${icon(isVideo ? "video" : i.kind === "photo" || i.kind === "image" ? "image" : "edit")}</div><div><h1>${esc(i.title || "Untitled")}</h1><p>${esc(String(i.kind || "Post"))} <span aria-hidden="true">·</span> ${esc(fdate(i.createdAt) || "Date unavailable")}</p></div></section>
        <nav class="ap-post-tabs" aria-label="Post insight sections">${detailTabs.map(tab => `<button type="button" data-ap-detail-tab="${tab}" class="${(d.tab || "overview") === tab ? "on" : ""}" aria-pressed="${(d.tab || "overview") === tab}">${tab[0].toUpperCase() + tab.slice(1)}</button>`).join("")}</nav>
        ${panel}
      </div>`;
    }
    async function drawChart() {
      const el = body()?.querySelector("[data-ap-chart]");
      if (!el) return;
      let props;
      if (st.detail?.item) props = { kind: "line", data: st.detail.item.retention.map(r => ({ x: `${r.percent}%`, y: Math.round(Math.min(1, Math.max(0, Number(r.value) || 0)) * 1000) / 10 })), xKey: "x", yKey: "y", xLabel: "Duration watched (%)", yLabel: "Watched-duration retention", yPercent: true };
      else if (st.tab === "audience") {
        const by = Array.from({ length: 24 }, (_, h) => ({ x: h, y: 0 }));
        (data.audience?.activity || []).forEach(r => { if (by[r.hour]) by[r.hour].y += Number(r.events) || 0; });
        props = { kind: "bar", data: by, xKey: "x", yKey: "y", xLabel: "Hour of day", yLabel: "Events" };
      } else if (st.mdetail || true) props = { kind: "line", data: data.series.map(s => ({ x: s.day, y: s[st.metric] ?? 0 })), xKey: "x", yKey: "y", xLabel: "Day", yLabel: METRICS[st.metric] };
      try { chartMod = chartMod || await import("./studio-charts.jsx"); } catch { if (ok()) el.innerHTML = '<p class="ap-empty">The chart could not load.</p>'; return; }
      if (ok() && el.isConnected) chartMod.mountStudioChart(el, props);
    }
    function wire() {
      app.querySelectorAll("[data-ap-tab]").forEach(b => b.onclick = () => { st.tab = b.dataset.apTab; st.detail = null; st.mdetail = false; paint(); });
      app.querySelectorAll("[data-ap-metric]").forEach(b => b.onclick = () => { st.metric = b.dataset.apMetric; st.mdetail = true; paint(); });
      app.querySelector("[data-ap-mclose]")?.addEventListener("click", () => { st.mdetail = false; paint(); });
      app.querySelectorAll("[data-ap-set]").forEach(b => b.onclick = () => { st.metric = b.dataset.apSet; paint(); });
      app.querySelectorAll("[data-ap-days]").forEach(b => b.onclick = () => {
        const d = Number(b.dataset.apDays); st.days = d; rangeErr = "";
        if (d) { st.from = shift(d - 1); st.to = ymd(new Date()); fetchData(false); } else paint();
      });
      app.querySelectorAll("[data-ap-d]").forEach(i => i.onchange = () => {
        st[i.dataset.apD] = i.value;
        const span = (new Date(st.to) - new Date(st.from)) / 864e5 + 1;
        if (!st.from || !st.to || span < 1) rangeErr = "End date must be on or after the start date.";
        else if (span > 90) rangeErr = "Choose a range of 90 days or fewer.";
        else if (st.to > ymd(new Date())) rangeErr = "Dates cannot be in the future.";
        else { rangeErr = ""; return fetchData(false); }
        paint();
      });
      app.querySelectorAll("[data-ap-sel]").forEach(s => s.onchange = () => { st[s.dataset.apSel] = s.value; fetchData(false); });
      const moreButton = app.querySelector("[data-ap-more]");
      moreButton?.addEventListener("click", loadNextPage);
      const scrollRoot = app.querySelector(".ap-wrap");
      if (moreButton && more && !loadingMore && !st.detail && scrollRoot && "IntersectionObserver" in window) {
        moreObserver = new IntersectionObserver(entries => {
          if (entries.some(entry => entry.isIntersecting)) loadNextPage();
        }, { root: scrollRoot, rootMargin: "240px 0px" });
        moreObserver.observe(moreButton);
      }
      app.querySelectorAll("[data-ap-nav]").forEach(b => b.onclick = () => navigate(b.dataset.apNav));
      app.querySelectorAll("[data-ap-insight]").forEach(b => b.onclick = () => openDetail(b.dataset.apInsight));
      app.querySelectorAll("[data-ap-detail-tab]").forEach(b => b.onclick = () => {
        if (!st.detail) return;
        st.detail.tab = b.dataset.apDetailTab;
        paint();
      });
      app.querySelectorAll("[data-ap-close]").forEach(b => b.onclick = () => { st.detail = null; paint(); });
      if (st.detail?.item || (data && (st.mdetail || ["overview", "audience"].includes(st.tab)) && !st.detail)) drawChart();
    }
    async function openDetail(id) {
      st.contentScrollTop = app.querySelector(".ap-wrap")?.scrollTop || 0;
      const mine = st.detail = { id, tab: "overview" };
      paint();
      try {
        const item = await requestCloudApi(`/api/analytics/content/${encodeURIComponent(id)}?from=${st.from}&to=${st.to}`);
        if (st.detail !== mine || !ok()) return;
        mine.item = item; paint();
      } catch (e) { if (st.detail === mine && ok()) { mine.error = e.message || "Insights could not be loaded."; paint(); } }
    }
    fetchData(false);
  }
}

export default renderAccountToolsScreen;
