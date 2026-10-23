// A share opens the original permission-checked tournament, never a copied result.
export function tournamentLink(value, base = globalThis.location?.href) {
  if (!base) return null;
  for (const candidate of String(value || "").match(/https?:\/\/[^\s<>"']+/g) || []) {
    try {
      const url = new URL(candidate.replace(/[),.!]+$/, "")), current = new URL(base);
      const id = url.searchParams.get("tournament");
      if (url.origin !== current.origin || url.pathname !== current.pathname ||
        !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id || "")) continue;
      current.search = ""; current.hash = ""; current.searchParams.set("tournament", id);
      return current.href;
    } catch { /* Not a tournament URL. */ }
  }
  return null;
}
export function tournamentLinkMarkup(text, escape) {
  const href = tournamentLink(text);
  return href ? `<a class="btn" href="${escape(href)}">Open tournament</a>` : "";
}
export async function tournamentReferenceCard() {
  const canvas = document.createElement("canvas"); canvas.width = 1080; canvas.height = 1350;
  const c = canvas.getContext("2d");
  if (!c) throw new Error("The share card could not be prepared.");
  c.fillStyle = "#0d0b10"; c.fillRect(0, 0, 1080, 1350);
  const light = c.createRadialGradient(930, 420, 0, 700, 480, 780);
  light.addColorStop(0, "#6f1429"); light.addColorStop(1, "#0d0b10");
  c.fillStyle = light; c.fillRect(0, 0, 1080, 1350);
  c.strokeStyle = "#45242e"; c.lineWidth = 3;
  for (let x = -800; x < 1900; x += 140) { c.beginPath(); c.moveTo(800, 500); c.lineTo(x, 1350); c.stroke(); }
  c.fillStyle = "#f52b47"; c.fillRect(76, 100, 10, 48);
  c.fillStyle = "#fff"; c.font = "800 34px system-ui"; c.fillText("OLDTIME / TOURNAMENTS", 110, 136);
  c.font = "900 108px system-ui"; c.fillText("Make your", 76, 498); c.fillText("next move.", 76, 624);
  c.fillStyle = "#c8bdc5"; c.font = "500 38px system-ui"; c.fillText("Friends. Teams. A new challenge.", 76, 744);
  c.fillStyle = "#f52b47"; c.fillRect(76, 1000, 928, 100);
  c.fillStyle = "#fff"; c.font = "700 38px system-ui"; c.fillText("Open the tournament to join", 126, 1064);
  c.fillStyle = "#c8bdc5"; c.font = "400 27px system-ui"; c.fillText("Invitations and access rules still apply.", 76, 1180);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The share card could not be prepared.")), "image/jpeg", .9));
}
