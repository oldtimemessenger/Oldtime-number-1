// Lazy owner of at most one live sports-maps instance. Never simulates geography or elevation.
let loading = null;
let liveLoading = null;
async function loadMaps() {
  try { loading ||= import("./sports-maps.js"); return await loading; }
  catch { loading = null; throw new Error("The map preview could not load. Your recorded GPS route is shown as a trace."); }
}
async function loadLiveMap() {
  try { liveLoading ||= import("./sports-live-vector-map.js"); return await liveLoading; }
  catch { liveLoading = null; throw new Error("The live vector map could not be loaded in this build."); }
}
export const exportSupported = () => typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement !== "undefined" && !!HTMLCanvasElement.prototype.captureStream
  && ["video/mp4", "video/webm"].some(t => MediaRecorder.isTypeSupported?.(t));
export async function animatedCard(opts) { return (await loadMaps()).exportAnimatedCard(opts); }
export async function terrainLinks() { const m = await loadMaps(); return { credit: m.TERRAIN_CREDIT, links: m.TERRAIN_LINKS }; }
export class MapSlot {
  constructor() { this.inst = null; this.token = 0; this.pending = false; }
  async mount(host, { workout, hideEnds = false, style = "stylized", live = false, overhead = false }) {
    this.destroy(); const t = this.token; this.pending = true;
    try {
      const m = await loadMaps();
      const active = () => t === this.token && host.isConnected;
      const inst = await m.mountSportsMap(host, { workout, hideEnds, style, live, overhead,
        onError: e => active() && this.onError?.(e), onFrame: f => active() && this.onFrame?.(f), onMode: i => active() && this.onMode?.(i) });
      if (t !== this.token || !host.isConnected) { try { inst?.destroy(); } catch {} return null; }
      this.inst = inst; this.onMode?.(inst.getState());
      return inst;
    } catch (e) { if (t === this.token) throw e; return null; }
    finally { if (t === this.token) this.pending = false; }
  }
  update(workout) { try { this.inst?.update(workout); } catch {} }
  destroy() { this.token++; this.pending = false; try { this.inst?.destroy(); } catch {} this.inst = null; }
}
export class LiveMapSlot {
  constructor() { this.inst = null; this.token = 0; this.pending = false; }
  async mount(host, options) {
    this.destroy(); const token = this.token; this.pending = true;
    try {
      const module = await loadLiveMap();
      const inst = await module.mountLiveVectorMap(host, options);
      if (token !== this.token || !host.isConnected) { inst?.destroy(); return null; }
      this.inst = inst; return inst;
    } catch (error) {
      if (token === this.token) throw error;
      return null;
    } finally { if (token === this.token) this.pending = false; }
  }
  update(workout, viewer, color) { try { this.inst?.update(workout, viewer, color); } catch {} }
  setTheme(theme) { try { return Promise.resolve(this.inst?.setTheme(theme)).catch(() => null); } catch { return null; } }
  recenter() { try { this.inst?.recenter(); } catch {} }
  destroy() { this.token++; this.pending = false; try { this.inst?.destroy(); } catch {} this.inst = null; }
}
