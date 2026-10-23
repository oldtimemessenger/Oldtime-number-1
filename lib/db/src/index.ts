import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { getSupabasePoolConfig } from "./supabase-connection";
import { assertDatabaseSchemaCompatible } from "./schema-compatibility";

const { Pool } = pg;

const databaseBackend = process.env.APP_DATABASE_BACKEND ?? "supabase";
if (databaseBackend !== "postgres" && databaseBackend !== "supabase") {
  throw new Error("APP_DATABASE_BACKEND must be either postgres or supabase.");
}

const supabasePoolConfig =
  databaseBackend === "supabase" ? getSupabasePoolConfig(process.env) : null;
const databaseUrl =
  databaseBackend === "supabase"
    ? supabasePoolConfig!.connectionString
    : process.env.DATABASE_URL;
const usesAwsConnection =
  databaseBackend === "postgres" &&
  !databaseUrl &&
  ["PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD"].every((key) => Boolean(process.env[key]));

if (databaseBackend === "postgres" && !databaseUrl && !usesAwsConnection) {
  throw new Error(
    "Set DATABASE_URL or all of PGHOST, PGDATABASE, PGUSER, and PGPASSWORD.",
  );
}

export const pool = new Pool(
  databaseUrl
    ? {
        connectionString: databaseUrl,
        ...(supabasePoolConfig
          ? {
              max: supabasePoolConfig.max,
              idleTimeoutMillis: supabasePoolConfig.idleTimeoutMillis,
              connectionTimeoutMillis: supabasePoolConfig.connectionTimeoutMillis,
              ssl: supabasePoolConfig.ssl,
              options: supabasePoolConfig.options,
              application_name: "oldtime-api",
            }
          : {}),
      }
    : {
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
      },
);
pool.on("error", (error: Error) => {
  console.error("Unexpected idle PostgreSQL connection error:", error.message);
});
export const db = drizzle(pool, { schema });

// Check before accepting requests or starting maintenance jobs. Never run
// automatic migrations on startup or attempt to repair existing user records.
export async function verifyDatabaseStartup(): Promise<void> {
  if (databaseBackend === "supabase") {
    await assertDatabaseSchemaCompatible(pool, supabasePoolConfig!.schema);
  }
}

export * from "./schema";
export { accountStateTable } from "./schema/account-state";
export { contentReportsTable } from "./schema/content-reports";
