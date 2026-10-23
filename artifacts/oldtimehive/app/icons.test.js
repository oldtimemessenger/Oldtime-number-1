import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { icon, iconPaths } from "./icons.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const source = name => readFileSync(path.join(dir, name), "utf8");

test("the shared overflow icon is three vertically stacked dots", () => {
  const circles = [...iconPaths.more.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"\/>/g)]
    .map(([, x, y]) => [Number(x), Number(y)]);
  assert.deepEqual(circles, [[12, 5], [12, 12], [12, 19]]);
  assert.equal((icon("more").match(/<circle\b/g) || []).length, 3);
});

test("studio, sports, story and shared app menus use the same vertical overflow glyph", () => {
  assert.match(source("creative-editor-view.js"), /more:\s*svg\(iconPaths\.more\)/);
  assert.match(source("sports-mode.js"), /more:\s*iconPaths\.more/);
  assert.match(source("story-interactions.js"), /icon\("more"\)/);
  assert.match(source("app.js"), /aria-label="Comment actions">\$\{ic\.more\}/);
  assert.match(source("app.js"), /aria-label="More profile actions"[^>]*>\$\{ic\.more\}/);
});

test("comment controls use a heart for Like and a downward thumb for Dislike", () => {
  const app = source("app.js");
  assert.match(app, /data-clike="\$\{esc\(comment\.id\)\}"[^>]*>\$\{ic\.heart\}/);
  assert.match(app, /data-cdislike="\$\{esc\(comment\.id\)\}"[^>]*><svg[^>]*><path transform="rotate\(180 12 12\)"/);
});
