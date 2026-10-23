import test from "node:test";
import assert from "node:assert/strict";
import { sportsPostSourceId } from "../src/lib/sports-posts";

test("image and video shares do not replace one another, while retries stay idempotent", () => {
  assert.notEqual(sportsPostSourceId("workout", "image"), sportsPostSourceId("workout", "video"));
  assert.equal(sportsPostSourceId("workout", "video"), sportsPostSourceId("workout", "video"));
  assert.notEqual(sportsPostSourceId("workout"), "sports:workout", "Do not overwrite legacy media posts with summary shares");
});
