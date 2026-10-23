import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { cognitoConfig, CognitoError, refreshCognitoAuthorization } from "./cognito";

function encryptionKey(secret = process.env.SESSION_SECRET) {
  if (!secret || secret.length < 32) throw new CognitoError(503, "Secure sign-in is unavailable.");
  return createHash("sha256").update(`oldtime:cognito-refresh:v1:${secret}`).digest();
}
export function encryptRefreshToken(token: string, secret?: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64url")).join(".");
}
export function decryptRefreshToken(value: string, secret?: string) {
  const parts = value.split(".");
  if (parts.length !== 3) throw new CognitoError(401, "Sign in again to renew your secure session.");
  try {
    const [iv, tag, encrypted] = parts.map(part => Buffer.from(part, "base64url"));
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof CognitoError && error.status === 503) throw error;
    throw new CognitoError(401, "Sign in again to renew your secure session.");
  }
}

// A database row lock coalesces renewal across simultaneous requests and server instances.
// Tokens are encrypted server-side and are never returned to the browser.
export async function renewCognitoSession(sessionId: string, userId: string, dependencies = {
  configuration: cognitoConfig, refreshAuthorization: refreshCognitoAuthorization,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT s.expires_at,g.issuer,g.subject,g.encrypted_refresh_token,g.refresh_until
       FROM sessions s JOIN cognito_grants g ON g.session_id=s.id
       WHERE s.id=$1 AND s.user_id=$2 FOR UPDATE OF s,g`, [sessionId, userId]);
    const grant = result.rows[0];
    if (!grant || new Date(grant.refresh_until).getTime() <= Date.now()) {
      await client.query("ROLLBACK"); return false;
    }
    if (new Date(grant.expires_at).getTime() > Date.now()) {
      await client.query("COMMIT"); return true;
    }
    const config = dependencies.configuration();
    if (!config || config.issuer !== grant.issuer) throw new CognitoError(503, "Secure sign-in is unavailable.");
    const identity = await dependencies.refreshAuthorization(config,
      decryptRefreshToken(grant.encrypted_refresh_token), grant.subject);
    await client.query("UPDATE sessions SET expires_at=$1 WHERE id=$2",
      [new Date(Math.min(identity.expiresAt, new Date(grant.refresh_until).getTime())), sessionId]);
    await client.query("UPDATE cognito_grants SET encrypted_refresh_token=$1 WHERE session_id=$2",
      [encryptRefreshToken(identity.refreshToken), sessionId]);
    await client.query("COMMIT"); return true;
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof CognitoError && error.status === 401) {
      await client.query("DELETE FROM sessions WHERE id=$1 AND user_id=$2", [sessionId, userId]);
      return false;
    }
    throw error;
  } finally { client.release(); }
}
