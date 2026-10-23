export const LAYOUTS = ["overlay", "cutout", "split", "floating", "background", "pip", "react", "freeform", "solo"];
export function defaultRemixState(mode = "remix") {
  return {
    layout: mode === "reuse" ? "solo" : "cutout", divider: 50, active: "me", cutout: mode !== "reuse",
    layers: {
      original: { x: 50, y: 50, size: 100, rotation: 0, shape: "rectangle", border: "none", crop: 1 },
      me: { x: mode === "reuse" ? 74 : 70, y: mode === "reuse" ? 75 : 70, size: mode === "reuse" ? 34 : 58, rotation: 0, shape: "rounded", border: mode === "reuse" ? "thin" : "none", crop: 1 },
      text: {x:50,y:13,size:60,rotation:0,shape:"rectangle",border:"none",crop:1},
      sticker: {x:84,y:18,size:15,rotation:0,shape:"rectangle",border:"none",crop:1}
    }, text: "", sticker: "none", effect: "none", originalVolume: .8, meVolume: .8, offset: 0
  };
}
export function applyLayout(state, value) {
  if (!LAYOUTS.includes(value)) throw new Error("Choose a remix layout.");
  state.layout = value;
  state.cutout = ["cutout", "background", "react"].includes(value);
  if (value !== "freeform") Object.assign(state.layers.original, { x: 50, y: 50, size: 100, rotation: 0, shape: "rectangle", border: "none" });
  if (["cutout", "background", "react"].includes(value)) Object.assign(state.layers.me, { border: "none", shape: "rectangle" });
  else if (value === "solo") Object.assign(state.layers.me, { x: 50, y: 50, size: 100, rotation: 0, border: "none" });
  else if (["floating", "overlay", "pip"].includes(value)) Object.assign(state.layers.me, { shape: "rounded", border: "none" });
}
export function snapLayer(layer, value) {
  if (value === "free") return;
  const normalized = { top: "top-center", left: "center-left", center: "center-center", right: "center-right", bottom: "bottom-center" }[value] || value;
  const [vertical, horizontal] = normalized.split("-");
  const pad = Math.min(45, layer.size / 2 + 3);
  layer.x = horizontal === "left" ? pad : horizontal === "right" ? 100 - pad : 50;
  layer.y = vertical === "top" ? pad : vertical === "bottom" ? 100 - pad : 50;
}
export function remixTextLines(text) {
  return String(text).split("\n").flatMap(paragraph=>{
    const chars=typeof Intl.Segmenter==="function"?[...new Intl.Segmenter(undefined,{granularity:"grapheme"}).segment(paragraph)].map(part=>part.segment):Array.from(paragraph);
    if(!chars.length)return [""];
    const lines=[];for(let i=0;i<chars.length;i+=20)lines.push(chars.slice(i,i+20).join(""));
    return lines;
  });
}
export function layerBounds(state, key, width, height) {
  if(["text","sticker"].includes(key)){
    const l=state.layers[key];if(!l)return null;
    const w=width*l.size/100;
    const h=key==="sticker"?w:w*.128*remixTextLines(state.text||"").length*l.crop;
    return {x:width*l.x/100-w/2,y:height*l.y/100-h/2,width:w,height:h};
  }
  if (state.layout === "split") {
    const edge = width * state.divider / 100;
    return key === "original" ? { x: 0, y: 0, width: edge, height } : { x: edge, y: 0, width: width - edge, height };
  }
  if (state.layout === "solo" && key === "original") return null;
  const layer = state.layers[key], w = width * layer.size / 100, h = height * layer.size / 100;
  return { x: width * layer.x / 100 - w / 2, y: height * layer.y / 100 - h / 2, width: w, height: h };
}
function drawLayer(ctx, source, layer, box, subject = false) {
  if (!box || !source || (source.tagName === "VIDEO" && source.readyState < 2)) return;
  const sw = source.videoWidth || source.width, sh = source.videoHeight || source.height;
  if (!sw || !sh) return;
  const { x, y, width: w, height: h } = box;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(layer.rotation * Math.PI / 180);
  ctx.beginPath();
  if (layer.shape === "circle") ctx.ellipse(0, 0, w / 2, w / 2, 0, 0, Math.PI * 2);
  else ctx.roundRect(-w / 2, -h / 2, w, h, layer.shape === "rectangle" ? 0 : layer.shape === "card" ? 30 : 20);
  if (layer.border !== "none") {
    ctx.strokeStyle = layer.border === "frame" ? "#ef3340" : "#ffffff";
    ctx.lineWidth = layer.border === "frame" ? 10 : 3;
    if (layer.border === "glow") { ctx.shadowColor = "#fff"; ctx.shadowBlur = 20; }
    ctx.stroke(); ctx.shadowBlur = 0;
  }
  ctx.clip();
  const scale = (subject ? Math.min(w / sw, h / sh) : Math.max(w / sw, h / sh)) * layer.crop;
  ctx.drawImage(source, -sw * scale / 2, -sh * scale / 2, sw * scale, sh * scale);
  ctx.restore();
}
export function drawRemix(canvas, state, original, me, cutout = null, time = performance.now()) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.filter = state.effect === "mono" ? "grayscale(1)" : state.effect === "warm" ? "sepia(.25) saturate(1.25)" : "none";
  const self = state.cutout && cutout && me ? cutout.frame(me, time) : me;
  for (const key of ["original", "me"]) {
    const subject = key === "me" && state.cutout;
    const layer = subject ? { ...state.layers.me, shape: "rectangle", border: "none" } : state.layers[key];
    drawLayer(ctx, key === "original" ? original : self, layer, layerBounds(state, key, canvas.width, canvas.height), subject);
  }
  ctx.filter = "none";
  if (state.text) {
    const l=state.layers.text||{x:50,y:13,size:60,rotation:0,crop:1};
    const w=canvas.width*l.size/100,font=w*.1*l.crop;
    const lines=remixTextLines(state.text);
    ctx.save();ctx.translate(canvas.width*l.x/100,canvas.height*l.y/100);ctx.rotate(l.rotation*Math.PI/180);
    ctx.font = `bold ${font}px system-ui`; ctx.textAlign = "center";ctx.textBaseline="middle"; ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#111"; ctx.lineWidth = 4;
    if(!state.editingText)lines.forEach((line,i)=>{const y=(i-(lines.length-1)/2)*font*1.28;ctx.strokeText(line,0,y,w);ctx.fillText(line,0,y,w);});
    ctx.restore();
  }
  if (state.sticker !== "none") {
    const l=state.layers.sticker||{x:84,y:18,size:15,rotation:0,crop:1};
    ctx.save();ctx.translate(canvas.width*l.x/100,canvas.height*l.y/100);ctx.rotate(l.rotation*Math.PI/180);
    ctx.font = `${canvas.width*l.size/100*l.crop}px system-ui`; ctx.textAlign = "center";ctx.textBaseline="middle";
    ctx.fillText({ star: "★", heart: "♥", sparkle: "✦" }[state.sticker] || "",0,0);ctx.restore();
  }
}
