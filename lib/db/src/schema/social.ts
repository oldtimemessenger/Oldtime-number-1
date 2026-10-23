import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { AnyPgColumn, boolean, check, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./accounts";
import { workoutsTable } from "./sports";

export const postsTable = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    sourceId: text("source_id"),
    remixSourcePostId: uuid("remix_source_post_id")
      .references((): AnyPgColumn => postsTable.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    visibility: text("visibility").notNull().default("public"),
    destination: text("destination").notNull().default("both"),
    place: jsonb("place").$type<{ id: string; label: string; source: "custom" | "osm"; lat?: number; lon?: number }>(),
    sportsCard: jsonb("sports_card").$type<Record<string, unknown>>(),
    sportsWorkoutId: uuid("sports_workout_id").references(() => workoutsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("posts_created_at_idx").on(table.createdAt),
    index("posts_visibility_created_at_idx").on(table.visibility, table.createdAt),
    index("posts_destination_created_at_idx").on(table.destination, table.createdAt),
    index("posts_remix_source_post_idx")
      .on(table.remixSourcePostId)
      .where(sql`${table.remixSourcePostId} IS NOT NULL`),
    check("posts_destination_check", sql`${table.destination} IN ('main', 'community', 'both')`),
    index("posts_author_created_at_idx").on(table.authorId, table.createdAt),
    uniqueIndex("posts_author_source_unique").on(table.authorId, table.sourceId),
  ],
);

export const postLikesTable = pgTable(
  "post_likes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => postsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "post_likes_pk", columns: [table.userId, table.postId] }),
    index("post_likes_post_id_idx").on(table.postId),
  ],
);

export const postRepostsTable = pgTable(
  "post_reposts",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => postsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "post_reposts_pk", columns: [table.postId, table.userId] }),
    index("post_reposts_post_updated_idx").on(table.postId, table.updatedAt),
    index("post_reposts_user_idx").on(table.userId, table.postId),
  ],
);

export const closeFriendMembersTable = pgTable(
  "close_friend_members",
  {
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "close_friend_members_pk", columns: [table.ownerId, table.memberId] }),
    index("close_friend_members_member_idx").on(table.memberId),
  ],
);

export const accountBlocksTable = pgTable(
  "account_blocks",
  {
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "account_blocks_pk", columns: [table.ownerId, table.blockedId] }),
    index("account_blocks_blocked_idx").on(table.blockedId),
  ],
);

export const storiesTable = pgTable(
  "stories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    sourceId: text("source_id"),
    text: text("text").notNull().default(""),
    visibility: text("visibility").notNull().default("public"),
    mediaPath: text("media_path"),
    mediaType: text("media_type"),
    mediaReady: boolean("media_ready").notNull().default(true),
    savedToProfile: boolean("saved_to_profile").notNull().default(false),
    commentsEnabled: boolean("comments_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("stories_author_created_idx").on(table.authorId, table.createdAt),
    index("stories_visibility_expiry_idx").on(table.visibility, table.expiresAt),
    uniqueIndex("stories_author_source_unique").on(table.authorId, table.sourceId),
  ],
);

export const storyCommentsTable = pgTable(
  "story_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => storiesTable.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("story_comments_story_created_idx").on(table.storyId, table.createdAt),
    index("story_comments_author_created_idx").on(table.authorId, table.createdAt),
  ],
);

export const storyViewsTable = pgTable(
  "story_views",
  {
    storyId: uuid("story_id")
      .notNull()
      .references(() => storiesTable.id, { onDelete: "cascade" }),
    viewerId: uuid("viewer_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    primaryKey({ name: "story_views_pk", columns: [table.storyId, table.viewerId] }),
    index("story_views_story_viewed_idx").on(table.storyId, table.viewedAt),
    index("story_views_viewer_viewed_idx").on(table.viewerId, table.viewedAt),
  ],
);

export const storyReactionsTable = pgTable(
  "story_reactions",
  {
    storyId: uuid("story_id")
      .notNull()
      .references(() => storiesTable.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    primaryKey({ name: "story_reactions_pk", columns: [table.storyId, table.actorId] }),
    index("story_reactions_story_updated_idx").on(table.storyId, table.updatedAt),
  ],
);

export const insertPostSchema = createInsertSchema(postsTable).omit({
  id: true,
  createdAt: true,
});
export const insertPostLikeSchema = createInsertSchema(postLikesTable).omit({
  createdAt: true,
});

export type InsertPost = z.infer<typeof insertPostSchema>;
export type Post = typeof postsTable.$inferSelect;
export type InsertPostLike = z.infer<typeof insertPostLikeSchema>;
export type PostLike = typeof postLikesTable.$inferSelect;
