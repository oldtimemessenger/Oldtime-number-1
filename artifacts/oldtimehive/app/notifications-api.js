import { api, requestCloudApi } from "./store.js";

let ownerToken = null;
let items = [];
let loaded = false;
let loading = false;
let error = "";
let attemptedAt = 0;
let readAt = 0;
let nextBefore = null;
let pending = null;
let readPending = null;

function syncOwner() {
  const token = api.cloudAccessToken();
  if (ownerToken !== token) {
    ownerToken = token;
    items = [];
    loaded = loading = false;
    error = "";
    attemptedAt = readAt = 0;
    nextBefore = pending = readPending = null;
  }
  return token;
}

export function accountNotifications() {
  syncOwner();
  return api.authMode() === "cloud" ? [...items] : api.db().notes;
}

export function notificationState() {
  syncOwner();
  return { loaded, loading, error, hasMore: nextBefore !== null };
}

export function loadAccountNotifications({ force = false, more = false } = {}) {
  const token = syncOwner();
  if (!token) return Promise.resolve(false);
  if (pending) return pending;
  if (more && !nextBefore) return Promise.resolve(false);
  if (!force && !more && Date.now() - attemptedAt < 30_000) return Promise.resolve(false);
  attemptedAt = Date.now();
  loading = true;
  error = "";
  const request = requestCloudApi(`/api/notifications${more ? `?before=${encodeURIComponent(nextBefore)}` : ""}`, { timeoutMs: 15_000 })
    .then(result => {
      if (token !== api.cloudAccessToken()) return false;
      if (!Array.isArray(result.notifications)) throw new Error("Notification activity could not be read.");
      readAt = Number(result.readAt) || 0;
      const rows = result.notifications.map(note => ({
        id: note.id, user: api.me().id, actor: api.cloudAuthorId(note.actor),
        kind: note.kind, body: note.body, created: Number(note.createdAt),
        post: note.postId, story: note.storyId, comment: note.commentId,
        read: note.read === true || Number(note.createdAt) <= readAt,
      }));
      items = more ? [...new Map([...items, ...rows].map(note => [note.id, note])).values()] : rows;
      nextBefore = result.nextBefore ?? null;
      loaded = true;
      return true;
    }).catch(cause => {
      if (token === api.cloudAccessToken()) error = cause.message || "Notifications could not load.";
      throw cause;
    }).finally(() => {
      if (pending === request) { loading = false; pending = null; }
    });
  pending = request;
  return request;
}

export function readAccountNotifications() {
  const token = syncOwner();
  const through = Math.max(0, ...items.map(note => note.created));
  if (!token || through <= readAt) return Promise.resolve(false);
  if (readPending) return readPending;
  const request = requestCloudApi("/api/notifications/read", {
    method: "POST", body: { through }, timeoutMs: 15_000,
  }).then(result => {
    if (token !== api.cloudAccessToken()) return false;
    readAt = Number(result.readAt) || 0;
    items = items.map(note => ({ ...note, read: note.created <= readAt }));
    return true;
  }).finally(() => { if (readPending === request) readPending = null; });
  readPending = request;
  return request;
}
