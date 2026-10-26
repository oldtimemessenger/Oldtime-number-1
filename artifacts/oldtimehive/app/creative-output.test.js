import assert from "node:assert/strict";
import { test } from "node:test";
import { matchingOriginal, projectOutputKind } from "./creative-output.js";

test("a photo stays a photo when its layers contain animations or decoded image frames", () => {
  const photo = {
    background: { kind: "photo", media: "photo" },
    layers: [{ kind: "image", media: "animated-gif" }, { kind: "text", animation: "fade" }],
    duration: 5,
  };
  const assets = { get: key => key === "animated-gif" ? { frames: [{ end: 40 }] } : null };
  assert.equal(projectOutputKind(photo, assets), "photo");
});

test("a photo with an added sound is exported as video so the music is preserved", () => {
  const photo = { background: { kind: "photo", media: "photo" }, layers: [], audioTracks: [{ media: "sound" }] };
  assert.equal(projectOutputKind(photo, { get: () => null }), "video");
});

test("video format is explicit; legacy projects infer only from actual video sources", () => {
  const video = { background: { kind: "video", media: "clip" }, layers: [] };
  assert.equal(projectOutputKind(video, { get: () => null }), "video");
  assert.equal(projectOutputKind({ ...video, outputKind: "photo" }, { get: () => null }), "photo");
  assert.equal(projectOutputKind({ background: { kind: "photo" }, layers: [{ kind: "video" }] }), "video");
  assert.equal(projectOutputKind({ background: { kind: "photo" }, layers: [] }, { get: () => null }), "photo");
});

test("preserving an original is format-specific, so photo sources cannot bypass video export", () => {
  const photo = new Blob(["image"], { type: "image/jpeg" });
  const video = new Blob(["video"], { type: "video/webm" });
  assert.equal(matchingOriginal(photo, "photo"), photo);
  assert.equal(matchingOriginal(photo, "video"), null);
  assert.equal(matchingOriginal(video, "photo"), null);
  assert.equal(matchingOriginal(video, "video"), video);
});
