// Pure scene chooser for the activity photo cards. No DOM, no store, no network, no credentials.
// Input is only an opaque account id, a non-sensitive integer auth revision and a random salt.
export const POOLS = { run: ["run", "run-2", "run-3"], walk: ["walk-2", "walk-3", "walk"], cycle: ["cycle", "cycle-2", "cycle-3"], hike: ["hike", "hike-2", "hike-3"] };
// walk: the two newer scenes are chosen most of the time; the original (older man) is rare.
const WEIGHTS = { run: [1, 1, 1], walk: [5, 5, 1], cycle: [1, 1, 1], hike: [1, 1, 1] };
export function hash(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function chooseScenes({ accountId = "", revision = 0, salt = "", previous = {} } = {}) {
  const out = {};
  for (const a of Object.keys(POOLS)) {
    const w = WEIGHTS[a].map((weight, i) => POOLS[a][i] === previous[a] ? 0 : weight);
    const tot = w.reduce((x, y) => x + y, 0);
    let r = hash(`${accountId}|${revision}|${salt}|${a}`) % tot, i = 0;
    while (r >= w[i]) { r -= w[i]; i++; }
    out[a] = POOLS[a][i];
  }
  return out;
}
const KEY = "oldtime.sports.scene-salt";
let memSalt = "";
// Random per-browser-session salt (not a credential). Falls back to memory when storage is blocked.
export function sessionSalt(storage) {
  try { const s = storage ?? globalThis.sessionStorage; let v = s?.getItem(KEY); if (!v) { v = Math.random().toString(36).slice(2, 10); s?.setItem(KEY, v); } return v; }
  catch { return memSalt ||= Math.random().toString(36).slice(2, 10); }
}

// Revision 0 means a restored session after page load, not a new sign-in.
// Keep its previous mix. A real sign-in revision picks a fresh person for each activity.
export function createSceneSelector(storage) {
  let lastKey = "", lastScenes = null;
  const memory = new Map();
  return ({ accountId = "", revision = 0 } = {}) => {
    const accountKey = hash(accountId).toString(36), key = `${accountKey}|${revision}`;
    if (lastScenes && lastKey === key) return lastScenes;
    const savedKey = `oldtime.sports.scene-mix.${accountKey}`;
    let saved = memory.get(accountKey), targetStorage;
    try {
      targetStorage = storage ?? globalThis.sessionStorage;
      saved ||= JSON.parse(targetStorage?.getItem(savedKey) || "null");
    } catch { /* Blocked storage keeps a stable in-memory selection. */ }
    const valid = saved && Object.keys(POOLS).every(a => POOLS[a].includes(saved[a]));
    const result = revision === 0 && valid ? saved : chooseScenes({
      accountId, revision, salt: sessionSalt(targetStorage), previous: valid ? saved : {}
    });
    memory.set(accountKey, result);
    try { targetStorage?.setItem(savedKey, JSON.stringify(result)); } catch { /* In-memory fallback. */ }
    lastKey = key; lastScenes = result;
    return result;
  };
}
