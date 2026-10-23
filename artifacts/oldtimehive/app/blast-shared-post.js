import { api } from "./store.js";
import { listBlastFriends } from "./blast-store.js";
import { isLocalMedia } from "./local-media.js";
import { findSharedComment } from "./shared-content.js";

export function listBlastShareFriends() {
  return listBlastFriends().map(id => api.user(id)).filter(Boolean);
}

function safeMediaUrl(value) {
  const url = String(value || "").trim();
  return /^(https?:|blob:|data:(image|video)\/)/i.test(url) ||
    (url && !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("//")) ? url : "";
}

export function renderBlastSharedPost(blast, ctx) {
  if (!blast.sharedPostId) return "";
  const post = api.post(blast.sharedPostId);
  if (!post || !api.canSeePost(post)) return "";
  const author = api.user(post.author);
  const esc = ctx.esc;
  const media = isLocalMedia(post.media?.[0]) ? post.media[0] : safeMediaUrl(post.media?.[0]);
  const comment = findSharedComment(post, blast.sharedCommentId);
  return `<section class="blast-shared-post" data-testid="blast-shared-post">
    <button type="button" class="blast-shared-author" data-blast-open-source="${esc(post.id)}" ${comment ? `data-blast-open-comment="${esc(comment.id)}"` : ""} aria-label="Open original ${comment ? "comment" : "post"}">
      <b>@${esc(author?.username || "member")}</b>
      ${post.caption ? `<span>${esc(post.caption)}</span>` : ""}
      ${blast.sharedCommentId ? comment ? `<span class="blast-shared-comment"><b>@${esc(api.user(comment.author)?.username || "member")}</b> ${esc(comment.body || "Photo comment")}</span>` : "<span>Comment unavailable</span>" : ""}
    </button>
    ${media ? post.kind === "video"
      ? `<video ${isLocalMedia(media) ? `data-local-media="${esc(media)}"` : `src="${esc(media)}"`} controls playsinline preload="metadata" aria-label="Shared video"></video>`
      : `<img ${isLocalMedia(media) ? `data-local-media="${esc(media)}"` : `src="${esc(media)}"`} alt="Shared post" loading="lazy" />` : ""}
  </section>`;
}
