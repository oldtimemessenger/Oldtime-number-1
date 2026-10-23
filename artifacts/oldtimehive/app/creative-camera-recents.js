// Camera recents are stored in the authenticated creative-drafts API. IndexedDB
// is retained only as a read/delete source for verified legacy transfers.
export const RECENT_PHOTO_LIMIT = 24;
export const RECENT_BYTE_LIMIT = 64 * 1024 * 1024;
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const RECENTS_CONTEXT = "camera-recents";
let database;
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(item => stableJson(item) ?? "null").join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .filter(key => value[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function openDatabase() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open("oldtime-camera-recents", 1);
    let created = false;
    request.onupgradeneeded = event => { created = event.oldVersion === 0; };
    request.onsuccess = () => {
      const db = request.result;
      if (created) {
        db.close();
        const deletion = indexedDB.deleteDatabase("oldtime-camera-recents");
        deletion.onsuccess = deletion.onerror = deletion.onblocked = () => resolve(null);
        return;
      }
      if (!db.objectStoreNames.contains("photos")) {
        db.close();
        database = null;
        reject(new Error("The legacy recent-photo database is invalid."));
        return;
      }
      db.onversionchange = () => { db.close(); database = null; };
      resolve(db);
    };
    request.onerror = request.onblocked = () => {
      database = null; reject(new Error("Couldn’t open recent-photo storage."));
    };
  });
  return database;
}
export function boundedRecentPhotos(rows, ownerId, max = RECENT_PHOTO_LIMIT, bytes = RECENT_BYTE_LIMIT) {
  let used = 0;
  return rows.filter(row => row.ownerId === ownerId)
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    .filter(row => {
      const size = row.blob.size + row.thumbnail.size;
      if (used + size > bytes) return false;
      used += size; return true;
    }).slice(0, max);
}
async function legacyTransaction(ownerId) {
  if (!ownerId) throw new Error("Recent photos are unavailable until you sign in to your online account.");
  const db = await openDatabase();
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction("photos", "readonly");
    const store = tx.objectStore("photos");
    const request = store.index("ownerId").getAll(ownerId);
    let result = [];
    request.onsuccess = () => {
      try {
        result = request.result.filter(row => row.ownerId === ownerId);
      } catch { tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(new Error("Couldn’t read the legacy recent-photo transfer source."));
  });
}
const legacyPhotos = ownerId => legacyTransaction(ownerId);

async function retireLegacyPhoto(ownerId, original) {
  const db = await openDatabase();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction("photos", "readwrite");
    const store = tx.objectStore("photos");
    const request = store.get(original.id);
    request.onsuccess = () => {
      const row = request.result;
      if (row && (row.ownerId !== ownerId || row.createdAt !== original.createdAt ||
          row.blob?.size !== original.blob.size || row.hash !== original.hash)) {
        tx.abort(); return;
      }
      if (row) store.delete(original.id);
    };
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(new Error("The older photo changed; its original was kept."));
  });
}

// This is recovery, not the removed Recents UI. Preserve every original photo
// separately instead of applying the old display/count/thumbnail byte limits.
export async function migrateLegacyCameraPhotos(ownerId) {
  const { api, requestCloudApi } = await cloudClient(ownerId);
  const accountId = api.cloudAccountId();
  const request = (...args) => {
    if (api.cloudAccountId() !== accountId || api.me()?.id !== ownerId) {
      throw new Error("The signed-in account changed during photo recovery.");
    }
    return requestCloudApi(...args);
  };
  const rows = await legacyPhotos(ownerId);
  const report = { checked: rows.length, confirmed: 0, pending: 0, errors: [] };
  for (const row of rows) {
    try {
      if (!(row.blob instanceof Blob) || !row.blob.size) throw new Error("The older photo is unavailable.");
      const hash = await digest(row.blob);
      const path = `/api/creative/drafts/camera-recovery-${hash}`;
      let stored = (await request(path))?.draft;
      if (!stored) {
        const { putLocalMedia } = await import("./local-media.js");
        // Check ownership immediately before starting the upload as well.
        if (api.cloudAccountId() !== accountId) throw new Error("The signed-in account changed.");
        const reference = await putLocalMedia(row.blob);
        await verifyMedia(request, reference, hash, row.blob.size);
        const next = {
          version: 1, project: { type: "recovered-camera-photo" },
          state: { hash, size: row.blob.size, createdAt: row.createdAt },
          media: [reference], savedAt: Number.isFinite(row.createdAt) ? row.createdAt : Date.now(),
        };
        await request(path, { method: "PUT", body: next });
        stored = (await request(path))?.draft;
        if (stableJson(stored) !== stableJson(next)) throw new Error("The cloud photo was not confirmed.");
      }
      if (stored.project?.type !== "recovered-camera-photo" || stored.state?.hash !== hash ||
          stored.state?.size !== row.blob.size || stored.media?.length !== 1) {
        throw new Error("The recovered photo does not match its original.");
      }
      await verifyMedia(request, stored.media[0], hash, row.blob.size);
      if (api.cloudAccountId() !== accountId) throw new Error("The signed-in account changed.");
      await retireLegacyPhoto(ownerId, row);
      report.confirmed++;
    } catch (error) {
      report.pending++;
      report.errors.push(error?.message || "The older photo could not be confirmed.");
    }
  }
  return report;
}

async function cloudClient(ownerId) {
  if (!ownerId) throw new Error("Sign in to your online account to view recent photos.");
  if (typeof window === "undefined") throw new Error("Recent photos are unavailable outside the app.");
  const { api, requestCloudApi } = await import("./store.js");
  if (!api.cloudAccountId() || api.me()?.id !== ownerId) {
    throw new Error("Recent photos are unavailable until you sign in to your online account.");
  }
  return { api, requestCloudApi };
}

function mediaId(reference) {
  const match = /^oldtime-media:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(String(reference || ""));
  if (!match) throw new Error("A recent photo has an invalid cloud reference.");
  return match[1];
}

async function digest(blob) {
  const result = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, "0")).join("");
}

function manifest(entries, legacyTransferred = false) {
  return {
    version: 1,
    project: { type: "camera-recents" },
    state: { entries, legacyTransferred },
    media: [...new Set(entries.map(entry => entry.media))],
    savedAt: Date.now(),
  };
}

async function loadCloudManifest(requestCloudApi) {
  const result = await requestCloudApi(`/api/creative/drafts/${RECENTS_CONTEXT}`);
  const draft = result?.draft;
  if (!draft) return null;
  if (draft.version !== 1 || draft.project?.type !== "camera-recents" ||
      !Array.isArray(draft.state?.entries) || !Array.isArray(draft.media)) {
    throw new Error("The cloud recent-photo list could not be verified.");
  }
  return draft;
}

async function verifyMedia(requestCloudApi, reference, expectedHash, expectedSize) {
  const blob = await requestCloudApi(`/api/media/${encodeURIComponent(mediaId(reference))}`, { responseType: "blob" });
  if (!(blob instanceof Blob) || !blob.size || blob.size !== expectedSize || await digest(blob) !== expectedHash) {
    throw new Error("A cloud recent photo failed verification. The saved copy was left unchanged.");
  }
  return blob;
}

async function commitManifest(requestCloudApi, next) {
  const path = `/api/creative/drafts/${RECENTS_CONTEXT}`;
  await requestCloudApi(path, { method: "PUT", body: next });
  const confirmed = await loadCloudManifest(requestCloudApi);
  if (stableJson(confirmed) !== stableJson(next)) {
    throw new Error("The server did not confirm the recent-photo list.");
  }
  return confirmed;
}

async function materialize(ownerId, draft, requestCloudApi) {
  const entries = draft.state.entries;
  if (entries.length > RECENT_PHOTO_LIMIT) throw new Error("The cloud recent-photo list exceeds its limit.");
  const entryMedia = new Set(entries.map(entry => entry?.media));
  if (entryMedia.size !== draft.media.length || draft.media.some(reference => !entryMedia.has(reference))) {
    throw new Error("The cloud recent-photo list has unmatched media references.");
  }
  const rows = [];
  for (const entry of entries) {
    if (!entry || !/^[a-f0-9]{64}$/i.test(entry.hash) || !Number.isFinite(entry.createdAt) ||
        !Number.isInteger(entry.size) || entry.size <= 0 || entry.size > MAX_PHOTO_BYTES ||
        !draft.media.includes(entry.media)) {
      throw new Error("The cloud recent-photo list contains invalid data.");
    }
    const blob = await verifyMedia(requestCloudApi, entry.media, entry.hash, entry.size);
    const prepared = await prepareRecentPhoto(blob);
    rows.push({
      id: `${ownerId}:${entry.hash}`, ownerId, hash: entry.hash,
      createdAt: entry.createdAt, blob, thumbnail: prepared.thumbnail, reference: entry.media,
    });
  }
  return boundedRecentPhotos(rows, ownerId);
}

async function migrateLegacyPhotos(ownerId, requestCloudApi) {
  const allLegacy = await legacyPhotos(ownerId);
  const legacy = boundedRecentPhotos(allLegacy, ownerId);
  if (!legacy.length) return [];
  const { putLocalMedia, deleteLocalMedia } = await import("./local-media.js");
  const uploaded = [];
  const entries = [];
  let committed = false;
  try {
    for (const row of legacy) {
      const prepared = await prepareRecentPhoto(row.blob);
      const reference = await putLocalMedia(row.blob);
      uploaded.push(reference);
      await verifyMedia(requestCloudApi, reference, prepared.hash, row.blob.size);
      entries.push({
        hash: prepared.hash, createdAt: row.createdAt,
        size: row.blob.size, media: reference,
      });
    }
    const next = manifest(entries, true);
    const confirmed = await commitManifest(requestCloudApi, next);
    committed = true;
    const rows = await materialize(ownerId, confirmed, requestCloudApi);
    for (const row of legacy) await retireLegacyPhoto(ownerId, row);
    return rows;
  } catch (error) {
    if (!committed) {
      await Promise.all(uploaded.map(reference => deleteLocalMedia(reference).catch(() => {})));
    }
    throw error;
  }
}

export async function loadRecentPhotos(ownerId) {
  const { requestCloudApi } = await cloudClient(ownerId);
  const draft = await loadCloudManifest(requestCloudApi);
  if (draft) {
    const rows = await materialize(ownerId, draft, requestCloudApi);
    // Other older photos may still need recovery; never clear the entire
    // source just because this bounded display manifest was transferred.
    return rows;
  }
  return migrateLegacyPhotos(ownerId, requestCloudApi);
}
export async function prepareRecentPhoto(blob) {
  if (!(blob instanceof Blob) || !blob.type.startsWith("image/") || !blob.size) throw new Error("Choose a photo.");
  if (blob.size > MAX_PHOTO_BYTES) throw new Error("This photo is too large to keep in recents.");
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  let image, temporaryUrl;
  try {
    if (globalThis.createImageBitmap) image = await createImageBitmap(blob);
    else {
      temporaryUrl = URL.createObjectURL(blob);
      image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve; image.onerror = () => reject(new Error("Couldn’t preview this photo."));
        image.src = temporaryUrl;
      });
    }
    const width = image.width || image.naturalWidth, height = image.height || image.naturalHeight;
    const side = Math.min(width, height);
    if (!side) throw new Error("Couldn’t preview this photo.");
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 112;
    canvas.getContext("2d").drawImage(image, (width-side)/2, (height-side)/2, side, side, 0, 0, 112, 112);
    const thumbnail = await new Promise((resolve, reject) => canvas.toBlob(
      value => value ? resolve(value) : reject(new Error("Couldn’t preview this photo.")), "image/jpeg", .78));
    return { hash, blob, thumbnail };
  } finally {
    image?.close?.();
    if (temporaryUrl) { URL.revokeObjectURL(temporaryUrl); image.src = ""; }
  }
}
export async function saveRecentPhoto(ownerId, prepared) {
  if (!prepared?.hash || !/^[a-f0-9]{64}$/i.test(prepared.hash) ||
      !(prepared.blob instanceof Blob) || !prepared.blob.size) {
    throw new Error("Choose a photo before saving it to recents.");
  }
  const { requestCloudApi } = await cloudClient(ownerId);
  let draft = await loadCloudManifest(requestCloudApi);
  if (!draft) {
    await migrateLegacyPhotos(ownerId, requestCloudApi);
    draft = await loadCloudManifest(requestCloudApi);
  }
  const currentRows = draft ? await materialize(ownerId, draft, requestCloudApi) : [];
  const existing = draft?.state.entries.find(entry => entry.hash === prepared.hash);
  let reference = existing?.media;
  if (!reference) {
    const { putLocalMedia } = await import("./local-media.js");
    reference = await putLocalMedia(prepared.blob);
    await verifyMedia(requestCloudApi, reference, prepared.hash, prepared.blob.size);
  }
  const nextRows = boundedRecentPhotos([{
    id: `${ownerId}:${prepared.hash}`, ownerId, hash: prepared.hash,
    createdAt: Date.now(), blob: prepared.blob, thumbnail: prepared.thumbnail, reference,
  }, ...currentRows.filter(row => row.hash !== prepared.hash)], ownerId);
  const next = manifest(nextRows.map(row => ({
    hash: row.hash, createdAt: row.createdAt, size: row.blob.size, media: row.reference,
  })));
  await commitManifest(requestCloudApi, next);
  return nextRows;
}
