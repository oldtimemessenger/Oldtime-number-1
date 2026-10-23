import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";
import { pool } from "@workspace/db";
import { createCognitoAccountSession } from "../src/lib/cognito-accounts";
import { decryptRefreshToken, encryptRefreshToken, renewCognitoSession } from "../src/lib/cognito-grants";
import { cognitoConfig, CognitoError, type CognitoAuthorization } from "../src/lib/cognito";

const emails: string[] = [];
const issuer = "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_AuditPool";
function identity(): CognitoAuthorization {
  const suffix = randomBytes(12).toString("hex");
  const email = `cognito_fixture_${suffix}@example.test`;
  emails.push(email);
  return { issuer, subject: suffix, email, displayName: "Cognito Test Fixture",
    expiresAt: Date.now() + 60_000, refreshToken: `fixture-refresh-${suffix}` };
}
async function existingUser(email: string) {
  if (!emails.includes(email)) emails.push(email);
  const result = await pool.query(
    `INSERT INTO users (email,username,display_name,password_salt,password_hash)
     VALUES ($1,$2,'Existing Fixture','existing-fixture-salt',$3) RETURNING *`,
    [email, `test_${randomBytes(8).toString("hex")}`, randomBytes(64).toString("hex")]);
  return result.rows[0];
}
after(async () => {
  try { if (emails.length) await pool.query("DELETE FROM users WHERE email=ANY($1::text[])", [emails]); }
  finally { await pool.end(); }
});
const key = "test-only-encryption-key-not-a-real-user-secret".repeat(2);
test("refresh tokens are encrypted with randomized authenticated encryption", () => {
  const first = encryptRefreshToken("fixture-token", key), second = encryptRefreshToken("fixture-token", key);
  assert.notEqual(first, second);
  assert.ok(!first.includes("fixture-token"));
  assert.equal(decryptRefreshToken(first, key), "fixture-token");
  assert.throws(() => decryptRefreshToken(first, "other-test-only-key".repeat(3)));
  const parts = first.split(".");
  parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  assert.throws(() => decryptRefreshToken(parts.join("."), key));
  assert.throws(() => encryptRefreshToken("fixture", "short"));
});
test("concurrent first sign-ins use one canonical account and only store hashed/encrypted tokens", async () => {
  const verified = identity();
  const results = await Promise.all([createCognitoAccountSession(verified), createCognitoAccountSession(verified)]);
  assert.equal(results[0].account.id, results[1].account.id);
  assert.notEqual(results[0].accessToken, results[1].accessToken);
  const records = await pool.query(
    `SELECT s.token_hash,g.encrypted_refresh_token,s.expires_at,g.refresh_until FROM sessions s
     JOIN cognito_grants g ON g.session_id=s.id WHERE s.user_id=$1`, [results[0].account.id]);
  assert.equal(records.rows.length, 2);
  for (const row of records.rows) {
    assert.notEqual(row.token_hash, results[0].accessToken);
    assert.notEqual(row.encrypted_refresh_token, verified.refreshToken);
    assert.equal(decryptRefreshToken(row.encrypted_refresh_token), verified.refreshToken);
    assert.ok(new Date(row.expires_at).getTime() <= verified.expiresAt);
  }
  assert.equal("refreshToken" in results[0], false);
});
test("email equality alone cannot merge an existing account", async () => {
  const verified = identity(), original = await existingUser(verified.email);
  await assert.rejects(createCognitoAccountSession(verified), error =>
    error instanceof CognitoError && error.status === 409);
  const bindings = await pool.query("SELECT * FROM cognito_identities WHERE user_id=$1", [original.id]);
  assert.equal(bindings.rows.length, 0);
});
test("explicit authenticated linking preserves the original UUID, profile and password credentials", async () => {
  const verified = identity(), original = await existingUser(verified.email);
  const linked = await createCognitoAccountSession(verified, original.id);
  assert.equal(linked.account.id, original.id);
  assert.equal(linked.account.username, original.username);
  assert.equal(linked.account.displayName, original.display_name);
  const rows = await pool.query("SELECT * FROM users WHERE id=$1", [original.id]);
  assert.equal(rows.rows[0].password_hash, original.password_hash);
  assert.equal(rows.rows[0].password_salt, original.password_salt);
  assert.equal(new Date(rows.rows[0].created_at).getTime(), new Date(original.created_at).getTime());
  assert.equal((await createCognitoAccountSession(verified)).account.id, original.id);
});
test("linking a different email or an already-owned identity is rejected without altering accounts", async () => {
  const first = identity(), second = identity();
  const userA = await existingUser(first.email), userB = await existingUser(second.email);
  await assert.rejects(createCognitoAccountSession(first, userB.id), error =>
    error instanceof CognitoError && error.status === 403);
  await createCognitoAccountSession(first, userA.id);
  await assert.rejects(createCognitoAccountSession(first, userB.id), error =>
    error instanceof CognitoError && error.status === 409);
  const bindings = await pool.query("SELECT user_id FROM cognito_identities WHERE issuer=$1 AND subject=$2",
    [issuer, first.subject]);
  assert.deepEqual(bindings.rows.map(row => row.user_id), [userA.id]);
});
test("concurrent expired requests renew one grant and persist a rotated encrypted refresh token", async () => {
  const verified = identity(), result = await createCognitoAccountSession(verified);
  const sessions = await pool.query("UPDATE sessions SET expires_at=now()-interval '1 minute' WHERE user_id=$1 RETURNING id",
    [result.account.id]);
  const config = cognitoConfig({ COGNITO_ENABLED: "true", COGNITO_REGION: "us-east-2",
    COGNITO_USER_POOL_ID: "us-east-2_AuditPool", COGNITO_CLIENT_ID: "auditclient",
    COGNITO_DOMAIN: "https://audit.auth.us-east-2.amazoncognito.com",
    COGNITO_REDIRECT_URIS: "https://oldtime.example/" })!;
  let renewals = 0;
  const dependencies = { configuration: () => config,
    refreshAuthorization: async (_config: typeof config, token: string, subject: string) => {
      assert.equal(token, verified.refreshToken); assert.equal(subject, verified.subject);
      renewals++;
      return { ...verified, expiresAt: Date.now() + 60_000, refreshToken: "rotated-fixture-token" };
    } };
  const id = sessions.rows[0].id;
  const results = await Promise.all([
    renewCognitoSession(id, result.account.id, dependencies), renewCognitoSession(id, result.account.id, dependencies),
  ]);
  assert.deepEqual(results, [true, true]);
  assert.equal(renewals, 1);
  const grant = await pool.query("SELECT encrypted_refresh_token FROM cognito_grants WHERE session_id=$1", [id]);
  assert.equal(decryptRefreshToken(grant.rows[0].encrypted_refresh_token), "rotated-fixture-token");
});
test("provider revocation deletes only that session and grant, not the account or its other sessions", async () => {
  const verified = identity();
  const first = await createCognitoAccountSession(verified), second = await createCognitoAccountSession(verified);
  const sessions = await pool.query("SELECT id FROM sessions WHERE user_id=$1 ORDER BY created_at", [first.account.id]);
  const id = sessions.rows[0].id;
  await pool.query("UPDATE sessions SET expires_at=now()-interval '1 minute' WHERE id=$1", [id]);
  const config = cognitoConfig({ COGNITO_ENABLED: "true", COGNITO_REGION: "us-east-2",
    COGNITO_USER_POOL_ID: "us-east-2_AuditPool", COGNITO_CLIENT_ID: "auditclient",
    COGNITO_DOMAIN: "https://audit.auth.us-east-2.amazoncognito.com", COGNITO_REDIRECT_URIS: "https://oldtime.example/" })!;
  const renewed = await renewCognitoSession(id, first.account.id, { configuration: () => config,
    refreshAuthorization: async () => { throw new CognitoError(401, "Revoked fixture"); } });
  assert.equal(renewed, false);
  assert.equal((await pool.query("SELECT session_id FROM cognito_grants WHERE session_id=$1", [id])).rows.length, 0);
  assert.equal((await pool.query("SELECT id FROM sessions WHERE user_id=$1", [second.account.id])).rows.length, 1);
  assert.equal((await pool.query("SELECT id FROM users WHERE id=$1", [first.account.id])).rows.length, 1);
});
