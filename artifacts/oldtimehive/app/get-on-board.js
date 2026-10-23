import "./get-on-board.css";
import { requestCloudApi } from "./store.js";
import { openPlacePicker } from "./place-picker.js";
import { readInterests } from "./interests.js";
import { CATEGORIES, FORMATS, VISIBILITY, isUuid, forYouPlan, rankBoards, parseBoardLink, boardLink, uuid, boardIdFrom, entriesUrl, acceptFor, canText, checkFile, toJpeg, clearEntryDraft } from "./get-on-board-core.js";

export { parseBoardLink, boardLink };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nm = u => u?.displayName || u?.username || "Someone";
const label = s => String(s || "").replace("_", "-");
const B = `/api/boards`;
let cfg = { accountId: "", toast: () => {}, onShare: null, onEdit: null };
let root = null, opener = null, ui = null, urls = new Map(), seq = 0, pageObserver = null;

/** Optional one-time setup from the parent: accountId (for local interests), toast, onShare, onEdit. */
export function initGetOnBoard(o = {}) { cfg = { ...cfg, ...o }; }
/** Returns {boardId, entryId?} when the current URL (or given string) is a Get On Board link. Never posts anything. */
export function detectBoardLink(input = globalThis.location?.search || "") { return parseBoardLink(input); }
export function closeGetOnBoard() { if (!root) return; pageObserver?.disconnect(); pageObserver = null; seq++; for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); ui?.pv && URL.revokeObjectURL(ui.pv); root.remove(); root = null; ui = null; document.body.classList.remove("gob-open"); opener?.isConnected && opener.focus?.(); opener = null; }

export function openGetOnBoard({ boardId, entryId, toast, onShare, onEdit, accountId } = {}) {
  cfg = { ...cfg, ...(toast && { toast }), ...(onShare && { onShare }), ...(onEdit && { onEdit }), ...(accountId && { accountId }) };
  if (root) closeGetOnBoard();
  opener = document.activeElement;
  ui = { stack: [], sort: "for_you", cat: "", q: "", mine: false, boards: [], more: false, loading: false, err: "", busy: "", sheet: null, entries: [], emore: false, esort: "newest", emine: false, comments: [], pv: null, pvType: "" };
  root = document.createElement("div"); root.className = "gob"; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Get On Board");
  root.addEventListener("click", onClick); root.addEventListener("submit", onSubmit); root.addEventListener("keydown", e => { if (e.key === "Escape" && !ui.busy) { ui.sheet ? (ui.sheet = null, draw()) : back(); } });
  document.body.appendChild(root); document.body.classList.add("gob-open");
  if (isUuid(boardId)) { ui.stack = [{ s: "home" }]; showBoard(boardId, entryId); } else { ui.stack = [{ s: "home" }]; draw(); loadBoards(true); }
}

const cur = () => ui.stack.at(-1);
const curBoard = () => boardIdFrom(ui.stack, ui.board);
const say = m => cfg.toast?.(m);
const fail = e => { ui.err = e?.message || "Something went wrong."; };
async function api(path, opts) {
  const state = ui, result = await requestCloudApi(path, opts);
  if (ui !== state) throw new DOMException("Board screen closed", "AbortError");
  return result;
}
function patchEntry(entry) { ui.entry = entry; ui.entries = ui.entries.map(row => row.id === entry.id ? { ...row, ...entry } : row); }
function push(s) { ui.stack.push(s); ui.err = ""; ui.sheet = null; }
function back() { if (ui.busy) return; if (ui.stack.length > 1) { const old = ui.stack.pop(); if (old.s === "entry") { ui.comments = []; } if (old.s === "compose") clearEntryDraft(ui); ui.err = ""; ui.sheet = null; draw(); if (cur().s === "home") loadBoards(true); } else closeGetOnBoard(); }
function wipeMedia(keep) { for (const [k, u] of urls) if (!keep?.has(k)) { URL.revokeObjectURL(u); urls.delete(k); } }
async function media(path, key) {
  if (urls.has(key)) return urls.get(key);
  const my = seq, blob = await api(path, { responseType: "blob" });
  if (my !== seq || !root) return "";
  const u = URL.createObjectURL(blob); urls.set(key, u); return u;
}
function hydrate() {
  root.querySelectorAll("[data-media]").forEach(async el => {
    if (el.dataset.done) return; el.dataset.done = "1";
    try { const u = await media(el.dataset.media, el.dataset.key); if (u && el.isConnected) el.src = u; } catch { if (el.isConnected) el.replaceWith(Object.assign(document.createElement("span"), { className: "tx", textContent: "Media unavailable" })); }
  });
}

// ---------- data ----------
async function loadBoards(reset) {
  if (ui.loading && !reset) return;
  const state = ui, request = ui.request = (ui.request || 0) + 1;
  ui.loading = true; ui.err = ""; if (reset) { ui.boards = []; ui.off = 0; } draw();
  try {
    let sort = ui.sort, cat = ui.cat, rank = [];
    if (sort === "for_you") { const p = forYouPlan(cfg.accountId ? readInterests(cfg.accountId) : null); sort = p.sort; cat = cat || p.category; rank = p.rank; }
    const p = new URLSearchParams({ sort, offset: String(ui.off || 0) }); if (cat) p.set("category", cat); if (ui.q.trim()) p.set("q", ui.q.trim()); if (ui.mine) p.set("mine", "true");
    const r = await api(`${B}?${p}`); if (!root || ui !== state || request !== ui.request) return;
    const got = r.boards || []; ui.off = (ui.off || 0) + got.length; ui.more = !!r.hasMore;
    const seen = new Set(ui.boards.map(b => b.id)); ui.boards = ui.boards.concat(got.filter(b => !seen.has(b.id)));
    if (rank.length) ui.boards = rankBoards(ui.boards, rank);
  } catch (e) { if (ui === state && request === ui.request) fail(e); }
  if (ui === state && request === ui.request) { ui.loading = false; if (root) draw(); }
}
async function showBoard(id, entryId) {
  ui.stack.push({ s: "board", id }); ui.board = null; ui.entries = []; ui.err = ""; ui.esort = "newest"; ui.emine = false; draw();
  await loadEntries(true, id);
  if (entryId && root && !ui.err) openEntry(entryId);
}
async function loadEntries(reset, id = curBoard()) {
  if (!isUuid(id)) { ui.err = "This board could not be opened."; return draw(); }
  if (ui.loading && !reset) return;
  const state = ui, request = ui.request = (ui.request || 0) + 1;
  ui.loading = true; ui.err = ""; if (reset) { ui.entries = []; ui.eoff = 0; wipeMedia(); } draw();
  try {
    const p = new URLSearchParams({ sort: ui.esort, offset: String(ui.eoff || 0) }); if (ui.emine) p.set("mine", "true");
    const r = await api(`${B}/${id}?${p}`); if (!root || ui !== state || request !== ui.request) return;
    ui.board = r.board; ui.eoff = (ui.eoff || 0) + (r.entries || []).length; ui.emore = !!r.hasMore;
    const seen = new Set(ui.entries.map(e => e.id)); ui.entries = ui.entries.concat((r.entries || []).filter(e => !seen.has(e.id)));
  } catch (e) { if (ui === state && request === ui.request) fail(e); }
  if (ui === state && request === ui.request) { ui.loading = false; if (root) draw(); }
}
async function openEntry(entryId) {
  const bid = curBoard(); if (!isUuid(bid)) { ui.err = "This board could not be opened."; return draw(); } push({ s: "entry", id: bid, entryId }); ui.entry = null; ui.comments = []; draw();
  try {
    const [en, cm] = await Promise.all([api(`${B}/${bid}/entries/${entryId}`), api(`${B}/${bid}/entries/${entryId}/comments`).catch(() => ({ comments: [] }))]);
    if (!root || cur().entryId !== entryId) return; ui.entry = en.entry || en; ui.comments = cm.comments || [];
    if (!ui.board || ui.board.id !== bid) { const r = await api(`${B}/${bid}?offset=0`); ui.board = r.board; }
  } catch (e) { fail(e); }
  if (root) draw();
}
async function act(key, fn) { if (ui.busy) return; const state = ui; ui.busy = key; ui.err = ""; draw(); try { await fn(); } catch (e) { if (ui === state) fail(e); } if (ui === state) { ui.busy = ""; if (root) draw(); } }

// ---------- views ----------
const head = t => `<header class="gob-head"><button class="ib" data-a="back" aria-label="${ui.stack.length > 1 ? "Back" : "Close"}">${ui.stack.length > 1 ? "&#8592;" : "&#10005;"}</button><h2>${esc(t)}</h2>${cur().s === "home" ? `<button class="hbtn" data-a="new" aria-label="Start a board">New board</button>` : ""}</header>`;
const errv = () => ui.err ? `<p class="err" role="alert">${esc(ui.err)} <button class="lnk" data-a="retry">Retry</button></p>` : "";
const skels = (n, sq) => Array.from({ length: n }, () => `<div class="skel ${sq ? "sq" : ""}"></div>`).join("");
function draw() {
  if (!root) return; const s = cur().s, sc = root.querySelector(".gob-body")?.scrollTop || 0;
  pageObserver?.disconnect(); pageObserver = null;
  const body = { home, board: boardV, entry: entryV, compose: composeV, create: createV }[s]();
  root.innerHTML = `${head({ home: "Get On Board", board: ui.board?.prompt ? "Board" : "Board", entry: "Entry", compose: "Add your entry", create: "Start a board" }[s])}<main class="gob-body" aria-busy="${ui.loading}">${body}</main>${ui.sheet ? sheetV() : ""}`;
  root.querySelector(".gob-body").scrollTop = sc; hydrate(); observeMore();
}
function observeMore() {
  const body = root?.querySelector(".gob-body");
  if (!body || ui.loading || ui.err || !("IntersectionObserver" in window)) return;
  const sentinel = body.querySelector(cur().s === "home" ? '[data-a="more"]' : cur().s === "board" ? '[data-a="emore"]' : "");
  if (!sentinel) return;
  pageObserver = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting) || ui.loading || ui.err) return;
    if (cur().s === "home") void loadBoards(false);
    else if (cur().s === "board") void loadEntries(false);
  }, { root: body, rootMargin: "240px 0px" });
  pageObserver.observe(sentinel);
}
function home() {
  const list = ui.boards;
  const sv = ui.mine ? "mine" : ui.sort, plan = ui.sort === "for_you" && cfg.accountId ? forYouPlan(readInterests(cfg.accountId)) : null;
  return `<section class="browse-intro"><span class="eyebrow">OLDTIME · COMMUNITY</span><h3>Find a prompt worth answering.</h3><p>Open a board, add your photo, video or words, and keep the conversation in one place.</p></section>
  <form class="filters" data-f="search" role="search"><label class="filter-sort"><span>Browse</span><select data-fsort aria-label="Sort boards">${[["for_you", "For you"], ["popular", "Popular"], ["newest", "Newest"], ["mine", "Created by me"], ["surprise", "Surprise me"]].map(([k, t]) => `<option value="${k}" ${sv === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
  <label class="filter-category"><span>Category</span><select data-fcat aria-label="Category"><option value="">All categories</option>${CATEGORIES.map(c => `<option value="${c}" ${ui.cat === c ? "selected" : ""}>${c[0].toUpperCase() + c.slice(1)}</option>`).join("")}</select></label>
  <label class="filter-search"><span>Search prompts</span><input type="search" name="q" value="${esc(ui.q)}" placeholder="Try a topic or phrase" aria-label="Search boards"></label><button class="hbtn" type="submit">Search</button></form>
  ${errv()}
  ${list.map((b, i) => `<button class="card board-card c-${esc(b.category)}" data-board="${esc(b.id)}" style="animation-delay:${Math.min(i, 8) * 24}ms"><span class="board-card-top"><span class="eyebrow">${esc(b.category)} <i aria-hidden="true">/</i> ${esc(b.format)}</span><span class="open-mark" aria-hidden="true">Open</span></span><b>${esc(b.prompt)}</b><span class="board-card-bottom"><span class="meta">By ${esc(nm(b.creator))}${b.entryCount != null ? ` · ${esc(b.entryCount)} entries` : ""}${b.participantCount != null ? ` · ${esc(b.participantCount)} people` : ""}</span><span class="tag">${esc(label(b.visibility))}</span>${b.status === "closed" ? ' <span class="tag closed-tag">Closed</span>' : ""}</span></button>`).join("")}
  ${ui.loading ? skels(3) : ""}
  ${!ui.loading && !list.length && !ui.err ? `<div class="empty"><b>${ui.q || ui.cat || ui.mine ? "No boards match" : "No boards yet"}</b><span>Start a prompt and invite people to get on board.</span><button class="btn sm" data-a="new">Start a board</button></div>` : ""}
  ${ui.more && !ui.loading ? `<button class="btn sec" data-a="more">Load more</button>` : ""}
  <button class="lnk" data-a="blocked">Blocked people</button>`;
}
function boardV() {
  const b = ui.board; if (!b) return ui.err ? errv() + `<button class="btn sec" data-a="back">Back</button>` : skels(2);
  const open = b.status === "open";
  return `<section class="board-detail"><span class="eyebrow">${esc(b.category)} <i aria-hidden="true">/</i> ${esc(b.format)} <i aria-hidden="true">/</i> ${esc(label(b.visibility))}${open ? "" : " / Closed"}</span><h3>${esc(b.prompt)}</h3>
  <span class="meta">By ${esc(nm(b.creator))}${b.entryCount != null ? ` · ${esc(b.entryCount)} entries` : ""}${b.participantCount != null ? ` · ${esc(b.participantCount)} people` : ""}</span>${b.rules ? `<p class="note rules-note"><b>Rules</b><br>${esc(b.rules)}</p>` : ""}</section>
  <div class="board-actions"><button class="btn" data-a="add" ${open ? "" : "disabled"}>${open ? "Add your entry" : "Board closed"}</button><button class="btn sec" data-a="sharesheet" data-t="board">Share board</button>${b.canManage ? `<button class="btn sec" data-a="manage">Manage</button>` : ""}<button class="lnk" data-a="reportb">Report</button>${!b.canManage && b.creator?.id ? `<button class="lnk bad" data-a="block" data-who='${esc(JSON.stringify({ id: b.creator.id, displayName: nm(b.creator) }))}'>Block creator</button>` : ""}</div>
  <p class="access-note">${esc(VISIBILITY[b.visibility] || "")}</p>
  <div class="collection-tools"><select data-esort-select aria-label="Sort entries">${[["newest","Newest"],["popular","Popular"],["surprise","Surprise"],["mine","My entries"]].map(([key,title])=>`<option value="${key}" ${(ui.emine ? "mine" : ui.esort) === key ? "selected" : ""}>${title}</option>`).join("")}</select><span>${b.entryCount} entries</span></div>
  ${errv()}
  <div class="grid">${ui.entries.map(e => `<button class="tile ${e.removed ? "off" : ""}" data-entry="${esc(e.id)}" aria-label="Open entry by ${esc(nm(e.author))}">${e.mediaType === "image" || e.mediaType === "photo" ? `<img alt="" loading="lazy" data-media="${B}/${esc(b.id)}/entries/${esc(e.id)}/media" data-key="${esc(e.id)}">` : `<span class="tx ${e.mediaType === "video" ? "video-tile" : ""}">${e.mediaType === "video" ? '<span class="play-mark" aria-hidden="true">▶</span>' : ""}${esc(e.caption || (e.mediaType === "video" ? "Watch video" : ""))}</span>`}<span class="bd"><span>${esc(nm(e.author))}${e.pinned ? " · Pinned" : ""}</span><span>${esc(e.likes)} likes</span></span></button>`).join("")}${ui.loading ? skels(4, 1) : ""}</div>
  ${!ui.loading && !ui.entries.length && !ui.err ? `<div class="empty"><b>No entries yet</b><span>${open ? "Be the first to get on board." : "This board is closed."}</span></div>` : ""}
  ${ui.emore && !ui.loading ? `<button class="btn sec" data-a="emore">Load more</button>` : ""}`;
}
function entryV() {
  const e = ui.entry, b = ui.board; if (!e || !b) return ui.err ? errv() : skels(3);
  const vid = e.mediaType === "video", img = e.mediaType === "image" || e.mediaType === "photo", path = `${B}/${b.id}/entries/${e.id}/media`;
  return `${img ? `<img class="media" alt="Entry by ${esc(nm(e.author))}" data-media="${path}" data-key="${esc(e.id)}">` : vid ? `<video class="media" controls playsinline data-media="${path}" data-key="${esc(e.id)}"></video>` : ""}
  ${e.caption ? `<p style="margin:0;font-size:${img || vid ? 15 : 20}px;line-height:1.4">${esc(e.caption)}</p>` : ""}
  <div class="meta">${esc(nm(e.author))}${e.pinned ? ", pinned" : ""}${e.removed ? ", removed from collection" : ""}</div>
  ${e.place?.label ? `<span class="entry-place">${esc(e.place.label)}</span>` : ""}
  <div class="row wrap"><button class="heart" data-a="like" aria-pressed="${!!e.likedByMe}" ${ui.busy ? "disabled" : ""}>${e.likedByMe ? "Liked" : "Like"} ${e.likes}</button><button class="btn sec sm" data-a="sharesheet" data-t="entry">Share</button>
  ${e.canDelete ? `<button class="btn sec sm" data-a="edit">Edit</button>` : ""}
  ${e.canManage ? `<button class="btn sec sm" data-a="pin">${e.pinned ? "Unpin" : "Pin"}</button><button class="btn sec sm" data-a="rm">${e.removed ? "Restore to collection" : "Remove from collection"}</button>` : ""}
  ${e.canDelete ? `<button class="lnk bad" data-a="del">Delete mine</button>` : ""}<button class="lnk" data-a="reporte">Report</button>${!e.canDelete && e.author?.id ? `<button class="lnk bad" data-a="block" data-who='${esc(JSON.stringify({ id: e.author.id, displayName: nm(e.author) }))}'>Block author</button>` : ""}</div>
  ${e.canManage && !e.canDelete ? `<p class="note">Removing hides this from the collection only. The author keeps their original.</p>` : ""}${errv()}
  <h3 style="margin:6px 0 0;font-size:14px">Comments</h3>
  ${b.commentsEnabled ? `<form class="row" data-f="comment"><input name="text" maxlength="500" placeholder="Add a comment" aria-label="Comment" required><button class="btn sm" ${ui.busy ? "disabled" : ""}>Post</button></form>` : `<p class="note">Comments are off for this board.</p>`}
  ${ui.comments.map(c => `<div class="cm"><span><b>${esc(nm(c.author))}</b> ${esc(c.text)}</span>${c.canDelete ? `<button class="lnk bad" style="align-self:flex-start" data-delc="${esc(c.id)}">Delete</button>` : ""}</div>`).join("") || (b.commentsEnabled ? `<p class="note">No comments yet.</p>` : "")}`;
}
function composeV() {
  const b = ui.board, f = b.format, text = canText(f), fileOk = f !== "text", c = ui.cmp || {};
  return `<form data-f="entry" class="row" style="flex-direction:column;align-items:stretch;gap:12px">
  <p class="compose-prompt">${esc(b.prompt)}</p><p class="access-note">${esc(VISIBILITY[b.visibility] || "")}</p>
  ${fileOk ? `<div class="pickrow"><label class="btn sec sm pk">${f === "video" ? "Record video" : "Camera"}<input type="file" class="sr" accept="${f === "video" ? "video/*" : "image/*"}" capture="environment" data-pick data-src="camera"></label><label class="btn sec sm pk">${f === "photo" ? "Photo library" : f === "video" ? "Video library" : "Photos and videos"}<input type="file" class="sr" name="file" accept="${acceptFor(f)}" data-pick data-src="gallery"></label></div>` : ""}
  ${ui.pv ? (ui.pvType === "video" ? `<video class="media" src="${ui.pv}" controls playsinline></video>` : `<img class="media" src="${ui.pv}" alt="Preview of your entry">`) : ""}
  <label>${text && !ui.pv && f !== "mixed" || f === "text" ? "Your text" : "Caption"}<textarea name="caption" rows="${f === "text" ? 6 : 3}" maxlength="1000" ${f === "text" ? "required" : ""}>${esc(c.caption || "")}</textarea></label>
  <button class="btn sec sm" type="button" data-a="place">${c.place ? esc(c.place.label) : "Add place"}</button>
  ${ui.pv ? `<button class="lnk" type="button" data-a="removefile">Remove media</button>` : ""}
  ${ui.busy === "send" ? `<div class="bar"><i style="width:60%"></i></div>` : ""}${errv()}
  <div class="row"><button class="btn sec" type="button" data-a="back">Cancel</button><button class="btn" style="flex:1" ${ui.busy ? "disabled" : ""}>${ui.busy === "send" ? "Posting" : ui.err ? "Retry" : "Add to board"}</button></div></form>`;
}
function createV() {
  const c = ui.draft || (ui.draft = { prompt: "", format: "mixed", category: "creative", visibility: "invite_only", rules: "", commentsEnabled: true });
  return `<form data-f="create" class="row" style="flex-direction:column;align-items:stretch;gap:12px">
  <label>Prompt<textarea name="prompt" rows="2" maxlength="140" required placeholder="Show us...">${esc(c.prompt)}</textarea></label>
  <div class="row"><label style="flex:1">Format<select name="format">${FORMATS.map(x => `<option ${c.format === x ? "selected" : ""}>${x}</option>`).join("")}</select></label><label style="flex:1">Category<select name="category">${CATEGORIES.map(x => `<option ${c.category === x ? "selected" : ""}>${x}</option>`).join("")}</select></label></div>
  <label>Who can see it<select name="visibility">${Object.keys(VISIBILITY).map(x => `<option value="${x}" ${c.visibility === x ? "selected" : ""}>${label(x)}</option>`).join("")}</select></label>
  <p class="note" data-vis>${esc(VISIBILITY[c.visibility])}</p>
  <label>Rules (optional)<textarea name="rules" rows="2" maxlength="500">${esc(c.rules)}</textarea></label>
  <label class="row" style="flex-direction:row;align-items:center"><input type="checkbox" name="comments" style="width:22px;min-height:22px" ${c.commentsEnabled ? "checked" : ""}>Allow comments</label>
  ${errv()}<div class="row"><button class="btn sec" type="button" data-a="back">Cancel</button><button class="btn" style="flex:1" ${ui.busy ? "disabled" : ""}>${ui.busy === "create" ? "Creating" : "Create board"}</button></div></form>`;
}
function sheetV() {
  const s = ui.sheet, b = ui.board, e = ui.entry; let h = "";
  if (s.k === "share") {
    const ent = s.t === "entry" ? e : null, pub = b.visibility === "public", mine = ent && ent.canDelete;
    h = `<b>Share ${ent ? "entry" : "board"}</b><p class="note">${pub ? "This board is public. Anyone signed in can open the link." : `This board is ${label(b.visibility)}. The link only opens for people who already have access. Sharing never grants access.`}</p>
    ${ent && mine && pub ? `<button class="btn" data-a="tofeed" ${ui.busy ? "disabled" : ""}>${ui.busy === "feed" ? "Posting" : "Post a link to my feed"}</button><p class="note">Adds a link to the original entry. Nothing is copied.</p>` : ent && mine ? `<p class="note">Only entries on public boards can be linked to the feed.</p>` : ""}
    ${["Story", "Chat", "Community"].map(d => `<button class="btn sec" data-dest="${d.toLowerCase()}" ${cfg.onShare ? "" : "disabled"}>${d === "Chat" ? "Send in chat" : d === "Community" ? "Community" : "Add link to " + d}</button>`).join("")}
    <button class="btn sec" data-a="copy">Copy link</button>${errv()}`;
  } else if (s.k === "edit") {
    h = `<b>Edit entry</b><form data-f="edit"><label>Caption<textarea name="caption" rows="4" maxlength="2000" ${e.mediaType === "text" ? "required" : ""}>${esc(s.caption)}</textarea></label><button class="btn sec sm" type="button" data-a="editplace">${s.place ? esc(s.place.label) : "Add place"}</button>${errv()}<button class="btn sm" style="margin-top:10px" ${ui.busy ? "disabled" : ""}>${ui.busy === "edit" ? "Saving" : "Save changes"}</button></form>`;
  } else if (s.k === "manage") {
    h = `<b>Manage board</b><button class="btn sec" data-a="toggle">${b.status === "open" ? "Close board" : "Reopen board"}</button><button class="btn sec" data-a="ctoggle">${b.commentsEnabled ? "Turn comments off" : "Turn comments on"}</button>
    <form data-f="rules"><label>Rules<textarea name="rules" rows="3" maxlength="500">${esc(b.rules || "")}</textarea></label><button class="btn sm" style="margin-top:8px">Save rules</button></form>
    <button class="btn sec" data-a="invite">Invite people</button><button class="btn sec" data-a="reports">Reports${s.n != null ? " (" + s.n + ")" : ""}</button><button class="btn bad" data-a="delb">Delete board</button>${errv()}`;
  } else if (s.k === "invite") {
    h = `<b>Invite people</b><form class="row" data-f="usearch"><input name="q" minlength="2" placeholder="Search by name" aria-label="Search people" required><button class="btn sm">Search</button></form>${errv()}
    ${(s.res || []).map(u => `<label class="row" style="flex-direction:row;align-items:center"><input type="checkbox" style="width:22px;min-height:22px" data-inv="${esc(u.id)}" ${s.sel?.has(u.id) ? "checked" : ""}>${esc(nm(u))}</label>`).join("") || (s.searched ? '<p class="note">No people found.</p>' : "")}
    <button class="btn" data-a="sendinv" ${s.sel?.size && !ui.busy ? "" : "disabled"}>Invite ${s.sel?.size || ""}</button>`;
  } else if (s.k === "reports") {
    h = `<b>Reports</b>${s.list ? (s.list.length ? s.list.map(r => `<div class="cm"><b>${esc(r.target === "board" ? "Board" : "Entry")}</b>${esc(r.reason)}</div>`).join("") : '<p class="note">No reports.</p>') : skels(2)}${errv()}`;
  } else if (s.k === "report") {
    h = `<b>Report ${s.target === "board" ? "board" : "entry"}</b><form data-f="report"><label>Reason<textarea name="reason" rows="3" maxlength="500" required></textarea></label><button class="btn sm" style="margin-top:8px" ${ui.busy ? "disabled" : ""}>Send report</button></form>${errv()}`;
  } else if (s.k === "blocked") {
    h = `<b>Blocked people</b>${s.list ? (s.list.length ? s.list.map(u => `<div class="row"><span style="flex:1">${esc(nm(u))}</span><button class="btn sec sm" data-unblock="${esc(u.id)}" ${ui.busy ? "disabled" : ""}>Unblock</button></div>`).join("") : '<p class="note">Nobody is blocked.</p>') : skels(2)}${errv()}`;
  } else if (s.k === "confirm") {
    h = `<b>${esc(s.title)}</b><p class="note">${esc(s.text)}</p>${errv()}<div class="row"><button class="btn sec" data-a="x">Cancel</button><button class="btn bad" style="flex:1" data-a="yes" ${ui.busy ? "disabled" : ""}>${esc(s.ok)}</button></div>`;
  }
  return `<div class="scrim"><div class="sheet" role="dialog" aria-modal="true">${h}<button class="lnk" data-a="x">Close</button></div></div>`;
}

// ---------- events ----------
function confirm(title, text, ok, fn) { ui.sheet = { k: "confirm", title, text, ok, fn }; ui.err = ""; draw(); }
async function onClick(e) {
  if (e.target.matches(".scrim")) { if (!ui.busy) { ui.sheet = null; draw(); } return; }
  const t = e.target.closest("[data-a],[data-board],[data-entry],[data-sort],[data-cat],[data-esort],[data-delc],[data-unblock],[data-dest],[data-inv]"); if (!t) return;
  const d = t.dataset, b = ui.board, en = ui.entry, bid = curBoard();
  if (cur().s !== "home" && cur().s !== "create" && !isUuid(bid) && d.a !== "back" && d.a !== "x") { ui.err = "This board is not ready. Go back and open it again."; return draw(); }
  if (d.inv) { const s = ui.sheet; s.sel ||= new Set(); t.checked ? s.sel.add(d.inv) : s.sel.delete(d.inv); return draw(); }
  if (d.board) return showBoard(d.board);
  if (d.entry) return openEntry(d.entry);
  if (d.sort) { ui.sort = d.sort; return loadBoards(true); }
  if (d.cat !== undefined && t.hasAttribute("data-cat")) { ui.cat = d.cat; return loadBoards(true); }
  if (d.esort) { ui.esort = d.esort; return loadEntries(true); }
  if (d.unblock) return act("ub", async () => { await api(`${B}/blocks/${d.unblock}`, { method: "DELETE" }); ui.sheet.list = ui.sheet.list.filter(u => u.id !== d.unblock); ui.boards = []; say("Unblocked"); loadBoards(true); });
  if (d.delc) return act("c", async () => { await api(`${B}/${bid}/entries/${cur().entryId}/comments/${d.delc}`, { method: "DELETE" }); ui.comments = ui.comments.filter(c => c.id !== d.delc); });
  if (d.dest) {
    const state = ui, href = boardLink(bid, cur().s === "entry" ? cur().entryId : undefined);
    if (!cfg.onShare) return;
    try { await cfg.onShare({ destination: d.dest, href, boardId: bid, entryId: cur().entryId, visibility: b.visibility }); }
    catch (error) { if (ui === state) fail(error); }
    if (ui === state) { ui.sheet = null; draw(); } return;
  }
  switch (d.a) {
    case "removefile": { const caption = root.querySelector("[name=caption]")?.value || "", place = ui.cmp?.place; clearEntryDraft(ui); ui.cmp = { caption, place }; return draw(); }
    case "editplace": {
      const sheet = ui.sheet; sheet.caption = root.querySelector("[name=caption]")?.value || "";
      return openPlacePicker({ value: sheet.place, toast: say, onSelect: place => { if (ui?.sheet === sheet) { sheet.place = place; draw(); } }, onRemove: () => { if (ui?.sheet === sheet) { sheet.place = null; draw(); } } });
    }
    case "place": {
      const caption = root.querySelector("[name=caption]")?.value || ui.cmp?.caption || "";
      return openPlacePicker({ value: ui.cmp?.place || null, toast: say,
        onSelect: place => { ui.cmp = { caption, place }; draw(); },
        onRemove: () => { ui.cmp = { caption, place: null }; draw(); } });
    }
    case "back": return back();
    case "x": ui.sheet = null; ui.err = ""; return draw();
    case "retry": { ui.err = ""; const frame = cur(); if (frame.s === "entry") { ui.stack.pop(); return openEntry(frame.entryId); } return frame.s === "home" ? loadBoards(true) : frame.s === "board" ? loadEntries(true) : draw(); }
    case "new": ui.draft = null; push({ s: "create" }); return draw();
    case "more": return loadBoards(false);
    case "emore": return loadEntries(false);
    case "mine": ui.mine = !ui.mine; return loadBoards(true);
    case "blocked": ui.sheet = { k: "blocked" }; ui.err = ""; draw(); try { ui.sheet.list = (await api(`${B}/blocks`)).users || []; } catch (x) { fail(x); } return draw();
    case "block": return confirm("Block " + nm(d.who ? JSON.parse(d.who) : null) + "?", "You will no longer see their boards or entries in Get On Board. You can unblock them from Blocked people.", "Block", async () => { await api(`${B}/blocks/${JSON.parse(d.who).id}`, { method: "PUT" }); ui.sheet = null; say("Blocked"); ui.boards = []; while (cur().s !== "home") ui.stack.pop(); loadBoards(true); });
    case "emine": ui.emine = !ui.emine; return loadEntries(true);
    case "surprise": ui.sort = "newest"; ui.surprise = true; await loadBoards(true); if (ui.boards.length) showBoard(ui.boards[Math.floor(Math.random() * ui.boards.length)].id); return;
    case "add": clearEntryDraft(ui); push({ s: "compose", id: bid }); return draw();
    case "manage": ui.sheet = { k: "manage" }; return draw();
    case "toggle": return act("m", async () => { ui.board = { ...b, ...(await api(`${B}/${bid}`, { method: "PATCH", body: { status: b.status === "open" ? "closed" : "open" } })) }; say(ui.board.status === "open" ? "Board reopened" : "Board closed"); });
    case "ctoggle": return act("m", async () => { ui.board = { ...b, ...(await api(`${B}/${bid}`, { method: "PATCH", body: { commentsEnabled: !b.commentsEnabled } })) }; });
    case "delb": return confirm("Delete this board?", "This removes the board, all entries, feed links and media. It cannot be undone.", "Delete board", async () => { await api(`${B}/${bid}`, { method: "DELETE" }); ui.boards = ui.boards.filter(x => x.id !== bid); ui.sheet = null; while (cur().s !== "home") ui.stack.pop(); say("Board deleted"); });
    case "invite": ui.sheet = { k: "invite", sel: new Set(), res: [] }; return draw();
    case "sendinv": return act("i", async () => { await api(`${B}/${bid}/invites`, { method: "POST", body: { userIds: [...ui.sheet.sel].slice(0, 20) } }); ui.sheet = null; say("Invitations sent"); });
    case "reports": ui.sheet = { k: "reports" }; draw(); try { const r = await api(`${B}/${bid}/reports`); ui.sheet = { k: "reports", list: r.reports || r || [] }; } catch (x) { fail(x); } return draw();
    case "reportb": ui.sheet = { k: "report", target: "board" }; ui.err = ""; return draw();
    case "reporte": ui.sheet = { k: "report", target: en.id }; ui.err = ""; return draw();
    case "sharesheet": ui.sheet = { k: "share", t: d.t }; ui.err = ""; return draw();
    case "copy": try { await navigator.clipboard.writeText(boardLink(bid, d.t === "board" || cur().s !== "entry" ? undefined : cur().entryId)); say("Link copied"); } catch { ui.err = "Copy failed."; draw(); } return;
    case "tofeed": return act("feed", async () => {
      const result = await api(`${B}/${bid}/entries/${en.id}/share`, { method: "POST", body: { href: boardLink(bid, en.id) } });
      if (cfg.onShare) await cfg.onShare({ destination: "feed", postId: result.postId });
      ui.sheet = null; say("Link posted to your feed");
    });
    case "like": return act("like", async () => {
      const state = ui;
      patchEntry({ ...en, likedByMe: !en.likedByMe, likes: Math.max(0, en.likes + (en.likedByMe ? -1 : 1)) }); draw();
      try { patchEntry({ ...en, ...await api(`${B}/${bid}/entries/${en.id}/like`, { method: en.likedByMe ? "DELETE" : "PUT" }) }); }
      catch (error) { if (ui === state && ui.entry?.id === en.id) patchEntry(en); throw error; }
    });
    case "pin": return act("p", async () => { ui.entry = { ...en, ...(await api(`${B}/${bid}/entries/${en.id}`, { method: "PATCH", body: { pinned: !en.pinned } })) }; });
    case "rm": return act("p", async () => { ui.entry = { ...en, ...(await api(`${B}/${bid}/entries/${en.id}`, { method: "PATCH", body: { removed: !en.removed } })) }; say(ui.entry.removed ? "Removed from collection" : "Restored"); });
    case "del": return confirm("Delete your entry?", "This deletes your original, its file and any links to it.", "Delete", async () => { await api(`${B}/${bid}/entries/${en.id}`, { method: "DELETE" }); ui.entries = ui.entries.filter(x => x.id !== en.id); ui.sheet = null; ui.stack.pop(); say("Entry deleted"); });
    case "yes": return act("c", ui.sheet.fn);
    case "edit": ui.sheet = { k: "edit", caption: en.caption || "", place: en.place || null }; return draw();
  }
}
async function onSubmit(e) {
  e.preventDefault(); const f = e.target, k = f.dataset.f, fd = new FormData(f), bid = curBoard();
  if (k !== "search" && k !== "create" && !isUuid(bid)) { ui.err = "This board is not ready. Go back and open it again."; return draw(); }
  if (k === "search") { ui.q = String(fd.get("q") || ""); return loadBoards(true); }
  if (k === "edit") {
    const caption = String(fd.get("caption") || "").trim(), place = ui.sheet.place || null;
    ui.sheet.caption = caption;
    return act("edit", async () => { patchEntry(await api(`${B}/${bid}/entries/${ui.entry.id}`, { method: "PATCH", body: { caption, place } })); ui.sheet = null; say("Entry updated"); });
  }
  if (k === "create") return act("create", async () => {
    const body = { prompt: String(fd.get("prompt")).trim(), format: fd.get("format"), category: fd.get("category"), visibility: fd.get("visibility"), rules: String(fd.get("rules") || "").trim(), commentsEnabled: fd.get("comments") === "on" };
    ui.draft = { ...body };
    const r = await api(B, { method: "POST", body }); if (!isUuid(r?.id)) throw new Error("The board was created but could not be opened. Find it under Created by me."); ui.boards.unshift(r); ui.stack.pop(); ui.draft = null; say("Board created"); ui.stack.push({ s: "board", id: r.id }); ui.board = r; ui.entries = []; ui.emore = false; ui.err = "";
  });
  if (k === "comment") { const text = String(fd.get("text")).trim(); if (!text) return; return act("c", async () => { await api(`${B}/${bid}/entries/${cur().entryId}/comments`, { method: "POST", body: { text } }); ui.comments = (await api(`${B}/${bid}/entries/${cur().entryId}/comments`)).comments || []; }); }
  if (k === "rules") return act("m", async () => { ui.board = { ...ui.board, ...(await api(`${B}/${bid}`, { method: "PATCH", body: { rules: String(fd.get("rules")) } })) }; say("Rules saved"); });
  if (k === "report") return act("r", async () => { await api(`${B}/${bid}/report`, { method: "POST", body: { target: ui.sheet.target, reason: String(fd.get("reason")).trim() } }); ui.sheet = null; say("Report sent"); });
  if (k === "usearch") return act("u", async () => { const r = await api(`/api/users/search?query=${encodeURIComponent(String(fd.get("q")).trim())}`); const s = ui.sheet; if (!Array.isArray(r.profiles)) throw new Error("People search returned an unexpected response."); s.res = r.profiles.filter(u => isUuid(u.id)); s.searched = true; });
  if (k === "entry") {
    const b = ui.board, caption = String(fd.get("caption") || "").trim(), file = ui.file;
    if (b.format !== "text" && b.format !== "mixed" && !file) { ui.err = "Choose a file."; return draw(); }
    if (!file && !caption) { ui.err = "Add a file or some text."; return draw(); }
    const place = ui.cmp?.place || null;
    ui.cmp = { caption, place }; ui.entryId ||= uuid(); const id = ui.entryId;
    return act("send", async () => {
      if (!file) await api(entriesUrl(bid), { method: "POST", body: { id, caption, place } });
      else {
        const body = file.type.startsWith("image/") ? await toJpeg(file) : file;
        await api(`${entriesUrl(bid, id, caption)}&place=${encodeURIComponent(JSON.stringify(place))}`, { method: "POST", rawBody: body, contentType: body.type || "image/jpeg" });
      }
      ui.entryId = null; ui.file = null; if (ui.pv) URL.revokeObjectURL(ui.pv); ui.pv = null; ui.cmp = null; say("Added to the board");
       ui.stack.pop(); ui.err = ""; ui.busy = ""; await loadEntries(true, bid); if (root && !ui.err) await openEntry(id);
    });
  }
}
document.addEventListener?.("change", ev => {
  if (!root || !root.contains(ev.target)) return; const t = ev.target;
  if (t.matches("[data-pick]")) {
    const file = t.files[0]; if (!file) return;
    const cap = root.querySelector("[name=caption]")?.value; ui.cmp = { ...ui.cmp, caption: cap };
    const bad = checkFile(file, ui.board.format); if (bad) { ui.err = bad; return draw(); }
    if (ui.pv) URL.revokeObjectURL(ui.pv); ui.pv = null; ui.entryId = null;
    ui.err = ""; ui.file = file; ui.pvType = file.type.startsWith("video/") ? "video" : "image"; ui.pv = URL.createObjectURL(file); draw();
   } else if (t.matches("[data-esort-select]")) { ui.emine = t.value === "mine"; ui.esort = ui.emine ? "newest" : t.value; loadEntries(true); }
   else if (t.matches("[data-fsort]")) {
    if (t.value === "mine") { ui.mine = true; ui.sort = "newest"; loadBoards(true); }
    else if (t.value === "surprise") { ui.mine = false; ui.sort = "newest"; const state = ui; loadBoards(true).then(() => { if (ui === state && ui.boards.length && cur().s === "home") showBoard(ui.boards[Math.floor(Math.random() * ui.boards.length)].id); }); }
    else { ui.mine = false; ui.sort = t.value; loadBoards(true); }
  } else if (t.matches("[data-fcat]")) { ui.cat = t.value; loadBoards(true); }
  else if (t.name === "visibility") { const p = root.querySelector("[data-vis]"); if (p) p.textContent = VISIBILITY[t.value]; }
});
