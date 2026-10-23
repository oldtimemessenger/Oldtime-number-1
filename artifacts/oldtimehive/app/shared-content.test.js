import test from "node:test";
import assert from "node:assert/strict";

class Storage {
  values = new Map();
  fail = false;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { if (this.fail) throw new Error("Full"); this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
globalThis.localStorage = new Storage();
globalThis.sessionStorage = new Storage();
globalThis.window = { addEventListener() {}, dispatchEvent() {} };
localStorage.setItem("oldtime-v1", JSON.stringify({ session: "sender", users: [{ id: "sender", username: "sender" }] }));
const { api, mutate } = await import("./store.js");
const { findSharedComment, listRegularShareFriends, sendPostToFriends, renderSharedMessage } = await import("./shared-content.js");
const { renderShareSheet } = await import("./saved-sheets.js");
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

function seed() {
  mutate(db => {
    db.session = "sender";
    db.users = ["sender", "friend", "second", "pending", "blocked", "author"].map(id => ({
      id, username: id, name: id, followers: id === "author" ? ["sender"] : [], following: [], closeFriends: [],
      friends: id === "sender" ? ["friend", "second", "blocked"] : ["friend", "second", "blocked", "pending"].includes(id) ? ["sender"] : [],
      private: false
    }));
    db.posts = [{
      id: "post", author: "author", visibility: "public", caption: "<private-safe>", media: ["https://example.test/post.jpg"],
      comments: [{ id: "comment", author: "second", body: "A <great> comment", replies: [{ id: "reply", author: "friend", body: "Reply" }] }]
    }];
    db.convos = [];
    db.blocks = [{ by: "blocked", who: "sender" }];
    db.notes = [];
  });
}

test("share picker combines confirmed Friends and direct contacts without showing pending or blocked accounts", () => {
  seed();
  mutate(db => {
    db.users.push({ id: "contact", username: "contact", name: "Contact", followers: [], following: [], friends: [], closeFriends: [], private: false });
    db.convos.push({ id: "contact-chat", members: ["sender", "contact"], messages: [], draft: "" });
  });
  assert.deepEqual(listRegularShareFriends("post").map(friend => friend.id).sort(), ["contact", "friend", "second"]);
  mutate(db => { db.posts[0].visibility = "followers"; });
  assert.ok(listRegularShareFriends("post").every(friend => friend.unavailable));
});

test("an existing one-to-one contact can receive a source-linked post message", () => {
  seed();
  mutate(db => {
    db.users.push({ id: "contact", username: "contact", name: "Contact", followers: [], following: [], friends: [], closeFriends: [], private: false });
    db.convos.push({ id: "contact-chat", members: ["sender", "contact"], messages: [], draft: "Existing draft" });
  });
  assert.deepEqual(sendPostToFriends("post", ["contact"]), ["contact-chat"]);
  const chat = api.db().convos.find(item => item.id === "contact-chat");
  assert.equal(chat.messages[0].sharedPostId, "post");
  assert.equal(chat.messages[0].media, undefined);
  assert.equal(chat.draft, "Existing draft");
});

test("one multi-recipient send persists separate DMs and a live source reference, with no copied private content", () => {
  seed();
  const ids = sendPostToFriends("post", ["friend", "second", "friend"], { commentId: "comment", message: "Look here" });
  assert.equal(ids.length, 2);
  assert.equal(api.db().convos.length, 2);
  for (const chat of api.db().convos) {
    assert.equal(chat.members.length, 2);
    assert.equal(chat.messages.length, 1);
    assert.equal(chat.messages[0].kind, "shared-post");
    assert.equal(chat.messages[0].sharedPostId, "post");
    assert.equal(chat.messages[0].sharedCommentId, "comment");
    assert.equal(chat.messages[0].body, "Look here");
    assert.equal(chat.messages[0].status, "sent");
    assert.equal(chat.messages[0].media, undefined);
    assert.equal(chat.messages[0].caption, undefined);
  }
  const persisted = JSON.parse(localStorage.getItem("oldtime-v1"));
  assert.equal(persisted.convos.length, 2);
  assert.equal(persisted.notes.length, 2);
});

test("cloud sharing creates server-backed chats and sends only source references", async () => {
  seed();
  const originals = {
    authMode: api.authMode,
    refreshCloudChats: api.refreshCloudChats,
    ensureCloudChat: api.ensureCloudChat,
    sendCloudChatMessage: api.sendCloudChatMessage
  };
  const sent = [];
  api.authMode = () => "cloud";
  api.refreshCloudChats = async () => {};
  api.ensureCloudChat = async chat => chat;
  api.sendCloudChatMessage = async (conversationId, message) => {
    sent.push({ conversationId, message });
    return { id: message.id };
  };
  try {
    const result = await sendPostToFriends("post", ["friend"], { commentId: "comment", message: "Look here" });
    assert.equal(result.sentCount, 1);
    assert.deepEqual(result.failedRecipientIds, []);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].message.kind, "shared-post");
    assert.equal(sent[0].message.sharedPostId, "post");
    assert.equal(sent[0].message.sharedCommentId, "comment");
    assert.equal(sent[0].message.body, "Look here");
    assert.equal(sent[0].message.media, undefined);
    assert.equal(sent[0].message.caption, undefined);
    const chat = api.db().convos.find(item => item.id === sent[0].conversationId);
    assert.ok(chat);
    assert.equal(chat.messages[0].cloudSynced, true);
  } finally {
    Object.assign(api, originals);
  }
});

test("existing chats retain drafts and disappearing-message timers", () => {
  seed();
  mutate(db => db.convos.push({ id: "existing", members: ["sender", "friend"], messages: [], draft: "Unsent draft", disappear: "10 seconds" }));
  assert.deepEqual(sendPostToFriends("post", ["friend"]), ["existing"]);
  const chat = api.db().convos[0];
  assert.equal(chat.draft, "Unsent draft");
  assert.equal(chat.messages[0].expiresAt - chat.messages[0].created, 10000);
});

test("recipient, source, comment and storage failures leave no partial sends", () => {
  seed();
  for (const recipients of [[], ["pending"], ["blocked"], ["sender"], ["friend", "missing"]]) {
    assert.throws(() => sendPostToFriends("post", recipients));
    assert.equal(api.db().convos.length, 0);
  }
  assert.throws(() => sendPostToFriends("post", ["friend"], { commentId: "deleted" }), /Comment unavailable/);
  mutate(db => { db.posts[0].visibility = "followers"; });
  assert.throws(() => sendPostToFriends("post", ["friend"]), /cannot view/);
  assert.equal(api.db().convos.length, 0);
  mutate(db => { db.posts[0].visibility = "public"; });
  localStorage.fail = true;
  try { assert.throws(() => sendPostToFriends("post", ["friend", "second"]), /storage/); }
  finally { localStorage.fail = false; }
  assert.equal(api.db().convos.length, 0);
  assert.equal(api.db().notes.length, 0);
});

test("chat cards recheck current viewer permissions and deleted comments rather than exposing snapshots", () => {
  seed();
  const id = sendPostToFriends("post", ["friend"], { commentId: "comment" })[0];
  const message = api.db().convos.find(chat => chat.id === id).messages[0];
  mutate(db => { db.session = "friend"; });
  let card = renderSharedMessage(message, esc);
  assert.match(card, /data-chat-shared-comment="comment"/);
  assert.match(card, /A &lt;great&gt; comment/);
  assert.doesNotMatch(card, /A <great> comment/);
  mutate(db => { db.posts[0].visibility = "followers"; });
  assert.match(renderSharedMessage(message, esc), /Post unavailable/);
  assert.doesNotMatch(renderSharedMessage(message, esc), /great|post\.jpg/);
  mutate(db => { db.posts[0].visibility = "public"; db.posts[0].comments = []; });
  assert.match(renderSharedMessage(message, esc), /Comment unavailable/);
  mutate(db => { db.posts = []; });
  assert.match(renderSharedMessage(message, esc), /Post unavailable/);
});

test("comments and replies are identified without changing the original post", () => {
  seed();
  assert.equal(findSharedComment(api.post("post"), "reply").body, "Reply");
  assert.equal(findSharedComment(api.post("post"), "missing"), null);
});

test("share UI exposes Repost, Save, Status, Friends, copy and native sharing actions", () => {
  const html = renderShareSheet({
    post: { id: "post", cloud: true },
    comment: { id: "comment", authorName: "@author", body: "<script>attack</script>" }
  });
  for (const hook of [
    "data-share-repost", "data-share-save", "data-share-story", "data-share-friends",
    "data-share-copylink", "data-share-external", "Repost", "Save", "Share to Status",
    "Send to Friends", "Copy link", "Share with an app"
  ]) assert.ok(html.includes(hook));
  for (const removed of ["data-share-search", "data-share-friend value=", "data-share-submit", "data-share-whatsapp"]) assert.ok(!html.includes(removed));
  assert.match(html, /&lt;script&gt;attack&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("people picker only enables selected, viewable Friends and contacts", () => {
  const html = renderShareSheet({
    post: { id: "post" },
    friendsMode: true,
    friends: [
      { id: "friend", username: "friend", name: "Friend", avatar: "", unavailable: false },
      { id: "restricted", username: "restricted", name: "Restricted", unavailable: true }
    ]
  });
  assert.match(html, /data-share-search/);
  assert.match(html, /value="friend"/);
  assert.match(html, /value="restricted"[^>]*disabled/);
  assert.match(html, /data-share-submit disabled/);
  assert.match(html, /Friends or contacts who can view this post/);
  assert.match(html, /Add a message \(optional\)/);
});
