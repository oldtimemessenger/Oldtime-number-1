import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  CreateChatBody,
  CreateChatMessageBody,
  CreateChatMessageParams,
  CreateChatMessageResponse,
  CreateChatResponse,
  ListChatsResponse,
  ListChatMessagesParams,
  ListChatMessagesResponse,
  DeleteLegacyChatArchiveParams,
  ListLegacyChatArchivesResponse,
  SaveLegacyChatArchivePartBody,
  SaveLegacyChatArchivePartParams,
  SaveLegacyChatArchivePartResponse,
} from "@workspace/api-zod";
import {
  accountBlocksTable,
  chatLegacyArchivePartsTable,
  chatConversationsTable,
  chatMembersTable,
  chatMessageMediaTable,
  chatMessagesTable,
  db,
  userMediaAssetsTable,
  usersTable,
} from "@workspace/db";
import { getAuthContext, requireAuth } from "../lib/auth";
import { notifyChatChanged } from "../lib/live-gateway";

const router: IRouter = Router();

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, canonicalJson(item)]));
  }
  return value;
}

function archiveDigest(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(canonicalJson(payload))).digest("hex");
}

function legacyArchivePartDto(row: typeof chatLegacyArchivePartsTable.$inferSelect) {
  return {
    sourceId: row.sourceId,
    part: row.part,
    totalParts: row.totalParts,
    contentHash: row.contentHash,
    payload: row.payload,
    createdAt: row.createdAt.getTime(),
  };
}

async function chatDto(chatId: string, viewerId: string) {
  const [chat] = await db.select().from(chatConversationsTable)
    .where(eq(chatConversationsTable.id, chatId)).limit(1);
  if (!chat) return null;
  const members = await db.select({
    id: usersTable.id,
    username: usersTable.username,
    displayName: usersTable.displayName,
    lastReadAt: chatMembersTable.lastReadAt,
    state: chatMembersTable.state,
  }).from(chatMembersTable)
    .innerJoin(usersTable, eq(chatMembersTable.userId, usersTable.id))
    .where(eq(chatMembersTable.conversationId, chatId));
  const ownState = members.find(member => member.id === viewerId)?.state || {};
  return {
    id: chat.id,
    title: chat.title,
    members: members.map(({ state, lastReadAt, ...member }) => ({
      ...member,
      lastReadAt: (state as Record<string, unknown>)?.shareReceipts === false ? null : lastReadAt?.getTime() ?? null,
    })),
    state: ownState,
    createdAt: chat.createdAt.getTime(),
  };
}

const chatStateSchema = z.object({
  draft: z.string().max(5000).optional(),
  pinnedIds: z.array(z.string().min(3).max(80)).max(3).optional(),
  savedMessageIds: z.array(z.string().min(3).max(80)).max(1000).optional(),
  hiddenMessageIds: z.array(z.string().min(3).max(80)).max(2000).optional(),
  keptMessageIds: z.array(z.string().min(3).max(80)).max(1000).optional(),
  disappear: z.enum(["off", "10 seconds", "24 hours", "after view"]).optional(),
  mutedUntil: z.number().int().min(0).optional(),
  wallpaper: z.enum(["", "#e7f6e9"]).optional(),
  locked: z.boolean().optional(),
  shareReceipts: z.boolean().optional(),
  reactions: z.record(z.string(), z.array(z.string().min(1).max(16)).max(7)).optional(),
  pollVotes: z.record(z.string(), z.number().int().min(0).max(9)).optional(),
}).strict();

const messageMetadataSchema = z.object({
  replyTo: z.string().min(3).max(80).optional(),
  caption: z.string().max(2000).optional(),
  fileName: z.string().max(200).optional(),
  fileSize: z.string().max(40).optional(),
  viewOnce: z.boolean().optional(),
  forwarded: z.boolean().optional(),
  poll: z.object({
    question: z.string().min(1).max(500),
    options: z.array(z.string().min(1).max(200)).min(2).max(10),
  }).strict().optional(),
  postId: z.string().max(100).optional(),
  sharedPostId: z.string().max(100).optional(),
  sharedCommentId: z.string().max(100).optional(),
  commentId: z.string().max(100).optional(),
  duration: z.string().max(10).optional(),
  peaks: z.array(z.number().min(0).max(1)).max(100).optional(),
}).strip();

function matchesMessageMediaType(kind: string, contentType: string) {
  if (kind === "photo") return contentType.startsWith("image/") && contentType !== "image/gif";
  if (kind === "video") return contentType.startsWith("video/");
  if (kind === "gif") return contentType === "image/gif";
  if (kind === "voice") return contentType.startsWith("audio/");
  return kind === "file";
}

async function isChatMember(chatId: string, userId: string) {
  const [membership] = await db.select({ userId: chatMembersTable.userId })
    .from(chatMembersTable)
    .where(and(eq(chatMembersTable.conversationId, chatId), eq(chatMembersTable.userId, userId)))
    .limit(1);
  return Boolean(membership);
}

async function chatBlocked(chatId: string, userId: string) {
  const otherMembers = await db.select({ userId: chatMembersTable.userId })
    .from(chatMembersTable)
    .where(and(eq(chatMembersTable.conversationId, chatId)));
  const otherIds = otherMembers.map(member => member.userId).filter(id => id !== userId);
  if (!otherIds.length) return false;
  const [blocked] = await db.select({ ownerId: accountBlocksTable.ownerId })
    .from(accountBlocksTable)
    .where(or(
      and(eq(accountBlocksTable.ownerId, userId), inArray(accountBlocksTable.blockedId, otherIds)),
      and(inArray(accountBlocksTable.ownerId, otherIds), eq(accountBlocksTable.blockedId, userId)),
    )).limit(1);
  return Boolean(blocked);
}

router.get("/chats/legacy-archives", requireAuth, async (_req, res): Promise<void> => {
  const { userId } = getAuthContext(res);
  const rows = await db.select().from(chatLegacyArchivePartsTable)
    .where(eq(chatLegacyArchivePartsTable.ownerId, userId))
    .orderBy(chatLegacyArchivePartsTable.sourceId, chatLegacyArchivePartsTable.part);
  res.json(ListLegacyChatArchivesResponse.parse({ archives: rows.map(legacyArchivePartDto) }));
});

router.put("/chats/legacy-archives/:sourceId/:part", requireAuth, async (req, res): Promise<void> => {
  const params = SaveLegacyChatArchivePartParams.safeParse(req.params);
  const parsed = SaveLegacyChatArchivePartBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "The archived conversation could not be validated." });
    return;
  }
  const { sourceId, part } = params.data;
  const { totalParts, contentHash, payload } = parsed.data;
  if (part >= totalParts || Buffer.byteLength(JSON.stringify(payload), "utf8") > 750 * 1024 ||
    payload.version !== 1 || payload.id !== sourceId || !Array.isArray(payload.messages) ||
    payload.messages.length > 5000 || archiveDigest(payload) !== contentHash) {
    res.status(400).json({ error: "The archive part is too large or its verification data does not match." });
    return;
  }

  const { userId } = getAuthContext(res);
  if (payload.ownerAccountId !== userId || typeof payload.ownerLocalId !== "string" ||
    !Array.isArray(payload.members) ||
    !payload.members.some(member => member && typeof member === "object" &&
      (member as Record<string, unknown>).id === payload.ownerLocalId)) {
    res.status(403).json({ error: "Only the account that owns this archive can import it." });
    return;
  }
  const [existing] = await db.select().from(chatLegacyArchivePartsTable).where(and(
    eq(chatLegacyArchivePartsTable.ownerId, userId),
    eq(chatLegacyArchivePartsTable.sourceId, sourceId),
    eq(chatLegacyArchivePartsTable.part, part),
  )).limit(1);
  if (existing) {
    if (existing.contentHash !== contentHash || existing.totalParts !== totalParts) {
      res.status(409).json({ error: "This archive part already exists with different content." });
      return;
    }
    res.status(200).json(SaveLegacyChatArchivePartResponse.parse({
      status: "already-imported",
      archive: legacyArchivePartDto(existing),
    }));
    return;
  }

  await db.insert(chatLegacyArchivePartsTable).values({
    ownerId: userId,
    sourceId,
    part,
    totalParts,
    contentHash,
    payload,
  }).onConflictDoNothing();
  const [stored] = await db.select().from(chatLegacyArchivePartsTable).where(and(
    eq(chatLegacyArchivePartsTable.ownerId, userId),
    eq(chatLegacyArchivePartsTable.sourceId, sourceId),
    eq(chatLegacyArchivePartsTable.part, part),
  )).limit(1);
  if (!stored || stored.contentHash !== contentHash || stored.totalParts !== totalParts) {
    res.status(409).json({ error: "This archive part conflicts with a different stored copy." });
    return;
  }
  res.status(201).json(SaveLegacyChatArchivePartResponse.parse({
    status: "imported",
    archive: legacyArchivePartDto(stored),
  }));
});

router.delete("/chats/legacy-archives/:sourceId", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteLegacyChatArchiveParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Choose a valid archived conversation." });
    return;
  }
  const { userId } = getAuthContext(res);
  const deleted = await db.delete(chatLegacyArchivePartsTable).where(and(
    eq(chatLegacyArchivePartsTable.ownerId, userId),
    eq(chatLegacyArchivePartsTable.sourceId, params.data.sourceId),
  )).returning({ sourceId: chatLegacyArchivePartsTable.sourceId });
  if (!deleted.length) {
    res.status(404).json({ error: "Archived conversation not found." });
    return;
  }
  res.sendStatus(204);
});

router.get("/chats", requireAuth, async (_req, res): Promise<void> => {
  const { userId } = getAuthContext(res);
  const rooms = await db.select({ id: chatConversationsTable.id })
    .from(chatMembersTable)
    .innerJoin(chatConversationsTable, eq(chatMembersTable.conversationId, chatConversationsTable.id))
    .where(eq(chatMembersTable.userId, userId))
    .orderBy(desc(chatConversationsTable.updatedAt))
    .limit(200);
  const chats = (await Promise.all(rooms.map(room => chatDto(room.id, userId)))).filter(Boolean);
  res.json(ListChatsResponse.parse({ chats }));
});

router.post("/chats", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose valid chat members." });
    return;
  }
  const { userId } = getAuthContext(res);
  const memberIds = [...new Set([...parsed.data.members, userId])];
  if (memberIds.length < 2 || memberIds.length > 16) {
    res.status(400).json({ error: "A chat needs 2–16 members." });
    return;
  }
  const foundUsers = await db.select({ id: usersTable.id })
    .from(usersTable).where(inArray(usersTable.id, memberIds));
  if (foundUsers.length !== memberIds.length) {
    res.status(400).json({ error: "One or more chat members do not exist." });
    return;
  }
  const [blocked] = await db.select({ ownerId: accountBlocksTable.ownerId })
    .from(accountBlocksTable)
    .where(or(
      and(eq(accountBlocksTable.ownerId, userId), inArray(accountBlocksTable.blockedId, memberIds.filter(id => id !== userId))),
      and(inArray(accountBlocksTable.ownerId, memberIds.filter(id => id !== userId)), eq(accountBlocksTable.blockedId, userId)),
    )).limit(1);
  if (blocked) {
    res.status(400).json({ error: "Blocked accounts cannot be added to a chat." });
    return;
  }

  const existing = await db.select({ id: chatConversationsTable.id })
    .from(chatConversationsTable).where(eq(chatConversationsTable.id, parsed.data.id)).limit(1);
  if (existing.length) {
    if (!await isChatMember(parsed.data.id, userId)) {
      res.status(409).json({ error: "That conversation ID is already in use." });
      return;
    }
    const chat = await chatDto(parsed.data.id, userId);
    res.status(201).json(CreateChatResponse.parse({ chat }));
    return;
  }

  await db.transaction(async tx => {
    await tx.insert(chatConversationsTable).values({
      id: parsed.data.id,
      createdBy: userId,
      title: parsed.data.title?.trim() || "",
    });
    await tx.insert(chatMembersTable).values(memberIds.map(memberId => ({
      conversationId: parsed.data.id,
      userId: memberId,
    })));
  });
  const chat = await chatDto(parsed.data.id, userId);
  res.status(201).json(CreateChatResponse.parse({ chat }));
});

router.get("/chats/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const params = ListChatMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Choose a valid conversation." });
    return;
  }
  const { userId } = getAuthContext(res);
  if (!await isChatMember(params.data.id, userId) || await chatBlocked(params.data.id, userId)) {
    res.status(404).json({ error: "Conversation not found." });
    return;
  }
  const rows = await db.select({
    id: chatMessagesTable.id,
    conversationId: chatMessagesTable.conversationId,
    kind: chatMessagesTable.kind,
    body: chatMessagesTable.body,
    metadata: chatMessagesTable.metadata,
    createdAt: chatMessagesTable.createdAt,
    editedAt: chatMessagesTable.editedAt,
    author: {
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
    },
  }).from(chatMessagesTable)
    .innerJoin(usersTable, eq(chatMessagesTable.authorId, usersTable.id))
    .where(eq(chatMessagesTable.conversationId, params.data.id))
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(100);
  const messageIds = rows.map(message => message.id);
  const [members, mediaRows] = await Promise.all([
    db.select({
      userId: chatMembersTable.userId,
      lastReadAt: chatMembersTable.lastReadAt,
      state: chatMembersTable.state,
    }).from(chatMembersTable).where(eq(chatMembersTable.conversationId, params.data.id)),
    messageIds.length ? db.select({
      messageId: chatMessageMediaTable.messageId,
      mediaId: userMediaAssetsTable.id,
      contentType: userMediaAssetsTable.contentType,
      size: userMediaAssetsTable.size,
      position: chatMessageMediaTable.position,
    }).from(chatMessageMediaTable)
      .innerJoin(userMediaAssetsTable, eq(chatMessageMediaTable.mediaId, userMediaAssetsTable.id))
      .where(inArray(chatMessageMediaTable.messageId, messageIds))
      .orderBy(chatMessageMediaTable.position) : Promise.resolve([]),
  ]);
  const mediaByMessage = new Map<string, typeof mediaRows>();
  for (const item of mediaRows) mediaByMessage.set(item.messageId, [...(mediaByMessage.get(item.messageId) || []), item]);
  const messages = rows.reverse().map(message => {
    const metadata = messageMetadataSchema.safeParse(message.metadata || {});
    const safeMetadata = metadata.success ? metadata.data : {};
    const reactions: Record<string, string[]> = {};
    const pollVotes: Record<number, string[]> = {};
    for (const member of members) {
      const state = member.state as Record<string, any>;
      const selected = state?.reactions?.[message.id];
      if (Array.isArray(selected)) for (const emoji of selected) {
        if (typeof emoji === "string") reactions[emoji] = [...(reactions[emoji] || []), member.userId];
      }
      const vote = state?.pollVotes?.[message.id];
      if (Number.isInteger(vote) && vote >= 0 && vote <= 9) pollVotes[vote] = [...(pollVotes[vote] || []), member.userId];
    }
    const otherMembers = members.filter(member => member.userId !== userId &&
      (member.state as Record<string, unknown>)?.shareReceipts !== false);
    const readBy = otherMembers.filter(member => member.lastReadAt && member.lastReadAt >= message.createdAt)
      .map(member => member.userId);
    const attachments = (mediaByMessage.get(message.id) || []).map(item => ({
      reference: `oldtime-media:${item.mediaId}`,
      contentType: item.contentType,
      size: item.size,
    }));
    const poll = safeMetadata.poll ? {
      ...safeMetadata.poll,
      votes: Object.fromEntries(Object.entries(pollVotes).map(([index, voters]) => [index, voters])),
    } : undefined;
    return {
      ...message,
      ...safeMetadata,
      kind: message.kind,
      body: message.body,
      createdAt: message.createdAt.getTime(),
      editedAt: message.editedAt?.getTime(),
      edited: !!message.editedAt,
      editHistory: Array.isArray((message.metadata as Record<string, unknown>)?.editHistory)
        ? (message.metadata as Record<string, unknown>).editHistory : [],
      media: attachments,
      reactions,
      ...(poll ? { poll } : {}),
      readBy,
      status: otherMembers.length > 0 && readBy.length === otherMembers.length ? "read" as const : "sent" as const,
    };
  });
  res.json(ListChatMessagesResponse.parse({ messages }));
});

router.post("/chats/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const params = CreateChatMessageParams.safeParse(req.params);
  const parsed = CreateChatMessageBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Choose a valid message." });
    return;
  }
  const { userId } = getAuthContext(res);
  const conversationId = params.data.id;
  if (!await isChatMember(conversationId, userId) || await chatBlocked(conversationId, userId)) {
    res.status(404).json({ error: "Conversation not found." });
    return;
  }
  const body = parsed.data.body.trim();
  if (parsed.data.kind === "text" && !body) {
    res.status(400).json({ error: "Write a message before sending." });
    return;
  }
  const metadataResult = messageMetadataSchema.safeParse(parsed.data.metadata || {});
  if (!metadataResult.success) {
    res.status(400).json({ error: "Message details are invalid." });
    return;
  }
  const metadata = metadataResult.data;
  if (parsed.data.kind === "poll" && !metadata.poll) {
    res.status(400).json({ error: "A poll needs a question and at least two options." });
    return;
  }
  const mediaIds = parsed.data.mediaIds || [];
  if (mediaIds.length && !["photo", "video", "gif", "voice", "file"].includes(parsed.data.kind)) {
    res.status(400).json({ error: "This message type cannot contain an attachment." });
    return;
  }
  if ((parsed.data.kind === "photo" || parsed.data.kind === "video" ||
      parsed.data.kind === "gif" || parsed.data.kind === "voice" || parsed.data.kind === "file") && !mediaIds.length) {
    res.status(400).json({ error: "Upload the attachment before sending this message." });
    return;
  }
  const assets = mediaIds.length ? await db.select({
    id: userMediaAssetsTable.id,
    userId: userMediaAssetsTable.userId,
    contentType: userMediaAssetsTable.contentType,
    size: userMediaAssetsTable.size,
    ready: userMediaAssetsTable.ready,
  }).from(userMediaAssetsTable).where(inArray(userMediaAssetsTable.id, mediaIds)) : [];
  if (assets.length !== mediaIds.length || assets.some(asset =>
    asset.userId !== userId || !asset.ready || !matchesMessageMediaType(parsed.data.kind, asset.contentType))) {
    res.status(400).json({ error: "One or more attachments are not ready for this account or message type." });
    return;
  }
  const [existing] = await db.select({
    id: chatMessagesTable.id,
    conversationId: chatMessagesTable.conversationId,
    kind: chatMessagesTable.kind,
    body: chatMessagesTable.body,
    metadata: chatMessagesTable.metadata,
    createdAt: chatMessagesTable.createdAt,
    author: { id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName },
  }).from(chatMessagesTable)
    .innerJoin(usersTable, eq(chatMessagesTable.authorId, usersTable.id))
    .where(eq(chatMessagesTable.id, parsed.data.clientId)).limit(1);
  if (existing) {
    if (existing.author.id !== userId || existing.conversationId !== conversationId) {
      res.status(409).json({ error: "Message ID is already in use." });
      return;
    }
    if (existing.kind !== parsed.data.kind || existing.body !== body) {
      res.status(409).json({ error: "This message ID was already used for different content." });
      return;
    }
    const existingMedia = await db.select({
      id: chatMessageMediaTable.mediaId,
      contentType: userMediaAssetsTable.contentType,
      size: userMediaAssetsTable.size,
    }).from(chatMessageMediaTable)
      .innerJoin(userMediaAssetsTable, eq(chatMessageMediaTable.mediaId, userMediaAssetsTable.id))
      .where(eq(chatMessageMediaTable.messageId, existing.id))
      .orderBy(chatMessageMediaTable.position);
    res.status(201).json(CreateChatMessageResponse.parse({
      message: {
        ...existing,
        ...(messageMetadataSchema.safeParse(existing.metadata || {}).success
          ? messageMetadataSchema.parse(existing.metadata || {}) : {}),
        media: existingMedia.map(item => ({
          reference: `oldtime-media:${item.id}`, contentType: item.contentType, size: item.size,
        })),
        kind: existing.kind,
        createdAt: existing.createdAt.getTime(),
      },
    }));
    return;
  }
  const inserted = await db.transaction(async tx => {
    const [row] = await tx.insert(chatMessagesTable).values({
      id: parsed.data.clientId,
      conversationId,
      authorId: userId,
      kind: parsed.data.kind,
      body,
      metadata,
    }).returning();
    if (mediaIds.length) await tx.insert(chatMessageMediaTable).values(mediaIds.map((mediaId, position) => ({
      messageId: row.id, mediaId, position,
    })));
    return row;
  });
  await db.update(chatConversationsTable).set({ updatedAt: new Date() })
    .where(eq(chatConversationsTable.id, conversationId));
  const [author] = await db.select({
    id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName,
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const message = {
    id: inserted.id,
    conversationId,
    author,
    kind: parsed.data.kind,
    body: inserted.body,
    createdAt: inserted.createdAt.getTime(),
    ...metadata,
    media: assets.map(asset => ({
      reference: `oldtime-media:${asset.id}`, contentType: asset.contentType, size: asset.size,
    })),
    reactions: {},
    readBy: [],
    status: "sent" as const,
  };
  void notifyChatChanged(conversationId);
  res.status(201).json(CreateChatMessageResponse.parse({ message }));
});

router.patch("/chats/:id/messages/:messageId", requireAuth, async (req, res): Promise<void> => {
  const params = z.object({
    id: z.string().min(3).max(80),
    messageId: z.string().min(3).max(80),
  }).safeParse(req.params);
  const parsed = z.object({ body: z.string().trim().min(1).max(5000) }).strict().safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Write a message of 1–5000 characters." });
    return;
  }
  const { userId } = getAuthContext(res);
  const { id: conversationId, messageId } = params.data;
  if (!await isChatMember(conversationId, userId) || await chatBlocked(conversationId, userId)) {
    res.status(404).json({ error: "Message not found." });
    return;
  }
  const [message] = await db.select().from(chatMessagesTable).where(and(
    eq(chatMessagesTable.id, messageId),
    eq(chatMessagesTable.conversationId, conversationId),
    eq(chatMessagesTable.authorId, userId),
    eq(chatMessagesTable.kind, "text"),
  )).limit(1);
  if (!message) {
    res.status(404).json({ error: "Only your text messages can be edited." });
    return;
  }
  const oldMetadata = messageMetadataSchema.safeParse(message.metadata || {});
  const previous = Array.isArray((message.metadata as Record<string, unknown>)?.editHistory)
    ? (message.metadata as Record<string, unknown>).editHistory as string[] : [];
  const metadata = {
    ...(oldMetadata.success ? oldMetadata.data : {}),
    editHistory: [...previous.slice(-9), message.body],
  };
  const [updated] = await db.update(chatMessagesTable).set({
    body: parsed.data.body,
    editedAt: new Date(),
    metadata,
  }).where(eq(chatMessagesTable.id, messageId)).returning();
  const [author] = await db.select({
    id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName,
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  res.json(CreateChatMessageResponse.parse({
    message: {
      id: updated.id,
      conversationId,
      author,
      kind: updated.kind,
      body: updated.body,
      createdAt: updated.createdAt.getTime(),
      editedAt: updated.editedAt?.getTime(),
      edited: true,
      ...metadata,
    },
  }));
});

router.delete("/chats/:id/messages/:messageId", requireAuth, async (req, res): Promise<void> => {
  const params = z.object({
    id: z.string().min(3).max(80),
    messageId: z.string().min(3).max(80),
  }).safeParse(req.params);
  if (!params.success) { res.sendStatus(404); return; }
  const { userId } = getAuthContext(res);
  const { id: conversationId, messageId } = params.data;
  if (!await isChatMember(conversationId, userId) || await chatBlocked(conversationId, userId)) {
    res.sendStatus(404);
    return;
  }
  const removed = await db.delete(chatMessagesTable).where(and(
    eq(chatMessagesTable.id, messageId),
    eq(chatMessagesTable.conversationId, conversationId),
    eq(chatMessagesTable.authorId, userId),
  )).returning({ id: chatMessagesTable.id });
  if (!removed.length) { res.sendStatus(404); return; }
  res.sendStatus(204);
});

router.put("/chats/:id/state", requireAuth, async (req, res): Promise<void> => {
  const conversationId = String(req.params.id || "");
  const parsed = z.object({ state: chatStateSchema }).strict().safeParse(req.body);
  if (conversationId.length < 3 || conversationId.length > 80 || !parsed.success) {
    res.status(400).json({ error: "Conversation settings are invalid." });
    return;
  }
  const { userId } = getAuthContext(res);
  if (!await isChatMember(conversationId, userId) || await chatBlocked(conversationId, userId)) {
    res.status(404).json({ error: "Conversation not found." });
    return;
  }
  const state = parsed.data.state;
  if (Object.keys(state.reactions || {}).length > 2000 || Object.keys(state.pollVotes || {}).length > 2000) {
    res.status(400).json({ error: "Too many message settings were submitted." });
    return;
  }
  const referencedIds = new Set([
    ...(state.pinnedIds || []),
    ...(state.savedMessageIds || []),
    ...(state.hiddenMessageIds || []),
    ...(state.keptMessageIds || []),
    ...Object.keys(state.reactions || {}),
    ...Object.keys(state.pollVotes || {}),
  ]);
  if (referencedIds.size) {
    const found = await db.select({
      id: chatMessagesTable.id,
      kind: chatMessagesTable.kind,
      metadata: chatMessagesTable.metadata,
    }).from(chatMessagesTable)
      .where(and(eq(chatMessagesTable.conversationId, conversationId), inArray(chatMessagesTable.id, [...referencedIds])));
    const allowed = new Set(found.map(message => message.id));
    const polls = new Map(found.filter(message => message.kind === "poll").map(message => {
      const metadata = messageMetadataSchema.safeParse(message.metadata || {});
      return [message.id, metadata.success ? metadata.data.poll?.options.length || 0 : 0] as const;
    }));
    if (state.pinnedIds) state.pinnedIds = state.pinnedIds.filter(id => allowed.has(id));
    if (state.savedMessageIds) state.savedMessageIds = state.savedMessageIds.filter(id => allowed.has(id));
    if (state.hiddenMessageIds) state.hiddenMessageIds = state.hiddenMessageIds.filter(id => allowed.has(id));
    if (state.keptMessageIds) state.keptMessageIds = state.keptMessageIds.filter(id => allowed.has(id));
    if (state.reactions) state.reactions = Object.fromEntries(Object.entries(state.reactions).filter(([id]) => allowed.has(id)));
    if (state.pollVotes) state.pollVotes = Object.fromEntries(Object.entries(state.pollVotes)
      .filter(([id, option]) => (polls.get(id) || 0) > option));
  }
  const [member] = await db.update(chatMembersTable).set({
    state: sql`${chatMembersTable.state} || ${JSON.stringify(state)}::jsonb`,
    ...(state.shareReceipts === false ? { lastReadAt: null } : {}),
  }).where(and(
    eq(chatMembersTable.conversationId, conversationId),
    eq(chatMembersTable.userId, userId),
  )).returning({ state: chatMembersTable.state });
  res.json({ state: member?.state || {} });
});

router.post("/chats/:id/read", requireAuth, async (req, res): Promise<void> => {
  const conversationId = String(req.params.id || "");
  const body = z.object({ shareReceipts: z.boolean().optional() }).strict().safeParse(req.body || {});
  if (conversationId.length < 3 || conversationId.length > 80 || !body.success) {
    res.status(400).json({ error: "Read receipt settings are invalid." });
    return;
  }
  const { userId } = getAuthContext(res);
  if (!await isChatMember(conversationId, userId) || await chatBlocked(conversationId, userId)) {
    res.status(404).json({ error: "Conversation not found." });
    return;
  }
  const [member] = await db.select({ state: chatMembersTable.state })
    .from(chatMembersTable).where(and(
      eq(chatMembersTable.conversationId, conversationId),
      eq(chatMembersTable.userId, userId),
    )).limit(1);
  const shareReceipts = body.data.shareReceipts ??
    (member?.state as Record<string, unknown> | undefined)?.shareReceipts !== false;
  await db.update(chatMembersTable).set({
    lastReadAt: shareReceipts ? new Date() : null,
    state: sql`${chatMembersTable.state} || ${JSON.stringify({ shareReceipts })}::jsonb`,
  }).where(and(
    eq(chatMembersTable.conversationId, conversationId),
    eq(chatMembersTable.userId, userId),
  ));
  res.sendStatus(204);
});

export default router;
