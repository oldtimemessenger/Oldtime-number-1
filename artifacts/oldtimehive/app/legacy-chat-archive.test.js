import assert from "node:assert/strict";
import test from "node:test";
import { collectCompleteLegacyChatArchives, legacyChatArchiveHash, splitLegacyChatArchive } from "./legacy-chat-archive.js";

test("legacy chat archives split by byte size, hash canonically, and reassemble only complete verified parts", async () => {
  const base = { version: 1, id: "cv-legacy-room", title: "Old chat", members: [{ id: "user-1" }] };
  const messages = Array.from({ length: 8 }, (_, index) => ({
    id: `message-${index}`,
    author: "user-1",
    body: `Message ${index} ${"x".repeat(48)}`,
    created: 1_700_000_000_000 + index,
  }));
  const parts = await splitLegacyChatArchive(base, messages, 360);
  assert.ok(parts.length > 1);
  for (const part of parts) {
    assert.equal(await legacyChatArchiveHash(part.payload), part.contentHash);
    assert.ok(new TextEncoder().encode(JSON.stringify(part.payload)).length <= 360);
  }
  const partial = await collectCompleteLegacyChatArchives(parts.slice(0, -1));
  assert.equal(partial.archives.length, 0);
  assert.equal(partial.incomplete, 1);
  const complete = await collectCompleteLegacyChatArchives(parts);
  assert.equal(complete.archives.length, 1);
  assert.deepEqual(complete.archives[0].payload.messages, messages);
  const tampered = parts.map(part => ({ ...part, payload: { ...part.payload, title: "tampered" } }));
  assert.equal((await collectCompleteLegacyChatArchives(tampered)).archives.length, 0);
});
