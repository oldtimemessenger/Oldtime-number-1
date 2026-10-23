import { api, mutate, notify } from "./store.js";
import { projectScenes } from "./creative-project.js";

export function openCreativeResponse(itemId, story, layerId, custom) {
  const get = custom?.get || (() => (story ? api.db().stories : api.db().posts).find(item=>item.id===itemId));
  const permitted=item=>item&&(custom?true:story?api.canSeeStory(item):api.canSeePost(item));
  const item=get(), viewer=api.me();
  if(!viewer || !permitted(item))return;
  const layer=projectScenes(item.creativeProject).flatMap(scene=>scene.layers).find(layer=>layer.id===layerId);
  if(!layer||!["poll","question"].includes(layer.sticker))return;
  document.querySelector(".creative-response")?.remove();
  const overlay=document.createElement("div");overlay.className="creative-response";
  const form=document.createElement("form"), title=document.createElement("b"); title.textContent=layer.text;form.append(title);
  const close=document.createElement("button");close.type="button";close.textContent="Close";close.onclick=()=>overlay.remove();form.append(close);
  const save = answer => {
    try {
      const current=get();if(!permitted(current))throw new Error("This post is no longer available.");
      const commit=custom?.save || (fn=>mutate(db=>fn((story?db.stories:db.posts).find(item=>item.id===itemId),db)));
      commit((record,db)=>{
        const target=projectScenes(record.creativeProject).flatMap(scene=>scene.layers).find(layer=>layer.id===layerId);
        if(layer.sticker==="poll"){target.votes||={};target.votes[viewer.id]=answer;}
        else {
          target.answers||=[];target.answers.push({id:crypto.randomUUID(),author:viewer.id,text:answer,created:Date.now()});
          if(db&&record.author!==viewer.id)notify(db,{id:"n-"+crypto.randomUUID(),user:record.author,actor:viewer.id,kind:"creative-question",
            ...(story?{story:itemId}:{post:itemId}),body:"answered your question",created:Date.now(),read:false});
        }
      });overlay.remove();
    }catch(error){feedback.textContent=error.message;}
  };
  const feedback=document.createElement("p");feedback.setAttribute("role","status");
  if(layer.sticker==="poll") {
    (layer.choices||["Yes","No"]).forEach((choice,index)=>{
      const button=document.createElement("button");button.type="button";button.textContent=choice;button.onclick=()=>save(index);form.append(button);
    });
  } else {
    const input=document.createElement("textarea");input.required=true;input.maxLength=500;input.setAttribute("aria-label","Your answer");form.append(input);
    const button=document.createElement("button");button.type="submit";button.textContent="Send answer";form.append(button);
    form.onsubmit=event=>{event.preventDefault();if(input.value.trim())save(input.value.trim());};
  }
  if(viewer.id===item.author && layer.answers?.length)for(const answer of layer.answers){
    const paragraph=document.createElement("p");paragraph.textContent=`@${api.user(answer.author)?.username||"member"}: ${answer.text}`;form.append(paragraph);
  }
  form.append(feedback);overlay.append(form);document.body.append(overlay);form.querySelector("textarea,button")?.focus();
}
