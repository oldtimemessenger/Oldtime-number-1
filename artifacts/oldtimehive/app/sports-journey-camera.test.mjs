import test from "node:test";
import assert from "node:assert/strict";
import { journeyCamera } from "./sports-journey-camera.js";
const tl = { bounds: { x0: 0, x1: 4000, y0: 0, y1: 1200 } };
test("Full Route stays fitted and stable while timestamps advance", () => {
  const a = journeyCamera(tl, { x: 0, y: 0, progress: 0 }, false, { street: true });
  const b = journeyCamera(tl, { x: 3600, y: 1000, progress: .9 }, false, { street: true });
  assert.deepEqual(a, b); assert.equal(a.tx, 2000); assert.equal(a.ty, 600); assert.equal(a.yaw, 0);
  assert.ok(a.D > 4000);
});
test("Follow Journey uses the timestamp-derived marker, bounded street zoom and no suggested route", () => {
  const state = { x: 170, y: 320, progress: .3 };
  const camera = journeyCamera(tl, state, true, { street: true });
  assert.equal(camera.tx, state.x); assert.equal(camera.ty, state.y);
  assert.equal(camera.yaw, 0); assert.ok(camera.D >= 120 && camera.D <= 600);
  assert.equal(state.progress, .3);
});
