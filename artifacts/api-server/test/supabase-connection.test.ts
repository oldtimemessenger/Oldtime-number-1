import assert from "node:assert/strict";
import test from "node:test";
import { getSupabasePoolConfig } from "@workspace/db/supabase";

test("Supabase runtime config accepts the shared Session Pooler with verified TLS", () => {
  const config = getSupabasePoolConfig({
    SUPABASE_DATABASE_URL:
      "postgresql://postgres.projectref:encoded-password@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=verify-full",
    SUPABASE_DATABASE_SSL_MODE: "verify-full",
    SUPABASE_DATABASE_CA_CERT:
      "-----BEGIN CERTIFICATE-----\npublic-test-certificate\n-----END CERTIFICATE-----",
  });
  assert.equal(config.schema, "oldtime_app");
  assert.equal(config.max, 5);
  assert.equal(config.idleTimeoutMillis, 10_000);
  assert.equal(config.connectionTimeoutMillis, 5_000);
  assert.match(config.connectionString, /pooler\.supabase\.com/);
  assert.equal(new URL(config.connectionString).searchParams.has("sslmode"), false);
  assert.equal(config.sslMode, "verify-full");
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.match(config.ssl.ca, /BEGIN CERTIFICATE/);
});

test("Supabase runtime config supports encrypted TLS without CA verification when explicitly selected", () => {
  const config = getSupabasePoolConfig({
    SUPABASE_DATABASE_URL:
      "postgresql://postgres.projectref:encoded-password@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require",
    SUPABASE_DATABASE_SSL_MODE: "require",
  });
  assert.equal(config.sslMode, "require");
  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
  assert.equal(new URL(config.connectionString).searchParams.has("sslmode"), false);
});

test("Supabase runtime config removes SSL query options so the verified CA is preserved", () => {
  const config = getSupabasePoolConfig({
    SUPABASE_DATABASE_URL:
      "postgresql://postgres.projectref:encoded-password@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=%2Ftmp%2Fother.crt",
    SUPABASE_DATABASE_SSL_MODE: "verify-full",
    SUPABASE_DATABASE_CA_CERT:
      "-----BEGIN CERTIFICATE-----\npublic-test-certificate\n-----END CERTIFICATE-----",
  });
  const url = new URL(config.connectionString);
  assert.equal(url.searchParams.has("sslrootcert"), false);
  assert.equal(config.ssl.ca.includes("public-test-certificate"), true);
});

test("Supabase runtime config rejects plaintext connection URLs", () => {
  assert.throws(
    () =>
      getSupabasePoolConfig({
        SUPABASE_DATABASE_URL:
          "postgresql://postgres.projectref:encoded-password@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=disable",
      }),
    /plaintext modes are not supported/,
  );
});

test("Supabase runtime config rejects conflicting URL and environment SSL modes", () => {
  assert.throws(
    () =>
      getSupabasePoolConfig({
        SUPABASE_DATABASE_URL:
          "postgresql://postgres.projectref:encoded-password@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=verify-full",
        SUPABASE_DATABASE_SSL_MODE: "require",
      }),
    /must match the sslmode/,
  );
});

test("Supabase runtime config rejects direct and paid-pooler URLs for this low-cost setup", () => {
  assert.throws(
    () =>
      getSupabasePoolConfig({
        SUPABASE_DATABASE_URL:
          "postgresql://postgres:encoded-password@db.projectref.supabase.co:5432/postgres?sslmode=require",
        SUPABASE_DATABASE_SSL_MODE: "require",
      }),
    /shared Session Pooler/,
  );
});

test("Supabase backend selection fails clearly if its secret is missing", () => {
  assert.throws(
    () => getSupabasePoolConfig({}),
    /requires the SUPABASE_DATABASE_URL secret/,
  );
});

test("Supabase verified TLS requires a PEM CA certificate", () => {
  assert.throws(
    () =>
      getSupabasePoolConfig({
        SUPABASE_DATABASE_URL:
          "postgresql://postgres.projectref:encoded-password@aws-0-us-east-2.pooler.supabase.com:5432/postgres",
      }),
    /SUPABASE_DATABASE_SSL_MODE=verify-full requires the official SUPABASE_DATABASE_CA_CERT secret/,
  );
});

test("isolated Supabase schema controls search_path rather than connection URL options", () => {
  const config = getSupabasePoolConfig({
    SUPABASE_DATABASE_URL: "postgresql://postgres.projectref:password@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require&options=-c%20search_path%3Dpublic",
    SUPABASE_DATABASE_SCHEMA: "oldtime_app",
  });
  assert.equal(config.schema, "oldtime_app");
  assert.equal(config.options, "-c search_path=oldtime_app,pg_catalog");
  assert.equal(new URL(config.connectionString).searchParams.has("options"), false);
});

test("invalid or legacy schema targets cannot be selected accidentally", () => {
  assert.throws(() => getSupabasePoolConfig({
    SUPABASE_DATABASE_URL: "postgresql://postgres.projectref:password@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require",
    SUPABASE_DATABASE_SCHEMA: "old_time",
  }), /public or oldtime_app/);
});
