// Original, self-contained avatar illustrations. Identity images, not UI accents.
export const AVATAR_CHOICES = [
  {id:"red",name:"Red",top:"#c53b49",bottom:"#7d1421"},
  {id:"graphite",name:"Graphite",top:"#555b65",bottom:"#20242c"},
  {id:"slate",name:"Slate",top:"#9aa6b3",bottom:"#586676"},
  {id:"blue",name:"Blue",top:"#459dc1",bottom:"#245c78"},
  {id:"green",name:"Green",top:"#419779",bottom:"#245744"},
  {id:"silver",name:"Silver",top:"#d3d7dc",bottom:"#8d969f"}
];

export function automaticAvatarChoice(seed) {
  let hash=2166136261;
  for(const character of String(seed||"member")) hash=Math.imul(hash^character.codePointAt(0),16777619)>>>0;
  return AVATAR_CHOICES[hash%AVATAR_CHOICES.length].id;
}

const images=new Map();
function legacyAvatarImage(choice) {
  const preset=AVATAR_CHOICES.find(item=>item.id===choice);
  if(!preset)throw new Error("Unknown avatar choice.");
  if(!images.has(choice)) {
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="tone" x2=".25" y2="1"><stop stop-color="${preset.top}"/><stop offset="1" stop-color="${preset.bottom}"/></linearGradient><linearGradient id="figure" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity=".48"/></linearGradient><clipPath id="disc"><circle cx="60" cy="60" r="60"/></clipPath></defs><g clip-path="url(#disc)"><circle cx="60" cy="60" r="60" fill="url(#tone)"/><ellipse cx="60" cy="43" rx="19" ry="23" fill="url(#figure)"/><path d="M14 126v-15c0-27 18-40 46-40s46 13 46 40v15Z" fill="url(#figure)"/></g></svg>`;
    images.set(choice,`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`);
  }
  return images.get(choice);
}

export function avatarImage(choice) {
  if (!AVATAR_CHOICES.some(item => item.id === choice)) throw new Error("Unknown avatar choice.");
  return `${import.meta.env?.BASE_URL || "/"}brand/avatars/${choice}.svg`;
}

export function automaticAvatar(seed) { return avatarImage(automaticAvatarChoice(seed)); }

export function resolveProfileAvatar(user,legacyDefault) {
  const existing=typeof user.avatar==="string"?user.avatar.trim():"";
  const builtIn = AVATAR_CHOICES.find(choice => existing === legacyAvatarImage(choice.id));
  if (builtIn) return avatarImage(builtIn.id);
  // Never replace uploaded photos or explicitly chosen avatars.
  return existing&&existing!==legacyDefault ? existing : automaticAvatar(user.cloudAccountId||user.id||user.username);
}
