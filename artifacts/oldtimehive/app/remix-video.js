export function waitForVideoFrame(video, timeout=15000) {
  if(video.readyState>=2&&video.videoWidth>0&&video.videoHeight>0)return Promise.resolve(video);
  return new Promise((resolve,reject)=>{
    const events=["loadeddata","canplay","resize","playing"];
    let timer;
    const cleanup=()=>{clearTimeout(timer);events.forEach(name=>video.removeEventListener(name,check));video.removeEventListener("error",failed);};
    const check=()=>{if(video.readyState>=2&&video.videoWidth>0&&video.videoHeight>0){cleanup();resolve(video);}};
    const failed=()=>{cleanup();reject(new Error("This video couldn’t start. Try Camera again or upload a playable video."));};
    events.forEach(name=>video.addEventListener(name,check));
    video.addEventListener("error",failed);
    timer=setTimeout(failed,timeout);
    check();
  });
}
