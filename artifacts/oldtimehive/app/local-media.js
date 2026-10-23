import { createSHA256 } from "hash-wasm";
import { Upload } from "tus-js-client";

const PREFIX = "oldtime-media:";
const urls = new Map();
const urlExpiries = new Map();
const pendingUrls = new Map();
const quotaBlockedUntil = new Map();
const cloudClient = () => import("./store.js");
const sha256Placeholder = "0".repeat(64);
let mediaObserver;

export function shouldRetryMediaUpload(error, attempt, options) {
  const status = Number(error?.originalResponse?.getStatus?.() || 0);
  if ([401, 402, 403, 413].includes(status)) return false;
  return Upload.defaultOptions.onShouldRetry(error, attempt, options);
}

function workerDigest(blob) {
  if (typeof Worker !== "function") return digestOnMainThread(blob);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./media-hash-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = event => {
      worker.terminate();
      if (event.data?.error) reject(new Error(event.data.error));
      else resolve(event.data?.sha256 || "");
    };
    worker.onerror = event => {
      worker.terminate();
      reject(event.error || new Error("The media file could not be verified."));
    };
    worker.postMessage(blob);
  }).catch(() => digestOnMainThread(blob));
}

async function digestOnMainThread(blob) {
  const digest = await createSHA256();
  digest.init();
  const chunkSize = 8 * 1024 * 1024;
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    digest.update(new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer()));
  }
  return digest.digest("hex");
}

export function uploadResumableMedia(blob, ticket, onProgress) {
  const contentType = String(blob?.type || "").split(";")[0].trim().toLowerCase();
  if (!contentType) return Promise.reject(new Error("Choose a supported media file."));
  return new Promise((resolve, reject) => {
    const upload = new Upload(blob, {
      endpoint: ticket.endpoint,
      headers: { "x-signature": ticket.token },
      metadata: {
        bucketName: ticket.bucketName,
        objectName: ticket.objectName,
        contentType,
        // Cloud media is immutable after confirmation; allow the Storage CDN
        // and browser to reuse it instead of transferring the same bytes again.
        // Match the five-minute signed-read lifetime so edge/browser caches
        // never extend private media access beyond the URL's authorization.
        cacheControl: "300",
      },
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      onShouldRetry: shouldRetryMediaUpload,
      storeFingerprintForResuming: false,
      removeFingerprintOnSuccess: true,
      onProgress: (sent, total) => onProgress?.(total ? sent / total : 0, "uploading"),
      onError: error => {
        const status = Number(error?.originalResponse?.getStatus?.() || 0);
        console.warn("[Oldtime upload]", { status, reason: "cloud-upload-failed" });
        const message = status === 402
          ? "Media uploads are temporarily restricted by the storage service. Please try again later."
          : status === 401 || status === 403
          ? "Upload authorization failed. Please try again."
          : status === 413
            ? "This file exceeds the storage service’s allowed size."
            : "The upload was interrupted. Check your connection and try again.";
        const failure = new Error(message);
        failure.status = status;
        reject(failure);
      },
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}

export function isLocalMedia(value) { return String(value || "").startsWith(PREFIX); }
export function renderMediaUrl(value) { return isLocalMedia(value) ? "" : String(value || ""); }

export async function optimizeMediaForUpload(blob, { onProgress } = {}) {
  if (!(blob instanceof Blob) || !blob.size || !Number.isSafeInteger(blob.size)) {
    throw new Error("Choose a supported media file.");
  }
  let contentType = String(blob.type || "").split(";")[0].trim().toLowerCase();
  if (!contentType) throw new Error("Choose a supported media file.");
  if (contentType.startsWith("image/")) {
    const { compressImageForUpload } = await import("./image-compression.js");
    blob = await compressImageForUpload(blob, { onProgress });
    contentType = String(blob.type || "").split(";")[0].trim().toLowerCase();
  }
  if (contentType.startsWith("video/")) {
    const { compressVideoTo720p } = await import("./video-compression.js");
    blob = await compressVideoTo720p(blob, { onProgress });
    contentType = String(blob.type || "").split(";")[0].trim().toLowerCase();
    if (!["video/mp4", "video/webm"].includes(contentType)) {
      throw new Error("The optimized video could not be verified. The original was not uploaded.");
    }
  }
  if (!blob.size || !Number.isSafeInteger(blob.size)) {
    throw new Error("The optimized media could not be verified.");
  }
  return blob;
}

export async function putLocalMedia(blob, requestedId, onProgress, { preserveBytes = false } = {}) {
  if (!(blob instanceof Blob) || !blob.size || !Number.isSafeInteger(blob.size)) {
    throw new Error("Choose a supported media file.");
  }
  const hasFixedId = typeof requestedId === "string" && requestedId.length > 0;
  let contentType = String(blob.type || "").split(";")[0].trim().toLowerCase();
  if (!contentType) throw new Error("Choose a supported media file.");
  if (!preserveBytes) {
    blob = await optimizeMediaForUpload(blob, { onProgress });
    contentType = String(blob.type || "").split(";")[0].trim().toLowerCase();
  }
  if (!blob.size || !Number.isSafeInteger(blob.size)) {
    throw new Error("The optimized media could not be verified.");
  }
  if (!hasFixedId) requestedId = crypto.randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedId)) {
    throw new Error("The media reference is invalid.");
  }
  const { api, requestCloudApi } = await cloudClient();
  if (!api.cloudAccountId()) throw new Error("Sign in to your online account before uploading media.");

  const id = requestedId;
  const reservation = await requestCloudApi(`/api/media/${encodeURIComponent(id)}/upload`, {
    method: "POST",
    body: { contentType, size: blob.size, sha256: sha256Placeholder },
  });
  if (reservation?.ready) {
    onProgress?.(1, "complete", { size: blob.size, contentType });
    return `${PREFIX}${id}`;
  }

  const [sha256] = await Promise.all([
    workerDigest(blob),
    reservation?.uploaded
      ? Promise.resolve(onProgress?.(1, "uploading"))
      : uploadResumableMedia(blob, reservation, onProgress),
  ]);
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("The media file could not be verified.");
  await requestCloudApi(`/api/media/${encodeURIComponent(id)}/confirm`, {
    method: "POST",
    body: { sha256 },
  });
  onProgress?.(1, "complete", { size: blob.size, contentType });
  return `${PREFIX}${id}`;
}

export async function mediaUrl(value) {
  if (!isLocalMedia(value)) {
    const url = String(value || "");
    if (!url || !/^(https?:|blob:|data:(audio|video|image)\/|\/|\.\/)/i.test(url)) {
      throw new Error("This media is unavailable.");
    }
    return url;
  }
  const id = value.slice(PREFIX.length);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("This media reference is invalid.");
  }
  const { api, requestCloudApi } = await cloudClient();
  const cacheKey = `${api.cloudAccountId() || "signed-out"}:${value}`;
  const owner = api.cloudAccountId() || "signed-out";
  if ((quotaBlockedUntil.get(owner) || 0) > Date.now()) {
    throw Object.assign(new Error("Media is temporarily restricted by the storage service. Please try again later."), { status: 402 });
  }
  quotaBlockedUntil.delete(owner);
  const cached = urls.get(cacheKey);
  if (cached && (urlExpiries.get(cacheKey) || 0) > Date.now() + 15000) return cached;
  if (pendingUrls.has(cacheKey)) return pendingUrls.get(cacheKey);
  const pending = requestCloudApi(`/api/media/${encodeURIComponent(id)}/url`)
    .then(result => {
      if (!result?.url) throw new Error("This media is unavailable.");
      urls.set(cacheKey, result.url);
      urlExpiries.set(cacheKey, Date.now() + 4 * 60 * 1000);
      return result.url;
    })
    .catch(error => {
      // A provider-wide restriction is not a missing file. Avoid hammering
      // signing endpoints for every tile while the same restriction persists.
      if (error?.status === 402) quotaBlockedUntil.set(owner, Date.now() + 60_000);
      throw error;
    })
    .finally(() => pendingUrls.delete(cacheKey));
  pendingUrls.set(cacheKey, pending);
  return pending;
}

export function invalidateMediaUrl(value) {
  for (const key of urls.keys()) {
    if (key.endsWith(`:${value}`)) {
      urls.delete(key);
      urlExpiries.delete(key);
    }
  }
}

export async function migrateLocalMedia(value, ownerId) {
  const { api, requestCloudApi } = await cloudClient();
  if (!isLocalMedia(value) || !ownerId || api.me()?.id !== ownerId || !api.cloudAccountId()) {
    throw new Error("Sign in to the account that owns this media.");
  }
  const id = value.slice(PREFIX.length);
  try {
    const existing = await requestCloudApi(`/api/media/${encodeURIComponent(id)}/url`);
    if (existing?.url) return false;
  } catch (error) {
    if (error?.status !== 404) throw error;
  }
  const original = await operation("readonly", store => store.get(value));
  if (!(original instanceof Blob) || !original.size) {
    throw new Error("This media is not available in the account or as a legacy source.");
  }
  await putLocalMedia(original, id, undefined, { preserveBytes: true });
  const verified = await requestCloudApi(`/api/media/${encodeURIComponent(id)}/url`);
  if (!verified?.url || verified.size !== original.size || verified.contentType !== original.type) {
    throw new Error("The cloud copy could not be verified. The original is still preserved.");
  }
  await operation("readwrite", store => store.delete(value));
  return true;
}

async function openDatabase() {
  if (!globalThis.indexedDB) throw new Error("Legacy media storage is unavailable.");
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open("oldtime-created-media", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(new Error("Couldn’t open legacy media storage.")); };
  });
  return database;
}
let database;
async function operation(mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("files", mode);
    const request = action(transaction.objectStore("files"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = transaction.onabort = () => reject(new Error("Couldn’t read legacy media."));
  });
}
async function blobDigest(blob) {
  const digest = await createSHA256();
  digest.init();
  const chunkSize = 8 * 1024 * 1024;
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    digest.update(new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer()));
  }
  return digest.digest("hex");
}

export async function deleteLocalMedia(value) {
  if (!isLocalMedia(value)) return;
  const { api, requestCloudApi } = await cloudClient();
  const id = value.slice(PREFIX.length);
  for (const [key, url] of urls) {
    if (key.endsWith(`:${value}`) && url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
      urls.delete(key);
      urlExpiries.delete(key);
    }
  }
  if (api.cloudAccountId() && /^[0-9a-f-]{36}$/i.test(id)) {
    try { await requestCloudApi(`/api/media/${encodeURIComponent(id)}`, { method: "DELETE" }); }
    catch (error) {
      if (!/404|not found/i.test(String(error?.message || ""))) throw error;
    }
  }
  await operation("readwrite", store => store.delete(value)).catch(() => {});
}

async function loadElement(element) {
  if (!element.isConnected) return;
  const reference = element.dataset.localMedia;
  if (!reference || element.dataset.loadedMedia === reference) return;
  element.dataset.loadedMedia = reference;
  try {
    const url = await mediaUrl(reference);
    if (!element.isConnected || element.dataset.localMedia !== reference) return;
    element.parentElement?.querySelector(":scope > .local-media-unavailable")?.remove();
    element.classList.remove("media-load-failed");
    element.removeAttribute("aria-label");
    if (element.tagName !== "A") {
      // A signed link may expire while a tab is suspended. Refresh the cloud
      // link once; never substitute an old browser-only media copy.
      element.onerror = () => {
        if (!element.isConnected || element.dataset.localMedia !== reference) return;
        invalidateMediaUrl(reference);
        if (element.dataset.mediaRefreshAttempt !== reference) {
          element.dataset.mediaRefreshAttempt = reference;
          element.dataset.loadedMedia = "";
          void loadElement(element);
        } else {
          showMediaFailure(element, reference, new Error("The media could not load over this connection."));
        }
      };
    }
    if (element.tagName === "A") element.href = url;
    else {
      element.hidden = false;
      element.src = url;
    }
    if (element.tagName === "VIDEO" && !element.paused) void element.play().catch(() => {});
  } catch (error) {
    showMediaFailure(element, reference, error);
  }
}

function showMediaFailure(element, reference, error) {
  if (!element.isConnected || element.dataset.localMedia !== reference) return;
  element.dataset.loadedMedia = "";
  const status = Number(error?.status || 0);
  const message = status === 410 ? "The original file could not be found in cloud storage."
    : status === 402 ? "Media is temporarily restricted by the storage service. Please try again later."
    : status === 401 ? "Sign in again to load this media."
    : status === 403 || status === 404 ? "This media is not accessible to this account."
    : "Media could not load. Check your connection and retry.";
  console.warn("[Oldtime media]", { status, reason: status ? "cloud-access" : "network-or-playback" });
  const cardThumb = Boolean(element.closest(".ot-collection-cover, .ot-collection-tile"));
  const profileAvatar = element.matches(".profile-avatar, .story-avatar-action img, .ring img");
  const profileCover = Boolean(element.closest(".profile-cover"));
  element.classList.add("media-load-failed");
  if (element.tagName === "IMG") element.alt = "";
  element.setAttribute("aria-label", message);
  // A missing avatar should remain a quiet, fixed-size placeholder. Never add
  // a sibling status row that can spill into a name or story label.
  if (profileAvatar) return;
  if (element.tagName === "IMG" || element.tagName === "VIDEO") element.hidden = true;
  if (element.parentElement?.querySelector(":scope > .local-media-unavailable")) return;
  const notice = document.createElement(cardThumb ? "span" : "div");
  notice.className = `local-media-unavailable${cardThumb ? " local-media-unavailable--compact" : ""}${profileCover ? " local-media-unavailable--cover" : ""}`;
  notice.setAttribute("role", "status");
  const text = document.createElement("span");
  text.textContent = cardThumb ? "Unavailable" : profileCover ? "Cover unavailable"
    : status === 402 ? "Media temporarily unavailable" : "Media unavailable";
  notice.setAttribute("aria-label", message);
  if (cardThumb) {
    notice.append(text);
    element.after(notice);
    return;
  }
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry";
  retry.setAttribute("aria-label", "Retry loading media");
  retry.addEventListener("click", () => {
    invalidateMediaUrl(reference);
    element.dataset.mediaRefreshAttempt = "";
    element.dataset.loadedMedia = "";
    element.hidden = false;
    element.classList.remove("media-load-failed");
    element.removeAttribute("aria-label");
    notice.remove();
    void loadElement(element);
  });
  notice.append(text, retry);
  element.after(notice);
}

export function promoteCloudMediaSources(root) {
  const selector = 'img[src^="oldtime-media:"],video[src^="oldtime-media:"],audio[src^="oldtime-media:"]';
  const elements = [
    ...(root?.matches?.(selector) ? [root] : []),
    ...(root?.querySelectorAll?.(selector) || []),
  ];
  for (const element of elements) {
    const reference = element.getAttribute("src");
    if (!isLocalMedia(reference)) continue;
    if (element.dataset.localMedia !== reference) element.dataset.loadedMedia = "";
    element.dataset.localMedia = reference;
    element.removeAttribute("src");
  }
  return elements;
}

export function observeCloudMedia(root) {
  if (!root || typeof MutationObserver !== "function") return () => {};
  const pending = new Set();
  let scheduled = false;
  const enqueue = element => {
    if (!element?.querySelectorAll) return;
    pending.add(element);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      for (const node of pending) if (node.isConnected) void hydrateLocalMedia(node);
      pending.clear();
    });
  };
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") enqueue(record.target);
      else for (const node of record.addedNodes) enqueue(node);
    }
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "data-local-media"] });
  enqueue(root);
  return () => { observer.disconnect(); pending.clear(); };
}

export async function hydrateLocalMedia(root) {
  promoteCloudMediaSources(root);
  const elements = [
    ...(root?.matches?.("[data-local-media]") ? [root] : []),
    ...(root?.querySelectorAll?.("[data-local-media]") || []),
  ];
  if (!elements.length) return;
  if (!("IntersectionObserver" in globalThis)) {
    await Promise.all(elements.map(loadElement));
    return;
  }
  if (!mediaObserver) {
    mediaObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        mediaObserver.unobserve(entry.target);
        void loadElement(entry.target);
      }
    }, { rootMargin: "80px 0px" });
  }
  for (const element of elements) {
    if (element.dataset.loadedMedia === element.dataset.localMedia) continue;
    if (element.tagName === "IMG") {
      element.loading = "lazy";
      element.decoding = "async";
      const rect = element.getBoundingClientRect();
      element.fetchPriority = rect.bottom > 0 && rect.top < window.innerHeight ? "high" : "low";
    } else if (element.tagName === "VIDEO") {
      // Signed links may be prepared near the viewport, but fetching video
      // bytes starts only when a player actually plays, not for gallery tiles.
      element.preload = "none";
    }
    mediaObserver.observe(element);
  }
}
