import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  db, usersTable, tournamentsTable as tournaments, tournamentParticipants as participants,
  tournamentTeams as teams, tournamentSupports as supports, tournamentAudit as audit,
  tournamentNotifications, tournamentNotificationPreferences,
  participationBlocks as blocks, type TournamentStanding,
} from "@workspace/db";
import { competitionRank, tournamentStatus, TournamentError } from "./tournament-policy";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Tournament = typeof tournaments.$inferSelect;
export const personFields = { id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName };
const person = (u: { id: string; username: string; displayName: string }) => ({ ...u, avatarUrl: null });

export async function blocked(tx: Tx, a: string, b: string) {
  const [row] = await tx.select({ id: blocks.userId }).from(blocks).where(or(
    and(eq(blocks.userId, a), eq(blocks.blockedId, b)),
    and(eq(blocks.userId, b), eq(blocks.blockedId, a)))).limit(1);
  return !!row;
}
export async function standings(tx: Tx, t: Tournament) {
  const roster = await tx.select({ entry: participants, user: personFields }).from(participants)
    .innerJoin(usersTable, eq(usersTable.id, participants.userId))
    .where(and(eq(participants.tournamentId, t.id), eq(participants.status, "accepted")));
  const tally = await tx.select({ participantId: supports.participantId, score: sql<number>`count(*)::int` })
    .from(supports).where(eq(supports.tournamentId, t.id)).groupBy(supports.participantId);
  const counts = new Map(tally.map(r => [r.participantId, r.score]));
  const scoreMap = new Map<string, number>();
  if (t.scoringMethod === "participant_entries") {
    for (const item of roster) scoreMap.set(item.entry.id, 1);
  } else for (const [id, count] of counts) scoreMap.set(id, count);
  const groups = await tx.select().from(teams).where(eq(teams.tournamentId, t.id));
  const rows: Omit<TournamentStanding, "rank">[] = t.hostingType === "team"
    ? groups.map(team => {
      const members = roster.filter(p => p.entry.teamId === team.id);
      const score = members.reduce((n, p) => n + (scoreMap.get(p.entry.id) || 0), 0);
      return { id: team.id, teamId: team.id, participantId: null, name: team.name, score,
        percentage: Math.min(100, score / t.goal * 100), members: members.map(p => person(p.user)) };
    })
    : roster.map(p => {
      const score = scoreMap.get(p.entry.id) || 0;
      return { id: p.entry.id, teamId: null, participantId: p.entry.id, name: p.user.displayName, score,
        percentage: Math.min(100, score / t.goal * 100), members: [person(p.user)] };
    });
  return { roster, groups, counts, scoreMap, results: competitionRank(rows) };
}
export async function writeAudit(tx: Tx, tournamentId: string, actorId: string | null, action: string, details: Record<string, unknown> = {}) {
  await tx.insert(audit).values({ tournamentId, actorId, action, details });
}
export async function notifyTournament(tx: Tx, input: {
  recipientId: string; actorId?: string | null; tournamentId: string; eventKey: string;
  kind: string; body: string; essential?: boolean;
}) {
  const essential = input.essential ?? true;
  if (!essential) {
    const [preference] = await tx.select().from(tournamentNotificationPreferences)
      .where(eq(tournamentNotificationPreferences.userId, input.recipientId));
    if (preference?.nonEssentialEnabled === false) return;
  }
  await tx.insert(tournamentNotifications).values({ ...input, essential }).onConflictDoNothing();
}
// All writers take the same row lock. Time is read AFTER waiting for the lock.
export async function withTournament<T>(id: string, viewer: string, action: (tx: Tx, t: Tournament, now: Date) => Promise<T>) {
  return db.transaction(async tx => {
    await tx.execute(sql`select id from tournaments where id=${id} for update`);
    const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, id));
    if (!t) throw new TournamentError(404, "Tournament not found.");
    const [membership] = await tx.select().from(participants).where(and(eq(participants.tournamentId, id), eq(participants.userId, viewer)));
    if (await blocked(tx, t.hostId, viewer) || t.hostId !== viewer &&
      ((!t.publishedAt || t.visibility !== "public") && !membership))
      throw new TournamentError(404, "This tournament is private. Ask the host for an invitation.");
    const clock = await tx.execute(sql`select clock_timestamp() as now`);
    const now = new Date(clock.rows[0].now as string);
    if (!t.cancelledAt && !t.completedAt && now >= t.endsAt) {
      const { results, roster } = await standings(tx, t);
      t.completedAt = now; t.finalResults = results;
      await tx.update(tournaments).set({ completedAt: now, finalResults: results }).where(eq(tournaments.id, id));
      await writeAudit(tx, id, null, "completed");
      const recipients = new Set([t.hostId, ...roster.map(p => p.entry.userId)]);
      for (const recipientId of recipients) await notifyTournament(tx, {
        recipientId, tournamentId: id, eventKey: `completed:${id}`, kind: "completed",
        body: `“${t.title}” has ended. Final results are ready.`, essential: true,
      });
    }
    return action(tx, t, now);
  });
}
export async function dto(tx: Tx, t: Tournament, viewer: string, now: Date) {
  const { roster, groups, counts, scoreMap, results } = await standings(tx, t);
  const [host] = await tx.select(personFields).from(usersTable).where(eq(usersTable.id, t.hostId));
  const all = await tx.select({ entry: participants, user: personFields }).from(participants)
    .innerJoin(usersTable, eq(usersTable.id, participants.userId)).where(eq(participants.tournamentId, t.id));
  const my = all.find(p => p.entry.userId === viewer);
  const myTeam = my?.entry.teamId ? groups.find(team => team.id === my.entry.teamId) : null;
  const mapEntry = (p: typeof all[number]) => ({ ...p.entry, user: person(p.user), score: scoreMap.get(p.entry.id) || 0,
    percentage: Math.min(100, (scoreMap.get(p.entry.id) || 0) / t.goal * 100) });
  const [mySupport] = await tx.select({ participantId: supports.participantId }).from(supports)
    .where(and(eq(supports.tournamentId, t.id), eq(supports.userId, viewer)));
  // Unaccepted identities are private to the organizer and the invitee.
  const visible = all.filter(p => p.entry.status === "accepted" || t.hostId === viewer || p.entry.userId === viewer);
  const logs = await tx.select({ id: audit.id, action: audit.action, createdAt: audit.createdAt, actor: personFields })
    .from(audit).leftJoin(usersTable, eq(usersTable.id, audit.actorId)).where(eq(audit.tournamentId, t.id))
    .orderBy(desc(audit.createdAt)).limit(20);
  const status = tournamentStatus(t, now);
  const open = status === "upcoming" || status === "active" || status === "awaiting_consent";
  return {
    id: t.id, title: t.title, description: t.description, rules: t.rules, category: t.category,
    coverTheme: t.coverTheme, hostingType: t.hostingType,
    visibility: t.visibility, scoringMethod: t.scoringMethod, supportEnabled: t.supportEnabled,
    openToParticipants: t.openToParticipants, maxParticipants: t.maxParticipants, goal: t.goal,
    startsAt: t.startsAt, endsAt: t.endsAt, createdAt: t.createdAt, status,
    host: person(host), featuredParticipantId: t.featuredUserId, format: t.hostingType === "team" ? "team" : "individual",
    participantCount: roster.length, participants: visible.map(mapEntry), teams: groups.map(team => ({
      ...team, captain: all.find(p => p.entry.userId === team.captainId)?.user
        ? person(all.find(p => p.entry.userId === team.captainId)!.user) : null,
    })),
    standings: t.finalResults || results, finalResults: t.finalResults,
    recentActivity: logs.filter(l => !["invited", "declined"].includes(l.action) || t.hostId === viewer || l.actor?.id === viewer)
      .map(l => ({ ...l, actor: l.actor ? person(l.actor) : null })),
    canManage: t.hostId === viewer,
    canInvite: t.hostId === viewer || my?.entry.status === "accepted" && myTeam?.captainId === viewer,
    myParticipation: my ? mapEntry(my) : null, mySupport: mySupport || null,
    canJoin: !!(open && my?.entry.status !== "accepted" && !["declined","withdrawn","change_requested"].includes(my?.entry.status || "") &&
      (t.publishedAt ? t.visibility === "public" && t.openToParticipants || my?.entry.status === "invited" : my?.entry.role === "featured")),
    canSupport: status === "active" && t.scoringMethod === "community_support" && t.supportEnabled && !mySupport,
    serverNow: now.toISOString(),
  };
}
export function requireOpen(t: Tournament, now: Date) {
  if (["completed", "cancelled"].includes(tournamentStatus(t, now)))
    throw new TournamentError(409, "This competition has ended. Its results are locked.");
}
// Used by the background sweeper, including tournaments nobody currently has open.
export async function finalizeDueTournaments() {
  const due = await db.select({ id: tournaments.id, hostId: tournaments.hostId }).from(tournaments)
    .where(sql`${tournaments.endsAt} <= clock_timestamp() and ${tournaments.completedAt} is null and ${tournaments.cancelledAt} is null`).limit(100);
  for (const t of due) await withTournament(t.id, t.hostId, async () => undefined);
}
export async function notifyTournamentMilestones() {
  const rows = await db.select({ id: tournaments.id, hostId: tournaments.hostId }).from(tournaments)
    .where(sql`${tournaments.publishedAt} is not null and ${tournaments.cancelledAt} is null and ${tournaments.completedAt} is null
      and ${tournaments.endsAt} > clock_timestamp() and ${tournaments.startsAt} <= clock_timestamp() + interval '24 hours'`)
    .orderBy(tournaments.startsAt).limit(100);
  for (const row of rows) await withTournament(row.id, row.hostId, async (tx, t, clockNow) => {
    if (t.cancelledAt || t.completedAt || !t.publishedAt) return;
    const roster = await tx.select({ userId: participants.userId }).from(participants)
      .where(and(eq(participants.tournamentId, t.id), eq(participants.status, "accepted")));
    const recipients = new Set([t.hostId, ...roster.map(p => p.userId)]);
    if (t.startsAt > clockNow && t.startsAt.getTime() - clockNow.getTime() <= 24 * 3600000) {
      for (const recipientId of recipients) await notifyTournament(tx, {
        recipientId, tournamentId: t.id, eventKey: `reminder-24h:${t.id}:${recipientId}`,
        kind: "starts_soon", body: `“${t.title}” is scheduled to start within 24 hours.`, essential: false,
      });
      return;
    }
    if (clockNow < t.startsAt) return;
    for (const recipientId of recipients) await notifyTournament(tx, {
      recipientId, tournamentId: t.id, eventKey: `started:${t.id}:${recipientId}`,
      kind: "started", body: `“${t.title}” has started.`, essential: false,
    });
    const { results } = await standings(tx, t);
    const percentage = Math.max(0, ...results.map(r => r.percentage));
    for (const threshold of [25, 50, 75, 100]) if (percentage >= threshold) {
      for (const recipientId of recipients) await notifyTournament(tx, {
        recipientId, tournamentId: t.id, eventKey: `milestone:${t.id}:${threshold}:${recipientId}`,
        kind: "milestone", body: `“${t.title}” reached ${threshold}% of its goal.`, essential: false,
      });
    }
  });
}
