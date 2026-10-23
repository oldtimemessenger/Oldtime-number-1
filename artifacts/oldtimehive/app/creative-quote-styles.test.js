import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QUOTE_STYLES, contrastRatio, applyQuoteStyle, applyReadableType } from "./creative-quote-styles.js";
import { createProject, createLayer, ProjectHistory } from "./creative-project.js";
const read = name => readFileSync(new URL(name, import.meta.url), "utf8");

test("every quote style has at least AAA-grade 7:1 text contrast", () => {
  assert.ok(QUOTE_STYLES.length >= 5 && QUOTE_STYLES.length <= 6);
  for (const s of QUOTE_STYLES) assert.ok(contrastRatio(s.background, s.color) >= 7, `${s.id} ${contrastRatio(s.background, s.color).toFixed(2)}`);
});
test("styles keep written text, survive structuredClone and undo/redo", () => {
  const project = createProject(), layer = createLayer("text", { text: "Stay close to what feels like home." });
  project.layers.push(layer); const history = new ProjectHistory(project);
  history.record(); applyQuoteStyle(project, layer, "oxblood");
  assert.equal(layer.text, "Stay close to what feels like home."); assert.equal(project.background.color, "#4a0f16");
  assert.equal(structuredClone(project).layers[0].quoteStyle, "oxblood");
  history.undo(); assert.equal(project.layers[0].text, layer.text); assert.equal(project.background.color, "#f2f3f5");
  history.redo(); assert.equal(project.layers[0].color, "#f6e9dc");
});
test("styles never replace photo backgrounds; readable type works on them", () => {
  const project = createProject(); project.background = { kind: "photo", media: "blob:x", color: "#fff" };
  const layer = createLayer("text", { text: "Mine" }); applyQuoteStyle(project, layer, "ink");
  assert.equal(project.background.media, "blob:x"); assert.equal(layer.text, "Mine");
  assert.ok(applyReadableType(layer) && layer.backgroundOn && layer.text === "Mine");
  assert.equal(applyReadableType({ kind: "text", locked: true }), false);
});
test("legacy Quote drafts cannot reopen the disabled creation mode", () => {
  const src = read("creative-editor.js");
  assert.doesNotMatch(src, /classList\.add\(["']is-quote["']\)|startQuote|onQuote/);
});
test("Camera lands first on fresh creation; Studio never shows capture controls", () => {
  const src = read("creative-editor.js"), css = read("creative-overlay.css"), view = read("creative-editor-view.js");
  assert.match(src, /import \{ shouldAutoStartCamera \} from "\.\/creative-editor-startup\.js"/);
  assert.match(src, /if\(shouldAutoStartCamera\(\{/);
  assert.match(css, /\.creative-editor\.is-studio \.ce-camera-bar[^{]*\{[^}]*display: none !important/);
  assert.doesNotMatch(view, /Start with a photo/);
  assert.doesNotMatch(src, /Your media and edits are still here/);
  assert.doesNotMatch(read("creative-studio.js"), /Your media and edits are still here/);
});
