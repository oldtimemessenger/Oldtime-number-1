import test from "node:test";
import assert from "node:assert/strict";
class Storage {
  values = new Map(); fail = false;
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { if (this.fail) throw new Error("Full"); this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
globalThis.localStorage = new Storage(); globalThis.sessionStorage = new Storage();
globalThis.window = { addEventListener() {}, dispatchEvent() {} };
localStorage.setItem("oldtime-v1", JSON.stringify({ session: "me", users: [{ id: "me", username: "me" }] }));
const { api, mutate } = await import("./store.js");
const { commentSource, resolveCommentSource, validateProjectAudience, publishCreativeProject } = await import("./creative-content.js");
const { createProject, ProjectHistory } = await import("./creative-project.js");
const { bindCreativeTools } = await import("./creative-editor-tools.js");
function seed() {
  mutate(db => {
    db.session = "me";
    db.users = ["me", "author", "commenter", "outsider", "friend"].map(id => ({
      id, username: id, name: id, avatar: "", private: false,
      followers: id === "author" ? ["me"] : [], following: [], closeFriends: [],
      friends: id === "me" ? ["author", "friend"] : ["author", "friend"].includes(id) ? ["me"] : []
    }));
    db.posts = [{ id: "original", author: "author", caption: "Original", media: [], kind: "text", visibility: "public",
      comments: [{ id: "comment", author: "commenter", body: "Never persist this original text", likes: ["friend"],
        replies: [{ id: "reply", author: "friend", body: "Reply context" }] }], created: Date.now() }];
    db.stories = []; db.notes = []; db.blocks = [];
  });
  return createProject(commentSource("original", "comment"));
}
function derivative(project, visibility = "public") { return { id: "remix", author: "me", visibility, creativeProject: project }; }
test("aspect selection survives finishing inline typing and inspector refresh",()=>{
  const project=createProject(),controls=new Map(),q=id=>{
    if(!controls.has(id))controls.set(id,{value:"",setAttribute(){}});
    return controls.get(id);
  };
  let tools;
  tools=bindCreativeTools({root:{querySelectorAll:()=>[],addEventListener(){}},q,project,layer:()=>null,history:new ProjectHistory(project),
    inline:{finish:()=>tools.refresh()},add(){},changed:()=>tools.refresh(),seek(){},setSelected(){}});
  for(const ratio of ["1:1","4:5","16:9","9:16"]){q("aspect").value=ratio;q("aspect").onchange();assert.equal(project.aspect,ratio);assert.equal(q("aspect").value,ratio);}
});
test("a restricted source on another gallery page prevents public publication",async()=>{
  const restricted=seed();mutate(db=>{db.posts[0].visibility="followers";});
  const project=createProject();project.pages=[createProject(),restricted];
  await assert.rejects(()=>publishCreativeProject(project,new Map(),{destination:"post",visibility:"public",ownerId:"me"}));
  assert.equal(api.db().posts.length,1);
});
test("published remix retains live native layers and notifies both commenter and original creator", async () => {
  const project = seed();
  const item = await publishCreativeProject(project, new Map(), { destination: "post", visibility: "public", caption: "Watch this", ownerId: "me" });
  assert.equal(api.post(item.id), item); assert.ok(item.creativeProject.layers.length);
  assert.ok(!JSON.stringify(item).includes("Never persist"));
  assert.deepEqual(item.sourceComment, { post: "original", comment: "comment" });
  assert.deepEqual(new Set(api.db().notes.map(note => note.user)), new Set(["commenter", "author"]));
  assert.ok(api.db().notes.every(note => note.post === item.id));
});
test("story publication uses the exact same layer model with retained source and notification", async () => {
  const project = seed();
  const item = await publishCreativeProject(project, new Map(), { destination: "story", visibility: "public", caption: "Story", ownerId: "me" });
  assert.ok(api.db().stories.includes(item)); assert.equal(api.canSeeStory(item), true);
  assert.ok(api.db().notes.every(note => note.story === item.id));
});
test("Hey Word story responses keep the prompt chain and credit the public starter", async () => {
  const project = seed();
  const item = await publishCreativeProject(project, new Map(), {
    destination: "story", visibility: "public", ownerId: "me",
    heyWord: { promptId: "hw-chain", prompt: "Show the moment you felt proud", startedBy: "author", startedByName: "Author", startedByHandle: "author", sourceStoryId: "story-root", responseTo: "story-root" }
  });
  assert.deepEqual(item.heyWord, {
    promptId: "hw-chain", prompt: "Show the moment you felt proud", startedBy: "author",
    startedByName: "Author", startedByHandle: "author", sourceStoryId: "story-root", responseTo: "story-root"
  });
  assert.ok(api.db().notes.some(note => note.kind === "hey-word" && note.user === "author" && note.story === item.id));
});
test("Hey Word responses to restricted stories omit starter attribution and notifications", async () => {
  const project = seed();
  const item = await publishCreativeProject(project, new Map(), {
    destination: "story", visibility: "public", ownerId: "me",
    heyWord: { promptId: "hw-private", prompt: "Share your favorite place", startedBy: "author", startedByHandle: "author", sourceStoryId: "private-story", responseTo: "private-story", creditHidden: true }
  });
  assert.equal(item.heyWord.creditHidden, true);
  assert.equal(item.heyWord.startedBy, undefined);
  assert.equal(item.heyWord.startedByHandle, undefined);
  assert.ok(!api.db().notes.some(note => note.kind === "hey-word"));
});
test("private source cannot be republished publicly even by a permitted follower", () => {
  const project = seed(); mutate(db => { db.users.find(user => user.id === "author").private = true; });
  assert.ok(resolveCommentSource(project.layers[0].source));
  assert.throws(() => validateProjectAudience(project, "public"), /restricted/);
  assert.equal(api.canSeePost(derivative(project), "outsider"), false);
});
test("friends-only source cannot reach remixer friends who lack original access", () => {
  const project = seed(); mutate(db => { db.posts[0].visibility = "friends"; });
  assert.throws(() => validateProjectAudience(project, "friends"), /smaller audience/);
  assert.equal(api.canSeePost(derivative(project), "friend"), false);
});
test("Close Friends source disappears after regular friendship is revoked", () => {
  const project = seed(); mutate(db => { db.posts[0].visibility = "close-friends"; db.users.find(user => user.id === "author").closeFriends = ["me"]; });
  assert.equal(api.canSeePost(derivative(project)), true);
  mutate(db => { db.users.find(user => user.id === "me").friends = []; });
  assert.equal(api.canSeePost(derivative(project)), false);
});
test("blocked commenter, unavailable community and deleted source all fail closed", () => {
  let project = seed(); mutate(db => { db.blocks.push({ by: "commenter", who: "me" }); });
  assert.equal(api.canSeePost(derivative(project)), false);
  project = seed(); mutate(db => { db.posts[0].visibility = "community"; });
  assert.equal(api.canSeePost(derivative(project)), false);
  project = seed(); mutate(db => { db.posts = []; });
  assert.equal(api.canSeePost(derivative(project)), false);
});
test("deleted original comment revokes posts and stories, including legacy copied comment stories", () => {
  const project = seed(), story = derivative(project);
  assert.equal(api.canSeeStory(story), true);
  mutate(db => { db.posts[0].comments = []; });
  assert.equal(api.canSeePost(derivative(project)), false); assert.equal(api.canSeeStory(story), false);
  assert.equal(api.canSeeStory({ id: "legacy", author: "me", visibility: "public", sourceComment: { post: "original", comment: "comment" } }), false);
});
test("reply comments preserve parent context, and forged comment author metadata is rejected", () => {
  const project = seed(), source = commentSource("original", "reply");
  assert.equal(resolveCommentSource(source).replyTo, "Reply to @commenter");
  source.commentAuthorId = "me"; project.layers[0].source = source;
  assert.equal(resolveCommentSource(source), null); assert.equal(api.canSeePost(derivative(project)), false);
});
test("storage failure and ended editing session do not publish or send notifications", async () => {
  const project = seed(); localStorage.fail = true;
  await assert.rejects(publishCreativeProject(project, new Map(), { destination: "post", visibility: "public", ownerId: "me" }), /storage|space|Full|save/i);
  localStorage.fail = false;
  assert.equal(api.db().posts.length, 1); assert.equal(api.db().notes.length, 0);
  await assert.rejects(publishCreativeProject(project, new Map(), { destination: "post", visibility: "public", ownerId: "me", active: () => false }), /session/);
});
