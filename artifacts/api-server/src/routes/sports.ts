import { Router, raw } from "express";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, desc, sql, or } from "drizzle-orm";
import { db, workoutsTable, sportsMediaTable, postsTable } from "@workspace/db";
import { requireAuth, getAuthContext } from "../lib/auth";
import { recordingSchema, calculateWorkout } from "../lib/sports-recording";
import { deleteSportsImage, readSportsImage, sportsMediaReadUrl, storeSportsImage, storeSportsVideo } from "../lib/sports-media";
import sportsSocialRouter from "./sports-social";
import { SPORTS_MODE_ENABLED, sportsMutationDisabled } from "../lib/sports-feature-state.js";
const router = Router();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function output(row: typeof workoutsTable.$inferSelect, detail = true) {
  const { points, events, ...info } = row.recording;
  const lastEvent = row.recording.events.at(-1)?.type;
  const status = lastEvent === "finish" ? "completed" : lastEvent === "pause" ? "paused" : "recording";
  return { id: row.id, ...info, status, summary: row.summary, synced: true,
    ...(detail ? { points, events } : {}) };
}
router.get("/posts/:id/sports-card", async (req, res) => {
  if (!uuid.test(req.params.id)) { res.sendStatus(404); return; }
  const [post] = await db.select({ card: postsTable.sportsCard }).from(postsTable).where(eq(postsTable.id, req.params.id)).limit(1);
  const imageId = post?.card?.imageId;
  if (typeof imageId !== "string") { res.sendStatus(404); return; }
  const [image] = await db.select().from(sportsMediaTable).where(eq(sportsMediaTable.id, imageId)).limit(1);
  if (!image) { res.sendStatus(404); return; }
  const signedUrl = await sportsMediaReadUrl(image.object);
  if (signedUrl) {
    // Let storage serve byte ranges; do not download an entire video for each seek.
    res.setHeader("Cache-Control", "private, no-store");
    res.redirect(307, signedUrl);
    return;
  }
  const bytes = await readSportsImage(image.object);
  res.set({ "Content-Type": image.mime, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" });
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    const start = match?.[1] ? Number(match[1]) : match?.[2] ? Math.max(0, bytes.length - Number(match[2])) : -1;
    const end = match?.[1] && match?.[2] ? Math.min(bytes.length - 1, Number(match[2])) : bytes.length - 1;
    if (!match || start < 0 || start >= bytes.length || end < start) { res.set("Content-Range", `bytes */${bytes.length}`).sendStatus(416); return; }
    res.status(206).set("Content-Range", `bytes ${start}-${end}/${bytes.length}`).send(bytes.subarray(start, end + 1)); return;
  }
  res.send(bytes);
});
router.use("/sports", requireAuth, (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!SPORTS_MODE_ENABLED && sportsMutationDisabled(req.method)) {
    res.status(410).json({ error: "Sports recording and publishing are currently disabled." });
    return;
  }
  next();
});
router.use(sportsSocialRouter);
router.get("/sports/workouts", async (req, res) => {
  const offset = Number(req.query.offset || 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) { res.status(400).json({ error: "Invalid history offset." }); return; }
  const userId = getAuthContext(res).userId;
  const rows = await db.select({
    id: workoutsTable.id, activityType: sql<string>`${workoutsTable.recording}->>'activityType'`,
    startedAt: sql<number>`(${workoutsTable.recording}->>'startedAt')::float8`,
    endedAt: sql<number | null>`(${workoutsTable.recording}->>'endedAt')::float8`, summary: workoutsTable.summary,
    status: sql<string>`CASE WHEN ${workoutsTable.recording}->'events'->-1->>'type' = 'finish' THEN 'completed' WHEN ${workoutsTable.recording}->'events'->-1->>'type' = 'pause' THEN 'paused' ELSE 'recording' END`,
  }).from(workoutsTable).where(eq(workoutsTable.userId, userId))
    .orderBy(sql`CASE WHEN ${workoutsTable.recording}->'events'->-1->>'type' = 'finish' THEN 1 ELSE 0 END`,
      desc(workoutsTable.createdAt), desc(workoutsTable.id)).offset(offset).limit(51);
  res.json({ workouts: rows.slice(0, 50).map(row => ({ ...row, synced: true })),
    nextOffset: rows.length > 50 ? offset + 50 : null });
});
router.put("/sports/workouts/:id", async (req, res) => {
  const parsed = recordingSchema.safeParse(req.body);
  if (!uuid.test(req.params.id) || !parsed.success) { res.status(400).json({ error: "Workout needs a valid activity, ordered GPS points and start/pause/resume/finish times." }); return; }
  const userId = getAuthContext(res).userId, recording = parsed.data;
  const hash = createHash("sha256").update(JSON.stringify(recording)).digest("hex");
  await db.insert(workoutsTable).values({ id: req.params.id, userId, recording, summary: calculateWorkout(recording), recordingHash: hash })
    .onConflictDoUpdate({
      target: workoutsTable.id,
      set: { recording, summary: calculateWorkout(recording), recordingHash: hash },
      where: eq(workoutsTable.userId, userId),
    });
  const [row] = await db.select().from(workoutsTable).where(and(eq(workoutsTable.id, req.params.id), eq(workoutsTable.userId, userId))).limit(1);
  if (!row || row.recordingHash !== hash) { res.status(409).json({ error: "This workout ID already belongs to another recording." }); return; }
  res.json({ workout: output(row) });
});
router.get("/sports/workouts/:id", async (req, res) => {
  if (!uuid.test(req.params.id)) { res.sendStatus(404); return; }
  const [row] = await db.select().from(workoutsTable).where(and(eq(workoutsTable.id, req.params.id), eq(workoutsTable.userId, getAuthContext(res).userId))).limit(1);
  if (!row) { res.sendStatus(404); return; } res.json({ workout: output(row) });
});
router.post("/sports/workouts/:id/card", raw({ type: ["image/jpeg", "video/webm", "video/mp4"], limit: "50mb" }), async (req, res) => {
  const mime = (req.get("Content-Type") || "").split(";")[0];
  if (!uuid.test(req.params.id) || !Buffer.isBuffer(req.body)) { res.status(400).json({ error: "Send a valid JPEG card or MP4/WebM route video." }); return; }
  const userId = getAuthContext(res).userId;
  const [workout] = await db.select({ id: workoutsTable.id }).from(workoutsTable).where(and(eq(workoutsTable.id, req.params.id), eq(workoutsTable.userId, userId))).limit(1);
  if (!workout) { res.sendStatus(404); return; }
  const existing = await db.select({ id: sportsMediaTable.id }).from(sportsMediaTable).where(and(eq(sportsMediaTable.workoutId, workout.id), eq(sportsMediaTable.userId, userId)));
  if (existing.length >= 10) { res.status(429).json({ error: "This workout already has ten exported cards." }); return; }
  const id = randomUUID();
  let object;
  try { object = mime === "image/jpeg" ? await storeSportsImage(id, req.body) : await storeSportsVideo(id, req.body, mime); }
  catch { res.status(400).json({ error: "The card or route video could not be stored. Check its format and media storage configuration." }); return; }
  try { await db.insert(sportsMediaTable).values({ id, userId, workoutId: workout.id, object, mime }); }
  catch (e) { await deleteSportsImage(object); throw e; }
  res.status(201).json({ cardId: id });
});
router.delete("/sports/workouts/:id", async (req, res) => {
  if (!uuid.test(req.params.id)) { res.sendStatus(404); return; }
  const userId = getAuthContext(res).userId;
  const [row] = await db.select({ id: workoutsTable.id }).from(workoutsTable).where(and(eq(workoutsTable.id, req.params.id), eq(workoutsTable.userId, userId))).limit(1);
  if (!row) { res.sendStatus(404); return; }
  // Removing a private workout also removes its exported files and published sports posts.
  const images = await db.select().from(sportsMediaTable).where(eq(sportsMediaTable.workoutId, row.id));
  for (const image of images) await deleteSportsImage(image.object);
  await db.transaction(async tx => {
    await tx.delete(postsTable).where(and(eq(postsTable.authorId, userId), or(
      eq(postsTable.sportsWorkoutId, row.id), eq(postsTable.sourceId, `sports:${row.id}`))));
    await tx.delete(workoutsTable).where(and(eq(workoutsTable.id, row.id), eq(workoutsTable.userId, userId)));
  });
  res.sendStatus(204);
});
export default router;
