import { test } from "node:test";
import assert from "node:assert/strict";
import { boardInput, acceptsEntry, canReadBoard } from "./participation-policy";
test("collections default to invite-only and reject unsupported privacy promises", () => {
  assert.equal(boardInput.parse({ prompt: "Your morning view" }).visibility, "invite_only");
  assert.equal(boardInput.safeParse({ prompt: "Test", visibility: "friends" }).success, false);
});
test("private links never grant access; blocking gates all non-owner eligibility", () => {
  const b = { creatorId: "owner", visibility: "invite_only" };
  assert.equal(canReadBoard(b, "guest", false), false);
  assert.equal(canReadBoard(b, "guest", true), true);
  assert.equal(canReadBoard(b, "guest", true, true), false);
  assert.equal(canReadBoard({ ...b, visibility: "private" }, "guest", true), false);
  assert.equal(canReadBoard({ ...b, visibility: "private" }, "owner", false), true);
});
test("entry formats are enforced, empty text never creates a phantom response", () => {
  assert.equal(acceptsEntry("video", "photo", "text"), false);
  assert.equal(acceptsEntry("mixed", "text", " "), false);
  assert.equal(acceptsEntry("photo", "photo", ""), true);
});
