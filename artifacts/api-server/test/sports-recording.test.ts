import test from "node:test";
import assert from "node:assert/strict";
import { recordingSchema, calculateWorkout } from "../src/lib/sports-recording";
const start = Date.now() - 600000;
const recording = () => ({ activityType: "walk", startedAt: start, endedAt: start + 20000,
  points: [{ lat: 40, lon: -73, timestamp: start, accuracy: 5 },
    { lat: 40.0001, lon: -73, timestamp: start + 10000, accuracy: 5 }],
  events: [{ type: "start", timestamp: start }, { type: "finish", timestamp: start + 20000 }] });
test("completed recording yields server-calculated metrics", () => {
  const parsed = recordingSchema.parse(recording());
  assert.ok(calculateWorkout(parsed).distanceM >= 11);
});
test("client-supplied totals, invalid positions and reversed timestamps are rejected", () => {
  assert.equal(recordingSchema.safeParse({ ...recording(), summary: { distanceM: 1000000 } }).success, false);
  const w = recording(); w.points[1].lat = 999;
  assert.equal(recordingSchema.safeParse(w).success, false);
  w.points[1].lat = 40; w.points[1].timestamp = start - 1;
  assert.equal(recordingSchema.safeParse(w).success, false);
});
test("GPS points during a pause and impossible event state transitions are rejected", () => {
  const w = recording(); w.events.splice(1, 0, { type: "pause", timestamp: start + 5000 }, { type: "resume", timestamp: start + 15000 });
  assert.equal(recordingSchema.safeParse(w).success, false);
  w.points.pop(); assert.equal(recordingSchema.safeParse(w).success, true);
  w.events.splice(2, 0, { type: "pause", timestamp: start + 9000 });
  assert.equal(recordingSchema.safeParse(w).success, false);
});
test("in-progress and paused workouts can be safely checkpointed in the cloud", () => {
  const active = recording();
  active.endedAt = null;
  active.events = [{ type: "start", timestamp: start }];
  active.points[1].timestamp = start + 10000;
  assert.equal(recordingSchema.safeParse(active).success, true);

  const paused = { ...active, events: [{ type: "start", timestamp: start }, { type: "pause", timestamp: start + 15000 }] };
  assert.equal(recordingSchema.safeParse(paused).success, true);
  const pointAfterPause = { ...paused, points: [{ ...active.points[1], timestamp: start + 16000 }] };
  assert.equal(recordingSchema.safeParse(pointAfterPause).success, false);
});
test("active workouts cannot claim a finish time without a finish event", () => {
  const active = recording();
  active.endedAt = null;
  assert.equal(recordingSchema.safeParse(active).success, false);
});
