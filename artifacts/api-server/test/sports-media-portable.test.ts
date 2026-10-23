import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { storeSportsVideo, readSportsImage, deleteSportsImage } from "../src/lib/sports-media";
test("explicit legacy filesystem storage remains readable and deletable", async () => {
  const cwd = process.cwd(), dir = await mkdtemp(join(tmpdir(), "oldtime-media-"));
  const previousDriver = process.env.SPORTS_MEDIA_STORAGE;
  const previousMode = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  process.env.SPORTS_MEDIA_STORAGE = "filesystem";
  process.chdir(dir);
  try {
    const body = Buffer.alloc(128); body.write("ftyp", 4);
    const location = await storeSportsVideo(randomUUID(), body, "video/mp4");
    assert.equal(location.kind, "filesystem");
    assert.deepEqual(await readSportsImage(location), body);
    await deleteSportsImage(location);
    await assert.rejects(() => readSportsImage(location));
    await assert.rejects(() => readSportsImage({ kind: "filesystem", key: "../escape.mp4" }), /Invalid/);
  } finally {
    process.chdir(cwd);
    if (previousDriver === undefined) delete process.env.SPORTS_MEDIA_STORAGE;
    else process.env.SPORTS_MEDIA_STORAGE = previousDriver;
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
    await rm(dir, { recursive: true, force: true });
  }
});
test("runtime uploads cannot opt back into filesystem or retired media providers", async () => {
  const previousDriver = process.env.SPORTS_MEDIA_STORAGE, previousMode = process.env.NODE_ENV;
  const body = Buffer.alloc(128); body.write("ftyp", 4);
  try {
    for (const mode of ["production", "development"]) {
      process.env.NODE_ENV = mode;
      for (const driver of ["filesystem", "s3", "gcs"]) {
        process.env.SPORTS_MEDIA_STORAGE = driver;
        await assert.rejects(storeSportsVideo(randomUUID(), body, "video/mp4"), /must be stored in Supabase/);
      }
    }
  } finally {
    if (previousDriver === undefined) delete process.env.SPORTS_MEDIA_STORAGE;
    else process.env.SPORTS_MEDIA_STORAGE = previousDriver;
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
  }
});
