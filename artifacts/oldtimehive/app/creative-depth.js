import {createPersonCutout} from "./remix-cutout.js";
import {waitForVideoFrame} from "./remix-video.js";
import {canvasBlob} from "./creative-export.js";

// The foreground is derived only from owned background media, never comment-card pixels.
export async function photoSubjectBlob({asset,project,container,alive}){
  if(!asset||asset.tagName==="VIDEO"||project.background.kind!=="photo")throw new Error("Upload or capture a portrait photo first.");
  const canvas=document.createElement("canvas"),scale=Math.min(1,1024/Math.max(project.width,project.height));
  canvas.width=Math.max(2,Math.round(project.width*scale/2)*2);canvas.height=Math.max(2,Math.round(project.height*scale/2)*2);
  const w=asset.naturalWidth||asset.width,h=asset.naturalHeight||asset.height,crop={x:0,y:0,width:1,height:1,...project.background.crop};
  const sw=w*crop.width,sh=h*crop.height,fit=Math.max(canvas.width/sw,canvas.height/sh),cw=canvas.width/fit,ch=canvas.height/fit;
  canvas.getContext("2d").drawImage(asset,crop.x*w+(sw-cw)/2,crop.y*h+(sh-ch)/2,cw,ch,0,0,canvas.width,canvas.height);
  const stream=canvas.captureStream(5),video=document.createElement("video");
  video.muted=true;video.playsInline=true;video.setAttribute("playsinline","");video.srcObject=stream;
  video.style.cssText="width:1px;height:1px;opacity:.01;pointer-events:none";container.append(video);
  let cutout;
  try{
    await video.play();stream.getVideoTracks()[0]?.requestFrame?.();await waitForVideoFrame(video);
    cutout=await createPersonCutout();if(!alive())throw new Error("Studio closed.");
    await cutout.prepare(video);if(!alive())throw new Error("Studio closed.");
    const foreground=cutout.frame(video,performance.now()+100),pixels=foreground.getContext("2d").getImageData(0,0,foreground.width,foreground.height).data;
    let count=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>80)count++;
    if(count<pixels.length/4*.01||count>pixels.length/4*.99)throw new Error("No clear person detected. Try a portrait with a visible background.");
    return await canvasBlob(foreground);
  }finally{
    cutout?.close();video.pause();video.srcObject=null;video.remove();stream.getTracks().forEach(track=>track.stop());
  }
}
