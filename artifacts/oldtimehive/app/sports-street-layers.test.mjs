import test from "node:test";
import assert from "node:assert/strict";
import { streetLayers, checkpoints, clampStreetView, bindStreetGestures, heatCells } from "./sports-street-layers.js";
test("heat aggregates only this journey's valid recorded points and caches the result", () => {
  const tl = { segments: [{ pts: [{ x: 5, y: 8 }, { x: 20, y: 9 }, { x: 200, y: 200 }, { x: NaN, y: 0 }] }] };
  const cells = heatCells(tl);
  assert.equal(cells.length, 2);
  assert.equal(cells[0].count, 2);
  assert.strictEqual(heatCells(tl), cells);
  assert.deepEqual(heatCells(null), []);
});
test("distance tokens interpolate only measured segments and never bridge GPS gaps", () => {
  const tl = { total: 1100, segments: [{ pts: [{ x: 0, y: 0, cum: 0 }, { x: 600, y: 0, cum: 600 }] },
    { pts: [{ x: 900, y: 0, cum: 800 }, { x: 1200, y: 0, cum: 1100 }] }] };
  assert.deepEqual(checkpoints(tl, 499).map(p => p.distanceM), [250]);
  assert.deepEqual(checkpoints(tl).map(p => p.distanceM), [250, 500, 1000]);
  assert.equal(checkpoints(tl)[0].x, 250);
});
test("privacy-trimmed endpoints do not regain hidden distance tokens", () => {
  const tl = { total: 600, segments: [{ pts: [{ x: 0, y: 0, cum: 300 }, { x: 300, y: 0, cum: 600 }] }] };
  assert.deepEqual(checkpoints(tl).map(p => p.distanceM), [500]);
});
test("layer values are strict, camera zoom/pan bounded, headless gestures safe", () => {
  assert.deepEqual(streetLayers({ pace: true, markers: "false", fake: true }), { route: true, markers: true, streets: true, pace: true, collectibles: false, heat: false });
  assert.deepEqual(clampStreetView({ zoom: 100, x: 999, y: -999 }, { x0: 0, x1: 0, y0: 0, y1: 0 }, 400), { zoom: 8, x: 80, y: -80 });
  assert.doesNotThrow(() => bindStreetGestures({}, {}, () => {})());
});
