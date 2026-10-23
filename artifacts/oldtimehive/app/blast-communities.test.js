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

const user = id => ({
  id, name: id, username: id, avatar: "/app/avatar.svg", private: false,
  followers: [], following: [], friends: [], closeFriends: []
});
localStorage.setItem("oldtime-v1", JSON.stringify({
  session: "author",
  users: ["author", "member", "stranger"].map(user),
  posts: [],
  convos: []
}));

const { mutate } = await import("./store.js");
const {
  createBlastPost, getBlastPost, joinBlastCommunity,
  leaveBlastCommunity, listBlastCommunities, listBlastCommunityPosts, listBlastPosts
} = await import("./blast-store.js");
const { resetBlastCloudState } = await import("./blast-cloud-state.js");
const switchUser = id => mutate(db => { db.session = id; });

test("Blast communities persist membership and keep community posts behind membership", () => {
  assert.equal(joinBlastCommunity("everyday-life"), true);
  assert.equal(joinBlastCommunity("everyday-life"), false, "joining twice does not duplicate membership");
  const post = createBlastPost({
    communityId: "everyday-life",
    audience: "friends",
    body: "A conversation for community members"
  });
  assert.equal(post.audience, "community", "community posts cannot accidentally inherit the friends audience");
  assert.deepEqual(listBlastCommunityPosts("everyday-life").map(item => item.id), [post.id]);
  assert.deepEqual(listBlastPosts().map(item => item.id), [post.id], "the unified Blast feed includes joined-community posts");

  switchUser("stranger");
  assert.equal(getBlastPost(post.id), null);
  assert.deepEqual(listBlastCommunityPosts("everyday-life"), []);
  assert.deepEqual(listBlastPosts(), [], "the unified feed excludes community posts from non-members");
  assert.equal(listBlastCommunities().find(item => item.id === "everyday-life").joined, false);
  assert.throws(() => createBlastPost({ communityId: "everyday-life", body: "Not joined" }), /Join this community/);

  joinBlastCommunity("everyday-life");
  assert.equal(getBlastPost(post.id)?.id, post.id, "a joined member can read a community post without Blast friendship");
  assert.deepEqual(listBlastPosts().map(item => item.id), [post.id], "joining adds the post to the unified feed");
  assert.equal(leaveBlastCommunity("everyday-life"), true);
  assert.equal(getBlastPost(post.id), null, "leaving revokes access to member-only posts");
  assert.deepEqual(listBlastPosts(), [], "leaving removes the post from the unified feed");
  assert.throws(() => joinBlastCommunity("not-a-community"), /not available/);

  switchUser("author");
  assert.equal(getBlastPost(post.id)?.id, post.id, "authors keep access to their own content");
  assert.equal(listBlastCommunities().find(item => item.id === "everyday-life").joined, true);
  assert.equal(localStorage.getItem("oldtime-blast-v1"), null, "new Blast changes are not written to device storage");
  resetBlastCloudState();
});
