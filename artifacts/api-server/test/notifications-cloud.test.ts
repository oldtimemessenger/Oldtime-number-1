import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { pool } from "@workspace/db";
import app from "../src/app";

test("notifications come from live social activity, isolate accounts and preserve cloud read status", async t => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const ids: string[] = [];
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    try { if (ids.length) await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]); }
    finally { await pool.end(); }
  });
  const request = (path: string, token?: string, method = "GET", body?: unknown) => fetch(`${base}${path}`, {
    method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  async function register() {
    const username = `notif_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const response = await request("/auth/register", undefined, "POST", {
      username, email: `${username}@example.test`, displayName: username, password: `Notif-${randomUUID()}`,
    });
    assert.equal(response.status, 201);
    const auth = await response.json();
    ids.push(auth.account.id);
    return auth;
  }
  const alice = await register();
  const bob = await register();
  assert.equal((await request("/notifications")).status, 401);
  const postId = randomUUID();
  await pool.query("INSERT INTO posts(id,author_id,text,destination) VALUES($1,$2,$3,'main')",
    [postId, alice.account.id, "A notification integration test post"]);
  assert.equal((await request(`/posts/${postId}/like`, bob.accessToken, "PUT")).status, 200);
  assert.equal((await request(`/relationships/follow/${alice.account.id}`, bob.accessToken, "POST")).status, 200);
  assert.equal((await request(`/posts/${postId}/comments`, bob.accessToken, "POST", { body: "A live comment" })).status, 200);
  const response = await request("/notifications", alice.accessToken);
  assert.equal(response.status, 200, await response.clone().text());
  const feed = await response.json();
  assert.deepEqual(new Set(feed.notifications.map((n: { kind: string }) => n.kind)), new Set(["like", "follow", "comment"]));
  assert.ok(feed.notifications.every((n: { actor: { id: string }; read: boolean }) => n.actor.id === bob.account.id && !n.read));
  assert.deepEqual((await (await request("/notifications", bob.accessToken)).json()).notifications, []);
  assert.equal((await request(`/posts/${postId}`, alice.accessToken)).status, 200);
  const through = Math.max(...feed.notifications.map((n: { createdAt: number }) => n.createdAt));
  assert.equal((await request("/notifications/read", alice.accessToken, "POST", { through })).status, 200);
  assert.equal((await request("/account/state", alice.accessToken, "PUT", { state: { savedPostIds: [] } })).status, 200);
  const reopened = await (await request("/notifications", alice.accessToken)).json();
  assert.equal(reopened.readAt, through);
  assert.ok(reopened.notifications.every((n: { read: boolean }) => n.read));
  assert.equal((await request("/notifications/read", alice.accessToken, "POST", { through: 0 })).status, 200);
  assert.equal((await (await request("/notifications", alice.accessToken)).json()).readAt, through);
  await pool.query("INSERT INTO account_blocks(owner_id,blocked_id) VALUES($1,$2)", [alice.account.id, bob.account.id]);
  assert.deepEqual((await (await request("/notifications", alice.accessToken)).json()).notifications, []);
  assert.equal((await request(`/posts/${postId}`, bob.accessToken)).status, 404);
});
