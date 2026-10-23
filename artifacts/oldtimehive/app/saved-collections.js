import { api, mutate } from "./store.js";
import { recordActivity } from "./activity-tracking.js";

function currentUser() {
  const user = api.me();
  if (!user) throw new Error("Sign in to save posts.");
  return user;
}

function visiblePost(id) {
  const post = api.post(id);
  if (!post || !api.canSeePost(post)) throw new Error("Post unavailable.");
  return post;
}

function saveReference(db, owner, postId, saved) {
  owner.savedPostIds ||= db.posts.filter(post => post.saves?.includes(owner.id)).map(post => post.id);
  owner.savedPostIds = owner.savedPostIds.filter(id => id !== postId);
  if (saved) owner.savedPostIds.push(postId);
  const local = db.posts.find(post => post.id === postId);
  if (local) {
    local.saves = (local.saves || []).filter(id => id !== owner.id);
    if (saved) local.saves.push(owner.id);
  }
}

function syncOnlineBookmark(postId) {
  const post = api.cloudPost(postId);
  const owner = currentUser();
  if (post) post.saves = owner.savedPostIds?.includes(postId) ? [owner.id] : [];
}

export function listSavedPosts() {
  const owner = currentUser();
  const available = [...new Map([...api.posts(), ...api.cloudPosts()].map(post => [post.id, post])).values()];
  return available.filter(post => api.canSeePost(post) &&
    (post.saves?.includes(owner.id) || owner.savedPostIds?.includes(post.id)))
    .sort((a, b) => b.created - a.created);
}

function cleanName(value) {
  const name = String(value || "").trim();
  if (!name || name.length > 60) throw new Error("Use a collection name of 1–60 characters.");
  return name;
}

export function listSavedCollections(postId = "") {
  const user = currentUser();
  return (user.savedCollections || []).map(collection => {
    const posts = (collection.postIds || []).map(id => api.post(id))
      .filter(post => post && (post.saves?.includes(user.id) || user.savedPostIds?.includes(post.id)) && api.canSeePost(post));
    const first = posts[0];
    return {
      id: collection.id, name: collection.name,
      selected: posts.some(post => post.id === postId),
      postIds: posts.map(post => post.id), count: posts.length,
      cover: first?.kind === "video" ? api.user(first.author)?.avatar || "" : first?.media?.[0] || ""
    };
  });
}

export function setPostSaved(postId, saved) {
  const user = currentUser();
  const item=visiblePost(postId),wasSaved=item.saves?.includes(user.id)||user.savedPostIds?.includes(postId);
  mutate(db => {
    const owner = db.users.find(item => item.id === user.id);
    if (!owner) throw new Error("Account unavailable.");
    saveReference(db, owner, postId, saved);
    if (!saved) for (const collection of owner.savedCollections || []) {
      collection.postIds = (collection.postIds || []).filter(id => id !== postId);
    }
  });
  syncOnlineBookmark(postId);
  if (item.cloud && wasSaved !== saved) item.saveCount = Math.max(0, Number(item.saveCount || 0) + (saved ? 1 : -1));
  if(saved&&!wasSaved)recordActivity("save",item);
}

export function createSavedCollection(value, postId = "") {
  const user = currentUser();
  const name = cleanName(value);
  if (postId) visiblePost(postId);
  const id = `collection-${globalThis.crypto.randomUUID()}`;
  mutate(db => {
    const owner = db.users.find(item => item.id === user.id);
    owner.savedCollections ||= [];
    if (owner.savedCollections.some(item => item.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("That collection name is already used.");
    }
    owner.savedCollections.push({ id, name, postIds: postId ? [postId] : [], createdAt: Date.now() });
    if (postId) {
      saveReference(db, owner, postId, true);
    }
  });
  if (postId) syncOnlineBookmark(postId);
  return id;
}

export function renameSavedCollection(id, value) {
  const user = currentUser();
  const name = cleanName(value);
  mutate(db => {
    const owner = db.users.find(item => item.id === user.id);
    const collection = (owner.savedCollections || []).find(item => item.id === id);
    if (!collection) throw new Error("Collection unavailable.");
    if (owner.savedCollections.some(item => item.id !== id && item.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("That collection name is already used.");
    }
    collection.name = name;
  });
}

export function deleteSavedCollection(id) {
  const user = currentUser();
  mutate(db => {
    const owner = db.users.find(item => item.id === user.id);
    owner.savedCollections = (owner.savedCollections || []).filter(item => item.id !== id);
  });
}

export function toggleSavedCollection(id, postId) {
  const user = currentUser();
  visiblePost(postId);
  mutate(db => {
    const owner = db.users.find(item => item.id === user.id);
    const collection = (owner.savedCollections || []).find(item => item.id === id);
    if (!collection) throw new Error("Collection unavailable.");
    collection.postIds ||= [];
    if (collection.postIds.includes(postId)) {
      collection.postIds = collection.postIds.filter(value => value !== postId);
    } else {
      collection.postIds.push(postId);
      saveReference(db, owner, postId, true);
    }
  });
  syncOnlineBookmark(postId);
}
