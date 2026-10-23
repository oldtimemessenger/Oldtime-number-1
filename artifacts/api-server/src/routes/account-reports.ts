import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { contentReportsTable } from "@workspace/db/schema";
import { createRateLimiter, getAuthContext, requireAuth } from "../lib/auth";

const router = Router();
const reportSchema = z.object({
  kind: z.enum(["problem", "profile", "post", "story", "comment"]),
  category: z.string().trim().min(1).max(80),
  targetUserId: z.string().uuid().optional(),
  postId: z.string().trim().min(1).max(128).optional(),
  commentId: z.string().trim().min(1).max(128).optional(),
  reason: z.string().trim().min(10).max(1000),
}).strict();

router.use("/account/reports", requireAuth, createRateLimiter("account-reports", 30));

router.get("/account/reports", async (_req, res): Promise<void> => {
  const reporterId = getAuthContext(res).userId;
  const reports = await db.select({
    id: contentReportsTable.id,
    kind: contentReportsTable.kind,
    category: contentReportsTable.category,
    reason: contentReportsTable.reason,
    status: contentReportsTable.status,
    createdAt: contentReportsTable.createdAt,
  }).from(contentReportsTable)
    .where(eq(contentReportsTable.reporterId, reporterId))
    .orderBy(desc(contentReportsTable.createdAt))
    .limit(100);
  res.json({ reports });
});

router.post("/account/reports", async (req, res): Promise<void> => {
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Add a valid report description before submitting." });
    return;
  }
  const reporterId = getAuthContext(res).userId;
  const input = parsed.data;
  if (input.kind === "profile" && !input.targetUserId) {
    res.status(400).json({ error: "Choose a profile to report." });
    return;
  }
  const [report] = await db.insert(contentReportsTable).values({
    reporterId,
    targetUserId: input.targetUserId || null,
    kind: input.kind,
    category: input.category,
    postId: input.postId || null,
    commentId: input.commentId || null,
    reason: input.reason,
  }).returning({
    id: contentReportsTable.id,
    status: contentReportsTable.status,
    createdAt: contentReportsTable.createdAt,
  });
  res.status(201).json({ report });
});

export default router;
