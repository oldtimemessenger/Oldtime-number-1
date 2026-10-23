export const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;

export function isStorySaved(story) {
  return story?.savedToProfile === true;
}

export function isStoryActive(story, now = Date.now()) {
  const created = Number(story?.created);
  if (!Number.isFinite(created) || created <= 0 || created > now) return false;
  return isStorySaved(story) || now - created < STORY_LIFETIME_MS;
}
