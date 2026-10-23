// Shared geometry for live camera preview, capture and crop gestures.
export const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const shouldMirror = facing => facing === "user";
export function cameraConstraints(facing) {
  return { video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false };
}
/** Source rect + destination rect matching the renderer's cover fit. */
export function coverPlan(srcW, srcH, dstW, dstH, crop) {
  const sx = (crop?.x || 0) * srcW, sy = (crop?.y || 0) * srcH, sw = (crop?.width || 1) * srcW, sh = (crop?.height || 1) * srcH;
  const r = Math.max(dstW / sw, dstH / sh);
  return { sx, sy, sw, sh, dx: (dstW - sw * r) / 2, dy: (dstH - sh * r) / 2, dw: sw * r, dh: sh * r };
}
/** Capture exactly the framed region of the preview, mirroring only selfies. */
export function captureFrame(canvas, video, width, height, facing) {
  const p = coverPlan(video.videoWidth, video.videoHeight, width, height);
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.save();
  if (shouldMirror(facing)) { ctx.translate(width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh);
  ctx.restore();
  return canvas;
}
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function zoomFromPinch(startZoom, startDist, dist, min, max) {
  if (!(startDist > 0)) return clampNum(startZoom, min, max);
  return clampNum(startZoom * dist / startDist, min, max);
}
/** Scale a normalized crop rect around its centre; stays inside 0..1. */
export function pinchRect(rect, startDist, dist, minSize = .1) {
  if (!(startDist > 0)) return { ...rect };
  const f = dist / startDist, cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  const width = clampNum(rect.width * f, minSize, 1), height = clampNum(rect.height * f, minSize, 1);
  return { x: clampNum(cx - width / 2, 0, 1 - width), y: clampNum(cy - height / 2, 0, 1 - height), width, height };
}
export function lockAspect(rect, ratio, assetRatio) {
  // ratio is output w/h; rect is normalized, so pixel ratio = rect.w*assetRatio / rect.h
  const width = Math.min(rect.width, rect.height * ratio / assetRatio), height = width * assetRatio / ratio;
  return { x: clampNum(rect.x, 0, 1 - width), y: clampNum(rect.y, 0, 1 - height), width, height };
}
export const resetRect = () => ({ x: 0, y: 0, width: 1, height: 1 });
/** Move the visible source rect by a canvas-space drag. Rect is normalized to the asset. */
export function panCrop(rect, dx, dy, asset, out) {
  const sw = rect.width * asset.w, sh = rect.height * asset.h, r = Math.max(out.w / sw, out.h / sh);
  return { ...rect, x: clampNum(rect.x - dx / r / asset.w, 0, 1 - rect.width), y: clampNum(rect.y - dy / r / asset.h, 0, 1 - rect.height) };
}
/** Zoom in (factor>1) around a canvas-space focal point, keeping that source point fixed. */
export function zoomCrop(rect, factor, focal, asset, out) {
  const width = clampNum(rect.width / factor, .08, 1), height = clampNum(rect.height / factor, .08, 1);
  const fx = rect.x + rect.width * clampNum(focal.x / out.w, 0, 1), fy = rect.y + rect.height * clampNum(focal.y / out.h, 0, 1);
  const ux = clampNum(focal.x / out.w, 0, 1), uy = clampNum(focal.y / out.h, 0, 1);
  return { x: clampNum(fx - width * ux, 0, 1 - width), y: clampNum(fy - height * uy, 0, 1 - height), width, height };
}
/** Natural 1x when the lens range includes it (ultrawide min<1 is not the default), otherwise the nearest limit. */
export const naturalZoom = (min, max) => clampNum(1, Number(min) || 1, Number(max) || 1);
