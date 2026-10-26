import {videoPoint} from "./creative-video-edit.js";

const graphs = new WeakMap();
export function releaseCreativeAudio(video) {
  const graph = graphs.get(video);
  if (graph) {
    try { graph.source.disconnect(); } catch {}
    void graph.context.close().catch(() => {});
    graphs.delete(video);
  }
}
export function videoMime() {
  if (!globalThis.MediaRecorder) throw new Error("Video recording is unavailable in this browser.");
  const type = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm", "video/mp4"]
    .find(value => MediaRecorder.isTypeSupported(value));
  if (!type) throw new Error("Video export is unavailable in this browser.");
  return type;
}
export function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Couldn’t render the image.")), "image/png"); }
    catch { reject(new Error("This media cannot be exported. Upload an original file instead.")); }
  });
}
function waitForAudio(audio) {
  if (audio.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timeout;
    const cleanup = () => {
      clearTimeout(timeout);
      audio.removeEventListener("canplay", ready);
      audio.removeEventListener("error", failed);
    };
    const fail = () => { cleanup(); reject(new Error("The selected sound could not be loaded.")); };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => fail();
    audio.addEventListener("canplay", ready, { once: true });
    audio.addEventListener("error", failed, { once: true });
    timeout = setTimeout(fail, 10000);
    audio.load();
  });
}
export async function exportCreativeVideo({ canvas, video, background = {}, duration, render, alive, audioTracks = [] }) {
  const mimeType = videoMime();
  let audioContext, output, recorder, timer, source, destination, ownsAudioContext = false;
  const connected = [];
  const audioConnections = [], audioElements = [];
  const tracksToMix = audioTracks.filter(track => track?.media);
  const oldTime = video?.currentTime || 0;
  const oldMuted = video?.muted,oldSpeed=video?.playbackRate||1;
  const seekVideo=target=>new Promise((resolve,reject)=>{
    if(Math.abs(video.currentTime-target)<.02&&!video.seeking&&video.readyState>=2){resolve();return;}
    let timer;
    const cleanup=()=>{clearTimeout(timer);video.removeEventListener("seeked",done);video.removeEventListener("error",failed);};
    const done=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(new Error("Couldn’t seek this video. Your edit is still here."));};
    video.addEventListener("seeked",done,{once:true});video.addEventListener("error",failed,{once:true});timer=setTimeout(failed,8000);video.currentTime=target;
  });
  try {
    // Also protect older projects with odd-sized custom crops.
    canvas.width+=canvas.width%2;canvas.height+=canvas.height%2;
    output = canvas.captureStream(30);
    const frame=()=>output.getVideoTracks()[0]?.requestFrame?.();
    const existingGraph = video ? graphs.get(video) : null;
    if (existingGraph) {
      audioContext = existingGraph.context;
    } else if (video || tracksToMix.length) {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) throw new Error("Sound export is unavailable in this browser.");
      audioContext = new AudioContextConstructor();
      ownsAudioContext = !video;
    }
    if (audioContext) {
      if (audioContext.state === "suspended") await audioContext.resume();
      if (audioContext.state !== "running") throw new Error("Allow audio playback in your browser, then try again.");
      destination = audioContext.createMediaStreamDestination();
      if (video) {
        let graph = existingGraph;
        if (!graph) {
          source = audioContext.createMediaElementSource(video);
          source.connect(audioContext.destination);
          graph = { context: audioContext, source };
          graphs.set(video, graph);
        } else source = graph.source;
        source.connect(destination); connected.push(source);
      }
      for (const track of tracksToMix) {
        const audio = document.createElement("audio");
        audio.crossOrigin = "anonymous";
        audio.preload = "auto";
        audio.loop = track.loop !== false;
        audio.src = track.media;
        await waitForAudio(audio);
        const input = audioContext.createMediaElementSource(audio);
        const gain = audioContext.createGain();
        gain.gain.value = Math.max(0, Math.min(1, Number.isFinite(Number(track.volume)) ? Number(track.volume) : .8));
        input.connect(gain);
        gain.connect(destination);
        audioConnections.push([input, gain], [gain, destination]);
        audioElements.push({ audio, track });
      }
      for (const track of destination.stream.getAudioTracks()) output.addTrack(track);
      if (video) {
        const point=videoPoint(background,0);await seekVideo(point.sourceTime);video.playbackRate=point.speed;
        video.muted = false;render(0);frame();await video.play();
      }
    }
    render(0);output.getVideoTracks()[0]?.requestFrame?.();
    const blob = await new Promise((resolve, reject) => {
      const chunks = [];
      recorder = new MediaRecorder(output, { mimeType, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 });
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error("Video export failed. Your edit is still available."));
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
      const start = performance.now();let pausedTime=0,lastClip=video?videoPoint(background,0).id:null,updating=false;
      recorder.start(200);
      for (const item of audioElements) {
        item.audio.currentTime = Math.max(0, Number(item.track.offset) || 0);
        item.audio.play().catch(() => reject(new Error("The selected sound could not start during export.")));
      }
      output.getVideoTracks()[0]?.requestFrame?.();
      timer = setInterval(async () => {
        if(updating)return;updating=true;
        try{
        if (!alive()) { clearInterval(timer); if (recorder.state !== "inactive") recorder.stop(); reject(new Error("Export canceled.")); return; }
        const time = Math.min(duration, (performance.now() - start-pausedTime) / 1000);
        if(video&&background.videoEdit){
          const point=videoPoint(background,time);
          if(point.id!==lastClip){
            const pauseStart=performance.now();recorder.pause();video.pause();await seekVideo(point.sourceTime);video.playbackRate=point.speed;
            for (const item of audioElements) item.audio.pause();
            render(time);await video.play();
            for (const item of audioElements) {
              const length=item.audio.duration,offset=Number(item.track.offset)||0;
              if(Number.isFinite(length)&&length>0)item.audio.currentTime=item.track.loop===false
                ? Math.min(time+offset,Math.max(0,length-.05))
                : (time+offset)%length;
              await item.audio.play();
            }
            pausedTime+=performance.now()-pauseStart;lastClip=point.id;recorder.resume();
          }
        }
        render(time);output.getVideoTracks()[0]?.requestFrame?.();
        if (time >= duration) { clearInterval(timer); recorder.stop(); }
        }catch(failure){clearInterval(timer);if(recorder.state!=="inactive")recorder.stop();reject(failure);}
        finally{updating=false;}
      }, 1000 / 30);
    });
    if (!blob.size) throw new Error("The export was empty.");
    return blob;
  } finally {
    clearInterval(timer);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    for (const track of output?.getTracks() || []) track.stop();
    for (const node of new Set(connected)) {
      try { node.disconnect(destination); } catch {}
    }
    for (const [node, target] of audioConnections) {
      try { node.disconnect(target); } catch {}
    }
    for (const item of audioElements) {
      item.audio.pause();
      item.audio.removeAttribute("src");
      item.audio.load();
    }
    if (video) { video.pause(); video.muted = oldMuted;video.playbackRate=oldSpeed; video.currentTime = oldTime; }
    if (ownsAudioContext) await audioContext?.close().catch(() => {});
  }
}
