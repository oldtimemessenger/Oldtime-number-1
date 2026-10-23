import test from "node:test";
import assert from "node:assert/strict";
import { creativeRecoveryContext, creativeRecoverySignature } from "./creative-drafts.js";

function draft(reference, contents = "original") {
  return { version: 1, project: { background: { media: reference }, layers: [] },
    state: { selectedId: null }, savedAt: 1234,
    media: [[reference, new Blob([contents], { type: "image/png" })]] };
}
test("draft recovery identity uses original bytes and content, not temporary blob URLs", async () => {
  const first = draft("blob:before"), second = draft("oldtime-media:after");
  assert.equal(await creativeRecoverySignature(first), await creativeRecoverySignature(second));
  assert.equal(await creativeRecoveryContext("studio", first), await creativeRecoveryContext("studio", second));
  assert.notEqual(await creativeRecoveryContext("studio", first), await creativeRecoveryContext("camera", second));
});
test("different original media or edits cannot be mistaken for a confirmed recovery", async () => {
  const original = draft("blob:original"), changed = draft("blob:original", "modified");
  assert.notEqual(await creativeRecoverySignature(original), await creativeRecoverySignature(changed));
  const edited = structuredClone(original);
  edited.project.layers.push({ kind: "text", text: "different" });
  assert.notEqual(await creativeRecoveryContext("studio", original), await creativeRecoveryContext("studio", edited));
});
