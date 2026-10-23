import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { placeTagSchema, type PlaceTag } from "../lib/place-tag";

const router = Router();
const cache = new Map<string, { expires: number; places: PlaceTag[] }>();
let inFlight = false, nextRequest = 0, dailyStart = Date.now(), dailyCount = 0;
const attribution = { text: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" };

// Photon explicitly permits modest project usage. Never autocomplete remotely,
// bypass quotas, or fall back to a billable provider. Manual tagging remains usable.
router.get("/places/search", requireAuth, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().replace(/\s+/g, " ") : "";
  const hasPosition = req.query.lat !== undefined || req.query.lon !== undefined;
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (q.length < 2 || q.length > 80 || hasPosition && (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)) {
    res.status(400).json({ error: "Enter a place name to search." }); return;
  }
  const now = Date.now(), key = `${q.toLowerCase()}|${hasPosition ? `${lat.toFixed(3)},${lon.toFixed(3)}` : ""}`;
  for (const [k, v] of cache) if (v.expires < now) cache.delete(k);
  const hit = cache.get(key);
  if (hit) { res.json({ places: hit.places, attribution }); return; }
  if (now - dailyStart > 86400000) { dailyStart = now; dailyCount = 0; }
  if (inFlight || now < nextRequest || dailyCount >= 500) {
    res.status(429).json({ error: "Place search is busy. You can still use a place name." }); return;
  }
  inFlight = true; nextRequest = now + 2000; dailyCount++;
  try {
    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", q); url.searchParams.set("limit", "12");
    if (hasPosition) { url.searchParams.set("lat", lat.toFixed(3)); url.searchParams.set("lon", lon.toFixed(3)); }
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Oldtime-place-search/1.0", Accept: "application/json" } });
    if (!response.ok) throw new Error();
    const text = await response.text();
    if (text.length > 250000) throw new Error();
    const data = JSON.parse(text);
    const places: PlaceTag[] = [];
    for (const f of Array.isArray(data.features) ? data.features.slice(0, 12) : []) {
      const p = f.properties || {}, point = f.geometry?.coordinates;
      const type = ({ N: "node", W: "way", R: "relation" } as Record<string, string>)[p.osm_type];
      // Do not suggest private house numbers or inferred home addresses.
      if (!type || !p.name || !["place", "amenity", "leisure", "tourism", "shop"].includes(p.osm_key) || !Array.isArray(point)) continue;
      const label = [p.name, p.city && p.city !== p.name ? p.city : null].filter(Boolean).join(" · ").slice(0, 140);
      const parsed = placeTagSchema.safeParse({ id: `osm:${type}:${p.osm_id}`, label, source: "osm", lat: point[1], lon: point[0] });
      if (parsed.success && !places.some(v => v.id === parsed.data.id)) places.push(parsed.data);
    }
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: now + 900000, places });
    res.json({ places, attribution });
  } catch {
    res.status(503).json({ error: "Place search is unavailable. You can still use a place name." });
  } finally { inFlight = false; }
});
export default router;
