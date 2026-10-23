import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { RequestHandler, Response } from "express";
import { eq } from "drizzle-orm";
import { db, sessionsTable } from "@workspace/db";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_KEY_LENGTH = 64;

export interface AuthContext {
  userId: string;
  sessionId: string;
}

function derivePassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_KEY_LENGTH, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

export async function makePasswordCredentials(
  password: string,
): Promise<{ passwordSalt: string; passwordHash: string }> {
  const passwordSalt = randomBytes(16).toString("hex");
  const passwordHash = (await derivePassword(password, passwordSalt)).toString("hex");
  return { passwordSalt, passwordHash };
}

export async function verifyPassword(
  password: string,
  passwordSalt: string,
  passwordHash: string,
): Promise<boolean> {
  const expected = Buffer.from(passwordHash, "hex");
  if (expected.length !== PASSWORD_KEY_LENGTH) {
    return false;
  }
  const actual = await derivePassword(password, passwordSalt);
  return timingSafeEqual(actual, expected);
}

export function createAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function authenticateAccessToken(token: unknown): Promise<AuthContext | null> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    return null;
  }
  const [session] = await db
    .select({ id: sessionsTable.id, userId: sessionsTable.userId, expiresAt: sessionsTable.expiresAt })
    .from(sessionsTable)
    .where(eq(sessionsTable.tokenHash, hashAccessToken(token)))
    .limit(1);

  let authorized = Boolean(session && session.expiresAt.getTime() > Date.now());
  if (session && !authorized) {
    const { renewCognitoSession } = await import("./cognito-grants");
    authorized = await renewCognitoSession(session.id, session.userId);
  }
  return session && authorized ? { userId: session.userId, sessionId: session.id } : null;
}

export const requireAuth: RequestHandler = async (req, res, next): Promise<void> => {
  const authorization = req.header("authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9_-]{32,128})$/i.exec(authorization);
  if (!match) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }

  let context: AuthContext | null;
  try {
    context = await authenticateAccessToken(match[1]);
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 503) {
      res.status(503).json({ error: error.message });
      return;
    }
    throw error;
  }
  if (!context) {
    res.status(401).json({ error: "Your session has expired. Sign in again." });
    return;
  }

  res.locals.auth = context satisfies AuthContext;
  next();
};

export function getAuthContext(res: Response): AuthContext {
  const context = res.locals.auth as AuthContext | undefined;
  if (!context) {
    throw new Error("Authenticated route is missing its session context.");
  }
  return context;
}

export function createRateLimiter(scope: string, maxAttempts: number): RequestHandler {
  const windowMs = 60_000;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req, res, next): void => {
    const now = Date.now();
    const key = `${scope}:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    if (buckets.size > 10_000) {
      for (const [entryKey, entry] of buckets) {
        if (entry.resetAt <= now) {
          buckets.delete(entryKey);
        }
      }
    }

    if (bucket.count >= maxAttempts) {
      res.status(429).json({ error: "Too many attempts. Try again in a minute." });
      return;
    }

    bucket.count += 1;
    next();
  };
}
