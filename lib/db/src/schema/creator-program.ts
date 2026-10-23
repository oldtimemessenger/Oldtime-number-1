import { boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./accounts";

// Program status is independent from creator earnings and historical Stripe data.
export const creatorProgramsTable = pgTable("creator_program_accounts", {
  userId: uuid("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("rising"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  restricted: boolean("restricted").notNull().default(false),
  isAdmin: boolean("is_admin").notNull().default(false),
  interested: boolean("interested").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  returningOfferUntil: timestamp("returning_offer_until", { withTimezone: true }),
  preferences: jsonb("preferences").notNull().default({ features: true, promotions: true, creators: true, communities: true }),
});

// Only a future verified Apple/Google adapter may write these records.
// There is deliberately no client/admin endpoint to manufacture an entitlement.
export const blueBadgeEntitlementsTable = pgTable("blue_badge_entitlements", {
  userId: uuid("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  store: text("store").notNull(),
  transactionId: text("transaction_id").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  introUsed: boolean("intro_used").notNull().default(false),
  state: text("state").notNull().default("active"),
  autoRenews: boolean("auto_renews"),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  billingIssueAt: timestamp("billing_issue_at", { withTimezone: true }),
}, table => [uniqueIndex("blue_badge_transaction_unique").on(table.store, table.transactionId)]);

// Permanent verified-store bindings outlive renewals/expiry. The ID is a
// one-way digest, not a receipt/purchase token. No browser/admin writer exists.
export const badgeStoreSubscriptionsTable = pgTable("blue_badge_store_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  store: text("store").notNull(),
  subscriptionKey: text("subscription_key").notNull(),
  productId: text("product_id").notNull(),
  state: text("state").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  autoRenews: boolean("auto_renews"),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  billingIssueAt: timestamp("billing_issue_at", { withTimezone: true }),
  introUsed: boolean("intro_used").notNull().default(false),
}, t => [uniqueIndex("badge_store_subscription_unique").on(t.store, t.subscriptionKey), index("badge_store_user_idx").on(t.userId)]);

export const badgeStoreEventsTable = pgTable("blue_badge_store_events", {
  store: text("store").notNull(),
  eventId: text("event_id").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.store, t.eventId] })]);

export const creatorHistoryTable = pgTable("creator_program_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("creator_history_user_idx").on(table.userId, table.createdAt)]);

export const creatorConfigTable = pgTable("creator_program_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const announcementDismissalsTable = pgTable("announcement_dismissals", {
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  campaignId: text("campaign_id").notNull(),
  choice: text("choice").notNull(),
  dismissUntil: timestamp("dismiss_until", { withTimezone: true }),
}, table => [primaryKey({ columns: [table.userId, table.campaignId] })]);

// One aggregate event per account/campaign/day; no device fingerprint or PII.
export const announcementEventsTable = pgTable("announcement_events", {
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  campaignId: text("campaign_id").notNull(),
  event: text("event").notNull(),
  day: date("day", { mode: "string" }).notNull(),
  count: integer("count").notNull().default(1),
}, table => [primaryKey({ columns: [table.userId, table.campaignId, table.event, table.day] })]);
