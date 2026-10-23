import { roundBox, wrapLines } from "./creative-renderer.js";

export function drawSticker(ctx, layer) {
  const kind = layer.sticker;
  const width = layer.width || 560;
  const left = -width / 2;
  const text = String(layer.text || "");
  const red = layer.color || "#e5262f";
  const finish = (w, h) => { ctx.restore(); return { width: w, height: h }; };
  const drawPill = (yy, label, index = 0) => {
    roundBox(ctx, left + 24, yy, width - 48, 66, 20);
    ctx.fillStyle = index ? "#f2f3f5" : "#fff";
    ctx.fill();
    ctx.fillStyle = "#17191d";
    ctx.font = "700 32px Manrope, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, 0, yy + 43, width - 88);
  };
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.22)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = red;
  ctx.strokeStyle = red;
  ctx.lineWidth = 18;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (kind) {
    case "heart":
      ctx.beginPath();
      ctx.moveTo(0, 110);
      ctx.bezierCurveTo(-260, -40, -150, -200, 0, -80);
      ctx.bezierCurveTo(150, -200, 260, -40, 0, 110);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.lineWidth = 12;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      return finish(390, 300);
    case "arrow":
      ctx.shadowColor = "transparent";
      ctx.lineWidth = 42;
      ctx.strokeStyle = "#fff";
      ctx.beginPath(); ctx.moveTo(-220, 0); ctx.lineTo(170, 0); ctx.moveTo(70, -110); ctx.lineTo(180, 0); ctx.lineTo(70, 110); ctx.stroke();
      ctx.lineWidth = 22;
      ctx.strokeStyle = red;
      ctx.beginPath(); ctx.moveTo(-220, 0); ctx.lineTo(170, 0); ctx.moveTo(70, -110); ctx.lineTo(180, 0); ctx.lineTo(70, 110); ctx.stroke();
      return finish(480, 260);
    case "circle":
      ctx.shadowColor = "transparent";
      ctx.beginPath(); ctx.arc(0, 0, 156, 0, Math.PI * 2);
      ctx.lineWidth = 24; ctx.stroke();
      return finish(340, 340);
    case "rectangle":
      ctx.shadowColor = "transparent";
      roundBox(ctx, -220, -110, 440, 220, 28);
      ctx.lineWidth = 24; ctx.stroke();
      return finish(470, 250);
    case "star":
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 75 : 170, a = i * Math.PI / 5 - Math.PI / 2;
        i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
      ctx.shadowColor = "transparent"; ctx.lineWidth = 10; ctx.strokeStyle = "#fff"; ctx.stroke();
      return finish(350, 350);
    case "reaction": {
      roundBox(ctx, left, -78, width, 156, 46);
      ctx.fillStyle = "#f4f1ec"; ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.beginPath(); ctx.moveTo(-10, 70); ctx.lineTo(-42, 112); ctx.lineTo(32, 75); ctx.closePath();
      ctx.fillStyle = "#f4f1ec"; ctx.fill();
      ctx.beginPath(); ctx.arc(left + 74, 0, 38, 0, Math.PI * 2); ctx.fillStyle = red; ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "700 38px Manrope, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText("♥", left + 74, 14);
      ctx.fillStyle = "#17191d"; ctx.font = "800 44px Manrope, system-ui, sans-serif"; ctx.textAlign = "left";
      ctx.fillText(text || "WOW", left + 136, 15, width - 160);
      return finish(width, 175);
    }
    case "emoji": {
      ctx.shadowColor = "rgba(0,0,0,.36)";
      ctx.shadowBlur = 18;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "128px Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif";
      ctx.fillStyle = "#fff";
      ctx.fillText(text || "❤️", 0, 0, 168);
      ctx.textBaseline = "alphabetic";
      return finish(180, 180);
    }
    case "custom-text": {
      ctx.font = "800 58px Manrope, system-ui, sans-serif";
      const lines = wrapLines(ctx, text || "Your text", width - 60).slice(0, 3);
      const height = Math.max(110, 48 + lines.length * 66);
      ctx.textAlign = "center";
      ctx.lineJoin = "round";
      lines.forEach((line, index) => {
        const y = -height / 2 + 52 + index * 66;
        ctx.strokeStyle = "rgba(17,19,22,.92)";
        ctx.lineWidth = 13;
        ctx.strokeText(line, 0, y, width - 56);
        ctx.fillStyle = "#fff";
        ctx.fillText(line, 0, y, width - 56);
      });
      return finish(width, height);
    }
    case "location":
    case "mention":
    case "hashtag":
    case "music": {
      const height = 132;
      roundBox(ctx, left, -height / 2, width, height, 32);
      ctx.fillStyle = layer.background || "#f4f1ec"; ctx.fill();
      ctx.shadowColor = "transparent";
      if (kind === "location") {
        ctx.fillStyle = red; ctx.beginPath(); ctx.arc(left + 70, -4, 30, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(left + 46, 14); ctx.lineTo(left + 70, 50); ctx.lineTo(left + 94, 14); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(left + 70, -4, 9, 0, Math.PI * 2); ctx.fill();
      } else if (kind === "mention") {
        ctx.fillStyle = red; ctx.beginPath(); ctx.arc(left + 70, 0, 38, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "800 44px Manrope, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText("@", left + 70, 15);
      } else if (kind === "hashtag") {
        ctx.fillStyle = red; ctx.font = "800 54px Manrope, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText("#", left + 70, 19);
      } else {
        ctx.fillStyle = red; ctx.beginPath(); ctx.arc(left + 70, 0, 36, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(left + 70, -16); ctx.lineTo(left + 70, 16); ctx.lineTo(left + 86, 8); ctx.stroke();
      }
      const prefix = kind === "location" ? "PLACE" : kind === "mention" ? "HANDLE" : kind === "hashtag" ? "TOPIC" : "AUDIO";
      ctx.fillStyle = "#8e9299"; ctx.font = "700 21px Manrope, system-ui, sans-serif"; ctx.textAlign = "left";
      ctx.fillText(prefix, left + 132, -16);
      ctx.fillStyle = "#17191d"; ctx.font = "800 34px Manrope, system-ui, sans-serif";
      const content = kind === "mention" ? `@${text.replace(/^@/, "")}` : kind === "hashtag" ? `#${text.replace(/^#/, "")}` : text;
      ctx.fillText(content || (kind === "music" ? "Original audio" : "Add a label"), left + 132, 28, width - 160);
      return finish(width, height);
    }
    case "question":
    case "hey-word": {
      const prompt = text || (kind === "question" ? "Ask me anything" : "Share your take");
      ctx.shadowColor = "transparent";
      roundBox(ctx, left, -142, width, 284, 28);
      ctx.fillStyle = layer.background || "#f4f1ec"; ctx.fill();
      roundBox(ctx, left, -142, width, 58, 28); ctx.fillStyle = red; ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "800 22px Manrope, system-ui, sans-serif"; ctx.textAlign = "left";
      ctx.fillText(kind === "hey-word" ? "OLDTIME · HEY WORD" : "QUESTION", left + 24, -105);
      ctx.fillStyle = "#17191d"; ctx.font = "700 36px Manrope, system-ui, sans-serif";
      const lines = wrapLines(ctx, prompt, width - 52).slice(0, 2);
      lines.forEach((line, i) => ctx.fillText(line, left + 24, -28 + i * 45, width - 48));
      drawPill(56, kind === "hey-word" ? "Share your take" : "Write a reply");
      return finish(width, 300);
    }
    case "poll": {
      const lines = wrapLines(ctx, text || "What do you think?", width - 48).slice(0, 2);
      const height = 290 + (lines.length - 1) * 42;
      ctx.shadowColor = "transparent";
      roundBox(ctx, left, -height / 2, width, height, 28);
      ctx.fillStyle = layer.background || "#f4f1ec"; ctx.fill();
      ctx.fillStyle = red; ctx.font = "800 22px Manrope, system-ui, sans-serif"; ctx.textAlign = "left";
      ctx.fillText("POLL", left + 24, -height / 2 + 38);
      ctx.fillStyle = "#17191d"; ctx.font = "700 34px Manrope, system-ui, sans-serif"; ctx.textAlign = "left";
      lines.forEach((line, i) => ctx.fillText(line, left + 24, -height / 2 + 86 + i * 40, width - 48));
      const choices = (layer.choices || ["Yes", "No"]).slice(0, 2);
      choices.forEach((choice, i) => {
        const yy = -height / 2 + 112 + lines.length * 40 + i * 74;
        roundBox(ctx, left + 20, yy, width - 40, 62, 18);
        ctx.fillStyle = "#fff"; ctx.fill();
        const count = Object.values(layer.votes || {}).filter(value => value === i).length;
        ctx.fillStyle = "#17191d"; ctx.font = "700 30px Manrope, system-ui, sans-serif"; ctx.textAlign = "center";
        ctx.fillText(`${choice}  ·  ${count}`, 0, yy + 40, width - 72);
      });
      return finish(width, height);
    }
    default: {
      const prefix = { location: "PLACE · ", mention: "@", hashtag: "#", music: "AUDIO · " }[kind] || "";
      const lines = wrapLines(ctx, prefix + text, width - 64).slice(0, 3);
      const height = 70 + lines.length * 50;
      ctx.shadowColor = "transparent";
      roundBox(ctx, left, -height / 2, width, height, 28);
      ctx.fillStyle = layer.background || "#f4f1ec"; ctx.fill();
      ctx.fillStyle = "#17191d"; ctx.textAlign = "center"; ctx.font = "700 38px Manrope, system-ui, sans-serif";
      lines.forEach((line, i) => ctx.fillText(line, 0, -height / 2 + 52 + i * 48, width - 48));
      return finish(width, height);
    }
  }
}
