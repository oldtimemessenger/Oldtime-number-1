import assert from "node:assert/strict";
import test from "node:test";
import { resolveStoryMedia } from "./story-media.js";

test("keeps valid story media unchanged", () => {
  assert.equal(resolveStoryMedia({ media: "https://cdn.example.test/story.jpg" }), "https://cdn.example.test/story.jpg");
});

test("replaces the app fallback avatar used by a legacy shared story with the source post media", () => {
  const source = { media: ["https://cdn.example.test/original.jpg"] };
  assert.equal(
    resolveStoryMedia({ media: "/app/avatar.svg", sourcePost: "post-1" }, id => id === "post-1" ? source : null),
    source.media[0],
  );
});

test("does not render a fallback avatar or invent media when source media is absent", () => {
  assert.equal(resolveStoryMedia({ media: "/app/avatar.svg" }), "");
  assert.equal(resolveStoryMedia({ media: "/app/avatar.svg", sourcePost: "text-post" }, () => ({ media: [] })), "");
});
