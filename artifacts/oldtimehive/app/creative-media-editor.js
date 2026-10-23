import {clamp,setProjectDuration} from "./creative-project.js";
import {initVideoEdit,editedDuration,clipDuration,splitVideoClip,updateVideoClip,cropDimensions,mediaFilter,adjustPixels} from "./creative-video-edit.js";
import {distance,pinchRect,resetRect,lockAspect} from "./creative-capture-geometry.js";

export function bindMediaEditor({root,editor,q,project,assets,history,changed,seek,time,stop,canEdit,inline,error}) {
  let clipIndex=0,crop=null,gesture=null,thumbKey="",thumbRequest=0,thumbVideo=null,destroyed=false;
  const source=()=>assets.get(project.background.media),isVideo=()=>project.background.kind==="video"&&project.background.media!=="live-camera";
  const edit=()=>isVideo()?initVideoEdit(project.background,source()?.creativeDuration||source()?.duration||project.duration):null;
  const closeProperties=()=>{
    for(const [id,selector] of [["source-toggle",".ce-source"],["style-toggle","#ce-inspector"],["share-toggle",".ce-share"]]){q(id).setAttribute("aria-expanded","false");root.querySelector(selector).classList.add("is-collapsed");}
    q("stickers").hidden=true;q("comments").hidden=true;q("layers-toggle").setAttribute("aria-expanded","false");root.querySelector(".ce-panel").classList.remove("is-layers-open");
  };
  const closePanel=()=>{q("media-panel").hidden=true;q("trim-handle-start").hidden=q("trim-handle-end").hidden=true;root.querySelectorAll("[data-ce-media-tool]").forEach(el=>{el.classList.remove("on");el.setAttribute("aria-pressed","false");});};
  const refresh=()=>{
    if(destroyed)return;
    const model=edit(),clip=model?.clips[clipIndex]||model?.clips[0];
    if(model&&clipIndex>=model.clips.length)clipIndex=0;
    root.querySelector(".ce-video-context").hidden=!model||!!crop;
    root.querySelectorAll("[data-ce-media-tool]").forEach(button=>{
      button.disabled=!canEdit()||(["trim","speed"].includes(button.dataset.ceMediaTool)&&!model)||(["crop","color"].includes(button.dataset.ceMediaTool)&&!source());
    });
    q("split").disabled=!model||!canEdit();q("clip-delete").disabled=!model||!canEdit();
    q("clip-prev").disabled=!model||clipIndex===0;q("clip-next").disabled=!model||clipIndex===model.clips.length-1;
    if(clip){
      for(const id of ["trim-start","trim-end"]){q(id).max=model.sourceDuration;q(id).min=0;}
      q("trim-start").value=clip.in.toFixed(2);q("trim-end").value=clip.out.toFixed(2);q("speed").value=clip.speed;
      q("speed-value").value=`${clip.speed.toFixed(2)}×`;
    }
    for(const [name,property] of [["start","in"],["end","out"]]){
      const handle=q(`trim-handle-${name}`);handle.hidden=!clip||q("media-panel").hidden||root.querySelector('[data-ce-media-panel="trim"]').hidden;
      if(clip)handle.style.left=`${clamp(clip[property]/model.sourceDuration*100,3,97)}%`;
    }
    for(const name of ["brightness","contrast","saturation"]){q(name).value=project.background.adjustments?.[name]??100;q(`${name}-value`).value=`${q(name).value}%`;}
    const list=q("clip-list"),key=JSON.stringify(model?.clips||[]);
    if(list.dataset.clips!==key){
      list.dataset.clips=key;list.replaceChildren();
      (model?.clips||[]).forEach((item,index)=>{
        const button=document.createElement("button");button.type="button";button.textContent=`Clip ${index+1} · ${clipDuration(item).toFixed(1)}s`;button.dataset.clipIndex=index;
        button.onclick=()=>{clipIndex=index;seek(model.clips.slice(0,index).reduce((n,c)=>n+clipDuration(c),0));refresh();};
        list.append(button);
      });
    }
    list.querySelectorAll("button").forEach(button=>button.setAttribute("aria-pressed",String(Number(button.dataset.clipIndex)===clipIndex)));
    void thumbnails();
  };
  const thumbnails=async()=>{
    const key=project.background.media;if(!isVideo()||key===thumbKey||!source()?.videoWidth)return;
    thumbKey=key;const request=++thumbRequest;q("filmstrip").replaceChildren();
    thumbVideo?.pause();thumbVideo?.remove();
    const video=document.createElement("video");thumbVideo=video;video.muted=true;video.playsInline=true;video.crossOrigin="anonymous";video.src=source().src;
    video.style.cssText="position:absolute;width:1px;height:1px;opacity:.01;pointer-events:none";root.append(video);
    try{
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("Thumbnail timeout")),8000);video.onloadeddata=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject();};video.load();});
      const duration=edit().sourceDuration,canvas=document.createElement("canvas");canvas.width=48;canvas.height=64;
      for(let i=0;i<8;i++){
        if(destroyed||request!==thumbRequest)return;
        await new Promise(resolve=>{const timer=setTimeout(resolve,500);video.onseeked=()=>{clearTimeout(timer);resolve();};video.currentTime=Math.max(.01,duration*(i+.5)/8);});
        canvas.getContext("2d").drawImage(video,0,0,48,64);const image=document.createElement("img");image.src=canvas.toDataURL("image/jpeg",.55);image.alt="";q("filmstrip").append(image);
      }
    }catch{/* Scrubbing and editing remain usable when a browser cannot generate thumbnails. */}
    finally{video.pause();video.removeAttribute("src");video.load();video.remove();}
  };
  const updateDuration=()=>{setProjectDuration(project,editedDuration(edit()));seek(Math.min(time(),project.duration));changed();refresh();};
  const applyClip=changes=>{if(!canEdit())return;try{history.record();updateVideoClip(edit(),clipIndex,changes);updateDuration();error("");}catch(failure){error(failure);refresh();}};
  for(const [name,property] of [["start","in"],["end","out"]]){
    const handle=q(`trim-handle-${name}`);let drag;
    handle.onpointerdown=e=>{
      const model=edit();if(!model||!canEdit())return;e.preventDefault();history.record();stop();
      drag={id:e.pointerId,x:e.clientX,value:model.clips[clipIndex][property],width:handle.parentElement.clientWidth};handle.setPointerCapture(e.pointerId);
    };
    handle.onpointermove=e=>{
      if(!drag||e.pointerId!==drag.id)return;
      const model=edit(),clip=model.clips[clipIndex],raw=drag.value+(e.clientX-drag.x)/drag.width*model.sourceDuration;
      const value=property==="in"?clamp(raw,0,clip.out-.1):clamp(raw,clip.in+.1,model.sourceDuration);
      try{
        updateVideoClip(model,clipIndex,{[property]:value});setProjectDuration(project,editedDuration(model));
        const offset=model.clips.slice(0,clipIndex).reduce((n,c)=>n+clipDuration(c),0);
        seek(property==="in"?offset:offset+clipDuration(clip)-.02);changed();refresh();
      }catch(failure){error(failure);}
    };
    handle.onpointerup=handle.onpointercancel=()=>drag=null;
  }
  for(const [name,property] of [["trim-start","in"],["trim-end","out"]])q(name).onchange=()=>applyClip({[property]:Number(q(name).value)});
  q("speed").onpointerdown=()=>history.record();q("speed").onkeydown=()=>history.record();
  q("speed").oninput=()=>{if(!canEdit())return;try{updateVideoClip(edit(),clipIndex,{speed:Number(q("speed").value)});updateDuration();error("");}catch(failure){error(failure);refresh();}};
  for(const name of ["brightness","contrast","saturation"]){
    q(name).onpointerdown=()=>history.record();q(name).onkeydown=()=>history.record();
    q(name).oninput=()=>{if(!canEdit())return;project.background.adjustments||={};project.background.adjustments[name]=Number(q(name).value);changed(false);refresh();};
  }
  const split=()=>{if(!canEdit()||!edit())return;try{history.record();clipIndex=splitVideoClip(edit(),time());changed();refresh();error("");}catch(failure){error(failure);}};
  q("split").onclick=split;root.querySelectorAll("[data-ce-quick-split]").forEach(button=>button.onclick=split);
  for(const [id,direction] of [["clip-prev",-1],["clip-next",1]])q(id).onclick=()=>{
    const model=edit(),next=clipIndex+direction;if(!model||next<0||next>=model.clips.length)return;
    history.record();const [item]=model.clips.splice(clipIndex,1);model.clips.splice(next,0,item);clipIndex=next;updateDuration();
  };
  q("clip-delete").onclick=()=>{
    const model=edit();if(!model||!canEdit())return;history.record();model.clips.splice(clipIndex,1);
    if(!model.clips.length){stop();project.background={kind:"color",color:project.background.color||"#17191d",media:""};setProjectDuration(project,5);seek(0);closePanel();}
    else{clipIndex=Math.min(clipIndex,model.clips.length-1);updateDuration();}
    changed();refresh();
  };
  const positionCrop=()=>{if(!crop)return;Object.assign(q("crop-box").style,{left:`${crop.rect.x*100}%`,top:`${crop.rect.y*100}%`,width:`${crop.rect.width*100}%`,height:`${crop.rect.height*100}%`});};
  const startCrop=()=>{
    if(!source()||!canEdit())return;inline.finish();stop();closePanel();closeProperties();
    crop={rect:{x:0,y:0,width:1,height:1,...project.background.crop},asset:source(),dimensions:cropDimensions(source())};
    q("crop-overlay").hidden=false;editor.classList.add("is-cropping");syncRatioButtons();positionCrop();changed(false);
  };
  const finishCrop=apply=>{
    if(!crop)return;
    if(apply){history.record();project.background.crop={...crop.rect};const size=cropDimensions(crop.asset,crop.rect);project.width=size.width;project.height=size.height;project.aspect="custom";}
    crop=null;gesture=null;q("crop-overlay").hidden=true;editor.classList.remove("is-cropping");changed();refresh();
  };
  q("crop-done").onclick=()=>finishCrop(true);q("crop-cancel").onclick=()=>finishCrop(false);
  const cpts=new Map();let pinchG=null;
  const assetRatio=()=>{const a=crop.asset;return (a.videoWidth||a.naturalWidth||a.width)/(a.videoHeight||a.naturalHeight||a.height);};
  const applyRatio=()=>{if(crop?.ratio)crop.rect=lockAspect(crop.rect,crop.ratio,assetRatio());positionCrop();};
  const syncRatioButtons=()=>root.querySelectorAll("[data-ce-crop-ratio]").forEach(b=>b.setAttribute("aria-pressed",String((b.dataset.ceCropRatio==="free"?null:b.dataset.ceCropRatio)===(crop?.ratioKey||null))));
  root.querySelectorAll("[data-ce-crop-ratio]").forEach(b=>b.onclick=()=>{
    if(!crop)return;const k=b.dataset.ceCropRatio;
    if(k==="free"){crop.ratio=null;crop.ratioKey=null;}else{const [w,h]=k.split(":").map(Number);crop.ratio=w/h;crop.ratioKey=k;}
    applyRatio();syncRatioButtons();
  });
  q("crop-reset").onclick=()=>{if(!crop)return;crop.rect=resetRect();crop.ratio=null;crop.ratioKey=null;positionCrop();syncRatioButtons();};
  q("crop-box").ondblclick=()=>q("crop-reset").click();
  q("crop-box").onpointerdown=e=>{
    if(!crop)return;e.preventDefault();e.stopPropagation();q("crop-box").setPointerCapture(e.pointerId);
    cpts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(cpts.size===2){const [a,b]=[...cpts.values()];pinchG={d:distance(a,b),rect:{...crop.rect}};gesture=null;return;}
    const r=root.querySelector(".ce-stage").getBoundingClientRect();gesture={id:e.pointerId,x:e.clientX,y:e.clientY,stage:r,rect:{...crop.rect},corner:e.target.closest("[data-ce-crop-corner]")?.dataset.ceCropCorner};
  };
  q("crop-box").onpointermove=e=>{
    if(cpts.has(e.pointerId))cpts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(crop&&pinchG&&cpts.size===2){e.preventDefault();const [a,b]=[...cpts.values()];crop.rect=pinchRect(pinchG.rect,pinchG.d,distance(a,b));applyRatio();return;}
    if(!crop||!gesture||e.pointerId!==gesture.id)return;e.preventDefault();
    const dx=(e.clientX-gesture.x)/gesture.stage.width,dy=(e.clientY-gesture.y)/gesture.stage.height,r=gesture.rect,n={...r},corner=gesture.corner;
    if(!corner){n.x=clamp(r.x+dx,0,1-r.width);n.y=clamp(r.y+dy,0,1-r.height);}
    else{
      if(corner.includes("w")){n.x=clamp(r.x+dx,0,r.x+r.width-.1);n.width=r.x+r.width-n.x;}else n.width=clamp(r.width+dx,.1,1-r.x);
      if(corner.includes("n")){n.y=clamp(r.y+dy,0,r.y+r.height-.1);n.height=r.y+r.height-n.y;}else n.height=clamp(r.height+dy,.1,1-r.y);
    }
    crop.rect=n;applyRatio();
  };
  q("crop-box").onpointerup=q("crop-box").onpointercancel=e=>{cpts.delete(e.pointerId);if(cpts.size<2)pinchG=null;gesture=null;};
  root.querySelectorAll("[data-ce-media-tool]").forEach(button=>button.onclick=()=>{
    const tool=button.dataset.ceMediaTool;if(tool==="more"){const open=editor.classList.toggle("is-more-open");button.setAttribute("aria-expanded",String(open));return;}
    if(tool==="crop"){startCrop();return;}if(!canEdit())return;inline.finish();stop();if(crop)finishCrop(true);closeProperties();
    if(tool!=="color"&&!edit())return;
    q("media-panel").hidden=false;q("media-title").textContent={trim:"Trim / Split",speed:"Speed",color:"Color"}[tool];
    root.querySelectorAll("[data-ce-media-panel]").forEach(panel=>panel.hidden=panel.dataset.ceMediaPanel!==tool);
    root.querySelectorAll("[data-ce-media-tool]").forEach(el=>{el.classList.toggle("on",el.dataset.ceMediaTool===tool);el.setAttribute("aria-pressed",String(el.dataset.ceMediaTool===tool));});
    refresh();
  });
  q("media-close").onclick=closePanel;
  const custom=document.createElement("option");custom.value="custom";custom.textContent="Custom crop";custom.disabled=true;q("aspect").append(custom);
  return {refresh,finishCrop,get cropActive(){return !!crop;},cropSize:()=>crop?.dimensions,
    drawCrop(canvas){
      const ctx=canvas.getContext("2d"),native="filter" in ctx;
      if(crop.asset.tagName==="VIDEO"&&crop.asset.readyState<2)return;
      ctx.clearRect(0,0,canvas.width,canvas.height);
      if(native)ctx.filter=mediaFilter(project.background);ctx.drawImage(crop.asset,0,0,canvas.width,canvas.height);
      if(native)ctx.filter="none";
      else if(Object.values(project.background.adjustments||{}).some(value=>value!==100)){const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);adjustPixels(pixels.data,project.background);ctx.putImageData(pixels,0,0);}
      positionCrop();
    },
    dispose(){destroyed=true;++thumbRequest;thumbVideo?.pause();thumbVideo?.remove();}};
}
