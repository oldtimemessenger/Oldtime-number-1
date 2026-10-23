import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
globalThis.window = { addEventListener() {}, dispatchEvent() {} };
localStorage.setItem("oldtime-v1", JSON.stringify({
  session: "legacy",
  users: [
    { id: "legacy", username: "legacy", email: null },
    { id: "other", username: "other", email: "person@example.test" }
  ]
}));

const { api, mutate, profileEmailValidationMessage } = await import("./store.js");
const { serializeSignalData } = await import("./comms/signal-codec.js");
const {
  acceptBlastFriendRequest, addBlastReply, createBlastPost, deleteBlastPost, getBlastPost,
  listBlastFriendRequests, listBlastFriends, removeBlastFriend, removeBlastFriendRequest,
  sendBlastFriendRequest, setBlastEventRsvp, toggleBlastReaction
} = await import("./blast-store.js");

test("profile email checks safely handle legacy accounts without email", () => {
  const me = api.me();
  assert.equal(me.email, "");
  assert.deepEqual(api.db().friendRequests, []);
  assert.deepEqual(api.db().blocks, []);
  assert.deepEqual(me.followers, []);
  assert.deepEqual(me.following, []);
  assert.deepEqual(me.friends, []);
  assert.deepEqual(me.closeFriends, []);
  assert.equal(api.emailInUse("new@example.test", me.id), false);

  assert.doesNotThrow(() => mutate(db => {
    db.users[0].email = "new@example.test";
  }));
  assert.equal(api.emailInUse("NEW@example.test", me.id), false);
  assert.equal(api.emailInUse("person@example.test", me.id), true);
});

test("Close Friends are confirmed Friends; follows and audience visibility stay independent", () => {
  const users = [
    { id: "author", username: "author", private: false, followers: ["follower"], following: ["follower"], friends: ["friend", "close"], closeFriends: ["close"] },
    { id: "follower", username: "follower", private: false, followers: [], following: ["author"], friends: [], closeFriends: [] },
    { id: "friend", username: "friend", private: false, followers: [], following: [], friends: ["author"], closeFriends: [] },
    { id: "close", username: "close", private: false, followers: [], following: [], friends: ["author"], closeFriends: [] },
    { id: "public", username: "public", private: false, followers: [], following: [], friends: [], closeFriends: [] }
  ];
  const posts = [
    { id: "public-post", author: "author", visibility: "public" },
    { id: "followers-post", author: "author", visibility: "followers" },
    { id: "friends-post", author: "author", visibility: "friends" },
    { id: "close-camel-post", author: "author", visibility: "closeFriends" },
    { id: "close-kebab-post", author: "author", visibility: "close-friends" },
    { id: "legacy-close-post", author: "author", closeFriends: true }
  ];
  const stories = [
    { id: "public-story", author: "author", visibility: "public" },
    { id: "followers-story", author: "author", visibility: "followers" },
    { id: "friends-story", author: "author", visibility: "friends" },
    { id: "close-story", author: "author", visibility: "close-friends" },
    { id: "close-camel-story", author: "author", visibility: "closeFriends" },
    { id: "close-audience-story", author: "author", audience: "close_friends" },
    { id: "legacy-close-story", author: "author", closeFriends: true }
  ];
  mutate(db => {
    db.users = users;
    db.posts = posts;
    db.stories = stories;
    db.session = "public";
    db.friendRequests = [{ from: "friend", to: "author", at: 1 }];
  });

  assert.equal(api.areFriends("author", "friend"), true);
  assert.equal(api.areFriends("author", "follower"), false);
  assert.equal(api.db().users.find(user => user.id === "author").followers.includes("friend"), false);
  assert.deepEqual(api.db().friendRequests, [{ from: "friend", to: "author", at: 1 }]);
  assert.deepEqual(JSON.parse(localStorage.getItem("oldtime-v1")).friendRequests, [{ from: "friend", to: "author", at: 1 }]);

  const visibleTo = viewer => {
    mutate(db => { db.session = viewer; });
    return api.posts().map(post => post.id);
  };
  const storiesVisibleTo = viewer => {
    mutate(db => { db.session = viewer; });
    return api.db().stories.filter(story => api.canSeeStory(story)).map(story => story.id);
  };
  assert.deepEqual(visibleTo("public"), ["public-post"]);
  assert.deepEqual(visibleTo("follower"), ["public-post", "followers-post"]);
  assert.deepEqual(visibleTo("friend"), ["public-post", "friends-post"]);
  assert.deepEqual(visibleTo("close"), ["public-post", "friends-post", "close-camel-post", "close-kebab-post", "legacy-close-post"]);
  assert.deepEqual(visibleTo("author"), posts.map(post => post.id));
  assert.deepEqual(storiesVisibleTo("public"), ["public-story"]);
  assert.deepEqual(storiesVisibleTo("follower"), ["public-story", "followers-story"]);
  assert.deepEqual(storiesVisibleTo("friend"), ["public-story", "friends-story"]);
  assert.deepEqual(storiesVisibleTo("close"), [
    "public-story",
    "friends-story",
    "close-story",
    "close-camel-story",
    "close-audience-story",
    "legacy-close-story"
  ]);
  assert.deepEqual(storiesVisibleTo("author"), stories.map(story => story.id));

  mutate(db => { db.users.find(user => user.id === "author").private = true; });
  assert.deepEqual(visibleTo("public"), []);
  assert.deepEqual(visibleTo("follower"), ["public-post", "followers-post"]);
  assert.deepEqual(visibleTo("friend"), ["public-post", "friends-post"]);
  assert.deepEqual(visibleTo("close"), ["public-post", "friends-post", "close-camel-post", "close-kebab-post", "legacy-close-post"]);
  assert.deepEqual(storiesVisibleTo("public"), []);
  assert.deepEqual(storiesVisibleTo("follower"), ["public-story", "followers-story"]);
  assert.deepEqual(storiesVisibleTo("friend"), ["public-story", "friends-story"]);
  assert.deepEqual(storiesVisibleTo("close"), [
    "public-story",
    "friends-story",
    "close-story",
    "close-camel-story",
    "close-audience-story",
    "legacy-close-story"
  ]);
});

test("Close Friends exclude strangers, pending requests and blocked accounts and revoke access after unfriending", t => {
  const before = structuredClone(api.db());
  t.after(() => mutate(db => Object.assign(db, before)));
  mutate(db => {
    db.session = "owner";
    db.users = [
      { id: "owner", username: "owner", friends: ["friend", "blocked"], closeFriends: ["friend", "stranger", "pending", "blocked"], followers: [], following: [] },
      { id: "friend", username: "friend", friends: ["owner"], closeFriends: ["owner"], followers: [], following: [] },
      { id: "stranger", username: "stranger", friends: [], closeFriends: [], followers: [], following: [] },
      { id: "pending", username: "pending", friends: ["owner"], closeFriends: [], followers: [], following: [] },
      { id: "blocked", username: "blocked", friends: ["owner"], closeFriends: [], followers: [], following: [] }
    ];
    db.blocks = [{ by: "blocked", who: "owner" }];
    db.friendRequests = [{ from: "owner", to: "pending" }];
    db.posts = [{ id: "restricted", author: "owner", visibility: "close-friends" }];
    db.stories = [{ id: "restricted-story", author: "owner", visibility: "close-friends" }];
  });
  assert.deepEqual(api.user("owner").closeFriends, ["friend"]);
  assert.equal(api.isCloseFriend("owner", "friend"), true);
  for (const id of ["stranger", "pending", "blocked"]) assert.equal(api.isCloseFriend("owner", id), false);
  assert.equal(api.canSeePost(api.post("restricted"), "friend"), true);
  mutate(db => { db.users.find(user => user.id === "owner").friends = []; });
  assert.deepEqual(api.user("owner").closeFriends, []);
  assert.deepEqual(api.user("friend").closeFriends, []);
  assert.equal(api.canSeePost(api.post("restricted"), "friend"), false);
  mutate(db => { db.session = "friend"; });
  assert.equal(api.canSeeStory(api.db().stories[0]), false);
  // Even hand-edited/stale records cannot grant Close Friends access without friendship.
  api.user("owner").closeFriends = ["stranger"];
  assert.equal(api.isCloseFriend("owner", "stranger"), false);
});

test("profile edits do not require a missing or unchanged email", () => {
  assert.equal(profileEmailValidationMessage("", "", () => false), "");
  assert.equal(profileEmailValidationMessage("not-an-email", "not-an-email", () => false), "");
  assert.equal(profileEmailValidationMessage("bad", "", () => false), "Enter a valid email");
  assert.equal(profileEmailValidationMessage("taken@example.test", "", () => true), "Email already registered");
  assert.equal(profileEmailValidationMessage("new@example.test", "", () => false), "");
});

test("Blast heart and support reactions can stay active independently", () => {
  const post = createBlastPost({ type: "post", audience: "public", body: "Reply test" });
  try {
    toggleBlastReaction(post.id, "heart");
    toggleBlastReaction(post.id, "support");

    let reactions = getBlastPost(post.id).reactions.filter(item => item.userId === api.me().id);
    assert.deepEqual(new Set(reactions.map(item => item.kind)), new Set(["heart", "support"]));

    toggleBlastReaction(post.id, "heart");
    reactions = getBlastPost(post.id).reactions.filter(item => item.userId === api.me().id);
    assert.deepEqual(reactions.map(item => item.kind), ["support"]);

    toggleBlastReaction(post.id, "support");
    reactions = getBlastPost(post.id).reactions.filter(item => item.userId === api.me().id);
    assert.deepEqual(reactions, []);
  } finally {
    deleteBlastPost(post.id);
  }
});

test("Blast event RSVPs update independently and can be cleared", () => {
  const post = createBlastPost({
    type: "event",
    audience: "public",
    title: "RSVP test",
    event: {
      kind: "meetup",
      startsAt: Date.now() + 60 * 60 * 1000,
      durationMinutes: 60,
      online: true
    }
  });
  try {
    setBlastEventRsvp(post.id, "going");
    assert.equal(getBlastPost(post.id).participants[0].status, "going");

    setBlastEventRsvp(post.id, "interested");
    assert.equal(getBlastPost(post.id).participants[0].status, "interested");
    assert.equal(getBlastPost(post.id).participants.length, 1);

    setBlastEventRsvp(post.id, "none");
    assert.deepEqual(getBlastPost(post.id).participants, []);
  } finally {
    deleteBlastPost(post.id);
  }
});

test("Blast replies save and friend request controls send, accept, and remove", () => {
  const post = createBlastPost({ type: "post", audience: "public", body: "Reply test" });
  const originalUserId = api.me().id;
  let request;
  try {
    addBlastReply(post.id, "A saved reply");
    assert.equal(getBlastPost(post.id).replies[0].body, "A saved reply");

    request = sendBlastFriendRequest("friend");
    assert.equal(listBlastFriendRequests().some(item => item.id === request.id), true);
    removeBlastFriendRequest(request.id);
    assert.equal(listBlastFriendRequests().some(item => item.id === request.id), false);

    request = sendBlastFriendRequest("friend");
    mutate(db => { db.session = "friend"; });
    acceptBlastFriendRequest(request.id);
    assert.equal(listBlastFriends().includes(originalUserId), true);

    mutate(db => { db.session = originalUserId; });
    assert.equal(listBlastFriends().includes("friend"), true);
    removeBlastFriend("friend");
    assert.equal(listBlastFriends().includes("friend"), false);
  } finally {
    mutate(db => { db.session = originalUserId; });
    if (request && listBlastFriendRequests().some(item => item.id === request.id)) {
      removeBlastFriendRequest(request.id);
    }
    removeBlastFriend("friend");
    deleteBlastPost(post.id);
  }
});

test("new accounts use the API and do not save plaintext passwords locally", async () => {
  const account = {
    id: "b5377081-e515-4a11-a40f-819f94b33cf8",
    username: "cloudmember",
    displayName: "Cloud Member",
    email: "cloud@example.test",
    joinedAt: Date.now()
  };
  const password = "longer-test-password";
  let importRequests = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("data:image/")) {
      return { ok: true, blob: async () => new Blob([Uint8Array.of(1, 2, 3)], { type: "image/jpeg" }) };
    }
    if (/^\/api\/media\/[0-9a-f-]+\/upload$/.test(String(url))) {
      return { ok: true, json: async () => ({ ready: true }) };
    }
    assert.equal(options.method, "POST");
    if (url === "/api/auth/register") {
      const registration = JSON.parse(options.body);
      assert.equal(registration.password, password);
      assert.equal(registration.displayName, account.username, "the display name defaults to the username when omitted");
      return {
        ok: true,
        status: 201,
        json: async () => ({
          accessToken: "a".repeat(43),
          tokenType: "Bearer",
          expiresAt: Date.now() + 60_000,
          account
        })
      };
    }
    if (url === "/api/posts/import") {
      importRequests++;
      assert.equal(options.headers.Authorization, `Bearer ${"a".repeat(43)}`);
      const { posts } = JSON.parse(options.body);
      assert.equal(posts.length, 4);
      const plainPost = posts.find(post => post.sourceId === "legacy-text-post");
      const engagedPost = posts.find(post => post.sourceId === "legacy-engaged-post");
      const commentedPost = posts.find(post => post.sourceId === "legacy-commented-post");
      const mediaPost = posts.find(post => post.sourceId === "legacy-media-post");
      assert.equal(plainPost.text, "A saved text post");
      assert.equal(engagedPost.likedByMe, true);
      assert.equal(engagedPost.savedByMe, true);
      assert.equal(commentedPost.comments[0].body, "My old reply");
      assert.equal(commentedPost.legacyArchive.comments[0].body, "Keep this reply");
      assert.equal(mediaPost.mediaIds.length, 1);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: posts.map((post, index) => ({
            sourceId: post.sourceId,
            postId: `${index + 1}13a143c-8c24-4f8b-94e5-0368f4196f45`,
            outcome: "imported"
          }))
        })
      };
    }
    assert.equal(url, "/api/auth/password");
    assert.equal(options.headers.Authorization, `Bearer ${"a".repeat(43)}`);
    assert.deepEqual(JSON.parse(options.body), {
      currentPassword: password,
      newPassword: "newer-test-password"
    });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  assert.equal(await api.signup({
    email: account.email,
    username: account.username,
    password
  }), "cloud");
  assert.equal(api.me().cloudAccountId, account.id);
  assert.equal(api.cloudAccountId(), account.id);
  assert.equal(api.me().password, undefined);

  const legacySnapshot = JSON.parse(localStorage.getItem("oldtime-v1"));
  assert.equal(legacySnapshot.users.some(user => user.cloudAccountId === account.id), false);
  assert.equal(JSON.stringify(legacySnapshot).includes(password), false);

  mutate(db => {
    db.posts = [
      {
        id: "legacy-text-post",
        author: api.me().id,
        kind: "text",
        caption: "A saved text post",
        media: [],
        visibility: "public",
        created: 1_700_000_000_000,
        likes: [],
        comments: [],
        saves: []
      },
      {
        id: "legacy-engaged-post",
        author: api.me().id,
        kind: "text",
        caption: "Transfer the author's own engagement",
        media: [],
        visibility: "public",
        created: 1_700_000_000_003,
        likes: [api.me().id],
        comments: [],
        saves: [api.me().id]
      },
      {
        id: "legacy-commented-post",
        author: api.me().id,
        kind: "text",
        caption: "Keep its legacy conversation intact",
        media: [],
        visibility: "public",
        created: 1_700_000_000_002,
        likes: ["legacy-like"],
        comments: [
          { id: "legacy-comment", author: "legacy-other-user", text: "Keep this reply" },
          { id: "legacy-owned-comment", author: api.me().id, text: "My old reply" },
        ],
        saves: []
      },
      {
        id: "legacy-media-post",
        author: api.me().id,
        kind: "photo",
        caption: "Still needs durable media storage",
        media: ["data:image/jpeg;base64,AA=="],
        visibility: "public",
        created: 1_700_000_000_001,
        likes: [],
        comments: [],
        saves: []
      }
    ];
  });
  const legacySource = JSON.parse(localStorage.getItem("oldtime-v1"));
  legacySource.posts = structuredClone(api.db().posts);
  localStorage.setItem("oldtime-v1", JSON.stringify(legacySource));
  const migration = await api.migrateCloudTextPosts();
  assert.equal(migration.confirmed, 4);
  assert.equal(migration.unsupported, 0);
  assert.equal(importRequests, 1);
  assert.deepEqual(api.db().posts, []);
  assert.deepEqual(
    JSON.parse(localStorage.getItem("oldtime-v1")).posts.map(post => post.id).sort(),
    [],
    "only server-confirmed legacy posts are pruned from the device source",
  );
  await api.migrateCloudTextPosts();
  assert.equal(importRequests, 1, "confirmed migrations must not be uploaded again in the same session");

  await assert.doesNotReject(api.changePassword(password, "newer-test-password"));
  api.logout();
});

test("WebRTC descriptions and ICE candidates become structured-clone-safe signal data", () => {
  class FakeRtcDescription {
    constructor(type, sdp) {
      this.type = type;
      this.sdp = sdp;
    }
    toJSON() { return { type: this.type, sdp: this.sdp }; }
  }

  class FakeIceCandidate {
    constructor(candidate) {
      this.candidate = candidate;
      this.sdpMid = "0";
      this.sdpMLineIndex = 0;
    }
    toJSON() {
      return {
        candidate: this.candidate,
        sdpMid: this.sdpMid,
        sdpMLineIndex: this.sdpMLineIndex
      };
    }
  }

  const signal = serializeSignalData({
    offer: new FakeRtcDescription("offer", "v=0\r\n"),
    candidate: new FakeIceCandidate("candidate:1 1 udp 1 192.0.2.1 9 typ host"),
    retry: false
  });

  assert.deepEqual(signal.offer, { type: "offer", sdp: "v=0\r\n" });
  assert.deepEqual(signal.candidate, {
    candidate: "candidate:1 1 udp 1 192.0.2.1 9 typ host",
    sdpMid: "0",
    sdpMLineIndex: 0
  });
  assert.deepEqual(structuredClone(signal), signal);
});

test("failed API sign-in never accepts a cached local password or creates an account", async () => {
  api.logout();
  mutate(db => {
    db.users.push({ id: "local-only-auth-check", username: "local_only_auth_check", email: "local_auth@example.test",
      password: "cached-test-password", friends: [], closeFriends: [] });
  });
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [401, 500]) {
      let requests = 0;
      globalThis.fetch = async url => {
        requests++;
        assert.equal(url, "/api/auth/login");
        return { ok: false, status, json: async () => ({ error: "Sign-in failed" }) };
      };
      await assert.rejects(api.login("local_only_auth_check", "cached-test-password"), /Sign-in failed/);
      assert.equal(requests, 1);
      assert.equal(api.me(), null);
      assert.equal(api.cloudAccountId(), null);
    }
    globalThis.fetch = async () => { throw new TypeError("Network unavailable"); };
    await assert.rejects(api.login("local_only_auth_check", "cached-test-password"));
    assert.equal(api.me(), null);
  } finally {
    globalThis.fetch = originalFetch;
    mutate(db => { db.users = db.users.filter(user => user.id !== "local-only-auth-check"); });
  }
});

test("post deletion is allowed only for the post owner", async () => {
  mutate(db => {
    db.users = [
      { id: "delete-owner", username: "delete_owner", friends: [], closeFriends: [] },
      { id: "delete-other", username: "delete_other", friends: [], closeFriends: [] }
    ];
    db.session = "delete-owner";
    db.posts = [
      { id: "delete-owned", author: "delete-owner", text: "my post" },
      { id: "delete-foreign", author: "delete-other", text: "someone else's post" }
    ];
  });

  await api.deleteOwnPost("delete-owned");
  assert.equal(api.post("delete-owned"), null);
  await assert.rejects(api.deleteOwnPost("delete-foreign"), /own posts/);
  assert.equal(api.post("delete-foreign")?.author, "delete-other");
});

test("Story deletion is allowed only for the Story owner", async () => {
  mutate(db => {
    db.users = [
      { id: "story-owner", username: "story_owner", friends: [], closeFriends: [] },
      { id: "story-other", username: "story_other", friends: [], closeFriends: [] }
    ];
    db.session = "story-owner";
    db.stories = [
      { id: "story-owned", author: "story-owner" },
      { id: "story-foreign", author: "story-other" }
    ];
  });

  await api.deleteOwnStory("story-owned");
  assert.equal(api.db().stories.some(story => story.id === "story-owned"), false);
  await assert.rejects(api.deleteOwnStory("story-foreign"), /own Stories/);
  assert.equal(api.db().stories.find(story => story.id === "story-foreign")?.author, "story-other");
});
