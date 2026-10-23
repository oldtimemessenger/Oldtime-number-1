import assert from "node:assert/strict";
import test from "node:test";
import { parseRevenueCatMembership } from "../src/lib/revenuecat-membership-parser";

const accountId = "0f22d4cb-c637-4b5a-b98e-8e8ce43a4020";
const future = "2030-04-01T12:00:00.000Z";
const requestDate = "2026-10-14T15:00:00.000Z";

function customer(overrides: Record<string, unknown> = {}) {
  return {
    request_date: requestDate,
    subscriber: {
      entitlements: {
        blue_badge: {
          product_identifier: "blue_badge_monthly",
          expires_date: future,
        },
      },
      subscriptions: {
        blue_badge_monthly: {
          store: "app_store",
          expires_date: future,
          original_purchase_date: "2026-10-01T12:00:00.000Z",
          store_transaction_id: "transaction-current",
          period_type: "normal",
        },
      },
      ...overrides,
    },
  };
}

test("maps an Apple Blue Badge entitlement to server-verifiable evidence", () => {
  const result = parseRevenueCatMembership(accountId, customer());
  assert.equal(result?.store, "apple");
  assert.equal(result?.evidence.accountId, accountId);
  assert.equal(result?.evidence.state, "active");
  assert.equal(result?.evidence.productId, "blue_badge_monthly");
  assert.equal(result?.evidence.expiresAt.toISOString(), future);
});

test("does not grant access from a subscription without the Blue Badge entitlement", () => {
  const payload = customer({
    entitlements: {},
    subscriptions: {
      blue_badge_monthly: {
        store: "play_store",
        expires_date: future,
        store_transaction_id: "transaction-current",
      },
    },
  });
  assert.equal(parseRevenueCatMembership(accountId, payload), null);
});

test("preserves paid access through cancellation until expiry", () => {
  const payload = customer({
    entitlements: {
      blue_badge: { product_identifier: "blue_badge_monthly", expires_date: future },
    },
    subscriptions: {
      blue_badge_monthly: {
        store: "play_store",
        expires_date: future,
        original_purchase_date: "2026-10-01T12:00:00.000Z",
        unsubscribe_detected_at: requestDate,
      },
    },
  });
  const result = parseRevenueCatMembership(accountId, payload);
  assert.equal(result?.store, "google");
  assert.equal(result?.evidence.state, "canceled");
  assert.equal(result?.evidence.autoRenews, false);
});

test("rejects products outside the Blue Badge allowlist", () => {
  const payload = customer({
    entitlements: {
      blue_badge: { product_identifier: "creator_access", expires_date: future },
    },
    subscriptions: {
      creator_access: { store: "app_store", expires_date: future },
    },
  });
  assert.equal(parseRevenueCatMembership(accountId, payload), null);
});
