import { api } from "./store.js";

const GAP = 72 * 60 * 60 * 1000;
export const HELP_GUIDES = [
  { id:"help-welcome", title:"Explore Oldtime at your pace", description:"A little help with creating, connecting and privacy. Choose the guides you want to explore.", image:"welcome.webp", primaryLabel:"Explore guides", primaryRoute:"help-guides", group:"features", section:"Get started", pages:["home"], eligible:c=>!!c.page, priority:55 },
  { id:"help-cover", title:"Make your profile yours", description:"Add a cover photo, update your bio or choose an avatar. Preview your changes before saving.", image:"cover.webp", primaryLabel:"Edit profile", primaryRoute:"help-cover", group:"features", section:"Get started", pages:["home","profile"], eligible:c=>!c.hasCover, priority:40 },
  { id:"help-friends", title:"Find your people", description:"Explore Friends in Community and look for people you know. You decide who to add.", image:"friends.webp", primaryLabel:"Open Friends", primaryRoute:"help-friends", secondaryLabel:"About Community", secondaryRoute:"help-article-blast", group:"communities", section:"Connect", pages:["home","blast"], eligible:c=>c.friendCount===0, priority:30 },
  { id:"help-blast", title:"Bring your friends to Community", description:"Share your Oldtime username with friends and invite them to explore Community. Learn how video notes, friends and chats work.", image:"blast.webp", primaryLabel:"Invite to Community", primaryRoute:"help-blast-invite", secondaryLabel:"About Community", secondaryRoute:"help-article-blast", group:"communities", section:"Connect", pages:["blast"], eligible:c=>c.friendCount<3, priority:15 },
  { id:"help-note", title:"What's on your mind?", description:"Write a short note. Make it yours, then preview it before sharing.", image:"note.webp", primaryLabel:"Write a note", primaryRoute:"help-note", group:"features", section:"Get started", pages:["home","profile"], eligible:c=>!c.hasNote, priority:20 },
  { id:"help-studio", title:"Create without leaving the canvas", description:"Start in Camera or upload a photo. Use Edit to add text, crop and adjust your image. Nothing is shared until you choose to share.", image:"studio.webp", primaryLabel:"Open Camera", primaryRoute:"help-studio", group:"features", section:"Get started", pages:["home"], eligible:c=>!!c.page, priority:15 },
  { id:"help-communities", title:"A space for shared interests", description:"Explore the communities available to you. Check a community's rules before joining or starting a conversation.", image:"communities.webp", primaryLabel:"Explore communities", primaryRoute:"help-communities", group:"communities", section:"Connect", pages:["communities"], eligible:c=>!!c.page, priority:40 },
  { id:"help-saved", title:"Keep a message easy to find", description:"Use the bookmark action on a message, then open Saved in your inbox to review it. Saving is different from liking.", image:"saved.webp", primaryLabel:"Open Messages", primaryRoute:"help-messages", secondaryLabel:"How saving works", secondaryRoute:"help-article-saved", group:"features", section:"Connect", pages:["messages"], eligible:c=>!!c.page, priority:30 },
  { id:"help-privacy", title:"Your audience, your choice", description:"Review your account privacy, Close Friends and profile visibility controls. The Privacy Center explains the available settings.", image:"privacy.webp", primaryLabel:"Review privacy", primaryRoute:"settings:privacy-center", group:"features", section:"Privacy & control", pages:["settings","profile"], eligible:c=>!!c.page, priority:50 },
  { id:"help-chat-privacy", title:"Read receipts and last seen", description:"Check your chat privacy settings before your next conversation. Review what your activity controls do and who they apply to.", image:"messages.webp", primaryLabel:"Chat privacy", primaryRoute:"settings:chat", group:"features", section:"Privacy & control", pages:["messages","settings"], eligible:c=>!!c.page, priority:45 },
  { id:"help-notifications", title:"Choose the updates you want", description:"Review notifications and optional announcement categories. You can also pause occasional feature tips in the guide library.", image:"notifications.webp", primaryLabel:"Notifications", primaryRoute:"settings:notifications", secondaryLabel:"Tip preferences", secondaryRoute:"help-guides", group:"features", section:"Privacy & control", pages:["notifications","settings"], eligible:c=>!!c.page, priority:35 },
  { id:"help-safety", title:"Know where to get help", description:"Review blocked accounts, privacy topics and Help & Support. Problem reports are submitted to your account’s online report history.", image:"safety.webp", primaryLabel:"Help & Support", primaryRoute:"help", group:"features", section:"Privacy & control", pages:["communities","blast","settings"], eligible:c=>!!c.page, priority:20 },
  { id:"help-interests", title:"Tune your suggestions", description:"Choose the interests you want to see more of. Oldtime uses your saved choices and activity. No engagement is invented and no paid AI is used.", image:"welcome.webp", primaryLabel:"Choose interests", primaryRoute:"help-guides", group:"features", section:"Preferences", pages:["home"], eligible:c=>!!c.page&&c.interestsSet===false, priority:25 },
];
export function helpGuide(id) {
  const guide=HELP_GUIDES.find(item=>item.id===id);
  return guide ? {...guide,category:guide.section,optional:true,local:true} : null;
}
export function readHelpState(accountId, storage) {
  if (storage || ![api.cloudAccountId(), api.me()?.id].filter(Boolean).includes(accountId) ||
    !api.cloudAccountStateLoaded()) return null;
  const state = api.cloudAccountState()?.helpPreferences;
  if (!state) return { lastShownAt: 0, items: {}, paused: false };
  if (typeof state !== "object" || Array.isArray(state) || !state.items ||
    typeof state.items !== "object" || Array.isArray(state.items) ||
    typeof state.lastShownAt !== "number" || !Number.isFinite(state.lastShownAt) || state.lastShownAt < 0) return null;
  return { paused: false, ...state };
}
export function canShowHelp(state, now=Date.now()) {
  return !!state && !state.paused && (!state.lastShownAt || now-state.lastShownAt>=GAP);
}
export function hasSeenHelp(state,id) {
  const item=state?.items?.[id];
  return !!(item?.never || item?.lastShownAt || item?.viewedAt || item?.actions || item?.dismissed>=2);
}
export async function setHelpPaused(accountId,paused) {
  const state=readHelpState(accountId);
  if(!state)throw new Error("Your tip preferences could not be saved.");
  state.paused=!!paused;
  await api.updateCloudAccountState({ helpPreferences: state });
}
export function pickHelpPrompt(context={}, state, preferences={}, now=Date.now()) {
  if(context.composing||context.recording||!canShowHelp(state,now))return null;
  const choices=HELP_GUIDES.filter(p=>preferences[p.group]===true && p.eligible(context) && !hasSeenHelp(state,p.id))
    .filter(p=>context.page ? p.pages.includes(context.page) : ["help-cover","help-friends","help-blast","help-note"].includes(p.id))
    .filter(p=>now-(state.items?.[p.id]?.lastShownAt||0)>=GAP)
    .map(p=>({p,score:p.priority+(p.id==="help-blast"&&context.page==="blast"?30:0)-20*(state.items?.[p.id]?.dismissed||0)-30*(state.items?.[p.id]?.actions||0)}))
    .sort((a,b)=>b.score-a.score || a.p.id.localeCompare(b.p.id));
  const prompt=choices[0]?.p;
  return prompt ? helpGuide(prompt.id) : null;
}
export async function recordHelpChoice(accountId,id,event,now=Date.now()) {
  const state=readHelpState(accountId);if(!state)throw new Error("Your prompt preferences could not be saved.");
  const previous=state.items?.[id]||{}, next={...previous};
  if(event==="shown"){state.lastShownAt=now;next.lastShownAt=now;}
  if(event==="viewed")next.viewedAt=now;
  if(event==="never")next.never=true;
  if(event==="not-now")next.dismissed=(next.dismissed||0)+1;
  if(event==="action")next.actions=(next.actions||0)+1;
  state.items={...state.items,[id]:next};
  await api.updateCloudAccountState({ helpPreferences: state });
}
