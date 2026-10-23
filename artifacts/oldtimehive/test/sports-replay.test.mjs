import test from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, stateAt, privacyFilter, cleanPoints, hav, animatedCardSvg } from "../app/sports-replay.js";
import { routeGeometry } from "../app/sports-card.js";

const start = 1791650000000;
const point = (n, lat, lon, extra = {}) => ({ timestamp: start + n * 10000, lat, lon, accuracy: 5, ...extra });
const route = points => ({ activityType: "run", points, events: [], startedAt: start,
  endedAt: points.at(-1)?.timestamp, summary: { distanceM: 3500, activeSeconds: 1200, paceSecondsPerKm: 343, elevationGainM: null } });

test("replay follows timestamps, not equal point spacing; missing altitude stays unavailable", () => {
  const w = route([point(0, 40, -74), point(1, 40.0003, -74), point(4, 40.0006, -74)]);
  const tl = buildTimeline(w);
  const halfway = stateAt(tl, 25000);
  assert.ok(Math.abs(halfway.lat - 40.00045) < 0.000001);
  assert.equal(halfway.alt, null);
  assert.equal(stateAt(tl, tl.duration).done, true);
});

test("pauses and poor GPS fixes create breaks without an invented connecting line", () => {
  const w = route([point(0, 40, -74), point(1, 40.0003, -74), point(2, 40.0006, -74, { accuracy: 200 }),
    point(3, 40.001, -74), point(4, 40.0013, -74)]);
  assert.equal(buildTimeline(w).segments.length, 2);
  assert.doesNotThrow(() => cleanPoints([null, {}, ...w.points]));
  w.events = [{ type: "pause", timestamp: start + 15000 }];
  assert.equal(buildTimeline(w).segments.length, 2);
});

test("endpoint hiding protects loops returning near home and splits removed areas", () => {
  const pts = [];
  for (let loop = 0; loop < 2; loop++) for (let i = 0; i <= 200; i++) {
    const angle = i / 200 * Math.PI * 2;
    pts.push(point(pts.length, 40 + 0.004 * Math.sin(angle), -74 + 0.006 * (1 - Math.cos(angle))));
  }
  const w = route(pts), safe = privacyFilter(pts);
  assert.ok(safe.length > 20);
  assert.ok(safe.some(p => p.breakBefore));
  assert.ok(safe.every(p => hav(p, pts[0]) > 250 && hav(p, pts.at(-1)) > 250));
  assert.ok(buildTimeline(w, { hideEnds: true }).segments.length >= 2);
  assert.ok(routeGeometry(w, { trim: true }).segments.length >= 2);
  assert.ok(routeGeometry(w, { trim: false }).segments.length);
});

test("animated export escapes user content and contains no raw location metadata", () => {
  const pts = Array.from({ length: 100 }, (_, n) => point(n, 40.7131234 + n * 0.0003, -74.0076543));
  const svg = animatedCardSvg({ workout: route(pts), hideEnds: true,
    owner: { name: "<script>bad</script>" }, caption: "<script>alert(1)</script>" });
  assert.ok(svg.includes("<animate"));
  assert.ok(!svg.includes("<script>"));
  assert.ok(!svg.includes("40.7131234"));
  assert.ok(!svg.includes("-74.0076543"));
  assert.ok(!svg.includes("latitude"));
  assert.ok(!svg.includes("<image"));
});
