import { boolean, doublePrecision, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./accounts";
export const analyticsResourcesTable = pgTable("analytics_resources", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sourceId: text("source_id").notNull(), kind: text("kind").notNull(), title: text("title").notNull(),
  isPublic: boolean("is_public").notNull().default(false),
  durationMs: integer("duration_ms"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("analytics_resource_source_unique").on(t.ownerId,t.sourceId), index("analytics_resource_owner_idx").on(t.ownerId,t.createdAt)]);
export const analyticsSessionsTable = pgTable("analytics_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  resourceId: uuid("resource_id").notNull().references(() => analyticsResourcesTable.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  nonce: uuid("nonce").notNull(), source: text("source").notNull(),
  watchedMs: integer("watched_ms").notNull().default(0), visibleMs: integer("visible_ms").notNull().default(0),
  progress: doublePrecision("progress").notNull().default(0), qualified: boolean("qualified").notNull().default(false),
  completed: boolean("completed").notNull().default(false),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("analytics_session_nonce_unique").on(t.actorId,t.nonce), index("analytics_session_resource_idx").on(t.resourceId,t.startedAt)]);
export const analyticsEventsTable = pgTable("analytics_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  resourceId: uuid("resource_id").references(() => analyticsResourcesTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), source: text("source").notNull(), dedupKey: text("dedup_key").notNull(),
  value: integer("value").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("analytics_event_dedup_unique").on(t.ownerId,t.actorId,t.dedupKey), index("analytics_event_owner_idx").on(t.ownerId,t.createdAt), index("analytics_event_resource_idx").on(t.resourceId,t.createdAt)]);
export const analyticsDailyTable = pgTable("analytics_daily", {
  ownerId: uuid("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  day: text("day").notNull(), kind: text("kind").notNull(), value: integer("value").notNull().default(0),
}, t => [primaryKey({ columns: [t.ownerId,t.day,t.kind] })]);
export const analyticsFollowsTable = pgTable("analytics_follows", {
  ownerId: uuid("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.ownerId,t.actorId] })]);
