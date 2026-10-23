import test from "node:test";
import assert from "node:assert/strict";
import { viewportMetrics, createSwipeTracker, createSheetRegistry, canStartSwipe, ownedSheets } from "./creative-overlay.js";

test("viewport metrics expose keyboard and visual offsets", () => {
  assert.deepEqual(viewportMetrics({ height: 400, offsetTop: 30, offsetLeft: 0, width: 390 }, 844), { height: 400, top: 30, left: 0, width: 390, keyboard: 414 });
  assert.equal(viewportMetrics(null).height, null);
  assert.equal(viewportMetrics({ height: 844, offsetTop: 0, width: 390 }, 844).keyboard, 0);
});
test("swipe dismisses only on a downward vertical drag from scroll top", () => {
  const t = createSwipeTracker();
  t.start(10, 10, { t: 0 }); t.move(12, 60); assert.equal(t.end(400), false);
  t.start(10, 10, { t: 0 }); t.move(10, 40); t.move(12, 120); assert.equal(t.end(400), true);
  t.start(10, 10, { t: 0 }); t.move(100, 40); t.move(100, 200); assert.equal(t.end(400), false, "horizontal drag is a slider");
  t.start(10, 10, { t: 0, scrollTop: 50 }); t.move(10, 200); assert.equal(t.end(400), false, "scrolled content scrolls");
  t.start(10, 10, { t: 0 }); t.move(10, 200); t.move(10, 20); assert.equal(t.end(400), false);
});
test("fast short flick dismisses", () => {
  const t = createSwipeTracker(); t.start(0, 0, { t: 0 }); t.move(0, 40); assert.equal(t.end(50), true);
});
test("registry dismisses all except the opening tool", () => {
  const r = createSheetRegistry(), state = { a: true, b: true, c: true };
  for (const k of Object.keys(state)) r.register(k, { isOpen: () => state[k], close: () => { state[k] = false; } });
  assert.equal(r.dismissAll({ except: ["a"], skip: ["c"] }), true);
  assert.deepEqual(state, { a: true, b: false, c: true });
  assert.equal(r.dismissAll({ except: ["a"], skip: ["c"] }), false);
  assert.equal(r.dismissAll(), true); assert.equal(r.anyOpen(), false);
});
test("gesture targets: sliders keep their gestures, grips always swipe", () => {
  const el = sel => ({ closest: s => s.includes(sel) ? {} : null });
  assert.equal(canStartSwipe(el("input")), false);
  assert.equal(canStartSwipe({ closest: s => s === "[data-ce-grip]" ? {} : {} }), true);
  assert.equal(canStartSwipe(el("nothing")), true);
});
test("tool buttons own their sheet", () => {
  assert.deepEqual(ownedSheets({ id: "ce-draw", dataset: {} }), ["draw"]);
  assert.deepEqual(ownedSheets({ id: "", dataset: { ceAdd: "sticker" } }), ["stickers"]);
  assert.deepEqual(ownedSheets({ id: "", dataset: { ceAdd: "text" } }), []);
  assert.deepEqual(ownedSheets({ id: "", dataset: { ceStudioOpen: "text-style" } }), ["style"]);
});
