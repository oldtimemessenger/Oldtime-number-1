// 1:1 WebRTC voice and video. Prefer direct peer-to-peer media; TURN is an
// explicit fallback. Signaling is separate, and video reuses this same session.

import { api, mutate } from "../store.js";
import { iceServers, turnConfig } from "./config.js";
import { createIceRestartAnswer, createIceRestartOffer } from "./ice-recovery.js";
import { callMediaConstraints, callVideoConstraints, capCallSender } from "./media-policy.js";
import { publish, subscribe, reportCallTransport } from "./signaling.js";
import { selectedIceTransport } from "./transport.js";

const RING_MS = 45000;
const ICE_RESTART_GRACE_MS = 2500;
const ICE_RESTART_TIMEOUT_MS = 15000;
const MAX_ICE_RESTART_ATTEMPTS = 1;
let session = null;
let completedCall = null;
let unsub = null;
let onChange = () => {};
let history = () => {};
let onEnded = () => {};

export function onCallChange(fn) { onChange = fn; }
export function onCallHistory(fn) { history = fn; }
export function onCallEnded(fn) { onEnded = fn; }
export function currentCall() { return session; }

export function installSignaling() {
  if (unsub) return;
  unsub = subscribe(onSignal);
  window.addEventListener("online", () => {
    note("Network back");
    if (session?.pc && ["disconnected", "failed"].includes(session.pc.connectionState)) {
      void requestIceRestart(session.pc);
    }
  });
  window.addEventListener("offline", () => note("Network lost"));
  document.addEventListener("visibilitychange", () => {
    if (session) session.background = document.hidden;
    onChange();
  });
}

function note(text) {
  if (!session) return;
  session.detail = text;
  onChange();
}

export async function startCall(convoId, video) {
  const me = api.me();
  const c = api.db().convos.find(x => x.id === convoId);
  if (!me || !c) throw new Error("No chat");
  if (c.members.length !== 2) throw new Error("Calls are 1:1");
  const to = c.members.find(id => id !== me.id);
  if (!to || api.blocked(me.id, to)) throw new Error("Cannot call this contact");
  if (session && session.phase !== "ended") throw new Error("Already on a call");
  completedCall = null;
  session = blank(convoId, to, video, "outgoing");
  onChange();
  try {
    await api.ensureCloudChat(c);
    await attachMedia(video);
    session.pc = makePc();
    wirePc(session.pc);
    await addTracks();
    const offer = await session.pc.createOffer();
    await session.pc.setLocalDescription(offer);
    publish("invite", session.id, to, { convoId, video, offer });
    flushOutgoingIce();
    session.timer = setTimeout(() => timeout(), RING_MS);
  } catch (err) {
    session.phase = "failed";
    session.detail = err?.name === "NotAllowedError" ? "Permission denied" : (err.message || "Could not start");
    cleanupMedia();
    onChange();
  }
}

export function accept() {
  if (!session || session.phase !== "incoming") return;
  clearTimeout(session.timer);
  session.phase = "connecting";
  onChange();
  acceptAsync().catch(err => {
    session.phase = "failed";
    session.detail = err?.name === "NotAllowedError" ? "Permission denied" : (err.message || "Failed");
    publish("reject", session.id, session.peer, { reason: "failed" });
    onChange();
  });
}

async function acceptAsync() {
  await attachMedia(session.video);
  session.pc = makePc();
  wirePc(session.pc);
  await addTracks();
  await session.pc.setRemoteDescription(session.remoteOffer);
  session.pendingIce.forEach(c => session.pc.addIceCandidate(c).catch(() => {}));
  session.pendingIce = [];
  const answer = await session.pc.createAnswer();
  await session.pc.setLocalDescription(answer);
  publish("answer", session.id, session.peer, { answer });
  flushOutgoingIce();
  publish("accept", session.id, session.peer, {});
}

export function decline() {
  if (!session) return;
  publish("reject", session.id, session.peer, { reason: "declined" });
  endLocal("declined", false);
}

export function hangup() {
  if (!session) return;
  if (session.started) reportTransport("ended");
  publish("end", session.id, session.peer, {});
  endLocal("ended", true);
}

export function toggleMute() {
  if (!session) return;
  session.muted = !session.muted;
  session.localStream?.getAudioTracks().forEach(t => t.enabled = !session.muted);
  onChange();
}

export function toggleCamera() {
  if (!session) return;
  const tracks = session.localStream?.getVideoTracks().filter(track => track.readyState === "live") || [];
  if (!tracks.length) {
    if (session.video) void addVideo().catch(error => {
      if (!session) return;
      session.detail = error.message || "Camera could not be added.";
      onChange();
    });
    return;
  }
  session.cameraOn = !session.cameraOn;
  tracks.forEach(t => t.enabled = session.cameraOn);
  onChange();
}

export async function flipCamera() {
  if (!session?.video) return;
  session.facing = session.facing === "user" ? "environment" : "user";
  const active = session;
  const cam = await navigator.mediaDevices.getUserMedia({ video: callVideoConstraints(active.facing), audio: false });
  const next = cam.getVideoTracks()[0];
  if (session !== active || !active.pc) {
    next.stop();
    return;
  }
  const videoTransceiver = active.pc.getTransceivers().find(item =>
    item.receiver.track.kind === "video" && !item.stopped
  );
  if (videoTransceiver) await videoTransceiver.sender.replaceTrack(next);
  active.localStream?.getVideoTracks().forEach(t => t.stop());
  if (active.localStream) active.localStream.addTrack(next);
  active.video = true;
  active.cameraOn = true;
  onChange();
}

export async function addVideo() {
  if (!session || session.localStream?.getVideoTracks().some(track => track.readyState === "live")) return;
  const active = session;
  const cam = await navigator.mediaDevices.getUserMedia({ video: callVideoConstraints(active.facing), audio: false });
  const track = cam.getVideoTracks()[0];
  if (session !== active || !active.pc || !active.localStream) {
    track.stop();
    return;
  }
  active.localStream.addTrack(track);
  const videoTransceiver = active.pc.getTransceivers().find(item =>
    item.receiver.track.kind === "video" && !item.stopped
  );
  if (!videoTransceiver) {
    active.localStream.removeTrack(track);
    track.stop();
    throw new Error("This call cannot add video. End the call and start a video call instead.");
  }
  const sender = videoTransceiver.sender;
  await sender.replaceTrack(track);
  await capCallSender(sender, "video");
  active.video = true;
  active.cameraOn = true;
  onChange();
}

export function toggleSpeaker() {
  if (!session) return;
  session.speaker = !session.speaker;
  const el = document.querySelector("#ot-remote-audio") || document.querySelector("#ot-remote");
  if (el?.setSinkId) {
    el.setSinkId(session.speaker ? "default" : "communications").catch(() => {});
  }
  onChange();
}

export function setMinimized(v) {
  if (!session) return;
  session.minimized = v;
  onChange();
}

async function onSignal(row) {
  if (row.type === "transport-error") {
    if (session && row.callId === session.id) {
      clearTimeout(session.timer);
      clearIceRecoveryTimers(session);
      session.phase = "failed";
      session.detail = String(row.payload?.message || "Call signaling is unavailable.");
      session.pc?.close();
      session.pc = null;
      cleanupMedia();
      onChange();
    }
    return;
  }
  if (row.type === "invite") {
    if (row.payload?.retry === true) return answerIceRestart(row);
    return incoming(row);
  }
  if (!session || row.callId !== session.id) return;
  if (row.from !== session.peer) return;
  if (row.type === "ice-restart-request") {
    if (session.isInitiator) void beginIceRestart(session, session.pc);
    return;
  }
  if (row.type === "answer" && session.pc) {
    await session.pc.setRemoteDescription(row.payload.answer);
    if (session.iceRestarting) session.iceRestarting = false;
    await flushPendingIce(session);
    session.iceRestartRequested = false;
    if (!session.started) session.phase = "connecting";
  }
  if (row.type === "ice" && row.payload.candidate) {
    const cand = new RTCIceCandidate(row.payload.candidate);
    const currentUfrag = remoteIceUfrag(session.pc?.remoteDescription?.sdp);
    const candidateUfrag = iceUsernameFragment(cand);
    const belongsToCurrentDescription = !candidateUfrag || !currentUfrag || candidateUfrag === currentUfrag;
    if (session.pc?.remoteDescription && !session.iceRestarting && belongsToCurrentDescription) {
      session.pc.addIceCandidate(cand).catch(() => {});
    } else {
      session.pendingIce.push(cand);
    }
  }
  if (row.type === "ringing") session.phase = "ringing";
  if (row.type === "accept") session.phase = "connecting";
  if (row.type === "reject") endLocal(row.payload.reason === "busy" ? "busy" : "declined", false);
  if (row.type === "end") endLocal("ended", true);
  onChange();
}

function incoming(row) {
  const me = api.me();
  if (!me || row.to !== me.id) return;
  if (!api.user(row.from) || api.blocked(me.id, row.from)) return;
  if (session && session.phase !== "ended") {
    publish("reject", row.callId, row.from, { reason: "busy" });
    return;
  }
  if (!api.db().convos.some(room => room.id === row.payload.convoId)) mutate(db => {
    db.convos.push({
      id: row.payload.convoId, members: [me.id, row.from], messages: [], draft: "",
      pinnedIds: [], cloudBacked: true, disappear: "off", mutedUntil: 0, wallpaper: "", locked: false,
    });
  });
  session = blank(row.payload.convoId, row.from, !!row.payload.video, "incoming");
  session.id = row.callId;
  session.remoteOffer = row.payload.offer;
  publish("ringing", session.id, session.peer, {});
  session.timer = setTimeout(() => {
    publish("reject", session.id, session.peer, { reason: "timeout" });
    endLocal("missed", false);
  }, RING_MS);
  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    const who = api.user(row.from)?.name || "Someone";
    new Notification("Oldtime", { body: who + " is calling" });
  } else if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
  onChange();
}

function blank(convoId, peer, video, phase) {
  return {
    id: "call" + Date.now(), convoId, peer, video, phase,
    isInitiator: phase === "outgoing",
    muted: false, cameraOn: !!video, speaker: true, facing: "user",
    minimized: false, background: document.hidden, started: 0,
    detail: "", localStream: null, remoteStream: new MediaStream(),
    pc: null, pendingIce: [], outgoingIce: [], signalingReady: false, remoteOffer: null, timer: null,
    transport: "unknown", iceRestartTimer: null, iceRecoveryTimeout: null,
    iceRestartAttempts: 0, iceRestarting: false, iceRestartRequested: false
  };
}

function makePc() {
  const pc = new RTCPeerConnection(iceServers({ allowTurnFallback: true }));
  // Reserve an SDP video section for voice calls too. No camera permission or
  // video packets are used until a participant explicitly adds their camera.
  pc.addTransceiver("video", { direction: "sendrecv" });
  return pc;
}

function wirePc(pc) {
  pc.onicecandidate = (e) => {
    if (!session || session.pc !== pc || !e.candidate) return;
    if (!session.signalingReady) session.outgoingIce.push(e.candidate);
    else publish("ice", session.id, session.peer, { candidate: e.candidate });
  };
  pc.ontrack = (e) => {
    const active = session;
    if (!active || active.pc !== pc) return;
    const incomingTracks = e.streams.length
      ? e.streams.flatMap(stream => stream.getTracks())
      : [e.track];
    incomingTracks.forEach(track => {
      if (!active.remoteStream.getTracks().includes(track)) active.remoteStream.addTrack(track);
    });
    e.track.onunmute = () => {
      if (session !== active || active.pc !== pc) return;
      if (e.track.kind === "video") active.video = true;
      onChange();
    };
    onChange();
  };
  pc.onconnectionstatechange = () => {
    if (!session || session.pc !== pc) return;
    const s = pc.connectionState;
    if (s === "connected") {
      session.phase = "connected";
      session.started = session.started || Date.now();
      session.detail = "Connected";
      clearTimeout(session.timer);
      clearIceRecoveryTimers(session);
      session.iceRestartAttempts = 0;
      session.iceRestartRequested = false;
      session.iceRestarting = false;
      void updateTransport(pc);
    }
    if (s === "disconnected") {
      session.detail = "Reconnecting";
      scheduleIceRestart(pc);
    }
    if (s === "failed") void requestIceRestart(pc);
    onChange();
  };
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
      void updateTransport(pc);
    }
  };
}

function flushOutgoingIce() {
  if (!session) return;
  session.signalingReady = true;
  for (const candidate of session.outgoingIce.splice(0)) publish("ice", session.id, session.peer, { candidate });
}

function scheduleIceRestart(pc) {
  if (!session || session.pc !== pc || !session.started) return;
  clearTimeout(session.iceRestartTimer);
  session.iceRestartTimer = setTimeout(() => {
    if (session?.pc === pc && pc.connectionState === "disconnected") {
      void requestIceRestart(pc);
    }
  }, ICE_RESTART_GRACE_MS);
}

function requestIceRestart(pc) {
  const active = session;
  if (!active || active.pc !== pc || !active.started || active.phase === "ended" || active.phase === "failed") return;
  clearTimeout(active.iceRestartTimer);
  active.detail = "Reconnecting";

  if (active.isInitiator) {
    void beginIceRestart(active, pc);
  } else if (!active.iceRestartRequested && !active.iceRestarting) {
    active.iceRestartRequested = true;
    active.iceRecoveryTimeout = setTimeout(() => failDirectConnection(pc), ICE_RESTART_TIMEOUT_MS);
    try {
      publish("ice-restart-request", active.id, active.peer, {});
    } catch {
      active.iceRestartRequested = false;
      active.detail = "Reconnecting; signaling is unavailable";
    }
  }
  onChange();
}

async function beginIceRestart(active, pc) {
  if (!active || session !== active || active.pc !== pc || !active.started || active.iceRestarting) return;
  if (active.iceRestartAttempts >= MAX_ICE_RESTART_ATTEMPTS) {
    failDirectConnection(pc);
    return;
  }

  active.iceRestartAttempts += 1;
  active.iceRestarting = true;
  active.iceRestartRequested = false;
  active.pendingIce = [];
  active.detail = "Reconnecting";
  clearTimeout(active.iceRestartTimer);
  clearTimeout(active.iceRecoveryTimeout);
  active.iceRecoveryTimeout = setTimeout(() => failDirectConnection(pc), ICE_RESTART_TIMEOUT_MS);
  onChange();

  try {
    const offer = await createIceRestartOffer(pc);
    if (session !== active || active.pc !== pc) return;
    publish("invite", active.id, active.peer, {
      convoId: active.convoId,
      video: !!active.video,
      offer,
      retry: true,
    });
  } catch {
    failDirectConnection(pc);
  }
}

async function answerIceRestart(row) {
  const active = session;
  if (!active || active.id !== row.callId || active.peer !== row.from || active.isInitiator || !active.pc || !active.started || active.phase === "failed" || active.phase === "ended") return;
  active.iceRestarting = true;
  active.iceRestartRequested = false;
  active.pendingIce = [];
  active.detail = "Reconnecting";
  clearTimeout(active.iceRestartTimer);
  clearTimeout(active.iceRecoveryTimeout);
  active.iceRecoveryTimeout = setTimeout(() => failDirectConnection(active.pc), ICE_RESTART_TIMEOUT_MS);
  onChange();

  try {
    const answer = await createIceRestartAnswer(active.pc, row.payload.offer);
    active.iceRestarting = false;
    await flushPendingIce(active);
    publish("answer", active.id, active.peer, { answer });
  } catch {
    failDirectConnection(active.pc);
  }
}

async function flushPendingIce(active) {
  if (!active?.pc?.remoteDescription || !active.pendingIce.length) return;
  const currentUfrag = remoteIceUfrag(active.pc.remoteDescription.sdp);
  const pending = active.pendingIce;
  active.pendingIce = [];
  for (const candidate of pending) {
    const candidateUfrag = iceUsernameFragment(candidate);
    if (candidateUfrag && currentUfrag && candidateUfrag !== currentUfrag) {
      active.pendingIce.push(candidate);
      continue;
    }
    await active.pc.addIceCandidate(candidate).catch(() => {});
  }
}

function iceUsernameFragment(candidate) {
  if (typeof candidate?.usernameFragment === "string" && candidate.usernameFragment) return candidate.usernameFragment;
  if (typeof candidate?.candidate !== "string") return "";
  return candidate.candidate.match(/\bufrag\s+([^\s]+)/)?.[1] || "";
}

function remoteIceUfrag(sdp) {
  return typeof sdp === "string" ? sdp.match(/(?:^|\r?\n)a=ice-ufrag:([^\r\n]+)/)?.[1] || "" : "";
}

function clearIceRecoveryTimers(active) {
  clearTimeout(active?.iceRestartTimer);
  clearTimeout(active?.iceRecoveryTimeout);
  if (active) {
    active.iceRestartTimer = null;
    active.iceRecoveryTimeout = null;
  }
}

async function updateTransport(pc) {
  if (!session || session.pc !== pc || session.phase !== "connected") return;
  let selected = "unknown";
  try {
    selected = selectedIceTransport(await pc.getStats());
  } catch {}
  if (!session || session.pc !== pc || session.phase !== "connected") return;
  if (selected === "unknown") return;
  session.transport = selected;
  session.detail = selected === "relay"
    ? "Connected through a TURN relay"
    : "Connected peer-to-peer";
  onChange();
}

function reportTransport(stage, failure) {
  if (!session) return;
  const rawNetworkType = navigator.connection?.effectiveType;
  const networkType = ["slow-2g", "2g", "3g", "4g"].includes(rawNetworkType)
    ? rawNetworkType
    : "unknown";
  reportCallTransport({
    callId: session.id,
    stage,
    transport: session.transport,
    video: !!session.video,
    durationSeconds: session.started ? Math.floor((Date.now() - session.started) / 1000) : 0,
    networkType,
    ...(failure ? { failure } : {}),
  });
}

function failDirectConnection(pc) {
  if (!session || session.pc !== pc || session.phase === "failed" || session.phase === "ended") return;
  clearTimeout(session.timer);
  clearIceRecoveryTimers(session);
  session.phase = "failed";
  session.detail = turnConfig()
    ? "Direct and relay connections failed. Check your network and try again."
    : "Could not reconnect directly. This network may block peer-to-peer calls; no TURN fallback is configured.";
  reportTransport("failed", "ice-failed");
  try {
    publish("end", session.id, session.peer, { reason: "direct-connection-failed" });
  } catch {}
  pc.close();
  session.pc = null;
  cleanupMedia();
  onChange();
}

async function attachMedia(video) {
  session.localStream = await navigator.mediaDevices.getUserMedia(callMediaConstraints(video));
  session.cameraOn = !!video;
}

async function addTracks() {
  await Promise.all(session.localStream.getTracks().map(async track => {
    const sender = session.pc.addTrack(track, session.localStream);
    await capCallSender(sender, track.kind);
  }));
}

function timeout() {
  if (!session || session.phase === "connected") return;
  publish("end", session.id, session.peer, { reason: "timeout" });
  endLocal("no answer", false);
}

function endLocal(reason, log) {
  if (!session) return;
  clearTimeout(session.timer);
  const snap = session;
  session = null;
  clearIceRecoveryTimers(snap);
  snap.pc?.close();
  cleanupStream(snap.localStream);
  if (log && snap.started) {
    const sec = Math.round((Date.now() - snap.started) / 1000);
    const label = (snap.video ? "Video call" : "Voice call") + " · " + fmt(sec);
    history(snap.convoId, label);
    completedCall = {
      id: snap.id,
      convoId: snap.convoId,
      peer: snap.peer,
      video: snap.video,
      seconds: sec,
      duration: fmt(sec),
      endedAt: Date.now()
    };
    onEnded(completedCall);
  } else if (log) {
    history(snap.convoId, (snap.video ? "Video call" : "Voice call") + " · " + reason);
  }
  onChange();
}

function cleanupMedia() {
  cleanupStream(session?.localStream);
}
function cleanupStream(stream) { stream?.getTracks().forEach(t => t.stop()); }
function fmt(s) { return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

export function duration() {
  if (!session?.started) return "0:00";
  return fmt(Math.round((Date.now() - session.started) / 1000));
}
