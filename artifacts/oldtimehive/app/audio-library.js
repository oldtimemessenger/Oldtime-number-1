import { api, mutate } from "./store.js";

export function audioSource(post, viewerId = api.me()?.id) {
  const visited = new Set();
  while (post) {
    if (visited.has(post.id) || visited.size > 16 || !api.canSeePost(post, viewerId)) return null;
    visited.add(post.id);
    if (!post.audioSourcePostId) return post.kind === "video" && post.media?.[0] ? post : null;
    post = api.post(post.audioSourcePostId);
  }
  return null;
}
export function audioTitle(post) {
  const source = audioSource(post);
  const owner = source && api.user(source.author);
  return source?.sound && source.sound !== "Original audio" ? source.sound : `Original audio · @${owner?.username || "creator"}`;
}
export function savedAudio() {
  const user = api.me();
  if (!user) return [];
  return (user.savedAudioIds || []).map(id => api.post(id)).filter(post => audioSource(post))
    .map(post => ({ id: post.id, title: audioTitle(post), author: api.user(post.author)?.name || "", avatar: api.user(post.author)?.avatar || "" }));
}
export function audioSaved(post) {
  const source = audioSource(post);
  return Boolean(source && api.me()?.savedAudioIds?.includes(source.id));
}
export function saveAudio(post, save = true) {
  const me = api.me(), source = audioSource(post);
  if (!me || !source) throw new Error("This audio is unavailable.");
  mutate(db => {
    const owner = db.users.find(user => user.id === me.id);
    owner.savedAudioIds = (owner.savedAudioIds || []).filter(id => id !== source.id);
    if (save) owner.savedAudioIds.push(source.id);
  });
}
export function removeSavedAudio(id) {
  const me = api.me();
  if (!me) throw new Error("Sign in to manage saved audio.");
  mutate(db => {
    const owner = db.users.find(user => user.id === me.id);
    owner.savedAudioIds = (owner.savedAudioIds || []).filter(value => value !== id);
  });
}
export function audioUses(post) {
  const source = audioSource(post);
  if (!source) return 0;
  return [...api.posts(), ...api.cloudPosts()].filter(item => audioSource(item)?.id === source.id).length;
}
