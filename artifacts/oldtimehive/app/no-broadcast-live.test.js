import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../../api-server/src/routes/index.ts", import.meta.url), "utf8");

test("The reduced app navigation does not expose a separate Live feature", () => {
  assert.doesNotMatch(appSource, /data-drawer-route=["']live/);
  assert.doesNotMatch(appSource, /data-open-live/);
  assert.doesNotMatch(appSource, /mountLiveView|createLiveClient|function renderLiveExperience/);
  assert.doesNotMatch(routeSource, /liveRouter|from ["']\.\/live["']/);
});
