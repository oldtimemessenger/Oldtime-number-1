import { test } from "node:test";
import assert from "node:assert/strict";
import * as storyInteractions from "./story-interactions.js";
test("Story replies and saves do not expose local-only persistence helpers", () => {
  assert.equal(storyInteractions.saveStoryComment, undefined);
  assert.equal(storyInteractions.setStoryComments, undefined);
  assert.equal(storyInteractions.setStorySaved, undefined);
});
