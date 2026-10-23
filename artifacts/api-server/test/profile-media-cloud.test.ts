import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { once } from "node:events";
import { accountBlocksTable, db, pool } from "@workspace/db";
import app from "../src/app";
import { deleteSupabaseMedia } from "../src/lib/supabase-storage";
import { installSupabaseStorageFixture } from "./helpers/supabase-storage-fixture";

test("profile headers are cloud-backed for other users without exposing private media or blocked profiles", async t => {
  const storageFixture = installSupabaseStorageFixture();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const userIds: string[] = [];
  const mediaIds: string[] = [];
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    try {
      if (mediaIds.length) {
        const objects = await pool.query("SELECT object_key FROM user_media_assets WHERE id=ANY($1::uuid[])", [mediaIds]);
        for (const object of objects.rows) await deleteSupabaseMedia(object.object_key);
      }
      if (userIds.length) await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [userIds]);
    } finally {
      await pool.end();
      storageFixture.restore();
    }
  });
  async function request(path: string, token?: string, method = "GET", body?: unknown) {
    return fetch(`${base}${path}`, {
      method, headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function register() {
    const username = `profile_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
    const response = await request("/auth/register", undefined, "POST", {
      username, email: `${username}@example.test`, displayName: username,
      password: `Fixture-${randomUUID()}`,
    });
    assert.equal(response.status, 201);
    const auth = await response.json();
    userIds.push(auth.account.id);
    return auth;
  }
  const alice = await register(), bob = await register();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWuoAAAAASUVORK5CYII=", "base64");
  async function upload() {
    const id = randomUUID();
    const response = await fetch(`${base}/media/${id}`, {
      method: "PUT", headers: { Authorization: `Bearer ${alice.accessToken}`, "Content-Type": "image/png" }, body: png,
    });
    assert.equal(response.status, 201);
    mediaIds.push(id);
    return `oldtime-media:${id}`;
  }
  const avatar = await upload(), cover = await upload(), unpublished = await upload();
  const saved = await request("/account/profile", alice.accessToken, "PUT", {
    username: alice.account.username, displayName: alice.account.displayName, email: alice.account.email,
    profile: { avatar, cover, bio: "Cloud header", city: "Hidden city", birthday: "1990-01-01",
      interests: ["Music"], profileVisibility: { city: false, interests: true } },
  });
  assert.equal(saved.status, 200);
  const publicView = await request(`/profiles/${alice.account.username}`, bob.accessToken);
  assert.equal(publicView.status, 200);
  const { profile } = await publicView.json();
  assert.equal(profile.avatar, avatar);
  assert.equal(profile.cover, cover);
  assert.equal(profile.bio, "Cloud header");
  assert.deepEqual(profile.interests, ["Music"]);
  for (const field of ["email", "birthday", "city", "savedPostIds"]) assert.equal(profile[field], undefined);
  for (const reference of [avatar, cover]) {
    const result = await request(`/media/${reference.split(":")[1]}/url`, bob.accessToken);
    assert.equal(result.status, 200);
    const read = await fetch((await result.json()).url);
    assert.equal(read.status, 200);
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), png);
  }
  assert.equal((await request(`/media/${unpublished.split(":")[1]}/url`, bob.accessToken)).status, 404);
  await db.insert(accountBlocksTable).values({ ownerId: alice.account.id, blockedId: bob.account.id });
  assert.equal((await request(`/media/${avatar.split(":")[1]}/url`, bob.accessToken)).status, 404);
  const blockedProfile = await (await request(`/profiles/${alice.account.username}`, bob.accessToken)).json();
  assert.equal(blockedProfile.profile.avatar, undefined);
  assert.equal(blockedProfile.profile.cover, undefined);
});
