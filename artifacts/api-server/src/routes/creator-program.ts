import { Router, type IRouter, type RequestHandler, type ErrorRequestHandler } from "express";
import { requireCreatorAccount } from "../lib/account-professional";
import { eq } from "drizzle-orm";
import {
  db, pool, creatorProgramsTable, creatorConfigTable, announcementDismissalsTable, announcementEventsTable,
} from "@workspace/db";
import {
  UpdateAnnouncementPreferencesBody, DismissAccountAnnouncementBody, RecordAnnouncementEventBody,
  UpdateCreatorProgramConfigBody, GetCreatorCenterResponse, GetBlueBadgeMembershipResponse,
} from "@workspace/api-zod";
import { createRateLimiter, getAuthContext, requireAuth } from "../lib/auth";
import { creatorConfig, creatorDashboard, eligibleAnnouncements, programAccount, storeMembership } from "../lib/creator-program";
import { membershipIsActive } from "../lib/creator-eligibility";
import { validDistribution } from "../lib/badge-readiness";
import { isRevenueCatBillingConfigured, refreshRevenueCatMembership, RevenueCatVerificationError } from "../lib/revenuecat-membership";

const router: IRouter = Router();
const limit = createRateLimiter("creator", 90);
const evalLimit = createRateLimiter("creator-evaluation", 8);
const billingLimit = createRateLimiter("badge-verification", 8);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireAdmin: RequestHandler = async (_req, res, next) => {
  if (!(await programAccount(getAuthContext(res).userId)).isAdmin) {
    res.status(403).json({ error: "Creator administrator access is required." }); return;
  }
  next();
};
const routes = ["/creator", "/badge", "/announcements", "/announcement-preferences"];
router.use(routes, requireAuth, limit);

const dashboard: RequestHandler = async (_req, res) => {
  if (!(await creatorConfig()).flags.creatorCenter) {
    res.status(503).json({ error: "Creator Center is currently paused." }); return;
  }
  res.json(GetCreatorCenterResponse.parse(await creatorDashboard(getAuthContext(res).userId)));
};
router.get("/creator/center", requireCreatorAccount, dashboard);
router.post("/creator/evaluate", requireCreatorAccount, evalLimit, dashboard);

async function blueBadgeMembershipResponse(userId: string) {
  const [config, account, membership] = await Promise.all([creatorConfig(), programAccount(userId), storeMembership(userId)]);
  const billingEnabled = isRevenueCatBillingConfigured();
  return GetBlueBadgeMembershipResponse.parse({
    status: membership.status, autoRenews: membership.autoRenews, canceledAt: membership.canceledAt,
    purchaseSupported: billingEnabled, restorationSupported: billingEnabled, distribution: config.distribution, promotionConfig: config.promotions,
    active: membership.active, store: membership.store, expiresAt: membership.expiresAt,
    interested: account.interested, billingEnabled,
    ...config.pricing,
    benefits: ["A membership badge beside your profile and interactions", "Creator Center guidance and resources remain available to everyone",
      "Planned early access and selected beta invitations", "Planned profile customization and member support"],
    // No billing provider is configured, so never advertise a trial or discount
    // that cannot be applied at checkout. Membership status remains store-verified.
    offer: { eligible: false, kind: "standard", available: false },
    creatorMembershipRequired: true,
  });
}

router.get("/badge/membership", async (_req, res) => {
  const userId = getAuthContext(res).userId;
  if (!(await creatorConfig()).flags.blueBadge) {
    res.status(503).json({ error: "Blue Badge is currently paused." }); return;
  }
  const membership = await blueBadgeMembershipResponse(userId);
  if (!membership) return;
  res.setHeader("Cache-Control", "no-store");
  res.json(membership);
});

router.post("/badge/membership/refresh", billingLimit, async (req, res) => {
  const userId = getAuthContext(res).userId;
  if (!(await creatorConfig()).flags.blueBadge) {
    res.status(503).json({ error: "Blue Badge is currently paused." }); return;
  }
  try {
    await refreshRevenueCatMembership(userId);
  } catch (error) {
    if (error instanceof RevenueCatVerificationError) {
      res.status(error.status).json({ error: error.publicMessage }); return;
    }
    throw error;
  }
  const membership = await blueBadgeMembershipResponse(userId);
  if (!membership) return;
  res.setHeader("Cache-Control", "no-store");
  res.json(membership);
});

router.post("/badge/interest", async (_req, res) => {
  const userId = getAuthContext(res).userId;
  if (!(await creatorConfig()).flags.blueBadge) { res.status(503).json({ error: "Blue Badge is currently paused." }); return; }
  await programAccount(userId);
  await db.update(creatorProgramsTable).set({ interested: true }).where(eq(creatorProgramsTable.userId, userId));
  res.json({ interested: true });
});

router.get("/creator/badges", async (req, res) => {
  const ids = [...new Set(String(req.query.userIds ?? "").split(","))];
  if (!ids.length || ids.length > 50 || ids.some(id => !uuid.test(id))) {
    res.status(400).json({ error: "Provide between 1 and 50 valid account IDs." }); return;
  }
  if (!(await creatorConfig()).flags.blueBadge) { res.json({ badges: ids.map(userId => ({ userId, active: false })) }); return; }
  const { rows } = await pool.query<{ user_id: string; store: string; state: string; verified_at: Date; expires_at: Date; revoked_at: Date | null }>(
    "SELECT user_id,store,state,verified_at,expires_at,revoked_at FROM blue_badge_entitlements WHERE user_id=ANY($1::uuid[])", [ids]);
  const active = new Set(rows.filter(row => membershipIsActive({ store: row.store, state: row.state, verifiedAt: row.verified_at, expiresAt: row.expires_at, revokedAt: row.revoked_at })).map(row => row.user_id));
  res.setHeader("Cache-Control", "no-store");
  res.json({ badges: ids.map(userId => ({ userId, active: active.has(userId.toLowerCase()) })) });
});

router.get("/announcements", async (_req, res) => {
  const userId = getAuthContext(res).userId;
  const announcements = await eligibleAnnouncements(userId);
  const { rows } = await pool.query<{ campaign_id: string }>("SELECT DISTINCT campaign_id FROM announcement_events WHERE user_id=$1 AND event='shown'", [userId]);
  const seen = new Set(rows.map(row => row.campaign_id));
  res.json({ announcements, unreadCount: announcements.filter(item => !seen.has(item.id)).length,
    optionalTipsEnabled:(await creatorConfig()).flags.announcements });
});

router.get("/announcement-preferences", async (_req, res) => {
  const account = await programAccount(getAuthContext(res).userId);
  res.json(UpdateAnnouncementPreferencesBody.parse(account.preferences));
});
router.put("/announcement-preferences", async (req, res) => {
  const parsed = UpdateAnnouncementPreferencesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "All four announcement preferences must be true or false." }); return; }
  const userId = getAuthContext(res).userId;
  await programAccount(userId);
  await db.update(creatorProgramsTable).set({ preferences: parsed.data }).where(eq(creatorProgramsTable.userId, userId));
  res.json(parsed.data);
});

router.post("/announcements/:id/dismiss", async (req, res) => {
  const parsed = DismissAccountAnnouncementBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose Not now or Never show." }); return; }
  const campaign = (await creatorConfig()).campaigns.find(c => c.id === req.params.id);
  if (!campaign) { res.status(404).json({ error: "Announcement not found." }); return; }
  if (!campaign.optional || ["safety", "service"].includes(campaign.category)) {
    res.status(400).json({ error: "Essential account and service notices cannot be suppressed." }); return;
  }
  const values = { userId: getAuthContext(res).userId, campaignId: campaign.id, choice: parsed.data.choice,
    dismissUntil: parsed.data.choice === "not-now" ? new Date(Date.now() + campaign.cooldownHours * 3600000) : null };
  await db.insert(announcementDismissalsTable).values(values).onConflictDoUpdate({
    target: [announcementDismissalsTable.userId, announcementDismissalsTable.campaignId], set: { choice: values.choice, dismissUntil: values.dismissUntil },
  });
  res.json({ dismissed: true });
});
router.post("/announcements/:id/event", async (req, res) => {
  const parsed = RecordAnnouncementEventBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Unsupported announcement event." }); return; }
  const campaign = (await creatorConfig()).campaigns.find(c => c.id === req.params.id && c.enabled);
  if (!campaign) { res.status(404).json({ error: "Announcement not found." }); return; }
  await db.insert(announcementEventsTable).values({ userId: getAuthContext(res).userId, campaignId: campaign.id,
    event: parsed.data.event, day: new Date().toISOString().slice(0, 10) }).onConflictDoNothing();
  res.json({ recorded: true });
});
router.post("/announcements/reset", async (_req, res) => {
  await db.delete(announcementDismissalsTable).where(eq(announcementDismissalsTable.userId, getAuthContext(res).userId));
  res.json({ reset: true });
});

router.get("/creator/admin/config", requireAdmin, async (_req, res) => res.json(await creatorConfig()));
router.get("/creator/admin/analytics", requireAdmin, async (_req, res) => {
  const { rows: [stats] } = await pool.query<{
    evaluatedAccounts: number; approvedCreators: number; interestedAccounts: number;
    activeMemberships: number; announcementViews: number; announcementActions: number;
  }>(`WITH active AS (
      SELECT user_id FROM blue_badge_entitlements
       WHERE store IN ('apple','google') AND state IN ('active','canceled','billing-issue') AND verified_at<=now() AND expires_at>now() AND revoked_at IS NULL
    ) SELECT
      (SELECT count(*)::int FROM creator_program_accounts) AS "evaluatedAccounts",
      (SELECT count(*)::int FROM creator_program_accounts c JOIN active a ON c.user_id=a.user_id WHERE c.status='approved' AND NOT c.restricted) AS "approvedCreators",
      (SELECT count(*)::int FROM creator_program_accounts WHERE interested) AS "interestedAccounts",
      (SELECT count(*)::int FROM active) AS "activeMemberships",
      (SELECT count(*)::int FROM announcement_events WHERE event='shown') AS "announcementViews",
      (SELECT count(*)::int FROM announcement_events WHERE event='action') AS "announcementActions"`);
  res.json(stats);
});
router.put("/creator/admin/config", requireAdmin, async (req, res) => {
  const parsed = UpdateCreatorProgramConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Configuration does not match the published limits and fields." }); return; }
  const config = parsed.data;
  if (new Set(config.campaigns.map(c => c.id)).size !== config.campaigns.length
    || config.campaigns.some(c => (c.startAt !== null && c.endAt !== null && c.endAt <= c.startAt)
      || (["safety", "service"].includes(c.category) && c.optional))
     || !validDistribution(config.distribution)
     || Object.keys(req.body).some(key => !["flags", "thresholds", "campaigns", "pricing", "promotions", "distribution"].includes(key))
    || Object.keys(req.body.flags).some(key => !(key in config.flags))) {
    res.status(400).json({ error: "Check the campaign IDs, dates, required notices and official app links. Billing and payout controls are not supported." }); return;
  }
  await db.insert(creatorConfigTable).values({ key: "program", value: config }).onConflictDoUpdate({
    target: creatorConfigTable.key, set: { value: config, updatedAt: new Date() },
  });
  req.log.info({ administratorId: getAuthContext(res).userId }, "Creator program configuration updated");
  res.json(config);
});

const handleError: ErrorRequestHandler = (error, req, res, _next) => {
  req.log.error({ err: error }, "Creator program request failed");
  res.status(500).json({ error: "Creator information could not be loaded. Try again." });
};
router.use(handleError);
export default router;
