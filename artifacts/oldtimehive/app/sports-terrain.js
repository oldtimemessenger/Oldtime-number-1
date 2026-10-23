// Optional terrain provider. Replaceable: the renderer only needs {id, tiles, encoding, ...},
// supports(bounds) and probe(). Public AWS Terrain Tiles (Terrarium). No token, no paid provider.
// Only used inside the USA, where tiles come from USGS 3DEP / SRTM style public-domain sources.
// Canonical attribution document and its "Required attribution" list, quoted from the Tilezen
// joerd docs. Dates inside are legal citations from the data owners. AWS tiles mix these sources
// by location, so the whole list applies wherever terrain is shown.
export const ATTRIBUTION_URL = "https://github.com/tilezen/joerd/blob/master/docs/attribution.md";
export const ATTRIBUTION_LINES = [
  "ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and funded under National Science Foundation awards 1043681, 1559691, and 1542736;",
  "Australia terrain data \u00a9 Commonwealth of Australia (Geoscience Australia) 2017;",
  "Austria terrain data \u00a9 offene Daten \u00d6sterreichs \u2013 Digitales Gel\u00e4ndemodell (DGM) \u00d6sterreich;",
  "Canada terrain data contains information licensed under the Open Government Licence \u2013 Canada;",
  "Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers;",
  "Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration;",
  "Mexico terrain data source: INEGI, Continental relief, 2016;",
  "New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New Zealand and the New Zealand Government (All rights reserved);",
  "Norway terrain data \u00a9 Kartverket;",
  "United Kingdom terrain data \u00a9 Environment Agency copyright and/or database right 2015. All rights reserved;",
  "United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey.",
];
export const terrainProvider = {
  id: "aws-terrarium",
  name: "Terrain Tiles (AWS Open Data)",
  tiles: ["https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"],
  encoding: "terrarium", tileSize: 256, maxzoom: 15,
  credit: "Terrain Tiles on AWS Open Data. Elevation sources vary by location. Relief only, not a map or imagery.",
  get creditHtml() { return `Terrain Tiles on AWS Open Data. Sources vary by location. <a href="${ATTRIBUTION_URL}" target="_blank" rel="noopener noreferrer">Full data-source credits</a>`; },
  attributionUrl: ATTRIBUTION_URL, attributionLines: ATTRIBUTION_LINES,
  links: [
    { label: "Terrain Tiles data sources and credits", href: ATTRIBUTION_URL },
    { label: "Registry of Open Data on AWS", href: "https://registry.opendata.aws/terrain-tiles" },
  ],
  // Approximate USA boxes (south, north, west, east). Tiles are a mixture of sources, so border
  // areas can include others. The full attribution list is always shown with terrain.
  coverage: [[24.5, 49, -124.8, -66.9], [51.2, 71.6, -170, -129.9], [18.8, 22.4, -160.7, -154.7]],
  supports(ll) {
    if (!ll) return { ok: false, reason: "No route to place on terrain." };
    const inside = (la, lo) => this.coverage.some(([s, n, w, e]) => la >= s && la <= n && lo >= w && lo <= e);
    const ok = [[ll.s, ll.w], [ll.s, ll.e], [ll.n, ll.w], [ll.n, ll.e]].every(([a, b]) => inside(a, b));
    return ok ? { ok: true } : { ok: false, reason: "Terrain is only offered for routes inside approximate USA bounds right now." };
  },
  async probe(ll, timeout = 7000) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, reason: "You are offline." };
    const z = 8, lat = (ll.s + ll.n) / 2, lon = (ll.w + ll.e) / 2;
    const x = Math.floor((lon + 180) / 360 * 2 ** z), r = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z);
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(this.tiles[0].replace("{z}", z).replace("{x}", x).replace("{y}", y), { signal: ctl.signal, mode: "cors" });
      if (!res.ok) return { ok: false, reason: "Terrain tiles did not load." };
      const bmp = await createImageBitmap(await res.blob()); bmp.close?.();
      return { ok: true };
    } catch { return { ok: false, reason: "Terrain tiles could not be reached." }; }
    finally { clearTimeout(timer); }
  },
};
