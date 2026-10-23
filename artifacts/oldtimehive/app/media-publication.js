// Preserve original quality and avoid real-time video export when nothing changed.
export function originalPublicationMedia(project, blobs, asset) {
  const background = project.background || {};
  const blob = blobs.get(background.media);
  const width = asset?.videoWidth || asset?.naturalWidth;
  const height = asset?.videoHeight || asset?.naturalHeight;
  if (!(blob instanceof Blob) || !blob.size || !["photo", "video"].includes(background.kind) ||
    project.pages?.length || project.layers?.length || background.mirror ||
    !width || !height || Math.abs(width / height - project.width / project.height) > .001 ||
    background.filter && background.filter !== "none" ||
    Object.values(background.adjustments || {}).some(value => value !== 100)) return null;
  const crop = background.crop;
  if (crop && ((crop.x || 0) !== 0 || (crop.y || 0) !== 0 || crop.width !== 1 || crop.height !== 1)) return null;
  if (background.kind === "video") {
    const edit = background.videoEdit;
    if (!edit || edit.clips?.length !== 1) return null;
    const clip = edit.clips[0];
    if (clip.in !== 0 || clip.speed !== 1 ||
      Math.abs(clip.out - edit.sourceDuration) > .01 ||
      Math.abs(project.duration - edit.sourceDuration) > .01) return null;
  }
  return blob;
}

export async function publishRenderedPost({ blobs, upload, createPost, text, visibility, place, active, onProgress }) {
  const guard = () => {
    if (!active()) throw new Error("This editing session has ended.");
  };
  guard();
  if (!blobs.length || blobs.some(blob => !(blob instanceof Blob) || !blob.size)) {
    throw new Error("The rendered post is empty. Your edit is still here.");
  }
  const mediaIds = [];
  for (const [index, blob] of blobs.entries()) {
    guard();
    const reference = await upload(blob, fraction => onProgress?.({ fraction, index, total: blobs.length }));
    guard();
    if (!/^oldtime-media:[0-9a-f-]{36}$/i.test(reference)) {
      throw new Error("The uploaded post media could not be confirmed.");
    }
    mediaIds.push(reference.slice("oldtime-media:".length));
  }
  guard();
  return createPost(text, { visibility, place, mediaIds });
}
