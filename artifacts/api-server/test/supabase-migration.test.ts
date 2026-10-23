import assert from "node:assert/strict";
import test from "node:test";
import { getOrderedMigrationTables } from "@workspace/db/supabase-data-migration";
import { createSupabaseSchemaPlan } from "@workspace/db/supabase-schema-plan";
import { getTableConfig } from "drizzle-orm/pg-core";

test("migration orders all tables after their referenced parents", () => {
  const tables = getOrderedMigrationTables();
  const order = new Map(tables.map((table, index) => [table.name, index]));
  assert.equal(order.size, 70);
  for (const [index, table] of tables.entries()) {
    for (const key of table.foreignKeys) {
      const parent = getTableConfig(key.reference().foreignTable).name;
      if (parent !== table.name) assert.ok(order.get(parent)! < index, `${parent} must precede ${table.name}`);
    }
  }
});

test("initial migration creates only isolated tables with RLS, preserving legacy schemas", async () => {
  const plan = await createSupabaseSchemaPlan();
  assert.equal((plan.match(/CREATE TABLE "oldtime_app"\./g) || []).length, 70);
  assert.equal((plan.match(/ENABLE ROW LEVEL SECURITY/g) || []).length, 70);
  assert.match(plan, /CREATE TABLE "oldtime_app"\."post_reposts"/);
  assert.match(plan, /CREATE TABLE "oldtime_app"\."blast_account_state"/);
  assert.match(plan, /CREATE TABLE "oldtime_app"\."user_follows"/);
  assert.match(plan, /CREATE TABLE "oldtime_app"\."friendships"/);
  assert.match(plan, /CREATE TABLE "oldtime_app"\."chat_message_media"/);
  assert.doesNotMatch(plan, /\b(DROP|TRUNCATE|RENAME)\b|\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(plan, /REFERENCES "public"|ALTER TABLE "public"|ALTER TABLE "old_time"/);
  assert.match(plan, /REVOKE ALL ON SCHEMA "oldtime_app" FROM PUBLIC, anon, authenticated/);
});
