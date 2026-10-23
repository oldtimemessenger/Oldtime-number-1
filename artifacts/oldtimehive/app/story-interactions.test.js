import test from "node:test";
import assert from "node:assert/strict";
import { createBurst, validateStoryComment, insertAtCursor, createPause, isIgnoredTap, MAX_BURSTS } from "./story-interactions.js";

const node = () => { const n = { style: { setProperty() {} }, removed: false, setAttribute() {}, remove() { n.removed = true; } }; return n; };
const host = () => ({ nodes: [], append(n) { this.nodes.push(n); } });
test("bursts are bounded, expire and clean up", () => {
  const timers = new Map(); let id = 0; const h = host();
  const b = createBurst({ host: h, create: node, setTimer: fn => (timers.set(++id, fn), id), clearTimer: t => timers.delete(t) });
  for (let i = 0; i < 30; i++) b.spawn(i, i);
  assert.equal(b.count(), MAX_BURSTS); assert.equal(h.nodes.filter(n => !n.removed).length, MAX_BURSTS);
  [...timers.values()][0](); assert.equal(b.count(), MAX_BURSTS - 1);
  b.dispose(); assert.equal(b.count(), 0); assert.equal(timers.size, 0);
});
test("reduced motion spawns nothing", () => {
  const b = createBurst({ host: host(), create: node, reduced: true }); assert.equal(b.spawn(1, 1), null); assert.equal(b.count(), 0);
});
test("Story reply validation trims input and rejects empty or oversized text", () => {
  assert.equal(validateStoryComment("  hi  "), "hi");
  assert.throws(() => validateStoryComment("  "), /Write a reply/);
  assert.throws(() => validateStoryComment("x".repeat(301)), /300/);
});
test("emoji insertion respects cursor and limit", () => {
  assert.deepEqual(insertAtCursor("abcd", 2, 2, "X"), { value: "abXcd", cursor: 3 });
  assert.deepEqual(insertAtCursor("abcd", 1, 3, "X"), { value: "aXd", cursor: 2 });
  assert.equal(insertAtCursor("a".repeat(300), 0, 0, "X").value.length, 300);
});
test("pause is reference counted", () => {
  const log = []; const p = createPause({ onPause: () => log.push("p"), onResume: () => log.push("r") });
  p.hold(); p.hold(); p.release(); assert.deepEqual(log, ["p"]); p.release(); p.release(); assert.deepEqual(log, ["p", "r"]);
});
test("control taps are ignored", () => {
  assert.equal(isIgnoredTap({ closest: s => s.includes("button") ? {} : null }), true);
  assert.equal(isIgnoredTap({ closest: () => null }), false);
  assert.equal(isIgnoredTap({ closest: selector => selector.split(",").includes("canvas") ? {} : null }), false, "read-only creative story canvases allow repeated visual hearts");
});
