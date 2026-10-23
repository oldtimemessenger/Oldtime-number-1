import test from "node:test";
import assert from "node:assert/strict";
import { getRepostView } from "./repost-state.js";

test("online repost state is taken from the server response, not the local cache", () => {
  const serverPost = {
    id: "online",
    cloud: true,
    repostedByMe: true,
    repostCount: 4,
    repostNote: "Server note",
    reposts: ["me"],
    repostNotes: { me: "Server note" },
  };
  const db = { localRepostsByPost: { online: { me: { note: "Stale device note" }, peer: { note: "Device-only repost" } } } };
  const view = getRepostView(serverPost, db);
  assert.equal(view.repostCount, 4);
  assert.equal(view.repostedByMe, true);
  assert.deepEqual(view.reposts, ["me"]);
  assert.deepEqual(view.repostNotes, { me: "Server note" });
});

test("a local cache entry is never merged into an online post", () => {
  const serverPost = { id: "online", cloud: true, repostCount: 0, repostedByMe: false, reposts: [], repostNotes: {} };
  const view = getRepostView(serverPost, { localRepostsByPost: { online: { me: { note: "Not synced" } } } });
  assert.equal(view.repostCount, 0);
  assert.deepEqual(view.reposts, []);
  assert.deepEqual(view.repostNotes, {});
});

test("missing posts remain unavailable instead of creating a local repost", () => {
  assert.equal(getRepostView(null, {}), null);
});
