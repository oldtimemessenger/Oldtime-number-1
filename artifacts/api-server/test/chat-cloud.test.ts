import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { once } from "node:events";
import app from "../src/app";
import { deleteSupabaseMedia } from "../src/lib/supabase-storage";
import { pool } from "@workspace/db";
import { installSupabaseStorageFixture } from "./helpers/supabase-storage-fixture";

test("cloud chats persist messages, attachments, reactions, saved state and read receipts with member-only access", async t => {
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
    const username = `chat_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
    const response = await request("/auth/register", undefined, "POST", {
      username, email: `${username}@example.test`, displayName: username, password: `Chat-${randomUUID()}`,
    });
    assert.equal(response.status, 201);
    const auth = await response.json();
    users.push(auth.account.id);
    return auth;
  }

  const alice = await register();
  const bob = await register();
  const outsider = await register();
  const conversationId = `cv-${randomUUID()}`;
  const roomResponse = await request("/chats", alice.accessToken, "POST", {
    id: conversationId, title: "Cloud chat", members: [alice.account.id, bob.account.id],
  });
  assert.equal(roomResponse.status, 201);
  assert.equal((await request(`/chats/${conversationId}/messages`, outsider.accessToken)).status, 404);

  const messageId = `m-${randomUUID()}`;
  const sent = await request(`/chats/${conversationId}/messages`, alice.accessToken, "POST", {
    clientId: messageId, kind: "text", body: "Saved across devices",
  });
  assert.equal(sent.status, 201);
  const savedState = await request(`/chats/${conversationId}/state`, bob.accessToken, "PUT", {
    state: {
      pinnedIds: [messageId],
      savedMessageIds: [messageId],
      reactions: { [messageId]: ["❤️"] },
    },
  });
  assert.equal(savedState.status, 200);
  const bobRooms = await (await request("/chats", bob.accessToken)).json();
  assert.deepEqual(bobRooms.chats[0].state.savedMessageIds, [messageId]);

  const beforeRead = await (await request(`/chats/${conversationId}/messages`, alice.accessToken)).json();
  assert.deepEqual(beforeRead.messages[0].reactions["❤️"], [bob.account.id]);
  assert.equal(beforeRead.messages[0].status, "sent");
  assert.equal((await request(`/chats/${conversationId}/read`, bob.accessToken, "POST", { shareReceipts: false })).status, 204);
  const hiddenReceipt = await (await request(`/chats/${conversationId}/messages`, alice.accessToken)).json();
  assert.equal(hiddenReceipt.messages[0].status, "sent");
  assert.equal((await request(`/chats/${conversationId}/read`, bob.accessToken, "POST", { shareReceipts: true })).status, 204);
  const readReceipt = await (await request(`/chats/${conversationId}/messages`, alice.accessToken)).json();
  assert.equal(readReceipt.messages[0].status, "read");
  assert.ok(readReceipt.messages[0].readBy.includes(bob.account.id));

  assert.equal((await request(`/chats/${conversationId}/messages/${messageId}`, bob.accessToken, "PATCH", { body: "forged edit" })).status, 404);
  const edited = await request(`/chats/${conversationId}/messages/${messageId}`, alice.accessToken, "PATCH", { body: "Edited in the cloud" });
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).message.body, "Edited in the cloud");
  assert.equal((await request(`/chats/${conversationId}/messages/${messageId}`, bob.accessToken, "DELETE")).status, 404);

  const mediaId = randomUUID();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64");
  mediaKeys.push(`media/${alice.account.id}/${mediaId}`);
  const upload = await fetch(`${base}/media/${mediaId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${alice.accessToken}`, "Content-Type": "image/png" },
    body: png,
  });
  assert.equal(upload.status, 201);
  const photoId = `m-${randomUUID()}`;
  const photo = await request(`/chats/${conversationId}/messages`, alice.accessToken, "POST", {
    clientId: photoId, kind: "photo", body: "Photo", mediaIds: [mediaId], metadata: { caption: "Cloud photo" },
  });
  assert.equal(photo.status, 201);
  const bobMedia = await fetch(`${base}/media/${mediaId}`, { headers: { Authorization: `Bearer ${bob.accessToken}` } });
  assert.equal(bobMedia.status, 200);
  assert.equal(bobMedia.headers.get("content-type"), "image/png");
  assert.equal((await fetch(`${base}/media/${mediaId}`, { headers: { Authorization: `Bearer ${outsider.accessToken}` } })).status, 404);
  assert.equal((await request(`/media/${mediaId}`, alice.accessToken, "DELETE")).status, 409);
  assert.equal((await request(`/chats/${conversationId}/messages/${photoId}`, alice.accessToken, "DELETE")).status, 204);
  assert.equal((await request(`/media/${mediaId}`, alice.accessToken, "DELETE")).status, 204);
  mediaKeys.length = 0;

  assert.equal((await request(`/chats/${conversationId}/messages/${messageId}`, alice.accessToken, "DELETE")).status, 204);
  assert.equal((await request(`/chats/${conversationId}/messages`, bob.accessToken)).status, 200);
  assert.deepEqual((await (await request(`/chats/${conversationId}/messages`, bob.accessToken)).json()).messages, []);
});
