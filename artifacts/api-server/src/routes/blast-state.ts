import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { blastStateTable, db, userMediaAssetsTable, usersTable } from "@workspace/db";
import { createRateLimiter, getAuthContext, requireAuth } from "../lib/auth";

const router = Router();
const scopes = ["social", "video-notes"] as const;
const mediaPattern = /^(?:(?:oldtime-media|media)-)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const MAX_STATE_BYTES = 2 * 1024 * 1024;
const socialStateSchema = z.object({
  version: z.literal(1),
  friendships: z.array(z.record(z.string(), z.unknown())).max(5000),
  friendRequests: z.array(z.record(z.string(), z.unknown())).max(5000),
  posts: z.array(z.record(z.string(), z.unknown())).max(5000),
  preferences: z.record(z.string(), z.unknown()),
  communityMemberships: z.array(z.record(z.string(), z.unknown())).max(5000),
}).passthrough();
const videoNotesStateSchema = z.object({
  version: z.literal(1),
  notes: z.array(z.record(z.string(), z.unknown())).max(5000),
  chats: z.array(z.record(z.string(), z.unknown())).max(5000),
  saved: z.array(z.record(z.string(), z.unknown())).max(10000),
}).passthrough();
const inputSchema = z.object({
  revision: z.number().int().min(0),
  data: z.record(z.string(), z.unknown()),
}).strict();

function collectMediaRefs(value: unknown, refs = new Set<string>(), inMediaField = false): Set<string> {
  if (typeof value === "string") {
    if (/^(?:data:(?:image|video|audio)\/|blob:)/i.test(value)) {
      throw new Error("Media must be uploaded to your account before syncing Blast.");
    }
    if (inMediaField) {
      const match = value.match(mediaPattern);
      if (!match) throw new Error("A Blast attachment has an invalid media reference.");
      refs.add(match[1]);
    }
    return refs;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMediaRefs(item, refs, inMediaField);
    return refs;
  }
  if (!value || typeof value !== "object") return refs;
  for (const [key, item] of Object.entries(value)) {
    const mediaField = ["mediaId", "mediaIds", "reference"].includes(key);
    collectMediaRefs(item, refs, mediaField);
  }
  return refs;
}

router.use("/blast/state", requireAuth, createRateLimiter("blast-state", 60));

router.get("/blast/state/:scope", async (req, res): Promise<void> => {
  const scope = String(req.params.scope || "");
  if (!scopes.includes(scope as (typeof scopes)[number])) {
    res.status(400).json({ error: "Blast data scope is invalid." });
    return;
  }
  const userId = getAuthContext(res).userId;
  const [record] = await db.select({
    revision: blastStateTable.revision,
    data: blastStateTable.data,
  }).from(blastStateTable).where(and(
    eq(blastStateTable.userId, userId),
    eq(blastStateTable.scope, scope),
  )).limit(1);
  res.json({ revision: record?.revision || 0, data: record?.data || null });
});

router.put("/blast/state/:scope", async (req, res): Promise<void> => {
  const scope = String(req.params.scope || "");
  if (!scopes.includes(scope as (typeof scopes)[number])) {
    res.status(400).json({ error: "Blast data scope is invalid." });
    return;
  }
  const parsed = inputSchema.safeParse(req.body);
  const validator = scope === "social" ? socialStateSchema : videoNotesStateSchema;
  if (!parsed.success || !validator.safeParse(parsed.data.data).success) {
    res.status(400).json({ error: "Blast data is invalid or too large to sync." });
    return;
  }
  if (Buffer.byteLength(JSON.stringify(parsed.data.data)) > MAX_STATE_BYTES) {
    res.status(413).json({ error: "Blast data exceeds the account sync limit." });
    return;
  }

  let mediaRefs: Set<string>;
  try {
    mediaRefs = collectMediaRefs(parsed.data.data);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Blast media references are invalid." });
    return;
  }

  const userId = getAuthContext(res).userId;
  if (mediaRefs.size) {
    const owned = await db.select({ id: userMediaAssetsTable.id }).from(userMediaAssetsTable)
      .where(and(
        eq(userMediaAssetsTable.userId, userId),
        eq(userMediaAssetsTable.ready, true),
        inArray(userMediaAssetsTable.id, [...mediaRefs]),
      ));
    if (owned.length !== mediaRefs.size) {
      res.status(400).json({ error: "Upload and verify every Blast attachment before syncing." });
      return;
    }
  }

  const result = await db.transaction(async tx => {
    await tx.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.id, userId)).for("update");
    const [current] = await tx.select({
      revision: blastStateTable.revision,
      data: blastStateTable.data,
    }).from(blastStateTable).where(and(
      eq(blastStateTable.userId, userId),
      eq(blastStateTable.scope, scope),
    )).limit(1);
    if ((current?.revision || 0) !== parsed.data.revision) return null;
    const revision = (current?.revision || 0) + 1;
    await tx.insert(blastStateTable).values({
      userId,
      scope,
      revision,
      data: parsed.data.data,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [blastStateTable.userId, blastStateTable.scope],
      set: { revision, data: parsed.data.data, updatedAt: new Date() },
    });
    return { revision, data: parsed.data.data };
  });
  if (!result) {
    res.status(409).json({ error: "Blast data changed in another session. Reload it and try again." });
    return;
  }
  res.json(result);
});

export default router;
