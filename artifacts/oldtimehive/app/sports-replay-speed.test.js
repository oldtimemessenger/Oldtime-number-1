import test from "node:test";
import assert from "node:assert/strict";
import { REPLAY_SPEEDS, replaySpeedFor } from "./sports-replay-speed.js";

test("flyover replay defaults to 8x while keeping lower manual speeds", () => {
  assert.deepEqual(REPLAY_SPEEDS, [1, 2, 4, 8]);
  assert.equal(replaySpeedFor(120_000, 8), 8);
  assert.equal(replaySpeedFor(120_000, 2), 2);
});

test("non-flyover replay keeps its duration-based speed selection", () => {
  assert.equal(replaySpeedFor(20_000), 1);
  assert.equal(replaySpeedFor(90_000), 4);
  assert.equal(replaySpeedFor(600_000), 8);
});
