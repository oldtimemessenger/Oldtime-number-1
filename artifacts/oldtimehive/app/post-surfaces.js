export function isFeedHomePost(post) {
  return post?.destination !== "community"
    && post?.kind !== "text"
    && post?.kind !== "quote"
    && Boolean(post?.media?.length || post?.creativeProject?.background?.media);
}

export function isCommunitySurfacePost(post) {
  return post?.destination === "community" || post?.destination === "both";
}

export function isProfileSurfacePost(post) {
  return post?.destination !== "community";
}
