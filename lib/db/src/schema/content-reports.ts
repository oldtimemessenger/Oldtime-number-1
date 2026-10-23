import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./accounts";

export const contentReportsTable = pgTable("content_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reporterId: uuid("reporter_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  targetUserId: uuid("target_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  category: text("category").notNull(),
  postId: text("post_id"),
  commentId: text("comment_id"),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("received"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("content_reports_reporter_created_idx").on(table.reporterId, table.createdAt),
  index("content_reports_status_created_idx").on(table.status, table.createdAt),
]);
