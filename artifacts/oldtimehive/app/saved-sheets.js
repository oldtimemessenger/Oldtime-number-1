const fallbackEsc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function safeUrl(url) {
  const u = String(url ?? "").trim();
  if (!u) return "";
  if (/^(https?:|blob:)/i.test(u)) return u;
  if (/^data:image\//i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("//")) return "";
  return u;
}

function postImage(post) {
  const p = post || {};
  const m = Array.isArray(p.media) ? p.media[0] : null;
  return safeUrl(p.thumbnail || p.poster || p.image || p.cover || p.url || (m && (m.poster || m.thumbnail || m.url || m.src)) || (typeof m === "string" ? m : ""));
}

function thumb(url, e, cls = "") {
  const s = safeUrl(url);
  return s ? `<img class="ss-thumb ${cls}" src="${e(s)}" alt="" loading="lazy">` : `<span class="ss-thumb ${cls}" aria-hidden="true"></span>`;
}

export function renderSavedSheet({ post = {}, author = {}, collections = [], saved = false, esc = fallbackEsc, icons = {} } = {}) {
  const e = esc || fallbackEsc;
  const id = e(post.id ?? "");
  const rows = (collections || []).map(c => {
    const cid = e(c.id), name = e(c.name);
    const on = !!c.selected;
    return `<li class="ss-row">
      <button type="button" class="ss-row-main" data-saved-collection="${cid}" aria-pressed="${on}">
        ${thumb(c.cover, e)}
        <span class="ss-text"><b>${name}</b><small>Private</small></span>
        <span class="ss-check${on ? " on" : ""}" aria-hidden="true">${on ? (icons.check || "") : (icons.plus || "")}</span>
      </button>
      <button type="button" class="ss-mini" data-collection-rename="${cid}" aria-label="Rename ${name}">${icons.edit || "Edit"}</button>
      <button type="button" class="ss-mini" data-collection-delete="${cid}" aria-label="Delete ${name}">${icons.close || "Delete"}</button>
    </li>`;
  }).join("");
  return `<section class="panel saved-social-panel" role="dialog" aria-modal="true" aria-labelledby="saved-sheet-title" data-post-id="${id}">
    <div class="ss-grab" aria-hidden="true"></div>
    <header class="ss-head">
      ${thumb(postImage(post), e)}
      <span class="ss-text"><b id="saved-sheet-title">Saved</b><small>Private</small></span>
      <button type="button" class="ss-save${saved ? " on" : ""}" data-saved-toggle aria-pressed="${!!saved}" aria-label="${saved ? "Remove from saved" : "Save"}">${saved ? (icons.bookmarkOn || "") : (icons.bookmark || "")}</button>
      <button type="button" class="ss-close" data-social-sheet-close aria-label="Close">${icons.close || ""}</button>
    </header>
    <div class="ss-body">
      <div class="ss-sec"><h2>Collections</h2><button type="button" class="ss-link" data-collection-new>New collection</button></div>
      <form class="ss-form" data-collection-form hidden>
        <label class="ss-sr" for="ss-collection-name">Collection name</label>
        <input id="ss-collection-name" name="name" type="text" required maxlength="60" placeholder="Collection name" autocomplete="off">
        <div class="ss-form-actions"><button type="button" class="ss-ghost" data-collection-cancel>Cancel</button><button type="submit" class="ss-primary ss-compact">Save</button></div>
      </form>
      <ul class="ss-list">${rows}</ul>
      <p class="ss-error" data-sheet-error role="alert"></p>
    </div>
  </section>`;
}

export function renderShareSheet({
  post = {}, author = {}, comment = null, friends = [], friendsMode = false,
  selectedFriends = [], friendSearch = "", saved = false, reposted = false,
  canRepost = false, esc = fallbackEsc, icons = {}
} = {}) {
  const e = esc || fallbackEsc;
  const id = e(post.id ?? "");
  const who = author.username || author.name || "";
  const caption = post.caption || post.text || "";
  const c = comment && typeof comment === "object" ? comment : null;
  const preview = c
    ? `<div class="srp-preview srp-quote"><b>${e(c.authorName)}</b><span>${e(c.body || "Photo comment")}</span>${c.attachment?.url ? thumb(c.attachment.url, e, "srp-thumb") : ""}</div>`
    : `<div class="srp-preview">${thumb(postImage(post), e, "srp-thumb")}<span class="srp-ptext"><b>${e(who)}</b><small>${e(caption)}</small></span></div>`;
  const recipientList = friends.map(friend => {
    const unavailable = friend.unavailable === true;
    const name = String(friend.name || friend.username || "Friend");
    const username = String(friend.username || name);
    const selected = selectedFriends.includes(friend.id);
    const searchValue = `${name} ${username}`.toLowerCase();
    const face = friend.avatar
      ? `<img class="srp-avatar" src="${e(friend.avatar)}" alt="" loading="lazy">`
      : `<span class="srp-avatar srp-initial" aria-hidden="true">${e(name.slice(0, 1).toUpperCase())}</span>`;
    return `<li class="srp-cell" data-share-cell data-search="${e(searchValue)}">
      <label class="srp-friend ${unavailable ? "srp-off" : ""}">
        <input type="checkbox" data-share-friend value="${e(friend.id)}" aria-label="Share with @${e(username)}" ${selected ? "checked" : ""} ${unavailable ? "disabled" : ""}>
        <span class="srp-face">${face}<span class="srp-badge">${icons.check || ""}</span></span>
        <span class="srp-name">@${e(username)}</span>
      </label>
      ${unavailable ? `<small class="srp-reason">Can’t view this post</small>` : ""}
    </li>`;
  }).join("");
  const header = friendsMode
    ? `<button type="button" class="srp-back" data-share-back aria-label="Back to share">${icons.back || ""}</button><h2 id="share-sheet-title">Send to Friends</h2>`
    : `<span aria-hidden="true"></span><h2 id="share-sheet-title">Share</h2>`;
  const body = friendsMode
    ? `<div class="srp-body srp-friends-body">
        ${preview}
        <p class="srp-description">Choose Friends or contacts who can view this post.</p>
        <p class="srp-error" data-sheet-error role="alert"></p>
        <label class="srp-search">
          <span class="srp-searchic" aria-hidden="true">${icons.search || ""}</span>
          <input type="search" data-share-search placeholder="Search people" autocomplete="off" value="${e(friendSearch)}" aria-label="Search people">
        </label>
        <div class="srp-scroll">
          ${friends.length
            ? `<ul class="srp-grid">${recipientList}</ul>`
            : `<div class="srp-empty"><b>No Friends or contacts yet</b><span>Message someone first to add them as a contact.</span></div>`}
        </div>
        <div class="srp-compose">
          <textarea data-share-message maxlength="500" placeholder="Add a message (optional)" aria-label="Optional message"></textarea>
          <button type="button" class="srp-send" data-share-submit disabled>Send</button>
        </div>
      </div>`
    : `<div class="srp-body">
        ${preview}
        <p class="srp-description">Choose how to share this post.</p>
        <p class="srp-error" data-sheet-error role="alert"></p>
        <div class="srp-actions">
          <button type="button" class="srp-act" data-share-repost aria-pressed="${reposted}" ${canRepost ? "" : "disabled"} aria-label="${canRepost ? (reposted ? "Remove repost" : "Repost") : "Repost unavailable until this post is online"}">
            <span class="srp-actic" aria-hidden="true">${icons.repost || ""}</span><span class="srp-actlbl">${reposted ? "Remove repost" : "Repost"}</span>
          </button>
          <button type="button" class="srp-act" data-share-save aria-pressed="${saved}">
            <span class="srp-actic" aria-hidden="true">${saved ? icons.bookmarkOn || icons.bookmark || "" : icons.bookmark || ""}</span><span class="srp-actlbl">${saved ? "Remove saved post" : "Save"}</span>
          </button>
          <button type="button" class="srp-act" data-share-story>
            <span class="srp-actic" aria-hidden="true">${icons.camera || ""}</span><span class="srp-actlbl">Share to Status</span>
          </button>
          <button type="button" class="srp-act" data-share-friends>
            <span class="srp-actic" aria-hidden="true">${icons.users || ""}</span><span class="srp-actlbl">Send to Friends</span>
          </button>
          <button type="button" class="srp-act" data-share-copylink>
            <span class="srp-actic" aria-hidden="true"><svg class="navic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></span>
            <span class="srp-actlbl">Copy link</span>
          </button>
          <button type="button" class="srp-act" data-share-external>
            <span class="srp-actic" aria-hidden="true">${icons.share || ""}</span><span class="srp-actlbl">Share with an app</span>
          </button>
        </div>
      </div>`;
  return `<section class="panel share-recipient-panel" role="dialog" aria-modal="true" aria-labelledby="share-sheet-title" data-post-id="${id}">
    <div class="srp-grab" aria-hidden="true"></div>
    <header class="srp-head">${header}<button type="button" class="srp-close" data-social-sheet-close aria-label="Close">${icons.close || ""}</button></header>
    ${body}
  </section>`;
}
