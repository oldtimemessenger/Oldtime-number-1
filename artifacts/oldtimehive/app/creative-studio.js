import {createLayer} from "./creative-project.js";
import {TEXT_PRESETS,BLEND_MODES,PHOTO_PRESETS,textPreset} from "./creative-text-effects.js";
import {photoSubjectBlob} from "./creative-depth.js";
import {bindCaptureModes} from "./creative-capture-modes.js";

export function bindCreativeStudio({root,editor,q,project,assets,history,inline,mediaTools,add,layer,setSelected,changed,stop,error,status,rememberBlob,setBusy,alive,canEdit,finishCarousel}){
  q("saturation").min="0";
  const more=root.querySelector(".ce-more");
  const cameraButton=document.createElement("button");cameraButton.type="button";cameraButton.className="ce-tool";cameraButton.innerHTML=q("camera").innerHTML;cameraButton.setAttribute("data-ce-basic-only","");cameraButton.setAttribute("aria-label","Open camera");
  root.querySelector(".ce-upload-tool").after(cameraButton);cameraButton.onclick=()=>{if(q("workspace").value==="studio"){q("workspace").value="camera";q("workspace").onchange();}q("camera").click();};
  const lab=document.createElement("section");lab.className="ce-browser";lab.setAttribute("data-ce-studio-only","");
  const heading=document.createElement("h3");heading.textContent="Photo looks & depth";lab.append(heading);
  for(const name of Object.keys(PHOTO_PRESETS)){
    const button=document.createElement("button");button.type="button";button.className="ce-browse";
    button.textContent=name[0].toUpperCase()+name.slice(1);button.dataset.cePhotoPreset=name;
    button.onclick=()=>{
      if(!canEdit()||!assets.get(project.background.media))return;
      mediaTools.finishCrop(true);inline.finish();history.record();project.background.adjustments={...PHOTO_PRESETS[name]};
      changed();status(`${button.textContent} applied. The original media is unchanged.`);
    };lab.append(button);
  }
  const depth=document.createElement("button");depth.type="button";depth.id="ce-depth";depth.className="ce-browse";depth.textContent="Text behind person";lab.append(depth);
  const labMenu=document.createElement("details");labMenu.className="ce-menu ce-studio-lab-menu";labMenu.name="ce-menu";labMenu.setAttribute("data-ce-studio-only","");
  const summary=document.createElement("summary");summary.className="ce-chip";summary.textContent="Looks & depth";
  labMenu.append(summary,lab);more.append(labMenu);
  const capture=bindCaptureModes({root,editor,q,project,assets,rememberBlob,changed,canEdit,alive,finishCarousel,error});
  root.addEventListener("click",event=>{
    const button=event.target.closest('button,label[for="ce-upload"]');if(!button)return;
    for(let menu=button.closest("details[open]");menu;menu=menu.parentElement.closest("details[open]"))menu.open=false;
    if(button.dataset.ceMediaTool!=="more"){
      editor.classList.remove("is-more-open");
      root.querySelectorAll('[data-ce-media-tool="more"]').forEach(item=>item.setAttribute("aria-expanded","false"));
    }
  });
  root.addEventListener("pointerdown",event=>{
    root.querySelectorAll("details[open]").forEach(menu=>{if(!menu.contains(event.target))menu.open=false;});
  });
  root.addEventListener("keydown",event=>{
    if(event.key!=="Escape")return;
    const menus=root.querySelectorAll("details[open]");if(!menus.length)return;
    event.preventDefault();event.stopPropagation();menus.forEach(menu=>menu.open=false);
  });
  const text=()=>{
    let item=layer();
    if(item?.kind!=="text"||item.locked)item=add(createLayer("text",{text:"Your title",fontSize:96}));
    return item;
  };
  const inspector=()=>{
    if(q("style-toggle").getAttribute("aria-expanded")!=="true")q("style-toggle").click();
    q("inspector").classList.remove("is-collapsed");q("style-toggle").setAttribute("aria-expanded","true");
  };
  q("workspace").onchange=()=>{
    if(!canEdit())return;
    inline.finish();mediaTools.finishCrop(true);stop();
    const studio=q("workspace").value==="studio";
    editor.classList.toggle("is-studio",studio);editor.classList.toggle("is-basic",!studio);editor.classList.remove("is-more-open");
    root.querySelectorAll("[data-ce-media-tool=more]").forEach(button=>button.setAttribute("aria-expanded","false"));
    q("media-panel").hidden=true;q("trim-handle-start").hidden=q("trim-handle-end").hidden=true;
    for(const [id,selector] of [["source-toggle",".ce-source"],["style-toggle","#ce-inspector"]]){
      q(id).setAttribute("aria-expanded","false");root.querySelector(selector).classList.add("is-collapsed");
    }
    root.querySelector(".ce-panel").classList.remove("is-layers-open");q("layers-toggle").setAttribute("aria-expanded","false");
    changed();
  };
  root.querySelectorAll("[data-ce-text-preset]").forEach(button=>button.onclick=()=>{
    if(!canEdit())return;
    inline.finish();history.record();const item=text();Object.assign(item,textPreset(button.dataset.ceTextPreset));changed();
  });
  for(const [id,key] of [["effect-strength","amount"],["effect-color","color"]]){
    q(id).onfocus=()=>history.record();
    q(id).oninput=()=>{
      const item=layer();if(!canEdit()||item?.kind!=="text"||item.locked)return;
      item.textEffect={name:"plain",amount:.6,color:"#b51e29",...item.textEffect,[key]:key==="amount"?Number(q(id).value)/100:q(id).value};changed(false);
    };
  }
  q("blend").onchange=()=>{
    const item=layer();if(!canEdit()||!item||item.locked||!BLEND_MODES.includes(q("blend").value))return;
    history.record();item.blendMode=q("blend").value;changed(false);
  };
  root.querySelectorAll("[data-ce-studio-open]").forEach(button=>button.onclick=()=>{
    if(!canEdit())return;
    const action=button.dataset.ceStudioOpen;
    if(["text-style","text-presets","text-animation"].includes(action)){
      inline.finish();text();changed();inspector();
      (action==="text-animation"?q("animation"):action==="text-style"?q("font"):root.querySelector(".ce-presets")).scrollIntoView({block:"nearest"});
    }else if(["source","layers"].includes(action))q(action==="layers"?"layers-toggle":"source-toggle").click();
    else if(["color","crop"].includes(action))root.querySelector(`[data-ce-media-tool="${action}"]`).click();
    else if(action==="draw")q("draw").click();
    else if(["order","timing","blend"].includes(action)){if(!layer())return;inspector();q(action==="order"?"forward":action==="timing"?"start":"blend").focus();}
    else if(action==="guides"){q("safe").checked=!q("safe").checked;q("safe").dispatchEvent(new Event("change"));}
    else if(action==="pages"){q("page-tools").hidden=false;q("pages").focus();try{q("pages").showPicker?.();}catch{}}
    else if(action==="aspect"||action==="canvas-color"){
      if(q("style-toggle").getAttribute("aria-expanded")!=="true")q("style-toggle").click();
      q(action).focus();try{q(action).showPicker?.();}catch{}
    }
  });
  depth.onclick=async()=>{
    if(!canEdit())return;
    inline.finish();mediaTools.finishCrop(true);stop();
    const asset=assets.get(project.background.media);
    try{
      setBusy(true);status("Isolating the person for a real foreground layer…");error("");
      const blob=await photoSubjectBlob({asset,project,container:assets.container,alive});if(!alive())return;
      const media=rememberBlob(blob);await assets.load(media);if(!alive())return;
      let item=project.layers.find(value=>value.kind==="text"&&!value.locked)||add(createLayer("text",{text:"Your title",font:"Georgia",fontSize:144,backgroundOn:false}));
      // Keep the title below the foreground; later Bring forward / Send back stays editable.
      add(createLayer("image",{media,width:project.width,height:project.height,x:.5,y:.5,subjectCutout:true}));
      setSelected(item.id);status("Text is behind the person. Move your title or use layer order to bring it in front.");
    }catch(failure){if(alive())error(failure);}
    finally{setBusy(false);if(alive())changed();}
  };
  const refresh=()=>{
    capture.refresh();
    q("workspace").disabled=!canEdit();
    const captureLabel=q("capture-label");
    if(captureLabel)captureLabel.textContent=`${q("destination").value==="story"?"Story · ":""}${editor.classList.contains("is-camera-video")?"Video":"Photo"}`;
    const animated=project.layers.some(item=>item.animation&&item.animation!=="none"||assets.items.get(item.media)?.frames);
    editor.classList.toggle("is-static-photo",project.background.kind==="photo"&&!animated&&!assets.items.get(project.background.media)?.frames);
    cameraButton.disabled=q("camera").disabled;
    const item=layer(),effect=item?.textEffect;
    q("effect-strength").value=Math.round((effect?.amount??.6)*100);q("effect-color").value=effect?.color||"#b51e29";q("blend").value=item?.blendMode||"source-over";
    q("blend").disabled=!item||item.locked||!canEdit();
    for(const id of ["effect-strength","effect-color"])q(id).disabled=item?.kind!=="text"||item.locked||!canEdit();
    root.querySelectorAll("[data-ce-text-preset]").forEach(button=>{
      const selected=button.dataset.ceTextPreset===(effect?.name||"plain");button.setAttribute("aria-pressed",String(selected));button.classList.toggle("on",selected);button.disabled=!canEdit()||!!item?.locked;
    });
    root.querySelectorAll("[data-ce-photo-preset]").forEach(button=>button.disabled=!canEdit()||!assets.get(project.background.media));
    depth.disabled=!canEdit()||project.background.kind!=="photo"||!assets.get(project.background.media);
    depth.title=project.background.kind!=="photo"?"Capture or upload a portrait photo first.":"Create an editable foreground cutout above your text.";
  };
  refresh();return {refresh,capturePhoto:capture.capturePhoto,captureMode:capture.mode,selectCaptureMode:capture.select,
    captureSnapshot:capture.snapshot,restoreCapture:capture.restore,flushCapture:capture.flushShots};
}
