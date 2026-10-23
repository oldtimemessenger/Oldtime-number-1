export const ACTIVITY_TYPES = ["run", "walk", "cycle", "hike"];
export const MAX_SPEED_METRES_PER_SECOND = Object.freeze({ run: 15, walk: 5, cycle: 40, hike: 6 });
export function metres(a, b) {
  const rad = Math.PI / 180, lat = (b.lat - a.lat) * rad, lon = (b.lon - a.lon) * rad;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(lon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function routeSegments(workout) {
  const result = []; let segment = [];
  const pauses = (workout.events || []).filter(e => e.type === "pause");
  for (const p of workout.points || []) {
    const prev = segment.at(-1);
    if (prev && (p.timestamp - prev.timestamp > 45000 || p.breakBefore ||
      pauses.some(e => e.timestamp > prev.timestamp && e.timestamp <= p.timestamp) ||
      metres(prev, p) / Math.max(.001, (p.timestamp - prev.timestamp) / 1000) > MAX_SPEED_METRES_PER_SECOND[workout.activityType])) {
      result.push(segment); segment = [];
    }
    segment.push(p);
  }
  if (segment.length) result.push(segment);
  return result;
}
export function calculateWorkout(workout, now = Date.now()) {
  const end = workout.endedAt || now, start = workout.startedAt;
  let activeMs = 0, open = start;
  for (const e of workout.events || []) {
    if (e.type === "pause" || e.type === "finish") {
      if (open !== null) activeMs += Math.max(0, Math.min(end, e.timestamp) - open);
      open = null;
    } else if (e.type === "resume" && open === null) open = e.timestamp;
  }
  if (open !== null) activeMs += Math.max(0, end - open);
  const flags = new Set(), segments = routeSegments(workout);
  if (segments.length > 1) flags.add("gps-gaps");
  let distanceM = 0, movingSeconds = 0, elevationGainM = 0, altitudePairs = 0;
  for (const segment of segments) for (let i = 1; i < segment.length; i++) {
    const a = segment[i - 1], b = segment[i], dt = (b.timestamp - a.timestamp) / 1000;
    if (a.accuracy > 50 || b.accuracy > 50 || dt <= 0) { flags.add("poor-accuracy"); continue; }
    const distance = metres(a, b);
    // Preserve ordinary one-second walking fixes; suppress sub-metre drift and near-stationary noise.
    const reportedAccuracy = Math.max(0, (a.accuracy || 0) + (b.accuracy || 0)) / 2;
    const noiseFloor = Math.max(.8, Math.min(2.5, reportedAccuracy * .2));
    if (distance < noiseFloor || distance / dt < .35) continue;
    distanceM += distance; movingSeconds += dt;
    if (Number.isFinite(a.altitude) && Number.isFinite(b.altitude) &&
      a.altitudeAccuracy <= 10 && b.altitudeAccuracy <= 10) {
      const gain = b.altitude - a.altitude;
      if (gain > 3 && gain < 30) elevationGainM += gain;
      altitudePairs++;
    }
  }
  if (!(workout.points || []).length) flags.add("no-gps");
  const activeSeconds = Math.round(activeMs / 1000);
  return { distanceM: Math.round(distanceM), elapsedSeconds: Math.max(0, Math.round((end - start) / 1000)),
    activeSeconds, movingSeconds: Math.min(activeSeconds, Math.round(movingSeconds)),
    paceSecondsPerKm: distanceM > 0 ? Math.round(activeSeconds / (distanceM / 1000)) : null,
    speedKmh: activeSeconds > 0 ? Math.round(distanceM / activeSeconds * 3.6 * 100) / 100 : 0,
    elevationGainM: altitudePairs >= 3 ? Math.round(elevationGainM) : null, flags: [...flags] };
}
export function privateRoute(workout, trimMetres = 250) {
  const segments = routeSegments(workout).map(s => [...s]);
  let remaining = trimMetres;
  while (segments.length && remaining > 0) {
    const s = segments[0];
    if (s.length < 2) { segments.shift(); continue; }
    remaining -= metres(s[0], s[1]); s.shift();
  }
  remaining = trimMetres;
  while (segments.length && remaining > 0) {
    const s = segments.at(-1);
    if (s.length < 2) { segments.pop(); continue; }
    remaining -= metres(s.at(-1), s.at(-2)); s.pop();
  }
  return segments.filter(s => s.length > 1);
}
