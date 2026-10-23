// Government imagery only. No credentials, proprietary SDK, or paid map plan.
// USGS NAIP: detailed aerial photography in the contiguous USA.
// NASA Blue Marble: worldwide, coarse satellite composite (not street-level or live).
const EARTH = 6378137, RAD = Math.PI / 180, SIZE = 256;
export const IMAGERY_SOURCES = {
  street: {
    label: "Street map", kind: "street", credit: "© OpenStreetMap contributors · openstreetmap.org/copyright",
    detail: "OpenStreetMap road map. Route and movement come from measured GPS points.",
    links: [{ label: "OpenStreetMap licence", href: "https://www.openstreetmap.org/copyright" },
      { label: "Tile usage policy", href: "https://operations.osmfoundation.org/policies/tiles/" }],
    maxZoom: 18, url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  },
  usgs: {
    label: "Aerial · USGS", kind: "aerial", credit: "Map services and data available from U.S. Geological Survey, National Geospatial Program · USDA NAIP",
    detail: "Public-domain U.S. aerial imagery. Not live satellite imagery.",
    links: [{ label: "USGS imagery credits", href: "https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map" }],
    maxZoom: 18, url: (z, x, y) => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`,
  },
  nasa: {
    label: "Satellite overview · NASA", kind: "aerial", credit: "NASA Earth Observatory · Blue Marble",
    detail: "Worldwide regional satellite composite, approximately 500 m resolution. Historical imagery, not live or street-level.",
    links: [{ label: "NASA Blue Marble", href: "https://science.nasa.gov/earth/earth-observatory/collections/blue-marble" },
      { label: "NASA media use", href: "https://www.nasa.gov/nasa-brand-center/images-and-media/" }],
    maxZoom: 8, url: (z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/2004-07-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg`,
  },
  copernicus: {
    label: "Satellite · Copernicus", kind: "aerial", credit: "Copernicus Sentinel data",
    detail: "Sentinel-2 true-colour satellite imagery, approximately 10 m resolution. Photography on a flat map, not 3D terrain or buildings.",
    links: [{ label: "Sentinel data licence", href: "https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice" },
      { label: "Free public data access", href: "https://planetarycomputer.microsoft.com/docs" }],
    maxZoom: 15,
  },
};
const px = (lon, z) => (lon + 180) / 360 * SIZE * 2 ** z;
const py = (lat, z) => (1 - Math.asinh(Math.tan(Math.max(-85, Math.min(85, lat)) * RAD)) / Math.PI) / 2 * SIZE * 2 ** z;
export function imageryPlan(tl, provider = "usgs") {
  if (!tl?.bounds || !tl.llBounds || tl.status !== "ok") throw new Error("No GPS route.");
  const b = tl.bounds, span = Math.max(700, Math.max(b.x1 - b.x0, b.y1 - b.y0) * 3);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const kx = EARTH * RAD * Math.cos(tl.lat0 * RAD), ky = EARTH * RAD;
  const west = tl.lon0 + (cx - span / 2) / kx, east = tl.lon0 + (cx + span / 2) / kx;
  const south = tl.lat0 + (cy - span / 2) / ky, north = tl.lat0 + (cy + span / 2) / ky;
  if (east - west > 180 || west < -180 || east > 180 || north > 85 || south < -85)
    throw new Error("Imagery is unavailable for this route extent.");
  const source = IMAGERY_SOURCES[provider];
  let z = Math.max(1, Math.min(source.maxZoom, Math.floor(Math.log2(2 * Math.PI * EARTH * Math.cos(tl.lat0 * RAD) * 3 / span))));
  let bounds;
  for (;;) {
    const max = 2 ** z - 1;
    bounds = { x0: Math.max(0, Math.floor(px(west, z) / SIZE)), x1: Math.min(max, Math.floor(px(east, z) / SIZE)),
      y0: Math.max(0, Math.floor(py(north, z) / SIZE)), y1: Math.min(max, Math.floor(py(south, z) / SIZE)) };
    if ((bounds.x1 - bounds.x0 + 1) * (bounds.y1 - bounds.y0 + 1) <= (source.kind === "street" ? 4 : 16) || z === 1) break;
    z--;
  }
  return { ...bounds, z, source, provider,
    u0: px(west, z) - bounds.x0 * SIZE, u1: px(east, z) - bounds.x0 * SIZE,
    v0: py(north, z) - bounds.y0 * SIZE, v1: py(south, z) - bounds.y0 * SIZE,
    viewport: { w: west, e: east, s: south, n: north } };
}
export function contiguousUS(tl) {
  const b = tl?.llBounds;
  return !!b && b.w >= -124.8 && b.e <= -66.8 && b.s >= 24.5 && b.n <= 49.2;
}
// Tiny bounded cache. Changing endpoint privacy cannot reuse differently georeferenced imagery.
const cache = new Map();
const catalog = new Map();
async function sentinelSource(tl, signal) {
  const { viewport: b } = imageryPlan(tl, "copernicus");
  const cacheKey = [b.w, b.s, b.e, b.n].map(n => n.toFixed(2)).join(",");
  const old = catalog.get(cacheKey);
  if (old && Date.now() - old.time < 3600000) return old.source;
  const end = new Date(), start = new Date(end); start.setUTCFullYear(start.getUTCFullYear() - 1);
  const query = new URLSearchParams({ collections: "sentinel-2-l2a", bbox: [b.w, b.s, b.e, b.n].join(","),
    limit: "3", sortby: "-datetime", datetime: `${start.toISOString()}/${end.toISOString()}`,
    query: JSON.stringify({ "eo:cloud_cover": { lt: 20 } }) });
  const response = await fetch(`https://planetarycomputer.microsoft.com/api/stac/v1/search?${query}`, { signal, mode: "cors", credentials: "omit" });
  if (!response.ok) throw new Error("Satellite catalog unavailable.");
  const data = await response.json();
  const item = data.features?.find(p => /^[A-Za-z0-9_-]+$/.test(p.id) && p.assets?.visual &&
    p.bbox?.length >= 4 && p.bbox[0] <= b.w && p.bbox[1] <= b.s && p.bbox[2] >= b.e && p.bbox[3] >= b.n);
  if (!item) throw new Error("No recent satellite scene covers this route.");
  const date = String(item.properties?.datetime || "").slice(0, 10), year = date.slice(0, 4);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Satellite acquisition date unavailable.");
  const source = { ...IMAGERY_SOURCES.copernicus, id: item.id, date,
    credit: `Contains modified Copernicus Sentinel data ${year}`,
    detail: `${IMAGERY_SOURCES.copernicus.detail} Acquired ${date}. Scene clouds and coverage can vary.`,
    url: (z, x, y) => `https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad/${z}/${x}/${y}@1x?collection=sentinel-2-l2a&item=${encodeURIComponent(item.id)}&assets=visual`,
  };
  catalog.set(cacheKey, { time: Date.now(), source }); while (catalog.size > 8) catalog.delete(catalog.keys().next().value);
  return source;
}
async function fetchMosaic(tl, provider, signal, onProgress) {
  const plan = imageryPlan(tl, provider), { x0, x1, y0, y1, z, source } = plan;
  if (provider === "copernicus") plan.source = await sentinelSource(tl, signal);
  const actualSource = plan.source;
  const key = `${provider}/${actualSource.id || ""}/${z}/${x0}/${y0}/${x1}/${y1}`;
  let image = cache.get(key);
  let partial = false;
  if (!image) {
    image = document.createElement("canvas"); image.width = (x1 - x0 + 1) * SIZE; image.height = (y1 - y0 + 1) * SIZE;
    const ctx = image.getContext("2d"), jobs = []; let loaded = 0;
    if (provider === "street") { ctx.fillStyle = "#edf2f0"; ctx.fillRect(0, 0, image.width, image.height); }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push((async () => {
      const response = await fetch(actualSource.url(z, x, y), { signal, mode: "cors", credentials: "omit", cache: "default", referrerPolicy: "strict-origin-when-cross-origin" });
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) throw new Error("Imagery tiles are unavailable.");
      const bitmap = await createImageBitmap(await response.blob());
      ctx.drawImage(bitmap, (x - x0) * SIZE, (y - y0) * SIZE, SIZE, SIZE); bitmap.close();
      loaded++;
      if (provider === "street" && onProgress) onProgress({ ...imageryMesh(plan, tl, image), partial: loaded < (x1 - x0 + 1) * (y1 - y0 + 1) });
    })());
    if (provider === "street") {
      const results = await Promise.allSettled(jobs);
      if (!loaded) throw new Error("Map tiles are unavailable.");
      partial = results.some(result => result.status === "rejected");
    } else await Promise.all(jobs);
    // Also confirms CORS-safe recording, and rejects empty/ocean/no-data service responses.
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    let visible = 0;
    for (let i = 0; i < pixels.length; i += 4096) if (pixels[i + 3] > 100 && pixels[i] + pixels[i + 1] + pixels[i + 2] > 35) visible++;
    if (visible < 8) throw new Error("No imagery coverage here.");
    if (!partial) { cache.set(key, image); while (cache.size > 3) cache.delete(cache.keys().next().value); }
  }
  return { ...imageryMesh(plan, tl, image), partial };
}
export function imageryMesh(plan, tl, image) {
  const { x0, y0, z } = plan;
  // Mesh positions use the EXACT same local GPS projection as the route, not guessed anchors.
  const n = plan.source.kind === "street" ? 2 : 8, points = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    // Mesh only the requested viewport, not an entire coarse satellite tile.
    // This avoids near-plane clipping on short routes at low-resolution zooms.
    const u = plan.u0 + i / n * (plan.u1 - plan.u0), v = plan.v0 + j / n * (plan.v1 - plan.v0);
    const lon = (x0 * SIZE + u) / (SIZE * 2 ** z) * 360 - 180;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y0 * SIZE + v) / (SIZE * 2 ** z)))) / RAD;
    points.push({ u, v, x: (lon - tl.lon0) * EARTH * RAD * Math.cos(tl.lat0 * RAD), y: (lat - tl.lat0) * EARTH * RAD });
  }
  return { image, points, n, ...plan };
}
export async function loadImagery(tl, { signal, kind = "aerial", onProgress } = {}) {
  const providers = kind === "street" ? ["street"] : contiguousUS(tl) ? ["usgs", "copernicus", "nasa"] : ["copernicus", "nasa"];
  for (const provider of providers) {
    const controller = new AbortController(), cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(cancel, provider === "street" ? 6000 : 10000);
    try { return await fetchMosaic(tl, provider, controller.signal, onProgress); }
    catch (e) { if (signal?.aborted) throw e; if (provider === providers.at(-1)) {
      const failure = new Error(kind === "street" ? "Map preview is unavailable. Your GPS route remains available as a trace." : "Aerial imagery is unavailable right now. Your GPS route remains available as a trace.");
      failure.cause = e; throw failure;
    } }
    finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
  }
}
function triangle(ctx, image, a, b, c, pa, pb, pc) {
  if (!pa || !pb || !pc) return;
  const du1 = b.u - a.u, dv1 = b.v - a.v, du2 = c.u - a.u, dv2 = c.v - a.v;
  const det = du1 * dv2 - du2 * dv1;
  if (!det) return;
  const dx1 = pb[0] - pa[0], dy1 = pb[1] - pa[1], dx2 = pc[0] - pa[0], dy2 = pc[1] - pa[1];
  const A = (dx1 * dv2 - dx2 * dv1) / det, B = (dy1 * dv2 - dy2 * dv1) / det;
  const C = (dx2 * du1 - dx1 * du2) / det, D = (dy2 * du1 - dy1 * du2) / det;
  ctx.save(); ctx.beginPath(); ctx.moveTo(...pa); ctx.lineTo(...pb); ctx.lineTo(...pc); ctx.closePath(); ctx.clip();
  ctx.setTransform(A, B, C, D, pa[0] - A * a.u - C * a.v, pa[1] - B * a.u - D * a.v);
  ctx.drawImage(image, 0, 0); ctx.restore();
}
export function drawImagery(ctx, imagery, project, { flat = false } = {}) {
  const { points: p, n, image } = imagery, projected = p.map(q => project(q.x, q.y));
  if (flat) {
    // North-up row strips avoid 128 expensive triangle clips per frame.
    for (let j = 0; j < n; j++) {
      const a = j * (n + 1), b = (j + 1) * (n + 1) + n, pa = projected[a], pb = projected[b];
      if (!pa || !pb) continue;
      const x = Math.round(pa[0]), y = Math.round(pa[1]), right = Math.round(pb[0]), bottom = Math.round(pb[1]);
      if (right > x && bottom > y) ctx.drawImage(image, p[a].u, p[a].v, p[b].u - p[a].u, p[b].v - p[a].v, x, y, right - x, bottom - y);
    }
    return;
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    triangle(ctx, image, p[a], p[b], p[d], projected[a], projected[b], projected[d]);
    triangle(ctx, image, p[a], p[d], p[c], projected[a], projected[d], projected[c]);
  }
}
