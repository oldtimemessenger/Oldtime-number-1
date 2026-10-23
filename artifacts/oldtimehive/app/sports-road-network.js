import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

const RAD = Math.PI / 180, EARTH = 6378137, tiles = new Map();
let metadata;
const timeout = signal => signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000);
const xTile = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const yTile = (lat, z) => {
  const p = Math.max(-85, Math.min(85, lat)) * RAD;
  return Math.floor((1 - Math.asinh(Math.tan(p)) / Math.PI) / 2 * 2 ** z);
};
export function roadTilePlan(viewport, desiredZoom, maxZoom = 14) {
  if (!viewport || ![viewport.w, viewport.e, viewport.s, viewport.n].every(Number.isFinite) ||
      viewport.w > viewport.e || viewport.s > viewport.n) throw new Error("Invalid map area");
  let z = Math.max(0, Math.min(maxZoom, desiredZoom)), p;
  do {
    const limit = 2 ** z - 1;
    p = { z, x0: Math.max(0, xTile(viewport.w, z)), x1: Math.min(limit, xTile(viewport.e, z)),
      y0: Math.max(0, yTile(viewport.n, z)), y1: Math.min(limit, yTile(viewport.s, z)) };
    if ((p.x1 - p.x0 + 1) * (p.y1 - p.y0 + 1) <= 9 || z === 0) return p;
    z--;
  } while (z >= 0);
}
export function decodeRoads(bytes, x, y, z) {
  const layer = new VectorTile(new PbfReader(new Uint8Array(bytes))).layers.transportation;
  const result = []; if (!layer) return result;
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i), kind = feature.properties.class;
    if (feature.type !== 2 || ["rail", "aerialway", "ferry", "transit", "pier"].includes(kind)) continue;
    const geometry = feature.toGeoJSON(x, y, z).geometry;
    const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.type === "MultiLineString" ? geometry.coordinates : [];
    for (const line of lines) if (line.length > 1) result.push({ kind, points: line });
  }
  return result;
}
export function projectRoads(roads, timeline) {
  const cos = Math.cos(timeline.lat0 * RAD);
  return roads.map(road => ({ kind: road.kind, points: road.points.map(([lon, lat]) => ({
    x: (lon - timeline.lon0) * EARTH * RAD * cos, y: (lat - timeline.lat0) * EARTH * RAD,
  })) }));
}
export async function loadRoads(plan, { signal } = {}) {
  metadata ||= fetch("https://tiles.openfreemap.org/planet", { signal: AbortSignal.timeout(8000), cache: "default" })
    .then(async r => { if (!r.ok) throw new Error("Street layer unavailable"); return r.json(); })
    .catch(e => { metadata = null; throw e; });
  const source = await metadata;
  const template = source.tiles?.[0];
  if (!template?.startsWith("https://tiles.openfreemap.org/")) throw new Error("Invalid street source");
  const p = roadTilePlan(plan.viewport, plan.z, source.maxzoom || 14), all = [];
  for (let y = p.y0; y <= p.y1; y++) for (let x = p.x0; x <= p.x1; x++) all.push({ x, y });
  // Only current viewport, no region prefetch. Bounded two-request concurrency.
  const results = new Array(all.length); let index = 0;
  await Promise.all([0, 1].map(async () => {
    while (index < all.length) {
      const i = index++, { x, y } = all[i], key = `${template}/${p.z}/${x}/${y}`;
      if (signal?.aborted) throw new Error("Street layer cancelled");
      let roads = tiles.get(key);
      if (!roads) {
        const url = template.replace("{z}", p.z).replace("{x}", x).replace("{y}", y);
        const r = await fetch(url, { signal: timeout(signal), cache: "default", credentials: "omit" });
        if (!r.ok) throw new Error("Street layer unavailable");
        const bytes = await r.arrayBuffer();
        if (bytes.byteLength > 2500000) throw new Error("Street tile too large");
        roads = decodeRoads(bytes, x, y, p.z); tiles.set(key, roads);
        if (tiles.size > 24) tiles.delete(tiles.keys().next().value);
      }
      results[i] = roads;
    }
  }));
  return results.flat();
}
export function drawRoads(ctx, roads, project, width) {
  if (!roads?.length) return;
  const paths = [new Path2D(), new Path2D()];
  for (const road of roads) {
    const p = paths[["motorway", "trunk", "primary", "secondary"].includes(road.kind) ? 1 : 0];
    let pen = false;
    for (const point of road.points) {
      const q = Array.isArray(point) ? project(point[0], point[1]) : project(point.x, point.y);
      if (!q) { pen = false; continue; }
      if (pen) p.lineTo(...q); else { p.moveTo(...q); pen = true; }
    }
  }
  ctx.save(); ctx.lineJoin = "round"; ctx.lineCap = "round";
  paths.forEach((path, i) => {
    ctx.strokeStyle = i ? "rgba(71,95,207,.18)" : "rgba(58,148,235,.13)";
    ctx.lineWidth = Math.max(3, width / 120) * (i ? 1.5 : 1); ctx.stroke(path);
    ctx.strokeStyle = i ? "rgba(53,81,186,.75)" : "rgba(58,142,226,.55)";
    ctx.lineWidth = Math.max(1.1, width / 330) * (i ? 1.4 : 1); ctx.stroke(path);
  }); ctx.restore();
}
export function createRoadOverlay(roads, imagery) {
  const canvas = document.createElement("canvas");
  canvas.width = imagery.image.width; canvas.height = imagery.image.height;
  const scale = 256 * 2 ** imagery.z;
  drawRoads(canvas.getContext("2d"), roads, (lon, lat) => {
    const p = Math.max(-85, Math.min(85, lat)) * RAD;
    return [(lon + 180) / 360 * scale - imagery.x0 * 256,
      (1 - Math.asinh(Math.tan(p)) / Math.PI) / 2 * scale - imagery.y0 * 256];
  }, canvas.width);
  return canvas;
}
