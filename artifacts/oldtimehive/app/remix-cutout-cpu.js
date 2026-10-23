import { createMatteSurface } from "./remix-matte.js";
// Lazy CPU-only path for browsers without a usable graphics context.
export async function createCpuCutout(base) {
  const tf = await import("@tensorflow/tfjs-core");
  await import("@tensorflow/tfjs-backend-cpu");
  await tf.setBackend("cpu"); await tf.ready();
  const bodypix = await import("@tensorflow-models/body-pix");
  const model = await bodypix.load({
    architecture: "MobileNetV1", outputStride: 16, multiplier: .5, quantBytes: 2,
    modelUrl: `${base}bodypix/model.json`
  });
  const input = document.createElement("canvas"), snapshot = document.createElement("canvas"), surface = createMatteSurface();
  const inputCtx = input.getContext("2d");
  const snapshotCtx = snapshot.getContext("2d");
  let pending = null, closed = false, failure = null, lastTime = -1, lastVideo = null;
  const segment = video => {
    if (closed || video.readyState < 2) return Promise.resolve();
    if (pending) return pending;
    if (lastVideo !== video) { lastVideo = video; surface.reset(); }
    const detailScale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    snapshot.width = Math.max(1, Math.round(video.videoWidth * detailScale));
    snapshot.height = Math.max(1, Math.round(video.videoHeight * detailScale));
    snapshotCtx.drawImage(video, 0, 0, snapshot.width, snapshot.height);
    const scale = Math.min(1, 256 / Math.max(video.videoWidth, video.videoHeight));
    input.width = Math.max(1, Math.round(video.videoWidth * scale));
    input.height = Math.max(1, Math.round(video.videoHeight * scale));
    inputCtx.drawImage(snapshot, 0, 0, input.width, input.height);
    // Keep the same MobileNet model but retain its sigmoid probabilities.
    // segmentPerson() thresholds them irreversibly into a binary silhouette.
    const scores = tf.tidy(() => {
      const pixels = tf.browser.fromPixels(input);
      const height = Math.floor(input.height * .75 / 16) * 16 + 1;
      const width = Math.floor(input.width * .75 / 16) * 16 + 1;
      const prediction = model.baseModel.predict(tf.image.resizeBilinear(pixels, [height, width]));
      return tf.squeeze(tf.image.resizeBilinear(tf.sigmoid(prediction.segmentation), [input.height, input.width]), [2]);
    });
    pending = scores.data()
      .then(data => {
        if (closed) return;
        surface.update(snapshot, { data, width: input.width, height: input.height });
      })
      .catch(error => { failure = error; })
      .finally(() => { scores.dispose(); pending = null; if (closed) model.dispose(); });
    return pending;
  };
  return {
    async prepare(video) { await segment(video); if (failure) throw new Error("Background removal couldn’t process this video."); },
    frame(video, time) {
      if (failure) throw new Error("Background removal stopped. Retry cutout before recording.");
      if (!pending && time - lastTime >= 120) { lastTime = time; void segment(video); }
      return surface.canvas;
    },
    close() { if (closed) return; closed = true; if (!pending) model.dispose(); surface.close(); }
  };
}
