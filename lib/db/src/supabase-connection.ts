export type SupabasePoolConfig = {
  connectionString: string;
  schema: string;
  options: string;
  sslMode: "require" | "verify-full";
  ssl: {
    ca?: string;
    rejectUnauthorized: boolean;
  };
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
};

/**
 * Runtime connections use Supabase's shared Session Pooler, not the paid
 * dedicated pooler. Keep this server-only: the database password must never
 * reach either client bundle.
 */
export function getSupabasePoolConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): SupabasePoolConfig {
  const connectionString = env.SUPABASE_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "APP_DATABASE_BACKEND=supabase requires the SUPABASE_DATABASE_URL secret.",
    );
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("SUPABASE_DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("SUPABASE_DATABASE_URL must use the PostgreSQL protocol.");
  }
  if (!url.hostname.endsWith(".pooler.supabase.com") || url.port !== "5432") {
    throw new Error(
      "Use the Supabase shared Session Pooler connection URL (port 5432) for this app runtime.",
    );
  }

  const urlSslMode = url.searchParams.get("sslmode")?.toLowerCase();
  const configuredSslMode = env.SUPABASE_DATABASE_SSL_MODE?.trim().toLowerCase();
  const sslMode = configuredSslMode || urlSslMode || "verify-full";
  if (sslMode !== "require" && sslMode !== "verify-full") {
    throw new Error(
      "SUPABASE_DATABASE_SSL_MODE must be require or verify-full; plaintext modes are not supported.",
    );
  }
  if (urlSslMode && urlSslMode !== sslMode) {
    throw new Error(
      "SUPABASE_DATABASE_SSL_MODE must match the sslmode in SUPABASE_DATABASE_URL.",
    );
  }

  const caCertificate = env.SUPABASE_DATABASE_CA_CERT?.trim().replace(/\\n/g, "\n");
  const schema = env.SUPABASE_DATABASE_SCHEMA?.trim() || "oldtime_app";
  if (!["public", "oldtime_app"].includes(schema)) {
    throw new Error("SUPABASE_DATABASE_SCHEMA must be public or oldtime_app.");
  }
  if (
    sslMode === "verify-full" &&
    (!caCertificate ||
      !caCertificate.includes("-----BEGIN CERTIFICATE-----") ||
      !caCertificate.includes("-----END CERTIFICATE-----"))
  ) {
    throw new Error(
      "SUPABASE_DATABASE_SSL_MODE=verify-full requires the official SUPABASE_DATABASE_CA_CERT secret.",
    );
  }

  // Pass TLS options directly to node-postgres. Its connection-string parser
  // replaces an explicit `ssl.ca` value when SSL parameters remain in the URL.
  for (const key of [
    "ssl",
    "sslmode",
    "sslrootcert",
    "sslcert",
    "sslkey",
    "sslpassword",
    "sslnegotiation",
    "options",
  ]) {
    url.searchParams.delete(key);
  }

  return {
    connectionString: url.toString(),
    schema,
    options: `-c search_path=${schema},pg_catalog`,
    sslMode,
    ssl:
      sslMode === "verify-full"
        ? { ca: caCertificate!, rejectUnauthorized: true }
        : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  };
}
