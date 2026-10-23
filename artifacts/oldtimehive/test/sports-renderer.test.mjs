import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("privacy changes invalidate both exports and cannot interrupt a busy export", async () => {
  const source = await readFile(new URL("../app/sports-mode.js", import.meta.url), "utf8");
  const handler = source.match(/function onChange\(e\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(handler, "Production change handler was found");
  const ui = { busy: "", hideEnds: true, video: { url: URL.createObjectURL(new Blob(["video"])) }, mapImg: { url: URL.createObjectURL(new Blob(["image"])) } };
  let renders = 0;
  const change = new Function("ui", "render", "soc", `${handler}; return onChange;`)(ui, () => renders++, { onSocialChange: () => false });
  change({ target: { id: "sp-hide", checked: false } });
  assert.equal(ui.video, null); assert.equal(ui.mapImg, null);
  assert.equal(ui.hideEnds, false); assert.equal(renders, 1);
  ui.busy = "mapimg"; ui.hideEnds = true;
  const target = { id: "sp-hide", checked: false };
  change({ target });
  assert.equal(target.checked, true);
  assert.equal(ui.hideEnds, true); assert.equal(renders, 1);
});

test("street startup, moving marker and map snapshot render without runtime errors", async () => {
  const saved = new Map(), requests = [], frames = [], calls = [];
  const install = (key, value) => { saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); };
  const ctx = new Proxy({
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: t => ({ width: String(t).length * 7 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(200) }),
  }, { get: (obj, key) => key in obj ? obj[key] : (...args) => { calls.push([key, args]); } });
  class Element {
    constructor(tag) { this.tagName = tag; this.style = {}; this.children = []; this.clientWidth = 360; this.clientHeight = 520; }
    appendChild(el) { this.children.push(el); el.parent = this; return el; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(e => e !== this); }
    setAttribute() {}
    getContext(kind) { return kind === "2d" ? ctx : null; }
    toBlob(fn, type) { fn(new Blob(["mock canvas encoding"], { type })); }
  }
  try {
    install("document", { createElement: tag => new Element(tag) });
    install("devicePixelRatio", 1);
    install("Path2D", class { moveTo() {} lineTo() {} closePath() {} });
    install("requestAnimationFrame", fn => { frames.push(fn); return frames.length; });
    install("cancelAnimationFrame", () => {});
    install("createImageBitmap", async () => ({ width: 256, height: 256, close() {} }));
    install("fetch", async url => { requests.push(String(url)); return new Response(new Blob(["mock raster"]), { headers: { "content-type": "image/png" } }); });
    const { mountSportsMap } = await import("../app/sports-maps.js");
    const start = 1791650000000, points = Array.from({ length: 26 }, (_, i) => ({ lat: 40.75 + i * .00005, lon: -73.99 + i * .00065, accuracy: 5, timestamp: start + i * 4000 }));
    const workout = { activityType: "cycle", points, events: [], startedAt: start, endedAt: points.at(-1).timestamp, summary: { distanceM: 1500, activeSeconds: 100 } };
    const map = await mountSportsMap(new Element("div"), { workout, style: "street", hideEnds: false });
    try {
      assert.equal(map.getState().mode, "street");
      assert.ok(requests.length > 0 && requests.every(u => u.startsWith("https://tile.openstreetmap.org/")));
      frames.shift()?.(performance.now() + 16);
      assert.ok(calls.some(([name]) => name === "arc"), "Moving location marker was rendered");
      const blob = await map.exportMapImage({ owner: { name: "Map test", username: "maptest" }, caption: "Test route" });
      assert.equal(blob.type, "image/jpeg");
      assert.ok(calls.some(([name]) => name === "drawImage"), "Street raster was rendered");
    } finally { map.destroy(); }
  } finally {
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
