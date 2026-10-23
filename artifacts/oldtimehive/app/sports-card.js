import { cleanPoints, privacyFilter } from "./sports-replay.js";
// Sports card: honest route geometry + canvas rendering. No external images, no fake data.
export const LAYOUTS = [
  { id: "photo", label: "Photo" },
  { id: "route", label: "Route" },
  { id: "poster", label: "Poster" },
  { id: "minimal", label: "Minimal" },
];
const TRIM_M = 250, MIN_TOTAL_M = 1000, GAP_S = 45, GAP_M = 150;

export const fmtDist = m => Number.isFinite(m) ? (m / 1000).toFixed(2) : "--";
export const fmtDur = s => {
  if (!Number.isFinite(s)) return "--";
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
};
export const fmtPace = s => Number.isFinite(s) && s > 0 && s < 5999 ? Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0") : "--";
const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
const lat = p => num(p.lat ?? p.latitude), lon = p => num(p.lon ?? p.lng ?? p.longitude);
const when = p => num(p.t ?? p.timestamp ?? p.time);
function hav(a, b) {
  const R = 6371000, r = Math.PI / 180, dLa = (lat(b) - lat(a)) * r, dLo = (lon(b) - lon(a)) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(lat(a) * r) * Math.cos(lat(b) * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
// Split actual points into continuous segments; gaps are never bridged.
function split(points) {
  const valid = (points || []).filter(p => p && lat(p) !== null && lon(p) !== null);
  const segs = []; let cur = [], total = 0;
  valid.forEach((p, i) => {
    const prev = valid[i - 1];
    if (prev) {
      const d = hav(prev, p), ta = when(prev), tb = when(p);
      if (p.breakBefore || d > GAP_M || (ta !== null && tb !== null && Math.abs(tb - ta) / (Math.abs(ta) > 1e11 || Math.abs(tb) > 1e11 ? 1000 : 1) > GAP_S)) { if (cur.length) segs.push(cur); cur = []; }
      else total += d;
    }
    cur.push({ p, cum: total });
  });
  if (cur.length) segs.push(cur);
  return { segs, total };
}
// Returns {segments:[[{x,y}]], start, end, bounds} in unit space, or {reason}.
export function routeGeometry(workout, { trim = false } = {}) {
  const { segs: rawSegs, total } = split(cleanPoints(workout?.points));
  const segs = trim ? split(privacyFilter(workout?.points)).segs : rawSegs;
  if (!rawSegs.length || rawSegs.every(s => s.length < 2)) return { reason: "No GPS route was recorded." };
  if (trim && total < MIN_TOTAL_M) return { reason: "Too short to share a route privately." };
  let use = segs.filter(s => s.length > 1);
  if (!use.length) return { reason: "Nothing left after trimming route ends." };
  const all = use.flat().map(q => q.p);
  const la0 = all.reduce((a, p) => a + lat(p), 0) / all.length, k = Math.cos(la0 * Math.PI / 180);
  const pts = use.map(s => s.map(q => ({ x: lon(q.p) * k, y: -lat(q.p) })));
  const xs = pts.flat().map(p => p.x), ys = pts.flat().map(p => p.y);
  const b = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  return { segments: pts, start: pts[0][0], end: pts[pts.length - 1].at(-1), bounds: b, trimmed: trim };
}
export function fitRoute(geo, x, y, w, h) {
  const b = geo.bounds, bw = Math.max(b.x1 - b.x0, 1e-9), bh = Math.max(b.y1 - b.y0, 1e-9);
  const s = Math.min(w / bw, h / bh), ox = x + (w - bw * s) / 2, oy = y + (h - bh * s) / 2;
  const f = p => ({ x: ox + (p.x - b.x0) * s, y: oy + (p.y - b.y0) * s });
  return { segments: geo.segments.map(sg => sg.map(f)), start: f(geo.start), end: f(geo.end) };
}
export function pathD(segments) {
  return segments.map(s => s.map((p, i) => (i ? "L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1)).join("")).join("");
}
export function statRows(workout, activity) {
  const s = workout?.summary || {}, speedy = workout?.activityType === "cycle";
  const rows = [["Distance", fmtDist(s.distanceM), "km"], ["Time", fmtDur(s.activeSeconds), ""]];
  rows.push(speedy ? ["Speed", Number.isFinite(s.speedKmh) ? s.speedKmh.toFixed(1) : "--", "km/h"] : ["Pace", fmtPace(s.paceSecondsPerKm), "/km"]);
  if (Number.isFinite(s.elevationGainM)) rows.push(["Climb", Math.round(s.elevationGainM), "m"]);
  return rows;
}
function cover(ctx, img, W, H) {
  const r = Math.max(W / img.width, H / img.height), w = img.width * r, h = img.height * r;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}
function stroke(ctx, fit, color, lw) {
  ctx.lineJoin = ctx.lineCap = "round"; ctx.strokeStyle = color; ctx.lineWidth = lw;
  fit.segments.forEach(s => { ctx.beginPath(); s.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); });
}
function marks(ctx, fit, c, bg) {
  [[fit.start, c, 1], [fit.end, "#f4212e", 1]].forEach(([p, col]) => {
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(p.x, p.y, 17, 0, 7); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, 7); ctx.fill();
  });
}
const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif';
export const CARD_W = 1080, CARD_H = 1350;
// opts: {layout, image(HTMLImageElement|null), showRoute, activityLabel, workout}
export function drawCard(canvas, opts) {
  const { layout = "poster", image = null, showRoute = false, activityLabel = "", workout, owner = null, milestones = [], trimRoute = true } = opts;
  canvas.width = CARD_W; canvas.height = CARD_H;
  if (layout === "poster") return drawPoster(canvas, { trimRoute, showRoute, activityLabel, workout, owner, milestones, image });
  const ctx = canvas.getContext("2d"), W = CARD_W, H = CARD_H, P = 80;
  const rows = statRows(workout), geo = showRoute ? routeGeometry(workout, { trim: trimRoute }) : null;
  const date = workout?.startedAt ? new Date(workout.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  const dark = layout === "poster" || (layout === "photo");
  ctx.fillStyle = layout === "poster" ? "#0f1419" : layout === "photo" ? "#161823" : "#ffffff"; ctx.fillRect(0, 0, W, H);
  if (layout === "photo" && image) { cover(ctx, image, W, H); const g = ctx.createLinearGradient(0, H * .45, 0, H); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.82)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  if (layout === "route" && image) { ctx.globalAlpha = .12; cover(ctx, image, W, H); ctx.globalAlpha = 1; }
  const ink = dark ? "#ffffff" : "#0f1419", sub = dark ? "rgba(255,255,255,.7)" : "#737373";
  ctx.textBaseline = "alphabetic"; ctx.fillStyle = sub; ctx.font = `600 34px ${FONT}`;
  ctx.fillText((activityLabel || "").toUpperCase() + (date ? "  /  " + date : ""), P, P + 30);
  ctx.fillStyle = (ACT[workout?.activityType] || ACT.run).c; ctx.fillRect(P, P + 56, 64, 6);
  const fitBox = (x, y, w, h) => { if (geo?.segments) { const f = fitRoute(geo, x, y, w, h); stroke(ctx, f, dark ? "#ffffff" : "#0f1419", 10); marks(ctx, f, dark ? "#ffffff" : "#0f1419", dark ? "#0f1419" : "#fff"); } };
  const statsRow = (y, size) => {
    const cw = (W - P * 2) / rows.length;
    rows.forEach(([l, v, u], i) => {
      const x = P + i * cw; ctx.fillStyle = sub; ctx.font = `600 28px ${FONT}`; ctx.fillText(l.toUpperCase(), x, y);
      ctx.fillStyle = ink; ctx.font = `700 ${size}px ${FONT}`; ctx.fillText(String(v), x, y + size + 6);
      const w = ctx.measureText(String(v)).width; ctx.fillStyle = sub; ctx.font = `600 26px ${FONT}`; ctx.fillText(u, x + w + 8, y + size + 6);
    });
  };
  if (layout === "photo") {
    if (geo?.segments) fitBox(W - 380, P + 100, 300, 300);
    statsRow(H - 300, 76);
  } else if (layout === "route") {
    if (geo?.segments) fitBox(P, 190, W - P * 2, 700); else { ctx.fillStyle = sub; ctx.font = `600 32px ${FONT}`; ctx.fillText("Route hidden", P, 300); }
    statsRow(H - 330, 76);
  } else if (layout === "poster") {
    ctx.fillStyle = ink; ctx.font = `800 300px ${FONT}`; ctx.fillText(fmtDist(workout?.summary?.distanceM), P - 8, 560);
    ctx.fillStyle = sub; ctx.font = `700 54px ${FONT}`; ctx.fillText("KILOMETRES", P, 640);
    if (geo?.segments) fitBox(W - 440, 700, 360, 330);
    const r2 = rows.slice(1); r2.forEach(([l, v, u], i) => { const y = 740 + i * 150; ctx.fillStyle = sub; ctx.font = `600 28px ${FONT}`; ctx.fillText(l.toUpperCase(), P, y); ctx.fillStyle = ink; ctx.font = `700 76px ${FONT}`; ctx.fillText(v + " " + u, P, y + 76); });
  } else {
    const kc = (ACT[workout?.activityType] || ACT.run).c; poly(ctx, [[0, 0], [30, 0], [30, H], [0, H]], kc); poly(ctx, [[W - 330, 0], [W, 0], [W, 230]], kc); poly(ctx, [[W - 120, H], [W, H - 90], [W, H]], "#3a4bff");
    rows.forEach(([l, v, u], i) => { const y = 260 + i * 190; ctx.fillStyle = "#e3e5e9"; ctx.fillRect(P, y - 50, W - P * 2, 2); ctx.fillStyle = sub; ctx.font = `600 30px ${FONT}`; ctx.fillText(l.toUpperCase(), P, y); ctx.fillStyle = ink; ctx.font = `700 110px ${FONT}`; ctx.fillText(v + " " + u, P, y + 110); });
    if (geo?.segments) fitBox(W - 400, 880, 300, 280);
  }
  ctx.fillStyle = sub; ctx.font = `700 30px ${FONT}`; ctx.textAlign = "right";
  ctx.fillText("OLDTIME", W - P, H - 60); ctx.textAlign = "left";
  return canvas;
}
export function cardDataUrl(canvas, type) {
  return canvas.toDataURL(type === "png" ? "image/png" : "image/jpeg", .92);
}
export async function cardBlob(canvas, type) {
  return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error("Could not export the image.")), type === "png" ? "image/png" : "image/jpeg", .92));
}

export const ACT = { run: { c: "#e630f5", k: "#0b0c0e" }, walk: { c: "#6bff8f", k: "#0b0c0e" }, cycle: { c: "#3a4bff", k: "#ffffff" }, hike: { c: "#ff7a1a", k: "#0b0c0e" } };
export const initials = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(x => x[0]?.toUpperCase() || "").join("") || "?";
export function loadAvatar(url) {
  return new Promise(res => {
    if (!url) return res(null);
    const im = new Image(); if (!/^data:|^blob:/.test(url)) im.crossOrigin = "anonymous";
    im.onload = () => res(im); im.onerror = () => res(null); im.src = url;
  });
}
function poly(ctx, pts, fill) { ctx.fillStyle = fill; ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill(); }
// Original Oldtime edition poster: route is the hero, set on a tilted paper panel between
// asymmetric sport-colour bands. Only real stats and earned milestones are drawn.
function drawPoster(canvas, { trimRoute = true, showRoute, activityLabel, workout, owner, milestones, image }) {
  const ctx = canvas.getContext("2d"), W = CARD_W, H = CARD_H, s = workout?.summary || {}, P = 76;
  const col = ACT[workout?.activityType] || ACT.run, INK = "#0f1419", PAPER = "#f3f0e8";
  const t = (txt, x, y, font, fill, al = "left", sk = 0) => { ctx.font = font; ctx.fillStyle = fill; ctx.textAlign = al; if ("letterSpacing" in ctx) ctx.letterSpacing = sk + "px"; ctx.fillText(txt, x, y); ctx.textAlign = "left"; if ("letterSpacing" in ctx) ctx.letterSpacing = "0px"; };
  const geo = showRoute ? routeGeometry(workout, { trim: trimRoute }) : null, hasRoute = !!geo?.segments;
  ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
  if (image) { ctx.globalAlpha = .26; cover(ctx, image, W, H); ctx.globalAlpha = 1; }
  // bands
  poly(ctx, [[0, 0], [W, 0], [W, 215], [0, 400]], col.c);
  poly(ctx, [[0, 1215], [W, 1105], [W, H], [0, H]], "#3a4bff" === col.c ? "#e630f5" : "#3a4bff");
  poly(ctx, [[640, H], [W, 1190], [W, H]], "#6bff8f" === col.c ? "#c8ff2e" : "#6bff8f");
  // header
  t("OLDTIME", P, 98, `800 30px ${FONT}`, col.k, "left", 7);
  const date = workout?.startedAt ? new Date(workout.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase() : "";
  t(date, W - P, 98, `700 30px ${FONT}`, col.k, "right", 5);
  t(String(activityLabel || "").toUpperCase(), P - 4, 292, `900 168px ${FONT}`, col.k, "left", -4);
  // hero panel
   ctx.save(); ctx.translate(W / 2, 630); ctx.rotate(-.018);
   ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(-470 + 14, -220 + 16, 940, 440);
   ctx.fillStyle = PAPER; ctx.fillRect(-470, -220, 940, 440);
   ctx.fillStyle = col.c; ctx.fillRect(-470, 208, 940, 12);
  ctx.restore();
  if (hasRoute) {
     const f = fitRoute(geo, 150, 460, 780, 330);
    ctx.save(); ctx.translate(11, 11); stroke(ctx, f, col.c, 24); ctx.restore();
    stroke(ctx, f, INK, 9); marks(ctx, f, INK, PAPER);
    t("START", f.start.x + 22, f.start.y - 18, `800 20px ${FONT}`, INK, "left", 3);
  } else {
    t("DISTANCE", 140, 520, `800 26px ${FONT}`, "#6a7078", "left", 6);
    const distance = fmtDist(s.distanceM);
    ctx.font = `900 280px ${FONT}`;
    const size = Math.min(280, 280 * 760 / Math.max(760, ctx.measureText(distance).width));
     t(distance, 130, 700, `900 ${size}px ${FONT}`, INK, "left", -8);
     t("KILOMETRES", 140, 810, `800 40px ${FONT}`, INK, "left", 8);
  }
  // identity
  if (owner) {
    ctx.save(); ctx.translate(W - 190, 500); ctx.rotate(.07); ctx.fillStyle = PAPER; ctx.fillRect(-98, -98, 196, 196); ctx.beginPath(); ctx.rect(-88, -88, 176, 176); ctx.clip();
    if (owner.avatarImg) cover2(ctx, owner.avatarImg, 176); else { ctx.fillStyle = col.c; ctx.fillRect(-88, -88, 176, 176); t(initials(owner.name), 0, 28, `800 72px ${FONT}`, col.k, "center"); }
    ctx.restore();
  }
  // numbers
   ctx.fillStyle = INK; ctx.fillRect(52, 886, W - 104, 354);
  const rows = statRows(workout).filter(r => r[0] !== "Distance");
  if (hasRoute) {
     const distance = fmtDist(s.distanceM); ctx.font = `900 174px ${FONT}`;
     const size = Math.min(174, 174 * 740 / Math.max(740, ctx.measureText(distance).width));
     t(distance, P - 6, 1055, `900 ${size}px ${FONT}`, "#fff", "left", -4);
    ctx.font = `900 ${size}px ${FONT}`; const w = ctx.measureText(distance).width;
     t("KM", P + w + 16, 1055, `800 36px ${FONT}`, "#ffffff", "left", 3);
  }
   const cw = (W - P * 2) / Math.max(rows.length, 1), y0 = hasRoute ? 1120 : 1010;
   rows.forEach(([l, v, u], i) => {
     const x = P + i * cw; ctx.fillStyle = "rgba(255,255,255,.28)"; ctx.fillRect(x, y0 - 28, cw - 28, 2);
     t(l.toUpperCase(), x, y0, `700 22px ${FONT}`, "#dce1e7", "left", 3);
     ctx.font = `700 26px ${FONT}`; const unitW = u ? ctx.measureText(u).width + 8 : 0;
     ctx.font = `800 62px ${FONT}`; const size = Math.min(62, 62 * (cw - 28 - unitW) / Math.max(1, ctx.measureText(String(v)).width));
     t(String(v), x, y0 + 64, `800 ${size}px ${FONT}`, "#fff");
     if (u) { const w = (ctx.font = `800 ${size}px ${FONT}`, ctx.measureText(String(v)).width); t(u, x + w + 8, y0 + 64, `700 26px ${FONT}`, "#dce1e7"); }
   });
   ctx.fillStyle = PAPER; ctx.fillRect(0, 1240, W, H - 1240);
  const earned = (milestones || []).slice(0, 2).map(m => String(m).toUpperCase().slice(0, 22));
   if (earned.length) { ctx.font = `800 22px ${FONT}`; ctx.fillStyle = INK; ctx.fillText(earned.join(" / "), P, H - 54, owner?.name ? 560 : W - P * 2); }
   if (owner?.name) { ctx.font = `800 24px ${FONT}`; ctx.fillStyle = INK; ctx.textAlign = "right"; ctx.fillText(String(owner.name).slice(0, 22).toUpperCase(), W - P, H - 54, 290); ctx.textAlign = "left"; }
  return canvas;
}
function cover2(ctx, img, size) { const r = Math.max(size / img.width, size / img.height), w = img.width * r, h = img.height * r; ctx.drawImage(img, -w / 2, -h / 2, w, h); }
