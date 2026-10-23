import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

const source = readFileSync(new URL("../src/lib/creator-eligibility.ts", import.meta.url), "utf8");
const { code } = transformSync(source, { loader: "ts", format: "esm" });
const { evaluateCreator, DEFAULT_THRESHOLDS, membershipIsActive } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const stats = { ...DEFAULT_THRESHOLDS, profileCompletion: 100 };
const options = { membershipActive: true, restricted: false, automaticApproval: true, previousStatus: "rising" };

test("qualifying creator needs verified membership, not just activity", () => {
  assert.equal(evaluateCreator(stats, DEFAULT_THRESHOLDS, options).status, "approved");
  const result = evaluateCreator(stats, DEFAULT_THRESHOLDS, { ...options, membershipActive: false });
  assert.equal(result.status, "membership-required");
  assert.equal(result.score, 100);
  assert.equal(result.eligible, true);
});
test("paying membership does not bypass eligibility, account standing, or approval flag", () => {
  assert.notEqual(evaluateCreator({ ...stats, originalPosts: 0 }, DEFAULT_THRESHOLDS, options).status, "approved");
  assert.equal(evaluateCreator(stats, DEFAULT_THRESHOLDS, { ...options, restricted: true }).status, "restricted");
  assert.equal(evaluateCreator(stats, DEFAULT_THRESHOLDS, { ...options, automaticApproval: false }).status, "eligible");
});
test("previously approved creators are paused on expiry and restored on verified renewal", () => {
  const inactive = { ...stats, activeDays: 0 };
  assert.equal(evaluateCreator(inactive, DEFAULT_THRESHOLDS, { ...options, wasApproved: true, membershipActive: false }).status, "membership-required");
  assert.equal(evaluateCreator(inactive, DEFAULT_THRESHOLDS, { ...options, wasApproved: true }).status, "approved");
  assert.equal(evaluateCreator(inactive, DEFAULT_THRESHOLDS, { ...options, wasApproved: true, restricted: true }).status, "restricted");
});
test("only Apple and Google unrevoked and unexpired entitlements count", () => {
  const now = Date.now();
  const valid = { store: "apple", verifiedAt: new Date(now - 1000), expiresAt: new Date(now + 1000), revokedAt: null };
  assert.equal(membershipIsActive(valid, now), true);
  assert.equal(membershipIsActive({ ...valid, store: "google" }, now), true);
  assert.equal(membershipIsActive({ ...valid, store: "stripe" }, now), false);
  assert.equal(membershipIsActive({ ...valid, expiresAt: new Date(now) }, now), false);
  assert.equal(membershipIsActive({ ...valid, revokedAt: new Date(now) }, now), false);
  assert.equal(membershipIsActive({ ...valid, verifiedAt: new Date(now + 100) }, now), false);
  assert.equal(membershipIsActive(undefined, now), false);
});
