import assert from "node:assert/strict";
import test from "node:test";
import { SPORTS_MODE_ENABLED, sportsMutationDisabled } from "../src/lib/sports-feature-state.js";

test("Sports recording stays disabled while read-only history access is preserved", () => {
  assert.equal(SPORTS_MODE_ENABLED, false);
  for (const method of ["GET", "HEAD", "OPTIONS"]) assert.equal(sportsMutationDisabled(method), false);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(sportsMutationDisabled(method), true);
});
