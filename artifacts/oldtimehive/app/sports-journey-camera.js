// One camera calculation for the preview and exported journey.
export function journeyCamera(timeline, state, follow, { still = false, street = false } = {}) {
  const b = timeline.bounds, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const radius = Math.max(30, Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2);
  const distance = radius * 2.5 + 40, progress = state?.progress || 0;
  const result = follow && state
    ? { tx: state.x, ty: state.y, D: Math.max(90, distance * .42), yaw: still ? .3 : .3 + progress * 1.1 }
    : { tx: cx, ty: cy, D: distance, yaw: still ? .3 : .3 + (state && state.progress < 1 ? progress * 1.1 : 0) };
  if (street) {
    result.yaw = 0;
    if (follow && state) result.D = Math.max(120, Math.min(600, result.D));
  }
  return result;
}
