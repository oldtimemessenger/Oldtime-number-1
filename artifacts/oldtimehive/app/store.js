import { projectSources } from "./creative-project.js";
import { mergeFeedPosts, followingPosts } from "./feed-posts.js";
import { automaticAvatar, resolveProfileAvatar } from "./profile-avatars.js";
import { cloudApiUrl } from "./api-origin.js";
import { collectCompleteLegacyChatArchives, legacyChatArchiveHash, splitLegacyChatArchive } from "./legacy-chat-archive.js";

const KEY = "oldtime-v1";
const CLOUD_SESSION_KEY = "oldtime-cloud-session-v1";
const DEFAULT_AVATAR = new URL("./avatar.svg", import.meta.url).href;
let cloudFeed = [];
let cloudOpenedPost = null;
let cloudFeedSurface = "main";
let cloudCommunityFeed = [];
let cloudCommunityFeedLoaded = false;
let cloudCommunityFeedLoading = false;
let cloudCommunityFeedOwnerToken = null;
let cloudCommunityFeedError = "";
let cloudCommunityFeedSurface = "community";
let cloudCommunityFeedNextOffset = 0;
let cloudCommunityFeedHasMore = false;
let cloudStories = [];
let cloudStoriesLoading = false;
let cloudStoriesOwnerToken = null;
let cloudStoriesLoaded = false;
let cloudStoriesFetchedAt = 0;
let cloudStoriesAttemptedAt = 0;
let cloudCloseFriendsOwnerToken = null;
let cloudCloseFriends = [];
let cloudRelationshipsOwnerToken = null;
let cloudRelationships = null;
let cloudRelationshipsLoading = false;
let cloudRelationshipsAttemptedAt = 0;
let cloudRelationshipImportOwnerToken = null;
let cloudBlocksOwnerToken = null;
let cloudBlocks = [];
let cloudPrivacyOwnerToken = null;
let cloudStoryMedia = new Map();
let cloudStoryMediaExpiries = new Map();
let cloudStoryComments = new Map();
let deletedCloudPostIds = new Set();
let cloudProfiles = new Map();
let cloudProfileRepostLists = new Map();
let cloudFeedLoaded = false;
let cloudFeedLoading = false;
let cloudFeedOwnerToken = null;
let cloudFeedError = "";
let cloudFeedNextOffset = 0;
let cloudFeedHasMore = false;
const migratingLegacyRepostOwners = new Set();
let cloudChatsOwnerToken = null;
let cloudChatsFetchedAt = 0;
let legacyChatMigration = {
  accountId: null,
  loading: false,
  pending: 0,
  confirmed: 0,
  error: "",
  lastAttemptAt: 0,
};
let legacyChatMigrationPromise = null;
const cloudChatMessagesFetchedAt = new Map();
const cloudChatCreatePromises = new Map();
const CLOUD_FEED_PAGE_SIZE = 30;
const CLOUD_FEED_REQUEST_TIMEOUT_MS = 15_000;
const CLOUD_PROFILE_REPOST_PAGE_SIZE = 30;
let cloudPostMigration = {
  accountId: null,
  loading: false,
  done: false,
  error: "",
  confirmed: 0,
  pending: 0,
  unsupported: 0,
  conflicts: 0,
  lastAttemptAt: 0
};
let cloudPostMigrationPromise = null;
let cloudStoryMigration = {
  accountId: null,
  loading: false,
  done: false,
  error: "",
  confirmed: 0,
  pending: 0,
  unsupported: 0
};
let cloudStoryMigrationPromise = null;
let authOperationVersion = 0;

function discardUnusedAuthSession(auth) {
  if (!auth?.accessToken || getCloudSession()?.accessToken === auth.accessToken) return;
  void fetch(cloudApiUrl("/api/auth/logout"), { method: "POST", keepalive: true,
    headers: { Authorization: `Bearer ${auth.accessToken}` } }).catch(() => {});
}

function ensureCurrentAuthOperation(version, auth) {
  if (version === authOperationVersion) return;
  discardUnusedAuthSession(auth);
  throw new Error("This sign-in was cancelled because your account or sign-in attempt changed.");
}

function clearCloudContent() {
  for (const url of cloudStoryMedia.values()) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  cloudStoryMedia = new Map();
  cloudStoryMediaExpiries = new Map();
  cloudStoryComments = new Map();
  cloudStories = [];
  cloudStoriesLoading = false;
  cloudStoriesOwnerToken = null;
  cloudStoriesLoaded = false;
  cloudStoriesFetchedAt = 0;
  cloudStoriesAttemptedAt = 0;
  cloudStoryMigration = { accountId: null, loading: false, done: false, error: "", confirmed: 0, pending: 0, unsupported: 0 };
  cloudStoryMigrationPromise = null;
  cloudCloseFriendsOwnerToken = null;
  cloudCloseFriends = [];
  cloudRelationshipsOwnerToken = null;
  cloudRelationships = null;
  cloudRelationshipsLoading = false;
  cloudRelationshipsAttemptedAt = 0;
  cloudRelationshipImportOwnerToken = null;
  cloudBlocksOwnerToken = null;
  cloudBlocks = [];
  cloudPrivacyOwnerToken = null;
  cloudFeed = [];
  cloudFeedSurface = "main";
  cloudCommunityFeed = [];
  cloudCommunityFeedLoaded = false;
  cloudCommunityFeedLoading = false;
  cloudCommunityFeedOwnerToken = null;
  cloudCommunityFeedError = "";
  cloudCommunityFeedSurface = "community";
  cloudCommunityFeedNextOffset = 0;
  cloudCommunityFeedHasMore = false;
  deletedCloudPostIds = new Set();
  cloudProfiles = new Map();
  cloudProfileRepostLists = new Map();
  cloudFeedLoaded = false;
  cloudFeedLoading = false;
  cloudFeedOwnerToken = null;
  cloudFeedError = "";
  cloudFeedNextOffset = 0;
  cloudFeedHasMore = false;
  cloudChatsOwnerToken = null;
  cloudChatsFetchedAt = 0;
  legacyChatMigration = { accountId: null, loading: false, pending: 0, confirmed: 0, error: "", lastAttemptAt: 0 };
  legacyChatMigrationPromise = null;
  cloudChatMessagesFetchedAt.clear();
  cloudChatCreatePromises.clear();
  cloudPostMigration = {
    accountId: null,
    loading: false,
    done: false,
    error: "",
    confirmed: 0,
    pending: 0,
    unsupported: 0,
    conflicts: 0,
    lastAttemptAt: 0
  };
  cloudPostMigrationPromise = null;
}

function forEachCloudPostCopy(postId, update) {
  for (const post of [...cloudFeed, ...cloudCommunityFeed]) {
    if (post.id === postId) update(post);
  }
}

function getCloudSession() {
  try {
    const value = JSON.parse(globalThis.sessionStorage?.getItem(CLOUD_SESSION_KEY) || "null");
    if (!value?.accessToken || !value?.account?.id || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function ensureCurrentCloudSession(session) {
  if (!session?.accessToken || getCloudSession()?.accessToken !== session.accessToken) {
    throw new Error("Your signed-in account changed before the online request finished.");
  }
}

function saveCloudSession(response) {
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) throw new Error("Session storage is unavailable.");
    storage.setItem(CLOUD_SESSION_KEY, JSON.stringify({
      accessToken: response.accessToken,
      expiresAt: response.expiresAt,
      account: response.account,
      authProvider: response.authProvider === "cognito" ? "cognito" : "password"
    }));
  } catch {
    throw new Error("Secure sign-in could not be saved in this browser. Check your storage settings and try again.");
  }
}

function clearCloudSession() {
  authOperationVersion++;
  const session = getCloudSession();
  clearCloudContent();
  try { globalThis.sessionStorage?.removeItem(CLOUD_SESSION_KEY); } catch { /* sign-out still clears local state */ }
  if (session?.accessToken && typeof fetch === "function") {
    void fetch(cloudApiUrl("/api/auth/logout"), {
      method: "POST",
      keepalive: true,
      headers: { Authorization: `Bearer ${session.accessToken}` }
    }).catch(() => {});
  }
}

async function authRequest(endpoint, body, accessToken = null) {
  let response;
  try {
    const headers = { "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    response = await fetch(cloudApiUrl(`/api/auth/${endpoint}`), {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error("The secure account service could not be reached.");
  }
  let result = {};
  try { result = await response.json(); } catch { /* handled by the status below */ }
  if (!response.ok) {
    const error = new Error(result.error || "Secure sign-in failed. Try again.");
    error.status = response.status;
    throw error;
  }
  return result;
}

async function cloudRequest(path, { method = "GET", body, rawBody, contentType, responseType, session = getCloudSession(), timeoutMs = 0 } = {}) {
  if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
  ensureCurrentCloudSession(session);

  const controller = timeoutMs > 0 && typeof AbortController === "function" ? new AbortController() : null;
  let timeoutId;
  const request = async () => {
    let response;
    try {
      const headers = { Authorization: `Bearer ${session.accessToken}` };
      if (rawBody !== undefined) headers["Content-Type"] = contentType || "image/png";
      else if (body !== undefined) headers["Content-Type"] = "application/json";
      response = await fetch(cloudApiUrl(path), {
        method,
        headers,
        ...(rawBody !== undefined ? { body: rawBody } : body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch {
      ensureCurrentCloudSession(session);
      if (controller?.signal.aborted) throw new Error("The online request took too long. Check your connection and try again.");
      throw new Error("The online service could not be reached. Check your connection and try again.");
    }

    ensureCurrentCloudSession(session);
    if (response.status === 401) {
      clearCloudSession();
      mutate(state => { state.session = null; });
      throw Object.assign(new Error("Your online session has expired. Sign in again."), { status: 401 });
    }
    if (response.status === 204) return null;
    if (response.ok && responseType === "blob") {
      const blob = await response.blob();
      ensureCurrentCloudSession(session);
      return blob;
    }
    let result = {};
    try { result = await response.json(); } catch { /* handled by the status below */ }
    ensureCurrentCloudSession(session);
    if (!response.ok) {
      const error = new Error(result.error || "The online request failed. Try again.");
      error.status = response.status;
      throw error;
    }
    return result;
  };

  if (!(timeoutMs > 0)) return request();
  const timedOut = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller?.abort();
      reject(new Error("The online request took too long. Check your connection and try again."));
    }, timeoutMs);
  });
  try {
    return await Promise.race([request(), timedOut]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function requestCloudApi(path, options = {}) {
  return cloudRequest(path, options);
}

function cloudAuthorId(author) {
  const session = getCloudSession();
  const me = api.me();
  if (session?.account?.id === author.id) return me?.id || author.id;

  const profile = {
    id: author.id,
    cloudAccountId: author.id,
    username: author.username,
    name: author.displayName || author.username,
    bio: "",
    avatar: automaticAvatar(author.id),
    city: "",
    verified: false,
    private: false,
    followers: [],
    following: [],
    friends: [],
    closeFriends: [],
    interests: [],
    profileVisibility: { city: false, interests: false }
  };
  Object.assign(profile, cloudProfiles.get(author.id) || {}, {
    username: author.username,
    name: author.displayName || author.username,
  });
  for (const key of ["avatar", "cover", "bio", "city", "interests"]) {
    if (author[key] !== undefined) profile[key] = structuredClone(author[key]);
  }
  if (["avatar", "cover", "bio"].some(key => Object.hasOwn(author, key))) {
    profile.city = typeof author.city === "string" ? author.city : "";
    profile.interests = Array.isArray(author.interests) ? [...author.interests] : [];
    profile.profileVisibility = {
      city: typeof author.city === "string",
      interests: Array.isArray(author.interests),
    };
  }
  cloudProfiles.set(author.id, profile);
  return author.id;
}

function normalizeCloudPost(post) {
  if (!post?.id || !post.author?.id || typeof post.text !== "string") {
    throw new Error("The online feed returned an invalid post.");
  }
  const me = api.me();
  const created = Number(post.createdAt);
  const repostedByMe = post.repostedByMe === true;
  const repostNote = typeof post.repostNote === "string" ? post.repostNote.slice(0, 140) : "";
  const mediaAssets = Array.isArray(post.media) ? post.media : [];
  const media = mediaAssets.map(item => item?.reference).filter(value => typeof value === "string" && value);
  if (!media.length && typeof post.sportsCard?.imageUrl === "string") media.push(post.sportsCard.imageUrl);
  const kind = post.sportsCard?.imageUrl
    ? (post.sportsCard.mediaType === "video" ? "video" : "photo")
    : mediaAssets.length > 1
      ? "carousel"
      : mediaAssets.some(item => String(item?.contentType || "").startsWith("video/"))
        ? "video"
        : media.length ? "photo" : "text";
  return {
    id: post.id,
    sourceId: post.sourceId || null,
    remixSourcePostId: post.remixSourcePostId || null,
    remixCount: Number.isSafeInteger(post.remixCount) && post.remixCount >= 0 ? post.remixCount : 0,
    author: cloudAuthorId(post.author),
    kind,
    destination: ["main", "community", "both"].includes(post.destination) ? post.destination : "both",
    caption: post.text,
    tags: [...post.text.matchAll(/#([a-z0-9_]+)/gi)].map(match => match[1].toLowerCase()),
    media,
    sportsCard: post.sportsCard || null,
    sound: "Original audio",
    location: post.place?.label || "",
    place: post.place || null,
    visibility: post.visibility || "public",
    cloud: true,
    likes: post.likedByMe && me ? [me.id] : [],
    likedBy: (Array.isArray(post.likedBy)?post.likedBy:[]).map(person=>{
      const id=cloudAuthorId(person), user=api.user(id);
      return {id,displayName:user?.name||person.displayName,avatarUrl:user?.avatar||""};
    }),
    likeCount: Number.isFinite(post.likeCount) && post.likeCount >= 0 ? post.likeCount : 0,
    commentCount: Number.isFinite(post.commentCount) && post.commentCount >= 0 ? post.commentCount : 0,
    saveCount: Number.isFinite(post.saveCount) && post.saveCount >= 0 ? post.saveCount : 0,
    repostCount: Number.isFinite(post.repostCount) && post.repostCount >= 0 ? post.repostCount : 0,
    friendRepostCount: Number.isSafeInteger(post.friendRepostCount) && post.friendRepostCount >= 0 ? post.friendRepostCount : 0,
    repostedByFriends: (Array.isArray(post.repostedByFriends) ? post.repostedByFriends : []).slice(0, 3).map(person => {
      const id = cloudAuthorId(person);
      const user = api.user(id);
      return {
        ...person,
        id,
        username: user?.username || person.username,
        displayName: user?.name || person.displayName,
        avatar: user?.avatar || person.avatar || "",
      };
    }),
    repostedByMe,
    repostNote,
    comments: [],
    saves: me?.savedPostIds?.includes(post.id) ? [me.id] : [],
    reposts: repostedByMe && me ? [me.id] : [],
    repostNotes: repostedByMe && me && repostNote ? { [me.id]: repostNote } : {},
    created: Number.isFinite(created) ? created : Date.now(),
    views: 0,
    shares: 0,
    cloud: true
  };
}

async function migrateLegacyCloudReposts(session) {
  const owner = api.me()?.id;
  if (!owner || session?.account?.id !== owner || migratingLegacyRepostOwners.has(owner)) return;
  const loadedPostIds = new Set(cloudFeed.map(post => post.id));
  const pending = Object.entries(db.localRepostsByPost || {})
    .filter(([postId, byUser]) => loadedPostIds.has(postId) && byUser && typeof byUser === "object" && byUser[owner])
    .map(([postId, byUser]) => ({ postId, entry: byUser[owner] }));
  if (!pending.length) return;

  migratingLegacyRepostOwners.add(owner);
  try {
    await Promise.allSettled(pending.map(async ({ postId, entry }) => {
      const note = String(entry?.note || "").trim().slice(0, 140);
      const result = await cloudRequest(`/api/posts/${encodeURIComponent(postId)}/repost`, {
        session,
        method: "PUT",
        body: { note },
      });
      ensureCurrentCloudSession(session);
      if (result.reposted !== true || !Number.isSafeInteger(result.repostCount) || result.repostCount < 1) {
        throw new Error("The server did not confirm this repost.");
      }
      const post = cloudFeed.find(item => item.id === postId);
      if (post) {
        post.repostedByMe = true;
        post.repostCount = result.repostCount;
        post.repostNote = typeof result.note === "string" ? result.note : "";
        post.reposts = [owner];
        post.repostNotes = post.repostNote ? { [owner]: post.repostNote } : {};
      }
      mutate(state => {
        const byUser = state.localRepostsByPost?.[postId];
        if (!byUser || byUser[owner]?.at !== entry?.at || byUser[owner]?.note !== entry?.note) return;
        delete byUser[owner];
        if (!Object.keys(byUser).length) delete state.localRepostsByPost[postId];
      });
    }));
  } finally {
    migratingLegacyRepostOwners.delete(owner);
  }
}

function saveCloudAccount(auth) {
  clearCloudContent();
  const account = auth.account;
  const email = String(account.email || "").trim().toLowerCase();
  const username = String(account.username || "").trim().toLowerCase();
  const existing = db.users.find(user => user.cloudAccountId === account.id || user.id === account.id) ||
    db.users.find(user => !user.cloudAccountId && email && user.email === email && user.username === username);
  const localId = existing?.id || account.id;
  saveCloudSession(auth);
  try {
    mutate(state => {
      let user = state.users.find(item => item.id === localId);
      if (!user) {
        user = {
          id: localId,
          username,
          name: account.displayName || username,
          bio: "",
          avatar: automaticAvatar(account.id),
          city: "",
          verified: false,
          private: false,
          followers: [],
          following: [],
          friends: [],
          closeFriends: [],
          interests: [],
          profileVisibility: { city: true, interests: true },
          email
        };
        state.users.push(user);
      }
      user.friends = Array.isArray(user.friends) ? user.friends : [];
      user.closeFriends = Array.isArray(user.closeFriends) ? user.closeFriends : [];
      user.cloudAccountId = account.id;
      user.username = username;
      user.name = account.displayName || username;
      user.email = email;
      delete user.password;
      state.session = localId;
    });
  } catch (error) {
    clearCloudSession();
    throw error;
  }
  return localId;
}

async function loginAccount(identifier, password) {
  const version = ++authOperationVersion;
  const normalized = String(identifier || "").trim().toLowerCase();
  const auth = await authRequest("login", { identifier: normalized, password });
  ensureCurrentAuthOperation(version, auth);
  saveCloudAccount(auth);
  return "cloud";
}

export function seed() {
  return {
    session: null,
    settings: { readReceipts: true, lastSeen: "everyone" },
    users: [],
    requests: [],
    friendRequests: [],
    posts: [],
    stories: [],
    convos: [],
    notes: [],
    blocks: [],
    reports: [],
    campaigns: [],
    interests: {},
    resets: []
  };
}

let db = load();
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (!raw || !raw.users) return seed();
    raw.requests = Array.isArray(raw.requests) ? raw.requests : [];
    raw.friendRequests = Array.isArray(raw.friendRequests) ? raw.friendRequests : [];
    raw.resets = Array.isArray(raw.resets) ? raw.resets : [];
    raw.posts = Array.isArray(raw.posts) ? raw.posts : [];
    raw.stories = Array.isArray(raw.stories) ? raw.stories : [];
    raw.convos = Array.isArray(raw.convos) ? raw.convos : [];
    raw.notes = Array.isArray(raw.notes) ? raw.notes : [];
    raw.blocks = Array.isArray(raw.blocks) ? raw.blocks : [];
    raw.reports = Array.isArray(raw.reports) ? raw.reports : [];
    raw.campaigns = Array.isArray(raw.campaigns) ? raw.campaigns : [];
    const userIds = new Set(raw.users.map(user => user.id));
    // Retire only studio-generated identities; preserve profile photos and classic icons.
    for (const user of raw.users) {
      if (user.avatarPreset === "alter-ego" || /^\/api\/alter-ego\/users\//.test(user.avatar || "")) {
        user.avatar = automaticAvatar(user.cloudAccountId || user.id);
        user.avatarPreset = "automatic";
      }
    }
    raw.users = raw.users.map(user => ({
      ...user,
      avatar: resolveProfileAvatar(user, DEFAULT_AVATAR),
      email: typeof user.email === "string" ? user.email.trim().toLowerCase() : "",
      followers: [...new Set((Array.isArray(user.followers) ? user.followers : [])
        .filter(id => typeof id === "string" && id !== user.id && userIds.has(id)))],
      following: [...new Set((Array.isArray(user.following) ? user.following : [])
        .filter(id => typeof id === "string" && id !== user.id && userIds.has(id)))],
      friends: [...new Set((Array.isArray(user.friends) ? user.friends : [])
        .filter(id => typeof id === "string" && id !== user.id && userIds.has(id)))],
      closeFriends: [...new Set((Array.isArray(user.closeFriends) ? user.closeFriends : [])
        .filter(id => typeof id === "string" && id !== user.id && userIds.has(id)))],
      interests: [...new Set((Array.isArray(user.interests) ? user.interests : [])
        .filter(value => typeof value === "string")
        .map(value => value.trim().toLowerCase())
        .filter(Boolean))],
      profileVisibility: {
        city: user.profileVisibility?.city !== false,
        interests: user.profileVisibility?.interests !== false
      }
    }));
    enforceCloseFriends(raw);
    raw.settings = { readReceipts: true, lastSeen: "everyone", ...raw.settings };
    if (raw.settings.readReceipts === undefined) raw.settings.readReceipts = true;
    if (!raw.settings.lastSeen) raw.settings.lastSeen = "everyone";
    return raw;
  } catch { return seed(); }
}
function persist() {
  // `oldtime-v1` is only a migration source. Current signed-in account data
  // must be confirmed by the online API, never mirrored as a second durable copy.
  if (!allowsTestOnlyLocalAccount() || getCloudSession()) return;
  try {
    const durable = {
      ...db,
      convos: db.convos.map(conversation => ({
        ...conversation,
        messages: (conversation.messages || []).filter(message => !message.cloudSynced),
      })),
    };
    const value = JSON.stringify(durable);
    if (localStorage.getItem(KEY) !== value) localStorage.setItem(KEY, value);
  } catch {
    throw new Error("Test-only legacy storage is unavailable.");
  }
}

function pruneVerifiedLegacyPosts(ownerId, postIds, savedMappings = []) {
  const session = getCloudSession();
  const confirmed = new Set(postIds);
  if (!confirmed.size) return;
  if (!session?.accessToken || api.me()?.id !== ownerId) {
    throw new Error("The signed-in account changed before the verified legacy source could be removed.");
  }
  try {
    const rawText = localStorage.getItem(KEY);
    if (!rawText) return;
    const legacy = JSON.parse(rawText);
    if (!legacy || typeof legacy !== "object" || !Array.isArray(legacy.posts)) {
      throw new Error("The legacy post source could not be safely checked.");
    }
    const nextPosts = legacy.posts.filter(post =>
      !(post?.author === ownerId && confirmed.has(post?.id)));
    const savedSourceIds = new Set(savedMappings.map(item => item.sourceId));
    const nextUsers = Array.isArray(legacy.users) ? legacy.users.map(user => {
      if (user?.id !== ownerId || !savedSourceIds.size) return user;
      return {
        ...user,
        savedPostIds: [...new Set([
          ...(Array.isArray(user.savedPostIds) ? user.savedPostIds : [])
            .filter(id => !savedSourceIds.has(id)),
          ...savedMappings.map(item => item.postId),
        ])].slice(0, 5000),
      };
    }) : legacy.users;
    if (nextPosts.length !== legacy.posts.length || savedSourceIds.size) {
      localStorage.setItem(KEY, JSON.stringify({ ...legacy, posts: nextPosts, users: nextUsers }));
    }
  } catch (error) {
    throw new Error(error?.message || "The verified legacy post source could not be removed.");
  }
}

function allowsTestOnlyLocalAccount() {
  return typeof process !== "undefined" && process.env?.NODE_ENV === "test";
}
function enforceCloseFriends(state) {
  const users = new Map(state.users.map(user => [user.id, user]));
  for (const user of state.users) {
    user.closeFriends = [...new Set(user.closeFriends || [])].filter(id => {
      const other = users.get(id);
      return other && id !== user.id && user.friends?.includes(id) && other.friends?.includes(user.id) &&
        !state.blocks?.some(block => (block.by === user.id && block.who === id) || (block.by === id && block.who === user.id));
    });
  }
}

let cloudAccountStateValue = null;
let cloudAccountStateOwnerToken = "";
let cloudAccountStateLoadPromise = null;
let cloudAccountStateWriteQueue = Promise.resolve();
const accountStateUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const accountStateInterests = ["Sports", "Photography", "Music", "Comedy", "Food", "Travel", "Fitness", "News", "Art", "Gaming", "Fashion", "Technology"];

function cloudOwnedContentState(user, session = getCloudSession()) {
  const savedPostIds = [...new Set([
    ...(Array.isArray(user?.savedPostIds) ? user.savedPostIds : []),
    ...db.posts.filter(post => post.saves?.includes(user?.id)).map(post => post.id),
  ].filter(value => typeof value === "string" && value.length > 0))].slice(0, 5000);
  const savedAudioIds = [...new Set((Array.isArray(user?.savedAudioIds) ? user.savedAudioIds : [])
    .filter(value => typeof value === "string" && value.length > 0))].slice(0, 2000);
  const commentFavorites = [...new Set((Array.isArray(user?.commentFavorites) ? user.commentFavorites : [])
    .filter(value => typeof value === "string" && value.length > 0))].slice(0, 5000);
  const savedCollections = (Array.isArray(user?.savedCollections) ? user.savedCollections : []).slice(0, 200)
    .filter(item => item && typeof item.id === "string" && typeof item.name === "string")
    .map(item => ({
      id: item.id.slice(0, 128),
      name: item.name.trim().slice(0, 60) || "Saved",
      postIds: [...new Set((Array.isArray(item.postIds) ? item.postIds : [])
        .filter(value => typeof value === "string" && value.length > 0))].slice(0, 5000),
      createdAt: Number.isSafeInteger(item.createdAt) && item.createdAt >= 0 ? item.createdAt : Date.now(),
    }));
  const profileCollections = (Array.isArray(user?.profileCollections) ? user.profileCollections : [])
    .slice(0, 100)
    .filter(item => item && typeof item.id === "string" && typeof item.title === "string" &&
      ["album", "memory"].includes(item.type))
    .map(item => {
      const position = item.coverPosition && typeof item.coverPosition === "object" ? item.coverPosition : {};
      const safePosition = {
        x: Math.max(0, Math.min(100, Number(position.x) || 50)),
        y: Math.max(0, Math.min(100, Number(position.y) || 50)),
        zoom: Math.max(1, Math.min(2, Number(position.zoom) || 1)),
      };
      return {
        id: item.id.slice(0, 128),
        type: item.type,
        title: item.title.trim().slice(0, 60) || "Collection",
        ...(typeof item.description === "string" ? { description: item.description.slice(0, 220) } : {}),
        ...(typeof item.coverUri === "string" ? { coverUri: item.coverUri.slice(0, 2048) } : {}),
        ...(typeof item.coverTemplate === "string" && ["mono", "red", "night"].includes(item.coverTemplate)
          ? { coverTemplate: item.coverTemplate } : {}),
        ...(item.coverPosition ? { coverPosition: safePosition } : {}),
        createdAt: Number.isSafeInteger(item.createdAt) && item.createdAt >= 0 ? item.createdAt : Date.now(),
        items: (Array.isArray(item.items) ? item.items : []).slice(0, 300)
          .filter(child => child && typeof child.id === "string" && typeof child.postId === "string" &&
            Number.isInteger(Number(child.mediaIndex)) && Number(child.mediaIndex) >= 0)
          .map(child => ({
            id: child.id.slice(0, 128),
            postId: child.postId.slice(0, 128),
            mediaIndex: Math.min(100, Number(child.mediaIndex)),
            ...(typeof child.caption === "string" ? { caption: child.caption.slice(0, 500) } : {}),
            createdAt: Number.isSafeInteger(child.createdAt) && child.createdAt >= 0 ? child.createdAt : Date.now(),
          })),
      };
    });
  const feedback = (Array.isArray(db.callFeedback) ? db.callFeedback : [])
    .filter(item => item?.user === user?.id || item?.user === session?.account?.id)
    .map(item => ({
      ...item,
      user: session?.account?.id || item.user,
      peer: db.users.find(candidate => candidate.id === item.peer)?.cloudAccountId || item.peer,
    }))
    .filter(item => accountStateUuid.test(item.user) && accountStateUuid.test(item.peer))
    .slice(-1000);
  const profile = {
    displayName: String(user?.name || user?.displayName || user?.username || "").trim().slice(0, 64),
    username: String(user?.username || "").trim().toLowerCase().slice(0, 24),
    bio: typeof user?.bio === "string" ? user.bio.slice(0, 280) : "",
    city: typeof user?.city === "string" ? user.city.slice(0, 80) : "",
    birthday: typeof user?.birthday === "string" ? user.birthday.slice(0, 10) : "",
    interests: [...new Set((Array.isArray(user?.interests) ? user.interests : [])
      .filter(value => accountStateInterests.includes(value)))].slice(0, 12),
    ...(typeof user?.avatar === "string" ? { avatar: resolveProfileAvatar(user, DEFAULT_AVATAR) } : {}),
    cover: typeof user?.cover === "string" ? user.cover : null,
    avatarPreset: typeof user?.avatarPreset === "string" ? user.avatarPreset : null,
    profileVisibility: {
      city: user?.profileVisibility?.city !== false,
      interests: user?.profileVisibility?.interests !== false,
    },
  };
  return {
    savedPostIds, savedAudioIds, savedCollections, profileCollections, commentFavorites, callFeedback: feedback,
    profile,
    notificationEnabled: user?.notifs !== false,
    chatPreferences: {
      readReceipts: db.settings?.readReceipts !== false,
      lastSeen: ["everyone", "contacts", "nobody"].includes(db.settings?.lastSeen) ? db.settings.lastSeen : "everyone",
    },
  };
}

function accountStateProjection(user, session = getCloudSession()) {
  const state = cloudOwnedContentState(user, session);
  const localIds = [user?.id, session?.account?.id].filter(value => typeof value === "string");
  const readScoped = key => {
    for (const id of localIds) {
      try {
        const value = JSON.parse(localStorage.getItem(`${key}${id}`) || "null");
        if (value && typeof value === "object" && !Array.isArray(value)) return value;
      } catch { /* Ignore malformed legacy preferences and keep the source intact. */ }
    }
    return null;
  };
  const legacyInterests = readScoped("oldtime-interests-v1:");
  if (legacyInterests) {
    state.interestPreferences = {
      enabled: legacyInterests.enabled !== false,
      selected: [...new Set((Array.isArray(legacyInterests.selected) ? legacyInterests.selected : [])
        .filter(value => accountStateInterests.includes(value)))],
    };
  }
  const legacyHelp = readScoped("oldtime-help-prompts-v1:");
  if (legacyHelp && typeof legacyHelp.lastShownAt === "number" &&
    Number.isFinite(legacyHelp.lastShownAt) && legacyHelp.lastShownAt >= 0 &&
    legacyHelp.items && typeof legacyHelp.items === "object" && !Array.isArray(legacyHelp.items)) {
    const items = Object.fromEntries(Object.entries(legacyHelp.items).slice(0, 50).map(([id, value]) => {
      const item = value && typeof value === "object" ? value : {};
      return [id.slice(0, 80), {
        ...(Number.isFinite(item.lastShownAt) && item.lastShownAt >= 0 ? { lastShownAt: item.lastShownAt } : {}),
        ...(Number.isFinite(item.viewedAt) && item.viewedAt >= 0 ? { viewedAt: item.viewedAt } : {}),
        ...(typeof item.never === "boolean" ? { never: item.never } : {}),
        ...(Number.isInteger(item.dismissed) && item.dismissed >= 0 ? { dismissed: item.dismissed } : {}),
        ...(Number.isInteger(item.actions) && item.actions >= 0 ? { actions: item.actions } : {}),
      }];
    }));
    state.helpPreferences = { lastShownAt: legacyHelp.lastShownAt, paused: legacyHelp.paused === true, items };
  }
  try {
    const recent = JSON.parse(localStorage.getItem("oldtime-emojis") || "[]");
    const favorites = JSON.parse(localStorage.getItem("oldtime-favorite-emojis") || "[]");
    state.emojiPreferences = {
      recent: [...new Set((Array.isArray(recent) ? recent : []).filter(value => typeof value === "string" && value.length <= 16))].slice(0, 32),
      favorites: [...new Set((Array.isArray(favorites) ? favorites : []).filter(value => typeof value === "string" && value.length <= 16))].slice(0, 128),
    };
  } catch { /* Ignore malformed global picker preferences and keep their source intact. */ }
  try {
    const theme = localStorage.getItem("oldtime.creative.toolsTheme");
    if (theme === "dark" || theme === "light") state.creativeToolsTheme = theme;
  } catch { /* Ignore malformed legacy editor preferences. */ }
  return state;
}

async function migrateInlineProfileMedia(profile, remoteProfile = {}) {
  const next = { ...profile };
  let upload;
  for (const key of ["avatar", "cover"]) {
    const value = next[key];
    if (remoteProfile[key] !== undefined || typeof value !== "string" || !/^data:image\//i.test(value)) continue;
    const response = await fetch(value);
    if (!response.ok) throw new Error("A legacy profile photo could not be read for cloud transfer.");
    const blob = await response.blob();
    if (!blob.size) throw new Error("A legacy profile photo is empty; the original copy was kept.");
    if (!upload) upload = (await import("./local-media.js")).putLocalMedia;
    next[key] = await upload(blob);
  }
  return next;
}

async function migrateInlineProfileCollections(collections, remoteCollections = []) {
  const remoteIds = new Set((Array.isArray(remoteCollections) ? remoteCollections : [])
    .map(item => item?.id).filter(id => typeof id === "string"));
  let upload;
  const result = [];
  for (const collection of Array.isArray(collections) ? collections : []) {
    if (!collection || typeof collection !== "object") continue;
    const next = { ...collection };
    if (!remoteIds.has(next.id) && typeof next.coverUri === "string" && /^(data:image\/|blob:)/i.test(next.coverUri)) {
      const response = await fetch(next.coverUri);
      if (!response.ok) throw new Error("A collection cover could not be read for cloud transfer.");
      const blob = await response.blob();
      if (!blob.size) throw new Error("A collection cover is empty; its original copy was kept.");
      if (!upload) upload = (await import("./local-media.js")).putLocalMedia;
      next.coverUri = await upload(blob);
    }
    result.push(next);
  }
  return result;
}

function stableAccountState(value) {
  if (Array.isArray(value)) return `[${value.map(stableAccountState).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableAccountState(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function applyAccountStateToUser(state, user, session) {
  if (!state || !user) return;
  if (state.profile && typeof state.profile === "object") {
    const profile = state.profile;
    if (typeof profile.username === "string") user.username = profile.username;
    if (typeof profile.displayName === "string") {
      user.name = profile.displayName;
      user.displayName = profile.displayName;
    }
    for (const key of ["bio", "city", "birthday", "interests", "avatar", "cover", "avatarPreset", "profileVisibility"]) {
      if (profile[key] !== undefined) user[key] = structuredClone(profile[key]);
    }
  }
  for (const key of ["savedPostIds", "savedAudioIds", "savedCollections", "commentFavorites"]) {
    if (Array.isArray(state[key])) user[key] = structuredClone(state[key]);
  }
  if (Array.isArray(state.profileCollections)) user.profileCollections = structuredClone(state.profileCollections);
  if (Array.isArray(state.callFeedback)) {
    const ownerId = session?.account?.id || user.id;
    const otherFeedback = (Array.isArray(db.callFeedback) ? db.callFeedback : [])
      .filter(item => item?.user !== user.id && item?.user !== ownerId);
    db.callFeedback = [...otherFeedback, ...structuredClone(state.callFeedback)];
  }
  if (typeof state.notificationEnabled === "boolean") user.notifs = state.notificationEnabled;
  if (state.chatPreferences) {
    db.settings = {
      readReceipts: state.chatPreferences.readReceipts !== false,
      lastSeen: ["everyone", "contacts", "nobody"].includes(state.chatPreferences.lastSeen)
        ? state.chatPreferences.lastSeen : "everyone",
    };
  }
}

function prepareLegacyPostInteractions(post, user) {
  const flattened = [];
  const usedSourceIds = new Set();
  const ownIds = new Set([user.id, user.cloudAccountId].filter(Boolean));
  let generated = 0;
  const visit = (comments, parentSourceId = null) => {
    if (!Array.isArray(comments)) return;
    for (const comment of comments) {
      if (!comment || typeof comment !== "object") {
        flattened.push({ invalid: true });
        continue;
      }
      generated++;
      const rawAuthor = comment.author ?? comment.authorId ?? comment.userId;
      const authorId = typeof rawAuthor === "string"
        ? rawAuthor
        : typeof rawAuthor?.id === "string" ? rawAuthor.id : "";
      let sourceId = String(comment.id || comment.sourceId || `legacy-comment-${generated}`);
      if (usedSourceIds.has(sourceId)) sourceId = `${sourceId.slice(0, 110)}-${generated}`;
      usedSourceIds.add(sourceId);
      const rawBody = comment.body ?? comment.text ?? "";
      const body = typeof rawBody === "string" ? rawBody.trim() : "";
      const createdAt = Number(comment.createdAt ?? comment.created);
      const safeCreatedAt = Number.isSafeInteger(createdAt) && createdAt >= 0
        ? createdAt
        : Number(post.created);
      flattened.push({
        sourceId,
        parentSourceId,
        authorId,
        username: String(comment.username || "").trim(),
        displayName: String(comment.displayName || comment.name || "").trim(),
        body,
        createdAt: safeCreatedAt,
        own: Boolean(authorId && ownIds.has(authorId)),
        invalid: sourceId.length > 128 || authorId.length > 128 ||
          String(comment.username || "").length > 24 ||
          String(comment.displayName || comment.name || "").length > 64 ||
          body.length > 1000 || !Number.isSafeInteger(safeCreatedAt) ||
          safeCreatedAt < 0 || safeCreatedAt > 8640000000000000,
      });
      visit(comment.replies, sourceId);
    }
  };
  visit(post.comments);
  const comments = flattened.filter(comment => comment.own && !comment.invalid && comment.body)
    .map(comment => ({
      sourceId: comment.sourceId,
      parentSourceId: comment.parentSourceId,
      body: comment.body,
      createdAt: comment.createdAt,
    }));
  const ownCommentIds = new Set(comments.map(comment => comment.sourceId));
  for (const comment of comments) {
    if (!ownCommentIds.has(comment.parentSourceId)) comment.parentSourceId = null;
  }
  const archivedComments = flattened.filter(comment => !comment.own || comment.invalid || !comment.body)
    .map(comment => ({
      id: comment.sourceId || `legacy-comment-${generated++}`,
      authorId: comment.authorId || "unverified",
      username: comment.username || "",
      displayName: comment.displayName || "",
      body: comment.body || "",
      createdAt: Number.isSafeInteger(comment.createdAt) && comment.createdAt >= 0
        ? comment.createdAt
        : Number(post.created),
      ...(comment.parentSourceId ? { parentId: comment.parentSourceId } : {}),
    }));
  const legacyLikes = Array.isArray(post.likes) ? post.likes.filter(id => !ownIds.has(id)) : [];
  const legacySaves = Array.isArray(post.saves) ? post.saves.filter(id => !ownIds.has(id)) : [];
  const valid = flattened.every(comment => !comment.invalid) &&
    legacyLikes.length <= 500 && legacySaves.length <= 500 &&
    legacyLikes.every(id => typeof id === "string" && id.length <= 128) &&
    legacySaves.every(id => typeof id === "string" && id.length <= 128) &&
    archivedComments.length <= 200 && comments.length <= 200;
  return {
    valid,
    comments,
    legacyArchive: { legacyLikes, legacySaves, comments: archivedComments },
  };
}

export const api = {
  db: () => db,
  me: () => {
    const cloud = getCloudSession();
    if (cloud) return db.users.find(user =>
      user.cloudAccountId === cloud.account.id || user.id === cloud.account.id
    ) || null;
    if (!allowsTestOnlyLocalAccount()) return null;
    const local = db.users.find(user => user.id === db.session) || null;
    return local?.cloudAccountId ? null : local;
  },
  cloudAccountId: () => getCloudSession()?.account?.id || null,
  cloudAccessToken: () => getCloudSession()?.accessToken || null,
  cloudAccountState: () => cloudAccountStateOwnerToken === getCloudSession()?.accessToken && cloudAccountStateValue
    ? structuredClone(cloudAccountStateValue) : null,
  cloudAccountStateLoaded: () => !!getCloudSession()?.accessToken &&
    cloudAccountStateOwnerToken === getCloudSession()?.accessToken && cloudAccountStateValue !== null,
  cloudAccountStateLoading: () => !!cloudAccountStateLoadPromise,
  async restoreCloudAccount() {
    const session = getCloudSession();
    if (!session?.accessToken) return false;
    let response;
    try {
      response = await cloudRequest("/api/auth/me", { session });
    } catch (error) {
      const current = getCloudSession();
      if ((!current || current.accessToken === session.accessToken) &&
        (error.status === 401 || error.status === 404)) {
        if (current) clearCloudSession();
        db.session = null;
        return false;
      }
      throw error;
    }
    ensureCurrentCloudSession(session);
    if (response?.account?.id !== session.account.id) {
      throw new Error("The server did not confirm your signed-in account.");
    }
    saveCloudAccount({ ...session, account: response.account });
    await this.loadCloudAccountState();
    return true;
  },
  async loadCloudAccountState() {
    const session = getCloudSession();
    const user = this.me();
    if (!session?.accessToken || !user) throw new Error("Sign in to load your saved account data.");
    if (cloudAccountStateOwnerToken === session.accessToken && cloudAccountStateValue !== null) {
      return structuredClone(cloudAccountStateValue);
    }
    if (cloudAccountStateLoadPromise) return cloudAccountStateLoadPromise;
    cloudAccountStateLoadPromise = (async () => {
      const response = await cloudRequest("/api/account/state", { session });
      const legacyState = accountStateProjection(user, session);
      const remoteState = response?.state;
      if (legacyState.profile) {
        legacyState.profile = await migrateInlineProfileMedia(legacyState.profile, remoteState?.profile || {});
      }
      legacyState.profileCollections = await migrateInlineProfileCollections(
        legacyState.profileCollections, remoteState?.profileCollections || [],
      );
      let state;
      if (!remoteState) {
        state = legacyState;
      } else {
        state = { ...legacyState, ...remoteState };
        for (const key of ["savedPostIds", "savedAudioIds"]) {
          state[key] = [...new Set([...(legacyState[key] || []), ...(remoteState[key] || [])])];
        }
        const collections = new Map();
        for (const item of [...(legacyState.savedCollections || []), ...(remoteState.savedCollections || [])]) {
          const previous = collections.get(item.id);
          collections.set(item.id, previous ? {
            ...previous,
            ...item,
            postIds: [...new Set([...(previous.postIds || []), ...(item.postIds || [])])],
          } : structuredClone(item));
        }
        state.savedCollections = [...collections.values()];
        const profileCollections = new Map();
        for (const collection of [
          ...(legacyState.profileCollections || []),
          ...(remoteState.profileCollections || []),
        ]) {
          const previous = profileCollections.get(collection.id);
          profileCollections.set(collection.id, previous ? {
            ...previous,
            ...collection,
            items: [...new Map([...(previous.items || []), ...(collection.items || [])]
              .map(item => [item.id, item])).values()],
          } : structuredClone(collection));
        }
        state.profileCollections = [...profileCollections.values()].slice(0, 100);
        state.callFeedback = [...new Map([
          ...(legacyState.callFeedback || []),
          ...(remoteState.callFeedback || []),
        ].map(item => [item.id, item])).values()].slice(-1000);
        if (remoteState.interestPreferences) state.interestPreferences = remoteState.interestPreferences;
        if (remoteState.helpPreferences) state.helpPreferences = remoteState.helpPreferences;
        if (remoteState.profile) state.profile = { ...legacyState.profile, ...remoteState.profile };
      }
      if (stableAccountState(remoteState || {}) !== stableAccountState(state)) {
        await cloudRequest("/api/account/state", { method: "PUT", body: { state }, session });
      }
      const verified = await cloudRequest("/api/account/state", { session });
      if (!verified?.state || stableAccountState(verified.state) !== stableAccountState(state)) {
        throw new Error("The server did not confirm your saved account data. Your legacy copy was kept.");
      }
      if (getCloudSession()?.accessToken !== session.accessToken) {
        throw new Error("Your signed-in account changed while account data was loading.");
      }
      cloudAccountStateValue = verified.state;
      cloudAccountStateOwnerToken = session.accessToken;
      applyAccountStateToUser(verified.state, user, session);
      for (const prefix of ["oldtime-interests-v1:", "oldtime-help-prompts-v1:"]) {
        for (const id of [user.id, session.account.id]) {
          try { localStorage.removeItem(`${prefix}${id}`); } catch { /* The verified cloud copy remains authoritative. */ }
        }
      }
      for (const key of ["oldtime-emojis", "oldtime-favorite-emojis", "oldtime.creative.toolsTheme"]) {
        try { localStorage.removeItem(key); } catch { /* The verified cloud copy remains authoritative. */ }
      }
      return structuredClone(verified.state);
    })().finally(() => { cloudAccountStateLoadPromise = null; });
    return cloudAccountStateLoadPromise;
  },
  async updateCloudAccountState(patch) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to save account settings.");
    if (cloudAccountStateOwnerToken !== session.accessToken || cloudAccountStateValue === null) {
      await this.loadCloudAccountState();
    }
    if (getCloudSession()?.accessToken !== session.accessToken || cloudAccountStateValue === null) {
      throw new Error("Your signed-in account changed. Try saving again.");
    }
    const user = this.me();
    const previous = structuredClone(cloudAccountStateValue);
    const next = { ...previous, ...structuredClone(patch) };
    cloudAccountStateValue = next;
    applyAccountStateToUser(next, user, session);
    const task = cloudAccountStateWriteQueue.catch(() => {}).then(async () => {
      if (getCloudSession()?.accessToken !== session.accessToken) {
        throw new Error("Your signed-in account changed. Try saving again.");
      }
      await cloudRequest("/api/account/state", { method: "PUT", body: { state: next }, session });
      const confirmed = await cloudRequest("/api/account/state", { session });
      if (!confirmed?.state || stableAccountState(confirmed.state) !== stableAccountState(next)) {
        throw new Error("The server did not confirm your account settings.");
      }
      if (getCloudSession()?.accessToken === session.accessToken) {
        cloudAccountStateValue = confirmed.state;
        applyAccountStateToUser(confirmed.state, this.me(), session);
      }
      return structuredClone(confirmed.state);
    });
    cloudAccountStateWriteQueue = task;
    try {
      return await task;
    } catch (error) {
      if (getCloudSession()?.accessToken === session.accessToken &&
        stableAccountState(cloudAccountStateValue) === stableAccountState(next)) {
        cloudAccountStateValue = previous;
        applyAccountStateToUser(previous, this.me(), session);
      }
      throw error;
    }
  },
  async updateCloudAccountProfile({ username, displayName, email, profile }) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to save your profile online.");
    if (cloudAccountStateOwnerToken !== session.accessToken || cloudAccountStateValue === null) {
      await this.loadCloudAccountState();
    }
    const result = await cloudRequest("/api/account/profile", {
      method: "PUT",
      body: { username, displayName, email, profile },
      session,
    });
    ensureCurrentCloudSession(session);
    const user = this.me();
    if (!user || result?.account?.id !== session.account.id || !result.profile) {
      throw new Error("The server did not confirm your profile update.");
    }
    Object.assign(user, {
      username: result.account.username,
      name: result.account.displayName,
      displayName: result.account.displayName,
      email: result.account.email,
    }, structuredClone(result.profile));
    if (cloudAccountStateOwnerToken === session.accessToken && cloudAccountStateValue) {
      cloudAccountStateValue = { ...cloudAccountStateValue, profile: structuredClone(result.profile) };
    }
    return { ...result.account, ...result.profile };
  },
  async loadCloudPostComments(postId) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to load comments.");
    const result = await cloudRequest(`/api/posts/${encodeURIComponent(postId)}/comments`, { session });
    if (!Array.isArray(result?.comments)) throw new Error("Comments could not be loaded.");
    const comments = result.comments.map(item => ({
      id: String(item.id),
      parentId: item.parentId ? String(item.parentId) : null,
      author: item.author?.id ? cloudAuthorId(item.author) : "",
      body: String(item.body || ""),
      created: Number(item.createdAt) || 0,
      likes: (Array.isArray(item.likes) ? item.likes : []).map(id =>
        id === session.account.id ? this.me()?.id : String(id)),
      dislikes: (Array.isArray(item.dislikes) ? item.dislikes : []).map(id =>
        id === session.account.id ? this.me()?.id : String(id)),
      replies: [],
    }));
    const byId = new Map(comments.map(comment => [comment.id, comment]));
    const roots = [];
    for (const comment of comments) {
      const parent = comment.parentId && byId.get(comment.parentId);
      if (parent) parent.replies.push(comment);
      else roots.push(comment);
    }
    const post = this.post(postId);
    if (post) post.comments = roots;
    return roots;
  },
  async createCloudPostComment(postId, { body, parentId = null }) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to comment.");
    const result = await cloudRequest(`/api/posts/${encodeURIComponent(postId)}/comments`, {
      session,
      method: "POST",
      body: { body: String(body || ""), ...(parentId ? { parentId } : {}) },
    });
    if (!result?.id) throw new Error("The server did not confirm your comment.");
    await this.loadCloudPostComments(postId);
    return result;
  },
  async setCloudPostCommentReaction(postId, commentId, reaction) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to react to comments.");
    const result = await cloudRequest(`/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}/reaction`, {
      session,
      method: "PUT",
      body: { reaction },
    });
    await this.loadCloudPostComments(postId);
    return result.reaction;
  },
  async deleteCloudPostComment(postId, commentId) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to delete comments.");
    await cloudRequest(`/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`, {
      session,
      method: "DELETE",
    });
    await this.loadCloudPostComments(postId);
  },
  async submitCloudReport(input) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to submit a report.");
    return cloudRequest("/api/account/reports", { method: "POST", body: input, session });
  },
  async listCloudReports() {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to view your report history.");
    const result = await cloudRequest("/api/account/reports", { session });
    if (!Array.isArray(result?.reports)) throw new Error("Your online report history returned an invalid response.");
    return result.reports;
  },
  // Public lifecycle counter only; personalization must never inspect authentication tokens.
  authRevision: () => authOperationVersion,
  cloudAuthorId,
  authMode: () => getCloudSession() ? "cloud" : allowsTestOnlyLocalAccount() ? "local" : "signed-out",
  authProvider: () => getCloudSession()?.authProvider || "password",
  async finishCognitoSignIn(input, expectedAccountId = null) {
    const session = getCloudSession();
    if ((input.intent === "link" && !expectedAccountId) ||
      (expectedAccountId && session?.account.id !== expectedAccountId)) {
      throw new Error("Your signed-in account changed. Start secure sign-in again.");
    }
    const version = ++authOperationVersion;
    const auth = await authRequest("cognito/exchange", input,
      input.intent === "link" ? session.accessToken : null);
    ensureCurrentAuthOperation(version, auth);
    if ((getCloudSession()?.accessToken || null) !== (session?.accessToken || null)) {
      discardUnusedAuthSession(auth);
      throw new Error("Your signed-in account changed. Start secure sign-in again.");
    }
    if (expectedAccountId && auth.account?.id !== expectedAccountId) {
      discardUnusedAuthSession(auth);
      throw new Error("Secure sign-in returned a different account. Your current account has not been changed.");
    }
    saveCloudAccount(auth);
    return input.intent;
  },
  user: (id) => db.users.find(u => u.id === id) || db.users.find(u => u.username === id) || cloudProfiles.get(id),
  cloudPosts: () => [...cloudFeed],
  cloudStories: () => [...cloudStories],
  cloudStoriesLoaded: () => cloudStoriesLoaded,
  cloudStoriesLoading: () => cloudStoriesLoading,
  cloudStoriesNeedsRefresh: () => (!cloudStoriesLoaded || Date.now() - cloudStoriesFetchedAt > 60_000) &&
    Date.now() - cloudStoriesAttemptedAt > 10_000,
  stories: () => getCloudSession() ? [...cloudStories] : [...db.stories, ...cloudStories],
  cloudCloseFriends: () => [...cloudCloseFriends],
  cloudCloseFriendsLoaded: () => cloudCloseFriendsOwnerToken === getCloudSession()?.accessToken,
  cloudBlocks: () => [...cloudBlocks],
  cloudBlocksLoaded: () => cloudBlocksOwnerToken === getCloudSession()?.accessToken,
  cloudPrivacyLoaded: () => cloudPrivacyOwnerToken === getCloudSession()?.accessToken,
  cloudPost: (id) => cloudFeed.find(post => post.id === id) ||
    cloudCommunityFeed.find(post => post.id === id) ||
    [...cloudProfileRepostLists.values()].flatMap(state => state.posts || []).find(post => post.id === id) ||
    (cloudOpenedPost?.token === getCloudSession()?.accessToken && cloudOpenedPost?.post?.id === id ? cloudOpenedPost.post : null),
  async loadCloudPost(id) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to view this post.");
    const result = await cloudRequest(`/api/posts/${encodeURIComponent(id)}`, { session, timeoutMs: 15_000 });
    const post = normalizeCloudPost(result.post);
    cloudOpenedPost = { token: session.accessToken, post };
    return post;
  },
  post(id) {
    if (getCloudSession()) return this.cloudPost(id);
    return db.posts.find(post => post.id === id) || this.cloudPost(id);
  },
  async searchCloudUsers(query) {
    const session = getCloudSession();
    const normalized = String(query || "").trim();
    if (!session?.accessToken || normalized.length < 2) return [];
    const result = await cloudRequest(`/api/users/search?query=${encodeURIComponent(normalized)}`, { session });
    if (!Array.isArray(result.profiles)) throw new Error("Account search returned an invalid response.");
    return result.profiles.map(profile => ({ ...profile, localId: cloudAuthorId(profile) }))
      .filter(profile => profile.id !== session.account.id);
  },
  migrateLegacyChatArchives({ retry = false } = {}) {
    const session = getCloudSession();
    const me = this.me();
    if (!session?.accessToken || !me) return Promise.reject(new Error("Sign in to an online account to move old chat history."));
    const localRooms = this.db().convos.filter(room => room.members?.includes(me.id) &&
      !room.cloudBacked && !room.cloudPending && !room.legacyArchive &&
      (room.messages?.length || String(room.draft || "").trim()));
    if (!retry && legacyChatMigration.accountId === session.account.id &&
      ((legacyChatMigration.pending === 0 && localRooms.length === 0) ||
        (Date.now() - Number(legacyChatMigration.lastAttemptAt || 0) < 60_000 &&
          legacyChatMigration.pending === localRooms.length))) {
      return Promise.resolve({ ...legacyChatMigration });
    }
    if (legacyChatMigrationPromise) return legacyChatMigrationPromise;
    const migration = legacyChatMigration = {
      accountId: session.account.id,
      loading: true,
      pending: localRooms.length,
      confirmed: 0,
      error: "",
      lastAttemptAt: Date.now(),
    };
    const operation = Promise.resolve().then(async () => {
      const { migrateLocalMedia, putLocalMedia } = await import("./local-media.js");
      for (const room of localRooms) {
        if (room.cloudPending || room.cloudBacked) continue;
        try {
          const members = room.members.map(id => {
            const user = this.user(id);
            return {
              id,
              cloudAccountId: user?.cloudAccountId || null,
              username: String(user?.username || "oldtime-member").slice(0, 48),
              displayName: String(user?.name || user?.username || "Oldtime member").slice(0, 80),
              avatar: typeof user?.avatar === "string" && /^https?:\/\//i.test(user.avatar) ? user.avatar.slice(0, 2048) : "",
              verified: user?.verified === true,
            };
          });
          const messages = [];
          for (const original of room.messages || []) {
            const message = {
              id: String(original.id || ""),
              author: String(original.author || ""),
              kind: String(original.kind || "text"),
              body: String(original.body || ""),
              created: Number(original.created || 0),
              reactions: original.reactions || {},
              editHistory: original.editHistory || [],
              edited: !!original.edited,
              editedAt: Number(original.editedAt || 0),
              replyTo: original.replyTo || "",
              caption: original.caption || "",
              fileName: original.fileName || "",
              fileSize: original.fileSize || "",
              viewOnce: !!original.viewOnce,
              forwarded: !!original.forwarded,
              duration: original.duration || "",
              peaks: original.peaks || [],
              poll: original.poll || null,
              postId: original.postId || "",
              sharedPostId: original.sharedPostId || "",
              sharedCommentId: original.sharedCommentId || "",
              commentId: original.commentId || "",
              media: String(original.media || ""),
              readBy: original.readBy || [],
              savedBy: original.savedBy || [],
              kept: !!original.kept,
              hiddenFor: original.hiddenFor || [],
              expiresAt: Number(original.expiresAt || 0),
              expired: !!original.expired,
            };
            if (!message.id || !Number.isFinite(message.created)) {
              throw new Error("A legacy message is missing its original ID or date.");
            }
            if (message.media.startsWith("oldtime-media:")) {
              const copied = await migrateLocalMedia(message.media, me.id);
              if (!copied) {
                const mediaId = message.media.slice("oldtime-media:".length);
                const cloudMedia = await cloudRequest(`/api/media/${encodeURIComponent(mediaId)}/url`, { session });
                if (!cloudMedia?.url) throw new Error("A chat attachment is missing from cloud storage.");
              }
            } else if (/^(data:|blob:)/i.test(message.media)) {
              const response = await fetch(message.media);
              if (!response.ok) throw new Error("A chat attachment could not be read for transfer.");
              const blob = await response.blob();
              if (!blob.size || !blob.type) throw new Error("A chat attachment has no valid media type.");
              message.media = await putLocalMedia(blob);
            } else if (message.media && !/^(https?:\/\/|\/|\.\/)/i.test(message.media)) {
              throw new Error("A chat attachment uses an unsupported local-only reference.");
            }
            messages.push(message);
          }
          const base = {
            version: 1,
            id: room.id,
            ownerLocalId: me.id,
            ownerAccountId: session.account.id,
            title: String(room.title || "").slice(0, 80),
            members,
            group: room.group || null,
            draft: String(room.draft || ""),
            pinnedIds: Array.isArray(room.pinnedIds) ? room.pinnedIds : [],
            disappear: String(room.disappear || "off"),
            mutedUntil: Number(room.mutedUntil || 0),
            wallpaper: String(room.wallpaper || ""),
            locked: room.locked === true,
          };
          const parts = await splitLegacyChatArchive(base, messages);
          const expectedHashes = [];
          for (const part of parts) {
            const response = await cloudRequest(`/api/chats/legacy-archives/${encodeURIComponent(room.id)}/${part.part}`, {
              session,
              method: "PUT",
              body: { totalParts: part.totalParts, contentHash: part.contentHash, payload: part.payload },
            });
            ensureCurrentCloudSession(session);
            if (response.archive?.sourceId !== room.id || response.archive?.part !== part.part ||
              response.archive?.totalParts !== part.totalParts || response.archive?.contentHash !== part.contentHash) {
              throw new Error("The server did not confirm this archived conversation part.");
            }
            expectedHashes.push(part.contentHash);
          }
          const stored = await cloudRequest("/api/chats/legacy-archives", { session });
          const complete = await collectCompleteLegacyChatArchives(stored.archives);
          const verified = complete.archives.find(archive => archive.sourceId === room.id);
          if (!verified || verified.totalParts !== parts.length ||
            verified.hashes.some((hash, index) => hash !== expectedHashes[index]) ||
            verified.payload.messages.length !== messages.length ||
            verified.payload.ownerAccountId !== session.account.id) {
            throw new Error("The cloud archive could not be verified. The original chat is still preserved.");
          }
          ensureCurrentCloudSession(session);
          mutate(state => {
            state.convos = state.convos.filter(item =>
              !(item.id === room.id && item.members?.includes(me.id) && !item.cloudBacked && !item.cloudPending && !item.legacyArchive));
          });
          migration.confirmed++;
        } catch (error) {
          ensureCurrentCloudSession(session);
          migration.error = error.message || "Some old chats could not be verified in the cloud.";
        }
      }
      migration.pending = localRooms.length - migration.confirmed;
      return { ...migration };
    }).finally(() => {
      migration.loading = false;
      if (legacyChatMigrationPromise === operation) legacyChatMigrationPromise = null;
    });
    legacyChatMigrationPromise = operation;
    return operation;
  },
  legacyChatMigrationStatus() {
    return { ...legacyChatMigration };
  },
  async deleteCloudLegacyChatArchive(sourceId) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to delete a private chat archive.");
    await cloudRequest(`/api/chats/legacy-archives/${encodeURIComponent(sourceId)}`, { session, method: "DELETE" });
    const result = await cloudRequest("/api/chats/legacy-archives", { session });
    ensureCurrentCloudSession(session);
    if (result.archives?.some(archive => archive.sourceId === sourceId)) {
      throw new Error("The archived conversation could not be confirmed as deleted.");
    }
    mutate(state => {
      state.convos = state.convos.filter(room => !(room.id === sourceId && room.legacyArchive));
    });
    return true;
  },
  async refreshCloudChats({ force = false, migrateLegacy = true } = {}) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    if (!force && cloudChatsOwnerToken === session.accessToken && Date.now() - cloudChatsFetchedAt < 20_000) return false;
    if (migrateLegacy) await this.migrateLegacyChatArchives();
    const result = await cloudRequest("/api/chats", { session });
    const archiveResult = await cloudRequest("/api/chats/legacy-archives", { session });
    if (!Array.isArray(result.chats) || !Array.isArray(archiveResult.archives)) throw new Error("Messages returned an invalid response.");
    ensureCurrentCloudSession(session);
    const me = this.me();
    const rooms = result.chats.map(room => {
      if (typeof room.id !== "string" || !Array.isArray(room.members)) throw new Error("Messages returned an invalid conversation.");
      const members = room.members.map(profile => cloudAuthorId(profile));
      if (!members.includes(me?.id)) throw new Error("Messages returned a conversation without the signed-in user.");
      return {
        id: room.id, title: String(room.title || ""), members,
        state: room.state && typeof room.state === "object" ? room.state : {},
      };
    });
    const completeArchives = await collectCompleteLegacyChatArchives(archiveResult.archives);
    const archiveRooms = completeArchives.archives
      .filter(archive => archive.payload.ownerAccountId === session.account.id && archive.payload.ownerLocalId)
      .map(archive => {
        const payload = archive.payload;
        const idMap = new Map();
        const profiles = (Array.isArray(payload.members) ? payload.members : []).map(profile => {
          const sourceId = String(profile?.id || "");
          const cloudAccountId = typeof profile?.cloudAccountId === "string" ? profile.cloudAccountId : "";
          let localId = sourceId;
          if (sourceId === payload.ownerLocalId || cloudAccountId === session.account.id) localId = me.id;
          else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cloudAccountId)) {
            localId = cloudAuthorId({
              id: cloudAccountId,
              username: String(profile.username || "oldtime-member"),
              displayName: String(profile.displayName || profile.username || "Oldtime member"),
            });
          }
          idMap.set(sourceId, localId);
          return {
            id: localId,
            cloudAccountId: cloudAccountId || undefined,
            username: String(profile.username || "oldtime-member"),
            name: String(profile.displayName || profile.username || "Oldtime member"),
            avatar: typeof profile.avatar === "string" && /^https?:\/\//i.test(profile.avatar) ? profile.avatar : "",
            verified: profile.verified === true,
            legacyArchiveProfile: localId !== me.id && !cloudAccountId,
          };
        });
        if (!idMap.has(payload.ownerLocalId)) idMap.set(payload.ownerLocalId, me.id);
        const memberIds = [...new Set([me.id, ...(Array.isArray(payload.members) ? payload.members : [])
          .map(profile => idMap.get(String(profile?.id || "")) || String(profile?.id || ""))])];
        const messages = payload.messages.map(item => ({
          ...item,
          author: idMap.get(item.author) || item.author,
          reactions: Object.fromEntries(Object.entries(item.reactions || {}).map(([emoji, ids]) => [
            emoji, Array.isArray(ids) ? ids.map(id => idMap.get(id) || id) : [],
          ])),
          readBy: Array.isArray(item.readBy) ? item.readBy.map(id => idMap.get(id) || id) : [],
          savedBy: Array.isArray(item.savedBy) ? item.savedBy.map(id => idMap.get(id) || id) : [],
          hiddenFor: Array.isArray(item.hiddenFor) ? item.hiddenFor.map(id => idMap.get(id) || id) : [],
          cloudMediaOwnerId: me.id,
          cloudSynced: true,
        })).sort((left, right) => Number(left.created) - Number(right.created));
        return {
          id: archive.sourceId,
          members: memberIds,
          title: String(payload.title || ""),
          messages,
          draft: String(payload.draft || ""),
          pinnedIds: Array.isArray(payload.pinnedIds) ? payload.pinnedIds : [],
          disappear: String(payload.disappear || "off"),
          mutedUntil: Number(payload.mutedUntil || 0),
          wallpaper: String(payload.wallpaper || ""),
          locked: payload.locked === true,
          group: payload.group || null,
          cloudBacked: false,
          legacyArchive: true,
          legacyMessageCount: messages.length,
          legacyProfiles: profiles,
        };
      })
      .filter(room => room.messages.length > 0 || room.draft.trim().length > 0);
    mutate(state => {
      state.convos = state.convos.filter(item => !item.legacyArchive);
      for (const room of archiveRooms) {
        for (const profile of room.legacyProfiles || []) {
          if (!state.users.some(user => user.id === profile.id)) {
            const { legacyArchiveProfile, ...user } = profile;
            state.users.push({ ...user, legacyArchiveProfile });
          }
        }
        delete room.legacyProfiles;
        state.convos.unshift(room);
      }
      for (const room of rooms) {
        let local = state.convos.find(item => item.id === room.id);
        if (!local) {
          local = {
            id: room.id, members: room.members, title: room.title, messages: [], draft: "",
            pinnedIds: [], disappear: "off", mutedUntil: 0, wallpaper: "", locked: false,
            group: room.members.length > 2 ? { name: room.title || "Group", admins: [me.id] } : null,
          };
          state.convos.unshift(local);
        } else {
          local.members = room.members;
          if (room.title) local.title = room.title;
          if (room.members.length > 2 && !local.group) local.group = { name: room.title || "Group", admins: [me.id] };
        }
        local.cloudBacked = true;
        local.cloudState = room.state;
        local.draft = typeof room.state.draft === "string" ? room.state.draft : local.draft || "";
        local.pinnedIds = Array.isArray(room.state.pinnedIds) ? room.state.pinnedIds : [];
        local.disappear = typeof room.state.disappear === "string" ? room.state.disappear : local.disappear || "off";
        local.mutedUntil = Number(room.state.mutedUntil || 0);
        local.wallpaper = typeof room.state.wallpaper === "string" ? room.state.wallpaper : "";
        local.locked = room.state.locked === true;
        const hiddenIds = new Set(Array.isArray(room.state.hiddenMessageIds) ? room.state.hiddenMessageIds : []);
        for (const message of local.messages) {
          message.hiddenFor = hiddenIds.has(message.id) ? [me.id] : [];
        }
        const savedIds = Array.isArray(room.state.savedMessageIds) ? room.state.savedMessageIds : [];
        state.saved = [...new Set([...(state.saved || []), ...savedIds])];
        const keptIds = new Set(Array.isArray(room.state.keptMessageIds) ? room.state.keptMessageIds : []);
        for (const message of local.messages) message.kept = keptIds.has(message.id);
      }
    });
    cloudChatsOwnerToken = session.accessToken;
    cloudChatsFetchedAt = Date.now();
    return true;
  },
  async refreshCloudChatMessages(conversationId, { force = false } = {}) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    const cacheKey = `${session.account.id}:${conversationId}`;
    if (!force && cloudChatMessagesFetchedAt.get(cacheKey) && Date.now() - cloudChatMessagesFetchedAt.get(cacheKey) < 10_000) return false;
    const result = await cloudRequest(`/api/chats/${encodeURIComponent(conversationId)}/messages`, { session });
    if (!Array.isArray(result.messages)) throw new Error("Messages returned an invalid response.");
    ensureCurrentCloudSession(session);
    const me = this.me();
    const remote = result.messages.map(item => ({
      id: String(item.id),
      author: cloudAuthorId(item.author),
      kind: String(item.kind || "text"),
      body: String(item.body || ""),
      created: Number(item.createdAt),
      status: cloudAuthorId(item.author) === me?.id ? (item.status === "read" ? "read" : "sent") : "delivered",
      cloudSynced: true,
      reactions: Object.fromEntries(Object.entries(item.reactions || {}).map(([emoji, ids]) => [
        emoji,
        Array.isArray(ids) ? ids.map(id => id === session.account.id ? me?.id : id) : [],
      ])),
      editHistory: Array.isArray(item.editHistory) ? item.editHistory : [],
      edited: !!item.editedAt || !!item.edited,
      editedAt: Number(item.editedAt || 0),
      replyTo: item.replyTo || item.metadata?.replyTo || "",
      caption: item.caption || item.metadata?.caption || "",
      fileName: item.fileName || item.metadata?.fileName || "",
      fileSize: item.fileSize || item.metadata?.fileSize || "",
      viewOnce: !!(item.viewOnce ?? item.metadata?.viewOnce),
      forwarded: !!(item.forwarded ?? item.metadata?.forwarded),
      duration: item.duration || item.metadata?.duration || "",
      peaks: item.peaks || item.metadata?.peaks || [],
      poll: item.poll || item.metadata?.poll,
      postId: item.postId || item.metadata?.postId,
      sharedPostId: item.sharedPostId || item.metadata?.sharedPostId,
      sharedCommentId: item.sharedCommentId || item.metadata?.sharedCommentId,
      media: Array.isArray(item.media) ? item.media[0]?.reference || "" : "",
      readBy: Array.isArray(item.readBy)
        ? item.readBy.map(id => id === session.account.id ? me?.id : id)
        : [],
    }));
    mutate(state => {
      const room = state.convos.find(item => item.id === conversationId);
      if (!room) return;
      const byId = new Map(room.messages.map(item => [item.id, item]));
      const savedIds = new Set(room.cloudState?.savedMessageIds || []);
      const hiddenIds = new Set(room.cloudState?.hiddenMessageIds || []);
      const keptIds = new Set(room.cloudState?.keptMessageIds || []);
      for (const item of remote) byId.set(item.id, {
        ...byId.get(item.id),
        ...item,
        savedBy: savedIds.has(item.id) ? [me?.id] : [],
        hiddenFor: hiddenIds.has(item.id) ? [me?.id] : [],
        kept: keptIds.has(item.id),
      });
      room.messages = [...byId.values()].sort((a, b) => a.created - b.created);
    });
    cloudChatMessagesFetchedAt.set(cacheKey, Date.now());
    return true;
  },
  async ensureCloudChat(conversation) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to send messages.");
    if (!conversation?.id || !Array.isArray(conversation.members)) throw new Error("Conversation is unavailable.");
    if (cloudChatCreatePromises.has(conversation.id)) return cloudChatCreatePromises.get(conversation.id);
    const me = this.me();
    const members = [...new Set(conversation.members.map(id =>
      id === me?.id ? session.account.id : this.user(id)?.cloudAccountId || id
    ))];
    if (members.length < 2 || members.length > 16 || members.some(id => !/^[0-9a-f-]{36}$/i.test(id))) {
      throw new Error("Every chat member must have an online account before this conversation can sync.");
    }
    const promise = cloudRequest("/api/chats", {
      session,
      method: "POST",
      body: { id: conversation.id, title: conversation.title || conversation.group?.name || "", members },
    }).then(result => {
      if (!result.chat?.id || result.chat.id !== conversation.id) throw new Error("The conversation was not saved online.");
      mutate(state => {
        const room = state.convos.find(item => item.id === conversation.id);
        if (room) {
          room.cloudBacked = true;
          room.cloudPending = false;
          room.cloudState = result.chat.state || room.cloudState || {};
        }
      });
      return result.chat;
    }).finally(() => cloudChatCreatePromises.delete(conversation.id));
    cloudChatCreatePromises.set(conversation.id, promise);
    return promise;
  },
  async sendCloudChatMessage(conversationId, message) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to send messages.");
    const mediaIds = [];
    if (message?.media) {
      const mediaReference = String(message.media);
      let mediaId = "";
      if (mediaReference.startsWith("oldtime-media:")) {
        const currentId = mediaReference.slice("oldtime-media:".length);
        if (!/^[0-9a-f-]{36}$/i.test(currentId)) throw new Error("This attachment reference is invalid.");
        const uploaded = await cloudRequest(`/api/media/${encodeURIComponent(currentId)}/url`, { session });
        if (!uploaded?.url) throw new Error("The attachment is not available in your online account.");
        mediaId = currentId;
      } else if (mediaReference.startsWith("data:") || mediaReference.startsWith("blob:")) {
        const response = await fetch(mediaReference);
        if (!response.ok) throw new Error("The attachment could not be read for upload.");
        const blob = await response.blob();
        if (!blob.size) throw new Error("The attachment is empty.");
        const { putLocalMedia } = await import("./local-media.js");
        const uploadedReference = await putLocalMedia(blob);
        mediaId = uploadedReference.slice("oldtime-media:".length);
        message.media = uploadedReference;
      } else {
        throw new Error("This attachment must be uploaded again before it can be sent.");
      }
      message.cloudMediaId = mediaId;
      message.media = `oldtime-media:${mediaId}`;
      mediaIds.push(mediaId);
    }
    const metadata = Object.fromEntries(Object.entries({
      replyTo: message.replyTo,
      caption: message.caption,
      fileName: message.fileName,
      fileSize: message.fileSize,
      viewOnce: message.viewOnce,
      forwarded: message.forwarded,
      poll: message.poll ? { question: message.poll.question, options: message.poll.options } : undefined,
      postId: message.postId,
      sharedPostId: message.sharedPostId,
      sharedCommentId: message.sharedCommentId,
      commentId: message.commentId,
      duration: message.duration,
      peaks: message.peaks,
    }).filter(([, value]) => value !== null && value !== undefined));
    const result = await cloudRequest(`/api/chats/${encodeURIComponent(conversationId)}/messages`, {
      session,
      method: "POST",
      body: { clientId: message.id, kind: message.kind || "text", body: message.body || "", metadata, mediaIds },
    });
    if (!result.message?.id || result.message.id !== message.id) throw new Error("The message was not saved online.");
    cloudChatMessagesFetchedAt.set(`${session.account.id}:${conversationId}`, Date.now());
    return result.message;
  },
  async updateCloudChatState(conversationId, state) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to save chat settings.");
    const result = await cloudRequest(`/api/chats/${encodeURIComponent(conversationId)}/state`, {
      session, method: "PUT", body: { state },
    });
    if (!result.state || typeof result.state !== "object") throw new Error("Chat settings were not saved online.");
    mutate(current => {
      const room = current.convos.find(item => item.id === conversationId);
      if (room) room.cloudState = result.state;
    });
    return result.state;
  },
  async markCloudChatRead(conversationId, shareReceipts = true) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to save read status.");
    await cloudRequest(`/api/chats/${encodeURIComponent(conversationId)}/read`, {
      session, method: "POST", body: { shareReceipts },
    });
  },
  async editCloudChatMessage(conversationId, messageId, body) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to edit messages.");
    const result = await cloudRequest(`/api/chats/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`, {
      session, method: "PATCH", body: { body },
    });
    if (!result.message?.id || result.message.id !== messageId) throw new Error("The message edit was not saved online.");
    cloudChatMessagesFetchedAt.delete(`${session.account.id}:${conversationId}`);
    return result.message;
  },
  async deleteCloudChatMessage(conversationId, messageId) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to delete messages.");
    await cloudRequest(`/api/chats/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`, {
      session, method: "DELETE",
    });
    cloudChatMessagesFetchedAt.delete(`${session.account.id}:${conversationId}`);
  },
  async refreshCloudCloseFriends() {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    if (cloudCloseFriendsOwnerToken === session.accessToken) return [...cloudCloseFriends];
    const result = await cloudRequest("/api/close-friends", { session });
    if (!Array.isArray(result.profiles)) throw new Error("Close Friends returned an invalid response.");
    const ids = result.profiles.map(profile => cloudAuthorId(profile));
    ensureCurrentCloudSession(session);
    cloudCloseFriends = ids;
    cloudCloseFriendsOwnerToken = session.accessToken;
    return ids;
  },
  async replaceCloudCloseFriends(memberIds) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    const result = await cloudRequest("/api/close-friends", {
      session,
      method: "PUT",
      body: { memberIds: [...new Set(memberIds)].filter(id => id !== session.account.id) },
    });
    if (!Array.isArray(result.profiles)) throw new Error("Close Friends returned an invalid response.");
    const ids = result.profiles.map(profile => cloudAuthorId(profile));
    ensureCurrentCloudSession(session);
    cloudCloseFriends = ids;
    cloudCloseFriendsOwnerToken = session.accessToken;
    return ids;
  },
  cloudRelationshipsLoaded() {
    const session = getCloudSession();
    return Boolean(session?.accessToken && cloudRelationshipsOwnerToken === session.accessToken && cloudRelationships);
  },
  cloudRelationshipsLoading() {
    return cloudRelationshipsLoading;
  },
  async refreshCloudRelationships({ force = false, importLegacy = true } = {}) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    if (!force && this.cloudRelationshipsLoaded()) return structuredClone(cloudRelationships);
    if (!force && Date.now() - cloudRelationshipsAttemptedAt < 5000) return null;
    cloudRelationshipsLoading = true;
    cloudRelationshipsAttemptedAt = Date.now();
    try {
      if (importLegacy && cloudRelationshipImportOwnerToken !== session.accessToken) {
        const current = this.me();
        const remoteIds = values => [...new Set((Array.isArray(values) ? values : []).map(id => {
          const profile = this.user(id);
          return profile?.cloudAccountId || id;
        }).filter(id => id !== session.account.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)))];
        await cloudRequest("/api/relationships/import-legacy", {
          session,
          method: "POST",
          body: {
            followingIds: remoteIds(current?.following),
            friendIds: remoteIds(current?.friends),
            outgoingFriendRequestIds: remoteIds(db.friendRequests.filter(request => request.from === current?.id).map(request => request.to)),
            outgoingFollowRequestIds: remoteIds(db.requests.filter(request => request.from === current?.id).map(request => request.to)),
          },
        });
        ensureCurrentCloudSession(session);
        cloudRelationshipImportOwnerToken = session.accessToken;
      }
      const result = await cloudRequest("/api/relationships", { session });
      const keys = [
        "following", "followers", "friends", "incomingFriendRequests", "outgoingFriendRequests",
        "incomingFollowRequests", "outgoingFollowRequests",
      ];
      if (!result || keys.some(key => !Array.isArray(result[key]))) {
        throw new Error("Your online Friends and following list returned an invalid response.");
      }
      const ids = Object.fromEntries(keys.map(key => [
        key,
        result[key].map(profile => {
          if (!profile?.id || !profile?.username) throw new Error("An online relationship profile is invalid.");
          return cloudAuthorId(profile);
        }),
      ]));
      ensureCurrentCloudSession(session);
      cloudRelationships = ids;
      cloudRelationshipsOwnerToken = session.accessToken;
      const current = this.me();
      if (current) {
        current.following = ids.following;
        current.followers = ids.followers;
        current.friends = ids.friends;
        db.friendRequests = [
          ...db.friendRequests.filter(request => request.from !== current.id && request.to !== current.id),
          ...ids.incomingFriendRequests.map(from => ({ from, to: current.id, at: Date.now() })),
          ...ids.outgoingFriendRequests.map(to => ({ from: current.id, to, at: Date.now() })),
        ];
        db.requests = [
          ...db.requests.filter(request => request.from !== current.id && request.to !== current.id),
          ...ids.incomingFollowRequests.map(from => ({ from, to: current.id, at: Date.now() })),
          ...ids.outgoingFollowRequests.map(to => ({ from: current.id, to, at: Date.now() })),
        ];
      }
      return structuredClone(cloudRelationships);
    } finally {
      cloudRelationshipsLoading = false;
    }
  },
  async setCloudFollow(userId, shouldFollow) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    const target = this.user(userId);
    const remoteId = target?.cloudAccountId || userId;
    if (!remoteId || remoteId === session.account.id) throw new Error("Choose another account.");
    await cloudRequest(`/api/relationships/follow/${encodeURIComponent(remoteId)}`, {
      session,
      method: shouldFollow ? "POST" : "DELETE",
    });
    await this.refreshCloudRelationships({ force: true });
    return this.cloudRelationshipsLoaded();
  },
  async respondCloudFollowRequest(userId, accept) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    const target = this.user(userId);
    const remoteId = target?.cloudAccountId || userId;
    const path = `/api/relationships/follow-requests/${encodeURIComponent(remoteId)}`;
    await cloudRequest(accept ? `${path}/accept` : path, {
      session,
      method: accept ? "POST" : "DELETE",
    });
    await this.refreshCloudRelationships({ force: true });
  },
  async sendCloudFriendRequest(userId) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    const target = this.user(userId);
    const remoteId = target?.cloudAccountId || userId;
    if (!remoteId || remoteId === session.account.id) throw new Error("Choose another account.");
    const result = await cloudRequest(`/api/relationships/friend-requests/${encodeURIComponent(remoteId)}`, {
      session,
      method: "POST",
    });
    await this.refreshCloudRelationships({ force: true });
    return result.status;
  },
  async respondCloudFriendRequest(userId, accept) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    const target = this.user(userId);
    const remoteId = target?.cloudAccountId || userId;
    const path = `/api/relationships/friend-requests/${encodeURIComponent(remoteId)}`;
    await cloudRequest(accept ? `${path}/accept` : path, {
      session,
      method: accept ? "POST" : "DELETE",
    });
    await this.refreshCloudRelationships({ force: true });
  },
  async removeCloudFriend(userId) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    const target = this.user(userId);
    const remoteId = target?.cloudAccountId || userId;
    await cloudRequest(`/api/relationships/friends/${encodeURIComponent(remoteId)}`, {
      session,
      method: "DELETE",
    });
    await this.refreshCloudRelationships({ force: true });
  },
  async refreshCloudBlocks() {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    if (cloudBlocksOwnerToken === session.accessToken) return [...cloudBlocks];
    const result = await cloudRequest("/api/account/blocks", { session });
    if (!Array.isArray(result.profiles)) throw new Error("Account blocks returned an invalid response.");
    cloudBlocks = result.profiles.map(profile => cloudAuthorId(profile));
    ensureCurrentCloudSession(session);
    cloudBlocksOwnerToken = session.accessToken;
    return [...cloudBlocks];
  },
  async replaceCloudBlocks(userIds) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    const hadLoadedCloseFriends = this.cloudCloseFriendsLoaded();
    const result = await cloudRequest("/api/account/blocks", {
      session,
      method: "PUT",
      body: { userIds: [...new Set(userIds)].filter(id => id !== session.account.id) },
    });
    if (!Array.isArray(result.profiles)) throw new Error("Account blocks returned an invalid response.");
    cloudBlocks = result.profiles.map(profile => cloudAuthorId(profile));
    cloudBlocksOwnerToken = session.accessToken;
    if (hadLoadedCloseFriends) {
      cloudCloseFriends = cloudCloseFriends.filter(id => !cloudBlocks.includes(id));
      cloudCloseFriendsOwnerToken = session.accessToken;
    }
    if (this.cloudRelationshipsLoaded()) await this.refreshCloudRelationships({ force: true });
    ensureCurrentCloudSession(session);
    return [...cloudBlocks];
  },
  async syncCloudPrivacy() {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    if (cloudPrivacyOwnerToken === session.accessToken) return this.me()?.private === true;
    let result = await cloudRequest("/api/account/privacy", { session });
    if (!result.initialized) {
      result = await cloudRequest("/api/account/privacy", {
        session,
        method: "PUT",
        body: { isPrivate: this.me()?.private === true },
      });
    }
    if (typeof result.isPrivate !== "boolean") throw new Error("Profile privacy returned an invalid response.");
    ensureCurrentCloudSession(session);
    const owner = this.me()?.id;
    mutate(state => {
      const account = state.users.find(user => user.id === owner);
      if (account) account.private = result.isPrivate;
    });
    cloudPrivacyOwnerToken = session.accessToken;
    return result.isPrivate;
  },
  async refreshCloudPrivacy() {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    let result = await cloudRequest("/api/account/privacy", { session });
    if (!result.initialized) {
      result = await cloudRequest("/api/account/privacy", {
        session,
        method: "PUT",
        body: { isPrivate: this.me()?.private === true },
      });
    }
    if (typeof result.isPrivate !== "boolean") throw new Error("Profile privacy returned an invalid response.");
    ensureCurrentCloudSession(session);
    const owner = this.me()?.id;
    mutate(state => {
      const account = state.users.find(user => user.id === owner);
      if (account) account.private = result.isPrivate;
    });
    cloudPrivacyOwnerToken = session.accessToken;
    return result.isPrivate;
  },
  async updateCloudPrivacy(isPrivate) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    const result = await cloudRequest("/api/account/privacy", {
      session,
      method: "PUT",
      body: { isPrivate: Boolean(isPrivate) },
    });
    ensureCurrentCloudSession(session);
    const owner = this.me()?.id;
    mutate(state => {
      const account = state.users.find(user => user.id === owner);
      if (account) account.private = result.isPrivate === true;
    });
    cloudPrivacyOwnerToken = session.accessToken;
    return result.isPrivate === true;
  },
  migrateCloudStories({ retry = false } = {}) {
    const session = getCloudSession();
    const me = this.me();
    if (!session?.account?.id || !me) return Promise.reject(new Error("Sign in to an online account to migrate Stories."));
    const ownStories = db.stories.filter(story => story.author === me.id && !story.cloud);
    if (!retry && cloudStoryMigration.accountId === session.account.id &&
      ((cloudStoryMigration.done && ownStories.length === 0) ||
        (Date.now() - Number(cloudStoryMigration.lastAttemptAt || 0) < 60_000 &&
          cloudStoryMigration.pending === ownStories.length))) {
      return Promise.resolve({ ...cloudStoryMigration });
    }
    if (cloudStoryMigrationPromise) return cloudStoryMigrationPromise;
    const timestamp = value => {
      const numeric = Number(value);
      if (Number.isSafeInteger(numeric) && numeric >= 0 && numeric <= 8_640_000_000_000_000) return numeric;
      const parsed = Date.parse(String(value || ""));
      return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 8_640_000_000_000_000 ? parsed : NaN;
    };
    const mediaPrefix = "oldtime-media:";
    const candidates = ownStories.filter(story => {
      const id = String(story.id || "");
      const text = String(story.text ?? story.caption ?? "").trim();
      const visibility = story.closeFriends === true
        ? "close-friends"
        : String(story.visibility || story.audience || "public").toLowerCase().replace(/_/g, "-");
      const created = timestamp(story.created ?? story.createdAt);
      const mediaReference = Array.isArray(story.media) ? story.media[0] : story.media;
      const hasReference = typeof mediaReference === "string" && Boolean(mediaReference);
      const mediaKind = ["photo", "video"].includes(story.kind) || hasReference;
      return id.length > 0 && id.length <= 180
        && text.length <= 2000
        && (text.length > 0 || mediaKind)
        && ["public", "followers", "friends", "close-friends"].includes(visibility)
        && Number.isFinite(created) && Number.isSafeInteger(created)
        && created >= 0 && created <= 8_640_000_000_000_000
        && (!Array.isArray(story.media) || (story.media.length <= 1 && (!story.media.length || typeof story.media[0] === "string")));
    });
    const migration = cloudStoryMigration = {
      accountId: session.account.id,
      loading: true,
      done: false,
      error: "",
      confirmed: 0,
      pending: ownStories.length,
      unsupported: ownStories.length - candidates.length,
      lastAttemptAt: Date.now()
    };
    const operation = Promise.resolve().then(async () => {
      try {
        await this.syncCloudPrivacy();
        for (const story of candidates) {
          ensureCurrentCloudSession(session);
          const text = String(story.text ?? story.caption ?? "").trim();
          const visibility = story.closeFriends === true
            ? "close-friends"
            : String(story.visibility || story.audience || "public").toLowerCase().replace(/_/g, "-");
          const createdAt = timestamp(story.created ?? story.createdAt);
          const expiresAtValue = timestamp(story.expiresAt);
          const expiresAt = Number.isSafeInteger(expiresAtValue) && expiresAtValue >= createdAt
            ? expiresAtValue
            : createdAt + 86_400_000;
          const reference = Array.isArray(story.media) ? String(story.media[0] || "") :
            typeof story.media === "string" ? story.media : "";
          let mediaId = "";
          let mediaType;

          if (reference.startsWith(mediaPrefix)) {
            const { migrateLocalMedia } = await import("./local-media.js");
            await migrateLocalMedia(reference, me.id);
            mediaId = reference.slice(mediaPrefix.length);
            const metadata = await cloudRequest(`/api/media/${encodeURIComponent(mediaId)}/url`, { session });
            const contentType = String(metadata?.contentType || "").toLowerCase();
            mediaType = contentType.startsWith("video/") ? "video" : contentType.startsWith("image/") ? "photo" : undefined;
          } else if (reference) {
            const response = await fetch(reference);
            if (!response.ok) throw new Error("A legacy Story media file could not be read.");
            const mediaBlob = await response.blob();
            if (!mediaBlob.size || !/^(image\/(jpeg|png|webp)|video\/(mp4|webm))$/.test(mediaBlob.type)) {
              throw new Error("A legacy Story uses media that the cloud Story service cannot accept.");
            }
            const { putLocalMedia } = await import("./local-media.js");
            const uploadedReference = await putLocalMedia(mediaBlob);
            mediaId = uploadedReference.slice(mediaPrefix.length);
            mediaType = mediaBlob.type.startsWith("video/") ? "video" : "photo";
          }

          if (mediaId && !mediaType) throw new Error("A legacy Story uses a file type that the cloud Story service cannot accept.");
          if (!mediaId && ["photo", "video"].includes(story.kind)) {
            throw new Error("A legacy Story refers to media that is no longer available.");
          }

          const payload = {
            sourceId: String(story.id),
            text,
            visibility,
            createdAt,
            expiresAt,
            commentsEnabled: story.commentsEnabled !== false,
            savedToProfile: story.savedToProfile === true,
            ...(mediaType ? { mediaType, mediaId } : {})
          };
          let result = await cloudRequest("/api/stories/import", {
            session,
            method: "POST",
            body: payload
          });
          if (!result.story?.id || result.story.sourceId !== payload.sourceId) {
            throw new Error("The server did not confirm the legacy Story identity.");
          }
          const confirmed = result.story;
          if (confirmed?.sourceId !== payload.sourceId
            || confirmed.text !== text
            || confirmed.visibility !== visibility
            || Number(confirmed.createdAt) !== createdAt
            || Number(confirmed.expiresAt) !== expiresAt
            || confirmed.savedToProfile !== payload.savedToProfile
            || confirmed.commentsEnabled !== payload.commentsEnabled
            || (mediaType ? confirmed.mediaType !== mediaType || confirmed.hasMedia !== true : confirmed.hasMedia === true)) {
            throw new Error("The cloud Story copy did not pass its verification check.");
          }
          ensureCurrentCloudSession(session);
          mutate(state => {
            state.stories = state.stories.filter(item => !(item.id === story.id && item.author === me.id));
          });
          migration.confirmed++;
          migration.pending = ownStories.length - migration.confirmed;
        }
        migration.pending = ownStories.length - migration.confirmed;
        migration.done = migration.pending === 0;
        return { ...migration };
      } catch (error) {
        migration.pending = ownStories.length - migration.confirmed;
        migration.error = error instanceof Error ? error.message : "Some Stories could not be moved online.";
        throw error;
      } finally {
        migration.loading = false;
        if (cloudStoryMigrationPromise === operation) cloudStoryMigrationPromise = null;
      }
    });
    cloudStoryMigrationPromise = operation;
    return operation;
  },
  async refreshCloudStories() {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    if (cloudStoriesLoading && cloudStoriesOwnerToken === session.accessToken) return [...cloudStories];
    cloudStoriesLoading = true;
    cloudStoriesOwnerToken = session.accessToken;
    cloudStoriesAttemptedAt = Date.now();
    try {
      const result = await cloudRequest("/api/stories", { session });
      if (!Array.isArray(result.stories)) throw new Error("The online Stories feed returned an invalid response.");
      const nextStories = result.stories.map(story => ({
        id: story.id,
        author: cloudAuthorId(story.author),
        kind: story.mediaType || (story.hasMedia ? "photo" : "text"),
        hasMedia: story.hasMedia === true,
        media: "",
        text: story.text,
        visibility: story.visibility,
        closeFriends: story.visibility === "close-friends",
        created: Number(story.createdAt),
        expiresAt: Number(story.expiresAt),
        savedToProfile: story.savedToProfile === true,
        commentsEnabled: story.commentsEnabled !== false,
        comments: cloudStoryComments.get(story.id) || [],
        viewerReaction: story.viewerReaction || null,
        cloud: true,
        serverVisible: true,
        color: "#111922",
      }));
      ensureCurrentCloudSession(session);
      const storyIds = new Set(nextStories.map(story => story.id));
      for (const [id, url] of cloudStoryMedia) {
        if (storyIds.has(id)) continue;
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
        cloudStoryMedia.delete(id);
        cloudStoryMediaExpiries.delete(id);
      }
      cloudStories = nextStories;
      cloudStoriesLoaded = true;
      cloudStoriesFetchedAt = Date.now();
      return [...cloudStories];
    } finally {
      if (cloudStoriesOwnerToken === session.accessToken) cloudStoriesLoading = false;
    }
  },
  async createCloudStory({ text, visibility, mediaDataUrl = "", mediaBlob = null, mediaId = "", mediaType: requestedMediaType = "", commentsEnabled = true, onUploadProgress }) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    const isPrivate = await this.syncCloudPrivacy();
    if (isPrivate && visibility === "public") {
      throw new Error("Private accounts can share Stories with Followers, Friends, or Close Friends.");
    }
    const uploadBlob = mediaBlob instanceof Blob ? mediaBlob : mediaDataUrl ? await fetch(mediaDataUrl).then(response => {
      if (!response.ok) throw new Error("The selected Story media could not be read.");
      return response.blob();
    }) : null;
    if (uploadBlob && !/^(image\/(jpeg|png|webp)|video\/(mp4|webm))$/.test(uploadBlob.type)) {
      throw new Error("Choose a JPEG, PNG, WebP, MP4, or WebM Story file.");
    }
    let uploadedMediaReference = "";
    let resolvedMediaId = String(mediaId || "");
    if (uploadBlob && !resolvedMediaId) {
      const { putLocalMedia } = await import("./local-media.js");
      uploadedMediaReference = await putLocalMedia(uploadBlob, undefined, onUploadProgress);
      resolvedMediaId = uploadedMediaReference.slice("oldtime-media:".length);
    } else if (resolvedMediaId.startsWith("oldtime-media:")) {
      resolvedMediaId = resolvedMediaId.slice("oldtime-media:".length);
    }
    if (resolvedMediaId && !/^[0-9a-f-]{36}$/i.test(resolvedMediaId)) throw new Error("The Story media reference is invalid.");
    const mediaType = requestedMediaType || (uploadBlob ? (uploadBlob.type.startsWith("video/") ? "video" : "photo") : undefined);
    let storyId = "";
    try {
      const result = await cloudRequest("/api/stories", {
        session,
        method: "POST",
        body: {
          text: String(text || ""), visibility, commentsEnabled: commentsEnabled !== false,
          ...(mediaType ? { mediaType } : {}),
          ...(resolvedMediaId ? { mediaId: resolvedMediaId, mediaType: mediaType || "photo" } : {}),
        },
      });
      storyId = result.story?.id || "";
      if (!storyId) throw new Error("The online service did not return the new Story.");
      await this.refreshCloudStories();
      return cloudStories.find(story => story.id === storyId) || null;
    } catch (error) {
      if (storyId) try { await cloudRequest(`/api/stories/${encodeURIComponent(storyId)}`, { session, method: "DELETE" }); }
      catch { /* keep the original upload failure visible */ }
      if (uploadedMediaReference) {
        try { await (await import("./local-media.js")).deleteLocalMedia(uploadedMediaReference); }
        catch { /* keep the original Story failure visible */ }
      }
      throw error;
    }
  },
  async loadCloudStoryMedia(id) {
    const existing = cloudStoryMedia.get(id);
    if (existing && (cloudStoryMediaExpiries.get(id) || 0) > Date.now() + 15000) return existing;
    const session = getCloudSession();
    if (!session?.accessToken || !cloudStories.some(story => story.id === id)) {
      throw new Error("Story media is no longer available.");
    }
    const result = await cloudRequest(`/api/stories/${encodeURIComponent(id)}/media-url`, { session });
    if (!result?.url) throw new Error("Story media is no longer available.");
    if (cloudStoryMedia.size >= 10) {
      const oldest = cloudStoryMedia.keys().next().value;
      const urlToRevoke = cloudStoryMedia.get(oldest);
      if (urlToRevoke?.startsWith("blob:")) URL.revokeObjectURL(urlToRevoke);
      cloudStoryMedia.delete(oldest);
      cloudStoryMediaExpiries.delete(oldest);
    }
    cloudStoryMedia.set(id, result.url);
    cloudStoryMediaExpiries.set(id, Date.now() + 4 * 60 * 1000);
    return result.url;
  },
  async updateCloudStory(id, changes) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    const result = await cloudRequest(`/api/stories/${encodeURIComponent(id)}`, {
      session,
      method: "PATCH",
      body: {
        ...(typeof changes.savedToProfile === "boolean" ? { savedToProfile: changes.savedToProfile } : {}),
        ...(typeof changes.commentsEnabled === "boolean" ? { commentsEnabled: changes.commentsEnabled } : {}),
      },
    });
    const index = cloudStories.findIndex(story => story.id === id);
    if (index >= 0) cloudStories[index] = {
      ...cloudStories[index],
      savedToProfile: result.story.savedToProfile,
      commentsEnabled: result.story.commentsEnabled !== false,
    };
    return cloudStories[index] || null;
  },
  async saveCloudStory(id, savedToProfile) {
    return this.updateCloudStory(id, { savedToProfile: Boolean(savedToProfile) });
  },
  async loadCloudStoryComments(id) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to see Story replies.");
    const story = cloudStories.find(item => item.id === id);
    if (!story) throw new Error("Replies are available only for Stories published online.");
    const result = await cloudRequest(`/api/stories/${encodeURIComponent(id)}/comments`, { session });
    if (!Array.isArray(result.comments)) throw new Error("The Story replies could not be loaded.");
    const comments = result.comments.map(item => ({
      id: item.id,
      author: item.author.id,
      username: item.author.username,
      displayName: item.author.displayName,
      text: item.body,
      created: Number(item.createdAt),
      cloud: true,
    }));
    cloudStoryComments.set(id, comments);
    story.comments = comments;
    return [...comments];
  },
  async recordCloudStoryView(id) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to record a Story view.");
    const story = cloudStories.find(item => item.id === id);
    if (!story) throw new Error("This Story is not available online.");
    const result = await cloudRequest(`/api/stories/${encodeURIComponent(id)}/views`, {
      session,
      method: "POST",
    });
    if (typeof result.recorded !== "boolean") throw new Error("The Story view could not be confirmed.");
    return result;
  },
  async setCloudStoryReaction(id, emoji) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to react to this Story.");
    const story = cloudStories.find(item => item.id === id);
    if (!story) throw new Error("This Story is not available online.");
    const result = await cloudRequest(`/api/stories/${encodeURIComponent(id)}/reactions`, {
      session,
      method: "PUT",
      body: { emoji: String(emoji || "") },
    });
    if (!result.reaction?.emoji) throw new Error("The Story reaction could not be confirmed.");
    story.viewerReaction = result.reaction.emoji;
    return story.viewerReaction;
  },
  async removeCloudStoryReaction(id) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to update this Story reaction.");
    const story = cloudStories.find(item => item.id === id);
    if (!story) throw new Error("This Story is not available online.");
    await cloudRequest(`/api/stories/${encodeURIComponent(id)}/reactions`, {
      session,
      method: "DELETE",
    });
    story.viewerReaction = null;
  },
  async loadCloudStoryActivity(id) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to view Story activity.");
    const story = cloudStories.find(item => item.id === id);
    if (!story || story.author !== this.me()?.id) throw new Error("Only the Story owner can view activity.");
    const result = await cloudRequest(`/api/stories/${encodeURIComponent(id)}/activity`, { session });
    if (!Array.isArray(result.viewers)) throw new Error("Story activity could not be loaded.");
    return {
      viewCount: Number(result.viewCount) || 0,
      reactionCount: Number(result.reactionCount) || 0,
      viewers: result.viewers.map(viewer => ({
        id: String(viewer.id),
        username: String(viewer.username || "member"),
        displayName: String(viewer.displayName || viewer.username || "Member"),
        viewedAt: Number(viewer.viewedAt) || 0,
        reaction: viewer.reaction ? String(viewer.reaction) : null,
      })),
    };
  },
  async sendCloudStoryComment(id, body) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to reply to this Story.");
    const story = cloudStories.find(item => item.id === id);
    if (!story) throw new Error("Replies are available only for Stories published online.");
    const result = await cloudRequest(`/api/stories/${encodeURIComponent(id)}/comments`, {
      session,
      method: "POST",
      body: { body: String(body || "") },
    });
    const item = result.comment;
    if (!item?.id) throw new Error("The reply was not confirmed by the server.");
    const comment = {
      id: item.id,
      author: item.author.id,
      username: item.author.username,
      displayName: item.author.displayName,
      text: item.body,
      created: Number(item.createdAt),
      cloud: true,
    };
    const comments = [...(cloudStoryComments.get(id) || story.comments || []), comment];
    cloudStoryComments.set(id, comments);
    story.comments = comments;
    return comment;
  },
  async deleteCloudStoryComment(storyId, commentId) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to remove this reply.");
    await cloudRequest(`/api/stories/${encodeURIComponent(storyId)}/comments/${encodeURIComponent(commentId)}`, {
      session,
      method: "DELETE",
    });
    const comments = (cloudStoryComments.get(storyId) || []).filter(comment => comment.id !== commentId);
    cloudStoryComments.set(storyId, comments);
    const story = cloudStories.find(item => item.id === storyId);
    if (story) story.comments = comments;
  },
  cloudPostMigrationStatus: () => ({ ...cloudPostMigration }),
  cloudStoryMigrationStatus: () => ({ ...cloudStoryMigration }),
  cloudFeedStatus: () => ({
    loaded: cloudFeedLoaded,
    loading: cloudFeedLoading,
    error: cloudFeedError,
    hasMore: cloudFeedHasMore,
    surface: cloudFeedSurface,
  }),
  cloudCommunityFeedStatus: () => ({
    loaded: cloudCommunityFeedLoaded,
    loading: cloudCommunityFeedLoading,
    error: cloudCommunityFeedError,
    hasMore: cloudCommunityFeedHasMore,
    surface: cloudCommunityFeedSurface,
  }),
  cloudCommunityPosts: () => [...cloudCommunityFeed],
  cloudProfileReposts: userId => [...(cloudProfileRepostLists.get(String(userId))?.posts || [])],
  cloudProfileRepostsStatus: userId => {
    const state = cloudProfileRepostLists.get(String(userId));
    return state
      ? { loaded: state.loaded, loading: state.loading, error: state.error, hasMore: state.hasMore }
      : { loaded: false, loading: false, error: "", hasMore: false };
  },
  async refreshCloudProfileReposts(userId, username) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    const key = String(userId);
    const previous = cloudProfileRepostLists.get(key);
    if (previous?.loading && previous.ownerToken === session.accessToken) return [...previous.posts];
    cloudProfileRepostLists.set(key, {
      posts: previous?.ownerToken === session.accessToken ? previous.posts : [],
      loaded: false,
      loading: true,
      error: "",
      hasMore: false,
      nextOffset: 0,
      ownerToken: session.accessToken,
    });
    try {
      const result = await cloudRequest(
        `/api/profiles/${encodeURIComponent(username)}/reposts?limit=${CLOUD_PROFILE_REPOST_PAGE_SIZE}&offset=0`,
        { session },
      );
      ensureCurrentCloudSession(session);
      if (!Array.isArray(result.posts)) throw new Error("The online service returned an invalid repost list.");
      const state = {
        posts: result.posts.filter(post => !deletedCloudPostIds.has(post.id)).map(normalizeCloudPost),
        loaded: true,
        loading: false,
        error: "",
        hasMore: result.hasMore === true,
        nextOffset: Number.isSafeInteger(result.nextOffset) && result.nextOffset >= 0
          ? result.nextOffset
          : result.posts.length,
        ownerToken: session.accessToken,
      };
      cloudProfileRepostLists.set(key, state);
      return [...state.posts];
    } catch (error) {
      if (getCloudSession()?.accessToken === session.accessToken) {
        const state = cloudProfileRepostLists.get(key);
        if (state?.ownerToken === session.accessToken) {
          cloudProfileRepostLists.set(key, {
            ...state,
            loading: false,
            error: error.message || "Reposts could not be loaded.",
          });
        }
      }
      throw error;
    }
  },
  async loadMoreCloudProfileReposts(userId, username) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    const key = String(userId);
    const state = cloudProfileRepostLists.get(key);
    if (!state?.hasMore) return [...(state?.posts || [])];
    if (state.loading && state.ownerToken === session.accessToken) return [...state.posts];
    const offset = state.nextOffset;
    cloudProfileRepostLists.set(key, { ...state, loading: true, error: "" });
    try {
      const result = await cloudRequest(
        `/api/profiles/${encodeURIComponent(username)}/reposts?limit=${CLOUD_PROFILE_REPOST_PAGE_SIZE}&offset=${offset}`,
        { session },
      );
      ensureCurrentCloudSession(session);
      if (!Array.isArray(result.posts)) throw new Error("The online service returned an invalid repost list.");
      const page = result.posts.filter(post => !deletedCloudPostIds.has(post.id)).map(normalizeCloudPost);
      const current = cloudProfileRepostLists.get(key);
      if (!current || current.ownerToken !== session.accessToken) {
        throw new Error("Your signed-in account changed. Reload the profile to continue.");
      }
      const seen = new Set(current.posts.map(post => post.id));
      const nextState = {
        ...current,
        posts: [...current.posts, ...page.filter(post => !seen.has(post.id))],
        loaded: true,
        loading: false,
        error: "",
        hasMore: result.hasMore === true,
        nextOffset: Number.isSafeInteger(result.nextOffset) && result.nextOffset >= offset
          ? result.nextOffset
          : offset + result.posts.length,
      };
      cloudProfileRepostLists.set(key, nextState);
      return [...nextState.posts];
    } catch (error) {
      if (getCloudSession()?.accessToken === session.accessToken) {
        const current = cloudProfileRepostLists.get(key);
        if (current?.ownerToken === session.accessToken) {
          cloudProfileRepostLists.set(key, {
            ...current,
            loading: false,
            error: error.message || "More reposts could not be loaded.",
          });
        }
      }
      throw error;
    }
  },
  async refreshCloudFeed(surface = "main") {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    if (!["main", "following"].includes(surface)) throw new Error("Choose a valid feed.");
    if (cloudFeedLoading && cloudFeedOwnerToken === session.accessToken) return cloudFeed;
    if (cloudFeedSurface !== surface) {
      cloudFeed = [];
      cloudFeedLoaded = false;
      cloudFeedNextOffset = 0;
      cloudFeedHasMore = false;
    }
    cloudFeedSurface = surface;
    cloudFeedLoading = true;
    cloudFeedOwnerToken = session.accessToken;
    cloudFeedError = "";
    try {
      const result = await cloudRequest(
        `/api/feed?surface=${encodeURIComponent(surface)}&limit=${CLOUD_FEED_PAGE_SIZE}&offset=0`,
        { session },
      );
      ensureCurrentCloudSession(session);
      if (!Array.isArray(result.posts)) throw new Error("The online feed returned an invalid response.");
      const page = result.posts.filter(post => !deletedCloudPostIds.has(post.id)).map(normalizeCloudPost);
      cloudFeed = page;
      cloudFeedNextOffset = Number.isSafeInteger(result.nextOffset) && result.nextOffset >= 0
        ? result.nextOffset
        : result.posts.length;
      cloudFeedHasMore = typeof result.hasMore === "boolean"
        ? result.hasMore
        : result.posts.length === CLOUD_FEED_PAGE_SIZE;
      cloudFeedLoaded = true;
      void migrateLegacyCloudReposts(session);
      return [...cloudFeed];
    } catch (error) {
      if (getCloudSession()?.accessToken === session.accessToken) {
        cloudFeedError = error.message || "The online feed could not be loaded.";
      }
      throw error;
    } finally {
      if (cloudFeedOwnerToken === session.accessToken) {
        cloudFeedLoading = false;
        cloudFeedOwnerToken = null;
      }
    }
  },
  async loadMoreCloudFeed() {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    if (cloudFeedLoading && cloudFeedOwnerToken === session.accessToken) return [...cloudFeed];
    if (!cloudFeedHasMore) return [...cloudFeed];
    cloudFeedLoading = true;
    cloudFeedOwnerToken = session.accessToken;
    cloudFeedError = "";
    try {
      const result = await cloudRequest(
        `/api/feed?surface=${encodeURIComponent(cloudFeedSurface)}&limit=${CLOUD_FEED_PAGE_SIZE}&offset=${cloudFeedNextOffset}`,
        { session }
      );
      ensureCurrentCloudSession(session);
      if (!Array.isArray(result.posts)) throw new Error("The online feed returned an invalid response.");
      const page = result.posts.filter(post => !deletedCloudPostIds.has(post.id)).map(normalizeCloudPost);
      const seen = new Set(cloudFeed.map(post => post.id));
      cloudFeed = [...cloudFeed, ...page.filter(post => !seen.has(post.id))];
      cloudFeedNextOffset = Number.isSafeInteger(result.nextOffset) && result.nextOffset >= cloudFeedNextOffset
        ? result.nextOffset
        : cloudFeedNextOffset + result.posts.length;
      cloudFeedHasMore = typeof result.hasMore === "boolean"
        ? result.hasMore
        : result.posts.length === CLOUD_FEED_PAGE_SIZE;
      cloudFeedLoaded = true;
      void migrateLegacyCloudReposts(session);
      return [...cloudFeed];
    } catch (error) {
      if (getCloudSession()?.accessToken === session.accessToken) {
        cloudFeedError = error.message || "The online feed could not be loaded.";
      }
      throw error;
    } finally {
      if (cloudFeedOwnerToken === session.accessToken) {
        cloudFeedLoading = false;
        cloudFeedOwnerToken = null;
      }
    }
  },
  async refreshCloudCommunityFeed(following = false, { timeoutMs = CLOUD_FEED_REQUEST_TIMEOUT_MS } = {}) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    const surface = following ? "community-following" : "community";
    if (cloudCommunityFeedLoading && cloudCommunityFeedOwnerToken === session.accessToken) {
      return [...cloudCommunityFeed];
    }
    if (cloudCommunityFeedSurface !== surface) {
      cloudCommunityFeed = [];
      cloudCommunityFeedLoaded = false;
      cloudCommunityFeedNextOffset = 0;
      cloudCommunityFeedHasMore = false;
    }
    cloudCommunityFeedSurface = surface;
    cloudCommunityFeedLoading = true;
    cloudCommunityFeedOwnerToken = session.accessToken;
    cloudCommunityFeedError = "";
    try {
      const result = await cloudRequest(
        `/api/feed?surface=${surface}&limit=${CLOUD_FEED_PAGE_SIZE}&offset=0`,
        { session, timeoutMs },
      );
      ensureCurrentCloudSession(session);
      if (!Array.isArray(result.posts)) throw new Error("The online Community feed returned an invalid response.");
      cloudCommunityFeed = result.posts.filter(post => !deletedCloudPostIds.has(post.id)).map(normalizeCloudPost);
      cloudCommunityFeedNextOffset = Number.isSafeInteger(result.nextOffset) && result.nextOffset >= 0
        ? result.nextOffset : result.posts.length;
      cloudCommunityFeedHasMore = typeof result.hasMore === "boolean"
        ? result.hasMore : result.posts.length === CLOUD_FEED_PAGE_SIZE;
      cloudCommunityFeedLoaded = true;
      return [...cloudCommunityFeed];
    } catch (error) {
      if (getCloudSession()?.accessToken === session.accessToken) {
        cloudCommunityFeedError = error.message || "The online Community feed could not be loaded.";
      }
      throw error;
    } finally {
      if (cloudCommunityFeedOwnerToken === session.accessToken) {
        cloudCommunityFeedLoading = false;
        cloudCommunityFeedOwnerToken = null;
      }
    }
  },
  async loadMoreCloudCommunityFeed({ timeoutMs = CLOUD_FEED_REQUEST_TIMEOUT_MS } = {}) {
    const session = getCloudSession();
    if (!session?.accessToken) throw new Error("Sign in to an online account to continue.");
    if (!cloudCommunityFeedHasMore) return [...cloudCommunityFeed];
    if (cloudCommunityFeedLoading && cloudCommunityFeedOwnerToken === session.accessToken) {
      return [...cloudCommunityFeed];
    }
    cloudCommunityFeedLoading = true;
    cloudCommunityFeedOwnerToken = session.accessToken;
    cloudCommunityFeedError = "";
    try {
      const result = await cloudRequest(
        `/api/feed?surface=${cloudCommunityFeedSurface}&limit=${CLOUD_FEED_PAGE_SIZE}&offset=${cloudCommunityFeedNextOffset}`,
        { session, timeoutMs },
      );
      ensureCurrentCloudSession(session);
      if (!Array.isArray(result.posts)) throw new Error("The online Community feed returned an invalid response.");
      const page = result.posts.filter(post => !deletedCloudPostIds.has(post.id)).map(normalizeCloudPost);
      const seen = new Set(cloudCommunityFeed.map(post => post.id));
      cloudCommunityFeed = [...cloudCommunityFeed, ...page.filter(post => !seen.has(post.id))];
      cloudCommunityFeedNextOffset = Number.isSafeInteger(result.nextOffset) && result.nextOffset >= cloudCommunityFeedNextOffset
        ? result.nextOffset : cloudCommunityFeedNextOffset + result.posts.length;
      cloudCommunityFeedHasMore = typeof result.hasMore === "boolean"
        ? result.hasMore : result.posts.length === CLOUD_FEED_PAGE_SIZE;
      cloudCommunityFeedLoaded = true;
      return [...cloudCommunityFeed];
    } catch (error) {
      if (getCloudSession()?.accessToken === session.accessToken) {
        cloudCommunityFeedError = error.message || "More Community posts could not be loaded.";
      }
      throw error;
    } finally {
      if (cloudCommunityFeedOwnerToken === session.accessToken) {
        cloudCommunityFeedLoading = false;
        cloudCommunityFeedOwnerToken = null;
      }
    }
  },
  migrateCloudTextPosts({ retry = false } = {}) {
    const session = getCloudSession();
    const me = api.me();
    if (!session?.account?.id || !me) return Promise.reject(new Error("Sign in to an online account to migrate posts."));
    const ownPosts = db.posts.filter(post => post.author === me.id && !post.cloud);
    if (!retry && cloudPostMigration.accountId === session.account.id &&
      ((cloudPostMigration.done && ownPosts.length === 0) ||
        (Date.now() - Number(cloudPostMigration.lastAttemptAt || 0) < 60_000 &&
          cloudPostMigration.pending === ownPosts.length))) {
      return Promise.resolve({ ...cloudPostMigration });
    }
    if (cloudPostMigrationPromise) return cloudPostMigrationPromise;

    const eligible = ownPosts.filter(post => {
      const text = String(post.caption || "").trim();
      const media = Array.isArray(post.media) ? post.media.filter(Boolean) : [];
      const visibility = post.closeFriends === true ? "close-friends" : (post.visibility || "public");
      const interactions = prepareLegacyPostInteractions(post, me);
      const validMedia = media.length <= 10 && media.every(reference =>
        typeof reference === "string" && (
          /^oldtime-media:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference) ||
          /^data:(image|video)\//i.test(reference) ||
          /^blob:/i.test(reference)
        ));
      return ["text", "photo", "video", "carousel"].includes(post.kind) && !post.creativeProject && !post.sourceComment &&
        interactions.valid && validMedia &&
        ["public", "close-friends"].includes(visibility) &&
        typeof post.id === "string" &&
        post.id.length > 0 &&
        (text.length > 0 || media.length > 0) &&
        text.length <= 1000 &&
        Number.isSafeInteger(Number(post.created)) &&
        Number(post.created) >= 0 &&
        Number(post.created) <= 8640000000000000;
    });
    const migration = cloudPostMigration = {
      accountId: session.account.id,
      loading: true,
      done: false,
      error: "",
      confirmed: 0,
      pending: 0,
      unsupported: ownPosts.length - eligible.length,
      conflicts: 0,
      lastAttemptAt: Date.now()
    };
    const operation = Promise.resolve().then(async () => {
      try {
        const { migrateLocalMedia, putLocalMedia } = await import("./local-media.js");
        for (let offset = 0; offset < eligible.length; offset += 50) {
          const batch = eligible.slice(offset, offset + 50);
          const posts = [];
          for (const post of batch) {
            const media = Array.isArray(post.media) ? post.media.filter(Boolean) : [];
            const mediaIds = [];
            for (const reference of media) {
              if (reference.startsWith("oldtime-media:")) {
                await migrateLocalMedia(reference, me.id);
                mediaIds.push(reference.slice("oldtime-media:".length));
              } else {
                const response = await fetch(reference);
                if (!response.ok) throw new Error("A legacy post attachment could not be read for cloud transfer.");
                const blob = await response.blob();
                if (!blob.size) throw new Error("A legacy post attachment is empty; the original was kept.");
                const uploaded = await putLocalMedia(blob);
                const mediaId = /^oldtime-media:([0-9a-f-]{36})$/i.exec(uploaded)?.[1];
                if (!mediaId) throw new Error("The server did not confirm the legacy post attachment.");
                mediaIds.push(mediaId);
              }
            }
            const interactions = prepareLegacyPostInteractions(post, me);
            posts.push({
              sourceId: post.id,
              text: String(post.caption || "").trim(),
              visibility: post.closeFriends === true ? "close-friends" : (post.visibility || "public"),
              mediaIds,
              likedByMe: Array.isArray(post.likes) && post.likes.includes(me.id),
              savedByMe: (Array.isArray(post.saves) && post.saves.includes(me.id)) ||
                (Array.isArray(me.savedPostIds) && me.savedPostIds.includes(post.id)),
              comments: interactions.comments,
              legacyArchive: interactions.legacyArchive,
              createdAt: Number(post.created)
            });
          }
          const result = await cloudRequest("/api/posts/import", {
            session,
            method: "POST",
            body: { posts }
          });
          ensureCurrentCloudSession(session);
          if (!Array.isArray(result.results) || result.results.length !== batch.length) {
            throw new Error("The server did not confirm every post in the import batch.");
          }
          const outcomes = new Map(result.results.map(item => [item.sourceId, item]));
          if (outcomes.size !== batch.length || batch.some(post => !outcomes.has(post.id))) {
            throw new Error("The server returned an incomplete post import confirmation.");
          }
          const confirmedIds = [];
          const savedMappings = [];
          for (const post of batch) {
            const result = outcomes.get(post.id);
            const outcome = result.outcome;
            if (outcome === "imported" || outcome === "already-imported") {
              migration.confirmed++;
              confirmedIds.push(post.id);
              if (Array.isArray(post.saves) && post.saves.includes(me.id) ||
                Array.isArray(me.savedPostIds) && me.savedPostIds.includes(post.id)) {
                if (typeof result.postId !== "string" || !result.postId) {
                  throw new Error("The server did not confirm the saved post's online ID.");
                }
                savedMappings.push({ sourceId: post.id, postId: result.postId });
              }
            }
            else if (outcome === "conflict") migration.conflicts++;
            else throw new Error("The server returned an unknown post import status.");
          }
          if (confirmedIds.length) {
            const confirmed = new Set(confirmedIds);
            pruneVerifiedLegacyPosts(me.id, confirmedIds, savedMappings);
            mutate(state => {
              state.posts = state.posts.filter(post => !(post.author === me.id && confirmed.has(post.id)));
              const owner = state.users.find(user => user.id === me.id);
              if (owner && savedMappings.length) {
                const migratedSources = new Set(savedMappings.map(item => item.sourceId));
                owner.savedPostIds = [...new Set([
                  ...(Array.isArray(owner.savedPostIds) ? owner.savedPostIds : [])
                    .filter(id => !migratedSources.has(id)),
                  ...savedMappings.map(item => item.postId),
                ])].slice(0, 5000);
              }
            });
            if (savedMappings.length && cloudAccountStateOwnerToken === session.accessToken && cloudAccountStateValue) {
              const migratedSources = new Set(savedMappings.map(item => item.sourceId));
              cloudAccountStateValue = {
                ...cloudAccountStateValue,
                savedPostIds: [...new Set([
                  ...(Array.isArray(cloudAccountStateValue.savedPostIds) ? cloudAccountStateValue.savedPostIds : [])
                    .filter(id => !migratedSources.has(id)),
                  ...savedMappings.map(item => item.postId),
                ])].slice(0, 5000),
              };
              applyAccountStateToUser(cloudAccountStateValue, api.me(), session);
            }
            if (cloudAccountStateOwnerToken === session.accessToken && cloudAccountStateValue) {
              const archiveBySource = new Map(
                (Array.isArray(cloudAccountStateValue.legacyPostArchives)
                  ? cloudAccountStateValue.legacyPostArchives
                  : []).map(item => [item.sourcePostId, item]),
              );
              for (const post of batch) {
                if (!confirmed.has(post.id)) continue;
                const payload = posts.find(item => item.sourceId === post.id);
                const archive = payload?.legacyArchive;
                if (archive && (archive.legacyLikes.length || archive.legacySaves.length || archive.comments.length)) {
                  archiveBySource.set(post.id, { sourcePostId: post.id, ...archive });
                }
              }
              cloudAccountStateValue = {
                ...cloudAccountStateValue,
                ...(archiveBySource.size ? { legacyPostArchives: [...archiveBySource.values()] } : {}),
              };
            }
          }
        }
        migration.pending = ownPosts.length - migration.confirmed;
        migration.done = migration.pending === 0;
        return { ...migration };
      } catch (error) {
        migration.pending = ownPosts.length - migration.confirmed;
        migration.error = error.message || "Some posts could not be confirmed by the server.";
        throw error;
      } finally {
        migration.loading = false;
        if (cloudPostMigrationPromise === operation) cloudPostMigrationPromise = null;
      }
    });
    cloudPostMigrationPromise = operation;
    return operation;
  },
  async createCloudPost(text, sportsFields = {}) {
    const session = getCloudSession();
    const hadLoadedFeed = cloudFeedLoaded;
    const result = await cloudRequest("/api/posts", { session, method: "POST", body: { text, ...sportsFields } });
    ensureCurrentCloudSession(session);
    const post = normalizeCloudPost(result.post);
    cloudFeed = [post, ...cloudFeed.filter(item => item.id !== post.id)];
    if (["community", "both"].includes(post.destination)) {
      cloudCommunityFeed = [post, ...cloudCommunityFeed.filter(item => item.id !== post.id)];
    }
    if (hadLoadedFeed) cloudFeedNextOffset += 1;
    else {
      cloudFeedNextOffset = 1;
      cloudFeedHasMore = true;
    }
    cloudFeedLoaded = true;
    cloudFeedError = "";
    return post;
  },
  async setCloudLike(id, liked) {
    const session = getCloudSession();
    const path = `/api/posts/${encodeURIComponent(id)}/like`;
    const result = await cloudRequest(path, { session, method: liked ? "PUT" : "DELETE" });
    ensureCurrentCloudSession(session);
    forEachCloudPostCopy(id, post => {
      post.likeCount = result.likeCount;
      const me = api.me();
      post.likes = liked && me ? [me.id] : [];
      post.likedBy=(post.likedBy||[]).filter(person=>person.id!==me?.id);
      if(liked&&me)post.likedBy.unshift({id:me.id,displayName:me.name,avatarUrl:me.avatar||""});
    });
    return result;
  },
  async setCloudRepost(id, reposted, note = "") {
    const session = getCloudSession();
    const path = `/api/posts/${encodeURIComponent(id)}/repost`;
    const result = await cloudRequest(path, {
      session,
      method: reposted ? "PUT" : "DELETE",
      ...(reposted ? { body: { note: String(note || "").trim().slice(0, 140) } } : {}),
    });
    ensureCurrentCloudSession(session);
    if (typeof result.reposted !== "boolean" || !Number.isSafeInteger(result.repostCount) || result.repostCount < 0) {
      throw new Error("The online service returned an invalid repost update.");
    }
    forEachCloudPostCopy(id, post => {
      const me = api.me();
      post.repostedByMe = result.reposted;
      post.repostCount = result.repostCount;
      post.repostNote = result.reposted && typeof result.note === "string" ? result.note : "";
      post.reposts = result.reposted && me ? [me.id] : [];
      post.repostNotes = post.repostedByMe && me && post.repostNote ? { [me.id]: post.repostNote } : {};
    });
    const me = api.me();
    const post = api.cloudPost(id);
    const profileReposts = me && cloudProfileRepostLists.get(String(me.id));
    if (post && profileReposts?.loaded && profileReposts.ownerToken === session.accessToken) {
      profileReposts.posts = result.reposted
        ? [{ ...post }, ...profileReposts.posts.filter(item => item.id !== id)]
        : profileReposts.posts.filter(item => item.id !== id);
    }
    return result;
  },
  async deleteOwnPost(id) {
    const post = this.post(id);
    const ownerId = this.me()?.id;
    if (!post || !ownerId || post.author !== ownerId) throw new Error("You can only delete your own posts.");
    if (post.cloud) return this.deleteCloudPost(id);
    mutate(state => {
      state.posts = state.posts.filter(item => item.id !== id);
    });
  },
  async deleteOwnStory(id) {
    const story = cloudStories.find(item => item.id === id) || this.db().stories.find(item => item.id === id);
    const ownerId = this.me()?.id;
    if (!story || !ownerId || story.author !== ownerId) throw new Error("You can only delete your own Stories.");
    if (story.cloud) {
      const session = getCloudSession();
      await cloudRequest(`/api/stories/${encodeURIComponent(id)}`, { session, method: "DELETE" });
      ensureCurrentCloudSession(session);
      cloudStories = cloudStories.filter(item => item.id !== id);
      const mediaUrl = cloudStoryMedia.get(id);
      if (mediaUrl?.startsWith("blob:")) URL.revokeObjectURL(mediaUrl);
      cloudStoryMedia.delete(id);
      cloudStoryMediaExpiries.delete(id);
      return;
    }
    mutate(state => {
      state.stories = state.stories.filter(item => item.id !== id);
    });
  },
  async saveStory(id, savedToProfile) {
    const story = cloudStories.find(item => item.id === id) || this.db().stories.find(item => item.id === id);
    if (!story || story.author !== this.me()?.id) throw new Error("You can only save your own Stories.");
    if (story.cloud) return this.saveCloudStory(id, savedToProfile);
    throw new Error("This Story is stored on this device only. Publish it online before saving it to your profile.");
  },
  async deleteCloudPost(id) {
    const session = getCloudSession();
    const post = this.cloudPost(id);
    const ownerId = this.me()?.id;
    if (!post || post.author !== ownerId) throw new Error("You can only delete your own online posts.");
    await cloudRequest(`/api/posts/${encodeURIComponent(id)}`, { session, method: "DELETE" });
    ensureCurrentCloudSession(session);
    deletedCloudPostIds.add(id);
    cloudFeed = cloudFeed.filter(item => item.id !== id);
    cloudCommunityFeed = cloudCommunityFeed.filter(item => item.id !== id);
    cloudFeedNextOffset = Math.max(0, cloudFeedNextOffset - 1);
    // Remove an imported original only after the server confirms deletion,
    // otherwise the automatic legacy importer would publish it again.
    if (post.sourceId) {
      mutate(state => {
        state.posts = state.posts.filter(item => !(item.id === post.sourceId && item.author === ownerId));
      });
    }
  },
  reset: () => { clearCloudSession(); db = seed(); persist(); },
  async signup(form) {
    const username = (form.username || "").toLowerCase();
    const email = (form.email || "").trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error("Username must be 3–24 lowercase letters, numbers, or _");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a real email");
    if (!form.password || form.password.length < 8) throw new Error("Password needs at least 8 characters");
    const version = ++authOperationVersion;
    const auth = await authRequest("register", {
      email,
      username,
      displayName: String(form.name || username).trim().slice(0, 60) || username,
      password: form.password
    });
    ensureCurrentAuthOperation(version, auth);
    saveCloudAccount(auth);
    return "cloud";
  },
  changePassword(currentPassword, newPassword) {
    const session = getCloudSession();
    if (!session?.accessToken) {
      return Promise.reject(new Error("Sign in to an online account to change its password."));
    }
    return authRequest("password", { currentPassword, newPassword }, session.accessToken);
  },
  login(identifier, password) { return loginAccount(identifier, password); },
  logout() { clearCloudSession(); mutate(db => { db.session = null; }); },
  emailInUse(email, exceptId = null) {
    const normalized = String(email || "").trim().toLowerCase();
    return db.users.some(user => typeof user.email === "string" &&
      user.email.trim().toLowerCase() === normalized && user.id !== exceptId);
  },
  blocked(a, b) {
    if (db.blocks.some(x => (x.by === a && x.who === b) || (x.by === b && x.who === a))) return true;
    const current = this.me()?.id;
    const session = getCloudSession();
    if (!current || !session?.account?.id || (a !== current && b !== current)) return false;
    const other = a === current ? b : a;
    const remoteId = other === current ? session.account.id : this.user(other)?.cloudAccountId || other;
    return cloudBlocks.includes(remoteId);
  },
  areFriends(a, b) {
    const first = this.user(a);
    const second = this.user(b);
    const current = this.me();
    const session = getCloudSession();
    if (session?.accessToken && current && (a === current.id || b === current.id) && this.cloudRelationshipsLoaded()) {
      const otherId = a === current.id ? b : a;
      const other = this.user(otherId);
      const remoteId = other?.cloudAccountId || otherId;
      return cloudRelationships.friends.includes(remoteId);
    }
    return Boolean(first && second &&
      Array.isArray(first.friends) && first.friends.includes(second.id) &&
      Array.isArray(second.friends) && second.friends.includes(first.id));
  },
  isCloseFriend(authorId, viewerId) {
    const author = this.user(authorId);
    return Boolean(author && viewerId && this.areFriends(authorId, viewerId) && !this.blocked(authorId, viewerId) &&
      Array.isArray(author.closeFriends) && author.closeFriends.includes(viewerId));
  },
  canSee(authorId, viewerId = this.me()?.id) {
    const me = viewerId ? this.user(viewerId) : null;
    const author = this.user(authorId);
    if (!author) return false;
    if (me && this.blocked(me.id, author.id)) return false;
    if (author.private && author.id !== me?.id &&
      !author.followers.includes(me?.id) &&
      !this.areFriends(author.id, me?.id) &&
      !this.isCloseFriend(author.id, me?.id)) return false;
    return true;
  },
  canSeePost(post, viewerId = this.me()?.id, lineage = new Set()) {
    if (!post || !this.canSee(post.author, viewerId)) return false;
    if (lineage.has(post.id) || lineage.size > 16) return false;
    lineage.add(post.id);
    for (const id of new Set([post.remixOf, post.audioSourcePostId].filter(Boolean))) {
      const original = this.post(id);
      if (!original || !this.canSeePost(original, viewerId, new Set(lineage))) return false;
    }
    const sources = [...projectSources(post.creativeProject),
      ...(post.sourceComment ? [{ postId: post.sourceComment.post, commentId: post.sourceComment.comment }] : [])];
    for (const source of sources) {
      const original = this.post(source.postId);
      const comment = original?.comments?.flatMap(item => [item, ...(item.replies || [])]).find(item => item.id === source.commentId);
      if (!original || !comment || (source.commentAuthorId && comment.author !== source.commentAuthorId) ||
        this.blocked(comment.author, viewerId) || !this.canSeePost(original, viewerId, new Set(lineage))) return false;
    }
    const me = viewerId ? this.user(viewerId) : null;
    const author = this.user(post.author);
    const visibility = post.closeFriends === true ? "close-friends" : (post.visibility || "public");
    if (me?.id === author.id || visibility === "public") return true;
    if (visibility === "followers") return author.followers.includes(me?.id);
    if (visibility === "friends") return this.areFriends(author.id, me?.id);
    if (visibility === "closeFriends" || visibility === "close-friends") return this.isCloseFriend(author.id, me?.id);
    return false;
  },
  canSeeStory(story) {
    if (!story) return false;
    if (story.cloud) {
      return Boolean(story.serverVisible && (story.savedToProfile || Number(story.expiresAt) > Date.now()));
    }
    if (!this.canSee(story.author)) return false;
    if ((story.creativeProject || story.sourceComment) && !this.canSeePost(story)) return false;
    const me = this.me();
    const author = this.user(story.author);
    if (!author) return false;
    if (author.id === me?.id) return true;
    const visibility = String(story.visibility || story.audience || "")
      .toLowerCase()
      .replace(/_/g, "-");
    if (visibility === "close-friends" || visibility === "closefriends" || story.closeFriends === true) {
      return this.isCloseFriend(author.id, me?.id);
    }
    if (visibility === "friends") {
      return this.areFriends(author.id, me?.id);
    }
    if (visibility === "followers") {
      return Boolean(me && author.followers.includes(me.id));
    }
    return true;
  },
  posts() {
    const posts = getCloudSession()
      ? [...new Map([...cloudFeed, ...cloudCommunityFeed].map(post => [post.id, post])).values()]
      : mergeFeedPosts(db.posts, cloudFeed);
    return posts.filter(p => this.canSeePost(p));
  },
  ranked(mode) {
    const me = this.me();
    if (getCloudSession()) {
      const source = mode === "community" || mode === "community-following"
        ? cloudCommunityFeed
        : cloudFeed;
      const list = source.filter(post => this.canSeePost(post));
      if (mode === "following" && cloudFeedSurface !== "following") return followingPosts(list, me);
      return list;
    }
    let list = this.posts();
    if (mode === "following") list = followingPosts(list, me);
    return list.sort((a, b) => score(b, me) - score(a, me));
  }
};
function score(p, me) {
  const completion = p.watch || 0.35;
  const fresh = Math.max(0, 1 - (Date.now() - p.created) / 864e5);
  const interest = (p.tags || []).reduce((n, t) => n + ((me && db.interests[t]) || 0), 0);
  const small = (p.views || 0) < 3000 ? 0.35 : 0;
  return completion * 5 + (p.replays || 0) * 3 + (p.shares || 0) * 2 + p.saves.length * 2 + p.comments.length * 1.4 + p.likes.length + fresh + interest + small;
}
export function mutate(fn) {
  const before = structuredClone(db);
  const session = getCloudSession();
  const user = api.me();
  const beforeCloudState = session?.accessToken && user &&
    cloudAccountStateOwnerToken === session.accessToken && cloudAccountStateValue !== null
    ? cloudOwnedContentState(user, session) : null;
  try { fn(db); enforceCloseFriends(db); persist(); }
  catch (error) { db = before; throw error; }
  if (beforeCloudState && getCloudSession()?.accessToken === session.accessToken) {
    const updatedUser = api.me();
    const afterCloudState = cloudOwnedContentState(updatedUser, session);
    if (stableAccountState(beforeCloudState) !== stableAccountState(afterCloudState)) {
      void api.updateCloudAccountState(afterCloudState).catch(error => {
        window.dispatchEvent(new CustomEvent("oldtime-account-state-error", {
          detail: { message: error?.message || "Saved account data could not be synchronized." },
        }));
      });
    }
  }
}
export function profileEmailValidationMessage(value, currentValue, emailInUse) {
  const email = String(value || "").trim().toLowerCase();
  const currentEmail = String(currentValue || "").trim().toLowerCase();
  if (!email || email === currentEmail) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email";
  if (emailInUse(email)) return "Email already registered";
  return "";
}
export function notify(db, note) {
  if (db.users.find(u => u.id === note.user)?.notifs === false || api.blocked(note.user, note.actor)) return;
  db.notes.unshift(note);
}
export function fileToData(file) {
  if (!file || file.size > 2 * 1024 * 1024) return Promise.reject(new Error("Files must be 2 MB or smaller."));
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res({ url: r.result, video: file.type.startsWith("video"), name: file.name });
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
if (typeof window !== "undefined") window.addEventListener("storage", e => {
  if (e.key !== KEY || getCloudSession()) return;
  db = load();
  window.dispatchEvent(new Event("oldtime-data"));
});
