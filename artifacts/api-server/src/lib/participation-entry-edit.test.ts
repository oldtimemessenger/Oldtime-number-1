import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { entryUpdateInput, canUpdateEntry } from "./participation-policy";
describe("participation edit ownership", () => {
  it("lets the author change a caption and explicitly clear a place", () => {
    assert.deepEqual(entryUpdateInput.parse({ caption: " Updated ", place: null }), { caption: "Updated", place: null });
    assert.equal(canUpdateEntry({ caption: "Updated", place: null }, true, false), true);
  });
  it("does not let a board manager rewrite someone else's content", () => {
    assert.equal(canUpdateEntry({ caption: "Rewrite" }, false, true), false);
    assert.equal(canUpdateEntry({ place: null }, false, true), false);
  });
  it("keeps moderation separate from authorship", () => {
    assert.equal(canUpdateEntry({ pinned: true, removed: false }, false, true), true);
    assert.equal(canUpdateEntry({ pinned: true }, true, false), false);
    assert.equal(canUpdateEntry({ caption: "Mine", pinned: true }, true, true), true);
  });
  it("rejects empty edits, oversized captions and server-owned fields", () => {
    for (const input of [{}, { caption: "x".repeat(2001) }, { userId: "other" }, { boardId: "other" }]) {
      assert.equal(entryUpdateInput.safeParse(input).success, false);
    }
  });
});
