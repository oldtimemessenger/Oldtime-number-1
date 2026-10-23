import "./repost-note.css";
import { api } from "./store.js";
import { openEmojiPicker, closeEmojiPicker } from "./emoji.js";
import { icon } from "./icons.js";

const REACTIONS = [["😂","Laugh"],["❤️","Love"],["💯","Hundred"],["🔥","Fire"],["🙏","Thanks"]];
let dismissActive = null;
export function closeRepostNote() { dismissActive?.(); }

export function openRepostNote(id, { esc, toast, onSaved }) {
  closeRepostNote();
  const me=api.me(),item=api.post(id);
  if(!me||!item||!api.canSeePost(item))return toast("Post unavailable");
  if(!item.cloud)return toast("Reposts are available for online posts.");
  const owner=me.id,previous=document.activeElement,already=Boolean(item.repostedByMe)||(item.reposts||[]).includes(owner);
  const original=String(item.repostNote||item.repostNotes?.[owner]||"").slice(0,140);
  const layer=document.createElement("div");
  const accountTimer=setInterval(()=>{if(api.me()?.id!==owner)dismissActive?.();},250);
  layer.className="rn-overlay";
  layer.innerHTML=`<section class="rn-sheet" role="dialog" aria-modal="true" aria-labelledby="rn-title">
    <div class="rn-handle"></div><header><h2 id="rn-title">${already?"Your repost":"Add a repost"}</h2><button type="button" class="rn-icon" data-rn-close aria-label="Close">${icon("close")}</button></header>
    <div class="rn-preview"><img src="${esc(me.avatar||"")}" alt="" /><div><b>${esc(me.name||me.username)}</b><small>Reposting @${esc(api.user(item.author)?.username||"member")}</small></div>${icon("repost")}</div>
    <form><label for="rn-text">Add your thought <span>(optional)</span></label>
      <textarea id="rn-text" maxlength="140" rows="3" placeholder="What made you want to share this?">${esc(original)}</textarea>
      <div class="rn-meta"><button type="button" class="rn-emoji" data-rn-picker>${icon("smile")}<span>Emoji</span></button><small data-rn-count>${original.length} / 140</small></div>
      <div class="rn-reactions" role="group" aria-label="Quick reactions">${REACTIONS.map(([emoji,label],i)=>`<button type="button" data-rn-reaction="${i}" aria-label="Add ${label} reaction">${emoji}</button>`).join("")}</div>
       <p class="rn-note">Your note is saved with your online repost. The original post and its audience stay unchanged.</p>
      <p class="rn-error" role="alert" data-rn-error></p>
      <button type="submit" class="rn-save">${already?"Save note":"Repost"}</button>
      ${already?'<button type="button" class="rn-remove" data-rn-remove>Remove my repost</button>':""}
    </form></section>`;
  document.body.append(layer);
  const sheet=layer.querySelector(".rn-sheet"),input=layer.querySelector("textarea");
  const cleanup=()=>{
    clearInterval(accountTimer);
    closeEmojiPicker();document.removeEventListener("keydown",keyboard);layer.remove();
    if(dismissActive===cleanup)dismissActive=null;
    if(previous?.isConnected)previous.focus({preventScroll:true});
  };
  dismissActive=cleanup;
  const keyboard=e=>{
    if(e.key==="Escape"){e.preventDefault();cleanup();}
    if(e.key!=="Tab")return;
    const controls=[...sheet.querySelectorAll("button,textarea")].filter(x=>!x.disabled);
    if(e.shiftKey&&document.activeElement===controls[0]){e.preventDefault();controls.at(-1).focus();}
    else if(!e.shiftKey&&document.activeElement===controls.at(-1)){e.preventDefault();controls[0].focus();}
  };
  document.addEventListener("keydown",keyboard);
  layer.onclick=e=>{if(e.target===layer)cleanup();};
  layer.querySelector("[data-rn-close]").onclick=cleanup;
  const count=()=>layer.querySelector("[data-rn-count]").textContent=`${input.value.length} / 140`;
  input.oninput=count;
  layer.querySelector("[data-rn-picker]").onclick=()=>openEmojiPicker(input,()=>{
    input.value=input.value.slice(0,140);count();
  });
  layer.querySelectorAll("[data-rn-reaction]").forEach(button=>button.onclick=()=>{
    const text=REACTIONS[Number(button.dataset.rnReaction)][0];
    input.setRangeText(text,input.selectionStart,input.selectionEnd,"end");
    input.value=input.value.slice(0,140);count();input.focus();
  });
  const commit=async remove=>{
    try{
      if(api.me()?.id!==owner)throw new Error("Your account changed. Reopen this post.");
      const current=api.post(id);
      if(!current||!api.canSeePost(current))throw new Error("Post unavailable.");
      if(!current.cloud)throw new Error("Reposts are available for online posts.");
      await api.setCloudRepost(id,!remove,input.value);
      if(api.me()?.id!==owner)throw new Error("Your account changed. Reopen this post.");
      cleanup();onSaved?.({removed:remove});toast(remove?"Repost removed":already?"Repost note saved":"Reposted");
    }catch(e){layer.querySelector("[data-rn-error]").textContent=e.message||"Could not save your repost.";}
  };
  layer.querySelector("form").onsubmit=e=>{e.preventDefault();commit(false);};
  layer.querySelector("[data-rn-remove]")?.addEventListener("click",()=>commit(true));
  // Focusing a button rather than the textarea avoids forcing the keyboard open.
  layer.querySelector("[data-rn-close]").focus({preventScroll:true});
}
