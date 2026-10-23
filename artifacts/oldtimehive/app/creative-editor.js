import "./creative-editor.css";
import "./creative-overlay.css";
import { bindViewport, bindSheets } from "./creative-overlay.js";
import { api } from "./store.js";
import { icon } from "./icons.js";
import { openEmojiPicker, closeEmojiPicker } from "./emoji.js";
import { renderCreativeEditor } from "./creative-editor-view.js";
import { createProject, createLayer, duplicateLayer, moveLayer, clamp, setProjectDuration, keepLayerInFrame, ProjectHistory, projectScenes } from "./creative-project.js";
import { putLocalMedia } from "./local-media.js";
import { CreativeAssets, drawProject } from "./creative-renderer.js";
import { bindCreativeGestures } from "./creative-gestures.js";
import { commentSource, resolveCommentSource, validateProjectSources, validateProjectAudience, publishCreativeProject } from "./creative-content.js";
import { publishRenderedPost, originalPublicationMedia } from "./media-publication.js";
import { videoMime, canvasBlob, exportCreativeVideo } from "./creative-export.js";
import { bindInlineText } from "./creative-inline-text.js";
import { bindCreativeTools } from "./creative-editor-tools.js";
import { bindCreativePages } from "./creative-pages.js";
import { bindMediaEditor } from "./creative-media-editor.js";
import { initVideoEdit, syncVideoEdit } from "./creative-video-edit.js";
import { waitForVideoFrame } from "./remix-video.js";
import { createCameraStrip } from "./creative-camera-strip.js";
import { bindToolsTheme } from "./creative-controls-palette.js";
import { naturalZoom, cameraConstraints, captureFrame, zoomFromPinch, distance } from "./creative-capture-geometry.js";
import {bindCreativeStudio} from "./creative-studio.js";
import { openPlacePicker } from "./place-picker.js";
import { prepareCreativeDraft, restoreCreativeDraft, saveCreativeDraft, loadCreativeDraft, deleteCreativeDraft } from "./creative-drafts.js";
import { shouldAutoStartCamera } from "./creative-editor-startup.js";

let currentEditor = null;
export function closeCreativeEditor() { currentEditor?.(); }
export function openCreativeEditor({ postId, commentId, destination = "post", startCamera = false, startStudio = false, startShare = false, background = null, caption = "", location = "", visibility, heyWord = null, esc, icons, toast = () => {}, onClose, onPosted, onSave, saveLabel = "Save", initialProject } = {}) {
  closeCreativeEditor();
  if (heyWord?.prompt) destination = "story";
  if (!["post", "community", "story"].includes(destination)) destination = "post";
  const openedInCommunity = destination === "community";
  let source;
  try { source = postId && commentId ? commentSource(postId, commentId) : null; }
  catch (error) { toast(error.message); return; }
  const ownerId = api.me()?.id;
  if (!ownerId) { toast("Sign in to create a remix."); return; }
  const project = createProject(source), assets = new CreativeAssets(), blobs = new Map();
  if((startCamera||startStudio)&&!source&&!initialProject&&!background?.media)project.background.color="#0d0e11";
  if(initialProject)Object.assign(project,structuredClone(initialProject));
  const history = new ProjectHistory(project);
  const root = document.createElement("div"); root.innerHTML = renderCreativeEditor({ destination, hasSource: !!source, esc, icons });
  document.body.appendChild(root);
  const editor = root.firstElementChild, q = name => root.querySelector("#ce-" + name), canvas = q("canvas");
  q("destination").value=destination;
  if(startStudio)q("workspace").value="studio";
  const syncHeyWordControls = () => {
    const active = q("destination").value === "story" && q("sticker-kind").value === "hey-word";
    q("hey-word-controls").hidden = !active;
    q("hey-word-field").hidden = !active || !q("hey-word-enabled").checked;
  };
  if (heyWord?.prompt) {
    q("sticker-kind").value = "hey-word";
    q("hey-word-enabled").checked = true;
    q("hey-word-enabled").disabled = true;
    q("hey-word-prompt").value = String(heyWord.prompt).slice(0, 120);
    q("hey-word-prompt").readOnly = true;
    q("hey-word-note").textContent = heyWord.creditHidden
      ? "You’re responding to this prompt. The starter’s identity stays private."
      : `You’re responding to @${heyWord.startedByHandle || "member"}’s Oldtime prompt.`;
  }
  syncHeyWordControls();
  q("destination").addEventListener("change", syncHeyWordControls);
  q("sticker-kind").addEventListener("change", syncHeyWordControls);
  q("hey-word-enabled").addEventListener("change", syncHeyWordControls);
  const unbindTheme=bindToolsTheme(editor);
  editor.insertBefore(root.querySelector(".ce-crop-bar"),root.querySelector(".ce-body"));
  const mediaHost=document.createElement("div");mediaHost.setAttribute("aria-hidden","true");
  mediaHost.style.cssText="position:absolute;width:1px;height:1px;opacity:.01;pointer-events:none;overflow:hidden";
  root.append(mediaHost);assets.container=mediaHost;
  for(const [id,selector] of [["source-toggle",".ce-source"],["style-toggle","#ce-inspector"],["share-toggle",".ce-share"]]){
    q(id).setAttribute("aria-expanded","false");root.querySelector(selector).classList.add("is-collapsed");
  }
  if (heyWord?.prompt) {
    q("stickers").hidden = false;
  }
  const oldOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";
  const viewport = bindViewport({ editor });
  let selectedId = project.layers[0]?.id || null, time = 0, measurements = new Map(), raf;
  let closed = false, busy = false, recording = null, live = null, facing = "user", drawing = false, preview = false, playing = false,cameraMode="photo",cameraOpen=false;
  let playbackStart = 0, recordingStart = 0, inline, tools, pages, mediaTools,studioTools, previousCamera = null, captureTimer = null, cameraRequest = 0;
  let sheets=null,quoteReturn=null,quoteDraft=null,quoteCaption="";
  const draftContext=source?`remix:${postId}:${commentId}`:destination==="community"?"create:community":"create:camera";
  const replaceProject=value=>{for(const key of Object.keys(project))delete project[key];Object.assign(project,structuredClone(value));};
  const layer = () => project.layers.find(item => item.id === selectedId);
  const status = () => { /* Helper copy is intentionally not shown over the canvas. */ };
  const error = value => { q("error").textContent = value?.message || String(value || ""); };
  const render = at => {
    const size=mediaTools?.cropActive?mediaTools.cropSize():project;
    if(canvas.width!==size.width)canvas.width=size.width;
    if(canvas.height!==size.height)canvas.height=size.height;
    editor.style.setProperty("--ce-ratio",`${size.width}/${size.height}`);
    editor.style.setProperty("--ce-ratio-num",size.width/size.height);
    editor.classList.toggle("is-typing",!!inline?.active());
    const wrap=root.querySelector(".ce-stage-wrap"),available=Math.max(80,wrap.clientHeight-root.querySelector(".ce-transport").offsetHeight-16);
    editor.style.setProperty("--ce-stage-width",`${Math.min(wrap.clientWidth-16,available*size.width/size.height)}px`);
    if(mediaTools?.cropActive){mediaTools.drawCrop(canvas);measurements=new Map();return;}
    measurements = drawProject(canvas, project, assets, resolveCommentSource, at, preview || busy ? null : selectedId);
    if (!project.allowOutside && !drawing && !preview && !busy) {
      let moved = false;
      for (const item of project.layers) if(!item.subjectCutout)moved = keepLayerInFrame(item, measurements.get(item.id), project) || moved;
      if (moved) measurements = drawProject(canvas, project, assets, resolveCommentSource, at, selectedId);
    }
    inline?.sync();
  };
  let strip=null;
  const rememberBlob = blob => { const url = URL.createObjectURL(blob); blobs.set(url, blob); return url; };
  const backgroundVideo = () => assets.get(project.background.media)?.tagName === "VIDEO" ? assets.get(project.background.media) : null;
  const stopLive = () => {
    for (const track of live?.getTracks() || []) track.stop();
    live = null; q("record").disabled = true; q("photo").disabled = true; q("flip").hidden = true;
    clearInterval(captureTimer); captureTimer=null;
  };
  const stopPlayback = () => { playing = false;if(!live)backgroundVideo()?.pause();q("play").innerHTML = icon("play") || "Play"; };
  const refreshControls = () => {
    root.inert=busy;editor.setAttribute("aria-busy",String(busy));
    editor.classList.toggle("has-live-camera",!!live);
    editor.classList.toggle("is-camera-open",cameraOpen);editor.classList.toggle("is-camera-video",cameraMode==="video");editor.classList.toggle("is-capturing",!!recording);
    q("empty").hidden=!!live||!!project.background.media||project.layers.length>0||editor.classList.contains("is-quote");
    q("photo").setAttribute("aria-pressed",String(cameraMode==="photo"));q("record").setAttribute("aria-pressed",String(cameraMode==="video"));
    q("shutter").setAttribute("aria-label",recording?"Stop recording video":cameraMode==="photo"?"Take photo":"Start recording video");
    const track=live?.getVideoTracks()[0],caps=track?.readyState==="live"?track.getCapabilities?.()||{}:{};
    q("flash").disabled=!caps.torch;q("zoom").disabled=!caps.zoom;
    q("publish").disabled = busy || !!live || !project.layers.length && !project.background.media;
    if(editor.classList.contains("is-quote")&&!project.layers.some(item=>item.kind==="text"&&item.text.trim()))q("publish").disabled=true;
    q("export").disabled = q("publish").disabled;
    q("save-exit").disabled=busy||!!recording||!!captureTimer;
    q("save-exit").title=recording?"Stop recording before saving.":"Save without sharing.";
    q("save-exit").setAttribute("aria-describedby","ce-save-hint");
    q("upload").disabled = busy || !!recording;
    q("camera").disabled = busy || !!recording;
    q("flip").disabled = busy || !!recording;
    q("record").disabled = q("photo").disabled = busy || !!recording || !!captureTimer;
    q("shutter").disabled = track?.readyState!=="live" || busy || !!captureTimer;
    q("pages").disabled=busy||!!live;q("remove-page").disabled=busy||!!live;
    q("undo").disabled = !!live || busy || !history.past.length;
    q("redo").disabled = !!live || busy || !history.future.length;
    q("preview").disabled = busy || !!recording;
    q("scrub").max = project.duration;
    q("empty").hidden = !!project.layers.length || !!project.background.media;
    q("time").textContent = `${time.toFixed(1)} / ${project.duration.toFixed(1)}s`;
    q("scrub").value = time;
    q("draw").setAttribute("aria-pressed", String(drawing));
    q("draw-controls").hidden = !drawing;
    mediaTools?.refresh();
    studioTools?.refresh();
  };
  const updateInspector = () => {
    const item = layer(); q("inspector").hidden = !item;
    tools?.refresh();
    if (!item) return;
    q("text-fields").hidden = item.kind !== "text";
    const editableSticker = item.kind === "sticker" && ["reaction","location","mention","hashtag","music","question","poll","emoji","custom-text"].includes(item.sticker);
    q("sticker-edit-fields").hidden = !editableSticker;
    q("sticker-edit-poll").hidden = !editableSticker || item.sticker !== "poll";
    q("sticker-edit-text").value = item.text || "";
    q("sticker-edit-choice-a").value = item.choices?.[0] || "Yes";
    q("sticker-edit-choice-b").value = item.choices?.[1] || "No";
    q("sticker-edit-accent").value = item.color || "#e5262f";
    q("sticker-edit-surface").value = item.background || "#f4f1ec";
    q("sticker-edit-help").textContent = "";
    for (const [name, value] of Object.entries({ text: item.text || "", font: item.font || "Manrope", align: item.align || "center",
      color: item.color || "#ffffff", background: item.background || "#17191d", opacity: item.opacity, scale: item.scale,
      rotation: item.rotation, start: item.startTime, end: item.endTime })) q(name).value = value;
    q("background-on").checked = !!item.backgroundOn;
    q("start").max = project.duration; q("end").max = project.duration;
  };
  const refreshLayers = () => {
    q("layer-list").replaceChildren();
    [...project.layers].reverse().forEach((item, index) => {
      const button = document.createElement("button"); button.type = "button";
      button.textContent = (item.locked ? "Locked · " : item.hidden ? "Hidden · " : "") + (item.kind === "comment" ? "Original comment" : item.kind === "text" ? item.text.slice(0, 24) || "Text" : item.kind === "image" ? item.subjectCutout?"Subject cutout":"Image / GIF" : item.kind === "drawing" ? "Drawing" : item.kind === "sticker" ? item.sticker : "Emoji");
      button.dataset.layerId = item.id; button.setAttribute("aria-selected", String(selectedId === item.id));
      button.onclick = () => { inline?.finish(); selectedId = item.id; drawing = false; if (time < item.startTime || time > item.endTime) seek(item.startTime); changed(); };
      button.ondblclick = () => inline.edit(item);
      q("layer-list").appendChild(button);
    });
  };
  const changed = (full = true) => {
    if (closed) return;
    if (full) { refreshLayers(); updateInspector(); pages?.refresh(); }
    refreshControls(); render(time);
  };
  const revealStickerEditor = item => {
    if(item?.kind!=="sticker")return;
    q("inspector").classList.remove("is-collapsed");
    q("style-toggle").setAttribute("aria-expanded","true");
  };
  const select = id => { if (id!==selectedId) inline?.finish(); selectedId = id; changed(); revealStickerEditor(project.layers.find(item=>item.id===id)); };
  const remove = () => { if(layer()?.locked)return; history.record(); inline?.finish(); project.layers = project.layers.filter(item => item.id !== selectedId); selectedId = null; changed(); };
  const seek = value => {
    stopPlayback(); time = clamp(value, 0, project.duration);
    const video = backgroundVideo(); if(video&&!live){if(project.background.videoEdit)syncVideoEdit(video,project.background,time);else video.currentTime=Math.min(time,Math.max(0,video.duration-.01));}
    refreshControls(); render(time);
  };
  const options = () => {
    q("inspector").classList.remove("is-collapsed");q("style-toggle").setAttribute("aria-expanded","true");changed();
    q("duplicate").scrollIntoView({block:"nearest",behavior:"smooth"});q("duplicate").focus({preventScroll:true});
  };
  const unbind = bindCreativeGestures(canvas, { project, measurements: () => measurements, time: () => time, selected: () => selectedId,
    select, changed, trash: q("trash"), remove, options, drawing: () => drawing ? { color: q("draw-color").value, width: Number(q("draw-width").value), opacity:Number(q("draw-opacity").value), mode:q("brush").value } : null,
    checkpoint:()=>history.record(), editText:item=>inline.edit(item),
    background:()=>{
      const media=project.background.media,item=media&&media!=="live-camera"&&!live&&!preview&&!busy&&!recording&&!mediaTools?.cropActive?assets.get(media):null;
      const w=item?.videoWidth||item?.naturalWidth||item?.width,h=item?.videoHeight||item?.naturalHeight||item?.height;
      return w&&h?{rect:{x:0,y:0,width:1,height:1,...project.background.crop},asset:{w,h}}:null;
    },
    setCrop:rect=>{project.background.crop={...rect};},
    preview: () => preview || busy || !!recording || !!captureTimer || !!mediaTools?.cropActive });
  const close = (posted = false) => {
    if (closed) return;
    closed = true; playing = false; cancelAnimationFrame(raf); unbind();unbindTheme();mediaTools?.dispose();
    if (recording?.state !== "inactive") recording?.stop();
    stopLive(); closeEmojiPicker(); assets.dispose();
    strip?.dispose();
    for (const url of blobs.keys()) URL.revokeObjectURL(url);
    document.removeEventListener("keydown", keyboard); window.removeEventListener("pagehide", pagehide);
    window.removeEventListener("beforeunload",beforeunload);
    viewport.dispose(); sheets?.dispose(); document.body.style.overflow = oldOverflow;
    root.remove(); currentEditor = null;
    if (!posted) onClose?.();
  };
  currentEditor = close;
  const pagehide = () => close(true);
  window.addEventListener("pagehide", pagehide);
  const sceneHasContent=scene=>!!(scene&&(scene.layers?.some(item=>item.kind!=="text"||item.text?.trim())||
    scene.background?.media&&scene.background.media!=="live-camera"||scene.pages?.some(sceneHasContent)));
  const hasContent=()=>!!(sceneHasContent(project)||sceneHasContent(quoteReturn?.project)||sceneHasContent(quoteDraft)||
    previousCamera?.background.media||studioTools?.captureSnapshot().shots.length||q("caption").value.trim());
  const beforeunload=event=>{if(!closed&&hasContent()){event.preventDefault();event.returnValue="";}};
  window.addEventListener("beforeunload",beforeunload);
  const hideExit=()=>{q("exit-dialog").hidden=true;editor.querySelectorAll(":scope > :not(#ce-exit-dialog)").forEach(node=>node.inert=false);q("save-exit").focus();};
  const showExit=()=>{
    if(!hasContent()){close();return;}
    inline?.finish();q("exit-dialog").hidden=false;
    editor.querySelectorAll(":scope > :not(#ce-exit-dialog)").forEach(node=>node.inert=true);
    q("exit-save").focus();
  };
  const keyboard = event => {
    if (document.querySelector(".emoji-overlay")) return;
    if(!q("exit-dialog").hidden&&event.key==="Escape"){event.preventDefault();hideExit();return;}
    if(event.key==="Escape"){event.preventDefault();navigateBack();}
    if (event.key === "Tab") {
      const host=q("exit-dialog").hidden?root:q("exit-dialog");
      const controls = [...host.querySelectorAll("button,input,textarea,select")].filter(el => !el.disabled && !el.closest("[hidden]") && el.getClientRects().length);
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }
  };
  document.addEventListener("keydown", keyboard);
  q("close").onclick = () => {
    if(editor.classList.contains("is-studio")){showExit();return;}
    navigateBack();
  };
  q("back").onclick = () => navigateBack();
  q("exit-cancel").onclick=hideExit;
  q("exit-save").onclick=()=>{hideExit();void saveAndExit();};
  q("exit-discard").onclick=async()=>{
    if(busy)return;
    busy=true;refreshControls();
    try{if(!onSave)await deleteCreativeDraft(ownerId,draftContext);close();}
    catch(failure){busy=false;hideExit();error(failure);changed();}
  };
  q("save-exit").onclick=()=>void saveAndExit();
  async function saveAndExit(){
    if(busy||recording||captureTimer)return;
    mediaTools.finishCrop(true);inline.finish();pages.flush();
    if(!hasContent()){close();return;}
    if(onSave){
      studioTools.flushCapture();
      ++cameraRequest;stopLive();cameraOpen=false;
      if(previousCamera){project.background=previousCamera.background;setProjectDuration(project,previousCamera.duration);previousCamera=null;}
      changed();await q("publish").onclick();return;
    }
    busy=true;stopPlayback();refreshControls();error("");status("Saving your draft…");
    try{
      if(api.me()?.id!==ownerId)throw new Error("This editing session has ended.");
      const scene=structuredClone(project);
      if(scene.background.media==="live-camera"){
        scene.background=structuredClone(previousCamera?.background||{kind:"color",color:"#f2f3f5"});
        scene.duration=previousCamera?.duration||5;
      }
      if(scene.pages?.length)scene.pages[scene.activePage||0]={...structuredClone(scene),pages:undefined,activePage:undefined};
      const state={caption:q("caption").value,location:q("location").value,visibility:q("visibility").value,
        destination:q("destination").value,workspace:q("workspace").value,capture:studioTools.captureSnapshot(),
        quoteReturn:quoteReturn?{...quoteReturn,past:[],future:[]}:null,
        quoteDraft,quoteCaption,isQuote:editor.classList.contains("is-quote"),selectedId,time};
      await saveCreativeDraft(ownerId,draftContext,prepareCreativeDraft(scene,state,blobs));
      if(!closed){close();toast("Draft saved to your account");}
    }catch(failure){if(!closed){busy=false;error(failure);status("Your edit is still here. Nothing was shared.");changed();}}
  }
  function navigateBack(){
    if(busy||recording||captureTimer)return;
    if(mediaTools?.cropActive){mediaTools.finishCrop(false);return;}
    if(cameraOpen){showExit();return;}
    if(sheets?.dismissAll())return;
    if(quoteReturn){
      inline.finish();quoteDraft=structuredClone(project);quoteCaption=q("caption").value;
      const saved=quoteReturn;quoteReturn=null;replaceProject(saved.project);
      previousCamera=null;selectedId=saved.selectedId;time=saved.time;
      history.past=saved.past;history.future=saved.future;
      editor.classList.remove("is-quote");q("title").textContent="Create";
      q("inline-text").setAttribute("aria-label","Text on media");
      q("destination").value=["post","community","story"].includes(saved.destination)?saved.destination:"post";syncDestinationChoice();q("caption").value=saved.caption;
      q("workspace").value=saved.workspace;q("workspace").onchange();
      studioTools.selectCaptureMode(saved.mode);pages.reset();changed();
      if(saved.cameraOpen||!source&&!onSave&&!project.background.media)void camera();
      return;
    }
    if(inline?.active()){inline.finish();changed();return;}
    const openMenus=root.querySelectorAll("details[open]");
    if(openMenus.length){openMenus.forEach(menu=>menu.open=false);return;}
    if(!q("media-panel").hidden){q("media-close").click();return;}
    if(editor.classList.contains("is-studio")){q("workspace").value="camera";q("workspace").onchange();workspaceChanged();return;}
    if(!cameraOpen&&!source&&!onSave){void camera();return;}
    showExit();
  }
  const loadSources = async () => {
    const current = source ? resolveCommentSource(source) : null;
    if (!current) return;
    const resources = [current.author.avatar, current.comment.attachment?.url].filter(Boolean);
    await Promise.all(resources.map(key => assets.load(key).catch(() => {})));
    if (!closed) changed(false);
  };
  const setBackground = async (file, kind) => {
    if (closed) return;
    const wasMirrored=!!project.background.mirror;
    const cameraEdits=project.background.media==="live-camera"?{crop:project.background.crop,adjustments:project.background.adjustments}:null;
    const value = typeof file === "string" && /^data:(image|video)\//.test(file) ? await (await fetch(file)).blob() : file;
    const media = typeof value === "string" ? value : rememberBlob(value);
    const item = await assets.load(media, kind === "video" ? "video" : "image");
    if (closed) return;
    stopPlayback();
    if (previousCamera) { project.background=previousCamera.background; setProjectDuration(project,previousCamera.duration); previousCamera=null; }
    history.record(); stopLive();cameraOpen=false;
    project.background = { kind, media, color: q("canvas-color").value,...cameraEdits };
    if(!cameraEdits||kind!=="video")delete project.background.mirror;else if(wasMirrored)project.background.mirror=true;
    setProjectDuration(project, kind === "video" ? Math.min(60, item.creativeDuration || item.duration) : 5);
    if(kind==="video")initVideoEdit(project.background,item.creativeDuration||item.duration);
    time = 0; changed(); status(kind === "video" ? "Video ready. Edit on screen or choose a tool below." : "Photo ready. Edit directly on screen.");
  };
  strip=createCameraStrip({host:q("camera-strip"),uploadHost:q("camera-gallery-slot"),onUpload:()=>{if(!busy&&!recording&&!captureTimer)q("upload").click();},
    onPick:async url=>{
      const blob=blobs.get(url);if(!blob||busy||recording||captureTimer)return;
      try{busy=true;inline?.finish();error("");refreshControls();
        await setBackground(blob,"photo");
      }catch(failure){error(failure);}finally{busy=false;if(!closed)changed();}
    }});
  q("upload").onchange = async event => {
    const files = [...event.target.files]; event.target.value = ""; if (!files.length) return;
    if (editor.classList.contains("is-quote")) {
      if (files.length !== 1 || !files[0].type.startsWith("image/")) {
        return error("Choose one supported photo for this quote.");
      }
      try {
        busy = true; inline.finish(); error(""); refreshControls();
        await setBackground(files[0], "photo");
        status("Photo added to quote. Adjust the text and share when ready.");
      } catch (failure) {
        error(failure);
      } finally {
        busy = false;
        if (!closed) changed();
      }
      return;
    }
    if(files.length>10)return error("Choose up to 10 photos or videos.");
    if (files.some(file=>!/^(image|video)\//.test(file.type))) return error("Choose supported photos or videos.");
    try {
      busy = true; inline.finish(); error(""); refreshControls(); await setBackground(files[0], files[0].type.startsWith("video/") ? "video" : "photo");
      for(const file of files.slice(1)){
        const media=rememberBlob(file),video=file.type.startsWith("video/"),asset=await assets.load(media,video?"video":"image");
        if(!video)strip?.add(media);
        const scene=createProject(source);scene.background={kind:video?"video":"photo",media,color:project.background.color};
        setProjectDuration(scene,video?asset.creativeDuration||asset.duration:5);pages.append(scene);
      }
      pages.flush();pages.refresh();root.querySelector(".ce-source").classList.add("is-collapsed");q("source-toggle").setAttribute("aria-expanded","false");
    }
    catch (failure) { error(failure); } finally { busy = false; if (!closed) changed(); }
  };
  const camera = async () => {
    if (closed || busy || recording) return;
    cameraOpen=true;refreshControls();
    if (!navigator.mediaDevices?.getUserMedia) return error("Camera is unavailable. Upload a photo or video instead.");
    try {
      error(""); const request=++cameraRequest;
      editor.classList.add("is-camera-pending");
      // Mobile cameras may not open the other lens while the first is active.
      if(live){backgroundVideo()?.pause();live.getTracks().forEach(track=>track.stop());refreshControls();}
      const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(facing));
      if (closed || request!==cameraRequest) { stream.getTracks().forEach(track => track.stop()); return; }
      if(!previousCamera)previousCamera={background:structuredClone(project.background),duration:project.duration};
      stopPlayback(); stopLive(); live = stream;
      const video = document.createElement("video"); video.playsInline = true; video.muted = true;video.setAttribute("playsinline","");video.srcObject = stream;mediaHost.append(video);await video.play();await waitForVideoFrame(video);
      if(closed||request!==cameraRequest){stream.getTracks().forEach(track=>track.stop());video.remove();return;}
      assets.items.set("live-camera", video);
      project.background = { kind: "video", media: "live-camera", color: "#17191d", mirror: facing === "user" };q("zoom").value=1;
      q("record").disabled = false; q("photo").disabled = false; q("flip").hidden = false; time = 0;
      const caps=stream.getVideoTracks()[0]?.getCapabilities?.()||{};
      q("flash").disabled=!caps.torch;q("zoom").disabled=!caps.zoom;
      if(caps.zoom){q("zoom").min=caps.zoom.min;q("zoom").max=caps.zoom.max;const z=naturalZoom(caps.zoom.min,caps.zoom.max);q("zoom").value=z;if(stream.getVideoTracks()[0].getSettings?.().zoom!==z)void stream.getVideoTracks()[0].applyConstraints({advanced:[{zoom:z}]}).catch(()=>{});}
      status("Choose Photo or Video, then press the circle to capture."); changed();
      root.querySelector(".ce-source").classList.add("is-collapsed");q("source-toggle").setAttribute("aria-expanded","false");
      editor.classList.remove("is-camera-pending");
    } catch (failure) {
      editor.classList.remove("is-camera-pending");
      stopLive(); if(previousCamera){project.background=previousCamera.background;setProjectDuration(project,previousCamera.duration);previousCamera=null;}
      error(failure.name === "NotAllowedError" ? "Allow camera access, or upload a file." : "Camera unavailable. Upload a photo or video instead."); changed();
    }
  };
  q("camera").onclick = camera;
  q("flip").onclick = () => { facing = facing === "user" ? "environment" : "user"; void camera(); };
  const countdown=action=>{
    const delay=Number(q("camera-timer").value);if(!delay){void action();return;}
    let remaining=delay;status(`Capturing in ${remaining}…`);
    captureTimer=setInterval(()=>{if(closed||!live){clearInterval(captureTimer);captureTimer=null;return;}remaining--;
      if(remaining<=0){clearInterval(captureTimer);captureTimer=null;void action();}else status(`Capturing in ${remaining}…`);
    },1000);refreshControls();
  };
  const pinch=new Map();let pinchStart=null;
  const zoomTo=value=>{const track=live?.getVideoTracks()[0];if(!track||q("zoom").disabled)return;q("zoom").value=value;void track.applyConstraints({advanced:[{zoom:value}]}).catch(()=>{});};
  canvas.addEventListener("pointerdown",e=>{if(!live||q("zoom").disabled||busy||captureTimer||!cameraOpen)return;pinch.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pinch.size===2){const [a,b]=[...pinch.values()];pinchStart={d:distance(a,b),z:Number(q("zoom").value)};}});
  canvas.addEventListener("pointermove",e=>{if(!pinch.has(e.pointerId))return;pinch.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pinch.size===2&&pinchStart){e.preventDefault();const [a,b]=[...pinch.values()];zoomTo(zoomFromPinch(pinchStart.z,pinchStart.d,distance(a,b),Number(q("zoom").min),Number(q("zoom").max)));}});
  const endPinch=e=>{pinch.delete(e.pointerId);if(pinch.size<2)pinchStart=null;};
  canvas.addEventListener("pointerup",endPinch);canvas.addEventListener("pointercancel",endPinch);
  q("flash").onclick=async()=>{
    const track=live?.getVideoTracks()[0];if(!track)return;
    const on=q("flash").getAttribute("aria-pressed")!=="true";
    try{await track.applyConstraints({advanced:[{torch:on}]});q("flash").setAttribute("aria-pressed",String(on));}catch{error("Flash is unavailable on this camera.");}
  };
  q("zoom").oninput=()=>{const track=live?.getVideoTracks()[0];if(track)void track.applyConstraints({advanced:[{zoom:Number(q("zoom").value)}]}).catch(()=>error("Zoom is unavailable on this camera."));};
  const capturePhoto=async()=>{
    const video=assets.get("live-camera");if(!live||!video?.videoWidth)return;
    try{busy=true;refreshControls();const photo=captureFrame(document.createElement("canvas"),video,project.width,project.height,facing);const blob=await canvasBlob(photo);
      await setBackground(blob,"photo");
    }catch(failure){error(failure);}finally{busy=false;if(!closed)changed();}
  };
  q("photo").onclick=()=>{if(recording||busy||captureTimer)return;cameraMode="photo";refreshControls();};
  q("record").onclick=()=>{if(recording||busy||captureTimer)return;cameraMode="video";refreshControls();};
  const recordVideo = async () => {
    if (recording) { recording.stop(); return; }
    if (!live || busy) return;
    try {
      busy=true;refreshControls();
      if(!live.getAudioTracks().length){
        try{const audio=await navigator.mediaDevices.getUserMedia({audio:true});if(closed||!live){audio.getTracks().forEach(track=>track.stop());return;}audio.getAudioTracks().forEach(track=>live.addTrack(track));}
        catch{error("Microphone unavailable. This video will be recorded without sound.");}
      }
      const chunks = [], recorder = new MediaRecorder(live, { mimeType: videoMime(), videoBitsPerSecond: 8_000_000 });
      busy=false;
      recording = recorder; recordingStart = performance.now();
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { error("Recording failed. Upload a video or try again."); recording = null; refreshControls(); };
      recorder.onstop = async () => {
        const duration = Math.min(60, (performance.now() - recordingStart) / 1000);
        recording = null; if (closed) return;
        busy = true; refreshControls();
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType }); if (!blob.size) throw new Error("The recording was empty.");
          await setBackground(blob, "video");
          // Some WebM recorders omit the container duration. Retain the measured recording duration.
          setProjectDuration(project,duration);
          const asset=backgroundVideo();if(asset)asset.creativeDuration=project.duration;
          delete project.background.videoEdit;initVideoEdit(project.background,project.duration);
          time=0;status("Recording ready. Preview it before sharing.");
        } catch (failure) { error(failure); }
        finally { busy = false; if (!closed) changed(); }
      };
      recorder.start(200);refreshControls();status("Recording underneath your layers…");
    } catch (failure) { busy=false;error(failure); recording = null; refreshControls(); }
  };
  q("shutter").onclick=()=>{
    if(recording){if(recording.state!=="inactive")recording.stop();q("shutter").disabled=true;return;}
    if(!live||busy||captureTimer)return;
    countdown(cameraMode==="photo"?capturePhoto:recordVideo);
  };
  const add = item => {
    mediaTools?.finishCrop(true);
    inline?.finish(); history.record();
    item.endTime = project.duration; project.layers.push(item); selectedId = item.id; drawing = false; changed(); revealStickerEditor(item); return item;
  };
  inline = bindInlineText({ input:q("inline-text"),done:q("text-done"),canvas,project,layer,history,changed });
  tools = bindCreativeTools({root,q,project,layer,history,inline,add,changed,seek,setSelected:id=>{selectedId=id;}});
  pages = bindCreativePages({q,project,history,changed,seek,setSelected:id=>{selectedId=id;}});
  mediaTools=bindMediaEditor({root,editor,q,project,assets,history,changed,seek,time:()=>time,stop:stopPlayback,
    canEdit:()=>!busy&&!recording&&!captureTimer,inline,error});
  studioTools=bindCreativeStudio({root,editor,q,project,assets,history,inline,mediaTools,add,layer,setSelected:id=>selectedId=id,
    changed,stop:stopPlayback,error,status,rememberBlob,setBusy:value=>{busy=value;refreshControls();},
    alive:()=>!closed&&api.me()?.id===ownerId,canEdit:()=>!busy&&!recording&&!captureTimer,
    finishCarousel:scenes=>{
      history.record();stopLive();cameraOpen=false;previousCamera=null;
      Object.assign(project,structuredClone(scenes[0]));project.pages=structuredClone(scenes);project.activePage=0;
      selectedId=null;time=0;pages.reset();changed();status("Carousel ready. Edit each photo before sharing.");
    }});
  const workspaceChanged=()=>{
    if(q("workspace").value==="studio"){
      if(live||cameraOpen){++cameraRequest;stopLive();cameraOpen=false;
        if(previousCamera){project.background=previousCamera.background;setProjectDuration(project,previousCamera.duration);previousCamera=null;}
        changed();}
    }else if(!live&&!cameraOpen&&!source&&!onSave&&!editor.classList.contains("is-quote")&&!project.background.media)void camera();
  };
  q("workspace").addEventListener("change",workspaceChanged);
  if(startStudio)q("workspace").dispatchEvent(new Event("change"));
  sheets = bindSheets({ root, editor, q });
  if (heyWord?.prompt) requestAnimationFrame(() => {
    const flow = q("sticker-flow");
    if (flow) flow.scrollLeft = flow.clientWidth;
  });
  root.querySelectorAll("[data-ce-add]").forEach(button => button.onclick = () => {
    const kind = button.dataset.ceAdd;
    if (kind === "text") { const item=add(createLayer("text",{text:"",color:project.background.kind==="color"?"#17191d":"#ffffff"})); inline.edit(item); }
    if (kind === "image") q("image-upload").click();
    if (kind === "sticker") {inline.finish();q("stickers").hidden=!q("stickers").hidden;}
    if (kind === "comment") {inline.finish();tools.populateComments();q("comments").hidden=!q("comments").hidden;}
    if (kind === "drawing") { drawing = !drawing; selectedId = null; changed(); status(drawing ? "Draw on the canvas. Turn Draw off to move your strokes as layers." : "Drawing finished."); }
    if (kind === "emoji") {
      openEmojiPicker(null, emoji => add(createLayer("emoji", { text: emoji, width: 210 })), { chat: true, selectOnly: true });
      document.querySelector(".emoji-overlay").style.zIndex = "2400";
    }
  });
  canvas.addEventListener("click",()=>{
    if(!editor.classList.contains("is-quote")||inline.active()||busy||preview)return;
    const item=layer()?.kind==="text"?layer():project.layers.find(value=>value.kind==="text"&&!value.locked);
    if(item){selectedId=item.id;inline.edit(item);changed(false);}
  });
  q("draw").onclick = () => { drawing = !drawing; selectedId = null; changed(); };
  q("image-upload").onchange = async event => {
    const file = event.target.files[0]; event.target.value = ""; if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) return error("Choose an image or GIF smaller than 10 MB.");
    try {
      const media = rememberBlob(file), image = await assets.load(media);
      if (closed) return;
      const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
      add(createLayer("image", { media, width: 480, height: 480 * height / width }));
    } catch (failure) { error(failure); }
  };
  for (const [name, property] of Object.entries({ text: "text", font: "font", align: "align", color: "color", background: "background", opacity: "opacity", scale: "scale", rotation: "rotation" })) {
    q(name).onfocus=()=>history.record();
    q(name).oninput = () => {
      const item = layer(); if (!item || busy || item.locked) return;
      item[property] = ["opacity", "scale", "rotation"].includes(name) ? Number(q(name).value) : q(name).value;
      changed(false);
      if (name === "text") refreshLayers();
    };
  }
  q("sticker-edit-text").onfocus=()=>history.record();
  q("sticker-edit-text").oninput=()=>{
    const item=layer();if(item?.kind!=="sticker"||item.locked)return;
    item.text=q("sticker-edit-text").value.slice(0,160);changed(false);refreshLayers();
  };
  for(const name of ["sticker-edit-choice-a","sticker-edit-choice-b"]){
    q(name).onfocus=()=>history.record();
    q(name).oninput=()=>{
      const item=layer();if(item?.kind!=="sticker"||item.sticker!=="poll"||item.locked)return;
      const choices=[q("sticker-edit-choice-a").value.trim().slice(0,40),q("sticker-edit-choice-b").value.trim().slice(0,40)];
      if(choices.every(Boolean)){item.choices=choices;q("sticker-edit-help").textContent="";changed(false);}
      else q("sticker-edit-help").textContent="Keep both answers filled in.";
    };
  }
  for(const [name,property] of [["sticker-edit-accent","color"],["sticker-edit-surface","background"]]){
    q(name).onfocus=()=>history.record();
    q(name).oninput=()=>{const item=layer();if(item?.kind!=="sticker"||item.locked)return;item[property]=q(name).value;changed(false);};
  }
  q("background-on").onchange = () => { if (layer()&&!layer().locked) {history.record();layer().backgroundOn = q("background-on").checked;} changed(false); };
  for (const name of ["start", "end"]) q(name).onchange = () => {
    const item = layer(); if (!item) return;
    if(item.locked)return;history.record();
    if (name === "start") item.startTime = clamp(q(name).value, 0, item.endTime - .1);
    else item.endTime = clamp(q(name).value, item.startTime + .1, project.duration);
    changed(); seek(Math.min(Math.max(time, item.startTime), item.endTime));
  };
  q("duplicate").onclick = () => { if(layer()?.locked)return;history.record();const copy = duplicateLayer(project, selectedId); if (copy) { selectedId = copy.id; changed(); } };
  q("delete").onclick = remove;
  q("forward").onclick = () => { if(layer()?.locked)return;history.record();moveLayer(project, selectedId, 1); changed(); };
  q("backward").onclick = () => { if(layer()?.locked)return;history.record();moveLayer(project, selectedId, -1); changed(); };
  q("canvas-color").onfocus=()=>history.record();
  q("canvas-color").oninput = () => { project.background.color = q("canvas-color").value; changed(false); };
  q("preview").onclick = () => {
    inline.finish();
    preview = !preview; drawing = false; editor.classList.toggle("is-preview", preview); q("preview").setAttribute("aria-pressed", String(preview));
    q("preview").querySelector(".ce-lbl").textContent=preview?"Edit":"Preview";changed(false);
    if (preview) { seek(0); q("play").click(); }
  };
  q("scrub").oninput = () => { if (!live && !busy) seek(q("scrub").value); };
  q("play").onclick = async () => {
    if (live || busy) return;
    if (playing) { stopPlayback(); return; }
    if (time >= project.duration - .05) time = 0;
    playbackStart = performance.now() - time * 1000; playing = true;
    const video = backgroundVideo();
    if(video){if(project.background.videoEdit)syncVideoEdit(video,project.background,time);else video.currentTime=time;video.muted=false;try{await video.play();}catch(failure){playing=false;error(failure);}}
  };
  q("publish").onclick = async () => {
    if (busy || live) return;
    mediaTools.finishCrop(true);
    inline.finish();
    pages.flush();
    const destination = q("destination").value;
    const wantsHeyWord = destination === "story" && q("hey-word-enabled").checked;
    const prompt = q("hey-word-prompt").value.trim();
    if (wantsHeyWord && !prompt) {
      error("Write a prompt for the Oldtime story sticker.");
      return;
    }
    const storyPrompt = wantsHeyWord ? {
      prompt,
      ...(heyWord?.promptId ? { promptId: heyWord.promptId } : {}),
      ...(heyWord?.startedBy ? { startedBy: heyWord.startedBy } : {}),
      ...(heyWord?.startedByName ? { startedByName: heyWord.startedByName } : {}),
      ...(heyWord?.startedByHandle ? { startedByHandle: heyWord.startedByHandle } : {}),
      ...(heyWord?.creditHidden ? { creditHidden: true } : {}),
      ...(heyWord?.sourceStoryId ? { sourceStoryId: heyWord.sourceStoryId } : {}),
      ...(heyWord?.responseTo ? { responseTo: heyWord.responseTo } : {}),
    } : null;
    busy = true; stopPlayback(); refreshControls(); error(""); status("Saving your layers and media…");
    try {
      if(onSave){
        validateProjectSources(project);
        await onSave({project,blobs,ownerId,active:()=>!closed&&api.me()?.id===ownerId,caption:q("caption").value,
          preview:async()=>{
            await document.fonts.ready;
            // Blast's fallback media must not bake revocable source comments into pixels.
            const scene=structuredClone(project);scene.layers=scene.layers.filter(item=>item.kind!=="comment");
            const animated=scene.background.kind==="video"||scene.layers.some(item=>assets.get(item.media)?.frames||item.animation&&item.animation!=="none");
            return animated?exportCreativeVideo({canvas,video:backgroundVideo(),background:scene.background,duration:scene.duration,render:at=>drawProject(canvas,scene,assets,resolveCommentSource,at),alive:()=>!closed})
              :(drawProject(canvas,scene,assets,resolveCommentSource,time),canvasBlob(canvas));
          }});
        close(true);return;
      }
      if (api.authMode() !== "cloud") {
        throw new Error("Reconnect your online account before publishing. Nothing was saved on this device.");
      }
      if (["story", "post", "community"].includes(destination)) {
        validateProjectSources(project);
        if (destination !== "story") validateProjectAudience(project, q("visibility").value);
        if (api.me()?.id !== ownerId || closed) throw new Error("This editing session has ended.");
        await document.fonts.ready;
        const storyProject = structuredClone(project);
        const original = destination !== "story" ? originalPublicationMedia(storyProject, blobs, assets.get(storyProject.background.media)) : null;
        const scenes = projectScenes(storyProject);
        const carousel = destination !== "story" && scenes.length > 1 && scenes.length <= 10 &&
          scenes.every(scene => scene.background.kind === "photo" && scene.background.media &&
            !assets.get(scene.background.media)?.frames &&
            !scene.layers.some(layer => assets.get(layer.media)?.frames || layer.animation && layer.animation !== "none"));
        const animated = storyProject.background.kind === "video" ||
          storyProject.layers.some(layer => assets.get(layer.media)?.frames || layer.animation && layer.animation !== "none");
        const rendered = [];
        if (carousel) {
          for (const scene of scenes) {
            drawProject(canvas, scene, assets, resolveCommentSource, 0);
            rendered.push(await canvasBlob(canvas));
          }
        }
        const mediaBlob = original || (carousel ? rendered[0] : animated
          ? await exportCreativeVideo({
              canvas, video: backgroundVideo(), background: storyProject.background,
              duration: storyProject.duration,
              render: at => drawProject(canvas, storyProject, assets, resolveCommentSource, at),
              alive: () => !closed && api.me()?.id === ownerId,
            })
          : (drawProject(canvas, storyProject, assets, resolveCommentSource, 0), await canvasBlob(canvas)));
        if (!mediaBlob.size) throw new Error("The rendered Story is empty.");
        if (api.me()?.id !== ownerId || closed) throw new Error("This editing session has ended.");
        validateProjectSources(project);
        if (destination !== "story") validateProjectAudience(project, q("visibility").value);
        status(destination === "story" ? "Preparing Story upload…" : "Preparing post upload…");
        const shareToOtherFeed = destination !== "story" && q("other-feed").checked;
        const postDestination = destination === "community"
          ? (shareToOtherFeed ? "both" : "community")
          : (shareToOtherFeed ? "both" : "main");
        const item = destination === "story" ? await api.createCloudStory({
          text: q("caption").value,
          visibility: q("visibility").value,
          mediaBlob,
          onUploadProgress: (fraction, phase) => !closed && status(
            phase === "compressing" ? `Optimizing video to 720p · ${Math.round(fraction * 100)}%`
              : `Uploading Story · ${Math.round(fraction * 100)}%`,
          ),
        }) : await publishRenderedPost({
          blobs: carousel ? rendered : [mediaBlob],
          upload: (blob, onProgress) => putLocalMedia(blob, undefined, (fraction, phase) => {
            if (phase === "compressing") {
              if (!closed) status(`Optimizing video to 720p · ${Math.round(fraction * 100)}%`);
            } else {
              onProgress?.(fraction);
            }
          }),
          onProgress: ({ fraction, index, total }) => !closed && status(
            `Uploading post${total > 1 ? ` · ${index + 1} of ${total}` : ""} · ${Math.round(fraction * 100)}%`,
          ),
          createPost: (text, fields) => api.createCloudPost(text, { ...fields, destination: postDestination }),
          text: q("caption").value,
          visibility: q("visibility").value,
          place: storyProject.place || null,
          active: () => !closed && api.me()?.id === ownerId,
        });
        let cleanupFailed = false;
        try { await deleteCreativeDraft(ownerId, draftContext); } catch { cleanupFailed = true; }
        close(true);
        const story = destination === "story";
        toast(cleanupFailed ? "Published. The saved cloud draft could not be cleared." : story ? "Story uploaded" : "Posted");
        onPosted?.(item?.id, story, !story && (openedInCommunity || destination === "community"));
        return;
      }
      const item = await publishCreativeProject(project, blobs, { destination, visibility: q("visibility").value, heyWord: storyPrompt,
        quote: editor.classList.contains("is-quote"),
        caption: q("caption").value, location:q("location").value, ownerId, active: () => !closed });
      let cleanupFailed=false;
      try{await deleteCreativeDraft(ownerId,draftContext);}catch{cleanupFailed=true;}
      const story = q("destination").value === "story"; close(true); toast(cleanupFailed?"Shared, but the saved draft could not be cleared.":story ? "Added to your story" : "Posted"); onPosted?.(item.id, story, !story && (openedInCommunity || destination === "community"));
    } catch (failure) { if (!closed) { busy = false; error(failure); status("Your edit is still here. Nothing was published."); refreshControls(); } }
  };
  q("export").onclick = async () => {
    if (busy || live) return;
    mediaTools.finishCrop(true);
    inline.finish();
    busy = true; stopPlayback(); refreshControls(); error(""); status("Rendering your preview…");
    try {
      validateProjectSources(project); await document.fonts.ready;
      const animated = project.background.kind === "video" || assets.items.get(project.background.media)?.frames || project.layers.some(item => assets.items.get(item.media)?.frames || item.animation && item.animation !== "none");
      const blob = animated ? await exportCreativeVideo({ canvas, video: backgroundVideo(),background:project.background, duration: project.duration, render: at => drawProject(canvas, project, assets, resolveCommentSource, at),
        alive: () => { if (closed) return false; try { validateProjectSources(project); return true; } catch { return false; } } }) : (drawProject(canvas, project, assets, resolveCommentSource, time), await canvasBlob(canvas));
      if (closed) return;
      const link = document.createElement("a"), url = URL.createObjectURL(blob);
      link.href = url; link.download = `old-time-remix.${blob.type.includes("mp4") ? "mp4" : blob.type.startsWith("video/") ? "webm" : "png"}`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
      status("Preview downloaded. Shared remixes keep editable layers and source links.");
    } catch (failure) { if (!closed) error(failure); }
    finally { busy = false; if (!closed) changed(); }
  };
  const tick = now => {
    if (closed) return;
    if (recording) {
      time = Math.min(project.duration, (now - recordingStart) / 1000);
      if (now - recordingStart >= 60_000 && recording.state === "recording") recording.stop();
    } else if (playing) {
      time = Math.min(project.duration, (now - playbackStart) / 1000);
      syncVideoEdit(backgroundVideo(),project.background,time,true);
      if (time >= project.duration) stopPlayback();
    }
    if (!busy) render(time);
    q("scrub").value = time; q("time").textContent = `${time.toFixed(1)} / ${project.duration.toFixed(1)}s`;
    raf = requestAnimationFrame(tick);
  };
  q("caption").value=caption;q("location").value=location;
  {const loc=q("location");loc.readOnly=true;loc.placeholder="Add place";
   const pick=()=>openPlacePicker({value:project.place||(loc.value?{id:"custom:existing",label:loc.value,source:"custom"}:null),toast,
     onSelect:p=>{project.place=p;loc.value=p.label;},onRemove:()=>{project.place=null;loc.value="";}});
   loc.onclick=pick;loc.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();pick();}};}
  q("destination").value=["post","community","story"].includes(destination)?destination:"post";
  const syncDestinationChoice = () => {
    const selected = q("destination").value;
    q("other-feed-label").textContent = selected === "community" ? "Also share to Main feed" : "Also share to Community";
    q("other-feed-field").hidden = selected === "story" || !!onSave;
    if (selected === "story") q("other-feed").checked = false;
  };
  q("destination").addEventListener("change", syncDestinationChoice);
  syncDestinationChoice();
  if(onSave){q("publish").textContent=saveLabel;q("destination").closest("label").hidden=true;q("visibility").closest("label").hidden=true;}
  q("visibility").value = visibility || (api.me().private ? "followers" : "public");
  if (source && !api.canSeePost(api.post(source.postId), null)) {
    q("visibility").value = api.post(source.postId).visibility === "close-friends" ? "close-friends" : "friends";
    status("The original is restricted. Your remix must use an audience that can view it.");
  }
  if(onSave){
    q("save-hint").textContent="Saves your edit and returns to the composer without sharing.";
    q("exit-description").textContent="Save your edit and return to the composer, or discard these changes. Nothing will be shared.";
  }
  changed(); void loadSources(); raf = requestAnimationFrame(tick); q("close").focus();
  if (startShare) q("share-toggle").click();
  void (async()=>{
    let restored=false;
    if(!onSave&&!initialProject&&!background){
      busy=true;refreshControls();
      try{
        const draft=await loadCreativeDraft(ownerId,draftContext);
        if(closed)return;
        if(draft){
          const saved=restoreCreativeDraft(draft,rememberBlob),state=saved.state;
          replaceProject(saved.project);selectedId=state.selectedId||null;time=state.time||0;
          quoteReturn=state.quoteReturn||null;quoteDraft=state.quoteDraft||null;quoteCaption=state.quoteCaption||"";
          q("caption").value=state.caption||"";q("location").value=state.location||"";
          q("destination").value=["post","community","story"].includes(state.destination)?state.destination:destination;syncDestinationChoice();q("visibility").value=state.visibility||"public";
          q("workspace").value=startStudio?"studio":state.workspace||"camera";
          busy=false;q("workspace").onchange();studioTools.restoreCapture(state.capture);
          editor.classList.remove("is-quote");q("title").textContent="Create";
          q("inline-text").setAttribute("aria-label","Text on media");
          q("canvas-color").value=project.background.color||"#f2f3f5";
          restored=true;status("Draft restored. Save & Exit keeps it in your account without sharing.");
        }
      }catch(failure){if(!closed)error(failure);}
      finally{busy=false;if(!closed)changed();}
    }
    if(closed)return;
    if(restored||initialProject){
      await Promise.all([project,...project.pages||[]].flatMap(scene=>[
        scene.background.media?assets.load(scene.background.media,scene.background.kind==="video"?"video":"image"):null,
        ...scene.layers.filter(item=>item.kind==="image").map(item=>assets.load(item.media))
      ]).filter(Boolean)).catch(error);
      if(!closed){pages.reset();changed();if(restored&&!startStudio&&!editor.classList.contains("is-quote")&&(studioTools.captureSnapshot().shots.length||startCamera&&!source&&!onSave&&!background?.media)){if(q("workspace").value!=="camera"){q("workspace").value="camera";q("workspace").onchange();}void camera();}}
    }else{
      if(shouldAutoStartCamera({
        startCamera,
        startStudio,
        hasSource: !!source,
        hasInitialProject: !!initialProject,
        hasBackground: !!background?.media,
        hasSaveHandler: !!onSave
      }))void camera();
      if(background?.media)await setBackground(background.media,background.kind).catch(error);
    }
  })();
  return { project, close };
}
