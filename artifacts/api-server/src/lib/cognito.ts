import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export type CognitoConfig = {
  issuer: string; clientId: string; domain: string; redirectUris: string[]; clientSecret?: string;
};
export type VerifiedCognitoIdentity = {
  issuer: string; subject: string; email: string; displayName: string; expiresAt: number;
};
export type CognitoAuthorization = VerifiedCognitoIdentity & { refreshToken: string };
export class CognitoError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function cognitoConfig(env = process.env): CognitoConfig | null {
  if (env.COGNITO_ENABLED !== "true") return null;
  const region = env.COGNITO_REGION || "";
  const pool = env.COGNITO_USER_POOL_ID || "";
  const clientId = env.COGNITO_CLIENT_ID || "";
  if (!/^[a-z]+(?:-[a-z]+)+-\d+$/.test(region) || !pool.startsWith(`${region}_`) ||
    !/^[a-z0-9-]+_[A-Za-z0-9]+$/.test(pool) || !/^[A-Za-z0-9]{1,128}$/.test(clientId)) {
    throw new CognitoError(503, "Secure sign-in is unavailable. Try again later.");
  }
  let domain: URL;
  let redirectUris: string[];
  try {
    domain = new URL(env.COGNITO_DOMAIN || "");
    if (domain.protocol !== "https:" || domain.username || domain.password ||
      domain.pathname !== "/" || domain.search || domain.hash) throw new Error();
    redirectUris = (env.COGNITO_REDIRECT_URIS || "").split(",").filter(Boolean).map(raw => {
      const url = new URL(raw.trim());
      if ((url.protocol !== "https:" && !(env.NODE_ENV !== "production" &&
        url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) ||
        url.username || url.password || url.hash || url.search) throw new Error();
      return url.href;
    });
    if (!redirectUris.length) throw new Error();
  } catch { throw new CognitoError(503, "Secure sign-in is unavailable. Try again later."); }
  return {
    issuer: `https://cognito-idp.${region}.amazonaws.com/${pool}`,
    clientId, domain: domain.origin, redirectUris,
    ...(env.COGNITO_CLIENT_SECRET ? { clientSecret: env.COGNITO_CLIENT_SECRET } : {}),
  };
}

const keySets = new Map<string, JWTVerifyGetKey>();
function verificationKeys(config: CognitoConfig) {
  let keys = keySets.get(config.issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks.json`),
      { timeoutDuration: 5000, cooldownDuration: 30000 });
    keySets.set(config.issuer, keys);
  }
  return keys;
}

export async function verifyCognitoIdToken(
  token: string, config: CognitoConfig, nonce: string | null, keys = verificationKeys(config), expectedSubject?: string,
): Promise<VerifiedCognitoIdentity> {
  if (!nonce && !expectedSubject) throw new CognitoError(401, "Sign-in could not be verified.");
  let payload;
  try {
    ({ payload } = await jwtVerify(token, keys, {
      issuer: config.issuer, audience: config.clientId, algorithms: ["RS256"],
      requiredClaims: ["sub", "exp", "iat", "email", "email_verified", "token_use", ...(nonce ? ["nonce"] : [])],
      clockTolerance: 5,
    }));
  } catch {
    throw new CognitoError(401, "Sign-in could not be verified. Start again.");
  }
  if (payload.token_use !== "id" || (nonce && payload.nonce !== nonce) ||
    (expectedSubject && payload.sub !== expectedSubject) || payload.email_verified !== true ||
    typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 256 ||
    typeof payload.email !== "string" || payload.email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ||
    typeof payload.iat !== "number" || payload.iat > Date.now() / 1000 + 5 ||
    typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
    throw new CognitoError(401, "A verified email is required to complete sign-in.");
  }
  const email = payload.email.trim().toLowerCase();
  return {
    issuer: config.issuer, subject: payload.sub, email,
    displayName: typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim().slice(0, 60) : email.split("@")[0].slice(0, 60),
    expiresAt: payload.exp * 1000,
  };
}

export async function exchangeCognitoCode(config: CognitoConfig, input: {
  code: string; codeVerifier: string; nonce: string; redirectUri: string;
}) {
  if (!config.redirectUris.includes(input.redirectUri)) {
    throw new CognitoError(400, "The sign-in return address is not allowed.");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code", client_id: config.clientId,
    code: input.code, code_verifier: input.codeVerifier, redirect_uri: input.redirectUri,
  });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (config.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
  }
  let result: Response;
  try {
    result = await fetch(`${config.domain}/oauth2/token`, {
      method: "POST", body, headers, redirect: "error", signal: AbortSignal.timeout(10000),
    });
  } catch { throw new CognitoError(503, "Secure sign-in could not be reached. Try again."); }
  if (!result.ok) throw new CognitoError(result.status >= 500 ? 503 : 401,
    "Sign-in could not be completed. Start again.");
  let data;
  try { data = await result.json(); }
  catch { throw new CognitoError(503, "Secure sign-in returned an invalid response."); }
  if (!data || typeof data !== "object" || !("id_token" in data) || typeof data.id_token !== "string" ||
    !("refresh_token" in data) || typeof data.refresh_token !== "string" || !data.refresh_token) {
    throw new CognitoError(401, "Sign-in could not be verified.");
  }
  return { ...await verifyCognitoIdToken(data.id_token, config, input.nonce), refreshToken: data.refresh_token };
}

export async function refreshCognitoAuthorization(config: CognitoConfig, refreshToken: string, subject: string) {
  const body = new URLSearchParams({
    grant_type: "refresh_token", client_id: config.clientId, refresh_token: refreshToken,
  });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (config.clientSecret) headers.Authorization =
    `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
  let response;
  try {
    response = await fetch(`${config.domain}/oauth2/token`, {
      method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(10000),
    });
  } catch { throw new CognitoError(503, "Secure sign-in could not be reached. Try again."); }
  if (!response.ok) throw new CognitoError(response.status >= 500 || response.status === 429 ? 503 : 401,
    "Your secure session could not be renewed. Sign in again.");
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new CognitoError(503, "Secure sign-in returned an invalid response."); }
  if (!data || typeof data !== "object" || !("id_token" in data) || typeof data.id_token !== "string") {
    throw new CognitoError(503, "Secure sign-in returned an invalid response.");
  }
  const identity = await verifyCognitoIdToken(data.id_token, config, null, verificationKeys(config), subject);
  return { ...identity, refreshToken: "refresh_token" in data &&
    typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : refreshToken };
}
