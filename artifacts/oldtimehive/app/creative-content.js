import { api, mutate, notify } from "./store.js";
import { findSharedComment } from "./shared-content.js";
import { projectSources, serializeProject, projectScenes } from "./creative-project.js";
import { isLocalMedia, migrateLocalMedia, putLocalMedia, deleteLocalMedia } from "./local-media.js";

export function resolveCommentSource(source, viewerId = api.me()?.id) {
  if (!source) return null;
  const post = api.post(source.postId), comment = findSharedComment(post, source.commentId);
  if (!post || !api.canSeePost(post, viewerId) || !comment || comment.author !== source.commentAuthorId ||
    api.blocked(comment.author, viewerId)) return null;
  const parent = post.comments?.find(item => item.replies?.some(reply => reply.id === comment.id));
  return { post, comment, author: api.user(comment.author) || { username: "member" },
    replyTo: parent ? `Reply to @${api.user(parent.author)?.username || "member"}` : "" };
}
export function commentSource(postId, commentId) {
  const post = api.post(postId), comment = findSharedComment(post, commentId);
  if (!post || !comment) throw new Error("Comment unavailable.");
  const source = { postId, commentId, commentAuthorId: comment.author, remixAuthorId: api.me()?.id };
  if (!resolveCommentSource(source)) throw new Error("This comment is no longer available to remix.");
  return source;
}
export function validateProjectSources(project) {
  if (projectSources(project).some(source => !resolveCommentSource(source))) throw new Error("The original comment is unavailable. Nothing was published.");
}
export function validateProjectAudience(project, visibility) {
  validateProjectSources(project);
  if (!["public", "followers", "friends", "close-friends"].includes(visibility)) throw new Error("Choose a valid audience.");
  const owner = api.me();
  if (!owner) throw new Error("Sign in before publishing.");
  if (visibility === "close-friends" && !owner.closeFriends?.length) throw new Error("Add confirmed Friends to Close Friends first.");
  for (const source of projectSources(project)) {
    const original = api.post(source.postId);
    if (visibility === "public" && (!api.canSeePost(original, null) || api.user(original.author)?.private)) {
      throw new Error("This source is restricted. Choose a permitted, smaller audience.");
    }
    const audience = { id: "audience-check", author: owner.id, visibility };
    if (api.db().users.some(user => api.canSeePost(audience, user.id) && !resolveCommentSource(source, user.id))) {
      throw new Error("Some people in this audience cannot view the original comment. Choose a smaller audience.");
    }
  }
}
export async function persistCreativeProject(project, blobs, guard = () => validateProjectSources(project)) {
  guard();
  const saved = serializeProject(project), keys = [], replacements = new Map();
  try {
    for (const item of [saved,...saved.pages||[]].flatMap(scene=>[scene.background,...scene.layers.filter(layer=>layer.kind==="image")])) {
      if (!item.media) continue;
      if (!replacements.has(item.media) && blobs.has(item.media)) {
        const key = await putLocalMedia(blobs.get(item.media)); keys.push(key); replacements.set(item.media,key);
      }
      item.media = replacements.get(item.media) || item.media;
      if (item.media.startsWith("blob:")) throw new Error("Upload this media again before saving.");
    }
    guard();
    return { saved, cleanup: () => Promise.all(keys.map(key=>deleteLocalMedia(key).catch(()=>{}))) };
  } catch (error) {
    await Promise.all(keys.map(key=>deleteLocalMedia(key).catch(()=>{}))); throw error;
  }
}
export async function publishCreativeProject(project, blobs, { destination, visibility, caption, location = "", quote = false, heyWord = null, ownerId, active = () => true }) {
  if (!["post","story","community"].includes(destination)) throw new Error("Choose where to share.");
  if (destination === "story" && api.authMode() === "cloud") {
    throw new Error("Layered Studio Stories are not synced yet. Use the Story composer for a cloud-backed Story; nothing was saved on this device.");
  }
  validateProjectAudience(project, visibility);
  if (api.me()?.id !== ownerId || !active()) throw new Error("This editing session has ended.");
  const saved = serializeProject(project), keys = [];
  const length=projectScenes(saved).reduce((sum,scene)=>sum+scene.duration,0);
  if(destination==="story"&&length>60)throw new Error("A Story can be up to 60 seconds. Remove a page or shorten its video.");
  try {
    const replacements = new Map();
    const references = [saved,...saved.pages||[]].flatMap(scene=>[scene.background,...scene.layers.filter(layer=>layer.kind==="image")]);
    for (const item of references) {
      if (!item.media) continue;
      if (!replacements.has(item.media) && blobs.has(item.media)) {
        const key = await putLocalMedia(blobs.get(item.media)); keys.push(key); replacements.set(item.media, key);
      }
      item.media = replacements.get(item.media) || item.media;
      if (item.media.startsWith("blob:")) throw new Error("Upload this media again before publishing.");
    }
    validateProjectAudience(saved, visibility);
    if (api.me()?.id !== ownerId || !active()) throw new Error("This editing session has ended.");
    const id = `${destination === "story" ? "s" : "p"}-${crypto.randomUUID()}`;
    let storyPrompt = null;
    if (destination === "story" && heyWord) {
      const prompt = String(heyWord.prompt || "").trim().replace(/\s+/g, " ").slice(0, 120);
      if (!prompt) throw new Error("Write a prompt for the Oldtime story sticker.");
      const creditHidden = !!heyWord.creditHidden;
      const starter = creditHidden ? null : String(heyWord.startedBy || ownerId);
      const starterUser = starter ? api.user(starter) : null;
      const starterHandle = String(heyWord.startedByHandle || starterUser?.username || "member").replace(/^@/, "").slice(0, 40);
      storyPrompt = {
        promptId: String(heyWord.promptId || `hw-${crypto.randomUUID()}`),
        prompt,
        ...(creditHidden ? { creditHidden: true } : {
          startedBy: starter,
          startedByName: String(heyWord.startedByName || starterUser?.name || starterHandle).slice(0, 80),
          startedByHandle: starterHandle,
        }),
        sourceStoryId: String(heyWord.sourceStoryId || id),
        ...(heyWord.responseTo ? { responseTo: String(heyWord.responseTo) } : {}),
      };
    }
    const sources = projectSources(saved), first = sources[0];
    const scenes = projectScenes(saved);
    const quoteText = saved.layers.filter(layer => layer.kind === "text").map(layer => String(layer.text || "").trim()).filter(Boolean).join("\n");
    const quoteMedia = saved.background.media || saved.layers.find(layer => layer.kind === "image")?.media || "";
    const photoCarousel = ["post", "community"].includes(destination) && scenes.length > 1 && scenes.length <= 10 &&
      scenes.every(scene => scene.background.kind === "photo" && !!scene.background.media);
    const item = {
      id, author: ownerId, kind: quote ? "text" : photoCarousel ? "carousel" : saved.background.kind === "video" ? "video" : saved.background.kind === "photo" ? "photo" : "text",
      caption: String(caption || "").trim(), text: String(quote ? quoteText : caption || (saved.background.kind==="color"?quoteText:"")).trim(), created: Date.now(), visibility,
      location: String(saved.place?.label || location).trim().slice(0,160), place: saved.place || null, creationSurface: destination,
      creativeProject: saved, media: destination === "story" ? saved.background.media : quote ? [quoteMedia].filter(Boolean) : photoCarousel ? scenes.map(scene => scene.background.media) : [saved.background.media].filter(Boolean),
      ...(storyPrompt ? { heyWord: storyPrompt } : {}),
      ...(first ? { sourceComment: { post: first.postId, comment: first.commentId } } : {}),
      likes: [], comments: [], saves: [], reposts: [], views: 0, shares: 0, trim: length, color: saved.background.color,
      tags: [...String(caption || "").matchAll(/#([a-z0-9_]+)/gi)].map(match => match[1].toLowerCase())
    };
    if (["post", "community"].includes(destination) && api.authMode() === "cloud") {
      if (!["public", "close-friends"].includes(visibility)) {
        throw new Error("Only Public and Close Friends posts can be shared from the cloud editor.");
      }
      if (first && !api.post(first.postId)?.cloud) {
        throw new Error("The original post is unavailable online, so this remix cannot be published.");
      }
      const mediaIds = [];
      for (const reference of item.media) {
        if (!isLocalMedia(reference)) throw new Error("Upload this media again before publishing to your account.");
        await migrateLocalMedia(reference, ownerId);
        mediaIds.push(reference.slice("oldtime-media:".length));
      }
      const cloudPost = await api.createCloudPost(item.text, {
        visibility, place: item.place, mediaIds, destination: destination === "community" ? "community" : "main",
        ...(first ? { remixSourcePostId: first.postId } : {}),
      });
      return { ...item, ...cloudPost, caption: item.caption, creativeProject: saved };
    }
    mutate(db => {
      validateProjectAudience(saved, visibility);
      (destination === "story" ? db.stories : db.posts).unshift(item);
      const notified = new Set();
      for (const source of sources) {
        const postAuthor = api.post(source.postId)?.author;
        for (const recipient of new Set([source.commentAuthorId, postAuthor].filter(Boolean))) {
          if (recipient === ownerId || notified.has(recipient)) continue;
          notified.add(recipient);
          notify(db, { id: "n-" + crypto.randomUUID(), user: recipient, actor: ownerId, kind: "comment-remix",
            ...(destination === "story" ? { story: id } : { post: id }),
            body: recipient === source.commentAuthorId ? `remixed your comment${destination === "story" ? " in a story" : ""}` : "remixed a comment on your post",
            created: Date.now(), read: false });
        }
      }
      if (storyPrompt?.responseTo && !storyPrompt.creditHidden && storyPrompt.startedBy !== ownerId && api.user(storyPrompt.startedBy)) {
        notify(db, { id: "n-" + crypto.randomUUID(), user: storyPrompt.startedBy, actor: ownerId, kind: "hey-word",
          story: id, body: "shared a story in your prompt", created: Date.now(), read: false });
      }
    });
    return item;
  } catch (error) {
    await Promise.all(keys.map(key => deleteLocalMedia(key).catch(() => {})));
    throw error;
  }
}
