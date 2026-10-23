import { io } from "socket.io-client";
import { iceServers } from "./comms/config.js";
import { cloudApiUrl } from "./api-origin.js";

const LIVE_SOCKET_PATH = "/api/live/socket.io";
const SIGNAL_TIMEOUT_MS = 12_000;

function mediaError(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "Allow camera and microphone access in your browser settings, then try again.";
  }
  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return "No camera or microphone was found on this device.";
  }
  if (error?.name === "NotReadableError" || error?.name === "TrackStartError") {
    return "Your camera or microphone is being used by another app.";
  }
  return error?.message || "Camera and microphone could not be started.";
}

function socketEndpoint() {
  const url = new URL(cloudApiUrl(LIVE_SOCKET_PATH), window.location.href);
  return { origin: url.origin, path: url.pathname };
}

export function createLiveClient(accessToken, signedInUserId) {
  if (typeof accessToken !== "string" || !accessToken) throw new Error("Sign in to open Oldtime Live.");
  if (typeof signedInUserId !== "string" || !signedInUserId) throw new Error("Your signed-in account could not be verified.");
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    throw new Error("Live video is not supported by this browser. Try a current Safari or Chrome version.");
  }

  const endpoint = socketEndpoint();
  const socket = io(endpoint.origin, {
    path: endpoint.path,
    transports: ["polling", "websocket"],
    auth: { accessToken },
    reconnection: true,
    reconnectionAttempts: 5,
    timeout: SIGNAL_TIMEOUT_MS,
  });

  const state = {
    rooms: [],
    room: null,
    localStream: null,
    remoteStreams: new Map(),
    cameraFacingMode: "user",
    status: "connecting",
    error: "",
    pendingStageInvitation: null,
  };
  const listeners = new Map();
  const peers = new Map();
  const pendingCandidates = new Map();
  let streamGeneration = 0;
  let streamRequest = null;
  let streamRequestGeneration = -1;
  let closed = false;
  let signalQueue = Promise.resolve();
  let lastSignalSentAt = 0;

  const emitLocal = (event, data) => {
    for (const listener of listeners.get(event) || []) listener(data, state);
  };
  const setError = (message) => {
    state.error = String(message || "");
    emitLocal("error", state.error);
    emitLocal("state", state);
  };
  const changed = (event = "snapshot", data = state) => {
    emitLocal(event, data);
    emitLocal("state", state);
  };
  const roomId = () => state.room?.id || null;

  function invoke(event, payload = {}) {
    if (closed) return Promise.reject(new Error("Live has closed."));
    if (!socket.connected) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.off("connect", onConnect);
          reject(new Error("Live could not connect. Check your connection and try again."));
        }, SIGNAL_TIMEOUT_MS);
        const onConnect = () => {
          clearTimeout(timer);
          invoke(event, payload).then(resolve, reject);
        };
        socket.once("connect", onConnect);
      });
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Live is taking too long to respond. Check your connection and retry.")), SIGNAL_TIMEOUT_MS);
      socket.emit(event, payload, result => {
        clearTimeout(timer);
        if (result?.ok) resolve(result.data);
        else reject(new Error(result?.error || "Live could not complete that action."));
      });
    });
  }

  function sendSignal(payload) {
    const queued = signalQueue.then(async () => {
      const wait = Math.max(0, 45 - (Date.now() - lastSignalSentAt));
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      const result = await invoke("live:signal:send", payload);
      lastSignalSentAt = Date.now();
      return result;
    });
    signalQueue = queued.catch(() => {});
    return queued;
  }

  function closePeer(userId) {
    const connection = peers.get(userId);
    if (!connection) return;
    connection.ontrack = null;
    connection.onicecandidate = null;
    connection.onconnectionstatechange = null;
    connection.close();
    peers.delete(userId);
    pendingCandidates.delete(userId);
    state.remoteStreams.delete(userId);
    changed("media");
  }

  function closePeers() {
    for (const userId of [...peers.keys()]) closePeer(userId);
  }

  function updateParticipant(participant) {
    if (!participant || !state.room?.participants) return;
    state.room = {
      ...state.room,
      participants: state.room.participants.map(item => item.id === participant.id ? participant : item),
    };
  }

  function currentUserId() {
    return signedInUserId;
  }

  function stagePeers() {
    return (state.room?.participants || [])
      .filter(participant => participant.id !== currentUserId() && (participant.role === "host" || participant.role === "guest"));
  }

  function ensurePeer(participant) {
    if (closed || !roomId() || peers.has(participant.id)) return;
    const peer = new RTCPeerConnection(iceServers({ allowTurnFallback: false }));
    peers.set(participant.id, peer);

    const publishing = !!state.localStream && (state.room?.participants || []).some(item =>
      item.id === currentUserId() && (item.role === "host" || item.role === "guest")
    );
    peer.__publishing = publishing;
    if (publishing) {
      for (const track of state.localStream.getTracks()) peer.addTrack(track, state.localStream);
    } else {
      peer.addTransceiver("audio", { direction: "recvonly" });
      peer.addTransceiver("video", { direction: "recvonly" });
    }

    peer.ontrack = event => {
      const media = event.streams?.[0] || state.remoteStreams.get(participant.id) || new MediaStream();
      if (!event.streams?.[0] && !media.getTracks().some(track => track.id === event.track.id)) media.addTrack(event.track);
      state.remoteStreams.set(participant.id, media);
      changed("media");
    };
    peer.onicecandidate = event => {
      if (!event.candidate || !roomId()) return;
      void sendSignal({
        roomId: roomId(),
        toUserId: participant.id,
        signal: { kind: "candidate", candidate: event.candidate.toJSON() },
      }).catch(error => setError(error.message));
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed") setError("A participant’s direct video connection failed. Their network may block peer-to-peer media.");
      if (peer.connectionState === "connected") changed("media");
    };

    const myId = currentUserId();
    if (myId && myId.localeCompare(participant.id) < 0) {
      void peer.createOffer()
        .then(offer => peer.setLocalDescription(offer))
        .then(() => sendSignal({
          roomId: roomId(),
          toUserId: participant.id,
          signal: { kind: "description", description: peer.localDescription.toJSON() },
        }))
        .catch(error => setError(error.message));
    }
  }

  async function syncPeers() {
    if (!state.room) return;
    const me = currentUserId();
    const localParticipant = state.room.participants?.find(participant => participant.id === me);
    if (!localParticipant) return;
    const isOnStage = localParticipant.role === "host" || localParticipant.role === "guest";
    if (!isOnStage && typeof document !== "undefined" && document.hidden) {
      closePeers();
      return;
    }
    const targetIds = new Set(stagePeers().map(participant => participant.id));

    if (!isOnStage) {
      for (const peerId of [...targetIds]) {
        if (peers.has(peerId)) continue;
      }
    } else {
      for (const participant of state.room.participants || []) {
        if (participant.id !== me && participant.role !== "invited") targetIds.add(participant.id);
      }
    }

    for (const peerId of [...peers.keys()]) {
      if (!targetIds.has(peerId)) closePeer(peerId);
    }
    const targets = (state.room.participants || []).filter(participant => targetIds.has(participant.id));
    const topologyChanged = targets.some(participant => {
      const existing = peers.get(participant.id);
      const shouldPublish = isOnStage && !!state.localStream;
      return existing && !!existing.__publishing !== shouldPublish;
    });
    if (topologyChanged) closePeers();
    for (const participant of targets) ensurePeer(participant);
  }

  async function handleSignal({ fromUserId, signal }) {
    const participant = state.room?.participants?.find(item => item.id === fromUserId);
    if (!participant || (participant.role !== "host" && participant.role !== "guest")) return;
    ensurePeer(participant);
    const peer = peers.get(fromUserId);
    if (!peer) return;
    try {
      if (signal.kind === "description") {
        await peer.setRemoteDescription(signal.description);
        for (const candidate of pendingCandidates.get(fromUserId) || []) await peer.addIceCandidate(candidate);
        pendingCandidates.delete(fromUserId);
        if (signal.description.type === "offer") {
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          await sendSignal({
            roomId: roomId(),
            toUserId: fromUserId,
            signal: { kind: "description", description: peer.localDescription.toJSON() },
          });
        }
      } else if (signal.kind === "candidate") {
        if (!peer.remoteDescription) {
          const queued = pendingCandidates.get(fromUserId) || [];
          queued.push(signal.candidate);
          pendingCandidates.set(fromUserId, queued);
        } else {
          await peer.addIceCandidate(signal.candidate);
        }
      }
    } catch (error) {
      setError(error.message || "A video connection could not be established.");
    }
  }

  function setSnapshot(snapshot) {
    if (!snapshot) return;
    state.room = { ...snapshot, currentUserId: signedInUserId };
    state.status = "in-room";
    state.error = "";
    void syncPeers();
    changed("snapshot");
  }

  function handleVisibilityChange() {
    void syncPeers();
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  socket.on("connect", () => {
    const previousRoom = state.room;
    if (previousRoom && previousRoom.host?.id !== signedInUserId) {
      state.status = "joining";
      changed("connection");
      void invoke("live:room:join", { roomId: previousRoom.id }).then(setSnapshot).catch(() => {
        state.room = null;
        state.pendingStageInvitation = null;
        state.status = "connected";
        state.error = "The room ended while your connection was interrupted. Choose another live room or start a new one.";
        changed("connection");
      });
      return;
    }
    if (previousRoom) {
      stopLocalStream();
      state.room = null;
      state.error = "Your connection dropped, so the live room ended. Start a new room when you’re ready.";
    }
    state.status = "connected";
    changed("connection");
  });
  socket.on("connect_error", error => {
    state.status = "error";
    const message = String(error?.message || "");
    setError(/xhr poll error|websocket error|transport error|timeout/i.test(message)
      ? "Live can’t connect right now. Check your connection and try again."
      : message || "Live can’t connect right now. Check your connection and try again.");
    changed("connection");
  });
  socket.on("disconnect", () => {
    if (closed) return;
    state.status = "reconnecting";
    closePeers();
    stopLocalStream();
    changed("connection");
  });
  socket.on("live:rooms:update", rooms => {
    state.rooms = Array.isArray(rooms) ? rooms : [];
    changed("rooms");
  });
  socket.on("live:room:snapshot", snapshot => setSnapshot(snapshot));
  socket.on("live:room:participant-joined", () => {
    void invoke("live:rooms:list").then(rooms => {
      state.rooms = rooms;
      changed("rooms");
    }).catch(() => {});
  });
  socket.on("live:room:participant-left", data => {
    closePeer(data?.userId);
    changed("participantLeft", data);
  });
  socket.on("live:room:ended", data => {
    closePeers();
    stopLocalStream();
    state.room = null;
    state.status = "connected";
    changed("ended", data);
  });
  socket.on("live:comment", comment => {
    if (state.room) {
      state.room = { ...state.room, comments: [...(state.room.comments || []), comment].slice(-60) };
    }
    changed("comment", comment);
  });
  socket.on("live:heart", data => changed("heart", data));
  socket.on("live:stage:request", request => {
    if (state.room) state.room = { ...state.room, requests: [...(state.room.requests || []).filter(item => item.id !== request.id), request] };
    changed("stageRequest", request);
  });
  socket.on("live:stage:decision", decision => {
    if (decision.participant?.id === currentUserId()) {
      state.pendingStageInvitation = decision.accepted ? {
        requestId: decision.requestId,
        participant: decision.participant,
      } : null;
    }
    changed("stageDecision", decision);
  });
  socket.on("live:stage:ready", participant => {
    updateParticipant(participant);
    void syncPeers();
    changed("stageReady", participant);
  });
  socket.on("live:stage:declined", participant => {
    updateParticipant(participant);
    void syncPeers();
    changed("stageDeclined", participant);
  });
  socket.on("live:stage:removed", participant => {
    updateParticipant(participant);
    if (participant.id === currentUserId()) {
      stopLocalStream();
      state.pendingStageInvitation = null;
      closePeers();
    }
    void syncPeers();
    changed("stageRemoved", participant);
  });
  socket.on("live:media:state", participant => {
    updateParticipant(participant);
    changed("mediaState", participant);
  });
  socket.on("live:signal:receive", data => void handleSignal(data));
  socket.on("live:error", data => setError(data?.message));

  function stopLocalStream() {
    streamGeneration += 1;
    streamRequest = null;
    streamRequestGeneration = -1;
    for (const track of state.localStream?.getTracks() || []) track.stop();
    state.localStream = null;
  }

  async function startLocalStream() {
    const activeTracks = state.localStream?.getTracks().filter(track => track.readyState === "live") || [];
    if (activeTracks.some(track => track.kind === "video") && activeTracks.some(track => track.kind === "audio")) return;
    if (streamRequest && streamRequestGeneration === streamGeneration) return streamRequest;
    const requestGeneration = streamGeneration;
    let mediaRequest;
    try {
      mediaRequest = navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: { facingMode: { ideal: state.cameraFacingMode }, width: { ideal: 720 }, height: { ideal: 1280 } },
      });
    } catch (error) {
      return Promise.reject(new Error(mediaError(error)));
    }
    let request;
    request = Promise.resolve(mediaRequest).then(stream => {
        if (requestGeneration !== streamGeneration || closed) {
          for (const track of stream.getTracks()) track.stop();
          return null;
        }
        for (const track of state.localStream?.getTracks() || []) track.stop();
        state.localStream = stream;
        changed("media");
        return stream;
      }, error => {
        throw new Error(mediaError(error));
      }).finally(() => {
        if (streamRequest === request) {
          streamRequest = null;
          streamRequestGeneration = -1;
        }
      });
    streamRequest = request;
    streamRequestGeneration = requestGeneration;
    return request;
  }

  async function startPreview() {
    if (state.room) throw new Error("Leave the current live before opening a camera preview.");
    state.error = "";
    state.status = "preview";
    changed("preview");
    try {
      await startLocalStream();
      if (!state.localStream?.getVideoTracks().some(track => track.readyState === "live")) {
        state.status = socket.connected ? "connected" : "reconnecting";
        changed("preview");
        return null;
      }
      state.status = "preview";
      changed("preview");
      return state.localStream;
    } catch (error) {
      state.status = socket.connected ? "connected" : "reconnecting";
      state.error = error.message || mediaError(error);
      changed("preview");
      throw error;
    }
  }

  function stopPreview() {
    if (state.room) return;
    stopLocalStream();
    state.error = "";
    state.status = socket.connected ? "connected" : "reconnecting";
    changed("preview");
  }

  function togglePreviewMic() {
    const audioTracks = state.localStream?.getAudioTracks() || [];
    if (!audioTracks.length) throw new Error("Allow microphone access to use this control.");
    const nextEnabled = !audioTracks[0].enabled;
    for (const track of audioTracks) track.enabled = nextEnabled;
    changed("media");
    return nextEnabled;
  }

  async function flipCamera() {
    const oldStream = state.localStream;
    const oldVideoTracks = oldStream?.getVideoTracks() || [];
    if (!oldVideoTracks.length) throw new Error("Start your camera preview before switching cameras.");
    const requestGeneration = streamGeneration;
    const nextFacingMode = state.cameraFacingMode === "user" ? "environment" : "user";
    let nextStream;
    try {
      nextStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: nextFacingMode },
          width: { ideal: 720 },
          height: { ideal: 1280 },
        },
      });
      const nextTrack = nextStream.getVideoTracks()[0];
      if (!nextTrack) throw new Error("No camera was available.");
      if (requestGeneration !== streamGeneration || closed || state.localStream !== oldStream) {
        for (const track of nextStream.getTracks()) track.stop();
        return null;
      }
      nextTrack.enabled = oldVideoTracks[0].enabled;
      const replacement = new MediaStream([...oldStream.getAudioTracks(), nextTrack]);
      const replacements = [];
      for (const peer of peers.values()) {
        const sender = peer.getSenders().find(item => item.track?.kind === "video");
        if (sender) replacements.push(sender.replaceTrack(nextTrack));
      }
      await Promise.allSettled(replacements);
      for (const track of oldVideoTracks) track.stop();
      state.localStream = replacement;
      state.cameraFacingMode = nextFacingMode;
      changed("media");
      return nextFacingMode;
    } catch (error) {
      for (const track of nextStream?.getTracks() || []) track.stop();
      throw new Error(mediaError(error));
    }
  }

  function on(event, listener) {
    const handlers = listeners.get(event) || new Set();
    handlers.add(listener);
    listeners.set(event, handlers);
    return () => {
      handlers.delete(listener);
      if (!handlers.size) listeners.delete(event);
    };
  }

  async function listRooms() {
    state.error = "";
    state.status = socket.connected ? "loading" : "connecting";
    changed("rooms");
    try {
      state.rooms = await invoke("live:rooms:list");
      state.status = "connected";
      changed("rooms");
      return state.rooms;
    } catch (error) {
      state.status = socket.connected ? "connected" : "error";
      throw error;
    }
  }

  async function startRoom(title) {
    if (state.room) throw new Error("Leave your current live before starting another.");
    state.status = "starting";
    state.error = "";
    changed("connection");
    try {
      await startLocalStream();
      const snapshot = await invoke("live:room:create", { title });
      setSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      stopLocalStream();
      state.status = "connected";
      changed("connection");
      throw error;
    }
  }

  async function joinRoom(id) {
    if (state.room) throw new Error("Leave your current live before joining another.");
    state.status = "joining";
    state.error = "";
    changed("connection");
    try {
      const snapshot = await invoke("live:room:join", { roomId: id });
      setSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      state.status = "connected";
      changed("connection");
      throw error;
    }
  }

  async function leaveRoom() {
    const id = roomId();
    if (!id) return;
    try { await invoke("live:room:leave", { roomId: id }); }
    finally {
      closePeers();
      stopLocalStream();
      state.room = null;
      state.pendingStageInvitation = null;
      state.status = socket.connected ? "connected" : "reconnecting";
      changed("snapshot");
    }
  }

  async function endRoom() {
    const id = roomId();
    if (!id) return;
    try { await invoke("live:room:end", { roomId: id }); }
    finally {
      closePeers();
      stopLocalStream();
      state.room = null;
      state.pendingStageInvitation = null;
      state.status = socket.connected ? "connected" : "reconnecting";
      changed("snapshot");
    }
  }

  async function sendComment(body) {
    return invoke("live:comment:send", { roomId: roomId(), body });
  }
  async function sendHeart() {
    return invoke("live:heart:send", { roomId: roomId() });
  }
  async function requestStage() {
    return invoke("live:stage:request", { roomId: roomId() });
  }
  async function decideStage(requestId, accept) {
    return invoke("live:stage:decision", { roomId: roomId(), requestId, accept });
  }
  async function joinStage() {
    if (!state.pendingStageInvitation) throw new Error("There is no stage invitation to accept.");
    await startLocalStream();
    try {
      const participant = await invoke("live:stage:ready", { roomId: roomId() });
      state.pendingStageInvitation = null;
      if (state.room) {
        state.room = {
          ...state.room,
          participants: state.room.participants.map(item => item.id === participant.id ? participant : item),
        };
      }
      await syncPeers();
      changed("snapshot");
      return participant;
    } catch (error) {
      stopLocalStream();
      throw error;
    }
  }
  async function declineStage() {
    const result = await invoke("live:stage:decline", { roomId: roomId() });
    state.pendingStageInvitation = null;
    changed("snapshot");
    return result;
  }
  async function removeStage(userId) {
    return invoke("live:stage:remove", { roomId: roomId(), userId });
  }
  async function toggleMic() {
    const audio = state.localStream?.getAudioTracks() || [];
    if (!audio.length) throw new Error("Join the stage before changing microphone access.");
    const nextMuted = audio[0].enabled;
    for (const track of audio) track.enabled = !nextMuted;
    const participant = await invoke("live:media:update", { roomId: roomId(), muted: nextMuted });
    changed("media");
    return participant;
  }
  async function toggleCamera() {
    const video = state.localStream?.getVideoTracks() || [];
    if (!video.length) throw new Error("Join the stage before changing camera access.");
    const nextCameraOn = !video[0].enabled;
    for (const track of video) track.enabled = nextCameraOn;
    const participant = await invoke("live:media:update", { roomId: roomId(), cameraOn: nextCameraOn });
    changed("media");
    return participant;
  }
  async function share() {
    const url = new URL(window.location.href);
    url.searchParams.set("openLive", "1");
    if (state.room?.id) url.searchParams.set("liveRoom", state.room.id);
    if (navigator.share) {
      await navigator.share({ title: state.room?.title || "Oldtime Live", url: url.href });
      return "shared";
    }
    await navigator.clipboard.writeText(url.href);
    return "copied";
  }

  function close() {
    if (closed) return;
    closed = true;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
    closePeers();
    stopLocalStream();
    socket.removeAllListeners();
    socket.disconnect();
    listeners.clear();
    state.room = null;
    state.rooms = [];
    state.status = "closed";
  }

  return {
    on,
    getState: () => state,
    listRooms,
    startPreview,
    stopPreview,
    togglePreviewMic,
    flipCamera,
    startRoom,
    joinRoom,
    leaveRoom,
    endRoom,
    sendComment,
    sendHeart,
    requestStage,
    decideStage,
    joinStage,
    declineStage,
    removeStage,
    toggleMic,
    toggleCamera,
    share,
    close,
  };
}
