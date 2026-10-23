import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { readSportsImage, type Location } from "../lib/sports-media";
import { putSupabaseMedia, readSupabaseMedia } from "../lib/supabase-storage";
import { supabaseMediaBucket } from "../lib/supabase-storage";
import { readLegacyCreatorMedia } from "../lib/creator-media-storage";

if (process.env.APP_DATABASE_BACKEND !== "supabase" || process.env.SUPABASE_DATABASE_SCHEMA !== "oldtime_app" ||
    process.argv[2] !== "--apply") {
  throw new Error("Use explicit --apply with the isolated Supabase app schema after the database copy.");
}

try {
  let migrated = 0;
  let total = 0;
  const checksum = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
  async function transfer(key: string, bytes: Buffer, mime: string) {
    try {
      await putSupabaseMedia(key, bytes, mime);
    } catch {
      // A retried migration may already have uploaded this immutable key.
      const existing = await readSupabaseMedia(key);
      if (checksum(existing) !== checksum(bytes)) throw new Error("Media destination conflict.");
    }
    if (checksum(await readSupabaseMedia(key)) !== checksum(bytes)) {
      throw new Error("Media checksum verification failed.");
    }
  }
  for (const table of ["sports_media", "participation_entries"] as const) {
    const { rows } = await pool.query<{ id: string; object: Location; mime: string }>(
      `SELECT id, object, mime FROM ${table} WHERE object IS NOT NULL ORDER BY id`,
    );
    total += rows.length;
    for (const row of rows) {
      if (row.object.kind === "supabase") continue;
      await transfer(row.object.key, await readSportsImage(row.object), row.mime);
      const result = await pool.query(
        `UPDATE ${table} SET object=$1::jsonb WHERE id=$2 AND object=$3::jsonb`,
        [JSON.stringify({ kind: "supabase", key: row.object.key }), row.id, JSON.stringify(row.object)],
      );
      if (result.rowCount !== 1) throw new Error("Media metadata changed during migration.");
      migrated += 1;
    }
  }
  const creator = await pool.query<{
    id: string; object_path: string; content_type: string;
    size: number; fingerprint: string | null; confirmed_at: Date | null;
  }>("SELECT id,object_path,content_type,size,fingerprint,confirmed_at FROM creator_media_assets ORDER BY id");
  total += creator.rows.length;
  for (const asset of creator.rows) {
    if (asset.object_path.startsWith("supabase://")) continue;
    const bytes = await readLegacyCreatorMedia(asset.object_path);
    if (bytes.length !== asset.size || (asset.fingerprint && checksum(bytes) !== asset.fingerprint)) {
      throw new Error("Legacy creator media verification failed.");
    }
    const key = `creator/${asset.confirmed_at ? "originals" : "pending"}/${asset.id}`;
    await transfer(key, bytes, asset.content_type);
    const result = await pool.query(
      "UPDATE creator_media_assets SET object_path=$1 WHERE id=$2 AND object_path=$3",
      [`supabase://${supabaseMediaBucket()}/${key}`, asset.id, asset.object_path],
    );
    if (result.rowCount !== 1) throw new Error("Creator media metadata changed during migration.");
    migrated += 1;
  }
  console.log(JSON.stringify({ migrated, total, sourceFilesRetained: true, checksumsVerified: true }));
} catch {
  console.error("Media migration stopped. Source files are retained; do not cut over until every media record is verified.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
