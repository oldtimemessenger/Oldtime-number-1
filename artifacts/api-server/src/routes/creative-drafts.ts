import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { creativeDraftsTable, db, userMediaAssetsTable } from "@workspace/db";
import { createRateLimiter, getAuthContext, requireAuth } from "../lib/auth";

const router = Router();
const contextPattern = /^[a-z0-9:_-]{1,120}$/i;
const mediaPattern = /^oldtime-media:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const draftSchema = z.object({
  version: z.literal(1),
  project: z.record(z.string(), z.unknown()),
  state: z.record(z.string(), z.unknown()),
  media: z.array(z.string().regex(mediaPattern)).max(100).refine(values => new Set(values).size === values.length),
  savedAt: z.number().int().nonnegative(),
}).strict();

router.use("/creative/drafts", requireAuth, createRateLimiter("creative-drafts", 40));

router.get("/creative/drafts/:context", async (req, res): Promise<void> => {
  const context = String(req.params.context || "");
  if (!contextPattern.test(context)) { res.status(400).json({ error: "Draft context is invalid." }); return; }
  const userId = getAuthContext(res).userId;
  const [record] = await db.select({ data: creativeDraftsTable.data })
    .from(creativeDraftsTable)
    .where(and(eq(creativeDraftsTable.userId, userId), eq(creativeDraftsTable.context, context)))
    .limit(1);
  res.json({ draft: record?.data || null });
});

router.put("/creative/drafts/:context", async (req, res): Promise<void> => {
  const context = String(req.params.context || "");
  if (!contextPattern.test(context)) { res.status(400).json({ error: "Draft context is invalid." }); return; }
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.success ? parsed.data : req.body || {})) > 2 * 1024 * 1024) {
    res.status(400).json({ error: "This draft is invalid or too large to save." });
    return;
  }
  const draft = parsed.data;
  const projectRefs = new Set<string>();
  let unsafeInlineMedia = false;
  const collect = (value: unknown) => {
    if (typeof value === "string") {
      if (/^(?:blob:|data:(?:image|video|audio)\/)/i.test(value)) unsafeInlineMedia = true;
      if (mediaPattern.test(value)) projectRefs.add(value);
    }
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(draft.project);
  collect(draft.state);
  const draftRefs = [...new Set(draft.media)];
  if (unsafeInlineMedia || projectRefs.size > 100 || [...projectRefs].some(reference => !draftRefs.includes(reference))) {
    res.status(400).json({ error: "Draft media references are incomplete." });
    return;
  }
  const userId = getAuthContext(res).userId;
  const mediaIds = draftRefs.map(reference => reference.match(mediaPattern)?.[1]).filter((id): id is string => !!id);
  if (mediaIds.length) {
    const owned = await db.select({ id: userMediaAssetsTable.id }).from(userMediaAssetsTable).where(and(
      inArray(userMediaAssetsTable.id, mediaIds),
      eq(userMediaAssetsTable.userId, userId),
      eq(userMediaAssetsTable.ready, true),
    ));
    if (owned.length !== mediaIds.length) {
      res.status(400).json({ error: "Upload and confirm every draft attachment before saving." });
      return;
    }
  }
  await db.insert(creativeDraftsTable).values({
    userId, context, data: draft, updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [creativeDraftsTable.userId, creativeDraftsTable.context],
    set: { data: draft, updatedAt: new Date() },
  });
  res.json({ ok: true, updatedAt: Date.now() });
});

router.delete("/creative/drafts/:context", async (req, res): Promise<void> => {
  const context = String(req.params.context || "");
  if (!contextPattern.test(context)) { res.status(400).json({ error: "Draft context is invalid." }); return; }
  const userId = getAuthContext(res).userId;
  await db.delete(creativeDraftsTable).where(and(
    eq(creativeDraftsTable.userId, userId), eq(creativeDraftsTable.context, context),
  ));
  res.sendStatus(204);
});

export default router;
