import "./creator-announcement.css";
import { requestCloudApi } from "./store.js";
import { readHelpState, canShowHelp, pickHelpPrompt, recordHelpChoice, helpGuide, hasSeenHelp } from "./help-prompts.js";
import { renderPromptCard } from "./help-prompt-view.js";

const DELAY = 30000;
const MARK = "oldtime-creator-announcement-v1:";
let token = 0;
let timer = null;
let open = null;
let lastInteraction = 0;
if(typeof document!=="undefined"){
  for(const event of ["pointerdown","keydown","wheel"])document.addEventListener(event,()=>{lastInteraction=Date.now();},{passive:true});
}

function marker(accountId) { return MARK + accountId; }
function hasMarker(accountId) {
  try { return globalThis.sessionStorage.getItem(marker(accountId)) !== null; } catch { return true; }
}
function setMarker(accountId) {
  try {
    const s = globalThis.sessionStorage;
    s.setItem(marker(accountId), String(Date.now()));
    return s.getItem(marker(accountId)) !== null;
  } catch { return false; }
}

export function pickAnnouncement(list, state) {
  const items = (Array.isArray(list) ? list : []).filter(a => a && a.optional === true && !["safety", "service"].includes(a.category) && typeof a.id === "string" && a.title && !hasSeenHelp(state,a.id));
  const rank = a => /welcome/i.test(a.id) || /^(welcome|creator)/i.test(String(a.category)) ? 0 : /promo/i.test(String(a.category)) ? 1 : 2;
  const ranked = items.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i);
  return ranked.length ? ranked[0].a : null;
}

function closeModal() {
  if (!open) return;
  open.cleanup();
  open = null;
}

export function resetCreatorAnnouncements() {
  token++;
  clearTimeout(timer);
  timer = null;
  closeModal();
}

export function scheduleCreatorAnnouncement({ app, esc, navigate, isSafe, accountId, toast=()=>{}, getContext=()=>({}) } = {}) {
  if (!app || typeof esc !== "function" || typeof isSafe !== "function") return;
  if (typeof accountId !== "string" || !accountId.trim()) return;
  if (open || timer || hasMarker(accountId) || !canShowHelp(readHelpState(accountId))) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const my = token;
  const stale = () => my !== token || !app.isConnected || open;
  timer = setTimeout(async () => {
    timer = null;
    if (stale() || !isSafe() || hasMarker(accountId) || Date.now()-lastInteraction<15000) return;
    let res, preferences, localOnly = false;
    try { [res,preferences] = await Promise.all([requestCloudApi("/api/announcements"),requestCloudApi("/api/announcement-preferences")]); }
    catch { localOnly = true; preferences = { features: true }; }
    if (stale() || !isSafe() || hasMarker(accountId) || Date.now()-lastInteraction<15000) return;
    const state=readHelpState(accountId);
    if(!canShowHelp(state))return;
    const tipsEnabled = localOnly ? !state.paused : res?.optionalTipsEnabled === true;
    const a = (tipsEnabled ? pickHelpPrompt(getContext(),state,preferences) : null) || pickAnnouncement(res?.announcements,state);
    if (!a) return;
    const claim = async () => {
      const latest=readHelpState(accountId);
      if(stale() || !isSafe() || hasMarker(accountId) || !canShowHelp(latest) || hasSeenHelp(latest,a.id))return false;
      try { await recordHelpChoice(accountId,a.id,"shown"); return setMarker(accountId); } catch { return false; }
    };
    let claimed=false;
    try {
      claimed = typeof navigator!=="undefined" && navigator.locks?.request
        ? await navigator.locks.request(`oldtime-tip:${accountId}`,{ifAvailable:true},lock=>lock?claim():false)
        : claim();
    } catch { return; } // An unavailable browser lock must not cause duplicate tips.
    if(claimed&&!stale()&&isSafe())present(a,{app,esc,navigate,accountId,my,isSafe,toast});
  }, DELAY);
}

export function showHelpfulWalkthrough({id,app,esc,navigate,accountId,isSafe=()=>true,toast=()=>{},preview=false}) {
  const a=helpGuide(id);
  if(!a || !app || !accountId || !isSafe())return;
  resetCreatorAnnouncements();
  if(!preview){
    setMarker(accountId);
    void recordHelpChoice(accountId,id,"viewed").catch(()=>toast("This guide can be viewed, but tip preferences couldn't be saved online."));
  }
  present({...a,manual:true,preview},{app,esc,navigate,accountId,isSafe,toast,my:token});
}

function present(a,{app,esc,navigate,accountId,isSafe,toast,my}) {
    const prior = document.activeElement;
    const id = `cta-${Math.random().toString(36).slice(2, 8)}`;
    const wrap = document.createElement("div");
    wrap.className = `cta-backdrop${a.local&&(!a.manual||a.preview)?" cta-help":""}`;
    wrap.innerHTML = renderPromptCard(a,{esc,id,baseUrl:import.meta.env.BASE_URL});
    const modal = wrap.firstElementChild;
    const err = wrap.querySelector(".cta-err");
    let busy = false;
    const onKey = e => {
      if (e.key === "Escape") { e.preventDefault(); dismiss("not-now"); return; }
      if (e.key !== "Tab" || (a.local&&!a.manual)) return;
      const f = [...modal.querySelectorAll("button:not([disabled])")];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    const cleanup = () => {
      const restoreFocus=modal.contains(document.activeElement);
      clearInterval(safetyTimer);
      document.removeEventListener("keydown", onKey, true);
      wrap.remove();
      if (restoreFocus&&prior?.isConnected) try { prior.focus(); } catch { /* ignore */ }
    };
    open = { cleanup };
    const safetyTimer = setInterval(() => { if (!isSafe() && open?.cleanup === cleanup) closeModal(); }, 500);
    async function dismiss(choice) {
      if (busy) return;
      busy = true; err.textContent = "";
      if(!a.preview) {
        try { await recordHelpChoice(accountId,a.id,choice); }
        catch {toast("Your tip choice couldn't be saved online.");}
      }
      if (open?.cleanup === cleanup) closeModal();
      if(!a.local&&!a.preview)requestCloudApi(`/api/announcements/${encodeURIComponent(a.id)}/dismiss`, { method:"POST",body:{choice} })
        .catch(()=>toast("Closed on this device. Online announcement preferences couldn't be updated."));
    }
    wrap.addEventListener("click", e => { if (e.target === wrap) dismiss("not-now"); });
    wrap.querySelectorAll("[data-cta]").forEach(b => b.addEventListener("click", async () => {
      const c = b.dataset.cta;
      if (c !== "action" && c !== "secondary-action") return dismiss(c);
      if (busy) return;
      busy = true;
      try {
        if(!a.preview)await recordHelpChoice(accountId,a.id,"action");
        if(!a.local&&!a.preview)await requestCloudApi(`/api/announcements/${encodeURIComponent(a.id)}/event`, { method: "POST", body: { event: "action" } });
      } catch { /* still navigate on explicit user request */ }
      if (open?.cleanup !== cleanup) return;
      closeModal();
      if (my === token) navigate?.(c==="secondary-action"?a.secondaryRoute:a.primaryRoute);
    }));
    document.addEventListener("keydown", onKey, true);
    app.appendChild(wrap);
    if(!a.local||a.manual)modal.querySelector(".cta-primary, .cta-secondary")?.focus();
    if(!a.local)requestCloudApi(`/api/announcements/${encodeURIComponent(a.id)}/event`, { method: "POST", body: { event: "shown" } }).catch(() => {});
}
