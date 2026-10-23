import assert from "node:assert/strict";
import test from "node:test";
import { reserveMedia, confirmMedia, deleteCreatorMedia } from "../src/lib/creator-media-storage";
import { getSupabaseMediaMetadata, validateSupabaseObjectKey } from "../src/lib/supabase-storage";
import { installSupabaseStorageFixture } from "./helpers/supabase-storage-fixture";

test("private Supabase object keys reject traversal and absolute URLs", () => {
  for (const key of ["../private", "sports/../../secret", "https://example.com/file", "/sports/id", "a//b"]) {
    assert.throws(() => validateSupabaseObjectKey(key), /Invalid private media key/);
  }
  assert.equal(validateSupabaseObjectKey("creator/pending/fixture"), "creator/pending/fixture");
});

test("Supabase creator media verifies bytes and stores an immutable original", async (t) => {
  const fixture = installSupabaseStorageFixture();
  t.after(() => fixture.restore());
  const body = Buffer.alloc(40);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(body);
  const reserved = await reserveMedia("image/png");
  assert.ok(reserved.path.startsWith("supabase://oldtime-media/creator/pending/"));
  assert.equal(reserved.upload.token, "fixture-upload-token");
  assert.ok(reserved.upload.endpoint.startsWith("https://storage-fixture.invalid/"));
  assert.equal(new URL(reserved.upload.endpoint).pathname, "/storage/v1/upload/resumable/sign");
  fixture.seed("oldtime-media", reserved.path.replace("supabase://oldtime-media/", ""), body, "image/png");
  const approved = await confirmMedia(reserved.path, "image/png", body.length);
  assert.match(approved.path, /^supabase:\/\/oldtime-media\/creator\/originals\//);
  assert.equal(approved.fingerprint.length, 64);
  const metadata = await getSupabaseMediaMetadata(approved.path.replace("supabase://oldtime-media/", ""));
  assert.deepEqual(metadata, { size: body.length, contentType: "image/png" });
  await assert.rejects(() => confirmMedia(reserved.path, "image/png", body.length + 1), /reservation|size or file signature/);
  await deleteCreatorMedia(approved.path);
});
