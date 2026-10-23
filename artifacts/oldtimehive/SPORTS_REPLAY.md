# Sports replay: implementation and operating limits

## Live maps and portable media

Recording defaults to a labeled north-up Street map; Aerial is an optional
photographic perspective. One measured GPS
fix anchors the map, without inventing route points or distance. Imagery refreshes
near the viewport edge. Network/coverage failures retain an honest trace fallback.

New Sports card/video uploads default to private server files, not Replit App
Storage. `SPORTS_MEDIA_DIR` points to the directory; stored keys are relative.
Development defaults to the API package's ignored `media-data/`. Production
requires an explicitly configured persistent media volume, not ephemeral disk.
Files are written atomically with private permissions and served through the
existing visibility-checked, Range-capable endpoint.

Copy the database and media directory together when migrating; back up both.
Explicit `SPORTS_MEDIA_STORAGE=s3` or `gcs` is an optional provider-neutral choice
with its own host credentials/costs; neither is auto-selected. Historical cloud
objects remain readable while their original configuration exists and must be
copied before removing it. No historical upload is deleted or automatically
moved by this change. Free imagery does not imply free hosting/disk capacity.

## Renderer and data

Saved route videos default to a labeled street-map distance replay. Aerial
replays use a Canvas perspective flyover over real imagery.
The replaceable imagery provider in `app/sports-imagery.js` requests a bounded
viewport (at most 16 tiles), checks CORS-safe pixels, and caches only three
in-memory mosaics. Privacy-filtered GPS determines the request extent. Preview
and recording use the same geographic projection. North-up street rendering
uses row strips rather than triangle clips to reduce redraw work.

- Street maps: OpenStreetMap standard raster tiles, visible clickable credits,
  normal browser HTTP caching and Referer. Only the current bounded map view is
  requested; exports reuse its rendered image, not an offline tile archive.
  The community service is best-effort, not a guaranteed unlimited production
  service. Policy: https://operations.osmfoundation.org/policies/tiles/.

- Contiguous U.S.: detailed aerial photography from USGS The National Map.
  <https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map>
  These government map services are public domain. Credit USGS, USDA and The
  National Map; acknowledgement: "Map services and data available from U.S.
  Geological Survey, National Geospatial Program."
- Elsewhere, or when U.S. imagery fails: first try recent Copernicus Sentinel-2
  L2A true-colour scenes (~10 m) through Microsoft's anonymous public Planetary
  Computer STAC/tile APIs. No account or billing token. Search the preceding
  year for low-cloud scenes covering the viewport. Details shows the acquisition
  date and resolution. Export includes the required credit:
  "Contains modified Copernicus Sentinel data [Year]".
  <https://planetarycomputer.microsoft.com/docs>
  <https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice>
- If neither detailed source works: NASA/MODIS Blue Marble regional satellite
  overview, approximately 500 m resolution, historical 2004 composite. This is
  not current or street-level imagery. It must never be described as detailed
  worldwide satellite coverage.
  <https://science.nasa.gov/earth/earth-observatory/collections/blue-marble>
  <https://www.nasa.gov/nasa-brand-center/images-and-media/>
  Use as factual map imagery with NASA/MODIS credit, not NASA endorsement.

Neither source requires a key or paid plan; external availability is not
guaranteed. Credits appear in preview and exported video. If imagery fails,
the explicitly labelled Trace fallback uses the original coordinate grid.
That reference grid is not a road map or satellite image and works offline
without WebGL. The recording screen can still use this lightweight trace.

Generated recordings enter Studio through its durable media registry, not an
unregistered blob URL. The primary "Share to feed" action uses the server-backed
Sports media upload and public post endpoint with confirmation. Opening Studio
alone is not proof that a public server-side post exists.

Optional terrain uses **MapLibre GL JS** (BSD-3-Clause), loaded only when requested.
Cesium and Three.js were not added: a globe or additional 3D engine is unnecessary
for this local workout view. The replaceable provider is isolated in
`app/sports-terrain.js`; the renderer is in `app/sports-maps.js`.

The current optional elevation provider is the public **Terrain Tiles** dataset
hosted by the Registry of Open Data on AWS:

- <https://registry.opendata.aws/terrain-tiles/>
- <https://github.com/tilezen/joerd/blob/master/docs/attribution.md>
- <https://github.com/tilezen/joerd/blob/master/docs/data-sources.md>

The dataset mixes sources and licenses by region. The UI retains the official
required attribution list. Terrain video credits include the canonical credits
URL and source acknowledgment. Source-derived legal citation years are retained;
they are not workout year labels. Attribution must remain when replacing a
provider or redistributing its data.

Terrain is currently offered within approximate US bounding boxes, not an exact
country boundary. Tiles can include neighboring regions; do not describe this as
exclusively USGS data. Terrain failure, absent WebGL or an unsupported region
falls back to the original stylized view. No Google/Mapbox imagery or standard
paid mapping APIs are used. Street views use OpenStreetMap standard raster
tiles under their usage policy.

The public dataset needs no API key but is an external network service, not a
guaranteed unlimited-production SLA. Availability and hosting terms may change.
Self-hosting a future provider could incur bandwidth/storage costs. Existing
Oldtime database/media hosting and ordinary app infrastructure costs still apply.

## Measurements and location privacy

Only the workout's recorded GPS samples and timestamps drive playback. Pauses,
large gaps, implausible speed jumps and poor fixes form disconnected segments.
Stationary jitter is filtered without synthesizing route points. Displayed
elevation is recorded GPS altitude with sufficient reported accuracy, never
terrain-derived exercise measurements.

Routes on posters are off by default. Endpoint hiding is enabled by default for
replays and removes all visits within 250 metres of the original endpoints,
including repeated visits on loops. Routes under 1 km cannot use the hidden
view. Users can explicitly choose the full route with a sensitive-location
warning. Hiding is not a guarantee of anonymity: recognizable route shapes can
still reveal an area.

Public posts contain an image/video URL, summary and optional challenge/people
tags, not raw coordinates. Animated SVG exports contain only normalized drawing
coordinates and escaped text, with no scripts, external media or GPS metadata.
Optional terrain tile requests necessarily disclose the requested approximate
area to the tile host.

## Export and integration

Supported browsers capture a 720×1280 Canvas through MediaRecorder, selecting an
available MP4/WebM MIME. Exports cancel explicitly on interruption or closing.
The animated SVG card is a downloadable fallback when video recording is
unsupported; it does not promise an MP4 on such devices.

Sports publishing reuses the existing private media storage and public post
endpoint. Published videos support byte ranges. “Share to Oldtime” opens the
existing creative editor with the matching image/video kind. Posted content
reuses Oldtime's existing Story, Blast and Friends/Chat sharing surfaces.
Existing local-only destinations must not be described as remote delivery;
this feature does not add a separate Sports feed or replace their transport.

Reliable recording while a phone is locked or another app is active still
requires native background tracking. The web recorder preserves its draft and
pauses rather than claiming to keep recording through browser suspension.
