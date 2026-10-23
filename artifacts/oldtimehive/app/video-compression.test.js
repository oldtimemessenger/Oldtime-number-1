import test from "node:test";
import assert from "node:assert/strict";
import { fitVideoTo720p, videoCompressionPlan, compressVideoTo720p, MAX_VIDEO_DURATION_SECONDS } from "./video-compression.js";

test("720p dimensions preserve orientation and never upscale", () => {
  assert.deepEqual(fitVideoTo720p(3840, 2160), { width: 1280, height: 720 });
  assert.deepEqual(fitVideoTo720p(1080, 1920), { width: 720, height: 1280 });
  assert.deepEqual(fitVideoTo720p(640, 480), { width: 640, height: 480 });
});

test("encoding plan bounds large videos and leaves already optimized files untouched", () => {
  const large = videoCompressionPlan({ width: 3840, height: 2160, size: 80_000_000, duration: 60 });
  assert.equal(large.needsEncoding, true);
  assert.equal(large.width, 1280);
  assert.equal(large.height, 720);
  assert.ok(large.videoBitsPerSecond + large.audioBitsPerSecond <= 1_250_000);
  assert.equal(large.frameRate, 24);

  const optimized = videoCompressionPlan({ width: 1280, height: 720, size: 7_000_000, duration: 60 });
  assert.equal(optimized.needsEncoding, false);
});

test("new video uploads allow exactly 2 minutes 9 seconds and reject longer clips", () => {
  assert.equal(MAX_VIDEO_DURATION_SECONDS, 129);
  assert.doesNotThrow(() => videoCompressionPlan({
    width: 1280, height: 720, size: 7_000_000, duration: MAX_VIDEO_DURATION_SECONDS,
  }));
  assert.throws(() => videoCompressionPlan({
    width: 1280, height: 720, size: 7_000_000, duration: MAX_VIDEO_DURATION_SECONDS + 0.01,
  }), /2 minutes 9 seconds or shorter/);
});

test("video compression fails explicitly outside a browser instead of uploading the original", async () => {
  await assert.rejects(
    compressVideoTo720p(new Blob(["source"], { type: "video/mp4" })),
    /original was not uploaded/i,
  );
});

test("non-video media is passed through unchanged", async () => {
  const image = new Blob(["image"], { type: "image/jpeg" });
  assert.equal(await compressVideoTo720p(image), image);
});
