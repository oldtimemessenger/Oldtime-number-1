import assert from "node:assert/strict";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { cognitoConfig, exchangeCognitoCode, refreshCognitoAuthorization, verifyCognitoIdToken } from "../src/lib/cognito";

const env = {
  COGNITO_ENABLED: "true", COGNITO_REGION: "us-east-2", COGNITO_USER_POOL_ID: "us-east-2_TestPool",
  COGNITO_CLIENT_ID: "testclient", COGNITO_DOMAIN: "https://test.auth.us-east-2.amazoncognito.com",
  COGNITO_REDIRECT_URIS: "https://oldtime.example/", NODE_ENV: "production",
};
const config = cognitoConfig(env)!;
const nonce = "n".repeat(43);
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = { ...await exportJWK(publicKey), kid: "test-key", alg: "RS256" };
const keys = createLocalJWKSet({ keys: [jwk] });
async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({
    iss: config.issuer, aud: config.clientId, sub: "verified-subject",
    exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000),
    nonce, email: "Member@example.test", email_verified: true, token_use: "id", name: "Member",
    ...overrides,
  }).setProtectedHeader({ alg: "RS256", kid: jwk.kid }).sign(privateKey);
}

test("Cognito is opt-in and requires an HTTPS domain and explicit callback allowlist", () => {
  assert.equal(cognitoConfig({}), null);
  assert.deepEqual(config.redirectUris, ["https://oldtime.example/"]);
  for (const override of [
    { COGNITO_REGION: "../outside" }, { COGNITO_USER_POOL_ID: "us-west-2_OtherPool" },
    { COGNITO_DOMAIN: "http://test.example" }, { COGNITO_DOMAIN: "https://user:password@test.example" },
    { COGNITO_DOMAIN: "https://test.example/another-path" }, { COGNITO_REDIRECT_URIS: "" },
    { COGNITO_REDIRECT_URIS: "http://not-local.example/" },
    { COGNITO_REDIRECT_URIS: "https://oldtime.example/?next=other" },
  ]) assert.throws(() => cognitoConfig({ ...env, ...override }), /unavailable/);
});

test("native-app callback URLs are no longer accepted", () => {
  assert.deepEqual(cognitoConfig({ ...env, COGNITO_NATIVE_REDIRECT_URIS: "oldtime-mobile://auth" })!.redirectUris,
    ["https://oldtime.example/"]);
  for (const callback of ["javascript:alert(1)", "exp://example/auth", "oldtime-mobile://auth",
    "oldtime-mobile://auth?next=evil", "oldtime-mobile://evil"]) {
    assert.throws(() => cognitoConfig({ ...env, COGNITO_REDIRECT_URIS: callback }), /unavailable/);
  }
  assert.throws(() => cognitoConfig({ ...env, COGNITO_REDIRECT_URIS: "oldtime-mobile://auth" }), /unavailable/);
});

test("a signed Cognito ID token binds issuer, client, subject, nonce, verified email and expiration", async () => {
  const verified = await verifyCognitoIdToken(await token(), config, nonce, keys);
  assert.equal(verified.issuer, config.issuer);
  assert.equal(verified.subject, "verified-subject");
  assert.equal(verified.email, "member@example.test");
  assert.equal(verified.displayName, "Member");
  assert.ok(verified.expiresAt > Date.now());
});
for (const [name, claims] of Object.entries({
  "wrong pool": { iss: "https://another-issuer.example" },
  "wrong client": { aud: "another-client" },
  "wrong nonce": { nonce: "other-nonce" },
  "access token instead of ID token": { token_use: "access" },
  "unverified email": { email_verified: false },
  "non-boolean verification": { email_verified: "true" },
  "invalid email": { email: "not-an-email" },
  "missing subject": { sub: undefined },
  "missing nonce": { nonce: undefined },
  "missing expiration": { exp: undefined },
  "expired token": { exp: Math.floor(Date.now() / 1000) - 10 },
  "future issued-at": { iat: Math.floor(Date.now() / 1000) + 60 },
})) {
  test(`Cognito rejects ${name}`, async () => {
    await assert.rejects(verifyCognitoIdToken(await token(claims), config, nonce, keys), error =>
      error instanceof Error && "status" in error && error.status === 401);
  });
}
test("Cognito rejects tokens signed by a different key or algorithm", async () => {
  const other = await generateKeyPair("RS256");
  const forged = await new SignJWT({ sub: "fake" }).setProtectedHeader({ alg: "RS256", kid: jwk.kid }).sign(other.privateKey);
  await assert.rejects(verifyCognitoIdToken(forged, config, nonce, keys));
  const symmetric = await new SignJWT({ sub: "fake" }).setProtectedHeader({ alg: "HS256", kid: jwk.kid })
    .sign(new TextEncoder().encode("not-a-valid-cognito-signature-key!"));
  await assert.rejects(verifyCognitoIdToken(symmetric, config, nonce, keys));
});
test("refreshed ID tokens bind the original subject even when a refresh response has no nonce", async () => {
  const signed = await token({ nonce: undefined });
  const verified = await verifyCognitoIdToken(signed, config, null, keys, "verified-subject");
  assert.equal(verified.subject, "verified-subject");
  await assert.rejects(verifyCognitoIdToken(signed, config, null, keys, "different-subject"));
  await assert.rejects(verifyCognitoIdToken(signed, config, null, keys));
});
test("code exchange rejects foreign callback URLs before sending any request", async t => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { assert.fail("A disallowed callback must not contact a provider"); };
  t.after(() => { globalThis.fetch = original; });
  await assert.rejects(exchangeCognitoCode(config, { code: "fixture", codeVerifier: "v".repeat(43),
    nonce, redirectUri: "https://attacker.example/" }), /not allowed/);
});
test("code exchange sends PKCE and verifies the returned signed token against JWKS", async t => {
  const original = globalThis.fetch;
  const signed = await token();
  let tokenRequests = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url) === `${config.issuer}/.well-known/jwks.json`) {
      return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Content-Type": "application/json" } });
    }
    assert.equal(String(url), `${config.domain}/oauth2/token`);
    assert.equal(options?.method, "POST");
    assert.equal(options?.redirect, "error");
    const body = new URLSearchParams(String(options?.body));
    assert.equal(body.get("code_verifier"), "v".repeat(43));
    assert.equal(body.get("redirect_uri"), config.redirectUris[0]);
    assert.equal(body.get("client_id"), config.clientId);
    tokenRequests++;
    return new Response(JSON.stringify({ id_token: signed, refresh_token: "fixture-refresh-token" }));
  };
  t.after(() => { globalThis.fetch = original; });
  const identity = await exchangeCognitoCode(config, { code: "fixture", codeVerifier: "v".repeat(43),
    nonce, redirectUri: config.redirectUris[0] });
  assert.equal(identity.subject, "verified-subject");
  assert.equal(tokenRequests, 1);
});
test("refresh exchange verifies subject ownership and distinguishes revocation from temporary provider failure", async t => {
  const original = globalThis.fetch;
  let status = 200;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), `${config.domain}/oauth2/token`);
    const body = new URLSearchParams(String(options?.body));
    assert.equal(body.get("grant_type"), "refresh_token");
    assert.equal(body.get("refresh_token"), "fixture-refresh-token");
    if (status !== 200) return new Response("{}", { status });
    return new Response(JSON.stringify({ id_token: await token({ nonce: undefined }), refresh_token: "rotated-fixture" }));
  };
  t.after(() => { globalThis.fetch = original; });
  const identity = await refreshCognitoAuthorization(config, "fixture-refresh-token", "verified-subject");
  assert.equal(identity.refreshToken, "rotated-fixture");
  await assert.rejects(refreshCognitoAuthorization(config, "fixture-refresh-token", "another-subject"));
  for (const code of [400, 429, 500]) {
    status = code;
    await assert.rejects(refreshCognitoAuthorization(config, "fixture-refresh-token", "verified-subject"), error =>
      error instanceof Error && "status" in error && error.status === (code === 400 ? 401 : 503));
  }
});
