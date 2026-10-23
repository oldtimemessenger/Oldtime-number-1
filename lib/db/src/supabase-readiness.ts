import pg from "pg";
import { getSupabasePoolConfig } from "./supabase-connection";
import { inspectDatabaseSchema } from "./schema-compatibility";

/**
 * An isolated diagnostic connection; never imports the active database pool.
 * Database-enforced read-only mode prevents accidental migration/data writes.
 */
export async function inspectSupabaseReadiness(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
) {
  const config = getSupabasePoolConfig(env);
  const client = new pg.Client({
    connectionString: config.connectionString,
    ssl: config.ssl,
    options: config.options,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    query_timeout: 10_000,
    statement_timeout: 10_000,
    application_name: "oldtime-supabase-readonly-audit",
  });

  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const compatibility = await inspectDatabaseSchema(client, config.schema);
    const schemas = await client.query<{
      schema: string;
      tables: number;
      rls_enabled: number;
    }>(`
      SELECT n.nspname AS schema, count(*)::integer AS tables,
             count(*) FILTER (WHERE c.relrowsecurity)::integer AS rls_enabled
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p') AND n.nspname IN ('public', 'old_time', 'oldtime_app')
       GROUP BY n.nspname ORDER BY n.nspname
    `);
    await client.query("ROLLBACK");
    return {
      connected: true,
      tls: {
        encrypted: true,
        serverIdentityVerified: config.ssl.rejectUnauthorized,
        mode: config.sslMode,
      },
      activeBackend: env.APP_DATABASE_BACKEND ?? "supabase",
      checkedSchema: config.schema,
      compatibility,
      schemas: schemas.rows,
      scope: "Read-only table, column, type, nullability and default checks. Does not certify account migration, authorization policies, constraints, media or live streaming.",
    };
  } finally {
    await client.end();
  }
}
