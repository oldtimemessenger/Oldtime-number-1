import test from "node:test";
import assert from "node:assert/strict";
import { roadTilePlan, projectRoads, decodeRoads } from "./sports-road-network.js";
test("street-network requests cover only a bounded viewport at the provider's available zoom", () => {
  const p = roadTilePlan({ w: -80.3, e: -80.1, s: 25.7, n: 25.9 }, 18);
  assert.ok(p.z <= 14);
  assert.ok((p.x1 - p.x0 + 1) * (p.y1 - p.y0 + 1) <= 9);
  assert.throws(() => roadTilePlan({ w: 170, e: -170, s: 1, n: 2 }, 14));
});
test("real longitude/latitude street geometry aligns with the recorded GPS coordinate system", () => {
  const roads = [{ kind: "residential", points: [[-80.2, 25.8], [-80.199, 25.801]] }];
  const result = projectRoads(roads, { lon0: -80.2, lat0: 25.8 });
  assert.equal(result[0].points[0].x, 0); assert.equal(result[0].points[0].y, 0);
  assert.ok(result[0].points[1].x > 90); assert.ok(result[0].points[1].y > 110);
  assert.deepEqual(decodeRoads(new ArrayBuffer(0), 0, 0, 0), []);
});
