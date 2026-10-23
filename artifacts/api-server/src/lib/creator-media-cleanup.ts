import { pool } from "@workspace/db";
import { deleteCreatorMedia } from "./creator-media-storage";
import { logger } from "./logger";

export function startCreatorMediaCleanup() {
  let busy = false;
  const cleanup = async () => {
    if (busy) return;
    busy = true;
    try {
      const { rows } = await pool.query<{ id: string; object_path: string }>(`SELECT a.id,a.object_path
        FROM creator_media_assets a LEFT JOIN creator_original_content c ON c.id=a.content_id
        WHERE a.content_id IS NULL AND a.created_at < now()-interval '1 hour'
          OR c.deleted_at IS NOT NULL LIMIT 100`);
      for (const asset of rows) {
        try {
          await deleteCreatorMedia(asset.object_path);
          await pool.query("DELETE FROM creator_media_assets WHERE id=$1", [asset.id]);
        } catch { logger.warn("Private creator media cleanup will retry"); }
      }
    } catch { logger.warn("Creator media maintenance could not complete"); }
    finally { busy = false; }
  };
  const timer = setInterval(() => { void cleanup(); }, 600000);
  timer.unref();
}
