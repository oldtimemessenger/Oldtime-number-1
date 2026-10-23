import test from "node:test";
import assert from "node:assert/strict";
import { imageryPlan, contiguousUS } from "./sports-imagery.js";
import { buildLiveTimeline, stateAt } from "./sports-replay.js";
const timeline = (lat = 40.75, lon = -73.97) => ({
  status: "ok", lat0: lat, lon0: lon,
  bounds: { x0: -750, x1: 750, y0: -400, y1: 400 },
  llBounds: { w: lon - .01, e: lon + .01, s: lat - .01, n: lat + .01 },
});
test("U.S. imagery stays bounded and samples the actual route extent", () => {
  const p = imageryPlan(timeline());
  assert.ok((p.x1 - p.x0 + 1) * (p.y1 - p.y0 + 1) <= 16);
  assert.ok(p.u0 >= 0 && p.v0 >= 0 && p.u1 > p.u0 && p.v1 > p.v0);
  assert.match(p.source.url(p.z, p.x0, p.y0), /nationalmap\.gov/);
});
test("global satellite overview is honest and cropped even for short routes", () => {
  const tl = timeline(48.85, 2.35), p = imageryPlan(tl, "nasa");
  assert.equal(contiguousUS(tl), false); assert.ok(p.z <= 8);
  assert.ok(p.u1 - p.u0 < 100);
  assert.match(p.source.detail, /not live or street-level/);
});
test("photo imagery exposes its real source type and export attribution", () => {
  const usgs = imageryPlan(timeline(), "usgs").source;
  const nasa = imageryPlan(timeline(48.85, 2.35), "nasa").source;
  const sentinel = imageryPlan(timeline(48.85, 2.35), "copernicus").source;
  assert.equal(usgs.kind, "aerial");
  assert.match(usgs.credit, /U\.S\. Geological Survey/);
  assert.equal(nasa.kind, "aerial");
  assert.match(nasa.credit, /NASA Earth Observatory/);
  assert.equal(sentinel.kind, "aerial");
});
test("missing routes and dateline crossings fail explicitly", () => {
  assert.throws(() => imageryPlan({ status: "none" }), /No GPS/);
  assert.throws(() => imageryPlan(timeline(40, 179.999)), /extent/);
});
test("one real GPS fix anchors a map without inventing a route", () => {
  const p = { lat: 40.75, lon: -73.97, timestamp: 1000, accuracy: 8 };
  const tl = buildLiveTimeline({ points: [p], events: [] });
  assert.equal(tl.previewOnly, true); assert.equal(tl.total, 0);
  assert.equal(tl.segments[0].pts.length, 1);
  assert.equal(stateAt(tl, 0).lat, p.lat); assert.equal(stateAt(tl, 0).pace, null);
  assert.equal(buildLiveTimeline({ points: [] }).status, "none");
});
test("higher-resolution global provider needs no account or paid API token", () => {
  const p = imageryPlan(timeline(48.85, 2.35), "copernicus");
  assert.ok(p.z <= 15); assert.match(p.source.detail, /10 m/);
  assert.ok((p.x1 - p.x0 + 1) * (p.y1 - p.y0 + 1) <= 16);
});
test("street maps use labeled free OSM tiles and mandatory attribution", () => {
  const p = imageryPlan(timeline(40.75, -73.97), "street");
  assert.equal(p.source.kind, "street"); assert.match(p.source.credit, /OpenStreetMap/);
  assert.match(p.source.url(p.z, p.x0, p.y0), /^https:\/\/tile\.openstreetmap\.org\//);
  assert.ok((p.x1 - p.x0 + 1) * (p.y1 - p.y0 + 1) <= 16);
});
