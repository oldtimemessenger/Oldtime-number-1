import test from "node:test";
import assert from "node:assert/strict";
import { selectVideoMime, verifyVideoBlob, exportDurationSeconds, canRenderFlyover } from "./sports-video.js";
import { markerPulse, POSITION_RED } from "./sports-marker.js";

test("export length slows the whole video rather than remaining capped at 24 seconds", () => {
  assert.equal(exportDurationSeconds(45), 45);
  assert.equal(exportDurationSeconds(90), 90);
  assert.equal(exportDurationSeconds(999), 120);
  assert.equal(exportDurationSeconds(-1), 15);
  assert.equal(exportDurationSeconds(undefined), 30);
});
test("flyover export uses the single 3D-city renderer", () => {
  assert.equal(canRenderFlyover("vector"), true);
  assert.equal(canRenderFlyover("imagery", "aerial"), false);
  assert.equal(canRenderFlyover("imagery", "street"), false);
  assert.equal(canRenderFlyover("terrain", "aerial"), false);
  assert.equal(canRenderFlyover("stylized", null), false);
});
test("red marker pulse expands, fades and honours reduced motion", () => {
  assert.equal(POSITION_RED, "#ed2339");
  assert.ok(markerPulse(750).radius > markerPulse(0).radius);
  assert.ok(markerPulse(750).opacity < markerPulse(0).opacity);
  assert.deepEqual(markerPulse(1500), markerPulse(0));
  assert.deepEqual(markerPulse(750, true), markerPulse(0, true));
});

test("prefers MP4 on browsers supporting both MP4 and WebM", () => {
  assert.equal(selectVideoMime({ isTypeSupported: () => true }), "video/mp4");
  assert.equal(selectVideoMime({ isTypeSupported: t => t === "video/webm;codecs=vp8" }), "video/webm;codecs=vp8");
  assert.equal(selectVideoMime({ isTypeSupported: () => false }), null);
});

function playback({ duration, dimensions = true, fail = false }) {
  let revoked = false, released = false;
  const video = {
    readyState: 0, videoWidth: 0, videoHeight: 0, duration,
    pause() {}, removeAttribute() { released = true; },
    load() {
      if (released) return;
      queueMicrotask(() => {
        if (fail) { this.onerror?.(); return; }
        this.readyState = 1;
        this.onloadedmetadata?.();
        this.readyState = 2;
        this.videoWidth = dimensions ? 720 : 0;
        this.videoHeight = dimensions ? 1280 : 0;
        this.onloadeddata?.();
      });
    },
  };
  return {
    options: { document: { createElement: () => video },
      urls: { createObjectURL: () => "blob:test", revokeObjectURL: () => { revoked = true; } }, timeoutMs: 20 },
    cleaned: () => revoked && released,
  };
}

test("accepts decoded recorder video with an unknown duration", async () => {
  for (const duration of [Infinity, NaN, 0]) {
    const p = playback({ duration });
    await verifyVideoBlob(new Blob(["video"]), p.options);
    assert.ok(p.cleaned());
  }
});

test("rejects a blob that never decodes a video frame", async () => {
  const p = playback({ duration: 20, dimensions: false });
  await assert.rejects(verifyVideoBlob(new Blob(["bad"]), p.options), /video preview is still loading/);
  assert.ok(p.cleaned());
});

test("does not accept a two-frame clip as a full route export", async () => {
  const p = playback({ duration: 0.068 });
  await assert.rejects(verifyVideoBlob(new Blob(["short"]), { ...p.options, minimumDuration: 9.6 }), /could not finish the video/);
});

test("rejects playback errors and releases the object URL", async () => {
  const p = playback({ duration: 20, fail: true });
  await assert.rejects(verifyVideoBlob(new Blob(["bad"]), p.options), /could not preview the exported video/);
  assert.ok(p.cleaned());
});
