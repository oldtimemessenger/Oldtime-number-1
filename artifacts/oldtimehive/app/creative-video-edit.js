import { clamp } from "./creative-project.js";

export function initVideoEdit(background, duration) {
  if (background.kind !== "video" || background.media === "live-camera") return null;
  if (!background.videoEdit?.clips?.length) {
    const length = Math.max(.1, Number.isFinite(duration) ? duration : 5);
    background.videoEdit = { sourceDuration:length, clips:[{id:crypto.randomUUID(),in:0,out:Math.min(60,length),speed:1}] };
  }
  return background.videoEdit;
}
export const clipDuration = clip => (clip.out-clip.in)/clip.speed;
export const editedDuration = edit => (edit?.clips||[]).reduce((sum,clip)=>sum+clipDuration(clip),0);
export function videoPoint(background, time) {
  const clips=background.videoEdit?.clips;
  if (!clips?.length) return {sourceTime:time,speed:1,index:0,id:"original"};
  let offset=0;
  for(let index=0;index<clips.length;index++){
    const clip=clips[index],length=clipDuration(clip);
    if(time<offset+length || index===clips.length-1)
      return {sourceTime:clamp(clip.in+(time-offset)*clip.speed,clip.in,Math.max(clip.in,clip.out-.001)),speed:clip.speed,index,id:clip.id,offset};
    offset+=length;
  }
}
export function syncVideoEdit(video, background, time, playing=false) {
  if(!video||video.srcObject||!background.videoEdit)return;
  const point=videoPoint(background,time);
  video.loop=false;video.playbackRate=point.speed;
  if(video.__creativeClip!==point.id || Math.abs(video.currentTime-point.sourceTime)>.25){
    video.currentTime=point.sourceTime;video.__creativeClip=point.id;
  }
  if(playing&&video.paused)void video.play().catch(()=>{});
}
export function splitVideoClip(edit, time) {
  const point=videoPoint({videoEdit:edit},time),clip=edit.clips[point.index];
  if(point.sourceTime-clip.in<.1 || clip.out-point.sourceTime<.1)throw new Error("Move the playhead inside the clip before splitting.");
  const next={...clip,id:crypto.randomUUID(),in:point.sourceTime};
  clip.out=point.sourceTime;edit.clips.splice(point.index+1,0,next);
  return point.index+1;
}
export function updateVideoClip(edit,index,changes) {
  const clip=edit.clips[index];if(!clip)throw new Error("Select a clip.");
  const next={...clip,...changes};
  if(!Number.isFinite(next.in)||!Number.isFinite(next.out)||next.in<0||next.out>edit.sourceDuration+.01||next.out-next.in<.1)throw new Error("Keep at least 0.1 seconds inside the original video.");
  if(!Number.isFinite(next.speed)||next.speed<.25||next.speed>2)throw new Error("Speed must be between 0.25× and 2×.");
  if(edit.clips.reduce((sum,item,i)=>sum+clipDuration(i===index?next:item),0)>60.01)throw new Error("Trim the video before slowing it down. Edited videos can be up to 60 seconds.");
  Object.assign(clip,next);
}
export function mediaFilter(background) {
  const {brightness=100,contrast=100,saturation=100}=background.adjustments||{};
  return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
}
export function adjustPixels(data,background) {
  const {brightness=100,contrast=100,saturation=100}=background.adjustments||{},b=brightness/100,c=contrast/100,s=saturation/100;
  for(let i=0;i<data.length;i+=4){
    const r=(data[i]*b-127.5)*c+127.5,g=(data[i+1]*b-127.5)*c+127.5,blue=(data[i+2]*b-127.5)*c+127.5,luma=r*.2126+g*.7152+blue*.0722;
    data[i]=clamp(luma+(r-luma)*s,0,255);data[i+1]=clamp(luma+(g-luma)*s,0,255);data[i+2]=clamp(luma+(blue-luma)*s,0,255);
  }
}
export function cropDimensions(asset,crop={width:1,height:1}) {
  const w=asset.videoWidth||asset.naturalWidth||asset.width,h=asset.videoHeight||asset.naturalHeight||asset.height,ratio=w*crop.width/(h*crop.height);
  const height=Math.min(1920,1080/ratio),width=height*ratio;
  // Browser video encoders require even chroma-plane dimensions.
  return {width:Math.max(64,Math.round(width/2)*2),height:Math.max(64,Math.round(height/2)*2)};
}
