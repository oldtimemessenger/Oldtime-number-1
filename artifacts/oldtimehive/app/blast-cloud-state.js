import { api, requestCloudApi } from "./store.js";

const snapshots = new Map();
const pendingSaves = new Map();
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(item => stableJson(item) ?? "null").join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .filter(key => value[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function cacheKey(accountId, scope) {
  return `${accountId}:${scope}`;
}

function mapOwnerId(value, fromId, toId) {
  if (value === fromId) return toId;
  if (Array.isArray(value)) return value.map(item => mapOwnerId(item, fromId, toId));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapOwnerId(item, fromId, toId)]));
  }
  return value;
}

function mergeMemoryState(scope, current, legacy) {
  const arrays = scope === "social"
    ? ["friendships", "friendRequests", "posts", "communityMemberships"]
    : ["notes", "chats", "saved"];
  const merged = { ...current, ...legacy };
  for (const key of arrays) {
    const values = [...(current?.[key] || []), ...(legacy?.[key] || [])];
    const identify = item => key === "friendships"
      ? (item.users || []).slice().sort().join(":")
      : key === "communityMemberships"
        ? `${item.userId}:${item.communityId}`
      : key === "saved"
        ? `${item.ownerId}:${item.peerId}:${item.messageId}`
        : item.id;
    const records = new Map();
    for (const item of values) {
      const id = identify(item);
      const previous = records.get(id);
      records.set(id, key === "chats" && previous ? {
        ...previous, ...item,
        messages: [...new Map([...(previous.messages || []), ...(item.messages || [])]
          .map(message => [message.id, message])).values()],
      } : item);
    }
    merged[key] = [...records.values()];
  }
  if (scope === "social") merged.preferences = { ...(current?.preferences || {}), ...(legacy?.preferences || {}) };
  return merged;
}

function localUserId() {
  const id = api.me()?.id;
  if (!id) throw new Error("Sign in to your online account to use Community.");
  return id;
}

function notify() {
  window.dispatchEvent(new Event("blast-cloud-state-changed"));
}

function clearScope(accountId, scope) {
  snapshots.delete(cacheKey(accountId, scope));
}

export function getBlastCloudState(scope, blankState) {
  const accountId = api.cloudAccountId() || "memory:shared-test-runtime";
  const key = cacheKey(accountId, scope);
  let cached = snapshots.get(key);
  if (accountId.startsWith("memory:")) {
    const legacyKey = scope === "social" ? "oldtime-blast-v1" : "oldtime-blast-video-notes-v1";
    let raw = null;
    try { raw = localStorage.getItem(legacyKey); } catch { /* Memory cache remains available. */ }
    if (cached?.legacyRaw !== raw) {
      let legacy = blankState();
      try {
        const parsed = JSON.parse(raw || "null");
        if (parsed?.version === 1) legacy = parsed;
      } catch { /* Non-cloud test/dev access is memory-only; never write a device fallback. */ }
      const state = cached ? mergeMemoryState(scope, cached.data, legacy) : legacy;
      cached = { data: structuredClone(state), revision: 0, legacyRaw: raw };
      snapshots.set(key, cached);
    }
  }
  return cached ? structuredClone(cached.data) : blankState();
}

export async function loadBlastCloudState(scope, {
  blankState,
  legacyKey,
  filterLegacy,
  prepareLegacy,
  removeMigratedLegacy,
} = {}) {
  const accountId = api.cloudAccountId();
  if (!accountId) throw new Error("Sign in to your online account to use Community.");
  const key = cacheKey(accountId, scope);
  // A normal load may have populated memory before recovery runs. Do not let
  // that cache prevent checking an older source or reading a newer revision.

  const result = await requestCloudApi(`/api/blast/state/${encodeURIComponent(scope)}`);
  if (api.cloudAccountId() !== accountId) throw new Error("The signed-in account changed while Community was loading.");
  let data = result.data;
  let revision = Number(result.revision) || 0;
  const localId = localUserId();

  if (legacyKey || !data) {
    const legacy = readLegacy(legacyKey, blankState);
    const owned = filterLegacy(legacy);
    if (hasRecords(owned)) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(owned)));
      const sourceId = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
      // Keep the verified older version on the backend too. A newer cloud
      // edit must not erase the only remaining copy of a legacy attachment.
      const priorRecovery = data?.recoverySources?.[sourceId];
      const prepared = priorRecovery
        ? { data: mapOwnerId(priorRecovery, accountId, localId), oldMediaIds: [] }
        : await prepareLegacy(structuredClone(owned));
      const recovered = mapOwnerId(prepared.data, localId, accountId);
      // Existing server records win collisions; missing legacy records are
      // imported even when this account already has newer cloud content.
      const cloudData = data ? mergeMemoryState(scope, recovered, data) : recovered;
      cloudData.recoverySources = { ...data?.recoverySources, [sourceId]: recovered };
      const saved = await requestCloudApi(`/api/blast/state/${encodeURIComponent(scope)}`, {
        method: "PUT",
        body: { revision, data: cloudData },
      });
      if (api.cloudAccountId() !== accountId) throw new Error("The signed-in account changed while Community was syncing.");
      const verified = await requestCloudApi(`/api/blast/state/${encodeURIComponent(scope)}`);
      if (api.cloudAccountId() !== accountId) throw new Error("The signed-in account changed while Community was verifying.");
      if (stableJson(saved.data) !== stableJson(cloudData) ||
          stableJson(verified.data) !== stableJson(cloudData)) {
        throw new Error("The Community cloud copy did not match the data being transferred. The original is preserved.");
      }
      data = verified.data;
      revision = verified.revision;
      await removeMigratedLegacy?.(legacy, owned, prepared);
    } else {
      data ||= blankState();
    }
  }

  if (api.cloudAccountId() !== accountId) throw new Error("The signed-in account changed while Community was loading.");
  snapshots.set(key, { data: mapOwnerId(data, accountId, localId), revision });
  notify();
  return mapOwnerId(data, accountId, localId);
}

function readLegacy(key, blankState) {
  if (!key) return blankState();
  let value;
  try { value = localStorage.getItem(key); }
  catch { throw new Error("The old Community archive could not be checked. Nothing was changed."); }
  if (!value) return blankState();
  try {
    const parsed = JSON.parse(value);
    if (!parsed || parsed.version !== 1) throw new Error("unsupported");
    return parsed;
  } catch {
    throw new Error("The old Community archive is unreadable. It has been left unchanged.");
  }
}

function hasRecords(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) =>
    key !== "version" && (Array.isArray(item) ? item.length > 0 : item && typeof item === "object" ? Object.keys(item).length > 0 : false));
}

export function saveBlastCloudState(scope, data) {
  const accountId = api.cloudAccountId() || "memory:shared-test-runtime";
  const key = cacheKey(accountId, scope);
  if (accountId.startsWith("memory:")) {
    const current = snapshots.get(key);
    snapshots.set(key, { data: structuredClone(data), revision: (current?.revision || 0) + 1, legacyRaw: current?.legacyRaw ?? null });
    notify();
    return structuredClone(data);
  }
  const previous = pendingSaves.get(key) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    let snapshot = snapshots.get(key);
    if (!snapshot) {
      await loadBlastCloudState(scope, {
        blankState: () => ({ version: 1 }),
        legacyKey: "",
        filterLegacy: value => value,
        prepareLegacy: value => ({ data: value }),
      });
      snapshot = snapshots.get(key);
    }
    const cloudData = mapOwnerId(data, localUserId(), accountId);
    const saved = await requestCloudApi(`/api/blast/state/${encodeURIComponent(scope)}`, {
      method: "PUT",
      body: { revision: snapshot.revision, data: cloudData },
    });
    if (api.cloudAccountId() !== accountId) throw new Error("The signed-in account changed before Community was saved.");
    if (stableJson(saved.data) !== stableJson(cloudData)) {
      throw new Error("The server did not confirm the Community changes.");
    }
    const localData = mapOwnerId(saved.data, accountId, localUserId());
    snapshots.set(key, { data: structuredClone(localData), revision: saved.revision });
    notify();
    return localData;
  });
  pendingSaves.set(key, operation);
  return operation.finally(() => {
    if (pendingSaves.get(key) === operation) pendingSaves.delete(key);
  });
}

export function resetBlastCloudState() {
  snapshots.clear();
  pendingSaves.clear();
}

window.addEventListener("oldtime-data", () => {
  const accountId = api.cloudAccountId();
  for (const key of snapshots.keys()) if (!accountId || !key.startsWith(`${accountId}:`)) snapshots.delete(key);
});
