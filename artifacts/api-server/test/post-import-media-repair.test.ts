import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { once } from "node:events";
import app from "../src/app";
import { pool } from "@workspace/db";

test("retrying a matching legacy post import repairs a missing media link without replacing existing links", async t => {
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

  const username = `qa_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const password = `Fixture-${randomUUID()}`;
  const register = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email: `${username}@example.test`, displayName: "Media repair test", password }),
  });
  assert.equal(register.status, 201);
  const owner = await register.json() as { accessToken: string; account: { id: string } };
  users.push(owner.account.id);

  const mediaId = randomUUID();
  const replacementMediaId = randomUUID();
  for (const id of [mediaId, replacementMediaId]) {
    await pool.query(
      `INSERT INTO user_media_assets (id, user_id, object_key, content_type, size, sha256, ready)
       VALUES ($1, $2, $3, 'image/jpeg', 1, $4, true)`,
      [id, owner.account.id, `media/${owner.account.id}/${id}`, "a".repeat(64)],
    );
  }
  const sourceId = randomUUID();
  const createdAt = Date.now();
  const imported = {
    sourceId,
    text: "Legacy media post",
    visibility: "public",
    createdAt,
    mediaIds: [],
    likedByMe: true,
    savedByMe: true,
  };
  const headers = { Authorization: `Bearer ${owner.accessToken}`, "Content-Type": "application/json" };
  const first = await fetch(`${base}/posts/import`, {
    method: "POST",
    headers,
    body: JSON.stringify({ posts: [imported] }),
  });
  assert.equal(first.status, 200);
  const firstResult = (await first.json() as { results: { postId: string; outcome: string }[] }).results[0];
  assert.equal(firstResult.outcome, "imported");
  const persistedLike = await pool.query(
    "SELECT 1 FROM post_likes WHERE user_id=$1 AND post_id=$2",
    [owner.account.id, firstResult.postId],
  );
  assert.equal(persistedLike.rowCount, 1, "the signed-in user's legacy like is stored in the database");
  const persistedAccountState = await pool.query(
    "SELECT data FROM account_state WHERE user_id=$1",
    [owner.account.id],
  );
  assert.ok(
    (persistedAccountState.rows[0]?.data?.savedPostIds || []).includes(firstResult.postId),
    "the saved post ID is stored in the signed-in account's server state",
  );

  const retry = await fetch(`${base}/posts/import`, {
    method: "POST",
    headers,
    body: JSON.stringify({ posts: [{ ...imported, mediaIds: [mediaId] }] }),
  });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json() as { results: { outcome: string }[] }).results[0].outcome, "already-imported");
  const likeCount = await pool.query(
    "SELECT count(*)::int AS count FROM post_likes WHERE user_id=$1 AND post_id=$2",
    [owner.account.id, firstResult.postId],
  );
  assert.equal(likeCount.rows[0]?.count, 1, "retrying the import does not duplicate a like");

  const conflictingRetry = await fetch(`${base}/posts/import`, {
    method: "POST",
    headers,
    body: JSON.stringify({ posts: [{ ...imported, mediaIds: [replacementMediaId] }] }),
  });
  assert.equal(conflictingRetry.status, 200);
  assert.equal((await conflictingRetry.json() as { results: { outcome: string }[] }).results[0].outcome, "conflict");

  const feed = await fetch(`${base}/feed?limit=30&offset=0`, { headers: { Authorization: `Bearer ${owner.accessToken}` } });
  assert.equal(feed.status, 200);
  const posts = (await feed.json() as { posts: { sourceId: string; media: { reference: string }[] }[] }).posts;
  assert.equal(posts.find(post => post.sourceId === sourceId)?.media[0]?.reference, `oldtime-media:${mediaId}`);
  assert.equal(posts.find(post => post.sourceId === sourceId)?.media.length, 1);
});
