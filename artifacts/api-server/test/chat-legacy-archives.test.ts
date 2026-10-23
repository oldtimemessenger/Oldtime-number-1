import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { once } from "node:events";
import app from "../src/app";
import { pool } from "@workspace/db";

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [
      key,
      canonicalJson((value as Record<string, unknown>)[key]),
    ]));
  }
  return value;
}

test("legacy chat archives are private, idempotent, conflict-safe, and deletable by their owner", async t => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const users: string[] = [];
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    try {
      if (users.length) await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
    } finally {
      await pool.end();
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
    const username = `archive_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
    const response = await request("/auth/register", undefined, "POST", {
      username,
      email: `${username}@example.test`,
      displayName: username,
      password: `Archive-${randomUUID()}`,
    });
    assert.equal(response.status, 201);
    const auth = await response.json() as { accessToken: string; account: { id: string } };
    users.push(auth.account.id);
    return auth;
  }

  const owner = await register();
  const stranger = await register();
  const sourceId = `cv-legacy-${randomUUID()}`;
  const payload = {
    version: 1,
    id: sourceId,
    ownerLocalId: "old-local-owner",
    ownerAccountId: owner.account.id,
    title: "Private imported conversation",
    members: [{ id: "old-local-owner", displayName: "Owner" }],
    messages: [{ id: "old-message-1", author: "old-local-owner", kind: "text", body: "Only the owner can see this", created: 1_700_000_000_000 }],
  };
  const contentHash = createHash("sha256").update(JSON.stringify(canonicalJson(payload))).digest("hex");
  const path = `/chats/legacy-archives/${encodeURIComponent(sourceId)}/0`;
  const body = { totalParts: 1, contentHash, payload };

  assert.equal((await request("/chats/legacy-archives", owner.accessToken)).status, 200);
  const imported = await request(path, owner.accessToken, "PUT", body);
  assert.equal(imported.status, 201);
  const repeated = await request(path, owner.accessToken, "PUT", body);
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).status, "already-imported");

  const listed = await request("/chats/legacy-archives", owner.accessToken);
  const archives = await listed.json();
  assert.equal(archives.archives.length, 1);
  assert.equal(archives.archives[0].contentHash, contentHash);
  assert.deepEqual(archives.archives[0].payload, payload);
  assert.equal((await request("/chats/legacy-archives", stranger.accessToken)).status, 200);
  assert.equal((await (await request("/chats/legacy-archives", stranger.accessToken)).json()).archives.length, 0);

  const conflictingPayload = { ...payload, title: "Different content" };
  const conflictingHash = createHash("sha256").update(JSON.stringify(canonicalJson(conflictingPayload))).digest("hex");
  assert.equal((await request(path, owner.accessToken, "PUT", {
    totalParts: 1, contentHash: conflictingHash, payload: conflictingPayload,
  })).status, 409);
  assert.equal((await request(path, stranger.accessToken, "PUT", body)).status, 403);
  assert.equal((await request(`/chats/legacy-archives/${encodeURIComponent(sourceId)}`, stranger.accessToken, "DELETE")).status, 404);
  assert.equal((await (await request("/chats/legacy-archives", owner.accessToken)).json()).archives.length, 1);

  assert.equal((await request(`/chats/legacy-archives/${encodeURIComponent(sourceId)}`, owner.accessToken, "DELETE")).status, 204);
  assert.equal((await (await request("/chats/legacy-archives", owner.accessToken)).json()).archives.length, 0);
});
