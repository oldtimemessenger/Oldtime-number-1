import { pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable, sessionsTable } from "./accounts";

export const cognitoIdentitiesTable = pgTable("cognito_identities", {
  issuer: text("issuer").notNull(),
  subject: text("subject").notNull(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.issuer, table.subject] }),
  uniqueIndex("cognito_identity_user_pool_unique").on(table.userId, table.issuer),
]);
export const insertCognitoIdentitySchema = createInsertSchema(cognitoIdentitiesTable).omit({ createdAt: true });
export type CognitoIdentityRecord = typeof cognitoIdentitiesTable.$inferSelect;

export const cognitoGrantsTable = pgTable("cognito_grants", {
  sessionId: uuid("session_id").primaryKey().references(() => sessionsTable.id, { onDelete: "cascade" }),
  issuer: text("issuer").notNull(),
  subject: text("subject").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  refreshUntil: timestamp("refresh_until", { withTimezone: true }).notNull(),
});
