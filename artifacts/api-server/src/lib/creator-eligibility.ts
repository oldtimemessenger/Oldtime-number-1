export interface CreatorThresholds {
  accountAgeDays: number;
  originalPosts: number;
  activeDays: number;
  engagementReceived: number;
  communityInteractions: number;
}
export interface CreatorStats extends CreatorThresholds { profileCompletion: number }
export const DEFAULT_THRESHOLDS: CreatorThresholds = {
  accountAgeDays: 14, originalPosts: 5, activeDays: 10,
  engagementReceived: 20, communityInteractions: 5,
};

export function membershipIsActive(entitlement: {
  store: string; verifiedAt: Date; expiresAt: Date; revokedAt: Date | null; state?: string;
} | undefined, now = Date.now()): boolean {
  return Boolean(entitlement && ["apple", "google"].includes(entitlement.store)
    && (entitlement.state === undefined || ["active", "canceled", "billing-issue"].includes(entitlement.state))
    && entitlement.verifiedAt.getTime() <= now && !entitlement.revokedAt
    && entitlement.expiresAt.getTime() > now);
}

export function evaluateCreator(stats: CreatorStats, thresholds: CreatorThresholds,
  options: { membershipActive: boolean; restricted: boolean; automaticApproval: boolean; previousStatus: string; wasApproved?: boolean }) {
  const requirements = [
    { key: "accountAgeDays", label: "Account age", current: stats.accountAgeDays, target: thresholds.accountAgeDays },
    { key: "profileCompletion", label: "Complete your account profile", current: stats.profileCompletion, target: 100 },
    { key: "originalPosts", label: "Qualifying original posts", current: stats.originalPosts, target: thresholds.originalPosts },
    { key: "activeDays", label: "Active posting or interaction days in the last 14 days", current: stats.activeDays, target: thresholds.activeDays },
    { key: "engagementReceived", label: "Engagement from distinct established accounts", current: stats.engagementReceived, target: thresholds.engagementReceived },
    { key: "communityInteractions", label: "Interactions with other creators", current: stats.communityInteractions, target: thresholds.communityInteractions },
  ].map(item => ({ ...item, met: item.current >= item.target }));
  const score = Math.round(requirements.reduce((total, item) => total + Math.min(1, item.current / item.target), 0) / requirements.length * 100);
  const eligible = requirements.every(item => item.met) && !options.restricted;
  let status: string;
  if (options.restricted) status = "restricted";
  else if (options.wasApproved || options.previousStatus === "approved") status = options.membershipActive ? "approved" : "membership-required";
  else if (eligible && !options.membershipActive) status = "membership-required";
  else if (eligible && (options.automaticApproval || options.previousStatus === "approved")) status = "approved";
  else if (eligible) status = "eligible";
  else status = score >= 60 ? "emerging" : "rising";
  const level = eligible || options.wasApproved ? "Creator Eligible" : score >= 60 ? "Emerging" : score >= 25 ? "Rising" : "Newcomer";
  return { status, level, score, eligible, requirements };
}
