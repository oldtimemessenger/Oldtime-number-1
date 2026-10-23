import test from "node:test";
import assert from "node:assert/strict";
import { FLYOVER_PHASES, flyoverCameraForState, flyoverRouteProgress, jetFlameFeature, replayCameraProgress, replayRouteFeatureCollection } from "./sports-replay-vector-map.js";
import { OPENFREEMAP_VIDEO_CREDIT, sportsRouteColor } from "./sports-vector-style.js";
import { buildTimeline, cleanPoints, stateAt } from "./sports-replay.js";
import { calculateWorkout } from "../../../lib/sports/metrics.js";

const timeline = {
  segments: [
    { pts: [{ lon: -73, lat: 40 }, { lon: -72.999, lat: 40.001 }, { lon: -72.998, lat: 40.002 }] },
    { pts: [{ lon: -72.97, lat: 40.03 }, { lon: -72.969, lat: 40.031 }] },
  ],
};

test("replay vector line grows only through the current recorded point", () => {
  const data = replayRouteFeatureCollection(timeline, {
    seg: 0, i: 1, f: 0.5, lon: -72.9985, lat: 40.0015,
  });
  assert.equal(data.features.length, 1);
  assert.deepEqual(data.features[0].geometry.coordinates, [
    [-73, 40], [-72.999, 40.001], [-72.9985, 40.0015],
  ]);
});

test("route cleanup preserves a real corner while removing meter-scale lateral jitter", () => {
  const points = [
    { lat: 0, lon: 0, timestamp: 1000, accuracy: 4 },
    { lat: 0.000001, lon: 0.00005, timestamp: 2000, accuracy: 4 },
    { lat: 0, lon: 0.0001, timestamp: 3000, accuracy: 4 },
    { lat: 0.00005, lon: 0.0001, timestamp: 4000, accuracy: 4 },
    { lat: 0.0001, lon: 0.0001, timestamp: 5000, accuracy: 4 },
  ];
  const cleaned = cleanPoints(points);
  assert.ok(cleaned.length < points.length);
  assert.ok(cleaned.some(p => p.lat === 0 && p.lon === 0.0001), "the 90-degree turn remains in the route");
  assert.deepEqual(cleaned[0], points[0]);
  assert.deepEqual(cleaned.at(-1), points.at(-1));
});

test("distance uses useful one-second walking fixes rather than dropping every sub-3m step", () => {
  const workout = { activityType: "walk", startedAt: 1000, endedAt: 4000,
    events: [{ type: "start", timestamp: 1000 }, { type: "finish", timestamp: 4000 }],
    points: [0, 1, 2, 3].map(i => ({ lat: i * 0.00002, lon: 0, timestamp: 1000 + i * 1000, accuracy: 5 })) };
  assert.ok(calculateWorkout(workout).distanceM >= 6);
});

test("replay keeps GPS gaps as separate lines when it reaches a later segment", () => {
  const data = replayRouteFeatureCollection(timeline, {
    seg: 1, i: 1, f: 0, lon: -72.969, lat: 40.031,
  });
  assert.equal(data.features.length, 2);
  assert.deepEqual(data.features.map(feature => feature.geometry.coordinates), [
    [[-73, 40], [-72.999, 40.001], [-72.998, 40.002]],
    [[-72.97, 40.03], [-72.969, 40.031]],
  ]);
});

test("a short plausible GPS interruption is a dashed estimate, not recorded distance", () => {
  const workout = {
    activityType: "run", startedAt: 1000, endedAt: 91000,
    events: [{ type: "start", timestamp: 1000 }, { type: "finish", timestamp: 91000 }],
    points: [
      { lat: 0, lon: 0, timestamp: 1000, accuracy: 5 },
      { lat: 0.0002, lon: 0, timestamp: 11000, accuracy: 5 },
      { lat: 0.0004, lon: 0, timestamp: 21000, accuracy: 5 },
      { lat: 0.0014, lon: 0, timestamp: 81000, accuracy: 5 },
      { lat: 0.0016, lon: 0, timestamp: 91000, accuracy: 5 },
    ],
  };
  const timeline = buildTimeline(workout);
  assert.equal(timeline.estimatedGapCount, 1);
  assert.equal(timeline.segments.length, 1);
  assert.ok(Math.abs(timeline.total - calculateWorkout(workout).distanceM) < 1);
  const inGap = stateAt(timeline, 50_000);
  assert.equal(inGap.estimated, true);
  assert.equal(inGap.pace, null);
  const completeRoute = replayRouteFeatureCollection(timeline, stateAt(timeline, timeline.duration));
  assert.deepEqual(completeRoute.features.map(feature => feature.properties.estimated), [false, true, false]);
});

test("replay does not estimate a paused or long GPS interruption", () => {
  const base = {
    activityType: "run", startedAt: 1000, endedAt: 301000,
    points: [
      { lat: 0, lon: 0, timestamp: 1000, accuracy: 5 },
      { lat: 0.0002, lon: 0, timestamp: 11000, accuracy: 5 },
      { lat: 0.0004, lon: 0, timestamp: 21000, accuracy: 5 },
      { lat: 0.0014, lon: 0, timestamp: 81000, accuracy: 5 },
      { lat: 0.0016, lon: 0, timestamp: 91000, accuracy: 5 },
    ],
  };
  const paused = buildTimeline({ ...base, events: [
    { type: "start", timestamp: 1000 }, { type: "pause", timestamp: 30000 },
    { type: "resume", timestamp: 70000 }, { type: "finish", timestamp: 91000 },
  ] });
  assert.equal(paused.estimatedGapCount, 0);
  assert.equal(paused.segments.length, 2);

  const long = buildTimeline({ ...base, endedAt: 301000, events: [
    { type: "start", timestamp: 1000 }, { type: "finish", timestamp: 301000 },
  ], points: base.points.map((point, index) => ({ ...point, timestamp: index < 3 ? point.timestamp : point.timestamp + 180_000 })) });
  assert.equal(long.estimatedGapCount, 0);
  assert.equal(long.segments.length, 2);
});

test("replay does not create a route before it has a timeline position", () => {
  assert.deepEqual(replayRouteFeatureCollection(timeline, null), {
    type: "FeatureCollection", features: [],
  });
});

test("jet flame wake follows the active GPS segment and extends behind the moving marker", () => {
  const state = { seg: 0, i: 1, lon: -72.999, lat: 40.001, f: 0.5, pace: 300 };
  const flame = jetFlameFeature(timeline, state, 0);
  const coordinates = flame.features[0].geometry.coordinates;
  assert.equal(coordinates.length, 4);
  assert.ok(coordinates[0][1] < state.lat, "northbound movement leaves its wake behind the marker");
  assert.deepEqual(coordinates.at(-1), [state.lon, state.lat]);

  const gapState = { seg: 1, i: 0, lon: -72.97, lat: 40.03 };
  const gapFlame = jetFlameFeature(timeline, gapState, 0).features[0].geometry.coordinates;
  assert.ok(gapFlame[0][0] < gapState.lon, "eastbound movement leaves its wake west of the current segment");
  assert.equal(gapFlame.at(-1)[1], gapState.lat, "the wake attaches to the real GPS point");
});

test("jet flame flickers during playback and stays steady with reduced motion", () => {
  const state = { seg: 0, i: 1, lon: -72.999, lat: 40.001, pace: 300 };
  const first = jetFlameFeature(timeline, state, 0);
  const later = jetFlameFeature(timeline, state, 500);
  assert.notDeepEqual(first, later);
  assert.deepEqual(
    jetFlameFeature(timeline, state, 0, true),
    jetFlameFeature(timeline, state, 500, true),
  );
});

test("flyover establishes, follows low, reveals the full route overhead, and pulls back", () => {
  const tl = { ...timeline, llBounds: { w: -73, e: -72.969, s: 40, n: 40.031 }, lon0: -72.99, lat0: 40.015 };
  const state = { seg: 0, i: 1, lon: -72.999, lat: 40.001, f: 0.5 };
  const fit = { center: [-72.9845, 40.0155], zoom: 12.5 };
  const start = flyoverCameraForState(tl, state, 0, fit);
  const chase = flyoverCameraForState(tl, state, 0.2, fit);
  const overhead = flyoverCameraForState(tl, state, FLYOVER_PHASES.overheadEnd - 0.0001, fit);
  const routeReveal = flyoverCameraForState(tl, state, FLYOVER_PHASES.overheadEnd, fit);
  const end = flyoverCameraForState(tl, state, 1, fit);

  assert.equal(start.phase, "establish");
  assert.deepEqual(start.center, fit.center);
  assert.equal(start.pitch, 0);
  assert.equal(chase.phase, "chase");
  assert.equal(chase.pitch, 73);
  assert.ok(chase.zoom > 17.5 && chase.zoom <= 18.3);
  const cameraAheadMeters = Math.hypot(
    (chase.center[0] - state.lon) * 111320 * Math.cos(state.lat * Math.PI / 180),
    (chase.center[1] - state.lat) * 111320,
  );
  assert.ok(cameraAheadMeters >= 34 && cameraAheadMeters <= 85);
  assert.equal(overhead.phase, "overhead");
  assert.ok(Math.abs(overhead.center[0] - fit.center[0]) < 0.00001);
  assert.ok(Math.abs(overhead.center[1] - fit.center[1]) < 0.00001);
  assert.ok(overhead.pitch < 0.01);
  assert.equal(routeReveal.phase, "pullback");
  assert.deepEqual(routeReveal.center, fit.center);
  assert.equal(routeReveal.zoom, fit.zoom);
  assert.equal(end.phase, "pullback");
  assert.deepEqual(end.center, fit.center);
  assert.equal(end.zoom, fit.zoom - 0.55);
});

test("flyover performs its single full orbit while holding at an in-route GPS point", () => {
  const tl = { ...timeline, llBounds: { w: -73, e: -72.969, s: 40, n: 40.031 }, lon0: -72.99, lat0: 40.015 };
  const state = { seg: 0, i: 1, lon: -72.999, lat: 40.001, f: 0.5 };
  const fit = { center: [-72.9845, 40.0155], zoom: 12.5 };
  const chaseEnd = flyoverCameraForState(tl, state, FLYOVER_PHASES.chaseToOrbitEnd, fit);
  const halfOrbit = flyoverCameraForState(tl, state, (FLYOVER_PHASES.chaseToOrbitEnd + FLYOVER_PHASES.orbitEnd) / 2, fit);
  const orbitEnd = flyoverCameraForState(tl, state, FLYOVER_PHASES.orbitEnd - 0.000001, fit);
  const follow = flyoverCameraForState(tl, state, FLYOVER_PHASES.orbitEnd + 0.001, fit);

  assert.equal(chaseEnd.phase, "orbit");
  assert.ok(Math.abs(halfOrbit.bearing - chaseEnd.bearing - 180) < 1e-6);
  assert.ok(Math.abs(orbitEnd.bearing - chaseEnd.bearing - 360) < 1e-6);
  assert.deepEqual(orbitEnd.center, chaseEnd.center);
  assert.equal(orbitEnd.phase, "orbit");
  assert.equal(follow.phase, "chase");
  assert.equal(orbitEnd.pitch, 73);
  assert.ok(Math.abs(((follow.bearing - orbitEnd.bearing + 540) % 360) - 180) < 0.01);
});

test("flyover route heading uses the active GPS segment without joining a gap", () => {
  const separated = {
    segments: [
      timeline.segments[0],
      { pts: [{ lon: -72.97, lat: 40.03 }, { lon: -72.97, lat: 40.029 }] },
    ],
    llBounds: timeline.llBounds,
    lon0: -72.985,
    lat0: 40.015,
  };
  const state = { seg: 1, i: 0, lon: -72.97, lat: 40.03, f: 0 };
  const camera = flyoverCameraForState(separated, state, 0.2, { center: [-72.985, 40.015], zoom: 12 });
  assert.ok(Math.abs(camera.bearing - 180) < 0.01);
  assert.equal(flyoverRouteProgress(0), 0);
  assert.ok(Math.abs(flyoverRouteProgress(FLYOVER_PHASES.chaseToOrbitEnd) - 0.46) < 1e-12);
  assert.equal(flyoverRouteProgress(0.44), 0.46);
  assert.ok(Math.abs(flyoverRouteProgress(FLYOVER_PHASES.orbitEnd) - 0.46) < 1e-12);
  assert.equal(flyoverRouteProgress(FLYOVER_PHASES.chaseEnd), 1);
  assert.equal(flyoverRouteProgress(1), 1);
});

test("on-screen flyover sends camera progress, stays close while paused, and restores fit on request", () => {
  assert.equal(replayCameraProgress({ enabled: false, playing: true, routeProgress: 0.5 }), null);
  assert.equal(replayCameraProgress({ enabled: true, playing: false }), FLYOVER_PHASES.chaseToOrbitEnd);
  assert.equal(replayCameraProgress({ enabled: true, playing: true, routeProgress: 0.44 }), 0.46);
  assert.equal(replayCameraProgress({ enabled: true, playing: false, pausedProgress: 0.6 }), 0.6);
});

test("flyover chase adjusts for activity speed and visible building density", () => {
  const tl = { ...timeline, llBounds: { w: -73, e: -72.969, s: 40, n: 40.031 } };
  const state = { seg: 0, i: 1, lon: -72.999, lat: 40.001, f: 0.5 };
  const fit = { center: [-72.9845, 40.0155], zoom: 12.5 };
  const slow = flyoverCameraForState(tl, { ...state, pace: 600 }, 0.2, fit);
  const fast = flyoverCameraForState(tl, { ...state, pace: 240 }, 0.2, fit);
  const dense = flyoverCameraForState(tl, { ...state, pace: 600 }, 0.2, fit, { density: 1 });
  assert.ok(fast.zoom < slow.zoom);
  assert.ok(dense.zoom < slow.zoom);
  assert.ok(slow.zoom > 18, "the cinematic chase camera frames the street close-up");
});
test("video attribution follows OpenFreeMap's required wording and replay shares the live route palette", () => {
  assert.equal(OPENFREEMAP_VIDEO_CREDIT, "OpenFreeMap © OpenMapTiles Data from OpenStreetMap");
  assert.equal(sportsRouteColor({ activityType: "run" }), "#ed2339");
  assert.equal(sportsRouteColor({ activityType: "cycle" }), "#4765d5");
});
