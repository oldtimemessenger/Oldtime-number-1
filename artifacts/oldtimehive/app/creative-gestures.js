import { hitLayer, transformGesture, createLayer, localPoint, layerVisible } from "./creative-project.js";
import {panCrop,zoomCrop,distance} from "./creative-capture-geometry.js";
import {canvasGeometry} from "./creative-canvas-geometry.js";

export function bindCreativeGestures(canvas, { project, measurements, time, selected, select, changed, trash, remove, options, drawing, preview, checkpoint = () => {}, editText = () => {}, background = () => null, setCrop = () => {} }) {
  let bg = null;
  const pointers = new Map();
  let anchor = null, stroke = null, path = null, hold = null, origin = null, moved = false, lastTap = null;
  let previousSelection = null, multiTouch = false, suppressClickUntil = 0;
  const point = event => {
    const rect = canvas.getBoundingClientRect();
    const fit=canvasGeometry(rect,project,getComputedStyle(canvas).objectFit);
    return {x:(event.clientX-rect.left-fit.offsetX)/fit.scaleX,y:(event.clientY-rect.top-fit.offsetY)/fit.scaleY};
  };
  const cancelHold = () => { clearTimeout(hold); hold = null; };
  const resetAnchor = () => {
    const layer = project.layers.find(item => item.id === selected());
    anchor = layer ? { initial: { x: layer.x, y: layer.y, scale: layer.scale, rotation: layer.rotation, fontSize: layer.fontSize }, before: [...pointers.values()] } : null;
  };
  const overTrash = event => {
    const rect = trash.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  };
  const down = event => {
    if (preview() || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault(); canvas.setPointerCapture(event.pointerId);
    const current = point(event); pointers.set(event.pointerId, current);
    if (drawing() && pointers.size === 1) {
      const brush = drawing(), existing = project.layers.find(item => item.id === selected());
      let layer = brush.mode === "eraser" ? (existing?.kind === "drawing" && !existing.locked ? existing : [...project.layers].reverse().find(item => item.kind === "drawing" && !item.locked && !item.hidden))
        : brush.mode === "handwriting" && existing?.handwriting && !existing.locked ? existing : null;
      if (brush.mode === "eraser" && !layer) { pointers.delete(event.pointerId); return; }
      checkpoint();
      if (!layer) {
        layer = createLayer("drawing", { width: project.width, height: project.height, strokes: [],
          color: brush.color, strokeWidth: brush.width, handwriting: brush.mode === "handwriting", startTime: 0, endTime: project.duration });
        project.layers.push(layer);
      }
      path = { points: [localPoint(layer,current,project)], color: brush.color, width: brush.width * (brush.mode==="marker"?1.4:1),
        opacity: brush.opacity * (brush.mode === "highlighter" ? .35 : 1), erase: brush.mode === "eraser" };
      layer.strokes.push(path); layer.revision = (layer.revision || 0) + 1;
      stroke = layer; select(layer.id); changed(false); return;
    }
    if (pointers.size === 1) {
      previousSelection = project.layers.find(item => item.id === selected());
      multiTouch = false;
      const layer = hitLayer(project, current, measurements(), time());
      select(layer?.id || null); origin = { x: event.clientX, y: event.clientY }; moved = false;
      const info = !layer && !drawing() ? background() : null;
      bg = info ? { info, rect: { ...info.rect }, last: current, pts: null, dist: 0, started: false } : null;
      if (layer) hold = setTimeout(() => { options(); anchor = null; }, 600);
    } else {
      cancelHold(); multiTouch = true;
      if (!selected() && previousSelection?.kind === "text" && !previousSelection.locked && layerVisible(previousSelection, time())) select(previousSelection.id);
      if (selected() || !bg) bg = null;
      else { const [a, b] = [...pointers.values()]; bg.dist = distance(a, b); bg.mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; bg.info = background() || bg.info; bg.rect = { ...bg.info.rect }; bg.pinch = true; }
    }
    resetAnchor();
  };
  const move = event => {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault(); const current = point(event); pointers.set(event.pointerId, current);
    const drift = origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
    if (drift > 5) cancelHold();
    if (stroke) { path.points.push(localPoint(stroke, current, project)); stroke.revision++; changed(false); return; }
    if (bg) {
      const info = bg.info, out = { w: project.width, h: project.height }, pts = [...pointers.values()];
      if (!bg.started && drift <= 5 && !bg.pinch) return;
      if (!bg.started) { checkpoint(); bg.started = true; moved = true; }
      if (pts.length >= 2 && bg.pinch) {
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        let r = zoomCrop(bg.rect, distance(pts[0], pts[1]) / Math.max(1, bg.dist), mid, info.asset, out);
        r = panCrop(r, mid.x - bg.mid.x, mid.y - bg.mid.y, info.asset, out);
        setCrop(r);
      } else if (pts.length === 1 && !bg.pinch) {
        const r = panCrop(bg.rect, current.x - bg.last.x, current.y - bg.last.y, info.asset, out);
        bg.rect = r; bg.last = current; setCrop(r);
      }
      changed(false); return;
    }
    const layer = project.layers.find(item => item.id === selected());
    if (!layer || !anchor) return;
    if (!moved && drift <= 5 && !multiTouch) return;
    if (!moved) { checkpoint(); moved = true; }
    transformGesture(layer, anchor.initial, anchor.before, [...pointers.values()], project);
    if (!multiTouch) { trash.classList.add("show"); trash.classList.toggle("is-over", overTrash(event)); }
    changed(false);
    resetAnchor();
  };
  const up = event => {
    cancelHold();
    if (!pointers.has(event.pointerId)) return;
    if (!stroke && !multiTouch && event.type !== "pointercancel" && trash.classList.contains("show") && overTrash(event)) remove();
    if (stroke && pointers.size === 1 && !path.erase) {
      const points = stroke.strokes.flatMap(item => Array.isArray(item) ? item : item.points);
      const ink=stroke.strokes.filter(item=>!item.erase).flatMap(item=>Array.isArray(item)?item:item.points);
      const minX = Math.min(...ink.map(p => p.x)), maxX = Math.max(...ink.map(p => p.x));
      const minY = Math.min(...ink.map(p => p.y)), maxY = Math.max(...ink.map(p => p.y));
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const angle=stroke.rotation*Math.PI/180;
      stroke.x += (cx*Math.cos(angle)-cy*Math.sin(angle))*stroke.scale/project.width;
      stroke.y += (cx*Math.sin(angle)+cy*Math.cos(angle))*stroke.scale/project.height;
      const padding=Math.max(stroke.strokeWidth,...stroke.strokes.map(item=>item.width||0))*2;
      stroke.width = Math.max(30, maxX - minX + padding);
      stroke.height = Math.max(30, maxY - minY + padding);
      points.forEach(p => { p.x -= cx; p.y -= cy; });
      stroke.revision++;
    }
    pointers.delete(event.pointerId);
    if (bg && bg.pinch) { bg.rect = { ...bg.info.rect }; bg.info = background() || bg.info; if (pointers.size === 1) { bg.pinch = false; bg.last = [...pointers.values()][0]; bg.rect = { ...bg.info.rect }; } }
    if (!pointers.size) {
      bg = null;
      if (!stroke && !moved && !multiTouch && event.type !== "pointercancel") {
        const id = selected(), now = performance.now();
        if (lastTap?.id === id && now-lastTap.at < 350) { editText(project.layers.find(item=>item.id===id)); lastTap=null; }
        else lastTap={id,at:now};
      }
      if (moved || multiTouch || event.type === "pointercancel") suppressClickUntil = Date.now() + 400;
      stroke = null; path = null; anchor = null; origin = null; trash.classList.remove("show", "is-over"); changed();
    }
    else resetAnchor();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.style.touchAction = "none";
  const suppressClick = event => {
    if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  canvas.addEventListener("click", suppressClick, true);
  for (const [name, callback] of [["pointerdown", down], ["pointermove", move], ["pointerup", up], ["pointercancel", up]]) canvas.addEventListener(name, callback);
  return () => {
    cancelHold(); pointers.clear();
    canvas.removeEventListener("click", suppressClick, true);
    for (const [name, callback] of [["pointerdown", down], ["pointermove", move], ["pointerup", up], ["pointercancel", up]]) canvas.removeEventListener(name, callback);
  };
}
