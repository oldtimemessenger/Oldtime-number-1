import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { accountStateTable, usersTable } from "@workspace/db/schema";
import { createRateLimiter, getAuthContext, requireAuth } from "../lib/auth";

const router = Router();
const stateId = z.string().trim().min(1).max(128);
const timestamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const helpItemSchema = z.object({
  lastShownAt: timestamp.optional(),
  viewedAt: timestamp.optional(),
  never: z.boolean().optional(),
  dismissed: z.number().int().min(0).max(1000).optional(),
  actions: z.number().int().min(0).max(1000).optional(),
}).strict();
const profileMedia = z.string().trim().min(1).max(1024)
  .refine(value => !/^(data:|blob:)/i.test(value), "Upload profile media to your account before saving.");
const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(64).optional(),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/).optional(),
  bio: z.string().max(280).optional(),
  city: z.string().max(80).optional(),
  birthday: z.string().max(10).refine(value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value)).optional(),
  interests: z.array(z.enum([
    "Sports", "Photography", "Music", "Comedy", "Food", "Travel",
    "Fitness", "News", "Art", "Gaming", "Fashion", "Technology",
  ])).max(12).optional(),
  avatar: profileMedia.optional(),
  cover: profileMedia.nullable().optional(),
  avatarPreset: z.string().max(120).nullable().optional(),
  profileVisibility: z.object({ city: z.boolean(), interests: z.boolean() }).strict().optional(),
}).strict();
const profileCollectionItemSchema = z.object({
  id: stateId,
  postId: stateId,
  mediaIndex: z.number().int().min(0).max(100),
  caption: z.string().max(500).optional(),
  createdAt: timestamp,
}).strict();
const profileCollectionSchema = z.object({
  id: stateId,
  type: z.enum(["album", "memory"]),
  title: z.string().trim().min(1).max(60),
  description: z.string().max(220).optional(),
  coverUri: profileMedia.optional(),
  coverTemplate: z.enum(["mono", "red", "night"]).optional(),
  coverPosition: z.object({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    zoom: z.number().min(1).max(2),
  }).strict().optional(),
  createdAt: timestamp,
  items: z.array(profileCollectionItemSchema).max(300),
}).strict();
const legacyPostArchiveSchema = z.object({
  sourcePostId: stateId,
  legacyLikes: z.array(z.string().max(128)).max(500),
  legacySaves: z.array(z.string().max(128)).max(500),
  comments: z.array(z.object({
    id: stateId,
    authorId: z.string().max(128),
    username: z.string().max(24),
    displayName: z.string().max(64),
    body: z.string().max(1000),
    createdAt: timestamp,
    parentId: stateId.nullable().optional(),
  }).strict()).max(200),
}).strict();
const accountStateSchema = z.object({
  savedPostIds: z.array(stateId).max(5000).optional(),
  savedAudioIds: z.array(stateId).max(2000).optional(),
  commentFavorites: z.array(stateId).max(5000).optional(),
  savedCollections: z.array(z.object({
    id: stateId,
    name: z.string().trim().min(1).max(60),
    postIds: z.array(stateId).max(5000),
    createdAt: timestamp,
  }).strict()).max(200).optional(),
  profileCollections: z.array(profileCollectionSchema).max(100).optional(),
  interestPreferences: z.object({
    enabled: z.boolean(),
    selected: z.array(z.enum([
      "Sports", "Photography", "Music", "Comedy", "Food", "Travel",
      "Fitness", "News", "Art", "Gaming", "Fashion", "Technology",
    ])).max(12),
  }).strict().nullable().optional(),
  notificationEnabled: z.boolean().optional(),
  chatPreferences: z.object({
    readReceipts: z.boolean(),
    lastSeen: z.enum(["everyone", "contacts", "nobody"]),
  }).strict().optional(),
  helpPreferences: z.object({
    lastShownAt: timestamp,
    paused: z.boolean(),
    items: z.record(z.string(), helpItemSchema).refine(items => Object.keys(items).length <= 50),
  }).strict().optional(),
  emojiPreferences: z.object({
    recent: z.array(z.string().min(1).max(16)).max(32),
    favorites: z.array(z.string().min(1).max(16)).max(128),
  }).strict().optional(),
  creativeToolsTheme: z.enum(["dark", "light"]).optional(),
  callFeedback: z.array(z.object({
    id: stateId,
    user: z.string().uuid(),
    peer: z.string().uuid(),
    convoId: stateId,
    video: z.boolean(),
    durationSeconds: z.number().int().min(0).max(24 * 60 * 60),
    rating: z.number().int().min(1).max(5),
    message: z.string().max(240),
    created: timestamp,
  }).strict()).max(1000).optional(),
  legacyPostArchives: z.array(legacyPostArchiveSchema).max(500).optional(),
  profile: profileSchema.optional(),
}).strict();

router.use("/account/state", requireAuth, createRateLimiter("account-state", 60));
router.use("/account/profile", requireAuth, createRateLimiter("account-profile", 30));

const profileUpdateSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/),
  displayName: z.string().trim().min(1).max(64),
  email: z.string().trim().email().max(254),
  profile: profileSchema,
}).strict();

router.get("/account/state", async (_req, res): Promise<void> => {
  const userId = getAuthContext(res).userId;
  const [record] = await db.select({ data: accountStateTable.data })
    .from(accountStateTable)
    .where(eq(accountStateTable.userId, userId))
    .limit(1);
  res.json({ state: record?.data || null });
});

router.put("/account/state", async (req, res): Promise<void> => {
  const parsed = accountStateSchema.safeParse(req.body?.state);
  if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.success ? parsed.data : req.body?.state || {})) > 256 * 1024) {
    res.status(400).json({ error: "Account settings or saved items are invalid or too large." });
    return;
  }
  const userId = getAuthContext(res).userId;
  await db.insert(accountStateTable).values({
    userId,
    data: parsed.data,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: accountStateTable.userId,
    set: {
      data: sql`${JSON.stringify(parsed.data)}::jsonb || jsonb_build_object('notificationReadAt', coalesce(${accountStateTable.data}->'notificationReadAt', '0'::jsonb))`,
      updatedAt: new Date(),
    },
  });
  res.json({ ok: true, updatedAt: Date.now() });
});

router.put("/account/profile", async (req, res): Promise<void> => {
  const parsed = profileUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Profile details are invalid." });
    return;
  }
  const userId = getAuthContext(res).userId;
  const [current] = await db.select({
    id: usersTable.id,
    username: usersTable.username,
    displayName: usersTable.displayName,
    email: usersTable.email,
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!current) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  if (parsed.data.email.toLowerCase() !== current.email.toLowerCase()) {
    res.status(409).json({ error: "Sign-in email changes require account verification and cannot be changed here." });
    return;
  }
  const [conflict] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.username, parsed.data.username)).limit(1);
  if (conflict && conflict.id !== userId) {
    res.status(409).json({ error: "That username is already in use." });
    return;
  }
  const stateProfile = {
    ...parsed.data.profile,
    displayName: parsed.data.displayName,
    username: parsed.data.username,
    profileVisibility: parsed.data.profile.profileVisibility || { city: true, interests: true },
  };
  const account = await db.transaction(async tx => {
    const [existing] = await tx.select({ data: accountStateTable.data }).from(accountStateTable)
      .where(eq(accountStateTable.userId, userId)).limit(1);
    const state = { ...(existing?.data || {}), profile: stateProfile };
    const [updated] = await tx.update(usersTable).set({
      username: parsed.data.username,
      displayName: parsed.data.displayName,
    }).where(eq(usersTable.id, userId)).returning({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      email: usersTable.email,
    });
    await tx.insert(accountStateTable).values({
      userId,
      data: state,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: accountStateTable.userId,
      set: {
        data: sql`${JSON.stringify(state)}::jsonb || jsonb_build_object('notificationReadAt', coalesce(${accountStateTable.data}->'notificationReadAt', '0'::jsonb))`,
        updatedAt: new Date(),
      },
    });
    return updated;
  });
  res.json({ account, profile: stateProfile });
});

export default router;
