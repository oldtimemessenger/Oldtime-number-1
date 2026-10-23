import test from "node:test";
import assert from "node:assert/strict";
import { nextSection, ownsHorizontalGesture, bindSectionSwipes } from "./section-swipes.js";

test("left/right follow the main button order without wrapping", () => {
  assert.equal(nextSection("updates", -120, 10), "blast");
  assert.equal(nextSection("blast", -120, 0), "communities");
  assert.equal(nextSection("communities", 120, 0), "blast");
  assert.equal(nextSection("chat", -120, 0), "profile");
  assert.equal(nextSection("profile", -120, 0), null);
  assert.equal(nextSection("updates", 120, 0), null);
});
test("vertical, short, diagonal and slow drags do not navigate", () => {
  for (const [x, y, elapsed] of [[10, 140, 100], [40, 0, 100], [90, 70, 100], [140, 0, 1000]]) {
    assert.equal(nextSection("blast", x, y, elapsed), null);
  }
  assert.equal(nextSection("settings", -120, 0), null);
});
test("controls and horizontal scrollers own their gestures", () => {
  assert.equal(ownsHorizontalGesture({ closest: () => ({}) }, {}), true);
  const root = {};
  const node = { closest: () => null, scrollWidth: 600, clientWidth: 300, parentElement: root };
  assert.equal(ownsHorizontalGesture(node, root, () => ({ overflowX: "auto" })), true);
  assert.equal(ownsHorizontalGesture(node, root, () => ({ overflowX: "hidden" })), false);
});
test("canceled, multi-touch, overlay, and stale-section gestures never navigate", () => {
  const handlers = {}, navigated = [];
  let section = "updates", allowed = true;
  const root = { addEventListener: (name, fn) => { handlers[name] = fn; } };
  const target = { closest: () => null, parentElement: root, scrollWidth: 1, clientWidth: 1 };
  bindSectionSwipes({ root, current: () => section, enabled: () => allowed, navigate: value => navigated.push(value) });
  const start = () => handlers.touchstart({ target, touches: [{ clientX: 200, clientY: 100 }], timeStamp: 0 });
  const end = () => handlers.touchend({ changedTouches: [{ clientX: 50, clientY: 105 }], timeStamp: 200 });
  start(); handlers.touchcancel(); end();
  start(); handlers.touchmove({ touches: [{}, {}] }); end();
  start(); allowed = false; end(); allowed = true;
  start(); section = "blast"; end();
  assert.deepEqual(navigated, []);
  section = "updates"; start(); end();
  assert.deepEqual(navigated, ["blast"]);
});
