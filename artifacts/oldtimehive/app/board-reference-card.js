// A reference card shares a gated link, not a private participant's media.
export async function boardReferenceCard(href) {
  const canvas = document.createElement("canvas"); canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f7f6f2"; ctx.fillRect(0, 0, 1080, 1350);
  ctx.fillStyle = "#ff2035"; ctx.fillRect(64, 76, 12, 54);
  ctx.fillStyle = "#111419"; ctx.font = "700 42px system-ui";
  ctx.fillText("OLDTIME", 98, 119);
  ctx.fillStyle = "#ece5f7"; ctx.fillRect(64, 270, 952, 666);
  ctx.fillStyle = "#13151b"; ctx.font = "800 112px system-ui";
  ctx.fillText("Get On", 110, 492); ctx.fillText("Board.", 110, 620);
  ctx.font = "500 38px system-ui"; ctx.fillText("Your turn to join in.", 110, 750);
  ctx.fillStyle = "#111419"; ctx.font = "600 28px system-ui";
  ctx.fillText("Open the original collection", 64, 1085);
  // Visible domain, full permission-gated deep link remains in the caption.
  ctx.font = "400 26px system-ui"; ctx.fillStyle = "#61666b";
  ctx.fillText(new URL(href).host, 64, 1132);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The reference card could not be created.")), "image/jpeg", .94));
}
