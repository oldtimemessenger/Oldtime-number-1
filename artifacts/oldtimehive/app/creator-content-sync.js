import { api, requestCloudApi } from "./store.js";
import { isLocalMedia, mediaUrl, uploadResumableMedia } from "./local-media.js";
import { projectScenes, projectSources } from "./creative-project.js";

let syncing = false;
const meaningful = s => s.trim().length >= 20 && s.trim().split(/\s+/).length >= 3;
// Explicit owner action: never upload private device media in the background.
// The archive is owner-only and never changes the item's selected audience.
export async function syncCreatorOriginals(progress = () => {}) {
  if (syncing) throw new Error("Original content is already being synced.");
  const owner = api.me()?.id, account = api.cloudAccountId();
  if (!owner || !account) throw new Error("Sign in to an online account before syncing originals.");
  syncing = true;
  let confirmed = 0, skipped = 0, failed = 0, attempted = 0, lastError = "";
  const assertOwner = () => {
    if (api.me()?.id !== owner || api.cloudAccountId() !== account) throw new Error("The signed-in account changed. Sync stopped.");
  };
  try {
    const persisted = await requestCloudApi("/api/creator/content");
    const known = new Set(persisted.content.map(c => c.sourceId));
    const candidates = [...api.db().posts, ...api.db().stories].filter(item => item.author === owner && !item.cloud && !known.has(item.id));
    for (const item of candidates) {
      if (attempted >= 10) break;
      assertOwner();
      if (item.sourceComment || item.sourcePost || item.creativeProject && projectSources(item.creativeProject).length) { skipped++; continue; }
      const scenes = item.creativeProject ? projectScenes(item.creativeProject) : [];
      const text = [item.caption || item.text || "", ...scenes.flatMap(s => s.layers.filter(l => l.kind === "text").map(l => l.text || ""))].join(" ").trim();
      const media = [...new Set((scenes.length
        ? scenes.flatMap(s => [s.background.media, ...s.layers.filter(l => l.kind === "image").map(l => l.media)])
        : Array.isArray(item.media) ? item.media : [item.media]).filter(Boolean))];
      // No remote/demo image URLs, revoked linked comments or browser counters
      // become proof of original content.
      if (media.length > 10 || media.some(value => !isLocalMedia(value) && !/^data:(image|video)\//i.test(value)) ||
        !media.length && !meaningful(text)) { skipped++; continue; }
      attempted++;
      progress(`Verifying original ${confirmed + failed + 1} of up to ${Math.min(10, candidates.length)}…`);
      try {
        const mediaIds = [];
        for (const value of media) {
          assertOwner();
          const blob = await (await fetch(await mediaUrl(value))).blob();
          if (!blob.size || !blob.type) throw new Error("This media is unavailable.");
          assertOwner();
          const contentType = String(blob.type || "").split(";")[0].trim().toLowerCase();
          const reservation = await requestCloudApi("/api/creator/content/upload", { method: "POST", body: { contentType, size: blob.size } });
          assertOwner();
          await uploadResumableMedia(blob, reservation.upload);
          mediaIds.push(reservation.id);
        }
        assertOwner();
        // Also verify that it has not been deleted while uploading.
        if (![...api.db().posts, ...api.db().stories].some(p => p.id === item.id && p.author === owner)) throw new Error("The original was removed while syncing.");
        await requestCloudApi("/api/creator/content", { method: "POST", body: {
          sourceId: item.id, surface: api.db().stories.includes(item) ? "story" : item.creationSurface === "community" ? "community" : "post",
          body: text.slice(0, 5000), mediaIds,
        } });
        confirmed++;
      } catch (error) {
        failed++;
        lastError = error.message;
        progress(`Not synced: ${error.message}`);
        if (error.status === 429 || /account changed/i.test(error.message)) break;
      }
    }
    return { confirmed, skipped, failed, lastError, remaining: Math.max(0, candidates.length - attempted - skipped) };
  } finally { syncing = false; }
}

export async function removeCreatorOriginalCredit(sourceId) {
  if (!api.cloudAccountId()) return;
  const { content } = await requestCloudApi("/api/creator/content");
  const record = content.find(c => c.sourceId === sourceId);
  if (record) await requestCloudApi(`/api/creator/content/${record.id}`, { method: "DELETE" });
}
