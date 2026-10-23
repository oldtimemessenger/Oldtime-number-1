import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { eq, inArray } from "drizzle-orm";
import { db, pool, usersTable, sessionsTable, tournamentsTable, tournamentParticipants, tournamentSupports, tournamentAudit, tournamentNotifications } from "@workspace/db";
import app from "../src/app";
import { createAccessToken, hashAccessToken, makePasswordCredentials } from "../src/lib/auth";
import { competitionRank, tournamentInput, tournamentStatus } from "../src/lib/tournament-policy";
import { finalizeDueTournaments, notifyTournamentMilestones } from "../src/lib/tournaments";

test("tournament policy rejects score injection and preserves tied rankings", () => {
  assert.deepEqual(competitionRank([{ id: "b", score: 3 }, { id: "a", score: 3 }, { id: "c", score: 1 }]).map(r => r.rank), [1, 1, 3]);
  const dates = { startsAt: new Date(2000), endsAt: new Date(4000), publishedAt: new Date(1000), completedAt: null, cancelledAt: null };
  assert.equal(tournamentStatus(dates, new Date(1999)), "upcoming");
  assert.equal(tournamentStatus(dates, new Date(2000)), "active");
  assert.equal(tournamentStatus(dates, new Date(4000)), "completed");
  assert.equal(tournamentInput.safeParse({ title: "Injected", score: 999 }).success, false);
});

test("tournaments use real sessions, consent, unique support, team eligibility and immutable completion", { timeout: 120000 }, async () => {
  assert.notEqual(process.env.NODE_ENV, "production", "Integration tests must not run against production");
  const ids = Array.from({ length: 4 }, () => randomUUID()), tournamentIds: string[] = [];
  const tokens = ids.map(() => createAccessToken());
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address() as { port: number };
  const base = `http://127.0.0.1:${addr.port}/api/tournaments`;
  async function request(actor: number | null, path = "", method = "GET", body?: unknown) {
    const response = await fetch(base + path, { method, headers: {
      ...(actor == null ? {} : { Authorization: `Bearer ${tokens[actor]}` }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json().catch(() => null) };
  }
  const input = (extra: Record<string, unknown> = {}) => ({
    title: "Tournament integration " + randomUUID().slice(0, 8),
    description: "A synthetic competition for automated checks.", rules: "One support per account. No self support.",
    hostingType: "community", visibility: "public", durationMinutes: 30, startsAt: new Date().toISOString(), goal: 10, ...extra,
  });
  const create = async (extra: Record<string, unknown> = {}) => {
    const r = await request(0, "", "POST", input(extra));
    assert.equal(r.status, 201, JSON.stringify(r.data)); tournamentIds.push(r.data.id); return r.data;
  };
  try {
    const credentials = await makePasswordCredentials(randomUUID());
    await db.insert(usersTable).values(ids.map((id, i) => ({
      id, email: `tournament-${id}@example.test`, username: `trn_${id.replaceAll("-", "").slice(0, 20)}`,
      displayName: `Tournament Tester ${i}`, ...credentials,
    })));
    await db.insert(sessionsTable).values(ids.map((id, i) => ({
      userId: id, tokenHash: hashAccessToken(tokens[i]), expiresAt: new Date(Date.now() + 600000),
    })));
    assert.equal((await request(null)).status, 401);
    assert.equal((await request(0, "", "POST", input({ score: 100 }))).status, 400);
    assert.equal((await request(0, "", "POST", input({ durationMinutes: 5 }))).status, 400);
    for (const durationMinutes of [30, 120, 720, 1440]) {
      const t = await create({ durationMinutes, startsAt: new Date(Date.now() + 60000).toISOString() });
      assert.equal(Date.parse(t.endsAt) - Date.parse(t.startsAt), durationMinutes * 60000);
      assert.equal((await request(1, `/${t.id}/support`, "POST", { participantId: t.participants[0].id })).status, 409);
      assert.equal((await request(1, `/${t.id}/cancel`, "POST", {})).status, 403);
      assert.equal((await request(0, `/${t.id}/cancel`, "POST", {})).data.status, "cancelled");
      assert.equal((await request(1, `/${t.id}/join`, "POST", {})).status, 409);
    }
    const t = await create();
    const owner = t.participants[0];
    assert.equal((await request(0, `/${t.id}/support`, "POST", { participantId: owner.id })).status, 409);
    const join = await request(1, `/${t.id}/join`, "POST", {});
    assert.equal(join.status, 200); assert.equal(join.data.participantCount, 2);
    assert.equal((await request(1, `/${t.id}/join`, "POST", {})).data.participantCount, 2);
    const votes = await Promise.all([request(2, `/${t.id}/support`, "POST", { participantId: owner.id }),
      request(2, `/${t.id}/support`, "POST", { participantId: owner.id })]);
    assert.deepEqual(votes.map(r => r.status).sort(), [200, 409]);
    assert.equal((await request(1, `/${t.id}/support`, "POST", { participantId: owner.id, score: 100 })).status, 400);
    assert.equal((await request(1, `/${t.id}/invitations`, "POST", { userId: ids[3] })).status, 403);
    let current = (await request(3, `/${t.id}`)).data;
    assert.equal(current.standings[0].score, 1);
    assert.equal(current.standings[0].percentage, 10);
    // Simulate elapsed time only on this test's own competition; production records are never modified.
    await db.update(tournamentsTable).set({ startsAt: new Date(Date.now() - 3600000), endsAt: new Date(Date.now() - 60000) }).where(eq(tournamentsTable.id, t.id));
    await finalizeDueTournaments();
    current = (await request(3, `/${t.id}`)).data;
    assert.equal(current.status, "completed"); assert.equal(current.finalResults[0].score, 1);
    const frozen = JSON.stringify(current.finalResults);
    assert.equal((await request(3, `/${t.id}/support`, "POST", { participantId: owner.id })).status, 409);
    assert.equal((await request(3, `/${t.id}/join`, "POST", {})).status, 409);
    assert.equal(JSON.stringify((await request(0, `/${t.id}`)).data.finalResults), frozen);
    assert.equal((await db.select().from(tournamentSupports).where(eq(tournamentSupports.tournamentId, t.id))).length, 1);
    assert.equal((await db.select().from(tournamentAudit).where(eq(tournamentAudit.tournamentId, t.id))).filter(r => r.action === "completed").length, 1);

    const consent = await create({ hostingType: "person", featuredUserId: ids[1] });
    assert.equal(consent.status, "awaiting_consent");
    assert.equal(consent.participantCount, 0);
    assert.equal((await request(2, `/${consent.id}`)).status, 404);
    assert.ok(!(await request(2)).data.tournaments.some((r: { id: string }) => r.id === consent.id));
    assert.ok((await request(1, "?scope=mine")).data.tournaments.some((r: { id: string }) => r.id === consent.id));
    assert.equal((await request(1, `/${consent.id}/join`, "POST", {})).data.status, "active");
    assert.equal((await request(2, `/${consent.id}`)).status, 200);
    assert.equal((await request(0, `/${consent.id}/invitations`, "POST", { userId: ids[3] })).status, 200);
    assert.equal((await request(0, `/${consent.id}/invitations`, "POST", { userId: ids[3] })).status, 409);
    assert.equal((await request(3, `/${consent.id}/decline`, "POST", {})).data.myParticipation.status, "declined");
    assert.equal((await request(3, `/${consent.id}/join`, "POST", {})).status, 409);
    const friend = await create({ hostingType: "friend", featuredUserId: ids[1] });
    assert.equal(friend.visibility, "invite_only");
    assert.equal(friend.status, "awaiting_consent");
    assert.equal((await request(2, `/${friend.id}`)).status, 404);
    assert.equal((await request(1, `/${friend.id}/join`, "POST", {})).data.status, "active");
    assert.equal((await request(2, `/${friend.id}`)).status, 404);

    const team = await create({ hostingType: "team", teamNames: ["North", "South"] });
    const first = team.teams[0].id, second = team.teams[1].id;
    assert.equal((await request(1, `/${team.id}/join`, "POST", { teamId: first })).status, 200);
    const joinTeam = await request(2, `/${team.id}/join`, "POST", { teamId: second });
    assert.equal(joinTeam.status, 200);
    assert.equal((await request(1, `/${team.id}/support`, "POST", { participantId: team.participants[0].id })).status, 409);
    const target = joinTeam.data.participants.find((p: { userId: string }) => p.userId === ids[2]);
    const supportTeam = await request(3, `/${team.id}/support`, "POST", { participantId: target.id });
    assert.equal(supportTeam.status, 200);
    assert.equal(supportTeam.data.standings.find((s: { teamId: string }) => s.teamId === second).score, 1);
    assert.equal((await request(2, `/${team.id}/join`, "POST", { teamId: first })).data.myParticipation.teamId, second);
    assert.equal((await db.select().from(tournamentParticipants).where(eq(tournamentParticipants.tournamentId, team.id))).length, 3);

    const changes = await create({ hostingType: "person", featuredUserId: ids[1], startsAt: new Date(Date.now() + 60000).toISOString() });
    const change = await request(1, `/${changes.id}/request-changes`, "POST", { message: "Please extend the duration to give everyone time." });
    assert.equal(change.status, 200); assert.equal(change.data.myParticipation.status, "change_requested");
    const pendingId = change.data.myParticipation.id;
    assert.equal((await request(0, `/${changes.id}/resend/${pendingId}`, "POST", {})).status, 200);
    assert.equal((await request(1, `/${changes.id}`)).data.myParticipation.status, "invited");
    const notices = (await request(1, "/notifications")).data.notifications;
    const revisedNotice = notices.find((n: { kind: string }) => n.kind === "invitation_updated");
    assert.ok(revisedNotice);
    assert.equal((await request(1, `/notifications/${revisedNotice.id}/read`, "PATCH", {})).status, 200);
    assert.equal((await request(1, `/${changes.id}/join`, "POST", {})).status, 200);

    const limited = await create({
      visibility: "public", openToParticipants: false, maxParticipants: 2,
      scoringMethod: "participant_entries", supportEnabled: false,
      startsAt: new Date(Date.now() + 60000).toISOString(),
    });
    assert.equal(limited.standings[0].score, 1);
    assert.equal((await request(1, `/${limited.id}/join`, "POST", {})).status, 403);
    assert.equal((await request(0, `/${limited.id}/invitations`, "POST", { userId: ids[1] })).status, 200);
    assert.equal((await request(1, `/${limited.id}/join`, "POST", {})).data.myParticipation.status, "accepted");
    assert.equal((await request(0, `/${limited.id}/invitations`, "POST", { userId: ids[2] })).status, 409);
    assert.equal((await request(2, `/${limited.id}/support`, "POST", { participantId: limited.participants[0].id })).status, 409);
    assert.equal((await request(0, `/${limited.id}`, "PATCH", {
      title: "Revised before start", durationMinutes: 45, startsAt: new Date(Date.now() + 120000).toISOString(),
    })).data.title, "Revised before start");
    assert.equal((await request(1, "/notification-preferences", "PATCH", { nonEssentialEnabled: false })).status, 200);
    assert.equal((await request(1, "/notification-preferences")).data.nonEssentialEnabled, false);

    const withdraw = await create({ startsAt: new Date(Date.now() + 60000).toISOString() });
    assert.equal((await request(1, `/${withdraw.id}/join`, "POST", {})).status, 200);
    assert.equal((await request(1, `/${withdraw.id}/withdraw`, "POST", {})).status, 200);
    assert.equal((await request(1, `/${withdraw.id}/join`, "POST", {})).status, 409);

    const teamCaptain = await create({ hostingType: "team", teamNames: ["Red", "Black"], startsAt: new Date(Date.now() + 60000).toISOString() });
    const captainTeamId = teamCaptain.teams[0].id;
    assert.equal((await request(0, `/${teamCaptain.id}/invitations`, "POST", { userId: ids[1], teamId: captainTeamId })).status, 200);
    const teammate = await request(1, `/${teamCaptain.id}/join`, "POST", {});
    assert.equal(teammate.status, 200);
    assert.equal((await request(0, `/${teamCaptain.id}/teams/${captainTeamId}/captain`, "POST", { userId: ids[1] })).status, 200);
    assert.equal((await request(1, `/${teamCaptain.id}/invitations`, "POST", { userId: ids[2] })).status, 200);
    assert.ok((await db.select().from(tournamentNotifications).where(eq(tournamentNotifications.recipientId, ids[1]))).length > 0);

    const milestone = await create({ goal: 1, startsAt: new Date(Date.now() - 5000).toISOString(), durationMinutes: 60 });
    assert.equal((await request(2, `/${milestone.id}/support`, "POST", { participantId: milestone.participants[0].id })).status, 200);
    await notifyTournamentMilestones();
    const hostNotices = (await request(0, "/notifications")).data.notifications;
    assert.ok(hostNotices.some((n: { kind: string; tournamentId: string }) => n.tournamentId === milestone.id && n.kind === "started"));
    assert.ok(hostNotices.some((n: { kind: string; tournamentId: string }) => n.tournamentId === milestone.id && n.kind === "milestone"));
  } finally {
    if (tournamentIds.length) await db.delete(tournamentsTable).where(inArray(tournamentsTable.id, tournamentIds));
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    await pool.end();
  }
});
