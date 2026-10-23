function isDefaultAvatar(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  try {
    return new URL(raw, "https://oldtime.invalid")
      .pathname
      .toLowerCase()
      .endsWith("/avatar.svg");
  } catch {
    return /(?:^|\/)avatar\.svg(?:[?#]|$)/i.test(raw);
  }
}

export function resolveStoryMedia(story, getPost = () => null) {
  const current = String(story?.media ?? "").trim();
  if (current && !isDefaultAvatar(current)) return current;

  // Older shared Stories could accidentally use the author's fallback avatar
  // as the full-screen media. Resolve the source post instead of showing it.
  const source = story?.sourcePost ? getPost(story.sourcePost) : null;
  const sourceMedia = Array.isArray(source?.media) ? source.media[0] : "";
  return sourceMedia && !isDefaultAvatar(sourceMedia) ? String(sourceMedia) : "";
}
