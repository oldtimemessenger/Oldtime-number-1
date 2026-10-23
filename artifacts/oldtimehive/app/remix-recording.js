const graphs = new WeakMap();
export function releaseRemixAudio(soundtrack) {
  const graph = graphs.get(soundtrack);
  if (graph) { void graph.audio.close().catch(() => {}); graphs.delete(soundtrack); }
}
export async function startRemixRecording({ canvas, soundtrack, self, stream, state, onDone, onError }) {
  if (!globalThis.MediaRecorder || !canvas.captureStream) throw new Error("Video recording is not supported by this browser.");
  const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Audio) throw new Error("Audio recording is not supported by this browser.");
  const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/mp4", "video/webm"]
    .find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error("This browser cannot export video. Try a current Safari or Chrome.");
  let graph = graphs.get(soundtrack);
  if (!graph) { graph = { audio: new Audio(), sources: new WeakMap() }; graphs.set(soundtrack, graph); }
  const audio = graph.audio;
  let output, recorder, timer, failed = false;
  const gains = {};
  const release = () => {
    clearTimeout(timer);
    soundtrack.pause();
    for (const track of output?.getTracks() || []) track.stop();
    for (const gain of Object.values(gains)) gain.disconnect();
    for (const node of usedSources) node.disconnect();
  };
  const usedSources = [];
  try {
    await audio.resume();
    const destination = audio.createMediaStreamDestination();
    const connect = (node, key, level) => {
      usedSources.push(node);
      const gain = audio.createGain(); gain.gain.value = level;
      node.connect(gain); gain.connect(destination); gains[key] = gain;
    };
    const mediaSource = element => {
      if (!graph.sources.has(element)) graph.sources.set(element, audio.createMediaElementSource(element));
      return graph.sources.get(element);
    };
    connect(mediaSource(soundtrack), "original", state.originalVolume);
    if (stream?.getAudioTracks().length) connect(audio.createMediaStreamSource(stream), "me", state.meVolume);
    else if (self) { self.muted = false; connect(mediaSource(self), "me", state.meVolume); }
    soundtrack.currentTime = Math.min(state.offset, Math.max(0, (soundtrack.duration || 0) - .1));
    soundtrack.loop = true;
    await soundtrack.play();
    if (self && !stream) { self.currentTime = 0; await self.play(); }
    output = canvas.captureStream(24);
    for (const track of destination.stream.getAudioTracks()) output.addTrack(track);
    const chunks = [];
    recorder = new MediaRecorder(output, { mimeType, videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 128_000 });
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { failed = true; release(); onError(new Error("Recording failed. Nothing was published.")); };
    recorder.onstop = () => {
      release();
      if (failed) return;
      const blob = new Blob(chunks, { type: recorder.mimeType });
      if (!blob.size) onError(new Error("The recording was empty. Please try again."));
      else onDone(blob);
    };
    recorder.start(250);
    timer = setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 60_000);
    return {
      cancel() { failed = true; if (recorder.state !== "inactive") recorder.stop(); },
      stop() { if (recorder.state !== "inactive") recorder.stop(); },
      levels() {
        gains.original?.gain.setValueAtTime(state.originalVolume, audio.currentTime);
        gains.me?.gain.setValueAtTime(state.meVolume, audio.currentTime);
      }
    };
  } catch (error) { release(); throw error; }
}
