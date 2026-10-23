import { routeSegments } from "../../../lib/sports/metrics.js";
import { cleanPoints } from "./sports-replay.js";
import { openFreeMapProvider, sportsRouteColor } from "./sports-vector-style.js";
import { POSITION_RED } from "./sports-marker.js";

const ROUTE_ID = "oldtime-recorded-route";
const START_ID = "oldtime-route-start";

const gpsPoint = p => {
  const lat = p?.lat ?? p?.latitude, lon = p?.lon ?? p?.longitude;
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? [lon, lat] : null;
};
const metersBetween = (a, b) => {
  if (!a || !b) return Infinity;
  const rad = Math.PI / 180, lat1 = a[1] * rad, lat2 = b[1] * rad;
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

export function routeFeatureCollection(workout) {
  const cleaned = cleanPoints(workout?.points || []);
  const lines = routeSegments({ ...workout, points: cleaned })
    .map(segment => segment.map(gpsPoint).filter(Boolean))
    .filter(points => points.length > 1);
  return {
    type: "FeatureCollection",
    features: lines.map(coordinates => ({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates },
    })),
  };
}

export function latestRecordedLocation(workout) {
  const points = workout?.points || [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i], coords = gpsPoint(p);
    if (coords && (!Number.isFinite(p.accuracy) || p.accuracy <= 50)) {
      return { coordinates: coords, timestamp: p.timestamp };
    }
  }
  return null;
}

function avatarMarker(ml, viewer) {
  const el = document.createElement("div");
  el.className = "sp-gps-avatar-marker";
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", `Your current location${viewer?.username ? `, @${viewer.username}` : ""}`);
  el.title = "Your current GPS location";
  const fallback = document.createElement("span");
  fallback.className = "sp-gps-avatar-initials";
  fallback.setAttribute("aria-hidden", "true");
  fallback.textContent = String(viewer?.name || viewer?.username || "ME").trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase() || "ME";
  el.append(fallback);
  const avatar = String(viewer?.avatar || "");
  if (avatar) {
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.src = avatar;
    img.addEventListener("error", () => img.remove(), { once: true });
    el.append(img);
  }
  const tail = document.createElement("span");
  tail.className = "sp-gps-avatar-tail";
  tail.setAttribute("aria-hidden", "true");
  el.append(tail);
  return new ml.Marker({ element: el, anchor: "center" });
}

export async function mountLiveVectorMap(host, {
  workout,
  viewer = {},
  theme = "light",
  styleProvider = openFreeMapProvider,
} = {}) {
  if (!host) throw new Error("There is no map container.");
  const location = latestRecordedLocation(workout);
  if (!location) throw new Error("Waiting for a real GPS fix before placing your map.");

  let ml;
  try {
    const [mod, , worker] = await Promise.all([
      import("maplibre-gl"),
      import("maplibre-gl/dist/maplibre-gl.css"),
      import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
    ]);
    ml = mod.default || mod;
    if (worker?.default && ml.setWorkerUrl) ml.setWorkerUrl(worker.default);
  } catch {
    throw new Error("The vector-map renderer could not be loaded.");
  }
  const style = await styleProvider.load(theme);
  if (!host.isConnected) throw new Error("The map was closed before it could load.");
  const map = new ml.Map({
    container: host,
    style,
    center: location.coordinates,
    zoom: 16,
    minZoom: 2,
    maxZoom: 20,
    attributionControl: false,
    pitchWithRotate: false,
    dragRotate: false,
    cooperativeGestures: true,
    fadeDuration: 120,
  });
  let destroyed = false, loaded = false, following = true, lastSignature = "";
  let latestWorkout = workout, latestViewer = viewer, latestColor = sportsRouteColor(workout);
  let marker = null;
  const mapError = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The vector map took too long to load. Check your connection and retry.")), 16000);
    map.once("load", () => { clearTimeout(timer); resolve(); });
  });

  const updateData = () => {
    if (destroyed || !map.isStyleLoaded()) return;
    const loc = latestRecordedLocation(latestWorkout);
    if (!loc) return;
    const signature = `${latestWorkout?.id || ""}:${loc.timestamp}:${latestWorkout?.points?.length || 0}`;
    if (signature !== lastSignature) {
      map.getSource(ROUTE_ID)?.setData(routeFeatureCollection(latestWorkout));
      const first = (latestWorkout?.points || []).map(gpsPoint).find(Boolean);
      map.getSource(START_ID)?.setData({
        type: "FeatureCollection",
        features: first ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: first } }] : [],
      });
      marker?.setLngLat(loc.coordinates);
      lastSignature = signature;
    }
    if (following && loc.timestamp !== undefined) {
      const center = map.getCenter();
      const distance = metersBetween([center.lng, center.lat], loc.coordinates);
      // Don't recenter on small GPS noise. Let the recorded-position marker move
      // naturally, then ease the map to it after the user has covered real ground.
      if (distance > 8) map.easeTo({ center: loc.coordinates, duration: 750, essential: false });
    }
  };
  const addRouteLayers = () => {
    if (destroyed || !map.isStyleLoaded()) return;
    if (!map.getSource(ROUTE_ID)) {
      map.addSource(ROUTE_ID, { type: "geojson", data: routeFeatureCollection(latestWorkout) });
      map.addLayer({
        id: `${ROUTE_ID}-outline`, type: "line", source: ROUTE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": theme === "dark" ? "#10151b" : "#ffffff", "line-width": 9, "line-opacity": 0.96 },
      });
      map.addLayer({
        id: `${ROUTE_ID}-line`, type: "line", source: ROUTE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": latestColor, "line-width": 5, "line-opacity": 0.98 },
      });
      map.addSource(START_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: `${START_ID}-dot`, type: "circle", source: START_ID,
        paint: { "circle-radius": 13, "circle-color": POSITION_RED, "circle-stroke-color": "#fff", "circle-stroke-width": 3 },
      });
      lastSignature = "";
    }
    updateData();
  };

  map.on("style.load", addRouteLayers);
  map.on("dragstart", () => { following = false; });
  map.on("zoomstart", () => { following = false; });
  map.on("rotatestart", () => { following = false; });
  map.addControl(new ml.AttributionControl({ compact: false }), "top-left");
  map.addControl(new ml.ScaleControl({ maxWidth: 82, unit: "metric" }), "top-left");

  try {
    await mapError;
    if (destroyed) throw new Error("The map was closed while it was loading.");
    loaded = true;
    marker = avatarMarker(ml, latestViewer);
    marker.setLngLat(location.coordinates).addTo(map);
    addRouteLayers();
    host.classList.add("sp-vector-live-map");
    return {
      update(nextWorkout, nextViewer = latestViewer, color = latestColor) {
        if (destroyed) return;
        latestWorkout = nextWorkout || latestWorkout;
        latestViewer = nextViewer || latestViewer;
        latestColor = color || latestColor;
        marker?.getElement().setAttribute("aria-label", `Your current location${latestViewer?.username ? `, @${latestViewer.username}` : ""}`);
        if (map.getLayer(`${ROUTE_ID}-line`)) map.setPaintProperty(`${ROUTE_ID}-line`, "line-color", latestColor);
        updateData();
      },
      async setTheme(nextTheme) {
        if (destroyed || (nextTheme !== "light" && nextTheme !== "dark")) return;
        theme = nextTheme;
        const nextStyle = await styleProvider.load(theme);
        if (destroyed) return;
        map.once("style.load", addRouteLayers);
        map.setStyle(nextStyle, { diff: false });
      },
      recenter() {
        const loc = latestRecordedLocation(latestWorkout);
        if (!loc || destroyed) return;
        following = true;
        map.easeTo({ center: loc.coordinates, zoom: Math.max(16, map.getZoom()), duration: 350, essential: true });
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        marker?.remove();
        map.remove();
        host.classList.remove("sp-vector-live-map");
      },
    };
  } catch (error) {
    map.remove();
    throw error;
  }
}
