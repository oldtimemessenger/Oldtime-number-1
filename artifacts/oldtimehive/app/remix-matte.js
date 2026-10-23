const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));
const smooth = (lo, hi, value) => { const t = clamp((value - lo) / (hi - lo)); return t * t * (3 - 2 * t); };

// The shipped selfie model has ONE foreground probability channel ("selfie").
// A category index is not a foreground probability and must never be inverted.
export function foregroundConfidence(masks, labels = []) {
  const index = Math.max(0, labels.findIndex(label => /^(person|selfie|foreground)$/i.test(label)));
  const mask = masks?.[index];
  if (!mask) throw new Error("Person detection did not return foreground confidence.");
  return { data: mask.getAsFloat32Array(), width: mask.width, height: mask.height };
}

export function resampleConfidence(mask, width, height, output = new Float32Array(width * height)) {
  for (let y = 0; y < height; y++) {
    const sy = clamp((y + .5) * mask.height / height - .5, 0, mask.height - 1);
    const y0 = Math.floor(sy), y1 = Math.min(mask.height - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = clamp((x + .5) * mask.width / width - .5, 0, mask.width - 1);
      const x0 = Math.floor(sx), x1 = Math.min(mask.width - 1, x0 + 1), fx = sx - x0;
      const a = mask.data[y0 * mask.width + x0], b = mask.data[y0 * mask.width + x1];
      const c = mask.data[y1 * mask.width + x0], d = mask.data[y1 * mask.width + x1];
      output[y * width + x] = clamp((a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy);
    }
  }
  return output;
}

// Boundary-only refinement; source RGB in the opaque interior is untouched.
// Colour-guided filtering preserves detail, while a local gradient limits the
// alpha transition to roughly two working-resolution pixels, not a blurred halo.
export function refineMatte(rgba, confidence, width, height, previous = null) {
  const alpha = new Float32Array(width * height);
  const source = rgba.slice();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, p = confidence[i], offset = i * 4;
    const left = i - (x > 0 ? 1 : 0), right = i + (x < width - 1 ? 1 : 0);
    const up = i - (y > 0 ? width : 0), down = i + (y < height - 1 ? width : 0);
    let value = p <= .02 ? 0 : p >= .98 ? 1 : p;
    if (p > .02 && p < .98) {
      let sum = p * 2, weight = 2;
      for (const n of [left, right, up, down]) {
        const k = n * 4;
        const difference = (source[offset] - source[k]) ** 2 + (source[offset + 1] - source[k + 1]) ** 2 + (source[offset + 2] - source[k + 2]) ** 2;
        const w = 1 / (1 + difference / 225);
        sum += confidence[n] * w; weight += w;
      }
      const filtered = p * .65 + sum / weight * .35;
      const gx = (confidence[right] - confidence[left]) * .5, gy = (confidence[down] - confidence[up]) * .5;
      const gradient = Math.max(.025, Math.hypot(gx, gy));
      value = smooth(-1.15, 1.15, (filtered - .5) / gradient);
      // Only stabilize stationary, already similar boundary pixels. Fast
      // movement/new foreground does not inherit a stale silhouette.
      if (previous?.alpha.length === alpha.length && value > 0 && value < 1) {
        const delta = Math.abs(value - previous.alpha[i]);
        const rgbDelta = (source[offset] - previous.rgb[offset]) ** 2 + (source[offset + 1] - previous.rgb[offset + 1]) ** 2 + (source[offset + 2] - previous.rgb[offset + 2]) ** 2;
        if (delta < .25 && rgbDelta < 225) value = value * .78 + previous.alpha[i] * .22;
      }
      // Restrained colour unmixing, using THIS frame's nearby foreground and
      // background. No assumed green/blue/white background, no added outline.
      if (value > .08 && value < .92) {
        const length = Math.hypot(gx, gy);
        if (length > .02) {
          let foreground = -1, background = -1;
          for (let radius = 1; radius <= 3; radius++) {
            for (const direction of [-1, 1]) {
              const nx = clamp(Math.round(x + gx / length * radius * direction), 0, width - 1);
              const ny = clamp(Math.round(y + gy / length * radius * direction), 0, height - 1);
              const n = ny * width + nx;
              if (foreground < 0 && confidence[n] > .85) foreground = n;
              if (background < 0 && confidence[n] < .15) background = n;
            }
          }
          if (foreground >= 0 && background >= 0) for (let channel = 0; channel < 3; channel++) {
            const c = source[offset + channel], b = source[background * 4 + channel], f = source[foreground * 4 + channel];
            const unmixed = clamp((c - (1 - value) * b) / Math.max(.35, value), Math.max(0, f - 28), Math.min(255, f + 28));
            rgba[offset + channel] = c + (unmixed - c) * Math.min(.35, 1 - value) * .8;
          }
        }
      }
    }
    alpha[i] = value;
    rgba[offset + 3] = Math.round(value * 255);
  }
  return { alpha, rgb: source };
}

export function createMatteSurface() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let probability, previous = null;
  return {
    canvas,
    update(source, mask) {
      const sw = source.videoWidth || source.width, sh = source.videoHeight || source.height;
      const scale = Math.min(1, 640 / Math.max(sw, sh));
      const width = Math.max(1, Math.round(sw * scale)), height = Math.max(1, Math.round(sh * scale));
      if (!probability || canvas.width !== width || canvas.height !== height) {
        canvas.width = width; canvas.height = height;
        probability = new Float32Array(width * height); previous = null;
      }
      resampleConfidence(mask, width, height, probability);
      ctx.drawImage(source, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      previous = refineMatte(image.data, probability, width, height, previous);
      ctx.putImageData(image, 0, 0);
      return canvas;
    },
    reset() { previous = null; },
    close() { previous = null; probability = null; canvas.width = canvas.height = 0; }
  };
}
