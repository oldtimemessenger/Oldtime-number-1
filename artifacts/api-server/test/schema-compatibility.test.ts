import assert from "node:assert/strict";
import test from "node:test";
import {
  compareDatabaseColumns,
  getDatabaseColumnContracts,
  type ColumnContract,
  type DatabaseColumn,
} from "@workspace/db/schema-compatibility";

const contracts: ColumnContract[] = [
  { table: "users", column: "id", type: "uuid", notNull: true, hasDefault: true },
  { table: "users", column: "email", type: "text", notNull: true, hasDefault: false },
  { table: "posts", column: "id", type: "uuid", notNull: true, hasDefault: true },
];
const columns: DatabaseColumn[] = contracts.map((column) => ({
  table_name: column.table,
  column_name: column.column,
  data_type: column.type,
  not_null: column.notNull,
  has_default: column.hasDefault,
}));

test("compatibility contract covers all actual exported database tables", () => {
  const all = getDatabaseColumnContracts();
  const tables = new Set(all.map((column) => column.table));
  for (const table of ["users", "sessions", "posts", "cognito_identities", "sports_workouts", "tournaments", "participation_boards", "analytics_resources"]) {
    assert.ok(tables.has(table), `missing contract for ${table}`);
  }
  assert.ok(tables.size > 40);
});

test("matching columns pass without reading or changing user records", () => {
  const report = compareDatabaseColumns(columns, contracts);
  assert.equal(report.compatible, true);
  assert.equal(report.matchingTables, 2);
});

test("an unrelated legacy schema never counts as a compatible empty app", () => {
  const report = compareDatabaseColumns([], contracts);
  assert.equal(report.compatible, false);
  assert.deepEqual(report.missingTables, ["posts", "users"]);
});

test("existing table names are insufficient when their columns differ", () => {
  const report = compareDatabaseColumns(columns.filter((column) => column.column_name !== "email"), contracts);
  assert.equal(report.compatible, false);
  assert.deepEqual(report.columnIssues, [{ table: "users", column: "email", problems: ["missing column"] }]);
});

test("UUID/integer identity mismatches are blocked", () => {
  const actual = columns.map((column) => ({ ...column, data_type: column.column_name === "id" ? "integer" : column.data_type }));
  const report = compareDatabaseColumns(actual, contracts);
  assert.equal(report.compatible, false);
  assert.equal(report.columnIssues.length, 2);
});

test("missing defaults and incompatible nullability are detected", () => {
  const actual = columns.map((column) => ({ ...column, has_default: false, not_null: false }));
  const report = compareDatabaseColumns(actual, contracts);
  assert.equal(report.compatible, false);
  assert.ok(report.columnIssues.some((issue) => issue.problems.includes("required database default missing")));
  assert.ok(report.columnIssues.some((issue) => issue.problems.includes("NOT NULL constraint missing")));
});

test("unknown required columns block inserts while optional extensions remain compatible", () => {
  const extra: DatabaseColumn = { table_name: "posts", column_name: "legacy_owner", data_type: "integer", not_null: true, has_default: false };
  assert.equal(compareDatabaseColumns([...columns, extra], contracts).compatible, false);
  assert.equal(compareDatabaseColumns([...columns, { ...extra, not_null: false }], contracts).compatible, true);
  assert.equal(compareDatabaseColumns([...columns, { ...extra, has_default: true }], contracts).compatible, true);
});
