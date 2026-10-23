// Only recorded GPS points are used. Tokens are virtual distance milestones,
// never invented landmarks, traffic reports or directions to unknown places.
export const DEFAULT_STREET_LAYERS = Object.freeze({ route: true, markers: true, streets: true, pace: false, collectibles: false, heat: false });
const heatCache = new WeakMap();
export function heatCells(timeline) {
  if (!timeline || typeof timeline !== "object") return [];
  if (heatCache.has(timeline)) return heatCache.get(timeline);
  const cells = new Map();
  for (const segment of timeline.segments || []) for (const p of segment.pts || []) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const x = Math.floor(p.x / 100) * 100 + 50, y = Math.floor(p.y / 100) * 100 + 50, key = `${x}:${y}`;
    const c = cells.get(key) || { x, y, count: 0 }; c.count++; cells.set(key, c);
  }
  const result = [...cells.values()].sort((a, b) => b.count - a.count).slice(0, 64);
  heatCache.set(timeline, result); return result;
}
export function drawStreetHeat(ctx, timeline, project, width) {
  const cells = heatCells(timeline), max = Math.max(1, ...cells.map(c => c.count));
  for (const c of cells) {
    const p = project(c.x, c.y); if (!p) continue;
    const radius = Math.max(20, width / 11), intensity = c.count / max;
    const g = ctx.createRadialGradient(...p, 0, ...p, radius);
    g.addColorStop(0, intensity > .6 ? "rgba(237,35,57,.42)" : "rgba(237,35,57,.3)");
    g.addColorStop(.55, "rgba(249,166,80,.17)"); g.addColorStop(1, "rgba(249,166,80,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(...p, radius, 0, Math.PI * 2); ctx.fill();
  }
}
export const streetLayers = values => Object.fromEntries(Object.entries(DEFAULT_STREET_LAYERS).map(([k, v]) => [k, typeof values?.[k] === "boolean" ? values[k] : v]));
export function checkpoints(timeline, distance = timeline?.total || 0) {
  const result = []; let next = 250;
  for (const segment of timeline?.segments || []) {
    if (!segment.pts.length) continue;
    next = Math.max(next, Math.ceil(segment.pts[0].cum / 250) * 250);
    for (let i = 1; i < segment.pts.length; i++) {
      const a = segment.pts[i - 1], point = segment.pts[i];
      while (point.cum >= next && next <= distance) {
        const f = Math.max(0, Math.min(1, (next - a.cum) / Math.max(.001, point.cum - a.cum)));
        result.push({ x: a.x + (point.x - a.x) * f, y: a.y + (point.y - a.y) * f, distanceM: next, collected: true }); next += 250;
      }
    }
  }
  return result;
}
export function drawStreetLayers(ctx, tl, st, project, layers, width) {
  if (layers.pace) for (const segment of tl.segments) {
    for (let i = 1; i < segment.pts.length; i++) {
      const a = segment.pts[i - 1], b = segment.pts[i];
      if (b.cum > (st?.cum ?? tl.total)) break;
      const p = project(a.x, a.y), q = project(b.x, b.y);
      if (!p || !q) continue;
      const speed = (b.cum - a.cum) / Math.max(.001, ((b.v ?? 0) - (a.v ?? 0)) / 1000);
      // Pace colouring is this workout's measured movement, not a crowd heatmap.
      ctx.strokeStyle = speed > 4 ? "#ed2339" : speed > 2 ? "#269ec4" : "#45b67f";
      ctx.lineWidth = Math.max(4, width / 100); ctx.beginPath();
      ctx.moveTo(...p); ctx.lineTo(...q); ctx.stroke();
    }
  }
  if (layers.collectibles) for (const point of checkpoints(tl, st?.cum ?? tl.total)) {
    const p = project(point.x, point.y); if (!p) continue;
    const r = Math.max(9, width / 45);
    ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    ctx.fillStyle = "#d4ff80"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = "#274627"; ctx.stroke();
    ctx.fillStyle = "#274627"; ctx.font = `700 ${Math.max(10, r)}px system-ui`; ctx.textAlign = "center";
    ctx.fillText(String(point.distanceM / 250), p[0], p[1] + r * .36);
  }
}
export function clampStreetView(view, bounds, baseDistance) {
  const size = Math.max(80, Math.hypot(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0) * .5 + baseDistance * .2);
  return { zoom: Math.max(.65, Math.min(8, view.zoom || 1)),
    x: Math.max(-size, Math.min(size, view.x || 0)),
    y: Math.max(-size, Math.min(size, view.y || 0)) };
}
export function bindStreetGestures(canvas, renderer, changed) {
  if (!canvas?.addEventListener) return () => {};
  canvas.style.touchAction = "none";
  const points = new Map(); let start = null;
  const position = e => ({ x: e.clientX, y: e.clientY });
  const begin = () => {
    const p = [...points.values()];
    start = { view: { ...(renderer.view || { zoom: 1, x: 0, y: 0 }) },
      x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length,
      distance: p.length === 2 ? Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) : 0 };
  };
  const down = e => {
    if (e.pointerType === "mouse" && e.button !== 0 || points.size >= 2) return;
    e.preventDefault(); points.set(e.pointerId, position(e));
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    begin();
  };
  const move = e => {
    if (!points.has(e.pointerId) || !start || !renderer.cam) return;
    points.set(e.pointerId, position(e)); e.preventDefault();
    const p = [...points.values()], rect = canvas.getBoundingClientRect();
    const cx = p.reduce((s, q) => s + q.x, 0) / p.length, cy = p.reduce((s, q) => s + q.y, 0) / p.length;
    const scale = renderer.cam.D / Math.max(1, Math.min(rect.height * .85, rect.width * 1.25));
    const distance = p.length === 2 ? Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) : 0;
    renderer.view = clampStreetView({ zoom: start.view.zoom * (start.distance > 0 ? distance / start.distance : 1),
      x: start.view.x - (cx - start.x) * scale, y: start.view.y + (cy - start.y) * scale }, renderer.tl.bounds, renderer.cam.D);
    changed();
  };
  const end = e => { points.delete(e.pointerId); if (points.size) begin(); else start = null; };
  const cancel = () => { points.clear(); start = null; };
  const wheel = e => {
    if (!e.ctrlKey) return; e.preventDefault();
    renderer.view = clampStreetView({ ...(renderer.view || { x: 0, y: 0, zoom: 1 }),
      zoom: (renderer.view?.zoom || 1) * Math.exp(-e.deltaY * .008) }, renderer.tl.bounds, renderer.cam?.D || 400); changed();
  };
  const events = { pointerdown: down, pointermove: move, pointerup: end, pointercancel: cancel, lostpointercapture: end, wheel };
  for (const [type, fn] of Object.entries(events)) canvas.addEventListener(type, fn, { passive: false });
  return () => { for (const [type, fn] of Object.entries(events)) canvas.removeEventListener(type, fn); cancel(); };
}
