const art = file => `${import.meta.env.BASE_URL}illustrations/${file}`;
export const oldTimeArt = {
  neighbors: { src: art("oldtime-neighbors.png"), alt: "A diverse row of Oldtime cartoon neighbors wearing colorful branded hoodies" },
  conversation: { src: art("oldtime-conversation.png"), alt: "Two Oldtime cartoon friends talking in branded hoodies" },
  celebration: { src: art("oldtime-celebration.png"), alt: "A diverse group of Oldtime cartoon friends celebrating in colorful branded hoodies" },
  community: { src: art("oldtime-community.png"), alt: "A mixed-age group of cartoon Oldtime community members in branded hoodies" },
  lineup: { src: art("oldtime-lineup.png"), alt: "Eight cartoon Oldtime members in colorful branded hoodies" }
};
export const escHtml = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function artImg(kind, cls = "hc-art", decorative = false) {
  const a = oldTimeArt[kind] || oldTimeArt.community;
  return `<img class="${cls}" src="${escHtml(a.src)}" alt="${decorative ? "" : escHtml(a.alt)}" loading="lazy">`;
}
const ILL = { insights: "Oldtime stopwatch beside a red glass graph and a feather", help: "Oldtime life buoy with a speech bubble and a feather", badge: "Oldtime Blue Badge" };
const FILES = { insights: "oldtime-insights.png", help: "oldtime-help.png", badge: "oldtime-blue-badge.png" };
export function illustration(name, cls = "hc-art") {
  if (!ILL[name]) return "";
  return `<img class="${cls}" src="${escHtml(`${import.meta.env.BASE_URL}illustrations/${FILES[name]}`)}" alt="${escHtml(ILL[name])}" loading="lazy">`;
}
