import "./like-motion.js";
import { openTournaments, closeTournaments } from "./tournaments.js";
import { getTournamentNotifications, markTournamentNotificationRead, getTournamentNotificationPreferences, updateTournamentNotificationPreferences } from "./tournaments-api.js";
import { tournamentLink, tournamentLinkMarkup, tournamentReferenceCard } from "./tournament-links.js";
import { interestContext } from "./interests.js";
import "./styles.css";
import "./gold-save.css";
import { openProfileImageCropper } from "./profile-image-cropper.js";
import "./profile-image-cropper.css";
import { bindSectionSwipes } from "./section-swipes.js";
import "./post-detail.css";
import { isCommunitySurfacePost, isFeedHomePost, isProfileSurfacePost } from "./post-surfaces.js";
import "./service-worker-registration.js";
import { mountStoryInteractions } from "./story-interactions.js";
import "./story-interactions.css";
import { isStoryActive } from "./story-lifecycle.js";
import { resolveStoryMedia } from "./story-media.js";
import { api, mutate, notify, profileEmailValidationMessage, requestCloudApi } from "./store.js";
import { accountNotifications, notificationState, loadAccountNotifications, readAccountNotifications } from "./notifications-api.js";
import { subscribeNotificationUpdates } from "./comms/signaling.js";
import { createMigrationRunner } from "./migration-runner.js";
import { openCloudComments } from "./cloud-comments.js";
import { ensureConvo as makeConvo, openChatList, openThread, closeChatTimers } from "./chat.js";
import { mountComms, closeVoiceNote } from "./comms/index.js";
import { icons as ic, icon } from "./icons.js";
import { openEmojiPicker, closeEmojiPicker } from "./emoji.js";
import { extraScreen, settingGroups } from "./experiences.js";
import { isBlastGuidanceSafe } from "./blast.js";
import { openSocialSheet } from "./social-sheets-controller.js";
import { openRepostNote } from "./repost-note.js";
import { findSharedComment } from "./shared-content.js";
import { listSavedCollections, listSavedPosts } from "./saved-collections.js";
import { openAudioPanel } from "./audio-panel.js";
import { audioTitle, audioUses } from "./audio-library.js";
import { isLocalMedia, renderMediaUrl, hydrateLocalMedia, observeCloudMedia, mediaUrl, putLocalMedia, deleteLocalMedia } from "./local-media.js";
import { finishStartup } from "./startup.js";
import { loginMarkup, signupMarkup } from "./auth-design.js";
import { completeCognitoSignIn, mountCognitoAction, beginCognitoSignIn, logoutAccount } from "./cognito-auth.js";
import "./brand-selection.css";
import { openCreativeEditor } from "./creative-editor.js";
import { SPORTS_MODE_ENABLED } from "../../../lib/sports/feature-state.js";
import { openGetOnBoard, closeGetOnBoard, initGetOnBoard, detectBoardLink } from "./get-on-board.js";
import { boardReferenceCard } from "./board-reference-card.js";
import { creativeMediaMarkup, creativeAttribution, mountCreativeViewers } from "./creative-viewer.js";
import { CREATOR_TOOL_ROUTES, renderCreatorScreen, resetCreatorScreenState, blueBadgeMarkup, hydrateBlueBadges } from "./creator-center.js";
import { ACCOUNT_TOOL_ROUTES,getAccountTools,loadAccountTools,resetAccountTools,renderAccountToolsScreen } from "./account-professional.js";
import { registerOwnActivityContent,trackQualifiedView,recordActivity,recordProfileVisit } from "./activity-tracking.js";
import { scheduleCreatorAnnouncement, resetCreatorAnnouncements, showHelpfulWalkthrough } from "./creator-announcement.js";
import { renderGuideLibrary, bindGuideLibrary } from "./guide-library.js";
import { renderPostLikesRow } from "./post-likes-row.js";
import "./post-likes-row.css";
import { getRepostView } from "./repost-state.js";
import { renderRepostAffordance, mountRepostAffordances } from "./repost-affordance.js";
import "./flat-surfaces.css";
import "./button-palette.css";
import { AVATAR_CHOICES, avatarImage, automaticAvatar } from "./profile-avatars.js";
import "./profile-avatars.css";
import "./compact-interface.css";
import { openCreationHub } from "./creation-hub.js";
import "./profile-presentations.css";

const $ = (s, r = document) => r.querySelector(s);
const app = $("#app");
observeCloudMedia(document.body);
const brandArtUrl = `${import.meta.env.BASE_URL}brand/oldtime-login-red.png`;
let floatingVideoCleanup = null;
app.addEventListener("error", event => {
  const media = event.target;
  if (isLocalMedia(media.getAttribute?.("src"))) {
    void hydrateLocalMedia(media);
    return;
  }
  if (media.dataset?.localMedia) return; // The cloud loader owns retry/access errors.
  if (media.tagName === "IMG" && !media.dataset.fallback) {
    media.dataset.fallback = "true";
    media.src = new URL("./avatar.svg", import.meta.url).href;
  }
  if ((media.tagName === "VIDEO" || media.classList?.contains("fullimg")) && media.closest(".clip") && !media.parentElement.querySelector(".media-fallback")) {
    const notice = document.createElement("div");
    notice.className = "media-fallback";
    const message = document.createElement("span");
    message.textContent = media.error?.code === 4 ? "This browser could not play this media."
      : media.error?.code === 3 ? "This media could not be decoded." : "Media could not load.";
    const retry = document.createElement("button");
    retry.type = "button"; retry.textContent = "Retry";
    retry.onclick = event => {
      event.preventDefault(); event.stopPropagation();
      notice.remove();
      if (media.tagName === "VIDEO") {
        media.load();
        void media.play().catch(() => {});
      } else {
        media.dataset.fallback = "";
        media.src = media.currentSrc || media.src;
      }
    };
    notice.append(message, retry);
    media.addEventListener("loadeddata", () => notice.remove(), { once: true });
    media.parentElement.appendChild(notice);
  }
}, true);
app.addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target.closest("[data-video-float]") : null;
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  detachFeedVideo(target.dataset.videoFloat);
});
let tab = "updates";
let creatorSessionAccount = null;
let homeView = "explore";
let homeTopic = "all";
let communityView = "for-you";
let nearbyCity = "all";
let nearbyLocationStatus = "idle";
let nearbyLocationRequestId = 0;
let profileId = null;
let profileMode = "posts";
let savedCollectionId = "";
let storyTimer = null, storyUi = null;
let createKind = "photo";
let pending = [];
let chatId = null;
let profileReturnChatId = null;
let searchQ = "";
let peopleSearch = { query: "", status: "idle", profiles: [], error: "" };
let peopleSearchTimer = null;
let peopleSearchRequestId = 0;
let carouselIndex = {};
let expandedCaptions = {};
let muted = true;
let viewer = null;
let profileMore = false;
let settingsView = "home";
const legacyMigrationRunner = createMigrationRunner({
  currentOwner: () => api.cloudAccountId(),
  run: () => migrateLegacyAccountDataInBackground(),
});
window.addEventListener("online", () => {
  if (api.me()) legacyMigrationRunner.request(api.cloudAccountId(), { retry: true });
});
let hasPendingSettingsChanges = false;
let selectedCampaignId = null;
let feedObserver = null;
let feedPageObserver = null;
let homeFeedMorePending = false;
let cameraStream = null;
let cameraFacing = "environment";
let cameraMode = "post";
let cameraGeneration = 0;
let cameraFlashOn = false;
let notificationsOrigin = null;
let notificationsReturnStack = [];
let notificationFilter = "all";
let notificationUpdateTimer = null;
subscribeNotificationUpdates(() => {
  clearTimeout(notificationUpdateTimer);
  const owner = api.cloudAccountId();
  notificationUpdateTimer = setTimeout(() => {
    if (!owner || owner !== api.cloudAccountId()) return;
    void Promise.all([
      loadAccountNotifications({ force: true }),
      api.refreshCloudRelationships({ force: true }),
    ]).then(() => { if (owner === api.cloudAccountId()) render(); })
      .catch(() => { if (tab === "notes") render(); });
  }, 150);
});
const navigationStack = [];
const watchedPosts = new Set();
let drawerEscapeHandler = null;
let drawerReturnFocus = null;

const HOME_VIEWS = [
  { id: "nearby", label: "Places" },
  { id: "following", label: "Following" }
];
const HOME_TOPICS = [
  { id: "all", label: "For You" },
  { id: "interests", label: "Interests" },
  { id: "world", label: "Around the World" },
  { id: "culture", label: "Culture" },
  { id: "comedy", label: "Comedy" },
  { id: "fashion", label: "Fashion" },
  { id: "food", label: "Food" },
  { id: "travel", label: "Travel" },
  { id: "music", label: "Music" },
  { id: "beauty", label: "Beauty" },
  { id: "art", label: "Art & Design" },
  { id: "pets", label: "Pets" },
  { id: "gaming", label: "Gaming" },
  { id: "learning", label: "Learning" }
];
const PROFILE_INTERESTS = [
  { id: "fitness", label: "Fitness" },
  { id: "running", label: "Running" },
  { id: "basketball", label: "Basketball" },
  { id: "yoga", label: "Yoga" },
  { id: "college", label: "College life" },
  { id: "nursing", label: "Nursing" },
  { id: "cybersecurity", label: "Cybersecurity" },
  { id: "study-groups", label: "Study groups" },
  { id: "gaming", label: "Gaming" },
  { id: "cars", label: "Cars" },
  { id: "music", label: "Music" },
  { id: "photography", label: "Photography" },
  { id: "fashion", label: "Fashion" },
  { id: "food", label: "Food" },
  { id: "tech", label: "Tech" },
  { id: "travel", label: "Travel" },
  { id: "art", label: "Art & design" },
  { id: "pets", label: "Pets" },
  { id: "beauty", label: "Beauty" }
];
const profileInterestName = id => PROFILE_INTERESTS.find(interest => interest.id === id)?.label || id;
const cityMatchKey = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase();
const HOME_TOPIC_TERMS = {
  world: ["world", "global", "international", "country", "culture", "language", "travel", "heritage"],
  culture: ["culture", "history", "language", "tradition", "festival", "heritage", "community"],
  comedy: ["comedy", "funny", "humor", "humour", "meme", "joke", "laugh", "prank", "standup", "parody"],
  fashion: ["fashion", "style", "outfit", "fit check", "fitcheck", "streetwear", "wardrobe", "clothes"],
  food: ["food", "recipe", "cook", "cooking", "meal", "restaurant", "cafe", "coffee", "noodles", "brunch", "baking"],
  travel: ["travel", "trip", "roadtrip", "road trip", "coast", "tourism", "vacation", "destination", "landscape"],
  music: ["music", "song", "singer", "band", "concert", "dance", "audio", "chorus"],
  beauty: ["beauty", "makeup", "skincare", "hair", "nails"],
  sports: ["sport", "sports", "fitness", "workout", "running", "soccer", "football", "basketball"],
  art: ["art", "design", "drawing", "illustration", "photography", "craft", "creative"],
  pets: ["pet", "pets", "dog", "cat", "animal", "puppy", "kitten"],
  gaming: ["game", "gaming", "gamer", "console", "esports"],
  learning: ["learn", "lesson", "tutorial", "education", "study", "skill"]
};
const PROFILE_INTEREST_TERMS = {
  fitness: ["fitness", "workout", "gym", "exercise"],
  running: ["running", "run", "runner"],
  basketball: ["basketball", "hoops", "nba"],
  yoga: ["yoga"],
  college: ["college", "campus", "university", "school"],
  nursing: ["nursing", "nurse"],
  cybersecurity: ["cybersecurity", "cyber security", "infosec"],
  "study-groups": ["study group", "study", "learning", "learn"],
  gaming: ["gaming", "game", "gamer"],
  cars: ["cars", "car", "drive", "driving", "automotive"],
  music: ["music", "song", "singer", "band", "concert"],
  photography: ["photography", "photo", "camera"],
  fashion: ["fashion", "style", "outfit"],
  food: ["food", "recipe", "cooking", "restaurant", "cafe"],
  tech: ["tech", "technology", "software", "gadgets"],
  travel: ["travel", "trip", "roadtrip", "vacation"],
  art: ["art", "design", "drawing", "illustration"],
  pets: ["pets", "pet", "dog", "cat", "animal"],
  beauty: ["beauty", "makeup", "skincare", "hair"]
};
const DISCOVERY_AREAS = [
  { name: "Miami", lat: 25.7617, lon: -80.1918 },
  { name: "New York", lat: 40.7128, lon: -74.006 },
  { name: "Los Angeles", lat: 34.0522, lon: -118.2437 },
  { name: "Chicago", lat: 41.8781, lon: -87.6298 }
];

const esc = (s = "") => String(s).replace(/&/g, "&" + "amp;").replace(/</g, "&" + "lt;").replace(/>/g, "&" + "gt;").replace(/"/g, "&" + "quot;");
const fmt = (n) => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n || 0);
const ago = (t) => { const s = Math.max(1, (Date.now() - (t || Date.now())) / 1000); if (s < 60) return "now"; if (s < 3600) return Math.floor(s / 60) + "m"; if (s < 86400) return Math.floor(s / 3600) + "h"; return Math.floor(s / 86400) + "d"; };
const videoFloatIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"></rect><path d="M13 13h6v5h-6z"></path></svg>';
const normalizeFeedText = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function detachFeedVideo(postId) {
  if (floatingVideoCleanup) floatingVideoCleanup();
  const video = [...app.querySelectorAll(".clip video[data-id]")].find(item => item.dataset.id === postId);
  if (!video) { toast("This video is no longer available in the feed."); return; }

  const placeholder = document.createElement("span");
  placeholder.className = "video-float-placeholder";
  video.before(placeholder);
  feedObserver?.unobserve(video);

  const originalControls = video.controls;
  const floating = document.createElement("section");
  floating.className = "ot-video-float";
  floating.setAttribute("role", "region");
  floating.setAttribute("aria-label", "Floating video player");
  floating.dataset.testid = "floating-video-player";
  floating.innerHTML = `
    <div class="ot-video-float-controls">
      <button type="button" class="ot-video-float-button" data-video-expand aria-label="Expand video" title="Expand video">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M3 3l7 7M16 21h5v-5m0 5-7-7"></path></svg>
      </button>
      <button type="button" class="ot-video-float-button" data-video-close aria-label="Close floating video" title="Close video">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg>
      </button>
    </div>
    <button type="button" class="ot-video-float-button ot-video-float-play" data-video-play aria-label="Pause video" title="Pause video">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"></path></svg>
    </button>`;
  video.classList.add("ot-video-float-media");
  video.controls = true;
  floating.append(video);
  document.body.append(floating);
  video.play().catch(() => {});

  let expanded = false;
  const expand = floating.querySelector("[data-video-expand]");
  const close = floating.querySelector("[data-video-close]");
  const play = floating.querySelector("[data-video-play]");
  const renderExpandIcon = () => {
    expand.classList.toggle("is-expanded", expanded);
    expand.setAttribute("aria-label", expanded ? "Minimize video" : "Expand video");
    expand.title = expanded ? "Minimize video" : "Expand video";
    expand.innerHTML = expanded
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v5H3m0-5 7 7M16 21v-5h5m0 5-7-7"></path></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M3 3l7 7M16 21h5v-5m0 5-7-7"></path></svg>';
  };
  const onKey = event => {
    if (event.key === "Escape" && expanded) {
      expanded = false;
      floating.classList.remove("is-expanded");
      renderExpandIcon();
    }
  };
  const restore = () => {
    document.removeEventListener("keydown", onKey);
    video.pause();
    video.controls = originalControls;
    video.classList.remove("ot-video-float-media");
    if (placeholder.isConnected) placeholder.replaceWith(video);
    else video.remove();
    floating.remove();
    floatingVideoCleanup = null;
    if (tab === "updates" && $("#feed")) observeVideos();
  };
  expand.onclick = () => {
    expanded = !expanded;
    floating.classList.toggle("is-expanded", expanded);
    renderExpandIcon();
  };
  close.onclick = restore;
  play.onclick = () => {
    if (video.paused) {
      video.play().catch(() => {});
      play.setAttribute("aria-label", "Pause video");
      play.title = "Pause video";
      play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"></path></svg>';
    } else {
      video.pause();
      play.setAttribute("aria-label", "Play video");
      play.title = "Play video";
      play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 12 7-12 7z"></path></svg>';
    }
  };
  document.addEventListener("keydown", onKey);
  floatingVideoCleanup = restore;
}

function homePosts() {
  const me = api.me();
  if (api.authMode() === "cloud") {
    const wantedSurface = homeView === "following" ? "following" : "main";
    const status = api.cloudFeedStatus();
    if (!status.loading && !status.error && (!status.loaded || status.surface !== wantedSurface)) {
      void api.refreshCloudFeed(wantedSurface).then(() => {
        if (tab === "updates" && settingsView === "home") render();
      }).catch(() => {
        if (tab === "updates" && settingsView === "home") render();
      });
    }
  }
  let posts = api.ranked(homeView === "following" ? "following" : "foryou")
    .filter(isFeedHomePost);
  if (homeView === "nearby") {
    const city = nearbyCity === "all" ? "" : normalizeFeedText(nearbyCity || me?.city);
    posts = city ? posts.filter(post => {
      const location = normalizeFeedText(post.location || api.user(post.author)?.city);
      return location === city || location.startsWith(`${city} `);
    }) : posts;
  }
  if (homeTopic === "interests") {
    const selected = new Set(Array.isArray(me?.interests) ? me.interests : []);
    const terms = [...selected]
      .flatMap(id => PROFILE_INTEREST_TERMS[id] || [id])
      .map(normalizeFeedText)
      .filter(Boolean);
    posts = terms.length ? posts.filter(post => {
      const text = ` ${normalizeFeedText([post.caption, post.sound, ...(post.tags || [])].join(" "))} `;
      return terms.some(term => text.includes(` ${term} `));
    }) : [];
  } else if (homeTopic !== "all") {
    const terms = HOME_TOPIC_TERMS[homeTopic] || [];
    posts = posts.filter(post => {
      const text = ` ${normalizeFeedText([post.caption, post.sound, ...(post.tags || [])].join(" "))} `;
      return terms.some(term => text.includes(` ${normalizeFeedText(term)} `));
    });
  }
  return posts;
}

function nearbyAreas() {
  const counts = new Map();
  api.posts().filter(isFeedHomePost).forEach(post => {
    const rawLocation = postPlaceValue(post);
    const normalized = normalizeFeedText(rawLocation);
    if (!normalized) return;
    const curated = DISCOVERY_AREAS.find(area => {
      const key = normalizeFeedText(area.name);
      return normalized === key || normalized.startsWith(`${key} `);
    });
    const name = curated?.name || String(rawLocation).trim();
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => {
    const ai = DISCOVERY_AREAS.findIndex(area => area.name === a.name);
    const bi = DISCOVERY_AREAS.findIndex(area => area.name === b.name);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.name.localeCompare(b.name);
  });
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const radians = degrees => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function requestNearbyLocation() {
  if (nearbyLocationStatus === "requesting") return;
  if (!navigator.geolocation) {
    nearbyLocationStatus = "unavailable";
    render();
    toast("Location isn’t available. Browse the areas below.");
    return;
  }
  const requestId = ++nearbyLocationRequestId;
  nearbyLocationStatus = "requesting";
  render();
  try {
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (requestId !== nearbyLocationRequestId) return;
      const closest = DISCOVERY_AREAS.map(area => ({
        ...area,
        distance: distanceKm(coords.latitude, coords.longitude, area.lat, area.lon)
      })).sort((a, b) => a.distance - b.distance)[0];
      if (closest?.distance <= 100) {
        nearbyCity = closest.name;
        nearbyLocationStatus = "located";
        toast(`Showing posts near ${closest.name}`);
      } else {
        nearbyCity = "all";
        nearbyLocationStatus = "available";
        toast("No nearby area yet. Explore the available areas below.");
      }
      render();
    }, error => {
      if (requestId !== nearbyLocationRequestId) return;
      nearbyCity = "all";
      nearbyLocationStatus = error?.code === 1 ? "denied" : "unavailable";
      render();
      toast("Location off. Browse the available areas below.");
    }, { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 });
  } catch {
    if (requestId !== nearbyLocationRequestId) return;
    nearbyLocationStatus = "unavailable";
    nearbyCity = "all";
    render();
    toast("Location isn’t available. Browse the areas below.");
  }
}

function homeEmptyMessage(me) {
  const topic = HOME_TOPICS.find(item => item.id === homeTopic)?.label;
  if (homeView === "nearby" && nearbyCity !== "all") return `No photos or videos near ${nearbyCity || me.city} yet. Try another area.`;
  if (homeTopic === "interests" && !me.interests?.length) return "Choose interests to find posts about the things you care about.";
  if (homeTopic !== "all") {
    const scope = homeView === "nearby" ? `near ${nearbyCity === "all" ? "these areas" : nearbyCity}` : homeView === "following" ? "from people you follow" : "in Explore";
    return `No ${topic?.toLowerCase() || "topic"} posts ${scope} yet. Try another topic.`;
  }
  if (homeView === "nearby") return "No nearby photos or videos yet. Choose another area or explore everything.";
  if (homeView === "following") return "Photos and videos from people you follow will appear here.";
  return "No photos or videos to show yet.";
}

function copyText(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  let copied = false;
  try { copied = document.execCommand("copy"); } catch { copied = false; }
  ta.remove();
  return copied;
}
async function copyShareLink(url) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch {}
  return copyText(url);
}
async function shareExternally({ title, text, url }) {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
    }
  }
  return await copyShareLink(url) ? "copied" : "failed";
}
function toast(msg) {
  const t = $(".toast"); if (!t) return;
  t.textContent = msg; t.style.display = "block";
  clearTimeout(toast._t); toast._t = setTimeout(() => t.style.display = "none", 1600);
}
function shell(inner, mode, { hideNav = false } = {}) {
  storyUi?.dispose(); storyUi = null;
  mountRepostAffordances(null);
  resetCreatorAnnouncements();
  closeEmojiPicker();
  const conversation = $("#msgs")?.dataset.convo;
  closeVoiceNote(!conversation || !inner.includes(`data-convo="${conversation}"`));
  closeChatTimers();
  clearInterval(storyTimer);
  feedObserver?.disconnect();
  const light = mode === "light";
  const communitiesScreen = inner.includes("community-screen");
  const profileScreen = inner.includes("profile-screen");
  const mediaFeedScreen = inner.includes("home-screen") || inner.includes('<div class="feed">');
  const blastWorkspace = inner.includes('class="blast-x-workspace"');
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mediaFeedScreen ? "#090a0c" : "#ffffff");
  const me = api.me();
  app.innerHTML = `<div class="stage"><div class="phone ${light ? "light" : ""} ${communitiesScreen ? "stories-phone" : ""} ${mediaFeedScreen ? "media-feed-phone" : ""} ${blastWorkspace ? "blast-wide-phone" : ""}">
    ${inner}
    <nav class="nav ${light ? "lightnav" : ""} ${profileScreen ? "profile-nav" : ""} ${hideNav ? "nav-hidden" : ""}" aria-label="Primary navigation">
      <button type="button" data-tab="updates" class="${tab === "updates" && !profileId ? "on" : ""}" aria-label="Home">${ic.home}<span>Home</span></button>
      <button type="button" data-tab="communities" class="${tab === "communities" ? "on" : ""}" aria-label="Community" data-testid="button-nav-community">${ic.users}<span>Community</span></button>
      <button type="button" data-tab="search" class="${tab === "search" ? "on" : ""}" aria-label="Search" data-testid="button-nav-search">${ic.search}<span>Search</span></button>
      <button type="button" data-tab="chat" class="${tab === "chat" ? "on" : ""}" aria-label="Chat">${ic.comment}<span>Chat</span></button>
      <button type="button" data-tab="profile" class="${tab === "updates" && profileId === me.id ? "on" : ""}" aria-label="Profile">${ic.user}<span>Profile</span></button>
    </nav>
    <div class="app-drawer" id="app-drawer" hidden aria-hidden="true">
      <button class="drawer-scrim" id="drawer-scrim" type="button" aria-label="Close menu"></button>
      <aside class="drawer-panel" role="dialog" aria-modal="true" aria-label="Oldtime navigation">
        <header class="drawer-header">
          <button type="button" class="drawer-account" data-drawer-route="profile" data-testid="button-drawer-profile">
            <img src="${esc(me.avatar || "")}" alt="" />
            <span><b>${esc(me.name || me.username)}</b><small>@${esc(me.username)}</small></span>
            <span class="drawer-chevron" aria-hidden="true">›</span>
          </button>
          <button type="button" class="drawer-close" id="drawer-close" data-testid="button-close-app-menu" aria-label="Close menu">${ic.close}</button>
        </header>
        <div class="drawer-links">
          <p class="drawer-label">Oldtime</p>
          <button type="button" class="drawer-link ${tab === "communities" ? "active" : ""}" data-drawer-route="communities" data-testid="button-drawer-community">${ic.users}<span>Community</span></button>
          <button type="button" class="drawer-link ${tab === "chat" ? "active" : ""}" data-drawer-route="chat" data-testid="button-drawer-chat">${ic.comment}<span>Chat</span></button>
          <button type="button" class="drawer-link" data-drawer-route="notes" data-testid="button-drawer-notifications">${ic.bell}<span>Notifications</span></button>
          <button type="button" class="drawer-link" data-drawer-route="settings" data-testid="button-drawer-settings">${ic.settings}<span>Settings</span></button>
          <button type="button" class="drawer-link" data-drawer-route="get-on-board" data-testid="button-drawer-get-on-board">${ic.home}<span>Get On Board</span></button>
        </div>
        <div class="drawer-footer"><span>OLDTIME TECHNOLOGIES</span><small>Your Oldtime account, in one place.</small></div>
      </aside>
    </div>
    <div class="toast" role="status"></div>
    <div class="sheet" id="sheet"></div>
    <div class="storyview" id="storyview"></div>
  </div></div>`;
  $("#drawer-close") && ($("#drawer-close").onclick = closeAppDrawer);
  $("#drawer-scrim") && ($("#drawer-scrim").onclick = closeAppDrawer);
  app.querySelectorAll("[data-drawer-route]").forEach(button => {
    button.onclick = () => {
      if (hasPendingSettingsChanges && !confirm("Discard your unsaved settings changes?")) return;
      hasPendingSettingsChanges = false;
      navigateFromDrawer(button.dataset.drawerRoute);
    };
  });
  app.querySelectorAll("[data-drawer-action]").forEach(button => {
    button.onclick = () => {
      if (hasPendingSettingsChanges && !confirm("Discard your unsaved settings changes?")) return;
      hasPendingSettingsChanges = false;
      const action = button.dataset.drawerAction;
      closeAppDrawer();
      openHomeCreate();
    };
  });
  app.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => navigateMainSection(b.dataset.tab));
  const createButton = $("#create-open");
  if (createButton) createButton.onclick = () => {
    openCreate();
  };
  app.querySelectorAll('#back, #playall').forEach(button => {
    const symbols = { "←": ["back", "Back"], "✕": ["close", "Close"], "▶": ["play", "Play"] };
    const replacement = symbols[button.textContent.trim()];
    if (replacement) { button.innerHTML = icon(replacement[0]); button.setAttribute("aria-label", replacement[1]); }
  });
  app.querySelectorAll("[data-creator-open]").forEach(button => button.onclick = () => navigateFromDrawer(button.dataset.creatorOpen));
  void hydrateBlueBadges(app);
  if (helpfulSurface()) scheduleCreatorAnnouncement({ app,esc,navigate:navigateHelpfulPrompt,toast,accountId:api.cloudAccountId(),
    getContext:()=>({page:helpfulSurface(),hasCover:!!api.me()?.cover,friendCount:api.me()?.friends?.length||0,
      hasNote:api.posts().some(p=>p.author===api.me()?.id&&p.kind==="text"),
      ...interestContext(api.cloudAccountId()||api.me()?.id||""),composing:isComposing(),recording:!!document.querySelector(".creative-editor.is-capturing")}),isSafe:isHelpfulSurfaceSafe });
}

function refreshCloudStoriesWhenNeeded() {
  if (api.authMode() !== "cloud" || !api.cloudStoriesNeedsRefresh() || api.cloudStoriesLoading()) return;
  const owner = api.cloudAccountId();
  const route = { tab, profileId, settingsView };
  const isSameRoute = () => api.cloudAccountId() === owner && tab === route.tab &&
    profileId === route.profileId && settingsView === route.settingsView;
  void api.refreshCloudStories().then(() => {
    if (isSameRoute()) render();
  }).catch(error => {
    if (isSameRoute()) {
      toast(error.message || "Stories could not be loaded.");
    }
  });
}
function isComposing() {
  if(document.querySelector(".creative-editor,.creative-response,.cta-backdrop"))return true;
  const el=document.activeElement;
  return !!el&&(/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)||el.isContentEditable);
}
function helpfulSurface() {
  if(tab==="blast"&&!isBlastGuidanceSafe())return null;
  if(tab==="updates")return profileId?"profile":"home";
  if(tab==="settings")return settingsView==="home"?"settings":null;
  return {blast:"blast",chat:"messages",communities:"communities",notes:"notifications"}[tab]||null;
}
function isHelpfulSurfaceSafe() {
  return (tab!=="blast"||isBlastGuidanceSafe()) && !viewer && !chatId && !hasPendingSettingsChanges && !document.hidden && !isComposing()
    && !$("#sheet.on, #storyview.on, .creative-editor, .sp, .app-drawer.on, .emoji-overlay, .bvn-drawer-backdrop, .bvn-composer, .bvn-thread-wrap, .blast-notes-composer, .blast-create")
    && !["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName)
    && !document.activeElement?.isContentEditable;
}
async function inviteToBlast() {
  const me=api.me();if(!me)return;
  const text=`Let's try Oldtime Community. My Oldtime username is @${me.username}. Open Community to find people and share posts.`;
  try {
    if(navigator.share)await navigator.share({title:"Try Oldtime Community with me",text});
    else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);toast("Invite copied. Share it with your friends.");}
    else toast(`Your Oldtime username is @${me.username}. Share it with your friends.`);
  } catch(error) {if(error.name!=="AbortError")toast(`Sharing wasn't available. Your username is @${me.username}.`);}
}
function navigateHelpfulPrompt(route) {
  if(route==="help-blast-invite"){void inviteToBlast();return;}
  if(route==="help-cover"){openEditProfile();return;}
  if(route==="help-note"){openCreate([],"text");return;}
  if(route==="help-studio"){openCreate();return;}
  if(route==="help-messages"){navigateFromDrawer("chat");return;}
  if(route==="help-communities"){navigateFromDrawer("communities");return;}
  if(route==="help-friends"||route==="help-blast"){
    navigateFromDrawer("communities");return;
  }
  if(route.startsWith("settings:")){
    const view=route.slice(9);
    if(!["privacy-center","chat","notifications"].includes(view))return;
    navigationStack.push(captureNavigationState());
    closeAppDrawer();tab="settings";settingsView=view;profileId=null;chatId=null;viewer=null;render();return;
  }
  navigateFromDrawer(route);
  if(route.startsWith("help-article-")&&navigationStack.length){
    navigationStack.at(-1).helpfulArticle=route;
    $("#settings-back")?.setAttribute("aria-label","Back to previous screen");
  }
}
function likesRow(post) {
  const me=api.me();
  const people=post.cloud?(post.likedBy||[]):post.likes.map(id=>api.user(id)).filter(Boolean).map(u=>({id:u.id,displayName:u.name,avatarUrl:u.avatar}));
  return renderPostLikesRow({id:post.id,count:post.cloud?post.likeCount:post.likes.length,people,viewerId:me?.id,esc});
}
function updateLikesRow(post) {
  app.querySelectorAll("[data-post-likes]").forEach(row=>{
    if(row.dataset.postLikes===post.id)row.outerHTML=likesRow(post);
  });
  // A post without likes has no row yet. Insert after its author handle.
  app.querySelectorAll(".clip[data-id]").forEach(clip=>{
    if(clip.dataset.id===post.id&&!clip.querySelector("[data-post-likes]"))clip.querySelector(".handle")?.insertAdjacentHTML("afterend",likesRow(post));
  });
  app.querySelectorAll("[data-post-likes] [data-profile]").forEach(button=>button.onclick=e=>{
    e.stopPropagation();navigateToProfile(button.dataset.profile);
  });
  app.querySelectorAll("[data-post-likes] [data-avatar-profile]").forEach(button=>button.onclick=e=>{
    e.stopPropagation();openPersonAvatar(button.dataset.avatarProfile);
  });
}
function captureNavigationState() {
  return { tab, homeView, homeTopic, communityView, nearbyCity, profileId, profileMode, chatId, profileReturnChatId, viewer, settingsView, searchQ };
}
function openAppDrawer() {
  const drawer = $("#app-drawer");
  if (!drawer) return;
  drawerReturnFocus = document.activeElement;
  drawer.hidden = false;
  drawer.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => { if (!drawer.hidden) drawer.classList.add("on"); });
  $("#drawer-close")?.focus();
  drawerEscapeHandler = event => {
    if (event.key === "Escape") closeAppDrawer();
  };
  document.addEventListener("keydown", drawerEscapeHandler);
}
function closeAppDrawer() {
  const drawer = $("#app-drawer");
  if (drawer) {
    drawer.classList.remove("on");
    drawer.hidden = true;
    drawer.setAttribute("aria-hidden", "true");
  }
  if (drawerEscapeHandler) {
    document.removeEventListener("keydown", drawerEscapeHandler);
    drawerEscapeHandler = null;
  }
  const focusTarget = drawerReturnFocus?.isConnected ? drawerReturnFocus : $("#profile-actions-open, #community-search-open");
  drawerReturnFocus = null;
  focusTarget?.focus({ preventScroll: true });
}
async function navigateFromDrawer(route) {
  closeAppDrawer();
  if (route === "blast") route = "communities";
  if (route === "sports" && !SPORTS_MODE_ENABLED) route = "updates";
  if (route === "live" || route === "tournaments") {
    toast("This feature is currently unavailable.");
    return;
  }
  const isSupportRoute = route === "help" || route.startsWith("help-");
  const isToolsRoute = ACCOUNT_TOOL_ROUTES.includes(route) || CREATOR_TOOL_ROUTES.includes(route);
  if (!isSupportRoute && !isToolsRoute && !["updates", "search", "communities", "chat", "profile", "get-on-board", "notes", "settings"].includes(route)) {
    route = "updates";
  }
  if (route === "communities") return navigateMainSection("communities");
  if (route === "tournaments") return openTournaments({ toast, onShare: shareTournamentReference });
  if (route === "get-on-board") {
    initGetOnBoard({ accountId: api.me()?.id, toast, onShare: shareBoardReference });
    return openGetOnBoard({ accountId: api.me()?.id, toast, onShare: shareBoardReference });
  }
  if (route === "sports") {
    const [{ openSportsMode }, { sports }, { sportsSocial }] = await Promise.all([
      import("./sports-mode.js"), import("./sports-engine.js"), import("./sports-social.js"),
    ]);
    openSportsMode({ toast,
      onShare: async ({ media, caption }) => {
        // Register generated recordings like uploads; unregistered blob URLs
        // cannot be saved or published by Studio.
        const source = media.blob ? await putLocalMedia(media.blob) : media.url;
        openUniversalCreation({
          background: { media: source, kind: media.type === "video" ? "video" : "photo" }, caption,
        });
        if (media.blob && media.url?.startsWith("blob:")) URL.revokeObjectURL(media.url);
        return true;
      },
      onPublish: async ({ workout, caption, media, challengeId, taggedUserIds = [] }) => {
        if (!api.me()?.cloudAccountId) throw new Error("Sign in to sync this activity and publish it to Oldtime.");
        if (!workout.synced) workout = await sports.sync(workout.id);
        // Freeze the selected canonical tags into the shared card metadata.
        // Validate before uploading so a failed tag never publishes a misleading card.
        await sportsSocial.tagWorkout(workout.id, { challengeId: challengeId || null, taggedUserIds });
        let content = media.blob, mime = media.mime || content?.type;
        if (media.type !== "video") {
          const source = await (await fetch(media.url)).blob();
          const image = await createImageBitmap(source);
          const canvas = document.createElement("canvas");
          canvas.width = image.width; canvas.height = image.height;
          canvas.getContext("2d").drawImage(image, 0, 0); image.close();
          content = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .88)); mime = "image/jpeg";
        }
        if (!content) throw new Error("The card or video could not be exported.");
        const upload = await requestCloudApi(`/api/sports/workouts/${workout.id}/card`, {
          method: "POST", rawBody: content, contentType: mime,
        });
        const name = ({run:"Run",walk:"Walk",cycle:"Ride",hike:"Hike"})[workout.activityType];
        const post = await api.createCloudPost(caption.trim() || `${name} · ${(workout.summary.distanceM / 1000).toFixed(2)} km on Oldtime`,
          { workoutId: workout.id, sportsCardId: upload.cardId });
        viewer = null; profileId = null; tab = "updates"; settingsView = "home";
        homeView = "explore"; homeTopic = "all";
        render();
        requestAnimationFrame(() => {
          const feed = $("#feed");
          const card = [...(feed?.children || [])].find(item => item.dataset.id === post.id);
          card?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        toast("Posted to your main feed");
      },
    });
    return;
  }
  if (route === "notes") {
    if (tab !== "notes") openNotifications();
    return;
  }
  if (route === "settings" && tab === "settings") {
    settingsView = "home";
    render();
    return;
  }
  if (route === "profile" && tab === "updates" && profileId === api.me().id) return;
  if (route !== "settings" && route === tab && !profileId && !chatId && !viewer) return;

  navigationStack.push(captureNavigationState());
  profileReturnChatId = null;
  if (!isToolsRoute) {
    notificationsOrigin = null;
    notificationsReturnStack = [];
  }
  settingsView = "home";
  viewer = null;
  if (route === "profile") {
    tab = "updates";
    profileId = api.me().id;
    profileMode = "posts";
    chatId = null;
  } else {
    tab = isSupportRoute ? "settings" : route;
    if (isSupportRoute) settingsView = route;
    profileId = null;
    chatId = null;
  }
  render();
}
function restoreNavigationState(state) {
  if (!state) return;
  ({ tab, homeView, homeTopic, communityView, nearbyCity, profileId, profileMode, chatId, profileReturnChatId, viewer, settingsView, searchQ } = state);
  communityView = state.communityView === "following" ? "following" : "for-you";
}
function navigateBack() {
  const previous = navigationStack.pop();
  if (!previous) return false;
  restoreNavigationState(previous);
  render();
  return true;
}
function navigateToProfile(id, { fromChat = false } = {}) {
  recordProfileVisit(id,fromChat?"direct":viewer?"content":tab==="search"?"search":tab==="communities"?"community":"direct");
  if (notificationsReturnStack.length) notificationsReturnStack.push(captureNavigationState());
  else navigationStack.push(captureNavigationState());
  if (fromChat) profileReturnChatId = chatId;
  else profileReturnChatId = null;
  profileId = id;
  profileMode = "posts";
  tab = "updates";
  viewer = null;
  render();
}
function openPersonAvatar(id) {
  const story = api.stories()
    .filter(item => item.author === id && isStoryActive(item) && api.canSeeStory(item))
    .sort((a, b) => b.created - a.created)[0];
  if (story) return openStory(id, story.id);
  if (id === api.me()?.id) return openStory(id);
  return navigateToProfile(id);
}
function openPostViewer(id, commentId = "") {
  if (notificationsReturnStack.length) notificationsReturnStack.push(captureNavigationState());
  else navigationStack.push(captureNavigationState());
  viewer = id;
  profileId = null;
  render();
  if (commentId) comments(id, commentId);
}
function openNotifications() {
  if (tab === "notes") return;
  if (hasPendingSettingsChanges && !confirm("Discard your unsaved settings changes?")) return;
  hasPendingSettingsChanges = false;
  notificationsOrigin = captureNavigationState();
  notificationsReturnStack = [];
  tab = "notes";
  profileId = null;
  chatId = null;
  viewer = null;
  settingsView = "home";
  void Promise.all([loadAccountNotifications({ force: true }), api.refreshCloudRelationships({ force: true })])
    .then(() => { if (tab === "notes") render(); }).catch(() => { if (tab === "notes") render(); });
  render();
}
function backFromNotificationDetail() {
  const previous = notificationsReturnStack.pop();
  if (!previous) return false;
  restoreNavigationState(previous);
  render();
  return true;
}
function leaveNotifications() {
  const previous = notificationsOrigin || { tab: "updates", homeView, homeTopic, profileId: null, profileMode, chatId: null, profileReturnChatId: null, viewer: null, settingsView };
  notificationsOrigin = null;
  notificationsReturnStack = [];
  restoreNavigationState(previous);
  render();
}
let toolsOwner=null,toolsReady=false,toolsLoading=false,toolsAttempt=0;
function ensureAccountTools(){
  const account=api.cloudAccountId();
  if(account!==toolsOwner){toolsOwner=account;toolsReady=false;toolsLoading=false;toolsAttempt=0;resetAccountTools();}
  if(!account||toolsReady||toolsLoading||Date.now()-toolsAttempt<30000)return;
  toolsLoading=true;toolsAttempt=Date.now();
  void loadAccountTools().then(()=>{
    if(api.cloudAccountId()!==account)return;
    toolsReady=true;
    mutate(db=>{const user=db.users.find(u=>u.id===api.me()?.id);if(user)user.professional={...getAccountTools()};});
    render();
  }).catch(()=>{}).finally(()=>{if(api.cloudAccountId()===account)toolsLoading=false;});
}
window.addEventListener("oldtime-account-tools",()=>{
  if(!api.me())return;
  mutate(db=>{const user=db.users.find(u=>u.id===api.me().id);if(user)user.professional={...getAccountTools()};});
  // The switching screen controls its own navigation; do not unmount its
  // confirmation/success flow before the successful handler completes.
});
function navigateMainSection(section) {
  if (hasPendingSettingsChanges && !confirm("Discard your unsaved settings changes?")) return;
  hasPendingSettingsChanges = false;
  if (section === "blast") section = "communities";
  if (!["updates", "communities", "search", "chat", "profile"].includes(section)) section = "updates";
  const nextTab = section === "profile" ? "updates" : section;
  if (tab !== nextTab || profileId || chatId || viewer) navigationStack.push(captureNavigationState());
  profileReturnChatId = null;
  notificationsOrigin = null;
  notificationsReturnStack = [];
  tab = nextTab;
  settingsView = "home";
  viewer = null;
  if (section === "profile") { profileId = api.me().id; tab = "updates"; profileMode = "posts"; }
  else { chatId = null; profileId = null; }
  render();
}

bindSectionSwipes({
  root: app,
  current: () => tab === "updates" ? homeView : app.querySelector(".nav:not(.nav-hidden) [data-tab].on")?.dataset.tab,
  sections: () => tab === "updates" ? ["explore", "following", "nearby"] : ["updates", "communities", "chat", "profile"],
  enabled: () => !!api.me() && !chatId && !viewer &&
    !!app.querySelector(".nav:not(.nav-hidden) [data-tab].on") &&
    !document.querySelector("#sheet.on,#storyview.on,.creative-editor,.app-drawer.on,.emoji-overlay,.gob,.ch-back,.pp-back,details[open]") &&
    !document.activeElement?.matches("input,textarea,select,[contenteditable=true]"),
  navigate: section => { if (tab === "updates") { homeView = section; render(); } else navigateMainSection(section); },
});

function render() {
  const migrationAccount = api.cloudAccountId();
  if (migrationAccount && api.me()) legacyMigrationRunner.request(migrationAccount);
  if (tab === "profile") tab = "updates";
  if (!["updates", "communities", "search", "chat", "notes", "settings", "profile-edit", ...ACCOUNT_TOOL_ROUTES, ...CREATOR_TOOL_ROUTES].includes(tab)) {
    tab = "updates";
    profileId = null;
    chatId = null;
    viewer = null;
    settingsView = "home";
  }
  if (!app.dataset.carouselChangeListener) {
    app.addEventListener("creative-carousel-change", event => {
      const { id, index } = event.detail || {};
      if (id) carouselIndex[id] = Number(index) || 0;
    });
    app.dataset.carouselChangeListener = "true";
  }
  const relationshipAccount = api.cloudAccountId();
  if (relationshipAccount && !api.cloudRelationshipsLoaded() && !api.cloudRelationshipsLoading()) {
    void api.refreshCloudRelationships().then(() => {
      if (relationshipAccount === api.cloudAccountId()) render();
    }).catch(() => {});
  }
  registerOwnActivityContent();
  void loadAccountNotifications().then(changed => { if (changed) render(); })
    .catch(() => { if (tab === "notes") render(); });
  const creatorAccount = api.cloudAccountId();
  if (creatorAccount !== creatorSessionAccount) {
    resetCreatorScreenState();
    resetCreatorAnnouncements();
    if (peopleSearchTimer) clearTimeout(peopleSearchTimer);
    peopleSearchTimer = null;
    peopleSearchRequestId++;
    peopleSearch = { query: "", status: "idle", profiles: [], error: "" };
    searchQ = "";
    creatorSessionAccount = creatorAccount;
  }
   if (!api.me() || !api.cloudAccountId()) { closeGetOnBoard(); closeTournaments(); return auth(); }
  const stateOwner = api.cloudAccountId();
  if (stateOwner && !api.cloudAccountStateLoaded() && !api.cloudAccountStateLoading() &&
    app.dataset.accountStateAttempt !== stateOwner) {
    app.dataset.accountStateAttempt = stateOwner;
    void api.loadCloudAccountState().then(() => {
      if (api.cloudAccountId() === stateOwner) render();
    }).catch(error => toast(error.message || "Your saved account data could not be loaded."));
  }
  if (!app.dataset.accountStateErrorListener) {
    window.addEventListener("oldtime-account-state-error", event =>
      toast(event.detail?.message || "Saved account data could not be synchronized."));
    app.dataset.accountStateErrorListener = "true";
  }
   if (pendingStoryId) void resolvePendingStoryLink();
  mountComms({ toast, esc });
  if (viewer) return postViewer(viewer);
  const toolsContext = { shell, app, esc, toast, navigate: navigateFromDrawer,
    back: () => { if (!navigateBack()) navigateFromDrawer("settings"); } };
  if (ACCOUNT_TOOL_ROUTES.includes(tab)) return renderAccountToolsScreen(tab, toolsContext);
  if (CREATOR_TOOL_ROUTES.includes(tab)) return renderCreatorScreen(tab, toolsContext);
  if (tab === "notes") return notes();
  if (tab === "settings") return settings();
  if (tab === "updates" && profileId) return profile(profileId);
  if (tab === "updates") return updates();
  if (tab === "chat") return chatId ? thread(chatId) : chats();
  if (tab === "search") return search();
  if (tab === "communities") return communities();
  if (tab === "profile-edit") return editProfilePage();
  updates();
}
function auth() {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#990000");
  app.innerHTML = loginMarkup(brandArtUrl);
  void mountCognitoAction($("#cognito-sign-in"), { onError: message => { if ($("#err")) $("#err").textContent = message; } });
  $("#login-form").onsubmit = async event => {
    event.preventDefault();
    const button = $("#login");
    const error = $("#err");
    button.disabled = true;
    error.textContent = "";
    try {
      const mode = await api.login($("#email").value.trim(), $("#pass").value);
      render();
    } catch (e) {
      error.textContent = e.message;
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  };
  $("#signup").onclick = signup;
}
function signup() {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#990000");
  app.innerHTML = signupMarkup(brandArtUrl);
  void mountCognitoAction($("#cognito-sign-in"), { onError: message => { if ($("#err")) $("#err").textContent = message; } });
  $("#back").onclick = auth;
  $("#signup-form").onsubmit = async event => {
    event.preventDefault();
    const button = $("#go");
    const error = $("#err");
    button.disabled = true;
    error.textContent = "";
    try {
      await api.signup({ email: $("#su-email").value.trim(), username: $("#su-user").value.trim(), password: $("#su-pass").value });
      render();
    } catch (e) {
      error.textContent = e.message;
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  };
}
function updates() {
  feedPageObserver?.disconnect();
  feedPageObserver = null;
  const initialCloudStatus = api.cloudFeedStatus();
  if (api.authMode() === "cloud" && !initialCloudStatus.loaded && !initialCloudStatus.loading && !initialCloudStatus.error) {
    void api.refreshCloudFeed().then(() => {
      if (tab === "updates" && settingsView === "home") render();
    }).catch(() => {
      if (tab === "updates" && settingsView === "home") render();
    });
  }
  const previousFeed = $("#feed");
  const activePost = previousFeed?.children[Math.round(previousFeed.scrollTop / (previousFeed.clientHeight || 1))]?.dataset.id;
  const me = api.me();
  refreshCloudStoriesWhenNeeded();
  const stories = api.stories().filter(s => isStoryActive(s) && api.canSeeStory(s));
  const byAuthor = new Map();
  stories.forEach(s => { if (!byAuthor.has(s.author)) byAuthor.set(s.author, s); });
  const posts = homePosts();
  const openedPost = viewer ? api.post(viewer) : null;
  if (openedPost && isFeedHomePost(openedPost) && !posts.some(post => post.id === openedPost.id)) posts.unshift(openedPost);
  const areas = nearbyAreas();
  const allAreaCount = areas.reduce((sum, area) => sum + area.count, 0);
  const cloudStatus = api.cloudFeedStatus();
  const cloudFeedPager = cloudStatus.hasMore
    ? `<div class="feed-page-status" role="status">${cloudStatus.loading || homeFeedMorePending
      ? "Loading more posts…"
      : cloudStatus.error
        ? `Couldn’t load more posts. <button type="button" class="feed-page-action" id="cloud-feed-more">Retry</button>`
        : `<button type="button" class="feed-page-action" id="cloud-feed-more">Load more posts</button>`}</div>`
    : "";
  const cloudEmpty = api.authMode() === "cloud" && !api.cloudPosts().length
    ? cloudStatus.loading
      ? `<div class="empty" role="status">Loading online posts…</div>`
      : cloudStatus.error
        ? `<div class="empty" role="status"><p>Couldn’t load online posts.</p><button type="button" id="cloud-feed-retry">Try again</button></div>`
        : null
    : null;
  const homeEmpty = homeTopic === "interests"
    ? `<div class="interest-feed-empty"><div class="interest-feed-mark" aria-hidden="true">◎</div><b>${me.interests?.length ? "Your interests, your feed" : "Find posts around what you love"}</b><p>${me.interests?.length ? "There aren’t any posts matching your interests yet. Add another interest or check back soon." : "Choose a few interests to personalize this feed and find people who share them."}</p><button type="button" id="edit-home-interests">${me.interests?.length ? "Edit interests" : "Choose interests"}</button></div>`
    : homeView === "nearby"
      ? `<div class="nearby-feed-empty"><div class="interest-feed-mark" aria-hidden="true">⌖</div><b>${esc(homeEmptyMessage(me))}</b><p>Pick an area or switch to all areas to find more posts.</p><button type="button" data-nearby-area="all">Explore all areas</button></div>`
    : `<div class="empty">${esc(homeEmptyMessage(me))}</div>`;
  shell(`<section class="screen on home-screen">
      <div class="feed" id="feed">${posts.map(postCard).join("") || cloudEmpty || homeEmpty}${cloudFeedPager}</div>
    <header class="home-discovery-header">
      <div class="home-primary-row">
        <button class="icon home-create-button" id="create-open" aria-label="Create" title="Create">${ic.plus}</button>
        <nav class="home-view-tabs" role="tablist" aria-label="Home feed views">
          ${HOME_VIEWS.map(view => `<button type="button" role="tab" class="home-view-tab ${homeView === view.id ? "on" : ""}" data-home-view="${view.id}" aria-selected="${homeView === view.id}" title="${view.id === "nearby" ? `Nearby posts around ${esc(me.city || "your profile city")}` : view.label}">${view.label}</button>`).join("")}
        </nav>
          <span class="home-header-actions">
          <button class="icon" data-tab="search" aria-label="Search" title="Search">${ic.search}</button>
          <button class="icon home-notifications-button" id="notifications-open" aria-label="Notifications" title="Notifications">${ic.bell}${accountNotifications().some(note => note.user === me.id && !note.read) || api.db().requests.some(request => request.to === me.id) || api.db().friendRequests?.some(request => request.to === me.id) ? '<span class="home-notification-dot" aria-label="Unread notifications"></span>' : ""}</button>
        </span>
      </div>
      <nav class="home-topic-tabs" role="tablist" aria-label="Feed topics">
        ${HOME_TOPICS.map(topic => `<button type="button" role="tab" class="home-topic-tab ${homeTopic === topic.id ? "on" : ""}" data-home-topic="${topic.id}" aria-selected="${homeTopic === topic.id}">${esc(topic.label)}</button>`).join("")}
      </nav>
      ${homeView === "nearby" ? `<div class="nearby-controls">
        <div class="nearby-location-line">
          <span class="nearby-location-label" aria-live="polite">${nearbyLocationStatus === "requesting" ? "Finding your area…" : nearbyCity === "all" ? "Explore posts by area" : `Near ${esc(nearbyCity)}`}</span>
          <button type="button" class="nearby-location-button" data-nearby-locate ${nearbyLocationStatus === "requesting" ? "disabled" : ""}>${nearbyLocationStatus === "requesting" ? "Finding…" : nearbyLocationStatus === "located" ? "Refresh" : "Use my location"}</button>
        </div>
        <nav class="nearby-area-list" aria-label="Choose a nearby area">
          <button type="button" class="nearby-area-chip ${nearbyCity === "all" ? "on" : ""}" data-nearby-area="all" aria-pressed="${nearbyCity === "all"}">All areas <small>${allAreaCount}</small></button>
          ${areas.map(area => `<button type="button" class="nearby-area-chip ${nearbyCity === area.name ? "on" : ""}" data-nearby-area="${esc(area.name)}" aria-pressed="${nearbyCity === area.name}">${esc(area.name)} <small>${area.count}</small></button>`).join("")}
        </nav>
      </div>` : ""}
    </header>
     <div class="stories home-stories" style="position:absolute;left:0;right:0;z-index:4;${homeView === "nearby" ? "top:calc(max(16px,env(safe-area-inset-top,0px)) + 142px)" : ""}">${[...(byAuthor.has(me.id) ? [me.id] : []), ...[...byAuthor.keys()].filter(id => id !== me.id)].map(id => {
      const u = api.user(id);
      const story = byAuthor.get(id);
      const ringClass = ["ring", story ? "active" : "seen", isCloseFriendsStory(story) ? "close-friends" : ""].filter(Boolean).join(" ");
      return `<div class="story">
        <button type="button" class="story-avatar-action" data-avatar-profile="${esc(id)}" aria-label="${story ? `View @${esc(u.username)}'s story` : "Create a story"}">
          <span class="${ringClass}"><img src="${esc(u.avatar)}" alt="" /></span>
        </button>
        <button type="button" class="story-name" data-profile="${esc(id)}" aria-label="Open @${esc(u.username)}'s profile">${esc(u.username)}</button>
      </div>`;
    }).join("")}</div>
  </section>`);
  const feedScroller = $("#feed");
  const updateStoryVisibility = () => $(".home-screen")?.classList.toggle("stories-scrolled", feedScroller.scrollTop > 36);
  feedScroller.addEventListener("scroll", updateStoryVisibility, { passive: true });
  $("#cloud-feed-retry") && ($("#cloud-feed-retry").onclick = async () => {
    try { await api.refreshCloudFeed(homeView === "following" ? "following" : "main"); render(); }
    catch { render(); }
  });
  const loadMoreCloudPosts = async () => {
    if (homeFeedMorePending || !api.cloudFeedStatus().hasMore) return;
    homeFeedMorePending = true;
    try { await api.loadMoreCloudFeed(); }
    catch { /* The feed status retains the error and exposes a retry button. */ }
    finally {
      homeFeedMorePending = false;
      if (tab === "updates" && settingsView === "home") render();
    }
  };
  $("#cloud-feed-more")?.addEventListener("click", loadMoreCloudPosts);
  $("#edit-home-interests") && ($("#edit-home-interests").onclick = openEditProfile);
  app.querySelectorAll("[data-avatar-profile]").forEach(b => b.onclick = event => {
    event.stopPropagation();
    openPersonAvatar(b.dataset.avatarProfile);
  });
  $("#create-open").onclick = openHomeCreate;
  $("#notifications-open").onclick = openNotifications;
  app.querySelectorAll("[data-home-view]").forEach(b => b.onclick = () => {
    const enteringNearby = b.dataset.homeView === "nearby" && homeView !== "nearby";
    homeView = b.dataset.homeView;
    render();
    if (enteringNearby && nearbyLocationStatus === "idle") requestNearbyLocation();
  });
  app.querySelectorAll("[data-home-topic]").forEach(b => b.onclick = () => { homeView = "explore"; homeTopic = b.dataset.homeTopic; render(); });
  app.querySelectorAll("[data-nearby-area]").forEach(button => button.onclick = () => {
    nearbyLocationRequestId++;
    nearbyCity = button.dataset.nearbyArea || "all";
    render();
  });
  app.querySelector("[data-nearby-locate]")?.addEventListener("click", requestNearbyLocation);
  bindPosts();
  const feedPager = $("#feed")?.querySelector(".feed-page-status");
  if (feedPager && cloudStatus.hasMore && !cloudStatus.loading && !cloudStatus.error &&
      api.authMode() === "cloud" && "IntersectionObserver" in window) {
    feedPageObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMoreCloudPosts();
    }, { root: $("#feed"), rootMargin: "320px 0px" });
    feedPageObserver.observe(feedPager);
  }
  if (activePost) {
    const active = [...$("#feed").children].find(el => el.dataset.id === activePost);
    if (active) $("#feed").scrollTop = active.offsetTop;
  }
  updateStoryVisibility();
}
function observeVideos() {
  feedObserver?.disconnect();
  const vids = [...app.querySelectorAll(".clip video")];
  feedObserver = new IntersectionObserver((ents) => ents.forEach(en => {
    const v = en.target;
    if (en.isIntersecting) { v.muted = muted; v.play().catch(() => {}); }
    else v.pause();
  }), { threshold: 0.65 });
  vids.forEach(v => {
    const item=api.post(v.dataset.id);if(item)trackQualifiedView(item,v.closest(".clip")||v,"feed");
    feedObserver.observe(v);
    v.ontimeupdate = () => { const p = api.db().posts.find(p => p.id === v.dataset.id); if (p?.trim && v.currentTime >= p.trim) v.currentTime = 0; };
  });
}
function postCard(p) {
  p=getRepostView(p,api.db());
  const u = api.user(p.author);
  if (!u) return "";
  const me = api.me();
  const liked = p.likes.includes(me.id);
  const likeCount = Number.isFinite(p.likeCount) ? p.likeCount : p.likes.length;
  const saved = p.saves.includes(me.id);
  const saveCount = Number.isFinite(p.saveCount) ? p.saveCount : p.saves.length;
  const repostFaces = p.cloud ? renderRepostAffordance(p,{esc}) : "";
  const following = !p.cloud && (me.following.includes(u.id) || u.id === me.id);
  const caption = String(p.caption || "");
  const longCaption = caption.length > 120;
  const captionOpen = !!expandedCaptions[p.id];
  const moreButton = longCaption ? `<button type="button" class="caption-more" data-caption-toggle="${esc(p.id)}" aria-expanded="${captionOpen}">${captionOpen ? "See less" : "See more"}</button>` : "";
  const captionMarkup = p.kind !== "text" && caption
    ? `<div class="cap ${longCaption && !captionOpen ? "is-collapsed" : longCaption ? "is-expanded" : ""}" data-caption-content="${esc(p.id)}">${esc(caption)}${tournamentLinkMarkup(caption, esc)}</div>${moreButton}`
    : "";
  const selectedSlide = Math.max(0, Math.min((p.media?.length || 1) - 1, carouselIndex[p.id] || 0));
  const selectedMedia = p.media?.[selectedSlide] || p.media?.[0] || "";
  const mediaAttrs = reference => isLocalMedia(reference)
    ? `data-local-media="${esc(reference)}" data-local-media-owner="${esc(p.author)}"`
    : `src="${esc(renderMediaUrl(reference))}"`;
  const rawCarousel = !p.creativeProject && p.kind === "carousel" && p.media?.length > 1;
  const media = p.creativeProject ? creativeMediaMarkup(p, esc, false, false, selectedSlide) : p.kind === "video"
    ? `<video ${mediaAttrs(p.media[0])} data-id="${p.id}" data-dbl="${p.id}" loop playsinline preload="none" ${muted ? "muted" : ""}></video>`
    : p.kind === "text"
      ? `<div class="textpost" style="height:100%"><p class="textpost-caption ${longCaption && !captionOpen ? "is-collapsed" : longCaption ? "is-expanded" : ""}" data-caption-content="${esc(p.id)}">${esc(caption || p.text || "")}</p>${moreButton}</div>`
      : rawCarousel
        ? `<div class="post-carousel" data-post-carousel="${esc(p.id)}" data-count="${p.media.length}"><img class="fullimg" ${mediaAttrs(selectedMedia)} loading="lazy" decoding="async" alt="Photo ${selectedSlide + 1} of ${p.media.length}" data-dbl="${p.id}" /><span class="carousel-count">${selectedSlide + 1}/${p.media.length}</span></div>`
        : `<img class="fullimg" ${mediaAttrs(selectedMedia)} loading="lazy" decoding="async" alt="" data-dbl="${p.id}" />`;
  const actions = p.cloud
    ? `<button class="act ${liked ? "on" : ""}" data-like="${p.id}" aria-label="Like post" aria-pressed="${liked}">${liked ? ic.heartOn : ic.heart}<span class="act-count">${fmt(likeCount)}</span></button>
       <button class="act" data-comment="${p.id}" aria-label="Comments">${ic.comment}<span class="act-count">${fmt(p.commentCount || 0)}</span></button>
       <button class="act ${saved ? "on" : ""}" data-save="${p.id}" aria-label="${saved ? "Remove saved post" : "Save post"}" aria-pressed="${saved}">${saved ? ic.bookmarkOn : ic.bookmark}<span class="act-count">${fmt(saveCount)}</span></button>
       <button class="act" data-share="${p.id}" aria-label="Share post">${ic.share}<span class="act-label">Share</span></button>`
    : `<button class="act ${liked ? "on" : ""}" data-like="${p.id}" aria-label="Like post" aria-pressed="${liked}">${liked ? ic.heartOn : ic.heart}<span class="act-count">${fmt(likeCount)}</span></button>
       <button class="act" data-comment="${p.id}" aria-label="Comments">${ic.comment}<span class="act-count">${fmt(p.comments.length)}</span></button>
       <button class="act ${saved ? "on" : ""}" data-save="${p.id}" aria-label="${saved ? "Remove saved post" : "Save post"}" aria-pressed="${saved}">${saved ? ic.bookmarkOn : ic.bookmark}<span class="act-count">${fmt(saveCount)}</span></button>
       <button class="act" data-share="${p.id}" aria-label="Share post">${ic.share}<span class="act-label">Share</span></button>`;
  return `<article class="clip ${viewer && !p.creativeProject ? "post-detail" : ""}" data-id="${p.id}">${media}<div class="shade"></div>
    ${p.kind === "video" ? `<button type="button" class="clip-float-control" data-video-float="${esc(p.id)}" aria-label="Continue video in a floating player" title="Continue video in a floating player">${videoFloatIcon}</button>` : ""}
    <div class="rail">
      ${actions}
      ${p.author === me.id ? `<button type="button" class="act post-delete-act" data-delete-post="${esc(p.id)}" aria-label="Delete your post" title="Delete post"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg><span>Delete</span></button>` : ""}
      ${p.kind === "video" ? `<button class="act" data-mute="${p.id}" aria-label="${muted ? "Unmute" : "Mute"} video">${muted ? ic.mute : ic.volume}</button>` : ""}
    </div>
    ${p.kind === "carousel" && p.media?.length > 1 ? `<div class="carousel-nav">${p.media.map((_, i) => `<button data-dot="${p.id}:${i}" aria-label="Photo ${i + 1} of ${p.media.length}" aria-pressed="${i === selectedSlide}" class="${i === selectedSlide ? "on" : ""}"></button>`).join("")}</div>` : ""}
    <div class="meta" tabindex="0" aria-label="Post details">
      ${postPlaceCard(p)}
      ${repostFaces}
      <div class="handle"><button type="button" class="feed-author-avatar" data-avatar-profile="${esc(u.id)}" aria-label="Open @${esc(u.username)}'s story or profile"><img src="${esc(u.avatar || "")}" alt="" class="avatar" /></button><button type="button" class="feed-author-name" data-profile="${esc(u.id)}">${esc(u.name)}</button>${blueBadgeMarkup(u.cloudAccountId || u.id, esc)} ${following ? "" : p.cloud ? "" : `<button class="followpill" data-follow="${u.id}">Follow</button>`}</div>
      ${likesRow(p)}
      ${captionMarkup}
      ${p.creativeProject ? creativeAttribution(p, esc) : ""}
    </div>
    <button type="button" class="soundbar" data-audio-open="${esc(p.id)}" aria-label="Open audio, library and remix">
      <img src="${u.avatar}" alt="" />
      <div><b>${esc(audioTitle(p))}</b><div class="sub">▶ ${fmt(audioUses(p))} uses</div></div>
    </button>
  </article>`;
}
function postPlaceValue(post) {
  return String(post?.location || "").trim();
}
function postPlaceCard(post) {
  const place = postPlaceValue(post);
  if (!place) return "";
  const key = cityMatchKey(place);
  const people = new Set(api.posts()
    .filter(candidate => cityMatchKey(postPlaceValue(candidate)) === key)
    .map(candidate => candidate.author));
  const count = people.size;
  return `<div class="clip-place">
    <span class="clip-place-label">Nearby creators</span>
    <button type="button" class="clip-place-card" data-place-explore="${esc(place)}" aria-label="Explore ${esc(place)}">
      <span class="clip-place-icon">${ic.location}</span>
      <span class="clip-place-copy"><b>${esc(place)}</b><small>${fmt(count)} ${count === 1 ? "person" : "people"} posted here · Explore now</small></span>
      <span class="clip-place-arrow" aria-hidden="true">›</span>
    </button>
  </div>`;
}
function head(u, following, p) {
  return `<div class="handle"><button type="button" class="feed-author-avatar" data-avatar-profile="${esc(u.id)}" aria-label="Open @${esc(u.username)}'s story or profile"><img src="${esc(u.avatar || "")}" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover" /></button> <button class="feed-author-name" type="button" data-profile="${esc(u.id)}">@${esc(u.username)}</button>${blueBadgeMarkup(u.cloudAccountId || u.id, esc)} ${following ? "" : `<button class="followchip" data-follow="${esc(u.id)}">Follow</button>`}</div>`;
}
function rail(p, liked, saved) {
  return `<div class="rail">
    <button class="act ${liked ? "on" : ""}" data-like="${p.id}" aria-label="Like post">${liked ? ic.heartOn : ic.heart}${fmt(p.likes.length)}</button>
    <button class="act" data-comment="${p.id}" aria-label="Comments">${ic.comment}${fmt(p.comments.length)}</button>
    <button class="act ${saved ? "on" : ""}" data-save="${p.id}"><span class="bubble">${saved ? ic.bookmarkOn : ic.bookmark}</span>${fmt(p.saves.length)}</button>
    <button class="act" data-mute="${p.id}"><span class="bubble">${muted ? ic.mute : ic.volume}</span></button>
    <button type="button" class="rail-avatar" data-avatar-profile="${esc(p.author)}" aria-label="Open author's story or profile"><img class="avatar" src="${esc(api.user(p.author)?.avatar || "")}" alt="" /></button>
  </div>`;
}
function bindPostDeleteActions(root = app, { onDeleted } = {}) {
  root.querySelectorAll("[data-delete-post]").forEach(button => button.onclick = async event => {
    event.preventDefault();
    event.stopPropagation();
    const postId = button.dataset.deletePost;
    const post = api.post(postId);
    const owner = api.me()?.id;
    if (!post || !owner || post.author !== owner) {
      toast("You can only delete your own posts.");
      return;
    }
    if (!confirm("Permanently delete this post and its replies, likes, and shared copies? This cannot be undone.")) return;
    const media = (post.media || []).filter(isLocalMedia);
    button.disabled = true;
    try {
      await api.deleteOwnPost(postId);
      if (api.me()?.id !== owner) return;
      let cleanupFailed = false;
      for (const item of media) {
        const referenced = [...api.db().posts, ...api.db().stories].some(candidate =>
          Array.isArray(candidate.media) ? candidate.media.includes(item) : candidate.media === item
        );
        if (!referenced) {
          try { await deleteLocalMedia(item); }
          catch (error) { cleanupFailed = true; console.warn("Deleted post media could not be cleared from device storage.", error); }
        }
      }
      if (onDeleted) onDeleted(post);
      else { viewer = null; render(); }
      toast(cleanupFailed ? "Post deleted. Some device media could not be cleared." : "Post deleted");
    } catch (error) {
      if (api.me()?.id === owner) toast(error.message || "The post could not be deleted.");
      if (button.isConnected) button.disabled = false;
    }
  });
}

function bindPosts() {
  mountRepostAffordances(app);
  app.querySelectorAll("article.clip").forEach(element=>{
    if(element.querySelector("video"))return;
    const item=api.post(element.dataset.id);if(item)trackQualifiedView(item,element,tab==="communities"?"community":"feed");
  });
  observeVideos();
  void hydrateLocalMedia(app);
  mountCreativeViewers(app, { onSource: openPostViewer, muted });
  app.querySelectorAll("[data-audio-open]").forEach(button => button.onclick = event => {
    event.stopPropagation();
    openAudioPanel({
      postId: button.dataset.audioOpen, sheet: $("#sheet"), esc, icons: ic, toast, onClose: render,
      onPosted: () => { tab = "updates"; profileId = null; viewer = null; render(); }
    });
  });
  app.querySelectorAll("[data-like]").forEach(b => b.onclick = (e) => { e.stopPropagation(); like(b.dataset.like); });
  bindPostDeleteActions();
  app.querySelectorAll("[data-save]").forEach(b => b.onclick = (e) => { e.stopPropagation(); save(b.dataset.save); });
  app.querySelectorAll("[data-comment]").forEach(b => b.onclick = (e) => { e.stopPropagation(); comments(b.dataset.comment); });
  app.querySelectorAll("[data-share]").forEach(b => b.onclick = (e) => { e.stopPropagation(); void sharePost(b.dataset.share); });
  app.querySelectorAll("[data-repost]").forEach(b => b.onclick = (e) => { e.stopPropagation(); repost(b.dataset.repost); });
  app.querySelectorAll("[data-repost-note]").forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    openRepostNote(b.dataset.repostNote, { esc, toast, onSaved: () => render() });
  });
  app.querySelectorAll("[data-follow]").forEach(b => b.onclick = (e) => { e.stopPropagation(); follow(b.dataset.follow); });
  app.querySelectorAll("[data-place-explore]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    nearbyLocationRequestId++;
    nearbyCity = b.dataset.placeExplore || "all";
    homeView = "nearby";
    homeTopic = "all";
    render();
  });
  app.querySelectorAll("[data-avatar-profile]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    openPersonAvatar(b.dataset.avatarProfile);
  });
  app.querySelectorAll("[data-profile]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    navigateToProfile(b.dataset.profile);
  });
  app.querySelectorAll("[data-dot]").forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    const [id, n] = b.dataset.dot.split(":");
    carouselIndex[id] = +n;
    const canvas = b.closest(".clip")?.querySelector("canvas[data-creative-carousel]");
    if (canvas) canvas.dispatchEvent(new CustomEvent("creative-carousel-index", { detail: +n }));
    else render();
  });
  app.querySelectorAll("[data-caption-toggle]").forEach(button => button.onclick = event => {
    event.stopPropagation();
    const expanded = button.getAttribute("aria-expanded") === "true";
    const body = button.parentElement?.querySelector("[data-caption-content]");
    if (!body) return;
    body.classList.toggle("is-expanded", !expanded);
    body.classList.toggle("is-collapsed", expanded);
    button.setAttribute("aria-expanded", String(!expanded));
    button.textContent = expanded ? "See more" : "See less";
    expandedCaptions[button.dataset.captionToggle] = !expanded;
  });
  app.querySelectorAll("[data-post-carousel]").forEach(stage => {
    let start = null;
    stage.onpointerdown = event => { start = { x: event.clientX, y: event.clientY }; };
    stage.onpointercancel = () => { start = null; };
    stage.onpointerup = event => {
      if (!start) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      start = null;
      if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
      const id = stage.dataset.postCarousel, count = Number(stage.dataset.count) || 1;
      carouselIndex[id] = Math.max(0, Math.min(count - 1, (carouselIndex[id] || 0) + (dx < 0 ? 1 : -1)));
      stage.dataset.suppressClickUntil = String(Date.now() + 350);
      event.preventDefault(); event.stopPropagation(); render();
    };
    stage.addEventListener("click", event => {
      if (Date.now() < Number(stage.dataset.suppressClickUntil || 0)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  });
  app.querySelectorAll("[data-mute]").forEach(b => b.onclick = (e) => { e.stopPropagation(); muted = !muted; render(); });
  app.querySelectorAll("[data-dbl]").forEach(el => {
    let lastTap = 0;
    let singleTapTimer = null;
    el.onclick = event => {
      event.preventDefault();
      const now = Date.now();
      if (now - lastTap <= 320) {
        clearTimeout(singleTapTimer);
        lastTap = 0;
        const clip = el.closest(".clip");
        const bounds = clip?.getBoundingClientRect();
        const x = bounds ? Math.max(24, Math.min(bounds.width - 24, event.clientX - bounds.left)) : 0;
        const y = bounds ? Math.max(48, Math.min(bounds.height - 48, event.clientY - bounds.top)) : 0;
        like(el.dataset.dbl, true, false);
        showPostHeart(el.dataset.dbl, x, y);
        return;
      }
      lastTap = now;
      singleTapTimer = window.setTimeout(() => {
        lastTap = 0;
        if (el instanceof HTMLVideoElement && el.isConnected) {
          if (el.paused) el.play().catch(() => {});
          else el.pause();
        }
      }, 320);
    };
  });
}
function showPostHeart(id, x, y) {
  const clip = [...app.querySelectorAll(".clip")].find(item => item.dataset.id === id);
  if (!clip) return;
  const heart = document.createElement("span");
  heart.className = "post-heart-burst";
  heart.style.left = `${x || clip.clientWidth / 2}px`;
  heart.style.top = `${y || clip.clientHeight / 2}px`;
  heart.innerHTML = ic.heartOn;
  heart.setAttribute("aria-hidden", "true");
  clip.appendChild(heart);
  window.setTimeout(() => heart.remove(), 1050);
}
async function like(id, forceLike = null, rerender = true) {
  const me = api.me();
  const cloudPost = api.cloudPost(id);
  if (cloudPost) {
    const wasLiked = cloudPost.likes.includes(me.id);
    const shouldLike = forceLike === null ? !wasLiked : forceLike;
    if (shouldLike === wasLiked) return;
    try {
      await api.setCloudLike(id, shouldLike);
      if(shouldLike)recordActivity("like",cloudPost);
      if (rerender) render();
      else {
        const updated = api.cloudPost(id);
        if(updated)updateLikesRow(updated);
        app.querySelectorAll("[data-like]").forEach(button => {
          if (button.dataset.like !== id) return;
          const liked = updated?.likes.includes(me.id) || false;
          button.classList.toggle("on", liked);
          button.setAttribute("aria-pressed", String(liked));
          button.innerHTML = `${liked ? ic.heartOn : ic.heart}${fmt(updated?.likeCount || 0)}`;
        });
      }
    } catch (error) {
      toast(error.message || "Couldn’t update this like");
    }
    return;
  }
  mutate(db => {
    const p = db.posts.find(x => x.id === id);
    if (!p) return;
    const i = p.likes.indexOf(me.id);
    const shouldLike = forceLike === null ? i < 0 : forceLike;
    if (shouldLike && i < 0) {
      p.likes.push(me.id);
      recordActivity("like",p);
      (p.tags || []).forEach(t => db.interests[t] = (db.interests[t] || 0) + 1);
      if (p.author !== me.id) notify(db, { id: "n" + Date.now(), user: p.author, kind: "like", actor: me.id, post: id, body: "liked your post", created: Date.now(), read: false });
    } else if (!shouldLike && i >= 0) p.likes.splice(i, 1);
  });
  if (rerender) render();
  else {
    const post = api.db().posts.find(item => item.id === id);
    if(post)updateLikesRow(post);
    app.querySelectorAll("[data-like]").forEach(button => {
      if (button.dataset.like !== id) return;
      const liked = post?.likes.includes(me.id) || false;
      button.classList.toggle("on", liked);
      button.setAttribute("aria-pressed", String(liked));
      button.innerHTML = `${liked ? ic.heartOn : ic.heart}${fmt(post?.likes.length || 0)}`;
    });
  }
}
function save(id) {
  showSocialSheet(id, "saved");
}
function showSocialSheet(id, mode, options = {}) {
  openSocialSheet({
    id, mode, commentId: options.commentId || "", sheet: $("#sheet"), esc, icons: ic, toast,
    onClose: options.onClose || render,
    onExternal: sharePostExternally,
    onStory: addSharedContentToStory,
    onRepost: repost,
  });
}
async function follow(id) {
  const me = api.me();
  const u = api.user(id);
  const wasFollowing=me.following.includes(id);
  if (api.blocked(me.id, id)) return toast("Unblock this user before following");
  if (api.authMode() === "cloud") {
    try {
      await api.refreshCloudRelationships();
      const current = api.me();
      const following = current.following.includes(id);
      const requested = api.db().requests.some(request => request.from === current.id && request.to === id);
      await api.setCloudFollow(id, !following && !requested);
      const nowFollowing = api.me().following.includes(id);
      const nowRequested = api.db().requests.some(request => request.from === api.me().id && request.to === id);
      render();
      toast(nowFollowing ? "Following" : nowRequested ? "Follow request sent" : wasFollowing ? "Unfollowed" : "Follow request canceled");
    } catch (error) {
      toast(error.message || "Follow settings could not be updated.");
    }
    return;
  }
  mutate(db => {
    const meU = db.users.find(x => x.id === me.id);
    const them = db.users.find(x => x.id === id);
    if (meU.following.includes(id)) {
      meU.following = meU.following.filter(x => x !== id);
      them.followers = them.followers.filter(x => x !== me.id);
      db.requests = db.requests.filter(r => !(r.from === me.id && r.to === id));
    } else if (them.private) {
      if (db.requests.some(r => r.from === me.id && r.to === id)) db.requests = db.requests.filter(r => !(r.from === me.id && r.to === id));
      else db.requests.push({ from: me.id, to: id, at: Date.now() });
    } else {
      meU.following.push(id); them.followers.push(me.id);
      notify(db, { id: "n" + Date.now(), user: id, kind: "follow", actor: me.id, body: "started following you", created: Date.now(), read: false });
    }
  });
  if(!u.private)recordActivity(api.me().following.includes(id)?"follow":"unfollow",{author:id,id:null},"profile");
  render();
  const following=api.me().following.includes(id);
  const requested=api.db().requests.some(r=>r.from===me.id&&r.to===id);
  toast(following?"Following":requested?"Requested":wasFollowing?"Unfollowed":"Follow request canceled");
}
async function friend(id) {
  const me = api.me();
  const them = api.user(id);
  if (!them || them.id === me.id || api.blocked(me.id, them.id)) {
    return toast("Unblock this user before adding them as a Friend");
  }
  if (api.authMode() === "cloud") {
    try {
      await api.refreshCloudRelationships();
      if (api.areFriends(me.id, them.id)) {
        if (!confirm(`Remove @${them.username} from Friends?`)) return;
        await api.removeCloudFriend(them.id);
        render();
        toast("Friend removed");
        return;
      }
      const incoming = api.db().friendRequests.some(request => request.from === them.id && request.to === me.id);
      const outgoing = api.db().friendRequests.some(request => request.from === me.id && request.to === them.id);
      if (incoming) {
        await api.respondCloudFriendRequest(them.id, true);
        render();
        toast("You’re now Friends");
      } else if (outgoing) {
        await api.respondCloudFriendRequest(them.id, false);
        render();
        toast("Friend request canceled");
      } else {
        const status = await api.sendCloudFriendRequest(them.id);
        render();
        toast(status === "friends" ? "You’re now Friends" : "Friend request sent");
      }
    } catch (error) {
      toast(error.message || "Friend settings could not be updated.");
    }
    return;
  }
  const alreadyFriends = api.areFriends(me.id, them.id);
  if (alreadyFriends && !confirm(`Remove @${them.username} from Friends?`)) return;
  let message = "Friend request sent";
  mutate(db => {
    db.friendRequests = Array.isArray(db.friendRequests) ? db.friendRequests : [];
    const current = db.users.find(user => user.id === me.id);
    const other = db.users.find(user => user.id === them.id);
    if (!current || !other) return;
    current.friends = Array.isArray(current.friends) ? current.friends : [];
    other.friends = Array.isArray(other.friends) ? other.friends : [];
    const outgoing = db.friendRequests.some(request => request.from === me.id && request.to === them.id);
    const incoming = db.friendRequests.some(request => request.from === them.id && request.to === me.id);
    if (alreadyFriends) {
      current.friends = current.friends.filter(friendId => friendId !== them.id);
      other.friends = other.friends.filter(friendId => friendId !== me.id);
      message = "Friend removed";
    } else if (incoming) {
      if (!current.friends.includes(them.id)) current.friends.push(them.id);
      if (!other.friends.includes(me.id)) other.friends.push(me.id);
      db.friendRequests = db.friendRequests.filter(request =>
        !((request.from === me.id && request.to === them.id) || (request.from === them.id && request.to === me.id))
      );
      notify(db, { id: "n" + Date.now(), user: them.id, kind: "friend-accepted", actor: me.id, body: "accepted your Friend request", created: Date.now(), read: false });
      message = "You’re now Friends";
    } else if (outgoing) {
      db.friendRequests = db.friendRequests.filter(request => !(request.from === me.id && request.to === them.id));
      message = "Friend request canceled";
    } else {
      db.friendRequests.push({ from: me.id, to: them.id, at: Date.now() });
      notify(db, { id: "n" + Date.now(), user: them.id, kind: "friend-request", actor: me.id, body: "sent you a Friend request", created: Date.now(), read: false });
    }
  });
  render();
  toast(message);
}
async function toggleCloseFriend(id) {
  const me = api.me();
  const target = api.user(id);
  if (!target || target.id === me.id || api.blocked(me.id, target.id)) {
    return toast("Unblock this user before adding them to Close Friends");
  }
  if (api.authMode() === "cloud") {
    try {
      await Promise.all([api.refreshCloudCloseFriends(), api.refreshCloudBlocks()]);
      const selected = new Set(api.cloudCloseFriends());
      if (selected.has(target.id)) selected.delete(target.id);
      else selected.add(target.id);
      await api.replaceCloudCloseFriends([...selected]);
      render();
      toast(selected.has(target.id) ? "Added to Close Friends" : "Removed from Close Friends");
    } catch (error) {
      toast(error.message || "Close Friends could not be updated.");
    }
    return;
  }
  if (!api.areFriends(me.id, target.id)) return toast("Become Friends first before adding them to Close Friends");
  let added = false;
  mutate(db => {
    const current = db.users.find(user => user.id === me.id);
    current.closeFriends = Array.isArray(current.closeFriends) ? current.closeFriends : [];
    const index = current.closeFriends.indexOf(target.id);
    if (index >= 0) current.closeFriends.splice(index, 1);
    else { current.closeFriends.push(target.id); added = true; }
  });
  render();
  toast(added ? "Added to Close Friends" : "Removed from Close Friends");
}
async function respondToFriendRequest(from, accept) {
  const me = api.me();
  if (api.authMode() === "cloud") {
    try {
      await api.respondCloudFriendRequest(from, accept);
      render();
      toast(accept ? "Friend request accepted" : "Friend request declined");
    } catch (error) {
      toast(error.message || "Friend request could not be updated.");
    }
    return;
  }
  mutate(db => {
    db.friendRequests = Array.isArray(db.friendRequests) ? db.friendRequests : [];
    const request = db.friendRequests.find(item => item.from === from && item.to === me.id);
    const other = db.users.find(user => user.id === from);
    const current = db.users.find(user => user.id === me.id);
    if (request && accept && other && current) {
      current.friends = Array.isArray(current.friends) ? current.friends : [];
      other.friends = Array.isArray(other.friends) ? other.friends : [];
      if (!current.friends.includes(from)) current.friends.push(from);
      if (!other.friends.includes(me.id)) other.friends.push(me.id);
      notify(db, { id: "n" + Date.now(), user: from, kind: "friend-accepted", actor: me.id, body: "accepted your Friend request", created: Date.now(), read: false });
    }
    db.friendRequests = db.friendRequests.filter(item => !(item.from === from && item.to === me.id));
  });
  render();
}
function sharePost(id) {
  showSocialSheet(id, "share");
}
async function sharePostExternally(id, commentId = "", action = "external") {
  const p = api.post(id);
  if (!p || !api.canSeePost(p)) return toast("Post unavailable");
  const author = api.user(p.author);
  const link = new URL(location.pathname, location.origin);
  link.searchParams.set("post", id);
  const comment = findSharedComment(p, commentId);
  if (commentId && !comment) throw new Error("Comment unavailable.");
  if (commentId) link.searchParams.set("comment", commentId);
  const text = comment
    ? `@${api.user(comment.author)?.username || "member"}: ${comment.body || "Photo comment"}`
    : p.caption?.trim() || `Check out @${author?.username || "someone"}'s post on Oldtime.`;
  if (action === "copylink") {
    if (!await copyShareLink(link.href)) throw new Error("Couldn't copy this link.");
    toast(commentId ? "Comment link copied" : "Post link copied");
    return {completed:true,kind:"copied"};
  }
  const result = await shareExternally({
    title: commentId ? "Oldtime comment" : `@${author?.username || "someone"} on Oldtime`,
    text,
    url: link.href
  });
  if (result === "cancelled") return;
  if (result === "failed") return toast("Couldn't share this post");
  if (result === "shared") {
    recordActivity("share",p,"shared-link");
    const me = api.me();
    mutate(db => {
      const post = db.posts.find(item => item.id === id);
      if (!post) return;
      post.shares = (post.shares || 0) + 1;
      if (post.author !== me.id) notify(db, { id: "n" + Date.now(), user: post.author, kind: "share", actor: me.id, post: id, body: "shared your post", created: Date.now(), read: false });
    });
  }
  toast(result === "shared" ? (commentId ? "Comment shared" : "Post shared") : (commentId ? "Comment link copied" : "Post link copied"));
  return {completed:true,kind:result==="shared"?"shared":"copied"};
}
function addSharedContentToStory(id, commentId = "") {
  const post = api.post(id);
  if (!post || !api.canSeePost(post)) throw new Error("Post unavailable.");
  const comment = findSharedComment(post, commentId);
  if (commentId && !comment) throw new Error("Comment unavailable.");
  // Sharing must not turn another person's restricted content into a public snapshot.
  if (post.author !== api.me().id && !api.canSeePost(post, null)) throw new Error("Only public posts can be added to your status.");
  queueMicrotask(() => openCommentCreative(id, commentId, "story", false, render));
  return true;
}
const pendingRepostRequests = new Set();
async function repost(id) {
  if (pendingRepostRequests.has(id)) return false;
  const me = api.me(), post = api.post(id);
  if (!me || !post || !post.cloud) {
    toast("This post hasn’t been uploaded yet. Only online posts can be reposted.");
    return false;
  }
  const remove = Boolean(post.repostedByMe) || (post.reposts || []).includes(me.id);
  pendingRepostRequests.add(id);
  try {
    await api.setCloudRepost(id, !remove, post.repostNote || post.repostNotes?.[me.id] || "");
    if (api.me()?.id !== me.id) return false;
    render();
    return true;
  } catch (error) {
    if (api.me()?.id === me.id) toast(error.message || "Could not save your repost.");
    return false;
  } finally {
    pendingRepostRequests.delete(id);
  }
}

function openCommentCreative(postId, commentId, destination = "post", startCamera = false, onClose = () => comments(postId, commentId)) {
  const sheet = $("#sheet");
  sheet.classList.remove("on"); sheet.innerHTML = ""; sheet.onclick = null; sheet.onkeydown = null;
  openCreativeEditor({ postId, commentId, destination, startCamera, esc, icons: ic, toast,
    onClose,
    onPosted: (id, story) => {
      tab = "updates"; profileId = null; viewer = null; render();
      if (story) openStory(api.me().id); else openPostViewer(id);
    }
  });
}
function comments(id, focusedCommentId = "") {
  const sheet = $("#sheet");
  if (api.cloudPost(id)) {
    const trigger = document.activeElement;
    return openCloudComments(id, {
      sheet, esc, icons: ic, toast, openEmojiPicker,
      onClose: () => { trigger?.focus?.(); },
      onCountChange: count => app.querySelectorAll("[data-comment]").forEach(button => {
        if (button.dataset.comment === id) button.innerHTML = `${ic.comment}<span>${fmt(count)}</span>`;
      }),
    });
  }
  const trigger = document.activeElement;
  let searchText = "";
  let sortMode = "top";
  let actionLayer = null;
  const expandedReplies = new Set();
  const totalCount = comments => comments.reduce((total, comment) => total + 1 + (comment.replies || []).length, 0);
  const close = () => {
    actionLayer?.remove();
    actionLayer = null;
    sheet.classList.remove("on");
    sheet.innerHTML = "";
    sheet.onclick = null;
    sheet.onkeydown = null;
    if (trigger?.isConnected) trigger.focus();
  };
  function showCommentActions(commentId, triggerButton) {
    const post = api.post(id);
    const comment = findSharedComment(post, commentId);
    if (!comment) return;
    actionLayer?.remove();
    const author = api.user(comment.author) || { username: "member" };
    const key = `${id}:${comment.id}`;
    const isFavorite = Array.isArray(api.me().commentFavorites) && api.me().commentFavorites.includes(key);
    const body = `@${author.username}: ${comment.body || "Photo comment"}`;
    const commentPanel = $(".comment-panel", sheet);
    commentPanel?.setAttribute("aria-hidden", "true");
    if (commentPanel) commentPanel.inert = true;
    actionLayer = document.createElement("div");
    actionLayer.className = "comment-action-overlay";
    actionLayer.innerHTML = `<section class="comment-action-panel" role="dialog" aria-modal="true" aria-label="Comment actions" tabindex="-1">
      <div class="grab" aria-hidden="true"></div>
      <header class="comment-action-header"><h2>Comment actions</h2><button type="button" data-action-close aria-label="Close comment actions">${ic.close}</button></header>
      <div class="comment-action-preview"><b>@${esc(author.username)}</b><span>${esc(comment.body || "Photo comment")}</span></div>
      <div class="comment-action-list">
        <button type="button" data-action-remix>Remix</button>
        <button type="button" data-action-video>Reply with video</button>
        <button type="button" data-action-story>Share to Status</button>
        <button type="button" data-action-share>Share comment</button>
        <button type="button" data-action-copy>Copy comment</button>
        <button type="button" data-action-favorite>${isFavorite ? "Remove from Favorites" : "Add to Favorites"}</button>
        <button type="button" data-action-report>Report comment</button>
      </div>
      <p class="comment-action-note">Reports are not sent to moderation.</p>
    </section>`;
    sheet.appendChild(actionLayer);
    const dialog = $(".comment-action-panel", actionLayer);
    const dismiss = () => {
      actionLayer?.remove();
      actionLayer = null;
      if (commentPanel?.isConnected) {
        commentPanel.removeAttribute("aria-hidden");
        commentPanel.inert = false;
      }
      if (triggerButton?.isConnected) triggerButton.focus();
    };
    $("[data-action-close]", actionLayer).onclick = dismiss;
    actionLayer.onclick = event => { if (event.target === actionLayer) dismiss(); };
    $("[data-action-story]", actionLayer).onclick = () => {
      dismiss(); close(); openCommentCreative(id, comment.id, "story");
    };
    $("[data-action-remix]", actionLayer).onclick = () => { dismiss(); close(); openCommentCreative(id, comment.id); };
    $("[data-action-video]", actionLayer).onclick = () => { dismiss(); close(); openCommentCreative(id, comment.id, "post", true); };
    $("[data-action-share]", actionLayer).onclick = () => {
      dismiss();
      close();
      showSocialSheet(id, "share", { commentId, onClose: () => comments(id, commentId) });
    };
    $("[data-action-copy]", actionLayer).onclick = async () => {
      try {
        const copied = await copyShareLink(body);
        toast(copied ? "Comment copied." : "Couldn’t copy comment.");
        if (copied) dismiss();
      } catch (error) { toast(error.message || "Couldn’t copy comment."); }
    };
    $("[data-action-favorite]", actionLayer).onclick = () => {
      try {
        mutate(db => {
          const me = db.users.find(user => user.id === api.me().id);
          me.commentFavorites = Array.isArray(me.commentFavorites) ? me.commentFavorites : [];
          me.commentFavorites = me.commentFavorites.includes(key) ? me.commentFavorites.filter(item => item !== key) : [...me.commentFavorites, key];
        });
        const saved = (api.me().commentFavorites || []).includes(key);
        toast(saved ? "Saved to Favorites" : "Removed from Favorites");
        dismiss();
        drawList();
        [...$("#clist", sheet).querySelectorAll("[data-cmore]")].find(button => button.dataset.cmore === commentId)?.focus();
      } catch (error) { toast(error.message || "Couldn’t update Favorites."); }
    };
    $("[data-action-report]", actionLayer).onclick = async () => {
      try {
        const author = api.user(comment.author);
        const targetUserId = author?.cloudAccountId || comment.author;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUserId)) {
          throw new Error("This comment is not linked to an online account, so it cannot be reported.");
        }
        await api.submitCloudReport({
          kind: "comment",
          category: "Comment",
          targetUserId,
          postId: String(id),
          commentId: String(comment.id),
          reason: "Reported comment for review.",
        });
        toast("Report received by Oldtime. Review status is not available yet.");
        dismiss();
      } catch (error) { toast(error.message || "Couldn’t save this report."); }
    };
    dialog.onkeydown = event => {
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll("button:not([disabled])")];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable.at(-1).focus();
      } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
        event.preventDefault();
        focusable[0].focus();
      }
    };
    dialog.focus();
  }
  const drawList = () => {
    const post = api.post(id);
    if (!post || !api.canSeePost(post)) return close();
    const list = $("#clist", sheet);
    const visibleComments = [...(post.comments || [])]
      .filter(comment => {
        const author = api.user(comment.author);
        const text = `${author?.username || ""} ${author?.name || ""} ${comment.body || ""}`.toLowerCase();
        return !searchText || text.includes(searchText);
      })
      .sort((a, b) => sortMode === "top"
        ? ((b.likes || []).length - (a.likes || []).length) || (b.created || 0) - (a.created || 0)
        : (b.created || 0) - (a.created || 0));
    $("#comment-count", sheet).textContent = `${totalCount(post.comments || [])} ${totalCount(post.comments || []) === 1 ? "comment" : "comments"}`;
    $("#comment-sort-label", sheet).textContent = sortMode === "top" ? "Top" : "Newest";
    list.innerHTML = visibleComments.map(comment => {
      const author = api.user(comment.author) || { username: "member", avatar: "" };
      const replies = comment.replies || [];
      const expanded = expandedReplies.has(comment.id);
      const liked = (comment.likes || []).includes(api.me().id);
      const disliked = (comment.dislikes || []).includes(api.me().id);
      const commentDate = comment.created ? new Date(comment.created) : null;
      const dateLabel = commentDate ? `${commentDate.getMonth() + 1}-${String(commentDate.getDate()).padStart(2, "0")}` : ago(comment.created);
      const replyMarkup = replies.map(reply => {
        const replyAuthor = api.user(reply.author) || { username: "member", avatar: "" };
        return `<div class="comment-reply" id="reply-${esc(reply.id)}">
          <img src="${esc(replyAuthor.avatar)}" alt="" class="comment-reply-avatar" />
          <div class="comment-reply-content"><b>@${esc(replyAuthor.username)}</b><span>${esc(reply.body)}</span>
            ${reply.attachment?.url ? `<img class="comment-attachment" src="${esc(reply.attachment.url)}" alt="Photo attached to reply" loading="lazy" />` : ""}
            <small>${ago(reply.created)} <button type="button" data-cmore="${esc(reply.id)}" aria-label="Reply actions">${ic.more}</button> ${reply.author === api.me().id ? `<button type="button" data-rdel="${esc(comment.id)}:${esc(reply.id)}">Delete</button>` : ""}</small>
          </div>
        </div>`;
      }).join("");
      const favoriteKey = `${id}:${comment.id}`;
      const isFavorite = Array.isArray(api.me().commentFavorites) && api.me().commentFavorites.includes(favoriteKey);
      return `<article class="comment-item" id="comment-${esc(comment.id)}">
        <img class="comment-avatar" src="${esc(author.avatar)}" alt="" loading="lazy" />
        <div class="comment-content">
          <div class="comment-body"><b>@${esc(author.username)}${blueBadgeMarkup(author.cloudAccountId || author.id, esc)}</b><span>${esc(comment.body)}</span></div>
          ${comment.attachment?.url ? `<img class="comment-attachment" src="${esc(comment.attachment.url)}" alt="Photo attached to comment" loading="lazy" />` : ""}
          <div class="comment-footer">
            <span class="comment-date">${dateLabel}</span>
            <button type="button" class="comment-reply-action" data-reply="${esc(comment.id)}">Reply</button>
            <span class="comment-votes">
               <button type="button" class="comment-vote ${liked ? "on" : ""}" data-clike="${esc(comment.id)}" aria-label="${liked ? "Unlike" : "Like"} comment" aria-pressed="${liked}">${ic.heart}<small>${(comment.likes || []).length || ""}</small></button>
               <button type="button" class="comment-vote ${disliked ? "on" : ""}" data-cdislike="${esc(comment.id)}" aria-label="${disliked ? "Remove dislike" : "Dislike"} comment" aria-pressed="${disliked}"><svg viewBox="0 0 24 24" aria-hidden="true"><path transform="rotate(180 12 12)" d="M7 10v11H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3Zm0 0 4-8c1.5 0 2.5 1 2.5 2.5L13 9h6.2a2 2 0 0 1 2 2.4l-1.4 8a2 2 0 0 1-2 1.6H7V10Z"/></svg></button>
            </span>
            <button type="button" class="comment-more" data-cmore="${esc(comment.id)}" aria-label="Comment actions">${ic.more}</button>
            <button type="button" class="comment-share-action" data-comment-share="${esc(comment.id)}" aria-label="Share comment">${ic.share}</button>
            ${comment.author === api.me().id || post.author === api.me().id ? `<button type="button" class="comment-delete" data-cdel="${esc(comment.id)}">Delete</button>` : ""}
          </div>
          ${replies.length ? `<button type="button" class="comment-view-replies" data-toggle-replies="${esc(comment.id)}" aria-expanded="${expanded}">${expanded ? "Hide" : "View"} ${replies.length} ${replies.length === 1 ? "reply" : "replies"}</button>` : ""}
          ${expanded ? `<div class="comment-replies">${replyMarkup}</div>` : ""}
        </div>
      </article>`;
    }).join("") || `<div class="comment-empty">${searchText ? "No comments match your search." : "No comments yet. Start the conversation."}</div>`;
    list.querySelectorAll("[data-comment-share]").forEach(button => button.onclick = () => {
      const commentId = button.dataset.commentShare;
      close();
      showSocialSheet(id, "share", { commentId, onClose: () => comments(id, commentId) });
    });
    list.querySelectorAll("[data-reply]").forEach(button => button.onclick = () => {
      const comment = (api.post(id)?.comments || []).find(item => item.id === button.dataset.reply);
      if (!comment) return;
      const author = api.user(comment.author);
      const input = $("#cbody", sheet);
      input.value = author ? `@${author.username} ` : "";
      input.dataset.reply = comment.id;
      input.placeholder = `Reply to @${author?.username || "member"}`;
      input.focus();
    });
    list.querySelectorAll("[data-cmore]").forEach(button => button.onclick = () => showCommentActions(button.dataset.cmore, button));
    list.querySelectorAll("[data-toggle-replies]").forEach(button => button.onclick = () => {
      const commentId = button.dataset.toggleReplies;
      if (expandedReplies.has(commentId)) expandedReplies.delete(commentId);
      else expandedReplies.add(commentId);
      drawList();
    });
    void hydrateBlueBadges(sheet);
    list.querySelectorAll("[data-clike]").forEach(button => button.onclick = async () => {
      button.disabled = true;
      try { await api.setCloudPostCommentReaction(id, button.dataset.clike, "like"); drawList(); }
      catch (error) { toast(error.message || "Couldn’t update the comment reaction online."); }
      finally { button.disabled = false; }
    });
    list.querySelectorAll("[data-cdislike]").forEach(button => button.onclick = async () => {
      button.disabled = true;
      try { await api.setCloudPostCommentReaction(id, button.dataset.cdislike, "dislike"); drawList(); }
      catch (error) { toast(error.message || "Couldn’t update the comment reaction online."); }
      finally { button.disabled = false; }
    });
    list.querySelectorAll("[data-cdel]").forEach(button => button.onclick = async () => {
      button.disabled = true;
      try { await api.deleteCloudPostComment(id, button.dataset.cdel); }
      catch (error) { toast(error.message || "Couldn’t delete the comment online."); return; }
      expandedReplies.delete(button.dataset.cdel);
      drawList();
    });
    list.querySelectorAll("[data-rdel]").forEach(button => button.onclick = async () => {
      const [commentId, replyId] = button.dataset.rdel.split(":");
      try { await api.deleteCloudPostComment(id, replyId); }
      catch (error) { toast(error.message || "Couldn’t delete the reply online."); return; }
      drawList();
    });
  };
  sheet.classList.add("on");
  const draw = () => {
    const p = api.post(id);
    if (!p || !api.canSeePost(p)) return close();
    const previousBody = $("#cbody", sheet)?.value || "";
    const previousReply = $("#cbody", sheet)?.dataset.reply || "";
    sheet.innerHTML = `<section class="panel comment-panel" role="dialog" aria-modal="true" aria-label="Comments">
      <div class="grab" aria-hidden="true"></div>
      <div class="comment-toolbar">
        <label class="comment-search-wrap">${ic.search}<input id="comment-search" type="search" placeholder="Search comments" aria-label="Search comments" value="${esc(searchText)}" /></label>
        <button type="button" class="comment-sort" id="comment-sort" aria-label="Sort comments"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4v16m0 0-4-4m4 4 4-4M16 20V4m0 0 4 4m-4-4-4 4"/></svg><span id="comment-sort-label"></span></button>
        <button type="button" class="comment-close" id="comment-close" aria-label="Close comments">${ic.close}</button>
      </div>
      <div class="comment-count" id="comment-count"></div>
      <div class="comment-list" id="clist" aria-label="Comments"></div>
      <form id="cform" class="comment-composer">
        <img class="comment-composer-avatar" src="${esc(api.me().avatar)}" alt="" />
        <div class="comment-composer-pill">
          <input class="comment-input" id="cbody" value="${esc(previousBody)}" data-reply="${esc(previousReply)}" placeholder="${previousReply ? "Write a reply" : "Add a comment..."}" autocomplete="off" aria-label="${previousReply ? "Write a reply" : "Add a comment"}" />
          <button type="button" class="comment-tool" id="comment-photo" aria-label="Photo comments unavailable">${ic.image || ic.camera}</button>
          <button type="button" class="comment-tool" id="comment-mention" aria-label="Mention someone">@</button>
          <button type="button" class="comment-tool" id="comment-emoji" aria-label="Add emoji">${ic.smile}</button>
        </div>
        <button class="comment-send" type="submit" aria-label="Send comment">${ic.send}</button>
      </form>
    </section>`;
    $("#comment-search", sheet).oninput = event => { searchText = event.target.value.trim().toLowerCase(); drawList(); };
    $("#comment-sort", sheet).onclick = () => { sortMode = sortMode === "top" ? "newest" : "top"; drawList(); };
    $("#comment-close", sheet).onclick = close;
    $("#comment-photo", sheet).onclick = () => toast("Photo comments are unavailable until cloud attachment storage is connected.");
    $("#comment-emoji", sheet).onclick = () => openEmojiPicker($("#cbody", sheet), undefined, { chat: true });
    $("#comment-mention", sheet).onclick = () => {
      const input = $("#cbody", sheet);
      const start = input.selectionStart ?? input.value.length;
      input.setRangeText("@", start, input.selectionEnd ?? start, "end");
      input.focus();
    };
    $("#cform", sheet).onsubmit = async e => {
      e.preventDefault();
      const input = $("#cbody", sheet);
      const body = input.value.trim();
      if (!body) return input.focus();
      const parent = input.dataset.reply;
      const send = $("#cform button[type=submit]", sheet);
      send.disabled = true;
      try {
        await api.createCloudPostComment(id, { body, parentId: parent || null });
        input.value = "";
        delete input.dataset.reply;
        input.placeholder = "Add a comment...";
        searchText = "";
        $("#comment-search", sheet).value = "";
        drawList();
        $("#cbody", sheet).focus();
      } catch (error) { toast(error.message || "Couldn’t add your comment online."); }
      finally { send.disabled = false; }
    };
    drawList();
    sheet.onclick = event => { if (event.target === sheet) close(); };
    sheet.onkeydown = event => {
      if (event.key !== "Escape") return;
      if (actionLayer) {
        event.stopPropagation();
        $("[data-action-close]", actionLayer)?.click();
      } else close();
    };
  };
  draw();
  if (api.cloudPost(id)) {
    void api.loadCloudPostComments(id).then(() => {
      if (sheet.classList.contains("on")) drawList();
    }).catch(error => toast(error.message || "Comments could not be loaded online."));
  }
  if (focusedCommentId) {
    const source = api.post(id);
    const parent = source?.comments?.find(comment => comment.replies?.some(reply => reply.id === focusedCommentId));
    if (parent) { expandedReplies.add(parent.id); drawList(); }
    const target = document.getElementById(`comment-${focusedCommentId}`) || document.getElementById(`reply-${focusedCommentId}`);
    if (target) {
      target.classList.add("shared-comment-highlight");
      target.setAttribute("tabindex", "-1");
      target.scrollIntoView?.({ block: "center" });
      target.focus({ preventScroll: true });
    } else toast("Comment unavailable");
  }
}

function openStory(authorId, storyId = null) {
  const visibleStories = api.stories()
    .filter(s => isStoryActive(s) && api.canSeeStory(s))
    .sort((a, b) => b.created - a.created);
  const targetStory = storyId ? visibleStories.find(story => story.id === storyId) : null;
  if (storyId && !targetStory) return toast("Story unavailable");
  authorId = targetStory?.author || authorId;
  const authors = [...new Set(visibleStories.map(story => story.author))];
  const groups = authors.map(author => ({ author, stories: visibleStories.filter(story => story.author === author) }));
  let groupIndex = groups.findIndex(group => group.author === authorId);
  if (groupIndex < 0) {
    if (authorId !== api.me()?.id) return toast("Story unavailable");
    createKind = "story";
    openCreate([], "story");
    return;
  }
  let list = groups[groupIndex].stories;
  let i = storyId ? Math.max(0, list.findIndex(story => story.id === storyId)) : 0;
  const view = $("#storyview");
  view.classList.add("on");
  let touchOrigin = null;
  let show;
  const close = () => {
    storyUi?.dispose(); storyUi = null;
    view.removeEventListener("touchstart", onTouchStart);
    view.removeEventListener("touchend", onTouchEnd);
    view.classList.remove("on"); view.innerHTML = ""; clearInterval(storyTimer);
  };
  const changeAuthor = direction => {
    const next = groupIndex + direction;
    if (next < 0 || next >= groups.length) return close();
    groupIndex = next;
    list = groups[groupIndex].stories;
    i = direction > 0 ? 0 : list.length - 1;
    show();
  };
  const moveStory = direction => {
    const next = i + direction;
    if (next >= list.length) return changeAuthor(1);
    if (next < 0) return changeAuthor(-1);
    i = next;
    show();
  };
  const onTouchStart = event => {
    if (event.touches.length !== 1 || event.target.closest("button,a,input,textarea,select,.story-bar")) {
      touchOrigin = null;
      return;
    }
    touchOrigin = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  };
  const onTouchEnd = event => {
    if (!touchOrigin || !event.changedTouches.length) return;
    const dx = event.changedTouches[0].clientX - touchOrigin.x;
    const dy = event.changedTouches[0].clientY - touchOrigin.y;
    touchOrigin = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 52) return;
    event.preventDefault();
    event.stopPropagation();
    if (Math.abs(dy) > Math.abs(dx)) changeAuthor(dy < 0 ? 1 : -1);
    else moveStory(dx < 0 ? 1 : -1);
  };
  view.addEventListener("touchstart", onTouchStart, { passive: true });
  view.addEventListener("touchend", onTouchEnd, { passive: false });
  show = async () => {
    clearInterval(storyTimer);
    const s = list[i];
    storyUi?.dispose(); storyUi = null;
    if (!s) { if (groupIndex < groups.length - 1) changeAuthor(1); else close(); return; }
    if (!isStoryActive(s) || !api.canSeeStory(s)) { i++; show(); return; }
    if (s.cloud && s.hasMedia && !s.media) {
      view.innerHTML = `<div class="story-cloud-loading" role="status">Loading Story…</div>`;
      try { s.media = await api.loadCloudStoryMedia(s.id); }
      catch (error) {
        if (list[i] !== s) return;
        toast(error.message || "Story media could not be loaded.");
        i++;
        show();
        return;
      }
      if (list[i] !== s) return;
    }
     const mediaSource = resolveStoryMedia(s, id => api.post(id));
       const author = api.user(s.author) || {};
       const creatorName = author.name || author.displayName || author.username || "Oldtime member";
       const age = ago(s.created || s.createdAt);
       const ageLabel = age === "now" ? "Just now" : `${age} ago`;
       view.innerHTML = `<div class="progress"><b id="bar"></b></div>
        <div class="story-header"><button type="button" id="story-profile" class="story-creator" aria-label="Open ${esc(author.username || "member")} profile"><img src="${esc(author.avatar || "")}" alt="" /><span class="story-creator-copy"><b>${esc(creatorName)}</b><small>${esc(ageLabel)} by ${esc(creatorName)}</small></span></button></div>
        <button type="button" id="sclose" aria-label="Close Story">${ic.close}</button>
          <div class="story-stage" style="background:${esc(s.color || "#000")}">${s.creativeProject ? creativeMediaMarkup(s, esc, true) : mediaSource ? (String(mediaSource).startsWith("data:video") || s.kind === "video" ? `<video class="story-stage-media" src="${esc(mediaSource)}" autoplay muted playsinline></video>` : `<img class="story-stage-media" src="${esc(mediaSource)}" alt="" />`) : `<div class="story-stage-empty" role="status">Text Story</div>`}<div class="story-caption">${esc(s.text || s.caption || "")}${s.creativeProject ? creativeAttribution(s, esc) : ""}</div></div>`;
     const storyStage = view.querySelector(".story-stage");
      storyStage?.classList.toggle("is-text-story", !s.creativeProject && !mediaSource);
     const storyMedia = storyStage?.querySelector(".story-stage-media");
     storyMedia?.addEventListener("error", () => {
       storyMedia.remove();
       storyStage.classList.add("is-media-unavailable");
       const notice = document.createElement("div");
       notice.className = "story-stage-empty";
       notice.setAttribute("role", "status");
       notice.textContent = "Story media unavailable";
       storyStage.prepend(notice);
     }, { once: true });
     if (s.heyWord?.prompt) {
       const starter = api.user(s.heyWord.startedBy || s.author);
       const starterHandle = String(s.heyWord.startedByHandle || starter?.username || "member").replace(/^@/, "");
       const sticker = document.createElement("div");
       sticker.className = "hey-word-story-sticker";
       sticker.innerHTML = `<span class="hey-word-title"><i aria-hidden="true"></i>OLDTIME · OPEN PROMPT</span><span class="hey-word-prompt">${esc(s.heyWord.prompt)}</span>${s.heyWord.creditHidden ? "" : `<span class="hey-word-by">Started by @${esc(starterHandle)}</span>`}`;
       const join = document.createElement("button");
       join.type = "button"; join.className = "hey-word-join"; join.textContent = "Share your take";
       join.setAttribute("aria-label", `Share your take on this story prompt: ${s.heyWord.prompt}`);
       join.onclick = event => {
         event.preventDefault(); event.stopPropagation();
         const sourceOwner = api.user(s.author);
         const publicCredit = s.visibility === "public" && !s.closeFriends && !!sourceOwner && !sourceOwner.private;
         const heyWord = {
           promptId: s.heyWord.promptId || s.id,
           prompt: s.heyWord.prompt,
           sourceStoryId: s.heyWord.sourceStoryId || s.id,
           responseTo: s.id,
           ...(publicCredit && !s.heyWord.creditHidden ? {
             startedBy: s.heyWord.startedBy || s.author,
             startedByName: s.heyWord.startedByName || starter?.name || starterHandle,
             startedByHandle: starterHandle,
           } : { creditHidden: true }),
         };
         close();
         openUniversalCreation({ destination: "story", startCamera: true, heyWord });
       };
       sticker.append(join);
       view.querySelector(".story-stage")?.append(sticker);
       const caption = view.querySelector(".story-caption");
       if (caption) caption.style.bottom = "168px";
     }
    const tournamentHref = tournamentLink(s.creativeProject?.caption || s.caption || s.text || "");
    if (tournamentHref) {
      const link = document.createElement("a");
      link.className = "btn primary"; link.href = tournamentHref; link.textContent = "Open tournament";
      link.style.cssText = "position:absolute;bottom:40px;left:16px;right:16px;z-index:3";
      view.append(link);
    }
    const boardRef = detectBoardLink(s.creativeProject?.caption || s.caption || s.text || "");
    if (boardRef) {
      const href = new URL(location.pathname, location.origin);
      href.searchParams.set("board", boardRef.boardId);
      if (boardRef.entryId) href.searchParams.set("entry", boardRef.entryId);
      const link = document.createElement("a");
      link.className = "btn primary"; link.href = href.href; link.textContent = "Open collection";
      link.style.cssText = "position:absolute;bottom:40px;left:16px;right:16px;z-index:3";
      view.append(link);
    }
    if (s.creativeProject) mountCreativeViewers(view, { onSource: (postId, commentId) => {
      close(); openPostViewer(postId, commentId);
    } });
    trackQualifiedView(s,view.lastElementChild,"content");
    let paused = false;
    const storyVideo = () => view.querySelector("video");
     if (s.cloud && s.author !== api.me()?.id) {
       void api.recordCloudStoryView(s.id).catch(error => {
         if (list[i] === s) toast(error.message || "Story view could not be recorded.");
       });
     }
     storyUi = mountStoryInteractions({
       view,
       story: s,
       api,
       toast,
        avatar: author.avatar || "",
        onProfile: () => {
          $("#sclose")?.click();
          profileId = s.author; tab = "profile"; viewer = null; render();
        },
        onShare: async () => {
          const url = new URL(location.href);
          url.search = "";
          url.hash = "";
          url.searchParams.set("story", s.id);
          return shareExternally({
            title: `${creatorName}'s Oldtime Story`,
            text: `View ${creatorName}'s Story on Oldtime.`,
            url: url.href,
          });
        },
       pause: () => { paused = true; storyVideo()?.pause(); },
       resume: () => { paused = false; storyVideo()?.play?.().catch(() => {}); },
       onSave: async () => {
         await api.saveStory(s.id, !s.savedToProfile);
         s.savedToProfile = !s.savedToProfile;
       },
       onDelete: async () => {
         const owner = api.me()?.id;
         if (!owner || s.author !== owner) { toast("You can only delete your own Story."); return; }
         if (!confirm("Delete this Story? This cannot be undone.")) return;
         try {
           await api.deleteOwnStory(s.id);
           if (api.me()?.id !== owner) return;
           list = list.filter(story => story.id !== s.id);
           let cleanupFailed = false;
           if (isLocalMedia(s.media)) {
             const stillUsed = [...api.db().posts, ...api.db().stories].some(item =>
               Array.isArray(item.media) ? item.media.includes(s.media) : item.media === s.media
             );
             if (!stillUsed) try { await deleteLocalMedia(s.media); }
             catch (error) { cleanupFailed = true; console.warn("Deleted Story media could not be cleared from device storage.", error); }
           }
           toast(cleanupFailed ? "Story deleted. Its device media could not be cleared." : "Story deleted");
           if (!list.length) close(); else { i = Math.min(i, list.length - 1); show(); }
         } catch (error) { toast(error.message || "The Story could not be deleted."); }
       },
     });
    $("#sclose").onclick = close;
     $("#story-profile").onclick = () => { close(); navigateToProfile(s.author); };
    let w = 0; clearInterval(storyTimer);
    storyTimer = setInterval(() => {
      if (!isStoryActive(s) || !api.canSeeStory(s) || !api.stories().some(item => item.id === s.id)) { i++; show(); return; }
      if (paused) return;
      w += s.creativeProject ? 100 / ((s.trim || s.creativeProject.duration) * 1000 / 90) : 2;
      const bar = $("#bar"); if (bar) bar.style.width = w + "%"; if (w >= 100) { i++; show(); }
    }, 90);
  };
  show();
}

function openProfilePostPlayback(authorId, posts) {
  const list = posts.slice();
  if (!list.length) return toast("No posts to play");
  if (!api.canSee(authorId)) return toast("This account is private");
  const view = $("#storyview");
  let index = 0;

  const close = () => {
    clearInterval(storyTimer);
    storyTimer = null;
    view.classList.remove("on");
    view.innerHTML = "";
  };
  const move = direction => {
    if (direction > 0) {
      if (index >= list.length - 1) return close();
      index += 1;
    } else if (index > 0) index -= 1;
    show();
  };
  const startPhotoTimer = progress => {
    clearInterval(storyTimer);
    const started = Date.now();
    storyTimer = setInterval(() => {
      const amount = Math.min(100, ((Date.now() - started) / 5000) * 100);
      if (progress.isConnected) progress.style.width = `${amount}%`;
      if (amount >= 100) move(1);
    }, 90);
  };
  const show = () => {
    clearInterval(storyTimer);
    storyTimer = null;
    if (!api.canSee(authorId)) {
      close();
      toast("This account is private");
      return;
    }
    const post = list[index];
    const author = api.user(authorId);
    if (!post || !author) return close();
    const media = post.media?.[0] || "";
    const isVideo = post.kind === "video" || String(media).startsWith("data:video");
    const content = post.creativeProject ? creativeMediaMarkup(post, esc) : media
      ? (isVideo
        ? `<video id="profile-play-video" src="${esc(media)}" autoplay muted playsinline aria-label="${esc(post.caption || "Profile video")}"></video>`
        : `<img src="${esc(media)}" alt="${esc(post.caption || "Profile post")}" />`)
      : `<div class="profile-play-text">${esc(post.caption || "Post")}</div>`;
    view.classList.add("on");
    view.innerHTML = `
      <div class="profile-play-progress" aria-hidden="true">
        ${list.map((_, i) => `<span class="${i < index ? "done" : i === index ? "active" : ""}"><i></i></span>`).join("")}
      </div>
      <div class="profile-play-header">
        <img src="${esc(author.avatar || "")}" alt="" />
        <div><b>@${esc(author.username)}</b><small>${index + 1} of ${list.length} posts</small></div>
      </div>
      <button type="button" class="profile-play-close" id="profile-play-close" aria-label="Close playback">${ic.close}</button>
      <div class="profile-play-media">${content}</div>
      ${post.creativeProject ? creativeAttribution(post, esc) : ""}
      ${media && post.caption ? `<div class="profile-play-caption">${esc(post.caption)}</div>` : ""}
      <button type="button" class="profile-play-zone profile-play-zone-left" id="profile-play-prev" aria-label="Previous post"></button>
      <button type="button" class="profile-play-zone profile-play-zone-right" id="profile-play-next" aria-label="Next post"></button>
    `;
    if (post.creativeProject) mountCreativeViewers(view, { onSource: (id, commentId) => { close(); openPostViewer(id, commentId); } });
    $("#profile-play-close", view).onclick = close;
    $("#profile-play-prev", view).onclick = () => move(-1);
    $("#profile-play-next", view).onclick = () => move(1);

    const progress = $(".profile-play-progress .active i", view);
    trackQualifiedView(post,$(".profile-play-media",view),"profile");
    const video = $("#profile-play-video", view);
    if (!video) {
      startPhotoTimer(progress);
      return;
    }
    const started = Date.now();
    let lastTime = video.currentTime;
    let lastAdvance = started;
    video.addEventListener("ended", () => move(1), { once: true });
    video.addEventListener("error", () => move(1), { once: true });
    video.addEventListener("timeupdate", () => {
      if (Number.isFinite(video.duration) && video.duration > 0 && progress.isConnected) {
        progress.style.width = `${Math.min(100, (video.currentTime / video.duration) * 100)}%`;
      }
    });
    storyTimer = setInterval(() => {
      if (video.currentTime > lastTime) {
        lastTime = video.currentTime;
        lastAdvance = Date.now();
      }
      if (Date.now() - lastAdvance > 15000) move(1);
    }, 500);
    const attempt = video.play();
    if (attempt?.catch) attempt.catch(() => startPhotoTimer(progress));
  };

  show();
}

function openHomeCreate() {
  openCreationHub({
    studio: () => openUniversalCreation({ startStudio: true }),
    camera: () => openUniversalCreation({ startCamera: true }),
    media: (file, kind) => openUniversalCreation({ background: { media: file, kind }, destination: "post" }),
    story: () => openUniversalCreation({ startCamera: true, destination: "story" })
  }, ic);
}
function openCameraLanding() {
  stopCameraLanding();
  openUniversalCreation({startCamera:true});
}
function legacyCameraLanding() {
  stopCameraLanding();
  cameraFacing = "environment";
  cameraMode = "post";
  shell(`<section class="screen on camera-screen" aria-label="Camera">
    <div class="camera-feed"><video id="camera-preview" autoplay playsinline muted></video><div class="camera-vignette"></div></div>
    <header class="camera-top-controls">
      <button type="button" class="camera-top-button" id="camera-close" aria-label="Close">${ic.close}</button>
      <button type="button" class="camera-top-button" id="camera-flash" aria-label="Flash" disabled>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 10-13h-7z"/></svg>
      </button>
      <span></span>
    </header>
    <div class="camera-bottom-controls">
      <div class="camera-capture-row">
        <button type="button" class="camera-side-button" id="camera-gallery" aria-label="Choose a photo from your library" title="Choose a photo">${ic.image}</button>
        <button type="button" class="camera-shutter" id="camera-shutter" aria-label="Take photo"><span></span></button>
        <button type="button" class="camera-side-button" id="camera-flip" aria-label="Flip camera">${ic.flip}</button>
      </div>
      <nav class="camera-modes" role="tablist" aria-label="Create type">
        ${[["post","POST"],["story","STORY"]].map(([id,label]) => `<button type="button" role="tab" data-camera-mode="${id}" aria-selected="${id === cameraMode}" class="${id === cameraMode ? "on" : ""}">${label}</button>`).join("")}
      </nav>
    </div>
    <input id="camera-file" type="file" accept="image/*" hidden />
  </section>`, undefined, { hideNav: true });

  const preview = $("#camera-preview");
  const generation = cameraGeneration;
  connectCamera(preview, generation).then(available => {
    if (!available && generation === cameraGeneration && preview.isConnected) toast("Camera unavailable");
  });
  $("#camera-close").onclick = () => { stopCameraLanding(); render(); };
  $("#camera-flash").onclick = toggleCameraFlash;
  $("#camera-flip").onclick = flipCamera;
  $("#camera-gallery").onclick = () => $("#camera-file").click();
  $("#camera-file").onchange = async () => {
    const file = $("#camera-file").files?.[0];
    $("#camera-file").value = "";
    if (!file) return;
    try {
      const media = preparePendingMedia(file);
      if (!$("#camera-preview")) return;
      const kind = cameraMode === "story" ? "story" : "photo";
      createKind = kind;
      stopCameraLanding();
      render();
      openCreate([media], kind);
    } catch (error) {
      toast(error.message || "Couldn't read media");
    }
  };
  $("#camera-shutter").onclick = () => {
    captureCameraPhoto();
  };
  app.querySelectorAll("[data-camera-mode]").forEach(button => button.onclick = () => {
    cameraMode = button.dataset.cameraMode;
    app.querySelectorAll("[data-camera-mode]").forEach(modeButton => {
      const active = modeButton.dataset.cameraMode === cameraMode;
      modeButton.classList.toggle("on", active);
      modeButton.setAttribute("aria-selected", active);
    });
    $("#camera-shutter").setAttribute("aria-label", "Take photo");
    $("#camera-gallery").disabled = false;
  });
}

async function connectCamera(preview, generation) {
  if (!preview?.isConnected || !navigator.mediaDevices?.getUserMedia) return false;
  const video = { facingMode: { ideal: cameraFacing }, width: { ideal: 1280 }, height: { ideal: 1920 } };
  let next;
  try {
    next = await navigator.mediaDevices.getUserMedia({ video, audio: true });
  } catch {
    try { next = await navigator.mediaDevices.getUserMedia({ video, audio: false }); }
    catch { return false; }
  }
  if (generation !== cameraGeneration || !preview.isConnected) {
    next.getTracks().forEach(track => track.stop());
    return false;
  }
  cameraStream = next;
  preview.srcObject = next;
  try { await preview.play(); } catch {}
  updateFlashButton();
  return true;
}

function updateFlashButton() {
  const button = $("#camera-flash");
  const track = cameraStream?.getVideoTracks()[0];
  if (!button) return;
  const available = Boolean(track?.getCapabilities?.().torch);
  button.disabled = !available;
  button.classList.toggle("active", cameraFlashOn);
  button.setAttribute("aria-label", available ? (cameraFlashOn ? "Turn flash off" : "Turn flash on") : "Flash unavailable");
}

async function toggleCameraFlash() {
  const track = cameraStream?.getVideoTracks()[0];
  if (!track?.getCapabilities?.().torch) return;
  cameraFlashOn = !cameraFlashOn;
  try {
    await track.applyConstraints({ advanced: [{ torch: cameraFlashOn }] });
    updateFlashButton();
  } catch {
    cameraFlashOn = false;
    updateFlashButton();
  }
}

async function flipCamera() {
  cameraFacing = cameraFacing === "environment" ? "user" : "environment";
  cameraFlashOn = false;
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = null;
  const preview = $("#camera-preview");
  if (preview) preview.srcObject = null;
  const generation = ++cameraGeneration;
  const available = await connectCamera(preview, generation);
  if (!available && generation === cameraGeneration && preview?.isConnected) toast("Camera unavailable");
}

function stopCameraLanding() {
  cameraGeneration++;
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = null;
  cameraFlashOn = false;
}

async function captureCameraPhoto() {
  const preview = $("#camera-preview");
  if (!cameraStream || !preview?.videoWidth || !preview.videoHeight) {
    $("#camera-file").click();
    return;
  }
  const generation = cameraGeneration;
  const scale = Math.min(1, 1600 / Math.max(preview.videoWidth, preview.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(preview.videoWidth * scale);
  canvas.height = Math.round(preview.videoHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) return toast("Camera capture unavailable");
  context.drawImage(preview, 0, 0, canvas.width, canvas.height);
  canvas.toBlob(async blob => {
    if (!blob || generation !== cameraGeneration || !preview.isConnected) return;
    try {
      const media = preparePendingMedia(new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" }));
      const kind = cameraMode === "story" ? "story" : "photo";
      createKind = kind;
      stopCameraLanding();
      render();
      openCreate([media], kind);
    } catch (error) {
      toast(error.message || "Couldn't read media");
    }
  }, "image/jpeg", .82);
}

window.addEventListener("pagehide", stopCameraLanding);

document.addEventListener("click", event => {
  const anchor = event.target.closest?.("a[href]");
  if (!anchor) return;
  const href = new URL(anchor.href, location.href);
  const tournamentId = href.searchParams.get("tournament");
  if (href.origin === location.origin && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(tournamentId || "")) {
    event.preventDefault(); event.stopPropagation();
    navigateMainSection("updates"); return;
  }
  const link = href.origin === location.origin ? detectBoardLink(href.href) : null;
  if (!link) return;
  event.preventDefault(); event.stopPropagation();
  navigateMainSection("updates");
}, true);
async function shareTournamentReference({ destination, href }) {
  if (destination === "messages") {
    closeTournaments();
    return shareBoardReference({ destination: "chat", href });
  }
  const source = await putLocalMedia(await tournamentReferenceCard());
  closeTournaments();
  tab = "updates"; viewer = null; profileId = null;
  openUniversalCreation({ background: { media: source, kind: "photo" }, caption: href, startShare: true,
    initialProject: { width: 1080, height: 1350, background: { kind: "photo", media: source, color: "#0d0b10" } },
    destination: destination === "story" ? "story" : "post" });
}
async function shareBoardReference({ destination, href }) {
  try {
    if (destination === "feed") { await api.refreshCloudFeed(); tab = "updates"; viewer = null; profileId = null; render(); return; }
    if (destination === "story" || destination === "community") {
      const source = await putLocalMedia(await boardReferenceCard(href));
      closeGetOnBoard();
      if (destination === "community") { tab = "communities"; viewer = null; render(); }
      openUniversalCreation({ background: { media: source, kind: "photo" }, caption: href,
        destination: destination === "story" ? "story" : "community" });
      return;
    }
    if (!await copyShareLink(href)) throw new Error("The link could not be copied.");
    closeGetOnBoard(); viewer = null; profileId = null; chatId = null;
    const target = destination === "blast" ? "communities" : "chat";
    tab = target; render();
    const owner = api.me()?.id;
    const observer = new MutationObserver(() => {
      if (owner !== api.me()?.id || tab !== target) { observer.disconnect(); return; }
      const input = [...app.querySelectorAll("textarea,input:not([type=search])")].find(el =>
        !el.value && !el.disabled && !/search|password|email/i.test(el.placeholder || "") &&
        (target === "communities" ? el.tagName === "TEXTAREA" || /blast|thought|write|say/i.test(el.placeholder || "") : /message|say something/i.test(el.placeholder || "")));
      if (input) { input.value = href; input.dispatchEvent(new Event("input", { bubbles: true })); input.focus(); observer.disconnect(); }
    });
    observer.observe(app, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 60000);
    toast(target === "communities" ? "Link copied. Choose Community." : "Link copied. Choose a conversation.");
  } catch (error) { toast(error.message || "The link could not be prepared."); }
}
function openUniversalCreation({startCamera=false,startStudio=false,startShare=false,initialProject=null,background=null,destination="post",caption="",heyWord=null}={}) {
  const community=tab==="communities";
  const sheet=$("#sheet");if(sheet){sheet.classList.remove("on");sheet.innerHTML="";}
  openCreativeEditor({startCamera,startStudio,startShare,initialProject,background,caption,heyWord,destination:community&&destination==="post"?"community":destination,esc,icons:ic,toast,
    onPosted:(id,story,toCommunity)=>{
      viewer=null;profileId=null;tab=toCommunity?"communities":"updates";render();
      if(story)openStory(api.me().id);else if(!toCommunity)openPostViewer(id);
    }
  });
}
function preparePendingMedia(file) {
  return {
    blob: file,
    url: URL.createObjectURL(file),
    video: file.type.startsWith("video/"),
    name: file.name || "media",
  };
}
function openCreate(initialMedia = [], initialKind = null) {
  if(initialKind==="text") {
    tab = "communities"; profileId = null; viewer = null; render(); openCommunityNoteComposer(); return;
  }
  openUniversalCreation({destination:initialKind==="story"?"story":"post",
    startCamera:initialMedia.length===0,
    background:initialMedia[0]?{media:initialMedia[0].blob || initialMedia[0].url,kind:initialMedia[0].video?"video":"photo"}:null});
  for (const media of initialMedia) if (media.url?.startsWith("blob:")) URL.revokeObjectURL(media.url);
}
function legacyCreateForm(initialMedia = [], initialKind = null) {
  const returnToCommunity = tab === "communities" && initialKind === "text";
  pending = initialMedia;
  if (initialKind) createKind = initialKind;
  const sheet = $("#sheet");
  sheet.classList.add("on");
  const kinds = [["video", "Video"], ["photo", "Photo"], ["carousel", "Carousel"], ["story", "Story"]];
  sheet.innerHTML = `<div class="panel" style="max-height:94%"><div class="grab"></div><b>Create</b>
    <div class="seg" id="kinds">
      ${kinds.map(([kind, label]) => `<button data-k="${kind}">${label}</button>`).join("")}
    </div>
    <textarea class="field" id="cap" placeholder="Caption"></textarea>
    <button class="icon" id="caption-emoji" aria-label="Add emoji to caption">${ic.smile}</button>
    <input class="field" id="loc" placeholder="Location (optional)" style="margin-top:8px" />
     <select class="field" id="vis" style="margin-top:8px"><option value="public">Public</option><option value="followers">Followers</option><option value="friends">Friends</option><option value="close-friends">Close Friends</option></select>
     <div class="sub close-friends-hint" id="close-friends-hint" hidden><span id="close-friends-hint-text"></span> <button type="button" class="close-friends-manage" id="manage-close-friends">Manage Close Friends</button></div>
    <div id="create-media-tools">
      <div class="row" style="margin:8px 0;flex-wrap:wrap"><button class="btn ghost small" id="pick">Upload</button><button class="btn ghost small" id="rec">Record</button><input id="file" type="file" accept="image/*,video/*" multiple hidden /><input id="cam" type="file" accept="video/*,image/*" capture="environment" hidden /><span class="sub" id="picked">No file yet</span></div>
      <video id="prev" controls style="width:100%;max-height:160px;display:none;border-radius:12px"></video>
      <img id="pimg" style="width:100%;max-height:160px;object-fit:cover;display:none;border-radius:12px" />
      <label class="sub" id="trim-row">Trim end <input class="field" id="trim" type="number" min="1" placeholder="Seconds" /></label>
    </div>
    <button class="btn ghost" id="create-layer-editor" style="margin-top:10px">Open layer editor</button>
    <button class="btn" id="post" style="margin-top:10px">Post</button></div>`;
  const paint = () => {
    sheet.querySelectorAll("#kinds button").forEach(b => b.classList.toggle("on", b.dataset.k === createKind));
    $("#create-media-tools").hidden = false;
    $("#rec").hidden = createKind !== "video";
    $("#trim-row").hidden = createKind !== "video";
    $("#cap").placeholder = "Caption";
    const closeFriendsOption = $("#vis").querySelector('option[value="close-friends"]');
    const cloudMode = api.authMode() === "cloud";
    const hasCloseFriends = cloudMode ? api.cloudCloseFriends().length > 0 : (api.me().closeFriends || []).length > 0;
    const visibilitySelect = $("#vis");
    visibilitySelect.querySelectorAll('option[value="followers"], option[value="friends"]').forEach(option => {
      option.hidden = cloudMode;
      option.disabled = cloudMode;
    });
    const publicOption = visibilitySelect.querySelector('option[value="public"]');
    publicOption.disabled = cloudMode && api.me()?.private === true;
    if (publicOption.disabled && visibilitySelect.value === "public") visibilitySelect.value = "close-friends";
    closeFriendsOption.disabled = !hasCloseFriends;
    $("#close-friends-hint-text").textContent = hasCloseFriends
      ? "Only people on your list can see this."
      : "Add people to Close Friends before sharing privately.";
    $("#close-friends-hint").hidden = $("#vis").value !== "close-friends" && !(createKind === "story" && !hasCloseFriends);
  };
  paint();
  if (api.authMode() === "cloud") {
    void Promise.all([api.syncCloudPrivacy(), api.refreshCloudCloseFriends(), api.refreshCloudBlocks()])
      .then(() => { if (sheet.classList.contains("on")) paint(); })
      .catch(error => toast(error.message || "Online story settings could not be loaded."));
  }
  $("#vis").onchange = paint;
  const showPending = () => {
    const picked = $("#picked"), prev = $("#prev"), pimg = $("#pimg");
    if (!picked?.isConnected) return;
    picked.textContent = pending.length ? `${pending.length} ready` : "No file yet";
    prev.style.display = "none";
    pimg.style.display = "none";
    if (pending[0]?.video) { prev.style.display = "block"; prev.src = pending[0].url; }
    else if (pending[0]) { pimg.style.display = "block"; pimg.src = pending[0].url; }
  };
  showPending();
  $("#caption-emoji").onclick = () => openEmojiPicker($("#cap"));
  $("#create-layer-editor").onclick = () => {
    const files = pending.slice(), kind = createKind, caption = $("#cap").value, location = $("#loc").value, visibility = $("#vis").value;
    sheet.classList.remove("on"); sheet.innerHTML = "";
    openCreativeEditor({ destination: kind === "story" ? "story" : "post", background: files[0] ? { media: files[0].url, kind: files[0].video ? "video" : "photo" } : null,
      esc, icons: ic, toast,
      onClose: () => { openCreate(files, kind); $("#cap").value = caption; $("#loc").value = location; $("#vis").value = visibility; },
      onPosted: (id, story) => { viewer = null; profileId = null; tab = "updates"; render(); if (story) openStory(api.me().id); else openPostViewer(id); }
    });
  };
  sheet.querySelector("#kinds").onclick = (e) => { const b = e.target.closest("[data-k]"); if (!b) return; createKind = b.dataset.k; paint(); };
  $("#pick").onclick = () => $("#file").click();
  $("#rec").onclick = () => $("#cam").click();
  const take = async (files) => {
    const post = $("#post");
    post.disabled = true;
    try {
      pending = [];
      for (const f of files) {
        if (!/^(image|video)\//.test(f.type)) throw new Error("Choose photos or videos");
        pending.push(preparePendingMedia(f));
      }
    } catch (e) { pending = []; toast(e.message || "Couldn't read media"); return; }
    finally { post.disabled = false; }
    showPending();
  };
  $("#file").onchange = () => take([...$("#file").files]);
  $("#cam").onchange = () => take([...$("#cam").files]);
  $("#post").onclick = async () => {
    const caption = $("#cap").value.trim();
    const tags = [...caption.matchAll(/#([a-z0-9_]+)/gi)].map(m => m[1].toLowerCase());
    if (createKind === "text" && !caption) return toast("Add text");
    if (createKind === "story" && !caption && !pending.length) return toast("Add text or media");
    if (["video", "photo", "carousel"].includes(createKind) && !pending.length) return toast("Add a photo or video");
    if (createKind === "video" && (pending.length !== 1 || !pending[0].video)) return toast("Choose one video");
    if (createKind === "photo" && (pending.length !== 1 || pending[0].video)) return toast("Choose one photo");
    if (createKind === "carousel" && (pending.length < 2 || pending.some(p => p.video))) return toast("Choose at least two photos");
    if (createKind === "story" && pending.length > 1) return toast("Choose one story image or video");
    const visibility = $("#vis").value;
    const hasCloseFriends = api.authMode() === "cloud"
      ? api.cloudCloseFriends().length > 0
      : (api.me().closeFriends || []).length > 0;
    if (visibility === "close-friends" && !hasCloseFriends) {
      return toast("Add people to Close Friends before sharing with them");
    }
    const trim = Number($("#trim").value) || 0;
    if (api.authMode() === "cloud" && createKind === "story") {
      try {
        await api.createCloudStory({
          text: caption,
          visibility,
          mediaDataUrl: pending[0]?.url || "",
        });
      } catch (error) {
        toast(error.message || "Couldn’t publish your Story");
        return;
      }
    } else if (api.authMode() === "cloud" && ["photo", "video", "carousel"].includes(createKind)) {
      // Do not tell a signed-in user that media is online when this legacy
      // feed path would still write the file into browser-local storage.
      return toast("Cloud photo and video posts are not ready yet. Use Story to publish media online.");
    } else if (api.authMode() === "cloud" && createKind === "text") {
      if (visibility !== "public") return toast("Online text posts currently support public visibility only. Nothing was posted.");
      try { await api.createCloudPost(caption); }
      catch (error) { toast(error.message || "Couldn’t publish your post"); return; }
    } else {
      try { mutate(db => {
        if (createKind === "story") db.stories.unshift({ id: "s" + Date.now(), author: api.me().id, kind: pending[0]?.video ? "video" : (pending[0] ? "photo" : "text"), media: pending[0]?.url || "", text: caption, visibility, created: Date.now(), color: "#111922" });
        else db.posts.unshift({ id: "p" + Date.now(), author: api.me().id, kind: createKind, caption: caption || " ", tags, media: createKind === "text" ? [] : pending.map(p => p.url), sound: "Original audio", location: $("#loc").value.trim(), visibility, trim, likes: [], comments: [], saves: [], created: Date.now(), views: 0, shares: 0, color: "linear-gradient(160deg,#111922,#1a2330)" });
      }); } catch (e) { toast(e.message); return; }
    }
    pending = []; sheet.classList.remove("on");
    if ($("#camera-preview")) stopCameraLanding();
    tab = returnToCommunity ? "communities" : "updates"; profileId = null;
    render(); toast("Posted");
  };
  $("#manage-close-friends").onclick = () => {
    sheet.classList.remove("on");
    tab = "settings";
    settingsView = "close-friends";
    render();
  };
  sheet.onclick = (e) => { if (e.target === sheet) sheet.classList.remove("on"); };
}

function automaticProfileCover(user) {
  const post = api.posts().find(p => p.author === user.id && p.kind !== "video" && !p.creativeProject && p.media?.[0]);
  return post?.media?.[0] || user.avatar || "";
}

function profilePostMedia(post) {
  const stored = Array.isArray(post?.media) ? post.media.filter(Boolean) : [];
  if (stored.length) return stored;
  const project = post?.creativeProject;
  const projectMedia = [project?.background?.media, ...(project?.layers || []).filter(layer => layer.kind === "image").map(layer => layer.media)]
    .filter(value => typeof value === "string" && value);
  return projectMedia.slice(0, 1);
}

function profileMediaSource(value) {
  const media = String(value || "");
  return /^oldtime-media:[\w-]+$/i.test(media)
    ? `data-local-media="${esc(media)}"`
    : `src="${esc(media)}"`;
}

function profileCoverPickerMarkup(prefix, { title = "", uri = "", template = "", position = {} } = {}) {
  const x = Math.max(0, Math.min(100, Number(position.x) || 50));
  const y = Math.max(0, Math.min(100, Number(position.y) || 50));
  const zoom = Math.max(1, Math.min(2, Number(position.zoom) || 1));
  const photo = uri ? `<img data-cover-image ${profileMediaSource(uri)} alt="" style="object-position:${x}% ${y}%;transform:scale(${zoom})" />` : "";
  const art = template ? `<span data-cover-template-preview class="ot-profile-cover-template is-${esc(template)}"><b>${esc(title || "Your collection")}</b><small>OLDTIME · ${template === "night" ? "MEMORIES" : "ALBUM"}</small></span>` : "";
  return `<div class="ot-cover-picker" data-cover-picker="${esc(prefix)}" data-cover-title="${esc(title)}">
    <div class="ot-cover-preview" data-cover-preview>${photo}${art}<span data-cover-placeholder ${uri || template ? "hidden" : ""}>Cover preview</span></div>
    <label class="ot-cover-upload" for="${esc(prefix)}-file">${uri ? "Change photo" : "Choose photo"}</label>
    <input id="${esc(prefix)}-file" class="ot-cover-file" type="file" accept="image/*" aria-label="Choose and crop a cover image" />
    <div class="ot-cover-templates" role="group" aria-label="Cover templates">
      <button type="button" data-cover-template="mono" aria-pressed="${template === "mono"}">Mono</button>
      <button type="button" data-cover-template="red" aria-pressed="${template === "red"}">Red</button>
      <button type="button" data-cover-template="night" aria-pressed="${template === "night"}">Night</button>
    </div>
    <div class="ot-cover-crop-controls" ${uri ? "" : "hidden"}>
      <label>Horizontal <input type="range" min="0" max="100" value="${x}" data-cover-x></label>
      <label>Vertical <input type="range" min="0" max="100" value="${y}" data-cover-y></label>
      <label>Zoom <input type="range" min="100" max="200" value="${Math.round(zoom * 100)}" data-cover-zoom></label>
    </div>
    ${uri || template ? `<button type="button" class="ot-cover-remove" data-cover-remove>Remove cover</button>` : ""}
  </div>`;
}

function bindProfileCoverPicker(root, prefix) {
  const picker = root.querySelector(`[data-cover-picker="${prefix}"]`);
  if (!picker) throw new Error("Cover editor is unavailable.");
  const coverTitle = picker.dataset.coverTitle || "Your collection";
  const image = picker.querySelector("[data-cover-image]");
  const templatePreview = picker.querySelector("[data-cover-template-preview]");
  const placeholder = picker.querySelector("[data-cover-placeholder]");
  const fileInput = picker.querySelector(".ot-cover-file");
  const cropControls = picker.querySelector(".ot-cover-crop-controls");
  let file = null;
  let objectUrl = "";
  let uri = image?.dataset.localMedia || image?.getAttribute("src") || "";
  let template = templatePreview?.classList.contains("is-red") ? "red"
    : templatePreview?.classList.contains("is-night") ? "night"
      : templatePreview ? "mono" : "";
  const position = { x: Number(picker.querySelector("[data-cover-x]")?.value || 50), y: Number(picker.querySelector("[data-cover-y]")?.value || 50), zoom: Number(picker.querySelector("[data-cover-zoom]")?.value || 100) / 100 };
  const updateCrop = () => {
    const activeImage = picker.querySelector("[data-cover-image]");
    if (activeImage) {
      activeImage.style.objectPosition = `${position.x}% ${position.y}%`;
      activeImage.style.transform = `scale(${position.zoom})`;
    }
  };
  [["x", "data-cover-x"], ["y", "data-cover-y"], ["zoom", "data-cover-zoom"]].forEach(([key, selector]) => {
    picker.querySelector(`[${selector}]`)?.addEventListener("input", event => {
      position[key] = key === "zoom" ? Number(event.target.value) / 100 : Number(event.target.value);
      updateCrop();
    });
  });
  const clearObjectUrl = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = ""; };
  fileInput?.addEventListener("change", () => {
    const selected = fileInput.files?.[0];
    if (!selected) return;
    if (!selected.type.startsWith("image/")) { toast("Choose an image file"); fileInput.value = ""; return; }
    clearObjectUrl();
    file = selected;
    uri = "";
    template = "";
    objectUrl = URL.createObjectURL(selected);
    const preview = picker.querySelector("[data-cover-preview]");
    preview.innerHTML = `<img data-cover-image alt="" />`;
    const nextImage = preview.querySelector("[data-cover-image]");
    nextImage.src = objectUrl;
    nextImage.style.objectPosition = `${position.x}% ${position.y}%`;
    nextImage.style.transform = `scale(${position.zoom})`;
    placeholder.hidden = true;
    cropControls.hidden = false;
    picker.querySelectorAll("[data-cover-template]").forEach(button => button.setAttribute("aria-pressed", "false"));
    picker.querySelector("[data-cover-remove]")?.remove();
    fileInput.closest(".ot-cover-picker").querySelector(".ot-cover-upload").textContent = "Change photo";
  });
  picker.querySelectorAll("[data-cover-template]").forEach(button => button.addEventListener("click", () => {
    clearObjectUrl();
    file = null;
    uri = "";
    template = button.dataset.coverTemplate;
    const preview = picker.querySelector("[data-cover-preview]");
    preview.innerHTML = `<span data-cover-template-preview class="ot-profile-cover-template is-${template}"><b>${esc(coverTitle)}</b><small>OLDTIME · ${template === "night" ? "MEMORIES" : "ALBUM"}</small></span>`;
    picker.querySelectorAll("[data-cover-template]").forEach(option => option.setAttribute("aria-pressed", String(option === button)));
    placeholder.hidden = true;
    cropControls.hidden = true;
    if (!picker.querySelector("[data-cover-remove]")) picker.insertAdjacentHTML("beforeend", `<button type="button" class="ot-cover-remove" data-cover-remove>Remove cover</button>`);
  }));
  picker.addEventListener("click", event => {
    if (!event.target.closest("[data-cover-remove]")) return;
    clearObjectUrl();
    file = null;
    uri = "";
    template = "";
    picker.querySelector("[data-cover-preview]").innerHTML = `<span data-cover-placeholder>Cover preview</span>`;
    placeholder.hidden = false;
    cropControls.hidden = true;
    picker.querySelectorAll("[data-cover-template]").forEach(button => button.setAttribute("aria-pressed", "false"));
    picker.querySelector("[data-cover-remove]")?.remove();
    fileInput.value = "";
  });
  if (uri) {
    cropControls.hidden = false;
    picker.querySelector(".ot-cover-upload").textContent = "Change photo";
    updateCrop();
  }
  const read = async () => ({
    uri: file ? await putLocalMedia(file) : uri,
    template: file || uri ? "" : template,
    position: { ...position },
  });
  return { read, dispose: clearObjectUrl };
}

function openProfilePostCoverEditor(user, post) {
  if (!post || post.author !== user?.id || user?.id !== api.me()?.id) return;
  const sheet = $("#sheet");
  if (!sheet) return;
  const saved = user.profilePostCovers?.[post.id] || {};
  const currentUri = post.profileCoverUri || saved.uri || "";
  const currentTemplate = post.profileCoverTemplate || saved.template || "";
  const currentPosition = post.profileCoverPosition || saved.position || {};
  const title = post.caption || post.text || "Profile post";
  sheet.classList.add("on");
  sheet.innerHTML = `<div class="panel ot-collection-create-panel ot-post-cover-panel" role="dialog" aria-modal="true" aria-labelledby="ot-post-cover-title">
    <div class="grab"></div><div class="row ot-collection-form-head"><b id="ot-post-cover-title">Profile post cover</b><button type="button" class="icon" data-cover-cancel aria-label="Close">×</button></div>
    <p class="sub">Choose a photo, adjust the crop, or select a template. This only changes how the post appears on your profile.</p>
    ${profileCoverPickerMarkup("post-cover", { title, uri: currentUri, template: currentTemplate, position: currentPosition })}
    <button type="button" class="btn primary" id="ot-post-cover-save">Save cover</button>
  </div>`;
  const picker = bindProfileCoverPicker(sheet, "post-cover");
  const close = () => { picker.dispose(); sheet.classList.remove("on"); sheet.innerHTML = ""; };
  sheet.querySelector("[data-cover-cancel]").onclick = close;
  void hydrateLocalMedia(sheet);
  sheet.querySelector("#ot-post-cover-save").onclick = async () => {
    let cover;
    try { cover = await picker.read(); }
    catch (error) { toast(error.message || "Could not save the cover"); return; }
    mutate(db => {
      const localPost = db.posts.find(item => item.id === post.id && item.author === user.id);
      const owner = db.users.find(item => item.id === user.id);
      if (localPost) {
        localPost.profileCoverUri = cover.uri || undefined;
        localPost.profileCoverTemplate = cover.template || undefined;
        localPost.profileCoverPosition = cover.position;
      }
      if (owner) {
        if (!owner.profilePostCovers) owner.profilePostCovers = {};
        if (cover.uri || cover.template) owner.profilePostCovers[post.id] = { uri: cover.uri, template: cover.template, position: cover.position };
        else delete owner.profilePostCovers[post.id];
      }
    });
    close();
    render();
    toast("Profile cover updated");
  };
}

function profile(id) {
  const u = api.user(id);
  const me = api.me();
  if (!u) { profileId = null; profileReturnChatId = null; return updates(); }
  const cloudBlocksReady = api.authMode() !== "cloud" || api.cloudBlocksLoaded();
  if (!cloudBlocksReady) {
    const owner = api.cloudAccountId();
    void api.refreshCloudBlocks().then(() => {
      if (api.cloudAccountId() === owner && profileId === u.id) render();
    }).catch(error => toast(error.message || "Block settings could not be loaded."));
  }
  const locked = !api.canSee(u.id);
  let profileRepostStatus = api.authMode() === "cloud" ? api.cloudProfileRepostsStatus(u.id) : null;
  if (profileMode === "reposts" && !locked && api.authMode() === "cloud" &&
      u.username && !profileRepostStatus.loaded && !profileRepostStatus.loading && !profileRepostStatus.error) {
    const owner = api.cloudAccountId();
    const load = api.refreshCloudProfileReposts(u.id, u.username);
    profileRepostStatus = api.cloudProfileRepostsStatus(u.id);
    void load.then(() => {
      if (api.cloudAccountId() === owner && profileId === u.id && profileMode === "reposts") render();
    }).catch(() => {
      if (api.cloudAccountId() === owner && profileId === u.id && profileMode === "reposts") render();
    });
  }
  const posts = api.posts().filter(p => p.author === u.id && isProfileSurfacePost(p) && (p.author === me.id || api.canSeePost(p)));
  const coverImage = u.cover || (locked ? u.avatar : automaticProfileCover(u));
  const videos = posts.filter(p => p.kind === "video");
    const saved = listSavedPosts().filter(isProfileSurfacePost);
   const reposts = api.authMode() === "cloud"
     ? api.cloudProfileReposts(u.id)
      : api.posts().filter(p => isProfileSurfacePost(p) && (p.reposts || []).includes(u.id) && (p.author === me.id || api.canSeePost(p)));
   const visibleReposts = reposts.filter(isProfileSurfacePost);
  const repostedAuthors = new Map();
   visibleReposts.forEach(post => {
    const author = api.user(post.author);
    if (author && !repostedAuthors.has(author.id)) repostedAuthors.set(author.id, { author, post });
  });
  const mine = u.id === me.id;
  const savedCollections = mine && profileMode === "saved" ? listSavedCollections() : [];
  const selectedCollection = savedCollections.find(collection => collection.id === savedCollectionId);
  const savedGrid = selectedCollection ? saved.filter(post => selectedCollection.postIds.includes(post.id)) : saved;
  const grid = locked ? [] : profileMode === "videos" ? videos
     : profileMode === "reposts" ? visibleReposts
      : profileMode === "saved" && mine ? savedGrid : posts;
  const profileModes = ["posts", "videos", "reposts", ...(mine ? ["saved"] : [])];
  const profileModeIcons = { posts: icon("grid"), videos: ic.video, reposts: ic.repost, saved: ic.bookmark };
  const profileModeLabels = { posts: "Posts", videos: "Videos", reposts: "Reposts", saved: "Saved" };
  const gridTitle = profileMode === "saved" ? "Saved posts" : profileMode === "reposts" ? "Reposts" : profileMode === "videos" ? "Videos" : "Posts";
  const profileGridMarkup = grid.slice(0, profileMore ? grid.length : 8).map(p => {
    const savedCover = u.profilePostCovers?.[p.id] || {};
    const coverUri = p.profileCoverUri || savedCover.uri || "";
    const coverTemplate = p.profileCoverTemplate || savedCover.template || "";
    const crop = p.profileCoverPosition || savedCover.position || {};
    const cropStyle = `object-position:${Math.max(0, Math.min(100, Number(crop.x) || 50))}% ${Math.max(0, Math.min(100, Number(crop.y) || 50))}%;transform:scale(${Math.max(1, Math.min(2, Number(crop.zoom) || 1))})`;
    let visual;
    if (coverTemplate) {
      visual = `<span class="ot-profile-cover-template is-${esc(coverTemplate)}"><b>${esc(p.caption || p.text || "A moment")}</b><small>OLDTIME · ${coverTemplate === "night" ? "MEMORIES" : "POST"}</small></span>`;
    } else if (coverUri) {
      visual = `<img ${profileMediaSource(coverUri)} alt="" style="width:100%;height:100%;object-fit:cover;${cropStyle}" />`;
    } else if (p.creativeProject) {
      visual = creativeMediaMarkup(p, esc, false, true);
    } else if (p.media?.[0]) {
      const fallback = p.kind === "video" ? api.user(p.author)?.avatar || u.avatar : p.media[0];
      visual = `<img ${profileMediaSource(fallback)} alt="" style="width:100%;height:100%;object-fit:cover" />`;
    } else {
      visual = `<span class="ot-profile-cover-template"><b>${esc((p.text || p.caption || "A thought").slice(0, 54))}</b><small>OLDTIME · NOTE</small></span>`;
    }
    const openPostAttributes = `data-open="${esc(p.id)}"`;
    const postCaption = String(p.caption || p.text || "Post");
    const postAuthor = api.user(p.author) || u;
    const postLikes = Number(p.likeCount ?? p.likes?.length ?? 0);
    return `<article class="profile-post-card">
      <button type="button" class="profile-post-media ${!p.media?.[0] && !coverUri && !coverTemplate && !p.creativeProject ? "is-text" : ""}" ${openPostAttributes} aria-label="Open ${esc(postCaption)}">
        ${visual}${profileMode === "reposts" ? `<span class="profile-repost-mark" aria-label="Repost">${ic.repost}</span>` : ""}
        ${p.kind === "video" ? `<span class="profile-post-video-mark" aria-label="Video">${ic.video}</span>` : ""}
        <span class="profile-post-views">${ic.play}${fmt(p.views || 0)}</span>
      </button>
       ${mine && p.author === u.id && profileMode !== "reposts" ? `<button type="button" class="hookcard-delete" data-delete-post="${esc(p.id)}" aria-label="Delete your post">${ic.trash}</button>` : ""}
      ${mine && p.author === u.id && profileMode !== "reposts" ? `<button type="button" class="hookcard-cover" data-post-cover-edit="${esc(p.id)}" aria-label="Edit profile cover for post">${ic.image}</button>` : ""}
      <div class="profile-post-detail">
       <p class="profile-post-caption">${esc(postCaption)}</p>
       <div class="profile-post-byline"><span class="profile-post-author"><img src="${esc(postAuthor.avatar || "")}" alt="" /><span>${esc(postAuthor.name || postAuthor.username || "Oldtime member")}</span></span><span class="profile-post-likes" aria-label="${fmt(postLikes)} likes">${ic.heart}${fmt(postLikes)}</span></div>
      </div>
    </article>`;
  }).join("");
  const profileGridEmptyMessage = profileMode === "reposts"
    ? profileRepostStatus?.loading ? "Loading reposts…"
      : profileRepostStatus?.error ? "Reposts could not be loaded. Check your connection and try again."
        : mine ? "Posts you repost will appear here." : "No reposts to show yet."
    : `No ${gridTitle.toLowerCase()} yet.`;
  const accountType = getAccountTools().accountType;
  const activityRoute = accountType === "creator" ? "creator-studio" : accountType === "business" ? "business-dashboard" : "personal-activity";
  const activityLabel = accountType === "creator" ? "Creator Studio" : accountType === "business" ? "Business Dashboard" : "Your activity";
  const requested = api.db().requests.some(r => r.from === me.id && r.to === u.id);
  const friendRequests = Array.isArray(api.db().friendRequests) ? api.db().friendRequests : [];
  const friendRequested = friendRequests.some(r => r.from === me.id && r.to === u.id);
  const friendRequestIncoming = friendRequests.some(r => r.from === u.id && r.to === me.id);
  const isFriend = api.areFriends(me.id, u.id);
  const isCloseFriend = (api.authMode() === "cloud" ? api.cloudCloseFriends() : me.closeFriends || []).includes(u.id);
  const hasProfileStory = api.stories().some(story =>
    story.author === u.id && isStoryActive(story) && api.canSeeStory(story)
  );
  const visibleNote = !locked && Boolean(u.profileNote?.trim());
  const visibleCity = !locked && (mine || u.profileVisibility?.city !== false);
  const visibleInterests = !locked && (mine || u.profileVisibility?.interests !== false);
  const interestIds = visibleInterests && Array.isArray(u.interests) ? u.interests : [];
  const cityLine = u.city && visibleCity
    ? `<p class="sub profile-city">City · ${esc(u.city)}${mine && u.profileVisibility?.city === false ? `<small>Only you</small>` : ""}</p>`
    : "";
  const interestLine = interestIds.length
    ? `<div class="profile-interest-list" aria-label="Interests">${interestIds.map(id => `<span class="profile-interest-chip">${esc(profileInterestName(id))}</span>`).join("")}${mine && u.profileVisibility?.interests === false ? `<small>Only you</small>` : ""}</div>`
    : mine
      ? `<button type="button" class="profile-add-interests" id="edit-interests" data-testid="button-add-profile-interests">Add interests to your profile</button>`
      : "";
   shell(`<section class="screen on profile-screen"><div class="scroll profile-page">
    <div class="profile-hero">
      <div class="profile-cover"><img ${profileMediaSource(coverImage)} alt="" /></div>
       <div class="profile-topbar"><button id="back" aria-label="Back">←</button><div class="row profile-topbar-actions"><button id="sharep" class="profile-share" aria-label="Share profile" title="Share profile">${ic.share}</button><button type="button" class="icon profile-more" id="profile-actions-open" aria-label="More profile actions" title="More">${ic.more}</button></div></div>
      <div class="profile-intro">
        <div class="profile-identity">
          <div class="profile-avatar-wrap">
            ${hasProfileStory ? `<button type="button" class="profile-story-ring" data-profile-story aria-label="View ${esc(u.username)}'s story"><img class="profile-avatar" src="${esc(u.avatar)}" alt="" /></button>` : `<img class="profile-avatar" src="${esc(u.avatar)}" alt="" />`}
            ${mine ? `<button type="button" class="profile-note-bubble ${u.profileNote?.trim() ? "" : "empty"}" id="profile-note" aria-label="${u.profileNote?.trim() ? "Edit your note" : "Add a note"}">${esc(u.profileNote?.trim() || "Add a note")}</button>` : visibleNote ? `<span class="profile-note-bubble">${esc(u.profileNote.trim())}</span>` : ""}
          </div>
          <div><b class="profile-name">${esc(u.name)}${blueBadgeMarkup(u.cloudAccountId || u.id, esc)}</b><div class="sub">@${u.username}</div></div>
        </div>
        ${u.professional?.showCategory&&u.professional.accountType!=="personal"?`<small class="sub">${esc(u.professional.accountType==="creator"?u.professional.creatorCategory:u.professional.businessCategory)}</small>`:""}
        <div class="profile-stats">${fmt(posts.reduce((n,p)=>n+(p.measuredViews||0),0))} measured plays · ${fmt(u.followers.length)} followers · ${fmt(u.following.length)} following</div>
        <p class="cap">${esc(u.bio || "")}</p>${cityLine}${interestLine}
         <div class="row profile-primary-actions">${mine ? `<button class="followwide" id="edit">Edit profile</button>` : `<button class="followwide" id="pfollow">${me.following.includes(u.id) ? "Following" : requested ? "Requested" : "+ Follow"}</button><button class="followwide" id="pmsg" ${api.blocked(me.id, u.id) ? "disabled" : ""}>Message</button>`}</div>
      </div>
    </div>
    <div class="profile-body">
     <div class="profile-section-tabs" role="tablist" aria-label="Profile sections">
      ${profileModes.map(mode => `<button type="button" role="tab" id="profile-tab-${mode}" data-m="${mode}" class="profile-section-tab ${profileMode === mode ? "on" : ""}" aria-label="${profileModeLabels[mode]}" title="${profileModeLabels[mode]}" aria-selected="${profileMode === mode}" aria-controls="profile-content-grid" tabindex="${profileMode === mode ? "0" : "-1"}">${profileModeIcons[mode]}</button>`).join("")}
     </div>
    ${mine && profileMode === "saved" ? `<div class="profile-saved-collections" role="group" aria-label="Private saved collections">
       <button type="button" data-saved-filter="" aria-pressed="${!selectedCollection}" class="${!selectedCollection ? "selected" : ""}"><span><b>All saved</b><small>Private · ${saved.length}</small></span></button>
       ${savedCollections.map(collection => `<button type="button" data-saved-filter="${esc(collection.id)}" aria-pressed="${selectedCollection?.id === collection.id}" class="${selectedCollection?.id === collection.id ? "selected" : ""}">${collection.cover ? `<img src="${esc(collection.cover)}" alt="" />` : ""}<span><b>${esc(collection.name)}</b><small>Private · ${collection.count}</small></span></button>`).join("")}
    </div>` : ""}
    ${!locked && profileMode === "reposts" && repostedAuthors.size ? `<div class="profile-repost-faces" role="group" aria-label="Accounts in ${esc(u.name)}’s Reposts">${[...repostedAuthors.values()].map(({ author, post }) => `<button type="button" class="profile-repost-face" data-open="${esc(post.id)}" aria-label="Open repost of @${esc(author.username)}’s post" title="@${esc(author.username)}"><img src="${esc(author.avatar)}" alt="" /><span>${ic.repost}</span></button>`).join("")}</div>` : ""}
     ${locked ? `<div id="profile-content-grid" role="tabpanel" aria-labelledby="profile-tab-${profileMode}"><div class="empty">This account is private.</div></div>` : `<div id="profile-content-grid" role="tabpanel" aria-labelledby="profile-tab-${profileMode}">
       ${profileGridMarkup ? `<div class="profile-post-grid">${profileGridMarkup}</div>` : `<div class="empty">${profileGridEmptyMessage}</div>`}
       ${profileMode === "reposts" && profileRepostStatus?.error ? `<button type="button" class="profile-grid-more" id="profile-reposts-retry">Try again</button>` : ""}
       ${grid.length > 8 && !profileMore ? `<button type="button" class="profile-grid-more" id="more">See more ${gridTitle.toLowerCase()}</button>` : ""}
       ${profileMode === "reposts" && profileRepostStatus?.hasMore ? `<button type="button" class="profile-grid-more" id="profile-reposts-more" ${profileRepostStatus.loading ? "disabled" : ""}>${profileRepostStatus.loading ? "Loading…" : "Load more reposts"}</button>` : ""}
      </div>`}
    </div>
   </div>
   <div class="sheet profile-action-sheet" id="profile-actions-sheet" aria-hidden="true">
    <section class="panel profile-action-panel" role="dialog" aria-modal="true" aria-label="Profile actions" tabindex="-1">
     <div class="grab"></div>
     <div class="profile-action-heading"><b>${mine ? "Your profile" : `@${esc(u.username)}`}</b><button type="button" class="profile-action-close" data-profile-actions-close aria-label="Close profile actions">${ic.close}</button></div>
     <div class="profile-action-list">
      ${mine ? `
       <button type="button" class="profile-action-item" data-profile-activity="${esc(activityRoute)}">${ic.timeCircle}<span>${esc(activityLabel)}</span><span class="profile-action-chevron">›</span></button>
       <button type="button" class="profile-action-item" data-profile-settings>${ic.settings}<span>Settings</span><span class="profile-action-chevron">›</span></button>
       ${videos.length ? `<button type="button" class="profile-action-item" id="playall">${ic.play}<span>Play all videos</span><span class="profile-action-chevron">›</span></button>` : ""}
       <div class="profile-action-divider"></div>
       <button type="button" class="profile-action-item profile-action-quiet" id="logout">${ic.logout}<span>Log out</span></button>
      ` : `
       <button type="button" class="profile-action-item" id="pfriend" aria-pressed="${isFriend}">${ic.user}<span>${isFriend ? "Friends" : friendRequestIncoming ? "Accept friend request" : friendRequested ? "Friend request sent" : "Add friend"}</span><span class="profile-action-chevron">›</span></button>
       <button type="button" class="profile-action-item" id="pclosefriend" aria-pressed="${isCloseFriend}" ${!isFriend ? 'disabled title="Become friends first"' : ""}>${ic.heart}<span>${isCloseFriend ? "Remove from Close Friends" : "Add to Close Friends"}</span><span class="profile-action-chevron">›</span></button>
       ${videos.length ? `<button type="button" class="profile-action-item" id="playall">${ic.play}<span>Play all videos</span><span class="profile-action-chevron">›</span></button>` : ""}
       <div class="profile-action-divider"></div>
       <button type="button" class="profile-action-item" id="pblock" ${cloudBlocksReady ? "" : "disabled"}>${ic.lock}<span>${!cloudBlocksReady ? "Loading block settings…" : (api.authMode() === "cloud" ? api.cloudBlocks() : api.db().blocks.filter(b => b.by === me.id).map(b => b.who)).includes(u.id) ? "Unblock account" : "Block account"}</span></button>
       <button type="button" class="profile-action-item profile-action-quiet" id="prep">${ic.flag}<span>Report profile</span></button>
      `}
     </div>
    </section>
   </div>
   </section>`, "dark");
  $("#back").onclick = () => {
    if (backFromNotificationDetail()) return;
    if (navigateBack()) return;
    profileId = null;
    if (profileReturnChatId) {
      const previousChat = profileReturnChatId;
      profileReturnChatId = null;
      tab = "chat";
      chatId = previousChat;
    }
    render();
  };
  $("#profile-note") && ($("#profile-note").onclick = editProfileNote);
  $("#sharep") && ($("#sharep").onclick = () => { void shareProfile(u); });
  const profileActionSheet = $("#profile-actions-sheet");
  let profileActionReturnFocus = null;
  const closeProfileActionSheet = () => {
    if (!profileActionSheet) return;
    profileActionSheet.classList.remove("on");
    profileActionSheet.setAttribute("aria-hidden", "true");
    profileActionReturnFocus?.focus({ preventScroll: true });
    profileActionReturnFocus = null;
  };
  $("#profile-actions-open") && ($("#profile-actions-open").onclick = () => {
    if (!profileActionSheet) return;
    profileActionReturnFocus = document.activeElement;
    profileActionSheet.setAttribute("aria-hidden", "false");
    profileActionSheet.classList.add("on");
    profileActionSheet.querySelector('[role="dialog"]')?.focus({ preventScroll: true });
  });
  if (profileActionSheet) {
    profileActionSheet.onclick = event => { if (event.target === profileActionSheet) closeProfileActionSheet(); };
    profileActionSheet.onkeydown = event => { if (event.key === "Escape") closeProfileActionSheet(); };
    profileActionSheet.querySelector("[data-profile-actions-close]")?.addEventListener("click", closeProfileActionSheet);
    profileActionSheet.querySelector("[data-profile-settings]")?.addEventListener("click", () => {
      closeProfileActionSheet();
      navigateFromDrawer("settings");
    });
    profileActionSheet.querySelector("[data-profile-activity]")?.addEventListener("click", event => {
      const route = event.currentTarget.dataset.profileActivity;
      closeProfileActionSheet();
      navigateFromDrawer(route);
    });
  }
  void hydrateLocalMedia(app);
  bindPostDeleteActions();
  mountCreativeViewers(app, { onSource: openPostViewer, muted: true });
  app.querySelector("[data-profile-story]")?.addEventListener("click", () => openStory(u.id));
  $("#playall") && ($("#playall").onclick = () => {
    closeProfileActionSheet();
    if (locked) return toast("This account is private");
    openProfilePostPlayback(u.id, posts);
  });
  $("#more") && ($("#more").onclick = () => { profileMore = !profileMore; render(); });
  $("#profile-reposts-retry")?.addEventListener("click", async () => {
    const owner = api.cloudAccountId();
    const load = api.refreshCloudProfileReposts(u.id, u.username);
    render();
    try { await load; } catch { /* The profile shows the retry state. */ }
    if (api.cloudAccountId() === owner && profileId === u.id && profileMode === "reposts") render();
  });
  $("#profile-reposts-more")?.addEventListener("click", async () => {
    const owner = api.cloudAccountId();
    const load = api.loadMoreCloudProfileReposts(u.id, u.username);
    render();
    try { await load; } catch (error) { toast(error.message || "More reposts could not be loaded."); }
    if (api.cloudAccountId() === owner && profileId === u.id && profileMode === "reposts") render();
  });
  $("#logout") && ($("#logout").onclick = () => { closeProfileActionSheet(); logoutAccount(); settingsView = "home"; tab = "updates"; chatId = null; profileId = null; profileReturnChatId = null; viewer = null; render(); });
  app.querySelectorAll(".profile-section-tab[data-m]").forEach((button, index, buttons) => {
    const activateMode = mode => {
      profileMode = mode;
      render();
      requestAnimationFrame(() => $(`#profile-tab-${mode}`)?.focus({ preventScroll: true }));
    };
    button.onclick = () => activateMode(button.dataset.m);
    button.onkeydown = event => {
      let nextIndex = index;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % buttons.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + buttons.length) % buttons.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = buttons.length - 1;
      else return;
      event.preventDefault();
      activateMode(buttons[nextIndex].dataset.m);
    };
  });
  $("#pfollow") && ($("#pfollow").onclick = () => follow(u.id));
  $("#pmsg") && ($("#pmsg").onclick = () => { profileReturnChatId = null; tab = "chat"; chatId = ensureConvo([u.id]); render(); });
  $("#pfriend") && ($("#pfriend").onclick = () => { closeProfileActionSheet(); friend(u.id); });
  $("#pclosefriend") && ($("#pclosefriend").onclick = () => { closeProfileActionSheet(); toggleCloseFriend(u.id); });
  $("#pblock") && ($("#pblock").onclick = async () => {
    closeProfileActionSheet();
    if (api.authMode() === "cloud") {
      try {
        await api.refreshCloudBlocks();
        const selected = new Set(api.cloudBlocks());
        if (selected.has(u.id)) selected.delete(u.id);
        else selected.add(u.id);
        await api.replaceCloudBlocks([...selected]);
        render();
        toast(selected.has(u.id) ? "Account blocked" : "Account unblocked");
      } catch (error) { toast(error.message || "Block settings could not be updated."); }
      return;
    }
    mutate(db => {
      const i = db.blocks.findIndex(b => b.by === me.id && b.who === u.id);
      if (i >= 0) db.blocks.splice(i, 1);
      else db.blocks.push({ by: me.id, who: u.id });
    });
    render();
  });
  $("#prep") && ($("#prep").onclick = async () => {
    closeProfileActionSheet();
    try {
      const targetUserId = api.user(u.id)?.cloudAccountId || u.cloudAccountId || u.id;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUserId)) {
        throw new Error("This profile is not linked to an online account, so it cannot be reported.");
      }
      await api.submitCloudReport({
        kind: "profile",
        category: "Profile",
        targetUserId,
        reason: "Reported profile for review.",
      });
      toast("Report received by Oldtime. Review status is not available yet.");
    } catch (error) { toast(error.message || "Couldn’t submit this report."); }
  });
  $("#edit") && ($("#edit").onclick = openEditProfile);
  $("#edit-interests") && ($("#edit-interests").onclick = openEditProfile);
  app.querySelectorAll("[data-saved-filter]").forEach(button => button.onclick = () => {
    savedCollectionId = button.dataset.savedFilter;
    render();
  });
  app.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openPostViewer(b.dataset.open));
   app.querySelectorAll("[data-post-cover-edit]").forEach(button => button.onclick = event => {
     event.stopPropagation();
     const post = api.post(button.dataset.postCoverEdit);
     if (post) openProfilePostCoverEditor(u, post);
   });
}
async function shareProfile(user) {
  const link = new URL(location.pathname, location.origin);
  link.searchParams.set("user", user.username);
  const result = await shareExternally({
    title: `@${user.username} on Oldtime`,
    text: `Check out @${user.username} on Oldtime.`,
    url: link.href
  });
  if (result === "cancelled") return;
  if (result === "failed") return toast("Couldn't share this profile");
  toast(result === "shared" ? "Profile shared" : "Profile link copied");
}
function openEditProfile() {
  navigationStack.push(captureNavigationState());
  tab = "profile-edit";
  profileId = null;
  chatId = null;
  viewer = null;
  render();
}

function editProfilePage() {
  const me = api.me();
  const defaultCover = automaticProfileCover(me);
  const selectedInterests = new Set((Array.isArray(me.interests) ? me.interests : [])
    .filter(id => PROFILE_INTERESTS.some(interest => interest.id === id)));
  let resetCover = false;
  let coverObjectUrl = "";
  let avatarObjectUrl = "", pickedAvatar = null, pickedAvatarPreset = null;
  let pickedAvatarFile = null, pickedCoverFile = null;
  shell(`<section class="screen on edit-profile-screen">
    <header class="profile-editor-header">
      <button type="button" id="profile-editor-back" class="profile-editor-back" data-testid="button-profile-editor-back" aria-label="Back">${ic.back}</button>
      <b>Edit profile</b>
      <button type="button" id="savep-header" class="profile-editor-header-save" data-testid="button-save-profile-header">Save</button>
    </header>
    <div class="edit-profile-scroll">
      <section class="profile-editor-avatar-section">
        <img id="profile-avatar-preview" class="profile-editor-avatar" src="${esc(me.avatar || "")}" alt="Profile photo" />
          <div class="profile-avatar-actions">
            <label class="profile-editor-photo-action" data-testid="button-profile-photo-upload" for="avatar-file">Upload photo</label>
            <details class="profile-avatar-choices" id="profile-avatar-choices">
              <summary>Choose avatar</summary>
              <div class="profile-avatar-choice-panel">
                <div class="profile-avatar-choice-grid">${AVATAR_CHOICES.map(choice=>`<button type="button" class="profile-avatar-choice" data-profile-avatar="${choice.id}" aria-label="${choice.name} avatar" aria-pressed="${me.avatarPreset===choice.id}"><img src="${avatarImage(choice.id)}" alt="" /><span>${choice.name}</span></button>`).join("")}</div>
                <button type="button" class="profile-avatar-automatic" data-profile-avatar="automatic">Use automatic avatar</button>
              </div>
            </details>
          </div>
        <input id="avatar-file" type="file" accept="image/*" data-testid="input-profile-photo" aria-label="Choose a profile photo" />
      </section>
      <div class="profile-editor-fields">
        <label class="profile-editor-field"><span>Name</span><input id="nm" data-testid="input-profile-name" value="${esc(me.name)}" placeholder="Add your name" autocomplete="name" /></label>
        <label class="profile-editor-field"><span>Username</span><input id="un" data-testid="input-profile-username" value="${esc(me.username)}" placeholder="username" autocomplete="username" autocapitalize="none" /></label>
        <label class="profile-editor-field"><span>Email</span><input id="em" data-testid="input-profile-email" type="email" value="${esc(me.email || "")}" placeholder="Email (optional)" autocomplete="email" /></label>
        <div class="profile-editor-bio">
          <label for="bio">Bio</label>
          <textarea id="bio" data-testid="input-profile-bio" placeholder="Write a short bio">${esc(me.bio || "")}</textarea>
          <button type="button" class="profile-editor-emoji" id="bio-emoji" aria-label="Add emoji to bio">${ic.smile}</button>
        </div>
        <label class="profile-editor-field"><span>Birthday</span><input id="birthday" data-testid="input-profile-birthday" type="date" value="${esc(me.birthday || "")}" /></label>
        <label class="profile-editor-field"><span>City</span><input id="city" data-testid="input-profile-city" value="${esc(me.city || "")}" placeholder="Add a city" autocomplete="address-level2" /></label>
      </div>
      <section class="profile-editor-cover-section">
        <div class="profile-editor-section-heading"><b>Profile cover</b></div>
        <img id="cover-preview" src="${esc(me.cover || defaultCover)}" alt="Current profile cover" />
        <label class="profile-editor-cover-upload" data-testid="button-profile-cover-upload" for="cover-file">Upload a custom cover</label>
        <input id="cover-file" type="file" accept="image/*" data-testid="input-profile-cover" aria-label="Choose a custom profile cover" />
        <button type="button" class="profile-editor-auto-cover" id="cover-auto" data-testid="button-profile-cover-auto" aria-pressed="false">Use automatic cover</button>
      </section>
      <section class="profile-editor-interests">
        <div class="profile-editor-section-heading"><b>Interests</b><small>Choose up to 8</small></div>
        <div class="profile-interest-picker" role="group" aria-label="Choose your interests">
          ${PROFILE_INTERESTS.map(interest => `<button type="button" class="profile-interest-option ${selectedInterests.has(interest.id) ? "selected" : ""}" data-profile-interest="${interest.id}" data-testid="button-interest-${interest.id}" aria-pressed="${selectedInterests.has(interest.id)}">${interest.label}</button>`).join("")}
        </div>
      </section>
    </div>
    <footer class="profile-editor-footer">
      <button type="button" class="profile-editor-save-cover" id="save-cover" data-testid="button-save-profile-cover" disabled>Save cover photo</button>
      <button type="button" class="profile-editor-save" id="savep" data-testid="button-save-profile">Save changes</button>
    </footer>
  </section>`, "light");
  $("#bio-emoji").onclick = () => openEmojiPicker($("#bio"));
  app.querySelectorAll("[data-profile-interest]").forEach(button => {
    button.onclick = () => {
      const interestId = button.dataset.profileInterest;
      if (selectedInterests.has(interestId)) selectedInterests.delete(interestId);
      else {
        if (selectedInterests.size >= 8) return toast("Choose up to 8 interests");
        selectedInterests.add(interestId);
      }
      button.classList.toggle("selected", selectedInterests.has(interestId));
      button.setAttribute("aria-pressed", String(selectedInterests.has(interestId)));
    };
  });
  const coverInput = $("#cover-file");
  const coverPreview = $("#cover-preview");
  const coverAutoButton = $("#cover-auto");
  const coverSaveButton = $("#save-cover");
  const avatarInput = $("#avatar-file");
  const releaseAvatarPreview = () => {
    if(avatarObjectUrl)URL.revokeObjectURL(avatarObjectUrl);
    avatarObjectUrl="";
  };
  const markAvatarChoice = choice => {
    document.querySelectorAll("[data-profile-avatar]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.profileAvatar===choice)));
  };
  document.querySelectorAll("[data-profile-avatar]").forEach(button=>button.onclick=()=>{
    const choice=button.dataset.profileAvatar;
    pickedAvatar=choice==="automatic"?automaticAvatar(me.cloudAccountId||me.id):avatarImage(choice);
    pickedAvatarPreset=choice;
    pickedAvatarFile=null;
    avatarInput.value="";
    releaseAvatarPreview();
    $("#profile-avatar-preview").src=pickedAvatar;
    markAvatarChoice(choice);
    $("#profile-avatar-choices").open=false;
  });
  avatarInput.onchange=async()=>{
    const file=avatarInput.files?.[0];
    if(!file)return;
    try {
      const croppedFile=await openProfileImageCropper(file,"avatar");
      if(!croppedFile)return;
      pickedAvatarFile=croppedFile;
      pickedAvatar=null;pickedAvatarPreset=null;
      releaseAvatarPreview();
      avatarObjectUrl=URL.createObjectURL(croppedFile);
      $("#profile-avatar-preview").src=avatarObjectUrl;
      markAvatarChoice(null);
    } catch(error) {
      toast(error.message);
    } finally {
      avatarInput.value="";
    }
  };
  const releaseCoverPreview = () => {
    if (coverObjectUrl) URL.revokeObjectURL(coverObjectUrl);
    coverObjectUrl = "";
  };
  const leaveEditor = () => {
    releaseCoverPreview();
    releaseAvatarPreview();
    if (!navigateBack()) {
      tab = "updates";
      profileId = me.id;
      render();
    }
  };
  $("#profile-editor-back").onclick = leaveEditor;
  coverInput.onchange = async () => {
    const coverFile = coverInput.files?.[0];
    if (!coverFile) return;
    try {
      const croppedFile=await openProfileImageCropper(coverFile,"cover");
      if(!croppedFile)return;
      pickedCoverFile=croppedFile;
      resetCover = false;
      coverAutoButton.setAttribute("aria-pressed", "false");
      coverAutoButton.textContent = "Use automatic cover";
      releaseCoverPreview();
      coverObjectUrl = URL.createObjectURL(croppedFile);
      coverPreview.src = coverObjectUrl;
      coverSaveButton.disabled = false;
      coverSaveButton.textContent = "Save cover photo";
    } catch(error) {
      toast(error.message);
    } finally {
      coverInput.value = "";
    }
  };
  coverAutoButton.onclick = () => {
    resetCover = true;
    pickedCoverFile = null;
    coverInput.value = "";
    releaseCoverPreview();
    if (defaultCover) coverPreview.src = defaultCover;
    else coverPreview.removeAttribute("src");
    coverAutoButton.setAttribute("aria-pressed", "true");
    coverAutoButton.textContent = "Automatic cover selected";
    coverSaveButton.disabled = false;
    coverSaveButton.textContent = "Save automatic cover";
  };
  coverSaveButton.onclick = async () => {
    const coverFile = pickedCoverFile;
    if (!coverFile && !resetCover) return;
    try {
      if (coverFile && !coverFile.type.startsWith("image/")) throw new Error("Choose an image.");
      if (!api.cloudAccountId()) throw new Error("Sign in to your online account before saving your cover.");
      const cover = coverFile ? await putLocalMedia(coverFile) : null;
      await api.updateCloudAccountProfile({
        username: me.username,
        displayName: me.name,
        email: me.email,
        profile: {
          bio: me.bio || "",
          city: me.city || "",
          birthday: me.birthday || "",
          interests: Array.isArray(me.interests) ? me.interests : [],
          avatar: me.avatar || "",
          cover,
          profileVisibility: {
            city: me.profileVisibility?.city !== false,
            interests: me.profileVisibility?.interests !== false,
          },
          ...(me.avatarPreset ? { avatarPreset: me.avatarPreset } : {}),
        },
      });
      releaseCoverPreview();
      pickedCoverFile = null;
      if (coverFile) coverPreview.src = await mediaUrl(cover);
      else if (defaultCover) coverPreview.src = defaultCover;
      else coverPreview.removeAttribute("src");
      coverInput.value = "";
      resetCover = false;
      coverAutoButton.setAttribute("aria-pressed", String(!coverFile));
      coverAutoButton.textContent = coverFile ? "Use automatic cover" : "Automatic cover selected";
      coverSaveButton.disabled = true;
      coverSaveButton.textContent = coverFile ? "Cover photo saved" : "Automatic cover saved";
      toast(coverFile ? "Cover photo saved" : "Automatic cover saved");
    } catch (error) {
      toast(error.message);
    }
  };
  const profileSaveButtons = [$("#savep-header"), $("#savep")];
  const profileSaveLabels = profileSaveButtons.map(button => button.textContent);
  let savingProfile = false;
  const saveProfile = async () => {
    if (savingProfile) return;
    const username = $("#un").value.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return toast("Bad username");
    if (api.db().users.some(u => u.username === username && u.id !== me.id)) return toast("Username taken");
    const email = $("#em").value.trim().toLowerCase();
    const emailError = profileEmailValidationMessage(email, me.email, value => api.emailInUse(value, me.id));
    if (emailError) return toast(emailError);
    const file = pickedAvatarFile;
    const coverFile = pickedCoverFile;
    const changes = { name: $("#nm").value.trim() || username, username, email, bio: $("#bio").value.trim(), city: $("#city").value.trim(), birthday: $("#birthday").value, interests: [...selectedInterests] };
    try {
      savingProfile = true;
      profileSaveButtons.forEach(button => {
        button.disabled = true;
        button.textContent = "Saving…";
      });
      if (file && !file.type.startsWith("image/")) return toast("Choose an image");
      if (coverFile && !coverFile.type.startsWith("image/")) return toast("Choose an image");
      if (!api.cloudAccountId()) throw new Error("Sign in to your online account before saving your profile.");
      const avatar = file ? await putLocalMedia(file) : pickedAvatar || api.me()?.avatar || me.avatar;
      const cover = coverFile ? await putLocalMedia(coverFile) : resetCover ? null : me.cover || null;
      const profile = {
        bio: changes.bio,
        city: changes.city,
        birthday: changes.birthday,
        interests: changes.interests,
        avatar,
        cover,
        profileVisibility: {
          city: me.profileVisibility?.city !== false,
          interests: me.profileVisibility?.interests !== false,
        },
        ...(file ? { avatarPreset: null } : pickedAvatarPreset ? { avatarPreset: pickedAvatarPreset } : {}),
      };
      await api.updateCloudAccountProfile({
        username: changes.username,
        displayName: changes.name,
        email: changes.email,
        profile,
      });
    } catch (e) { toast(e.message); return; }
    finally {
      savingProfile = false;
      profileSaveButtons.forEach((button, index) => {
        button.disabled = false;
        button.textContent = profileSaveLabels[index];
      });
    }
    releaseCoverPreview();
    releaseAvatarPreview();
    if (!navigateBack()) {
      tab = "updates";
      profileId = me.id;
      render();
    }
    toast("Profile updated");
  };
  profileSaveButtons.forEach(button => { button.onclick = saveProfile; });
}

function editProfileNote() {
  const me = api.me();
  const sheet = $("#sheet");
  sheet.classList.add("on");
  sheet.innerHTML = `<div class="panel profile-note-panel"><div class="grab"></div><b>Your note</b>
    <p class="sub">This note appears above your profile photo.</p>
    <textarea class="field" id="note-text" maxlength="80" placeholder="Write a short note…">${esc(me.profileNote || "")}</textarea>
    <div class="note-form-row"><span class="sub" id="note-count"></span>${me.profileNote?.trim() ? `<button type="button" class="sub" id="remove-note">Remove note</button>` : ""}</div>
    <button type="button" class="btn" id="save-note">Save note</button></div>`;
  const input = $("#note-text");
  const updateCount = () => { $("#note-count").textContent = `${input.value.length}/80`; };
  updateCount();
  input.oninput = updateCount;
  $("#save-note").onclick = () => {
    const profileNote = input.value.trim();
    try {
      mutate(db => {
        const user = db.users.find(item => item.id === me.id);
        if (!user) throw new Error("Profile unavailable");
        user.profileNote = profileNote;
      });
    } catch (error) { return toast(error.message); }
    sheet.classList.remove("on");
    render();
    toast(profileNote ? "Note saved" : "Note removed");
  };
  $("#remove-note")?.addEventListener("click", () => {
    try { mutate(db => { const user = db.users.find(item => item.id === me.id); if (user) user.profileNote = ""; }); }
    catch (error) { return toast(error.message); }
    sheet.classList.remove("on");
    render();
    toast("Note removed");
  });
  sheet.onclick = (e) => { if (e.target === sheet) sheet.classList.remove("on"); };
}
function postViewer(id) {
  const p = api.post(id);
  if (!p || !api.canSeePost(p)) { viewer = null; render(); toast("Post unavailable"); return; }
  const author = api.user(p.author) || { id: p.author, username: "member", name: "Oldtime member", avatar: "" };
  const following = (api.me()?.following || []).includes(author.id);
  shell(`<section class="screen on post-viewer-screen">
    <header class="post-viewer-topbar">
      <button type="button" class="post-viewer-back" id="post-viewer-back" aria-label="Back">←</button>
      <button type="button" class="post-viewer-avatar" id="post-viewer-avatar" aria-label="Open @${esc(author.username)}'s Story or profile"><img src="${esc(author.avatar || "")}" alt="" /></button>
      <button type="button" class="post-viewer-identity" id="post-viewer-profile"><b>${esc(author.name || author.username)}</b><small>@${esc(author.username)}</small></button>
      ${author.id !== api.me()?.id ? `<button type="button" class="post-viewer-follow" id="post-viewer-follow" aria-pressed="${following}">${following ? "Following" : "Follow"}</button>` : ""}
      <button type="button" class="post-viewer-share" id="post-viewer-share" aria-label="Share post">${ic.share}</button>
    </header>
    <div class="post-viewer-feed">${postCard(p)}</div>
    <footer class="post-viewer-footer">
      <button type="button" class="post-viewer-comment-launch" id="post-viewer-comment" aria-label="Add a comment">
        <img src="${esc(api.me()?.avatar || "")}" alt="" /><span>Add a comment…</span>
      </button>
      <button type="button" class="post-viewer-footer-send" id="post-viewer-comment-send" aria-label="Open comments">${ic.send}</button>
    </footer>
  </section>`, "light", { hideNav: true });
  $("#post-viewer-back").onclick = () => {
    if (backFromNotificationDetail()) return;
    if (navigateBack()) return;
    viewer = null;
    render();
  };
  $("#post-viewer-avatar").onclick = () => openPersonAvatar(author.id);
  $("#post-viewer-profile").onclick = () => navigateToProfile(author.id);
  $("#post-viewer-follow")?.addEventListener("click", () => void follow(author.id));
  $("#post-viewer-share").onclick = () => void sharePost(id);
  const openComments = () => comments(id);
  $("#post-viewer-comment").onclick = openComments;
  $("#post-viewer-comment-send").onclick = openComments;
  bindPosts();
  if (pendingSharedComment && params.get("post") === id) {
    const commentId = pendingSharedComment;
    pendingSharedComment = "";
    comments(id, commentId);
  }
}
function ensureConvo(ids) { return makeConvo(ids); }
function chats() {
  openChatList({
    shell, toast, esc, ago, app, $: (q) => $(q), render,
    setChat: (id) => { chatId = id; render(); },
    openProfile: id => navigateToProfile(id, { fromChat: true }),
    openStory: authorId => openStory(authorId),
    editProfileNote
  });
}
function thread(id) {
  openThread(id, { shell, toast, esc, ago, app, $: (q) => $(q), render, setChat: (id) => { chatId = id; render(); }, openProfile: id => navigateToProfile(id, { fromChat: true }), openSharedPost: openPostViewer });
}

function isCloseFriendsStory(story) {
  const visibility = String(story?.visibility || story?.audience || "").toLowerCase().replace(/_/g, "-");
  return story?.closeFriends === true || visibility === "close-friends";
}

function communities() {
  const me = api.me();
  refreshCloudStoriesWhenNeeded();
  const desiredCommunitySurface = communityView === "following" ? "community-following" : "community";
  const initialCloudStatus = api.cloudCommunityFeedStatus();
  const startingCloudLoad = api.authMode() === "cloud" &&
    (!initialCloudStatus.loaded || initialCloudStatus.surface !== desiredCommunitySurface) &&
    !initialCloudStatus.loading &&
    (!initialCloudStatus.error || initialCloudStatus.surface !== desiredCommunitySurface);
  if (startingCloudLoad) {
    void api.refreshCloudCommunityFeed(communityView === "following").then(() => {
      if (tab === "communities") render();
    }).catch(() => {
      if (tab === "communities") render();
    });
  }
  const cloudStatus = api.cloudCommunityFeedStatus();
  const followed = new Set(me.following || []);
  const activeStories = api.stories()
    .filter(story => isStoryActive(story) && api.canSeeStory(story))
    .sort((a, b) => b.created - a.created);
  const storyByAuthor = new Map();
  activeStories.forEach(story => { if (!storyByAuthor.has(story.author)) storyByAuthor.set(story.author, story); });
  const followedPeople = [...followed]
    .map(id => api.user(id))
    .filter(person => person && api.canSee(person.id));
  const rankedPosts = api.authMode() === "cloud"
    ? api.ranked(desiredCommunitySurface)
    : api.ranked("foryou").filter(isCommunitySurfacePost);
  const communityPosts = api.authMode() === "cloud"
    ? rankedPosts
    : communityView === "following"
      ? rankedPosts.filter(post => post.author === me.id || followed.has(post.author))
      : rankedPosts;
  const myInterests = new Set(Array.isArray(me.interests) ? me.interests : []);
  const canMatchMyInterests = me.profileVisibility?.interests !== false;
  const canMatchMyCity = me.profileVisibility?.city !== false;
  const suggestedPeople = api.db().users
    .filter(person => person.id !== me.id && !followed.has(person.id) && api.canSee(person.id))
    .map(person => {
      const personInterests = new Set(Array.isArray(person.interests) ? person.interests : []);
      const sharedInterests = canMatchMyInterests && person.profileVisibility?.interests !== false
        ? [...myInterests].filter(id => personInterests.has(id))
        : [];
      const sameCity = canMatchMyCity
        && person.profileVisibility?.city !== false
        && cityMatchKey(me.city)
        && cityMatchKey(me.city) === cityMatchKey(person.city);
      return { person, sharedInterests, sameCity };
    })
    .filter(match => match.sharedInterests.length || match.sameCity)
    .sort((a, b) => b.sharedInterests.length - a.sharedInterests.length || Number(b.sameCity) - Number(a.sameCity) || (a.person.name || a.person.username).localeCompare(b.person.name || b.person.username))
    .slice(0, 8);
  const suggestedPeopleCards = suggestedPeople.map(({ person, sharedInterests, sameCity }) => {
    const matchSummary = [
      sameCity ? `City · ${esc(person.city)}` : "",
      ...sharedInterests.map(id => profileInterestName(id))
    ].filter(Boolean);
    const matchCount = sharedInterests.length;
    const matchTitle = matchCount
      ? `${matchCount} shared ${matchCount === 1 ? "interest" : "interests"}${sameCity ? " · Same city" : ""}`
      : "Same city";
    return `<article class="people-match-card" data-testid="card-person-match-${esc(person.id)}">
      <div class="people-match-person">
        <img src="${esc(person.avatar)}" alt="" />
        <div class="people-match-identity"><b>${esc(person.name || person.username)}</b><small>@${esc(person.username)}</small></div>
      </div>
      <p class="people-match-reason">${matchTitle}</p>
      <div class="people-match-tags">${matchSummary.map(label => `<span>${label}</span>`).join("")}</div>
      <div class="people-match-actions">
        <button type="button" class="people-match-view" data-vibe-profile="${esc(person.id)}" data-testid="button-view-match-${esc(person.id)}">View profile</button>
        <button type="button" class="people-match-follow" data-vibe-follow="${esc(person.id)}" data-testid="button-follow-match-${esc(person.id)}">Follow</button>
      </div>
    </article>`;
  }).join("");
  const peopleMatchEmpty = myInterests.size
    ? "No new matches yet. Try adding another interest."
    : "Choose a few interests to find people with more in common.";
  const fallbackPeople = followedPeople.length ? [] : suggestedPeople.map(match => match.person);
  const communityStoryIds = [...new Set([
    me.id,
    ...storyByAuthor.keys(),
    ...followedPeople.map(person => person.id),
    ...fallbackPeople.map(person => person.id)
  ])].filter(id => id === me.id || storyByAuthor.has(id) || api.canSee(id)).slice(0, 16);
  const communityStoryCards = communityStoryIds.map(id => {
    const person = api.user(id);
    if (!person) return "";
    const story = storyByAuthor.get(id);
    const own = id === me.id;
    const suggested = !own && !story && !followed.has(id) && followedPeople.length === 0;
    const actionLabel = story
      ? own ? "View your story" : `View @${person.username}'s story`
      : own ? "Create a story" : `Open @${person.username}'s profile`;
    const action = story || own ? `data-story="${esc(id)}"` : "";
    const ringClass = ["community-story-ring", story ? "has-story" : "", isCloseFriendsStory(story) ? "close-friends" : ""].filter(Boolean).join(" ");
    const testId = own ? "community-story-own" : `community-story-${id}`;
    const avatarButton = `<div class="community-story-person ${own ? "own-story" : ""} ${story ? "story-active" : ""}">
      <button type="button" data-testid="${esc(testId)}" class="community-story-avatar-button ${own ? "own-story" : ""}" data-avatar-profile="${esc(id)}" ${action} aria-label="${esc(actionLabel)}">
        <span class="community-story-avatar-wrap"><span class="${ringClass}"><img src="${esc(person.avatar)}" alt="" loading="lazy" /></span>${own && !story ? `<i class="community-story-add" aria-hidden="true">${ic.plus}</i>` : ""}</span>
      </button>
      <button type="button" class="community-story-name" data-profile="${esc(id)}" aria-label="Open @${esc(person.username)}'s profile">${esc(own ? "Your story" : person.username)}</button>
     </div>`;
    return suggested
      ? `<div class="community-story-suggestion">${avatarButton}<button type="button" class="community-story-follow" data-vibe-follow="${esc(id)}" aria-label="Follow @${esc(person.username)}">${ic.plus}</button></div>`
      : avatarButton;
  }).join("");
  const communityStoryFind = !followedPeople.length && !suggestedPeople.length
    ? `<button type="button" class="community-story-find" id="community-story-search">${ic.search}<span>Find people</span></button>`
    : "";
  const communityStoryHeading = followedPeople.length ? "Following" : "People";
  const communityCards = communityPosts.map(post => communityPostCard(post)).join("");
  const peopleDiscoverySection = followedPeople.length
    ? `<section class="stories-section people-match-section">
        <div class="people-match-heading"><h2 class="stories-heading">People to follow</h2><button type="button" id="edit-match-interests" data-testid="button-edit-match-interests">Edit interests</button></div>
        <div class="people-match-carousel" aria-label="People with shared interests or city">${suggestedPeopleCards || `<div class="people-match-empty">${peopleMatchEmpty}<button type="button" data-edit-match-interests data-testid="button-add-match-interests">Choose interests</button></div>`}</div>
      </section>`
    : "";
  shell(`<section class="screen on community-screen">
    <div class="stories-feed-scroll">
      <header class="community-header">
        <h1>Community</h1>
        <button type="button" class="community-header-action" id="community-search-open" aria-label="Search people, posts, and tags">${ic.search}</button>
        <button type="button" class="community-header-action" id="community-note-open" aria-label="Create post or Note" title="Create post or Note">${ic.plus}</button>
      </header>
      <section class="stories-section community-story-section">
        <div class="community-story-heading-row"><h2 class="stories-heading">${communityStoryHeading}</h2>${followedPeople.length ? "" : `<button type="button" id="edit-match-interests" data-testid="button-edit-match-interests">Edit interests</button>`}</div>
        <div class="community-story-rail" aria-label="${communityStoryHeading === "Following" ? "Following and active Stories" : "People and active Stories"}">${communityStoryCards}${communityStoryFind}</div>
      </section>
      <section class="stories-section community-feed-section">
        <div class="community-feed-tabs" role="tablist" aria-label="Community posts">
          <button type="button" role="tab" data-community-view="following" aria-selected="${communityView === "following"}" class="${communityView === "following" ? "on" : ""}">Following</button>
          <button type="button" role="tab" data-community-view="for-you" aria-selected="${communityView === "for-you"}" class="${communityView === "for-you" ? "on" : ""}">For you</button>
        </div>
        ${cloudStatus.error ? `<div class="community-feed-status" role="status">Online posts couldn’t load. <button type="button" id="community-feed-retry">Try again</button></div>` : cloudStatus.loading || startingCloudLoad ? `<p class="community-feed-loading" role="status">Loading posts…</p>` : ""}
        <div class="community-content-grid" aria-label="${communityView === "following" ? "Posts from people you follow" : "Recommended community posts"}">
          ${communityCards || (cloudStatus.loading || startingCloudLoad || cloudStatus.error ? "" : `<div class="stories-empty discover-empty">${communityView === "following" ? "Posts from people you follow will appear here." : "No posts yet. Share a Note, photo, or video."}</div>`)}
        </div>
        ${cloudStatus.hasMore ? `<button type="button" class="community-feed-more" id="community-feed-more" ${cloudStatus.loading ? "disabled" : ""}>${cloudStatus.loading ? "Loading…" : "Load more"}</button>` : ""}
      </section>
      ${peopleDiscoverySection}
    </div>
  </section>`, "light");
  const openCommunitySearch = () => {
    navigationStack.push(captureNavigationState());
    tab = "search";
    render();
    requestAnimationFrame(() => $("#q")?.focus({ preventScroll: true }));
  };
  $("#community-search-open").onclick = openCommunitySearch;
  $("#community-story-search")?.addEventListener("click", openCommunitySearch);
  bindPosts();
  $("#edit-match-interests")?.addEventListener("click", openEditProfile);
  app.querySelector("[data-edit-match-interests]")?.addEventListener("click", openEditProfile);
  $("#community-note-open").onclick = openCommunityNoteComposer;
  $("#community-feed-retry")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await api.refreshCloudCommunityFeed(communityView === "following"); } catch {}
    if (tab === "communities") render();
  });
  $("#community-feed-more")?.addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await api.loadMoreCloudCommunityFeed(); } catch {}
    if (tab === "communities") render();
  });
  app.querySelectorAll("[data-community-view]").forEach(button => button.onclick = () => {
    communityView = button.dataset.communityView === "following" ? "following" : "for-you";
    render();
  });
  app.querySelectorAll("[data-story]").forEach(button => button.onclick = event => {
    if (button.classList.contains("own-story") && event.target.closest(".friend-note")) return editProfileNote();
    openStory(button.dataset.story);
  });
  app.querySelectorAll("[data-profile-note]").forEach(button => button.onclick = () => {
    navigateToProfile(button.dataset.profileNote);
  });
  app.querySelectorAll("[data-stories-post]").forEach(button => button.onclick = () => {
    openPostViewer(button.dataset.storiesPost);
  });
  app.querySelectorAll("[data-vibe-profile]").forEach(button => button.onclick = () => {
    navigateToProfile(button.dataset.vibeProfile);
  });
  app.querySelectorAll("[data-vibe-follow]").forEach(button => button.onclick = () => follow(button.dataset.vibeFollow));
}

function openCommunityNoteComposer() {
  const sheet = $("#sheet");
  if (!sheet) return;
  const trigger = $("#community-note-open");
  const ownerId = api.me()?.id;
  let closed = false;
  let attachedImage = null;
  let attachedImageId = null;
  let previewUrl = null;
  const close = () => {
    if (closed) return;
    closed = true;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    document.removeEventListener("keydown", onKey);
    sheet.classList.remove("on");
    sheet.innerHTML = "";
    sheet.onclick = null;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  };
  const onKey = event => { if (event.key === "Escape") close(); };
  sheet.innerHTML = `<div class="panel community-note-panel" role="dialog" aria-modal="true" aria-labelledby="community-note-title" tabindex="-1">
    <div class="grab"></div>
    <header class="community-note-panel-head"><h2 id="community-note-title">Write a note</h2><button type="button" class="community-note-close" aria-label="Close">×</button></header>
    <label class="community-note-label" for="community-note-input">Share a thought with your Community</label>
    <textarea id="community-note-input" maxlength="1000" placeholder="What’s on your mind?" data-testid="input-community-note"></textarea>
    <div class="community-note-media-tools">
      <label class="community-note-image-picker" for="community-note-image">
        <span aria-hidden="true">＋</span><span>Add image</span>
        <input id="community-note-image" type="file" accept="image/*" hidden>
      </label>
      <div id="community-note-image-preview" class="community-note-image-preview" hidden></div>
    </div>
    <div class="community-note-compose-footer"><small id="community-note-count">0 / 1,000</small><button type="button" id="community-note-submit" disabled data-testid="button-post-note">Post</button></div>
    <p class="community-note-error" id="community-note-error" role="alert"></p>
  </div>`;
  sheet.classList.add("on");
  sheet.onclick = event => { if (event.target === sheet) close(); };
  document.addEventListener("keydown", onKey);
  const input = $("#community-note-input", sheet);
  const imageInput = $("#community-note-image", sheet);
  const imagePreview = $("#community-note-image-preview", sheet);
  const counter = $("#community-note-count", sheet);
  const submit = $("#community-note-submit", sheet);
  const error = $("#community-note-error", sheet);
  const syncSubmit = () => {
    submit.disabled = (!input.value.trim() && !attachedImage) || submit.dataset.busy === "true";
  };
  const clearAttachedImage = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    attachedImage = null;
    attachedImageId = null;
    imageInput.value = "";
    imagePreview.replaceChildren();
    imagePreview.hidden = true;
    syncSubmit();
  };
  sheet.querySelector(".community-note-close").onclick = close;
  input.oninput = () => {
    counter.textContent = `${[...input.value].length.toLocaleString()} / 1,000`;
    syncSubmit();
  };
  imageInput.onchange = () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      error.textContent = "Choose an image file.";
      imageInput.value = "";
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    attachedImage = file;
    attachedImageId = crypto.randomUUID();
    previewUrl = URL.createObjectURL(file);
    imagePreview.replaceChildren();
    const image = document.createElement("img");
    image.src = previewUrl;
    image.alt = "Image attached to your note";
    const details = document.createElement("div");
    details.className = "community-note-image-details";
    const name = document.createElement("span");
    name.textContent = file.name || "Image attached";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "community-note-image-remove";
    remove.setAttribute("aria-label", "Remove attached image");
    remove.textContent = "Remove";
    remove.onclick = clearAttachedImage;
    details.append(name, remove);
    imagePreview.append(image, details);
    imagePreview.hidden = false;
    error.textContent = "";
    imageInput.value = "";
    syncSubmit();
  };
  submit.onclick = async () => {
    const text = input.value.trim();
    if ((!text && !attachedImage) || submit.dataset.busy === "true") return;
    if (api.authMode() !== "cloud") {
      error.textContent = "Reconnect your online account before publishing a note.";
      return;
    }
    submit.dataset.busy = "true";
    submit.disabled = true;
    error.textContent = "";
    try {
      let mediaIds = [];
      if (attachedImage) {
        const reference = await putLocalMedia(attachedImage, attachedImageId);
        const uploadedId = String(reference || "").replace(/^oldtime-media:/, "");
        if (!/^[0-9a-f-]{36}$/i.test(uploadedId)) {
          throw new Error("The image upload could not be confirmed. Your note is still here.");
        }
        mediaIds = [uploadedId];
      }
      await api.createCloudPost(text, { destination: "community", mediaIds });
      if (api.me()?.id !== ownerId) { close(); return; }
      close();
      communityView = "for-you";
      render();
      toast("Note posted");
    } catch (failure) {
      error.textContent = failure.message || "Your note could not be posted. Try again.";
      submit.dataset.busy = "false";
      syncSubmit();
    }
  };
  sheet.querySelector(".community-note-close")?.focus();
  requestAnimationFrame(() => { if (!closed) input.focus(); });
}

function communityPostCard(post) {
  const author = api.user(post.author) || { id: post.author, username: "member", name: "Member", avatar: "/app/avatar.svg" };
  const currentUser = api.me();
  const text = String(post.text || post.caption || "").trim();
  const media = profilePostMedia(post);
  const likes = Array.isArray(post.likes) ? post.likes : [];
  const comments = Array.isArray(post.comments) ? post.comments : [];
  const saves = Array.isArray(post.saves) ? post.saves : [];
  const liked = likes.includes(currentUser?.id);
  const saved = saves.includes(currentUser?.id);
  const likeCount = Number(post.likeCount ?? likes.length);
  const commentCount = Number(post.commentCount ?? comments.reduce((count, item) => count + 1 + (item.replies?.length || 0), 0));
  const saveCount = Number(post.saveCount ?? saves.length);
  const repostCount = Number(post.repostCount ?? (post.reposts || []).length);
  const reposted = Boolean(post.repostedByMe) || (post.reposts || []).includes(currentUser?.id);
  const friendReposts = Array.isArray(post.repostedByFriends) ? post.repostedByFriends : [];
  const friendRepostCount = Number.isSafeInteger(post.friendRepostCount) ? post.friendRepostCount : friendReposts.length;
  const friendNames = friendReposts.slice(0, 3).map(friend => `@${friend.username || friend.displayName || "friend"}`);
  const friendMore = Math.max(0, friendRepostCount - friendNames.length);
  const repostAttribution = friendNames.length
    ? `<div class="community-repost-attribution" aria-label="Reposted by ${esc(friendNames.join(", "))}${friendMore ? ` and ${friendMore} more` : ""}"><span aria-hidden="true">${ic.repost}</span><span>Reposted by <b>${esc(friendNames.join(", "))}${friendMore ? ` and ${friendMore} more` : ""}</b></span></div>`
    : "";
  const mediaMarkup = media.map((source, index) => {
    const video = post.kind === "video" && index === 0;
    const preview = video
      ? `<video ${profileMediaSource(source)} muted playsinline preload="none" aria-label="Video post preview"></video><span class="community-media-play">${ic.play}</span>`
      : `<img ${profileMediaSource(source)} alt="${esc(text || "Community post photo")}" loading="lazy" />`;
    return `<button type="button" class="community-post-media-item" data-stories-post="${esc(post.id)}" aria-label="Open ${video ? "video" : "photo"} ${index + 1} by @${esc(author.username)}">${preview}</button>`;
  }).join("");
  return `<article class="community-post-card" data-testid="card-community-post-${esc(post.id)}">
    <header class="community-post-author-row">
      <button type="button" class="community-post-avatar" data-avatar-profile="${esc(author.id)}" aria-label="Open @${esc(author.username)}'s story or profile"><img src="${esc(author.avatar)}" alt="" loading="lazy" /></button>
      <button type="button" class="community-post-identity" data-profile="${esc(author.id)}">
        <b>${esc(author.name || author.username)}</b><small>@${esc(author.username)} · ${ago(Number(post.created || post.createdAt))}</small>
      </button>
      ${post.author === currentUser?.id ? `<button type="button" class="community-post-delete" data-delete-post="${esc(post.id)}" aria-label="Delete your post">${ic.trash}</button>` : ""}
    </header>
    ${repostAttribution}
    ${text ? `<button type="button" class="community-post-copy" data-stories-post="${esc(post.id)}">${esc(text)}</button>` : ""}
    ${mediaMarkup ? `<div class="community-post-media" data-count="${media.length}" data-kind="${post.kind === "video" ? "video" : "photo"}" aria-label="${post.kind === "video" ? "Post video" : "Post photos"}">${mediaMarkup}</div>` : ""}
    <div class="community-post-actions" aria-label="Post actions">
      <button type="button" class="${liked ? "is-active" : ""}" data-like="${esc(post.id)}" aria-label="${liked ? "Unlike post" : "Like post"}" aria-pressed="${liked}">${liked ? ic.heartOn : ic.heart}<span>${fmt(likeCount)}</span></button>
      <button type="button" data-comment="${esc(post.id)}" aria-label="Comment on post">${ic.comment}<span>${fmt(commentCount)}</span></button>
      <button type="button" class="${reposted ? "is-active" : ""}" data-repost="${esc(post.id)}" aria-label="${reposted ? "Remove repost" : "Repost"}" aria-pressed="${reposted}">${ic.repost}<span>${fmt(repostCount)}</span></button>
      <button type="button" data-share="${esc(post.id)}" aria-label="Share post">${ic.share}</button>
       <button type="button" class="${saved ? "is-active" : ""}" data-save="${esc(post.id)}" aria-label="${saved ? "Remove saved post" : "Save post"}" aria-pressed="${saved}">${saved ? ic.bookmarkOn : ic.bookmark}<span>${fmt(saveCount)}</span></button>
    </div>
  </article>`;
}

function peopleSearchQuery(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed.startsWith("#")) return "";
  return trimmed.replace(/^@/, "").trim().toLowerCase();
}

function renderSearchPreservingInput() {
  const input = $("#q");
  const keepFocus = document.activeElement === input;
  const start = input?.selectionStart ?? 0;
  const end = input?.selectionEnd ?? start;
  render();
  if (keepFocus) {
    const nextInput = $("#q");
    nextInput?.focus({ preventScroll: true });
    nextInput?.setSelectionRange(start, end);
  }
}

function schedulePeopleSearch(query) {
  if (peopleSearchTimer) clearTimeout(peopleSearchTimer);
  peopleSearchTimer = null;
  if (api.authMode() !== "cloud" || query.length < 2) {
    peopleSearchRequestId++;
    peopleSearch = { query, status: "idle", profiles: [], error: "" };
    return;
  }
  if (peopleSearch.query === query && ["loading", "success", "error"].includes(peopleSearch.status)) return;

  const requestId = ++peopleSearchRequestId;
  peopleSearch = { query, status: "loading", profiles: [], error: "" };
  peopleSearchTimer = setTimeout(async () => {
    peopleSearchTimer = null;
    try {
      const result = await requestCloudApi(`/api/users/search?query=${encodeURIComponent(query)}`);
      if (!Array.isArray(result?.profiles)) throw new Error("Account search returned an invalid response.");
      if (requestId !== peopleSearchRequestId || peopleSearch.query !== query) return;
      peopleSearch = { query, status: "success", profiles: result.profiles, error: "" };
    } catch (error) {
      if (requestId !== peopleSearchRequestId || peopleSearch.query !== query) return;
      peopleSearch = { query, status: "error", profiles: [], error: error?.message || "Couldn’t search online accounts." };
    }
    if (tab === "search" && peopleSearchQuery(searchQ) === query) renderSearchPreservingInput();
  }, 250);
}

function search() {
  const q = searchQ.trim().toLowerCase().replace(/^[@#]/, "");
  const peopleQuery = peopleSearchQuery(searchQ);
  schedulePeopleSearch(peopleQuery);
  const me = api.me();
  const remoteUsers = peopleSearch.query === peopleQuery && peopleSearch.status === "success"
    ? peopleSearch.profiles
      .filter(profile => profile && typeof profile.id === "string" && typeof profile.username === "string")
      .map(profile => {
        const id = api.cloudAuthorId(profile);
        return api.user(id);
      })
      .filter(Boolean)
    : [];
  const localUsers = api.db().users.filter(u =>
    u.id !== me.id && !api.blocked(me.id, u.id) &&
    (!q || u.username.toLowerCase().includes(q) || u.name.toLowerCase().includes(q))
  );
  const seenUsers = new Set();
  const users = [...remoteUsers, ...localUsers].filter(user => {
    if (user.id === me.id || api.blocked(me.id, user.id)) return false;
    const key = user.username.toLowerCase();
    if (seenUsers.has(key)) return false;
    seenUsers.add(key);
    return true;
  });
  const posts = api.posts().filter(p => !q || p.caption.toLowerCase().includes(q) || (p.tags || []).some(t => t.includes(q)) || (p.location || "").toLowerCase().includes(q));
  const tags = [...new Set(api.posts().flatMap(p => p.tags || []))].filter(t => !q || t.includes(q)).slice(0, 8);
  const peopleStatus = peopleQuery.length < 2
    ? (searchQ.trim() && !searchQ.trim().startsWith("#") ? `<div class="sub" role="status">Enter at least 2 characters to search accounts.</div>` : "")
    : peopleSearch.query !== peopleQuery || peopleSearch.status === "loading"
      ? `<div class="sub" role="status">Searching Oldtime accounts…</div>`
      : peopleSearch.status === "error"
        ? `<div class="sub" role="status">Couldn’t search online accounts. <button class="sub" type="button" id="people-search-retry">Try again</button></div>`
        : peopleSearch.status === "success" && !remoteUsers.length
          ? `<div class="sub" role="status">No matching Oldtime accounts.</div>`
          : "";
  shell(`<section class="screen on"><div class="scroll page"><button class="sub" id="back" aria-label="Back to previous screen">← Back</button><div class="h1">Search</div>
    <input class="search" id="q" placeholder="People, posts, #tags, places" value="${esc(searchQ)}" />
    <div class="chips" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${tags.map(t => `<button class="chip" data-tag="${t}">#${t}</button>`).join("")}</div>
     ${users.map(u => `<button class="listbtn search-person" data-profile="${esc(u.id)}"><img data-avatar-hit src="${esc(u.avatar)}" alt="" style="width:40px;height:40px;border-radius:50%;object-fit:cover" /><div><b>${esc(u.name || u.username)}</b><div class="sub">@${esc(u.username)}</div></div></button>`).join("")}
    ${peopleStatus}
     <div class="grid3" style="margin-top:10px">${posts.slice(0, 12).map(p => {
       const media = p.media?.[0] || "";
       const attrs = isLocalMedia(media) ? `data-local-media="${esc(media)}" data-local-media-owner="${esc(p.author)}"` : `src="${esc(renderMediaUrl(media))}"`;
       return `<button class="cell" data-open="${p.id}">${p.creativeProject ? creativeMediaMarkup(p, esc, false, true) : media ? (p.kind === "video" ? `<video ${attrs} muted></video>` : `<img ${attrs} />`) : `<div class="textpost" style="height:100%"><p style="font-size:12px">${esc(p.caption.slice(0, 30))}</p></div>`}</button>`;
     }).join("")}</div>
    ${!users.length && !posts.length && !peopleStatus ? `<div class="empty">${searchQ.trim() ? "No results. Try a username, name, hashtag, or place." : "Search for people, posts, hashtags, or places."}</div>` : ""}
  </div></section>`);
  $("#back").onclick = () => {
    if (!navigateBack()) { tab = "updates"; profileId = null; viewer = null; render(); }
  };
  $("#q").oninput = (e) => { const position = e.target.selectionStart; searchQ = e.target.value; render(); $("#q").focus({ preventScroll: true }); $("#q").setSelectionRange(position, position); };
  $("#people-search-retry")?.addEventListener("click", () => {
    peopleSearch = { query: "", status: "idle", profiles: [], error: "" };
    render();
  });
  app.querySelectorAll("[data-tag]").forEach(b => b.onclick = () => { searchQ = b.dataset.tag; render(); });
   app.querySelectorAll("[data-profile]").forEach(b => b.onclick = event => {
     if (event.target.closest("[data-avatar-hit]")) openPersonAvatar(b.dataset.profile);
     else navigateToProfile(b.dataset.profile);
   });
  app.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openPostViewer(b.dataset.open));
}

function notes() {
  const me = api.me();
  const reqs = api.db().requests.filter(r => r.to === me.id);
  const friendReqs = (Array.isArray(api.db().friendRequests) ? api.db().friendRequests : [])
    .filter(r => r.to === me.id && api.user(r.from));
  if (api.authMode() !== "cloud") mutate(db => db.notes.forEach(n => { if (n.user === me.id) n.read = true; }));
  const status = notificationState();
  if (status.loaded && !status.loading && !status.error) {
    void readAccountNotifications().then(changed => { if (changed && tab === "notes") render(); })
      .catch(() => toast("Notification read status could not be saved. Try again."));
  }
  const filters = [["all","All"],["following","People you follow"],["comments","Comments"],["activity","Activity"],["requests","Requests"]];
  const followedActors = new Set(Array.isArray(me.following) ? me.following : []);
  const commentKinds = new Set(["comment", "reply", "comment-remix", "story-comment"]);
  const activityKinds = new Set(["follow", "like", "share", "friend-accepted", "story-reaction"]);
  const filteredRequests = notificationFilter === "all" || notificationFilter === "requests" ? reqs : [];
  const filteredFriendRequests = notificationFilter === "all" || notificationFilter === "requests" ? friendReqs : [];
  const filteredNotes = accountNotifications()
    .filter(note => note.user === me.id && (
      notificationFilter === "all" ||
      (notificationFilter === "following" && followedActors.has(note.actor)) ||
      (notificationFilter === "comments" && commentKinds.has(note.kind)) ||
      (notificationFilter === "activity" && activityKinds.has(note.kind))
    ))
    .sort((a, b) => (b.created || 0) - (a.created || 0));
  const activityRoute = getAccountTools().accountType === "creator" ? "creator-studio" : getAccountTools().accountType === "business" ? "business-dashboard" : "personal-activity";
  shell(`<section class="screen on"><div class="scroll page"><div class="notifications-header"><button id="back" class="icon" aria-label="Back to previous screen" title="Back">${ic.back}</button><div class="h1">Notifications</div><button type="button" class="notification-insights-button" data-creator-open="${activityRoute}">Activity</button></div>
    <div class="notification-filter-control"><div class="notification-filters" aria-label="Filter notifications">${filters.map(([value,label]) => `<button type="button" class="notification-filter ${notificationFilter === value ? "is-active" : ""}" data-notification-filter="${value}" aria-pressed="${notificationFilter === value}">${label}${value === "requests" && reqs.length + friendReqs.length ? ` (${reqs.length + friendReqs.length})` : ""}</button>`).join("")}</div>
    <button type="button" class="icon" aria-label="Announcements and preferences" data-creator-open="announcements">${ic.settings}</button></div>
    ${filteredFriendRequests.map(r => `<div class="listbtn"><img src="${api.user(r.from)?.avatar || ""}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover" /><div><b>@${api.user(r.from)?.username || "member"}</b> wants to be Friends<div class="row"><button class="btn small" data-friend-accept="${r.from}">Accept</button><button class="btn ghost small" data-friend-decline="${r.from}">Decline</button></div></div></div>`).join("")}
    ${filteredRequests.map(r => `<div class="listbtn"><img src="${api.user(r.from)?.avatar || ""}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover" /><div><b>@${api.user(r.from)?.username || "member"}</b> requested to follow<div class="row"><button class="btn small" data-acc="${r.from}">Accept</button><button class="btn ghost small" data-dec="${r.from}">Decline</button></div></div></div>`).join("")}
    ${notificationFilter === "requests" ? "" : status.error ? `<div class="notification-load-status" role="alert">${esc(status.error)} <button type="button" id="notifications-retry">Retry</button></div>` : !status.loaded && api.authMode() === "cloud" ? `<div class="notification-load-status" role="status">Loading notifications…</div>` : ""}
    ${filteredNotes.map(n => `<button class="listbtn notification-row ${n.read ? "" : "is-unread"}" data-note="${esc(n.id)}"><img src="${api.user(n.actor)?.avatar || ""}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover" /><div><b>@${esc(api.user(n.actor)?.username || "someone")}</b> ${esc(n.body)}<div class="sub">${ago(n.created)}</div></div></button>`).join("") || ((notificationFilter !== "requests" && (status.error || (!status.loaded && api.authMode() === "cloud"))) || filteredRequests.length || filteredFriendRequests.length ? "" : `<div class="empty">${notificationFilter === "requests" ? "No follow or Friend requests right now." : notificationFilter === "all" ? "You’re caught up." : notificationFilter === "following" ? "No activity from people you follow yet." : notificationFilter === "comments" ? "No comment activity yet." : "No post activity yet."}</div>`)}
    ${status.hasMore && notificationFilter !== "requests" ? `<button type="button" class="btn ghost small" id="notifications-more">${status.loading ? "Loading…" : "Older notifications"}</button>` : ""}
  </div></section>`);
  $("#back").onclick = leaveNotifications;
  app.querySelectorAll("[data-notification-filter]").forEach(button => button.onclick = () => { notificationFilter = button.dataset.notificationFilter; notes(); });
  const reloadNotifications = options => {
    void loadAccountNotifications(options).then(() => { if (tab === "notes") render(); }).catch(() => { if (tab === "notes") render(); });
  };
  if ($("#notifications-retry")) $("#notifications-retry").onclick = () => reloadNotifications({ force: true });
  if ($("#notifications-more")) $("#notifications-more").onclick = () => reloadNotifications({ more: true });
   app.querySelectorAll("[data-acc]").forEach(b => b.onclick = async () => {
     const from = b.dataset.acc;
     if (api.authMode() === "cloud") {
       try { await api.respondCloudFollowRequest(from, true); render(); }
       catch (error) { toast(error.message || "Follow request could not be accepted."); }
       return;
     }
     mutate(db => { const meU = db.users.find(u => u.id === me.id); const them = db.users.find(u => u.id === from); if (!meU.followers.includes(from)) meU.followers.push(from); if (!them.following.includes(me.id)) them.following.push(me.id); db.requests = db.requests.filter(r => !(r.from === from && r.to === me.id)); });
     render();
   });
   app.querySelectorAll("[data-dec]").forEach(b => b.onclick = async () => {
     const from = b.dataset.dec;
     if (api.authMode() === "cloud") {
       try { await api.respondCloudFollowRequest(from, false); render(); }
       catch (error) { toast(error.message || "Follow request could not be declined."); }
       return;
     }
     mutate(db => { db.requests = db.requests.filter(r => !(r.from === from && r.to === me.id)); });
     render();
   });
  app.querySelectorAll("[data-friend-accept]").forEach(b => b.onclick = () => respondToFriendRequest(b.dataset.friendAccept, true));
  app.querySelectorAll("[data-friend-decline]").forEach(b => b.onclick = () => respondToFriendRequest(b.dataset.friendDecline, false));
   app.querySelectorAll("[data-note]").forEach(b => b.onclick = async () => {
     const n = accountNotifications().find(x => x.id === b.dataset.note);
    if (!n) return;
     if (n.post && api.authMode() === "cloud") {
       b.disabled = true;
       try { await api.loadCloudPost(n.post); }
       catch (error) { toast(error.message || "This post is no longer available."); b.disabled = false; return; }
       if (tab !== "notes" || api.me()?.id !== me.id) return;
     }
    notificationsReturnStack.push(captureNavigationState());
     if (n.story) { openStory(me.id, n.story); }
    else if (n.post) { viewer = n.post; profileId = null; tab = "updates"; render(); }
    else if (n.actor) { profileId = n.actor; viewer = null; tab = "updates"; render(); }
  });
}

async function loadTournamentNotifications() {
  const page = app.querySelector(".scroll.page");
  if (!page || tab !== "notes") return;
  const account = api.cloudAccountId();
  if (!account) return;
  try {
    const [result, preferences] = await Promise.all([
      getTournamentNotifications(), getTournamentNotificationPreferences(),
    ]);
    if (tab !== "notes" || !page.isConnected || account !== api.cloudAccountId()) return;
    const rows = result.notifications || [];
    page.querySelector(".tournament-notifications")?.remove();
    page.insertAdjacentHTML("afterbegin", `<section class="tournament-notifications" aria-label="Tournament notifications">
      <div class="row" style="justify-content:space-between;align-items:center"><b>Tournament updates</b>
        <button class="btn ghost small" type="button" data-tournament-reminders="${preferences.nonEssentialEnabled === false ? "off" : "on"}">${preferences.nonEssentialEnabled === false ? "Reminders off" : "Reminders on"}</button></div>
      ${rows.length ? rows.map(n => `<button type="button" class="listbtn notification-row" data-tournament-note="${esc(n.id)}" data-tournament-id="${esc(n.tournamentId)}">
        <span class="notification-icon">${ic.trophy || ic.users}</span><span><b>${esc(n.kind.replace(/_/g," "))}</b><br>${esc(n.body)}<div class="sub">${ago(new Date(n.createdAt).getTime())}${n.readAt ? "" : " · New"}</div></span></button>`).join("") : `<div class="sub" style="padding:10px 0">Tournament invitations, schedule reminders, and results will appear here.</div>`}
    </section>`);
    page.querySelectorAll("[data-tournament-note]").forEach(button => button.onclick = async () => {
      const { tournamentNote, tournamentId } = button.dataset;
      try { await markTournamentNotificationRead(tournamentNote); } catch {}
      notificationsReturnStack.push(captureNavigationState());
      openTournaments({ toast, initialId: tournamentId, onShare: shareTournamentReference });
    });
    page.querySelector("[data-tournament-reminders]")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      const enable = button.dataset.tournamentReminders === "off";
      button.disabled = true;
      try { await updateTournamentNotificationPreferences(enable); await loadTournamentNotifications(); }
      catch { button.textContent = "Could not update"; }
      finally { if (button.isConnected) button.disabled = false; }
    });
  } catch {
    if (tab === "notes" && page.isConnected && !page.querySelector(".tournament-notifications")) page.insertAdjacentHTML("afterbegin",
      `<section class="tournament-notifications"><b>Tournament updates</b><div class="sub">Tournament updates are temporarily unavailable. Please try again later.</div></section>`);
  }
}

async function migrateLegacyAccountDataInBackground(onProgress = () => {}) {
  const owner = api.cloudAccountId();
  if (!owner || !api.me()) throw new Error("The signed-in account is unavailable.");
  const conciseMigrationStatus = result => {
    const confirmed = Number(result?.confirmed ?? result?.migrated ?? 0);
    const pending = Number(result?.pending ?? 0);
    const unsupported = Number(result?.unsupported ?? 0);
    const existing = Number(result?.existing ?? 0);
    const parts = [];
    if (confirmed) parts.push(`${confirmed} confirmed`);
    if (pending) parts.push(`${pending} still need cloud confirmation`);
    if (unsupported) parts.push(`${unsupported} need review`);
    if (existing) parts.push(`${existing} already have a cloud copy; original kept`);
    return parts.length ? parts.join(" · ") : "Cloud records checked.";
  };
  const steps = [
    ["Profile and account settings", async () => {
      await api.loadCloudAccountState();
      return "Account data loaded from your online account.";
    }],
    ["Posts", async () => conciseMigrationStatus(await api.migrateCloudTextPosts({ retry: true }))],
    ["Stories", async () => {
      await api.refreshCloudStories();
      const result = await api.migrateCloudStories({ retry: true });
      if (result.confirmed) await api.refreshCloudStories();
      return conciseMigrationStatus(result);
    }],
    ["Private chat archives", async () => {
      const result = await api.migrateLegacyChatArchives({ retry: true });
      await api.refreshCloudChats();
      return conciseMigrationStatus(result);
    }],
    ["Community content and media", async () => {
      const [{ loadBlastSocialCloudState }, { loadBlastVideoNoteCloudState }] = await Promise.all([
        import("./blast-store.js"), import("./blast-video-note-store.js"),
      ]);
      await loadBlastSocialCloudState();
      await loadBlastVideoNoteCloudState();
      return "Community account data checked online.";
    }],
    ["Studio drafts", async () => {
      const { migrateLegacyCreativeDrafts } = await import("./creative-drafts.js");
      return conciseMigrationStatus(await migrateLegacyCreativeDrafts(api.me().id));
    }],
    ["Older camera media", async () => {
      const { migrateLegacyCameraPhotos } = await import("./creative-camera-recents.js");
      return conciseMigrationStatus(await migrateLegacyCameraPhotos(api.me().id));
    }],
  ];
  const results = [];
  for (const [label, action] of steps) {
    if (api.cloudAccountId() !== owner) {
      results.push({ label, status: "Stopped because the signed-in account changed.", warning: true });
      onProgress(results);
      break;
    }
    const row = { label, status: "Checking…" };
    results.push(row);
    onProgress(results);
    try {
      row.status = await action();
      row.warning = /need cloud confirmation|need review|pending/i.test(row.status);
    } catch (error) {
      row.status = error?.message || "Could not verify the cloud copy.";
      row.warning = true;
    }
    onProgress(results);
  }
  return results;
}

function settings() {
  const me = api.me();
  if (!api.db().settings) mutate(db => { db.settings = { readReceipts: true, lastSeen: "everyone" }; });
  const prefs = api.db().settings;
  const blocked = api.authMode() === "cloud"
    ? api.cloudBlocks().map(who => ({ by: me.id, who }))
    : api.db().blocks.filter(b => b.by === me.id);
  if (api.authMode() === "cloud" && settingsView === "blocked" && !api.cloudBlocksLoaded()) {
    const owner = api.cloudAccountId();
    void api.refreshCloudBlocks().then(() => {
      if (api.cloudAccountId() === owner && settingsView === "blocked") render();
    }).catch(error => toast(error.message || "Blocked accounts could not be loaded."));
  }
  const titles = { home: "Settings", password: "Password", privacy: "Account privacy", "close-friends": "Close Friends", chat: "Chat privacy", notifications: "Notifications", blocked: "Blocked accounts", help: "Help & Support", about: "About", campaigns: "Campaigns", "privacy-center": "Privacy Center" };
  const editableSettingsViews = new Set(["privacy", "close-friends", "chat", "notifications"]);
  const settingsDraft = {
    isPrivate: Boolean(me.private),
    showCity: me.profileVisibility?.city !== false,
    showInterests: me.profileVisibility?.interests !== false,
    readReceipts: prefs.readReceipts !== false,
    lastSeen: prefs.lastSeen || "everyone",
    notifications: me.notifs !== false,
    closeFriends: new Set(api.authMode() === "cloud" ? api.cloudCloseFriends() : (Array.isArray(me.closeFriends) ? me.closeFriends : []))
  };
  const initialSettingsDraft = { ...settingsDraft, closeFriends: new Set(settingsDraft.closeFriends) };
  const sameSet = (left, right) => left.size === right.size && [...left].every(id => right.has(id));
  const hasUnsavedSettings = () => {
    if (settingsView === "privacy") {
      return settingsDraft.isPrivate !== initialSettingsDraft.isPrivate ||
        settingsDraft.showCity !== initialSettingsDraft.showCity ||
        settingsDraft.showInterests !== initialSettingsDraft.showInterests;
    }
    if (settingsView === "close-friends") return !sameSet(settingsDraft.closeFriends, initialSettingsDraft.closeFriends);
    if (settingsView === "chat") {
      return settingsDraft.readReceipts !== initialSettingsDraft.readReceipts ||
        settingsDraft.lastSeen !== initialSettingsDraft.lastSeen;
    }
    if (settingsView === "notifications") return settingsDraft.notifications !== initialSettingsDraft.notifications;
    return false;
  };
  if (api.authMode() === "cloud" && settingsView === "privacy" && !api.cloudPrivacyLoaded()) {
    const owner = api.cloudAccountId();
    void api.refreshCloudPrivacy().then(isPrivate => {
      if (api.cloudAccountId() !== owner || settingsView !== "privacy" || hasUnsavedSettings()) return;
      if (settingsDraft.isPrivate !== isPrivate) {
        settingsDraft.isPrivate = isPrivate;
        initialSettingsDraft.isPrivate = isPrivate;
        render();
      }
    }).catch(error => toast(error.message || "Account privacy could not be loaded."));
  }
  const updateSettingsSaveState = () => {
    const saveButton = $("#settings-save");
    if (!saveButton) return;
    const dirty = hasUnsavedSettings();
    hasPendingSettingsChanges = dirty;
    saveButton.disabled = !dirty;
    const status = $("#settings-save-status");
    if (status) status.textContent = dirty ? "Unsaved changes" : "";
  };
  let content = "";
  let extra = null;
  const entry = (iconName, label, summary, view, id = "") => {
    const value = view === "privacy" ? (me.private ? "Private" : "Public")
      : view === "close-friends" ? String((me.closeFriends || []).length)
      : view === "blocked" ? String(blocked.length)
      : view === "notifications" ? (me.notifs === false ? "Off" : "On")
      : view === "chat" ? `${prefs.readReceipts === false ? "Receipts off" : "Receipts on"} · ${prefs.lastSeen || "everyone"}`
      : "";
    return `<button type="button" class="settings-entry" data-testid="button-settings-${id || view}" ${view ? `data-settings="${view}"` : ""} ${id ? `id="${id}"` : ""}>
      <span class="settings-entry-icon">${ic[iconName] || ic.more}</span>
      <span class="settings-entry-copy"><b>${label}</b>${summary ? `<small>${summary}</small>` : ""}</span>
      ${value ? `<small class="settings-entry-value">${value}</small>` : ""}
      <span class="settings-entry-chevron" aria-hidden="true">›</span>
    </button>`;
  };
  if (settingsView === "home") {
    content = `<div class="settings-home" id="settings-home">
      <button type="button" class="settings-account-card" data-settings-profile data-testid="button-settings-view-profile">
        <img src="${esc(me.avatar || "")}" alt="" />
        <span><b>${esc(me.name || me.username)}</b><small>@${esc(me.username)}</small></span>
        <span class="settings-account-action">View profile</span>
      </button>
      <label class="settings-search"><span aria-hidden="true">${ic.search}</span><input id="settings-search" type="search" placeholder="Search settings" aria-label="Search settings" /></label>
      <div class="settings-groups">
      <section class="settings-group" data-settings-group><h2>Your account</h2>
        <button type="button" class="settings-entry" data-creator-open="account-type"><span class="settings-entry-icon">${ic.user}</span><span class="settings-entry-copy"><b>Account Type</b><small>${esc(getAccountTools().accountType)} · Change your tools, not your identity.</small></span></button>
        <button type="button" class="settings-entry" data-creator-open="${getAccountTools().accountType==="creator"?"creator-studio":getAccountTools().accountType==="business"?"business-dashboard":"personal-activity"}"><span class="settings-entry-icon">${ic.user}</span><span class="settings-entry-copy"><b>${getAccountTools().accountType==="creator"?"Creator Studio":getAccountTools().accountType==="business"?"Business Dashboard":"Your activity"}</b><small>Your recorded profile visits, views and engagement.</small></span></button>
        ${getAccountTools().accountType==="creator"?'<button type="button" class="settings-entry" data-creator-open="creator-center"><span class="settings-entry-icon">'+ic.user+'</span><span class="settings-entry-copy"><b>Creator Center</b><small>Your progress and creator status.</small></span></button>':""}
        <button type="button" class="settings-entry" data-creator-open="blue-badge"><span class="settings-entry-icon">${ic.check}</span><span class="settings-entry-copy"><b>Blue Badge</b><small>Membership and benefits.</small></span></button>
        <button type="button" class="settings-entry" data-creator-open="announcements"><span class="settings-entry-icon">${ic.bell}</span><span class="settings-entry-copy"><b>Notifications &amp; Announcements</b><small>Creator updates, announcements, and offers.</small></span></button>
        ${entry("user", "Edit profile", "Update your photo, bio and interests.", "", "edit")}
        ${entry("lock", "Password", "Change your account password.", "password")}
        ${entry("settings", "About Oldtime", "Learn how this app works.", "about")}
      </section>
      ${settingGroups.map(group => `<section class="settings-group" data-settings-group><h2>${group.title}</h2>${group.items.map(([label, summary, id]) => {
        const direct = ({ privacy:"privacy", "close-friends":"close-friends", chat:"chat", notifications:"notifications", blocked:"blocked", "profile-visibility":"privacy" })[id];
        const iconName = ({ privacy:"lock", "close-friends":"users", chat:"comment", notifications:"bell", blocked:"lock", "profile-visibility":"user" })[id] || "settings";
        return entry(iconName, label, summary, direct || `setting-${id}`);
      }).join("")}</section>`).join("")}
      <section class="settings-group" data-settings-group><h2>Help and support</h2>
        ${entry("comment", "Help & Support", "Quick answers and practical guides.", "help")}
        ${entry("comment", "Feature walkthroughs", "Explore guides and manage occasional tips.", "help-guides")}
        ${entry("lock", "Privacy Center", "Manage your privacy and data.", "privacy-center")}
        ${entry("users", "Campaigns", "Find and share community support.", "campaigns")}
      </section>
      <section class="settings-group settings-account-actions" data-settings-group>
        <h2>Account actions</h2>
        ${entry("refresh", "Clear all app data", "Remove accounts and content from this device.", "", "reset")}
        ${entry("back", "Log out", "", "", "out")}
      </section>
      </div>
      <div class="settings-empty-search" id="settings-no-results" role="status" hidden>No settings match that search.</div>
    </div>`;
  } else if(settingsView==="help-guides"){
    const accountId=api.cloudAccountId()||me.id;
    content=renderGuideLibrary(accountId,esc);
    titles[settingsView]="Feature walkthroughs";
    extra={bind:()=>bindGuideLibrary(app,{accountId,toast,open:id=>showHelpfulWalkthrough({
      id,app,esc,navigate:navigateHelpfulPrompt,accountId,isSafe:isHelpfulSurfaceSafe,toast
    }),preview:id=>showHelpfulWalkthrough({
      id,app,esc,navigate:navigateHelpfulPrompt,accountId,isSafe:isHelpfulSurfaceSafe,toast,preview:true
    })})};
  } else if (settingsView.startsWith("campaign") || settingsView === "help" || settingsView.startsWith("help-") || settingsView === "privacy-center" || settingsView.startsWith("privacy-topic-")) {
    extra = extraScreen(settingsView, { api, me, db: api.db(), mutate, toast, campaignId: selectedCampaignId, navigate: route => {
      if(navigationStack.at(-1)?.helpfulArticle)delete navigationStack.at(-1).helpfulArticle;
      if(["help-blast","help-blast-invite","help-note","help-friends","help-messages","help-communities","help-studio"].includes(route))return navigateHelpfulPrompt(route);
      if (route === "edit-profile") return openEditProfile();
      if (["account-type","personal-activity","creator-studio","business-dashboard","monthly-recap","best-practices","inspiration","blue-badge"].includes(route)) return navigateFromDrawer(route);
      if (route.startsWith("campaign:")) selectedCampaignId = route.slice(9);
      else if (route === "campaign-edit") selectedCampaignId = settingsView.startsWith("campaign:") ? settingsView.slice(9) : selectedCampaignId;
      settingsView = route;
      render();
    } });
    content = extra.content;
    titles[settingsView] = extra.title;
  } else if (settingsView === "password") {
    content = api.authProvider() === "cognito"
      ? `<p class="sub">Choose “Forgot your password?” on the secure sign-in page to reset your password.</p><button class="btn primary" id="cognito-password" type="button">Open secure sign-in</button><div id="cognito-account-link" style="display:contents"></div>`
      : `<div id="cognito-account-link" style="display:contents"></div><form class="settings-password-form" id="password-form"><input class="field" id="cp" type="password" autocomplete="current-password" placeholder="Current password" aria-label="Current password" required />
      <input class="field" id="np" type="password" autocomplete="new-password" placeholder="New password (8–128 characters)" aria-label="New password" minlength="8" maxlength="128" required />
      <input class="field" id="confirm-pass" type="password" autocomplete="new-password" placeholder="Confirm password" aria-label="Confirm password" minlength="8" maxlength="128" required />
      <button class="btn" id="sp" type="submit" style="margin-top:8px">Save password</button></form>`;
  } else if (settingsView === "privacy") {
    content = `
      <button type="button" class="listbtn" id="private-toggle" data-testid="button-toggle-private" aria-pressed="${settingsDraft.isPrivate}">Private account · ${settingsDraft.isPrivate ? "On" : "Off"}</button>
      <div class="profile-visibility-settings">
        <b>Profile details</b>
        <button type="button" class="listbtn" data-profile-visibility="city" data-testid="button-toggle-city-visibility" aria-pressed="${settingsDraft.showCity}">Show city on profile · ${settingsDraft.showCity ? "On" : "Off"}</button>
        <button type="button" class="listbtn" data-profile-visibility="interests" data-testid="button-toggle-interest-visibility" aria-pressed="${settingsDraft.showInterests}">Show interests on profile · ${settingsDraft.showInterests ? "On" : "Off"}</button>
      </div>`;
  } else if (settingsView === "close-friends") {
    content = `
      <div class="sub close-friends-count" id="close-friends-count">${settingsDraft.closeFriends.size} added</div>
      <p class="sub">Only confirmed Friends can be added to Close Friends.</p>
      <input class="search" id="close-friends-search" type="search" placeholder="Search Friends" aria-label="Search Friends for Close Friends" />
      <div id="close-friends-list" aria-live="polite"></div>`;
  } else if (settingsView === "chat") {
    content = `
      <button type="button" class="listbtn" id="receipts-toggle" data-testid="button-toggle-read-receipts" aria-pressed="${settingsDraft.readReceipts}">Read receipts · ${settingsDraft.readReceipts ? "On" : "Off"}</button>
      <div class="settings-choice-block"><b>Last seen</b><div class="seg">${["everyone", "contacts", "nobody"].map(value => `<button type="button" data-last-seen="${value}" class="${settingsDraft.lastSeen === value ? "on" : ""}" aria-pressed="${settingsDraft.lastSeen === value}">${value[0].toUpperCase() + value.slice(1)}</button>`).join("")}</div></div>`;
  } else if (settingsView === "notifications") {
    content = `
      <button type="button" class="listbtn" id="notifs-toggle" data-testid="button-toggle-notifications" aria-pressed="${settingsDraft.notifications}">Notifications · ${settingsDraft.notifications ? "On" : "Off"}</button>`;
  } else if (settingsView === "blocked") {
    content = blocked.map(b => `<div class="listbtn"><span>@${esc(api.user(b.who)?.username || "unknown")}</span><button data-un="${esc(b.who)}">Unblock</button></div>`).join("") || `<div class="sub">No blocked users.</div>`;
  } else if (settingsView === "about") {
    content = `<b>Oldtime</b>`;
  }
  const hasEditableSettings = editableSettingsViews.has(settingsView);
  const saveBar = hasEditableSettings ? `<footer class="settings-save-bar" aria-live="polite">
    <span id="settings-save-status"></span>
    <button type="button" id="settings-save" data-testid="button-save-settings" disabled>Save changes</button>
  </footer>` : "";
  shell(`<section class="screen on account-settings-screen ${hasEditableSettings ? "settings-has-save" : ""}"><div class="scroll settings-scroll">
    <header class="settings-header">
      <button id="settings-back" class="settings-back" data-testid="button-settings-back" aria-label="${settingsView === "home" ? "Back" : "Back to Settings"}">${ic.back}</button>
       <div><h1>${titles[settingsView] || "Settings"}</h1></div>
      <span aria-hidden="true"></span>
    </header>
    <main class="settings-content">${content}</main>
  </div>${saveBar}</section>`, "light");
  void mountCognitoAction($("#cognito-account-link"), { intent: "link",
    connected: api.authProvider() === "cognito", onError: toast });
  $("#cognito-password") && ($("#cognito-password").onclick = async () => {
    const button = $("#cognito-password");
    button.disabled = true;
    try { await beginCognitoSignIn("login"); }
    catch (error) { if (button.isConnected) button.disabled = false; toast(error.message); }
  });
  if (extra) {
    extra.bind();
    app.querySelectorAll("[data-exp-nav]").forEach(button => {
      if (button.closest("#help-results")) return;
      button.onclick = () => {
      const route = button.dataset.expNav;
      if(navigationStack.at(-1)?.helpfulArticle)delete navigationStack.at(-1).helpfulArticle;
      if(["help-blast","help-blast-invite","help-note","help-friends","help-messages","help-communities","help-studio"].includes(route))return navigateHelpfulPrompt(route);
      if (route === "edit-profile") return openEditProfile();
      if (["account-type","personal-activity","creator-studio","business-dashboard","monthly-recap","best-practices","inspiration","blue-badge"].includes(route)) return navigateFromDrawer(route);
      if (route.startsWith("campaign:")) selectedCampaignId = route.slice(9);
      else if (route === "campaign-edit") selectedCampaignId = settingsView.startsWith("campaign:") ? settingsView.slice(9) : selectedCampaignId;
      settingsView = route;
      render();
      };
    });
  }
  if (settingsView === "close-friends") {
    let remoteCandidates = [];
    let searchVersion = 0;
    let cloudListReady = api.authMode() !== "cloud" || api.cloudCloseFriendsLoaded();
    let cloudListError = "";
    const renderCloseFriends = (query = "") => {
      const current = api.me();
      const selected = settingsDraft.closeFriends;
      const normalizedQuery = query.trim().toLowerCase();
      const cloudMode = api.authMode() === "cloud";
      if (cloudMode && !cloudListReady) {
        $("#close-friends-count").textContent = `${selected.size} added`;
        $("#close-friends-list").innerHTML = `<div class="empty">${esc(cloudListError || "Loading your Close Friends…")}</div>`;
        return;
      }
      const cloudSelected = [...selected].map(id => api.user(id)).filter(Boolean);
      const candidates = (cloudMode
        ? [...new Map([...cloudSelected, ...remoteCandidates].map(person => [person.id, person])).values()]
        : api.db().users.filter(person => api.areFriends(current.id, person.id) && !api.blocked(current.id, person.id)))
        .filter(person => !normalizedQuery || `${person.name || person.displayName || ""} ${person.username || ""}`.toLowerCase().includes(normalizedQuery))
        .sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) ||
          (a.name || a.displayName || a.username).localeCompare(b.name || b.displayName || b.username));
      $("#close-friends-count").textContent = `${selected.size} added`;
      $("#close-friends-list").innerHTML = candidates.map(person => {
        const added = selected.has(person.id);
        return `<button type="button" class="listbtn close-friend-row ${added ? "is-selected" : ""}" data-close-friend="${esc(person.id)}" aria-pressed="${added}">
          <img src="${esc(person.avatar || "")}" alt="" />
          <span class="close-friend-person"><b>${esc(person.name || person.displayName || person.username)}</b><small>@${esc(person.username)}</small></span>
          <span class="close-friend-state">${added ? "Added" : "Add"}</span>
        </button>`;
      }).join("") || `<div class="empty">${normalizedQuery ? "No accounts match that search." : cloudMode ? "Search by username to add people." : "Become Friends with someone first to add them here."}</div>`;
      app.querySelectorAll("[data-close-friend]").forEach(button => {
        button.onclick = () => {
          const id = button.dataset.closeFriend;
          if (!cloudMode && (!api.areFriends(current.id, id) || api.blocked(current.id, id))) {
            selected.delete(id);
            renderCloseFriends($("#close-friends-search").value);
            updateSettingsSaveState();
            return toast("Only confirmed Friends can be added to Close Friends");
          }
          if (selected.has(id)) selected.delete(id);
          else selected.add(id);
          updateSettingsSaveState();
          renderCloseFriends($("#close-friends-search").value);
        };
      });
    };
    $("#close-friends-search").oninput = event => {
      const query = event.currentTarget.value;
      renderCloseFriends(query);
      if (api.authMode() !== "cloud" || query.trim().length < 2) {
        remoteCandidates = [];
        renderCloseFriends(query);
        return;
      }
      const request = ++searchVersion;
      void api.searchCloudUsers(query).then(profiles => {
        if (request !== searchVersion || !$("#close-friends-list")?.isConnected) return;
        remoteCandidates = profiles;
        renderCloseFriends(query);
      }).catch(error => toast(error.message || "Account search could not be completed."));
    };
    renderCloseFriends();
    if (api.authMode() === "cloud") {
      const search = $("#close-friends-search");
      cloudListReady = api.cloudCloseFriendsLoaded();
      if (cloudListReady) return;
      void Promise.all([api.refreshCloudCloseFriends(), api.refreshCloudBlocks()]).then(([ids]) => {
        if (!$("#close-friends-list")?.isConnected) return;
        cloudListReady = true;
        settingsDraft.closeFriends = new Set(ids);
        initialSettingsDraft.closeFriends = new Set(ids);
        renderCloseFriends(search.value);
        updateSettingsSaveState();
      }).catch(error => {
        cloudListError = error.message || "Close Friends could not be loaded. Try again.";
        toast(cloudListError);
        renderCloseFriends(search.value);
      });
    }
  }
  const save = (change, message) => {
    try { mutate(change); } catch (e) { toast(e.message); return false; }
    render();
    if (message) toast(message);
    return true;
  };
  const saveSettingsButton = $("#settings-save");
  if (saveSettingsButton) saveSettingsButton.onclick = async () => {
    if (!hasUnsavedSettings()) return;
    try {
      if (api.authMode() === "cloud" && settingsView === "privacy") {
        await api.updateCloudPrivacy(settingsDraft.isPrivate);
      } else if (api.authMode() === "cloud" && settingsView === "close-friends") {
        await api.replaceCloudCloseFriends([...settingsDraft.closeFriends]);
        render();
        toast("Close Friends saved");
        return;
      } else if (api.authMode() === "cloud" && settingsView === "chat") {
        await api.updateCloudAccountState({ chatPreferences: {
          readReceipts: settingsDraft.readReceipts,
          lastSeen: settingsDraft.lastSeen,
        } });
      } else if (api.authMode() === "cloud" && settingsView === "notifications") {
        await api.updateCloudAccountState({ notificationEnabled: settingsDraft.notifications });
      }
      mutate(db => {
        const account = db.users.find(user => user.id === me.id);
        if (!account) throw new Error("Account unavailable");
        if (settingsView === "privacy") {
          account.private = settingsDraft.isPrivate;
          account.profileVisibility = {
            ...account.profileVisibility,
            city: settingsDraft.showCity,
            interests: settingsDraft.showInterests
          };
        } else if (settingsView === "close-friends") {
          account.closeFriends = [...settingsDraft.closeFriends].filter(id =>
            id !== account.id && api.areFriends(account.id, id) && !api.blocked(account.id, id)
          );
        } else if (settingsView === "chat") {
          db.settings = {
            ...db.settings,
            readReceipts: settingsDraft.readReceipts,
            lastSeen: settingsDraft.lastSeen
          };
        } else if (settingsView === "notifications") {
          account.notifs = settingsDraft.notifications;
        }
      });
    } catch (error) {
      toast(error.message || "Couldn't save settings");
      return;
    }
    hasPendingSettingsChanges = false;
    render();
    toast("Settings saved");
  };
  $("#settings-back").onclick = () => {
    if ((hasPendingSettingsChanges || hasUnsavedSettings()) && !confirm("Discard your unsaved settings changes?")) return;
    hasPendingSettingsChanges = false;
    if (settingsView.startsWith("campaign:")) { settingsView = "campaigns"; selectedCampaignId = null; render(); }
    else if (settingsView === "campaign-edit") { settingsView = selectedCampaignId ? `campaign:${selectedCampaignId}` : "campaigns"; render(); }
    else if (settingsView === "campaign-create") { settingsView = "campaigns"; render(); }
    else if (settingsView.startsWith("help-article-")) {
      if(navigationStack.at(-1)?.helpfulArticle===settingsView&&navigateBack())return;
      settingsView = "help"; render();
    }
    else if (settingsView.startsWith("privacy-topic-")) { settingsView = "privacy-center"; render(); }
    else if (settingsView !== "home") { settingsView = "home"; render(); }
    else if (!navigateBack()) { tab = "updates"; profileId = me.id; render(); }
  };
  app.querySelectorAll("[data-settings]").forEach(b => b.onclick = () => { settingsView = b.dataset.settings; render(); });
  $("#edit") && ($("#edit").onclick = openEditProfile);
  app.querySelector("[data-settings-profile]")?.addEventListener("click", () => navigateToProfile(me.id));
  $("#settings-search") && ($("#settings-search").oninput = event => {
    const query = event.currentTarget.value.trim().toLowerCase();
    let visibleEntries = 0;
    app.querySelectorAll(".settings-group").forEach(group => {
      const entries = [...group.querySelectorAll(".settings-entry")];
      let visibleInGroup = 0;
      entries.forEach(button => {
        const matches = !query || button.textContent.toLowerCase().includes(query);
        button.hidden = !matches;
        if (matches) visibleInGroup += 1;
      });
      group.hidden = visibleInGroup === 0;
      visibleEntries += visibleInGroup;
    });
    const empty = $("#settings-no-results");
    if (empty) empty.hidden = !query || visibleEntries > 0;
  });
  $("#password-form") && ($("#password-form").onsubmit = async event => {
    event.preventDefault();
    const currentPassword = $("#cp").value;
    const password = $("#np").value;
    if (password.length < 8 || password.length > 128) return toast("Password must be 8–128 characters");
    if (password !== $("#confirm-pass").value) return toast("Passwords do not match");
    try {
      if (api.authMode() === "cloud") {
        await api.changePassword(currentPassword, password);
      } else {
        if (currentPassword !== api.me().password) return toast("Current password is wrong");
        if (!save(db => { db.users.find(u => u.id === me.id).password = password; })) return;
      }
      settingsView = "home";
      render();
      toast("Password updated");
    } catch (error) {
      toast(error.message || "Couldn’t update your password");
    }
  });
  $("#private-toggle") && ($("#private-toggle").onclick = () => {
    settingsDraft.isPrivate = !settingsDraft.isPrivate;
    $("#private-toggle").setAttribute("aria-pressed", String(settingsDraft.isPrivate));
    $("#private-toggle").textContent = `Private account · ${settingsDraft.isPrivate ? "On" : "Off"}`;
    updateSettingsSaveState();
  });
  app.querySelectorAll("[data-profile-visibility]").forEach(button => button.onclick = () => {
    const key = button.dataset.profileVisibility === "city" ? "showCity" : "showInterests";
    settingsDraft[key] = !settingsDraft[key];
    const label = button.dataset.profileVisibility === "city" ? "Show city on profile" : "Show interests on profile";
    button.setAttribute("aria-pressed", String(settingsDraft[key]));
    button.textContent = `${label} · ${settingsDraft[key] ? "On" : "Off"}`;
    updateSettingsSaveState();
  });
  $("#receipts-toggle") && ($("#receipts-toggle").onclick = () => {
    settingsDraft.readReceipts = !settingsDraft.readReceipts;
    $("#receipts-toggle").setAttribute("aria-pressed", String(settingsDraft.readReceipts));
    $("#receipts-toggle").textContent = `Read receipts · ${settingsDraft.readReceipts ? "On" : "Off"}`;
    updateSettingsSaveState();
  });
  app.querySelectorAll("[data-last-seen]").forEach(button => button.onclick = () => {
    settingsDraft.lastSeen = button.dataset.lastSeen;
    app.querySelectorAll("[data-last-seen]").forEach(option => {
      const selected = option.dataset.lastSeen === settingsDraft.lastSeen;
      option.classList.toggle("on", selected);
      option.setAttribute("aria-pressed", String(selected));
    });
    updateSettingsSaveState();
  });
  $("#notifs-toggle") && ($("#notifs-toggle").onclick = () => {
    settingsDraft.notifications = !settingsDraft.notifications;
    $("#notifs-toggle").setAttribute("aria-pressed", String(settingsDraft.notifications));
    $("#notifs-toggle").textContent = `Notifications · ${settingsDraft.notifications ? "On" : "Off"}`;
    updateSettingsSaveState();
  });
  app.querySelectorAll("[data-un]").forEach(b => b.onclick = async () => {
    if (api.authMode() === "cloud") {
      try {
        await api.replaceCloudBlocks(api.cloudBlocks().filter(id => id !== b.dataset.un));
        render();
        toast("Unblocked");
      } catch (error) { toast(error.message || "The account could not be unblocked."); }
      return;
    }
    save(db => { db.blocks = db.blocks.filter(x => !(x.by === me.id && x.who === b.dataset.un)); }, "Unblocked");
  });
   $("#save-report") && ($("#save-report").onclick = () => {
    const reason = $("#problem").value.trim();
    if (!reason) return toast("Describe the problem first");
     save(db => db.reports.push({ id: "h" + Date.now(), by: me.id, target: "app", reason, at: Date.now() }), "Report saved");
  });
  $("#out") && ($("#out").onclick = () => { logoutAccount(); settingsView = "home"; tab = "updates"; chatId = null; profileId = null; viewer = null; render(); });
  $("#reset") && ($("#reset").onclick = () => {
    if (!confirm("Permanently delete all Oldtime data in this browser, including accounts, posts, stories, messages, and settings?")) return;
    api.reset();
    settingsView = "home";
    tab = "updates";
    profileId = null;
    viewer = null;
    render();
  });
}

const params = new URLSearchParams(location.search);
let pendingSharedComment = params.get("comment") || "";
let pendingStoryId = params.get("story") || "";
let pendingStoryOpening = false;
if (params.get("post")) viewer = params.get("post");
if (params.get("user")) profileId = api.user(params.get("user"))?.id || null;
async function resolvePendingStoryLink() {
  if (!pendingStoryId || pendingStoryOpening || !api.me()) return;
  const requestedId = pendingStoryId;
  const requestingAccount = api.cloudAccountId();
  pendingStoryOpening = true;
  try {
    await api.refreshCloudStories();
    if (requestingAccount !== api.cloudAccountId() || requestedId !== pendingStoryId) return;
    const story = api.stories().find(item => item.id === requestedId);
    pendingStoryId = "";
    if (!story || !api.canSeeStory(story)) { toast("Story unavailable"); return; }
    openStory(story.author, story.id);
  } catch (error) {
    if (requestingAccount === api.cloudAccountId() && requestedId === pendingStoryId) {
      pendingStoryId = "";
      toast(error.message || "Story could not be opened.");
    }
  } finally {
    pendingStoryOpening = false;
  }
}
window.addEventListener("oldtime-data", () => {
  if ($("#sheet.on") || $("#storyview.on") || $(".emoji-overlay")) return;
  const input = document.activeElement;
  const position = input?.selectionStart;
  const end = input?.selectionEnd;
  render();
  if (input?.id && $( `#${input.id}`) && typeof position === "number") {
    const next = $(`#${input.id}`); next.focus(); next.setSelectionRange(position, end);
  }
});
window.addEventListener("error", e => { if (e.error?.message) toast(e.error.message); });
window.addEventListener("unhandledrejection", e => { if (e.reason?.message) toast(e.reason.message); });
void (async () => {
  let result = null, failure = "";
  try {
    result = await completeCognitoSignIn();
    if (!result) await api.restoreCloudAccount();
  }
  catch (error) { failure = error.message || "Secure sign-in could not be completed."; }
  render();
  if (failure) {
    const field = $("#err");
    if (field) field.textContent = failure;
    else toast(failure);
  } else if (result === "link") toast("Secure sign-in connected");
  void finishStartup();
})();
