import { index, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./accounts";

export const userFollowsTable = pgTable(
  "user_follows",
  {
    followerId: uuid("follower_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    followedId: uuid("followed_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "user_follows_pk", columns: [table.followerId, table.followedId] }),
    index("user_follows_followed_idx").on(table.followedId, table.createdAt),
  ],
);

export const followRequestsTable = pgTable(
  "follow_requests",
  {
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "follow_requests_pk", columns: [table.requesterId, table.recipientId] }),
    index("follow_requests_recipient_idx").on(table.recipientId, table.createdAt),
  ],
);

export const friendRequestsTable = pgTable(
  "friend_requests",
  {
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "friend_requests_pk", columns: [table.requesterId, table.recipientId] }),
    index("friend_requests_recipient_idx").on(table.recipientId, table.createdAt),
  ],
);

export const friendshipsTable = pgTable(
  "friendships",
  {
    memberLowId: uuid("member_low_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    memberHighId: uuid("member_high_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "friendships_pk", columns: [table.memberLowId, table.memberHighId] }),
    index("friendships_high_idx").on(table.memberHighId, table.createdAt),
  ],
);

export const relationshipMigrationsTable = pgTable("relationship_migrations", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});
