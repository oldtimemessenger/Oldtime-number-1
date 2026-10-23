// IndexedDB is retained only as a read/delete source for verified migration.
let database;
const cloudBlobReferences = new WeakMap();
function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("Draft storage is unavailable in this browser."));
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open("oldtime-creative-drafts", 1);
    let createdDuringRead = false;
    request.onupgradeneeded = event => {
      if (event.oldVersion === 0) {
        createdDuringRead = true;
        return;
      }
      if (!request.result.objectStoreNames.contains("drafts")) request.result.createObjectStore("drafts");
    };
    request.onsuccess = () => {
      const db = request.result;
      if (createdDuringRead) {
        db.close();
        const cleanup = indexedDB.deleteDatabase("oldtime-creative-drafts");
        cleanup.onsuccess = cleanup.onerror = cleanup.onblocked = () => resolve(null);
        return;
      }
      db.onversionchange = () => { db.close(); database = null; };
      resolve(db);
    };
    request.onerror = request.onblocked = () => {
      database = null;
      reject(new Error("Couldn’t open draft storage. Close other Oldtime tabs and try again."));
    };
  });
  return database;
}
async function operation(ownerId, context, mode, action) {
  if (!ownerId || !context) throw new Error("Sign in before saving a draft.");
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("drafts", mode);
    const request = action(transaction.objectStore("drafts"), JSON.stringify([ownerId, context]));
    transaction.oncomplete = () => resolve(request.result ?? null);
    transaction.onerror = transaction.onabort = () =>
      reject(new Error("Couldn’t read the legacy draft. Your edit is still open."));
  });
}
async function legacyDraftDatabaseExists() {
  if (!globalThis.indexedDB || typeof indexedDB.databases !== "function") return null;
  try {
    return (await indexedDB.databases()).some(databaseInfo => databaseInfo.name === "oldtime-creative-drafts");
  } catch {
    return null;
  }
}
async function readLegacyDraft(ownerId, context) {
  if (await legacyDraftDatabaseExists() === false) return null;
  return operation(ownerId, context, "readonly", (store, key) => store.get(key)).catch(() => null);
}
async function deleteLegacyDraft(ownerId, context) {
  if (await legacyDraftDatabaseExists() === false) return;
  await operation(ownerId, context, "readwrite", (store, key) => store.delete(key)).catch(() => {});
}
function mapMedia(value, replace) {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "media" && typeof item === "string") value[key] = replace(item);
    else mapMedia(item, replace);
  }
}
export function prepareCreativeDraft(project, state, blobs) {
  const snapshot = structuredClone({ project, state });
  const media = new Map();
  mapMedia(snapshot, value => {
    if (value === "live-camera") throw new Error("Capture your photo or stop recording before saving.");
    if (value.startsWith("blob:")) {
      const blob = blobs.get(value);
      if (!(blob instanceof Blob) || !blob.size) throw new Error("This media is unavailable. Upload it again before saving.");
      media.set(value, blob);
    }
    return value;
  });
  return { version: 1, ...snapshot, media: [...media], savedAt: Date.now() };
}
export function restoreCreativeDraft(draft, rememberBlob) {
  if (draft?.version !== 1 || !draft.project || !Array.isArray(draft.media)) throw new Error("This draft cannot be opened.");
  const snapshot = structuredClone({ project: draft.project, state: draft.state || {} });
  const replacements = new Map(draft.media.map(([key, blob]) => {
    if (!(blob instanceof Blob) || !blob.size) throw new Error("The draft’s media is unavailable.");
    return [key, rememberBlob(blob)];
  }));
  mapMedia(snapshot, value => {
    if (value.startsWith("blob:") && !replacements.has(value)) throw new Error("The draft’s media is unavailable.");
    return replacements.get(value) || value;
  });
  return snapshot;
}
function collectMediaReferences(value, output = new Set()) {
  if (typeof value === "string" && /^oldtime-media:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) output.add(value);
  else if (Array.isArray(value)) value.forEach(item => collectMediaReferences(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach(item => collectMediaReferences(item, output));
  return output;
}
function containsUnuploadedMedia(value) {
  if (typeof value === "string") return /^blob:/i.test(value) || /^data:(?:image|video|audio)\//i.test(value);
  if (Array.isArray(value)) return value.some(containsUnuploadedMedia);
  if (value && typeof value === "object") return Object.values(value).some(containsUnuploadedMedia);
  return false;
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export async function prepareCloudCreativeDraft(draft, uploadMedia) {
  if (draft?.version !== 1 || !draft.project || !Array.isArray(draft.media)) throw new Error("This draft cannot be saved.");
  const replacements = new Map();
  for (const [key, blob] of draft.media) {
    if (!(blob instanceof Blob) || !blob.size) throw new Error("The draft’s media is unavailable.");
    let reference = cloudBlobReferences.get(blob);
    if (!reference) {
      reference = await uploadMedia(blob);
      cloudBlobReferences.set(blob, reference);
    }
    replacements.set(key, reference);
  }
  const snapshot = structuredClone({ project: draft.project, state: draft.state || {} });
  mapMedia(snapshot, value => {
    if (replacements.has(value)) return replacements.get(value);
    if (/^blob:/i.test(value)) throw new Error("Upload this media again before saving the draft.");
    return value;
  });
  if (containsUnuploadedMedia(snapshot)) throw new Error("Upload this media again before saving the draft.");
  const media = [...collectMediaReferences(snapshot)];
  if (media.length > 100) throw new Error("This draft uses too many media files.");
  return { version: 1, ...snapshot, media, savedAt: Date.now() };
}
async function cloudOwner(ownerId) {
  if (typeof window === "undefined") throw new Error("Sign in to your account to save or open cloud drafts.");
  const { api, requestCloudApi } = await import("./store.js");
  if (!api.cloudAccountId() || api.me()?.id !== ownerId) {
    throw new Error("Sign in to your account to save or open cloud drafts.");
  }
  return { api, requestCloudApi };
}
const draftPath = context => `/api/creative/drafts/${encodeURIComponent(context)}`;
export async function creativeRecoverySignature(draft, keepReferences = new Set()) {
  const replacements = new Map(await Promise.all((draft.media || []).map(async ([key, blob]) => {
    if (!(blob instanceof Blob) || !blob.size) throw new Error("A recovery draft has unavailable media.");
    const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [key, `sha256:${blob.type}:${blob.size}:${[...new Uint8Array(hash)].join(",")}`];
  })));
  const snapshot = structuredClone({ project: draft.project, state: draft.state || {} });
  mapMedia(snapshot, value => keepReferences.has(value) ? value : replacements.get(value) || value);
  return stableJson(snapshot);
}
export async function creativeRecoveryContext(context, draft) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson({
    context, content: await creativeRecoverySignature(draft),
    savedAt: draft.savedAt,
  })));
  return `recovered-${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
export async function saveCreativeDraft(ownerId, context, draft) {
  const { requestCloudApi } = await cloudOwner(ownerId);
  const { putLocalMedia } = await import("./local-media.js");
  const cloudDraft = await prepareCloudCreativeDraft(draft, putLocalMedia);
  await requestCloudApi(draftPath(context), { method: "PUT", body: cloudDraft });
  const confirmed = await requestCloudApi(draftPath(context));
  if (stableJson(confirmed?.draft) !== stableJson(cloudDraft)) {
    throw new Error("The server did not confirm the saved draft. Your open edit is unchanged.");
  }
  await deleteLegacyDraft(ownerId, context);
  return true;
}
export async function loadCreativeDraft(ownerId, context) {
  const { requestCloudApi } = await cloudOwner(ownerId);
  let result = await requestCloudApi(draftPath(context));
  if (!result?.draft) {
    const legacy = await readLegacyDraft(ownerId, context);
    if (!legacy) return null;
    await saveCreativeDraft(ownerId, context, legacy);
    result = await requestCloudApi(draftPath(context));
  }
  const stored = result?.draft;
  if (!stored) return null;
  const media = await Promise.all((stored.media || []).map(async reference => {
    const id = reference.slice("oldtime-media:".length);
    const blob = await requestCloudApi(`/api/media/${encodeURIComponent(id)}`, { responseType: "blob" });
    if (!(blob instanceof Blob) || !blob.size) throw new Error("The draft’s cloud media is unavailable.");
    cloudBlobReferences.set(blob, reference);
    return [reference, blob];
  }));
  return { ...stored, media };
}
export async function migrateLegacyCreativeDrafts(ownerId) {
  const { requestCloudApi } = await cloudOwner(ownerId);
  if (await legacyDraftDatabaseExists() === false) {
    return { checked: 0, confirmed: 0, migrated: 0, pending: 0, existing: 0 };
  }
  const db = await openDatabase();
  if (!db) return { checked: 0, confirmed: 0, migrated: 0, pending: 0, existing: 0 };
  const contexts = await new Promise((resolve, reject) => {
    const transaction = db.transaction("drafts", "readonly");
    const request = transaction.objectStore("drafts").getAllKeys();
    request.onsuccess = () => {
      const found = [];
      for (const key of request.result || []) {
        try {
          const parsed = JSON.parse(String(key));
          if (Array.isArray(parsed) && parsed[0] === ownerId && typeof parsed[1] === "string" && parsed[1]) {
            found.push(parsed[1]);
          }
        } catch { /* Ignore unrelated or malformed legacy keys. */ }
      }
      resolve([...new Set(found)]);
    };
    request.onerror = transaction.onerror = transaction.onabort = () =>
      reject(new Error("Couldn’t list legacy editor drafts. The original drafts were kept."));
  });
  const report = { checked: 0, confirmed: 0, migrated: 0, pending: 0, existing: 0, errors: [] };
  for (const context of contexts) {
    try {
      const legacy = await operation(ownerId, context, "readonly", (store, key) => store.get(key));
      if (!legacy) continue;
      report.checked += 1;
      const cloud = await requestCloudApi(draftPath(context));
      if (cloud?.draft) {
        const recoveryContext = await creativeRecoveryContext(context, legacy);
        const existingRecovery = await requestCloudApi(draftPath(recoveryContext));
        if (!existingRecovery?.draft) {
          await saveCreativeDraft(ownerId, recoveryContext, legacy);
        } else {
          // Verify its referenced bytes before retiring the older source.
          const recovered = await loadCreativeDraft(ownerId, recoveryContext);
          const keepReferences = collectMediaReferences({ project: legacy.project, state: legacy.state });
          if (await creativeRecoverySignature(legacy, keepReferences) !==
              await creativeRecoverySignature(recovered, keepReferences)) {
            throw new Error("The recovered draft does not match its original.");
          }
        }
        await deleteLegacyDraft(ownerId, context);
        report.existing += 1;
        report.confirmed += 1;
        continue;
      }
      await saveCreativeDraft(ownerId, context, legacy);
      report.migrated += 1;
      report.confirmed += 1;
    } catch (error) {
      report.pending += 1;
      report.errors.push({ context, message: error?.message || "Draft transfer could not be verified." });
    }
  }
  return report;
}
export async function deleteCreativeDraft(ownerId, context) {
  if (typeof window !== "undefined") {
    const { api, requestCloudApi } = await import("./store.js");
    if (api.cloudAccountId() && api.me()?.id === ownerId) {
      await requestCloudApi(draftPath(context), { method: "DELETE" });
    }
  }
  await deleteLegacyDraft(ownerId, context);
  return true;
}
