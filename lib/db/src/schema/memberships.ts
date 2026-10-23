import { boolean, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./accounts";

export const creatorMembershipSettingsTable = pgTable(
  "creator_membership_settings",
  {
    creatorId: uuid("creator_id")
      .primaryKey()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    stripeAccountId: text("stripe_account_id").notNull(),
    countryCode: text("country_code").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("creator_membership_stripe_account_unique").on(table.stripeAccountId),
  ],
);

export const stripeCustomersTable = pgTable(
  "stripe_customers",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("stripe_customers_customer_unique").on(table.stripeCustomerId),
  ],
);

export const membershipSubscriptionsTable = pgTable(
  "membership_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriberId: uuid("subscriber_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tierId: text("tier_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    status: text("status").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    lastStripeEventCreated: integer("last_stripe_event_created").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("membership_subscriptions_stripe_id_unique").on(table.stripeSubscriptionId),
    index("membership_subscriptions_subscriber_idx").on(table.subscriberId, table.status),
    index("membership_subscriptions_creator_idx").on(table.creatorId, table.status),
  ],
);

export const membershipCheckoutAttemptsTable = pgTable(
  "membership_checkout_attempts",
  {
    subscriberId: uuid("subscriber_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tierId: text("tier_id").notNull(),
    stripeSessionId: text("stripe_session_id"),
    status: text("status").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "membership_checkout_attempts_pk",
      columns: [table.subscriberId, table.creatorId],
    }),
    uniqueIndex("membership_checkout_attempts_session_unique").on(table.stripeSessionId),
    index("membership_checkout_attempts_status_idx").on(table.status, table.expiresAt),
  ],
);

export const stripeWebhookEventsTable = pgTable("stripe_webhook_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
