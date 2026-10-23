import { test } from "node:test";
import { strict as assert } from "node:assert";
import { placeTagSchema } from "../src/lib/place-tag";
test("custom labels never imply coordinates; selected OSM venues require a valid point", () => {
  const custom = { id: "custom:coffee", label: "  Coffee bar  ", source: "custom" };
  assert.equal(placeTagSchema.parse(custom).label, "Coffee bar");
  assert.equal(placeTagSchema.safeParse({ ...custom, lat: 1, lon: 2 }).success, false);
  const osm = { id: "osm:way:123", label: "Public park", source: "osm", lat: 25, lon: -80 };
  assert.equal(placeTagSchema.safeParse(osm).success, true);
  assert.equal(placeTagSchema.safeParse({ ...osm, lat: 91 }).success, false);
  assert.equal(placeTagSchema.safeParse({ ...osm, lon: undefined }).success, false);
  assert.equal(placeTagSchema.safeParse({ ...custom, label: " " }).success, false);
});
