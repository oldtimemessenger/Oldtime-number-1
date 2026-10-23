import { createHash } from "node:crypto";
import type { VerifiedStoreEvidence } from "./store-membership";

export const BLUE_BADGE_PRODUCT_IDS = ["blue_badge_monthly", "blue_badge_monthly:monthly"] as const;
export const BLUE_BADGE_ENTITLEMENT_ID = "blue_badge";
export const BLUE_BADGE_OFFERING_ID = "blue_badge";

type RevenueCatRecord = Record<string, unknown>;
type RevenueCatStore = "apple" | "google";
type RevenueCatState = VerifiedStoreEvidence["state"];

function record(value: unknown): RevenueCatRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RevenueCatRecord : {};
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function date(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function storeName(value: unknown): RevenueCatStore | null {
  if (value === "app_store" || value === "APP_STORE") return "apple";
  if (value === "play_store" || value === "PLAY_STORE") return "google";
  return null;
}

export type ParsedRevenueCatMembership = {
  store: RevenueCatStore;
  evidence: VerifiedStoreEvidence;
};

/**
 * Convert a RevenueCat v1 subscriber response into server-side evidence.
 * A client-side CustomerInfo object is never accepted by this parser.
 */
export function parseRevenueCatMembership(
  expectedAccountId: string,
  payload: unknown,
  now = new Date(),
): ParsedRevenueCatMembership | null {
  const response = record(payload);
  const subscriber = record(response.subscriber);
  const entitlements = record(subscriber.entitlements);
  const badgeEntitlement = record(entitlements[BLUE_BADGE_ENTITLEMENT_ID]);
  const subscriptions = record(subscriber.subscriptions);
  const entitlementProductId = string(badgeEntitlement.product_identifier);

  const productId = entitlementProductId && BLUE_BADGE_PRODUCT_IDS.includes(entitlementProductId as typeof BLUE_BADGE_PRODUCT_IDS[number])
    ? entitlementProductId
    : BLUE_BADGE_PRODUCT_IDS.find((id) => Object.hasOwn(subscriptions, id));
  if (!productId || !BLUE_BADGE_PRODUCT_IDS.includes(productId as typeof BLUE_BADGE_PRODUCT_IDS[number])) return null;

  const subscription = record(subscriptions[productId]);
  const store = storeName(subscription.store);
  if (!store) return null;

  const expiresAt = date(badgeEntitlement.expires_date)
    ?? date(subscription.expires_date)
    ?? date(subscription.grace_period_expires_date);
  if (!expiresAt) return null;

  const hasBadgeEntitlement = entitlementProductId === productId;
  const refundedAt = date(subscription.refunded_at);
  const billingIssueAt = date(subscription.billing_issues_detected_at);
  const gracePeriodEndsAt = date(subscription.grace_period_expires_date);

  // Do not grant an entitlement solely because a subscription object exists.
  // A currently valid subscription must also carry the configured Blue Badge
  // entitlement from RevenueCat.
  if (!hasBadgeEntitlement && !refundedAt && expiresAt.getTime() > now.getTime()) return null;

  let state: RevenueCatState;
  if (refundedAt) state = "revoked";
  else if (expiresAt.getTime() <= now.getTime()) state = "expired";
  else if (billingIssueAt && gracePeriodEndsAt && gracePeriodEndsAt.getTime() > now.getTime()) state = "billing-issue";
  else if (string(subscription.unsubscribe_detected_at)) state = "canceled";
  else if (hasBadgeEntitlement) state = "active";
  else return null;

  const observedAt = date(response.request_date)
    ?? (typeof response.request_date_ms === "number" ? date(response.request_date_ms) : null)
    ?? now;
  const originalPurchaseDate = date(subscription.original_purchase_date)?.toISOString()
    ?? string(subscription.store_transaction_id)
    ?? `${expectedAccountId}:${productId}`;
  const autoRenews = state === "canceled" || state === "expired" || state === "revoked"
    ? false
    : state === "billing-issue" || state === "active";
  const eventId = createHash("sha256")
    .update([expectedAccountId, store, productId, state, expiresAt.toISOString(), autoRenews].join(":"))
    .digest("hex");

  return {
    store,
    evidence: {
      accountId: expectedAccountId,
      originalSubscriptionId: `${expectedAccountId}:${productId}:${originalPurchaseDate}`,
      productId,
      eventId,
      state,
      observedAt,
      expiresAt,
      autoRenews,
      introUsed: subscription.period_type === "trial" || subscription.period_type === "intro",
    },
  };
}
