import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./accounts";

export const accountStateTable = pgTable("account_state", {
  userId: uuid("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
