import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { once } from "node:events";
import app from "../src/app";
import { pool } from "@workspace/db";

// Real HTTP + PostgreSQL tests, not mocked handlers or production accounts.
test("independent accounts have persisted posts, likes and comments with owner-only deletion", async t => {
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
    } finally { await pool.end(); }
  });
  async function request(path: string, token?: string, method = "GET", body?: unknown) {
    return fetch(`${base}${path}`, { method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function register() {
    const username = `qa_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const password = `Fixture-${randomUUID()}`;
    const response = await request("/auth/register", undefined, "POST",
      { username, email: `${username}@example.test`, displayName: "Lifecycle test", password });
    assert.equal(response.status, 201);
    const auth = await response.json();
    users.push(auth.account.id);
    return { ...auth, username, password };
  }
  const alice = await register(), bob = await register();
  const legacyAlice = await register(), legacyBob = await register();
  const preferenceWrite = await request("/account/state", alice.accessToken, "PUT", { state: {
    notificationEnabled: false,
    chatPreferences: { readReceipts: false, lastSeen: "contacts" },
    interestPreferences: null,
  } });
  assert.equal(preferenceWrite.status, 200);
  const preferences = await (await request("/account/state", alice.accessToken)).json();
  assert.equal(preferences.state.notificationEnabled, false);
  assert.deepEqual(preferences.state.chatPreferences, { readReceipts: false, lastSeen: "contacts" });
  assert.equal(preferences.state.interestPreferences, null);
  const profileWrite = await request("/account/profile", alice.accessToken, "PUT", {
    username: alice.username,
    displayName: "Cloud Profile Test",
    email: `${alice.username}@example.test`,
    profile: {
      bio: "Saved to the server",
      city: "New York",
      birthday: "1990-01-01",
      interests: ["Photography"],
      avatar: "/app/avatar.svg",
      cover: null,
      avatarPreset: null,
      profileVisibility: { city: false, interests: true },
    },
  });
  assert.equal(profileWrite.status, 200);
  const profile = await profileWrite.json();
  assert.equal(profile.account.displayName, "Cloud Profile Test");
  assert.deepEqual(profile.profile.profileVisibility, { city: false, interests: true });
  assert.equal((await request("/account/profile", alice.accessToken, "PUT", {
    username: alice.username,
    displayName: "Cloud Profile Test",
    email: "unverified@example.test",
    profile: { bio: "Must not change sign-in identity." },
  })).status, 409);
  const verifiedProfileState = await (await request("/account/state", alice.accessToken)).json();
  assert.equal(verifiedProfileState.state.notificationEnabled, false);
  assert.deepEqual(verifiedProfileState.state.profile.interests, ["Photography"]);
  assert.equal(verifiedProfileState.state.profile.displayName, "Cloud Profile Test");
  assert.equal((await request("/feed")).status, 401);
  const legacyImport = await request("/relationships/import-legacy", legacyAlice.accessToken, "POST", {
    friendIds: [legacyBob.account.id],
  });
  assert.deepEqual(await legacyImport.json(), { imported: true, migratedTargets: 1 });
  assert.equal((await request("/relationships/import-legacy", legacyAlice.accessToken, "POST", {
    friendIds: [],
  })).status, 200);
  const legacyBobImport = await request("/relationships/import-legacy", legacyBob.accessToken, "POST", {
    friendIds: [legacyAlice.account.id],
  });
  assert.deepEqual(await legacyBobImport.json(), { imported: true, migratedTargets: 1 });
  assert.ok((await (await request("/relationships", legacyAlice.accessToken)).json())
    .friends.some((profile: { id: string }) => profile.id === legacyBob.account.id));
  const friendshipRequest = await request(`/relationships/friend-requests/${bob.account.id}`, alice.accessToken, "POST");
  assert.equal(friendshipRequest.status, 200);
  assert.ok((await (await request("/relationships", bob.accessToken)).json())
    .incomingFriendRequests.some((profile: { id: string }) => profile.id === alice.account.id));
  assert.equal((await request(`/relationships/friend-requests/${alice.account.id}/accept`, bob.accessToken, "POST")).status, 204);
  assert.ok((await (await request("/relationships", alice.accessToken)).json())
    .friends.some((profile: { id: string }) => profile.id === bob.account.id));
  assert.equal((await request(`/relationships/friends/${bob.account.id}`, alice.accessToken, "DELETE")).status, 204);
  assert.equal((await request(`/relationships/follow/${bob.account.id}`, alice.accessToken, "POST")).status, 200);
  assert.ok((await (await request("/relationships", bob.accessToken)).json())
    .followers.some((profile: { id: string }) => profile.id === alice.account.id));
  assert.equal((await request("/account/privacy", bob.accessToken, "PUT", { isPrivate: true })).status, 200);
  const privateFollow = await request(`/relationships/follow/${bob.account.id}`, alice.accessToken, "POST");
  assert.equal((await privateFollow.json()).requested, true);
  assert.equal((await request(`/relationships/follow-requests/${alice.account.id}/accept`, bob.accessToken, "POST")).status, 204);
  assert.ok((await (await request("/relationships", alice.accessToken)).json())
    .following.some((profile: { id: string }) => profile.id === bob.account.id));
  assert.equal((await request(`/relationships/follow/${bob.account.id}`, alice.accessToken, "DELETE")).status, 204);
  assert.equal((await request("/account/privacy", bob.accessToken, "PUT", { isPrivate: false })).status, 200);
  assert.equal((await request("/account/blocks", alice.accessToken, "PUT", { userIds: [bob.account.id] })).status, 200);
  assert.ok(!(await (await request("/relationships", alice.accessToken)).json())
    .following.some((profile: { id: string }) => profile.id === bob.account.id));
  assert.ok(!(await (await request("/relationships", bob.accessToken)).json())
    .followers.some((profile: { id: string }) => profile.id === alice.account.id));
  assert.equal((await request("/account/blocks", alice.accessToken, "PUT", { userIds: [] })).status, 200);
  const created = await request("/posts", alice.accessToken, "POST", { text: "Lifecycle fixture" });
  assert.equal(created.status, 201);
  const { post } = await created.json();
  assert.equal(post.author.id, alice.account.id);
  assert.equal(post.destination, "main");
  assert.equal(post.remixCount, 0);
  const feed = await (await request("/feed", bob.accessToken)).json();
  assert.ok(feed.posts.some((p: { id: string }) => p.id === post.id));
  const remixSourceResponse = await request("/posts", alice.accessToken, "POST", {
    text: "Community remix source", destination: "community",
  });
  assert.equal(remixSourceResponse.status, 201);
  const { post: remixSource } = await remixSourceResponse.json();
  assert.equal(remixSource.remixCount, 0);
  assert.equal((await request("/account/privacy", alice.accessToken, "PUT", { isPrivate: true })).status, 200);
  const hiddenSourceAttempt = await request("/posts", bob.accessToken, "POST", {
    text: "Should not remix a hidden source", destination: "community", remixSourcePostId: remixSource.id,
  });
  assert.equal(hiddenSourceAttempt.status, 404);
  assert.equal((await request("/account/privacy", alice.accessToken, "PUT", { isPrivate: false })).status, 200);
  assert.equal((await request("/account/privacy", bob.accessToken, "PUT", { isPrivate: true })).status, 200);
  const publishedRemixResponse = await request("/posts", bob.accessToken, "POST", {
    text: "A published remix", destination: "community", remixSourcePostId: remixSource.id,
  });
  assert.equal(publishedRemixResponse.status, 201);
  const { post: publishedRemix } = await publishedRemixResponse.json();
  assert.equal(publishedRemix.remixSourcePostId, remixSource.id);
  assert.equal(publishedRemix.remixCount, 0);
  const hiddenRemixFeed = await (await request("/feed?surface=community", alice.accessToken)).json();
  assert.equal(hiddenRemixFeed.posts.find((item: { id: string }) => item.id === remixSource.id)?.remixCount, 0);
  assert.equal((await request("/account/privacy", bob.accessToken, "PUT", { isPrivate: false })).status, 200);
  const visibleRemixFeed = await (await request("/feed?surface=community", alice.accessToken)).json();
  assert.equal(visibleRemixFeed.posts.find((item: { id: string }) => item.id === remixSource.id)?.remixCount, 1);
  const pagedPost = await request("/posts", alice.accessToken, "POST", {
    text: "Second pagination fixture", destination: "community",
  });
  assert.equal(pagedPost.status, 201);
  const { post: communityPost } = await pagedPost.json();
  assert.equal(communityPost.destination, "community");
  assert.equal((await request("/posts", alice.accessToken, "POST", {
    text: "Invalid placement", destination: "local-device",
  })).status, 400);
  const firstPage = await (await request("/feed?limit=1&offset=0", bob.accessToken)).json();
  assert.equal(firstPage.posts.length, 1);
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.nextOffset, 1);
  const secondPage = await (await request(`/feed?limit=1&offset=${firstPage.nextOffset}`, bob.accessToken)).json();
  assert.equal(secondPage.posts.length, 1);
  assert.equal(secondPage.nextOffset, 2);
  assert.notEqual(secondPage.posts[0].id, firstPage.posts[0].id);
  const bothPost = await request("/posts", alice.accessToken, "POST", {
    text: "Cross-post fixture", destination: "both",
  });
  assert.equal(bothPost.status, 201);
  assert.equal((await bothPost.json()).post.destination, "both");
  assert.equal((await request("/feed?offset=100001", bob.accessToken)).status, 400);
  assert.equal((await request(`/posts/${post.id}`, bob.accessToken, "DELETE")).status, 404);
  for (let i = 0; i < 2; i++) {
    const liked = await request(`/posts/${post.id}/like`, bob.accessToken, "PUT");
    assert.equal(liked.status, 200);
    assert.equal((await liked.json()).likeCount, 1);
  }
  const likedFeed=await (await request("/feed",alice.accessToken)).json();
  const likedPost=likedFeed.posts.find((p:{id:string})=>p.id===post.id);
  assert.equal(likedPost.likeCount,1);
  assert.equal(likedPost.likedBy.length,1);
  assert.equal(likedPost.likedBy[0].id,bob.account.id);
  assert.equal(likedPost.likedBy[0].displayName,"Lifecycle test");
  assert.equal(likedPost.repostCount, 0);
  assert.equal(likedPost.repostedByMe, false);
  assert.equal(likedPost.repostNote, null);
  const postFriendshipRequest = await request(`/relationships/friend-requests/${bob.account.id}`, alice.accessToken, "POST");
  assert.equal(postFriendshipRequest.status, 200);
  assert.equal((await request(`/relationships/friend-requests/${alice.account.id}/accept`, bob.accessToken, "POST")).status, 204);
  const communityRepost = await request(`/posts/${communityPost.id}/repost`, bob.accessToken, "PUT", { note: "" });
  assert.equal(communityRepost.status, 200);
  const communityFriendFeed = await (await request("/feed?surface=community", alice.accessToken)).json();
  const groupedCommunityPosts = communityFriendFeed.posts.filter((item: { id: string }) => item.id === communityPost.id);
  assert.equal(groupedCommunityPosts.length, 1, "friend reposts retain one original Community card");
  assert.equal(groupedCommunityPosts[0].friendRepostCount, 1);
  assert.deepEqual(groupedCommunityPosts[0].repostedByFriends.map((friend: { username: string }) => friend.username), [bob.username]);
  assert.equal((await request(`/posts/${communityPost.id}/repost`, bob.accessToken, "DELETE")).status, 200);
  const firstRepost = await request(`/posts/${post.id}/repost`, bob.accessToken, "PUT", { note: "Worth sharing" });
  assert.equal(firstRepost.status, 200);
  assert.deepEqual(await firstRepost.json(), { reposted: true, repostCount: 1, note: "Worth sharing" });
  const repeatedRepost = await request(`/posts/${post.id}/repost`, bob.accessToken, "PUT", { note: "Updated thought" });
  assert.equal(repeatedRepost.status, 200);
  assert.deepEqual(await repeatedRepost.json(), { reposted: true, repostCount: 1, note: "Updated thought" });
  assert.equal((await request(`/posts/${post.id}/repost`, bob.accessToken, "PUT", { note: "x".repeat(141) })).status, 400);
  const bobFeed = await (await request("/feed", bob.accessToken)).json();
  const bobRepost = bobFeed.posts.find((p: { id: string }) => p.id === post.id);
  assert.equal(bobRepost.repostedByMe, true);
  assert.equal(bobRepost.repostNote, "Updated thought");
  const aliceFeed = await (await request("/feed", alice.accessToken)).json();
  const alicePost = aliceFeed.posts.find((p: { id: string }) => p.id === post.id);
  assert.equal(alicePost.repostCount, 1);
  assert.equal(alicePost.repostedByMe, false);
  assert.equal(alicePost.repostNote, null);
  const removedRepost = await request(`/posts/${post.id}/repost`, bob.accessToken, "DELETE");
  assert.deepEqual(await removedRepost.json(), { reposted: false, repostCount: 0, note: null });
  const restoredRepost = await request(`/posts/${post.id}/repost`, bob.accessToken, "PUT", { note: "Persist through deletion" });
  assert.equal(restoredRepost.status, 200);
  const ownReposts = await request(`/profiles/${bob.username}/reposts?limit=1`, bob.accessToken);
  assert.equal(ownReposts.status, 200);
  const ownRepostFeed = await ownReposts.json();
  assert.equal(ownRepostFeed.posts.length, 1);
  assert.equal(ownRepostFeed.posts[0].id, post.id);
  assert.equal(ownRepostFeed.posts[0].repostedByMe, true);
  assert.equal(ownRepostFeed.posts[0].repostNote, "Persist through deletion");
  assert.equal(ownRepostFeed.hasMore, false);
  const publicReposts = await request(`/profiles/${bob.username}/reposts`, alice.accessToken);
  assert.equal(publicReposts.status, 200);
  const publicRepostFeed = await publicReposts.json();
  assert.equal(publicRepostFeed.posts[0].id, post.id);
  assert.equal(publicRepostFeed.posts[0].repostedByMe, false);
  assert.equal(publicRepostFeed.posts[0].repostNote, null);
  const commentResponse = await request(`/posts/${post.id}/comments`, bob.accessToken, "POST", { body: "Real persisted comment" });
  assert.equal(commentResponse.status, 200);
  const comment = await commentResponse.json();
  assert.equal(comment.author.id, bob.account.id);
  const replyResponse = await request(`/posts/${post.id}/comments`, bob.accessToken, "POST",
    { body: "A persisted reply", parentId: comment.id });
  assert.equal(replyResponse.status, 200);
  const reply = await replyResponse.json();
  assert.equal(reply.parentId, comment.id);
  assert.equal((await request(`/posts/${post.id}/comments/${comment.id}/reaction`, alice.accessToken, "PUT",
    { reaction: "like" })).status, 200);
  const discussion = await (await request(`/posts/${post.id}/comments`, alice.accessToken)).json();
  const persistedComment = discussion.comments.find((c: { id: string }) => c.id === comment.id);
  assert.ok(persistedComment);
  assert.equal(persistedComment.parentId, null);
  assert.ok(persistedComment.likes.includes(alice.account.id));
  assert.ok(discussion.comments.some((c: { id: string; parentId: string }) =>
    c.id === reply.id && c.parentId === comment.id));
  assert.equal((await request(`/posts/${post.id}/comments/${comment.id}`, alice.accessToken, "DELETE")).status, 404);
  assert.equal((await request(`/posts/${post.id}/comments/${reply.id}`, alice.accessToken, "DELETE")).status, 404);

  await t.test("registration and login preserve another account's renewable Cognito session", async () => {
    const expired = await pool.query(
      "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()-interval '1 minute') RETURNING id",
      [alice.account.id, randomUUID()]);
    const sessionId = expired.rows[0].id;
    await pool.query(
      `INSERT INTO cognito_grants(session_id,issuer,subject,encrypted_refresh_token,refresh_until)
       VALUES($1,'https://fixture.invalid','fixture','test-only-not-a-real-token',now()+interval '1 day')`, [sessionId]);
    await register();
    const login = await request("/auth/login", undefined, "POST", { identifier: bob.username, password: bob.password });
    assert.equal(login.status, 200);
    assert.equal((await pool.query("SELECT id FROM sessions WHERE id=$1", [sessionId])).rowCount, 1);
    await pool.query("UPDATE cognito_grants SET refresh_until=now()-interval '1 minute' WHERE session_id=$1", [sessionId]);
    assert.equal((await request("/auth/login", undefined, "POST", { identifier: bob.username, password: bob.password })).status, 200);
    assert.equal((await pool.query("SELECT id FROM sessions WHERE id=$1", [sessionId])).rowCount, 0);
  });

  assert.equal((await request(`/posts/${post.id}`, alice.accessToken, "DELETE")).status, 204);
  assert.equal((await pool.query("SELECT id FROM post_comments WHERE post_id=$1", [post.id])).rowCount, 0);
  assert.equal((await pool.query("SELECT user_id FROM post_likes WHERE post_id=$1", [post.id])).rowCount, 0);
  assert.equal((await pool.query("SELECT user_id FROM post_reposts WHERE post_id=$1", [post.id])).rowCount, 0);
  const afterDelete = await (await request("/feed", bob.accessToken)).json();
  assert.ok(!afterDelete.posts.some((p: { id: string }) => p.id === post.id));
  assert.equal((await request(`/posts/${post.id}/like`, bob.accessToken, "PUT")).status, 404);
  assert.equal((await request(`/posts/${post.id}/comments`, bob.accessToken, "POST", { body: "No longer exists" })).status, 404);
});
