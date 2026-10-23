// Pure replay maths: a timestamped timeline based on recorded GPS points.
// Short, plausible signal losses may be estimated for the flyover only; metrics stay recorded-only.
import { routeSegments, MAX_SPEED_METRES_PER_SECOND } from "../../../lib/sports/metrics.js";
import { POSITION_RED } from "./sports-marker.js";

const R = 6371008.8, RAD = Math.PI / 180, TRIM_M = 250, MIN_HIDE_TOTAL_M = 1000;
const MAX_ESTIMATED_GAP_MS = 120_000;
const ESTIMATED_GAP_SPEED_MPS = Object.freeze({ run: 10, walk: 4, cycle: 28, hike: 5 });
export const hav = (a, b) => {
  const la = (b.lat - a.lat) * RAD, lo = (b.lon - a.lon) * RAD;
  const h = Math.sin(la / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(lo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};
// Only GPS altitude with a stated accuracy of 10 m or better is ever reported.
const gpsAlt = p => Number.isFinite(p.altitude) && Number.isFinite(p.altitudeAccuracy) && p.altitudeAccuracy <= 10 ? p.altitude : null;
const ll = p => [p?.lat ?? p?.latitude, p?.lon ?? p?.longitude];
const dist = (a, b) => { const [a1, a2] = ll(a), [b1, b2] = ll(b); return hav({ lat: a1, lon: a2 }, { lat: b1, lon: b2 }); };
// Shared point cleaning: drops invalid points and fixes worse than 50 m, preserving every gap.
// A low-tolerance Douglas-Peucker pass reduces meter-scale jitter while keeping actual corners.
function simplifyGpsSegment(points) {
  if (points.length < 3) return points;
  const lat0 = points[0].lat * RAD, scaleX = Math.cos(lat0) * R;
  const xy = points.map(p => ({ x: p.lon * RAD * scaleX, y: p.lat * RAD * R }));
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop(), a = xy[first], b = xy[last];
    const dx = b.x - a.x, dy = b.y - a.y, denom = dx * dx + dy * dy;
    let selected = -1, score = 1;
    for (let i = first + 1; i < last; i++) {
      const p = xy[i], t = denom ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / denom)) : 0;
      const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
      const accuracy = Number.isFinite(points[i].accuracy) ? points[i].accuracy : 4;
      const tolerance = Math.max(1, Math.min(4, accuracy * .35));
      if (d / tolerance > score) { score = d / tolerance; selected = i; }
    }
    if (selected >= 0) { keep[selected] = 1; stack.push([first, selected], [selected, last]); }
  }
  return points.filter((_, i) => keep[i]);
}
export function cleanPoints(points, { activityType } = {}) {
  const out = []; let segment = [], broke = false, nextBreakReason = null;
  const flush = () => {
    if (!segment.length) return;
    const clean = simplifyGpsSegment(segment);
    if (out.length && clean.length) clean[0] = { ...clean[0], breakBefore: true, breakReason: clean[0].breakReason || nextBreakReason || "source-break" };
    out.push(...clean); segment = [];
  };
  for (const p of points || []) {
    const [la, lo] = ll(p);
    if (!p || !Number.isFinite(la) || la < -90 || la > 90 || !Number.isFinite(lo) || lo < -180 || lo > 180 ||
        !Number.isFinite(p.timestamp)) { flush(); broke = true; nextBreakReason = "invalid-fix"; continue; }
    if (Number.isFinite(p.accuracy) && p.accuracy > 50) { flush(); broke = true; nextBreakReason = "poor-accuracy"; continue; }
    const prev = segment.at(-1);
    const elapsed = prev ? (p.timestamp - prev.timestamp) / 1000 : 0;
    const maxSpeed = MAX_SPEED_METRES_PER_SECOND[activityType] || 40;
    if (prev && (p.breakBefore || elapsed > 45 || elapsed <= 0 || dist(prev, p) / elapsed > maxSpeed)) {
      flush(); broke = true;
      nextBreakReason = elapsed > 45 ? "gps-gap" : p.breakBefore ? "source-break" : elapsed <= 0 ? "timestamp" : "speed-jump";
    } else if (!prev && p.breakBefore && !broke) {
      broke = true; nextBreakReason = "source-break";
    }
    segment.push(broke ? { ...p, breakBefore: true, breakReason: nextBreakReason || "source-break" } : p);
    broke = false; nextBreakReason = null;
  }
  flush();
  return out;
}
// Shared privacy filter for replay AND poster: removes EVERY point within radiusM of the original
// first or last point (so a loop passing home again is hidden too) and starts a new segment after
// each removed run. Privacy cuts are never bridged by the replay estimator.
export function privacyFilter(points, { radiusM = TRIM_M } = {}) {
  const pts = cleanPoints(points); if (pts.length < 2) return [];
  const a = pts[0], z = pts.at(-1), out = []; let broke = false;
  for (const p of pts) {
    if (dist(p, a) <= radiusM || dist(p, z) <= radiusM) { broke = true; continue; }
    out.push(broke && out.length ? { ...p, breakBefore: true, breakReason: "privacy", privacyBreak: true } : p); broke = false;
  }
  return out;
}
export const metersToLonLat = (tl, x, y) => ({ lon: tl.lon0 + x / (R * RAD * Math.cos(tl.lat0 * RAD)), lat: tl.lat0 + y / (R * RAD) });

function hasPauseBetween(events, start, end) {
  return (events || []).some(event =>
    (event.type === "pause" || event.type === "resume") &&
    event.timestamp > start && event.timestamp <= end,
  );
}

function reconstructShortGpsGaps(segments, workout, cumByT) {
  const output = [];
  let estimatedGapCount = 0;
  const maxSpeed = ESTIMATED_GAP_SPEED_MPS[workout?.activityType] || 5;
  const events = workout?.events || [];
  for (const segment of segments) {
    if (!output.length) { output.push([...segment]); continue; }
    const previousSegment = output.at(-1), previous = previousSegment.at(-1), first = segment[0];
    const gapMs = first.timestamp - previous.timestamp;
    const averageSpeed = dist(previous, first) / Math.max(1, gapMs / 1000);
    const canEstimate = first.breakReason === "gps-gap" && !first.privacyBreak &&
      gapMs > 45_000 && gapMs <= MAX_ESTIMATED_GAP_MS &&
      averageSpeed <= maxSpeed &&
      !hasPauseBetween(events, previous.timestamp, first.timestamp);
    if (!canEstimate) { output.push([...segment]); continue; }

    const steps = Math.max(2, Math.min(24, Math.ceil(gapMs / 5_000)));
    const carriedDistance = cumByT.get(previous.timestamp) ?? 0;
    for (let step = 1; step < steps; step++) {
      const fraction = step / steps;
      previousSegment.push({
        lat: previous.lat + (first.lat - previous.lat) * fraction,
        lon: previous.lon + (first.lon - previous.lon) * fraction,
        timestamp: previous.timestamp + gapMs * fraction,
        accuracy: Math.max(previous.accuracy || 0, first.accuracy || 0),
        altitude: null,
        altitudeAccuracy: null,
        estimated: true,
        replayCum: carriedDistance,
      });
    }
    previousSegment.push({ ...first, breakBefore: false, breakReason: null });
    previousSegment.push(...segment.slice(1));
    estimatedGapCount++;
  }
  return { segments: output, estimatedGapCount };
}

export function buildTimeline(workout, { hideEnds = false, trimM = TRIM_M } = {}) {
  const points = cleanPoints(workout?.points, { activityType: workout?.activityType }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.timestamp));
  const raw0 = routeSegments({ ...workout, points });
  let cum = 0; const cumByT = new Map();
  raw0.forEach(s => s.forEach((p, i) => { if (i) cum += hav(s[i - 1], p); cumByT.set(p.timestamp, cum); }));
  const total = cum;
  const none = status => ({ segments: [], duration: 1, total, status, hideEnds, bounds: null, lat0: 0, lon0: 0, llBounds: null });
  if (!raw0.some(s => s.length > 1)) return none("none");
  let raw = raw0;
  if (hideEnds) {
    if (total < MIN_HIDE_TOTAL_M) return none("short");
    raw = routeSegments({ ...workout, points: privacyFilter(points, { radiusM: trimM }) });
  }
  const reconstructed = reconstructShortGpsGaps(raw, workout, cumByT);
  const use = reconstructed.segments.map(s => s.map(p => ({
    p,
    cum: cumByT.get(p.timestamp) ?? p.replayCum ?? 0,
  }))).filter(s => s.length > 1);
  if (!use.length) return none("short");
  const all = use.flat();
  const lat0 = all.reduce((a, q) => a + q.p.lat, 0) / all.length, lon0 = all.reduce((a, q) => a + q.p.lon, 0) / all.length;
  const kx = R * RAD * Math.cos(lat0 * RAD), ky = R * RAD;
  let v = 0;
  const segments = use.map(s => {
    const pts = s.map((q, i) => {
      if (i) v += Math.max(0, q.p.timestamp - s[i - 1].p.timestamp);
      return { lat: q.p.lat, lon: q.p.lon, t: q.p.timestamp, cum: q.cum, alt: gpsAlt(q.p),
        estimated: !!q.p.estimated, x: (q.p.lon - lon0) * kx, y: (q.p.lat - lat0) * ky, v };
    });
    return { pts, v0: pts[0].v, v1: v };
  });
  const xs = segments.flatMap(s => s.pts.map(p => p.x)), ys = segments.flatMap(s => s.pts.map(p => p.y));
  const las = all.map(q => q.p.lat), los = all.map(q => q.p.lon);
  return { segments, duration: Math.max(1, v), total, status: "ok", hideEnds, lat0, lon0,
    estimatedGapCount: reconstructed.estimatedGapCount,
    bounds: { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) },
    llBounds: { s: Math.min(...las), n: Math.max(...las), w: Math.min(...los), e: Math.max(...los) } };
}

// One measured location can anchor a live basemap; it is NOT a fabricated route.
export function buildLiveTimeline(workout) {
  const tl = buildTimeline(workout);
  if (tl.status === "ok") return tl;
  const p = cleanPoints(workout?.points).at(-1);
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return tl;
  const point = { ...p, x: 0, y: 0, cum: 0, alt: gpsAlt(p), v: 0 };
  return { ...tl, status: "ok", previewOnly: true, lat0: p.lat, lon0: p.lon,
    bounds: { x0: 0, x1: 0, y0: 0, y1: 0 }, llBounds: { w: p.lon, e: p.lon, s: p.lat, n: p.lat },
    segments: [{ pts: [point], v0: 0, v1: 0 }] };
}
export function stateAt(tl, vms) {
  if (!tl.segments.length) return null;
  const v = Math.min(tl.duration, Math.max(0, vms));
  let si = 0;
  for (let k = 0; k < tl.segments.length; k++) if (tl.segments[k].v0 <= v) si = k;
  const seg = tl.segments[si], pts = seg.pts, vv = Math.min(seg.v1, Math.max(seg.v0, v));
  let i = 0;
  while (i < pts.length - 2 && pts[i + 1].v <= vv) i++;
  const a = pts[i], b = pts[i + 1] || a, span = b.v - a.v, f = span > 0 ? Math.min(1, Math.max(0, (vv - a.v) / span)) : 0;
  const lerp = (p, q) => p + (q - p) * f;
  const cum = lerp(a.cum, b.cum);
  let j = i; while (j > 0 && vv - pts[j - 1].v <= 30000) j--;
  const ref = pts[j], dist = cum - ref.cum, dt = (vv - ref.v) / 1000;
  const estimated = !!(a.estimated || b.estimated);
  return { x: lerp(a.x, b.x), y: lerp(a.y, b.y), lat: lerp(a.lat, b.lat), lon: lerp(a.lon, b.lon), cum, v, seg: si, i, f, estimated,
    alt: a.alt !== null && b.alt !== null ? lerp(a.alt, b.alt) : null,
    pace: !estimated && dist > 8 && dt > 3 ? dt / (dist / 1000) : null, progress: v / tl.duration, done: v >= tl.duration };
}

// ---------- formatting ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const clock = ms => { const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
export const paceText = p => Number.isFinite(p) && p > 0 && p < 5999 ? Math.floor(p / 60) + ":" + String(Math.round(p % 60)).padStart(2, "0") + " /km" : "--";
export const kmText = m => Number.isFinite(m) ? (m / 1000).toFixed(2) + " km" : "--";
const LABELS = { run: "Run", walk: "Walk", cycle: "Ride", hike: "Hike" };

// Downloadable animated route card. Uses ONLY normalised projected points: no latitude,
// longitude or start coordinates, no external images or scripts. All text is escaped.
export function animatedCardSvg({ workout, owner, caption = "", hideEnds = true, color = "#e630f5" }) {
  const tl = buildTimeline(workout, { hideEnds });
  if (tl.status !== "ok") throw new Error(tl.status === "short" ? "The route is too short to hide its start and finish. Turn that option off to include the full route." : "This workout has no GPS route to animate.");
  const W = 720, H = 960, bx = 60, by = 250, bw = W - 120, bh = 460, b = tl.bounds;
  const sc = Math.min(bw / Math.max(b.x1 - b.x0, 1e-6), bh / Math.max(b.y1 - b.y0, 1e-6));
  const ox = bx + (bw - (b.x1 - b.x0) * sc) / 2, oy = by + (bh - (b.y1 - b.y0) * sc) / 2;
  const P = p => [(ox + (p.x - b.x0) * sc).toFixed(1), (oy + (b.y1 - p.y) * sc).toFixed(1)];
  const d = tl.segments.map(s => s.pts.map((p, i) => (i ? "L" : "M") + P(p).join(" ")).join("")).join("");
  const first = P(tl.segments[0].pts[0]), lastSeg = tl.segments.at(-1).pts, last = P(lastSeg.at(-1));
  const grid = []; for (let k = 0; k <= 8; k++) { grid.push(`<path d="M${bx + k * bw / 8} ${by - 20}V${by + bh + 20}" />`); } for (let k = 0; k <= 6; k++) grid.push(`<path d="M${bx - 20} ${by + k * bh / 6}H${bx + bw + 20}" />`);
  const s = workout.summary || {}, dur = clock((s.activeSeconds || 0) * 1000);
  const name = owner?.name || owner?.username || "";
  const cap = String(caption || "").slice(0, 120);
  const D = "9s";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(LABELS[workout.activityType] || "Workout")} route card">
<rect width="${W}" height="${H}" fill="#0f1419"/>
<g stroke="#ffffff" stroke-opacity=".08" stroke-width="1" fill="none">${grid.join("")}</g>
<path d="M0 ${H - 330}L${W} ${H - 380}V${H}H0Z" fill="${esc(color)}" opacity=".14"/>
<text x="60" y="120" fill="#ffffff" font-family="system-ui,sans-serif" font-size="64" font-weight="800" letter-spacing="2">ACTIVITY</text>
<text x="60" y="170" fill="${esc(color)}" font-family="system-ui,sans-serif" font-size="30" font-weight="700">${esc((LABELS[workout.activityType] || "Workout").toUpperCase())}</text>
<path d="${d}" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
<path d="${d}" fill="none" stroke="#ffffff" stroke-opacity=".28" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="${d}" pathLength="1" fill="none" stroke="${esc(color)}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1 1" stroke-dashoffset="1"><animate attributeName="stroke-dashoffset" from="1" to="0" dur="${D}" repeatCount="indefinite"/></path>
<circle cx="${first[0]}" cy="${first[1]}" r="14" fill="${POSITION_RED}" stroke="#fff" stroke-width="4"/>
<circle cx="${last[0]}" cy="${last[1]}" r="14" fill="${POSITION_RED}" stroke="#fff" stroke-width="4"/>
<circle r="36" fill="${POSITION_RED}" opacity=".34"><animateMotion dur="${D}" repeatCount="indefinite" path="${d}"/></circle>
<circle r="12" fill="${JET_FLAME_ORANGE}" opacity=".9"><animateMotion dur="${D}" repeatCount="indefinite" path="${d}"/></circle>
<circle r="12" fill="${POSITION_RED}" stroke="#fff" stroke-width="3"><animateMotion dur="${D}" repeatCount="indefinite" path="${d}"/></circle>
<g font-family="system-ui,sans-serif" fill="#fff">
<text x="60" y="${by + bh + 90}" font-size="54" font-weight="800">${esc(kmText(s.distanceM))}</text><text x="60" y="${by + bh + 120}" font-size="20" fill="#a2a8b0">Distance</text>
<text x="300" y="${by + bh + 90}" font-size="54" font-weight="800">${esc(dur)}</text><text x="300" y="${by + bh + 120}" font-size="20" fill="#a2a8b0">Time</text>
<text x="500" y="${by + bh + 90}" font-size="54" font-weight="800">${esc(paceText(s.paceSecondsPerKm).replace(" /km", ""))}</text><text x="500" y="${by + bh + 120}" font-size="20" fill="#a2a8b0">Pace /km</text>
${Number.isFinite(s.elevationGainM) && s.elevationGainM > 0 ? `<text x="60" y="${by + bh + 170}" font-size="26" font-weight="700">${Math.round(s.elevationGainM)} m</text><text x="150" y="${by + bh + 170}" font-size="18" fill="#a2a8b0">Climb, recorded GPS altitude</text>` : ""}
${name ? `<text x="60" y="${H - 110}" font-size="26" font-weight="700">${esc(name)}</text>` : ""}
${cap ? `<text x="60" y="${H - 72}" font-size="20" fill="#d6dae0">${esc(cap)}</text>` : ""}
<text x="60" y="${H - 34}" font-size="16" fill="#a2a8b0">Stylized aerial trace. The grid is a reference, not a map. No terrain data.${tl.hideEnds ? " Start and finish areas hidden." : ""}</text>
</g></svg>`;
}
