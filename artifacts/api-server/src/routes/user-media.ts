import { createHash } from "node:crypto";
import { raw, Router } from "express";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  accountBlocksTable,
  accountStateTable,
  chatMembersTable,
  chatMessageMediaTable,
  chatMessagesTable,
  db,
  postMediaAssetsTable,
  postsTable,
  storiesTable,
  userMediaAssetsTable,
} from "@workspace/db";
import { createRateLimiter, getAuthContext, requireAuth } from "../lib/auth";
import {
  createSupabaseSignedReadUrl,
  deleteSupabaseMedia,
  fingerprintSupabaseMedia,
  getSupabaseMediaMetadata,
  putSupabaseMedia,
  readSupabaseMedia,
  reserveSupabaseResumableMedia,
} from "../lib/supabase-storage";
import { postVisibilityForViewer } from "./social";

const router = Router();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxDatabaseFileBytes = Number.MAX_SAFE_INTEGER;
const supportedTypes = [
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif",
  "video/mp4", "video/webm", "video/quicktime", "audio/mp4", "audio/webm", "audio/ogg", "audio/mpeg",
  "application/pdf", "text/plain", "text/csv", "application/rtf", "application/zip",
  "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

router.use("/media", requireAuth);

// Compatibility for old clients; current clients use the resumable direct-to-Storage flow below.
router.put("/media/:id", raw({ type: supportedTypes, limit: "50mb" }), createRateLimiter("user-media-legacy-upload", 20), async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const contentType = String(req.get("Content-Type") || "").split(";")[0].toLowerCase();
  const bytes = Buffer.isBuffer(req.body) ? req.body : null;
  if (!uuid.test(id) || !bytes?.length || !supportedTypes.includes(contentType)) {
    res.status(400).json({ error: "Choose a supported media file and try again." });
    return;
  }
  const userId = getAuthContext(res).userId;
  const objectKey = `media/${userId}/${id}`;
  const [existing] = await db.select().from(userMediaAssetsTable).where(eq(userMediaAssetsTable.id, id)).limit(1);
  if (existing) {
    if (existing.userId !== userId || existing.size !== bytes.length || existing.contentType !== contentType || !existing.ready) {
      res.status(409).json({ error: "This media ID belongs to another file or an incomplete upload." });
      return;
    }
    res.status(200).json({ id, contentType, size: bytes.length, ready: true });
    return;
  }
  let uploadedObject = false;
  try {
    await putSupabaseMedia(objectKey, bytes, contentType);
    uploadedObject = true;
    await db.insert(userMediaAssetsTable).values({
      id, userId, objectKey, contentType, size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), ready: true,
    });
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({ id, contentType, size: bytes.length, ready: true });
  } catch {
    if (uploadedObject) {
      const [winner] = await db.select().from(userMediaAssetsTable).where(eq(userMediaAssetsTable.id, id)).limit(1);
      if (winner?.userId === userId && winner.objectKey === objectKey && winner.ready &&
          winner.size === bytes.length && winner.contentType === contentType) {
        res.status(200).json({ id, contentType, size: bytes.length, ready: true });
        return;
      }
      if (!winner || winner.objectKey !== objectKey) await deleteSupabaseMedia(objectKey).catch(() => {});
    }
    res.status(503).json({ error: "The media could not be saved to your online account." });
  }
});

router.post("/media/:id/upload", createRateLimiter("user-media-upload", 40), async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const contentType = String(req.body?.contentType || "").split(";")[0].toLowerCase();
  const size = Number(req.body?.size);
  const sha256 = String(req.body?.sha256 || "").toLowerCase();
  if (!uuid.test(id) || !supportedTypes.includes(contentType) || !Number.isSafeInteger(size) ||
    size < 5 || size > maxDatabaseFileBytes || !/^[0-9a-f]{64}$/.test(sha256)) {
    res.status(400).json({ error: "Choose a supported media file and try again." });
    return;
  }

  const userId = getAuthContext(res).userId;
  const objectKey = `media/${userId}/${id}`;
  try {
    const [existing] = await db.select().from(userMediaAssetsTable)
      .where(eq(userMediaAssetsTable.id, id)).limit(1);
    if (existing && (existing.userId !== userId || existing.size !== size || existing.contentType !== contentType)) {
      res.status(409).json({ error: "This media ID belongs to another file or account." });
      return;
    }
    if (existing?.ready) {
      res.json({ id, contentType, size, ready: true });
      return;
    }
    if (!existing) {
      await db.insert(userMediaAssetsTable).values({
        id, userId, objectKey, contentType, size, sha256, ready: false,
      });
    }
    const uploaded = existing ? await getSupabaseMediaMetadata(objectKey) : null;
    if (uploaded && (uploaded.size !== size || uploaded.contentType !== contentType)) {
      res.status(409).json({ error: "An incomplete upload for this file needs to be restarted." });
      return;
    }
    const ticket = uploaded ? null : await reserveSupabaseResumableMedia(objectKey);
    res.status(existing ? 200 : 201).json({
      id, contentType, size, ready: false, uploaded: Boolean(uploaded), ...(ticket || {}),
    });
  } catch {
    res.status(503).json({ error: "A secure cloud upload could not be started. Please retry." });
  }
});

router.post("/media/:id/confirm", createRateLimiter("user-media-upload-confirm", 80), async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const sha256 = String(req.body?.sha256 || "").toLowerCase();
  if (!uuid.test(id) || !/^[0-9a-f]{64}$/.test(sha256)) {
    res.status(400).json({ error: "The uploaded file could not be verified." });
    return;
  }
  const userId = getAuthContext(res).userId;
  const [asset] = await db.select().from(userMediaAssetsTable).where(and(
    eq(userMediaAssetsTable.id, id), eq(userMediaAssetsTable.userId, userId),
  )).limit(1);
  if (!asset) { res.sendStatus(404); return; }
  if (asset.ready) { res.json({ id, contentType: asset.contentType, size: asset.size, ready: true }); return; }
  try {
    const metadata = await getSupabaseMediaMetadata(asset.objectKey);
    if (!metadata || metadata.size !== asset.size || metadata.contentType !== asset.contentType) {
      res.status(409).json({ error: "Supabase has not confirmed the complete upload yet." });
      return;
    }
    const verified = await fingerprintSupabaseMedia(asset.objectKey, asset.size);
    if (verified.fingerprint !== sha256) {
      res.status(409).json({ error: "The uploaded media did not match the original file. Please retry." });
      return;
    }
    await db.update(userMediaAssetsTable).set({ ready: true, sha256 })
      .where(and(eq(userMediaAssetsTable.id, id), eq(userMediaAssetsTable.userId, userId)));
    res.json({ id, contentType: asset.contentType, size: asset.size, ready: true });
  } catch {
    res.status(503).json({ error: "Supabase has not confirmed the upload yet. Please retry." });
  }
});

async function canReadMedia(userId: string, asset: typeof userMediaAssetsTable.$inferSelect) {
  if (asset.userId === userId) return true;
  const [profileBlock] = await db.select({ ownerId: accountBlocksTable.ownerId })
    .from(accountBlocksTable).where(or(
      and(eq(accountBlocksTable.ownerId, userId), eq(accountBlocksTable.blockedId, asset.userId)),
      and(eq(accountBlocksTable.ownerId, asset.userId), eq(accountBlocksTable.blockedId, userId)),
    )).limit(1);
  if (profileBlock) return false;
  const [account] = await db.select({ data: accountStateTable.data }).from(accountStateTable)
    .where(eq(accountStateTable.userId, asset.userId)).limit(1);
  const profile = account?.data?.profile as Record<string, unknown> | undefined;
  const reference = `oldtime-media:${asset.id}`;
  if (profile?.avatar === reference || profile?.cover === reference) return true;
  const [published] = await db.select({ mediaId: postMediaAssetsTable.mediaId })
    .from(postMediaAssetsTable)
    .innerJoin(postsTable, eq(postsTable.id, postMediaAssetsTable.postId))
    .where(and(
      eq(postMediaAssetsTable.mediaId, asset.id),
      postVisibilityForViewer(userId),
    )).limit(1);
  if (published) return true;
  const [attachment] = await db.select({ conversationId: chatMessagesTable.conversationId })
    .from(chatMessageMediaTable)
    .innerJoin(chatMessagesTable, eq(chatMessagesTable.id, chatMessageMediaTable.messageId))
    .innerJoin(chatMembersTable, eq(chatMembersTable.conversationId, chatMessagesTable.conversationId))
    .where(and(eq(chatMessageMediaTable.mediaId, asset.id), eq(chatMembersTable.userId, userId))).limit(1);
  if (!attachment) return false;
  const participants = await db.select({ userId: chatMembersTable.userId })
    .from(chatMembersTable).where(eq(chatMembersTable.conversationId, attachment.conversationId));
  const otherIds = participants.map(member => member.userId).filter(memberId => memberId !== userId);
  const [blocked] = otherIds.length ? await db.select({ ownerId: accountBlocksTable.ownerId })
    .from(accountBlocksTable).where(or(
      and(eq(accountBlocksTable.ownerId, userId), inArray(accountBlocksTable.blockedId, otherIds)),
      and(inArray(accountBlocksTable.ownerId, otherIds), eq(accountBlocksTable.blockedId, userId)),
    )).limit(1) : [];
  return !blocked;
}

router.get("/media/:id/url", createRateLimiter("user-media-read-url", 180), async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!uuid.test(id)) { res.sendStatus(404); return; }
  const userId = getAuthContext(res).userId;
  const [asset] = await db.select().from(userMediaAssetsTable).where(and(
    eq(userMediaAssetsTable.id, id), eq(userMediaAssetsTable.ready, true),
  )).limit(1);
  if (!asset || !await canReadMedia(userId, asset)) {
    res.status(404).json({ error: "This media is not accessible to this account.", code: "MEDIA_NOT_ACCESSIBLE" });
    return;
  }
  try {
    res.setHeader("Cache-Control", "no-store");
    const [metadata, signedUrl] = await Promise.all([
      getSupabaseMediaMetadata(asset.objectKey),
      createSupabaseSignedReadUrl(asset.objectKey),
    ]);
    if (!metadata) {
      req.log.warn({ mediaId: id }, "A ready media record has no matching cloud object");
      res.status(410).json({
        error: "The original file could not be found in cloud storage. Its record is preserved.",
        code: "MEDIA_OBJECT_MISSING",
      });
      return;
    }
    res.json({
      url: signedUrl,
      contentType: asset.contentType,
      size: asset.size,
    });
  }
  catch (error) {
    req.log.error({ err: error, mediaId: id }, "Cloud media link resolution failed");
    res.status(503).json({ error: "Cloud media is temporarily unreachable. Please retry.", code: "MEDIA_STORAGE_UNAVAILABLE" });
  }
});

router.get("/media/:id", createRateLimiter("user-media-read", 180), async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!uuid.test(id)) { res.sendStatus(404); return; }
  const userId = getAuthContext(res).userId;
  const [asset] = await db.select().from(userMediaAssetsTable).where(and(
    eq(userMediaAssetsTable.id, id), eq(userMediaAssetsTable.ready, true),
  )).limit(1);
  if (!asset || !await canReadMedia(userId, asset)) { res.sendStatus(404); return; }
  const bytes = await readSupabaseMedia(asset.objectKey);
  res.set({
    "Content-Type": asset.contentType,
    "Content-Length": String(bytes.length),
    ...(["application/pdf", "text/plain", "text/csv", "application/rtf", "application/zip",
      "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"].includes(asset.contentType)
      ? { "Content-Disposition": "attachment; filename=\"oldtime-attachment\"" } : {}),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  }).send(bytes);
});

router.delete("/media/:id", createRateLimiter("user-media-delete", 40), async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!uuid.test(id)) { res.sendStatus(404); return; }
  const userId = getAuthContext(res).userId;
  const [asset] = await db.select().from(userMediaAssetsTable).where(and(
    eq(userMediaAssetsTable.id, id), eq(userMediaAssetsTable.userId, userId),
  )).limit(1);
  if (!asset) { res.sendStatus(404); return; }
  const [chatReference] = await db.select({ messageId: chatMessageMediaTable.messageId })
    .from(chatMessageMediaTable).where(eq(chatMessageMediaTable.mediaId, id)).limit(1);
  const [postReference] = await db.select({ postId: postMediaAssetsTable.postId })
    .from(postMediaAssetsTable).where(eq(postMediaAssetsTable.mediaId, id)).limit(1);
  const [storyReference] = await db.select({ id: storiesTable.id })
    .from(storiesTable).where(eq(storiesTable.mediaPath, asset.objectKey)).limit(1);
  if (chatReference || postReference || storyReference) {
    res.status(409).json({ error: "This file is still attached to shared content. Remove that content before deleting the media." });
    return;
  }
  if (asset.ready) await deleteSupabaseMedia(asset.objectKey);
  await db.delete(userMediaAssetsTable).where(and(
    eq(userMediaAssetsTable.id, id), eq(userMediaAssetsTable.userId, userId),
  ));
  res.sendStatus(204);
});

export default router;
