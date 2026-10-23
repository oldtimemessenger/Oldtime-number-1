import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import { createMatteSurface, foregroundConfidence } from "./remix-matte.js";

export async function createPersonCutout({ forceCpu = false } = {}) {
  const base = `${import.meta.env.BASE_URL}remix-assets/`;
  const probe = document.createElement("canvas");
  const graphics = probe.getContext("webgl2") || probe.getContext("webgl");
  graphics?.getExtension("WEBGL_lose_context")?.loseContext();
  if (forceCpu || !graphics) {
    const { createCpuCutout } = await import("./remix-cutout-cpu.js");
    return createCpuCutout(base);
  }
  let segmenter;
  try {
    const files = await FilesetResolver.forVisionTasks(`${base}wasm`);
    segmenter = await ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: `${base}selfie_segmenter.tflite`, delegate: "CPU" },
      runningMode: "VIDEO", outputCategoryMask: false, outputConfidenceMasks: true
    });
  } catch {
    const { createCpuCutout } = await import("./remix-cutout-cpu.js");
    return createCpuCutout(base);
  }
  const surface = createMatteSurface(), labels = segmenter.getLabels();
  let lastTime = -1, lastVideo = null, closed = false, fallback = null, retired = false;
  const frame = (video, time) => {
      if (video.readyState < 2) return surface.canvas;
      if (lastVideo !== video) { lastVideo = video; surface.reset(); lastTime = -1; }
      if (time - lastTime < 85) return surface.canvas;
      lastTime = time;
      const result = segmenter.segmentForVideo(video, time);
      try {
        return surface.update(video, foregroundConfidence(result.confidenceMasks, labels));
      } finally { result.close(); }
  };
  return {
    async prepare(video) {
      if (closed) throw new Error("Cutout is closed.");
      if (fallback) return fallback.prepare(video);
      try {
        if (video.readyState >= 2) { lastTime = -1; frame(video, performance.now()); }
      } catch (failure) {
        console.warn("Remix cutout: switching to CPU after first-frame failure", failure);
        segmenter.close();
        retired=true;
        const { createCpuCutout } = await import("./remix-cutout-cpu.js");
        fallback = await createCpuCutout(base);
        if (closed) { fallback.close(); return; }
        await fallback.prepare(video);
      }
    },
    frame(video, time) { return fallback ? fallback.frame(video, time) : frame(video, time); },
    close() { if (closed) return; closed = true; if(fallback)fallback.close();else if(!retired)segmenter.close(); surface.close(); }
  };
}
