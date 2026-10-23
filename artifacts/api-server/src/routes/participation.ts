import { Router, raw, type IRouter, type RequestHandler } from "express";
import { and, or, eq, ne, inArray, notInArray, desc, ilike, like, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { randomUUID } from "node:crypto";
import { db, usersTable, postsTable, participationBoards as boards, participationEntries as entries,
  participationInvites as invites, participationReactions as reactions, participationReports as reports,
  participationBlocks as blocks, participationComments as comments } from "@workspace/db";
import { requireAuth, getAuthContext } from "../lib/auth";
import { boardInput, entryInput, entryUpdateInput, canUpdateEntry, canReadBoard, acceptsEntry } from "../lib/participation-policy";
import { storeSportsImage, storeSportsVideo, readSportsImage, deleteSportsImage } from "../lib/sports-media";

const router: IRouter = Router();
const uid = (res: Parameters<typeof getAuthContext>[0]) => getAuthContext(res)!.userId;
const validId = (v: unknown): v is string => z.string().uuid().safeParse(v).success;
const rates = new Map<string, { since: number; count: number }>();
router.use("/boards", requireAuth, (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") { next(); return; }
  const now = Date.now(), key = uid(res);
  for (const [k, v] of rates) if (now - v.since > 600000) rates.delete(k);
  const r = rates.get(key) || { since: now, count: 0 }; r.count++; rates.set(key, r);
  if (r.count > 45) { res.status(429).json({ error: "Take a moment before trying again." }); return; }
  next();
});
async function blockedIds(userId: string) {
  const rows = await db.select().from(blocks).where(or(eq(blocks.userId, userId), eq(blocks.blockedId, userId)));
  return rows.map(r => r.userId === userId ? r.blockedId : r.userId);
}
async function accessible(id: unknown, userId: string) {
  if (!validId(id)) return null;
  const [b] = await db.select().from(boards).where(eq(boards.id, id));
  if (!b) return null;
  const [inv] = await db.select().from(invites).where(and(eq(invites.boardId, id), eq(invites.userId, userId)));
  return canReadBoard(b, userId, !!inv, (await blockedIds(userId)).includes(b.creatorId)) ? b : null;
}
const countEntries = sql<number>`(select count(*)::int from participation_entries pe where pe.board_id=${boards.id} and not pe.removed)`;
const participantCount = sql<number>`(select count(distinct pe.user_id)::int from participation_entries pe where pe.board_id=${boards.id} and not pe.removed)`;
const likesCount = sql<number>`(select count(*)::int from participation_reactions pr where pr.entry_id=${entries.id})`;
async function boardDto(id: string, viewer: string) {
  const [r] = await db.select({ board: boards, username: usersTable.username, displayName: usersTable.displayName,
    entryCount: countEntries, participantCount }).from(boards).innerJoin(usersTable, eq(usersTable.id, boards.creatorId)).where(eq(boards.id, id));
  return r ? { ...r.board, entryCount: r.entryCount, participantCount: r.participantCount,
    creator: { id: r.board.creatorId, username: r.username, displayName: r.displayName }, canManage: r.board.creatorId === viewer } : null;
}
async function entryDto(id: string, viewer: string, owner: string) {
  const [r] = await db.select({ entry: entries, username: usersTable.username, displayName: usersTable.displayName, likes: likesCount,
    likedByMe: sql<boolean>`exists(select 1 from participation_reactions pr where pr.entry_id=${entries.id} and pr.user_id=${viewer})` })
    .from(entries).innerJoin(usersTable, eq(usersTable.id, entries.userId)).where(eq(entries.id, id));
  if (!r) return null;
  const { object, ...entry } = r.entry;
  return { ...entry, author: { id: entry.userId, username: r.username, displayName: r.displayName }, likes: r.likes,
    likedByMe: r.likedByMe, canDelete: entry.userId === viewer, canManage: owner === viewer,
    mediaPath: object ? `/api/boards/${entry.boardId}/entries/${entry.id}/media` : null };
}
async function entryAccess(boardId: unknown, entryId: unknown, userId: string) {
  const b = await accessible(boardId, userId);
  if (!b || !validId(entryId)) return null;
  const [e] = await db.select().from(entries).where(and(eq(entries.id, entryId), eq(entries.boardId, b.id)));
  if (!e || (await blockedIds(userId)).includes(e.userId) || e.removed && e.userId !== userId && b.creatorId !== userId) return null;
  return { b, e };
}
const offsetOf = (v: unknown) => Math.floor(Math.max(0, Math.min(10000, Number(v) || 0)));
router.get("/boards", async (req, res) => {
  const u = uid(res), hidden = await blockedIds(u), offset = offsetOf(req.query.offset);
  const rows = await db.select({ id: boards.id }).from(boards).where(and(
    or(eq(boards.creatorId, u), eq(boards.visibility, "public"), and(eq(boards.visibility, "invite_only"),
      inArray(boards.id, db.select({ id: invites.boardId }).from(invites).where(eq(invites.userId, u))))),
    hidden.length ? notInArray(boards.creatorId, hidden) : undefined,
    req.query.mine === "true" ? eq(boards.creatorId, u) : undefined,
    typeof req.query.category === "string" && req.query.category ? eq(boards.category, req.query.category) : undefined,
    typeof req.query.q === "string" && req.query.q ? ilike(boards.prompt, `%${req.query.q.slice(0, 100)}%`) : undefined))
    .orderBy(req.query.sort === "popular" ? desc(countEntries) : desc(boards.createdAt), desc(boards.id)).offset(offset).limit(21);
  res.json({ boards: await Promise.all(rows.slice(0, 20).map(r => boardDto(r.id, u))), hasMore: rows.length > 20 });
});
router.post("/boards", async (req, res) => {
  const input = boardInput.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Add a prompt and choose valid participation settings." }); return; }
  const [b] = await db.insert(boards).values({ ...input.data, creatorId: uid(res) }).returning();
  res.status(201).json(await boardDto(b.id, uid(res)));
});
router.put("/boards/blocks/:userId", async (req, res) => {
  if (!validId(req.params.userId) || req.params.userId === uid(res)) { res.sendStatus(400); return; }
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, req.params.userId));
  if (!user) { res.sendStatus(404); return; }
  await db.insert(blocks).values({ userId: uid(res), blockedId: user.id }).onConflictDoNothing(); res.sendStatus(204);
});
router.delete("/boards/blocks/:userId", async (req, res) => {
  if (!validId(req.params.userId)) { res.sendStatus(400); return; }
  await db.delete(blocks).where(and(eq(blocks.userId, uid(res)), eq(blocks.blockedId, req.params.userId))); res.sendStatus(204);
});
router.get("/boards/blocks", async (_req, res) => {
  const people = await db.select({ id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName })
    .from(blocks).innerJoin(usersTable, eq(usersTable.id, blocks.blockedId)).where(eq(blocks.userId, uid(res)));
  res.json({ users: people });
});
router.get("/boards/:id", async (req, res) => {
  const u = uid(res), b = await accessible(req.params.id, u);
  if (!b) { res.sendStatus(404); return; }
  const hidden = await blockedIds(u), offset = offsetOf(req.query.offset);
  const list = await db.select({ id: entries.id }).from(entries).where(and(eq(entries.boardId, b.id),
    b.creatorId === u ? undefined : eq(entries.removed, false),
    req.query.mine === "true" ? eq(entries.userId, u) : undefined, hidden.length ? notInArray(entries.userId, hidden) : undefined))
    .orderBy(desc(entries.pinned), req.query.sort === "popular" ? desc(likesCount) :
      req.query.sort === "surprise" ? sql`random()` : desc(entries.createdAt), desc(entries.id)).offset(offset).limit(25);
  res.json({ board: await boardDto(b.id, u), entries: await Promise.all(list.slice(0, 24).map(e => entryDto(e.id, u, b.creatorId))), hasMore: list.length > 24 });
});
router.patch("/boards/:id", async (req, res) => {
  const b = await accessible(req.params.id, uid(res));
  if (!b || b.creatorId !== uid(res)) { res.sendStatus(404); return; }
  const input = z.object({ status: z.enum(["open", "closed"]).optional(), rules: z.string().trim().max(1000).optional(), commentsEnabled: z.boolean().optional() }).strict().safeParse(req.body);
  if (!input.success) { res.sendStatus(400); return; }
  await db.update(boards).set(input.data).where(eq(boards.id, b.id)); res.json(await boardDto(b.id, uid(res)));
});
router.post("/boards/:id/invites", async (req, res) => {
  const b = await accessible(req.params.id, uid(res));
  if (!b || b.creatorId !== uid(res) || b.visibility === "private") { res.sendStatus(404); return; }
  const input = z.object({ userIds: z.array(z.string().uuid()).min(1).max(20) }).strict().safeParse(req.body);
  if (!input.success) { res.sendStatus(400); return; }
  const ids = [...new Set(input.data.userIds)], hidden = await blockedIds(uid(res));
  const people = await db.select({ id: usersTable.id }).from(usersTable).where(inArray(usersTable.id, ids));
  if (people.length !== ids.length || ids.some(id => hidden.includes(id))) { res.status(400).json({ error: "Choose eligible registered people." }); return; }
  await db.insert(invites).values(ids.map(userId => ({ userId, boardId: b.id }))).onConflictDoNothing(); res.json({ invited: ids.length });
});
const createBoardEntry: RequestHandler = async (req, res) => {
  const u = uid(res), b = await accessible(req.params.id, u);
  if (!b || b.status !== "open") { res.status(409).json({ error: "This collection is unavailable or closed." }); return; }
  const bytes = Buffer.isBuffer(req.body) ? req.body : null;
  const isMediaAlias = typeof req.params.mediaType === "string";
  const mime = isMediaAlias ? req.get("x-upload-mime") || "" : (req.get("content-type") || "").split(";")[0];
  const entryId = isMediaAlias ? req.params.entryId : req.query.entryId ?? req.query.id;
  let metadata: unknown;
  try { metadata = bytes ? { id: entryId, caption: req.query.caption || "", place: req.query.place ? JSON.parse(String(req.query.place)) : null } : req.body; }
  catch { res.status(400).json({ error: "Choose a valid place." }); return; }
  const input = entryInput.safeParse(metadata);
  if (!input.success) { res.status(400).json({ error: "Add a valid response." }); return; }
  const type = bytes ? mime === "image/jpeg" ? "photo" : mime === "video/mp4" || mime === "video/webm" ? "video" : "" : "text";
  if (!type || isMediaAlias && req.params.mediaType !== type) { res.status(400).json({ error: "Choose a supported photo or video." }); return; }
  if (!acceptsEntry(b.format, type, input.data.caption)) { res.status(400).json({ error: `This prompt accepts ${b.format} responses.` }); return; }
  const [old] = await db.select().from(entries).where(eq(entries.id, input.data.id));
  if (old) {
    if (old.userId !== u || old.boardId !== b.id) { res.sendStatus(409); return; }
    res.json(await entryDto(old.id, u, b.creatorId)); return;
  }
  let object: Awaited<ReturnType<typeof storeSportsImage>> | null = null;
  try {
    if (bytes) object = type === "photo" ? await storeSportsImage(randomUUID(), bytes) : await storeSportsVideo(randomUUID(), bytes, mime);
    const e = await db.transaction(async tx => {
      const [current] = await tx.select().from(boards).where(eq(boards.id, b.id)).for("update");
      if (!current || current.status !== "open") throw new Error("This collection has closed.");
      const [created] = await tx.insert(entries).values({ id: input.data.id, boardId: b.id, userId: u, caption: input.data.caption,
        place: input.data.place || null, mediaType: type, object, mime: bytes ? mime : null }).onConflictDoNothing().returning();
      return created;
    });
    if (!e && object) await deleteSportsImage(object);
    const result = await entryDto(input.data.id, u, b.creatorId);
    if (!result || result.userId !== u || result.boardId !== b.id) { res.sendStatus(409); return; }
    res.status(e ? 201 : 200).json(result);
  } catch (error) {
    if (object) await deleteSportsImage(object).catch(() => {});
    res.status(400).json({ error: error instanceof Error ? error.message : "Response could not be saved." });
  }
};
router.post("/boards/:id/entries", raw({ type: ["image/jpeg", "video/mp4", "video/webm"], limit: "50mb" }), createBoardEntry);
router.post("/boards/:id/entries/media/:entryId/:mediaType",
  raw({ type: "application/octet-stream", limit: "50mb" }), createBoardEntry);
router.get("/boards/:id/entries/:entryId", async (req, res) => {
  const a = await entryAccess(req.params.id, req.params.entryId, uid(res));
  if (!a) { res.sendStatus(404); return; } res.json(await entryDto(a.e.id, uid(res), a.b.creatorId));
});
router.get("/boards/:id/entries/:entryId/media", async (req, res) => {
  const a = await entryAccess(req.params.id, req.params.entryId, uid(res));
  if (!a?.e.object) { res.sendStatus(404); return; }
  const body = await readSportsImage(a.e.object);
  res.set({ "Content-Type": a.e.mime || "image/jpeg", "Cache-Control": "private, no-store", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff" });
  const range = req.get("range");
  if (range) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(range);
    const start = Number(m?.[1]), end = m?.[2] ? Math.min(Number(m[2]), body.length - 1) : body.length - 1;
    if (!m || start >= body.length || end < start) { res.set("Content-Range", `bytes */${body.length}`).sendStatus(416); return; }
    res.status(206).set({ "Content-Range": `bytes ${start}-${end}/${body.length}`, "Content-Length": String(end - start + 1) }).send(body.subarray(start, end + 1)); return;
  }
  res.set("Content-Length", String(body.length)).send(body);
});
router.patch("/boards/:id/entries/:entryId", async (req, res) => {
  const a = await entryAccess(req.params.id, req.params.entryId, uid(res));
  if (!a) { res.sendStatus(404); return; }
  const input = entryUpdateInput.safeParse(req.body);
  if (!input.success) { res.sendStatus(400); return; }
  if (!canUpdateEntry(input.data, a.e.userId === uid(res), a.b.creatorId === uid(res))) { res.sendStatus(404); return; }
  if (a.e.mediaType === "text" && input.data.caption !== undefined && !input.data.caption) { res.status(400).json({ error: "Text entries need a caption." }); return; }
  await db.update(entries).set(input.data).where(eq(entries.id, a.e.id)); res.json(await entryDto(a.e.id, uid(res), a.b.creatorId));
});
router.delete("/boards/:id/entries/:entryId", async (req, res) => {
  const a = await entryAccess(req.params.id, req.params.entryId, uid(res));
  if (!a || a.e.userId !== uid(res)) { res.sendStatus(404); return; }
  if (a.e.object) await deleteSportsImage(a.e.object);
  await db.transaction(async tx => {
    await tx.delete(postsTable).where(eq(postsTable.sourceId, `board:${a.b.id}:${a.e.id}:feed`));
    await tx.delete(entries).where(eq(entries.id, a.e.id));
  }); res.sendStatus(204);
});
router.put("/boards/:id/entries/:entryId/like", async (req, res) => {
  const a = await entryAccess(req.params.id, req.params.entryId, uid(res));
  if (!a || a.e.removed) { res.sendStatus(404); return; }
  await db.insert(reactions).values({ entryId: a.e.id, userId: uid(res) }).onConflictDoNothing();
  const dto = await entryDto(a.e.id, uid(res), a.b.creatorId); res.json({ likes: dto!.likes, likedByMe: dto!.likedByMe });
});
router.delete("/boards/:id/entries/:entryId/like", async (req, res) => {
  const a = await entryAccess(req.params.id, req.params.entryId, uid(res));
  if (!a) { res.sendStatus(404); return; }
  await db.delete(reactions).where(and(eq(reactions.entryId, a.e.id), eq(reactions.userId, uid(res))));
  const dto = await entryDto(a.e.id, uid(res), a.b.creatorId); res.json({ likes: dto!.likes, likedByMe: dto!.likedByMe });
});
router.get("/boards/:id/entries/:entryId/comments", async (req, res) => {
  const a = await entryAccess(req.params.id, req.params.entryId, uid(res));
  if (!a) { res.sendStatus(404); return; }
  const hidden = await blockedIds(uid(res));
  const list = await db.select({ id: comments.id, text: comments.text, createdAt: comments.createdAt, userId: comments.userId,
    username: usersTable.username, displayName: usersTable.displayName }).from(comments).innerJoin(usersTable, eq(usersTable.id, comments.userId))
    .where(and(eq(comments.entryId, a.e.id), hidden.length ? notInArray(comments.userId, hidden) : undefined)).orderBy(desc(comments.createdAt)).limit(50);
  res.json({ comments: list.map(c => ({ id: c.id, text: c.text, createdAt: c.createdAt,
    author: { id: c.userId, username: c.username, displayName: c.displayName }, canDelete: c.userId === uid(res) || a.b.creatorId === uid(res) })) });
});
router.post("/boards/:id/entries/:entryId/comments", async (req, res) => {
  const a = await entryAccess(req.params.id, req.params.entryId, uid(res));
  if (!a || a.e.removed || !a.b.commentsEnabled) { res.status(403).json({ error: "Comments are unavailable." }); return; }
  const input = z.object({ text: z.string().trim().min(1).max(2000) }).strict().safeParse(req.body);
  if (!input.success) { res.sendStatus(400); return; }
  const [c] = await db.insert(comments).values({ entryId: a.e.id, userId: uid(res), text: input.data.text }).returning();
  res.status(201).json({ id: c.id });
});
router.delete("/boards/:id/entries/:entryId/comments/:commentId", async (req, res) => {
  const a = await entryAccess(req.params.id, req.params.entryId, uid(res));
  if (!a || !validId(req.params.commentId)) { res.sendStatus(404); return; }
  await db.delete(comments).where(and(eq(comments.id, req.params.commentId), eq(comments.entryId, a.e.id),
    a.b.creatorId === uid(res) ? undefined : eq(comments.userId, uid(res)))); res.sendStatus(204);
});
router.post("/boards/:id/report", async (req, res) => {
  const b = await accessible(req.params.id, uid(res));
  const input = z.object({ target: z.string(), reason: z.string().trim().min(3).max(1000) }).strict().safeParse(req.body);
  if (!b || !input.success || input.data.target !== "board" && !(await entryAccess(b.id, input.data.target, uid(res)))) { res.sendStatus(400); return; }
  await db.insert(reports).values({ ...input.data, boardId: b.id, userId: uid(res) })
    .onConflictDoUpdate({ target: [reports.boardId, reports.userId, reports.target], set: { reason: input.data.reason } }); res.sendStatus(204);
});
router.get("/boards/:id/reports", async (req, res) => {
  const b = await accessible(req.params.id, uid(res));
  if (!b || b.creatorId !== uid(res)) { res.sendStatus(404); return; }
  res.json({ reports: await db.select({ target: reports.target, reason: reports.reason, createdAt: reports.createdAt }).from(reports).where(eq(reports.boardId, b.id)).limit(100) });
});
router.post("/boards/:id/entries/:entryId/share", async (req, res) => {
  const a = await entryAccess(req.params.id, req.params.entryId, uid(res));
  if (!a || a.e.userId !== uid(res) || a.b.visibility !== "public" || a.e.removed) { res.status(403).json({ error: "Only your entries in public collections can be shared to the public feed." }); return; }
  const input = z.object({ href: z.string().max(2000) }).strict().safeParse(req.body);
  let link: URL;
  try {
    if (!input.success) throw new Error();
    link = new URL(input.data.href);
    if (!["http:", "https:"].includes(link.protocol) || link.searchParams.get("board") !== a.b.id || link.searchParams.get("entry") !== a.e.id) throw new Error();
  } catch { res.sendStatus(400); return; }
  const [p] = await db.insert(postsTable).values({ authorId: uid(res), sourceId: `board:${a.b.id}:${a.e.id}:feed`,
     place: a.e.place, text: `Get On Board · ${a.b.prompt}\n${a.e.caption}\n${link.href}` }).onConflictDoUpdate({ target: [postsTable.authorId, postsTable.sourceId], set: { place: a.e.place, text: `Get On Board · ${a.b.prompt}\n${a.e.caption}\n${link.href}` } }).returning({ id: postsTable.id });
  res.status(201).json({ postId: p.id });
});
router.delete("/boards/:id", async (req, res) => {
  const b = await accessible(req.params.id, uid(res));
  if (!b || b.creatorId !== uid(res)) { res.sendStatus(404); return; }
  // Close first under the same lock that submissions take, preventing orphaned uploads.
  await db.transaction(async tx => { await tx.select().from(boards).where(eq(boards.id, b.id)).for("update");
    await tx.update(boards).set({ status: "closed" }).where(eq(boards.id, b.id)); });
  const media = await db.select({ object: entries.object }).from(entries).where(eq(entries.boardId, b.id));
  for (const e of media) if (e.object) await deleteSportsImage(e.object);
  await db.transaction(async tx => {
    await tx.delete(postsTable).where(like(postsTable.sourceId, `board:${b.id}:%`));
    await tx.delete(boards).where(eq(boards.id, b.id));
  }); res.sendStatus(204);
});
export default router;
