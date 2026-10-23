import assert from "node:assert/strict";
import test from "node:test";
import {
  isCommunitySurfacePost,
  isFeedHomePost,
  isProfileSurfacePost,
} from "./post-surfaces.js";

test("community-only posts stay in Community and out of Home and Profile", () => {
  const note = { destination: "community", kind: "photo", media: ["https://cdn.example/photo.jpg"] };

  assert.equal(isFeedHomePost(note), false);
  assert.equal(isCommunitySurfacePost(note), true);
  assert.equal(isProfileSurfacePost(note), false);
});

test("posts shared to both surfaces remain on Home, Community, and Profile", () => {
  const shared = { destination: "both", kind: "photo", media: ["https://cdn.example/photo.jpg"] };

  assert.equal(isFeedHomePost(shared), true);
  assert.equal(isCommunitySurfacePost(shared), true);
  assert.equal(isProfileSurfacePost(shared), true);
});

test("main-only posts do not enter Community, and Home remains media-only", () => {
  const photo = { destination: "main", kind: "photo", media: ["https://cdn.example/photo.jpg"] };
  const text = { destination: "main", kind: "text", media: [] };

  assert.equal(isFeedHomePost(photo), true);
  assert.equal(isCommunitySurfacePost(photo), false);
  assert.equal(isProfileSurfacePost(photo), true);
  assert.equal(isFeedHomePost(text), false);
  assert.equal(isProfileSurfacePost(text), true);
});
