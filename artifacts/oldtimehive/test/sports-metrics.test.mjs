import test from "node:test";
import assert from "node:assert/strict";
import { calculateWorkout, privateRoute, metres } from "../../../lib/sports/metrics.js";
import { routeGeometry, statRows } from "../app/sports-card.js";
const start = 1791600000000;
const point = (n, timestamp = start + n * 5000) => ({ lat: 40 + n * .0001, lon: -73, timestamp, accuracy: 5 });
const workout = () => ({ activityType: "run", startedAt: start, endedAt: start + 500000,
  points: Array.from({ length: 101 }, (_, i) => point(i)),
  events: [{ type: "start", timestamp: start }, { type: "finish", timestamp: start + 500000 }] });
test("real sampled route yields distance, active duration and pace", () => {
  const s = calculateWorkout(workout());
  assert.ok(s.distanceM > 1100 && s.distanceM < 1120);
  assert.equal(s.activeSeconds, 500);
  assert.ok(s.paceSecondsPerKm > 440 && s.paceSecondsPerKm < 460);
  assert.equal(s.elevationGainM, null);
});
test("card duration uses active time consistently with history and live recording", () => {
  assert.equal(statRows({ summary: { activeSeconds: 94, movingSeconds: 30, distanceM: 50 } })[1][1], "1:34");
});
test("pause time is excluded and pause movement never bridges", () => {
  const w = workout(); w.events.splice(1, 0, { type: "pause", timestamp: start + 100000 }, { type: "resume", timestamp: start + 200000 });
  w.points = w.points.filter(p => p.timestamp <= start + 100000 || p.timestamp >= start + 200000);
  assert.equal(calculateWorkout(w).activeSeconds, 400);
  assert.ok(calculateWorkout(w).distanceM < 950);
});
test("teleports, long GPS gaps and poor accuracy do not inflate distance", () => {
  const w = workout(); w.points = [point(0), { ...point(1), lat: 41 }, point(2)];
  assert.equal(calculateWorkout(w).distanceM, 0);
  w.points = [point(0), point(20)]; assert.equal(calculateWorkout(w).distanceM, 0);
  w.points = [point(0), { ...point(1), accuracy: 100 }]; assert.equal(calculateWorkout(w).distanceM, 0);
});
test("millisecond geolocation timestamps produce a continuous route", () => {
  const geo = routeGeometry(workout());
  assert.equal(geo.segments.length, 1);
  assert.equal(geo.segments[0].length, 101);
});
test("resume segments and GPS gaps are not joined on exported cards", () => {
  const w = workout(); w.points[50].breakBefore = true;
  assert.equal(routeGeometry(w).segments.length, 2);
});
test("route sharing removes at least 250m from both ends", () => {
  const w = workout(), route = privateRoute(w);
  assert.ok(metres(w.points[0], route[0][0]) >= 250);
  assert.ok(metres(w.points.at(-1), route.at(-1).at(-1)) >= 250);
  assert.equal(routeGeometry({ ...w, points: w.points.slice(0, 20) }, { trim: true }).segments, undefined);
});
