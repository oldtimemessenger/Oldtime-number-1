import { layerVisible } from "./creative-project.js";
import { mediaUrl } from "./local-media.js";
import { parseGIF, decompressFrames } from "gifuct-js";
import { releaseCreativeAudio } from "./creative-export.js";
import { drawSticker } from "./creative-stickers.js";
import { mediaFilter,adjustPixels } from "./creative-video-edit.js";
import {paintStyledText,BLEND_MODES} from "./creative-text-effects.js";

const subjectTones=new WeakMap();
function toneSubject(image,background){
  const key=JSON.stringify(background.adjustments||{}),cached=subjectTones.get(image);
  if(cached?.key===key)return cached.canvas;
  const canvas=document.createElement("canvas");canvas.width=image.naturalWidth||image.width;canvas.height=image.naturalHeight||image.height;
  const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);adjustPixels(pixels.data,background);ctx.putImageData(pixels,0,0);
  subjectTones.set(image,{key,canvas});return canvas;
}

export function roundBox(ctx, x, y, width, height, radius) {
  ctx.beginPath(); ctx.roundRect(x, y, width, height, radius);
}
export function wrapLines(ctx, text, width) {
  const lines = [];
  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  for (const paragraph of String(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/(\s+)/)) {
      if (ctx.measureText(line + word).width <= width) { line += word; continue; }
      if (line.trim()) { lines.push(line.trimEnd()); line = ""; }
      if (ctx.measureText(word).width <= width) { line = word.trimStart(); continue; }
      for (const piece of segmenter ? [...segmenter.segment(word)].map(item => item.segment) : [...word]) {
        if (line && ctx.measureText(line + piece).width > width) { lines.push(line); line = ""; }
        line += piece;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
export class CreativeAssets {
  constructor() { this.items = new Map(); this.pending = new Map(); this.closed = false; }
  get(key, time = 0) {
    const item = this.items.get(key);
    if (item?.frames) {
      const at = time * 1000 % item.duration;
      return item.frames.find(frame => at < frame.end)?.canvas || item.frames.at(-1).canvas;
    }
    return item;
  }
  async load(key, kind = "image") {
    if (!key || this.closed) return null;
    if (this.items.has(key)) return this.items.get(key);
    if (this.pending.has(key)) return this.pending.get(key);
    const task = (async () => {
      const url = await mediaUrl(key);
      if (kind === "video") {
        const video = document.createElement("video");
        video.crossOrigin = "anonymous"; video.playsInline = true; video.preload = "auto"; video.muted = true;
        this.container?.append(video);
        await new Promise((resolve, reject) => {
          video.onloadeddata = resolve; video.onerror = () => reject(new Error("This video cannot be opened in this browser."));
          video.src = url; video.load();
        });
        if(!Number.isFinite(video.duration)){
          // MediaRecorder WebM often omits Duration. Seeking to the buffered end
          // lets the browser determine the real length without a video service.
          await new Promise(resolve=>{
            let timer;
            const done=()=>{
              const end=Number.isFinite(video.duration)?video.duration:video.seekable.length?video.seekable.end(video.seekable.length-1):0;
              if(end>0&&Number.isFinite(end))video.creativeDuration=end;
              clearTimeout(timer);video.removeEventListener("seeked",done);video.removeEventListener("durationchange",finite);resolve();
            };
            const finite=()=>{if(Number.isFinite(video.duration))done();};
            video.addEventListener("seeked",done,{once:true});video.addEventListener("durationchange",finite);
            timer=setTimeout(done,1800);video.currentTime=1e9;
          });
          video.currentTime=0;
        }
        if (this.closed) { video.pause(); video.removeAttribute("src"); return null; }
        this.items.set(key, video); return video;
      }
      // Decode animated GIFs into disposal-correct frames. The same frames are used in exports.
      const response = await fetch(url);
      if (!response.ok) throw new Error("Image unavailable.");
      const blob = await response.blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (new TextDecoder().decode(bytes.slice(0, 6)).startsWith("GIF")) {
        const gif = parseGIF(bytes.buffer);
        if (gif.lsd.width * gif.lsd.height > 4_000_000 || gif.frames.length > 240 ||
          gif.lsd.width * gif.lsd.height * gif.frames.length > 32_000_000) throw new Error("Use a smaller GIF (up to 240 frames).");
        const frames = decompressFrames(gif, true);
        if(!frames.length)throw new Error("This GIF does not contain an image.");
        const canvas = document.createElement("canvas");
        canvas.width = gif.lsd.width; canvas.height = gif.lsd.height;
        const ctx = canvas.getContext("2d"), output = [];
        let elapsed = 0, previous = null, restore = null;
        for (const frame of frames) {
          if (previous?.disposalType === 2) ctx.clearRect(previous.dims.left, previous.dims.top, previous.dims.width, previous.dims.height);
          if (previous?.disposalType === 3 && restore) ctx.putImageData(restore, 0, 0);
          restore = frame.disposalType === 3 ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
          const patch = document.createElement("canvas"); patch.width = frame.dims.width; patch.height = frame.dims.height;
          patch.getContext("2d").putImageData(new ImageData(frame.patch, patch.width, patch.height), 0, 0);
          ctx.drawImage(patch, frame.dims.left, frame.dims.top);
          const surface = document.createElement("canvas"); surface.width = canvas.width; surface.height = canvas.height;
          surface.getContext("2d").drawImage(canvas, 0, 0);
          elapsed += Math.max(20, frame.delay || 100); output.push({ canvas: surface, end: elapsed }); previous = frame;
        }
        const asset = { frames: output, duration: elapsed, width: canvas.width, height: canvas.height };
        this.items.set(key, asset); return asset;
      }
      const image = new Image(); image.crossOrigin = "anonymous";
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("Image unavailable.")); image.src = url; });
      if (!this.closed) this.items.set(key, image);
      return image;
    })();
    this.pending.set(key, task);
    try { return await task; } finally { this.pending.delete(key); }
  }
  dispose() {
    this.closed = true;
    for (const item of this.items.values()) if (item?.tagName === "VIDEO") { releaseCreativeAudio(item); item.pause(); item.srcObject = null; item.removeAttribute("src"); item.load();item.remove(); }
    this.items.clear();
  }
}
function cover(ctx, image, width, height, crop) {
  const w = image.videoWidth || image.naturalWidth || image.width, h = image.videoHeight || image.naturalHeight || image.height;
  if (!w || !h || image.tagName==="VIDEO"&&image.readyState<2) return;
  const sx=(crop?.x||0)*w,sy=(crop?.y||0)*h,sw=(crop?.width||1)*w,sh=(crop?.height||1)*h;
  const ratio = Math.max(width / sw, height / sh);
  ctx.drawImage(image,sx,sy,sw,sh,(width-sw*ratio)/2,(height-sh*ratio)/2,sw*ratio,sh*ratio);
}
function commentCard(ctx, layer, source, assets, time) {
  const width = layer.width || 880, padding = 42, avatarSize = 88;
  ctx.font = '500 40px Manrope, system-ui, "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  const lines = wrapLines(ctx, source.comment.body || "Photo comment", width - 2 * padding);
  const photo = source.comment.attachment?.url ? assets.get(source.comment.attachment.url, time) : null;
  const photoHeight = photo ? Math.min(400, (width - 2 * padding) * (photo.naturalHeight || photo.height) / (photo.naturalWidth || photo.width)) : 0;
  const contextHeight = source.replyTo ? 36 : 0;
  const height = padding * 2 + avatarSize + 28 + lines.length * 54 + 40 + contextHeight + (photoHeight ? photoHeight + 24 : 0);
  const x = -width / 2, y = -height / 2;
  ctx.shadowColor = "rgba(15,18,24,.16)"; ctx.shadowBlur = 28; ctx.shadowOffsetY = 10;
  roundBox(ctx, x, y, width, height, 36); ctx.fillStyle = "#fff"; ctx.fill();
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  const avatar = assets.get(source.author.avatar);
  ctx.save(); roundBox(ctx, x + padding, y + padding, avatarSize, avatarSize, avatarSize / 2); ctx.clip();
  ctx.fillStyle = "#e8eaed"; ctx.fillRect(x + padding, y + padding, avatarSize, avatarSize);
  if (avatar) {
    ctx.translate(x + padding, y + padding); cover(ctx, avatar, avatarSize, avatarSize);
  } else {
    ctx.fillStyle = "#4d525a"; ctx.font = "600 44px Manrope, sans-serif"; ctx.textAlign = "center";
    ctx.fillText((source.author.name || source.author.username || "?").slice(0, 1).toUpperCase(), x + padding + 44, y + padding + 60);
  }
  ctx.restore(); ctx.textAlign = "left"; ctx.fillStyle = "#17191d";
  ctx.font = "700 40px Manrope, system-ui, sans-serif";
  const username = "@" + (source.author.username || "member");
  const available = width - padding * 2 - avatarSize - 24;
  let short = username;
  while (ctx.measureText(short).width > available && short.length > 2) short = short.slice(0, -2) + "…";
  ctx.fillText(short, x + padding + avatarSize + 24, y + padding + 35);
  ctx.font = "500 28px Manrope, system-ui, sans-serif"; ctx.fillStyle = "#71757d";
  ctx.fillText("Comment remix", x + padding + avatarSize + 24, y + padding + 77);
  let baseline = y + padding + avatarSize + 66;
  if (source.replyTo) { ctx.font = "500 27px Manrope, sans-serif"; ctx.fillText(source.replyTo, x + padding, baseline - 12); baseline += contextHeight; }
  ctx.fillStyle = "#17191d"; ctx.font = '500 40px Manrope, system-ui, "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  for (const line of lines) { ctx.fillText(line, x + padding, baseline); baseline += 54; }
  if (photo) { ctx.save(); roundBox(ctx, x + padding, baseline + 2, width - 2 * padding, photoHeight, 20); ctx.clip(); ctx.drawImage(photo, x + padding, baseline + 2, width - 2 * padding, photoHeight); ctx.restore(); baseline += photoHeight + 24; }
  ctx.fillStyle = "#747982"; ctx.font = "500 27px Manrope, sans-serif";
  ctx.fillText(`${source.comment.likes?.length || 0} likes · View original comment`, x + padding, y + height - padding);
  return { width, height };
}
export function textStyle(layer) {
  const fonts = { Manrope: "Manrope, system-ui, sans-serif", Georgia: "Georgia, serif", monospace: "monospace", "system-ui": "system-ui, sans-serif" };
  return { font: `${layer.italic ? "italic " : ""}${layer.bold === false ? 400 : 600} ${layer.fontSize || 64}px ${fonts[layer.font] || fonts.Manrope}`,
    family: fonts[layer.font] || fonts.Manrope, lineHeight: (layer.fontSize || 64) * (layer.lineSpacing || 1.35),
    text: layer.caseStyle === "uppercase" ? layer.text.toUpperCase() : layer.caseStyle === "lowercase" ? layer.text.toLowerCase() : layer.text || "" };
}
function textLayer(ctx, layer) {
  const fonts = { Manrope: "Manrope, system-ui, sans-serif", Georgia: "Georgia, serif", monospace: "monospace", "system-ui": "system-ui, sans-serif" };
  const style = textStyle(layer); ctx.font = style.font;
  ctx.letterSpacing = `${layer.letterSpacing || 0}px`;
  const width = layer.width || 760, padding = 30, lineHeight = style.lineHeight;
  const lines = wrapLines(ctx, style.text, width - padding * 2);
  const height = lines.length * lineHeight + padding * 2;
  if (layer.backgroundOn && layer.bubble !== "none") {
    ctx.save(); ctx.globalAlpha *= layer.backgroundOpacity ?? 1;
    roundBox(ctx, -width / 2, -height / 2, width, height, layer.bubble === "pill" ? height / 2 : layer.bubble === "square" ? 0 : 25);
    ctx.fillStyle = layer.background; ctx.fill(); ctx.restore();
  }
  ctx.fillStyle = layer.color; ctx.textAlign = layer.align || "center";
  const x = layer.align === "left" ? -width / 2 + padding : layer.align === "right" ? width / 2 - padding : 0;
  if (layer.shadow) { ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 5; }
  lines.forEach((line, index) => {
    const y = -height / 2 + padding + lineHeight * (index + .8);
    if (layer.outline) { ctx.strokeStyle = "#17191d"; ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.strokeText(line,x,y); }
    paintStyledText(ctx,layer,line,x,y);
  });
  return { width, height };
}
const drawingCache = new WeakMap();
function drawingLayer(ctx, layer) {
  const resolution = Math.min(2, Math.max(1, layer.scale)), key = [layer.revision, layer.width, layer.height, resolution].join(":");
  let cached = drawingCache.get(layer);
  if (!cached || cached.key !== key) {
    const surface = cached?.surface || document.createElement("canvas"); surface.width = Math.ceil(layer.width * resolution); surface.height = Math.ceil(layer.height * resolution);
    const pen = surface.getContext("2d"); pen.scale(resolution,resolution); pen.translate(layer.width/2,layer.height/2);
    for (const stroke of layer.strokes || []) {
      const points = Array.isArray(stroke) ? stroke : stroke.points;
      pen.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over"; pen.globalAlpha = stroke.opacity ?? 1;
      pen.strokeStyle = stroke.color || layer.color; pen.lineWidth = stroke.width || layer.strokeWidth; pen.lineCap = "round"; pen.lineJoin = "round";
      pen.beginPath(); points.forEach((point,index) => index ? pen.lineTo(point.x,point.y) : pen.moveTo(point.x,point.y));
      if (points.length === 1) pen.lineTo(points[0].x+.01,points[0].y); pen.stroke();
    }
    cached = { key, surface }; drawingCache.set(layer,cached);
  }
  ctx.drawImage(cached.surface,-layer.width/2,-layer.height/2,layer.width,layer.height);
  return { width: layer.width, height: layer.height };
}
export function drawProject(canvas, project, assets, resolveComment, time = 0, selectedId = null) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.save();
  ctx.scale(canvas.width / project.width, canvas.height / project.height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = project.background.color || "#f2f3f5"; ctx.fillRect(0, 0, project.width, project.height);
  const background = assets.get(project.background.media, time);
  if(background){
    const filtered=Object.values(project.background.adjustments||{}).some(value=>value!==100),nativeFilter="filter" in ctx;
    ctx.save();if(filtered&&nativeFilter)ctx.filter=mediaFilter(project.background);
    if(project.background.mirror){ctx.translate(project.width,0);ctx.scale(-1,1);}cover(ctx,background,project.width,project.height,project.background.crop);ctx.restore();
    if(filtered&&!nativeFilter){const pixels=ctx.getImageData(0,0,project.width,project.height);adjustPixels(pixels.data,project.background);ctx.putImageData(pixels,0,0);}
  }
  const measurements = new Map();
  for (const layer of project.layers) {
    if (!layerVisible(layer, time)) continue;
    ctx.save();ctx.globalCompositeOperation=BLEND_MODES.includes(layer.blendMode)?layer.blendMode:"source-over";
    ctx.translate(layer.x * project.width, layer.y * project.height); ctx.rotate(layer.rotation * Math.PI / 180); ctx.scale(layer.scale, layer.scale); ctx.globalAlpha = layer.opacity;
    if (layer.animation && layer.animation !== "none" && selectedId !== layer.id) {
      const progress = Math.min(1, Math.max(0, (time-layer.startTime)/.35), Math.max(0,(layer.endTime-time)/.2));
      const eased = 1-Math.pow(1-progress,3);
      if (layer.animation === "fade") ctx.globalAlpha *= eased;
      if (layer.animation === "pop") ctx.scale(.6+.4*eased,.6+.4*eased);
      if (layer.animation === "slide") { ctx.translate(0,(1-eased)*90); ctx.globalAlpha *= eased; }
    }
    let size = { width: layer.width || 760, height: layer.height || 200 };
    if (layer.kind === "comment") {
      const source = resolveComment(layer.source);
      if (source) size = commentCard(ctx, layer, source, assets, time);
    } else if (layer.kind === "text") size = textLayer(ctx, layer);
    else if (layer.kind === "sticker") size = drawSticker(ctx, layer);
    else if (layer.kind === "emoji") {
      ctx.font = '180px "Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(layer.text, 0, 0); size = { width: 210, height: 210 };
    } else if (layer.kind === "image") {
      let image = assets.get(layer.media, time);
      size = { width: layer.width || 480, height: layer.height || 480 };
      if(image&&layer.subjectCutout&&Object.values(project.background.adjustments||{}).some(value=>value!==100)){
        if("filter" in ctx)ctx.filter=mediaFilter(project.background);
        else image=toneSubject(image,project.background);
      }
      if (image) ctx.drawImage(image, -size.width / 2, -size.height / 2, size.width, size.height);
    } else if (layer.kind === "drawing") {
      size = drawingLayer(ctx,layer);
    }
    measurements.set(layer.id, size);
    if (selectedId === layer.id) {
      ctx.globalCompositeOperation="source-over";
      ctx.globalAlpha = 1; ctx.strokeStyle = "#e5262f"; ctx.lineWidth = 3 / layer.scale;
      ctx.setLineDash([12 / layer.scale, 8 / layer.scale]);
      roundBox(ctx, -size.width / 2 - 8, -size.height / 2 - 8, size.width + 16, size.height + 16, 20); ctx.stroke(); ctx.setLineDash([]);
      for (const x of [-size.width / 2, size.width / 2]) for (const y of [-size.height / 2, size.height / 2]) {
        ctx.beginPath(); ctx.arc(x, y, 8 / layer.scale, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();
  }
  ctx.restore(); return measurements;
}
