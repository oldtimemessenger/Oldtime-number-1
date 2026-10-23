import { api, requestCloudApi } from "./store.js";
import { records, erase } from "./sports-db.js";
import { calculateWorkout, metres, MAX_SPEED_METRES_PER_SECOND } from "../../../lib/sports/metrics.js";

export const ACTIVITIES = [
  { id: "run", label: "Running", description: "Find your rhythm", icon: "run" },
  { id: "walk", label: "Walking", description: "Every step counts", icon: "walk" },
  { id: "cycle", label: "Cycling", description: "Take the long way", icon: "cycle" },
  { id: "hike", label: "Hiking", description: "Get off the beaten path", icon: "hike" },
];
const listeners = new Set();
let owner = "", active = null, history = [], gpsStatus = "idle", warning = "", error = "", loading = false, saving = false;
let nextOffset = null;
let watch = null, wakeLock = null, writeChain = Promise.resolve(), generation = 0, hydration = null;
let saveTimer = null, lastCloudSaveAt = 0;
const who = () => api.me()?.cloudAccountId || api.me()?.id || "";
const recordingPayload = workout => ({
  activityType: workout.activityType, startedAt: workout.startedAt, endedAt: workout.endedAt ?? null,
  points: workout.points, events: workout.events,
});
async function saveWorkoutToCloud(workout) {
  const result = await requestCloudApi(`/api/sports/workouts/${encodeURIComponent(workout.id)}`, {
    method: "PUT", body: recordingPayload(workout),
  });
  if (result.workout?.id !== workout.id) throw new Error("The server did not confirm this activity.");
  return result.workout;
}
function snapshot() {
  if (active) active.summary = calculateWorkout(active);
  return { active, history, gpsStatus, accuracyM: active?.points.at(-1)?.accuracy ?? null,
    warning, error, loading, saving, hasMore: nextOffset !== null };
}
function emit() { const state = snapshot(); listeners.forEach(fn => fn(state)); }
function saveDraft(force = false) {
  if (!active) return writeChain;
  if (!api.me()?.cloudAccountId) return Promise.reject(new Error("Sign in to a cloud-backed account before recording."));
  active.updatedAt = Date.now();
  const elapsed = Date.now() - lastCloudSaveAt;
  if (!force && elapsed < 5000) {
    if (!saveTimer) {
      saveTimer = setTimeout(() => {
        saveTimer = null;
        void saveDraft(true).catch(() => {});
      }, 5000 - elapsed);
    }
    return writeChain;
  }
  clearTimeout(saveTimer); saveTimer = null;
  const data = structuredClone(active), account = owner, token = generation;
  writeChain = writeChain.catch(() => {}).then(async () => {
    if (token !== generation || account !== owner) throw new Error("The signed-in account changed.");
    const saved = await saveWorkoutToCloud(data);
    if (token !== generation || account !== owner) throw new Error("The signed-in account changed.");
    lastCloudSaveAt = Date.now();
    if (active?.id === data.id) {
      active.synced = true;
      active.summary = saved.summary;
    }
    return saved;
  }).catch(e => {
    error = e.message;
    if (active?.id === data.id && active.status === "recording") {
      stopSensors();
      active.events.push({ type: "pause", timestamp: Date.now() });
      active.status = "paused";
      active.updatedAt = Date.now();
      gpsStatus = "paused";
      warning = "Connection interrupted. Recording paused until it can be saved to your account.";
    }
    emit(); throw e;
  });
  void writeChain.catch(() => {});
  return writeChain;
}
function stopSensors() {
  if (watch !== null) navigator.geolocation?.clearWatch(watch);
  watch = null;
  void wakeLock?.release().catch(() => {}); wakeLock = null;
}
function startSensors() {
  stopSensors();
  if (!navigator.geolocation) { gpsStatus = "unavailable"; warning = "Location is unavailable. Duration is recording; distance is not."; emit(); return; }
  gpsStatus = "locating"; warning = ""; emit();
  const token = generation;
  watch = navigator.geolocation.watchPosition(position => {
    if (token !== generation || owner !== who() || active?.status !== "recording") return;
    const c = position.coords;
    if (!Number.isFinite(c.accuracy) || c.accuracy > 50) {
      gpsStatus = "weak"; warning = "GPS accuracy is poor. Inaccurate points are not added."; emit(); return;
    }
    const timestamp = Math.round(position.timestamp);
    if (!Number.isFinite(c.latitude) || c.latitude < -90 || c.latitude > 90 ||
        !Number.isFinite(c.longitude) || c.longitude < -180 || c.longitude > 180 ||
        timestamp < active.events.at(-1).timestamp) return;
    const previous = active.points.at(-1);
    if (timestamp < active.startedAt || timestamp > Date.now() + 60000 ||
        (previous && (timestamp <= previous.timestamp || timestamp - previous.timestamp < 900))) return;
    const elapsed = previous ? (timestamp - previous.timestamp) / 1000 : 0;
    const resumed = active.events.at(-1)?.type === "resume" && (!previous || active.events.at(-1).timestamp > previous.timestamp);
    if (previous && !resumed && elapsed <= 45 && elapsed > 0 &&
        metres(previous, { lat: c.latitude, lon: c.longitude }) / elapsed >
          MAX_SPEED_METRES_PER_SECOND[active.activityType] +
          Math.max(3, Math.min(20, (previous.accuracy + c.accuracy) * .5)) / elapsed) {
      gpsStatus = "weak"; warning = "An implausible GPS jump was ignored. Waiting for a steady location."; emit(); return;
    }
    if (active.points.length >= 5000) { pause(); warning = "Route limit reached. Finish this workout before starting another."; emit(); return; }
    active.points.push({ lat: c.latitude, lon: c.longitude, timestamp, accuracy: c.accuracy,
      altitude: Number.isFinite(c.altitude) ? c.altitude : null,
      altitudeAccuracy: Number.isFinite(c.altitudeAccuracy) ? c.altitudeAccuracy : null,
      breakBefore: !!(resumed || previous && timestamp - previous.timestamp > 45000) });
    gpsStatus = "tracking"; warning = ""; void saveDraft(); emit();
  }, e => {
    if (token !== generation || !active) return;
    gpsStatus = e.code === 1 ? "denied" : "gap";
    warning = e.code === 1 ? "Location permission was denied. Duration only—allow location and resume to record a route." : "GPS interrupted. Duration continues; missing route sections will not be invented.";
    emit();
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  if (navigator.wakeLock && document.visibilityState === "visible") {
    void navigator.wakeLock.request("screen").then(lock => {
      if (token !== generation || active?.status !== "recording") void lock.release(); else wakeLock = lock;
    }).catch(() => {});
  }
}
async function accountChanged() {
  const next = who(); if (next === owner) return hydration;
  if (active?.status === "recording") pause();
  clearTimeout(saveTimer); saveTimer = null; lastCloudSaveAt = 0;
  generation++; stopSensors(); owner = next; active = null; history = []; nextOffset = null; error = ""; warning = ""; gpsStatus = "idle"; emit();
  if (owner) {
    const token = generation;
    hydration = loadHistory().finally(() => { if (token === generation) hydration = null; });
    await hydration;
  } else hydration = null;
}
async function loadHistory() {
  const next = who();
  if (owner !== next) return accountChanged();
  const account = owner, token = generation;
  if (!account) return;
  loading = true; error = ""; emit();
  try {
    if (!api.me()?.cloudAccountId) {
      error = "Sign in to a cloud-backed account to view and record activities.";
      return;
    }
    let migrationError = "";
    const legacyOwners = [...new Set([account, api.me()?.id].filter(Boolean))];
    for (const legacyOwner of legacyOwners) {
      let local = [];
      try { local = await records(legacyOwner); }
      catch (e) { migrationError = e.message; continue; }
      for (const workout of local) {
        if (token !== generation) return;
        try {
          const saved = await saveWorkoutToCloud(workout);
          if (saved.id !== workout.id || saved.activityType !== workout.activityType ||
              saved.startedAt !== workout.startedAt || saved.points?.length !== workout.points?.length ||
              saved.events?.length !== workout.events?.length) {
            throw new Error("The server copy did not match the saved activity.");
          }
          await erase(legacyOwner, workout.id);
        } catch (e) {
          migrationError = `Some earlier activities still need a verified cloud transfer: ${e.message}`;
          break;
        }
      }
    }
    const result = await requestCloudApi("/api/sports/workouts");
    if (token !== generation) return;
    nextOffset = result.nextOffset ?? null;
    const openWorkout = result.workouts.find(workout => workout.status !== "completed");
    if (openWorkout && (!active || active.id !== openWorkout.id)) {
      const detailResult = await requestCloudApi(`/api/sports/workouts/${encodeURIComponent(openWorkout.id)}`);
      if (token !== generation) return;
      active = { ...detailResult.workout, synced: true };
      if (active.status === "recording") {
        active.events.push({ type: "pause", timestamp: Date.now() });
        active.status = "paused"; active.updatedAt = Date.now();
        gpsStatus = "paused";
        warning = "An interrupted recording was recovered from your account and paused. Resume when you are ready.";
        await saveDraft(true);
      }
    }
    history = result.workouts.filter(workout => workout.status === "completed")
      .map(workout => ({ ...workout, synced: true })).sort((a, b) => b.startedAt - a.startedAt);
    if (migrationError) error = migrationError;
  } catch (e) { error = e.message; }
  finally { if (token === generation) { loading = false; emit(); } }
}
async function loadMore() {
  if (nextOffset === null || loading || owner !== who()) return;
  const token = generation;
  loading = true; error = ""; emit();
  try {
    const result = await requestCloudApi(`/api/sports/workouts?offset=${nextOffset}`);
    if (token !== generation) return;
    const merged = new Map(history.map(w => [w.id, w]));
    for (const w of result.workouts.filter(item => item.status === "completed")) merged.set(w.id, { ...merged.get(w.id), ...w, synced: true });
    history = [...merged.values()].sort((a, b) => b.startedAt - a.startedAt);
    nextOffset = result.nextOffset ?? null;
  } catch (e) { error = e.message; }
  finally { if (token === generation) { loading = false; emit(); } }
}
async function start(type) {
  await accountChanged();
  if (!api.me()?.cloudAccountId) throw new Error("Sign in to a cloud-backed account before recording.");
  if (active) throw new Error("Finish or discard your current workout first.");
  if (!ACTIVITIES.some(a => a.id === type)) throw new Error("Choose an activity.");
  const now = Date.now();
  const workout = { id: crypto.randomUUID(), activityType: type, startedAt: now, endedAt: null,
    updatedAt: now, status: "recording", points: [], events: [{ type: "start", timestamp: now }], synced: false };
  const saved = await saveWorkoutToCloud(workout);
  lastCloudSaveAt = Date.now();
  active = { ...workout, summary: saved.summary, synced: true }; error = ""; startSensors(); emit();
}
function pause() {
  if (active?.status !== "recording") return;
  active.events.push({ type: "pause", timestamp: Date.now() }); active.status = "paused";
  stopSensors(); gpsStatus = "paused"; void saveDraft(true).catch(() => {}); emit();
}
async function resume() {
  if (active?.status !== "paused" || who() !== owner) return;
  active.events.push({ type: "resume", timestamp: Date.now() }); active.status = "recording";
  await saveDraft(true);
  startSensors(); emit();
}
function retryGps() {
  if (active?.status !== "recording") return false;
  warning = ""; error = ""; startSensors(); return true;
}
async function sync(id) {
  if (!api.me()?.cloudAccountId) throw new Error("Sign in to sync this activity with your account.");
  const token = generation;
  let workout = active?.id === id ? active : history.find(item => item.id === id);
  let legacyOwner = null;
  if (!workout) {
    for (const candidate of [...new Set([owner, api.me()?.id].filter(Boolean))]) {
      const legacy = (await records(candidate)).find(item => item.id === id);
      if (legacy) { workout = legacy; legacyOwner = candidate; break; }
    }
  }
  if (!workout) throw new Error("This activity is not available in your account.");
  const result = await saveWorkoutToCloud(workout);
  if (token !== generation) throw new Error("The signed-in account changed.");
  if (legacyOwner) {
    const verification = await requestCloudApi(`/api/sports/workouts/${encodeURIComponent(id)}`);
    if (verification.workout?.id !== id || verification.workout.points?.length !== workout.points?.length ||
        verification.workout.events?.length !== workout.events?.length) {
      throw new Error("The server copy could not be verified; the original is still preserved.");
    }
    await erase(legacyOwner, id);
  }
  const saved = { ...workout, ...result, synced: true };
  if (active?.id === id) active = saved;
  history = [saved, ...history.filter(w => w.id !== id)].sort((a, b) => b.startedAt - a.startedAt);
  lastCloudSaveAt = Date.now(); emit();
  return saved;
}
async function finish() {
  if (!active || saving) throw new Error("No workout is ready to finish.");
  saving = true; emit();
  try {
    stopSensors();
    if (active.events.at(-1)?.type !== "finish") {
      const now = Date.now();
      active.events.push({ type: "finish", timestamp: now }); active.endedAt = now; active.status = "completed";
    }
    active.summary = calculateWorkout(active); await saveDraft(true);
    const completed = structuredClone(active); active = null; gpsStatus = "idle";
    history = [completed, ...history.filter(w => w.id !== completed.id)];
    return completed;
  } catch (e) {
    // Keep the completed in-memory recording intact so a retry can safely upsert it.
    error = e.message; throw e;
  } finally { saving = false; emit(); }
}
async function discard() {
  if (!active) return;
  stopSensors(); clearTimeout(saveTimer); saveTimer = null; await writeChain.catch(() => {});
  await requestCloudApi(`/api/sports/workouts/${encodeURIComponent(active.id)}`, { method: "DELETE" });
  active = null; gpsStatus = "idle"; warning = ""; error = ""; emit();
}
async function detail(id) {
  const account = owner;
  const result = await requestCloudApi(`/api/sports/workouts/${id}`);
  if (account !== owner) throw new Error("The signed-in account changed.");
  return { ...result.workout, synced: true };
}
async function markSyncPending(id) {
  try { return await sync(id); } catch { return null; }
}
async function remove(id) {
  const entry = history.find(w => w.id === id);
  await requestCloudApi(`/api/sports/workouts/${encodeURIComponent(id)}`, { method: "DELETE" });
  history = history.filter(w => w.id !== id);
  if (active?.id === id) active = null;
  if (nextOffset !== null && entry) nextOffset = Math.max(0, nextOffset - 1);
  emit();
}
document.addEventListener("visibilitychange", () => {
  if (active?.status !== "recording") return;
  if (document.hidden) {
    // Keep receiving genuine fixes where the browser permits it, without
    // pretending browser GPS can survive OS suspension or inventing gaps.
     void saveDraft(true);
    warning = "Recording continues where the browser allows GPS. Locked-phone background tracking requires the native app.";
  } else {
    const last = active.points.at(-1);
    warning = last && Date.now() - last.timestamp > 20000
      ? "GPS was interrupted in the background. Missing sections stay as gaps; elapsed time continues."
      : "";
    if (navigator.wakeLock) navigator.wakeLock.request("screen").then(lock => { wake = lock; }).catch(() => {});
  }
  emit();
});
window.addEventListener("online", async () => {
  if (owner !== who()) return;
  if (active) { try { await saveDraft(true); } catch {} }
  await loadHistory();
});
setInterval(() => {
  if (active) {
    if (who() !== owner) { void accountChanged(); return; }
    if (active.status === "recording" && active.points.at(-1) && Date.now() - active.points.at(-1).timestamp > 45000) {
      gpsStatus = "gap"; warning = "Waiting for GPS. Missing route sections are not filled in.";
    }
    emit(); if (active.status === "recording" && Date.now() - active.updatedAt >= 5000) void saveDraft();
  }
}, 1000);
export const sports = { snapshot, subscribe(fn) { listeners.add(fn); fn(snapshot()); return () => listeners.delete(fn); },
  start, pause, resume, retryGps, finish, discard, sync, detail, markSyncPending, remove, loadHistory, loadMore, accountChanged };
