import { verifyAndRecordStoreMembership, type StoreVerifier } from "./store-membership";
import { BLUE_BADGE_PRODUCT_IDS, parseRevenueCatMembership } from "./revenuecat-membership-parser";

export class RevenueCatVerificationError extends Error {
  constructor(
    message: string,
    readonly status: 502 | 503,
    readonly publicMessage: string,
  ) {
    super(message);
    this.name = "RevenueCatVerificationError";
  }
}

export function isRevenueCatBillingConfigured() {
  return Boolean(process.env.REVENUECAT_SECRET_API_KEY);
}

export async function refreshRevenueCatMembership(userId: string) {
  const apiKey = process.env.REVENUECAT_SECRET_API_KEY;
  if (!apiKey) {
    throw new RevenueCatVerificationError(
      "RevenueCat server verification is not configured.",
      503,
      "Store billing is being prepared. Please try again later.",
    );
  }

  let response: Response;
  try {
    response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new RevenueCatVerificationError(
      error instanceof Error ? error.message : "RevenueCat request failed.",
      502,
      "Store verification is temporarily unavailable. Please try again.",
    );
  }

  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 ? 503 : 502;
    throw new RevenueCatVerificationError(
      `RevenueCat returned HTTP ${response.status}.`,
      status,
      status === 503
        ? "Store billing is being prepared. Please try again later."
        : "Store verification is temporarily unavailable. Please try again.",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new RevenueCatVerificationError(
      "RevenueCat returned an unreadable response.",
      502,
      "Store verification is temporarily unavailable. Please try again.",
    );
  }

  const parsed = parseRevenueCatMembership(userId, payload);
  if (!parsed) return false;

  const verifier: StoreVerifier = {
    store: parsed.store,
    allowedProducts: BLUE_BADGE_PRODUCT_IDS,
    async verify(opaqueProof, expectedAccountId) {
      if (opaqueProof !== userId || expectedAccountId !== userId) {
        throw new Error("RevenueCat account verification did not match the signed-in Oldtime account.");
      }
      return parsed.evidence;
    },
  };

  await verifyAndRecordStoreMembership(userId, userId, verifier);
  return true;
}
