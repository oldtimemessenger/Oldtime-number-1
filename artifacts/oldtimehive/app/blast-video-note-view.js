import { api } from "./store.js";
import { creativeMediaMarkup, creativeAspect } from "./creative-viewer.js";
import {
  addBlastChatReply,
  addBlastVideoNoteComment,
  deleteBlastMedia,
  deleteBlastVideoNote,
  formatBlastNoteDuration,
  getBlastMediaUrl,
  getBlastVideoNote,
  listBlastChats,
  listBlastChatMessages,
  listBlastSavedMessages,
  isBlastMessageSaved,
  toggleBlastSavedMessage,
  searchBlastChats,
  listBlastFeedVideoNotes,
  toggleBlastVideoNoteReaction
} from "./blast-video-note-store.js";
import { listBlastPosts } from "./blast-store.js";
import { getBlastCommunity } from "./blast-community-data.js";
import { renderBlastTimelinePost, renderBlastStoriesStrip, renderBlastDiscoveryStrip } from "./blast-social.js";
import { hasBlastNoteDraft } from "./blast-video-note-composer.js";

let timelineFilter = "all";
let timelineScope = "for-you";
let timelineQuery = "";
const NOTES_FEED_PAGE_SIZE = 8;
let timelineVisibleCount = NOTES_FEED_PAGE_SIZE;

const TIMELINE_FILTERS = new Set(["all", "moments", "posts", "communities", "events", "saved"]);

export function setBlastFeedScope(scope) {
  if (!["for-you", "following"].includes(scope)) return false;
  timelineScope = scope;
  timelineVisibleCount = NOTES_FEED_PAGE_SIZE;
  return true;
}

export function setBlastTimelineFilter(filter) {
  if (!TIMELINE_FILTERS.has(filter)) return false;
  timelineFilter = filter;
  timelineQuery = "";
  if (filter === "saved") timelineScope = "for-you";
  timelineVisibleCount = NOTES_FEED_PAGE_SIZE;
  return true;
}

export function getBlastTimelineFilter() {
  return timelineFilter;
}

export function resetBlastTimeline() {
  timelineScope = "for-you";
  timelineFilter = "all";
  timelineQuery = "";
  timelineVisibleCount = NOTES_FEED_PAGE_SIZE;
}

function profile(id) {
  const user = api.user(id);
  return {
    name: user?.name || user?.username || "Oldtime member",
    username: user?.username || "member",
    avatar: user?.avatar || ""
  };
}

function avatar(id, ctx, className = "bvn-avatar") {
  const person = profile(id);
  return person.avatar
    ? `<img class="${className}" src="${ctx.esc(person.avatar)}" alt="" />`
    : `<span class="${className}" aria-hidden="true">${ctx.esc(person.name.slice(0, 1).toUpperCase())}</span>`;
}

function timeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function audienceLabel(audience) {
  return ({
    public: "Friends",
    friends: "Friends",
    group: "Group",
    "only-me": "Only me"
  })[audience] || "Friends";
}

function safeColor(color) {
  return ["#ffffff", "#f4d35e", "#f28482", "#84a59d", "#5b8def"].includes(color) ? color : "#ffffff";
}

function safeNumber(value, fallback = 50) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : fallback;
}

function overlayMarkup(overlays, ctx) {
  const strokes = Array.isArray(overlays?.strokes) ? overlays.strokes : [];
  const labels = Array.isArray(overlays?.labels) ? overlays.labels : [];
  const strokeMarkup = strokes.map(stroke => {
    const points = Array.isArray(stroke.points) ? stroke.points : [];
    const value = points.map(point => `${safeNumber(point.x)},${safeNumber(point.y)}`).join(" ");
    if (points.length < 2) return "";
    return `<polyline points="${value}" fill="none" stroke="${safeColor(stroke.color)}" stroke-width="${Math.max(0.5, Math.min(8, Number(stroke.width) || 2.5))}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />`;
  }).join("");
  const labelMarkup = labels.map(label => {
    const text = String(label.text || "").trim().slice(0, 80);
    if (!text) return "";
    return `<text x="${safeNumber(label.x)}" y="${safeNumber(label.y)}" fill="${safeColor(label.color)}" font-size="${Math.max(2, Math.min(12, Number(label.size) || 6))}" text-anchor="middle" dominant-baseline="middle" paint-order="stroke fill" stroke="rgba(0,0,0,.65)" stroke-width="1.4" stroke-linejoin="round">${ctx.esc(text)}</text>`;
  }).join("");
  return `${strokeMarkup}${labelMarkup}`;
}

function mediaButton(note, ctx, extraClass = "") {
  const id = ctx.esc(note.id);
  const mediaId = ctx.esc(note.mediaId);
  const media = note.creativeProject ? creativeMediaMarkup(note,ctx.esc) : note.mediaType === "image"
    ? `<img class="bvn-note-image" data-bvn-media-id="${mediaId}" alt="Image note" />`
    : `<video class="bvn-note-video" data-bvn-media-id="${mediaId}" data-bvn-autoplay="true" muted playsinline preload="metadata" aria-label="Video note preview"></video>`;
  const overlay = overlayMarkup(note.overlays, ctx);
  return `<button class="bvn-note-preview ${extraClass}" ${note.creativeProject?`style="aspect-ratio:${creativeAspect(note.creativeProject)}"`:""} type="button" data-bvn-open-note="${id}" aria-label="Open ${note.mediaType === "image" ? "image" : "video"} note">
    ${media}<svg class="bvn-note-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${overlay}</svg>
    ${note.mediaType === "video" ? `<span class="bvn-note-duration">${ctx.esc(formatBlastNoteDuration(note.duration))}</span>` : ""}
    <span class="bvn-note-play" aria-hidden="true">${ctx.icon("play")}</span>
  </button>`;
}

function deleteNoteButton(note, ctx, className = "bvn-delete-note-action", label = "Delete") {
  if (note.authorId !== ctx.me.id) return "";
  return `<button type="button" class="${className}" data-bvn-delete-note="${ctx.esc(note.id)}" aria-label="Delete your note">${ctx.esc(label)}</button>`;
}

function noteCard(note, ctx) {
  const author = profile(note.authorId);
  const comments = note.comments || [];
  const reactions = note.reactions || [];
  const liked = reactions.some(item => item.userId === ctx.me.id && item.kind === "heart");
  const hearts = reactions.filter(item => item.kind === "heart").length;
  return `<article class="bvn-feed-card" data-testid="blast-video-note-card">
    <div class="bvn-card-top">${avatar(note.authorId, ctx)}<div class="bvn-card-person"><b>${ctx.esc(author.name)}</b><small>@${ctx.esc(author.username)} · ${ctx.esc(timeLabel(note.createdAt))}</small></div><span class="bvn-audience">${ctx.esc(audienceLabel(note.audience))}</span></div>
    <div class="bvn-feed-media">${mediaButton(note, ctx)}</div>
    ${note.caption ? `<p class="bvn-caption">${ctx.esc(note.caption)}</p>` : `<p class="bvn-note-kind">${note.mediaType === "video" ? "Video note" : "Photo note"}</p>`}
    <div class="bvn-card-actions"><span>${note.mediaType === "video" ? `Video note · ${ctx.esc(formatBlastNoteDuration(note.duration))}` : "Photo note"}</span><div class="bvn-social-actions"><button type="button" class="${liked ? "is-liked" : ""}" data-bvn-react="${ctx.esc(note.id)}" aria-pressed="${liked}" aria-label="${liked ? "Remove heart" : "Heart"} this note">${ctx.icon("heart")} ${hearts}</button><button type="button" data-bvn-open-note="${ctx.esc(note.id)}">${ctx.icon("comment")} Comments · ${comments.length}</button>${deleteNoteButton(note, ctx)}</div></div>
  </article>`;
}

function tabs(ctx, current) {
  const feedScopeAttribute = scope => current === "notes"
    ? `data-bvn-feed-scope="${scope}"`
    : `data-bvn-open-feed="${scope}"`;
  return `<nav class="bvn-tabs" aria-label="Community sections">
    <button type="button" class="${current === "notes" && timelineScope === "for-you" ? "is-active" : ""}" ${feedScopeAttribute("for-you")} aria-pressed="${current === "notes" && timelineScope === "for-you"}" ${current === "notes" && timelineScope === "for-you" ? 'aria-current="page"' : ""}>For you</button>
    <button type="button" class="${current === "notes" && timelineScope === "following" ? "is-active" : ""}" ${feedScopeAttribute("following")} aria-pressed="${current === "notes" && timelineScope === "following"}" ${current === "notes" && timelineScope === "following" ? 'aria-current="page"' : ""}>Following</button>
    <button type="button" class="${current === "communities" || current === "community" ? "is-active" : ""}" data-blast-nav="communities" ${current === "communities" || current === "community" ? 'aria-current="page"' : ""}>Communities</button>
  </nav>`;
}

function header(ctx, current) {
  return `<header class="bvn-header">
    <div><span class="bvn-kicker">MOMENTS &amp; COMMUNITY</span><h1>Community</h1></div>
    <div class="bvn-header-actions">
      <button class="bvn-icon-button" type="button" data-bvn-view="chats" aria-label="Messages and private moments" aria-pressed="${current === "chats" || current === "chat"}" data-testid="community-messages">${ctx.icon("comment")}</button>
      <button class="bvn-icon-button" type="button" data-blast-settings-open aria-label="Open community options" aria-expanded="${ctx.settingsOpen === true}" data-testid="blast-settings-open">${ctx.icon("settings")}</button>
    </div>
  </header>${tabs(ctx, current)}`;
}

function collectTimelineEntries(notes, posts) {
  const entries = [
    ...notes.map(note => ({ kind: "moment", createdAt: new Date(note.createdAt).getTime(), value: note })),
    ...posts.map(post => ({ kind: "post", createdAt: new Date(post.createdAt).getTime(), value: post }))
  ];
  const seen = new Set();
  return entries
    .filter(entry => {
      const key = `${entry.kind}:${entry.value.id}`;
      if (!entry.value.id || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (Number.isFinite(right.createdAt) ? right.createdAt : 0) - (Number.isFinite(left.createdAt) ? left.createdAt : 0));
}

function filteredTimelineEntries(entries, followingIds = []) {
  const followed = new Set(Array.isArray(followingIds) ? followingIds : []);
  return entries.filter(entry => {
    if (timelineFilter !== "saved" && timelineScope === "following" && !followed.has(entry.value.authorId || entry.value.author)) return false;
    if (timelineFilter === "saved" && (entry.kind !== "post" || !(entry.value.savedBy || []).includes(api.me()?.id))) return false;
    if (timelineFilter === "moments") return entry.kind === "moment";
    if (timelineFilter === "posts") return entry.kind === "post" && entry.value.type !== "event";
    if (timelineFilter === "communities") return entry.kind === "post" && Boolean(entry.value.communityId);
    if (timelineFilter === "events") return entry.kind === "post" && entry.value.type === "event";
    return true;
  }).filter(entry => {
    const query = timelineQuery.toLowerCase();
    if (!query) return true;
    const value = entry.value;
    return [value.title, value.body, value.text, value.caption, value.location, value.type]
      .filter(Boolean).join(" ").toLowerCase().includes(query);
  });
}

function timelineEntries(ctx, entries) {
  return entries.map(entry => {
    const content = entry.kind === "moment"
      ? noteCard(entry.value, ctx)
      : renderBlastTimelinePost(entry.value, ctx);
    const community = entry.kind === "post" && entry.value.communityId
      ? getBlastCommunity(entry.value.communityId)
      : null;
    const source = community
      ? `<button class="bvn-community-source" type="button" data-blast-community-open="${ctx.esc(community.id)}">${ctx.icon("users")}<span>${ctx.esc(community.name)}</span><span class="bvn-community-source-arrow" aria-hidden="true">›</span></button>`
      : "";
    return `<div class="bvn-feed-entry" data-bvn-feed-entry="${ctx.esc(`${entry.kind}:${entry.value.id}`)}">${source}${content}</div>`;
  }).join("");
}

function notesHome(ctx) {
  const notes = timelineFilter === "saved" ? [] : listBlastFeedVideoNotes();
  const followed = new Set(Array.isArray(ctx.me.following) ? ctx.me.following : []);
  const scopedNotes = timelineScope === "following" ? notes.filter(note => followed.has(note.authorId)) : notes;
  const posts = listBlastPosts();
  const allEntries = collectTimelineEntries(scopedNotes, posts);
  const entries = filteredTimelineEntries(allEntries, ctx.me.following);
  const entryCount = entries.length;
  const visibleEntries = entries.slice(0, timelineVisibleCount);
  const draftBanner = hasBlastNoteDraft() ? `<section class="bvn-draft-banner"><div><b>Unfinished video note</b></div><button type="button" data-bvn-resume-draft>Resume draft</button></section>` : "";
  const emptyTitle = timelineQuery
    ? "No matching updates"
    : timelineFilter === "saved"
      ? "No saved posts yet"
      : timelineFilter === "communities"
        ? "No community posts yet"
      : timelineScope === "following"
        ? "No updates from people you follow"
        : "Your feed starts here";
  const emptyCopy = timelineQuery
    ? "Try another search."
    : timelineFilter === "saved"
      ? "Save a post and it will appear here."
      : timelineFilter === "communities"
        ? "Posts from communities you have joined will show here."
      : timelineScope === "following"
        ? "Switch to For you to browse more updates."
        : "Share a video, photo, or post with the people who can see it.";
  const emptyAction = timelineFilter === "communities"
    ? `<button type="button" class="bvn-record-cta" data-blast-nav="communities">${ctx.icon("users")} Explore communities</button>`
    : timelineFilter === "saved"
      ? ""
      : `<button type="button" class="bvn-record-cta" data-bvn-open-camera>${ctx.icon("camera")} Create a moment</button>`;
  const emptyState = `<section class="bvn-empty"><span class="bvn-empty-icon">${ctx.icon(timelineFilter === "communities" ? "users" : "camera")}</span><h3>${emptyTitle}</h3><p>${emptyCopy}</p>${emptyAction}</section>`;
  const stories = ["saved", "communities"].includes(timelineFilter) || timelineQuery ? "" : renderBlastStoriesStrip(ctx);
  const discover = timelineScope === "for-you" && timelineFilter === "all" && !timelineQuery ? renderBlastDiscoveryStrip(ctx) : "";
  return `<main class="blast-screen bvn-screen bvn-twitter-feed"><div class="blast-wrap bvn-wrap">
    ${header(ctx, "notes")}
    ${draftBanner}
    <section class="bvn-content-composer" aria-label="Create a post">
      <div class="bvn-compose-main">${avatar(ctx.me.id, ctx)}<button type="button" class="bvn-compose-prompt" data-blast-new="post">What's on your mind?</button><button type="button" class="bvn-compose-photo" data-bvn-open-library aria-label="Add a photo or video">${ctx.icon("image")}</button></div>
      <div class="bvn-compose-actions">
        <button type="button" data-bvn-open-camera>${ctx.icon("camera")}<span>Record</span></button>
        <button type="button" data-bvn-open-library>${ctx.icon("image")}<span>Photo or video</span></button>
        <button type="button" data-blast-new="event">${ctx.icon("calendar")}<span>Plan an event</span></button>
      </div>
    </section>
    ${stories}
    ${discover}
    <div class="bvn-feed-heading"><div><span class="bvn-kicker">YOUR COMMUNITY</span><h2>${timelineFilter === "saved" ? "Saved posts" : "Latest"}</h2></div><span>${entryCount} ${entryCount === 1 ? "update" : "updates"}</span></div>
    <form class="bvn-feed-search" data-bvn-feed-search-form>
      <input type="search" name="query" value="${ctx.esc(timelineQuery)}" placeholder="Search posts and moments" aria-label="Search posts and moments" />
      <button type="submit" aria-label="Search feed">${ctx.icon("search")}</button>
    </form>
    ${visibleEntries.length
      ? `<div class="bvn-feed-list" data-bvn-feed-list>${timelineEntries(ctx, visibleEntries)}</div>${entryCount > visibleEntries.length ? `<button type="button" class="bvn-feed-load-more" data-bvn-feed-load-more>Load more</button>` : `<p class="bvn-feed-end">You're all caught up.</p>`}`
      : emptyState}
  </div></main>`;
}

function chatRowHtml(chat, ctx, matchText = "", messageId = "") {
  const person = profile(chat.peerId);
  const last = chat.lastMessage;
  const preview = matchText || (!last ? "Start a conversation" : last.kind === "video-note" ? "Video note" : last.body || "Message");
  return `<button class="bvn-chat-row" type="button" data-bvn-open-chat="${ctx.esc(chat.peerId)}" data-bvn-jump-message="${ctx.esc(messageId)}">
      ${avatar(chat.peerId, ctx)}<span class="bvn-chat-copy"><b>${ctx.esc(person.name)}</b><small>${ctx.esc(preview)}</small></span>
      <span class="bvn-chat-time">${last ? ctx.esc(timeLabel(last.createdAt)) : ""}</span>${ctx.icon("back")}
    </button>`;
}

function chatResultsHtml(ctx, query) {
  const q = String(query || "").trim();
  if (!q) {
    const chats = listBlastChats();
    return chats.map(chat => chatRowHtml(chat, ctx)).join("") || `<div class="bvn-empty"><span class="bvn-empty-icon">${ctx.icon("users")}</span><h3>No chats yet</h3><button type="button" class="bvn-record-cta" data-blast-nav="friends">${ctx.icon("users")} Find friends</button></div>`;
  }
  const found = searchBlastChats(q);
  return found.map(({ item, match }) => chatRowHtml(item, ctx, match?.text || "", match?.message.id || "")).join("") || `<div class="bvn-thread-empty"><p>No friends or messages match your search.</p></div>`;
}

function savedResultsHtml(ctx) {
  const items = listBlastSavedMessages();
  return items.map(({ peerId, message, text }) => {
    const person = profile(peerId);
    return `<button class="bvn-chat-row" type="button" data-bvn-open-chat="${ctx.esc(peerId)}" data-bvn-jump-message="${ctx.esc(message.id)}">${avatar(peerId, ctx)}<span class="bvn-chat-copy"><b>${ctx.esc(person.name)}</b><small>${ctx.esc(message.kind === "video-note" ? `Video note${text && text !== "Video note" ? ` · ${text}` : ""}` : text)}</small></span><span class="bvn-chat-time">${ctx.esc(timeLabel(message.createdAt))}</span>${ctx.icon("back")}</button>`;
  }).join("") || `<div class="bvn-thread-empty"><p>No saved messages yet. Save a message from a chat to find it here.</p></div>`;
}

function chatsHome(ctx) {
  const count = listBlastChats().length;
  return `<main class="blast-screen bvn-screen"><div class="blast-wrap bvn-wrap">
    ${header(ctx, "chats")}
    <div class="bvn-page-heading"><div><span class="bvn-kicker">PRIVATE MESSAGES</span><h2>Messages</h2></div><small>${count} friends</small></div>
    <div class="bvn-chat-tools" role="toolbar" aria-label="Chat actions">
      <button type="button" class="bvn-chat-tool" data-bvn-saved-toggle aria-pressed="false" aria-label="Saved messages">${ctx.icon("bookmark")}<span>Saved</span></button>
      <button type="button" class="bvn-chat-tool" data-bvn-search-toggle aria-expanded="false" aria-controls="bvn-chat-search" aria-label="Search chats">${ctx.icon("search")}<span>Search</span></button>
      <button type="button" class="bvn-chat-tool" data-blast-nav="friends" aria-label="New message to a friend">${ctx.icon("edit")}<span>New message</span></button>
    </div>
    <label class="bvn-chat-search" id="bvn-chat-search" hidden>${ctx.icon("search")}<input type="search" data-bvn-chat-query placeholder="Search friends or messages" aria-label="Search friends or messages" maxlength="80" /></label>
     <p class="bvn-local-note">Notes and media are saved to your account.</p>
    <section class="bvn-chat-list" data-bvn-chat-results aria-live="polite">${chatResultsHtml(ctx, "")}</section>
  </div></main>`;
}

function chatThread(view, ctx) {
  const peerId = String(view.peerId || "");
  const person = profile(peerId);
  const messages = listBlastChatMessages(peerId);
  const bubbles = messages.map(message => {
    const mine = message.authorId === ctx.me.id;
    const note = message.kind === "video-note" ? getBlastVideoNote(message.noteId) : null;
    const reply = message.replyToNoteId ? getBlastVideoNote(message.replyToNoteId) : null;
    const canSave = note || (message.kind !== "video-note" && message.body);
    const isSaved = canSave && isBlastMessageSaved(peerId, message.id);
    const saveBtn = canSave ? `<button type="button" class="bvn-save-message${isSaved ? " is-saved" : ""}" data-bvn-save-message="${ctx.esc(message.id)}" data-peer="${ctx.esc(peerId)}" aria-pressed="${!!isSaved}" aria-label="${isSaved ? "Remove from Saved" : "Save message"}">${isSaved ? ctx.icon("bookmark", true) : ctx.icon("bookmark")}</button>` : "";
    const deleteAction = note ? deleteNoteButton(note, ctx, "bvn-chat-delete-note", "Delete note") : "";
    const content = note
      ? mediaButton(note, ctx, "bvn-chat-note-preview")
      : `<p>${ctx.esc(message.body || "")}</p>`;
    return `<article class="bvn-chat-message ${mine ? "is-mine" : ""}" data-bvn-message-id="${ctx.esc(message.id)}" data-testid="blast-chat-message">
      ${reply ? `<button class="bvn-reply-quote" type="button" data-bvn-open-note="${ctx.esc(reply.id)}">Replying to a video note</button>` : ""}
      ${content}<small>${ctx.esc(timeLabel(message.createdAt))}</small>${saveBtn}${deleteAction}
    </article>`;
  }).join("");
  return `<main class="blast-screen bvn-screen"><div class="blast-wrap bvn-wrap bvn-thread-wrap">
    ${header(ctx, "chats")}
    <div class="bvn-thread-heading"><button class="bvn-back-button" type="button" data-bvn-view="chats" aria-label="Back to chats">${ctx.icon("back")}</button>${avatar(peerId, ctx)}<div><h2>${ctx.esc(person.name)}</h2><small>@${ctx.esc(person.username)} · Friend</small></div>
      <button class="bvn-icon-button" type="button" data-bvn-chat-camera="${ctx.esc(peerId)}" aria-label="Record a video note">${ctx.icon("camera")}</button></div>
    <div class="bvn-thread-messages" aria-label="Conversation with ${ctx.esc(person.name)}">
      ${bubbles || `<div class="bvn-thread-empty"><button type="button" class="bvn-record-cta" data-bvn-chat-camera="${ctx.esc(peerId)}">${ctx.icon("camera")} Record a video note</button></div>`}
    </div>
    <form class="bvn-chat-composer" data-bvn-chat-form="${ctx.esc(peerId)}">
      <button type="button" data-bvn-chat-camera="${ctx.esc(peerId)}" aria-label="Record a video note">${ctx.icon("camera")}</button>
      <input name="message" maxlength="500" aria-label="Message" placeholder="Write a comment or reply" required />
      <button type="submit" aria-label="Send message">${ctx.icon("send")}</button>
    </form>
  </div></main>`;
}

function noteDetail(view, ctx) {
  const note = getBlastVideoNote(view.id);
  if (!note) {
    return `<main class="blast-screen bvn-screen"><div class="blast-wrap bvn-wrap">${header(ctx, "notes")}<section class="bvn-empty"><h3>This video note is unavailable</h3><p>It may have been removed or is no longer visible to you.</p><button class="bvn-library-cta" type="button" data-bvn-view="notes">Back to notes</button></section></div></main>`;
  }
  const author = profile(note.authorId);
  const comments = (note.comments || []).map(comment => {
    const person = profile(comment.authorId);
    return `<article class="bvn-comment">${avatar(comment.authorId, ctx, "bvn-comment-avatar")}<div><b>${ctx.esc(person.name)}</b><small>${ctx.esc(timeLabel(comment.createdAt))}</small><p>${ctx.esc(comment.body)}</p></div></article>`;
  }).join("");
  const reactions = note.reactions || [];
  const liked = reactions.some(item => item.userId === ctx.me.id && item.kind === "heart");
  const hearts = reactions.filter(item => item.kind === "heart").length;
  const media = note.creativeProject ? creativeMediaMarkup(note,ctx.esc) : note.mediaType === "video"
    ? `<video class="bvn-detail-video" data-bvn-media-id="${ctx.esc(note.mediaId)}" controls playsinline preload="metadata" aria-label="Video note"></video>`
    : `<img class="bvn-detail-image" data-bvn-media-id="${ctx.esc(note.mediaId)}" alt="Photo note" />`;
  const isChat = note.channel === "chat";
  const peerId = note.authorId === ctx.me.id ? note.recipientId : note.authorId;
  const deleteAction = deleteNoteButton(note, ctx);
  return `<main class="blast-screen bvn-screen"><div class="blast-wrap bvn-wrap">
    ${header(ctx, isChat ? "chats" : "notes")}
    <button class="bvn-back-link" type="button" ${isChat ? `data-bvn-open-chat="${ctx.esc(peerId)}"` : 'data-bvn-view="notes"'}>${ctx.icon("back")} ${isChat ? "Back to conversation" : "Back to video notes"}</button>
    <article class="bvn-detail-card">
      <div class="bvn-card-top">${avatar(note.authorId, ctx)}<div class="bvn-card-person"><b>${ctx.esc(author.name)}</b><small>${ctx.esc(timeLabel(note.createdAt))}${isChat ? " · Private note" : ` · ${ctx.esc(audienceLabel(note.audience))}`}</small></div></div>
      <div class="bvn-detail-media" ${note.creativeProject?`style="aspect-ratio:${creativeAspect(note.creativeProject)}"`:""}>${media}<svg class="bvn-note-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${overlayMarkup(note.overlays, ctx)}</svg></div>
      ${note.creativeProject&&note.mediaType==="video"?'<button type="button" class="blast-btn" data-bvn-creative-audio aria-pressed="false">Unmute video</button>':""}
      ${note.caption ? `<p class="bvn-caption">${ctx.esc(note.caption)}</p>` : ""}
      ${note.mediaType === "video" ? `<span class="bvn-note-kind">Video note · ${ctx.esc(formatBlastNoteDuration(note.duration))}</span>` : `<span class="bvn-note-kind">Photo note</span>`}
      <div class="bvn-detail-actions"><button type="button" class="bvn-detail-heart ${liked ? "is-liked" : ""}" data-bvn-react="${ctx.esc(note.id)}" aria-pressed="${liked}" aria-label="${liked ? "Remove heart from this note" : "Heart this note"}; ${hearts} hearts">${ctx.icon("heart")}<span>${hearts}</span></button>${deleteAction}</div>
    </article>
    ${isChat ? `<div class="bvn-detail-comments"><div class="bvn-feed-heading"><div><span class="bvn-kicker">PRIVATE CONVERSATION</span><h2>Reply</h2></div></div><form class="bvn-comment-form" data-bvn-chat-detail-form="${ctx.esc(peerId)}" data-reply-note="${ctx.esc(note.id)}"><textarea name="comment" maxlength="500" required placeholder="Write a comment or reply"></textarea><button class="bvn-record-cta" type="submit">Send reply</button></form></div>` : `<div class="bvn-detail-comments">
      <div class="bvn-feed-heading"><div><span class="bvn-kicker">JOIN THE CONVERSATION</span><h2>Comments</h2></div><span>${comments.length}</span></div>
      <div class="bvn-comments">${comments || `<p class="bvn-no-comments">No comments yet.</p>`}</div>
      <form class="bvn-comment-form" data-bvn-comment-form="${ctx.esc(note.id)}"><textarea name="comment" maxlength="500" required placeholder="Write a comment"></textarea><button class="bvn-record-cta" type="submit">Comment</button></form>
    </div>`}
  </div></main>`;
}

export function renderBlastVideoNotes(view, ctx) {
  try {
    if (view.name === "notes") return notesHome(ctx);
    if (view.name === "chats") return chatsHome(ctx);
    if (view.name === "chat") return chatThread(view, ctx);
    if (view.name === "note-detail") return noteDetail(view, ctx);
    return notesHome(ctx);
  } catch (error) {
    const feedTheme = view.name === "notes" ? " bvn-twitter-feed" : "";
    return `<main class="blast-screen bvn-screen${feedTheme}"><div class="blast-wrap bvn-wrap">${header(ctx, "notes")}<section class="bvn-empty" role="alert"><h3>Video notes could not load</h3><p>${ctx.esc(error.message || "Try again.")}</p><button class="bvn-library-cta" type="button" data-bvn-retry>Try again</button></section></div></main>`;
  }
}

async function hydrateMediaElement(element, progressive = false) {
  if (element.dataset.bvnLoaded === "true") {
    if (progressive && element instanceof HTMLVideoElement && element.dataset.bvnAutoplay === "true" && element.dataset.bvnVisible === "true") {
      element.play().catch(() => {});
    }
    return;
  }
    const mediaId = element.dataset.bvnMediaId;
    try {
      const url = await getBlastMediaUrl(mediaId);
      if (!url || !element.isConnected) {
        if (element.isConnected) {
          element.dataset.bvnUnavailable = "true";
          element.closest(".bvn-note-preview, .bvn-detail-media")?.classList.add("is-unavailable");
        }
        return;
      }
      element.src = url;
      element.dataset.bvnLoaded = "true";
      if (element instanceof HTMLVideoElement && element.dataset.bvnAutoplay === "true") {
        element.muted = true;
        element.loop = false;
        let loops = 0;
        element.onended = () => {
          loops += 1;
          if (loops < 3) {
            element.currentTime = 0;
            element.play().catch(() => {});
          }
        };
        if (!progressive || element.dataset.bvnVisible === "true") element.play().catch(() => {});
      }
    } catch {
      if (element.isConnected) {
        element.dataset.bvnUnavailable = "true";
        element.closest(".bvn-note-preview, .bvn-detail-media")?.classList.add("is-unavailable");
      }
    }
}

function hydrateMedia(app, { progressiveFeed = false } = {}) {
  const elements = [...app.querySelectorAll("[data-bvn-media-id]")];
  if (progressiveFeed && typeof IntersectionObserver !== "undefined") {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const element = entry.target;
        element.dataset.bvnVisible = String(entry.isIntersecting);
        if (entry.isIntersecting) {
          hydrateMediaElement(element, true);
        } else if (element instanceof HTMLVideoElement && element.dataset.bvnLoaded === "true") {
          element.pause();
        }
      });
    }, { rootMargin: "120px 0px", threshold: 0.25 });
    elements.forEach(element => observer.observe(element));
    app.__bvnFeedMediaObserver = observer;
    return;
  }
  Promise.all(elements.map(element => hydrateMediaElement(element)));
}

function bindNotesFeedPagination(view, ctx, app) {
  const feed = app.querySelector("[data-bvn-feed-list]");
  const button = app.querySelector("[data-bvn-feed-load-more]");
  if (!feed || !button) return;

  const loadMore = () => {
    if (!button.isConnected || button.disabled) return;
    button.disabled = true;
    const existingKeys = new Set([...feed.querySelectorAll("[data-bvn-feed-entry]")].map(entry => entry.dataset.bvnFeedEntry));
    const entries = filteredTimelineEntries(collectTimelineEntries(listBlastFeedVideoNotes(), listBlastPosts()), ctx.me.following);
    const nextEntries = entries.filter(entry => !existingKeys.has(`${entry.kind}:${entry.value.id}`)).slice(0, NOTES_FEED_PAGE_SIZE);
    if (nextEntries.length) {
      feed.insertAdjacentHTML("beforeend", timelineEntries(ctx, nextEntries));
      timelineVisibleCount = feed.querySelectorAll("[data-bvn-feed-entry]").length;
    }
    const loadedKeys = new Set([...feed.querySelectorAll("[data-bvn-feed-entry]")].map(entry => entry.dataset.bvnFeedEntry));
    const hasMore = entries.some(entry => !loadedKeys.has(`${entry.kind}:${entry.value.id}`));
    if (!hasMore) {
      button.remove();
      feed.insertAdjacentHTML("afterend", `<p class="bvn-feed-end">You're all caught up.</p>`);
    } else {
      button.disabled = false;
    }
    bindBlastVideoNotes(view, ctx);
  };

  button.onclick = loadMore;
  if (typeof IntersectionObserver !== "undefined") {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMore();
    }, { rootMargin: "320px 0px" });
    observer.observe(button);
    app.__bvnFeedLoadObserver = observer;
  }
}

export function bindBlastVideoNotes(view, ctx) {
  const { app, toast } = ctx;
  app.__bvnFeedLoadObserver?.disconnect();
  app.__bvnFeedMediaObserver?.disconnect();
  hydrateMedia(app, { progressiveFeed: view.name === "notes" });
  if(view.name==="chat"&&view.messageId){
    requestAnimationFrame(()=>{
      const message=[...app.querySelectorAll("[data-bvn-message-id]")].find(node=>node.dataset.bvnMessageId===view.messageId);
      message?.scrollIntoView({block:"center",behavior:"instant"});
    });
  }

  app.querySelectorAll("[data-bvn-view]").forEach(button => {
    button.onclick = () => {
      const next = button.dataset.bvnView;
      ctx.setView(next === "chat" ? { name: "chats" } : next);
    };
  });
  app.querySelectorAll("[data-bvn-feed-filter]").forEach(button => {
    button.onclick = () => {
      if (!setBlastTimelineFilter(button.dataset.bvnFeedFilter || "all")) return;
      ctx.refresh();
    };
  });
  app.querySelectorAll("[data-bvn-feed-scope]").forEach(button => {
    button.onclick = () => {
      if (!setBlastFeedScope(button.dataset.bvnFeedScope)) return;
      ctx.refresh();
    };
  });
  app.querySelectorAll("[data-bvn-open-feed]").forEach(button => {
    button.onclick = () => {
      if (!setBlastFeedScope(button.dataset.bvnOpenFeed || "for-you")) return;
      ctx.setView({ name: "notes" });
    };
  });
  const feedSearch = app.querySelector("[data-bvn-feed-search-form]");
  if (feedSearch) feedSearch.onsubmit = event => {
    event.preventDefault();
    timelineQuery = String(new FormData(feedSearch).get("query") || "").trim().slice(0, 120);
    timelineVisibleCount = NOTES_FEED_PAGE_SIZE;
    ctx.refresh();
  };
  app.querySelectorAll("[data-bvn-open-camera]").forEach(button => {
    button.onclick = () => ctx.setView({ name: "note-camera", shareContext: { channel: "feed" }, openLibrary: false });
  });
  app.querySelectorAll("[data-bvn-open-library]").forEach(button => {
    button.onclick = () => ctx.setView({ name: "note-camera", shareContext: { channel: "feed" }, openLibrary: true });
  });
  const bindOpenChat = () => app.querySelectorAll("[data-bvn-open-chat]").forEach(button => {
    button.onclick = () => ctx.setView({ name: "chat", peerId: button.dataset.bvnOpenChat, messageId: button.dataset.bvnJumpMessage || "" });
  });
  bindOpenChat();
  const results = app.querySelector("[data-bvn-chat-results]");
  if (results) {
    const queryInput = app.querySelector("[data-bvn-chat-query]"), searchBox = app.querySelector("#bvn-chat-search");
    const savedButton = app.querySelector("[data-bvn-saved-toggle]"), searchButton = app.querySelector("[data-bvn-search-toggle]");
    const draw = () => {
      try { results.innerHTML = savedButton.getAttribute("aria-pressed") === "true" ? savedResultsHtml(ctx) : chatResultsHtml(ctx, queryInput.value); }
      catch (error) { results.innerHTML = `<div class="bvn-thread-empty"><p>${ctx.esc(error.message || "Could not load chats.")}</p></div>`; }
      bindOpenChat();
      results.querySelectorAll("[data-blast-nav]").forEach(b => b.onclick = () => ctx.setView(b.dataset.blastNav));
    };
    savedButton.onclick = () => { savedButton.setAttribute("aria-pressed", String(savedButton.getAttribute("aria-pressed") !== "true")); draw(); };
    searchButton.onclick = () => {
      const open = searchBox.hidden; searchBox.hidden = !open; searchButton.setAttribute("aria-expanded", String(open));
      if (open) { savedButton.setAttribute("aria-pressed", "false"); queryInput.focus(); } else { queryInput.value = ""; draw(); }
    };
    queryInput.oninput = () => { savedButton.setAttribute("aria-pressed", "false"); draw(); };
  }
  app.querySelectorAll("[data-bvn-save-message]").forEach(button => {
    button.onclick = async () => {
      try {
        const on = await toggleBlastSavedMessage(button.dataset.peer, button.dataset.bvnSaveMessage);
        toast(on ? "Saved." : "Removed from Saved.");
        ctx.refresh();
      } catch (error) { toast(error.message); }
    };
  });
  app.querySelectorAll("[data-bvn-chat-camera]").forEach(button => {
    button.onclick = () => ctx.setView({
      name: "note-camera",
      shareContext: { channel: "chat", recipientId: button.dataset.bvnChatCamera },
      returnView: { name: "chat", peerId: button.dataset.bvnChatCamera }
    });
  });
  app.querySelectorAll("[data-bvn-open-note]").forEach(button => {
    button.onclick = () => ctx.setView({ name: "note-detail", id: button.dataset.bvnOpenNote });
  });
  app.querySelectorAll("[data-bvn-react]").forEach(button => {
    button.onclick = async () => {
      try {
        await toggleBlastVideoNoteReaction(button.dataset.bvnReact);
        ctx.refresh();
      } catch (error) {
        toast(error.message);
      }
    };
  });
  app.querySelectorAll("[data-bvn-delete-note]").forEach(button => {
    button.onclick = async () => {
      if (!confirm("Delete this note? This cannot be undone.")) return;
      button.disabled = true;
      try {
        const deleted = await deleteBlastVideoNote(button.dataset.bvnDeleteNote);
        let mediaCleanupFailed = false;
        if (deleted.orphanedMediaId) {
          try {
            await deleteBlastMedia(deleted.orphanedMediaId);
          } catch (error) {
            mediaCleanupFailed = true;
            console.warn("Deleted note media could not be cleared from account storage.", error);
          }
        }
        toast(mediaCleanupFailed
          ? "Your note was deleted, but its media could not be removed from this device."
          : "Your note was deleted.");
        if (view.name === "note-detail") {
          ctx.setView(deleted.channel === "chat" ? { name: "chat", peerId: deleted.recipientId } : "notes");
        } else {
          ctx.refresh();
        }
      } catch (error) {
        toast(error.message || "Could not delete your note.");
        if (button.isConnected) button.disabled = false;
      }
    };
  });
  app.querySelectorAll("[data-bvn-retry]").forEach(button => { button.onclick = () => ctx.refresh(); });
  const resumeDraft = app.querySelector("[data-bvn-resume-draft]");
  if (resumeDraft) resumeDraft.onclick = () => ctx.setView({ name: "note-editor" });

  app.querySelectorAll("[data-bvn-comment-form]").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      try {
        await addBlastVideoNoteComment(form.dataset.bvnCommentForm, new FormData(form).get("comment"));
        toast("Comment added.");
        ctx.refresh();
      } catch (error) {
        toast(error.message);
      }
    });
  });
  app.querySelectorAll("[data-bvn-chat-detail-form]").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      try {
        await addBlastChatReply(
          form.dataset.bvnChatDetailForm,
          new FormData(form).get("comment"),
          form.dataset.replyNote
        );
        toast("Reply sent.");
        ctx.setView({ name: "chat", peerId: form.dataset.bvnChatDetailForm });
      } catch (error) {
        toast(error.message);
      }
    });
  });
  app.querySelectorAll("[data-bvn-chat-form]").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      try {
        await addBlastChatReply(form.dataset.bvnChatForm, new FormData(form).get("message"));
        ctx.refresh();
      } catch (error) {
        toast(error.message);
      }
    });
  });
  if (view.name === "notes") bindNotesFeedPagination(view, ctx, app);
}
