import { randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { createAccessToken, hashAccessToken, SESSION_TTL_MS } from "./auth";
import { CognitoError, type CognitoAuthorization } from "./cognito";
import { encryptRefreshToken } from "./cognito-grants";

// Never merge accounts merely because two records claim the same email.
// Existing accounts require a current Oldtime session plus a verified matching identity.
export async function createCognitoAccountSession(identity: CognitoAuthorization, linkUserId?: string) {
  const encryptedRefreshToken = encryptRefreshToken(identity.refreshToken);
  const client = await pool.connect();
  const accessToken = createAccessToken();
  const refreshUntil = Date.now() + SESSION_TTL_MS;
  const expiresAt = Math.min(identity.expiresAt, refreshUntil);
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${identity.issuer}:${identity.subject}`]);
    const existing = await client.query(
      `SELECT u.id,u.email,u.username,u.display_name,u.created_at FROM cognito_identities i
       JOIN users u ON u.id=i.user_id WHERE i.issuer=$1 AND i.subject=$2`,
      [identity.issuer, identity.subject]);
    let user = existing.rows[0];
    if (user && linkUserId && user.id !== linkUserId) {
      throw new CognitoError(409, "This sign-in is already connected to another account.");
    }
    if (!user) {
      if (linkUserId) {
        const target = await client.query(
          "SELECT id,email,username,display_name,created_at FROM users WHERE id=$1 FOR UPDATE", [linkUserId]);
        user = target.rows[0];
        if (!user || user.email.trim().toLowerCase() !== identity.email) {
          throw new CognitoError(403, "The verified email must match your existing account.");
        }
      } else {
        const emailOwner = await client.query("SELECT id FROM users WHERE lower(email)=$1 LIMIT 1", [identity.email]);
        if (emailOwner.rows.length) throw new CognitoError(409,
          "An Oldtime account already uses this email. Log in to that account and connect secure sign-in in Settings.");
        const created = await client.query(
          `INSERT INTO users (email,username,display_name,password_salt,password_hash)
           VALUES ($1,$2,$3,$4,$5) RETURNING id,email,username,display_name,created_at`,
          [identity.email, `member_${randomBytes(8).toString("hex")}`, identity.displayName,
            randomBytes(16).toString("hex"), randomBytes(64).toString("hex")]);
        user = created.rows[0];
      }
      await client.query("INSERT INTO cognito_identities (issuer,subject,user_id) VALUES ($1,$2,$3)",
        [identity.issuer, identity.subject, user.id]);
    }
    const session = await client.query("INSERT INTO sessions (user_id,token_hash,expires_at) VALUES ($1,$2,$3) RETURNING id",
      [user.id, hashAccessToken(accessToken), new Date(expiresAt)]);
    await client.query(
      "INSERT INTO cognito_grants (session_id,issuer,subject,encrypted_refresh_token,refresh_until) VALUES ($1,$2,$3,$4,$5)",
      [session.rows[0].id, identity.issuer, identity.subject, encryptedRefreshToken, new Date(refreshUntil)]);
    await client.query("COMMIT");
    return {
      accessToken, tokenType: "Bearer" as const, expiresAt: refreshUntil, authProvider: "cognito" as const,
      account: { id: user.id, email: user.email, username: user.username,
        displayName: user.display_name, joinedAt: new Date(user.created_at).getTime() },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      throw new CognitoError(409, "This email or sign-in is already connected. Use your existing account.");
    }
    throw error;
  } finally { client.release(); }
}
