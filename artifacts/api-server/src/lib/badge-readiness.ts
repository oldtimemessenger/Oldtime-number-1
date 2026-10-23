// Provider-neutral membership presentation. No client input grants access.
export type BadgeState = "none" | "pending" | "active" | "canceled" | "expired" | "revoked" | "billing-issue";
export function badgeState(entitlement: {
  state?: string; revokedAt?: Date | null; expiresAt: Date; verifiedAt: Date;
  canceledAt?: Date | null; billingIssueAt?: Date | null;
} | null | undefined, now = Date.now()): BadgeState {
  if (!entitlement) return "none";
  if (entitlement.revokedAt || entitlement.state === "revoked") return "revoked";
  if (entitlement.state === "pending" || entitlement.verifiedAt.getTime() > now) return "pending";
  if (entitlement.state === "expired" || entitlement.expiresAt.getTime() <= now) return "expired";
  if (entitlement.billingIssueAt || entitlement.state === "billing-issue") return "billing-issue";
  if (entitlement.canceledAt || entitlement.state === "canceled") return "canceled";
  return entitlement.state === undefined || entitlement.state === "active" ? "active" : "none";
}

export function validDistribution(links: { iphoneUrl: string | null; androidUrl: string | null; openUrl: string | null }) {
  const clean = (raw: string) => {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) throw new Error("Use an ordinary HTTPS app link.");
    return url;
  };
  try {
    if (links.iphoneUrl) {
      const url = clean(links.iphoneUrl);
      if (url.hostname !== "apps.apple.com" || !/\/id\d+$/.test(url.pathname)) return false;
    }
    if (links.androidUrl) {
      const url = clean(links.androidUrl);
      if (url.hostname !== "play.google.com" || url.pathname !== "/store/apps/details" ||
        !/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/.test(url.searchParams.get("id") || "") ||
        [...url.searchParams.keys()].some(k => !["id", "hl", "gl"].includes(k))) return false;
    }
    if (links.openUrl) {
      const url = clean(links.openUrl);
      // An ordinary universal/app link, never checkout, an intent or a scheme.
      if (!links.iphoneUrl && !links.androidUrl || url.pathname !== "/open/oldtimehive" || url.search ||
        ["localhost", "127.0.0.1"].includes(url.hostname)) return false;
    }
    return true;
  } catch { return false; }
}
