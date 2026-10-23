import test from "node:test";
import assert from "node:assert/strict";
import { coverPlan, pinchRect, zoomFromPinch, shouldMirror, lockAspect, cameraConstraints } from "./creative-capture-geometry.js";
test("cover plan fills destination and crops landscape source centrally", () => {
  const p = coverPlan(1920, 1080, 1080, 1920);
  assert.ok(Math.abs(p.dh - 1920) < 1e-9 && p.dw > 1080 && p.dx < 0 && p.dy === 0);
});
test("mirror only selfie; constraints carry no zoom", () => {
  assert.equal(shouldMirror("user"), true); assert.equal(shouldMirror("environment"), false);
  assert.equal(cameraConstraints("environment").video.zoom, undefined);
});
test("pinch clamps zoom and rect", () => {
  assert.equal(zoomFromPinch(1, 100, 1000, 1, 4), 4);
  assert.equal(zoomFromPinch(2, 0, 50, 1, 4), 2);
  const r = pinchRect({ x: .1, y: .1, width: .5, height: .5 }, 100, 50);
  assert.ok(Math.abs(r.width - .25) < 1e-9 && r.x > .1);
  assert.equal(pinchRect({ x: 0, y: 0, width: .9, height: .9 }, 10, 100).width, 1);
});
test("lock aspect keeps rect inside", () => {
  const r = lockAspect({ x: 0, y: 0, width: 1, height: 1 }, 1, 16 / 9);
  assert.ok(Math.abs(r.width * 16 / 9 / r.height - 1) < 1e-9);
});
import { panCrop, zoomCrop } from "./creative-capture-geometry.js";
test("pan moves crop opposite the drag and stays inside the asset", () => {
  const asset = { w: 2000, h: 1000 }, out = { w: 1000, h: 1000 };
  const r = panCrop({ x: .25, y: 0, width: .5, height: 1 }, 100, 0, asset, out);
  assert.ok(r.x < .25 && r.x >= 0);
  assert.equal(panCrop({ x: 0, y: 0, width: .5, height: 1 }, 5000, 0, asset, out).x, 0);
});
test("zoom keeps focal point and clamps to full frame", () => {
  const asset = { w: 1000, h: 1000 }, out = { w: 1000, h: 1000 };
  const z = zoomCrop({ x: 0, y: 0, width: 1, height: 1 }, 2, { x: 500, y: 500 }, asset, out);
  assert.ok(Math.abs(z.x - .25) < 1e-9 && z.width === .5);
  assert.equal(zoomCrop(z, .1, { x: 500, y: 500 }, asset, out).width, 1);
});
import { naturalZoom } from "./creative-capture-geometry.js";
test("natural zoom is 1x, never ultrawide minimum", () => {
  assert.equal(naturalZoom(.5, 10), 1); assert.equal(naturalZoom(1, 5), 1); assert.equal(naturalZoom(2, 5), 2);
});
