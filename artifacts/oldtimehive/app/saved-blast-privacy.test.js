import test from "node:test";
import assert from "node:assert/strict";

class Storage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
globalThis.localStorage = new Storage();
globalThis.sessionStorage = new Storage();
globalThis.window = { addEventListener() {}, dispatchEvent() {} };
const user = id => ({ id, name: id, username: id, avatar: "/app/avatar.svg", private: false, followers: [], following: [], friends: [], closeFriends: [] });
const original = { id: "original", author: "author", kind: "text", caption: "Original post", media: [], visibility: "public", saves: [], likes: [], comments: [] };
localStorage.setItem("oldtime-v1", JSON.stringify({
  session: "author", users: ["author", "friend", "second", "stranger"].map(user),
  posts: [original], convos: [{ id: "group", members: ["author", "friend", "stranger"], group: { name: "Group" } }]
}));
const { api, mutate } = await import("./store.js");
const {
  listSavedCollections, setPostSaved, createSavedCollection, renameSavedCollection,
  deleteSavedCollection, toggleSavedCollection, listSavedPosts
} = await import("./saved-collections.js");
const {
  createBlastPost, getBlastPost, listBlastPosts, addBlastReply, toggleBlastReaction,
  sendBlastFriendRequest, acceptBlastFriendRequest, removeBlastFriend
} = await import("./blast-store.js");
const { getBlastVideoNote, listBlastFeedVideoNotes, addBlastVideoNoteComment } = await import("./blast-video-note-store.js");
const { listBlastShareFriends } = await import("./blast-shared-post.js");
const { renderShareSheet } = await import("./saved-sheets.js");
const session = id => mutate(db => { db.session = id; });
function friend(id) {
  session("author");
  const request = sendBlastFriendRequest(id);
  session(id);
  acceptBlastFriendRequest(request.id);
  session("author");
}

test("Saved collections are private, persist names/membership, and unsaving clears membership", () => {
  const id = createSavedCollection("Trips", "original");
  assert.equal(listSavedCollections("original")[0].selected, true);
  assert.ok(api.db().posts[0].saves.includes("author"));
  renameSavedCollection(id, "Favorites");
  assert.equal(listSavedCollections()[0].name, "Favorites");
  assert.throws(() => createSavedCollection(" favorites "), /already used/);
  assert.throws(() => renameSavedCollection("unknown", "Other"), /unavailable/);
  session("stranger");
  assert.deepEqual(listSavedCollections(), []);
  assert.throws(() => toggleSavedCollection(id, "original"), /unavailable/);
  session("author");
  toggleSavedCollection(id, "original");
  assert.equal(listSavedCollections()[0].count, 0);
  toggleSavedCollection(id, "original");
  assert.equal(listSavedCollections()[0].count, 1);
  assert.equal(JSON.parse(localStorage.getItem("oldtime-v1")).users[0].savedCollections[0].name, "Favorites");
  setPostSaved("original", false);
  assert.equal(listSavedCollections()[0].count, 0);
  deleteSavedCollection(id);
  assert.deepEqual(listSavedCollections(), []);
});

test("new and legacy Blasts require accepted mutual Blast friendship; comments and reactions are gated", () => {
  friend("friend");
  friend("second");
  mutate(db => {
    db.users.find(user => user.id === "author").followers.push("stranger");
    db.users.find(user => user.id === "stranger").following.push("author");
  });
  sendBlastFriendRequest("stranger");
  const choices = listBlastShareFriends();
  assert.deepEqual(choices.map(user => user.id).sort(), ["friend", "second"]);
  const sheet = renderShareSheet({ post: original, friends: choices });
  assert.match(sheet, /data-share-copylink/);
  assert.match(sheet, /data-share-external/);
  assert.doesNotMatch(sheet, /data-share-friend\s+value=|value="stranger"|value="friend"/);
  const shared = createBlastPost({ sharedPostId: "original", recipientIds: ["friend"], initialComment: "Look at this" });
  assert.equal(shared.audience, "friends");
  assert.equal(shared.sharedPostId, "original");
  assert.equal(shared.media, null, "sharing references the source, not a copied media file");
  assert.equal(shared.replies[0].body, "Look at this");
  assert.ok(getBlastPost(shared.id, "friend"));
  assert.equal(getBlastPost(shared.id, "second"), null, "unselected friends cannot view direct shares");
  session("stranger");
  assert.equal(getBlastPost(shared.id), null);
  assert.deepEqual(listBlastPosts(), []);
  assert.throws(() => addBlastReply(shared.id, "Unauthorized"), /available/);
  assert.throws(() => toggleBlastReaction(shared.id), /available/);
  session("author");
  const publicInput = createBlastPost({ audience: "public", body: "Legacy public input" });
  assert.equal(publicInput.audience, "friends");
  assert.ok(getBlastPost(publicInput.id, "friend"));
  assert.equal(getBlastPost(publicInput.id, "stranger"), null);
  const privateBlast = createBlastPost({ body: "Just me", audience: "only-me" });
  assert.ok(getBlastPost(privateBlast.id, "author"));
  assert.equal(getBlastPost(privateBlast.id, "friend"), null);
  const key = "oldtime-blast-v1";
  localStorage.setItem(key, JSON.stringify({
    version: 1,
    friendships: [{ users: ["author", "friend"] }, { users: ["author", "second"] }],
    friendRequests: [],
    posts: [{ ...publicInput, id: "legacy-public", audience: "public" }],
    preferences: {},
    communityMemberships: []
  }));
  assert.equal(getBlastPost("legacy-public", "stranger"), null);
  assert.ok(getBlastPost("legacy-public", "friend"));
  const group = createBlastPost({ body: "Group private", audience: "group", groupId: "group" });
  assert.ok(getBlastPost(group.id, "friend"));
  assert.equal(getBlastPost(group.id, "stranger"), null, "group membership alone is insufficient");
  session("friend");
  addBlastReply(shared.id, "Friend comment");
  session("author");
  removeBlastFriend("friend");
  assert.equal(getBlastPost(shared.id, "friend"), null);
  session("friend");
  assert.throws(() => addBlastReply(shared.id, "After removal"), /available/);
  session("author");
});

test("Saved collections support online feed references without copying the original content", () => {
  const oldCloudPost = api.cloudPost;
  const oldCloudPosts = api.cloudPosts;
  let online = { id: "online-original", author: "author", kind: "text", caption: "Online post", visibility: "public", saves: [], media: [], created: Date.now() };
  api.cloudPost = id => online?.id === id ? online : null;
  api.cloudPosts = () => online ? [online] : [];
  try {
    session("author");
    const id = createSavedCollection("Online", "online-original");
    assert.equal(listSavedCollections("online-original").find(item => item.id === id).selected, true);
    assert.equal(listSavedPosts()[0].id, "online-original");
    assert.ok(api.me().savedPostIds.includes("online-original"));
    assert.equal(api.db().posts.find(post => post.id === "online-original"), undefined);
    online = { ...online, saves: [] };
    assert.equal(listSavedCollections()[0].count, 1, "refreshing the online object keeps the saved reference");
    const blast = createBlastPost({ sharedPostId: "online-original" });
    assert.ok(getBlastPost(blast.id));
    setPostSaved("online-original", false);
    assert.equal(listSavedCollections()[0].count, 0);
    online = null;
    assert.equal(getBlastPost(blast.id), null);
  } finally {
    api.cloudPost = oldCloudPost;
    api.cloudPosts = oldCloudPosts;
  }
});

test("source privacy, blocks, and deletion cannot be bypassed by sharing to Blast", () => {
  friend("friend");
  const post = createBlastPost({ sharedPostId: "original" });
  mutate(db => { db.posts[0].visibility = "only-me"; });
  assert.ok(getBlastPost(post.id, "author"));
  assert.equal(getBlastPost(post.id, "friend"), null);
  session("friend");
  assert.throws(() => createBlastPost({ sharedPostId: "original" }), /unavailable/);
  assert.throws(() => addBlastReply(post.id, "Private source"), /available/);
  session("author");
  mutate(db => { db.posts[0].visibility = "public"; db.blocks.push({ by: "author", who: "friend" }); });
  assert.equal(getBlastPost(post.id, "friend"), null);
  mutate(db => { db.blocks = []; db.posts = []; });
  assert.equal(getBlastPost(post.id), null);
  assert.equal(getBlastPost(post.id, "friend"), null);
});

test("legacy public video notes and their comments also require Blast friendship", () => {
  localStorage.setItem("oldtime-blast-video-notes-v1", JSON.stringify({
    version: 1, chats: [], notes: [
      { id: "note", authorId: "author", channel: "feed", audience: "public", mediaType: "video", createdAt: Date.now(), comments: [] },
      { id: "group-note", authorId: "author", channel: "feed", audience: "group", groupId: "group", mediaType: "image", createdAt: Date.now(), comments: [] }
    ]
  }));
  assert.ok(getBlastVideoNote("note", "friend"));
  assert.ok(getBlastVideoNote("group-note", "friend"));
  assert.equal(getBlastVideoNote("note", "stranger"), null);
  assert.equal(getBlastVideoNote("group-note", "stranger"), null);
  session("stranger");
  assert.deepEqual(listBlastFeedVideoNotes(), []);
  assert.throws(() => addBlastVideoNoteComment("note", "Unauthorized"), /available/);
  session("author");
});
