import test from "node:test";
import assert from "node:assert/strict";
import { loadToolsTheme, saveToolsTheme, normalizeToolsTheme, applyToolsTheme } from "./creative-controls-palette.js";
import { mockCloudAccountState } from "./test-cloud-state.js";

test("tools theme defaults to dark and persists only in the signed-in cloud account", async () => {
  const cloud = mockCloudAccountState("theme-owner");
  cloud.setLoaded(true);
  cloud.setState("theme-owner", {});
  assert.equal(loadToolsTheme(), "dark");
  assert.equal(await saveToolsTheme("light"), true);
  assert.equal(loadToolsTheme(), "light");
  cloud.failUpdates(new Error("offline"));
  await assert.rejects(saveToolsTheme("dark"), /offline/);
  assert.equal(normalizeToolsTheme("neon"), "dark");
  cloud.restore();
});

test("applyToolsTheme scopes the theme to the editor and marks the pressed button", () => {
  const buttons = ["light", "dark"].map(t => ({ dataset: { ceToolsTheme: t }, pressed: "", setAttribute(_, v) { this.pressed = v; } }));
  const editor = { dataset: {}, querySelectorAll: () => buttons };
  assert.equal(applyToolsTheme(editor, "light"), "light");
  assert.equal(editor.dataset.ceTools, "light"); assert.deepEqual(buttons.map(b => b.pressed), ["true", "false"]);
});
