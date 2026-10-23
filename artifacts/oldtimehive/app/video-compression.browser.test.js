import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import test from "node:test";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function findChromium() {
  const candidates = [process.env.CHROMIUM_PATH, "/repl/tools/bin/chromium", "/usr/bin/chromium",
    "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].filter(Boolean);
  const installed = candidates.find(path => existsSync(path));
  if (installed) return installed;
  for (const command of ["chromium", "chromium-browser", "google-chrome"]) {
    try { return execFileSync("which", [command], { encoding: "utf8" }).trim(); } catch {}
  }
  throw new Error("Chromium is required for the video compression browser test.");
}

function findFfmpeg() {
  try { return execFileSync("which", ["ffmpeg"], { encoding: "utf8" }).trim(); } catch { return ""; }
}

const ffmpegPath = findFfmpeg();
test("cloud media optimization retains video audio and reduces photo bytes without losing transparency", { timeout: 45_000, skip: !ffmpegPath }, async () => {
  const originalPort = process.env.PORT;
  const originalBasePath = process.env.BASE_PATH;
  const fixtureDir = mkdtempSync(join(tmpdir(), "oldtime-video-"));
  const fixturePath = join(fixtureDir, "source.mp4");
  const overLimitFixturePath = join(fixtureDir, "over-limit.mp4");
  execFileSync(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-t", "1.3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-b:v", "2M", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", fixturePath,
  ]);
  execFileSync(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=1",
    "-t", "130", "-an", "-c:v", "libx264", "-preset", "ultrafast",
    "-crf", "45", "-movflags", "+faststart", overLimitFixturePath,
  ]);
  process.env.PORT = "5173";
  process.env.BASE_PATH = "/";
  const server = await createServer({
    configFile: resolve(packageRoot, "vite.config.ts"),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  let browser;
  try {
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address === "object");
    browser = await chromium.launch({
      executablePath: findChromium(),
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
    });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const output = await page.evaluate(async ({ encodedSource, encodedOverLimit }) => {
      const { compressVideoTo720p } = await import("/app/video-compression.js");
      const { compressImageForUpload } = await import("/app/image-compression.js");
      const canvas = document.createElement("canvas");
      canvas.width = 2400;
      canvas.height = 1800;
      const context = canvas.getContext("2d");
      const pixels = context.createImageData(canvas.width, canvas.height);
      let seed = 17;
      for (let i = 0; i < pixels.data.length; i += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        pixels.data[i] = seed >>> 24;
        pixels.data[i + 1] = (seed >>> 16) & 255;
        pixels.data[i + 2] = (seed >>> 8) & 255;
        pixels.data[i + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      context.clearRect(0, 0, 160, 160);
      const photo = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      const optimizedPhoto = await compressImageForUpload(photo);
      const decodedPhoto = await createImageBitmap(optimizedPhoto);
      const pixel = document.createElement("canvas");
      pixel.width = pixel.height = 1;
      const pixelContext = pixel.getContext("2d");
      pixelContext.drawImage(decodedPhoto, 0, 0);
      const photoResult = {
        originalBytes: photo.size, optimizedBytes: optimizedPhoto.size, type: optimizedPhoto.type,
        width: decodedPhoto.width, height: decodedPhoto.height, alpha: pixelContext.getImageData(0, 0, 1, 1).data[3],
      };
      decodedPhoto.close();
      const nativeDecoder = globalThis.createImageBitmap;
      let fallbackBytes;
      try {
        globalThis.createImageBitmap = undefined;
        fallbackBytes = (await compressImageForUpload(photo)).size;
      } finally {
        globalThis.createImageBitmap = nativeDecoder;
      }
      const bytes = Uint8Array.from(atob(encodedSource), character => character.charCodeAt(0));
      const source = new Blob([bytes], { type: "video/mp4" });
      const optimized = await compressVideoTo720p(source);
      const overLimitBytes = Uint8Array.from(atob(encodedOverLimit), character => character.charCodeAt(0));
      let overLimitMessage = "";
      try {
        await compressVideoTo720p(new Blob([overLimitBytes], { type: "video/mp4" }));
      } catch (error) {
        overLimitMessage = error instanceof Error ? error.message : String(error);
      }
      const outputAudio = new AudioContext();
      const decodedAudio = await outputAudio.decodeAudioData(await optimized.arrayBuffer());
      const audio = decodedAudio.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < audio.length; i += 1) peak = Math.max(peak, Math.abs(audio[i]));
      await outputAudio.close();
      const url = URL.createObjectURL(optimized);
      const preview = document.createElement("video");
      const metadata = new Promise((resolve, reject) => {
        preview.onloadedmetadata = () => resolve({ width: preview.videoWidth, height: preview.videoHeight });
        preview.onerror = () => reject(new Error("Optimized output could not be decoded."));
      });
      preview.src = url;
      const dimensions = await metadata;
      URL.revokeObjectURL(url);
      return {
        sourceSize: source.size,
        outputSize: optimized.size,
        outputType: optimized.type,
        audioPeak: peak,
        overLimitMessage,
        photo: photoResult, fallbackPhotoBytes: fallbackBytes,
        ...dimensions,
      };
    }, {
      encodedSource: readFileSync(fixturePath).toString("base64"),
      encodedOverLimit: readFileSync(overLimitFixturePath).toString("base64"),
    });
    assert.ok(output.sourceSize > 0);
    assert.ok(output.outputSize > 0);
    assert.match(output.outputType, /^video\/(mp4|webm)$/);
    assert.ok(output.audioPeak > 0.01, "audio should survive the video optimization");
    assert.match(output.overLimitMessage, /2 minutes 9 seconds or shorter/);
    assert.ok(output.width <= 1280 && output.height <= 720);
    assert.ok(output.width >= output.height);
    assert.equal(output.photo.type, "image/webp");
    assert.ok(output.photo.optimizedBytes < output.photo.originalBytes);
    assert.ok(output.photo.width <= 1600 && output.photo.height <= 1600);
    assert.equal(output.photo.alpha, 0);
    assert.ok(output.fallbackPhotoBytes > 0 && output.fallbackPhotoBytes < output.photo.originalBytes);
    console.log("Photo fixture bytes:", output.photo.originalBytes, "→", output.photo.optimizedBytes);
  } finally {
    await browser?.close();
    await server.close();
    rmSync(fixtureDir, { recursive: true, force: true });
    process.env.PORT = originalPort;
    process.env.BASE_PATH = originalBasePath;
  }
});
