import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, badgeStoreSubscriptionsTable, badgeStoreEventsTable, blueBadgeEntitlementsTable } from "@workspace/db";
import { membershipIsActive } from "./creator-eligibility";
import { refreshCreatorsAfterActivity } from "./creator-program";

type Store = "apple" | "google";
type VerifiedState = "pending" | "active" | "canceled" | "expired" | "revoked" | "billing-issue";
export interface VerifiedStoreEvidence {
  accountId: string;
  originalSubscriptionId: string;
  productId: string;
  eventId: string;
  state: VerifiedState;
  observedAt: Date;
  expiresAt: Date;
  autoRenews: boolean | null;
  introUsed: boolean;
}
// Future native integration implements this server-only boundary using Apple's
// signed data + pinned certificates or Google's authenticated server API.
// This interface itself is NOT store verification and is not an HTTP endpoint.
export interface StoreVerifier {
  store: Store;
  allowedProducts: readonly string[];
  verify(opaqueProof: string, expectedAccountId: string): Promise<VerifiedStoreEvidence>;
}

export async function verifyAndRecordStoreMembership(userId: string, opaqueProof: string, verifier: StoreVerifier) {
  // No verifier is registered in the running web app. No client flags, local
  // storage, admin config or interest requests ever enter this path.
  if (!["apple", "google"].includes(verifier.store) || !verifier.allowedProducts.length) throw new Error("Native store verification is not configured.");
  const evidence = await verifier.verify(opaqueProof, userId);
  if (evidence.accountId !== userId || !verifier.allowedProducts.includes(evidence.productId) ||
    !evidence.originalSubscriptionId || !evidence.eventId ||
    !["pending", "active", "canceled", "expired", "revoked", "billing-issue"].includes(evidence.state) ||
    !Number.isFinite(evidence.observedAt.getTime()) || evidence.observedAt.getTime() > Date.now() + 300000 ||
    !Number.isFinite(evidence.expiresAt.getTime())) throw new Error("Store verification returned invalid account, product or lifecycle evidence.");
  const subscriptionKey = createHash("sha256").update(`${verifier.store}:${evidence.originalSubscriptionId}`).digest("hex");
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM users WHERE id=${userId} FOR UPDATE`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${verifier.store + subscriptionKey},0))`);
    const [bound] = await tx.select().from(badgeStoreSubscriptionsTable).where(and(
      eq(badgeStoreSubscriptionsTable.store, verifier.store), eq(badgeStoreSubscriptionsTable.subscriptionKey, subscriptionKey))).limit(1);
    // A restore cannot move a verified purchase to someone else's account.
    if (bound && bound.userId !== userId) throw new Error("This store subscription belongs to another Oldtime account.");
    const [event] = await tx.insert(badgeStoreEventsTable).values({ store: verifier.store, eventId: evidence.eventId }).onConflictDoNothing().returning();
    if (!event || bound && bound.observedAt.getTime() >= evidence.observedAt.getTime()) return;
    const verifiedAt = new Date();
    const state = evidence.state;
    const values = { userId, store: verifier.store, subscriptionKey, productId: evidence.productId, state,
      observedAt: evidence.observedAt, verifiedAt, expiresAt: evidence.expiresAt,
      autoRenews: state === "canceled" ? false : evidence.autoRenews,
      canceledAt: state === "canceled" ? evidence.observedAt : null,
      revokedAt: state === "revoked" ? evidence.observedAt : null,
      billingIssueAt: state === "billing-issue" ? evidence.observedAt : null,
      introUsed: evidence.introUsed || bound?.introUsed || false };
    await tx.insert(badgeStoreSubscriptionsTable).values(values).onConflictDoUpdate({
      target: [badgeStoreSubscriptionsTable.store, badgeStoreSubscriptionsTable.subscriptionKey], set: values,
    });
    const subscriptions = await tx.select().from(badgeStoreSubscriptionsTable).where(eq(badgeStoreSubscriptionsTable.userId, userId));
    const ordered = subscriptions.sort((a,b) => Number(membershipIsActive(b)) - Number(membershipIsActive(a))
      || (membershipIsActive(a) ? b.expiresAt.getTime()-a.expiresAt.getTime() : b.observedAt.getTime()-a.observedAt.getTime()));
    const current = ordered[0];
    // One shared entitlement. An expired/refunded subscription on one store
    // cannot erase another store's still-valid membership.
    const aggregate = { userId, store: current.store, transactionId: current.subscriptionKey, state: current.state,
      verifiedAt: current.verifiedAt, expiresAt: current.expiresAt, revokedAt: current.revokedAt,
      autoRenews: current.autoRenews, canceledAt: current.canceledAt, billingIssueAt: current.billingIssueAt,
      introUsed: subscriptions.some(s => s.introUsed) };
    await tx.insert(blueBadgeEntitlementsTable).values(aggregate).onConflictDoUpdate({
      target: blueBadgeEntitlementsTable.userId, set: aggregate,
    });
  });
  refreshCreatorsAfterActivity([userId]);
}
