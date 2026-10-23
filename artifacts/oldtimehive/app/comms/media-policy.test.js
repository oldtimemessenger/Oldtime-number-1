import assert from "node:assert/strict";
import test from "node:test";
import {
  CALL_AUDIO_MAX_BITRATE,
  CALL_VIDEO_MAX_BITRATE,
  CALL_VIDEO_MAX_FRAME_RATE,
  callMediaConstraints,
  callVideoConstraints,
  capCallSender,
} from "./media-policy.js";

test("voice calls do not request camera media", () => {
  assert.deepEqual(callMediaConstraints(false), { audio: true, video: false });
});

test("video calls request practical 480p/24fps capture instead of the device maximum", () => {
  assert.deepEqual(callMediaConstraints(true), {
    audio: true,
    video: {
      facingMode: { ideal: "user" },
      width: { ideal: 640, max: 640 },
      height: { ideal: 480, max: 480 },
      frameRate: { ideal: CALL_VIDEO_MAX_FRAME_RATE, max: CALL_VIDEO_MAX_FRAME_RATE },
    },
  });
});

test("turning video on or flipping cameras preserves the same 480p/24fps bandwidth limits", () => {
  assert.deepEqual(callVideoConstraints("environment"), {
    facingMode: { ideal: "environment" },
    width: { ideal: 640, max: 640 },
    height: { ideal: 480, max: 480 },
    frameRate: { ideal: CALL_VIDEO_MAX_FRAME_RATE, max: CALL_VIDEO_MAX_FRAME_RATE },
  });
});

test("sender bitrate caps are applied without replacing other RTP settings", async () => {
  const parameters = { degradationPreference: "balanced", encodings: [{ active: true }] };
  let applied;
  const sender = {
    getParameters: () => structuredClone(parameters),
    setParameters: async value => { applied = value; },
  };

  assert.equal(await capCallSender(sender, "video"), true);
  assert.equal(applied.degradationPreference, "balanced");
  assert.equal(applied.encodings[0].active, true);
  assert.equal(applied.encodings[0].maxBitrate, CALL_VIDEO_MAX_BITRATE);
  assert.equal(applied.encodings[0].maxFramerate, CALL_VIDEO_MAX_FRAME_RATE);
  assert.equal(await capCallSender(sender, "audio"), true);
  assert.equal(applied.encodings[0].maxBitrate, CALL_AUDIO_MAX_BITRATE);
  assert.equal("maxFramerate" in applied.encodings[0], false);
});

test("a browser that rejects optional sender tuning still keeps the call available", async () => {
  assert.equal(await capCallSender({ getParameters: () => ({}), setParameters: async () => { throw new Error("unsupported"); } }, "video"), false);
  assert.equal(await capCallSender({}, "video"), false);
});
