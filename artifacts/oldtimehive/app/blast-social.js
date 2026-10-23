import { api } from "./store.js";
import { isStoryActive } from "./story-lifecycle.js";
import { openBlastCreative } from "./blast-creative.js";
import { creativeMediaMarkup, creativeAspect } from "./creative-viewer.js";
import { renderBlastSharedPost } from "./blast-shared-post.js";
import { getBlastCommunity } from "./blast-community-data.js";
import {
  listBlastPosts, listBlastCommunities, getBlastPost, listBlastGroups, createBlastPost, addBlastReply,
  toggleBlastReaction, toggleBlastRepost, toggleBlastSavedPost, setBlastEventRsvp, deleteBlastPost, listBlastPeople,
  listBlastFriends, listBlastFriendRequests, sendBlastFriendRequest,
  acceptBlastFriendRequest, removeBlastFriendRequest, removeBlastFriend
} from "./blast-store.js";
import {
  deleteBlastMedia, getBlastMediaUrl, getBlastVideoNoteLimits, saveBlastMedia
} from "./blast-video-note-store.js";

const VIDEO_LIMITS = getBlastVideoNoteLimits();

let feedType = "all";
let feedQuery = "";
let blastTimeline = "for-you";
let peopleQuery = "";
const BLAST_FEED_PAGE_SIZE = 24;
let blastFeedVisibleCount = BLAST_FEED_PAGE_SIZE;
let blastFeedObserver = null;
let draft = {};
let draftMedia = null;
let composerPanelOpen = "";
let draftHistory = [];
let draftMediaTool = "";
let mediaAnnotationHistory = [];
let activeMediaTextEditor = null;

const TYPES = [
  ["post", "Post", "edit"], ["question", "Question", "comment"],
  ["activity", "Activity", "activity"], ["event", "Event", "users"]
];
const FEED_FILTERS = new Set(["all", "post", "question", "activity", "events", "saved"]);
const AUDIENCES = [
  ["friends", "Friends"],
  ["group", "Group conversation"], ["only-me", "Only me"]
];
const labelAudience = value => ({
  public: "Friends", friends: "Friends", group: "Group", "only-me": "Only me", community: "Community members"
}[value] || "Friends");
const dateLabel = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Just now" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
};
const relativeTimeLabel = value => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "now";
  const elapsed = Math.max(0, Date.now() - date.getTime());
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
};

export function setBlastFeedFilter(type) {
  if (!FEED_FILTERS.has(type)) return false;
  feedType = type;
  feedQuery = "";
  blastFeedVisibleCount = BLAST_FEED_PAGE_SIZE;
  return true;
}

export function getBlastFeedFilter() {
  return feedType;
}

export function filterBlastTimelinePosts(posts, timeline, followingIds) {
  if (timeline !== "following") return posts;
  const followed = new Set(Array.isArray(followingIds) ? followingIds : []);
  return posts.filter(post => followed.has(post.authorId || post.author));
}

const profile = (id, esc) => {
  const user = api.user(id);
  return {
    name: user?.name || user?.username || "Oldtime member",
    username: user?.username || "member",
    avatar: user?.avatar || ""
  };
};
const safeImg = (url, esc, name = "") => url
  ? `<img class="blast-avatar" src="${esc(url)}" alt="" />`
  : `<span class="blast-avatar" aria-hidden="true">${esc(String(name).slice(0, 1).toUpperCase())}</span>`;
const postCounts = post => ({
  hearts: (post.reactions || []).filter(item => item.kind === "heart").length,
  replies: (post.replies || []).length,
  reposts: (post.reposts || []).length
});

const safeOverlayNumber = (value, fallback = 50) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : fallback;
};
const safeOverlayColor = color => color === "#111111" ? "#111111" : "#ffffff";

function blastMediaOverlays(media) {
  return {
    strokes: Array.isArray(media?.overlays?.strokes) ? media.overlays.strokes : [],
    labels: Array.isArray(media?.overlays?.labels) ? media.overlays.labels : []
  };
}

function blastMediaInkMarkup(overlays) {
  return overlays.strokes.map(stroke => {
    const points = Array.isArray(stroke.points) ? stroke.points : [];
    if (!points.length) return "";
    const pointList = points.map(point => `${safeOverlayNumber(point.x)},${safeOverlayNumber(point.y)}`).join(" ");
    const width = Math.max(0.8, Math.min(4, Number(stroke.width) || 2));
    const color = safeOverlayColor(stroke.color);
    const outline = color === "#ffffff" ? "#111111" : "#ffffff";
    if (points.length === 1) {
      const x = safeOverlayNumber(points[0].x);
      const y = safeOverlayNumber(points[0].y);
      return `<circle cx="${x}" cy="${y}" r="${width + 0.8}" fill="none" stroke="${outline}" stroke-width="1.5" vector-effect="non-scaling-stroke"/><circle cx="${x}" cy="${y}" r="${width / 2}" fill="${color}"/>`;
    }
    return `<polyline points="${pointList}" fill="none" stroke="${outline}" stroke-width="${width + 1.5}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><polyline points="${pointList}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
  }).join("");
}

function blastMediaLabelsMarkup(overlays, esc, editable = false) {
  return overlays.labels.map((label, index) => {
    const text = String(label.text || "").slice(0, 80);
    if (!text) return "";
    const x = safeOverlayNumber(label.x);
    return `<div class="blast-post-media-label" ${editable ? `data-blast-media-label="${index}"` : ""} style="left:${x}%;top:${safeOverlayNumber(label.y)}%;max-width:calc(100% - ${x}%)">${esc(text)}</div>`;
  }).join("");
}

function communityMediaMarkup(media, esc, editable = false) {
  if (!media?.dataUrl && !media?.mediaId) return "";
  if(media.creativeProject&&!editable)return `<div class="blast-post-media-stage" style="aspect-ratio:${creativeAspect(media.creativeProject)}">${creativeMediaMarkup({id:media.creativeId,creativeProject:media.creativeProject},esc)}</div>`;
  const overlays = blastMediaOverlays(media);
  const modeClass = editable && draftMediaTool ? ` is-${draftMediaTool}-tool` : "";
  const mediaUrl = editable ? media.previewUrl || media.dataUrl : media.dataUrl;
  const mediaElement = media.mediaType === "video"
    ? `<video class="blast-media-preview" controls playsinline preload="metadata" ${mediaUrl ? `src="${esc(mediaUrl)}"` : `data-blast-video-id="${esc(media.mediaId || "")}"`} aria-label="${editable ? "Video being edited" : "Attached video"}"></video>`
    : `<img class="blast-media-preview" src="${esc(mediaUrl || "")}" alt="${editable ? "Photo being edited" : "Attached image"}" />`;
  return `<div class="blast-post-media-stage${editable ? ` blast-post-media-edit-stage${modeClass}` : ""}" ${editable ? 'data-blast-post-media-stage role="group" aria-label="Photo or video annotation area"' : ""}>
    ${mediaElement}
    ${editable&&media.creativeProject?'<button type="button" class="blast-btn" data-blast-creative-edit>Edit in Creative Studio</button>':""}
    <svg class="blast-post-media-ink" ${editable ? 'data-blast-post-media-ink' : ""} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${blastMediaInkMarkup(overlays)}</svg>
    <div class="blast-post-media-text-layer" ${editable ? 'data-blast-post-media-text-layer' : ""}>${blastMediaLabelsMarkup(overlays, esc, editable)}</div>
  </div>`;
}

function releaseMediaPreview(media) {
  if (media?.previewUrl) URL.revokeObjectURL(media.previewUrl);
}

function discardDraftMedia(media) {
  releaseMediaPreview(media);
  if (media?.mediaId) {
    deleteBlastMedia(media.mediaId).catch(error => console.warn("Unsent media could not be removed from account storage.", error));
  }
}

async function hydrateStoredBlastVideos(app) {
  const videos = [...app.querySelectorAll("video[data-blast-video-id]")];
  await Promise.all(videos.map(async video => {
    const mediaId = video.dataset.blastVideoId;
    try {
      const url = await getBlastMediaUrl(mediaId);
      if (!video.isConnected || video.dataset.blastVideoId !== mediaId) return;
      if (!url) throw new Error("This video is unavailable on this device.");
      video.src = url;
      video.load();
    } catch {
      if (!video.isConnected || video.dataset.blastVideoId !== mediaId) return;
      const stage = video.closest(".blast-post-media-stage");
      video.remove();
      if (!stage) return;
      stage.classList.add("blast-post-media-unavailable");
      const message = document.createElement("p");
      message.className = "blast-post-media-error";
      message.textContent = "This video is unavailable in this device's storage.";
      stage.append(message);
    }
  }));
}

function draftMediaOverlays() {
  if (!draftMedia) return { strokes: [], labels: [] };
  if (!draftMedia.overlays || typeof draftMedia.overlays !== "object") draftMedia.overlays = {};
  if (!Array.isArray(draftMedia.overlays.strokes)) draftMedia.overlays.strokes = [];
  if (!Array.isArray(draftMedia.overlays.labels)) draftMedia.overlays.labels = [];
  return draftMedia.overlays;
}

function saveMediaAnnotationSnapshot() {
  const overlays = draftMediaOverlays();
  mediaAnnotationHistory.push(JSON.stringify(overlays));
  if (mediaAnnotationHistory.length > 50) mediaAnnotationHistory.shift();
}

function redrawDraftMediaOverlays(stage, esc) {
  if (!stage || !draftMedia) return;
  const overlays = draftMediaOverlays();
  const ink = stage.querySelector("[data-blast-post-media-ink]");
  const labels = stage.querySelector("[data-blast-post-media-text-layer]");
  if (ink) ink.innerHTML = blastMediaInkMarkup(overlays);
  if (labels) labels.innerHTML = blastMediaLabelsMarkup(overlays, esc, true);
}

function commitActiveMediaText(esc) {
  const active = activeMediaTextEditor;
  if (!active) return;
  activeMediaTextEditor = null;
  const rawText = String(active.element.innerText || active.element.textContent || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .slice(0, 80);
  const text = rawText.trim();
  const overlays = draftMediaOverlays();
  if (active.index !== null && active.index < overlays.labels.length) {
    const previous = overlays.labels[active.index];
    if (text !== String(previous.text || "").trim()) {
      saveMediaAnnotationSnapshot();
      if (text) overlays.labels[active.index] = { ...previous, text };
      else overlays.labels.splice(active.index, 1);
    }
  } else if (text) {
    saveMediaAnnotationSnapshot();
    overlays.labels.push({ ...active.label, text });
  }
  active.element.remove();
  redrawDraftMediaOverlays(active.stage, esc);
}

function beginMediaTextEdit(stage, point, labelIndex, esc) {
  commitActiveMediaText(esc);
  const overlays = draftMediaOverlays();
  const existing = labelIndex === null ? null : overlays.labels[labelIndex];
  const label = existing
    ? { ...existing }
    : { x: safeOverlayNumber(point.x), y: safeOverlayNumber(point.y), color: "#ffffff", size: 6 };
  const layer = stage.querySelector("[data-blast-post-media-text-layer]");
  if (!layer) return;
  const editor = document.createElement("div");
  editor.className = "blast-post-media-text-editor";
  editor.contentEditable = "true";
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-label", "Text placed on media");
  editor.setAttribute("aria-multiline", "true");
  editor.dataset.placeholder = "Type here";
  editor.dataset.blastMediaTextEditor = "true";
  editor.style.left = `${safeOverlayNumber(label.x)}%`;
  editor.style.top = `${safeOverlayNumber(label.y)}%`;
  editor.style.maxWidth = `calc(100% - ${safeOverlayNumber(label.x)}%)`;
  editor.textContent = existing?.text || "";
  layer.append(editor);
  activeMediaTextEditor = { element: editor, stage, index: labelIndex, label };
  editor.addEventListener("input", () => {
    const text = String(editor.innerText || editor.textContent || "").replace(/\r/g, "").replace(/\u00a0/g, " ");
    if (text.length <= 80) return;
    editor.textContent = text.slice(0, 80);
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  editor.addEventListener("blur", () => commitActiveMediaText(esc));
  requestAnimationFrame(() => {
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}

function mediaPoint(event, stage) {
  const bounds = stage.getBoundingClientRect();
  return {
    x: safeOverlayNumber((event.clientX - bounds.left) / Math.max(1, bounds.width) * 100),
    y: safeOverlayNumber((event.clientY - bounds.top) / Math.max(1, bounds.height) * 100)
  };
}

export function renderBlastTimelinePost(post, ctx) {
  const { me, esc, icon } = ctx;
  const author = profile(post.authorId, esc);
  const counts = postCounts(post);
  const ownReactions = new Set((post.reactions || []).filter(item => item.userId === me.id).map(item => item.kind));
  const isReposted = (post.reposts || []).some(item => item.userId === me.id);
  const isSaved = (post.savedBy || []).includes(me.id);
  const event = post.type === "event" ? `<div class="blast-event-box">
    <div class="blast-event-line"><b>${esc(post.event?.kind?.replaceAll("-", " ") || "Event")}</b><span>${post.event?.online ? "Online" : esc(post.event?.location || post.location || "Venue to be shared")}</span></div>
    <div class="blast-event-line" style="margin-top:8px"><span>${esc(dateLabel(post.event?.startsAt))}</span><span>${(post.participants || []).length} going or interested</span></div>
    <div class="blast-actions"><button type="button" class="blast-secondary" data-blast-detail="${esc(post.id)}" data-testid="blast-event-details">Event details</button></div></div>` : "";
  return `<article class="blast-card blast-post" data-testid="blast-post-card-${esc(post.id)}">
    <div class="blast-post-avatar">${safeImg(author.avatar, esc, author.name)}</div>
    <div class="blast-post-content">
      <div class="blast-post-top">
        <div class="blast-person"><b>${esc(author.name)}</b><small>@${esc(author.username)} · ${esc(relativeTimeLabel(post.createdAt))}</small></div>
        <span class="blast-audience">${esc(labelAudience(post.audience))}</span>
      </div>
      ${post.title ? `<h3>${esc(post.title)}</h3>` : ""}
      ${post.body ? `<p class="blast-post-copy">${esc(post.body)}</p>` : ""}
      ${renderBlastSharedPost(post, ctx)}
      ${communityMediaMarkup(post.media, esc)}
      ${event}
      <div class="blast-post-meta"><span>${esc(post.type[0].toUpperCase() + post.type.slice(1))}</span>${post.location ? `<span>${icon("users")} ${esc(post.location)}</span>` : ""}</div>
      <div class="blast-post-actions">
        <button type="button" data-blast-detail="${esc(post.id)}" data-testid="blast-open-detail-${esc(post.id)}" aria-label="Reply to post, ${counts.replies} replies">${icon("comment")}<span>${counts.replies || ""}</span></button>
         <button type="button" class="${isReposted ? "is-on" : ""}" data-blast-repost="${esc(post.id)}" aria-pressed="${isReposted}" aria-label="${isReposted ? "Undo repost" : "Repost"}" data-testid="blast-repost-${esc(post.id)}">${icon("repost")}<span>${counts.reposts || ""}</span></button>
        <button type="button" class="${ownReactions.has("heart") ? "is-on" : ""}" data-blast-react="heart" data-id="${esc(post.id)}" aria-pressed="${ownReactions.has("heart")}" aria-label="${ownReactions.has("heart") ? "Remove like from this post" : "Like this post"}" data-testid="blast-reaction-heart">${icon("heart")}<span>${counts.hearts || ""}</span></button>
        <button type="button" class="${isSaved ? "is-on" : ""}" data-blast-save="${esc(post.id)}" aria-pressed="${isSaved}" aria-label="${isSaved ? "Remove bookmark" : "Save post"}" data-testid="blast-save-${esc(post.id)}">${icon("bookmark")}</button>
        <button type="button" data-blast-share="${esc(post.id)}" aria-label="Share post" data-testid="blast-share-${esc(post.id)}">${icon("send")}</button>
      </div>
    </div>
  </article>`;
}

export function renderBlastStoriesStrip(ctx) {
  const { me, esc, icon } = ctx;
  const stories = (api.db()?.stories || [])
    .filter(story => isStoryActive(story) && api.canSeeStory(story))
    .sort((a, b) => b.created - a.created);
  const byAuthor = new Map();
  stories.forEach(story => { if (!byAuthor.has(story.author)) byAuthor.set(story.author, story); });
  const following = Array.isArray(me.following) ? me.following : [];
  const authorIds = [...new Set([me.id, ...following, ...byAuthor.keys()])]
    .filter(id => id === me.id || byAuthor.has(id))
    .slice(0, 18);
  const tiles = authorIds.map((id, index) => {
    const person = id === me.id ? me : api.user(id);
    if (!person) return "";
    const own = id === me.id;
    const story = byAuthor.get(id);
    const label = own ? "Your story" : person.name || person.username || "Oldtime member";
    const closeFriends = story && (story.closeFriends === true || ["close-friends", "close_friends"].includes(String(story.visibility || story.audience || "").toLowerCase()));
    const action = own && !story
      ? `data-blast-create-story aria-label="Create your story"`
      : `data-blast-open-story="${esc(id)}" aria-label="View ${esc(label)}'s story"`;
    return `<button class="blast-story-tile ${own ? "is-own" : ""}" type="button" ${action} title="${esc(label)}" data-testid="blast-story-${own ? "own" : esc(id)}">
      <span class="blast-story-ring ${story ? "has-story" : "is-empty"} ${closeFriends ? "is-close-friends" : ""}">
        ${person.avatar ? `<img src="${esc(person.avatar)}" alt="" loading="lazy" />` : `<span class="blast-story-initial">${esc(label.slice(0, 1).toUpperCase())}</span>`}
        ${own && !story ? `<span class="blast-story-add">${icon("plus")}</span>` : story?.kind === "video" ? `<span class="blast-story-play">${icon("play")}</span>` : ""}
      </span><span class="blast-story-name">${esc(label)}</span>
    </button>`;
  }).join("");
  return `<section class="blast-stories-section" aria-label="Stories">
    <div class="blast-stories-heading"><h2>Stories</h2><div>
      <button type="button" data-blast-create-story>${icon("plus")}<span>Add story</span></button>
      <button type="button" data-tab="communities">See all</button>
    </div></div>
    <div class="blast-story-rail">${tiles || `<p class="blast-stories-empty">No stories to show yet.</p>`}</div>
  </section>`;
}

export function renderBlastDiscoveryStrip(ctx) {
  const { esc, icon } = ctx;
  const communities = listBlastCommunities().slice(0, 4);
  if (!communities.length) return "";
  return `<section class="blast-discover-strip" aria-label="Discover communities">
    <div class="blast-discover-heading"><h2>Discover</h2><button type="button" data-blast-nav="communities">See all</button></div>
    <div class="blast-discover-cards">${communities.map(community => `<button class="blast-discover-card" type="button" data-blast-nav="communities" data-testid="blast-discover-${esc(community.id)}">
      <span>${icon(community.icon)}</span><b>${esc(community.name)}</b><small>${esc(community.category)}</small>
    </button>`).join("")}</div>
  </section>`;
}

function hub(ctx) {
  const { me, esc, icon } = ctx;
  const visiblePosts = listBlastPosts(undefined, { type: feedType === "saved" ? "all" : feedType, query: feedQuery })
    .filter(post => feedType !== "saved" || (post.savedBy || []).includes(me.id));
  const posts = feedType === "saved" ? visiblePosts : filterBlastTimelinePosts(visiblePosts, blastTimeline, me.following);
  const pagePosts = posts.slice(0, blastFeedVisibleCount);
  const cards = pagePosts.map(post => renderBlastTimelinePost(post, ctx)).join("");
  const pager = posts.length > pagePosts.length
    ? `<div class="blast-feed-pager"><button type="button" class="blast-feed-load" data-blast-load-more>Load more posts</button></div>`
    : "";
  const timelineTabs = feedType === "saved" ? "" : `<nav class="blast-timeline-tabs" aria-label="Community timeline">
    <button type="button" class="blast-timeline-tab ${blastTimeline === "for-you" ? "is-active" : ""}" data-blast-timeline="for-you" aria-pressed="${blastTimeline === "for-you"}">For you</button>
    <button type="button" class="blast-timeline-tab ${blastTimeline === "following" ? "is-active" : ""}" data-blast-timeline="following" aria-pressed="${blastTimeline === "following"}">Following</button>
  </nav>`;
  const stories = feedType === "saved" ? "" : renderBlastStoriesStrip(ctx);
  const discover = feedType === "saved" ? "" : renderBlastDiscoveryStrip(ctx);
  const meAvatar = me.avatar ? `<img class="blast-me-avatar" src="${esc(me.avatar)}" alt="" />` : `<span class="blast-me-avatar"></span>`;
  return `<main class="blast-screen blast-hub"><div class="blast-wrap blast-anim">
    <header class="blast-head"><div><div class="blast-brand">Community</div><p class="blast-kicker">A little closer to home.</p></div>
      <div class="blast-head-actions">
        <button class="blast-icon-btn" type="button" data-blast-nav="friends" aria-label="Manage friends" data-testid="blast-friends">${icon("users")}</button>
        <button class="blast-icon-btn" type="button" data-blast-settings-open aria-label="Open settings" aria-expanded="${ctx.settingsOpen === true}" data-testid="blast-settings-open">${icon("settings")}</button>
      </div></header>
     <nav class="blast-tabs" aria-label="Community sections"><button class="blast-tab" type="button" data-blast-feed-scope="for-you">For you</button><button class="blast-tab" type="button" data-blast-feed-scope="following">Following</button><button class="blast-tab" type="button" data-blast-nav="communities">Communities</button><button class="blast-tab" type="button" data-blast-nav="chats">Chats</button></nav>
      ${timelineTabs}
      ${stories}
      ${discover}
      <div class="blast-feed-title"><h2>Home</h2><small>${posts.length} ${posts.length === 1 ? "post" : "posts"}</small></div>
      <div class="blast-compose-bar">${meAvatar}<button class="blast-compose-prompt" type="button" data-blast-new="post" data-testid="blast-compose-prompt">What’s happening?</button>
        <button class="blast-compose-create" type="button" data-blast-new="post" data-testid="blast-create">Post</button></div>
    <form class="blast-feed-tools" data-blast-search-form>
       <input class="blast-input" type="search" name="query" value="${esc(feedQuery)}" placeholder="Search posts" aria-label="Search posts" data-testid="blast-search" />
        <label class="blast-filter-wrap"><span class="blast-sr-only">Filter by category</span><select class="blast-select" name="type" aria-label="Filter by category" data-testid="blast-filter">
         ${[["all","All categories"],["post","Posts"],["question","Questions"],["activity","Activities"],["events","Events"],["saved","Saved"]].map(([value, label]) => `<option value="${value}" ${feedType === value ? "selected" : ""}>${label}</option>`).join("")}
       </select></label>
       <button class="blast-search-submit" type="submit" aria-label="Search neighborhood feed" data-testid="blast-search-submit">${icon("search")}</button>
    </form>
     ${cards || `<section class="blast-card blast-empty"><span class="blast-empty-mark">${icon(feedType === "saved" ? "bookmark" : "comment")}</span><h3>${feedType === "saved" ? "No saved posts yet" : blastTimeline === "following" && !feedQuery && feedType === "all" ? "No recent posts from people you follow" : feedQuery || feedType !== "all" ? "No posts found" : "Start the conversation"}</h3>
      <p>${feedType === "saved" ? "Save a post and it will be kept here." : blastTimeline === "following" && !feedQuery && feedType === "all" ? "Posts from people you follow will appear here when they share to an audience you can view." : feedQuery || feedType !== "all" ? "Try another search or filter." : "Your Community feed is ready for its first thought or plan."}</p>
       ${feedType === "saved" || blastTimeline === "following" ? "" : `<button class="blast-primary" type="button" data-blast-new="post" data-testid="blast-empty-create">Create a post</button>`}</section>`}${pager}
  </div></main>`;
}

function compose(ctx, isEvent = false) {
  const { esc, icon } = ctx;
  draft = { type: isEvent ? "event" : "post", audience: "friends", ...(draft || {}) };
  if (draft.audience === "public") draft.audience = "friends";
  if (isEvent) draft.type = "event";
  const selectedCommunity = getBlastCommunity(draft.communityId);
  if (selectedCommunity) draft.audience = "community";
  const groups = listBlastGroups();
  const event = draft.type === "event" ? `<div class="blast-card" style="padding:14px;display:grid;gap:13px">
    <div class="blast-eyebrow">Event details</div>
    <div class="blast-field"><label for="blast-event-kind">What are we doing?</label><select class="blast-select" id="blast-event-kind" name="eventKind" data-testid="blast-event-kind">
      ${[["watch-party","Watch party"],["meetup","Meetup"],["fitness-challenge","Fitness challenge"]].map(([v,l]) => `<option value="${v}" ${draft.eventKind === v ? "selected" : ""}>${l}</option>`).join("")}
    </select></div>
    <div class="blast-inline-fields"><div class="blast-field"><label for="blast-event-time">Starts</label><input class="blast-input" id="blast-event-time" type="datetime-local" name="startsAt" value="${esc(draft.startsAt || "")}" required data-testid="blast-event-start" /></div>
    <div class="blast-field"><label for="blast-event-duration">Duration, minutes</label><input class="blast-input" id="blast-event-duration" type="number" name="durationMinutes" min="15" max="1440" value="${esc(draft.durationMinutes || "60")}" required data-testid="blast-event-duration" /></div></div>
    <label class="blast-check-row"><input type="checkbox" name="online" ${draft.online ? "checked" : ""} data-testid="blast-event-online" /> This event is online</label>
    <div class="blast-field"><label for="blast-event-location">Venue or meeting place</label><input class="blast-input" id="blast-event-location" name="eventLocation" maxlength="120" value="${esc(draft.eventLocation || "")}" placeholder="Venue or meeting place" data-testid="blast-event-location" /></div>
    </div>` : "";
  const groupsMarkup = draft.audience === "group" ? (groups.length
    ? `<div class="blast-field"><label for="blast-group">Group conversation</label><select class="blast-select" id="blast-group" name="groupId" required data-testid="blast-group-select"><option value="">Choose a group</option>${groups.map(group => `<option value="${esc(group.id)}" ${draft.groupId === group.id ? "selected" : ""}>${esc(group.name)} · ${group.memberCount} members</option>`).join("")}</select></div>`
    : `<p class="blast-notice">You do not have a group conversation available for this audience. Create or join a group conversation in Oldtime, then return here.</p>`) : "";
  const typeButtons = TYPES.map(([type, label, glyph]) => `<button type="button" class="blast-type-choice ${draft.type === type ? "is-active" : ""}" data-blast-type="${type}" aria-pressed="${draft.type === type}" data-testid="blast-type-${type}">${icon(glyph)}${label}</button>`).join("");
  const audienceButtons = AUDIENCES.map(([value, label]) => `<button type="button" class="blast-audience-choice ${draft.audience === value ? "is-active" : ""}" data-blast-audience="${value}" aria-pressed="${draft.audience === value}" data-testid="blast-audience-${value}">${label}</button>`).join("");
  if (!isEvent) {
    const typePanel = composerPanelOpen === "type" ? `<section class="blast-notes-panel" aria-label="Choose post type">
      <span class="blast-notes-panel-label">Post type</span><div class="blast-type-picker">${typeButtons}</div></section>` : "";
    const groupPicker = draft.audience === "group" ? `<div class="blast-notes-group-slot">${groupsMarkup}</div>` : "";
    const audiencePanel = !selectedCommunity && composerPanelOpen === "audience" ? `<section class="blast-notes-panel" aria-label="Choose audience">
      <span class="blast-notes-panel-label">Who can see this?</span><div class="blast-audience-choices">${audienceButtons}</div>${groupPicker}</section>` : "";
    const locationPanel = composerPanelOpen === "location" ? `<section class="blast-notes-panel blast-notes-location-panel">
      <label class="blast-notes-panel-label" for="blast-post-location">Place (optional)</label>
      <input class="blast-input" id="blast-post-location" name="location" maxlength="120" value="${esc(draft.location || "")}" placeholder="Add a place manually" data-testid="blast-location" /></section>` : "";
    const locationIcon = `<svg class="navic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>`;
    const locationSummary = draft.location && composerPanelOpen !== "location" ? `<div class="blast-notes-location-summary">
      ${locationIcon}<span>${esc(draft.location)}</span><button type="button" data-blast-panel-toggle="location" aria-label="Edit post location">Edit</button></div>` : "";
    const selectedGroupName = groups.find(group => group.id === draft.groupId)?.name;
    const activityField = draft.type === "activity" ? `<label class="blast-notes-activity">
      <span class="blast-sr-only">Activity goal (optional)</span><input id="blast-activity-goal" name="activityGoal" maxlength="100" value="${esc(draft.activityGoal || "")}" placeholder="Activity goal (optional)" data-testid="blast-activity-goal" /></label>` : "";
    const mediaEditor = draftMedia ? `<section class="blast-post-media-editor" aria-label="Edit attached media">
      ${communityMediaMarkup(draftMedia, esc, true)}
      <div class="blast-post-media-tools" role="group" aria-label="Media editing tools">
        <button type="button" class="${draftMediaTool === "text" ? "is-active" : ""}" data-blast-media-tool="text" aria-pressed="${draftMediaTool === "text"}"><b aria-hidden="true">T</b>Text</button>
        <button type="button" class="${draftMediaTool === "draw" ? "is-active" : ""}" data-blast-media-tool="draw" aria-pressed="${draftMediaTool === "draw"}">${icon("edit")}Draw</button>
        <button type="button" data-blast-media-undo aria-label="Undo last media mark">Undo</button>
      </div>
    </section>` : "";
    return `<main class="blast-screen blast-notes-composer" data-testid="blast-notes-composer">
      <form class="blast-notes-form" id="blast-create-form" data-testid="blast-create-form">
        <header class="blast-notes-topbar">
          <button type="button" class="blast-notes-icon" data-blast-nav="${selectedCommunity ? "communities" : "hub"}" aria-label="Back to Community">${icon("back")}</button>
          <h1>Write a post</h1>
          <div class="blast-notes-top-actions">
            <button type="button" class="blast-notes-icon" data-blast-editor-undo aria-label="Undo last text edit" title="Undo">${`↶`}</button>
            <button type="submit" class="blast-notes-share" aria-label="Share post" data-testid="blast-submit">${icon("share")}<span>Share</span></button>
            <button type="button" class="blast-notes-icon" data-blast-panel-toggle="type" aria-label="Post type options" aria-expanded="${composerPanelOpen === "type"}">${icon("more")}</button>
          </div>
        </header>
        <div class="blast-notes-writing">
          <label class="blast-sr-only" for="blast-title">Title (optional)</label>
          <input class="blast-notes-title" id="blast-title" name="title" maxlength="90" value="${esc(draft.title || "")}" placeholder="Title" data-testid="blast-title" />
          <label class="blast-sr-only" for="blast-body">${draft.type === "question" ? "Ask your neighborhood" : "Your thought"}</label>
          <textarea class="blast-notes-body${draftMedia ? " has-media" : ""}" id="blast-body" name="body" maxlength="1000" placeholder="${draft.type === "question" ? "What would you like to ask?" : "Start writing…"}" required data-testid="blast-body">${esc(draft.body || "")}</textarea>
          ${activityField}
          ${mediaEditor}
        </div>
        <div class="blast-notes-bottom">
          <div class="blast-notes-audience-row">
            <span>${icon("lock")}<b>${selectedCommunity ? `Community · ${esc(selectedCommunity.name)}` : esc(labelAudience(draft.audience))}</b>${draft.audience === "group" && selectedGroupName ? `<small>${esc(selectedGroupName)}</small>` : ""}</span>
            ${selectedCommunity ? "" : `<button type="button" data-blast-panel-toggle="audience" aria-expanded="${composerPanelOpen === "audience"}">Change ${icon("back")}</button>`}
          </div>
          ${selectedCommunity ? `<p class="blast-community-members-only">Only joined members can view or reply.</p><input type="hidden" name="communityId" value="${esc(selectedCommunity.id)}" />` : ""}
          ${locationSummary}${audiencePanel}${typePanel}${locationPanel}
          ${draft.audience === "group" && composerPanelOpen !== "audience" && draft.groupId ? `<input type="hidden" name="groupId" value="${esc(draft.groupId)}" />` : ""}
          ${draft.location && composerPanelOpen !== "location" ? `<input type="hidden" name="location" value="${esc(draft.location)}" />` : ""}
          <footer class="blast-notes-toolbar">
            <div class="blast-notes-tools" role="group" aria-label="Post options">
              <button type="button" data-blast-panel-toggle="type" aria-label="Choose post type">${icon("edit")}</button>
              <button type="button" data-blast-media-trigger aria-label="Add a photo or video" data-testid="blast-add-media">${icon("image")}<span>Photo/video</span></button>
              ${selectedCommunity ? "" : `<button type="button" data-blast-panel-toggle="audience" aria-label="Choose who can see this">${icon("lock")}</button>`}
              <button type="button" data-blast-panel-toggle="location" aria-label="Add a place">${locationIcon}</button>
            </div>
          </footer>
          <input class="blast-notes-file" id="blast-media" type="file" accept="image/*,video/*" data-testid="blast-media" />
        </div>
      </form>
    </main>`;
  }
  return ctx.page(draft.type === "event" ? "Plan an event" : "Write a post", `<form class="blast-form" id="blast-create-form" data-testid="blast-create-form">
    <div class="blast-field"><span class="blast-label">Choose a format</span><div class="blast-type-picker">${typeButtons}</div></div>
    <div class="blast-field"><label for="blast-title">${draft.type === "event" ? "Event title" : "Title (optional)"}</label><input class="blast-input" id="blast-title" name="title" maxlength="90" value="${esc(draft.title || "")}" placeholder="${draft.type === "event" ? "Give the plan a name" : "Add a heading"}" ${draft.type === "event" ? "required" : ""} data-testid="blast-title" /></div>
    <div class="blast-field"><label for="blast-body">${draft.type === "question" ? "Ask your neighborhood" : draft.type === "event" ? "Details (optional)" : "Your thought"}</label><textarea class="blast-textarea" id="blast-body" name="body" maxlength="1000" placeholder="${draft.type === "question" ? "What would you like to know?" : "Share the details…"}" ${draft.type !== "event" ? "required" : ""} data-testid="blast-body">${esc(draft.body || "")}</textarea><small class="blast-help">Up to 1,000 characters.</small></div>
    ${event}
    ${draft.type === "activity" ? `<div class="blast-field"><label for="blast-goal">Activity goal (optional)</label><input class="blast-input" id="blast-goal" name="activityGoal" maxlength="100" value="${esc(draft.activityGoal || "")}" placeholder="A goal to work toward" data-testid="blast-activity-goal" /></div>` : ""}
    ${selectedCommunity ? `<p class="blast-notice">Posting to ${esc(selectedCommunity.name)}. Only joined members can view or reply.</p><input type="hidden" name="communityId" value="${esc(selectedCommunity.id)}" />` : `<div class="blast-field"><span class="blast-label">Who can see this?</span><div class="blast-audience-choices">${audienceButtons}</div>${groupsMarkup}</div>`}
    <div class="blast-field"><label for="blast-post-location">Place (optional)</label><input class="blast-input" id="blast-post-location" name="location" maxlength="120" value="${esc(draft.location || "")}" placeholder="Add a place manually" data-testid="blast-location" /></div>
      <div class="blast-field"><label for="blast-media">Image or video (optional)</label><input class="blast-input" id="blast-media" type="file" accept="image/*,video/*" data-testid="blast-media" /><small class="blast-help">Choose a photo or video to share.</small>
      ${draftMedia ? `<small class="blast-help">Attached: ${esc(draftMedia.name || "Selected file")}</small>` : ""}</div>
     <div class="blast-actions"><button class="blast-primary" type="submit" data-testid="blast-submit">${draft.type === "event" ? "Create event" : "Share post"}</button><button class="blast-secondary" type="button" data-blast-nav="notes" data-testid="blast-cancel">Cancel</button></div>
  </form>`, `<p class="blast-kicker" style="text-align:center;margin:-12px 0 18px">Pick the audience that feels right. Friends here are separate from follows.</p>`);
}

function detail(ctx, postId) {
  const post = getBlastPost(postId);
  if (!post) return ctx.page("Community", `<section class="blast-card blast-empty"><h3>This post is unavailable</h3><p>It may have been removed or is no longer visible to you.</p><button type="button" class="blast-primary" data-blast-nav="notes">Return to For you</button></section>`);
  const author = profile(post.authorId, ctx.esc);
  const counts = postCounts(post);
  const myReactions = new Set((post.reactions || []).filter(item => item.userId === ctx.me.id).map(item => item.kind));
  const isReposted = (post.reposts || []).some(item => item.userId === ctx.me.id);
  const isSaved = (post.savedBy || []).includes(ctx.me.id);
  const myRsvp = (post.participants || []).find(item => item.userId === ctx.me.id)?.status || "";
  const replies = (post.replies || []).map(reply => {
    const person = profile(reply.authorId, ctx.esc);
    return `<article class="blast-reply">${safeImg(person.avatar, ctx.esc, person.name)}<div><small><b>${ctx.esc(person.name)}</b> · ${ctx.esc(dateLabel(reply.createdAt))}</small><p>${ctx.esc(reply.body)}</p></div></article>`;
  }).join("");
  const event = post.type === "event" ? `<section class="blast-card" style="padding:15px;margin:14px 0">
    <div class="blast-eyebrow">Event plan</div><h3 style="margin:8px 0">${ctx.esc(post.event?.kind?.replaceAll("-", " ") || "Event")}</h3>
    <p class="blast-muted" style="font-size:12px;line-height:1.5">${ctx.esc(dateLabel(post.event?.startsAt))} · ${Number(post.event?.durationMinutes || 60)} minutes</p>
    <p style="margin-top:7px;font-size:12px">${post.event?.online ? "Online gathering" : `Meet at ${ctx.esc(post.event?.location || "venue not listed")}`}</p>
    <div class="blast-actions"><button type="button" class="blast-primary ${myRsvp === "going" ? "is-on" : ""}" data-blast-rsvp="going" data-id="${ctx.esc(post.id)}" aria-pressed="${myRsvp === "going"}" data-testid="blast-rsvp-going">Going</button>
      <button type="button" class="blast-secondary ${myRsvp === "interested" ? "is-on" : ""}" data-blast-rsvp="interested" data-id="${ctx.esc(post.id)}" aria-pressed="${myRsvp === "interested"}" data-testid="blast-rsvp-interested">Interested</button>
      <button type="button" class="blast-quiet" data-blast-rsvp="none" data-id="${ctx.esc(post.id)}" data-testid="blast-rsvp-none">Clear</button></div>
    <small class="blast-help" style="display:block;margin-top:8px">${(post.participants || []).length} responses</small></section>` : "";
  return ctx.page(post.type === "event" ? "Event detail" : "Post detail", `<article class="blast-card blast-post blast-detail-post">
    <div class="blast-post-top">${safeImg(author.avatar, ctx.esc, author.name)}<div class="blast-person"><b>${ctx.esc(author.name)}</b><small>@${ctx.esc(author.username)} · ${ctx.esc(dateLabel(post.createdAt))}</small></div><span class="blast-audience">${ctx.esc(labelAudience(post.audience))}</span></div>
    ${post.title ? `<h3>${ctx.esc(post.title)}</h3>` : ""}${post.body ? `<p class="blast-detail-copy">${ctx.esc(post.body)}</p>` : ""}
     ${communityMediaMarkup(post.media, ctx.esc)}
     ${renderBlastSharedPost(post, ctx)}
    ${post.activityGoal ? `<p class="blast-notice" style="margin-top:12px">Activity goal · ${ctx.esc(post.activityGoal)}</p>` : ""}
    ${post.location && post.type !== "event" ? `<p class="blast-post-meta">${ctx.esc(post.location)}</p>` : ""}
      <div class="blast-post-actions"><button type="button" class="${myReactions.has("heart") ? "is-on" : ""}" data-blast-react="heart" data-id="${ctx.esc(post.id)}" aria-pressed="${myReactions.has("heart")}" aria-label="${myReactions.has("heart") ? "Remove like from this post" : "Like this post"}" data-testid="blast-detail-heart">${ctx.icon("heart")}<span>${counts.hearts || ""}</span></button><button type="button" data-blast-detail-replies aria-label="Jump to replies" data-testid="blast-detail-replies">${ctx.icon("comment")}<span>${counts.replies || ""}</span></button><button type="button" class="${isReposted ? "is-on" : ""}" data-blast-repost="${ctx.esc(post.id)}" aria-pressed="${isReposted}" aria-label="${isReposted ? "Undo repost" : "Repost"}" data-testid="blast-detail-repost">${ctx.icon("repost")}<span>${counts.reposts || ""}</span></button><button type="button" class="${isSaved ? "is-on" : ""}" data-blast-save="${ctx.esc(post.id)}" aria-pressed="${isSaved}" aria-label="${isSaved ? "Remove bookmark" : "Save post"}" data-testid="blast-detail-save">${ctx.icon("bookmark")}</button><button type="button" data-blast-share="${ctx.esc(post.id)}" aria-label="Share post" data-testid="blast-detail-share">${ctx.icon("send")}</button></div>
     ${post.authorId === ctx.me.id ? `<button type="button" class="blast-danger" data-blast-delete="${ctx.esc(post.id)}" data-testid="blast-delete">Delete this post</button>` : ""}
  </article>${event}
  <div class="blast-section-heading"><h2>Replies</h2><small>${counts.replies}</small></div>
   <div class="blast-replies" aria-label="Community replies">${replies || `<div class="blast-card blast-empty"><p>No replies yet. Be the first to join in.</p></div>`}</div>
   <form class="blast-form blast-reply-composer" id="blast-reply-form" data-testid="blast-reply-form"><div class="blast-field"><label for="blast-reply">Add a reply</label><textarea class="blast-textarea" id="blast-reply" name="reply" maxlength="500" required placeholder="Keep it neighborly" data-testid="blast-reply-input"></textarea></div><button type="submit" class="blast-primary" data-testid="blast-reply-submit">Reply</button></form>`);
}

function friends(ctx) {
  const friends = listBlastFriends();
  const requests = listBlastFriendRequests();
  const me = ctx.me;
  const incoming = requests.filter(item => item.to === me.id);
  const outgoing = requests.filter(item => item.from === me.id);
  const people = listBlastPeople(peopleQuery).filter(person => person.status !== "friends");
  const personRows = people.map(person => `<div class="blast-person-row">${safeImg(person.avatar, ctx.esc, person.name)}
    <span class="blast-person"><b>${ctx.esc(person.name)}</b><small>@${ctx.esc(person.username)} · ${person.status === "incoming" ? "Request received" : person.status === "outgoing" ? "Request sent" : "Not connected"}</small></span>
    ${person.status === "incoming" ? `<button type="button" class="blast-primary" data-blast-accept-person="${ctx.esc(person.id)}" data-testid="blast-person-accept">Accept</button>` : person.status === "outgoing" ? `<button type="button" class="blast-quiet" data-blast-cancel-person="${ctx.esc(person.id)}" data-testid="blast-person-cancel">Cancel request</button>` : `<button type="button" class="blast-secondary" data-blast-add-person="${ctx.esc(person.id)}" data-testid="blast-person-add">Add friend</button>`}</div>`).join("");
  const friendRows = friends.map(id => {
    const person = profile(id, ctx.esc);
    return `<div class="blast-person-row">${safeImg(person.avatar, ctx.esc, person.name)}<span class="blast-person"><b>${ctx.esc(person.name)}</b><small>@${ctx.esc(person.username)} · Friend</small></span><button class="blast-quiet" type="button" data-blast-remove-friend="${ctx.esc(id)}" data-testid="blast-remove-friend">Remove</button></div>`;
  }).join("");
  const requestRows = [...incoming, ...outgoing].map(request => {
    const sender = profile(request.from, ctx.esc);
    const other = request.from === me.id ? profile(request.to, ctx.esc) : sender;
    return `<div class="blast-person-row"><span class="blast-person"><b>${ctx.esc(other.name)}</b><small>${request.from === me.id ? "Request sent" : "Wants to be friends"} · ${ctx.esc(dateLabel(request.createdAt))}</small></span>
      ${request.to === me.id ? `<button class="blast-primary" type="button" data-blast-accept="${ctx.esc(request.id)}" data-testid="blast-request-accept">Accept</button>` : ""}
      <button class="blast-quiet" type="button" data-blast-remove-request="${ctx.esc(request.id)}" data-testid="blast-request-remove">${request.to === me.id ? "Decline" : "Cancel"}</button></div>`;
  }).join("");
  return ctx.page("Friends", `<p class="blast-kicker" style="text-align:center;margin:-12px 0 18px">Your friend circle is separate from follows and Close Friends.</p>
    <div class="blast-card" style="padding:14px;margin-bottom:13px"><div class="blast-section-heading" style="margin:0 0 8px"><h2>Find people</h2><small>Oldtime members</small></div>
      <form data-blast-people-form><div class="blast-feed-tools"><input class="blast-input" type="search" name="peopleQuery" value="${ctx.esc(peopleQuery)}" placeholder="Search by name or username" aria-label="Find friends" data-testid="blast-people-search" /><button class="blast-secondary" type="submit" data-testid="blast-people-search-submit">Search</button></div></form>
      <div>${personRows || `<p class="blast-help" style="padding:14px 2px">${peopleQuery ? "No members match that search." : "No one new to show right now."}</p>`}</div></div>
    <section class="blast-card" style="padding:14px;margin-bottom:13px"><div class="blast-section-heading" style="margin:0 0 5px"><h2>Requests</h2><small>${requests.length}</small></div>
      ${requestRows || `<p class="blast-help" style="padding:13px 2px">No friend requests waiting.</p>`}</section>
    <section class="blast-card" style="padding:14px"><div class="blast-section-heading" style="margin:0 0 5px"><h2>Your friends</h2><small>${friends.length}</small></div>${friendRows || `<p class="blast-help" style="padding:13px 2px">Your friend circle is ready when you are.</p>`}</section>`);
}

export function renderBlastSocial(view, ctx) {
  try {
    if (view.name === "hub") return hub(ctx);
    if (view.name === "create") {
      if (view.communityId && getBlastCommunity(view.communityId)) {
        draft = { ...(draft || {}), type: view.type || "post", communityId: view.communityId, audience: "community" };
      }
      return compose(ctx, view.type === "event");
    }
    if (view.name === "detail") return detail(ctx, view.id);
    if (view.name === "friends") return friends(ctx);
    return hub(ctx);
  } catch (error) {
    return ctx.page("Community", `<section class="blast-card blast-empty" role="alert"><h3>Community could not load</h3><p>${ctx.esc(error.message || "Try again.")}</p><button class="blast-primary" type="button" data-blast-retry data-testid="blast-retry">Try again</button></section>`);
  }
}

export function bindBlastSocial(view, ctx) {
  const { app, toast } = ctx;
  blastFeedObserver?.disconnect();
  blastFeedObserver = null;
  if (view.name === "hub") {
    app.querySelectorAll("[data-blast-timeline]").forEach(button => button.onclick = () => {
      const nextTimeline = button.dataset.blastTimeline;
      if (!["for-you", "following"].includes(nextTimeline)) return;
      blastTimeline = nextTimeline;
      blastFeedVisibleCount = BLAST_FEED_PAGE_SIZE;
      ctx.refresh();
    });
    app.querySelectorAll("[data-blast-open-story]").forEach(button => button.onclick = () => {
      ctx.onOpenStory?.(button.dataset.blastOpenStory);
    });
    app.querySelectorAll("[data-blast-create-story]").forEach(button => button.onclick = () => {
      ctx.onCreateStory?.();
    });
    const pager = app.querySelector(".blast-feed-pager");
    if (pager) {
      const loadMore = () => {
        blastFeedVisibleCount += BLAST_FEED_PAGE_SIZE;
        ctx.refresh();
      };
      app.querySelector("[data-blast-load-more]")?.addEventListener("click", loadMore);
      if ("IntersectionObserver" in window) {
        blastFeedObserver = new IntersectionObserver(entries => {
          if (entries.some(entry => entry.isIntersecting)) loadMore();
        }, { rootMargin: "260px 0px" });
        blastFeedObserver.observe(pager);
      }
    }
  }
  hydrateStoredBlastVideos(app);
  app.querySelectorAll("[data-blast-new]").forEach(button => button.onclick = () => {
    blastFeedVisibleCount = BLAST_FEED_PAGE_SIZE;
    commitActiveMediaText(ctx.esc);
    discardDraftMedia(draftMedia);
    draft = { type: button.dataset.blastNew || "post", audience: "friends" }; draftMedia = null;
    composerPanelOpen = ""; draftHistory = []; draftMediaTool = ""; mediaAnnotationHistory = [];
    ctx.setView({ name: "create", type: draft.type });
  });
  app.querySelectorAll("[data-blast-detail]").forEach(button => button.onclick = () => ctx.setView({ name: "detail", id: button.dataset.blastDetail }));
  app.querySelectorAll("[data-blast-react]").forEach(button => button.onclick = async () => {
    try { await toggleBlastReaction(button.dataset.id, button.dataset.blastReact); ctx.refresh(); }
    catch (error) { toast(error.message); }
  });
  app.querySelectorAll("[data-blast-repost]").forEach(button => button.onclick = async () => {
    try {
      const added = await toggleBlastRepost(button.dataset.blastRepost);
      toast(added ? "Reposted." : "Repost removed.");
      ctx.refresh();
    } catch (error) { toast(error.message); }
  });
  app.querySelectorAll("[data-blast-save]").forEach(button => button.onclick = async () => {
    try {
      const saved = await toggleBlastSavedPost(button.dataset.blastSave);
      toast(saved ? "Post saved." : "Post removed from Saved.");
      ctx.refresh();
    } catch (error) { toast(error.message); }
  });
  app.querySelectorAll("[data-blast-share]").forEach(button => button.onclick = async () => {
    try {
      const post = getBlastPost(button.dataset.blastShare);
      if (!post) throw new Error("This post is no longer available.");
      const text = [post.title, post.body].filter(Boolean).join("\n\n");
      if (navigator.share) await navigator.share({ title: post.title || "Community post", text, url: location.href });
      else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        toast("Post text copied.");
      } else throw new Error("Sharing is not available in this browser.");
    } catch (error) {
      if (error.name !== "AbortError") toast(error.message || "Could not share this post.");
    }
  });
  app.querySelectorAll("[data-blast-detail-replies]").forEach(button => button.onclick = () => {
    app.querySelector("[data-testid='blast-reply-form']")?.scrollIntoView({ behavior: "smooth", block: "center" });
    app.querySelector("#blast-reply")?.focus({ preventScroll: true });
  });
  app.querySelectorAll("[data-blast-retry]").forEach(button => button.onclick = () => ctx.refresh());
  const searchForm = app.querySelector("[data-blast-search-form]");
  if (searchForm) searchForm.onsubmit = event => {
    event.preventDefault(); feedQuery = searchForm.elements.query.value.trim(); feedType = searchForm.elements.type.value;
    blastFeedVisibleCount = BLAST_FEED_PAGE_SIZE; ctx.refresh();
  };
  if (view.name === "create") {
    const form = app.querySelector("#blast-create-form");
    const editCreativeMedia=(file)=>{
      if(form)Object.assign(draft,Object.fromEntries(new FormData(form)));
      return openBlastCreative(ctx,{
      file,initialProject:file?null:draftMedia?.creativeProject,caption:draft.body||"",
      onSaved:async({blob,creativeProject,caption})=>{
        const saved=await saveBlastMedia(blob,"Community media");
        const previous=draftMedia;
        draftMedia={mediaId:saved.id,mediaType:saved.mediaType,name:"Community media",previewUrl:URL.createObjectURL(blob),
          creativeProject,creativeId:"bc-"+crypto.randomUUID(),overlays:{strokes:[],labels:[]}};
        releaseMediaPreview(previous);
        if(previous?.mediaId)void deleteBlastMedia(previous.mediaId).catch(()=>{});
        const text=creativeProject.layers.filter(item=>item.kind==="text").map(item=>item.text).join("\n");
        if(caption||text)draft.body=caption||text;
        if(!draft.title&&text)draft.title=text.slice(0,120);
        draftMediaTool="";ctx.refresh();
      }
      });
    };
    const studioButton=document.createElement("button");studioButton.type="button";studioButton.className="blast-btn";
    studioButton.textContent="Open Creative Studio";studioButton.onclick=()=>editCreativeMedia();form?.prepend(studioButton);
    app.querySelector("[data-blast-creative-edit]")?.addEventListener("click",()=>editCreativeMedia());
    app.querySelectorAll("[data-blast-type]").forEach(button => button.onclick = () => {
      commitActiveMediaText(ctx.esc);
      draft.type = button.dataset.blastType;
      composerPanelOpen = "type";
      ctx.setView({ name: "create", type: draft.type });
    });
    app.querySelectorAll("[data-blast-audience]").forEach(button => button.onclick = () => {
      commitActiveMediaText(ctx.esc);
      draft.audience = button.dataset.blastAudience;
      composerPanelOpen = "audience";
      ctx.setView({ name: "create", type: draft.type });
    });
    app.querySelectorAll("[data-blast-panel-toggle]").forEach(button => button.onclick = () => {
      commitActiveMediaText(ctx.esc);
      const nextPanel = button.dataset.blastPanelToggle || "";
      composerPanelOpen = composerPanelOpen === nextPanel ? "" : nextPanel;
      ctx.refresh();
    });
    const mediaInput = app.querySelector("#blast-media");
    app.querySelector("[data-blast-media-trigger]")?.addEventListener("click", () => mediaInput?.click());
    app.querySelector("[data-blast-editor-undo]")?.addEventListener("click", () => {
      commitActiveMediaText(ctx.esc);
      const previous = draftHistory.pop();
      if (!previous) { toast("There is nothing to undo."); return; }
      draft.title = previous.title;
      draft.body = previous.body;
      ctx.refresh();
    });
    form?.querySelectorAll('[name="title"], [name="body"]').forEach(field => field.addEventListener("beforeinput", () => {
      const data = new FormData(form);
      draftHistory.push({
        title: String(data.get("title") || ""),
        body: String(data.get("body") || "")
      });
      if (draftHistory.length > 100) draftHistory.shift();
    }));
    const mediaStage = app.querySelector("[data-blast-post-media-stage]");
    const mediaHint = app.querySelector("[data-blast-media-hint]");
    let activeStroke = null;
    app.querySelectorAll("[data-blast-media-tool]").forEach(button => button.addEventListener("click", () => {
      editCreativeMedia();return;
      commitActiveMediaText(ctx.esc);
      const selectedTool = button.dataset.blastMediaTool || "";
      draftMediaTool = draftMediaTool === selectedTool ? "" : selectedTool;
      mediaStage?.classList.toggle("is-text-tool", draftMediaTool === "text");
      mediaStage?.classList.toggle("is-draw-tool", draftMediaTool === "draw");
      app.querySelectorAll("[data-blast-media-tool]").forEach(item => {
        const active = item.dataset.blastMediaTool === draftMediaTool;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      if (mediaHint) mediaHint.textContent = draftMediaTool === "draw"
        ? "Draw with your finger, mouse, or stylus. Tap Draw again for video controls."
        : draftMediaTool === "text"
          ? "Tap anywhere on the media to start typing. Tap Text again for video controls."
          : "Choose Text or Draw to mark up this media.";
    }));
    mediaStage?.addEventListener("pointerdown", event => {
      if (event.target?.closest?.("[data-blast-media-text-editor]")) return;
      if (draftMediaTool === "text") {
        event.preventDefault();
        const existingLabel = event.target?.closest?.("[data-blast-media-label]");
        const index = existingLabel ? Number(existingLabel.dataset.blastMediaLabel) : null;
        const overlays = draftMediaOverlays();
        const point = index !== null && overlays.labels[index]
          ? { x: overlays.labels[index].x, y: overlays.labels[index].y }
          : mediaPoint(event, mediaStage);
        beginMediaTextEdit(mediaStage, point, index, ctx.esc);
        return;
      }
      if (draftMediaTool !== "draw") return;
      event.preventDefault();
      commitActiveMediaText(ctx.esc);
      const overlays = draftMediaOverlays();
      saveMediaAnnotationSnapshot();
      activeStroke = { color: "#ffffff", width: 2, points: [mediaPoint(event, mediaStage)] };
      overlays.strokes.push(activeStroke);
      mediaStage.setPointerCapture(event.pointerId);
      redrawDraftMediaOverlays(mediaStage, ctx.esc);
    });
    mediaStage?.addEventListener("pointermove", event => {
      if (!activeStroke) return;
      const point = mediaPoint(event, mediaStage);
      const previous = activeStroke.points[activeStroke.points.length - 1];
      if (Math.hypot(point.x - previous.x, point.y - previous.y) < 0.18) return;
      activeStroke.points.push(point);
      redrawDraftMediaOverlays(mediaStage, ctx.esc);
    });
    const finishMediaStroke = event => {
      if (!activeStroke) return;
      activeStroke = null;
      if (mediaStage?.hasPointerCapture?.(event.pointerId)) mediaStage.releasePointerCapture(event.pointerId);
    };
    mediaStage?.addEventListener("pointerup", finishMediaStroke);
    mediaStage?.addEventListener("pointercancel", finishMediaStroke);
    app.querySelector("[data-blast-media-undo]")?.addEventListener("click", () => {
      commitActiveMediaText(ctx.esc);
      const previous = mediaAnnotationHistory.pop();
      if (!previous || !draftMedia) { toast("There are no media marks to undo."); return; }
      try {
        draftMedia.overlays = JSON.parse(previous);
        redrawDraftMediaOverlays(mediaStage, ctx.esc);
      } catch {
        toast("That media edit could not be undone.");
      }
    });
    form?.querySelectorAll("input,textarea,select").forEach(field => field.addEventListener("input", () => {
      const data = new FormData(form);
      for (const [key, value] of data.entries()) if (key !== "online") draft[key] = String(value);
      draft.online = form.elements.online?.checked || false;
    }));
    mediaInput?.addEventListener("change", async () => {
      const file = mediaInput.files?.[0];
      if (!file) return;
      editCreativeMedia(file);mediaInput.value="";return;
      const supportedType = /^(image\/(jpeg|png|gif|webp|avif|heic|heif)|video\/(mp4|webm|quicktime))$/i.test(file.type);
      if (!supportedType) { mediaInput.value = ""; toast("Choose a JPEG, PNG, GIF, WebP, AVIF, HEIC, MP4, WebM, or QuickTime file."); return; }
      commitActiveMediaText(ctx.esc);
      mediaInput.disabled = true;
      try {
        let nextMedia;
        if (file.type.startsWith("video/")) {
          const saved = await saveBlastMedia(file, file.name);
          let previewUrl;
          try { previewUrl = URL.createObjectURL(file); }
          catch (error) {
            await deleteBlastMedia(saved.id);
            throw error;
          }
          nextMedia = { mediaId: saved.id, previewUrl, mediaType: "video", name: file.name, overlays: { strokes: [], labels: [] } };
        } else {
          const saved = await saveBlastMedia(file, file.name);
          let previewUrl;
          try { previewUrl = URL.createObjectURL(file); }
          catch (error) {
            await deleteBlastMedia(saved.id);
            throw error;
          }
          nextMedia = { mediaId: saved.id, previewUrl, mediaType: "image", name: file.name, overlays: { strokes: [], labels: [] } };
        }
        const previousMedia = draftMedia;
        draftMedia = nextMedia;
        releaseMediaPreview(previousMedia);
        if (previousMedia?.mediaId) {
          deleteBlastMedia(previousMedia.mediaId).catch(error => console.warn("Replaced media could not be removed from account storage.", error));
        }
        draftMediaTool = draft.type === "event" ? "" : "text";
        mediaAnnotationHistory = [];
        mediaInput.value = "";
        toast(file.type.startsWith("video/") ? "Video attached." : "Photo attached.");
        ctx.refresh();
      }
      catch (error) { mediaInput.value = ""; toast(error.message); }
      finally { mediaInput.disabled = false; }
    });
    form?.addEventListener("submit", async event => {
      event.preventDefault();
      commitActiveMediaText(ctx.esc);
      if (!form.reportValidity()) return;
      const data = new FormData(form);
      const input = {
        type: draft.type, title: String(data.get("title") || "").trim(),
        body: String(data.get("body") || "").trim(), audience: draft.audience,
        communityId: String(data.get("communityId") || draft.communityId || ""),
        groupId: String(data.get("groupId") || ""),
        location: String(data.get("location") || "").trim(),
        activityGoal: String(data.get("activityGoal") || "").trim(),
        media: draftMedia ? {
          mediaId: draftMedia.mediaId,
          mediaType: draftMedia.mediaType,
          name: draftMedia.name,
          creativeProject: draftMedia.creativeProject,
          creativeId: draftMedia.creativeId,
          overlays: draftMedia.overlays
        } : null,
        event: draft.type === "event" ? {
          kind: String(data.get("eventKind") || "meetup"),
          startsAt: new Date(String(data.get("startsAt") || "")).getTime(),
          durationMinutes: Number(data.get("durationMinutes") || 60),
          online: Boolean(form.elements.online?.checked),
          location: String(data.get("eventLocation") || "").trim()
        } : undefined
      };
      try {
        const saved = await createBlastPost(input);
        releaseMediaPreview(draftMedia);
        draft = {}; draftMedia = null; composerPanelOpen = ""; draftHistory = []; draftMediaTool = ""; mediaAnnotationHistory = [];
        toast(input.type === "event" ? "Event created." : "Post shared.");
        ctx.setView(input.communityId ? { name: "community", id: input.communityId } : input.type === "event" ? { name: "detail", id: saved.id } : "notes");
      } catch (error) { toast(error.message); }
    });
  }
  if (view.name === "detail") {
    app.querySelector("#blast-reply-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      const field = app.querySelector("#blast-reply");
      if (!field.value.trim()) { field.focus(); return; }
      try { await addBlastReply(view.id, field.value); toast("Reply added."); ctx.refresh(); }
      catch (error) { toast(error.message); }
    });
    app.querySelectorAll("[data-blast-rsvp]").forEach(button => button.onclick = async () => {
      try { await setBlastEventRsvp(button.dataset.id, button.dataset.blastRsvp); toast(button.dataset.blastRsvp === "none" ? "RSVP cleared." : "RSVP saved."); ctx.refresh(); }
      catch (error) { toast(error.message); }
    });
    app.querySelectorAll("[data-blast-delete]").forEach(button => button.onclick = async () => {
      if (!confirm("Delete this post? This cannot be undone.")) return;
      try {
        const post = getBlastPost(button.dataset.blastDelete);
        await deleteBlastPost(button.dataset.blastDelete);
        if (post?.media?.mediaId) {
          try { await deleteBlastMedia(post.media.mediaId); }
          catch (error) {
            console.warn("Deleted media could not be cleared from account storage.", error);
            toast("Post deleted, but its media could not be cleared from your account.");
            ctx.setView("notes");
            return;
          }
        }
        toast("Post deleted."); ctx.setView("notes");
      }
      catch (error) { toast(error.message); }
    });
  }
  if (view.name === "friends") {
    app.querySelector("[data-blast-people-form]")?.addEventListener("submit", event => {
      event.preventDefault();
      peopleQuery = new FormData(event.currentTarget).get("peopleQuery")?.toString().trim() || "";
      ctx.refresh();
    });
    app.querySelectorAll("[data-blast-add-person]").forEach(button => button.onclick = async () => {
      try { await sendBlastFriendRequest(button.dataset.blastAddPerson); toast("Friend request sent."); ctx.refresh(); }
      catch (error) { toast(error.message); }
    });
    app.querySelectorAll("[data-blast-accept]").forEach(button => button.onclick = async () => {
      try { await acceptBlastFriendRequest(button.dataset.blastAccept); toast("You are friends."); ctx.refresh(); }
      catch (error) { toast(error.message); }
    });
    app.querySelectorAll("[data-blast-accept-person]").forEach(button => button.onclick = async () => {
      try {
        const req = listBlastFriendRequests().find(item => item.from === button.dataset.blastAcceptPerson && item.to === ctx.me.id);
        if (!req) throw new Error("This request is no longer available.");
        await acceptBlastFriendRequest(req.id); toast("You are friends."); ctx.refresh();
      } catch (error) { toast(error.message); }
    });
    app.querySelectorAll("[data-blast-remove-request]").forEach(button => button.onclick = async () => {
      try { await removeBlastFriendRequest(button.dataset.blastRemoveRequest); toast("Request removed."); ctx.refresh(); }
      catch (error) { toast(error.message); }
    });
    app.querySelectorAll("[data-blast-cancel-person]").forEach(button => button.onclick = async () => {
      const req = listBlastFriendRequests().find(item => item.from === ctx.me.id && item.to === button.dataset.blastCancelPerson);
      if (!req) return;
      try { await removeBlastFriendRequest(req.id); toast("Request cancelled."); ctx.refresh(); }
      catch (error) { toast(error.message); }
    });
    app.querySelectorAll("[data-blast-remove-friend]").forEach(button => button.onclick = async () => {
      if (!confirm("Remove this friend? Follows and Close Friends will not change.")) return;
      try { await removeBlastFriend(button.dataset.blastRemoveFriend); toast("Friend removed."); ctx.refresh(); }
      catch (error) { toast(error.message); }
    });
  }
}
