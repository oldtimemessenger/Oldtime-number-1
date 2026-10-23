import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db, usersTable, tournamentsTable as tournaments, tournamentParticipants as participants,
  tournamentTeams as teams, tournamentSupports as supports, participationBlocks as blocks,
  tournamentNotifications, tournamentNotificationPreferences,
} from "@workspace/db";
import { requireAuth, getAuthContext, createRateLimiter } from "../lib/auth";
import { tournamentInput, tournamentSettingsInput, tournamentStatus, TournamentError } from "../lib/tournament-policy";
import { withTournament, dto, requireOpen, writeAudit, blocked, personFields, notifyTournament } from "../lib/tournaments";

const router: IRouter = Router();
const uuid = z.uuid();
const validId = (v: unknown): v is string => uuid.safeParse(v).success;
router.use("/tournaments", requireAuth, createRateLimiter("tournaments", 100));
// Only known, deliberately written domain errors are exposed.
router.use("/tournaments", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store"); next();
});
router.get("/tournaments/people", async (req, res) => {
  const q = String(req.query.q || "").trim().replace(/[%_\\]/g, "").slice(0, 60);
  if (q.length < 2) { res.json({ users: [] }); return; }
  const viewer = getAuthContext(res).userId;
  const excluded = db.select({ id: blocks.blockedId }).from(blocks).where(eq(blocks.userId, viewer));
  const reverse = db.select({ id: blocks.userId }).from(blocks).where(eq(blocks.blockedId, viewer));
  const users = await db.select(personFields).from(usersTable).where(and(
    or(ilike(usersTable.username, `%${q}%`), ilike(usersTable.displayName, `%${q}%`)),
    sql`${usersTable.id} not in (${excluded}) and ${usersTable.id} not in (${reverse})`)).limit(15);
  res.json({ users: users.map(u => ({ ...u, avatarUrl: null })) });
});
router.get("/tournaments/notifications", async (_req, res) => {
  const viewer = getAuthContext(res).userId;
  const rows = await db.select().from(tournamentNotifications)
    .where(eq(tournamentNotifications.recipientId, viewer))
    .orderBy(desc(tournamentNotifications.createdAt)).limit(100);
  res.json({ notifications: rows });
});
router.patch("/tournaments/notifications/:id/read", async (req, res) => {
  if (!validId(req.params.id)) { res.status(404).json({ error: "Notification not found." }); return; }
  const viewer = getAuthContext(res).userId;
  const [row] = await db.update(tournamentNotifications).set({ readAt: new Date() })
    .where(and(eq(tournamentNotifications.id, req.params.id), eq(tournamentNotifications.recipientId, viewer)))
    .returning({ id: tournamentNotifications.id });
  if (!row) { res.status(404).json({ error: "Notification not found." }); return; }
  res.json({ ok: true });
});
router.get("/tournaments/notification-preferences", async (_req, res) => {
  const viewer = getAuthContext(res).userId;
  const [row] = await db.select().from(tournamentNotificationPreferences)
    .where(eq(tournamentNotificationPreferences.userId, viewer));
  res.json({ nonEssentialEnabled: row?.nonEssentialEnabled ?? true });
});
router.patch("/tournaments/notification-preferences", async (req, res) => {
  const parsed = z.object({ nonEssentialEnabled: z.boolean() }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose whether to receive tournament reminders." }); return; }
  const viewer = getAuthContext(res).userId;
  await db.insert(tournamentNotificationPreferences).values({
    userId: viewer, nonEssentialEnabled: parsed.data.nonEssentialEnabled, updatedAt: new Date(),
  }).onConflictDoUpdate({ target: tournamentNotificationPreferences.userId,
    set: { nonEssentialEnabled: parsed.data.nonEssentialEnabled, updatedAt: new Date() } });
  res.json(parsed.data);
});
router.get("/tournaments", async (req, res) => {
  const viewer = getAuthContext(res).userId;
  const membership = db.select({ id: participants.tournamentId }).from(participants).where(eq(participants.userId, viewer));
  const blockedHosts = db.select({ id: blocks.blockedId }).from(blocks).where(eq(blocks.userId, viewer));
  const blockers = db.select({ id: blocks.userId }).from(blocks).where(eq(blocks.blockedId, viewer));
  const offset = Math.max(0, Math.min(10000, Math.floor(Number(req.query.offset) || 0)));
  const rows = await db.select({ id: tournaments.id }).from(tournaments).where(and(
    req.query.scope === "mine" ? or(eq(tournaments.hostId, viewer), inArray(tournaments.id, membership)) :
      or(eq(tournaments.hostId, viewer), inArray(tournaments.id, membership),
        and(eq(tournaments.visibility, "public"), sql`${tournaments.publishedAt} is not null`)),
    sql`${tournaments.hostId} not in (${blockedHosts}) and ${tournaments.hostId} not in (${blockers})`
  )).orderBy(desc(tournaments.createdAt), desc(tournaments.id)).offset(offset).limit(21);
  const results = [];
  for (const row of rows.slice(0, 20)) {
    try { results.push(await withTournament(row.id, viewer, (tx, t, now) => dto(tx, t, viewer, now))); }
    catch (e) { if (!(e instanceof TournamentError && e.status === 404)) throw e; }
  }
  res.json({ tournaments: results, hasMore: rows.length > 20, serverNow: new Date().toISOString() });
});
router.post("/tournaments", async (req, res) => {
  const input = tournamentInput.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: input.error.issues[0]?.message || "Check your tournament details." }); return; }
  const u = getAuthContext(res).userId, data = input.data;
  const now = new Date(), requested = new Date(data.startsAt);
  if (requested.getTime() < now.getTime() - 60000 || requested.getTime() > now.getTime() + 90 * 86400000) {
    res.status(400).json({ error: "Choose a start time now or within the next 90 days." }); return;
  }
  if (["person", "friend"].includes(data.hostingType) && data.featuredUserId === u) {
    res.status(400).json({ error: "Choose a different registered person." }); return;
  }
  const result = await db.transaction(async tx => {
    if (data.featuredUserId) {
      const [user] = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, data.featuredUserId));
      if (!user || await blocked(tx, u, user.id)) throw new TournamentError(400, "Choose an available registered participant.");
    }
    const startsAt = new Date(Math.max(now.getTime(), requested.getTime()));
    const [t] = await tx.insert(tournaments).values({
      title: data.title, description: data.description, rules: data.rules, hostingType: data.hostingType,
      visibility: data.hostingType === "friend" ? "invite_only" : data.visibility,
      category: data.category, coverTheme: data.coverTheme, scoringMethod: data.scoringMethod,
      supportEnabled: data.scoringMethod === "community_support" && data.supportEnabled,
      openToParticipants: data.hostingType === "friend" ? false : data.openToParticipants,
      maxParticipants: data.maxParticipants,
      goal: data.goal, hostId: u, featuredUserId: data.featuredUserId || null, startsAt,
      endsAt: new Date(startsAt.getTime() + data.durationMinutes * 60000),
      publishedAt: ["person", "friend"].includes(data.hostingType) ? null : now,
    }).returning();
    const groups = data.hostingType === "team"
      ? await tx.insert(teams).values(data.teamNames!.map((name, i) => ({ tournamentId: t.id, name, captainId: i === 0 ? u : null }))).returning() : [];
    if (data.hostingType !== "person") await tx.insert(participants).values({
      tournamentId: t.id, userId: u, role: data.hostingType === "team" ? "captain" : "competitor",
      status: "accepted", acceptedAt: now, teamId: groups[0]?.id || null,
    });
    if (data.hostingType === "person" || data.hostingType === "friend") {
      const [invite] = await tx.insert(participants).values({
        tournamentId: t.id, userId: data.featuredUserId!, role: data.hostingType === "person" ? "featured" : "competitor",
        status: "invited", teamId: null,
      }).returning();
      await notifyTournament(tx, { recipientId: data.featuredUserId!, actorId: u, tournamentId: t.id,
        eventKey: `invitation:${invite.id}`, kind: data.hostingType === "friend" ? "challenge" : "featured_invitation",
        body: `${data.hostingType === "friend" ? "Friend challenge" : "Featured participant invitation"}: “${t.title}”. Review the rules, schedule, and requirements before deciding.`,
      });
    }
    await writeAudit(tx, t.id, u, "created");
    return dto(tx, t, u, now);
  });
  res.status(201).json(result);
});
router.get("/tournaments/:id", async (req, res) => {
  if (!validId(req.params.id)) { res.status(404).json({ error: "Tournament not found." }); return; }
  const viewer = getAuthContext(res).userId;
  res.json(await withTournament(req.params.id, viewer, (tx, t, now) => dto(tx, t, viewer, now)));
});
router.patch("/tournaments/:id", async (req, res) => {
  if (!validId(req.params.id)) { res.status(404).json({ error: "Tournament not found." }); return; }
  const parsed = tournamentSettingsInput.safeParse(req.body);
  if (!parsed.success || !Object.keys(parsed.data).length) {
    res.status(400).json({ error: parsed.success ? "Choose at least one setting to update." : parsed.error.issues[0]?.message || "Check the tournament settings." });
    return;
  }
  const viewer = getAuthContext(res).userId;
  const result = await withTournament(req.params.id, viewer, async (tx, t, now) => {
    if (t.hostId !== viewer) throw new TournamentError(403, "Only the organizer can change tournament settings.");
    if (now >= t.startsAt || t.cancelledAt || t.completedAt)
      throw new TournamentError(409, "Tournament settings are locked once it starts.");
    const patch = parsed.data;
    if (t.hostingType === "friend" && patch.visibility && patch.visibility !== "invite_only")
      throw new TournamentError(400, "Friend challenges remain invitation only.");
    if (patch.goal !== undefined && (patch.goal < 1 || patch.goal > 100000))
      throw new TournamentError(400, "The goal must be between 1 and 100000.");
    if (patch.startsAt && new Date(patch.startsAt).getTime() < now.getTime() - 60000)
      throw new TournamentError(400, "Choose a future start time.");
    if (patch.startsAt && new Date(patch.startsAt).getTime() > now.getTime() + 90 * 86400000)
      throw new TournamentError(400, "Choose a start within the next 90 days.");
    const startsAt = patch.startsAt ? new Date(patch.startsAt) : t.startsAt;
    const duration = patch.durationMinutes ?? Math.round((t.endsAt.getTime() - t.startsAt.getTime()) / 60000);
    const endsAt = new Date(startsAt.getTime() + duration * 60000);
    const [accepted] = await tx.select({ count: sql<number>`count(*)::int` }).from(participants)
      .where(and(eq(participants.tournamentId, t.id), eq(participants.status, "accepted")));
    if (patch.maxParticipants != null && patch.maxParticipants < accepted.count)
      throw new TournamentError(409, "The participant limit cannot be lower than the number already entered.");
    const values = {
      ...patch,
      startsAt,
      endsAt,
      supportEnabled: patch.scoringMethod === "participant_entries" ? false : patch.supportEnabled,
      openToParticipants: patch.visibility && patch.visibility !== "public" ? false : patch.openToParticipants,
    };
    await tx.update(tournaments).set(values).where(eq(tournaments.id, t.id));
    await writeAudit(tx, t.id, viewer, "settings_updated", { fields: Object.keys(patch) });
    const people = await tx.select({ userId: participants.userId }).from(participants)
      .where(and(eq(participants.tournamentId, t.id), eq(participants.status, "accepted")));
    for (const p of people) if (p.userId !== viewer) await notifyTournament(tx, {
      recipientId: p.userId, actorId: viewer, tournamentId: t.id,
      eventKey: `settings:${t.id}:${now.getTime()}:${p.userId}`, kind: "settings_updated",
      body: `The organizer updated the schedule or rules for “${t.title}”.`,
    });
    const [updated] = await tx.select().from(tournaments).where(eq(tournaments.id, t.id));
    return dto(tx, updated, viewer, now);
  });
  res.json(result);
});
router.post("/tournaments/:id/request-changes", async (req, res) => {
  if (!validId(req.params.id)) { res.status(404).json({ error: "Tournament not found." }); return; }
  const parsed = z.object({ message: z.string().trim().min(5).max(500) }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Explain what you would like changed (5–500 characters)." }); return; }
  const userId = getAuthContext(res).userId;
  const result = await withTournament(req.params.id, userId, async (tx, t, now) => {
    const [mine] = await tx.select().from(participants).where(and(eq(participants.tournamentId, t.id), eq(participants.userId, userId)));
    if (mine?.status !== "invited" || mine.role !== "featured" || t.publishedAt)
      throw new TournamentError(409, "Only the invited featured participant can request changes before accepting.");
    await tx.update(participants).set({ status: "change_requested", responseMessage: parsed.data.message }).where(eq(participants.id, mine.id));
    await notifyTournament(tx, { recipientId: t.hostId, actorId: userId, tournamentId: t.id,
      eventKey: `change-request:${mine.id}:${now.getTime()}`, kind: "change_requested",
      body: `The featured participant requested changes to “${t.title}”: ${parsed.data.message}`,
    });
    await writeAudit(tx, t.id, userId, "change_requested");
    return dto(tx, t, userId, now);
  });
  res.json(result);
});
router.post("/tournaments/:id/withdraw", async (req, res) => {
  if (!validId(req.params.id)) { res.status(404).json({ error: "Tournament not found." }); return; }
  const userId = getAuthContext(res).userId;
  const result = await withTournament(req.params.id, userId, async (tx, t, now) => {
    if (now >= t.startsAt || t.cancelledAt || t.completedAt) throw new TournamentError(409, "You can withdraw only before the tournament starts.");
    const [mine] = await tx.select().from(participants).where(and(eq(participants.tournamentId, t.id), eq(participants.userId, userId)));
    if (mine?.status !== "accepted" || userId === t.hostId) throw new TournamentError(409, "Only an accepted participant can withdraw; the organizer can cancel the tournament.");
    await tx.update(participants).set({ status: "withdrawn" }).where(eq(participants.id, mine.id));
    if (mine.teamId) {
      const [team] = await tx.select().from(teams).where(eq(teams.id, mine.teamId));
      if (team?.captainId === userId) {
        const [next] = await tx.select().from(participants).where(and(eq(participants.teamId, mine.teamId), eq(participants.status, "accepted")));
        await tx.update(teams).set({ captainId: next?.userId || null }).where(eq(teams.id, mine.teamId));
        if (next) await tx.update(participants).set({ role: "captain" }).where(eq(participants.id, next.id));
      }
    }
    await writeAudit(tx, t.id, userId, "withdrawn");
    await notifyTournament(tx, { recipientId: t.hostId, actorId: userId, tournamentId: t.id,
      eventKey: `withdrawn:${mine.id}`, kind: "participant_withdrew", body: `A participant withdrew from “${t.title}”.` });
    return dto(tx, t, userId, now);
  });
  res.json(result);
});
router.post("/tournaments/:id/resend/:participantId", async (req, res) => {
  if (!validId(req.params.id) || !validId(req.params.participantId)) { res.status(404).json({ error: "Invitation not found." }); return; }
  const userId = getAuthContext(res).userId;
  const result = await withTournament(req.params.id, userId, async (tx, t, now) => {
    if (t.hostId !== userId || t.publishedAt || !["person", "friend"].includes(t.hostingType))
      throw new TournamentError(403, "Only the organizer can revise a pending featured invitation.");
    const [target] = await tx.select().from(participants).where(and(eq(participants.id, req.params.participantId),
      eq(participants.tournamentId, t.id), eq(participants.status, "change_requested")));
    if (!target) throw new TournamentError(409, "No change request is waiting for a response.");
    await tx.update(participants).set({ status: "invited", responseMessage: null }).where(eq(participants.id, target.id));
    await notifyTournament(tx, { recipientId: target.userId, actorId: userId, tournamentId: t.id,
      eventKey: `invitation-revised:${target.id}:${now.getTime()}`, kind: "invitation_updated",
      body: `The organizer revised “${t.title}”. Review the updated details and choose whether to accept.`,
    });
    await writeAudit(tx, t.id, userId, "invitation_revised");
    return dto(tx, t, userId, now);
  });
  res.json(result);
});
router.post("/tournaments/:id/teams/:teamId/captain", async (req, res) => {
  if (!validId(req.params.id) || !validId(req.params.teamId)) { res.status(404).json({ error: "Team not found." }); return; }
  const parsed = z.object({ userId: uuid }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose an accepted teammate." }); return; }
  const userId = getAuthContext(res).userId;
  const result = await withTournament(req.params.id, userId, async (tx, t, now) => {
    if (t.hostId !== userId || t.hostingType !== "team" || now >= t.startsAt)
      throw new TournamentError(403, "Only the organizer can assign a captain before the tournament starts.");
    const [team] = await tx.select().from(teams).where(and(eq(teams.id, req.params.teamId), eq(teams.tournamentId, t.id)));
    const [target] = await tx.select().from(participants).where(and(eq(participants.tournamentId, t.id),
      eq(participants.teamId, req.params.teamId), eq(participants.userId, parsed.data.userId), eq(participants.status, "accepted")));
    if (!team || !target) throw new TournamentError(400, "Choose an accepted member of this team.");
    if (team.captainId && team.captainId !== parsed.data.userId)
      await tx.update(participants).set({ role: "competitor" }).where(and(eq(participants.tournamentId, t.id), eq(participants.userId, team.captainId)));
    await tx.update(teams).set({ captainId: parsed.data.userId }).where(eq(teams.id, team.id));
    await tx.update(participants).set({ role: "captain" }).where(eq(participants.id, target.id));
    await writeAudit(tx, t.id, userId, "captain_assigned", { teamId: team.id, userId: parsed.data.userId });
    return dto(tx, t, userId, now);
  });
  res.json(result);
});
const actionInput = {
  join: z.object({ teamId: uuid.optional() }).strict(),
  decline: z.object({}).strict(),
  invitations: z.object({ userId: uuid, teamId: uuid.optional() }).strict(),
  support: z.object({ participantId: uuid }).strict(),
  cancel: z.object({}).strict(),
};
for (const action of ["join", "decline", "invitations", "support", "cancel"] as const) {
  router.post(`/tournaments/:id/${action}`, async (req, res) => {
    if (!validId(req.params.id)) { res.status(404).json({ error: "Tournament not found." }); return; }
    const input = actionInput[action].safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "Check the requested tournament action." }); return; }
    const userId = getAuthContext(res).userId;
    const data = input.data as { teamId?: string; userId?: string; participantId?: string };
    const result = await withTournament(req.params.id, userId, async (tx, t, now) => {
      requireOpen(t, now);
      const [mine] = await tx.select().from(participants).where(and(eq(participants.tournamentId, t.id), eq(participants.userId, userId)));
      if (action === "cancel") {
        if (t.hostId !== userId) throw new TournamentError(403, "Only the organizer can cancel this competition.");
        if (now >= t.startsAt) throw new TournamentError(409, "An active competition cannot be cancelled.");
        t.cancelledAt = now;
        await tx.update(tournaments).set({ cancelledAt: now }).where(eq(tournaments.id, t.id));
        const people = await tx.select({ userId: participants.userId }).from(participants)
          .where(and(eq(participants.tournamentId, t.id), sql`${participants.status} in ('accepted','invited','change_requested')`));
        for (const p of people) if (p.userId !== userId) await notifyTournament(tx, {
          recipientId: p.userId, actorId: userId, tournamentId: t.id,
          eventKey: `cancelled:${t.id}:${p.userId}`, kind: "cancelled",
          body: `The organizer cancelled “${t.title}”.`, essential: true,
        });
      }
      if (action === "invitations") {
        const isHost = t.hostId === userId;
        const [captainEntry] = await tx.select().from(participants).where(and(
          eq(participants.tournamentId, t.id), eq(participants.userId, userId),
          eq(participants.status, "accepted"), eq(participants.role, "captain")));
        if (!isHost && !captainEntry) throw new TournamentError(403, "Only the organizer or a team captain can send invitations.");
        if (!t.publishedAt) throw new TournamentError(409, "The featured participant must accept before you invite others.");
        const [user] = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, data.userId!));
        if (!user || await blocked(tx, userId, user.id)) throw new TournamentError(400, "This participant is unavailable.");
        if (t.hostingType === "team") {
          const [team] = await tx.select().from(teams).where(and(eq(teams.tournamentId, t.id), eq(teams.id,
            captainEntry?.teamId || data.teamId || "00000000-0000-0000-0000-000000000000")));
          if (!team) throw new TournamentError(400, "Choose a tournament team.");
          if (captainEntry && team.id !== captainEntry.teamId) throw new TournamentError(403, "Team captains can invite only to their own team.");
        } else if (data.teamId) throw new TournamentError(400, "This is an individual competition.");
        const total = await tx.select({ count: sql<number>`count(*)::int` }).from(participants)
          .where(and(eq(participants.tournamentId, t.id), sql`${participants.status} in ('accepted','invited')`));
        if (t.maxParticipants != null && total[0].count >= t.maxParticipants)
          throw new TournamentError(409, "The participant limit has been reached.");
        const [existing] = await tx.select({ id: participants.id }).from(participants)
          .where(and(eq(participants.tournamentId, t.id), eq(participants.userId, user.id)));
        if (existing) throw new TournamentError(409, "This person has already been invited or joined.");
        const [invite] = await tx.insert(participants).values({
          tournamentId: t.id, userId: user.id, teamId: captainEntry?.teamId || data.teamId || null, status: "invited",
        }).returning();
        await notifyTournament(tx, { recipientId: user.id, actorId: userId, tournamentId: t.id,
          eventKey: `invitation:${invite.id}`, kind: "invitation",
          body: `You are invited to “${t.title}”. Review the organizer, rules, schedule, and requirements before accepting.`,
        });
      }
      if (action === "join") {
        if (mine?.status === "accepted") return dto(tx, t, userId, now);
        if (["declined", "withdrawn", "change_requested"].includes(mine?.status || ""))
          throw new TournamentError(409, "This invitation cannot be accepted. Contact the organizer if you need help.");
        if ((!t.publishedAt || t.visibility !== "public" || !t.openToParticipants) && mine?.status !== "invited")
          throw new TournamentError(403, "An invitation is required to join.");
        if (!t.publishedAt && mine?.role !== "featured" &&
          !(t.hostingType === "friend" && mine?.userId === t.featuredUserId))
          throw new TournamentError(409, "Awaiting the invited participant’s acceptance.");
        const [accepted] = await tx.select({ count: sql<number>`count(*)::int` }).from(participants)
          .where(and(eq(participants.tournamentId, t.id), eq(participants.status, "accepted")));
        if (t.maxParticipants != null && accepted.count >= t.maxParticipants)
          throw new TournamentError(409, "This tournament has reached its participant limit.");
        let teamId = mine?.teamId || data.teamId || null;
        if (mine?.teamId && data.teamId && mine.teamId !== data.teamId) throw new TournamentError(409, "Join the team named in your invitation.");
        if (t.hostingType === "team") {
          const [team] = await tx.select().from(teams).where(and(eq(teams.tournamentId, t.id), eq(teams.id, teamId || "00000000-0000-0000-0000-000000000000")));
          if (!team) throw new TournamentError(400, "Choose a tournament team.");
        } else { if (teamId) throw new TournamentError(400, "This is an individual competition."); teamId = null; }
        if (mine) await tx.update(participants).set({ status: "accepted", acceptedAt: now, teamId }).where(eq(participants.id, mine.id));
        else await tx.insert(participants).values({ tournamentId: t.id, userId, status: "accepted", acceptedAt: now, teamId });
        if (mine?.role === "featured" || t.hostingType === "friend" && mine?.userId === t.featuredUserId) {
          t.publishedAt = now;
          await tx.update(tournaments).set({ publishedAt: now }).where(eq(tournaments.id, t.id));
        }
        if (userId !== t.hostId) {
          await notifyTournament(tx, { recipientId: t.hostId, actorId: userId, tournamentId: t.id,
            eventKey: `accepted:${t.id}:${userId}`, kind: "accepted",
            body: `${mine?.role === "featured" ? "The featured participant accepted" : "A participant joined"} “${t.title}”.`,
          });
        }
      }
      if (action === "decline") {
        if (mine?.status !== "invited") throw new TournamentError(409, "There is no pending invitation to decline.");
        await tx.update(participants).set({ status: "declined" }).where(eq(participants.id, mine.id));
        await notifyTournament(tx, { recipientId: t.hostId, actorId: userId, tournamentId: t.id,
          eventKey: `declined:${mine.id}`, kind: "declined",
          body: `${mine.role === "featured" ? "The featured participant declined" : "An invited participant declined"} “${t.title}”.`,
        });
      }
      if (action === "support") {
        if (tournamentStatus(t, now) !== "active" || !t.supportEnabled || t.scoringMethod !== "community_support")
          throw new TournamentError(409, "Support is not available for this scoring format.");
        const [target] = await tx.select().from(participants).where(and(eq(participants.id, data.participantId!),
          eq(participants.tournamentId, t.id), eq(participants.status, "accepted")));
        if (!target || await blocked(tx, userId, target.userId)) throw new TournamentError(400, "Choose an active competitor.");
        if (target.userId === userId || mine?.status === "accepted" && mine.teamId && mine.teamId === target.teamId)
          throw new TournamentError(409, "You cannot support yourself or your own team.");
        const [existing] = await tx.select({ id: supports.id }).from(supports).where(and(eq(supports.tournamentId, t.id), eq(supports.userId, userId)));
        if (existing) throw new TournamentError(409, "Your support has already been recorded for this competition.");
        await tx.insert(supports).values({ tournamentId: t.id, userId, participantId: target.id });
      }
      await writeAudit(tx, t.id, userId, action === "invitations" ? "invited" : action === "support" ? "supported" : action === "join" ? "joined" : action === "decline" ? "declined" : "cancelled",
        action === "support" ? { participantId: data.participantId } : action === "invitations" ? { userId: data.userId, teamId: data.teamId || null } : {});
      return dto(tx, t, userId, now);
    });
    res.json(result);
  });
}
router.use("/tournaments", (error: unknown, _req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  if (error instanceof TournamentError) { res.status(error.status).json({ error: error.message }); return; }
  next(error);
});
export default router;
