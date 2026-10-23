import { pgTable, uuid, text, boolean, jsonb, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./accounts";

export const participationBoards = pgTable("participation_boards", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: uuid("creator_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  format: text("format").notNull().default("mixed"),
  category: text("category").notNull().default("creative"),
  visibility: text("visibility").notNull().default("invite_only"),
  status: text("status").notNull().default("open"),
  rules: text("rules").notNull().default(""),
  commentsEnabled: boolean("comments_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("participation_boards_created_idx").on(t.createdAt)]);

export const participationEntries = pgTable("participation_entries", {
  id: uuid("id").primaryKey(),
  boardId: uuid("board_id").notNull().references(() => participationBoards.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  caption: text("caption").notNull().default(""),
  place: jsonb("place").$type<{ id: string; label: string; source: "custom" | "osm"; lat?: number; lon?: number }>(),
  mediaType: text("media_type").notNull().default("text"),
  object: jsonb("object").$type<{ kind: "filesystem" | "s3" | "gcs" | "supabase"; key: string }>(),
  mime: text("mime"),
  removed: boolean("removed").notNull().default(false),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("participation_entries_board_idx").on(t.boardId, t.createdAt)]);

export const participationInvites = pgTable("participation_invites", {
  boardId: uuid("board_id").notNull().references(() => participationBoards.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
}, t => [primaryKey({ columns: [t.boardId, t.userId] })]);

export const participationReactions = pgTable("participation_reactions", {
  entryId: uuid("entry_id").notNull().references(() => participationEntries.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
}, t => [primaryKey({ columns: [t.entryId, t.userId] })]);

export const participationReports = pgTable("participation_reports", {
  boardId: uuid("board_id").notNull().references(() => participationBoards.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  target: text("target").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.boardId, t.userId, t.target] })]);

export const participationBlocks = pgTable("participation_blocks", {
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  blockedId: uuid("blocked_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
}, t => [primaryKey({ columns: [t.userId, t.blockedId] })]);

export const participationComments = pgTable("participation_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id").notNull().references(() => participationEntries.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
