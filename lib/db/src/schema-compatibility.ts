import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import type pg from "pg";
import * as schema from "./schema";

export type ColumnContract = {
  table: string;
  column: string;
  type: string;
  notNull: boolean;
  hasDefault: boolean;
};

export type DatabaseColumn = {
  table_name: string;
  column_name: string;
  data_type: string;
  not_null: boolean;
  has_default: boolean;
};

export type SchemaCompatibility = {
  schema: string;
  expectedTables: number;
  matchingTables: number;
  missingTables: string[];
  columnIssues: {
    table: string;
    column: string;
    problems: string[];
  }[];
  compatible: boolean;
};

function normalizeType(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
    .replace(/^int4$/, "integer")
    .replace(/^int8$/, "bigint")
    .replace(/^bool$/, "boolean")
    .replace(/^timestamptz$/, "timestamp with time zone");
}

export function getDatabaseColumnContracts(): ColumnContract[] {
  return Object.values(schema).flatMap((value) => {
    if (!is(value, PgTable)) return [];
    const table = getTableConfig(value);
    return table.columns.map((column) => ({
      table: table.name,
      column: column.name,
      type: normalizeType(column.getSQLType()),
      notNull: column.notNull,
      hasDefault: column.hasDefault,
    }));
  });
}

export function compareDatabaseColumns(
  columns: DatabaseColumn[],
  contracts = getDatabaseColumnContracts(),
  schemaName = "public",
): SchemaCompatibility {
  const expected = [...new Set(contracts.map((column) => column.table))].sort();
  const actualTables = new Set(columns.map((column) => column.table_name));
  const actualColumns = new Map(
    columns.map((column) => [`${column.table_name}.${column.column_name}`, column]),
  );
  const missingTables = expected.filter((table) => !actualTables.has(table));
  const columnIssues: SchemaCompatibility["columnIssues"] = [];

  for (const contract of contracts) {
    if (!actualTables.has(contract.table)) continue;
    const actual = actualColumns.get(`${contract.table}.${contract.column}`);
    const problems: string[] = [];
    if (!actual) {
      problems.push("missing column");
    } else {
      if (normalizeType(actual.data_type) !== contract.type) {
        problems.push(`expected ${contract.type}; found ${actual.data_type}`);
      }
      if (contract.notNull !== actual.not_null) {
        problems.push(contract.notNull ? "NOT NULL constraint missing" : "unexpected NOT NULL constraint");
      }
      if (contract.hasDefault && !actual.has_default) {
        problems.push("required database default missing");
      }
    }
    if (problems.length) {
      columnIssues.push({ table: contract.table, column: contract.column, problems });
    }
  }

  // Extra required columns without a default can break inserts, even when
  // every column that the API knows about exists.
  const expectedColumns = new Set(contracts.map((column) => `${column.table}.${column.column}`));
  for (const actual of columns) {
    if (
      expected.includes(actual.table_name) &&
      !expectedColumns.has(`${actual.table_name}.${actual.column_name}`) &&
      actual.not_null && !actual.has_default
    ) {
      columnIssues.push({
        table: actual.table_name,
        column: actual.column_name,
        problems: ["extra required column has no default; API inserts would fail"],
      });
    }
  }

  const incompatibleTables = new Set(columnIssues.map((issue) => issue.table));
  return {
    schema: schemaName,
    expectedTables: expected.length,
    matchingTables: expected.filter((table) => actualTables.has(table) && !incompatibleTables.has(table)).length,
    missingTables,
    columnIssues,
    compatible: missingTables.length === 0 && columnIssues.length === 0,
  };
}

export async function inspectDatabaseSchema(
  reader: Pick<pg.Pool, "query">,
  schemaName = "public",
): Promise<SchemaCompatibility> {
  const result = await reader.query<DatabaseColumn>(`
    SELECT c.relname AS table_name, a.attname AS column_name,
           pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
           a.attnotnull AS not_null,
           (d.oid IS NOT NULL OR a.attidentity <> '' OR a.attgenerated <> '') AS has_default
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY c.relname, a.attnum
  `, [schemaName]);
  return compareDatabaseColumns(result.rows, undefined, schemaName);
}

export async function assertDatabaseSchemaCompatible(reader: Pick<pg.Pool, "query">, schemaName = "public"): Promise<void> {
  const report = await inspectDatabaseSchema(reader, schemaName);
  if (!report.compatible) {
    throw new Error(
      `Supabase schema is incompatible: ${report.missingTables.length} missing tables and ` +
      `${report.columnIssues.length} column issues. Run pnpm --filter @workspace/scripts run supabase:check. ` +
      "No automatic schema changes were applied.",
    );
  }
}
