import { api } from "./store.js";
import { cloudApiUrl } from "./api-origin.js";

const PENDING_KEY = "oldtime-cognito-pkce-v1";
const MAX_AGE_MS = 10 * 60 * 1000;
let configPromise;

export function getCognitoConfiguration() {
  if (!configPromise) configPromise = fetch(cloudApiUrl("/api/auth/cognito/config"), { cache: "no-store" })
    .then(async response => {
      let config;
      try { config = await response.json(); }
      catch { throw new Error("Secure sign-in is unavailable. You can use your existing login."); }
      if (!response.ok) throw new Error(config.error || "Secure sign-in is unavailable.");
      if (!config.enabled) return config;
      if (typeof config.clientId !== "string" || typeof config.authorizationEndpoint !== "string" ||
        typeof config.logoutEndpoint !== "string" || !Array.isArray(config.redirectUris)) {
        throw new Error("Secure sign-in is unavailable.");
      }
      return config;
    }).catch(error => { configPromise = null; throw error; });
  return configPromise;
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomString() { return base64url(crypto.getRandomValues(new Uint8Array(32))); }
function returnAddress() { return new URL(import.meta.env.BASE_URL, location.origin).href; }

export async function beginCognitoSignIn(intent = "login", config = null) {
  const accountId = api.cloudAccountId();
  config ||= await getCognitoConfiguration();
  if (api.cloudAccountId() !== accountId) throw new Error("Your signed-in account changed. Start again.");
  const redirectUri = returnAddress();
  if (!config.enabled || !config.redirectUris.includes(redirectUri)) {
    throw new Error("Secure sign-in is not available at this address. Use your existing login.");
  }
  if (intent === "link" && !api.cloudAccountId()) throw new Error("Log in to your existing account first.");
  const codeVerifier = randomString(), state = randomString(), nonce = randomString();
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier))));
  if (api.cloudAccountId() !== accountId) throw new Error("Your signed-in account changed. Start again.");
  const pending = { codeVerifier, state, nonce, redirectUri, intent,
    accountId, createdAt: Date.now() };
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending)); }
  catch { throw new Error("Sign-in could not be saved. Check your browser storage settings."); }
  const url = new URL(config.authorizationEndpoint);
  url.search = new URLSearchParams({ client_id: config.clientId, response_type: "code",
    scope: config.scope || "openid email", redirect_uri: redirectUri,
    code_challenge_method: "S256", code_challenge: challenge, state, nonce }).toString();
  location.assign(url.href);
}

export async function completeCognitoSignIn() {
  const url = new URL(location.href);
  if (!url.searchParams.has("state") ||
    (!url.searchParams.has("code") && !url.searchParams.has("error"))) return null;
  let pending;
  try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null"); }
  catch { /* report invalid pending state below */ }
  const state = url.searchParams.get("state"), code = url.searchParams.get("code");
  const failed = url.searchParams.has("error");
  for (const name of ["code", "state", "error", "error_description"]) url.searchParams.delete(name);
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  sessionStorage.removeItem(PENDING_KEY);
  if (!pending || pending.state !== state || !Number.isFinite(pending.createdAt) ||
    Date.now() - pending.createdAt > MAX_AGE_MS || pending.createdAt > Date.now() ||
    pending.redirectUri !== returnAddress() || !["login", "link"].includes(pending.intent)) {
    throw new Error("This sign-in attempt expired or could not be verified. Start again.");
  }
  if (failed || !code) throw new Error("Sign-in was not completed. You can try again.");
  return api.finishCognitoSignIn({ code, codeVerifier: pending.codeVerifier, nonce: pending.nonce,
    redirectUri: pending.redirectUri, intent: pending.intent }, pending.accountId);
}

export async function mountCognitoAction(container, { intent = "login", onError = () => {}, connected = false } = {}) {
  if (!container) return;
  try {
    const config = await getCognitoConfiguration();
    if (!container.isConnected || !config.enabled) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn primary";
    button.dataset.testid = intent === "link" ? "button-connect-secure-sign-in" : "button-cognito-sign-in";
    button.textContent = connected ? "Secure sign-in connected" :
      intent === "link" ? "Connect secure sign-in" : "Continue with secure sign-in";
    button.disabled = connected;
    button.onclick = async () => {
      button.disabled = true;
      try { await beginCognitoSignIn(intent, config); }
      catch (error) { if (button.isConnected) button.disabled = false; onError(error.message); }
    };
    container.replaceChildren(button);
  } catch (error) { if (container.isConnected) onError(error.message); }
}

export function logoutAccount() {
  const provider = api.authProvider();
  api.logout();
  if (provider !== "cognito") return;
  void getCognitoConfiguration().then(config => {
    if (api.me() || !config.enabled) return;
    const redirectUri = returnAddress();
    if (!config.redirectUris.includes(redirectUri)) return;
    const url = new URL(config.logoutEndpoint);
    url.search = new URLSearchParams({ client_id: config.clientId, logout_uri: redirectUri }).toString();
    location.assign(url.href);
  }).catch(() => { /* local and API sessions have already been ended */ });
}
