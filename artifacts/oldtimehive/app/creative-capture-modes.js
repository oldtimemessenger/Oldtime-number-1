export const CAPTURE_MODES=["photo","video","story","carousel"];
export function captureChoice(mode){
  if(!CAPTURE_MODES.includes(mode))throw new Error("Unknown capture mode.");
  return {capture:mode==="video"?"video":"photo",destination:mode==="story"?"story":"post"};
}
export function bindCaptureModes({root,editor,q,project,assets,rememberBlob,changed,canEdit,alive,finishCarousel,error}){
  const picker=q("capture-picker"),shots=[];
  const postDestination=q("destination").value==="community"?"community":"post";
  let mode=q("destination").value==="story"?"story":"photo",timer,wasVisible=false;
  const center=()=>{
    const button=picker.querySelector(`[data-ce-capture-mode="${mode}"]`);
    if(button)picker.scrollTo({left:button.offsetLeft-(picker.clientWidth-button.offsetWidth)/2,behavior:"instant"});
  };
  const refresh=()=>{
    const visible=editor.classList.contains("is-basic")&&editor.classList.contains("is-camera-open");
    if(visible&&!wasVisible)requestAnimationFrame(center);wasVisible=visible;
    editor.dataset.captureMode=mode;
    editor.dataset.carouselCount=shots.length;
    picker.querySelectorAll("button").forEach(button=>{
      button.setAttribute("aria-selected",String(button.dataset.ceCaptureMode===mode));
      button.disabled=!canEdit();
    });
    q("carousel-tray").hidden=mode!=="carousel"||!shots.length;
    q("carousel-next").disabled=!canEdit()||shots.length<2;
    q("carousel-next").textContent=`Next (${shots.length}/10)`;
  };
  const select=value=>{
    if(!canEdit()||!CAPTURE_MODES.includes(value)){center();return;}
    mode=value;
    const choice=captureChoice(mode);q("destination").value=choice.destination==="story"?"story":postDestination;
    q(choice.capture==="video"?"record":"photo").click();
    refresh();changed();center();
  };
  picker.querySelectorAll("[data-ce-capture-mode]").forEach(button=>button.onclick=()=>select(button.dataset.ceCaptureMode));
  picker.addEventListener("scroll",()=>{
    clearTimeout(timer);timer=setTimeout(()=>{
      if(!alive()||!canEdit())return;
      const middle=picker.scrollLeft+picker.clientWidth/2;
      const nearest=[...picker.querySelectorAll("button")].reduce((best,button)=>Math.abs(button.offsetLeft+button.offsetWidth/2-middle)<Math.abs(best.offsetLeft+best.offsetWidth/2-middle)?button:best);
      if(nearest.dataset.ceCaptureMode!==mode)select(nearest.dataset.ceCaptureMode);
    },180);
  });
  // Gallery access is owned by createCameraStrip. The former camera-gallery
  // element no longer exists; binding it here aborted the whole editor setup.
  const thumbnails=()=>{
    q("carousel-shots").replaceChildren();
    shots.forEach((shot,index)=>{
      const button=document.createElement("button");button.type="button";button.setAttribute("aria-label",`Remove carousel photo ${index+1}`);
      const image=document.createElement("img");image.src=shot.media;image.alt=`Photo ${index+1}`;
      button.append(image);button.onclick=()=>{if(!canEdit())return;shots.splice(index,1);thumbnails();refresh();};q("carousel-shots").append(button);
    });refresh();
  };
  const flushShots=()=>{
    if(!canEdit()||!shots.length)return;
    finishCarousel(shots.map(shot=>shot.scene));shots.length=0;thumbnails();
  };
  q("carousel-next").onclick=()=>{if(shots.length>=2)flushShots();};
  const capturePhoto=async blob=>{
    if(mode!=="carousel")return false;
    if(shots.length>=10){error("A carousel can contain up to 10 photos.");return true;}
    const media=rememberBlob(blob);await assets.load(media);if(!alive())return true;
    const {pages,activePage,...scene}=structuredClone(project);
    scene.background={...scene.background,kind:"photo",media};scene.duration=5;
    shots.push({media,scene});thumbnails();return true;
  };
  refresh();requestAnimationFrame(center);
  return {refresh,capturePhoto,select,flushShots,mode:()=>mode,
    snapshot:()=>({mode,shots:structuredClone(shots)}),
    restore:value=>{
      mode=CAPTURE_MODES.includes(value?.mode)?value.mode:"photo";
      shots.splice(0,shots.length,...structuredClone(value?.shots||[]));
      q(mode==="video"?"record":"photo").click();
      thumbnails();center();
    }};
}
