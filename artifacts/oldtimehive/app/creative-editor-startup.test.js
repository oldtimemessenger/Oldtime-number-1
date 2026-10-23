import test from "node:test";
import assert from "node:assert/strict";
import { shouldAutoStartCamera } from "./creative-editor-startup.js";

test("an explicit camera launch is honored when a custom save handler is present", () => {
  assert.equal(shouldAutoStartCamera({ startCamera: true, hasSaveHandler: true }), true);
});

test("fresh creation keeps its automatic camera landing by default", () => {
  assert.equal(shouldAutoStartCamera(), true);
});

test("camera does not replace an existing source, project, or selected media", () => {
  assert.equal(shouldAutoStartCamera({ startCamera: true, hasSource: true }), false);
  assert.equal(shouldAutoStartCamera({ startCamera: true, hasInitialProject: true }), false);
  assert.equal(shouldAutoStartCamera({ startCamera: true, hasBackground: true }), false);
});

test("a custom save flow without an explicit camera request does not open the camera", () => {
  assert.equal(shouldAutoStartCamera({ hasSaveHandler: true }), false);
});

test("opening Oldtime Studio does not auto-launch the camera", () => {
  assert.equal(shouldAutoStartCamera({ startStudio: true }), false);
  assert.equal(shouldAutoStartCamera({ startStudio: true, startCamera: true }), false);
});
