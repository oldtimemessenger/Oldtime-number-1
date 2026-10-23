import { JET_ENGINE_GLOW, JET_FLAME_ORANGE, POSITION_RED, markerPulse } from "./sports-marker.js";
import { openFreeMapProvider, OPENFREEMAP_VIDEO_CREDIT } from "./sports-vector-style.js";

const EMPTY = { type: "FeatureCollection", features: [] };
const pointFeature = point => point
  ? { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [point.lon, point.lat] } }
  : null;
const smoothstep = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const angleDelta = (a, b) => ((b - a + 540) % 360) - 180;
const mixAngle = (a, b, t) => (a + angleDelta(a, b) * t + 360) % 360;
export const FLYOVER_PHASES = Object.freeze({
  establishEnd: 0.1,
  chaseToOrbitEnd: 0.31,
  orbitEnd: 0.56,
  chaseEnd: 0.78,
  overheadEnd: 0.91,
});
const ORBIT_POINT = 0.46;

const centerPair = center => Array.isArray(center) ? center : [center?.lng, center?.lat];

function courseBearing(from, to) {
  if (!from || !to || (from.lon === to.lon && from.lat === to.lat)) return null;
  const rad = Math.PI / 180, lat1 = from.lat * rad, lat2 = to.lat * rad, dLon = (to.lon - from.lon) * rad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function jetFlameFeature(timeline, state, timeMs = 0, reduceMotion = false) {
  if (!Number.isFinite(state?.lon) || !Number.isFinite(state?.lat)) return EMPTY;
  const points = timeline?.segments?.[state.seg]?.pts || [];
  const index = Math.max(0, Math.min(points.length - 1, state.i || 0));
  const previous = points[index - 1] || points[index];
  const next = points[index + 1] || points[index];
  const heading = courseBearing(previous, next) ?? courseBearing(previous, state) ?? courseBearing(state, next) ?? 0;
  const radians = heading * Math.PI / 180;
  const speedKmh = Number.isFinite(state.pace) && state.pace > 0 ? 3600 / state.pace : 5;
  const flicker = reduceMotion ? 0 : Math.sin(Number(timeMs || 0) / 180) * 1.8 + Math.sin(Number(timeMs || 0) / 310) * 0.9;
  const length = Math.max(18, Math.min(40, 23 + speedKmh * 0.48 + flicker));
  const cosLat = Math.max(0.15, Math.cos(state.lat * Math.PI / 180));
  const offset = (behindMeters, sideMeters) => {
    const east = -Math.sin(radians) * behindMeters + Math.cos(radians) * sideMeters;
    const north = -Math.cos(radians) * behindMeters - Math.sin(radians) * sideMeters;
    return [
      state.lon + east / (111320 * cosLat),
      state.lat + north / 111320,
    ];
  };
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          offset(length, flicker * 0.18),
          offset(length * 0.66, flicker),
          offset(length * 0.28, -flicker * 0.35),
          [state.lon, state.lat],
        ],
      },
    }],
  };
}

export function flyoverRouteProgress(progress) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  const phase = FLYOVER_PHASES;
  if (p < phase.establishEnd) return 0;
  if (p < phase.chaseToOrbitEnd) {
    return ORBIT_POINT * smoothstep((p - phase.establishEnd) / (phase.chaseToOrbitEnd - phase.establishEnd));
  }
  if (p < phase.orbitEnd) return ORBIT_POINT;
  if (p < phase.chaseEnd) {
    return ORBIT_POINT + (1 - ORBIT_POINT) * smoothstep((p - phase.orbitEnd) / (phase.chaseEnd - phase.orbitEnd));
  }
  return 1;
}

export function replayCameraProgress({ enabled, playing, routeProgress, pausedProgress } = {}) {
  if (!enabled) return null;
  if (playing) return flyoverRouteProgress(routeProgress);
  return Number.isFinite(pausedProgress) ? pausedProgress : FLYOVER_PHASES.chaseToOrbitEnd;
}

export function flyoverCameraForState(timeline, state, progress, fit = { center: [timeline?.lon0 || 0, timeline?.lat0 || 0], zoom: 13 }, surroundings = {}) {
  if (!timeline?.segments?.length || !state) return null;
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  const phase = FLYOVER_PHASES;
  const firstSegment = timeline.segments.find(item => item?.pts?.length);
  const start = firstSegment?.pts?.[0] || state;
  const next = firstSegment?.pts?.[1] || start;
  const startBearing = courseBearing(start, next) ?? 0;
  const bounds = timeline.llBounds;
  const overviewCenter = centerPair(fit.center) || (bounds
    ? [(bounds.w + bounds.e) / 2, (bounds.s + bounds.n) / 2]
    : [timeline.lon0 || state.lon, timeline.lat0 || state.lat]);
  const overviewZoom = Number.isFinite(fit.zoom) ? fit.zoom : 13;
  const points = timeline.segments[state.seg]?.pts || [];
  const i = Math.max(0, Math.min(points.length - 1, state.i || 0));
  const bearing = courseBearing(points[Math.max(0, i - 1)], points[Math.min(points.length - 1, i + 2)]) ?? startBearing;
  const rad = bearing * Math.PI / 180;
  const speedKmh = Number.isFinite(state.pace) && state.pace > 0 ? 3600 / state.pace : null;
  const density = Math.max(0, Math.min(1, Number(surroundings.density) || 0));
  const chaseZoom = Math.max(17.5, Math.min(18.3,
    18.3 - (speedKmh ? Math.max(0, speedKmh - 9) * 0.018 : 0) - density * 0.2));
  const pitch = 73;
  const aheadM = speedKmh ? Math.min(85, 34 + speedKmh * 0.82) : 40;
  const chaseCenter = [
    state.lon + Math.sin(rad) * aheadM / (111320 * Math.max(0.15, Math.cos(state.lat * Math.PI / 180))),
    state.lat + Math.cos(rad) * aheadM / 111320,
  ];

  if (p < phase.establishEnd) {
    const t = smoothstep(p / phase.establishEnd);
    return {
      phase: "establish",
      center: [mix(overviewCenter[0], chaseCenter[0], t), mix(overviewCenter[1], chaseCenter[1], t)],
      zoom: mix(Math.min(overviewZoom, 11.5), chaseZoom, t),
      pitch: mix(0, pitch, t),
      bearing: mixAngle(0, startBearing, t),
    };
  }
  if (p < phase.chaseToOrbitEnd) return { phase: "chase", center: chaseCenter, zoom: chaseZoom, pitch, bearing };
  if (p < phase.orbitEnd) {
    const orbit = smoothstep((p - phase.chaseToOrbitEnd) / (phase.orbitEnd - phase.chaseToOrbitEnd));
    return { phase: "orbit", center: chaseCenter, zoom: chaseZoom, pitch, bearing: bearing + orbit * 360 };
  }
  if (p < phase.chaseEnd) return { phase: "chase", center: chaseCenter, zoom: chaseZoom, pitch, bearing };
  const finish = timeline.segments.at(-1)?.pts?.at(-1) || state;
  const finalCenter = centerPair(fit.center) || overviewCenter;
  if (p < phase.overheadEnd) {
    const reveal = smoothstep((p - phase.chaseEnd) / (phase.overheadEnd - phase.chaseEnd));
    const finishRad = bearing * Math.PI / 180;
    const finishCenter = [
      finish.lon + Math.sin(finishRad) * aheadM / (111320 * Math.max(0.15, Math.cos(finish.lat * Math.PI / 180))),
      finish.lat + Math.cos(finishRad) * aheadM / 111320,
    ];
    return {
      phase: "overhead",
      center: [mix(finishCenter[0], finalCenter[0], reveal), mix(finishCenter[1], finalCenter[1], reveal)],
      zoom: mix(chaseZoom, overviewZoom, reveal),
      pitch: mix(pitch, 0, reveal),
      bearing: mixAngle(bearing, 0, reveal),
    };
  }
  const pullback = smoothstep((p - phase.overheadEnd) / (1 - phase.overheadEnd));
  return { phase: "pullback", center: finalCenter, zoom: overviewZoom - 0.55 * pullback, pitch: 0, bearing: 0 };
}

export function replayRouteFeatureCollection(timeline, state) {
  if (!timeline?.segments?.length || !state) return EMPTY;
  const features = [];
  timeline.segments.forEach((segment, index) => {
    if (index > state.seg) return;
    const points = index < state.seg ? segment.pts.slice() : segment.pts.slice(0, state.i + 1);
    if (index === state.seg) {
      const last = points.at(-1);
      if (last?.lon !== state.lon || last?.lat !== state.lat) points.push({
        lon: state.lon, lat: state.lat, estimated: state.estimated || last?.estimated,
      });
    }
    if (points.length < 2) return;
    const coord = point => [point.lon, point.lat];
    let estimated = !!(points[0].estimated || points[1].estimated);
    let coordinates = [coord(points[0])];
    for (let i = 1; i < points.length; i++) {
      const nextEstimated = !!(points[i - 1].estimated || points[i].estimated);
      if (nextEstimated !== estimated) {
        if (coordinates.length > 1) features.push({
          type: "Feature", properties: { estimated },
          geometry: { type: "LineString", coordinates },
        });
        coordinates = [coord(points[i - 1])];
        estimated = nextEstimated;
      }
      coordinates.push(coord(points[i]));
    }
    if (coordinates.length > 1) features.push({
      type: "Feature", properties: { estimated },
      geometry: { type: "LineString", coordinates },
    });
  });
  return { type: "FeatureCollection", features };
}

function emptyOrPoint(point) {
  const feature = pointFeature(point);
  return { type: "FeatureCollection", features: feature ? [feature] : [] };
}

function waitForMapReady(map, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      map.off("idle", check);
      map.off("render", check);
      error ? reject(error) : resolve();
    };
    const check = () => {
      if (map.isStyleLoaded?.() && map.areTilesLoaded?.()) finish();
    };
    const timer = setTimeout(() => finish(new Error(
      "The map preview is taking longer than expected to load. Check your connection, then try again.",
    )), timeoutMs);
    map.on("idle", check);
    map.on("render", check);
    check();
  });
}

export class ReplayVectorRenderer {
  static async create(host, timeline, color, { theme = "light", onExplore, styleProvider = openFreeMapProvider } = {}) {
    if (!host?.isConnected) throw new Error("The replay map has no visible container.");
    let ml;
    try {
      const [module, , worker] = await Promise.all([
        import("maplibre-gl"),
        import("maplibre-gl/dist/maplibre-gl.css"),
        import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
      ]);
      ml = module.default || module;
      if (worker?.default && ml.setWorkerUrl) ml.setWorkerUrl(worker.default);
    } catch {
      throw new Error("The live vector-map renderer could not be loaded.");
    }

    if (!styleProvider || typeof styleProvider.load !== "function") {
      throw new Error("The vector map style provider is not configured.");
    }
    const style = await styleProvider.load(theme);
    if (!host.isConnected) throw new Error("The replay was closed before its map could load.");
    const el = document.createElement("div");
    el.className = "sp-aer sp-vector-replay-map";
    el.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
    host.appendChild(el);

    const bounds = timeline.llBounds;
    const center = bounds ? [(bounds.w + bounds.e) / 2, (bounds.s + bounds.n) / 2] : [timeline.lon0, timeline.lat0];
    const map = new ml.Map({
      container: el,
      style,
      center,
      zoom: 12,
      minZoom: 2,
      maxZoom: 20,
      pitch: 0,
      bearing: 0,
       maxPitch: 78,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,
      cooperativeGestures: true,
      fadeDuration: 120,
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
    });
    let tileError = null;
    const onMapError = event => {
      if (event?.sourceId) tileError = event.error || new Error(`Map source ${event.sourceId} failed to load.`);
    };
    map.on("error", onMapError);
    map.addControl(new ml.AttributionControl({ compact: false }), "top-left");
    map.addControl(new ml.ScaleControl({ maxWidth: 82, unit: "metric" }), "top-left");

    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("The vector map took too long to load. Check your connection and retry.")), 16000);
        map.once("load", () => { clearTimeout(timer); resolve(); });
      });
      if (!host.isConnected) throw new Error("The replay was closed while its map was loading.");

      const firstSymbol = style.layers.find(layer => layer.type === "symbol")?.id;
      const first = timeline.segments[0]?.pts?.[0];
      const last = timeline.segments.at(-1)?.pts?.at(-1);
      const building = style.layers.find(layer => layer.type === "fill" && layer["source-layer"] === "building");
      if (building) {
        const height = ["coalesce", ["to-number", ["get", "render_height"]], ["to-number", ["get", "height"]], 0];
        const minHeight = ["coalesce", ["to-number", ["get", "render_min_height"]], ["to-number", ["get", "min_height"]], 0];
        map.addLayer({
          id: "oldtime-flyover-buildings",
          type: "fill-extrusion",
          source: building.source,
          "source-layer": "building",
          minzoom: 14.5,
          filter: ["any",
            [">", ["to-number", ["get", "render_height"], 0], 2],
            [">", ["to-number", ["get", "height"], 0], 2],
          ],
          layout: { visibility: "none" },
          paint: {
            "fill-extrusion-color": theme === "dark" ? "#71818c" : "#c7bfb5",
            "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14.5, ["*", height, 0.65], 16, height],
            "fill-extrusion-base": minHeight,
            "fill-extrusion-opacity": 0.82,
            "fill-extrusion-vertical-gradient": true,
          },
        }, firstSymbol);
      }
      map.addSource("oldtime-replay-route", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "oldtime-replay-route-outline",
        type: "line",
        source: "oldtime-replay-route",
        filter: ["!=", ["get", "estimated"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.96 },
      });
      map.addLayer({
        id: "oldtime-replay-route-line",
        type: "line",
        source: "oldtime-replay-route",
        filter: ["!=", ["get", "estimated"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": color, "line-width": 5, "line-opacity": 0.98 },
      });
      map.addLayer({
        id: "oldtime-replay-estimated-outline",
        type: "line",
        source: "oldtime-replay-route",
        filter: ["==", ["get", "estimated"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#11171d", "line-width": 8, "line-opacity": 0.94, "line-dasharray": [2, 1.6] },
      });
      map.addLayer({
        id: "oldtime-replay-estimated-line",
        type: "line",
        source: "oldtime-replay-route",
        filter: ["==", ["get", "estimated"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ff9a4a", "line-width": 4.5, "line-opacity": 1, "line-dasharray": [2, 1.6] },
      });
      map.addSource("oldtime-replay-jet-wake", { type: "geojson", lineMetrics: true, data: EMPTY });
      map.addLayer({
        id: "oldtime-replay-jet-wake",
        type: "line",
        source: "oldtime-replay-jet-wake",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-gradient": ["interpolate", ["linear"], ["line-progress"],
            0, "rgba(237,35,57,0)",
            0.25, "#aa1024",
            0.56, POSITION_RED,
            0.8, JET_FLAME_ORANGE,
            1, JET_ENGINE_GLOW,
          ],
          "line-width": ["interpolate", ["linear"], ["zoom"], 14, 5, 16.5, 10, 18, 15],
          "line-opacity": 0.98,
          "line-blur": 1.3,
        },
      });
      map.addSource("oldtime-replay-start", { type: "geojson", data: emptyOrPoint(first) });
      map.addLayer({
        id: "oldtime-replay-start-dot",
        type: "circle",
        source: "oldtime-replay-start",
        paint: { "circle-radius": 13, "circle-color": POSITION_RED, "circle-stroke-color": "#fff", "circle-stroke-width": 3 },
      });
      map.addSource("oldtime-replay-finish", { type: "geojson", data: emptyOrPoint(last) });
      map.addLayer({
        id: "oldtime-replay-finish-ring",
        type: "circle",
        source: "oldtime-replay-finish",
        paint: { "circle-radius": 13, "circle-color": POSITION_RED, "circle-stroke-color": "#fff", "circle-stroke-width": 3 },
      });
      map.addLayer({
        id: "oldtime-replay-finish-letter",
        type: "symbol",
        source: "oldtime-replay-finish",
        layout: { "text-field": "F", "text-size": 9, "text-font": ["Open Sans Bold"], "text-offset": [0, 0.05] },
        paint: { "text-color": "#11171d", "text-halo-color": "#fff", "text-halo-width": 0.5 },
      });
      map.addSource("oldtime-replay-position", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "oldtime-replay-position-halo",
        type: "circle",
        source: "oldtime-replay-position",
        paint: { "circle-radius": 30, "circle-color": POSITION_RED, "circle-opacity": 0.52, "circle-blur": 0.7 },
      });
      map.addLayer({
        id: "oldtime-replay-jet-engine",
        type: "circle",
        source: "oldtime-replay-position",
        paint: { "circle-radius": 13, "circle-color": JET_FLAME_ORANGE, "circle-opacity": 0.94, "circle-blur": 0.85 },
      });
      map.addLayer({
        id: "oldtime-replay-position-dot",
        type: "circle",
        source: "oldtime-replay-position",
        paint: { "circle-radius": 12, "circle-color": POSITION_RED, "circle-stroke-color": "#fff", "circle-stroke-width": 3 },
      });

      const padding = 58;
      const camera = bounds && map.cameraForBounds(
        [[bounds.w, bounds.s], [bounds.e, bounds.n]],
        { padding, maxZoom: 15.5 },
      );
      const fit = { ...(camera || { center, zoom: 13 }), center: centerPair(camera?.center || center) };
      map.jumpTo({ center: fit.center, zoom: fit.zoom, pitch: 0, bearing: 0 });
      await waitForMapReady(map);
      if (tileError) throw new Error("The map preview could not load all of its tiles. Check your connection, then try again.");
      if (!host.isConnected) throw new Error("The replay was closed while its map was loading.");
      el.classList.add("sp-vector-replay-ready");
      const videoAttribution = styleProvider.videoAttribution ||
        (styleProvider.id === "openfreemap" ? OPENFREEMAP_VIDEO_CREDIT : styleProvider.attributionText || "");
      if (!videoAttribution) throw new Error("Add a video attribution for this vector map provider before exporting.");
      return new ReplayVectorRenderer({ ml, map, el, timeline, color, fit, onExplore, theme, videoAttribution, style, tileError, onMapError });
    } catch (error) {
      map.off("error", onMapError);
      map.remove();
      el.remove();
      throw error;
    }
  }

  constructor({ ml, map, el, timeline, color, fit, onExplore, theme, videoAttribution, style, tileError, onMapError }) {
    Object.assign(this, { ml, map, el, tl: timeline, color, fit, onExplore, videoAttribution, style, tileError, onMapError });
    this.background = theme === "dark" ? "#11171d" : "#f5f6f3";
    this.kind = "vector";
    this.cameraMode = "fit";
    this.routeKey = "";
    this.lastState = null;
    this.buildingsVisible = false;
    this.flyoverVisible = false;
    this.buildingLayerIds = style.layers.filter(layer =>
      layer.type === "fill" && layer["source-layer"] === "building" && map.getLayer(layer.id),
    ).map(layer => layer.id);
    this.lastDensityAt = 0;
    this.density = 0;
    this.destroyed = false;
    this.onDragStart = () => {
      this.cameraMode = "manual";
      this.onExplore?.();
    };
    map.on("dragstart", this.onDragStart);
    map.on("zoomstart", this.onDragStart);
  }

  fitBounds() {
    if (this.destroyed || !this.map || !this.fit) return;
    this.setFlyoverVisible(false);
    this.cameraMode = "fit";
    this.map.jumpTo({ center: this.fit.center, zoom: this.fit.zoom, pitch: 0, bearing: 0 });
  }

  setFollow(value) {
    if (this.destroyed) return;
    this.cameraMode = value ? "follow" : "fit";
    if (!value) this.fitBounds();
  }

  setBuildingsVisible(value) {
    const visible = !!value && !!this.map?.getLayer("oldtime-flyover-buildings");
    if (visible === this.buildingsVisible) return;
    this.buildingsVisible = visible;
    if (this.map?.getLayer("oldtime-flyover-buildings")) {
      this.map.setLayoutProperty("oldtime-flyover-buildings", "visibility", visible ? "visible" : "none");
    }
  }

  setFlyoverVisible(value) {
    const visible = !!value && !this.destroyed;
    if (visible === this.flyoverVisible) return;
    this.flyoverVisible = visible;
    this.setBuildingsVisible(visible);
  }

  setTimeline(timeline) {
    if (this.destroyed) return;
    this.tl = timeline;
    this.routeKey = "";
    const bounds = timeline.llBounds;
    if (bounds) {
      const camera = this.map.cameraForBounds(
        [[bounds.w, bounds.s], [bounds.e, bounds.n]],
        { padding: 58, maxZoom: 15.5 },
      );
      if (camera) this.fit = { ...camera, center: centerPair(camera.center) };
    }
    if (this.cameraMode === "fit") this.fitBounds();
  }

  frame(state, { follow = false, flyoverProgress = null, timeMs = performance.now() } = {}) {
    if (this.destroyed || !this.map || !state) return false;
    this.lastState = state;
    if (flyoverProgress !== null) {
      this.cameraMode = "flyover";
      this.setFlyoverVisible(true);
      const now = performance.now();
      if (this.buildingLayerIds.length && now - this.lastDensityAt > 700) {
        this.lastDensityAt = now;
        try {
          const visibleBuildings = this.map.queryRenderedFeatures({ layers: this.buildingLayerIds }).length;
          this.density = Math.max(0, Math.min(1, visibleBuildings / 80));
        } catch { /* Building density only adjusts zoom; missing queries do not block replay. */ }
      }
      const camera = flyoverCameraForState(this.tl, state, flyoverProgress, this.fit, { density: this.density });
      if (camera) this.map.jumpTo(camera);
    } else if (follow) {
      this.setFlyoverVisible(false);
      this.cameraMode = "follow";
      this.map.jumpTo({ center: [state.lon, state.lat], zoom: 16, pitch: 0, bearing: 0 });
    } else if (this.cameraMode === "follow" || this.cameraMode === "flyover") {
      this.setFlyoverVisible(false);
      this.fitBounds();
    } else {
      this.setFlyoverVisible(false);
    }

    const progressKey = `${state.seg}:${state.i}:${Math.round((state.f || 0) * 8)}`;
    if (progressKey !== this.routeKey) {
      this.map.getSource("oldtime-replay-route")?.setData(replayRouteFeatureCollection(this.tl, state));
      this.routeKey = progressKey;
    }
    const showPosition = flyoverProgress === null || flyoverProgress < FLYOVER_PHASES.chaseEnd;
    this.map.getSource("oldtime-replay-position")?.setData(showPosition ? emptyOrPoint(state) : EMPTY);
    const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.map.getSource("oldtime-replay-jet-wake")?.setData(showPosition ? jetFlameFeature(this.tl, state, timeMs, reduceMotion) : EMPTY);
    const pulse = markerPulse(timeMs, reduceMotion);
    this.map.setPaintProperty("oldtime-replay-position-halo", "circle-radius", pulse.radius);
    this.map.setPaintProperty("oldtime-replay-position-halo", "circle-opacity", pulse.opacity);
    this.map.setPaintProperty("oldtime-replay-jet-engine", "circle-radius", pulse.engineRadius);
    this.map.setPaintProperty("oldtime-replay-jet-engine", "circle-opacity", pulse.engineOpacity);
    this.map.triggerRepaint();
    return false;
  }

  async renderFrame(state, options) {
    if (this.destroyed) throw new Error("This export stopped because the replay was closed. Reopen the activity to try again.");
    const map = this.map;
    const rendered = new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        map.off("render", finish);
        resolve();
      };
      const timer = setTimeout(finish, 1000);
      map.once("render", finish);
    });
    this.frame(state, options);
    map.triggerRepaint();
    await rendered;
    if (this.tileError) {
      this.tileError = null;
      throw new Error("The map preview could not load all of its tiles. Check your connection, then try again.");
    }
  }

  async waitForTiles(timeoutMs) {
    if (this.destroyed) throw new Error("This export stopped because the replay was closed. Reopen the activity to try again.");
    await waitForMapReady(this.map, timeoutMs);
    if (this.tileError) {
      this.tileError = null;
      throw new Error("The map preview could not load all of its tiles. Check your connection, then try again.");
    }
  }

  drawTo(ctx, width, height) {
    if (this.destroyed) throw new Error("The replay map is no longer available.");
    const canvas = this.map.getCanvas();
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, width, height);
    const scale = Math.min(width / canvas.width, height / canvas.height);
    const drawWidth = canvas.width * scale, drawHeight = canvas.height * scale;
    ctx.drawImage(canvas, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.map?.off("dragstart", this.onDragStart);
    this.map?.off("zoomstart", this.onDragStart);
    this.map?.off("error", this.onMapError);
    this.map?.remove();
    this.el?.remove();
  }
}
