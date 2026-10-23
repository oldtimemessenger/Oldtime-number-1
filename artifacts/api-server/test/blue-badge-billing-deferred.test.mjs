import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("Blue Badge uses the requested planned price without advertising unconfigured offers", () => {
  const config = read("../src/lib/creator-program.ts");
  const route = read("../src/routes/creator-program.ts");
  const billing = read("../src/lib/revenuecat-membership.ts");
  assert.match(config, /standardPriceCents:\s*299/);
  assert.match(route, /const billingEnabled = isRevenueCatBillingConfigured\(\)/);
  assert.match(billing, /return Boolean\(process\.env\.REVENUECAT_SECRET_API_KEY\)/);
  assert.match(route, /offer:\s*\{\s*eligible:\s*false,\s*kind:\s*"standard",\s*available:\s*false\s*\}/);
});

test("membership status remains server-verified with no payment or gift grant endpoint", () => {
  const route = read("../src/routes/creator-program.ts");
  const service = read("../src/lib/store-membership.ts");
  assert.match(route, /storeMembership\(userId\)/);
  assert.match(service, /verifier\.verify\(opaqueProof, userId\)/);
  assert.doesNotMatch(route, /router\.(post|put|patch)\("\/badge\/(purchase|gift|redeem|checkout)/);
});
