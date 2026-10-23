// Original Oldtime quote treatments. Each is a complete background + type pairing
// whose contrast is verified by tests. Applying one never touches the user's words.
export const QUOTE_STYLES = [
  { id: "ink", label: "Ink", background: "#f3ecdf", color: "#1b1712", font: "Georgia" },
  { id: "midnight-gold", label: "Gold", background: "#14120f", color: "#e8c46a", font: "Georgia" },
  { id: "oxblood", label: "Oxblood", background: "#4a0f16", color: "#f6e9dc", font: "Georgia" },
  { id: "graphite", label: "Graphite", background: "#1c1d21", color: "#f4f1ec", font: "Manrope" },
  { id: "ivory-red", label: "Ivory", background: "#efe6d6", color: "#7d1220", font: "Georgia" },
  { id: "bronze", label: "Bronze", background: "#24190f", color: "#f2d9a0", font: "system-ui" }
];
const channel = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
export function luminance(hex) {
  const n = parseInt(String(hex).replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return .2126 * channel(n >> 16 & 255) + .7152 * channel(n >> 8 & 255) + .0722 * channel(n & 255);
}
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + .05) / (lo + .05);
}
export function quoteStyle(id) {
  const style = QUOTE_STYLES.find(item => item.id === id);
  if (!style) throw new Error("Choose a quote style.");
  return style;
}
// Changes only look: background color (when no photo/video is behind) and type fields.
export function applyQuoteStyle(project, layer, id) {
  const style = quoteStyle(id);
  if (!project.background.media) project.background = { ...project.background, kind: "color", color: style.background };
  if (layer?.kind === "text" && !layer.locked) {
    Object.assign(layer, { color: style.color, font: style.font, backgroundOn: false, shadow: false, textEffect: { name: "plain", amount: .6, color: style.color }, quoteStyle: id });
  }
  return style;
}
// One-tap legibility over photos: dark translucent plate, light text, soft shadow.
export function applyReadableType(layer) {
  if (layer?.kind !== "text" || layer.locked) return false;
  Object.assign(layer, { color: "#ffffff", backgroundOn: true, background: "#0d0e11", backgroundOpacity: .62, bubble: "rounded", shadow: true });
  return true;
}
