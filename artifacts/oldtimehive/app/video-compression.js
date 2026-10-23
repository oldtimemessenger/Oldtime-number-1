const MAX_LONG_EDGE = 1280;
const MAX_SHORT_EDGE = 720;
const MAX_TOTAL_BITRATE = 1_250_000;
const MAX_FRAME_RATE = 24;
export const MAX_VIDEO_DURATION_SECONDS = 129;

function videoDurationLimitError() {
  return new Error("Videos must be 2 minutes 9 seconds or shorter. The original was not uploaded.");
}

function validateVideoDuration(duration) {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("The video duration could not be read.");
  }
  if (duration > MAX_VIDEO_DURATION_SECONDS) throw videoDurationLimitError();
  return duration;
}

const MIME_TYPES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export function fitVideoTo720p(width, height) {
  const sourceWidth = Number(width);
  const sourceHeight = Number(height);
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) ||
      sourceWidth < 2 || sourceHeight < 2) {
    throw new Error("The video dimensions could not be read.");
  }
  const scale = Math.min(
    1,
    MAX_LONG_EDGE / Math.max(sourceWidth, sourceHeight),
    MAX_SHORT_EDGE / Math.min(sourceWidth, sourceHeight),
  );
  const even = value => Math.max(2, Math.floor(value * scale / 2) * 2);
  return { width: even(sourceWidth), height: even(sourceHeight) };
}

export function videoCompressionPlan({ width, height, size, duration }) {
  const dimensions = fitVideoTo720p(width, height);
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) throw new Error("The video file size could not be read.");
  const seconds = validateVideoDuration(Number(duration));
  const averageBitrate = bytes * 8 / seconds;
  const alreadyWithinTarget = dimensions.width === Number(width) &&
    dimensions.height === Number(height) && averageBitrate <= MAX_TOTAL_BITRATE;
  const targetTotalBitrate = Math.min(
    MAX_TOTAL_BITRATE,
    Math.max(32_000, Math.floor(averageBitrate * 0.85)),
  );
  const audioBitrate = Math.min(96_000, Math.max(8_000, Math.floor(targetTotalBitrate * 0.08)));
  return {
    ...dimensions,
    needsEncoding: !alreadyWithinTarget,
    videoBitsPerSecond: Math.max(24_000, targetTotalBitrate - audioBitrate),
    audioBitsPerSecond: audioBitrate,
    frameRate: MAX_FRAME_RATE,
  };
}

function chooseMimeType(Recorder) {
  if (typeof Recorder.isTypeSupported !== "function") return "";
  return MIME_TYPES.find(type => Recorder.isTypeSupported(type)) || "";
}

function report(onProgress, fraction, phase) {
  try { onProgress?.(Math.max(0, Math.min(1, fraction)), phase); } catch {}
}

function waitForMetadata(video) {
  if (video.readyState >= 1 && video.videoWidth && video.videoHeight) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const loaded = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("This video could not be opened for optimization.")); };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", loaded);
      video.removeEventListener("error", failed);
    };
    video.addEventListener("loadedmetadata", loaded, { once: true });
    video.addEventListener("error", failed, { once: true });
  });
}

function seekToStart(video) {
  if (video.currentTime === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("This video could not be prepared for optimization.")); };
    const cleanup = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", failed);
    };
    video.addEventListener("seeked", done, { once: true });
    video.addEventListener("error", failed, { once: true });
    video.currentTime = 0;
  });
}

function getFiniteDuration(video) {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    return Promise.resolve(validateVideoDuration(video.duration));
  }
  if (video.ended && Number.isFinite(video.currentTime) && video.currentTime > 0) {
    return Promise.resolve(validateVideoDuration(video.currentTime));
  }
  // Some browser-recorded WebM files omit duration metadata. They are still
  // playable; measure their actual timeline instead of rejecting or uploading
  // the original unoptimized file.
  return new Promise((resolve, reject) => {
    const fail = error => {
      cleanup();
      video.pause();
      reject(error);
    };
    const ended = () => {
      cleanup();
      const duration = Number(video.currentTime);
      try { resolve(validateVideoDuration(duration)); }
      catch (error) { reject(error); }
    };
    const failed = () => {
      cleanup();
      reject(new Error("The video duration could not be measured. The original was not uploaded."));
    };
    const checkLimit = () => {
      if (Number(video.currentTime) > MAX_VIDEO_DURATION_SECONDS) fail(videoDurationLimitError());
    };
    const cleanup = () => {
      video.removeEventListener("ended", ended);
      video.removeEventListener("error", failed);
      video.removeEventListener("timeupdate", checkLimit);
    };
    video.addEventListener("ended", ended, { once: true });
    video.addEventListener("error", failed, { once: true });
    video.addEventListener("timeupdate", checkLimit);
  });
}

/**
 * Re-encode newly uploaded videos in browser memory. Only the resulting Blob is
 * handed to the cloud upload path; no original is written to browser storage.
 */
export async function compressVideoTo720p(blob, { onProgress } = {}) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error("Choose a video file first.");
  if (!String(blob.type || "").toLowerCase().startsWith("video/")) return blob;

  const Recorder = globalThis.MediaRecorder;
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Recorder || !globalThis.document?.createElement || !AudioContextClass ||
      typeof document.createElement("canvas").captureStream !== "function") {
    throw new Error("This browser cannot optimize the video to 720p. Update your browser and retry; the original was not uploaded.");
  }
  const mimeType = chooseMimeType(Recorder);
  if (!mimeType) {
    throw new Error("This browser has no supported video encoder. Update your browser and retry; the original was not uploaded.");
  }

  const sourceUrl = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.playsInline = true;
  video.muted = true;
  video.preload = "auto";
  video.controls = false;
  video.style.cssText = "position:fixed;left:-4px;top:-4px;width:2px;height:2px;opacity:0;pointer-events:none";
  let audioContext;
  let audioDestination;
  let canvasStream;
  let drawFrame = 0;
  let recorder;
  let didReportFailure = false;
  try {
    document.body.append(video);
    audioContext = new AudioContextClass();
    audioDestination = audioContext.createMediaStreamDestination();
    audioContext.createMediaElementSource(video).connect(audioDestination);
    const audioResume = audioContext.resume();
    const metadata = waitForMetadata(video);
    video.src = sourceUrl;
    video.load();
    await Promise.all([metadata, audioResume]);
    // Most uploaded containers include a duration in their header. Reject an
    // over-limit file before playing it or starting its encoder.
    if (Number.isFinite(video.duration) && video.duration > MAX_VIDEO_DURATION_SECONDS) {
      throw videoDurationLimitError();
    }
    const firstPlay = video.play().then(() => {
      // Begin muted so upload flows remain playable after their async cloud
      // checks; the audio is captured into the output stream, never speakers.
      video.muted = false;
      return null;
    }, error => error);
    const playError = await firstPlay;
    if (playError) throw new Error("This browser could not play the video for optimization. The original was not uploaded.");
    const duration = await getFiniteDuration(video);
    const plan = videoCompressionPlan({
      width: video.videoWidth,
      height: video.videoHeight,
      size: blob.size,
      duration,
    });
    if (!plan.needsEncoding) {
      report(onProgress, 1, "compressing");
      return blob;
    }

    video.pause();
    await seekToStart(video);
    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser cannot prepare the video encoder.");
    canvasStream = canvas.captureStream(plan.frameRate);
    for (const track of audioDestination.stream.getAudioTracks()) canvasStream.addTrack(track);

    try {
      recorder = new Recorder(canvasStream, {
        mimeType,
        videoBitsPerSecond: plan.videoBitsPerSecond,
        audioBitsPerSecond: plan.audioBitsPerSecond,
      });
    } catch {
      throw new Error("This browser could not start the 720p video encoder. The original was not uploaded.");
    }
    const chunks = [];
    const recordingDone = new Promise((resolve, reject) => {
      recorder.addEventListener("dataavailable", event => {
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener("error", () => {
        didReportFailure = true;
        reject(new Error("The video could not be optimized. The original was not uploaded."));
      }, { once: true });
      recorder.addEventListener("stop", resolve, { once: true });
      video.addEventListener("ended", () => {
        if (recorder.state !== "inactive") recorder.stop();
      }, { once: true });
    });
    recordingDone.catch(() => {});
    let lastProgressAt = 0;
    const draw = timestamp => {
      if (video.readyState >= 2) {
        try { context.drawImage(video, 0, 0, plan.width, plan.height); }
        catch {
          if (!didReportFailure) {
            didReportFailure = true;
            if (recorder?.state !== "inactive") recorder?.stop();
          }
        }
      }
      if (timestamp - lastProgressAt >= 400) {
        lastProgressAt = timestamp;
        report(onProgress, video.duration ? video.currentTime / video.duration : 0, "compressing");
      }
      if (!video.ended && recorder?.state !== "inactive") drawFrame = requestAnimationFrame(draw);
    };
    drawFrame = requestAnimationFrame(draw);
    recorder.start(500);
    await video.play();
    await recordingDone;
    if (didReportFailure) throw new Error("The video could not be optimized. The original was not uploaded.");
    const outputType = String(recorder.mimeType || mimeType).split(";")[0].toLowerCase();
    const output = new Blob(chunks, { type: outputType });
    if (!output.size || !output.type.startsWith("video/")) {
      throw new Error("The 720p video could not be verified. The original was not uploaded.");
    }
    report(onProgress, 1, "compressing");
    return output;
  } catch (error) {
    if (error instanceof Error && /original was not uploaded/i.test(error.message)) throw error;
    if (error instanceof Error && error.message === "Choose a video file first.") throw error;
    const detail = error instanceof Error ? error.message : "An encoder error occurred.";
    throw new Error(`${detail} The original was not uploaded.`);
  } finally {
    if (drawFrame) cancelAnimationFrame(drawFrame);
    if (recorder?.state !== "inactive") {
      try { recorder.stop(); } catch {}
    }
    for (const track of canvasStream?.getTracks?.() || []) track.stop();
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(sourceUrl);
    if (audioContext && audioContext.state !== "closed") {
      await audioContext.close().catch(() => {});
    }
  }
}
