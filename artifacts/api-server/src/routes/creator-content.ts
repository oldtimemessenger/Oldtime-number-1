import { createHash } from "node:crypto";
import { Router, type IRouter, type ErrorRequestHandler } from "express";
import { notifyAccountActivity } from "../lib/live-gateway";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool, creatorMediaTable, creatorContentTable, postsTable, postCommentsTable, postCommentReactionsTable, usersTable } from "@workspace/db";
import { RequestCreatorMediaUploadBody, SyncCreatorOriginalBody, AddCloudPostCommentBody } from "@workspace/api-zod";
import { requireAuth, getAuthContext, createRateLimiter } from "../lib/auth";
import { reserveMedia, confirmMedia, deleteCreatorMedia } from "../lib/creator-media-storage";
import { refreshCreatorsAfterActivity } from "../lib/creator-program";
import { requireCreatorAccount } from "../lib/account-professional";
import { postVisibilityForViewer } from "./social";

const router: IRouter = Router();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normal = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const meaningful = (s: string) => s.trim().length >= 20 && s.trim().split(/\s+/).length >= 3;
router.use(["/creator/content", "/posts/:postId/comments"], requireAuth, createRateLimiter("creator-content", 60));

router.post("/creator/content/upload", requireCreatorAccount, createRateLimiter("creator-upload", 20), async (req, res) => {
  const parsed = RequestCreatorMediaUploadBody.safeParse(req.body);
  if (!parsed.success || Object.keys(req.body).some(k => !["contentType", "size"].includes(k))) {
    res.status(400).json({ error: "Choose a supported image or video file." }); return;
  }
  const userId = getAuthContext(res).userId;
  const reserved = await reserveMedia(parsed.data.contentType);
  const [asset] = await db.insert(creatorMediaTable).values({
    userId, objectPath: reserved.path, contentType: parsed.data.contentType, size: parsed.data.size,
  }).returning({ id: creatorMediaTable.id });
  res.setHeader("Cache-Control", "no-store");
  res.json({ id: asset.id, upload: reserved.upload });
});

router.get("/creator/content", async (_req, res) => {
  const { rows } = await pool.query("SELECT id,source_id AS \"sourceId\",original FROM creator_original_content WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 10000", [getAuthContext(res).userId]);
  res.setHeader("Cache-Control", "no-store"); res.json({ content: rows });
});

router.post("/creator/content", requireCreatorAccount, async (req, res) => {
  const parsed = SyncCreatorOriginalBody.safeParse(req.body);
  if (!parsed.success || Object.keys(req.body).some(k => !["sourceId", "surface", "body", "mediaIds"].includes(k)) ||
    new Set(parsed.data.mediaIds).size !== parsed.data.mediaIds.length) {
    res.status(400).json({ error: "Content needs a valid source, creation surface, text and unique media reservations." }); return;
  }
  const userId = getAuthContext(res).userId, input = parsed.data;
  if (!input.mediaIds.length && !meaningful(input.body)) {
    res.status(400).json({ error: "Original text needs at least 20 characters and three words." }); return;
  }
  const copiesCreated: string[] = [];
  let result: { id: string; original: boolean } | { invalid: true } | { conflict: true };
  try {
  result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM users WHERE id=${userId} FOR UPDATE`);
    const [existing] = await tx.select().from(creatorContentTable).where(and(
      eq(creatorContentTable.userId, userId), eq(creatorContentTable.sourceId, input.sourceId))).limit(1);
    if (existing) return existing.deletedAt ? { conflict: true } : { id: existing.id, original: existing.original };
    const assets = input.mediaIds.length ? await tx.select().from(creatorMediaTable).where(and(
      eq(creatorMediaTable.userId, userId), inArray(creatorMediaTable.id, input.mediaIds))) : [];
    if (assets.length !== input.mediaIds.length || assets.some(a => a.contentId || a.createdAt.getTime() < Date.now() - 3600000)) return { invalid: true };
    for (const asset of assets) {
      const verified = await confirmMedia(asset.objectPath, asset.contentType, asset.size);
      copiesCreated.push(verified.path);
      asset.fingerprint = verified.fingerprint; asset.objectPath = verified.path; asset.confirmedAt = new Date();
      await tx.update(creatorMediaTable).set({ objectPath: asset.objectPath, fingerprint: asset.fingerprint, confirmedAt: asset.confirmedAt }).where(eq(creatorMediaTable.id, asset.id));
    }
    const fingerprint = assets.length
      ? createHash("sha256").update(assets.map(a => a.fingerprint).sort().join(":")).digest("hex")
      : createHash("sha256").update(normal(input.body)).digest("hex");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${fingerprint},0))`);
    // Known cross-account copies never become original simply by changing IDs.
    const copies = await tx.execute(sql`SELECT id FROM creator_original_content WHERE fingerprint=${fingerprint} AND user_id<>${userId} LIMIT 1`);
    const kind = assets.some(a => a.contentType.startsWith("video/")) ? "video" : assets.length ? "photo" : "text";
    const [record] = await tx.insert(creatorContentTable).values({ userId, sourceId: input.sourceId,
      surface: input.surface, kind, body: input.body.trim(), fingerprint, original: copies.rows.length === 0,
    }).returning({ id: creatorContentTable.id, original: creatorContentTable.original });
    if (assets.length) await tx.update(creatorMediaTable).set({ contentId: record.id }).where(inArray(creatorMediaTable.id, input.mediaIds));
    return record;
  });
  } catch (error) {
    // A partial multi-file verification must not leave an untracked copy.
    await Promise.all(copiesCreated.map(path => deleteCreatorMedia(path).catch(() => {})));
    throw error;
  }
  if ("invalid" in result) { res.status(400).json({ error: "Media must belong to your account and be uploaded to fresh, unused reservations." }); return; }
  if ("conflict" in result) { res.status(409).json({ error: "This original was removed. Removed credit cannot be restored by replaying its source ID." }); return; }
  refreshCreatorsAfterActivity([userId]); res.json(result);
});

router.delete("/creator/content/:id", async (req, res) => {
  if (!uuid.test(String(req.params.id))) { res.status(400).json({ error: "Invalid content ID." }); return; }
  const userId = getAuthContext(res).userId;
  const [record] = await db.update(creatorContentTable).set({ deletedAt: new Date() }).where(and(
    eq(creatorContentTable.id, String(req.params.id)), eq(creatorContentTable.userId, userId))).returning({ id: creatorContentTable.id });
  if (!record) { res.status(404).json({ error: "Original not found." }); return; }
  const assets = await db.select().from(creatorMediaTable).where(eq(creatorMediaTable.contentId, record.id));
  let cleanupPending = false;
  for (const asset of assets) {
    try {
      await deleteCreatorMedia(asset.objectPath);
      await db.delete(creatorMediaTable).where(eq(creatorMediaTable.id, asset.id));
    } catch { cleanupPending = true; }
  }
  refreshCreatorsAfterActivity([userId]); res.json({ deleted: true, cleanupPending });
});

router.get("/posts/:postId/comments", async (req, res) => {
  if (!uuid.test(String(req.params.postId))) { res.status(400).json({ error: "Invalid post ID." }); return; }
  const viewerId = getAuthContext(res).userId;
  const [post] = await db.select({ id: postsTable.id }).from(postsTable)
    .where(and(eq(postsTable.id, String(req.params.postId)), postVisibilityForViewer(viewerId))).limit(1);
  if (!post) { res.status(404).json({ error: "Post not found." }); return; }
  const { rows } = await pool.query(`SELECT c.id,c.body,c.parent_id AS "parentId",
    extract(epoch from c.created_at)*1000 AS "createdAt",
    json_build_object('id',u.id,'username',u.username,'displayName',u.display_name) AS author,
    COALESCE(array_agg(r.user_id) FILTER (WHERE r.reaction='like'), ARRAY[]::uuid[]) AS likes,
    COALESCE(array_agg(r.user_id) FILTER (WHERE r.reaction='dislike'), ARRAY[]::uuid[]) AS dislikes
    FROM post_comments c JOIN users u ON u.id=c.user_id
    LEFT JOIN post_comment_reactions r ON r.comment_id=c.id
    WHERE c.post_id=$1 GROUP BY c.id,u.id ORDER BY c.created_at,c.id LIMIT 500`, [post.id]);
  res.json({ comments: rows.map(r => ({ ...r, createdAt: Number(r.createdAt) })) });
});

router.post("/posts/:postId/comments", createRateLimiter("cloud-comment", 15), async (req, res) => {
  const parsed = AddCloudPostCommentBody.safeParse({ body: req.body?.body });
  const parentId = req.body?.parentId;
  if (!uuid.test(String(req.params.postId)) || !parsed.success || !parsed.data.body.trim() ||
    (parentId !== undefined && (typeof parentId !== "string" || !uuid.test(parentId))) ||
    Object.keys(req.body || {}).some(k => !["body", "parentId"].includes(k))) {
    res.status(400).json({ error: "Write a comment of 1–1,000 characters." }); return;
  }
  const userId = getAuthContext(res).userId;
  const [post] = await db.select({ id: postsTable.id, authorId: postsTable.authorId }).from(postsTable)
    .where(and(eq(postsTable.id, String(req.params.postId)), postVisibilityForViewer(userId))).limit(1);
  if (!post) { res.status(404).json({ error: "Post not found." }); return; }
  if (parentId) {
    const [parent] = await db.select({ id: postCommentsTable.id }).from(postCommentsTable)
      .where(and(eq(postCommentsTable.id, parentId), eq(postCommentsTable.postId, post.id))).limit(1);
    if (!parent) { res.status(404).json({ error: "Reply target not found." }); return; }
  }
  const [comment] = await db.insert(postCommentsTable).values({
    postId: post.id, userId, parentId: parentId || null, body: parsed.data.body.trim(),
  }).returning();
  const [author] = await db.select({ id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  refreshCreatorsAfterActivity([userId, post.authorId]);
  if (userId !== post.authorId) notifyAccountActivity(post.authorId);
  if (parentId) {
    const [parent] = await db.select({ userId: postCommentsTable.userId }).from(postCommentsTable)
      .where(eq(postCommentsTable.id, parentId)).limit(1);
    if (parent && parent.userId !== userId && parent.userId !== post.authorId) notifyAccountActivity(parent.userId);
  }
  res.json({
    id: comment.id, parentId: comment.parentId, body: comment.body,
    createdAt: comment.createdAt.getTime(), author, likes: [], dislikes: [],
  });
});

router.delete("/posts/:postId/comments/:commentId", async (req, res) => {
  if (!uuid.test(String(req.params.postId)) || !uuid.test(String(req.params.commentId))) { res.status(400).json({ error: "Invalid comment ID." }); return; }
  const userId = getAuthContext(res).userId;
  const [deleted] = await db.delete(postCommentsTable).where(and(eq(postCommentsTable.id, String(req.params.commentId)),
    eq(postCommentsTable.postId, String(req.params.postId)), eq(postCommentsTable.userId, userId))).returning({ id: postCommentsTable.id });
  if (!deleted) { res.status(404).json({ error: "Comment not found or does not belong to you." }); return; }
  const [post] = await db.select({ authorId: postsTable.authorId }).from(postsTable).where(eq(postsTable.id, String(req.params.postId))).limit(1);
  refreshCreatorsAfterActivity([userId, ...(post ? [post.authorId] : [])]); res.json({ deleted: true });
});

router.put("/posts/:postId/comments/:commentId/reaction", async (req, res): Promise<void> => {
  const postId = String(req.params.postId);
  const commentId = String(req.params.commentId);
  const reaction = req.body?.reaction;
  if (!uuid.test(postId) || !uuid.test(commentId) ||
    !(reaction === "like" || reaction === "dislike" || reaction === null) ||
    Object.keys(req.body || {}).some(key => key !== "reaction")) {
    res.status(400).json({ error: "Choose a valid comment reaction." });
    return;
  }
  const userId = getAuthContext(res).userId;
  const [visiblePost] = await db.select({ id: postsTable.id }).from(postsTable)
    .where(and(eq(postsTable.id, postId), postVisibilityForViewer(userId))).limit(1);
  if (!visiblePost) { res.status(404).json({ error: "Post not found." }); return; }
  const [comment] = await db.select({ id: postCommentsTable.id }).from(postCommentsTable)
    .where(and(eq(postCommentsTable.id, commentId), eq(postCommentsTable.postId, postId))).limit(1);
  if (!comment) { res.status(404).json({ error: "Comment not found." }); return; }
  const [existing] = await db.select({ reaction: postCommentReactionsTable.reaction })
    .from(postCommentReactionsTable)
    .where(and(eq(postCommentReactionsTable.commentId, commentId), eq(postCommentReactionsTable.userId, userId)))
    .limit(1);
  const nextReaction = reaction === existing?.reaction ? null : reaction;
  if (!nextReaction) {
    await db.delete(postCommentReactionsTable).where(and(
      eq(postCommentReactionsTable.commentId, commentId),
      eq(postCommentReactionsTable.userId, userId),
    ));
  } else {
    await db.insert(postCommentReactionsTable).values({ commentId, userId, reaction: nextReaction })
      .onConflictDoUpdate({
        target: [postCommentReactionsTable.commentId, postCommentReactionsTable.userId],
        set: { reaction: nextReaction, createdAt: new Date() },
      });
  }
  res.json({ reaction: nextReaction });
});

const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  req.log.warn({ err: error }, "Creator content persistence failed");
  res.status(500).json({ error: "This content could not be saved online. Nothing was published. Please try again." });
};
router.use(errorHandler);
export default router;
