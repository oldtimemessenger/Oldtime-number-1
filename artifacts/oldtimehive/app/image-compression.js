const MAX_EDGE = 1600;
const SMALL_IMAGE_BYTES = 64 * 1024;
const OPTIMIZABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Never flatten animation. Inspect headers without reading a large file into memory.
export async function isAnimatedImage(blob) {
  const type = blob.type.split(";")[0].toLowerCase();
  if (type === "image/gif") return true;
  if (type === "image/webp") {
    const header = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    return String.fromCharCode(...header.slice(12, 16)) === "VP8X" && Boolean(header[20] & 2);
  }
  if (type !== "image/png") return false;
  let offset = 8;
  for (let count = 0; count < 256 && offset + 8 <= blob.size; count++) {
    const header = new Uint8Array(await blob.slice(offset, offset + 8).arrayBuffer());
    const length = new DataView(header.buffer).getUint32(0);
    const name = String.fromCharCode(...header.slice(4, 8));
    if (name === "acTL") return true;
    if (name === "IDAT" || name === "IEND") return false;
    offset += length + 12;
  }
  // Unknown or unusually long metadata: preserve the original rather than risk animation.
  return true;
}

async function decodeImage(blob) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch { /* Safari and older decoders can use the native image element. */ }
  }
  const source = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("This photo could not be prepared. Try another image."));
      image.src = source;
    });
  } finally {
    URL.revokeObjectURL(source);
  }
}

function encode(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

/** Optimize only a new upload. No cloud originals or existing media IDs are rewritten. */
export async function compressImageForUpload(blob, { onProgress } = {}) {
  const type = blob.type.split(";")[0].toLowerCase();
  if (!OPTIMIZABLE_TYPES.has(type) || blob.size <= SMALL_IMAGE_BYTES || await isAnimatedImage(blob)) return blob;
  onProgress?.(0, "optimizing");
  const image = await decodeImage(blob);
  try {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!(width > 0 && height > 0)) throw new Error("This photo could not be prepared. Try another image.");
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the photo.");
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let optimized = await encode(canvas, "image/webp", 0.78);
    if (optimized?.type !== "image/webp") {
      // PNG preserves transparency when WebP encoding is unavailable.
      optimized = await encode(canvas, type === "image/jpeg" ? "image/jpeg" : "image/png", 0.8);
    }
    onProgress?.(1, "optimizing");
    return optimized?.size > 0 && optimized.size < blob.size ? optimized : blob;
  } finally {
    image.close?.();
  }
}
