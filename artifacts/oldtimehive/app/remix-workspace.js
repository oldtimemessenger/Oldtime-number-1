import {layerBounds} from "./remix-compositor.js";
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export function hitRemixLayer(state,x,y,width,height) {
  for(const key of ["sticker","text","me","original"]){
    if((key==="text"&&!state.text)||(key==="sticker"&&state.sticker==="none"))continue;
    const b=layerBounds(state,key,width,height),l=state.layers[key];if(!b||!l)continue;
    const a=-l.rotation*Math.PI/180,dx=x-b.x-b.width/2,dy=y-b.y-b.height/2;
    if(Math.abs(dx*Math.cos(a)-dy*Math.sin(a))<=b.width/2&&Math.abs(dx*Math.sin(a)+dy*Math.cos(a))<=b.height/2)return key;
  }
  return state.active;
}
export function mountRemixWorkspace({root,canvas,state,onChange,canEdit}) {
  const q=id=>root.querySelector(`#${id}`),selection=q("studio-selection"),editor=q("studio-text-editor");
  let destroyed=false,gesture=null,focusMode=false;
  const canvasPointers=new Set();
  const undo=[],redo=[],listeners=[];
  const listen=(el,name,fn,options)=>{el.addEventListener(name,fn,options);listeners.push(()=>el.removeEventListener(name,fn,options));};
  const history=document.createElement("div");history.className="rs-history";
  history.innerHTML='<button type="button" id="studio-undo" aria-label="Undo edit">Undo</button><button type="button" id="studio-redo" aria-label="Redo edit">Redo</button>';
  (q("studio-history-slot")||root.querySelector(".rs-toolbar")).append(history);
  const stickerPicker=document.createElement("div");stickerPicker.className="rs-sticker-picker";stickerPicker.hidden=true;stickerPicker.setAttribute("role","group");stickerPicker.setAttribute("aria-label","Choose sticker");
  stickerPicker.innerHTML='<button type="button" data-pick-sticker="star" aria-label="Star">★</button><button type="button" data-pick-sticker="heart" aria-label="Heart">♥</button><button type="button" data-pick-sticker="sparkle" aria-label="Sparkle">✦</button><button type="button" data-pick-sticker="none" aria-label="Remove sticker">Remove</button>';
  root.querySelector(".rs-stage").append(stickerPicker);
  q("studio-rotation").min="-180";q("studio-rotation").max="180";
  for(const key of ["text","sticker"]){const o=document.createElement("option");o.value=key;o.textContent=key==="text"?"Text":"Sticker";q("studio-layer").append(o);}
  const snapshot=()=>JSON.stringify({...Object.fromEntries(["layout","layers","active","divider","text","sticker","effect","originalVolume","meVolume","offset"].map(k=>[k,state[k]])),cutout:q("studio-cutout").checked});
  const checkpoint=()=>{if(!canEdit())return;const s=snapshot();if(undo.at(-1)!==s){undo.push(s);if(undo.length>40)undo.shift();redo.length=0;}};
  const sync=()=>{
    if(destroyed)return;
    const b=layerBounds(state,state.active,canvas.width,canvas.height),l=state.layers[state.active];
    selection.hidden=!canEdit()||!b;
    if(b)Object.assign(selection.style,{left:`${b.x/canvas.width*100}%`,top:`${b.y/canvas.height*100}%`,width:`${b.width/canvas.width*100}%`,height:`${b.height/canvas.height*100}%`,transform:`rotate(${l.rotation}deg)`});
    root.querySelectorAll("[data-studio-select]").forEach(el=>{const selected=el.dataset.studioSelect===state.active;el.classList.toggle("on",selected);el.setAttribute("aria-pressed",String(selected));el.disabled=!canEdit();});
    q("studio-undo").disabled=!canEdit()||!undo.length;q("studio-redo").disabled=!canEdit()||!redo.length;
    if(state.editingText&&b){
      Object.assign(editor.style,{left:`${b.x/canvas.width*100}%`,top:`${b.y/canvas.height*100}%`,width:`${b.width/canvas.width*100}%`,minHeight:`${b.height/canvas.height*100}%`,fontSize:`${Math.max(16,b.width/canvas.width*canvas.clientWidth*.1*l.crop)}px`,transform:`rotate(${l.rotation}deg)`});
    }
  };
  const commitText=()=>{if(!state.editingText)return;state.text=editor.innerText.slice(0,80);q("studio-text").value=state.text;state.editingText=false;editor.hidden=true;sync();};
  const select=(key,edit=false)=>{
    if(!canEdit()||!state.layers[key])return;
    if(key!=="text")commitText();
    if(key!=="sticker")stickerPicker.hidden=true;
    state.active=key;q("studio-layer").value=key;onChange();
    if(key==="text"&&edit){checkpoint();state.editingText=true;root.classList.add("rs-panel-collapsed");q("studio-panel-toggle").setAttribute("aria-expanded","false");editor.hidden=false;editor.textContent=state.text;sync();editor.focus({preventScroll:true});}
  };
  const showTool=tool=>{
    commitText();stickerPicker.hidden=true;
    root.classList.remove("rs-focus");
    root.querySelectorAll("[data-studio-tool]").forEach(el=>{const on=el.dataset.studioTool===tool;el.classList.toggle("on",on);el.setAttribute("aria-pressed",String(on));});
    root.querySelectorAll("[data-studio-panel]").forEach(el=>el.hidden=el.dataset.studioPanel!==tool);
    root.classList.remove("rs-panel-collapsed");q("studio-panel-toggle").setAttribute("aria-expanded","true");
  };
  root.querySelectorAll("[data-studio-tool]").forEach(el=>listen(el,"click",()=>showTool(el.dataset.studioTool)));
  root.querySelectorAll("[data-studio-select]").forEach(el=>listen(el,"click",()=>{select(el.dataset.studioSelect,el.dataset.studioSelect==="text");if(el.dataset.studioSelect==="sticker"&&canEdit()){root.classList.add("rs-panel-collapsed");q("studio-panel-toggle").setAttribute("aria-expanded","false");stickerPicker.hidden=false;}}));
  stickerPicker.querySelectorAll("[data-pick-sticker]").forEach(button=>listen(button,"click",()=>{if(!canEdit())return;checkpoint();state.sticker=button.dataset.pickSticker;q("studio-sticker").value=state.sticker;stickerPicker.hidden=true;onChange();}));
  listen(q("studio-panel-toggle"),"click",()=>{if(root.classList.contains("rs-focus")){root.classList.remove("rs-focus","rs-panel-collapsed");q("studio-panel-toggle").setAttribute("aria-expanded","true");return;}const collapsed=root.classList.toggle("rs-panel-collapsed");q("studio-panel-toggle").setAttribute("aria-expanded",String(!collapsed));});
  const resizeViewport=()=>{if(window.visualViewport){root.style.height=`${window.visualViewport.height}px`;root.style.setProperty("--rs-height",`${window.visualViewport.height}px`);}};
  if(window.visualViewport)listen(window.visualViewport,"resize",resizeViewport);
  resizeViewport();
  listen(q("studio-fullscreen"),"click",async()=>{
    focusMode=!focusMode;root.classList.toggle("rs-focus",focusMode);
    q("studio-fullscreen").setAttribute("aria-pressed",String(focusMode));q("studio-fullscreen").setAttribute("aria-label",focusMode?"Exit full-screen editing":"Full-screen editing");
    try{if(focusMode&&root.requestFullscreen)await root.requestFullscreen();else if(!focusMode&&document.fullscreenElement===root)await document.exitFullscreen();}catch{/* Safari still gets the full-viewport focus workspace. */}
    resizeViewport();
  });
  listen(document,"fullscreenchange",()=>{if(!document.fullscreenElement){focusMode=false;root.classList.remove("rs-focus");q("studio-fullscreen").setAttribute("aria-pressed","false");}resizeViewport();});
  listen(root,"pointerdown",e=>{if(e.target.closest(".rs-history"))return;if(e.target.closest(".rs-group, .rs-handle")||e.target===canvas)checkpoint();},true);
  listen(canvas,"pointerdown",event=>{
    if(!canEdit())return;
    if(!canvasPointers.size){const r=canvas.getBoundingClientRect();select(hitRemixLayer(state,(event.clientX-r.left)/r.width*canvas.width,(event.clientY-r.top)/r.height*canvas.height,canvas.width,canvas.height));}
    canvasPointers.add(event.pointerId);
  });
  for(const name of ["pointerup","pointercancel"])listen(canvas,name,event=>canvasPointers.delete(event.pointerId));
  listen(canvas,"dblclick",event=>{const r=canvas.getBoundingClientRect();if(hitRemixLayer(state,(event.clientX-r.left)/r.width*canvas.width,(event.clientY-r.top)/r.height*canvas.height,canvas.width,canvas.height)==="text")select("text",true);});
  listen(editor,"input",()=>{state.text=editor.innerText.slice(0,80);q("studio-text").value=state.text;});
  listen(editor,"blur",commitText);
  const pointer=event=>{const r=canvas.getBoundingClientRect();return {x:(event.clientX-r.left)/r.width*canvas.width,y:(event.clientY-r.top)/r.height*canvas.height};};
  selection.querySelectorAll("[data-studio-handle]").forEach(handle=>{
    listen(handle,"pointerdown",e=>{
      if(!canEdit())return;e.preventDefault();e.stopPropagation();commitText();handle.setPointerCapture(e.pointerId);
      const p=pointer(e),l=state.layers[state.active],cx=canvas.width*l.x/100,cy=canvas.height*l.y/100;
      gesture={id:e.pointerId,handle:handle.dataset.studioHandle,size:l.size,rotation:l.rotation,cx,cy,distance:Math.hypot(p.x-cx,p.y-cy),angle:Math.atan2(p.y-cy,p.x-cx)};
    });
    listen(handle,"pointermove",e=>{
      if(!gesture||gesture.id!==e.pointerId)return;e.preventDefault();e.stopPropagation();const p=pointer(e),l=state.layers[state.active];
      if(gesture.handle==="rotate")l.rotation=clamp(gesture.rotation+(Math.atan2(p.y-gesture.cy,p.x-gesture.cx)-gesture.angle)*180/Math.PI,-180,180);
      else if(state.layout==="split"&&["me","original"].includes(state.active))state.divider=clamp(p.x/canvas.width*100,20,80);
      else l.size=clamp(gesture.size*Math.hypot(p.x-gesture.cx,p.y-gesture.cy)/Math.max(1,gesture.distance),15,100);
      onChange();
    });
    for(const name of ["pointerup","pointercancel"])listen(handle,name,e=>{e.stopPropagation();gesture=null;});
  });
  const restore=(from,to)=>{
    if(!canEdit()||!from.length)return;commitText();const cutoutWas=q("studio-cutout").checked;to.push(snapshot());Object.assign(state,JSON.parse(from.pop()));
    for(const key of ["text","sticker","effect","divider"])q(`studio-${key}`).value=state[key];
    q("studio-original-volume").value=state.originalVolume*100;q("studio-me-volume").value=state.meVolume*100;q("studio-offset").value=state.offset;
    q("studio-layout").value=state.layout;q("studio-cutout").checked=state.cutout;
    if(cutoutWas!==state.cutout)q("studio-cutout").dispatchEvent(new Event("change",{bubbles:true}));
    q("studio-offset").dispatchEvent(new Event("input",{bubbles:true}));
    onChange();
  };
  listen(q("studio-undo"),"click",()=>restore(undo,redo));listen(q("studio-redo"),"click",()=>restore(redo,undo));
  listen(root,"keydown",e=>{
    if(e.target.isContentEditable||["TEXTAREA","INPUT"].includes(e.target.tagName)&&e.target.type!=="range")return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();restore(e.shiftKey?redo:undo,e.shiftKey?undo:redo);}
    else if(e.target.type==="range")checkpoint();
  },true);
  sync();
  return {sync,checkpoint,commitText,get editingText(){return !!state.editingText;},destroy(){destroyed=true;listeners.forEach(fn=>fn());if(document.fullscreenElement===root)void document.exitFullscreen().catch(()=>{});}};
}
