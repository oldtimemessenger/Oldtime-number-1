import {videoPoint} from "./creative-video-edit.js";

const graphs = new WeakMap();
export function releaseCreativeAudio(video) {
  const graph = graphs.get(video);
  if (graph) { void graph.context.close().catch(() => {}); graphs.delete(video); }
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
export async function exportCreativeVideo({ canvas, video, background={}, duration, render, alive }) {
  const mimeType = videoMime();
  let audioContext, output, recorder, timer, source, destination;
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
    if (video) {
      let graph = graphs.get(video);
      if (!graph) {
        const context = new (window.AudioContext || window.webkitAudioContext)();
        graph = { context, source: context.createMediaElementSource(video) }; graph.source.connect(context.destination); graphs.set(video, graph);
      }
      audioContext = graph.context;
      await audioContext.resume();
      destination = audioContext.createMediaStreamDestination();
      source = graph.source; source.connect(destination);
      for (const track of destination.stream.getAudioTracks()) output.addTrack(track);
      const point=videoPoint(background,0);await seekVideo(point.sourceTime);video.playbackRate=point.speed;
      video.muted = false;render(0);frame();await video.play();
    }
    const blob = await new Promise((resolve, reject) => {
      const chunks = [];
      recorder = new MediaRecorder(output, { mimeType, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 });
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error("Video export failed. Your edit is still available."));
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
      const start = performance.now();let pausedTime=0,lastClip=videoPoint(background,0).id,updating=false;
      recorder.start(200);
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
            render(time);await video.play();pausedTime+=performance.now()-pauseStart;lastClip=point.id;recorder.resume();
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
    if(source&&destination)source.disconnect(destination);
    if (video) { video.pause(); video.muted = oldMuted;video.playbackRate=oldSpeed; video.currentTime = oldTime; }
  }
}
