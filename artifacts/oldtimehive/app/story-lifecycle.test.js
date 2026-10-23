import test from "node:test";
import assert from "node:assert/strict";
import { STORY_LIFETIME_MS, isStoryActive } from "./story-lifecycle.js";

test("stories expire exactly 24 hours after creation unless kept on profile", () => {
  const now = 200_000_000;
  const story = { created: now - STORY_LIFETIME_MS + 1 };
  assert.equal(isStoryActive(story, now), true);
  assert.equal(isStoryActive({ ...story, created: now - STORY_LIFETIME_MS }, now), false);
  assert.equal(isStoryActive({ ...story, savedToProfile: true }, now), true);
});

test("stories with invalid or future creation times are not shown", () => {
  assert.equal(isStoryActive({ created: Number.NaN }, 10_000), false);
  assert.equal(isStoryActive({ created: 10_001 }, 10_000), false);
  assert.equal(isStoryActive({}, 10_000), false);
});
