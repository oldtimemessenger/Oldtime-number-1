import { bigint, boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./accounts";
import { postsTable } from "./social";

// Private, owner-authenticated originals used by creator evaluation, not a
// public copy of friends/Close Friends content or the revocable Remix project.
export const creatorContentTable = pgTable("creator_original_content", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sourceId: text("source_id").notNull(),
  surface: text("surface").notNull(),
  kind: text("kind").notNull(),
  body: text("body").notNull(),
  fingerprint: text("fingerprint").notNull(),
  original: boolean("original").notNull().default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("creator_content_source_unique").on(t.userId, t.sourceId), index("creator_content_fingerprint_idx").on(t.fingerprint)]);

export const creatorMediaTable = pgTable("creator_media_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  objectPath: text("object_path").notNull(),
  contentType: text("content_type").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  fingerprint: text("fingerprint"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  contentId: uuid("content_id").references(() => creatorContentTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("creator_media_owner_idx").on(t.userId, t.createdAt)]);

// Real authenticated discussion on persisted public posts, never device-only
// comments/likes or client-submitted engagement counters.
export const postCommentsTable = pgTable("post_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id").notNull().references(() => postsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("post_comments_post_idx").on(t.postId, t.createdAt)]);

export const postCommentReactionsTable = pgTable("post_comment_reactions", {
  commentId: uuid("comment_id").notNull().references(() => postCommentsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  reaction: text("reaction").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("post_comment_reactions_comment_user_unique").on(t.commentId, t.userId),
  index("post_comment_reactions_user_idx").on(t.userId, t.createdAt),
]);
