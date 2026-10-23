import { bigint, boolean, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./accounts";
import { postsTable } from "./social";

export const userMediaAssetsTable = pgTable("user_media_assets", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  objectKey: text("object_key").notNull().unique(),
  contentType: text("content_type").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  ready: boolean("ready").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("user_media_assets_owner_created_idx").on(table.userId, table.createdAt)]);

export const postMediaAssetsTable = pgTable("post_media_assets", {
  postId: uuid("post_id").notNull().references(() => postsTable.id, { onDelete: "cascade" }),
  mediaId: uuid("media_id").notNull().references(() => userMediaAssetsTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
}, table => [
  primaryKey({ columns: [table.postId, table.mediaId] }),
  index("post_media_assets_media_idx").on(table.mediaId),
  index("post_media_assets_post_order_idx").on(table.postId, table.position),
]);
