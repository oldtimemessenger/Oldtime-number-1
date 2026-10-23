import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { once } from "node:events";
import app from "../src/app";
import { deleteSupabaseMedia } from "../src/lib/supabase-storage";
import { pool } from "@workspace/db";
import { installSupabaseStorageFixture } from "./helpers/supabase-storage-fixture";

test("legacy Stories import idempotently and confirm uploaded media before completion", async t => {
  const storageFixture = installSupabaseStorageFixture();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const users: string[] = [];
  const mediaKeys: string[] = [];
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const key of mediaKeys) await deleteSupabaseMedia(key).catch(() => {});
    try {
      if (users.length) await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    } finally {
      await pool.end();
      storageFixture.restore();
    }
  });

  async function request(path: string, token?: string, method = "GET", body?: unknown) {
    return fetch(`${base}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function register() {
    const username = `story_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
    const response = await request("/auth/register", undefined, "POST", {
      username,
      email: `${username}@example.test`,
      displayName: username,
      password: `Story-${randomUUID()}`,
    });
    assert.equal(response.status, 201);
    const auth = await response.json();
    users.push(auth.account.id);
    return auth;
  }

  const owner = await register();
  assert.equal((await request("/account/privacy", owner.accessToken, "PUT", { isPrivate: false })).status, 200);

  const sourceId = "legacy-story-photo-1";
  const createdAt = Date.now() - 2_000;
  const input = {
    sourceId,
    text: "Transferred Story",
    visibility: "friends",
    mediaType: "photo",
    commentsEnabled: false,
    savedToProfile: false,
    createdAt,
    expiresAt: createdAt + 24 * 60 * 60 * 1000,
  };
  const first = await request("/stories/import", owner.accessToken, "POST", input);
  assert.equal(first.status, 200);
  const imported = await first.json();
  assert.equal(imported.alreadyImported, false);
  assert.equal(imported.story.sourceId, sourceId);
  assert.equal(imported.story.visibility, "friends");
  assert.equal(imported.story.hasMedia, false);
  mediaKeys.push(`stories/${owner.account.id}/${imported.story.id}.png`);

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64");
  const upload = await fetch(`${base}/stories/${imported.story.id}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${owner.accessToken}`, "Content-Type": "image/png" },
    body: png,
  });
  assert.equal(upload.status, 204);

  const verified = await request("/stories/import", owner.accessToken, "POST", input);
  assert.equal(verified.status, 200);
  const confirmed = await verified.json();
  assert.equal(confirmed.alreadyImported, true);
  assert.equal(confirmed.story.id, imported.story.id);
  assert.equal(confirmed.story.hasMedia, true);
  assert.equal((await request("/stories", owner.accessToken)).status, 200);

  const conflict = await request("/stories/import", owner.accessToken, "POST", { ...input, text: "Different content" });
  assert.equal(conflict.status, 409);
  assert.equal((await request(`/stories/${imported.story.id}`, owner.accessToken, "DELETE")).status, 204);
});
