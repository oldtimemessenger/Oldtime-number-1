const galleryIcon = new URL("./assets/gallery-glyph.png", import.meta.url).href;
// Session-only strip of images the user actually captured or picked. Holds blob URLs owned by the editor.
export function createCameraStrip({ host, uploadHost = null, onPick, onUpload, max = 24 }) {
  const items = [];
  const tile = document.createElement("button");
  tile.type = "button"; tile.className = "ce-strip-upload"; tile.setAttribute("aria-label", "Choose photos from your gallery");
  const img0 = document.createElement("img"); img0.src = galleryIcon; img0.alt = ""; img0.draggable = false; img0.className = "ce-strip-glyph"; tile.append(img0);
  tile.onclick = () => onUpload();
  const list = document.createElement("div"); list.className = "ce-strip-list";
  const handle = document.createElement("button"); handle.type = "button"; handle.className = "ce-strip-handle";
  const bar = document.createElement("span"); bar.setAttribute("aria-hidden", "true"); handle.append(bar);
  let collapsed = false, disabled = false;
  host.setAttribute("role", "group"); host.setAttribute("aria-label", "Selected media"); if (uploadHost) uploadHost.append(tile); else host.append(tile);
  host.append(handle, list);
  const setCollapsed = (v) => {
    collapsed = !!v; host.dataset.collapsed = String(collapsed);
    handle.setAttribute("aria-expanded", String(!collapsed));
    handle.setAttribute("aria-label", collapsed ? "Show recent photos" : "Hide recent photos");
  };
  handle.onclick = () => setCollapsed(!collapsed);
  // Vertical swipes toggle; horizontal movement stays with the strip's own scroll.
  let start = null;
  const down = (e) => { start = { x: e.clientX, y: e.clientY }; };
  const up = (e) => {
    if (!start) return; const dx = e.clientX - start.x, dy = e.clientY - start.y; start = null;
    if(disabled)return;
    if (Math.abs(dy) >= 28 && Math.abs(dy) > Math.abs(dx) * 1.5) setCollapsed(dy > 0);
  };
  const cancel = () => { start = null; };
  const listeners = [["pointerdown", down], ["pointerup", up], ["pointercancel", cancel]];
  for (const [name, fn] of listeners) host.addEventListener?.(name, fn);
  const render = () => {
    list.replaceChildren(...items.map((item, i) => {
      const button = document.createElement("button"); button.type = "button"; button.className = "ce-strip-tile";
      button.disabled=disabled;
      button.setAttribute("aria-label", `Use recent photo ${i + 1}`);
      const img = document.createElement("img"); img.src = item.thumb; img.alt = ""; img.draggable = false; img.decoding = "async"; button.append(img);
      button.onclick = () => onPick(item.url); return button;
    }));
    host.dataset.count = items.length;
  };
  setCollapsed(false); render();
  return {
    add(url, thumbnailUrl = url) { if (!url || items.some(i => i.url === url)) return; items.unshift({ url, thumb: thumbnailUrl || url }); items.length = Math.min(items.length, max); render(); list.scrollTo?.({ left: 0 }); },
    items: () => items.map(i => i.url),
    thumbnails: () => items.map(i => i.thumb),
    toggle: (v) => setCollapsed(v === undefined ? !collapsed : !v),
    collapsed: () => collapsed,
    setDisabled(v) { disabled=!!v;host.querySelectorAll("button").forEach(b => b.disabled = disabled); tile.disabled = disabled; },
    dispose() { items.length = 0; for (const [name, fn] of listeners) host.removeEventListener?.(name, fn); tile.remove(); host.replaceChildren(); },
  };
}
