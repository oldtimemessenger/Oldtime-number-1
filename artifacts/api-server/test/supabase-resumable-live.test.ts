import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  deleteSupabaseMedia, getSupabaseMediaMetadata, readSupabaseMedia,
  reserveSupabaseResumableMedia,
} from "../src/lib/supabase-storage";

// Explicit opt-in. Uses the real provider, never a mocked storage response.
// Only the random verification object created by this test can be removed.
for (const byteLength of [68, 7 * 1024 * 1024]) {
test(`a real signed resumable upload (${byteLength} bytes) survives a private cloud read`, {
  skip: process.env.RUN_LIVE_STORAGE_TEST !== "1",
}, async () => {
  const key = `verification/resumable-${randomUUID()}.png`;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWuoAAAAASUVORK5CYII=",
    "base64",
  );
  // Padding exercises a second TUS chunk without using anyone's private media.
  const bytes = Buffer.alloc(byteLength);
  png.copy(bytes);
  let uploaded = false;
  try {
    const ticket = await reserveSupabaseResumableMedia(key);
    assert.match(new URL(ticket.endpoint).pathname, /\/resumable\/sign$/);
    const metadata = Object.entries({
      bucketName: ticket.bucketName, objectName: ticket.objectName,
      contentType: "image/png", cacheControl: "300",
    }).map(([name, value]) => `${name} ${Buffer.from(value).toString("base64")}`).join(",");
    const created = await fetch(ticket.endpoint, {
      method: "POST",
      headers: {
        "x-signature": ticket.token, "Tus-Resumable": "1.0.0",
        "Upload-Length": String(bytes.length), "Upload-Metadata": metadata,
      },
    });
    assert.equal(created.status, 201, `Signed upload creation failed (${created.status}).`);
    const location = created.headers.get("Location");
    assert.ok(location, "Supabase did not return an upload location.");
    const chunkSize = 6 * 1024 * 1024;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      const completed = await fetch(new URL(location, ticket.endpoint), {
        method: "PATCH",
        headers: {
          "x-signature": ticket.token, "Tus-Resumable": "1.0.0",
          "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream",
        },
        body: chunk,
      });
      assert.equal(completed.status, 204, `Signed upload completion failed (${completed.status}).`);
      assert.equal(Number(completed.headers.get("Upload-Offset")), offset + chunk.length);
    }
    uploaded = true;
    assert.equal((await getSupabaseMediaMetadata(key))?.size, bytes.length);
    const fingerprint = (data: Buffer) => createHash("sha256").update(data).digest("hex");
    assert.equal(fingerprint(await readSupabaseMedia(key)), fingerprint(bytes));
  } finally {
    if (uploaded) await deleteSupabaseMedia(key);
  }
});
}
