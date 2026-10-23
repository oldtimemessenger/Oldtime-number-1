import { createHash } from "node:crypto";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import pg from "pg";
import * as models from "./schema";
import { inspectDatabaseSchema } from "./schema-compatibility";
import { getSupabasePoolConfig } from "./supabase-connection";

function quote(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("Invalid migration identifier.");
  return `"${value}"`;
}

export function getOrderedMigrationTables() {
  const tables = Object.values(models).filter((value) => is(value, PgTable)).map(getTableConfig);
  const remaining = new Map(tables.map((table) => [table.name, table]));
  const ordered: typeof tables = [];
  while (remaining.size) {
    let progressed = false;
    for (const [name, table] of remaining) {
      const dependencies = table.foreignKeys.map((foreignKey) => getTableConfig(foreignKey.reference().foreignTable).name);
      if (dependencies.some((dependency) => dependency !== name && remaining.has(dependency))) continue;
      ordered.push(table);
      remaining.delete(name);
      progressed = true;
    }
    if (!progressed) throw new Error("Cyclic table dependencies require a reviewed migration.");
  }
  return ordered;
}

async function* readPages(client: pg.Client, select: string) {
  await client.query(`DECLARE oldtime_copy_cursor NO SCROLL CURSOR FOR ${select}`);
  try {
    for (;;) {
      const page = await client.query<Record<string, string | null>>("FETCH 250 FROM oldtime_copy_cursor");
      if (!page.rows.length) break;
      yield page.rows;
    }
  } finally {
    await client.query("CLOSE oldtime_copy_cursor");
  }
}

/**
 * Run only during a write pause. Source is read-only and retained. Target
 * must be empty; all writes and checksum comparisons share one transaction.
 * Never print rows, passwords, tokens, URLs or raw driver errors.
 */
export async function copyAppDataToSupabase(
  env: NodeJS.ProcessEnv = process.env,
  commit = false,
) {
  const config = getSupabasePoolConfig(env);
  if (config.schema !== "oldtime_app" || !env.SUPABASE_PROJECT_REF ||
      new URL(config.connectionString).username !== `postgres.${env.SUPABASE_PROJECT_REF}`) {
    throw new Error("Migration target must be the confirmed project's isolated oldtime_app schema.");
  }
  const sourceUrl = env.MIGRATION_SOURCE_DATABASE_URL || env.DATABASE_URL;
  if (!sourceUrl || sourceUrl === env.SUPABASE_DATABASE_URL) {
    throw new Error("A separate source database connection is required.");
  }
  const source = new pg.Client({ connectionString: sourceUrl, connectionTimeoutMillis: 8000 });
  const target = new pg.Client({
    connectionString: config.connectionString, ssl: config.ssl,
    options: config.options, connectionTimeoutMillis: 8000,
  });
  const reports: { table: string; rows: number; checksumMatched: true }[] = [];
  const archives: { table: string; rows: number; checksumMatched: true }[] = [];
  try {
    await source.connect();
    await target.connect();
    await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await source.query("SET LOCAL TIME ZONE 'UTC'");
    await source.query("SET LOCAL statement_timeout = '30s'");
    await target.query("BEGIN");
    await target.query("SET LOCAL TIME ZONE 'UTC'");
    await target.query("SET LOCAL statement_timeout = '30s'");
    await target.query("SELECT pg_advisory_xact_lock(173824, 1064)");

    const sourceSchema = await inspectDatabaseSchema(source);
    const targetSchema = await inspectDatabaseSchema(target, config.schema);
    if (!sourceSchema.compatible || !targetSchema.compatible) {
      throw new Error("Both source and destination must match the app schema before copying.");
    }
    const tables = getOrderedMigrationTables();
    const sourceColumns = await source.query<{
      table_name: string; column_name: string; data_type: string;
      is_nullable: string; column_default: string | null;
    }>(
      "SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
    );
    const knownColumns = new Set(tables.flatMap((table) => table.columns.map((column) => `${table.name}.${column.name}`)));
    const retiredTables = new Set(["alter_egos", "alter_ego_portraits"]);
    if (sourceColumns.rows.some((column) =>
      column.table_name !== "__drizzle_migrations" && !retiredTables.has(column.table_name) &&
      !knownColumns.has(`${column.table_name}.${column.column_name}`))) {
      throw new Error("Unmodeled source tables or columns require review before copying.");
    }
    const archiveCount = await target.query<{ count: string }>(
      "SELECT count(*) FROM oldtime_archive.retired_table_definitions",
    );
    if (archiveCount.rows[0].count !== "0") throw new Error("Migration refuses to overwrite an existing archive.");
    for (const table of tables) {
      const name = `${quote(config.schema)}.${quote(table.name)}`;
      const count = await target.query<{ count: string }>(`SELECT count(*) FROM ${name}`);
      if (count.rows[0].count !== "0") throw new Error("Migration refuses to overwrite a nonempty destination.");
    }
    for (const table of tables) {
      const columns = table.columns.map((column) => column.name);
      const primary = [...new Set([
        ...table.columns.filter((column) => column.primary).map((column) => column.name),
        ...table.primaryKeys.flatMap((key) => key.columns.map((column) => column.name)),
      ])];
      if (!primary.length) throw new Error("Every migrated table requires a stable primary key.");
      const fields = columns.map((column) => `${quote(column)}::text AS ${quote(column)}`).join(",");
      const order = primary.map(quote).join(",");
      const name = `${quote(config.schema)}.${quote(table.name)}`;
      const sourceDigest = createHash("sha256");
      let rows = 0;
      for await (const page of readPages(source, `SELECT ${fields} FROM "public".${quote(table.name)} ORDER BY ${order}`)) {
        const values = page.flatMap((row) => columns.map((column) => row[column]));
        const placeholders = page.map((_row, rowIndex) =>
          `(${columns.map((_column, index) => `$${rowIndex * columns.length + index + 1}`).join(",")})`).join(",");
        await target.query(`INSERT INTO ${name} (${columns.map(quote).join(",")}) VALUES ${placeholders}`, values);
        for (const row of page) sourceDigest.update(JSON.stringify(columns.map((column) => row[column])) + "\n");
        rows += page.length;
      }
      const targetDigest = createHash("sha256");
      let verifiedRows = 0;
      for await (const page of readPages(target, `SELECT ${fields} FROM ${name} ORDER BY ${order}`)) {
        for (const row of page) targetDigest.update(JSON.stringify(columns.map((column) => row[column])) + "\n");
        verifiedRows += page.length;
      }
      if (rows !== verifiedRows || sourceDigest.digest("hex") !== targetDigest.digest("hex")) {
        throw new Error("Migration verification failed; the destination transaction will roll back.");
      }
      reports.push({ table: table.name, rows, checksumMatched: true });
    }
    for (const name of retiredTables) {
      const columns = sourceColumns.rows.filter((column) => column.table_name === name);
      if (!columns.length) continue;
      const constraints = await source.query(
        `SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
           FROM pg_catalog.pg_constraint c
           JOIN pg_catalog.pg_class t ON t.oid=c.conrelid
           JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
          WHERE n.nspname='public' AND t.relname=$1 ORDER BY c.conname`, [name],
      );
      await target.query(
        "INSERT INTO oldtime_archive.retired_table_definitions (source_table,definition) VALUES ($1,$2::jsonb)",
        [name, JSON.stringify({ columns, constraints: constraints.rows })],
      );
      const digest = createHash("sha256");
      let count = 0;
      for await (const page of readPages(source,
        `SELECT to_jsonb(record)::text AS data FROM "public".${quote(name)} record ORDER BY to_jsonb(record)::text COLLATE "C"`)) {
        for (const row of page) {
          count += 1;
          digest.update(row.data! + "\n");
          await target.query(
            "INSERT INTO oldtime_archive.retired_records(source_table,row_index,row_data) VALUES ($1,$2,$3::jsonb)",
            [name, count, row.data],
          );
        }
      }
      const verified = await target.query<{ data: string }>(
        "SELECT row_data::text AS data FROM oldtime_archive.retired_records WHERE source_table=$1 ORDER BY row_index", [name],
      );
      const targetDigest = createHash("sha256");
      for (const row of verified.rows) targetDigest.update(row.data + "\n");
      if (count !== verified.rows.length || digest.digest("hex") !== targetDigest.digest("hex")) {
        throw new Error("Retired record archive verification failed.");
      }
      archives.push({ table: name, rows: count, checksumMatched: true });
    }
    await target.query(commit ? "COMMIT" : "ROLLBACK");
    await source.query("ROLLBACK");
    return { copied: commit, rehearsal: !commit, schema: config.schema, sourceRetained: true, tables: reports, archives };
  } catch (error) {
    await target.query("ROLLBACK").catch(() => undefined);
    await source.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await Promise.all([source.end(), target.end()]);
  }
}
