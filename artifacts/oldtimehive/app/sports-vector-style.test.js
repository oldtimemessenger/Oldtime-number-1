import test from "node:test";
import assert from "node:assert/strict";
import { customizeSportsVectorStyle, createSportsMapStyleProvider, OPENFREEMAP_CREDITS, OPENFREEMAP_VIDEO_CREDIT } from "./sports-vector-style.js";
import { latestRecordedLocation, routeFeatureCollection } from "./sports-live-vector-map.js";

const baseStyle = () => ({
  version: 8,
  sources: {
    openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
    relief: { type: "raster", tiles: ["https://example.test/{z}/{x}/{y}.png"] },
    dem: { type: "raster-dem", tiles: ["https://example.test/dem/{z}/{x}/{y}.png"] },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#fff" } },
    { id: "park", type: "fill", source: "openmaptiles", "source-layer": "park", paint: { "fill-color": "#123" } },
    { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": "#123" } },
    { id: "highway-minor", type: "line", source: "openmaptiles", "source-layer": "transportation", paint: { "line-color": "#123" } },
    { id: "place-label", type: "symbol", source: "openmaptiles", "source-layer": "place", paint: { "text-color": "#123" } },
    { id: "building", type: "fill", source: "openmaptiles", "source-layer": "building", paint: { "fill-color": "#123" } },
    { id: "relief", type: "raster", source: "relief" },
    { id: "hillshade", type: "hillshade", source: "dem" },
  ],
});

test("custom light and dark styles keep real vector layers and remove raster basemap imagery", () => {
  const light = customizeSportsVectorStyle(baseStyle(), "light");
  const dark = customizeSportsVectorStyle(baseStyle(), "dark");
  assert.equal(light.layers.some(layer => layer.type === "raster"), false);
  assert.equal(light.sources.relief, undefined);
  assert.equal(light.sources.dem, undefined);
  assert.notEqual(light.layers[0].paint["background-color"], dark.layers[0].paint["background-color"]);
  assert.equal(light.layers.find(layer => layer.id === "park").paint["fill-color"], "#dceee3");
  assert.equal(dark.layers.find(layer => layer.id === "water").paint["fill-color"], "#1b3444");
  assert.notEqual(light.layers.find(layer => layer.id === "highway-minor").paint["line-color"],
    dark.layers.find(layer => layer.id === "highway-minor").paint["line-color"]);
  assert.equal(light.sources.openmaptiles.attribution, OPENFREEMAP_CREDITS);
});

test("style provider loads once and applies a new theme without an API key", async () => {
  let calls = 0;
  const provider = createSportsMapStyleProvider({
    styleUrl: "https://tiles.example.test/style",
    id: "self-hosted",
    videoAttribution: "Hosted tiles © OpenStreetMap contributors",
    fetchImpl: async () => ({ ok: true, json: async () => { calls++; return baseStyle(); } }),
  });
  await provider.load("light");
  const dark = await provider.load("dark");
  assert.equal(calls, 1);
  assert.equal(dark.layers[0].paint["background-color"], "#11171d");
  assert.equal(provider.videoAttribution, "Hosted tiles © OpenStreetMap contributors");
  assert.equal(dark.sources.openmaptiles.attribution, "Hosted tiles © OpenStreetMap contributors");
  assert.equal(OPENFREEMAP_VIDEO_CREDIT, "OpenFreeMap © OpenMapTiles Data from OpenStreetMap");
});

test("route GeoJSON draws each plausible GPS segment separately and never joins a jump", () => {
  const workout = {
    id: "test-only",
    activityType: "walk",
    points: [
      { lat: 40, lon: -73, timestamp: 1000, accuracy: 5 },
      { lat: 40.0001, lon: -73, timestamp: 5000, accuracy: 5 },
      { lat: 40.03, lon: -73, timestamp: 9000, accuracy: 5 },
      { lat: 40.0301, lon: -73, timestamp: 13000, accuracy: 5 },
    ],
    events: [],
  };
  const features = routeFeatureCollection(workout).features;
  assert.equal(features.length, 2);
  assert.deepEqual(features[0].geometry.coordinates, [[-73, 40], [-73, 40.0001]]);
  assert.deepEqual(features[1].geometry.coordinates, [[-73, 40.03], [-73, 40.0301]]);
  assert.deepEqual(latestRecordedLocation(workout).coordinates, [-73, 40.0301]);
});

test("invalid and poor-accuracy fixes are never used for the live marker or route", () => {
  const workout = {
    id: "test-only", activityType: "walk", events: [],
    points: [
      { lat: 40, lon: -73, timestamp: 1000, accuracy: 5 },
      { lat: 40.001, lon: -73, timestamp: 5000, accuracy: 80 },
    ],
  };
  assert.deepEqual(latestRecordedLocation(workout).coordinates, [-73, 40]);
  assert.equal(routeFeatureCollection(workout).features.length, 0);
});
