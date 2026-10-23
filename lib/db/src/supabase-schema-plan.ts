import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as models from "./schema";

export const SUPABASE_APP_SCHEMA = "oldtime_app";

/**
 * Generate additive DDL from the real API models. Existing public/old_time
 * objects never participate in the diff and cannot be renamed or dropped.
 */
export async function createSupabaseSchemaPlan(): Promise<string> {
  const empty = generateDrizzleJson({});
  const target = generateDrizzleJson(models);
  target.schemas = { [SUPABASE_APP_SCHEMA]: SUPABASE_APP_SCHEMA };
  target.tables = Object.fromEntries(Object.values(target.tables).map((table) => {
    table.schema = SUPABASE_APP_SCHEMA;
    table.isRLSEnabled = true;
    for (const foreignKey of Object.values(table.foreignKeys)) {
      foreignKey.schemaTo = SUPABASE_APP_SCHEMA;
    }
    return [`${SUPABASE_APP_SCHEMA}.${table.name}`, table];
  }));
  const statements = await generateMigration(empty, target);
  const sql = statements.join("\n");
  if (/\b(DROP|TRUNCATE|RENAME)\b|\bDELETE\s+FROM\b/i.test(sql)) {
    throw new Error("Initial Supabase schema plan must only create new objects.");
  }
  return [
    "-- Additive Oldtime API schema. Preserve public and old_time unchanged.",
    sql,
    `REVOKE ALL ON SCHEMA "${SUPABASE_APP_SCHEMA}" FROM PUBLIC, anon, authenticated;`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA "${SUPABASE_APP_SCHEMA}" FROM PUBLIC, anon, authenticated;`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA "${SUPABASE_APP_SCHEMA}" FROM PUBLIC, anon, authenticated;`,
  ].join("\n");
}
