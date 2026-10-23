import { pool } from "@workspace/db";

// Explicit workspace-owner operation. No account gets admin by signing up first.
const [operation, username] = process.argv.slice(2);
if (!["--grant", "--revoke"].includes(operation) || !/^[a-z0-9_]{3,24}$/i.test(username ?? "")) {
  throw new Error("Usage: pnpm --filter @workspace/scripts run creator-admin --grant|--revoke <username>");
}
try {
  const result = await pool.query(
    `INSERT INTO creator_program_accounts (user_id,is_admin)
     SELECT id,$1 FROM users WHERE username=$2
     ON CONFLICT (user_id) DO UPDATE SET is_admin=EXCLUDED.is_admin RETURNING user_id`,
    [operation === "--grant", username.toLowerCase()],
  );
  if (result.rowCount !== 1) throw new Error("An existing online account with that username is required.");
  process.stdout.write(operation === "--grant" ? "Creator administrator access granted.\n" : "Creator administrator access revoked.\n");
} finally {
  await pool.end();
}
