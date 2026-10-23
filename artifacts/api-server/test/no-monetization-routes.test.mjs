import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("billing routes, webhook, Stripe runtime and catalog seed scripts are removed", () => {
  for (const file of [
    "../src/routes/memberships.ts", "../src/lib/membership-stripe.ts",
    "../scripts/seed-membership-prices.mjs", "../scripts/seed-membership-prices-live.mjs"
  ]) assert.equal(existsSync(new URL(file, import.meta.url)), false, file);
  assert.doesNotMatch(read("../src/app.ts") + read("../src/routes/index.ts"), /stripe|membership|checkout/i);
  const pkg = JSON.parse(read("../package.json"));
  assert.equal(pkg.dependencies.stripe, undefined);
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /membership|stripe/i);
});

test("API contract removes billing while retaining authentication and social endpoints", () => {
  const spec = read("../../../lib/api-spec/openapi.yaml");
  assert.doesNotMatch(spec, /\/memberships|\/stripe|MembershipTier|StripeWebhook|CheckoutUrl/);
  for (const path of ["/auth/register:", "/auth/login:", "/posts:", "/feed:", "/healthz:"]) {
    assert.ok(spec.includes(path), `${path} must remain`);
  }
});
