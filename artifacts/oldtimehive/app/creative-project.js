export const PROJECT_VERSION = 1;
export const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value)));
const uid = () => "layer-" + crypto.randomUUID();

export function createProject(source = null) {
  const project = {
    version: PROJECT_VERSION, width: 1080, height: 1920, duration: 5,
    background: { kind: "color", color: "#f2f3f5", media: "" }, layers: []
  };
  if (source) project.layers.push(createLayer("comment", { source, x: .5, y: .27 }));
  return project;
}
export function createLayer(kind, values = {}) {
  return {
    id: uid(), kind, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1,
    startTime: 0, endTime: 5, width: kind === "comment" ? 880 : 760,
    text: kind === "text" ? "Your text" : "", font: "Manrope", fontSize: 64,
    color: "#ffffff", background: "#17191d", backgroundOn: false, align: "center",
    ...values
  };
}
export function duplicateLayer(project, id) {
  const layer = project.layers.find(item => item.id === id);
  if (!layer) return null;
  const copy = structuredClone(layer);
  copy.id = uid(); copy.x = clamp(copy.x + .035, 0, 1); copy.y = clamp(copy.y + .035, 0, 1);
  project.layers.splice(project.layers.indexOf(layer) + 1, 0, copy);
  return copy;
}
export function moveLayer(project, id, direction) {
  const index = project.layers.findIndex(layer => layer.id === id);
  const next = clamp(index + direction, 0, project.layers.length - 1);
  if (index < 0 || next === index) return;
  const [layer] = project.layers.splice(index, 1); project.layers.splice(next, 0, layer);
}
export function setProjectDuration(project, duration) {
  const previous = project.duration;
  project.duration = clamp(duration, .1, 60);
  for (const layer of project.layers) {
    if (layer.endTime >= previous) layer.endTime = project.duration;
    layer.startTime = clamp(layer.startTime, 0, Math.max(0, project.duration - .1));
    layer.endTime = clamp(layer.endTime, layer.startTime + .1, project.duration);
  }
}
export function layerVisible(layer, time) {
  return !layer.hidden && time >= layer.startTime && time <= layer.endTime && layer.opacity > 0;
}
export function localPoint(layer, point, project) {
  const angle = -layer.rotation * Math.PI / 180;
  const dx = point.x - layer.x * project.width, dy = point.y - layer.y * project.height;
  return { x: (dx * Math.cos(angle) - dy * Math.sin(angle)) / layer.scale,
    y: (dx * Math.sin(angle) + dy * Math.cos(angle)) / layer.scale };
}
export function hitLayer(project, point, measurements, time = 0, includeLocked = false) {
  return [...project.layers].reverse().find(layer => {
    if (!layerVisible(layer, time) || layer.locked && !includeLocked) return false;
    const size = measurements.get(layer.id);
    if (!size) return false;
    const local = localPoint(layer, point, project);
    return Math.abs(local.x) <= size.width / 2 && Math.abs(local.y) <= size.height / 2;
  }) || null;
}
export function keepLayerInFrame(layer, size, project) {
  if (!size) return false;
  const before = [layer.x, layer.y, layer.scale].join(":");
  const angle = layer.rotation * Math.PI / 180;
  const width = Math.abs(Math.cos(angle)) * size.width + Math.abs(Math.sin(angle)) * size.height;
  const height = Math.abs(Math.sin(angle)) * size.width + Math.abs(Math.cos(angle)) * size.height;
  layer.scale = Math.min(layer.scale, (project.width - 32) / Math.max(1, width), (project.height - 32) / Math.max(1, height));
  const mx = (width * layer.scale / 2 + 16) / project.width, my = (height * layer.scale / 2 + 16) / project.height;
  layer.x = clamp(layer.x, mx, 1 - mx); layer.y = clamp(layer.y, my, 1 - my);
  return before !== [layer.x, layer.y, layer.scale].join(":");
}
export function transformGesture(layer, initial, before, after, project) {
  const center = points => ({ x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length });
  const a = center(before), b = center(after);
  const x=initial.x + (b.x - a.x) / project.width,y=initial.y + (b.y - a.y) / project.height;
  layer.x = project.allowOutside ? x : clamp(x, 0, 1);
  layer.y = project.allowOutside ? y : clamp(y, 0, 1);
  if (before.length > 1 && after.length > 1) {
    const distance = p => Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
    const angle = p => Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
    const ratio = distance(after) / Math.max(1, distance(before));
    if (layer.kind === "text" && Number.isFinite(initial.fontSize)) {
      // Resize the type inside its box, rather than scaling an already-wrapped
      // bitmap. Pinching inward can therefore reflow a phrase onto one line.
      layer.fontSize = clamp(initial.fontSize * ratio, 16, 180);
      layer.scale = initial.scale;
    } else layer.scale = clamp(initial.scale * ratio, .08, 3);
    const delta = Math.atan2(Math.sin(angle(after) - angle(before)), Math.cos(angle(after) - angle(before)));
    layer.rotation = ((initial.rotation + delta * 180 / Math.PI + 540) % 360) - 180;
  }
}
export function projectSources(project) {
  const sources = [project,...project?.pages||[]].flatMap(scene=>(scene?.layers || []).filter(layer => layer.kind === "comment" && layer.source).map(layer => layer.source));
  return [...new Map(sources.map(source=>[`${source.postId}:${source.commentId}:${source.commentAuthorId}`,source])).values()];
}
export const projectScenes = project => project?.pages?.length ? project.pages : [project];
export function serializeProject(project) {
  const copy = structuredClone(project);
  if(copy.pages?.length)Object.assign(copy,structuredClone(copy.pages[0]));
  for (const scene of [copy,...copy.pages||[]]) for (const [index, layer] of scene.layers.entries()) {
    layer.position = { x: layer.x, y: layer.y };
    layer.zIndex = index;
    delete layer.selected;
  }
  return copy;
}

export function setProjectAspect(project, ratio) {
  const formats = { "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350], "16:9": [1920, 1080] };
  if (!formats[ratio]) throw new Error("Choose a supported aspect ratio.");
  [project.width, project.height] = formats[ratio]; project.aspect = ratio;
}

export class ProjectHistory {
  constructor(project) { this.project = project; this.past = []; this.future = []; }
  record() {
    const snapshot = structuredClone(this.project);
    if (JSON.stringify(this.past.at(-1)) !== JSON.stringify(snapshot)) {
      this.past.push(snapshot); if (this.past.length > 60) this.past.shift();
    }
    this.future = [];
  }
  undo() {
    while(this.past.length&&JSON.stringify(this.past.at(-1))===JSON.stringify(this.project))this.past.pop();
    if (!this.past.length) return false;
    this.future.push(structuredClone(this.project)); this.restore(this.past.pop()); return true;
  }
  redo() {
    if (!this.future.length) return false;
    this.past.push(structuredClone(this.project)); this.restore(this.future.pop()); return true;
  }
  restore(snapshot) {
    for (const key of Object.keys(this.project)) delete this.project[key];
    Object.assign(this.project, structuredClone(snapshot));
  }
}
