const MIMES = [
  "video/mp4", "video/mp4;codecs=avc1.42E028",
  "video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm",
];

export const selectVideoMime = recorder => MIMES.find(type => recorder?.isTypeSupported?.(type)) || null;
export const exportDurationSeconds = value => Number.isFinite(Number(value))
  ? Math.max(15, Math.min(120, Number(value))) : 30;
export const canRenderFlyover = mode => mode === "vector";

// Recorder containers can have an unknown duration until playback/seek. A decoded
// frame, not a finite metadata duration, is the reliable playback readiness check.
export async function verifyVideoBlob(blob, {
  document: doc = globalThis.document, urls = globalThis.URL, timeoutMs = 15000, minimumDuration = 0,
} = {}) {
  const url = urls.createObjectURL(blob), video = doc.createElement("video");
  video.preload = "auto"; video.muted = true; video.playsInline = true;
  let timer;
  try {
    await new Promise((resolve, reject) => {
      const check = () => {
        if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) return;
        if (Number.isFinite(video.duration) && video.duration > 0 && video.duration < minimumDuration) {
          reject(new Error("This browser could not finish the video at the selected quality. Try again at 720p."));
        } else resolve();
      };
      timer = setTimeout(() => reject(new Error("The video preview is still loading. Please create the flyover again.")), timeoutMs);
      video.onloadedmetadata = check;
      video.onloadeddata = check;
      video.oncanplay = check;
      video.onerror = () => reject(new Error("This browser could not preview the exported video. Please create the flyover again."));
      video.src = url; video.load();
    });
  } finally {
    clearTimeout(timer);
    video.onloadedmetadata = video.onloadeddata = video.oncanplay = video.onerror = null;
    video.pause(); video.removeAttribute("src"); video.load();
    urls.revokeObjectURL(url);
  }
}
