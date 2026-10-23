import { Router } from "express";
import { sql, and, eq, inArray } from "drizzle-orm";
import { db, usersTable, workoutsTable, sportsChallengesTable as challenges, sportsMembersTable as members, sportsWorkoutTagsTable as tags } from "@workspace/db";
import { getAuthContext } from "../lib/auth";
import { z } from "zod";
const router = Router();
const uid = (res: Parameters<typeof getAuthContext>[0]) => getAuthContext(res).userId;
const idsSchema = z.array(z.string().uuid()).max(12);
const challengeSchema = z.object({
  name: z.string().trim().min(3).max(70), description: z.string().trim().max(350).default(""),
  activityType: z.enum(["run", "walk", "cycle", "hike"]), goalDistanceM: z.number().int().min(1000).max(1000000),
  durationDays: z.number().int().min(1).max(90), visibility: z.enum(["public", "invite_only"]).default("invite_only"),
  userIds: idsSchema.default([]),
}).strict();
const validId = (s: unknown) => z.string().uuid().safeParse(s).success;
async function accessible(id: string, userId: string) {
  const [c] = await db.select().from(challenges).where(eq(challenges.id, id));
  if (!c) return null;
  const [member] = await db.select().from(members).where(and(eq(members.challengeId, id), eq(members.userId, userId)));
  if (c.visibility !== "public" && c.creatorId !== userId && !member) return null;
  return { ...c, membershipStatus: member?.status || null, status: c.endsAt < new Date() ? "ended" : c.creatorId === userId ? "owner" : member?.status || "available" };
}
async function knownUsers(userIds: string[]) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return [];
  const people = await db.select({ id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName })
    .from(usersTable).where(inArray(usersTable.id, ids));
  if (people.length !== ids.length) throw new Error("One or more tagged accounts no longer exist.");
  return people;
}
async function rankings(id: string) {
  const result = await db.execute(sql`
    SELECT u.id AS "userId", u.username, u.display_name AS "displayName",
      coalesce(sum(CASE WHEN w.recording->>'activityType'=c.activity_type
        AND to_timestamp((w.recording->>'startedAt')::float8/1000) >= greatest(c.starts_at,m.joined_at)
        AND to_timestamp((w.recording->>'endedAt')::float8/1000) <= c.ends_at
        THEN (w.summary->>'distanceM')::float8 ELSE 0 END),0)::float8 AS "distanceM"
    FROM sports_members m JOIN users u ON u.id=m.user_id JOIN sports_challenges c ON c.id=m.challenge_id
    LEFT JOIN sports_workout_tags t ON t.challenge_id=c.id AND t.user_id=u.id
    LEFT JOIN sports_workouts w ON w.id=t.workout_id AND w.user_id=u.id
    WHERE m.challenge_id=${id} AND m.status='joined'
    GROUP BY u.id,m.joined_at ORDER BY "distanceM" DESC,u.username ASC`);
  return result.rows.map((row, i) => ({ userId: String(row.userId), username: String(row.username),
    displayName: String(row.displayName), distanceM: Number(row.distanceM), avatarPresetId: null, rank: i + 1 }));
}
async function detail(id: string, userId: string) {
  const c = await accessible(id, userId);
  if (!c) return null;
  const leaderboard = await rankings(id);
  const invitations = await db.select({ userId: usersTable.id, username: usersTable.username,
    displayName: usersTable.displayName, status: members.status }).from(members)
    .innerJoin(usersTable, eq(usersTable.id, members.userId)).where(eq(members.challengeId, id));
  return { challenge: { ...c, memberCount: leaderboard.length,
    ownDistanceM: Number(leaderboard.find(p => p.userId === userId)?.distanceM || 0) },
    leaderboard, invites: c.creatorId === userId ? invitations : [] };
}
router.get("/sports/maps/config", (_req, res) => {
  res.json({ provider: "openfreemap", renderer: "maplibre-gl-js", data: "OpenStreetMap via OpenMapTiles",
    configured: true, requiresKey: false, paidMapping: false, externalProvider: true,
    themes: ["light", "dark"], attributionRequired: true });
});
router.get("/sports/summary", async (req, res) => {
  const userId = uid(res);
  const zone = String(req.query.timeZone || "UTC");
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); }
  catch { res.status(400).json({ error: "Invalid time zone." }); return; }
  const data = await db.execute(sql`SELECT jsonb_build_object('startedAt',recording->'startedAt',
    'activityType',recording->'activityType') AS recording,summary FROM sports_workouts WHERE user_id=${userId}`);
  const totals = { distanceM: 0, activeSeconds: 0, elevationGainM: 0, workoutCount: data.rows.length, activeDays: 0 };
  const days = new Set<string>(), best = new Map<string, { activityType: string; longestDistanceM: number; fastestPaceSecondsPerKm: number | null }>();
  const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const weeklyMap = new Map<string, { day: string; distanceM: number; activeSeconds: number }>();
  for (let d = 6; d >= 0; d--) {
    const day = dayFormat.format(new Date(Date.now() - d * 86400000));
    weeklyMap.set(day, { day, distanceM: 0, activeSeconds: 0 });
  }
  for (const row of data.rows) {
    const r = row.recording as { startedAt: number; activityType: string };
    const s = row.summary as { distanceM: number; activeSeconds: number; elevationGainM: number | null; paceSecondsPerKm: number | null };
    totals.distanceM += s.distanceM; totals.activeSeconds += s.activeSeconds; totals.elevationGainM += s.elevationGainM || 0;
    const day = dayFormat.format(new Date(r.startedAt)); days.add(day);
    const week = weeklyMap.get(day); if (week) { week.distanceM += s.distanceM; week.activeSeconds += s.activeSeconds; }
    const pb = best.get(r.activityType) || { activityType: r.activityType, longestDistanceM: 0, fastestPaceSecondsPerKm: null };
    pb.longestDistanceM = Math.max(pb.longestDistanceM, s.distanceM);
    if (s.distanceM >= 1000 && s.paceSecondsPerKm && Number.isFinite(s.paceSecondsPerKm))
      pb.fastestPaceSecondsPerKm = Math.min(pb.fastestPaceSecondsPerKm ?? Infinity, s.paceSecondsPerKm);
    best.set(r.activityType, pb);
  }
  totals.activeDays = days.size;
  const longest = Math.max(0, ...[...best.values()].map(p => p.longestDistanceM));
  const milestones = [
    ["first", "First session", "Finish and save your first activity.", totals.workoutCount, 1],
    ["five-sessions", "Finding consistency", "Save five activities.", totals.workoutCount, 5],
    ["ten-sessions", "Double digits", "Save ten activities.", totals.workoutCount, 10],
    ["three-days", "Three active days", "Move on three different days.", totals.activeDays, 3],
    ["1k", "First kilometre", "Record one kilometre in a single activity.", longest, 1000],
    ["5k", "5K club", "Record five kilometres in a single activity.", longest, 5000],
    ["10k", "10K club", "Record ten kilometres in a single activity.", longest, 10000],
    ["50k", "Going the distance", "Record fifty kilometres across your activities.", totals.distanceM, 50000],
    ["100k", "100K total", "Record one hundred kilometres in total.", totals.distanceM, 100000],
    ["climb", "Above and beyond", "Record 250 metres of reliable elevation gain.", totals.elevationGainM, 250],
  ].map(([id, title, description, value, target]) => ({
    id, title, description, earned: Number(value) >= Number(target), progress: Math.min(Number(value), Number(target)), target,
  }));
  res.json({ totals, milestones, personalBests: [...best.values()], weekly: [...weeklyMap.values()] });
});
router.get("/sports/challenges", async (_req, res) => {
  const userId = uid(res);
  const result = await db.execute(sql`SELECT c.id,c.name,c.description,c.activity_type AS "activityType",
    c.goal_distance_m AS "goalDistanceM",c.starts_at AS "startsAt",c.ends_at AS "endsAt",c.creator_id AS "creatorId",c.visibility,m.status AS "membershipStatus",
    CASE WHEN c.ends_at<now() THEN 'ended' WHEN c.creator_id=${userId} THEN 'owner' ELSE coalesce(m.status,'available') END AS status
    FROM sports_challenges c LEFT JOIN sports_members m ON m.challenge_id=c.id AND m.user_id=${userId}
    WHERE c.creator_id=${userId} OR m.user_id IS NOT NULL OR (c.visibility='public' AND c.ends_at>now())
    ORDER BY c.starts_at DESC LIMIT 100`);
  const entries = await Promise.all(result.rows.map(async c => {
    const ranks = await rankings(String(c.id));
    return { ...c, status: String(c.status), memberCount: ranks.length, ownDistanceM: Number(ranks.find(p => p.userId === userId)?.distanceM || 0) };
  }));
  res.json({ challenges: entries.filter(c => c.status !== "invited"), invitations: entries.filter(c => c.status === "invited") });
});
router.post("/sports/challenges", async (req, res) => {
  const parsed = challengeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Check the name, activity, distance goal and duration." }); return; }
  const userId = uid(res), { userIds, durationDays, ...fields } = parsed.data;
  try { await knownUsers(userIds); } catch (e) { res.status(400).json({ error: (e as Error).message }); return; }
  const c = await db.transaction(async tx => {
    const [created] = await tx.insert(challenges).values({ ...fields, creatorId: userId, endsAt: new Date(Date.now() + durationDays * 86400000) }).returning();
    await tx.insert(members).values({ challengeId: created.id, userId, status: "joined", joinedAt: new Date() });
    const invitees = [...new Set(userIds)].filter(id => id !== userId);
    if (invitees.length) await tx.insert(members).values(invitees.map(id => ({ challengeId: created.id, userId: id })));
    return created;
  });
  res.status(201).json(await detail(c.id, userId));
});
router.get("/sports/challenges/:id", async (req, res) => {
  if (!validId(req.params.id)) { res.sendStatus(404); return; }
  const d = await detail(req.params.id, uid(res));
  if (!d) { res.status(404).json({ error: "Challenge not found." }); return; }
  res.json(d);
});
router.post("/sports/challenges/:id/join", async (req, res) => {
  if (!validId(req.params.id)) { res.sendStatus(404); return; }
  const userId = uid(res), c = await accessible(req.params.id, userId);
  if (!c) { res.status(404).json({ error: "Challenge not found." }); return; }
  if (c.endsAt < new Date()) { res.status(409).json({ error: "This challenge has ended." }); return; }
  await db.insert(members).values({ challengeId: c.id, userId, status: "joined", joinedAt: new Date() })
    .onConflictDoUpdate({ target: [members.challengeId, members.userId], set: { status: "joined",
      joinedAt: sql`coalesce(${members.joinedAt},now())` } });
  res.json(await detail(c.id, userId));
});
router.post("/sports/challenges/:id/invites", async (req, res) => {
  const ids = idsSchema.safeParse(req.body?.userIds);
  if (!ids.success || !validId(req.params.id)) { res.status(400).json({ error: "Select up to twelve real accounts." }); return; }
  const c = await accessible(req.params.id, uid(res));
  if (!c || c.creatorId !== uid(res)) { res.status(404).json({ error: "Only the challenge owner can send invitations." }); return; }
  if (c.endsAt < new Date()) { res.status(409).json({ error: "This challenge has ended." }); return; }
  try { await knownUsers(ids.data); } catch (e) { res.status(400).json({ error: (e as Error).message }); return; }
  const invitees = [...new Set(ids.data)].filter(id => id !== uid(res));
  if (invitees.length) await db.insert(members).values(invitees.map(id => ({ challengeId: c.id, userId: id }))).onConflictDoNothing();
  res.json(await detail(c.id, uid(res)));
});
router.delete("/sports/challenges/:id", async (req, res) => {
  if (!validId(req.params.id)) { res.sendStatus(404); return; }
  const deleted = await db.delete(challenges).where(and(eq(challenges.id, req.params.id), eq(challenges.creatorId, uid(res)))).returning({ id: challenges.id });
  if (!deleted.length) { res.status(404).json({ error: "Challenge not found." }); return; }
  res.sendStatus(204);
});
export async function workoutTagData(workoutId: string, userId: string) {
  const [tag] = await db.select().from(tags).where(and(eq(tags.workoutId, workoutId), eq(tags.userId, userId)));
  if (!tag) return { challenge: null, taggedPeople: [] };
  const [c] = tag.challengeId ? await db.select({ id: challenges.id, name: challenges.name }).from(challenges).where(eq(challenges.id, tag.challengeId)) : [];
  const people = await knownUsers(tag.taggedUserIds);
  return { challenge: c || null, taggedPeople: people.map(p => ({ userId: p.id, username: p.username, displayName: p.displayName })) };
}
router.get("/sports/workouts/:id/challenge", async (req, res) => {
  if (!validId(req.params.id)) { res.sendStatus(404); return; }
  const userId = uid(res);
  const [w] = await db.select({ id: workoutsTable.id }).from(workoutsTable).where(and(eq(workoutsTable.id, req.params.id), eq(workoutsTable.userId, userId)));
  if (!w) { res.sendStatus(404); return; }
  res.json(await workoutTagData(w.id, userId));
});
router.put("/sports/workouts/:id/challenge", async (req, res) => {
  const input = z.object({ challengeId: z.string().uuid().nullable(), taggedUserIds: idsSchema.default([]) }).strict().safeParse(req.body);
  if (!input.success || !validId(req.params.id)) { res.status(400).json({ error: "Choose a challenge and registered people to tag." }); return; }
  const userId = uid(res), c = input.data.challengeId ? await accessible(input.data.challengeId, userId) : null;
  if (input.data.challengeId && (!c || c.membershipStatus !== "joined")) { res.status(409).json({ error: "Join this challenge before attaching an activity." }); return; }
  const [w] = await db.select({ id: workoutsTable.id, recording: workoutsTable.recording }).from(workoutsTable).where(and(eq(workoutsTable.id, req.params.id), eq(workoutsTable.userId, userId)));
  if (!w) { res.status(404).json({ error: "Workout not found." }); return; }
  if (c && w.recording.activityType !== c.activityType) { res.status(409).json({ error: "The workout and challenge must use the same activity." }); return; }
  let people;
  try { people = await knownUsers(input.data.taggedUserIds); } catch (e) { res.status(400).json({ error: (e as Error).message }); return; }
  await db.insert(tags).values({ workoutId: w.id, userId, challengeId: c?.id || null, taggedUserIds: input.data.taggedUserIds })
    .onConflictDoUpdate({ target: tags.workoutId, set: { challengeId: c?.id || null, taggedUserIds: input.data.taggedUserIds } });
  res.json({ challenge: c ? { id: c.id, name: c.name } : null, taggedPeople: people.map(p => ({ userId: p.id, username: p.username, displayName: p.displayName })) });
});
export default router;
