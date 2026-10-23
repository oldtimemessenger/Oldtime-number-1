import { Router, type IRouter } from "express";
import { and, eq, lt, ne, or, sql } from "drizzle-orm";
import {
  ChangeAccountPasswordBody,
  LoginAccountBody,
  RegisterAccountBody,
} from "@workspace/api-zod";
import type {
  Account,
  AuthResponse,
  ErrorResponse,
  PasswordChangeResponse,
} from "@workspace/api-zod";
import { db, sessionsTable, usersTable } from "@workspace/db";
import {
  createAccessToken,
  createRateLimiter,
  getAuthContext,
  hashAccessToken,
  makePasswordCredentials,
  requireAuth,
  SESSION_TTL_MS,
  verifyPassword,
} from "../lib/auth";

const router: IRouter = Router();

const limitRegistrations = createRateLimiter("register", 5);
const limitLogins = createRateLimiter("login", 10);
const limitPasswordChanges = createRateLimiter("password-change", 5);

// An expired access token can still have a valid Cognito refresh grant.
// Unrelated registrations/logins must not revoke those sessions.
function expiredUnrenewableSessions() {
  return and(
    lt(sessionsTable.expiresAt, new Date()),
    sql`NOT EXISTS (
      SELECT 1 FROM cognito_grants g
      WHERE g.session_id = ${sessionsTable.id} AND g.refresh_until > now()
    )`,
  );
}

function toAccount(user: typeof usersTable.$inferSelect): Account {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    joinedAt: user.createdAt.getTime(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

router.post("/auth/register", limitRegistrations, async (req, res): Promise<void> => {
  const parsed = RegisterAccountBody.safeParse(req.body);
  if (!parsed.success) {
    const response: ErrorResponse = { error: "Check the account details and try again." };
    res.status(400).json(response);
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const username = parsed.data.username.trim().toLowerCase();
  const displayName = parsed.data.displayName.trim();
  if (!email || !username || !displayName) {
    const response: ErrorResponse = { error: "Email, username, and name are required." };
    res.status(400).json(response);
    return;
  }

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(or(eq(usersTable.email, email), eq(usersTable.username, username)))
    .limit(1);
  if (existing) {
    const response: ErrorResponse = {
      error: "That email or username is already in use.",
    };
    res.status(409).json(response);
    return;
  }

  const credentials = await makePasswordCredentials(parsed.data.password);
  const accessToken = createAccessToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  try {
    const account = await db.transaction(async (tx) => {
      await tx.delete(sessionsTable).where(expiredUnrenewableSessions());
      const [user] = await tx
        .insert(usersTable)
        .values({
          email,
          username,
          displayName,
          ...credentials,
        })
        .returning();
      await tx.insert(sessionsTable).values({
        userId: user.id,
        tokenHash: hashAccessToken(accessToken),
        expiresAt,
      });
      return user;
    });

    const response: AuthResponse = {
      accessToken,
      tokenType: "Bearer",
      expiresAt: expiresAt.getTime(),
      account: toAccount(account),
    };
    res.status(201).json(response);
  } catch (error) {
    if (isUniqueViolation(error)) {
      const response: ErrorResponse = {
        error: "That email or username is already in use.",
      };
      res.status(409).json(response);
      return;
    }
    throw error;
  }
});

router.post("/auth/login", limitLogins, async (req, res): Promise<void> => {
  const parsed = LoginAccountBody.safeParse(req.body);
  if (!parsed.success) {
    const response: ErrorResponse = { error: "Enter your email or username and password." };
    res.status(400).json(response);
    return;
  }

  const identifier = parsed.data.identifier.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(usersTable)
    .where(
      or(
        eq(usersTable.email, identifier),
        eq(usersTable.username, identifier),
      ),
    )
    .limit(1);

  if (
    !user ||
    !(await verifyPassword(parsed.data.password, user.passwordSalt, user.passwordHash))
  ) {
    const response: ErrorResponse = { error: "Email, username, or password is incorrect." };
    res.status(401).json(response);
    return;
  }

  const accessToken = createAccessToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.transaction(async (tx) => {
    await tx.delete(sessionsTable).where(expiredUnrenewableSessions());
    await tx.insert(sessionsTable).values({
      userId: user.id,
      tokenHash: hashAccessToken(accessToken),
      expiresAt,
    });
  });

  const response: AuthResponse = {
    accessToken,
    tokenType: "Bearer",
    expiresAt: expiresAt.getTime(),
    account: toAccount(user),
  };
  res.json(response);
});

router.post("/auth/password", requireAuth, limitPasswordChanges, async (req, res): Promise<void> => {
  const parsed = ChangeAccountPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    const response: ErrorResponse = {
      error: "Passwords must be between 8 and 128 characters.",
    };
    res.status(400).json(response);
    return;
  }

  const { userId, sessionId } = getAuthContext(res);
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) {
    const response: ErrorResponse = { error: "Account not found." };
    res.status(404).json(response);
    return;
  }

  if (!(await verifyPassword(parsed.data.currentPassword, user.passwordSalt, user.passwordHash))) {
    const response: ErrorResponse = { error: "The current password is incorrect." };
    res.status(401).json(response);
    return;
  }

  if (parsed.data.currentPassword === parsed.data.newPassword) {
    const response: ErrorResponse = { error: "Choose a different new password." };
    res.status(400).json(response);
    return;
  }

  const credentials = await makePasswordCredentials(parsed.data.newPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set(credentials)
      .where(eq(usersTable.id, userId));
    await tx
      .delete(sessionsTable)
      .where(and(eq(sessionsTable.userId, userId), ne(sessionsTable.id, sessionId)));
  });

  res.json({ ok: true } satisfies PasswordChangeResponse);
});

router.get("/auth/me", requireAuth, async (_req, res): Promise<void> => {
  const { userId } = getAuthContext(res);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);

  if (!user) {
    const response: ErrorResponse = { error: "Account not found." };
    res.status(404).json(response);
    return;
  }

  res.json({ account: toAccount(user) } satisfies { account: Account });
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = /^Bearer\s+([A-Za-z0-9_-]{32,128})$/i.exec(req.header("authorization") || "")?.[1];
  if (!token) { res.status(401).json({ error: "Sign in required" }); return; }
  // Revocation must work even after provider expiry or during a provider outage.
  // Possession only authorizes deleting this token, never changing account data.
  await db.delete(sessionsTable).where(eq(sessionsTable.tokenHash, hashAccessToken(token)));
  res.json({ ok: true });
});

export default router;
