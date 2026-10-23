import { eq, sql } from "drizzle-orm";
import {
  db, pool, creatorConfigTable, creatorProgramsTable, blueBadgeEntitlementsTable, creatorHistoryTable,
} from "@workspace/db";
import { UpdateCreatorProgramConfigBody, type CreatorProgramConfig, type CreatorDashboard } from "@workspace/api-zod";
import { DEFAULT_THRESHOLDS, evaluateCreator, membershipIsActive } from "./creator-eligibility";
import { logger } from "./logger";
import { badgeState } from "./badge-readiness";

const dayMs = 86400000;
const baseCampaign = { optional: true, enabled: true, inactiveDays: 0, startAt: null, endAt: null, cooldownHours: 168 } as const;
export const DEFAULT_CREATOR_CONFIG: CreatorProgramConfig = {
  flags: { creatorCenter: true, automaticApproval: true, blueBadge: true, announcements: true, promotions: true, milestones: true },
  thresholds: DEFAULT_THRESHOLDS,
  pricing: { standardPriceCents: 299, trialMonths: 2, returningPriceCents: 99, currency: "USD" },
  promotions: { introductoryEnabled: true, returningEnabled: true, returningInactiveDays: 14, returningOfferDays: 7 },
  distribution: { iphoneUrl: null, androidUrl: null, openUrl: null },
  campaigns: [
    { ...baseCampaign, id: "welcome-old-time", title: "Make yourself at home", description: "Share your moments and find your community. Ordinary posting stays free.", category: "welcome", primaryLabel: "Explore Oldtime", primaryRoute: "updates" },
    { ...baseCampaign, id: "creator-journey", title: "Your creator journey", description: "See how your original posts and community participation contribute to creator eligibility.", category: "creator", primaryLabel: "Open Creator Center", primaryRoute: "creator-center" },
    { ...baseCampaign, id: "creator-approved", title: "Welcome to the Creator Program", description: "Your activity and active membership qualified you for Approved Creator status. Keep a valid membership to retain your status.", category: "creator", primaryLabel: "Open Creator Center", primaryRoute: "creator-center" },
    { ...baseCampaign, id: "creator-membership-needed", title: "Your creator membership needs attention", description: "An active, verified Blue Badge membership is required to maintain Approved Creator status.", category: "creator", primaryLabel: "Check membership", primaryRoute: "blue-badge" },
    { ...baseCampaign, id: "blue-badge-preview", title: "Meet the Blue Badge", description: "Learn about Oldtime membership. Apple and Google purchases are not open yet.", category: "membership", primaryLabel: "Explore Blue Badge", primaryRoute: "blue-badge" },
    { ...baseCampaign, id: "welcome-back", title: "Welcome back to Oldtime", description: "Catch up with your community and see what's new.", category: "returning", inactiveDays: 7, primaryLabel: "See your feed", primaryRoute: "updates" },
  ],
};

export async function creatorConfig(): Promise<CreatorProgramConfig> {
  const [row] = await db.select().from(creatorConfigTable).where(eq(creatorConfigTable.key, "program")).limit(1);
  if (!row) return structuredClone(DEFAULT_CREATOR_CONFIG);
  // Additive configuration upgrade: preserve existing flags/prices/campaigns.
  const saved = row.value as Record<string, unknown>;
  return UpdateCreatorProgramConfigBody.parse({ ...DEFAULT_CREATOR_CONFIG, ...saved });
}

export async function programAccount(userId: string) {
  await db.insert(creatorProgramsTable).values({ userId }).onConflictDoNothing();
  const [account] = await db.select().from(creatorProgramsTable).where(eq(creatorProgramsTable.userId, userId)).limit(1);
  if (!account) throw new Error("Creator account could not be loaded.");
  return account;
}

export async function storeMembership(userId: string) {
  const [entitlement] = await db.select().from(blueBadgeEntitlementsTable).where(eq(blueBadgeEntitlementsTable.userId, userId)).limit(1);
  return {
    active: membershipIsActive(entitlement),
    store: entitlement && ["apple", "google"].includes(entitlement.store) ? entitlement.store as "apple" | "google" : null,
    expiresAt: entitlement?.expiresAt.getTime() ?? null,
    introUsed: entitlement?.introUsed ?? false,
    status: badgeState(entitlement),
    autoRenews: entitlement?.autoRenews ?? null,
    canceledAt: entitlement?.canceledAt?.getTime() ?? null,
  };
}

export async function creatorDashboard(userId: string): Promise<CreatorDashboard> {
  const [config, account, membership] = await Promise.all([creatorConfig(), programAccount(userId), storeMembership(userId)]);
  // Only persistent cloud activity counts. Duplicate text, self-engagement,
  // imported old timestamps, fresh throwaway accounts and repeated peers cannot
  // fabricate the eligibility counters.
  const { rows: [row] } = await pool.query<{
    age: number; complete: number; original: number; days: number; received: number; community: number;
    texts: number; photos: number; videos: number; stories: number; communityPosts: number;
  }>(`
    WITH persisted AS (
      SELECT id, created_at, 'text:'||lower(regexp_replace(trim(text), '\\s+', ' ', 'g')) AS dedupe,
        'text' AS kind,'post' AS surface,source_id IS NULL AS current_activity
      FROM posts WHERE author_id=$1 AND length(trim(text)) >= 20
        AND array_length(regexp_split_to_array(trim(text), '\\s+'), 1) >= 3
      UNION ALL
      SELECT c.id,c.created_at,CASE WHEN c.kind='text' THEN 'text:'||lower(regexp_replace(trim(c.body), '\\s+', ' ', 'g')) ELSE 'media:'||c.fingerprint END,
        c.kind,c.surface,true
      FROM creator_original_content c WHERE c.user_id=$1 AND c.deleted_at IS NULL AND c.original
      AND (c.kind='text' AND length(trim(c.body))>=20 AND array_length(regexp_split_to_array(trim(c.body),'\\s+'),1)>=3
        OR c.kind IN ('photo','video') AND EXISTS (SELECT 1 FROM creator_media_assets a WHERE a.content_id=c.id AND a.user_id=c.user_id AND a.confirmed_at IS NOT NULL AND a.fingerprint IS NOT NULL))
    ), qualifying AS (
      SELECT DISTINCT ON (dedupe) * FROM persisted ORDER BY dedupe,created_at,id
    ), received AS (
      SELECT DISTINCT l.user_id FROM post_likes l JOIN qualifying p ON p.id=l.post_id
      JOIN users u ON u.id=l.user_id
      WHERE l.user_id<>$1 AND u.created_at <= now() - interval '7 days'
      UNION
      SELECT DISTINCT c.user_id FROM post_comments c JOIN qualifying p ON p.id=c.post_id JOIN users u ON u.id=c.user_id
      WHERE c.user_id<>$1 AND u.created_at<=now()-interval '7 days' AND length(trim(c.body))>=20
      AND array_length(regexp_split_to_array(trim(c.body),'\\s+'),1)>=3
    ), community AS (
      SELECT DISTINCT p.author_id FROM post_likes l JOIN posts p ON p.id=l.post_id
      JOIN users u ON u.id=p.author_id
      WHERE l.user_id=$1 AND p.author_id<>$1 AND length(trim(p.text))>=20
      AND u.created_at <= now() - interval '7 days'
      UNION
      SELECT DISTINCT p.author_id FROM post_comments c JOIN posts p ON p.id=c.post_id JOIN users u ON u.id=p.author_id
      WHERE c.user_id=$1 AND p.author_id<>$1 AND u.created_at<=now()-interval '7 days'
      AND length(trim(c.body))>=20 AND array_length(regexp_split_to_array(trim(c.body),'\\s+'),1)>=3
    ), active_days AS (
      SELECT (created_at AT TIME ZONE 'UTC')::date AS day FROM qualifying WHERE current_activity AND created_at >= now()-interval '14 days'
      UNION
      SELECT (l.created_at AT TIME ZONE 'UTC')::date AS day FROM post_likes l JOIN posts p ON p.id=l.post_id
      WHERE l.user_id=$1 AND p.author_id<>$1 AND l.created_at >= now()-interval '14 days'
      UNION
      SELECT (c.created_at AT TIME ZONE 'UTC')::date AS day FROM post_comments c JOIN posts p ON p.id=c.post_id
      WHERE c.user_id=$1 AND p.author_id<>$1 AND c.created_at>=now()-interval '14 days'
      AND length(trim(c.body))>=20 AND array_length(regexp_split_to_array(trim(c.body),'\\s+'),1)>=3
    )
    SELECT greatest(0,floor(extract(epoch from now()-u.created_at)/86400))::int AS age,
      CASE WHEN length(u.username)>0 AND length(u.display_name)>0 AND length(u.email)>0 THEN 100 ELSE 0 END::int AS complete,
      (SELECT count(*)::int FROM qualifying) AS original,
      (SELECT count(*)::int FROM active_days) AS days,
      (SELECT count(*)::int FROM received) AS received,
       (SELECT count(*)::int FROM community) AS community,
       (SELECT count(*)::int FROM qualifying WHERE kind='text') AS texts,
       (SELECT count(*)::int FROM qualifying WHERE kind='photo') AS photos,
       (SELECT count(*)::int FROM qualifying WHERE kind='video') AS videos,
       (SELECT count(*)::int FROM qualifying WHERE surface='story') AS stories,
       (SELECT count(*)::int FROM qualifying WHERE surface='community') AS "communityPosts"
    FROM users u WHERE u.id=$1`, [userId]);
  if (!row) throw new Error("Account not found.");
  const stats = { accountAgeDays: row.age, profileCompletion: row.complete, originalPosts: row.original,
    activeDays: row.days, engagementReceived: row.received, communityInteractions: row.community };
  const result = evaluateCreator(stats, config.thresholds, { membershipActive: membership.active,
    restricted: account.restricted, automaticApproval: config.flags.automaticApproval && config.flags.creatorCenter, previousStatus: account.status, wasApproved: Boolean(account.approvedAt) });
  const reasons: Record<string, string> = {
    approved: "Eligibility checks passed with a verified active membership.",
    "membership-required": "Valid Blue Badge membership is required to hold Approved Creator status.",
    restricted: "Account standing prevents creator approval.",
    eligible: "Activity requirements passed. Automatic approval is currently paused.",
    emerging: "Progress toward the published activity requirements.",
    rising: "Build original content and genuine community participation.",
  };
  let approvedAt = account.approvedAt;
  // Account-row lock makes simultaneous dashboard fetches produce one transition.
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT user_id FROM creator_program_accounts WHERE user_id = ${userId} FOR UPDATE`);
    const [current] = await tx.select().from(creatorProgramsTable).where(eq(creatorProgramsTable.userId, userId)).limit(1);
    if (current?.status !== result.status) {
      approvedAt = result.status === "approved" ? current?.approvedAt ?? new Date() : current?.approvedAt ?? null;
      await tx.update(creatorProgramsTable).set({ status: result.status, approvedAt }).where(eq(creatorProgramsTable.userId, userId));
      await tx.insert(creatorHistoryTable).values({ userId, status: result.status, reason: reasons[result.status] ?? "Creator evaluation updated." });
    }
  });
  const historyRows = await pool.query<{ status: string; reason: string; created_at: Date }>(
    "SELECT status,reason,created_at FROM creator_program_history WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30", [userId]);
  return { ...result, contentBreakdown: { text: row.texts, photos: row.photos, videos: row.videos, stories: row.stories, communityPosts: row.communityPosts },
    status: result.status as CreatorDashboard["status"], approvedAt: approvedAt?.getTime() ?? null,
    membershipRequired: true, requirements: result.requirements, stats, membership: { active: membership.active, store: membership.store, expiresAt: membership.expiresAt },
    history: historyRows.rows.map(h => ({ status: h.status, reason: h.reason, at: h.created_at.getTime() })),
    milestones: config.flags.milestones ? [
      { id: "first-original", title: "First qualifying original post", reached: stats.originalPosts >= 1 },
      { id: "five-original", title: "Five original posts", reached: stats.originalPosts >= 5 },
      { id: "consistent", title: "Ten active days", reached: stats.activeDays >= 10 },
      { id: "eligible", title: "Creator activity requirements achieved", reached: result.eligible },
    ] : [], creatorPayoutsEnabled: false, isAdmin: account.isAdmin };
}

export async function eligibleAnnouncements(userId: string) {
  const [config, account, membership] = await Promise.all([creatorConfig(), programAccount(userId), storeMembership(userId)]);
  const now = Date.now();
  const inactiveDays = account.lastSeenAt ? Math.floor((now - account.lastSeenAt.getTime()) / dayMs) : 0;
  const returningOfferUntil = config.promotions.returningEnabled && inactiveDays >= config.promotions.returningInactiveDays
    ? new Date(now + config.promotions.returningOfferDays * dayMs) : account.returningOfferUntil;
  await db.update(creatorProgramsTable).set({ lastSeenAt: new Date(), returningOfferUntil }).where(eq(creatorProgramsTable.userId, userId));
  if (!config.flags.announcements) return [];
  const { rows: dismissals } = await pool.query<{ campaign_id: string; choice: string; dismiss_until: Date | null }>(
    "SELECT campaign_id,choice,dismiss_until FROM announcement_dismissals WHERE user_id=$1", [userId]);
  const prefs = account.preferences as Record<string, boolean>;
  let promotionCount = 0;
  const { rows: [identity] } = await pool.query<{ age: number }>("SELECT floor(extract(epoch from now()-created_at)/86400)::int AS age FROM users WHERE id=$1", [userId]);
  return [...config.campaigns].sort((a, b) => Number(b.category === "returning") - Number(a.category === "returning")).filter(c => {
    if (!c.enabled || (c.startAt !== null && c.startAt > now) || (c.endAt !== null && c.endAt <= now)) return false;
    if ((c.primaryRoute === "creator-center" && !config.flags.creatorCenter) || (c.primaryRoute === "blue-badge" && !config.flags.blueBadge)) return false;
    if (c.optional && (dismissals.some(d => d.campaign_id === c.id && (d.choice === "never" || Number(d.dismiss_until?.getTime()) > now)))) return false;
    if (c.optional && ((c.category === "creator" && !prefs.creators) || (c.category === "community" && !prefs.communities)
      || (["welcome", "feature"].includes(c.category) && !prefs.features))) return false;
    if (c.id === "creator-approved" && account.status !== "approved") return false;
    if (c.id === "creator-membership-needed" && account.status !== "membership-required") return false;
    if (c.id === "creator-journey" && account.status === "approved") return false;
    if (c.category === "welcome" && identity.age > 7) return false;
    const promotional = c.category === "membership" || c.category === "returning";
    if (promotional && (!config.flags.promotions || !prefs.promotions || membership.active)) return false;
    if (c.inactiveDays > inactiveDays && !(c.category === "returning" && returningOfferUntil && returningOfferUntil.getTime() > now)) return false;
    if (promotional && ++promotionCount > 1) return false;
    return true;
  });
}

const refreshing = new Set<string>();
export function refreshCreatorsAfterActivity(userIds: string[]) {
  for (const id of new Set(userIds)) {
    if (refreshing.has(id)) continue;
    refreshing.add(id);
    void creatorDashboard(id).catch(err => logger.warn({ err }, "Creator activity evaluation could not be completed"))
      .finally(() => refreshing.delete(id));
  }
}

export function startCreatorMembershipRefresh() {
  // Membership validation also occurs on every access. This periodically updates
  // stored creator statuses after expiry even if the account does not visit.
  const timer = setInterval(() => {
    void pool.query(
      `WITH paused AS (
         UPDATE creator_program_accounts c SET status='membership-required'
         WHERE status='approved' AND NOT EXISTS (
           SELECT 1 FROM blue_badge_entitlements e WHERE e.user_id=c.user_id
            AND e.store IN ('apple','google') AND e.state IN ('active','canceled','billing-issue') AND e.verified_at<=now() AND e.expires_at>now() AND e.revoked_at IS NULL
         ) RETURNING user_id
       ) INSERT INTO creator_program_history (user_id,status,reason)
         SELECT user_id,'membership-required','Verified membership expired or was revoked.' FROM paused`,
    )
      .catch(err => logger.warn({ err }, "Scheduled creator membership refresh failed"));
  }, 3600000);
  timer.unref();
}
