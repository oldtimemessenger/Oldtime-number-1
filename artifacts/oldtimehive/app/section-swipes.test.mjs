import test from "node:test";
import assert from "node:assert/strict";
import { nextSection } from "./section-swipes.js";
test("horizontal home-view gestures use actual sections and preserve vertical/two-finger navigation", () => {
  const sections = ["explore", "following", "nearby"];
  assert.equal(nextSection("explore", -110, 8, 180, sections), "following");
  assert.equal(nextSection("following", 110, 8, 180, sections), "explore");
  assert.equal(nextSection("explore", 110, 8, 180, sections), null);
  assert.equal(nextSection("following", 20, 110, 180, sections), null);
  assert.equal(nextSection("following", -110, 8, 1600, sections), null);
});
