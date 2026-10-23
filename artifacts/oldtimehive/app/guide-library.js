import "./guide-library.css";
import {INTERESTS,readInterests,saveInterests,resetInterests} from "./interests.js";
import {HELP_GUIDES,readHelpState,setHelpPaused} from "./help-prompts.js";

export function renderGuideLibrary(accountId,esc) {
  const state=readHelpState(accountId);
  return `<div class="guide-library">
    <p class="guide-intro">Explore whenever you want. Automatic tips appear at most once every three days, and each guide appears automatically only once.</p>
    <label class="guide-preferences"><span><b>Occasional tips</b><small>${state?"Your choices sync with your account.":"Tip preferences are loading or unavailable online."}</small></span><input type="checkbox" id="guide-tips-enabled" aria-label="Show occasional feature tips" ${state&&!state.paused?"checked":""} ${state?"":"disabled"} /></label>
    <div class="guide-preview-row"><span><b>Want to see a tip now?</b><small>This preview won't change your tip history or cooldown.</small></span><svg class="guide-preview-art" viewBox="0 0 64 52" aria-hidden="true"><path d="M7 42c12-22 15 4 27-17s15 4 23-16" fill="none" stroke="#8b55ce" stroke-width="5" stroke-linecap="round"/><circle cx="8" cy="42" r="6" fill="#86c94b" stroke="#fff" stroke-width="2"/><circle cx="56" cy="9" r="6" fill="#ff6b52" stroke="#fff" stroke-width="2"/><circle cx="31" cy="10" r="5" fill="#20232a"/><path d="M31 16v13m0-8-8 5m8-5 8 4m-8 4-6 9m6-9 8 9" fill="none" stroke="#20232a" stroke-width="3" stroke-linecap="round"/></svg><button type="button" class="cta-secondary" data-preview-tip="help-welcome">Preview a tip</button></div>
    ${interestSection(accountId,esc)}
    ${["Get started","Connect","Privacy & control"].map(section=>`<section class="guide-section"><h2>${esc(section)}</h2><div class="guide-grid">${HELP_GUIDES.filter(guide=>guide.section===section).map(guide=>`<button type="button" class="guide-item" data-open-guide="${guide.id}"><img loading="lazy" src="${import.meta.env.BASE_URL}guide/${guide.image}" width="80" height="60" alt="" /><span>${esc(guide.title)}</span><span class="guide-chevron" aria-hidden="true">›</span></button>`).join("")}</div></section>`).join("")}
  </div>`;
}
function interestSection(accountId,esc){
  const v=readInterests(accountId);
  if(!v)return `<section class="guide-section"><h2>Your interests</h2><p class="guide-intro">Interests couldn't be loaded from your account.</p></section>`;
  return `<section class="guide-section" aria-labelledby="gi-h"><h2 id="gi-h">Your interests</h2>
    <p class="guide-intro">Optional. Your choices sync with your account and shape which tips you see. Oldtime does not guess interests or use paid AI.</p>
    <label class="guide-preferences"><span><b>Use my interests</b><small>Turn off to ignore them.</small></span><input type="checkbox" id="guide-interests-enabled" aria-label="Use my interests for tips" ${v.enabled?"checked":""}></label>
    <div class="guide-chips" role="group" aria-label="Interests">${INTERESTS.map(i=>`<button type="button" class="guide-chip" data-interest="${esc(i)}" aria-pressed="${v.selected.includes(i)}">${esc(i)}</button>`).join("")}</div>
    <button type="button" class="cta-secondary guide-reset" id="guide-interests-reset">Reset interests</button></section>`;
}
export function bindGuideLibrary(app,{accountId,open,preview,toast}) {
  app.querySelectorAll("[data-open-guide]").forEach(button=>button.onclick=()=>open(button.dataset.openGuide));
  app.querySelector("[data-preview-tip]")?.addEventListener("click",event=>preview?.(event.currentTarget.dataset.previewTip));
  const chips=[...app.querySelectorAll("[data-interest]")],en=app.querySelector("#guide-interests-enabled");
  const persist=async()=>{
    try{await saveInterests(accountId,{enabled:en.checked,selected:chips.filter(c=>c.getAttribute("aria-pressed")==="true").map(c=>c.dataset.interest)});return true;}
    catch(error){toast(error.message);return false;}
  };
  chips.forEach(c=>c.onclick=async()=>{const on=c.getAttribute("aria-pressed")!=="true";c.setAttribute("aria-pressed",String(on));if(!await persist())c.setAttribute("aria-pressed",String(!on));});
  if(en)en.onchange=async()=>{if(!await persist())en.checked=!en.checked;};
  const reset=app.querySelector("#guide-interests-reset");
  if(reset)reset.onclick=async()=>{try{await resetInterests(accountId);chips.forEach(c=>c.setAttribute("aria-pressed","false"));en.checked=true;toast("Interests reset");}catch(error){toast(error.message);}};
  const toggle=app.querySelector("#guide-tips-enabled");
  if(toggle)toggle.onchange=async()=>{
    try{await setHelpPaused(accountId,!toggle.checked);toast(toggle.checked?"Occasional tips enabled":"Occasional tips paused");}
    catch(error){toggle.checked=!toggle.checked;toast(error.message);}
  };
}
