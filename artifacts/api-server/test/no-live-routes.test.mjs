import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const routeIndex = readFileSync(new URL("../src/routes/index.ts", import.meta.url), "utf8");
const liveRoute = new URL("../src/routes/live.ts", import.meta.url);

test("public broadcast Live routes are not part of the API", () => {
  assert.equal(existsSync(liveRoute), false);
  assert.doesNotMatch(routeIndex, /liveRouter|from ["']\.\/live["']/);
});
