import { Router, raw, type IRouter } from "express";
import { notifyAccountActivity } from "../lib/live-gateway";
import { and, asc, count, desc, eq, exists, gt, inArray, lte, ne, notExists, or } from "drizzle-orm";
import { z } from "zod/v4";
import {
  accountBlocksTable,
  closeFriendMembersTable,
  chatMessageMediaTable,
  db,
  followRequestsTable,
  friendRequestsTable,
  friendshipsTable,
  storyCommentsTable,
  storyReactionsTable,
  storiesTable,
  storyViewsTable,
  postMediaAssetsTable,
  userMediaAssetsTable,
  userFollowsTable,
  usersTable,
} from "@workspace/db";
import {
  CreateStoryCommentBody,
  CreateStoryCommentParams,
  CreateStoryCommentResponse,
  DeleteStoryCommentParams,
  DeleteStoryReactionParams,
  GetStoryActivityParams,
  GetStoryActivityResponse,
  ListStoryCommentsParams,
  ListStoryCommentsResponse,
  RecordStoryViewParams,
  RecordStoryViewResponse,
  UpsertStoryReactionBody,
  UpsertStoryReactionParams,
  UpsertStoryReactionResponse,
} from "@workspace/api-zod";
import { getAuthContext, requireAuth } from "../lib/auth";
import {
  deleteSupabaseMedia,
  deleteSupabaseMediaMany,
  createSupabaseSignedReadUrl,
  putSupabaseMedia,
  readSupabaseMedia,
} from "../lib/supabase-storage";

const router: IRouter = Router();
const MAX_STORY_MEDIA_BYTES = 50 * 1024 * 1024;
const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const STORY_REACTIONS = ["❤️", "😂", "😍", "🔥", "👏", "😮", "🙌", "💙", "😭"] as const;

const idParams = z.object({ id: z.string().uuid() });
const privacyInput = z.object({ isPrivate: z.boolean() });
const closeFriendsInput = z.object({
  memberIds: z.array(z.string().uuid()).max(500).refine(ids => new Set(ids).size === ids.length),
});
const createStoryInput = z.object({
  text: z.string().max(2000),
  visibility: z.enum(["public", "followers", "friends", "close-friends"]),
  mediaType: z.enum(["photo", "video"]).optional(),
  mediaId: z.string().uuid().optional(),
  commentsEnabled: z.boolean().optional(),
});
const importStoryInput = z.object({
  sourceId: z.string().trim().min(1).max(180),
  text: z.string().max(2000),
  visibility: z.enum(["public", "followers", "friends", "close-friends"]),
  mediaType: z.enum(["photo", "video"]).optional(),
  mediaId: z.string().uuid().optional(),
  commentsEnabled: z.boolean().optional(),
  savedToProfile: z.boolean().optional(),
  createdAt: z.number().int().min(0).max(8_640_000_000_000_000),
  expiresAt: z.number().int().min(0).max(8_640_000_000_000_000),
}).strict().refine(value =>
  Boolean(value.text.trim() || value.mediaType)
  && value.expiresAt >= value.createdAt
  && value.expiresAt <= value.createdAt + STORY_TTL_MS,
);
const updateStoryInput = z.object({
  savedToProfile: z.boolean().optional(),
  commentsEnabled: z.boolean().optional(),
}).refine(value => Object.keys(value).length > 0);

type StoryRow = typeof storiesTable.$inferSelect;
type StoryAuthor = Pick<typeof usersTable.$inferSelect, "id" | "username" | "displayName" | "createdAt">;

function profileDto(user: StoryAuthor) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    joinedAt: user.createdAt.getTime(),
  };
}

function storyDto(story: StoryRow, author: StoryAuthor, includeSourceId = false, viewerReaction: string | null = null) {
  return {
    id: story.id,
    ...(includeSourceId && story.sourceId ? { sourceId: story.sourceId } : {}),
    text: story.text,
    visibility: story.visibility as "public" | "followers" | "friends" | "close-friends",
    createdAt: story.createdAt.getTime(),
    expiresAt: story.expiresAt.getTime(),
    savedToProfile: story.savedToProfile,
    commentsEnabled: story.commentsEnabled,
    ...(story.mediaType ? { mediaType: story.mediaType as "photo" | "video" } : {}),
    hasMedia: Boolean(story.mediaPath && story.mediaReady),
    author: profileDto(author),
    viewerReaction,
  };
}

async function visibleStory(viewerId: string, storyId: string) {
  const [row] = await db
    .select({
      story: storiesTable,
      author: {
        id: usersTable.id,
        username: usersTable.username,
        displayName: usersTable.displayName,
        createdAt: usersTable.createdAt,
        isPrivate: usersTable.isPrivate,
      },
    })
    .from(storiesTable)
    .innerJoin(usersTable, eq(storiesTable.authorId, usersTable.id))
    .leftJoin(
      closeFriendMembersTable,
      and(
        eq(closeFriendMembersTable.ownerId, storiesTable.authorId),
        eq(closeFriendMembersTable.memberId, viewerId),
      ),
    )
    .where(
      and(
        eq(storiesTable.id, storyId),
        eq(storiesTable.mediaReady, true),
        or(
          eq(storiesTable.authorId, viewerId),
          and(eq(storiesTable.visibility, "public"), eq(usersTable.isPrivate, false)),
          and(
            eq(storiesTable.visibility, "followers"),
            exists(
              db.select({ followerId: userFollowsTable.followerId })
                .from(userFollowsTable)
                .where(and(
                  eq(userFollowsTable.followerId, viewerId),
                  eq(userFollowsTable.followedId, storiesTable.authorId),
                )),
            ),
          ),
          and(
            eq(storiesTable.visibility, "friends"),
            exists(
              db.select({ memberLowId: friendshipsTable.memberLowId })
                .from(friendshipsTable)
                .where(or(
                  and(
                    eq(friendshipsTable.memberLowId, viewerId),
                    eq(friendshipsTable.memberHighId, storiesTable.authorId),
                  ),
                  and(
                    eq(friendshipsTable.memberLowId, storiesTable.authorId),
                    eq(friendshipsTable.memberHighId, viewerId),
                  ),
                )),
            ),
          ),
          and(
            eq(storiesTable.visibility, "close-friends"),
            eq(closeFriendMembersTable.memberId, viewerId),
          ),
        ),
        notExists(
          db.select({ blockedId: accountBlocksTable.blockedId })
            .from(accountBlocksTable)
            .where(and(eq(accountBlocksTable.ownerId, viewerId), eq(accountBlocksTable.blockedId, storiesTable.authorId))),
        ),
        notExists(
          db.select({ blockedId: accountBlocksTable.blockedId })
            .from(accountBlocksTable)
            .where(and(eq(accountBlocksTable.ownerId, storiesTable.authorId), eq(accountBlocksTable.blockedId, viewerId))),
        ),
        or(eq(storiesTable.savedToProfile, true), gt(storiesTable.expiresAt, new Date())),
      ),
    )
    .limit(1);
  return row;
}

async function purgeExpiredStories() {
  const expired = await db
    .select({ id: storiesTable.id, mediaPath: storiesTable.mediaPath })
    .from(storiesTable)
    .where(and(eq(storiesTable.savedToProfile, false), lte(storiesTable.expiresAt, new Date())))
    .limit(50);
  if (!expired.length) return;
  const withMedia = expired.flatMap(story => story.mediaPath ? [story.mediaPath] : []);
  if (withMedia.length) await deleteSupabaseMediaMany(withMedia);
  await db.delete(storiesTable).where(inArray(storiesTable.id, expired.map(story => story.id)));
}

function validMediaBytes(body: Buffer, contentType: string, mediaType: "photo" | "video") {
  if (!body.length || body.length > MAX_STORY_MEDIA_BYTES) return false;
  const signatureValid = contentType === "image/jpeg"
    ? body[0] === 0xff && body[1] === 0xd8
    : contentType === "image/png"
      ? body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : contentType === "image/webp"
        ? body.subarray(0, 4).toString() === "RIFF" && body.subarray(8, 12).toString() === "WEBP"
        : contentType === "video/mp4"
          ? body.subarray(4, 8).toString() === "ftyp"
          : contentType === "video/webm"
            ? body.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
            : false;
  return signatureValid && (mediaType === "photo" ? contentType.startsWith("image/") : contentType.startsWith("video/"));
}

router.get("/account/privacy", requireAuth, async (_req, res): Promise<void> => {
  const { userId } = getAuthContext(res);
  const [user] = await db
    .select({ isPrivate: usersTable.isPrivate, initialized: usersTable.privacyInitialized })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  res.json({ isPrivate: user.isPrivate, initialized: user.initialized });
});

router.put("/account/privacy", requireAuth, async (req, res): Promise<void> => {
  const parsed = privacyInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid profile privacy setting." });
    return;
  }
  const { userId } = getAuthContext(res);
  const [user] = await db
    .update(usersTable)
    .set({ isPrivate: parsed.data.isPrivate, privacyInitialized: true })
    .where(eq(usersTable.id, userId))
    .returning({ isPrivate: usersTable.isPrivate, initialized: usersTable.privacyInitialized });
  if (!user) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  res.json(user);
});

router.get("/close-friends", requireAuth, async (_req, res): Promise<void> => {
  const { userId } = getAuthContext(res);
  const profiles = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      createdAt: usersTable.createdAt,
    })
    .from(closeFriendMembersTable)
    .innerJoin(usersTable, eq(closeFriendMembersTable.memberId, usersTable.id))
    .where(eq(closeFriendMembersTable.ownerId, userId))
    .orderBy(usersTable.username);
  res.json({ profiles: profiles.map(profileDto) });
});

router.put("/close-friends", requireAuth, async (req, res): Promise<void> => {
  const parsed = closeFriendsInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The Close Friends list is invalid." });
    return;
  }
  const { userId } = getAuthContext(res);
  const memberIds = parsed.data.memberIds;
  if (memberIds.includes(userId)) {
    res.status(400).json({ error: "You cannot add your own account to Close Friends." });
    return;
  }
  const members = memberIds.length
    ? await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(inArray(usersTable.id, memberIds))
    : [];
  if (members.length !== memberIds.length) {
    res.status(400).json({ error: "One or more selected accounts no longer exist." });
    return;
  }
  if (memberIds.length) {
    const blocked = await db
      .select({ ownerId: accountBlocksTable.ownerId })
      .from(accountBlocksTable)
      .where(
        or(
          and(eq(accountBlocksTable.ownerId, userId), inArray(accountBlocksTable.blockedId, memberIds)),
          and(inArray(accountBlocksTable.ownerId, memberIds), eq(accountBlocksTable.blockedId, userId)),
        ),
      )
      .limit(1);
    if (blocked.length) {
      res.status(400).json({ error: "Blocked accounts cannot be added to Close Friends." });
      return;
    }
  }
  const profiles = await db.transaction(async tx => {
    await tx.delete(closeFriendMembersTable).where(eq(closeFriendMembersTable.ownerId, userId));
    if (memberIds.length) {
      await tx.insert(closeFriendMembersTable).values(memberIds.map(memberId => ({ ownerId: userId, memberId })));
    }
    return tx
      .select({
        id: usersTable.id,
        username: usersTable.username,
        displayName: usersTable.displayName,
        createdAt: usersTable.createdAt,
      })
      .from(closeFriendMembersTable)
      .innerJoin(usersTable, eq(closeFriendMembersTable.memberId, usersTable.id))
      .where(eq(closeFriendMembersTable.ownerId, userId))
      .orderBy(usersTable.username);
  });
  res.json({ profiles: profiles.map(profileDto) });
});

router.get("/stories", requireAuth, async (_req, res): Promise<void> => {
  const { userId } = getAuthContext(res);
  try {
    await purgeExpiredStories();
  } catch (error) {
    console.error("Expired story media cleanup failed:", error instanceof Error ? error.message : "unknown error");
  }
  const rows = await db
    .select({
      story: storiesTable,
      author: {
        id: usersTable.id,
        username: usersTable.username,
        displayName: usersTable.displayName,
        createdAt: usersTable.createdAt,
      },
    })
    .from(storiesTable)
    .innerJoin(usersTable, eq(storiesTable.authorId, usersTable.id))
    .leftJoin(
      closeFriendMembersTable,
      and(
        eq(closeFriendMembersTable.ownerId, storiesTable.authorId),
        eq(closeFriendMembersTable.memberId, userId),
      ),
    )
    .where(
      and(
        eq(storiesTable.mediaReady, true),
        or(eq(storiesTable.savedToProfile, true), gt(storiesTable.expiresAt, new Date())),
        or(
          eq(storiesTable.authorId, userId),
          and(eq(storiesTable.visibility, "public"), eq(usersTable.isPrivate, false)),
          and(
            eq(storiesTable.visibility, "followers"),
            exists(
              db.select({ followerId: userFollowsTable.followerId })
                .from(userFollowsTable)
                .where(and(
                  eq(userFollowsTable.followerId, userId),
                  eq(userFollowsTable.followedId, storiesTable.authorId),
                )),
            ),
          ),
          and(
            eq(storiesTable.visibility, "friends"),
            exists(
              db.select({ memberLowId: friendshipsTable.memberLowId })
                .from(friendshipsTable)
                .where(or(
                  and(
                    eq(friendshipsTable.memberLowId, userId),
                    eq(friendshipsTable.memberHighId, storiesTable.authorId),
                  ),
                  and(
                    eq(friendshipsTable.memberLowId, storiesTable.authorId),
                    eq(friendshipsTable.memberHighId, userId),
                  ),
                )),
            ),
          ),
          and(
            eq(storiesTable.visibility, "close-friends"),
            eq(closeFriendMembersTable.memberId, userId),
          ),
        ),
        notExists(
          db.select({ blockedId: accountBlocksTable.blockedId })
            .from(accountBlocksTable)
            .where(and(eq(accountBlocksTable.ownerId, userId), eq(accountBlocksTable.blockedId, storiesTable.authorId))),
        ),
        notExists(
          db.select({ blockedId: accountBlocksTable.blockedId })
            .from(accountBlocksTable)
            .where(and(eq(accountBlocksTable.ownerId, storiesTable.authorId), eq(accountBlocksTable.blockedId, userId))),
        ),
      ),
    )
    .orderBy(desc(storiesTable.createdAt))
    .limit(200);
  const reactions = rows.length
    ? await db
      .select({ storyId: storyReactionsTable.storyId, emoji: storyReactionsTable.emoji })
      .from(storyReactionsTable)
      .where(and(
        inArray(storyReactionsTable.storyId, rows.map(row => row.story.id)),
        eq(storyReactionsTable.actorId, userId),
      ))
    : [];
  const viewerReactions = new Map(reactions.map(reaction => [reaction.storyId, reaction.emoji]));
  res.json({ stories: rows.map(row => storyDto(row.story, row.author, false, viewerReactions.get(row.story.id) ?? null)) });
});

router.get("/account/blocks", requireAuth, async (_req, res): Promise<void> => {
  const { userId } = getAuthContext(res);
  const profiles = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      createdAt: usersTable.createdAt,
    })
    .from(accountBlocksTable)
    .innerJoin(usersTable, eq(accountBlocksTable.blockedId, usersTable.id))
    .where(eq(accountBlocksTable.ownerId, userId))
    .orderBy(usersTable.username);
  res.json({ profiles: profiles.map(profileDto) });
});

router.put("/account/blocks", requireAuth, async (req, res): Promise<void> => {
  const parsed = z.object({
    userIds: z.array(z.string().uuid()).max(500).refine(ids => new Set(ids).size === ids.length),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The account block list is invalid." });
    return;
  }
  const { userId } = getAuthContext(res);
  const blockedIds = parsed.data.userIds;
  if (blockedIds.includes(userId)) {
    res.status(400).json({ error: "You cannot block your own account." });
    return;
  }
  const users = blockedIds.length
    ? await db.select({ id: usersTable.id }).from(usersTable).where(inArray(usersTable.id, blockedIds))
    : [];
  if (users.length !== blockedIds.length) {
    res.status(400).json({ error: "One or more selected accounts no longer exist." });
    return;
  }
  const profiles = await db.transaction(async tx => {
    await tx.delete(accountBlocksTable).where(eq(accountBlocksTable.ownerId, userId));
    if (blockedIds.length) {
      await tx.insert(accountBlocksTable).values(blockedIds.map(blockedId => ({ ownerId: userId, blockedId })));
      await tx.delete(closeFriendMembersTable).where(
        or(
          and(eq(closeFriendMembersTable.ownerId, userId), inArray(closeFriendMembersTable.memberId, blockedIds)),
          and(inArray(closeFriendMembersTable.ownerId, blockedIds), eq(closeFriendMembersTable.memberId, userId)),
        ),
      );
      await tx.delete(userFollowsTable).where(or(
        and(eq(userFollowsTable.followerId, userId), inArray(userFollowsTable.followedId, blockedIds)),
        and(inArray(userFollowsTable.followerId, blockedIds), eq(userFollowsTable.followedId, userId)),
      ));
      await tx.delete(followRequestsTable).where(or(
        and(eq(followRequestsTable.requesterId, userId), inArray(followRequestsTable.recipientId, blockedIds)),
        and(inArray(followRequestsTable.requesterId, blockedIds), eq(followRequestsTable.recipientId, userId)),
      ));
      await tx.delete(friendRequestsTable).where(or(
        and(eq(friendRequestsTable.requesterId, userId), inArray(friendRequestsTable.recipientId, blockedIds)),
        and(inArray(friendRequestsTable.requesterId, blockedIds), eq(friendRequestsTable.recipientId, userId)),
      ));
      await tx.delete(friendshipsTable).where(or(
        and(eq(friendshipsTable.memberLowId, userId), inArray(friendshipsTable.memberHighId, blockedIds)),
        and(inArray(friendshipsTable.memberLowId, blockedIds), eq(friendshipsTable.memberHighId, userId)),
      ));
    }
    return tx
      .select({
        id: usersTable.id,
        username: usersTable.username,
        displayName: usersTable.displayName,
        createdAt: usersTable.createdAt,
      })
      .from(accountBlocksTable)
      .innerJoin(usersTable, eq(accountBlocksTable.blockedId, usersTable.id))
      .where(eq(accountBlocksTable.ownerId, userId))
      .orderBy(usersTable.username);
  });
  res.json({ profiles: profiles.map(profileDto) });
});

router.post("/stories", requireAuth, async (req, res): Promise<void> => {
  const parsed = createStoryInput.safeParse(req.body);
  if (!parsed.success || (!parsed.data.text.trim() && !parsed.data.mediaType)) {
    res.status(400).json({ error: "Add text or media to your Story." });
    return;
  }
  const { userId } = getAuthContext(res);
  const mediaAsset = parsed.data.mediaId
    ? (await db.select().from(userMediaAssetsTable).where(and(
      eq(userMediaAssetsTable.id, parsed.data.mediaId),
      eq(userMediaAssetsTable.userId, userId),
      eq(userMediaAssetsTable.ready, true),
    )).limit(1))[0]
    : null;
  if (parsed.data.mediaId && (!mediaAsset || !parsed.data.mediaType ||
    (parsed.data.mediaType === "photo" && !mediaAsset.contentType.startsWith("image/")) ||
    (parsed.data.mediaType === "video" && !mediaAsset.contentType.startsWith("video/")))) {
    res.status(409).json({ error: "The Story media is not confirmed in your online account." });
    return;
  }
  const [author] = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      createdAt: usersTable.createdAt,
      isPrivate: usersTable.isPrivate,
      privacyInitialized: usersTable.privacyInitialized,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!author) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  if (!author.privacyInitialized) {
    res.status(409).json({ error: "Sync your profile privacy settings before sharing a Story." });
    return;
  }
  if (author.isPrivate && parsed.data.visibility === "public") {
    res.status(409).json({ error: "Private accounts can share online Stories with Close Friends only." });
    return;
  }
  if (parsed.data.visibility === "close-friends") {
    const [member] = await db
      .select({ memberId: closeFriendMembersTable.memberId })
      .from(closeFriendMembersTable)
      .where(eq(closeFriendMembersTable.ownerId, userId))
      .limit(1);
    if (!member) {
      res.status(409).json({ error: "Add people to Close Friends before sharing privately." });
      return;
    }
  }
  const [story] = await db
    .insert(storiesTable)
    .values({
      authorId: userId,
      text: parsed.data.text.trim(),
      visibility: parsed.data.visibility,
      mediaType: parsed.data.mediaType ?? null,
      mediaPath: mediaAsset?.objectKey ?? null,
      mediaReady: Boolean(mediaAsset) || !parsed.data.mediaType,
      commentsEnabled: parsed.data.commentsEnabled ?? true,
      expiresAt: new Date(Date.now() + STORY_TTL_MS),
    })
    .returning();
  res.status(201).json({ story: storyDto(story, author) });
});

router.post("/stories/import", requireAuth, async (req, res): Promise<void> => {
  const parsed = importStoryInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The legacy Story could not be validated." });
    return;
  }
  const { userId } = getAuthContext(res);
  const [author] = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      createdAt: usersTable.createdAt,
      isPrivate: usersTable.isPrivate,
      privacyInitialized: usersTable.privacyInitialized,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!author) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  if (!author.privacyInitialized) {
    res.status(409).json({ error: "Sync your profile privacy settings before migrating Stories." });
    return;
  }

  const value = parsed.data;
  const mediaAsset = value.mediaId
    ? (await db.select().from(userMediaAssetsTable).where(and(
      eq(userMediaAssetsTable.id, value.mediaId),
      eq(userMediaAssetsTable.userId, userId),
      eq(userMediaAssetsTable.ready, true),
    )).limit(1))[0]
    : null;
  if (value.mediaId && (!mediaAsset || !value.mediaType ||
    (value.mediaType === "photo" && !mediaAsset.contentType.startsWith("image/")) ||
    (value.mediaType === "video" && !mediaAsset.contentType.startsWith("video/")))) {
    res.status(409).json({ error: "The Story media is not confirmed in your online account." });
    return;
  }
  const createdAt = new Date(value.createdAt);
  const expiresAt = new Date(value.expiresAt);
  const matchesSource = (story: StoryRow) =>
    story.text === value.text.trim()
    && story.visibility === value.visibility
    && story.mediaType === (value.mediaType ?? null)
    && story.commentsEnabled === (value.commentsEnabled ?? true)
    && story.savedToProfile === (value.savedToProfile ?? false)
    && story.createdAt.getTime() === createdAt.getTime()
    && story.expiresAt.getTime() === expiresAt.getTime();

  let [story] = await db
    .select()
    .from(storiesTable)
    .where(and(eq(storiesTable.authorId, userId), eq(storiesTable.sourceId, value.sourceId)))
    .limit(1);
  let alreadyImported = Boolean(story);
  if (story && !matchesSource(story)) {
    res.status(409).json({ error: "A different cloud Story already uses this legacy source ID." });
    return;
  }
  if (!story) {
    [story] = await db
      .insert(storiesTable)
      .values({
        authorId: userId,
        sourceId: value.sourceId,
        text: value.text.trim(),
        visibility: value.visibility,
        mediaType: value.mediaType ?? null,
        mediaPath: mediaAsset?.objectKey ?? null,
        mediaReady: Boolean(mediaAsset) || !value.mediaType,
        savedToProfile: value.savedToProfile ?? false,
        commentsEnabled: value.commentsEnabled ?? true,
        createdAt,
        expiresAt,
      })
      .onConflictDoNothing({ target: [storiesTable.authorId, storiesTable.sourceId] })
      .returning();
    if (story) {
      alreadyImported = false;
    } else {
      [story] = await db
        .select()
        .from(storiesTable)
        .where(and(eq(storiesTable.authorId, userId), eq(storiesTable.sourceId, value.sourceId)))
        .limit(1);
      alreadyImported = true;
      if (!story || !matchesSource(story)) {
        res.status(409).json({ error: "The legacy Story conflicted with another import." });
        return;
      }
    }
  }
  if (story && mediaAsset && !story.mediaReady && story.mediaType === value.mediaType) {
    [story] = await db.update(storiesTable)
      .set({ mediaPath: mediaAsset.objectKey, mediaReady: true })
      .where(and(eq(storiesTable.id, story.id), eq(storiesTable.authorId, userId), eq(storiesTable.mediaReady, false)))
      .returning();
  }
  res.status(200).json({
    story: storyDto(story, author, true),
    alreadyImported,
  });
});

router.post(
  "/stories/:id/media",
  requireAuth,
  raw({ type: ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"], limit: MAX_STORY_MEDIA_BYTES }),
  async (req, res): Promise<void> => {
    const params = idParams.safeParse(req.params);
    const { userId } = getAuthContext(res);
    if (!params.success || !Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "Choose a supported image or video under the current storage limit." });
      return;
    }
    const [story] = await db
      .select()
      .from(storiesTable)
      .where(and(eq(storiesTable.id, params.data.id), eq(storiesTable.authorId, userId)))
      .limit(1);
    if (!story || !story.mediaType || story.mediaReady) {
      res.status(404).json({ error: "Story upload not found." });
      return;
    }
    const contentType = String(req.header("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!validMediaBytes(req.body, contentType, story.mediaType as "photo" | "video")) {
      res.status(400).json({ error: "The file type or media content is not supported." });
      return;
    }
    const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm" } as const)[contentType as "image/jpeg" | "image/png" | "image/webp" | "video/mp4" | "video/webm"];
    const mediaPath = `stories/${userId}/${story.id}.${extension}`;
    try {
      await putSupabaseMedia(mediaPath, req.body, contentType);
      const [updated] = await db
        .update(storiesTable)
        .set({ mediaPath, mediaReady: true })
        .where(and(eq(storiesTable.id, story.id), eq(storiesTable.authorId, userId), eq(storiesTable.mediaReady, false)))
        .returning({ id: storiesTable.id });
      if (!updated) throw new Error("Story upload could not be finalized.");
      res.status(204).end();
    } catch (error) {
      try { await deleteSupabaseMedia(mediaPath); } catch { /* preserve the original upload error */ }
      res.status(500).json({ error: error instanceof Error ? error.message : "Story media upload failed." });
    }
  },
);

router.get("/stories/:id/media", requireAuth, async (req, res): Promise<void> => {
  const params = idParams.safeParse(req.params);
  const { userId } = getAuthContext(res);
  if (!params.success) {
    res.status(404).json({ error: "Story not found." });
    return;
  }
  const row = await visibleStory(userId, params.data.id);
  if (!row?.story.mediaPath || !row.story.mediaType) {
    res.status(404).json({ error: "Story not found." });
    return;
  }
  try {
    const body = await readSupabaseMedia(row.story.mediaPath);
    const extension = row.story.mediaPath.split(".").at(-1);
    const contentType = ({ jpg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", webm: "video/webm" } as const)[extension as "jpg" | "png" | "webp" | "mp4" | "webm"];
    if (!contentType) {
      res.status(404).json({ error: "Story media not found." });
      return;
    }
    res.set({
      "Content-Type": contentType,
      "Content-Length": String(body.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    }).status(200).send(body);
  } catch {
    res.status(404).json({ error: "Story media not found." });
  }
});

router.get("/stories/:id/media-url", requireAuth, async (req, res): Promise<void> => {
  const params = idParams.safeParse(req.params);
  const { userId } = getAuthContext(res);
  if (!params.success) { res.sendStatus(404); return; }
  const row = await visibleStory(userId, params.data.id);
  if (!row?.story.mediaPath || !row.story.mediaType || !row.story.mediaReady) {
    res.sendStatus(404);
    return;
  }
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json({ url: await createSupabaseSignedReadUrl(row.story.mediaPath) });
  } catch {
    res.status(503).json({ error: "Story media could not be loaded. Please retry." });
  }
});

router.post("/stories/:id/views", requireAuth, async (req, res): Promise<void> => {
  const params = RecordStoryViewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "The Story ID is invalid." });
    return;
  }
  const { userId } = getAuthContext(res);
  const visible = await visibleStory(userId, params.data.id);
  if (!visible) {
    res.status(404).json({ error: "Story not found or not visible." });
    return;
  }
  if (visible.story.authorId === userId) {
    res.json(RecordStoryViewResponse.parse({ recorded: false }));
    return;
  }
  const [recorded] = await db
    .insert(storyViewsTable)
    .values({ storyId: params.data.id, viewerId: userId })
    .onConflictDoNothing()
    .returning({ storyId: storyViewsTable.storyId });
  res.json(RecordStoryViewResponse.parse({ recorded: Boolean(recorded) }));
});

router.put("/stories/:id/reactions", requireAuth, async (req, res): Promise<void> => {
  const params = UpsertStoryReactionParams.safeParse(req.params);
  const parsed = UpsertStoryReactionBody.safeParse(req.body);
  if (!params.success || !parsed.success || !STORY_REACTIONS.includes(parsed.data.emoji as typeof STORY_REACTIONS[number])) {
    res.status(400).json({ error: "Choose a supported Story reaction." });
    return;
  }
  const { userId } = getAuthContext(res);
  const visible = await visibleStory(userId, params.data.id);
  if (!visible) {
    res.status(404).json({ error: "Story not found or not visible." });
    return;
  }
  if (visible.story.authorId !== userId) {
    await db
      .insert(storyViewsTable)
      .values({ storyId: params.data.id, viewerId: userId })
      .onConflictDoNothing();
  }
  const [reaction] = await db
    .insert(storyReactionsTable)
    .values({ storyId: params.data.id, actorId: userId, emoji: parsed.data.emoji })
    .onConflictDoUpdate({
      target: [storyReactionsTable.storyId, storyReactionsTable.actorId],
      set: { emoji: parsed.data.emoji, updatedAt: new Date() },
    })
    .returning();
  res.json(UpsertStoryReactionResponse.parse({
    reaction: { emoji: reaction.emoji, createdAt: reaction.createdAt.getTime() },
  }));
  if (visible.story.authorId !== userId) notifyAccountActivity(visible.story.authorId);
});

router.delete("/stories/:id/reactions", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteStoryReactionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "The Story ID is invalid." });
    return;
  }
  const { userId } = getAuthContext(res);
  if (!await visibleStory(userId, params.data.id)) {
    res.status(404).json({ error: "Story not found or not visible." });
    return;
  }
  await db.delete(storyReactionsTable).where(and(
    eq(storyReactionsTable.storyId, params.data.id),
    eq(storyReactionsTable.actorId, userId),
  ));
  res.status(204).end();
});

router.get("/stories/:id/activity", requireAuth, async (req, res): Promise<void> => {
  const params = GetStoryActivityParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Story activity not found." });
    return;
  }
  const { userId } = getAuthContext(res);
  const [story] = await db
    .select({ id: storiesTable.id })
    .from(storiesTable)
    .where(and(eq(storiesTable.id, params.data.id), eq(storiesTable.authorId, userId)))
    .limit(1);
  if (!story) {
    res.status(404).json({ error: "Story activity not found." });
    return;
  }
  const [viewCount] = await db
    .select({ value: count() })
    .from(storyViewsTable)
    .where(eq(storyViewsTable.storyId, params.data.id));
  const [reactionCount] = await db
    .select({ value: count() })
    .from(storyReactionsTable)
    .where(eq(storyReactionsTable.storyId, params.data.id));
  const viewers = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      viewedAt: storyViewsTable.viewedAt,
      reaction: storyReactionsTable.emoji,
    })
    .from(storyViewsTable)
    .innerJoin(usersTable, eq(storyViewsTable.viewerId, usersTable.id))
    .leftJoin(storyReactionsTable, and(
      eq(storyReactionsTable.storyId, storyViewsTable.storyId),
      eq(storyReactionsTable.actorId, storyViewsTable.viewerId),
    ))
    .where(eq(storyViewsTable.storyId, params.data.id))
    .orderBy(desc(storyViewsTable.viewedAt))
    .limit(500);
  res.json(GetStoryActivityResponse.parse({
    viewCount: Number(viewCount?.value ?? 0),
    reactionCount: Number(reactionCount?.value ?? 0),
    viewers: viewers.map(viewer => ({
      id: viewer.id,
      username: viewer.username,
      displayName: viewer.displayName || viewer.username,
      viewedAt: viewer.viewedAt.getTime(),
      reaction: viewer.reaction,
    })),
  }));
});

router.get("/stories/:id/comments", requireAuth, async (req, res): Promise<void> => {
  const params = ListStoryCommentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "The Story ID is invalid." });
    return;
  }
  const { userId } = getAuthContext(res);
  if (!await visibleStory(userId, params.data.id)) {
    res.status(404).json({ error: "Story not found or not visible." });
    return;
  }
  const rows = await db
    .select({
      id: storyCommentsTable.id,
      body: storyCommentsTable.body,
      createdAt: storyCommentsTable.createdAt,
      authorId: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
    })
    .from(storyCommentsTable)
    .innerJoin(usersTable, eq(storyCommentsTable.authorId, usersTable.id))
    .where(eq(storyCommentsTable.storyId, params.data.id))
    .orderBy(asc(storyCommentsTable.createdAt))
    .limit(200);
  res.json(ListStoryCommentsResponse.parse({
    comments: rows.map(row => ({
      id: row.id,
      body: row.body,
      createdAt: row.createdAt.getTime(),
      author: {
        id: row.authorId,
        username: row.username,
        displayName: row.displayName || row.username,
      },
    })),
  }));
});

router.post("/stories/:id/comments", requireAuth, async (req, res): Promise<void> => {
  const params = CreateStoryCommentParams.safeParse(req.params);
  const parsed = CreateStoryCommentBody.safeParse(req.body);
  const body = parsed.success ? parsed.data.body.trim() : "";
  if (!params.success || !parsed.success || !body) {
    res.status(400).json({ error: "Write a reply of up to 300 characters." });
    return;
  }
  const { userId } = getAuthContext(res);
  const visible = await visibleStory(userId, params.data.id);
  if (!visible) {
    res.status(404).json({ error: "Story not found or not visible." });
    return;
  }
  if (!visible.story.commentsEnabled || (!visible.story.savedToProfile && visible.story.expiresAt <= new Date())) {
    res.status(409).json({ error: "Replies are turned off or this Story has expired." });
    return;
  }
  const [comment] = await db
    .insert(storyCommentsTable)
    .values({ storyId: params.data.id, authorId: userId, body })
    .returning();
  const [author] = await db
    .select({ id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!author) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  res.status(201).json(CreateStoryCommentResponse.parse({
    comment: {
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt.getTime(),
      author: { id: author.id, username: author.username, displayName: author.displayName || author.username },
    },
  }));
  if (visible.story.authorId !== userId) notifyAccountActivity(visible.story.authorId);
});

router.delete("/stories/:id/comments/:commentId", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteStoryCommentParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Reply not found." });
    return;
  }
  const { userId } = getAuthContext(res);
  const [comment] = await db
    .select({
      id: storyCommentsTable.id,
      authorId: storyCommentsTable.authorId,
      storyAuthorId: storiesTable.authorId,
    })
    .from(storyCommentsTable)
    .innerJoin(storiesTable, eq(storyCommentsTable.storyId, storiesTable.id))
    .where(and(
      eq(storyCommentsTable.id, params.data.commentId),
      eq(storyCommentsTable.storyId, params.data.id),
    ))
    .limit(1);
  if (!comment || (comment.authorId !== userId && comment.storyAuthorId !== userId)) {
    res.status(404).json({ error: "Reply not found or not authorized." });
    return;
  }
  await db.delete(storyCommentsTable).where(eq(storyCommentsTable.id, comment.id));
  res.status(204).end();
});

router.patch("/stories/:id", requireAuth, async (req, res): Promise<void> => {
  const params = idParams.safeParse(req.params);
  const parsed = updateStoryInput.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "The Story update is invalid." });
    return;
  }
  const { userId } = getAuthContext(res);
  const [row] = await db
    .select({
      story: storiesTable,
      author: {
        id: usersTable.id,
        username: usersTable.username,
        displayName: usersTable.displayName,
        createdAt: usersTable.createdAt,
      },
    })
    .from(storiesTable)
    .innerJoin(usersTable, eq(storiesTable.authorId, usersTable.id))
    .where(and(eq(storiesTable.id, params.data.id), eq(storiesTable.authorId, userId)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Story not found." });
    return;
  }
  const [updated] = await db
    .update(storiesTable)
    .set({ savedToProfile: parsed.data.savedToProfile })
    .where(eq(storiesTable.id, row.story.id))
    .returning();
  res.json({ story: storyDto(updated, row.author) });
});

router.delete("/stories/:id", requireAuth, async (req, res): Promise<void> => {
  const params = idParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Story not found." });
    return;
  }
  const { userId } = getAuthContext(res);
  const [story] = await db
    .select({ id: storiesTable.id, mediaPath: storiesTable.mediaPath })
    .from(storiesTable)
    .where(and(eq(storiesTable.id, params.data.id), eq(storiesTable.authorId, userId)))
    .limit(1);
  if (!story) {
    res.status(404).json({ error: "Story not found." });
    return;
  }
  const [mediaAsset] = story.mediaPath
    ? await db.select().from(userMediaAssetsTable).where(eq(userMediaAssetsTable.objectKey, story.mediaPath)).limit(1)
    : [];
  let deleteAsset = Boolean(story.mediaPath && !mediaAsset);
  if (mediaAsset) {
    const [postReference] = await db.select({ id: postMediaAssetsTable.mediaId })
      .from(postMediaAssetsTable).where(eq(postMediaAssetsTable.mediaId, mediaAsset.id)).limit(1);
    const [chatReference] = await db.select({ id: chatMessageMediaTable.messageId })
      .from(chatMessageMediaTable).where(eq(chatMessageMediaTable.mediaId, mediaAsset.id)).limit(1);
    const [otherStoryReference] = await db.select({ id: storiesTable.id }).from(storiesTable).where(and(
      eq(storiesTable.mediaPath, mediaAsset.objectKey), ne(storiesTable.id, story.id),
    )).limit(1);
    deleteAsset = !postReference && !chatReference && !otherStoryReference;
  }
  if (deleteAsset && story.mediaPath) await deleteSupabaseMedia(story.mediaPath);
  await db.delete(storiesTable).where(and(eq(storiesTable.id, story.id), eq(storiesTable.authorId, userId)));
  if (deleteAsset && mediaAsset) {
    await db.delete(userMediaAssetsTable).where(and(
      eq(userMediaAssetsTable.id, mediaAsset.id), eq(userMediaAssetsTable.userId, userId),
    ));
  }
  res.status(204).end();
});

export default router;
