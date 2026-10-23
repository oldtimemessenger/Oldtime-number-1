import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { once } from "node:events";
import app from "../src/app";
import { pool } from "@workspace/db";

test("Story views and reactions persist, while viewer identities remain owner-only", async t => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const userIds: string[] = [];

  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    try {
      if (userIds.length) await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [userIds]);
    } finally {
      await pool.end();
    }
  });

  async function request(path: string, token: string | undefined, method = "GET", body?: unknown) {
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
    userIds.push(auth.account.id);
    return auth;
  }

  const owner = await register();
  const viewer = await register();
  const stranger = await register();
  assert.equal((await request("/account/privacy", owner.accessToken, "PUT", { isPrivate: false })).status, 200);
  const created = await request("/stories", owner.accessToken, "POST", {
    text: "A durable Story activity test",
    visibility: "public",
    commentsEnabled: true,
  });
  assert.equal(created.status, 201);
  const { story } = await created.json();

  const viewerStories = await request("/stories", viewer.accessToken);
  assert.equal(viewerStories.status, 200);
  const initialList = await viewerStories.json();
  assert.equal(initialList.stories.find((item: { id: string }) => item.id === story.id)?.viewerReaction, null);

  const firstView = await request(`/stories/${story.id}/views`, viewer.accessToken, "POST");
  assert.equal(firstView.status, 200);
  assert.deepEqual(await firstView.json(), { recorded: true });
  const duplicateView = await request(`/stories/${story.id}/views`, viewer.accessToken, "POST");
  assert.deepEqual(await duplicateView.json(), { recorded: false });

  const reaction = await request(`/stories/${story.id}/reactions`, viewer.accessToken, "PUT", { emoji: "❤️" });
  assert.equal(reaction.status, 200);
  assert.equal((await reaction.json()).reaction.emoji, "❤️");
  const refreshedList = await request("/stories", viewer.accessToken);
  assert.equal((await refreshedList.json()).stories.find((item: { id: string }) => item.id === story.id)?.viewerReaction, "❤️");

  const ownerActivity = await request(`/stories/${story.id}/activity`, owner.accessToken);
  assert.equal(ownerActivity.status, 200);
  const activity = await ownerActivity.json();
  assert.equal(activity.viewCount, 1);
  assert.equal(activity.reactionCount, 1);
  assert.equal(activity.viewers[0].id, viewer.account.id);
  assert.equal(activity.viewers[0].reaction, "❤️");

  assert.equal((await request(`/stories/${story.id}/activity`, viewer.accessToken)).status, 404);
  assert.equal((await request(`/stories/${story.id}/activity`, stranger.accessToken)).status, 404);
  assert.equal((await request(`/stories/${story.id}/reactions`, stranger.accessToken, "PUT", { emoji: "💯" })).status, 400);
  const ownerReaction = await request(`/stories/${story.id}/reactions`, owner.accessToken, "PUT", { emoji: "🔥" });
  assert.equal(ownerReaction.status, 200);
  assert.equal((await ownerReaction.json()).reaction.emoji, "🔥");
  const ownerStories = await request("/stories", owner.accessToken);
  assert.equal((await ownerStories.json()).stories.find((item: { id: string }) => item.id === story.id)?.viewerReaction, "🔥");
  const activityWithOwnerReaction = await request(`/stories/${story.id}/activity`, owner.accessToken);
  const withOwnerReaction = await activityWithOwnerReaction.json();
  assert.equal(withOwnerReaction.viewCount, 1, "reacting to your own Story does not record a Story view");
  assert.equal(withOwnerReaction.reactionCount, 2, "owner reactions are included in the server-backed reaction count");
  assert.equal(withOwnerReaction.viewers.length, 1, "the owner is not listed as a viewer of their own Story");

  assert.equal((await request(`/stories/${story.id}/reactions`, viewer.accessToken, "DELETE")).status, 204);
  const afterRemoval = await request(`/stories/${story.id}/activity`, owner.accessToken);
  const finalActivity = await afterRemoval.json();
  assert.equal(finalActivity.viewCount, 1);
  assert.equal(finalActivity.reactionCount, 1);
  assert.equal(finalActivity.viewers[0].reaction, null);
  assert.equal((await request(`/stories/${story.id}/reactions`, owner.accessToken, "DELETE")).status, 204);
  const afterOwnerRemoval = await request(`/stories/${story.id}/activity`, owner.accessToken);
  assert.equal((await afterOwnerRemoval.json()).reactionCount, 0);
  assert.equal((await request(`/stories/${story.id}`, owner.accessToken, "DELETE")).status, 204);
});
