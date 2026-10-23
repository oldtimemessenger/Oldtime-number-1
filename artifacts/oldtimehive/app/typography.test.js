import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const appDir = new URL("./", import.meta.url);
const read = file => readFileSync(new URL(file, appDir), "utf8");
const cssFiles = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? cssFiles(new URL(`${entry.name}/`, dir))
    : entry.name.endsWith(".css") ? [new URL(entry.name, dir)] : []
);

test("interface text and form controls share the app font", () => {
  const css = read("styles.css");
  assert.match(read("compact-interface.css"), /--font:\s*system-ui,\s*-apple-system/);
  assert.match(css, /--font-heading:\s*var\(--font\)/);
  assert.match(css, /button,\s*input,\s*textarea,\s*select\s*\{[^}]*font-family:\s*var\(--font\)/);
});

test("no feature stylesheet introduces a different interface font", () => {
  const files = cssFiles(appDir);
  assert.ok(files.length >= 7, "Audit must cover feature styles, not just the main stylesheet");
  for (const file of files) {
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const [, property, value] of body.matchAll(/(?:^|;)\s*(font(?:-family)?)\s*:\s*([^;]+)/g)) {
        if (selector.trim() === ".word") continue; // Branded wordmark, not interface text.
        if (selector.trim().endsWith(".ce-preset-aa")) continue; // Authored-media font sample, not interface chrome.
        if (value.includes("Color Emoji")) continue; // Emoji glyphs need their own font.
        if (file.pathname.endsWith("/tournaments.css") && /var\(--(?:mono|display)\)/.test(value)) continue; // Tournament HUD labels and title display font are intentional.
        assert.ok(
          /^(inherit|initial|unset|revert)$/.test(value.trim()) || /var\(--font(?:-heading|-emoji)?(?:,|\))/.test(value),
          `${file.pathname}: ${selector.trim()} sets ${property}: ${value} outside the shared font`
        );
      }
    }
  }
});

test("inline interface headings and startup text use the same font", () => {
  const info = read("blast-info.js");
  assert.doesNotMatch(info, /var\(--serif|font-family:\s*(?:Georgia|Arial|Fraunces)/);
  const html = read("../index.html");
  for (const selector of ["oldtime-startup-status", "oldtime-startup-retry"]) {
    const rule = html.match(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`))?.[1];
    assert.ok(rule, `Missing ${selector} styling`);
    assert.match(rule, /font:[^;]*var\(--font/);
  }
});
