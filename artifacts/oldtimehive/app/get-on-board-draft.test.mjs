import { test } from "node:test";
import assert from "node:assert/strict";
import { clearEntryDraft } from "./get-on-board-core.js";
test("a cancelled entry cannot carry media, caption or an upload ID into a new entry", () => {
  const state = { pv: null, pvType: "video", file: { name: "old.mp4" }, entryId: "old-upload", cmp: { caption: "Old caption" } };
  clearEntryDraft(state);
  assert.deepEqual(state, { pv: null, pvType: "", file: null, entryId: null, cmp: null });
});
