import test from "node:test";
import assert from "node:assert/strict";
import { compressImageForUpload, isAnimatedImage } from "./image-compression.js";

test("small photos, audio, and GIFs are not unnecessarily re-encoded", async () => {
  for (const type of ["image/png", "image/jpeg", "image/gif", "audio/webm"]) {
    const source = new Blob(["small payload"], { type });
    assert.equal(await compressImageForUpload(source), source);
  }
});

test("animated PNG and WebP headers are preserved, not flattened", async () => {
  const png = new Uint8Array(80 * 1024);
  new DataView(png.buffer).setUint32(8, 8);
  png.set(new TextEncoder().encode("acTL"), 12);
  const webp = new Uint8Array(80 * 1024);
  webp.set(new TextEncoder().encode("VP8X"), 12);
  webp[20] = 2;
  for (const source of [new Blob([png], { type: "image/png" }), new Blob([webp], { type: "image/webp" })]) {
    assert.equal(await isAnimatedImage(source), true);
    assert.equal(await compressImageForUpload(source), source);
  }
  assert.equal(await isAnimatedImage(new Blob(["GIF89a"], { type: "image/gif" })), true);
});

test("static PNG and WebP are eligible for compression", async () => {
  const png = new Uint8Array(24);
  png.set(new TextEncoder().encode("IDAT"), 12);
  assert.equal(await isAnimatedImage(new Blob([png], { type: "image/png" })), false);
  const webp = new Uint8Array(32);
  webp.set(new TextEncoder().encode("VP8X"), 12);
  assert.equal(await isAnimatedImage(new Blob([webp], { type: "image/webp" })), false);
});
