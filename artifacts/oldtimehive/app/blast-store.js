import { api } from "./store.js";
import { findSharedComment } from "./shared-content.js";
import { BLAST_COMMUNITIES, getBlastCommunity } from "./blast-community-data.js";
import { getBlastCloudState, loadBlastCloudState, saveBlastCloudState } from "./blast-cloud-state.js";
import { cleanupLegacyBlastMediaIfUnused, transferLegacyBlastMedia } from "./blast-video-note-store.js";
import { putLocalMedia } from "./local-media.js";

const STORAGE_KEY = "oldtime-blast-v1";
const AUDIENCES = new Set(["public", "friends", "group", "only-me", "community"]);
const POST_TYPES = new Set(["post", "question", "activity", "event"]);
const REACTIONS = new Set(["heart", "support"]);

function blankState() {
  return { version: 1, friendships: [], friendRequests: [], posts: [], preferences: {}, communityMemberships: [] };
}

function readState() {
  return getBlastCloudState("social", blankState);
}

function updateState(change) {
  const state = readState();
  const result = change(state);
  const saved = saveBlastCloudState("social", state);
  const notify = () => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("blast-data-changed"));
    return result;
  };
  return saved && typeof saved.then === "function" ? saved.then(notify) : notify();
}

function legacyOwnerState(state, ownerId) {
  return {
    version: 1,
    friendships: state.friendships.filter(item => item.users?.includes(ownerId)),
    friendRequests: state.friendRequests.filter(item => item.from === ownerId || item.to === ownerId),
    posts: state.posts.filter(item => item.authorId === ownerId),
    preferences: state.preferences?.[ownerId] ? { [ownerId]: state.preferences[ownerId] } : {},
    communityMemberships: state.communityMemberships.filter(item => item.userId === ownerId),
  };
}

function parseLegacyBlastState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return blankState();
  let state;
  try { state = JSON.parse(raw); }
  catch { throw new Error("The old Community archive is unreadable. It has been left unchanged."); }
  if (!state || state.version !== 1) throw new Error("The old Community archive has an unsupported format and has been left unchanged.");
  for (const key of ["friendships", "friendRequests", "posts", "communityMemberships"]) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  if (!state.preferences || typeof state.preferences !== "object" || Array.isArray(state.preferences)) state.preferences = {};
  return state;
}

async function prepareLegacyBlastState(state) {
  const oldMediaIds = new Set();
  for (const post of state.posts) {
    if (!post.media) continue;
    if (post.media.dataUrl) {
      const response = await fetch(post.media.dataUrl);
      const blob = await response.blob();
      const uploaded = await putLocalMedia(blob);
      post.media.mediaId = uploaded.replace(/^oldtime-media:/, "media-");
      delete post.media.dataUrl;
    } else if (post.media.mediaId) {
      const transferred = await transferLegacyBlastMedia(post.media.mediaId);
      oldMediaIds.add(transferred.oldId);
      post.media.mediaId = transferred.id;
    }
  }
  return { data: state, oldMediaIds: [...oldMediaIds] };
}

export async function loadBlastSocialCloudState() {
  const ownerId = api.me()?.id;
  if (!ownerId || !api.cloudAccountId()) throw new Error("Sign in to sync Community.");
  return loadBlastCloudState("social", {
    blankState,
    legacyKey: STORAGE_KEY,
    filterLegacy: legacy => legacyOwnerState(legacy, ownerId),
    prepareLegacy: prepareLegacyBlastState,
    removeMigratedLegacy: async (legacy, _owned, prepared) => {
      const remaining = {
        ...legacy,
        friendships: legacy.friendships.filter(item => !item.users?.includes(ownerId)),
        friendRequests: legacy.friendRequests.filter(item => item.from !== ownerId && item.to !== ownerId),
        posts: legacy.posts.filter(item => item.authorId !== ownerId),
        communityMemberships: legacy.communityMemberships.filter(item => item.userId !== ownerId),
        preferences: Object.fromEntries(Object.entries(legacy.preferences || {}).filter(([id]) => id !== ownerId)),
      };
      if (remaining.friendships.length || remaining.friendRequests.length || remaining.posts.length ||
        remaining.communityMemberships.length || Object.keys(remaining.preferences).length) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
      for (const id of prepared.oldMediaIds || []) await cleanupLegacyBlastMediaIfUnused(id);
    },
  });
}

function signedInUserId() {
  const me = api.me();
  if (!me) throw new Error("Sign in to use Community.");
  return me.id;
}

function makeId(prefix = "blast") {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${uuid || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
}

function userPair(first, second) {
  return [first, second].sort((a, b) => a.localeCompare(b));
}

function areFriends(state, first, second) {
  return state.friendships.some(friendship =>
    friendship.users?.[0] === userPair(first, second)[0] &&
    friendship.users?.[1] === userPair(first, second)[1]
  );
}

function isMember(state, userId, communityId) {
  return state.communityMemberships.some(item => item.userId === userId && item.communityId === communityId);
}

function findGroup(groupId, userId) {
  return (api.db().convos || []).find(conversation =>
    conversation.id === groupId &&
    Array.isArray(conversation.members) &&
    conversation.members.includes(userId) &&
    (conversation.group || conversation.members.length > 2)
  );
}

function canViewPost(post, userId, state = readState()) {
  if (!post || !userId) return false;
  if (post.sharedPostId) {
    const source = api.post(post.sharedPostId);
    if (!source || !api.canSeePost(source, userId)) return false;
  }
  if (post.authorId === userId) return true;
  const author = api.user(post.authorId);
  if (!author || api.blocked(userId, author.id) || !api.canSee(author.id, userId)) return false;
  if (post.communityId) return post.audience === "community" && isMember(state, userId, post.communityId);
  if (!areFriends(state, userId, author.id)) return false;
  if (post.recipientIds?.length && !post.recipientIds.includes(userId)) return false;

  if (post.audience === "public") return true; // Legacy records now require friendship above.
  if (post.audience === "friends") return areFriends(state, userId, author.id);
  if (post.audience === "group") return Boolean(post.groupId && findGroup(post.groupId, userId));
  return false;
}

function requireVisiblePost(postId, userId, state) {
  const post = state.posts.find(item => item.id === postId);
  if (!post || !canViewPost(post, userId, state)) {
    throw new Error("This post is no longer available.");
  }
  return post;
}


function visibleGroups(userId) {
  return (api.db().convos || [])
    .filter(conversation =>
      Array.isArray(conversation.members) &&
      conversation.members.includes(userId) &&
      (conversation.group || conversation.members.length > 2)
    )
    .map(conversation => ({
      id: conversation.id,
      name: conversation.group?.name || conversation.title || "Group conversation",
      memberCount: conversation.members.length
    }));
}

export function listBlastPosts(userId = signedInUserId(), filters = {}) {
  const state = readState();
  const query = String(filters.query || "").trim().toLowerCase();
  const type = filters.type || "all";
  return state.posts
    .filter(post => canViewPost(post, userId, state))
    .filter(post => type === "all" || post.type === type || (type === "events" && post.type === "event"))
    .filter(post => !query || `${post.title || ""} ${post.body || ""} ${post.location || ""}`.toLowerCase().includes(query))
    .sort((left, right) => right.createdAt - left.createdAt);
}

export function getBlastPost(postId, userId = signedInUserId()) {
  const state = readState();
  const post = state.posts.find(item => item.id === postId);
  return post && canViewPost(post, userId, state) ? post : null;
}

export function listBlastGroups(userId = signedInUserId()) {
  return visibleGroups(userId);
}

export function listBlastCommunities(userId = signedInUserId()) {
  const state = readState();
  return BLAST_COMMUNITIES.map(community => ({
    ...community,
    joined: isMember(state, userId, community.id),
    postCount: state.posts.filter(post => post.communityId === community.id && canViewPost(post, userId, state)).length
  }));
}

export function isBlastCommunityMember(communityId, userId = signedInUserId()) {
  if (!getBlastCommunity(communityId)) return false;
  return isMember(readState(), userId, String(communityId));
}

export function joinBlastCommunity(communityId, userId = signedInUserId()) {
  const community = getBlastCommunity(communityId);
  if (!community) throw new Error("This community is not available.");
  return updateState(state => {
    if (isMember(state, userId, community.id)) return false;
    state.communityMemberships.push({ userId, communityId: community.id, joinedAt: Date.now() });
    return true;
  });
}

export function leaveBlastCommunity(communityId, userId = signedInUserId()) {
  const community = getBlastCommunity(communityId);
  if (!community) throw new Error("This community is not available.");
  return updateState(state => {
    const before = state.communityMemberships.length;
    state.communityMemberships = state.communityMemberships.filter(item => item.userId !== userId || item.communityId !== community.id);
    return state.communityMemberships.length !== before;
  });
}

export function listBlastCommunityPosts(communityId, userId = signedInUserId()) {
  if (!getBlastCommunity(communityId) || !isBlastCommunityMember(communityId, userId)) return [];
  return listBlastPosts(userId).filter(post => post.communityId === communityId);
}

function safeMediaAnnotationNumber(value, fallback = 50, min = 0, max = 100) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function sanitizeBlastMediaOverlays(overlays) {
  const safeColor = color => color === "#111111" ? "#111111" : "#ffffff";
  const strokes = (Array.isArray(overlays.strokes) ? overlays.strokes : [])
    .slice(0, 120)
    .map(stroke => {
      const points = (Array.isArray(stroke?.points) ? stroke.points : [])
        .slice(0, 800)
        .map(point => ({
          x: safeMediaAnnotationNumber(point?.x),
          y: safeMediaAnnotationNumber(point?.y)
        }));
      if (!points.length) return null;
      return {
        color: safeColor(stroke?.color),
        width: safeMediaAnnotationNumber(stroke?.width, 2, 0.8, 4),
        points
      };
    })
    .filter(Boolean);
  const labels = (Array.isArray(overlays.labels) ? overlays.labels : [])
    .slice(0, 100)
    .map(label => ({
      text: String(label?.text || "").slice(0, 80),
      x: safeMediaAnnotationNumber(label?.x),
      y: safeMediaAnnotationNumber(label?.y),
      color: safeColor(label?.color),
      size: safeMediaAnnotationNumber(label?.size, 6, 2, 12)
    }))
    .filter(label => label.text.trim());
  return { strokes, labels };
}

export function createBlastPost(input = {}) {
  const authorId = signedInUserId();
  const type = String(input.type || "post");
  const communityId = String(input.communityId || "");
  const state = readState();
  if (communityId && (!getBlastCommunity(communityId) || !isMember(state, authorId, communityId))) {
    throw new Error("Join this community before posting.");
  }
  const audience = communityId ? "community" : input.audience === "public" ? "friends" : String(input.audience || "friends");
  if (!POST_TYPES.has(type)) throw new Error("Choose a valid post type.");
  if (!AUDIENCES.has(audience)) throw new Error("Choose who can see this post.");

  const title = String(input.title || "").trim().slice(0, 90);
  const body = String(input.body || "").trim().slice(0, 1000);
  const sharedPostId = String(input.sharedPostId || "");
  const sharedCommentId = String(input.sharedCommentId || "");
  if (sharedPostId) {
    const original = api.post(sharedPostId);
    if (type !== "post" || !original || !api.canSeePost(original)) throw new Error("Post unavailable.");
    if (sharedCommentId && !findSharedComment(original, sharedCommentId)) throw new Error("Comment unavailable.");
  }
  if (sharedCommentId && !sharedPostId) throw new Error("Post unavailable.");
  const recipientIds = [...new Set((Array.isArray(input.recipientIds) ? input.recipientIds : []).map(String))];
  const initialComment = String(input.initialComment || "").trim();
  if (initialComment.length > 500) throw new Error("Comments must be 500 characters or fewer.");
  if (recipientIds.some(id => !areFriends(state, authorId, id) || api.blocked(authorId, id))) {
    throw new Error("Choose confirmed friends.");
  }
  if (sharedPostId && recipientIds.some(id => !api.canSeePost(api.post(sharedPostId), id))) {
    throw new Error("One of these friends cannot view this post.");
  }
  if (type === "event" ? !title : !body && !sharedPostId) {
    throw new Error(type === "event" ? "Add an event title." : "Write something before sharing.");
  }
  if (audience === "group" && !findGroup(input.groupId, authorId)) {
    throw new Error("Choose one of your group conversations.");
  }

  let media = null;
  if (input.media) {
    const mediaType = input.media.mediaType === "video" ? "video" : "image";
    if (input.media.mediaId) {
      const mediaId = String(input.media.mediaId);
      if (!/^media-[a-z0-9-]{1,128}$/i.test(mediaId)) throw new Error("Choose a valid video file.");
      media = {
        mediaId,
        mediaType,
        name: String(input.media.name || "").slice(0, 120)
      };
    } else {
      throw new Error("Upload the image or video to your account before creating this post.");
    }
    if (input.media.overlays && typeof input.media.overlays === "object") {
      media.overlays = sanitizeBlastMediaOverlays(input.media.overlays);
    }
    if(input.media.creativeProject){media.creativeProject=structuredClone(input.media.creativeProject);media.creativeId=String(input.media.creativeId);}
  }

  let event = null;
  if (type === "event") {
    const kind = String(input.event?.kind || "meetup");
    const startsAt = Number(input.event?.startsAt);
    const durationMinutes = Number(input.event?.durationMinutes || 60);
    if (!["watch-party", "meetup", "fitness-challenge"].includes(kind)) {
      throw new Error("Choose a valid event type.");
    }
    if (!Number.isFinite(startsAt) || startsAt < Date.now() - 60_000) {
      throw new Error("Choose a future date and time.");
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes < 15 || durationMinutes > 1440) {
      throw new Error("Event duration must be between 15 minutes and 24 hours.");
    }
    const online = input.event?.online === true;
    const location = String(input.event?.location || "").trim().slice(0, 120);
    if (!online && !location) throw new Error("Add a venue or choose an online event.");
    event = { kind, startsAt, durationMinutes, online, location };
  }

  const post = {
    id: makeId("post"),
    authorId,
    type,
    title,
    body,
    audience,
    communityId: communityId || null,
    sharedPostId: sharedPostId || null,
    sharedCommentId: sharedCommentId || null,
    recipientIds,
    groupId: audience === "group" ? String(input.groupId) : null,
    location: String(input.location || "").trim().slice(0, 120),
    activityGoal: String(input.activityGoal || "").trim().slice(0, 100),
    media,
    event,
    reactions: [],
    replies: initialComment ? [{ id: makeId("reply"), authorId, body: initialComment, createdAt: Date.now() }] : [],
    participants: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const saved = updateState(state => { state.posts.unshift(post); });
  return saved && typeof saved.then === "function" ? saved.then(() => post) : post;
}
export function updateBlastCreativePost(creativeId, change) {
  const post=listBlastPosts().find(item=>item.media?.creativeId===creativeId);
  if(!post)throw new Error("This post is no longer available.");
  return updateState(state=>{
    const record=state.posts.find(item=>item.id===post.id);
    if(!record)throw new Error("This post is no longer available.");
    change({id:creativeId,author:record.authorId,creativeProject:record.media.creativeProject});
  });
}

export function addBlastReply(postId, text) {
  const userId = signedInUserId();
  const body = String(text || "").trim().slice(0, 500);
  if (!body) throw new Error("Write a reply first.");
  return updateState(state => {
    const post = requireVisiblePost(postId, userId, state);
    const reply = { id: makeId("reply"), authorId: userId, body, createdAt: Date.now() };
    post.replies ||= [];
    post.replies.push(reply);
    post.updatedAt = Date.now();
    return reply;
  });
}

export function toggleBlastReaction(postId, kind = "heart") {
  const userId = signedInUserId();
  if (!REACTIONS.has(kind)) throw new Error("Choose a valid reaction.");
  return updateState(state => {
    const post = requireVisiblePost(postId, userId, state);
    post.reactions ||= [];
    const alreadyReacted = post.reactions.some(reaction => reaction.userId === userId && reaction.kind === kind);
    if (alreadyReacted) {
      post.reactions = post.reactions.filter(reaction => !(reaction.userId === userId && reaction.kind === kind));
    } else {
      post.reactions.push({ userId, kind });
    }
    return post.reactions;
  });
}

export function toggleBlastRepost(postId) {
  const userId = signedInUserId();
  return updateState(state => {
    const post = requireVisiblePost(postId, userId, state);
    post.reposts ||= [];
    const alreadyReposted = post.reposts.some(item => item.userId === userId);
    post.reposts = alreadyReposted
      ? post.reposts.filter(item => item.userId !== userId)
      : [...post.reposts, { userId, createdAt: Date.now() }];
    post.updatedAt = Date.now();
    return !alreadyReposted;
  });
}

export function toggleBlastSavedPost(postId) {
  const userId = signedInUserId();
  return updateState(state => {
    const post = requireVisiblePost(postId, userId, state);
    post.savedBy ||= [];
    const alreadySaved = post.savedBy.includes(userId);
    post.savedBy = alreadySaved
      ? post.savedBy.filter(id => id !== userId)
      : [...post.savedBy, userId];
    post.updatedAt = Date.now();
    return !alreadySaved;
  });
}

export function setBlastEventRsvp(postId, status) {
  const userId = signedInUserId();
  if (!["going", "interested", "none"].includes(status)) throw new Error("Choose a valid RSVP.");
  return updateState(state => {
    const post = requireVisiblePost(postId, userId, state);
    if (post.type !== "event") throw new Error("This post is not an event.");
    post.participants ||= [];
    post.participants = post.participants.filter(participant => participant.userId !== userId);
    if (status !== "none") post.participants.push({ userId, status, updatedAt: Date.now() });
    post.updatedAt = Date.now();
    return post.participants;
  });
}

export function deleteBlastPost(postId) {
  const userId = signedInUserId();
  return updateState(state => {
    const post = state.posts.find(item => item.id === postId);
    if (!post || post.authorId !== userId) throw new Error("You can only delete your own post.");
    state.posts = state.posts.filter(item => item.id !== postId);
    return true;
  });
}

export function listBlastPeople(query = "", userId = signedInUserId()) {
  const state = readState();
  const normalizedQuery = String(query || "").trim().toLowerCase();
  return api.db().users
    .filter(user => user.id !== userId && !api.blocked(userId, user.id))
    .filter(user => !normalizedQuery || `${user.name || ""} ${user.username || ""}`.toLowerCase().includes(normalizedQuery))
    .map(user => {
      const incoming = state.friendRequests.find(request => request.from === user.id && request.to === userId);
      const outgoing = state.friendRequests.find(request => request.from === userId && request.to === user.id);
      return {
        id: user.id,
        name: user.name || user.username,
        username: user.username,
        avatar: user.avatar,
        status: areFriends(state, userId, user.id) ? "friends" : incoming ? "incoming" : outgoing ? "outgoing" : "available"
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function listBlastFriends(userId = signedInUserId()) {
  const state = readState();
  return state.friendships
    .filter(friendship => friendship.users?.includes(userId))
    .map(friendship => friendship.users.find(id => id !== userId))
    .filter(id => Boolean(api.user(id)) && !api.blocked(userId, id));
}

export function listBlastFriendRequests(userId = signedInUserId()) {
  return readState().friendRequests.filter(request => request.from === userId || request.to === userId);
}

export function sendBlastFriendRequest(targetId) {
  const from = signedInUserId();
  const to = String(targetId || "");
  if (!to || from === to || !api.user(to)) throw new Error("Choose another Oldtime member.");
  if (api.blocked(from, to)) throw new Error("You can’t connect with this account.");

  return updateState(state => {
    if (areFriends(state, from, to)) throw new Error("You are already friends.");
    if (state.friendRequests.some(request => request.from === from && request.to === to)) {
      throw new Error("Your friend request is already waiting.");
    }
    if (state.friendRequests.some(request => request.from === to && request.to === from)) {
      throw new Error("They already sent you a request. Accept it from your requests.");
    }
    const request = { id: makeId("friend"), from, to, createdAt: Date.now() };
    state.friendRequests.push(request);
    return request;
  });
}

export function acceptBlastFriendRequest(requestId) {
  const userId = signedInUserId();
  return updateState(state => {
    const request = state.friendRequests.find(item => item.id === requestId && item.to === userId);
    if (!request) throw new Error("This friend request is no longer available.");
    if (api.blocked(request.from, request.to)) throw new Error("You can’t connect with this account.");
    state.friendships.push({ id: makeId("friendship"), users: userPair(request.from, request.to), createdAt: Date.now() });
    state.friendRequests = state.friendRequests.filter(item =>
      !(item.from === request.from && item.to === request.to) &&
      !(item.from === request.to && item.to === request.from)
    );
    return true;
  });
}

export function removeBlastFriendRequest(requestId) {
  const userId = signedInUserId();
  return updateState(state => {
    const request = state.friendRequests.find(item =>
      item.id === requestId && (item.from === userId || item.to === userId)
    );
    if (!request) throw new Error("This friend request is no longer available.");
    state.friendRequests = state.friendRequests.filter(item => item.id !== requestId);
    return true;
  });
}

export function removeBlastFriend(targetId) {
  const userId = signedInUserId();
  const pair = userPair(userId, String(targetId || ""));
  return updateState(state => {
    state.friendships = state.friendships.filter(friendship =>
      friendship.users?.[0] !== pair[0] || friendship.users?.[1] !== pair[1]
    );
    return true;
  });
}

