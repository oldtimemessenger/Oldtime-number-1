import test from "node:test";
import assert from "node:assert/strict";
import { mergeFeedPosts, followingPosts } from "./feed-posts.js";

test("cloud media stays visible in Following, including the owner's new upload", () => {
  const me = { id: "me", following: ["friend"] };
  const cloud = [{ id: "new", author: "me" }, { id: "friend-post", author: "friend" }, { id: "other", author: "other" }];
  assert.deepEqual(followingPosts(mergeFeedPosts([], cloud), me).map(post => post.id), ["new", "friend-post"]);
});
test("cloud records replace imported legacy versions without duplicates", () => {
  const cloud = [{ id: "new", sourceId: "legacy", author: "me" }];
  assert.deepEqual(mergeFeedPosts([{ id: "legacy" }, { id: "new" }, { id: "unmigrated" }], cloud),
    [{ id: "unmigrated" }, ...cloud]);
});
