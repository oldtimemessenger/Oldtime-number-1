import { createInsertSchema } from "drizzle-zod";
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./accounts";
import { userMediaAssetsTable } from "./user-media";

export const chatConversationsTable = pgTable(
  "chat_conversations",
  {
    id: text("id").primaryKey(),
    createdBy: uuid("created_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [index("chat_conversations_updated_idx").on(table.updatedAt)],
);

export const chatMembersTable = pgTable(
  "chat_members",
  {
    conversationId: text("conversation_id").notNull().references(() => chatConversationsTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
  },
  table => [
    primaryKey({ name: "chat_members_pk", columns: [table.conversationId, table.userId] }),
    index("chat_members_user_idx").on(table.userId, table.conversationId),
  ],
);

export const chatMessagesTable = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => chatConversationsTable.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("text"),
    body: text("body").notNull().default(""),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  table => [
    index("chat_messages_room_created_idx").on(table.conversationId, table.createdAt),
    index("chat_messages_author_idx").on(table.authorId, table.createdAt),
  ],
);

export const chatMessageMediaTable = pgTable(
  "chat_message_media",
  {
    messageId: text("message_id").notNull().references(() => chatMessagesTable.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id").notNull().references(() => userMediaAssetsTable.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  table => [
    primaryKey({ columns: [table.messageId, table.mediaId] }),
    uniqueIndex("chat_message_media_position_idx").on(table.messageId, table.position),
    index("chat_message_media_asset_idx").on(table.mediaId),
  ],
);

export const chatLegacyArchivePartsTable = pgTable(
  "chat_legacy_archive_parts",
  {
    ownerId: uuid("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    part: integer("part").notNull(),
    totalParts: integer("total_parts").notNull(),
    contentHash: text("content_hash").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    primaryKey({ name: "chat_legacy_archive_parts_pk", columns: [table.ownerId, table.sourceId, table.part] }),
    index("chat_legacy_archive_owner_created_idx").on(table.ownerId, table.createdAt),
  ],
);

export const insertChatConversationSchema = createInsertSchema(chatConversationsTable).omit({ createdAt: true, updatedAt: true });
export const insertChatMemberSchema = createInsertSchema(chatMembersTable).omit({ joinedAt: true, lastReadAt: true });
export const insertChatMessageSchema = createInsertSchema(chatMessagesTable).omit({ createdAt: true, editedAt: true });
export type ChatConversation = typeof chatConversationsTable.$inferSelect;
export type ChatMember = typeof chatMembersTable.$inferSelect;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;
export type InsertChatConversation = z.infer<typeof insertChatConversationSchema>;
export type InsertChatMember = z.infer<typeof insertChatMemberSchema>;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
