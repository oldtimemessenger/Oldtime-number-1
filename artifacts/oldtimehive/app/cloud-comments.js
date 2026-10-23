import { api, requestCloudApi } from "./store.js";
import { recordActivity } from "./activity-tracking.js";

// Persisted public-post discussion; does not replace private/device-local
// comment creation, linked-comment sharing or the universal creative editor.
export function openCloudComments(postId, { sheet, esc, icons, toast, onClose, onCountChange, openEmojiPicker }) {
  const post = api.cloudPost(postId);
  if (!post) return;
  const owner = api.cloudAccountId();
  let live = true, sending = false, searchText = "", sortMode = "top";
  const close = () => { live = false; sheet.classList.remove("on"); sheet.innerHTML = ""; sheet.onclick = sheet.onkeydown = null; onClose?.(); };
  const current = () => live && api.cloudAccountId() === owner && sheet.querySelector("[data-online-comments]");
  const normalize = c => ({ id: c.id, author: api.cloudAuthorId(c.author), body: c.body, created: c.createdAt, cloud: true, likes: [], dislikes: [], replies: [] });
  sheet.classList.add("on");
  sheet.innerHTML = `<section class="panel comment-panel" data-online-comments role="dialog" aria-modal="true" aria-label="Online comments">
    <div class="grab" aria-hidden="true"></div>
    <div class="comment-toolbar">
      <label class="comment-search-wrap">${icons.search}<input type="search" data-online-search placeholder="Search comments" aria-label="Search comments" /></label>
      <button type="button" class="comment-sort" data-online-sort aria-label="Sort comments"><span data-online-sort-label>Top</span></button>
      <button type="button" class="comment-close" data-online-close aria-label="Close comments">${icons.close}</button>
    </div>
    <div class="comment-count" data-online-count>Loading comments…</div>
    <div class="comment-status" data-online-status role="status" hidden></div>
    <button type="button" class="comment-retry" data-online-retry hidden>Try again</button>
    <div class="comment-list" data-online-list aria-label="Comments"></div>
    <form class="comment-composer" data-online-form>
      <img class="comment-composer-avatar" src="${esc(api.me()?.avatar || "")}" alt="" />
      <div class="comment-composer-pill">
        <input class="comment-input" data-online-input maxlength="1000" placeholder="Add a comment..." aria-label="Add a comment" autocomplete="off" required disabled />
        <button type="button" class="comment-tool" data-online-mention aria-label="Mention someone" disabled>@</button>
        <button type="button" class="comment-tool" data-online-emoji aria-label="Add emoji" disabled>${icons.smile}</button>
      </div>
      <button type="submit" class="comment-send" data-online-send aria-label="Send comment" disabled>${icons.send}</button>
    </form></section>`;
  sheet.querySelector("[data-online-close]").onclick = close;
  sheet.onclick = e => { if (e.target === sheet) close(); };
  sheet.onkeydown = e => { if (e.key === "Escape") close(); };
  const say = text => {
    if (!current()) return;
    const status = sheet.querySelector("[data-online-status]");
    status.textContent = text;
    status.hidden = !text;
  };
  const draw = () => {
    if (!current()) return;
    const list = sheet.querySelector("[data-online-list]");
    const comments = [...post.comments].filter(comment => {
      const user = api.user(comment.author);
      return !searchText || `${user?.username || ""} ${user?.name || ""} ${comment.body || ""}`.toLowerCase().includes(searchText);
    });
    if (sortMode === "newest") comments.sort((a, b) => new Date(b.created || 0).getTime() - new Date(a.created || 0).getTime());
    sheet.querySelector("[data-online-count]").textContent = `${comments.length} ${comments.length === 1 ? "comment" : "comments"}`;
    sheet.querySelector("[data-online-sort-label]").textContent = sortMode === "top" ? "Top" : "Newest";
    list.innerHTML = comments.map(comment => {
      const author = api.user(comment.author) || { username: "member", avatar: "" };
      const date = comment.created ? new Date(comment.created) : null;
      const dateLabel = date && !Number.isNaN(date.getTime())
        ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : "";
      return `<article class="comment-item">
        <img class="comment-avatar" src="${esc(author.avatar || "")}" alt="" loading="lazy" />
        <div class="comment-content">
          <div class="comment-body"><b>@${esc(author.username || "member")}</b><span>${esc(comment.body)}</span></div>
          <div class="comment-footer"><span class="comment-date">${esc(dateLabel)}</span>
            ${comment.author === api.me()?.id ? `<button type="button" class="comment-delete" data-online-delete="${esc(comment.id)}">Delete</button>` : ""}
          </div>
        </div>
      </article>`;
    }).join("") || `<div class="comment-empty">${searchText ? "No comments match your search." : "No comments yet. Start the conversation."}</div>`;
    list.querySelectorAll("[data-online-delete]").forEach(b => b.onclick = async () => {
      b.disabled = true;
      try {
        await requestCloudApi(`/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(b.dataset.onlineDelete)}`, { method: "DELETE" });
        if (!current()) return;
        post.comments = post.comments.filter(comment => comment.id !== b.dataset.onlineDelete);
        post.commentCount = Math.max(0, Number(post.commentCount || 0) - 1);
        draw(); onCountChange?.(post.commentCount); say("Comment removed.");
      } catch (e) { say(e.message); if (current()) b.disabled = false; }
    });
  };
  sheet.querySelector("[data-online-search]").oninput = event => {
    searchText = event.target.value.trim().toLowerCase();
    draw();
  };
  sheet.querySelector("[data-online-sort]").onclick = () => {
    sortMode = sortMode === "top" ? "newest" : "top";
    draw();
  };
  sheet.querySelector("[data-online-mention]").onclick = () => {
    const input = sheet.querySelector("[data-online-input]");
    const start = input.selectionStart ?? input.value.length;
    input.setRangeText("@", start, input.selectionEnd ?? start, "end");
    input.focus();
  };
  sheet.querySelector("[data-online-emoji]").onclick = () => openEmojiPicker?.(
    sheet.querySelector("[data-online-input]"), undefined, { chat: true },
  );
  sheet.querySelector("[data-online-form]").onsubmit = async e => {
    e.preventDefault();
    if (sending || !current()) return;
    const input = e.currentTarget.querySelector("[data-online-input]");
    const button = e.currentTarget.querySelector("[data-online-send]");
    const body = input.value.trim();
    if (!body) return;
    sending = true; button.disabled = true; say("Saving comment…");
    try {
      const comment = await requestCloudApi(`/api/posts/${encodeURIComponent(postId)}/comments`, { method: "POST", body: { body } });
      if (!current()) return;
       post.comments.push(normalize(comment));
       post.commentCount = Number(post.commentCount || 0) + 1;
       input.value = ""; draw(); onCountChange?.(post.commentCount); say("Comment saved."); toast?.("Comment saved");
      sheet.querySelector("[data-online-list]").scrollTop = sheet.querySelector("[data-online-list]").scrollHeight;
      recordActivity("comment",post);
    } catch (error) { say(error.message); }
    finally { sending = false; if (current()) button.disabled = false; }
  };
  const load = () => requestCloudApi(`/api/posts/${encodeURIComponent(postId)}/comments`).then(result => {
    if (!current()) return;
    post.comments = result.comments.map(normalize);
    post.commentCount = Math.max(Number(post.commentCount || 0), post.comments.length);
    draw(); onCountChange?.(post.commentCount); say("");
    sheet.querySelectorAll("[data-online-form] input,[data-online-form] button").forEach(el => el.disabled = false);
    sheet.querySelector("[data-online-retry]").hidden = true;
  }).catch(error => { say(error.message); if (current()) sheet.querySelector("[data-online-retry]").hidden = false; });
  sheet.querySelector("[data-online-retry]").onclick = () => { say("Loading comments…"); void load(); };
  void load();
}
