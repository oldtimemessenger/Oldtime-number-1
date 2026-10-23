// Voice notes use MediaRecorder, not WebRTC. Record → preview → compress → upload → chat message.

import { api } from "../store.js";
import { icons as ic } from "../icons.js";

const cache = new Map();
let cancelRecording = null;

export function closeVoiceNote(pausePlayback = true) {
  cancelRecording?.();
  if (pausePlayback) players.forEach(p => p.audio.pause());
}
window.addEventListener("pagehide", () => closeVoiceNote());

export function formatDur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

export function openVoiceNote(ctx, convoId, pushMsg) {
  const sheet = ctx.$("#sheet");
  sheet.classList.add("on");
  const state = { rec: null, chunks: [], blob: null, url: null, peaks: [], paused: false, started: 0, elapsed: 0, timer: null, stream: null, cancelled: false, preview: null, previewPlaying: false };
  const draw = () => {
    const recording = !!state.rec;
    const reviewing = !!state.blob;
    const status = recording ? (state.paused ? "Recording paused" : "Recording") : reviewing ? "Review before sending" : "Tap record to start";
    sheet.innerHTML = `<div class="panel vn-panel" role="dialog" aria-modal="true" aria-label="Record a voice note">
      <div class="grab"></div>
      <div class="vn-head">
        <div class="vn-heading"><b>Voice message</b><span class="vn-state" id="vn-state">${status}</span></div>
        <div class="vn-time" id="vn-time">${formatDur(state.elapsed)}</div>
      </div>
      <div class="vn-wave vn-record-wave" id="vn-wave" role="img" aria-label="Voice recording waveform">${bars(state.peaks)}</div>
      <div class="vn-actions">
        <button type="button" class="vn-action discard" id="vn-cancel" aria-label="Discard voice note" title="Discard">${ic.trash}</button>
        ${!recording && !reviewing ? `<div class="vn-start">Your recording stays private until you send it.</div><button type="button" class="vn-action primary" id="vn-rec" aria-label="Start recording" title="Record">${ic.mic}</button>` : ""}
        ${recording ? `<button type="button" class="vn-action" id="${state.paused ? "vn-resume" : "vn-pause"}" aria-label="${state.paused ? "Resume recording" : "Pause recording"}" title="${state.paused ? "Resume" : "Pause"}">${state.paused ? ic.play : ic.pause}</button><button type="button" class="vn-action primary" id="vn-stop" aria-label="Finish recording" title="Finish">${ic.check}</button>` : ""}
        ${reviewing ? `<button type="button" class="vn-action" id="vn-play" aria-label="${state.previewPlaying ? "Pause preview" : "Play preview"}" title="${state.previewPlaying ? "Pause" : "Preview"}">${state.previewPlaying ? ic.pause : ic.play}</button><button type="button" class="vn-action primary" id="vn-send" aria-label="Send voice note" title="Send">${ic.send}</button>` : ""}
      </div>
      <div class="vn-error" id="vn-err" role="alert"></div>
    </div>`;
    sheet.onclick = (e) => { if (e.target === sheet) cancel(); };
    ctx.$("#vn-cancel").onclick = cancel;
    if (ctx.$("#vn-rec")) ctx.$("#vn-rec").onclick = () => record().catch(err => fail(err));
    if (ctx.$("#vn-pause")) ctx.$("#vn-pause").onclick = () => { state.rec.pause(); state.paused = true; stopTick(); draw(); };
    if (ctx.$("#vn-resume")) ctx.$("#vn-resume").onclick = () => { state.rec.resume(); state.paused = false; startTick(); draw(); };
    if (ctx.$("#vn-stop")) ctx.$("#vn-stop").onclick = () => state.rec.stop();
    if (ctx.$("#vn-play")) ctx.$("#vn-play").onclick = togglePreview;
    if (ctx.$("#vn-send")) ctx.$("#vn-send").onclick = () => { ctx.$("#vn-send").disabled = true; send().catch(err => { fail(err); if (ctx.$("#vn-send")) ctx.$("#vn-send").disabled = false; }); };
  };
  function bars(peaks) {
    const src = peaks.length ? peaks : Array(24).fill(0.15);
    return src.slice(-32).map(p => `<i style="height:${Math.max(8, Math.round(p * 36))}px"></i>`).join("");
  }
  function togglePreview() {
    if (state.preview && !state.preview.paused) {
      state.preview.pause();
      state.previewPlaying = false;
      draw();
      return;
    }
    state.preview?.pause();
    state.preview = new Audio(state.url);
    state.preview.onended = () => {
      state.previewPlaying = false;
      if (sheet.isConnected && !state.cancelled) draw();
    };
    state.preview.play().then(() => {
      state.previewPlaying = true;
      draw();
    }).catch(fail);
  }
  function fail(err) {
    const el = ctx.$("#vn-err");
    if (el) el.textContent = err?.name === "NotAllowedError" ? "Microphone permission denied" : (err?.message || "Could not record");
  }
  async function record() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Recording is not available");
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (state.cancelled || !sheet.isConnected) { state.stream.getTracks().forEach(t => t.stop()); return; }
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    state.rec = new MediaRecorder(state.stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 });
    state.chunks = [];
    state.rec.ondataavailable = (e) => { if (e.data.size) state.chunks.push(e.data); };
    state.rec.onstop = () => {
      stopTick();
      state.stream.getTracks().forEach(t => t.stop());
      if (state.cancelled || !sheet.isConnected) { state.rec = null; return; }
      state.blob = new Blob(state.chunks, { type: state.rec.mimeType || "audio/webm" });
      state.url = URL.createObjectURL(state.blob);
      state.rec = null;
      draw();
    };
    state.rec.start(200);
    state.started = Date.now();
    startTick();
    draw();
  }
  function startTick() {
    state.timer = setInterval(() => {
      state.elapsed += 0.2;
      state.peaks.push(0.25 + Math.random() * 0.75);
      const t = ctx.$("#vn-time");
      const w = ctx.$("#vn-wave");
      if (t) t.textContent = formatDur(state.elapsed);
      if (w) w.innerHTML = bars(state.peaks);
    }, 200);
  }
  function stopTick() { clearInterval(state.timer); state.timer = null; }
  function cancel() {
    state.cancelled = true;
    stopTick();
    state.preview?.pause();
    if (state.rec && state.rec.state !== "inactive") state.rec.stop();
    state.stream?.getTracks().forEach(t => t.stop());
    if (state.url) URL.revokeObjectURL(state.url);
    sheet.classList.remove("on");
    cancelRecording = null;
  }
  async function send() {
    if (!state.blob?.size) throw new Error("Record a voice note first");
    state.preview?.pause();
    const id = "m" + crypto.randomUUID();
    const media = await uploadVoice(state.blob);
    if (state.cancelled) return;
    pushMsg(convoId, { id, kind: "voice", body: "Voice message", media, duration: formatDur(state.elapsed), status: "sending", peaks: state.peaks.slice(-32), fileSize: Math.round(state.blob.size / 1024) + " KB" });
    if (state.url) URL.revokeObjectURL(state.url);
    sheet.classList.remove("on");
    ctx.render();
  }
  cancelRecording = cancel;
  draw();
}

async function uploadVoice(blob) {
  if (!api.cloudAccountId()) throw new Error("Sign in to your online account before sending a voice note.");
  const { putLocalMedia } = await import("../local-media.js");
  return putLocalMedia(blob);
}

export function voiceBody(m) {
  const peaks = (m.peaks || []).slice(-24);
  const bars = (peaks.length ? peaks : Array(16).fill(0.3)).map(p => `<i style="height:${Math.max(6, Math.round(p * 22))}px"></i>`).join("");
  return `<div class="vn-msg" data-voice="${m.id}">
    <button type="button" data-vplay="${m.id}" aria-label="Play voice message" title="Play">${ic.play}</button>
    <div class="vn-wave" data-vwave="${m.id}">${bars}</div>
    <span aria-label="Duration ${m.duration || "0:00"}">${m.duration || "0:00"}</span>
    <button type="button" data-vspeed="${m.id}">1×</button>
  </div>`;
}

const players = new Map();

export function bindVoice(root) {
  root.querySelectorAll("[data-vplay]").forEach(btn => {
    const player = players.get(btn.dataset.vplay);
    if (player) {
      btn.innerHTML = player.audio.paused ? ic.play : ic.pause;
      btn.setAttribute("aria-label", player.audio.paused ? "Play voice message" : "Pause voice message");
      player.audio.onended = () => {
        btn.innerHTML = ic.play;
        btn.setAttribute("aria-label", "Play voice message");
      };
      player.audio.ontimeupdate = () => {
        const wave = btn.parentElement.querySelector("[data-vwave]");
        if (wave && player.audio.duration) wave.style.setProperty("--p", (player.audio.currentTime / player.audio.duration * 100) + "%");
      };
    }
    btn.onclick = (e) => { e.stopPropagation(); toggle(btn.dataset.vplay, btn); };
  });
  root.querySelectorAll("[data-vspeed]").forEach(btn => {
    const player = players.get(btn.dataset.vspeed);
    if (player) btn.textContent = player.audio.playbackRate + "×";
    btn.onclick = (e) => {
      e.stopPropagation();
      const p = players.get(btn.dataset.vspeed);
      const next = !p || p.audio.playbackRate === 1 ? 1.5 : p.audio.playbackRate === 1.5 ? 2 : 1;
      if (p) p.audio.playbackRate = next;
      btn.textContent = next + "×";
      btn.dataset.rate = String(next);
    };
  });
}

function mediaOf(id) {
  if (cache.has(id)) return cache.get(id);
  const message = api.db().convos.filter(c => c.members.includes(api.me()?.id)).flatMap(c => c.messages).find(m => m.id === id);
  return message?.media || "";
}

async function toggle(id, btn) {
  let p = players.get(id);
  if (!p) {
    let src = mediaOf(id) || btn.closest("[data-voice]")?.dataset.src;
    if (src?.startsWith("oldtime-media:")) {
      btn.disabled = true;
      try {
        const { mediaUrl } = await import("../local-media.js");
        src = await mediaUrl(src);
      } catch {
        src = "";
      } finally {
        btn.disabled = false;
      }
    }
    if (!src) {
      btn.textContent = "Unavailable";
      btn.disabled = true;
      btn.setAttribute("aria-label", "Voice message unavailable");
      return;
    }
    const audio = new Audio(src);
    audio.playbackRate = Number(btn.parentElement.querySelector("[data-vspeed]")?.dataset.rate || 1);
    audio.ontimeupdate = () => {
      const wave = btn.parentElement.querySelector("[data-vwave]");
      if (wave && audio.duration) wave.style.setProperty("--p", (audio.currentTime / audio.duration * 100) + "%");
    };
    audio.onended = () => {
      btn.innerHTML = ic.play;
      btn.setAttribute("aria-label", "Play voice message");
    };
    p = { audio };
    players.set(id, p);
  }
  if (p.audio.paused) {
    p.audio.play().then(() => {
      btn.innerHTML = ic.pause;
      btn.setAttribute("aria-label", "Pause voice message");
    }).catch(() => {
      btn.textContent = "Unavailable";
      btn.setAttribute("aria-label", "Voice message unavailable");
    });
  } else {
    p.audio.pause();
    btn.innerHTML = ic.play;
    btn.setAttribute("aria-label", "Play voice message");
  }
}

export async function retryVoice(ctx, convoId, messageId) {
  const { api, mutate } = await import("../store.js");
  const m = api.db().convos.find(c => c.id === convoId)?.messages.find(x => x.id === messageId);
  if (!m) return;
  if (!api.cloudAccountId() || !String(m.media || "").startsWith("oldtime-media:")) {
    ctx.toast("This voice note is no longer available to retry. Record it again.");
    return;
  }
  mutate(db => {
    const message = db.convos.find(c => c.id === convoId)?.messages.find(x => x.id === messageId);
    if (message) message.status = "sending";
  });
  try {
    const result = await api.sendCloudChatMessage(convoId, m);
    if (result?.id !== messageId) throw new Error("The server did not confirm this voice note.");
    mutate(db => {
      const message = db.convos.find(c => c.id === convoId)?.messages.find(x => x.id === messageId);
      if (message) { message.status = "sent"; message.cloudSynced = true; }
    });
    ctx.toast("Voice note sent");
  } catch (error) {
    mutate(db => {
      const message = db.convos.find(c => c.id === convoId)?.messages.find(x => x.id === messageId);
      if (message) message.status = "failed";
    });
    ctx.toast(error?.message || "Voice note could not be sent. Try again.");
  }
  ctx.render();
}
