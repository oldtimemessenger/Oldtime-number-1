import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Sports is disabled in the app while stored posts remain available", async () => {
  const [source, store] = await Promise.all([
    readFile(new URL("./app.js", import.meta.url), "utf8"),
    readFile(new URL("./store.js", import.meta.url), "utf8"),
  ]);
  assert.match(source, /SPORTS_MODE_ENABLED/);
  assert.match(source, /route === "sports" && !SPORTS_MODE_ENABLED/);
  assert.doesNotMatch(source, /data-drawer-route="sports"|data-blast-tool="sports"|button-drawer-sports/);
  assert.doesNotMatch(source, /\{ id: "sports", label: "Sports" \}/);
  assert.doesNotMatch(source, /\["Sports history"/);
  assert.doesNotMatch(source, /sportsCard\?\.challenge|sports-tags/);
  assert.match(store, /post\.sportsCard/);
});
