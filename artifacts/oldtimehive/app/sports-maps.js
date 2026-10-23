// Sports replay exports. Vector replays can render the same OpenFreeMap basemap shown in the app;
// the Canvas and terrain renderers remain available for their existing map modes.
import { buildTimeline, buildLiveTimeline, stateAt, metersToLonLat, clock, paceText, kmText, animatedCardSvg } from "./sports-replay.js";
import { terrainProvider as TP } from "./sports-terrain.js";
import { loadImagery, drawImagery } from "./sports-imagery.js";
import { streetLayers, drawStreetLayers, drawStreetHeat, checkpoints, bindStreetGestures } from "./sports-street-layers.js";
import { journeyCamera } from "./sports-journey-camera.js";
import { loadRoads, createRoadOverlay } from "./sports-road-network.js";
import { FLYOVER_PHASES, ReplayVectorRenderer, flyoverRouteProgress, replayCameraProgress } from "./sports-replay-vector-map.js";
import { OPENFREEMAP_VIDEO_CREDIT, openFreeMapProvider, sportsRouteColor } from "./sports-vector-style.js";
import { selectVideoMime, verifyVideoBlob, exportDurationSeconds } from "./sports-video.js";
import { POSITION_RED } from "./sports-marker.js";
import { REPLAY_SPEEDS, replaySpeedFor } from "./sports-replay-speed.js";

const COLORS = { run: "#ed2339", walk: "#6bff8f", cycle: "#6f7dff", hike: "#ff7a1a" };
const colorOf = w => COLORS[w?.activityType] || "#c8ff2e";
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion:reduce)").matches;
export const webglOk = () => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } };
export const videoMime = () => (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement === "undefined" || !HTMLCanvasElement.prototype.captureStream) ? null : selectVideoMime(MediaRecorder);
export const videoSupport = () => !!videoMime();
export const TERRAIN_LINKS = TP.links;
export const TERRAIN_LINES = TP.attributionLines;
export const TERRAIN_CREDIT = TP.credit;
const NICE = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
const niceStep = v => NICE.find(n => n >= v) || NICE.at(-1);
const lerp = (a, b, k) => a + (b - a) * k;
let oldtimeLogoImage = null, oldtimeLogoPromise = null;
function loadOldtimeLogo() {
  if (oldtimeLogoImage) return Promise.resolve(oldtimeLogoImage);
  if (oldtimeLogoPromise) return oldtimeLogoPromise;
  oldtimeLogoPromise = new Promise(resolve => {
    if (typeof Image === "undefined") { resolve(null); return; }
    const image = new Image();
    image.onload = () => { oldtimeLogoImage = image; resolve(image); };
    image.onerror = () => resolve(null);
    image.src = new URL(`${import.meta.env.BASE_URL}brand/oldtime-login-red.png`, document.baseURI).href;
  });
  return oldtimeLogoPromise;
}

// ---------- camera + scene (shared by live canvas, canvas fallback and stylized export) ----------
function camTarget(tl, st, follow, o = {}) {
  return journeyCamera(tl, st, follow, o);
}
function easeCam(cam, t, dt, snap) {
  if (!cam || snap) return { cam: { ...t }, moving: false };
  const k = 1 - Math.exp(-dt / 330);
  const n = { tx: lerp(cam.tx, t.tx, k), ty: lerp(cam.ty, t.ty, k), D: lerp(cam.D, t.D, k), yaw: lerp(cam.yaw, t.yaw, k) };
  return { cam: n, moving: Math.hypot(n.tx - t.tx, n.ty - t.ty) > .2 || Math.abs(n.D - t.D) > .3 || Math.abs(n.yaw - t.yaw) > .002 };
}
function drawScene(ctx, W, H, { tl, st, cam, color, time = 0, imagery = null, overhead = false, layers = streetLayers() }) {
  const street = imagery?.source?.kind === "street";
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#090d13"); g.addColorStop(.42, "#131a25"); g.addColorStop(1, "#1e2432");
  ctx.fillStyle = street ? "#eef1ed" : g; ctx.fillRect(0, 0, W, H);
  const pitch = overhead ? Math.PI / 2 : .96, D = cam.D, cp = Math.cos(pitch), sp = Math.sin(pitch);
  const ex = cam.tx + D * cp * Math.sin(cam.yaw), ey = cam.ty - D * cp * Math.cos(cam.yaw), ez = D * sp;
  let fx = cam.tx - ex, fy = cam.ty - ey, fz = -ez; const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  let rx = fy, ry = -fx; const rl = Math.hypot(rx, ry) || 1; rx /= rl; ry /= rl;
  const ux = ry * fz, uy = -rx * fz, uz = rx * fy - ry * fx, focal = Math.min(H * .85, W * 1.25);
  const proj = (x, y) => {
    // A stable orthographic basis avoids the perspective camera's pole singularity.
    // Aerial perspective is deliberately unchanged.
    if (street && overhead) return [W / 2 + (x - cam.tx) / D * focal, H * .52 - (y - cam.ty) / D * focal];
    const vx = x - ex, vy = y - ey, vz = -ez, zc = vx * fx + vy * fy + vz * fz;
    if (zc < 1) return null;
    return [W / 2 + (vx * rx + vy * ry) / zc * focal, H * .52 - (vx * ux + vy * uy + vz * uz) / zc * focal];
  };
  // reference grid
  const step = niceStep(D / 7), N = 14, kx = Math.round(cam.tx / step), ky = Math.round(cam.ty / step), buckets = new Map();
  if (imagery) {
    drawImagery(ctx, imagery, proj, { flat: overhead && Math.abs(cam.yaw) < .0001 });
    if (street && layers.streets && imagery.roadImage) drawImagery(ctx, { ...imagery, image: imagery.roadImage }, proj, { flat: overhead && Math.abs(cam.yaw) < .0001 });
    if (!street) { ctx.fillStyle = "rgba(5,10,15,.14)"; ctx.fillRect(0, 0, W, H); }
  } else {
  const seg = (x0, y0, x1, y1, major) => {
    const a = proj(x0, y0), b = proj(x1, y1); if (!a || !b) return;
    const fade = 1 - Math.hypot((x0 + x1) / 2 - cam.tx, (y0 + y1) / 2 - cam.ty) / (N * step); if (fade <= .02) return;
    const key = Math.round(fade * 6) * 2 + (major ? 1 : 0); let p = buckets.get(key); if (!p) buckets.set(key, p = new Path2D());
    p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]);
  };
  for (let a = -N; a <= N; a++) for (let b = -N; b < N; b++) {
    const gx = (kx + a) * step, gy = (ky + b) * step;
    seg(gx, gy, gx, gy + step, (kx + a) % 5 === 0); seg(gy < 0 ? gx : gx, gy, gx + step, gy, (ky + b) % 5 === 0);
  }
  ctx.lineWidth = Math.max(1, W / 480);
  for (const [key, p] of buckets) { ctx.globalAlpha = Math.min(.7, (key >> 1) / 6) * ((key & 1) ? .6 : .3) * 1.4; ctx.strokeStyle = "#8fa6c4"; ctx.stroke(p); }
  ctx.globalAlpha = 1;
  }
  // route
  if (street && layers.heat) drawStreetHeat(ctx, tl, proj, W);
  const lw = Math.max(3, W / 110), pathOf = pts => { const p = new Path2D(); let pen = false; for (const q of pts) { const s = proj(q.x, q.y); if (!s) { pen = false; continue; } pen ? p.lineTo(s[0], s[1]) : p.moveTo(s[0], s[1]); pen = true; } return p; };
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const full = tl.segments.map(s => pathOf(s.pts));
  if (!street || layers.route) {
  ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.lineWidth = lw * 1.9; full.forEach(p => ctx.stroke(p));
  ctx.strokeStyle = "rgba(255,255,255,.34)"; ctx.lineWidth = lw * .8; full.forEach(p => ctx.stroke(p));
  if (st) {
    const doneSegs = tl.segments.map((s, k) => k < st.seg ? s.pts : k === st.seg ? [...s.pts.slice(0, st.i + 1), { x: st.x, y: st.y }] : null).filter(Boolean);
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.shadowColor = color; ctx.shadowBlur = lw * 2;
    doneSegs.forEach(s => ctx.stroke(pathOf(s))); ctx.shadowBlur = 0;
  }
  }
  // start, finish
  const first = tl.segments[0].pts[0], lastP = tl.segments.at(-1).pts.at(-1), r = Math.max(13, W / 38);
  const dot = (p, fill, stroke) => { const s = proj(p.x, p.y); if (!s) return; ctx.beginPath(); ctx.arc(s[0], s[1], r, 0, 7); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = r * .4; ctx.strokeStyle = stroke; ctx.stroke(); };
  if (!street || layers.markers) { dot(first, POSITION_RED, "#fff"); dot(lastP, POSITION_RED, "#fff"); }
  if (street) drawStreetLayers(ctx, tl, st, proj, layers, W);
  // halo marker
  if (st) { const s = proj(st.x, st.y); if (s) {
    const pulse = 1.5 + .3 * Math.sin(time / 380); ctx.beginPath(); ctx.arc(s[0], s[1], r * pulse * 1.5, 0, 7); ctx.fillStyle = POSITION_RED; ctx.globalAlpha = .3; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(s[0], s[1], r * .92, 0, 7); ctx.fillStyle = POSITION_RED; ctx.fill(); ctx.lineWidth = r * .35; ctx.strokeStyle = "#fff"; ctx.stroke();
  } }
  // compass + grid scale (honest labelling of what the grid is)
  if (street && st) {
    const p = proj(st.x, st.y), a = tl.segments[st.seg]?.pts[st.i], b = tl.segments[st.seg]?.pts[st.i + 1];
    if (p && a && b && Math.hypot(b.x - a.x, b.y - a.y) > .5) {
      const heading = a && b ? Math.atan2(b.x - a.x, b.y - a.y) : 0, r = Math.max(10, W / 28);
      ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(heading);
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, 0, r * 1.35, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#193c62"; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * .7, r * .55); ctx.lineTo(0, r * .2); ctx.lineTo(-r * .7, r * .55); ctx.closePath(); ctx.fill(); ctx.restore();
    }
  }
  const c0 = proj(cam.tx, cam.ty), c1 = proj(cam.tx, cam.ty + D * .2), ang = c0 && c1 ? Math.atan2(c1[1] - c0[1], c1[0] - c0[0]) : -Math.PI / 2, cr = W / 26, cx = W - cr * 1.8, cy = cr * 1.8;
  ctx.save(); ctx.translate(cx, cy); ctx.strokeStyle = street ? "#193c62" : "rgba(255,255,255,.5)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, cr, 0, 7); ctx.stroke();
  ctx.rotate(ang + Math.PI / 2); ctx.fillStyle = street ? "#193c62" : "#fff"; ctx.beginPath(); ctx.moveTo(0, -cr * .8); ctx.lineTo(cr * .3, cr * .3); ctx.lineTo(-cr * .3, cr * .3); ctx.fill(); ctx.restore();
  ctx.fillStyle = street ? "#193c62" : "#fff"; ctx.font = `700 ${Math.round(cr * .6)}px system-ui,sans-serif`; ctx.textAlign = "center"; ctx.fillText("N", cx, cy + cr * 1.9);
  ctx.textAlign = "left"; ctx.fillStyle = street ? "#193c62" : "rgba(255,255,255,.62)"; ctx.font = `600 ${Math.max(11, Math.round(W / 46))}px system-ui,sans-serif`;
  ctx.fillText(imagery ? imagery.source.credit : `Grid cell ${step >= 1000 ? step / 1000 + " km" : step + " m"}`, W / 36, H - W / 36);
}

class CanvasRenderer {
  constructor(host, tl, color, imagery = null, overhead = false, live = false) {
    this.overhead = overhead; this.live = live;
    this.kind = imagery ? "imagery" : "canvas"; this.imagery = imagery; this.color = color; this.tl = tl; this.cam = null; this.t0 = performance.now();
    this.el = document.createElement("div"); this.el.className = "sp-aer"; this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("role", "img"); this.canvas.setAttribute("aria-label", imagery ? `${imagery.source.label} with your GPS route` : "Stylized aerial view of your recorded GPS route over a reference grid");
    this.canvas.style.cssText = "width:100%;height:100%;display:block"; this.el.style.cssText = "position:absolute;inset:0"; this.el.appendChild(this.canvas); host.appendChild(this.el);
    if (imagery?.source?.kind === "street") {
      const credit = document.createElement("a");
      credit.textContent = "© OpenStreetMap contributors"; credit.href = "https://www.openstreetmap.org/copyright";
      credit.target = "_blank"; credit.rel = "noopener noreferrer";
      credit.style.cssText = "position:absolute;top:10px;left:10px;z-index:3;padding:3px 6px;border-radius:4px;background:rgba(255,255,255,.94);color:#334155;font:10px/1.3 system-ui,sans-serif;text-decoration:none";
      this.el.appendChild(credit);
    }
    this.ctx = this.canvas.getContext("2d"); this.resize();
    this.ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => { this.resize(); this.onDirty?.(); }) : null; this.ro?.observe(host);
  }
  resize() { const d = Math.min(2, devicePixelRatio || 1), w = Math.max(80, this.el.clientWidth || 300), h = Math.max(80, this.el.clientHeight || 260); this.canvas.width = Math.round(w * d); this.canvas.height = Math.round(h * d); }
  setTimeline(tl) {
    this.tl = tl;
    if (this.imagery) {
      const old = this.imagery.timeline;
      if (old) {
        const dx = (old.lon0 - tl.lon0) * 6378137 * Math.PI / 180 * Math.cos(tl.lat0 * Math.PI / 180);
        const dy = (old.lat0 - tl.lat0) * 6378137 * Math.PI / 180;
        const scale = Math.cos(tl.lat0 * Math.PI / 180) / Math.cos(old.lat0 * Math.PI / 180);
        this.imagery = { ...this.imagery, points: this.imagery.points.map(p => ({ ...p, x: p.x * scale + dx, y: p.y + dy })), timeline: tl };
      }
    }
  }
  frame(st, { follow, dt, snap }) {
    const target = this.live && st ? { tx: st.x, ty: st.y, D: 400, yaw: this.overhead ? 0 : .3 } : camTarget(this.tl, st, follow, { still: reduced() });
    if (this.overhead) target.yaw = 0;
    if (this.overhead && follow && !this.live) target.D = Math.max(120, Math.min(600, target.D));
    if (this.overhead && this.imagery?.source?.kind === "street" && this.view) {
      target.tx += this.view.x; target.ty += this.view.y; target.D /= this.view.zoom;
    }
    const e = easeCam(this.cam, target, dt, snap); this.cam = e.cam;
    drawScene(this.ctx, this.canvas.width, this.canvas.height, { tl: this.tl, st, cam: this.cam, color: this.color, time: performance.now() - this.t0, imagery: this.imagery, overhead: this.overhead, layers: this.layers });
    return e.moving;
  }
  drawTo() { throw new Error("canvas renderer exports through its own scene"); }
  destroy() { this.gestureCleanup?.(); this.ro?.disconnect(); this.el.remove(); }
}

// ---------- optional MapLibre terrain ----------
class TerrainRenderer {
  static async create(host, tl, color) {
    let mod, ml;
    try { [mod] = await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")]); ml = mod.default || mod; }
    catch { throw new Error("The terrain renderer could not be loaded."); }
    const r = new TerrainRenderer(); r.ml = ml; r.tl = tl; r.color = color; r.kind = "terrain";
    r.el = document.createElement("div"); r.el.className = "sp-aer"; r.el.style.cssText = "position:absolute;inset:0"; host.appendChild(r.el);
    try { await r.build(); } catch (e) { r.destroy(); throw e; }
    return r;
  }
  gridData() {
    const tl = this.tl, b = tl.bounds, ext = Math.max(b.x1 - b.x0, b.y1 - b.y0, 100), step = niceStep(ext / 6), n = Math.ceil(ext * 2 / step) + 2;
    const cx = Math.round((b.x0 + b.x1) / 2 / step), cy = Math.round((b.y0 + b.y1) / 2 / step), feats = [], ll = (x, y) => { const p = metersToLonLat(tl, x, y); return [p.lon, p.lat]; };
    for (let a = -n; a <= n; a++) {
      feats.push({ type: "Feature", properties: { major: (cx + a) % 5 === 0 ? 1 : 0 }, geometry: { type: "LineString", coordinates: [ll((cx + a) * step, (cy - n) * step), ll((cx + a) * step, (cy + n) * step)] } });
      feats.push({ type: "Feature", properties: { major: (cy + a) % 5 === 0 ? 1 : 0 }, geometry: { type: "LineString", coordinates: [ll((cx - n) * step, (cy + a) * step), ll((cx + n) * step, (cy + a) * step)] } });
    }
    return { type: "FeatureCollection", features: feats };
  }
  routeData(upTo) {
    const tl = this.tl, lines = [];
    tl.segments.forEach((s, k) => {
      let pts = s.pts; if (upTo) { if (k > upTo.seg) return; if (k === upTo.seg) pts = [...pts.slice(0, upTo.i + 1), { lon: upTo.lon, lat: upTo.lat }]; }
      if (pts.length > 1) lines.push(pts.map(p => [p.lon, p.lat]));
    });
    return { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: lines } };
  }
  async build() {
    const ml = this.ml, tl = this.tl, ll = tl.llBounds, color = this.color, first = tl.segments[0].pts[0], last = tl.segments.at(-1).pts.at(-1);
    const empty = { type: "FeatureCollection", features: [] };
    const ends = { type: "FeatureCollection", features: [{ type: "Feature", properties: { k: "s" }, geometry: { type: "Point", coordinates: [first.lon, first.lat] } }, { type: "Feature", properties: { k: "f" }, geometry: { type: "Point", coordinates: [last.lon, last.lat] } }] };
    const style = { version: 8, sources: {
      dem: { type: "raster-dem", tiles: TP.tiles, tileSize: TP.tileSize, maxzoom: TP.maxzoom, encoding: TP.encoding, attribution: TP.creditHtml },
      grid: { type: "geojson", data: this.gridData() }, route: { type: "geojson", data: this.routeData() }, done: { type: "geojson", data: empty }, ends: { type: "geojson", data: ends }, pt: { type: "geojson", data: empty } },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#1a2230" } },
      { id: "hill", type: "hillshade", source: "dem", paint: { "hillshade-exaggeration": .7, "hillshade-shadow-color": "#05070b", "hillshade-highlight-color": "#9fb4cf", "hillshade-accent-color": "#2b3647" } },
      { id: "grid", type: "line", source: "grid", paint: { "line-color": "#8fa6c4", "line-opacity": ["case", ["==", ["get", "major"], 1], .28, .12], "line-width": 1 } },
      { id: "case", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#000", "line-opacity": .55, "line-width": 9 } },
      { id: "dim", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fff", "line-opacity": .38, "line-width": 4 } },
      { id: "done", type: "line", source: "done", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": color, "line-width": 6 } },
      { id: "ends", type: "circle", source: "ends", paint: { "circle-radius": 14, "circle-color": POSITION_RED, "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" } },
      { id: "halo", type: "circle", source: "pt", paint: { "circle-radius": 34, "circle-color": POSITION_RED, "circle-opacity": .34 } },
      { id: "dot", type: "circle", source: "pt", paint: { "circle-radius": 13, "circle-color": POSITION_RED, "circle-stroke-width": 3, "circle-stroke-color": "#fff" } }] };
    const map = this.map = new ml.Map({ container: this.el, style, center: [(ll.w + ll.e) / 2, (ll.s + ll.n) / 2], zoom: 13, pitch: 55, bearing: 0, interactive: false, attributionControl: false, fadeDuration: 0, maxPitch: 70, canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true } });
    map.addControl(new ml.AttributionControl({ compact: false }));
    await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error("Terrain tiles took too long to load.")), 9000);
      const bad = e => { if (e?.sourceId === "dem" || /elevation-tiles|terrarium|dem/i.test(e?.error?.message || "")) { clearTimeout(timer); rej(new Error("Terrain tiles could not be loaded.")); } };
      map.on("error", bad);
      map.on("sourcedata", e => { if (e.sourceId === "dem" && map.isSourceLoaded("dem")) { clearTimeout(timer); res(); } });
      map.on("error", e => { if (this.live) this.onFail?.(e); });
    });
    map.setTerrain({ source: "dem", exaggeration: 1.15 }); this.live = true;
    const bc = map.cameraForBounds([[ll.w, ll.s], [ll.e, ll.n]], { padding: 56, pitch: 55, bearing: 0 });
    this.fitZoom = Math.min(17, bc?.zoom ?? 14); this.fitCenter = [(ll.w + ll.e) / 2, (ll.s + ll.n) / 2]; this.cam = null;
  }
  setTimeline(tl) {
    this.tl = tl; const m = this.map; if (!m) return;
    m.getSource("route")?.setData(this.routeData()); m.getSource("grid")?.setData(this.gridData());
    const ll = tl.llBounds, bc = m.cameraForBounds([[ll.w, ll.s], [ll.e, ll.n]], { padding: 56, pitch: 55, bearing: 0 }); this.fitZoom = Math.min(17, bc?.zoom ?? this.fitZoom); this.fitCenter = [(ll.w + ll.e) / 2, (ll.s + ll.n) / 2];
  }
  frame(st, { follow, dt, snap }) {
    const m = this.map; if (!m) return false;
    const f = follow && st, t = { x: f ? st.lon : this.fitCenter[0], y: f ? st.lat : this.fitCenter[1], z: f ? Math.min(17.5, this.fitZoom + 1.3) : this.fitZoom, b: reduced() ? 0 : f ? 20 - (st.progress * 80) : 0 };
    let moving = false;
    if (!this.cam || snap) this.cam = { ...t }; else { const k = 1 - Math.exp(-dt / 330); this.cam = { x: lerp(this.cam.x, t.x, k), y: lerp(this.cam.y, t.y, k), z: lerp(this.cam.z, t.z, k), b: lerp(this.cam.b, t.b, k) }; moving = Math.abs(this.cam.z - t.z) > .01 || Math.abs(this.cam.x - t.x) > 1e-6 || Math.abs(this.cam.y - t.y) > 1e-6 || Math.abs(this.cam.b - t.b) > .3; }
    m.jumpTo({ center: [this.cam.x, this.cam.y], zoom: this.cam.z, bearing: this.cam.b, pitch: 55 });
    m.getSource("done")?.setData(st ? this.routeData(st) : { type: "FeatureCollection", features: [] });
    m.getSource("pt")?.setData(st ? { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [st.lon, st.lat] } } : { type: "FeatureCollection", features: [] });
    return moving;
  }
  drawTo(ctx, W, H) {
    this.map.redraw?.(); const c = this.map.getCanvas(), s = Math.max(W / c.width, H / c.height), w = c.width * s, h = c.height * s;
    ctx.drawImage(c, (W - w) / 2, (H - h) / 2, w, h);
  }
  destroy() { this.live = false; try { this.map?.remove(); } catch {} this.el?.remove(); }
}

// ---------- HUD for exported frames ----------
function wrapText(ctx, text, max, lines) {
  const out = []; let line = "";
  for (const w of String(text || "").split(/\s+/).filter(Boolean)) { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > max && line) { out.push(line); line = w; } else line = t; }
  if (line) out.push(line); return out.slice(0, lines);
}
function drawHud(ctx, W, H, o) {
  const { st, tl, workout, owner, caption, terrain, imagery, vectorMap, mapCredit, color, hideEnds } = o, s = workout.summary || {};
  const landscape = W > H, u = landscape ? Math.min(W / 1280, H / 720) : W / 720;
  const headHeight = landscape ? 92 : 150, panelHeight = landscape ? 215 : 400;
  const left = landscape ? 46 : 36, top = H - panelHeight * u;
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(9,13,19,.55)"; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, headHeight * u); ctx.lineTo(0, (headHeight - 18) * u); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = `800 ${(landscape ? 42 : 58) * u}px system-ui,sans-serif`; ctx.fillText("ACTIVITY", left * u, (landscape ? 50 : 84) * u);
  ctx.fillStyle = color; ctx.font = `700 ${(landscape ? 21 : 26) * u}px system-ui,sans-serif`; ctx.fillText(({ run: "RUN", walk: "WALK", cycle: "RIDE", hike: "HIKE" }[workout.activityType] || "WORKOUT"), left * u, (landscape ? 78 : 118) * u);
  const brandW = 242 * u, brandH = 50 * u, brandX = W - brandW - 18 * u, brandY = 16 * u;
  ctx.save();
  ctx.fillStyle = "rgba(9,13,19,.76)";
  ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.lineWidth = u;
  ctx.beginPath(); ctx.roundRect(brandX, brandY, brandW, brandH, 13 * u); ctx.fill(); ctx.stroke();
  if (oldtimeLogoImage) {
    const logoH = 36 * u, logoW = logoH * oldtimeLogoImage.width / oldtimeLogoImage.height;
    ctx.drawImage(oldtimeLogoImage, brandX + 8 * u, brandY + (brandH - logoH) / 2, logoW, logoH);
  }
  const brandTextX = brandX + 52 * u;
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,.72)"; ctx.font = `700 ${9 * u}px system-ui,sans-serif`;
  ctx.fillText("POWERED BY", brandTextX, brandY + 17 * u, brandW - 62 * u);
  ctx.fillStyle = "#fff"; ctx.font = `800 ${15 * u}px system-ui,sans-serif`;
  ctx.fillText("OLDTIME", brandTextX, brandY + 34 * u, brandW - 62 * u);
  ctx.restore();
  ctx.fillStyle = "rgba(9,13,19,.82)"; ctx.beginPath(); ctx.moveTo(0, top + 30 * u); ctx.lineTo(W, top); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
  const speed = st?.pace > 0 ? (3600 / st.pace).toFixed(1) : null;
  const paceValue = workout.activityType === "cycle" ? speed : st?.pace ? paceText(st.pace).replace(" /km", "") : null;
  const paceLabel = workout.activityType === "cycle" ? "Speed km/h" : "Pace /km";
  const cols = [[kmText(st?.cum ?? 0).replace(" km", ""), "Distance km"], [clock(st?.v ?? 0), "Replay time"], [paceValue || "--", paceLabel]];
  cols.forEach(([v, l], i) => { const x = (left + i * (landscape ? 390 : 220)) * u; ctx.fillStyle = "#fff"; ctx.font = `800 ${(landscape ? 42 : 52) * u}px system-ui,sans-serif`; ctx.fillText(v, x, top + (landscape ? 82 : 108) * u); ctx.fillStyle = "#a2a8b0"; ctx.font = `600 ${(landscape ? 16 : 19) * u}px system-ui,sans-serif`; ctx.fillText(l, x, top + (landscape ? 107 : 136) * u); });
  ctx.font = `600 ${21 * u}px system-ui,sans-serif`; ctx.fillStyle = "#d6dae0";
  const alt = st?.alt != null ? `GPS altitude ${Math.round(st.alt)} m` : "", climb = Number.isFinite(s.elevationGainM) && s.elevationGainM > 0 ? `Climb ${Math.round(s.elevationGainM)} m (recorded GPS)` : "";
  const elev = [alt, climb].filter(Boolean).join("   "); if (elev) ctx.fillText(elev, left * u, top + (landscape ? 135 : 176) * u);
  const name = owner?.name || owner?.username || ""; if (name) { ctx.fillStyle = "#fff"; ctx.font = `700 ${26 * u}px system-ui,sans-serif`; ctx.fillText(name, left * u, top + (landscape ? 164 : 216) * u); }
  if (caption) { ctx.fillStyle = "#d6dae0"; ctx.font = `500 ${21 * u}px system-ui,sans-serif`; wrapText(ctx, caption, W - 2 * left * u, 2).forEach((l, i) => ctx.fillText(l, left * u, top + (landscape ? 190 : 252) * u + i * 28 * u)); }
  ctx.fillStyle = "#a2a8b0"; ctx.font = `500 ${15 * u}px system-ui,sans-serif`;
  const credit = [
    ...(vectorMap ? [mapCredit || OPENFREEMAP_VIDEO_CREDIT] : []),
    ...(imagery && !vectorMap ? [imagery.source.credit, imagery.source.detail] : []),
    ...(terrain ? [TP.credit, "Full data-source credits: " + TP.attributionUrl,
      ...(vectorMap ? [] : ["United States 3DEP, GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey. Relief is DEM scenery; elevation numbers are recorded GPS only."])] : []),
     ...(!vectorMap && !imagery && !terrain ? ["Stylized aerial. The grid is a reference, not a map. No terrain or imagery data."] : []),
  ];
  if (tl.estimatedGapCount) credit.push("Dashed path marks an estimated short GPS gap; it is excluded from recorded workout stats.");
  credit.push(hideEnds ? "Start and finish areas hidden." : "Start and finish shown.");
  credit.flatMap(t => wrapText(ctx, t, W - 72 * u, 3)).slice(0, 5).forEach((l, i, a) => ctx.fillText(l, 36 * u, H - (22 + (a.length - 1 - i) * 19) * u));
}

// ---------- controller ----------
class Aerial {
  constructor(host, o) {
    Object.assign(this, { host, workout: o.workout, hideEnds: !!(o.hideEnds ?? o.publicRoute), onError: o.onError, onFrame: o.onFrame, onMode: o.onMode, live: !!o.live, overhead: !!o.overhead });
    this.vectorMapProvider = o.vectorMapProvider || openFreeMapProvider;
    this.layers = streetLayers(o.layers);
    this.theme = o.theme === "dark" ? "dark" : "light";
    this.color = colorOf(o.workout); this.v = 0; this.playing = false; this.snap = true; this.follow = false; this.destroyed = false; this.raf = 0; this.token = 0;
    this.mode = "stylized"; this.desiredStyle = "stylized"; this.reason = ""; this.exporting = false; this.speed = 60; this.defaultSpeed = o.defaultSpeed; this.last = 0;
    this.tl = this.live ? buildLiveTimeline(this.workout) : buildTimeline(this.workout, { hideEnds: this.hideEnds }); this.v = this.tl.duration; this.autoSpeed();
    this.flyoverCamera = !this.live && this.defaultSpeed === 8;
    this.lastFlyoverProgress = this.flyoverCamera ? FLYOVER_PHASES.chaseToOrbitEnd : null;
  }
  autoSpeed() { this.speed = replaySpeedFor(this.tl.duration, this.defaultSpeed); }
  problem() { return this.tl.status === "short" ? "This route is too short to hide its start and finish. Turn that option off to show the full route." : this.tl.status === "none" ? "This workout has no GPS route to show." : ""; }
  async init(style) {
    this.desiredStyle = style || "stylized";
    this.rend = this.tl.status === "ok" && this.desiredStyle !== "vector" ? this.canvasRenderer() : null;
    this.emitMode(); if (["terrain", "imagery", "street", "vector"].includes(style)) await this.setStyle(style); this.kick();
  }
  canvasRenderer(imagery = null) { const r = new CanvasRenderer(this.host, this.tl, this.color, imagery, this.overhead, this.live); r.onDirty = () => this.kick(); return r; }
  terrainState() {
    if (this.tl.status !== "ok") return { available: false, reason: "No route." };
    if (!webglOk()) return { available: false, reason: "This browser cannot use WebGL for terrain." };
    const s = TP.supports(this.tl.llBounds); return { available: s.ok, reason: s.reason || "" };
  }
  info() { return { mode: this.mode, renderer: this.rend?.kind || "none", reason: this.reason, imagery: this.rend?.imagery?.source || null, terrain: this.terrainState(), attribution: this.mode === "terrain" ? { text: TP.credit, links: TP.links } : this.mode === "vector" ? { text: this.rend?.videoAttribution || this.vectorMapProvider.videoAttribution || this.vectorMapProvider.attributionText || (this.vectorMapProvider.id === "openfreemap" ? OPENFREEMAP_VIDEO_CREDIT : "Map credit not configured"), links: this.vectorMapProvider.attributionLinks || [] } : null, speed: this.speed, playing: this.playing, hideEnds: this.hideEnds, status: this.tl.status, estimatedGapCount: this.tl.estimatedGapCount || 0, timelineDurationMs: this.tl.duration || 0,
    follow: this.follow, roadsStatus: this.rend?.imagery?.roadStatus || null, layers: streetLayers(this.layers), collectedCount: checkpoints(this.tl, stateAt(this.tl, this.v)?.cum || 0).length }; }
  getState() { return this.info(); }
  emitMode() { this.onMode?.(this.info()); }
  async setStyle(mode, { force = false } = {}) {
    const want = ["terrain", "imagery", "street", "vector"].includes(mode) ? mode : "stylized", t = ++this.token;
    this.desiredStyle = want;
    this.overhead = want === "street" || want === "vector" || this.live && this.overhead;
    this.color = want === "street" ? "#2386e8" : want === "vector" ? sportsRouteColor(this.workout) : colorOf(this.workout);
    this.imageryAbort?.abort();
    if (this.tl.status !== "ok") {
      if (want === "vector") { this.mode = "vector"; this.reason = this.problem(); this.emitMode(); }
      return this.info();
    }
    if (want === this.mode && !force) return this.info();
    if (want === "vector") {
      this.reason = "Loading the live vector map."; this.emitMode();
      try {
        const renderer = await ReplayVectorRenderer.create(this.host, this.tl, this.color, {
          theme: this.theme,
          onExplore: () => { this.follow = false; this.snap = true; this.emitMode(); },
          styleProvider: this.vectorMapProvider,
        });
        if (t !== this.token || this.destroyed) { renderer.destroy(); return this.info(); }
        this.swap(renderer, "vector", "");
      } catch (error) {
        if (t !== this.token || this.destroyed) return this.info();
        this.rend?.destroy(); this.rend = null; this.mode = "vector";
        this.reason = error?.message || "The live vector map could not be loaded.";
        this.emitMode();
      }
      return this.info();
    }
    if (want === "imagery" || want === "street") {
      this.imageryAbort = new AbortController(); this.reason = "Loading imagery"; this.emitMode();
      try {
        let shown = null; const loadingTimeline = this.tl;
        this.imageryReady = loadImagery(loadingTimeline, { signal: this.imageryAbort.signal, kind: want === "street" ? "street" : "aerial",
          onProgress: next => {
            if (t !== this.token || this.destroyed) return;
            if (!shown) { shown = next; next.timeline = loadingTimeline; this.swap(this.canvasRenderer(next), want, ""); this.rend.setTimeline(this.tl); this.kick(); }
          } });
        const imagery = await this.imageryReady;
        if (t !== this.token || this.destroyed) return this.info();
        imagery.timeline = loadingTimeline; this.lastImageryRefresh = Date.now();
        if (!shown) this.swap(this.canvasRenderer(imagery), want, "");
        else { this.rend.imagery.partial = imagery.partial; this.emitMode(); this.kick(); }
        const rendered = this.rend.imagery;
        if (want === "street") {
          rendered.roadStatus = "loading";
          this.roadsReady = loadRoads(imagery, { signal: this.imageryAbort.signal }).then(roads => {
            if (t !== this.token || this.destroyed || this.rend?.imagery?.image !== imagery.image) return false;
            const current = this.rend.imagery;
            current.roadImage = createRoadOverlay(roads, imagery); current.roadStatus = "ready";
            current.source = { ...current.source, credit: "© OpenStreetMap · OpenFreeMap · OpenMapTiles",
              links: [...(current.source.links || []), { label: "OpenFreeMap", href: "https://openfreemap.org" }, { label: "OpenMapTiles", href: "https://openmaptiles.org" }] };
            this.emitMode(); this.kick(); return true;
          }).catch(() => {
            if (this.rend?.imagery?.image === imagery.image && !this.destroyed) { this.rend.imagery.roadStatus = "unavailable"; this.emitMode(); }
            return false;
          });
        }
      } catch (e) {
        if (t !== this.token || this.destroyed) return this.info();
        this.swap(this.canvasRenderer(), "stylized", e?.message || "Imagery unavailable. Trace view is ready.");
      }
      return this.info();
    }
    if (want === "stylized") { const n = this.canvasRenderer(); n.frame(null, { follow: false, dt: 16, snap: true }); this.swap(n, "stylized", ""); return this.info(); }
    const ts = this.terrainState(); if (!ts.available) { this.reason = ts.reason; this.emitMode(); return this.info(); }
    this.reason = "Checking terrain tiles."; this.emitMode();
    const pr = await TP.probe(this.tl.llBounds); if (t !== this.token || this.destroyed) return this.info();
    if (!pr.ok) { this.reason = pr.reason + " Using the stylized aerial."; this.emitMode(); return this.info(); }
    try {
      const r = await TerrainRenderer.create(this.host, this.tl, this.color); if (t !== this.token || this.destroyed) { r.destroy(); return this.info(); }
      r.onFail = () => { if (this.rend === r && !this.exporting) { this.setStyle("stylized"); this.reason = "Terrain tiles stopped loading. Switched to the stylized aerial."; this.emitMode(); } };
      this.swap(r, "terrain", "");
    } catch (e) { this.reason = (e?.message || "Terrain could not start.") + " Using the stylized aerial."; this.emitMode(); }
    return this.info();
  }
  swap(n, mode, reason) {
    const old = this.rend; this.rend = n; this.mode = mode; this.reason = reason; this.snap = true;
    if (mode === "street") {
      n.layers = streetLayers(this.layers); n.view = { x: 0, y: 0, zoom: 1 };
      n.gestureCleanup = bindStreetGestures(n.canvas, n, () => { if (this.exporting) return; this.follow = false; this.snap = true; this.kick(); });
    }
    old?.destroy(); this.emitMode(); this.kick();
  }
  setLayers(values) { this.layers = streetLayers(values); if (this.mode === "street") this.rend.layers = this.layers; this.emitMode(); this.kick(); return this.info(); }
  setFollow(value) { this.flyoverCamera = false; this.lastFlyoverProgress = null; this.follow = !!value; if (this.rend?.view) this.rend.view = { x: 0, y: 0, zoom: 1 }; this.rend?.setFollow?.(this.follow); this.snap = false; this.emitMode(); this.kick(); }
  resetView() {
    if (this.mode === "street") { this.rend.view = { x: 0, y: 0, zoom: 1 }; this.snap = true; this.kick(); }
    else if (this.mode === "vector") this.fit();
  }
  kick() { if (this.raf || this.destroyed || !this.rend) return; this.last = performance.now(); this.raf = requestAnimationFrame(t => this.tick(t)); }
  tick(t) {
    this.raf = 0; if (this.destroyed || !this.rend || this.exporting) return;
    const dt = Math.min(100, Math.max(1, t - this.last)); this.last = t;
    const wasPlaying = this.playing;
    if (this.playing) { this.v += dt * this.speed; if (this.v >= this.tl.duration) { this.v = this.tl.duration; this.playing = false; this.emitMode(); } }
    const st = stateAt(this.tl, this.v), following = this.follow && (this.playing || (this.v > 0 && this.v < this.tl.duration));
    const flyoverProgress = replayCameraProgress({
      enabled: this.flyoverCamera,
      playing: wasPlaying,
      routeProgress: st.progress,
      pausedProgress: this.lastFlyoverProgress,
    });
    if (wasPlaying && this.flyoverCamera) this.lastFlyoverProgress = flyoverProgress;
    let moving = false; try { moving = this.rend.frame(st, { follow: following, flyoverProgress, dt, snap: this.snap }); } catch (e) { this.onError?.(e); return; }
    this.snap = false;
    this.onFrame?.({ progress: st.progress, elapsedMs: st.v, durationMs: this.tl.duration, distanceM: st.cum, totalM: this.tl.total, paceSecondsPerKm: st.pace, gpsAltitudeM: st.alt, playing: this.playing, speed: this.speed, done: st.done });
    if (this.playing || moving) this.kick();
  }
  update(w) {
    if (this.exporting) return; if (w) this.workout = w; this.rebuild(); this.v = this.tl.duration; this.snap = false; this.kick();
    const b = this.rend?.imagery?.viewport, current = this.tl.llBounds;
    if (this.live && ["imagery", "street"].includes(this.mode) && b && current && Date.now() - this.lastImageryRefresh > 10000) {
      const dx = (b.e - b.w) * .2, dy = (b.n - b.s) * .2;
      const p = this.tl.segments.at(-1)?.pts.at(-1);
      if (p && (p.lon < b.w + dx || p.lon > b.e - dx || p.lat < b.s + dy || p.lat > b.n - dy)) {
        this.lastImageryRefresh = Date.now(); this.setStyle(this.mode, { force: true });
      }
    }
  }
  rebuild() {
    this.tl = this.live ? buildLiveTimeline(this.workout) : buildTimeline(this.workout, { hideEnds: this.hideEnds });
    if (this.tl.status !== "ok") return;
    if (!this.rend && this.desiredStyle !== "vector") this.rend = this.canvasRenderer(); else this.rend?.setTimeline?.(this.tl);
  }
  async setHideEnds(v) {
    this.hideEnds = !!v; this.rebuild(); if (this.tl.status === "short") throw new Error(this.problem());
    if (["imagery", "street", "vector"].includes(this.mode)) await this.setStyle(this.mode, { force: true });
    this.autoSpeed(); this.v = this.tl.duration; this.playing = false; this.snap = true; this.flyoverCamera = this.defaultSpeed === 8; this.lastFlyoverProgress = this.flyoverCamera ? FLYOVER_PHASES.chaseToOrbitEnd : null; this.emitMode(); this.kick();
  }
  fit() { this.follow = false; this.flyoverCamera = false; this.lastFlyoverProgress = null; this.rend?.fitBounds?.(); this.snap = false; this.emitMode(); this.kick(); }
  replay() { if (this.tl.status !== "ok") return; if (this.v >= this.tl.duration - 1) this.v = 0; this.follow = false; this.flyoverCamera = this.defaultSpeed === 8; this.lastFlyoverProgress = null; this.playing = true; this.emitMode(); this.kick(); }
  resume() { this.replay(); }
  pause() { this.playing = false; this.emitMode(); this.kick(); }
  restart() { this.v = 0; this.follow = false; this.flyoverCamera = this.defaultSpeed === 8; this.lastFlyoverProgress = null; this.playing = true; this.snap = true; this.emitMode(); this.kick(); }
  stopReplay() { this.playing = false; this.follow = false; this.flyoverCamera = false; this.lastFlyoverProgress = null; this.v = 0; this.emitMode(); this.kick(); }
  setSpeed(n) { if (REPLAY_SPEEDS.includes(n)) { this.speed = n; this.emitMode(); } }
  seek(p) { this.v = Math.min(1, Math.max(0, p)) * this.tl.duration; this.flyoverCamera = this.defaultSpeed === 8; this.lastFlyoverProgress = this.flyoverCamera ? flyoverRouteProgress(this.v / this.tl.duration) : null; this.snap = false; this.kick(); }
  exportAnimatedCard({ workout, owner, caption, hideEnds } = {}) {
    const svg = animatedCardSvg({ workout: workout || this.workout, owner, caption, hideEnds: hideEnds ?? this.hideEnds, color: this.color });
    return new Blob([svg], { type: "image/svg+xml" });
  }
  async exportMapImage({ owner, caption = "" } = {}) {
    await this.imageryReady;
    await loadOldtimeLogo();
    if (this.layers?.streets && this.roadsReady) await this.roadsReady;
    if (this.tl.status !== "ok" || this.tl.previewOnly) throw new Error("A recorded GPS route is needed.");
    const imagery = this.rend?.imagery;
    const vectorMap = this.mode === "vector" && this.rend?.kind === "vector";
    if (!vectorMap && !imagery) throw new Error("Map imagery isn’t available right now. Your recorded GPS trace remains available.");
    const canvas = document.createElement("canvas"); canvas.width = 1080; canvas.height = 1350;
    const ctx = canvas.getContext("2d"), st = stateAt(this.tl, this.tl.duration);
    if (vectorMap) {
      this.rend.fitBounds();
      await this.rend.renderFrame(st, { follow: false, snap: true });
      this.rend.drawTo(ctx, 1080, 1350);
    } else {
      const cam = camTarget(this.tl, st, false, { still: true }); cam.yaw = 0;
      drawScene(ctx, 1080, 1350, { tl: this.tl, st, cam, imagery, color: this.color, overhead: true, layers: this.layers });
    }
    drawHud(ctx, 1080, 1350, { st, tl: this.tl, workout: this.workout, owner, caption, imagery, vectorMap, mapCredit: this.rend?.videoAttribution, color: this.color, hideEnds: this.hideEnds });
    return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("Map image could not be exported.")), "image/jpeg", .93));
  }
  async exportVideo({ workout, owner, caption = "", onProgress, onPreview, hideEnds, seconds = 30,
    cameraStyle = "flyover", aspect = "portrait", quality = "standard" } = {}) {
    const mime = videoMime();
    if (!mime) throw new Error("Video export isn’t supported in this browser. Create an animated route card instead.");
    if (this.exporting) throw new Error("A video is already being created.");
    if (workout) this.workout = workout;
    if (hideEnds !== undefined && !!hideEnds !== this.hideEnds) await this.setHideEnds(hideEnds); else this.rebuild();
    await this.imageryReady;
    await loadOldtimeLogo();
    if (this.layers?.streets && this.roadsReady) await this.roadsReady;
    if (this.tl.status !== "ok" || this.tl.previewOnly) throw new Error(this.problem() || "This workout has no GPS route.");
    const vectorMap = this.mode === "vector" && this.rend?.kind === "vector";
    const terrain = this.mode === "terrain" && this.rend?.kind === "terrain";
    const aerialMap = this.mode === "imagery" && this.rend?.kind === "canvas" &&
      !!this.rend.imagery?.image;
    if (this.mode === "vector" && !vectorMap) throw new Error(this.reason || "The map preview is still loading. Wait for it to finish, then try again.");
    if (cameraStyle === "flyover" && !vectorMap && !aerialMap) throw new Error("The flyover needs the 3D city map or available satellite imagery. Select a map style and wait for it to load.");
    this.exporting = true; this.playing = false; const tl = this.tl, w = this.workout, imagery = this.rend?.imagery || null;
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "") ||
      (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
    const landscape = aspect === "landscape", high = quality === "high";
    const W = landscape ? (high ? 1920 : 1280) : (high ? 1080 : 720);
    const H = landscape ? (high ? 1080 : 720) : (high ? 1920 : 1280);
    const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H; const ctx = canvas.getContext("2d");
    const follow = this.follow;
    let exportHost = null, exportRenderer = null;
    if (!ctx) { this.exporting = false; throw new Error("Video rendering is unavailable in this browser."); }
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
    onPreview?.(canvas);
    if (!canvas.isConnected) {
      canvas.style.cssText = "position:fixed;right:12px;bottom:12px;width:160px;height:auto;z-index:2147483646;pointer-events:none";
      document.body.appendChild(canvas);
    }
    let stream;
    try { stream = canvas.captureStream(30); }
    catch { canvas.remove(); this.exporting = false; throw new Error("This browser couldn’t capture the map for video. Try creating an animated route card instead."); }
    const chunks = [];
    let rec; try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3500000 }); } catch { canvas.remove(); stream.getTracks().forEach(t => t.stop()); this.exporting = false; throw new Error("Video export couldn’t start in this browser. Try an animated route card instead."); }
    const track = stream.getVideoTracks()[0];
    let frameCount = 0;
    rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
    const stopped = new Promise(res => { rec.onstop = res; });
    let aborted = null; const abortP = new Promise((_, rej) => { this._abort = m => { aborted = m; rej(new Error(m)); }; });
    abortP.catch(() => {});
    rec.onerror = () => this._abort?.("Video recording failed. Try again.");
      const onVis = () => { if (document.hidden) this._abort?.("Video export stopped when Oldtime went into the background. Start it again when the app is open."); };
      const onHide = () => this._abort?.("Video export stopped when the page was closed. Start it again when Oldtime is open.");
    document.addEventListener("visibilitychange", onVis); addEventListener("pagehide", onHide);
    let cam = null, tgtCam = null; const dur = exportDurationSeconds(seconds) * 1000;
    const run = async () => {
      if (vectorMap || terrain) {
        exportHost = document.createElement("div");
        exportHost.setAttribute("aria-hidden", "true");
        const renderScale = mobile ? .5 : 1;
        const renderWidth = Math.round(W * renderScale), renderHeight = Math.round(H * renderScale);
        const previewScale = Math.min((innerWidth - 32) / renderWidth, (innerHeight - 150) / renderHeight, 1);
        const left = Math.max(16, (innerWidth - renderWidth * previewScale) / 2);
        // Hidden/offscreen WebGL sources can be paint-throttled. Keep the export
        // renderer onscreen beneath the captured canvas while it records.
        exportHost.style.cssText = `position:fixed;left:${left}px;top:90px;width:${renderWidth}px;height:${renderHeight}px;transform:scale(${previewScale});transform-origin:top left;overflow:hidden;pointer-events:none;z-index:2147483645`;
        canvas.style.cssText = `position:fixed;left:${left}px;top:90px;width:${renderWidth * previewScale}px;height:${renderHeight * previewScale}px;max-height:none;pointer-events:none;z-index:2147483646`;
        document.body.appendChild(exportHost);
        exportRenderer = vectorMap
          ? await ReplayVectorRenderer.create(exportHost, tl, this.color, { theme: this.theme, styleProvider: this.vectorMapProvider })
          : await TerrainRenderer.create(exportHost, tl, this.color);
      }
      if (cameraStyle === "flyover" && vectorMap) {
        const preflight = [0, 0.1, 0.31, 0.43, 0.56, 0.67, 0.78, 0.91, 0.98];
        const deadline = performance.now() + 22000;
        for (let i = 0; i < preflight.length; i++) {
          const p = preflight[i], routeProgress = flyoverRouteProgress(p);
          await exportRenderer.renderFrame(stateAt(tl, routeProgress * tl.duration), { flyoverProgress: p, snap: i === 0 });
          const remaining = deadline - performance.now();
          if (remaining <= 0) throw new Error("The route map is taking longer than expected to prepare. Check your connection, then try again.");
          await exportRenderer.waitForTiles(remaining);
          onProgress?.(0.01 + 0.08 * (i + 1) / preflight.length);
        }
      } else if (vectorMap) {
        await exportRenderer.renderFrame(stateAt(tl, tl.duration), { follow: false, snap: true });
        await exportRenderer.waitForTiles(22000);
      } else if (terrain) {
        exportRenderer.frame(stateAt(tl, 0), { follow: true, dt: 0, snap: true });
      }
      const paint = async (p, dt, now) => {
        const routeProgress = cameraStyle === "flyover" ? flyoverRouteProgress(p) : p;
        const st = stateAt(tl, routeProgress * tl.duration);
        if (terrain) { exportRenderer.frame(st, { follow: p < 1, dt, snap: p === 0 }); exportRenderer.drawTo(ctx, W, H); }
        else if (vectorMap) {
          await exportRenderer.renderFrame(st, cameraStyle === "flyover"
            ? { flyoverProgress: p, dt, snap: p === 0, timeMs: now }
            : { follow: p < 1 && follow, dt, snap: p === 0, timeMs: now });
          exportRenderer.drawTo(ctx, W, H);
        }
        else {
          const satelliteFlyover = cameraStyle === "flyover" && aerialMap;
          if (satelliteFlyover) {
            const base = camTarget(tl, st, false, { still: true });
            const unit = Math.max(0, Math.min(1, p));
            const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
            const orbit = smooth((unit - 0.31) / (0.56 - 0.31));
            const zoom = unit < 0.1
              ? lerp(1.7, 0.82, smooth(unit / 0.1))
              : unit < 0.56
                ? 0.82
                : unit < 0.91
                  ? lerp(0.82, 2.1, smooth((unit - 0.56) / (0.91 - 0.56)))
                  : 2.1;
            tgtCam = { ...base, D: Math.max(90, base.D * zoom), yaw: base.yaw + orbit * Math.PI * 2 };
          } else {
            tgtCam = camTarget(tl, st, follow, { still: reduced() });
            if (imagery?.source?.kind === "street") { tgtCam.yaw = 0; if (follow) tgtCam.D = Math.max(120, Math.min(600, tgtCam.D)); }
          }
          const e = easeCam(cam, tgtCam, dt, !cam); cam = e.cam;
          drawScene(ctx, W, H, { tl, st, cam, color: this.color, time: now, imagery, overhead: imagery?.source?.kind === "street", layers: this.layers });
        }
        drawHud(ctx, W, H, { st, tl, workout: w, owner, caption, terrain, imagery, vectorMap, mapCredit: exportRenderer?.videoAttribution || this.rend?.videoAttribution, color: this.color, hideEnds: this.hideEnds });
        frameCount++;
        track?.requestFrame?.();
      };
      await paint(0, 0, 0);
      rec.start(250); track?.requestFrame?.();
      const t0 = performance.now(); let prev = t0;
      for (;;) {
        await new Promise(r => requestAnimationFrame(r)); if (aborted) return;
        const now = performance.now(), p = Math.min(1, (now - t0) / dur), dt = Math.min(100, now - prev); prev = now;
        await paint(p, dt, now - t0);
        onProgress?.(Math.min(.97, p));
        if (p >= 1) break;
      }
      await new Promise(r => setTimeout(r, 500));
    };
    try {
      await Promise.race([run(), abortP]);
      if (aborted) throw new Error(aborted);
      rec.state !== "inactive" && rec.stop(); await stopped;
      const blob = new Blob(chunks, { type: (rec.mimeType || mime).split(";")[0] });
      if (!blob.size || frameCount < 2) throw new Error("The browser did not capture enough frames. Please create the flyover again.");
      await verifyVideoBlob(blob, { minimumDuration: dur / 1000 * .8 });
      onProgress?.(1); return blob;
    } catch (e) { try { rec.state !== "inactive" && rec.stop(); } catch {} throw e; }
    finally {
      document.removeEventListener("visibilitychange", onVis); removeEventListener("pagehide", onHide);
      exportRenderer?.destroy(); exportRenderer = null; exportHost?.remove(); exportHost = null;
      canvas.remove();
      stream.getTracks().forEach(t => t.stop()); this._abort = null; this.exporting = false; this.snap = true;
      if (vectorMap) this.rend?.frame(stateAt(this.tl, this.v), { follow: this.follow });
      this.kick();
    }
  }
  destroy() {
    if (this.destroyed) return; this._abort?.("Video export stopped because the replay was closed. Start it again from the activity.");
    this.destroyed = true; this.token++; this.imageryAbort?.abort(); if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; this.rend?.destroy(); this.rend = null;
  }
}

export async function mountSportsMap(host, options = {}) {
  if (!host) throw new Error("No place to show the aerial view.");
  const a = new Aerial(host, options);
  if (a.tl.status !== "ok") { const e = new Error(a.problem()); e.code = a.tl.status === "none" ? "no-route" : "short-route"; throw e; }
  await a.init(options.style);
  return {
    update: w => a.update(w), destroy: () => a.destroy(), fit: () => a.fit(), setStyle: (m, options) => a.setStyle(m, options),
    replay: () => a.replay(), resume: () => a.resume(), pause: () => a.pause(), restart: () => a.restart(), stopReplay: () => a.stopReplay(),
    setSpeed: n => a.setSpeed(n), seek: p => a.seek(p), setHideEnds: v => a.setHideEnds(v), getState: () => a.getState(),
    exportVideo: o => a.exportVideo(o), exportAnimatedCard: o => a.exportAnimatedCard(o),
    exportMapImage: o => a.exportMapImage(o),
    setLayers: values => a.setLayers(values), setFollow: value => a.setFollow(value), resetView: () => a.resetView(),
  };
}
export function exportAnimatedCard({ workout, owner, caption, hideEnds = true } = {}) {
  return new Blob([animatedCardSvg({ workout, owner, caption, hideEnds, color: colorOf(workout) })], { type: "image/svg+xml" });
}
