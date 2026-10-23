import { api } from "./store.js";
import { createLayer, setProjectAspect, clamp } from "./creative-project.js";
import { commentSource, resolveCommentSource } from "./creative-content.js";

export function bindCreativeTools({ root, q, project, layer, history, inline, add, changed, seek, setSelected }) {
  const values = { "font-size": ["fontSize",64], "background-opacity": ["backgroundOpacity",1], "letter-spacing": ["letterSpacing",0],
    "line-spacing": ["lineSpacing",1.35], case: ["caseStyle","none"], bubble: ["bubble","rounded"], animation: ["animation","none"] };
  const checks = { bold: ["bold",true], italic: ["italic",false], shadow: ["shadow",false], outline: ["outline",false] };
  for (const [name,[property]] of Object.entries(values)) {
    q(name).onfocus = () => history.record();
    q(name).oninput = () => {
      const item=layer(); if(!item||item.locked)return;
      item[property]=["case","bubble","animation"].includes(name)?q(name).value:Number(q(name).value);
      changed(false); inline.sync();
    };
  }
  q("text-width").onfocus = () => history.record();
  q("text-width").oninput = () => {
    const item = layer(); if (!item || item.kind !== "text" || item.locked) return;
    item.width = clamp(Number(q("text-width").value), .08, 1) * project.width;
    changed(false); inline.sync();
  };
  for (const [name,[property]] of Object.entries(checks)) q(name).onchange=()=>{
    const item=layer(); if(!item||item.locked)return; history.record(); item[property]=q(name).checked; changed(false); inline.sync();
  };
  const restore = method => { inline.finish(); if(history[method]()) { setSelected(null); seek(Math.min(project.duration,Number(q("scrub").value))); changed(); } };
  q("undo").onclick=()=>restore("undo"); q("redo").onclick=()=>restore("redo");
  for (const [id,section] of [["source-toggle",".ce-source"],["style-toggle","#ce-inspector"],["share-toggle",".ce-share"]]) {
    q(id).onclick=()=>{
      const target=root.querySelector(section), expanded=q(id).getAttribute("aria-expanded")!=="true";
      root.querySelector("#ce-media-panel").hidden=true;
      q("trim-handle-start").hidden=q("trim-handle-end").hidden=true;
      for(const [otherId,otherSection] of [["source-toggle",".ce-source"],["style-toggle","#ce-inspector"],["share-toggle",".ce-share"]]){
        if(otherId!==id){q(otherId).setAttribute("aria-expanded","false");root.querySelector(otherSection).classList.add("is-collapsed");}
      }
      q(id).setAttribute("aria-expanded",String(expanded)); target.classList.toggle("is-collapsed",!expanded);
    };
  }
  q("layers-toggle").onclick=()=>{
    const open=q("layers-toggle").getAttribute("aria-expanded")!=="true";
    q("layers-toggle").setAttribute("aria-expanded",String(open)); root.querySelector(".ce-panel").classList.toggle("is-layers-open",open);
  };
  q("aspect").onchange=()=>{ const ratio=q("aspect").value;inline.finish(); history.record(); setProjectAspect(project,ratio); changed(); };
  q("safe").onchange=()=>{ q("safe-guides").hidden=!q("safe").checked; };
  q("allow-outside").onchange=()=>{ history.record(); project.allowOutside=q("allow-outside").checked; changed(); };
  q("lock").onclick=()=>{ const item=layer(); if(!item)return; inline.finish(); history.record(); item.locked=!item.locked; changed(); };
  q("hide").onclick=()=>{ const item=layer(); if(!item)return; inline.finish(); history.record(); item.hidden=!item.hidden; changed(); };
  for (const name of ["overlay-start","overlay-end"]) {
    q(name).onpointerdown=()=>history.record();
    q(name).onkeydown=()=>history.record();
    q(name).oninput=()=>{
      const item=layer(); if(!item||item.locked)return;
      if(name==="overlay-start")item.startTime=clamp(q(name).value,0,item.endTime-.1);
      else item.endTime=clamp(q(name).value,item.startTime+.1,project.duration);
      seek(clamp(Number(q(name).value),item.startTime,item.endTime)); changed(false); refresh();
    };
  }
  const keyboard=event=>{
    if(event.target.matches("input,textarea,[contenteditable=true]"))return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="z"){event.preventDefault();restore(event.shiftKey?"redo":"undo");}
  };
  root.addEventListener("keydown",keyboard);
  if(q("sticker-flow")?.nodeType===1){
  const stickerConfig={
    reaction:{title:"Reaction",label:"Reaction text",value:"WOW",help:"Place a bold reaction on your media."},
    location:{title:"Place label",label:"Place name",value:api.me()?.city||"Here",help:"A text label only; it does not use live location."},
    mention:{title:"Handle label",label:"Handle",value:api.me()?.username||"member",help:"Shown as text on the media; it does not tag or notify an account."},
    hashtag:{title:"Topic label",label:"Topic",value:"oldtime",help:"A visual topic label; it does not create a searchable hashtag."},
    music:{title:"Audio label",label:"Audio name",value:"Original audio",help:"Names audio on the media; it does not add a music track."},
    emoji:{title:"Emoji",label:"Emoji",value:"❤️",help:"Choose an emoji, then place and resize it on your media."},
    "custom-text":{title:"Custom text",label:"Text",value:"",help:"Add your own words directly on the media."},
    question:{title:"Question",label:"Question",value:"Ask me anything",help:"People can send a written reply to this sticker."},
    poll:{title:"Poll",label:"Question",value:"What do you think?",options:"Yes, No",help:"People can choose one of two answers."},
    "hey-word":{title:"Hey Word",label:"Prompt",value:"",help:"An original Oldtime story prompt people can answer with their own story."}
  };
  const simpleStickerKinds=new Set(["heart","arrow","circle","rectangle","star"]);
  const flow=q("sticker-flow");
  let activeSticker=null;
  const goToStickerPage=(page,behavior="smooth")=>{
    if(!flow)return;
    flow.scrollTo?.({left:page*flow.clientWidth,behavior});
    if(!flow.scrollTo)flow.scrollLeft=page*flow.clientWidth;
  };
  const updateStickerPreview=()=>{
    if(!activeSticker)return;
    const config=stickerConfig[activeSticker]||{};
    const preview=q("sticker-config-preview");preview.dataset.kind=activeSticker;preview.replaceChildren();
    preview.style.setProperty("--ce-sticker-accent",q("sticker-accent").value);
    preview.style.setProperty("--ce-sticker-surface",q("sticker-surface").value);
    const badge=document.createElement("span");badge.className="ce-sticker-preview-badge";
    badge.textContent=activeSticker==="hey-word"?"OLDTIME · HEY WORD":activeSticker==="poll"?"POLL":activeSticker==="question"?"QUESTION":(config.title||activeSticker).toUpperCase();
    const copy=document.createElement("strong");
    const value=activeSticker==="hey-word"?q("hey-word-prompt").value:q("sticker-value").value;
    copy.textContent=value.trim()||config.value||"Your text";
    preview.append(badge,copy);
  };
  const syncStorySticker=()=>{
    const story=q("destination").value==="story";
    const button=root.querySelector('[data-ce-sticker="hey-word"]');
    if(button){
      button.disabled=!story;
      button.setAttribute("aria-disabled",String(!story));
      if(button.lastElementChild)button.lastElementChild.textContent=story?"Hey Word":"Hey Word · Story";
    }
    if(activeSticker==="hey-word"&&!story){activeSticker=null;q("sticker-kind").value="";q("hey-word-controls").hidden=true;goToStickerPage(0);}
  };
  const filterStickers=()=>{
    const category=root.querySelector('#ce-sticker-categories [aria-selected="true"]')?.dataset.ceStickerCategory||"all";
    const query=q("sticker-search").value.trim().toLowerCase();
    let visible=0;
    q("sticker-track").querySelectorAll("[data-ce-sticker]").forEach(button=>{
      const matchesCategory=category==="all"||button.dataset.ceStickerGroup===category;
      const matchesQuery=!query||button.dataset.ceStickerName.includes(query);
      const show=matchesCategory&&matchesQuery;
      button.hidden=!show;visible+=Number(show);
    });
    q("sticker-empty").hidden=visible>0;
  };
  const configureSticker=kind=>{
    const config=stickerConfig[kind];if(!config)return;
    activeSticker=kind;
    q("sticker-kind").value=kind;
    q("sticker-kind").dispatchEvent(new Event("change",{bubbles:true}));
    q("sticker-config-title").textContent=config.title;
    q("sticker-value-label").textContent=config.label;
    q("sticker-value-wrap").hidden=kind==="hey-word";
    q("sticker-options-wrap").hidden=kind!=="poll";
    q("sticker-value").value=config.value;
    q("sticker-value").maxLength=kind==="emoji"?24:160;
    q("sticker-accent").value="#e5262f";
    q("sticker-surface").value="#f4f1ec";
    q("sticker-options").value=config.options||"Yes, No";
    q("sticker-config-help").textContent=config.help;
    q("sticker-add").textContent=kind==="custom-text"?"Add text":kind==="emoji"?"Add emoji":kind==="hey-word"?"Add prompt":"Place sticker";
    if(kind==="hey-word"){
      q("hey-word-enabled").checked=true;
      q("hey-word-enabled").dispatchEvent(new Event("change",{bubbles:true}));
    }
    updateStickerPreview();
    goToStickerPage(1);
    if(kind==="hey-word")requestAnimationFrame(()=>q("hey-word-prompt").focus({preventScroll:true}));
    else requestAnimationFrame(()=>q("sticker-value").focus({preventScroll:true}));
  };
  q("sticker-back").onclick=()=>{goToStickerPage(0);q("sticker-search").focus({preventScroll:true});};
  q("sticker-search").oninput=filterStickers;
  q("sticker-categories").addEventListener("click",event=>{
    const button=event.target.closest("[data-ce-sticker-category]");if(!button)return;
    q("sticker-categories").querySelectorAll("[data-ce-sticker-category]").forEach(item=>item.setAttribute("aria-selected",String(item===button)));
    filterStickers();
  });
  q("destination").addEventListener("change",syncStorySticker);
  syncStorySticker();
  q("sticker-value").addEventListener("input",updateStickerPreview);
  q("sticker-options").addEventListener("input",updateStickerPreview);
  q("hey-word-prompt").addEventListener("input",updateStickerPreview);
  q("sticker-accent").addEventListener("input",updateStickerPreview);
  q("sticker-surface").addEventListener("input",updateStickerPreview);
  root.querySelectorAll("[data-ce-sticker]").forEach(button=>button.onclick=()=>{
    const kind=button.dataset.ceSticker;
    if(button.disabled)return;
    if(stickerConfig[kind]){configureSticker(kind);return;}
    if(!simpleStickerKinds.has(kind))return;
    add(createLayer("sticker",{sticker:kind,width:560,height:180,color:"#e5262f",background:"#f4f1ec"}));
    q("stickers").hidden=true;goToStickerPage(0);
  });
  q("sticker-add").onclick=()=>{
    if(!activeSticker)return;
    if(activeSticker==="hey-word"){
      const prompt=q("hey-word-prompt").value.trim();
      if(!prompt){q("sticker-config-help").textContent="Write a prompt before sharing this story.";q("hey-word-prompt").focus();return;}
      q("hey-word-enabled").checked=true;
      q("hey-word-enabled").dispatchEvent(new Event("change",{bubbles:true}));
      q("stickers").hidden=true;goToStickerPage(0);return;
    }
    const kind=activeSticker;
    const defaults={reaction:"WOW",location:api.me()?.city||"Here",mention:api.me()?.username||"member",hashtag:"oldtime",music:"Original audio",question:"Ask me anything",poll:"What do you think?",emoji:"❤️"};
    const raw=q("sticker-value").value.trim().slice(0,160);
    if(kind==="custom-text"&&!raw){q("sticker-config-help").textContent="Add a few words before placing this sticker.";q("sticker-value").focus();return;}
    const text=(raw||defaults[kind]||"").replace(kind==="mention"?/^@/:kind==="hashtag"?/^#/:/^$/,"");
    const choices=q("sticker-options").value.split(",").map(value=>value.trim().slice(0,40)).filter(Boolean).slice(0,2);
    if(kind==="poll"&&choices.length!==2){q("sticker-config-help").textContent="Enter two answers separated by a comma.";q("sticker-options").focus();return;}
    add(createLayer("sticker",{sticker:kind,text,width:kind==="emoji"?240:560,height:kind==="poll"||kind==="question"?300:180,
      color:q("sticker-accent").value,background:q("sticker-surface").value,choices:kind==="poll"?choices:undefined}));
    q("stickers").hidden=true;goToStickerPage(0);
  };
  if(q("sticker-kind").value&&stickerConfig[q("sticker-kind").value]){
    activeSticker=q("sticker-kind").value;
    const config=stickerConfig[activeSticker];
    q("sticker-config-title").textContent=config.title;
    q("sticker-value-label").textContent=config.label;
    q("sticker-value-wrap").hidden=activeSticker==="hey-word";
    q("sticker-options-wrap").hidden=activeSticker!=="poll";
    q("sticker-value").value=config.value;
    q("sticker-options").value=config.options||"Yes, No";
    q("sticker-config-help").textContent=config.help;
    updateStickerPreview();
  }
  filterStickers();
  }
  const populateComments=()=>{
    q("comment-select").replaceChildren();
    for(const post of api.posts()){
      if(!api.canSeePost(post))continue;
      for(const comment of (post.comments||[]).flatMap(c=>[c,...c.replies||[]])){
        const source={postId:post.id,commentId:comment.id,commentAuthorId:comment.author};
        if(!resolveCommentSource(source))continue;
        const option=document.createElement("option");option.value=JSON.stringify([post.id,comment.id]);
        option.textContent=`@${api.user(comment.author)?.username||"member"}: ${(comment.body||"Photo comment").slice(0,90)}`;
        q("comment-select").append(option);
      }
    }
    q("comment-add").disabled=!q("comment-select").options.length;
  };
  q("comment-add").onclick=()=>{
    if(!q("comment-select").value)return;
    try {const [post,comment]=JSON.parse(q("comment-select").value);add(createLayer("comment",{source:commentSource(post,comment),x:.5,y:.3}));q("comments").hidden=true;}
    catch(error){q("error").textContent=error.message;}
  };
  const refresh=()=>{
    const item=layer(); q("undo").disabled=!history.past.length; q("redo").disabled=!history.future.length;
    q("aspect").value=project.aspect||"9:16";q("allow-outside").checked=!!project.allowOutside;
    q("safe-guides").hidden=!q("safe").checked;
    q("text-width").disabled=!item||item.kind!=="text"||!!item.locked;
    q("text-width").value=clamp((item?.width||760)/project.width,.08,1);
    if(!item)return;
    for(const [name,[property,fallback]] of Object.entries(values))q(name).value=item[property]??fallback;
    for(const [name,[property,fallback]] of Object.entries(checks))q(name).checked=item[property]??fallback;
    q("lock").textContent=item.locked?"Unlock":"Lock";q("hide").textContent=item.hidden?"Show":"Hide";
    for(const name of ["overlay-start","overlay-end"])q(name).max=project.duration;
    q("overlay-start").value=item.startTime;q("overlay-end").value=item.endTime;
    q("timeline-summary").textContent=`${item.startTime.toFixed(1)}s – ${item.endTime.toFixed(1)}s`;
    for(const id of ["delete","duplicate","forward","backward"])q(id).disabled=!!item.locked;
  };
  return {refresh,populateComments};
}
