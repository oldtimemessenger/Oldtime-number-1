import test from "node:test";
import assert from "node:assert/strict";
import { drawSticker } from "./creative-stickers.js";
import { renderCreativeEditor } from "./creative-editor-view.js";

function mockContext() {
  const calls = [];
  const ctx = new Proxy({
    measureText: text => ({ width: String(text).length * 16 }),
    fill: () => calls.push("fill"),
    stroke: () => calls.push("stroke"),
    fillText: () => calls.push("fillText")
  }, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === "string") return (...args) => calls.push(key);
      return undefined;
    },
    set(target, key, value) { target[key] = value; return true; }
  });
  return { ctx, calls };
}

test("each available sticker draws a real, measurable canvas layer", () => {
  const kinds = ["heart", "arrow", "circle", "rectangle", "star", "reaction", "location",
    "mention", "hashtag", "music", "question", "poll", "hey-word", "emoji", "custom-text"];
  for (const sticker of kinds) {
    const { ctx, calls } = mockContext();
    const bounds = drawSticker(ctx, { sticker, text: "A short prompt", choices: ["Yes", "No"] });
    assert.ok(bounds.width > 0 && bounds.height > 0, `${sticker} has bounds`);
    assert.ok(calls.includes("fill") || calls.includes("stroke") || calls.includes("fillText"), `${sticker} draws visible artwork`);
  }
});

test("story and community stickers share one swipeable in-editor picker", () => {
  const html = renderCreativeEditor({ destination: "story" });
  for (const id of ["ce-sticker-flow", "ce-sticker-library", "ce-sticker-config-page",
    "ce-sticker-back", "ce-sticker-add", "ce-sticker-search", "ce-sticker-categories"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const kind of ["poll", "question", "hey-word", "location", "mention", "hashtag", "music", "heart", "arrow", "emoji", "custom-text"]) {
    assert.match(html, new RegExp(`data-ce-sticker="${kind}"`));
  }
  for(const id of ["ce-sticker-edit-fields","ce-sticker-edit-text","ce-sticker-edit-choice-a","ce-sticker-edit-choice-b","ce-sticker-edit-accent","ce-sticker-edit-surface"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /data-ce-story-only/);
  assert.doesNotMatch(html, /id="ce-hey-word-controls" class="ce-group" hidden>\s*<label class="ce-check".*Oldtime story prompt/);
});
