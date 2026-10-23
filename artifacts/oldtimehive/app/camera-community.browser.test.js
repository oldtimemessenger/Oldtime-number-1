import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    "/repl/tools/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome"
  ].filter(Boolean);
  const installed = candidates.find(path => existsSync(path));
  if (installed) return installed;

  for (const command of ["chromium", "chromium-browser", "google-chrome"]) {
    try {
      return execFileSync("which", [command], { encoding: "utf8" }).trim();
    } catch {}
  }
  throw new Error("Chromium is required for the Oldtime browser regression test.");
}

const fixture = {
  session: "camera-quotes-test",
  settings: { readReceipts: true, lastSeen: "everyone" },
  users: [{
    id: "camera-quotes-test",
    username: "testmember",
    name: "Test Member",
    email: "testmember@example.test",
    password: "test-password",
    avatar: "/app/avatar.svg",
    private: false,
    followers: [],
    following: [],
    friends: ["story-member"],
    closeFriends: ["story-member"],
    interests: [],
    profileVisibility: { city: true, interests: true }
  }, {
    id: "story-member",
    username: "storymember",
    name: "Story Member",
    avatar: "/app/avatar.svg",
    private: false,
    followers: [],
    following: [],
    friends: ["camera-quotes-test"],
    closeFriends: [],
    interests: [],
    profileVisibility: { city: true, interests: true }
  }, {
    id: "story-outsider",
    username: "storyoutsider",
    name: "Story Outsider",
    avatar: "/app/avatar.svg",
    private: false,
    followers: [],
    following: [],
    friends: [],
    closeFriends: [],
    interests: [],
    profileVisibility: { city: true, interests: true }
  }],
  requests: [],
  friendRequests: [],
  posts: [],
  stories: [],
  convos: [{
    id: "primary-chat",
    members: ["camera-quotes-test", "story-member"],
    messages: [{ id: "primary-message", author: "story-member", body: "Primary conversation", created: 1700000000000 }]
  }, {
    id: "request-chat",
    members: ["camera-quotes-test", "story-outsider"],
    messages: [{ id: "request-message", author: "story-outsider", body: "Request conversation", created: 1700000001000 }]
  }, {
    id: "general-chat",
    members: ["camera-quotes-test", "story-member", "story-outsider"],
    group: { name: "General test group" },
    messages: [
      { id: "general-message", author: "story-member", body: "General conversation", created: 1700000002000 },
      { id: "general-outgoing", author: "camera-quotes-test", body: "hey", created: 1700000002500 },
      { id: "general-outgoing-followup", author: "camera-quotes-test", body: "again", created: 1700000003000 }
    ]
  }],
  notes: [],
  blocks: [],
  reports: [],
  campaigns: [],
  interests: {},
  resets: []
};

test("Oldtime navigation, settings, search, profile, Chat, and creation flows work in the browser", {
  timeout: 180_000
}, async () => {
  const originalPort = process.env.PORT;
  const originalBasePath = process.env.BASE_PATH;
  process.env.PORT = "5173";
  process.env.BASE_PATH = "/";

  const server = await createServer({
    configFile: resolve(packageRoot, "vite.config.ts"),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, strictPort: false }
  });
  let browser;

  try {
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address === "object", "Vite should listen on an available port");

    browser = await chromium.launch({
      executablePath: findChromium(),
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking",
        "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
    });
    const context = await browser.newContext({
      serviceWorkers: "block",
      viewport: { width: 402, height: 874 }
    });
    // This isolated rendering regression test has no API service. Real
    // authentication and draft recovery are also checked against the running app.
    const storyNow = Date.now();
    const browserStories = [{
      id: "cloud-friend-story", text: "Story viewer reference", visibility: "public", hasMedia: true, mediaType: "photo",
      savedToProfile: false, commentsEnabled: true, createdAt: storyNow - 3_600_000, expiresAt: storyNow + 80_400_000,
      author: { id: "story-member", username: "storymember", displayName: "Story Member", createdAt: storyNow - 1_000_000 }
    }, {
      id: "cloud-owner-story", text: "Owner activity reference", visibility: "public", hasMedia: true, mediaType: "photo",
      savedToProfile: false, commentsEnabled: true, createdAt: storyNow - 1_800_000, expiresAt: storyNow + 84_600_000,
      author: { id: fixture.session, username: "testmember", displayName: "Test Member", createdAt: storyNow - 2_000_000 }
    }];
    let publishedStory = null;
    let studioMediaReserved = false;
    let communityPostPublishingEnabled = false;
    let createdCommunityPostBody = null;
    let ownerStoryReaction = null;
    let accountState = null;
    const storyApiCalls = [];
    const communityPost = {
      id: "browser-repost-post",
      sourceId: null,
      destination: "both",
      text: "A cloud-backed photo for the repost interaction test",
      visibility: "public",
      media: [{
        id: "browser-repost-media",
        contentType: "image/svg+xml",
        reference: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 800'%3E%3Crect width='400' height='800' fill='%23101116'/%3E%3Ccircle cx='200' cy='300' r='120' fill='%23e12b36'/%3E%3C/svg%3E",
      }],
      createdAt: storyNow,
      author: { id: "story-member", username: "storymember", displayName: "Story Member", joinedAt: storyNow - 1_000_000 },
      likeCount: 0,
      likedByMe: false,
      likedBy: [],
      commentCount: 2,
      saveCount: 4,
      remixSourcePostId: null,
      remixCount: 3,
      repostCount: 0,
      repostedByMe: false,
      repostNote: null,
      place: null,
      sportsCard: null,
    };
    let showRepostFixture = false;
    let communityReposted = false;
    let showProfileGridFixture = false;
    const profileGridPosts = [{
      id: "profile-grid-image", text: "", visibility: "public",
      media: [{ id: "profile-grid-image-media", contentType: "image/svg+xml", reference: "/app/avatar.svg" }],
      createdAt: storyNow - 3_000, author: { id: fixture.session, username: "testmember", displayName: "Test Member" },
      likeCount: 1, likedByMe: false, commentCount: 2, saveCount: 3,
      remixSourcePostId: null, remixCount: 5, repostCount: 4, repostedByMe: false, savedByMe: false,
    }, {
      id: "profile-grid-note", text: "A thought from the test profile", visibility: "public", media: [],
      createdAt: storyNow - 2_000, author: { id: fixture.session, username: "testmember", displayName: "Test Member" },
      likeCount: 0, likedByMe: false, commentCount: 0, saveCount: 0,
      remixSourcePostId: null, remixCount: 0, repostCount: 0, repostedByMe: false, savedByMe: false,
    }, {
      id: "profile-grid-video", text: "A video in the community timeline", visibility: "public",
      media: [{ id: "profile-grid-video-media", contentType: "video/mp4", reference: "/app/avatar.svg" }],
      createdAt: storyNow - 1_000, author: { id: fixture.session, username: "testmember", displayName: "Test Member" },
      likeCount: 0, likedByMe: false, commentCount: 0, saveCount: 0,
      remixSourcePostId: null, remixCount: 0, repostCount: 0, repostedByMe: false, savedByMe: false,
    }];
    const isolateApi=route=>{
      const url = new URL(route.request().url());
      if (url.pathname === "/api/account/state") {
        if (route.request().method() === "GET") {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: accountState }) });
        }
        if (route.request().method() === "PUT") {
          accountState = route.request().postDataJSON()?.state || null;
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: accountState }) });
        }
      }
      if (url.pathname === "/api/account/profile" && route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        const profile = {
          ...body.profile,
          username: body.username,
          displayName: body.displayName,
          profileVisibility: body.profile?.profileVisibility || { city: true, interests: true },
        };
        accountState = { ...(accountState || {}), profile };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            account: { id: fixture.session, username: body.username, displayName: body.displayName, email: body.email },
            profile,
          }),
        });
      }
      if (url.pathname === "/api/account/professional") {
        return route.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify({ accountType: "personal", settings: { accountType: "personal" } }) });
      }
      if (url.pathname === "/api/analytics/me") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          overview: { views: 12, profileVisits: 3, uniqueViewers: 8, newFollowers: 2, unfollows: 0,
            netFollowers: 2, totalFollowers: 2, likes: 4, comments: 1, shares: 1, saves: 0, engagementRate: .5 },
          comparison: {}, definitions: {}, series: [], content: [], hasMore: false,
          trackingSince: new Date().toISOString(), unavailable: [],
        }) });
      }
      if (url.pathname === "/api/feed" && route.request().method() === "GET") {
        if (showProfileGridFixture) {
          return route.fulfill({
            status: 200, contentType: "application/json",
            body: JSON.stringify({ posts: profileGridPosts, hasMore: false, nextOffset: profileGridPosts.length }),
          });
        }
        return route.fulfill({
          status: showRepostFixture ? 200 : 503,
          contentType: "application/json",
          body: JSON.stringify(showRepostFixture
            ? { posts: [{
              ...communityPost,
              repostCount: communityReposted ? 1 : 0,
              repostedByMe: communityReposted,
              repostNote: null,
            }], hasMore: false, nextOffset: 1 }
            : { error: "API unavailable in the isolated rendering test" }),
        });
      }
      if (/^\/api\/posts\/profile-grid-[^/]+\/like$/.test(url.pathname)) {
        const liked = route.request().method() === "PUT";
        return route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({ liked, likeCount: liked ? 1 : 0 }),
        });
      }
      if (url.pathname === `/api/posts/${communityPost.id}/repost`) {
        if (route.request().method() === "PUT") {
          communityReposted = true;
          const note = route.request().postDataJSON()?.note || "";
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ reposted: true, repostCount: 1, note }),
          });
        }
        if (route.request().method() === "DELETE") {
          communityReposted = false;
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ reposted: false, repostCount: 0, note: null }),
          });
        }
      }
      if (url.pathname === "/api/account/privacy") {
        storyApiCalls.push(`${route.request().method()} ${url.pathname}`);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ isPrivate: false, initialized: true }) });
      }
      if (url.pathname === "/api/relationships/import-legacy" && route.request().method() === "POST") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ imported: true, migratedTargets: 0 }) });
      }
      if (url.pathname === "/api/relationships" && route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          following: [], followers: [], friends: [{ id: "story-member", username: "storymember", displayName: "Story Member" }], incomingFriendRequests: [],
          outgoingFriendRequests: [], incomingFollowRequests: [], outgoingFollowRequests: []
        }) });
      }
      if (url.pathname === "/api/chats" && route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ chats: [] }) });
      }
      if (url.pathname === "/api/chats/legacy-archives" && route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ archives: [] }) });
      }
      if (url.pathname.startsWith("/api/creative/drafts/")) {
        if (route.request().method() === "GET") {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ draft: null }) });
        }
        if (route.request().method() === "DELETE") return route.fulfill({ status: 204, body: "" });
        if (route.request().method() === "PUT") {
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, updatedAt: Date.now() }) });
        }
      }
      if (/^\/api\/stories\/[^/]+\/media$/.test(url.pathname) && route.request().method() === "GET") {
        return route.fulfill({
          status: 200, contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800"><rect width="400" height="800" fill="#343434"/><circle cx="200" cy="300" r="120" fill="#e5262f"/></svg>'
        });
      }
      if (/^\/api\/stories\/[^/]+\/views$/.test(url.pathname) && route.request().method() === "POST") {
        storyApiCalls.push("POST Story view");
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ recorded: true }) });
      }
      if (/^\/api\/stories\/[^/]+\/reactions$/.test(url.pathname) && route.request().method() === "PUT") {
        storyApiCalls.push("PUT Story reaction");
        const emoji = route.request().postDataJSON().emoji;
        if (url.pathname.includes("/cloud-owner-story/")) ownerStoryReaction = emoji;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reaction: { emoji, createdAt: Date.now() } }) });
      }
      if (/^\/api\/stories\/[^/]+\/reactions$/.test(url.pathname) && route.request().method() === "DELETE") {
        storyApiCalls.push("DELETE Story reaction");
        if (url.pathname.includes("/cloud-owner-story/")) ownerStoryReaction = null;
        return route.fulfill({ status: 204, body: "" });
      }
      if (/^\/api\/stories\/[^/]+\/activity$/.test(url.pathname) && route.request().method() === "GET") {
        storyApiCalls.push("GET Story activity");
        return route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({ viewCount: 1, reactionCount: 1 + (url.pathname.includes("/cloud-owner-story/") && ownerStoryReaction ? 1 : 0), viewers: [{
            id: "story-member", username: "storymember", displayName: "Story Member", viewedAt: Date.now(), reaction: "😂"
          }] })
        });
      }
      if (/^\/api\/stories\/[^/]+\/comments$/.test(url.pathname) && route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ comments: [] }) });
      }
      if (/^\/api\/stories\/[^/]+\/comments$/.test(url.pathname) && route.request().method() === "POST") {
        const body = route.request().postDataJSON().body;
        return route.fulfill({
          status: 201, contentType: "application/json",
          body: JSON.stringify({ comment: {
            id: "browser-story-reply", body, createdAt: Date.now(),
            author: { id: fixture.session, username: "testmember", displayName: "Test Member" }
          } })
        });
      }
      if (/^\/api\/stories\/[^/]+\/comments\/[^/]+$/.test(url.pathname) && route.request().method() === "DELETE") {
        return route.fulfill({ status: 204, body: "" });
      }
      if (/^\/api\/stories\/[^/]+\/media-url$/.test(url.pathname)) {
        return route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({ url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC" }),
        });
      }
      if (/^\/api\/media\/[^/]+\/upload$/.test(url.pathname) && route.request().method() === "POST") {
        studioMediaReserved = true;
        return route.fulfill({
          status: 201, contentType: "application/json",
          body: JSON.stringify({ ready: true }),
        });
      }
      if (url.pathname === "/api/posts" && route.request().method() === "POST") {
        if (!communityPostPublishingEnabled) {
          return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "API unavailable in isolated rendering test" }) });
        }
        createdCommunityPostBody = route.request().postDataJSON();
        const post = {
          id: "cloud-community-note",
          sourceId: null,
          text: createdCommunityPostBody.text,
          visibility: "public",
          destination: createdCommunityPostBody.destination,
          media: (createdCommunityPostBody.mediaIds || []).map(id => ({
            id, contentType: "image/png", reference: `oldtime-media:${id}`,
          })),
          createdAt: Date.now(),
          author: { id: fixture.session, username: "testmember", displayName: "Test Member", joinedAt: storyNow - 2_000_000 },
          likeCount: 0, likedByMe: false, likedBy: [], repostCount: 0, repostedByMe: false, repostNote: null,
          place: null, sportsCard: null,
        };
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ post }) });
      }
      if (url.pathname === "/api/stories" && route.request().method() === "GET") {
        storyApiCalls.push("GET /api/stories");
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stories: [...browserStories, ...(publishedStory ? [publishedStory] : [])] }) });
      }
      if (url.pathname === "/api/stories" && route.request().method() === "POST") {
        storyApiCalls.push("POST /api/stories");
        const input = route.request().postDataJSON();
        publishedStory = {
          id: "cloud-studio-story", text: input.text, visibility: input.visibility,
          hasMedia: Boolean(input.mediaType), mediaType: input.mediaType,
          savedToProfile: false, createdAt: Date.now(), expiresAt: Date.now() + 86400000,
          author: { id: fixture.session, username: "testmember", displayName: "Test Member", createdAt: Date.now() }
        };
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ story: publishedStory }) });
      }
      if (url.pathname === "/api/stories/cloud-studio-story" && route.request().method() === "DELETE") {
        publishedStory = null;
        return route.fulfill({ status: 204, body: "" });
      }
      if (url.pathname.endsWith("/api/users/search")) {
        const query = url.searchParams.get("query")?.toLowerCase() || "";
        const profiles = query && "storymember".includes(query)
          ? [{ id: "52a126f3-8f2b-4c15-b45f-07af2853d821", username: "storymember", displayName: "Story Member Online", joinedAt: 1700000000000 }]
          : [];
        return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({profiles})});
      }
      return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"API unavailable in isolated rendering test"})});
    };
    await context.route("**/api/**",isolateApi);
    await context.addInitScript(state => {
      if (!localStorage.getItem("oldtime-v1")) {
        localStorage.setItem("oldtime-v1", JSON.stringify(state));
      }
      sessionStorage.clear();
      sessionStorage.setItem("oldtime-cloud-session-v1",JSON.stringify({
        account:{id:state.session},accessToken:"a".repeat(43),expiresAt:Date.now()+600_000
      }));
      window.__getUserMediaCalls = 0;
      window.__lastStoryShare = null;
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async data => { window.__lastStoryShare = data; }
      });
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            window.__getUserMediaCalls++;
            throw new DOMException("Camera permission denied for this test", "NotAllowedError");
          }
        }
      });
    }, fixture);

    const page = await context.newPage();
    page.on("dialog",dialog=>dialog.accept());
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    await page.locator("#create-open").waitFor({ state: "visible" });
    assert.deepEqual(
      await page.locator(".nav:not(.nav-hidden) > button").evaluateAll(buttons => buttons.map(button => button.innerText.trim())),
      ["Home", "Community", "Search", "Chat", "Profile"],
      "Search replaces Create in the primary navigation"
    );
    assert.equal(await page.locator('.nav [data-tab="communities"]').getAttribute("aria-label"), "Community");
    assert.equal(await page.locator(".nav [data-tab]").count(), 5, "Search and Chat remain separate global destinations");
    assert.equal(await page.locator(".nav").evaluate(element => getComputedStyle(element).backgroundColor), "rgb(9, 10, 12)");

    assert.equal(await page.locator("#menu-open").count(), 0, "Home has no hamburger");
    await page.locator("#notifications-open").click();
    await page.locator(".notification-insights-button").click();
    await page.locator('[data-ap-view="personal-activity"] .ap-insights').waitFor({ state: "visible" });
    assert.equal(await page.locator('[data-ap-metric="views"] b').innerText(), "12",
      "Activity renders the account analytics response rather than the app menu or Home");
    assert.match(await page.locator("#ap-body").innerText(), /Profile visits[\s\S]*Engagement rate/);
    await page.locator("[data-ap-back]").click();
    await page.locator(".notifications-header").waitFor({ state: "visible" });
    await page.locator("#back").click();
    await page.locator(".home-screen").waitFor({ state: "visible" });
    await page.locator('.nav [data-tab="profile"]').click();
    assert.equal(await page.locator('[data-testid="collection-shelf"], [data-collection-create], [data-collection-open]').count(), 0,
      "Albums & Memories and its profile entry points are removed");
    assert.doesNotMatch(await page.locator(".profile-page").innerText(), /Albums & Memories|Little chapters from real life/);
    if (process.env.OLDTIME_NAVIGATION_ONLY === "1") {
      await page.screenshot({ path: "/tmp/oldtime-profile-no-albums.png" });
    }
    await page.locator("#profile-actions-open").click();
    await page.locator("[data-profile-activity]").click();
    await page.locator('[data-ap-view="personal-activity"] .ap-insights').waitFor({ state: "visible" });
    await page.locator("[data-ap-back]").click();
    await page.locator(".profile-page").waitFor({ state: "visible" });
    await page.locator("#profile-actions-open").click();
    await page.locator("[data-profile-settings]").click();
    await page.locator(".settings-home").waitFor({ state: "visible" });
    await page.locator("#settings-back").click();
    await page.locator('.nav [data-tab="updates"]').click();
    await page.locator(".home-screen").waitFor({ state: "visible" });
    if (process.env.OLDTIME_NAVIGATION_ONLY === "1") {
      await page.setViewportSize({ width: 320, height: 780 });
      const compact = await page.locator(".home-primary-row").evaluate(element => {
        const tabs = element.querySelector(".home-view-tabs").getBoundingClientRect();
        const actions = element.querySelector(".home-header-actions").getBoundingClientRect();
        return tabs.right <= actions.left && actions.right <= window.innerWidth;
      });
      assert.equal(compact, true, "Home actions remain compact without covering feed tabs at 320px");
      assert.deepEqual(pageErrors, []);
      await page.screenshot({ path: "/tmp/oldtime-navigation-check.png" });
      return;
    }

    await page.locator('.home-stories [data-avatar-profile="story-member"]').waitFor({ state: "visible" });
    await page.locator('.home-stories [data-avatar-profile="story-member"]').click();
    await page.locator("#storyview.on .story-stage-media").waitFor({ state: "visible" });
    assert.equal(await page.locator("#storyview #sclose").count(), 1, "the viewer has one X close action");
    assert.match(await page.locator(".story-creator-copy").innerText(), /STORY MEMBER[\s\S]*ago by Story Member/);
    assert.equal(await page.locator(".story-profile-mini").count(), 1);
    assert.equal(await page.locator(".story-compose .story-quick-reaction, .story-compose .story-reaction-open").count(), 3,
      "the reply bar keeps only the three intended Story reaction controls");
    assert.equal(await page.locator(".story-side-actions .story-heart").count(), 1);
    assert.equal(await page.locator(".story-side-actions .story-share").count(), 1);
    const storyGeometry = await page.locator(".story-stage").evaluate(element => {
      const rect = element.getBoundingClientRect();
      const media = element.querySelector(".story-stage-media");
      return {
        width: rect.width, height: rect.height,
        viewWidth: element.parentElement.getBoundingClientRect().width,
        viewHeight: element.parentElement.getBoundingClientRect().height,
        objectFit: getComputedStyle(media).objectFit
      };
    });
    assert.equal(storyGeometry.width, storyGeometry.viewWidth, "Story media spans the full viewer width");
    assert.equal(storyGeometry.height, storyGeometry.viewHeight, "Story media spans the full viewer height");
    assert.equal(storyGeometry.objectFit, "cover", "full-screen media retains its crop instead of letterboxing");
    assert.equal(await page.locator(".story-owner-controls .story-activity-open").count(), 0,
      "only the Story owner gets the viewer list control");
    await page.locator(".story-reaction-open").click();
    assert.equal(await page.locator(".story-reaction-picker").evaluate(element => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)",
      "the emoji reactions float without a tray or panel behind them");
    const reactionRequest = page.waitForResponse(response =>
      response.url().includes("/api/stories/cloud-friend-story/reactions") &&
      response.request().method() === "PUT"
    );
    await page.locator('.story-reaction-picker button[data-reaction="😂"]').click();
    await reactionRequest;
    await page.locator(".story-reply-input").fill("Looking good");
    await page.locator(".story-send").click();
    const postedReply = page.locator(".story-live-message").filter({ hasText: "Looking good" }).last();
    await postedReply.waitFor({ state: "visible" });
    assert.match(await postedReply.innerText(), /Looking good/);
    await page.locator(".story-side-actions .story-share").click();
    assert.equal(await page.evaluate(() => window.__lastStoryShare?.url?.includes("story=cloud-friend-story")), true,
      "native sharing uses a URL that opens this Story");
    assert.ok(storyApiCalls.includes("POST Story view"), "opening another person's Story records the view through the API");
    await page.locator("#sclose").click();
    await page.locator("#storyview.on").waitFor({ state: "detached" });

    await page.locator('.home-stories .story-name[data-profile="story-member"]').click();
    await page.locator(".profile-screen").waitFor({ state: "visible" });
    assert.match(await page.locator(".profile-name").innerText(), /Story Member/);
    await page.locator("#back").click();
    await page.locator(".home-screen").waitFor({ state: "visible" });
    await page.locator('.home-stories [data-avatar-profile="story-member"]').click();
    await page.locator("#storyview.on .story-stage-media").waitFor({ state: "visible" });
    await page.locator("#story-profile").click();
    await page.locator(".profile-screen").waitFor({ state: "visible" });
    await page.locator("#back").click();
    await page.locator(".home-screen").waitFor({ state: "visible" });

    await page.locator('.home-stories [data-avatar-profile="camera-quotes-test"]').click();
    await page.locator(".story-owner-controls .story-activity-open").waitFor({ state: "visible" });
    assert.deepEqual(
      await page.locator(".story-owner-controls").evaluate(element => [...element.children].map(child =>
        child.classList.contains("story-activity-open") ? child.className : child.querySelector(".story-more-open")?.className
      )),
      ["story-activity-open", "story-more-open"],
      "owner view insights sit directly beside the vertical options control"
    );
    assert.deepEqual(
      await page.locator(".story-more-open svg circle").evaluateAll(circles => circles.map(circle => circle.getAttribute("cy"))),
      ["5", "12", "19"],
      "the three-dot options icon stays vertical"
    );
    for (const emoji of ["❤️", "😂"]) {
      const control = page.locator(`.story-quick-reaction[data-reaction="${emoji}"]`);
      assert.equal(await control.isDisabled(), false, "Story owners can use their quick reactions");
      const reactionResponse = page.waitForResponse(response =>
        response.url().includes("/api/stories/cloud-owner-story/reactions") &&
        response.request().method() === "PUT"
      );
      await control.click();
      await reactionResponse;
    }
    assert.equal(await page.locator(".story-reaction-open").isDisabled(), false);
    await page.locator(".story-reaction-open").click();
    const ownerPicker = page.locator('.story-reaction-picker button[data-reaction="🔥"]');
    await ownerPicker.waitFor({ state: "visible" });
    const pickerReactionResponse = page.waitForResponse(response =>
      response.url().includes("/api/stories/cloud-owner-story/reactions") &&
      response.request().method() === "PUT"
    );
    await ownerPicker.click();
    await pickerReactionResponse;
    await page.locator(".story-activity-open").click();
    await page.locator(".story-insights-list").waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const summary = document.querySelector(".story-insights-summary")?.textContent?.trim();
      return summary && summary !== "Loading…";
    });
    assert.match(await page.locator(".story-insights-summary").innerText(), /1 view · 2 reactions · You: 🔥/);
    assert.match(await page.locator(".story-insights-list").innerText(), /@storymember[\s\S]*😂/);
    await page.locator(".story-more-open").click();
    const optionsBounds = await page.locator(".story-more-menu").boundingBox();
    const ownerStoryBounds = await page.locator("#storyview").boundingBox();
    assert.ok(optionsBounds && ownerStoryBounds);
    assert.ok(optionsBounds.width <= 216, "Story options stay compact");
    assert.ok(optionsBounds.x >= ownerStoryBounds.x && optionsBounds.x + optionsBounds.width <= ownerStoryBounds.x + ownerStoryBounds.width,
      "the options dropdown stays within the Story viewer horizontally");
    assert.ok(optionsBounds.y >= ownerStoryBounds.y && optionsBounds.y + optionsBounds.height <= ownerStoryBounds.y + ownerStoryBounds.height,
      "the options dropdown stays within the Story viewer vertically");
    assert.doesNotMatch(await page.locator(".story-more-menu").innerText(), /Close Story/i);
    await page.locator("#sclose").click();
    await page.locator("#storyview.on").waitFor({ state: "detached" });

    assert.equal(await page.locator("#menu-open").count(), 0);
    await page.locator("#notifications-open").click();
    await page.locator(".notifications-header").waitFor({ state: "visible" });
    assert.equal(await page.locator(".notifications-header .h1").innerText(), "Notifications");
    await page.locator('[data-notification-filter="requests"]').click();
    assert.match(await page.locator(".screen.on").innerText(), /No follow or Friend requests right now/);
    await page.locator("#back").click();
    await page.locator(".home-screen").waitFor({ state: "visible" });

    await page.locator('.nav [data-tab="profile"]').click();
    await page.locator("#profile-actions-open").click();
    await page.locator("[data-profile-settings]").click();
    await page.locator(".account-settings-screen").waitFor({ state: "visible" });
    assert.match(await page.locator(".account-settings-screen").innerText(), /Settings/);
    await page.locator('[data-settings="notifications"]').click();
    await page.locator("#notifs-toggle").waitFor({ state: "visible" });
    await page.locator("#settings-back").click();
    await page.locator(".settings-home").waitFor({ state: "visible" });
    await page.locator('[data-settings="help"]').click();
    await page.locator(".settings-home").waitFor({ state: "detached" });
    assert.match(await page.locator(".account-settings-screen").innerText(), /Help & Support/);
    await page.locator("#settings-back").click();
    await page.locator(".settings-home").waitFor({ state: "visible" });
    await page.locator("#settings-back").click();
    await page.locator(".profile-screen").waitFor({ state: "visible" });

    await page.locator('.nav [data-tab="communities"]').click();
    await page.locator(".community-screen").waitFor({ state: "visible" });
    assert.equal(await page.locator(".community-header h1").innerText(), "Community");
    assert.equal(await page.locator(".community-header [data-tab='chat'], .community-header [aria-label='Chat']").count(), 0,
      "Community itself has no embedded private-chat control");
    assert.equal(await page.locator(".community-feed-tabs [role=tab]").count(), 2);
    assert.equal(await page.locator("#community-more-open").count(), 0);
    assert.equal(await page.locator(".community-feed-heading .community-note-open").count(), 0,
      "the separate Create pill is removed from below Stories");
    const communityCreate = page.locator(".community-header #community-note-open");
    assert.equal(await communityCreate.count(), 1);
    assert.equal(await communityCreate.getAttribute("aria-label"), "Create post or Note");
    assert.equal(await communityCreate.locator("svg").count(), 1);
    await communityCreate.click();
    await page.locator("#community-note-input").waitFor({ state: "visible" });
    assert.equal(await page.locator("#community-note-image").getAttribute("accept"), "image/*",
      "Community notes can attach an image without leaving the Community");
    await page.locator("#community-note-input").fill("A short note for my community");
    assert.equal(await page.locator("#community-note-count").innerText(), "29 / 1,000");
    assert.equal(await page.locator("#community-note-submit").isEnabled(), true);
    await page.locator("#community-note-submit").click();
    await page.waitForFunction(() => !!document.querySelector("#community-note-error")?.textContent.trim());
    assert.match(await page.locator("#community-note-error").innerText(), /API unavailable|Reconnect your online account/,
      "a note is never silently saved only to this device");
    assert.equal(await page.evaluate(() => (JSON.parse(localStorage.getItem("oldtime-v1") || "{}").posts || []).length), 0);
    communityPostPublishingEnabled = true;
    await page.locator("#community-note-image").setInputFiles({
      name: "community-note.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64"),
    });
    await page.locator("#community-note-image-preview").waitFor({ state: "visible" });
    await page.locator("#community-note-submit").click();
    await page.locator(".community-note-panel").waitFor({ state: "hidden" });
    assert.equal(createdCommunityPostBody.destination, "community");
    assert.equal(createdCommunityPostBody.mediaIds.length, 1);
    await page.getByText("A short note for my community").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator(".community-note-panel").waitFor({ state: "hidden" });
    await page.locator('.nav [data-tab="updates"]').click();
    await page.locator('button.icon[data-tab="search"]').click();
    await page.locator("#q").waitFor({ state: "visible" });
    assert.equal(await page.locator("#q").getAttribute("placeholder"), "People, posts, #tags, places");
    await page.locator("#q").fill("@StoryMember");
    await page.locator('[data-profile="52a126f3-8f2b-4c15-b45f-07af2853d821"]').waitFor({ state: "visible" });
    assert.match(await page.locator('[data-profile="52a126f3-8f2b-4c15-b45f-07af2853d821"]').innerText(), /@storymember/,
      "username search should use the authenticated cloud account endpoint and accept @handles");
    await page.locator('[data-profile="52a126f3-8f2b-4c15-b45f-07af2853d821"]').click();
    await page.locator(".profile-screen").waitFor({ state: "visible" });
    assert.match(await page.locator(".profile-name").innerText(), /Story Member Online/);
    assert.equal(await page.locator(".profile-primary-actions button").count(), 2,
      "profile actions keep their existing Follow and Message options");
    assert.equal(await page.locator(".profile-relationship-actions, .profile-actions").count(), 0,
      "relationship, block, and report controls stay out of the profile header");
    await page.locator("#profile-actions-open").click();
    await page.locator("#profile-actions-sheet").waitFor({ state: "visible" });
    assert.equal(await page.locator("#pfriend").isVisible(), true);
    assert.equal(await page.locator("#pclosefriend").isVisible(), true);
    assert.equal(await page.locator("#pblock").isVisible(), true);
    assert.equal(await page.locator("#prep").isVisible(), true);
    await page.keyboard.press("Escape");
    await page.locator("#profile-actions-sheet").waitFor({ state: "hidden" });
    await page.locator('.nav [data-tab="updates"]').click();
    await page.locator("#create-open").waitFor({ state: "visible" });

    assert.equal(await page.locator('[data-drawer-route="chat"]').count(), 1,
      "Chat remains available outside the Community screen");
    if (await page.locator('.nav [data-tab="chat"]').count()) {
    await page.locator('.nav [data-tab="chat"]').click();
    await page.locator(".chat-list-screen").waitFor({ state: "visible" });
    assert.equal(await page.locator("#crows .chat-inbox-row").count(), 3,
      "All chats should include Primary, Requests, and General conversations by default");
    assert.equal(await page.locator("#saved").count(), 0, "Saved should not duplicate the Saved option in inbox settings");
    assert.equal(await page.locator("#chat-more").count(), 0, "the duplicate overflow icon should not appear in the inbox header");
    if (process.env.OLDTIME_CHAT_SCREENSHOTS) await page.screenshot({ path: "/tmp/oldtime-chat-inbox.png" });
    await page.locator("#toggle-chat-search").click();
    await page.locator("#cq").fill("no-such-message-match");
    assert.equal(await page.locator("#crows .chat-inbox-row").count(), 0, "search should filter the conversation rows");
    await page.locator(".chat-title").click();
    await page.locator("#chat-search-panel").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#toggle-chat-search").getAttribute("aria-expanded"), "false",
      "clicking outside the search bar should close it");
    assert.equal(await page.locator("#cq").inputValue(), "", "closing search should clear the stale query");
    assert.equal(await page.locator("#crows .chat-inbox-row").count(), 3,
      "closing search should restore the unfiltered inbox");
    await page.setViewportSize({ width: 470, height: 874 });
    const initialInboxMenu = await page.locator("#chat-more-menu").evaluate(element => ({
      hidden: element.hidden,
      display: getComputedStyle(element).display,
      menuTextVisible: element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0
    }));
    assert.equal(initialInboxMenu.hidden, true, "filter menu must start closed on the Messages landing screen");
    assert.equal(initialInboxMenu.display, "none", "closed filter menu must not leak into the Messages header");
    assert.equal(initialInboxMenu.menuTextVisible, false, "closed filter menu content must not be visible");
    for (const width of [320, 402, 430, 470, 980]) {
    await page.setViewportSize({ width, height: 874 });
    await page.locator("#chat-filter-open").click();
    await page.locator("#chat-more-menu").waitFor({ state: "visible" });
      if (width === 320) {
        assert.equal(await page.locator("#chat-more-menu h2").textContent(), "Filters",
          "the inbox sheet should restore the compact Filters title");
        assert.equal(await page.locator("#chat-folder-options").isVisible(), true,
          "folder chips should be visible when the inbox filter sheet opens");
        const flatStyle = await page.locator("#chat-more-menu").evaluate(element => {
          const selected = element.querySelector('.chat-option[aria-checked="true"]');
          const savedCard = element.querySelector(".chat-organize-card");
          const radio = selected.querySelector(".chat-option-radio");
          return {
            selectionBackground: getComputedStyle(selected).backgroundColor,
            selectionGradient: getComputedStyle(selected).backgroundImage,
            selectionShadow: getComputedStyle(selected).boxShadow,
            radioShadow: getComputedStyle(radio).boxShadow,
            cardBackground: getComputedStyle(savedCard).backgroundColor,
            cardGradient: getComputedStyle(savedCard).backgroundImage,
            cardShadow: getComputedStyle(savedCard).boxShadow
          };
        });
        assert.equal(flatStyle.selectionGradient, "none");
        assert.equal(flatStyle.selectionShadow, "none");
        assert.equal(flatStyle.radioShadow, "none");
        assert.equal(flatStyle.cardBackground, "rgb(255, 255, 255)");
        assert.equal(flatStyle.cardGradient, "none");
        assert.equal(flatStyle.cardShadow, "none");
      }
    if (process.env.OLDTIME_CHAT_SCREENSHOTS && width === 402) await page.screenshot({ path: "/tmp/oldtime-chat-settings.png" });
    const mobileFilterSheet = await page.locator("#chat-more-menu").evaluate(element => {
      const rect = element.getBoundingClientRect();
      return {
        position: getComputedStyle(element).position,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        backdrop: getComputedStyle(document.querySelector("#chat-options-backdrop")).display
      };
    });
    assert.equal(mobileFilterSheet.position, "fixed", "mobile-width filter menu should use a bottom sheet");
    assert.ok(mobileFilterSheet.left >= 0 && mobileFilterSheet.right <= mobileFilterSheet.viewportWidth + 1,
      "filter sheet should fit the full mobile layout viewport");
    assert.ok(mobileFilterSheet.top >= 0,
      `filter sheet must not be clipped above the Messages header at ${width}px`);
    assert.ok(Math.abs(mobileFilterSheet.width - mobileFilterSheet.viewportWidth) <= 1,
      `filter sheet must use the viewport width, not the header button width at ${width}px`);
    assert.ok(Math.abs(mobileFilterSheet.bottom - mobileFilterSheet.viewportHeight) <= 1,
      `filter sheet must attach to the bottom of the viewport, not the header at ${width}px`);
    assert.equal(mobileFilterSheet.backdrop, "block", "open filter sheet should dim the page behind it");
    await page.keyboard.press("Escape");
    await page.locator("#chat-more-menu").waitFor({ state: "hidden" });
    }

    await page.setViewportSize({ width: 402, height: 874 });
    for (const folder of ["primary", "requests", "general"]) {
      const tab = page.locator(`.chat-inbox-tabs [data-inbox-folder="${folder}"]`);
      await tab.click();
      assert.equal(await tab.getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator("#crows .chat-inbox-row").count(), 1,
        `${folder} should show only its matching conversation`);
    }
    await page.locator("#chat-filter-open").click();
    await page.locator("#chat-more-menu").waitFor({ state: "visible" });
    await page.locator('[data-more-filter="all"]').click();
    assert.equal(await page.locator("#chat-filter-open").getAttribute("aria-current"), "page");
    assert.equal(await page.locator("#crows .chat-inbox-row").count(), 3,
      "choosing All chats should leave the folder scope and restore every conversation");
    await page.locator("#chat-filter-open").click();
    await page.locator("#chat-more-menu").waitFor({ state: "visible" });
    await page.locator('[data-more-filter="unanswered"]').click();
    assert.equal(await page.locator('[data-more-filter="unanswered"]').getAttribute("aria-checked"), "true");
    for (const width of [402, 360, 320]) {
      await page.setViewportSize({ width, height: 874 });
      const layout = await page.locator(".chat-inbox-toolbar").evaluate(element => ({
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
        width: element.clientWidth,
        scroll: element.scrollWidth,
        viewport: window.innerWidth,
      }));
      assert.ok(layout.scroll <= layout.width + 1, `Messages tabs do not overflow at ${width}px`);
      assert.ok(layout.left >= 0 && layout.right <= layout.viewport + 1, `Messages toolbar fits the viewport at ${width}px`);
    }
    await page.setViewportSize({ width: 402, height: 874 });
    await page.locator("#chat-filter-open").click();
    await page.locator('[data-more-filter="all"]').click();
    await page.locator("#crows .chat-inbox-row").first().click();
    await page.locator("#msg").waitFor({ state: "visible" });
    if (process.env.OLDTIME_CHAT_SCREENSHOTS) await page.screenshot({ path: "/tmp/oldtime-chat-thread.png" });
    const renderedBubble = await page.locator("#msgs .bubble-msg").first().evaluate(element => ({
      height: element.getBoundingClientRect().height,
      messageHeight: element.querySelector(".message-body").getBoundingClientRect().height,
      text: element.querySelector(".message-body").innerText,
      metadataInsideBubble: !!element.querySelector(".meta-line"),
      rowAlignment: getComputedStyle(element.closest(".message-row")).alignItems,
      rowBackground: getComputedStyle(element.closest(".message-row")).backgroundColor,
      bubbleBackground: getComputedStyle(element).backgroundColor,
      timestamp: element.closest(".message-row").querySelector(".message-time")?.textContent,
      timestampInsideBubble: !!element.querySelector(".message-time"),
      timestampAlignedLeft: element.closest(".message-row").querySelector(".message-footer")?.getBoundingClientRect().left
    }));
    assert.ok(renderedBubble.height < 90,
      `a short rendered chat bubble should not retain template whitespace, got ${renderedBubble.height}px`);
    assert.ok(renderedBubble.messageHeight < 45,
      `the message body should occupy only its text lines, got ${renderedBubble.messageHeight}px`);
    assert.equal(renderedBubble.metadataInsideBubble, false,
      "time and delivery checks should sit below the bubble, not inside it");
    assert.equal(renderedBubble.rowAlignment, "flex-start",
      "incoming bubble should align to the left");
    assert.equal(renderedBubble.rowBackground, "rgba(0, 0, 0, 0)",
      "incoming message rows should not paint a gray backing panel");
    assert.equal(renderedBubble.bubbleBackground, "rgb(241, 241, 242)",
      "the actual incoming bubble should retain its light gray fill");
    assert.match(renderedBubble.timestamp, /^[0-9]{1,2}:[0-9]{2}/,
      "one timestamp should appear below the last message in a cluster");
    assert.equal(renderedBubble.timestampInsideBubble, false,
      "timestamps should sit outside the bubble");
    const incomingBubbleLeft = await page.locator("#msgs .bubble-msg").first().evaluate(element => element.getBoundingClientRect().left);
    assert.ok(Math.abs(renderedBubble.timestampAlignedLeft - incomingBubbleLeft) < 8,
      `incoming timestamp should align with its bubble (${renderedBubble.timestampAlignedLeft}px vs ${incomingBubbleLeft}px)`);
    const outgoingBubble = await page.locator("#msgs .bubble-msg.mine").first().evaluate(element => {
      const row = element.closest(".message-row");
      const footer = row.querySelector(".message-footer");
      return {
        height: element.getBoundingClientRect().height,
        text: element.querySelector(".message-body").innerText,
        rowAlignment: getComputedStyle(row).alignItems,
        rowBackground: getComputedStyle(row).backgroundColor,
        bubbleBackground: getComputedStyle(element).backgroundColor,
        statusInsideBubble: !!element.querySelector(".message-status"),
        status: footer?.textContent.trim(),
        time: footer?.querySelector(".message-time")?.textContent,
        footerRight: footer?.getBoundingClientRect().right,
        bubbleRight: element.getBoundingClientRect().right,
        timeInsideBubble: !!element.querySelector(".message-time")
      };
    });
    assert.equal(outgoingBubble.text, "hey");
    assert.ok(outgoingBubble.height < 70,
      `a one-word sent message should fit a compact bubble, got ${outgoingBubble.height}px`);
    assert.equal(outgoingBubble.rowAlignment, "flex-end",
      "sent bubbles should align to the right on mobile");
    assert.equal(outgoingBubble.rowBackground, "rgba(0, 0, 0, 0)",
      "sent message rows should not paint a gray backing panel");
    assert.equal(outgoingBubble.bubbleBackground, "rgb(200, 16, 46)",
      "the actual sent bubble should retain Oldtime red");
    assert.equal(outgoingBubble.statusInsideBubble, false,
      "delivery checks should not be drawn inside the sent bubble");
    assert.equal(outgoingBubble.timeInsideBubble, false);
    assert.equal(outgoingBubble.time, undefined,
      "the first message in a same-sender cluster should not repeat the timestamp");
    assert.equal(outgoingBubble.status, undefined,
      "the middle message in a cluster should not repeat the delivery label");
    const outgoingClusterEnd = await page.locator("#msgs .bubble-msg.mine").last().evaluate(element => {
      const row = element.closest(".message-row");
      const footer = row.querySelector(".message-footer");
      return {
        time: footer?.querySelector(".message-time")?.textContent,
        status: footer?.querySelector(".message-status")?.textContent,
        timeInsideBubble: !!element.querySelector(".message-time"),
        hasCheckmark: /✓/.test(footer?.textContent || ""),
        footerRight: footer?.getBoundingClientRect().right,
        bubbleRight: element.getBoundingClientRect().right
      };
    });
    assert.match(outgoingClusterEnd.time, /^[0-9]{1,2}:[0-9]{2}/,
      "show one timestamp at the end of the same-sender cluster");
    assert.equal(outgoingClusterEnd.status, "Delivered",
      "show Apple's text receipt under the latest sent message");
    assert.equal(outgoingClusterEnd.hasCheckmark, false,
      "text receipts should not include checkmark glyphs");
    assert.equal(outgoingClusterEnd.timeInsideBubble, false);
    assert.ok(Math.abs(outgoingClusterEnd.footerRight - outgoingClusterEnd.bubbleRight) < 8);
    assert.equal(await page.locator("#msg").evaluate(element => element.tagName), "TEXTAREA",
      "the message composer should grow vertically instead of clipping long text");
    await page.locator("#msg").fill("First message line\nSecond message line\nThird message line");
    const expandedComposer = await page.locator("#msg").evaluate(element => ({
      height: parseFloat(getComputedStyle(element).height),
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight
    }));
    assert.ok(expandedComposer.height > 45, "multiline drafts should expand the composer");
    assert.ok(expandedComposer.clientHeight >= expandedComposer.scrollHeight - 1,
      "short multiline drafts should remain fully visible");
    await page.locator("#msg").fill("");
    await page.locator("#back").click();
    await page.locator(".chat-list-screen").waitFor({ state: "visible" });
    await page.locator("#newchat").click();
    await page.locator("#chat-contact-search").fill("storymember");
    await page.locator("[data-pick]").first().waitFor({ state: "visible" });
    assert.equal(await page.locator("#start").count(), 0, "direct-message mode should not show a redundant Start chat button");
    await page.locator("[data-pick]").first().click();
    await page.locator("#msgs").waitFor({ state: "visible" });
    assert.equal(await page.locator(".chat-identity-name").innerText(), "Story Member Online",
      "tapping a person should open their one-to-one inbox directly");
    await page.locator("#back").click();
    await page.locator(".chat-list-screen").waitFor({ state: "visible" });
    await page.locator("#newchat").click();
    await page.locator('[data-compose-kind="group"]').click();
    await page.locator("#chat-contact-search").fill("storymember");
    await page.locator("[data-pick]").first().waitFor({ state: "visible" });
    await page.locator("[data-pick]").first().click();
    await page.locator("#start").waitFor({ state: "visible" });
    assert.equal(await page.locator("#chat-compose-selected .chat-compose-chip").count(), 1,
      "group selection should be shown as a removable chip");
    await page.locator("#chat-compose-selected [data-remove-pick]").click();
    assert.equal(await page.locator("#start").count(), 0, "removing the last selected person should hide Create group");
    await page.locator("[data-pick]").first().click();
    await page.locator("#start").click();
    await page.locator("#msgs").waitFor({ state: "visible" });
    assert.equal(await page.locator(".chat-identity-name").innerText(), "Group",
      "Create group should open the newly created group conversation");
    await page.locator("#back").click();
    await page.locator(".chat-list-screen").waitFor({ state: "visible" });
    }
    await page.locator('.nav [data-tab="updates"]').click();
    await page.locator("#create-open").click();
    await page.locator(".ch-page").waitFor({ state: "visible" });
    assert.equal(await page.locator(".ch-primary[data-ch='studio']").innerText(), "Oldtime Studio");
    assert.equal(await page.locator(".ch-primary[data-ch='camera']").innerText(), "Camera");
    assert.equal(await page.locator(".ch-primary[data-ch='quote']").count(), 0, "Quote is not available in Create");
    assert.equal(await page.locator(".ch-quick[data-ch]").count(), 0, "the focused creation actions stay together");
    assert.equal(await page.locator(".ch-primary-icon").count(), 2, "Studio and Camera share the primary icon-tile style");
    assert.equal(await page.locator(".ch-recents, [data-ch-recents]").count(), 0,
      "Create no longer exposes device recents");
    if (process.env.OLDTIME_THEME_SCREENSHOTS) {
      await page.screenshot({ path: "/tmp/oldtime-technologies-create.png" });
    }
    const initialCameraCallCount = await page.evaluate(() => window.__getUserMediaCalls);
    await page.locator('.ch-primary[data-ch="studio"]').click();
    try {
      await page.locator(".creative-editor.is-studio").waitFor({ state: "visible", timeout: 10000 });
    } catch (error) {
      const editorState = await page.locator(".creative-editor").evaluateAll(elements => elements.map(element => ({
        classes: element.className,
        workspace: element.querySelector("#ce-workspace")?.value,
        status: element.querySelector("#ce-status")?.textContent,
      })));
      throw new Error(`Studio did not open; editors=${JSON.stringify(editorState)}; pageErrors=${pageErrors.join(" | ")}`, { cause: error });
    }
    assert.equal(await page.evaluate(() => window.__getUserMediaCalls), initialCameraCallCount,
      "Oldtime Studio opens without unexpectedly starting the camera");
    await page.locator(".ce-share-menu > summary").click();
    assert.equal(await page.locator("#ce-quote-designs").count(), 0, "Quote designs are hidden from Studio");
    await page.locator("#ce-close").click();
    await page.locator(".creative-editor").waitFor({ state: "detached" });
    await page.locator("#create-open").click();
    await page.locator('.ch-primary[data-ch="camera"]').click();
    await page.locator(".creative-editor.is-camera-open").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector("#ce-error")?.textContent.trim());
    assert.equal(await page.locator("#ce-canvas").evaluate(canvas => getComputedStyle(canvas).objectFit), "cover");
    await page.locator("#ce-close").click();
    if (await page.locator("#ce-exit-dialog").isVisible()) await page.locator("#ce-exit-discard").click();
    await page.locator(".creative-editor").waitFor({ state: "detached" });
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("oldtime-v1"));
      state.posts = [{
        id: "profile-grid-image", author: state.session, kind: "image", caption: "",
        media: ["/app/avatar.svg"], likes: ["story-member"], comments: [], reposts: [], saves: [], views: 26, created: 1700000000000
      }, {
        id: "profile-grid-note", author: state.session, kind: "text", caption: "A thought from the test profile",
        text: "A thought from the test profile", media: [], likes: [], comments: [], reposts: [], saves: [], views: 0, created: 1700000001000
      }, {
        id: "profile-grid-video", author: state.session, kind: "video", caption: "A video in the community timeline",
        media: ["/app/avatar.svg"], likes: [], comments: [], reposts: [], saves: [], views: 0, created: 1700000002000
      }];
      localStorage.setItem("oldtime-v1", JSON.stringify(state));
    });
    showProfileGridFixture = true;
    await page.reload({ waitUntil: "networkidle" });
    try {
      await page.locator("#create-open").waitFor({ state: "visible", timeout: 6000 });
    } catch (error) {
      console.error("Profile grid reload diagnostic", {
        body: await page.locator("body").innerText().catch(() => ""),
        pageErrors
      });
      throw error;
    }
    await page.locator('.nav [data-tab="updates"]').click();
    await page.locator('.clip[data-id="profile-grid-image"]').waitFor({ state: "visible" });
    assert.equal(await page.locator('.clip[data-id="profile-grid-note"]').count(), 0,
      "text-only Notes do not enter the Home media feed");
    await page.locator('.nav [data-tab="communities"]').click();
    await page.locator('[data-testid="card-community-post-profile-grid-note"]').waitFor({ state: "visible" });
    assert.equal(await page.locator(".community-post-card").count(), 3,
      "Community keeps text, photo, and video posts together in one timeline");
    assert.match(await page.locator('[data-testid="card-community-post-profile-grid-note"]').innerText(), /A thought from the test profile/);
    assert.equal(await page.locator('[data-testid="card-community-post-profile-grid-note"] .community-post-media-item').count(), 0,
      "text Notes remain uncluttered when they have no attached media");
    assert.equal(await page.locator('[data-testid="card-community-post-profile-grid-image"] .community-post-media-item img').count(), 1,
      "photo posts display inline in the Community timeline");
    assert.equal(await page.locator('[data-testid="card-community-post-profile-grid-video"] .community-post-media[data-kind="video"] video').count(), 1,
      "video posts display inline in the mixed X-style timeline");
    assert.equal(await page.locator('[data-testid="community-story-own"]').count(), 1,
      "the signed-in account stays visible in the avatar story row");
    assert.ok(await page.locator('[data-testid="community-story-own"]').getAttribute("data-story"),
      "the own-avatar action stays connected to the story flow");
    assert.equal(await page.locator("#stories-more").count(), 0,
      "Community has no hamburger menu button");
    assert.equal(await page.getByText("Photos from Notes", { exact: true }).count(), 0,
      "the photo-strip label is removed from Community");
    if (process.env.OLDTIME_COMMUNITY_SCREENSHOT) await page.screenshot({ path: "/tmp/oldtime-community-notes.png" });
    await page.locator("#community-search-open").click();
    await page.locator("#q").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.activeElement?.id === "q");
    await page.locator("#back").click();
    await page.locator(".community-screen").waitFor({ state: "visible" });
    await page.locator('[data-community-view="following"]').click();
    assert.equal(await page.locator('[data-community-view="following"]').getAttribute("aria-selected"), "true",
      "the Community Following feed tab is wired");
    await page.locator('[data-community-view="for-you"]').click();
    assert.equal(await page.locator('[data-community-view="for-you"]').getAttribute("aria-selected"), "true",
      "the Community For you feed tab is wired");
    await page.locator('[data-like="profile-grid-note"]').click();
    await page.waitForFunction(() =>
      document.querySelector('[data-like="profile-grid-note"]')?.getAttribute("aria-pressed") === "true"
    );
    assert.equal(await page.locator('[data-like="profile-grid-note"]').getAttribute("aria-pressed"), "true",
      "the Community post action row is wired to the existing like behavior");
    await page.locator('.nav [data-tab="profile"]').click();
    await page.locator(".profile-screen").waitFor({ state: "visible" });
    assert.match(await page.locator(".profile-name").innerText(), /Test Member/);
    assert.deepEqual(await page.locator(".profile-section-tab").evaluateAll(tabs => tabs.map(tab => tab.getAttribute("aria-label"))),
      ["Posts", "Videos", "Reposts", "Saved"], "profile content sections use a compact, labeled icon row");
    assert.equal(await page.locator(".profile-post-card").count(), 3, "profile posts render as content cards");
    assert.equal(await page.locator(".profile-post-grid").evaluate(grid => getComputedStyle(grid).display), "grid");
    assert.equal(await page.locator(".profile-post-grid").evaluate(grid => getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length), 2,
      "profile content uses a two-column gallery");
    assert.equal(await page.locator(".profile-body").getByText("Quotes", { exact: true }).count(), 0,
      "text posts appear once in the Posts grid instead of a duplicate Quotes shelf");
    assert.equal(await page.locator('[data-quote-open]').count(), 0, "legacy text posts do not expose a Quote viewer");
    await page.locator('[data-open="profile-grid-note"]').click();
    await page.locator('.clip.post-detail[data-id="profile-grid-note"]').waitFor({ state: "visible" });
    assert.match(await page.locator('.clip.post-detail[data-id="profile-grid-note"]').innerText(), /A thought from the test profile/);
    assert.equal(await page.locator('.nav [data-tab="profile"]').isVisible(), false,
      "the full-view post keeps the media immersive without the global navigation bar");
    await page.locator("#post-viewer-back").click();
    await page.locator(".profile-screen").waitFor({ state: "visible" });
    if (process.env.OLDTIME_THEME_SCREENSHOTS) {
      await page.locator(".profile-page").evaluate(element => {
        const tabs = element.querySelector(".profile-section-tabs");
        if (tabs) element.scrollTop = tabs.offsetTop - 100;
      });
      await page.screenshot({ path: "/tmp/oldtime-profile-grid.png" });
    }
    for (const mode of ["reposts", "videos", "saved"]) {
      await page.locator(`[data-m="${mode}"]`).click();
      assert.equal(await page.locator(`[data-m="${mode}"]`).getAttribute("class").then(value => value.includes("on")), true,
        `profile ${mode} tab should become active`);
    }
    await page.locator('[data-m="posts"]').click();
    assert.equal(await page.locator("#profile-content-grid [data-open='profile-grid-image']").isVisible(), true,
      "the Posts tab returns to the two-column gallery");
    await page.locator('[data-m="posts"]').focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator('[data-m="videos"]').getAttribute("aria-selected"), "true",
      "profile icon tabs support keyboard arrow navigation");
    await page.waitForFunction(() => document.activeElement?.id === "profile-tab-videos");
    assert.equal(await page.locator('[data-m="videos"]').evaluate(element => element === document.activeElement),
      true, "keyboard tab selection keeps focus on the newly selected section");
    await page.locator("#edit").click();
    await page.locator(".edit-profile-screen").waitFor({ state: "visible" });
    await page.locator('[data-testid="input-profile-name"]').waitFor({ state: "visible" });
    await page.locator("#profile-editor-back").click();
    await page.locator(".profile-screen").waitFor({ state: "visible" });
    showProfileGridFixture = false;
    await page.locator('.nav [data-tab="updates"]').click();

    await page.locator("#create-open").click();
    await page.locator(".ch-page").waitFor({ state: "visible" });
    const hubBounds = await page.locator(".ch-page").boundingBox();
    assert.ok(hubBounds && hubBounds.height >= 700, "Create opens as a full-screen page");
    await page.locator('.ch-row[data-ch="photo"]').click();
    const libraryPicker = page.locator("[data-ch-file]");
    assert.equal(await libraryPicker.getAttribute("accept"), "image/*,video/*");
    assert.equal(await libraryPicker.getAttribute("capture"), null, "the media picker must not force camera capture");
    assert.equal(await page.evaluate(() => window.__getUserMediaCalls), 0, "choosing Main feed does not start the camera");

    await libraryPicker.setInputFiles({
      name: "library-photo.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAmElEQVR4nO3QMREAIBDAsJeNDWxgEmRkoEP2Xmftc382OkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAO0BARgihnO/GDoAAAAASUVORK5CYII=", "base64")
    });
    // Authoritative success state: the camera is closed and a background photo is loaded (the empty-state hint is hidden only when project.background.media is set).
    await page.waitForFunction(() => {
      const editor = document.querySelector(".creative-editor"), canvas = document.querySelector("#ce-canvas");
      return editor && !editor.classList.contains("is-camera-open") && document.querySelector("#ce-empty")?.hidden === true && canvas?.width > 0 && canvas?.height > 0;
    }).catch(async error => {
      throw new Error(`Photo did not become ready. Camera open: ${await page.locator(".creative-editor").evaluate(element => element.classList.contains("is-camera-open"))}; error: ${await page.locator("#ce-error").textContent()}`, { cause: error });
    });
    assert.equal(await page.locator(".creative-editor").evaluate(element => element.classList.contains("is-camera-open")), false);
    assert.ok(await page.locator("#ce-canvas").evaluate(canvas=>canvas.width>0&&canvas.height>0));
    assert.equal(await page.locator(".ce-dock").isVisible(),true);
    assert.equal(await page.evaluate(() => window.__getUserMediaCalls), 0, "selecting a file does not request camera permission");
    if (process.env.OLDTIME_THEME_SCREENSHOTS) {
      await page.screenshot({ path: "/tmp/oldtime-create-theme.png" });
    }

    await page.locator("#ce-close").click(); // Return from the media review canvas to Camera mode.
    await page.locator("#ce-close").click();
    await page.locator("#ce-exit-dialog").waitFor({state:"visible"});
    await page.locator("#ce-exit-discard").click();
    await page.locator(".creative-editor").waitFor({state:"detached"});

    await page.locator("#create-open").click();
    await page.locator('.ch-primary[data-ch="camera"]').click();
    await page.locator(".creative-editor.is-camera-open").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector("#ce-error")?.textContent.trim());
    assert.equal(await page.locator("#ce-canvas").evaluate(canvas => getComputedStyle(canvas).objectFit), "cover", "the full-screen camera preview fills the screen without letterboxing");
    await page.locator("#ce-close").click();
    if (await page.locator("#ce-exit-dialog").isVisible()) await page.locator("#ce-exit-discard").click();
    await page.locator(".creative-editor").waitFor({state:"detached"});

    const cameraCallsBeforeStudio = await page.evaluate(() => window.__getUserMediaCalls);
    await page.locator("#create-open").click();
    await page.locator('.ch-primary[data-ch="studio"]').click();
    await page.locator(".creative-editor.is-studio").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => window.__getUserMediaCalls), cameraCallsBeforeStudio, "Oldtime Studio does not auto-start the camera");
    await page.locator("#ce-close").click();
    await page.locator(".creative-editor").waitFor({state:"detached"});

    await page.locator("#create-open").click();
    assert.equal(await page.locator(".ch-primary[data-ch='quote']").count(), 0,
      "Quote creation stays unavailable after visiting Studio and Camera");
    await page.locator(".ch-close").click();

    await page.locator('.nav [data-tab="profile"]').click();
    assert.equal(await page.locator(".profile-primary-actions button").count(), 1,
      "owners keep one direct Edit profile action");
    await page.locator("#profile-actions-open").click();
    await page.locator("#profile-actions-sheet").waitFor({ state: "visible" });
    assert.equal(await page.locator("#logout").isVisible(), true,
      "Log out remains available in the owner action drawer");
    assert.equal(await page.locator("[data-profile-activity]").isVisible(), true,
      "activity remains available in the owner action drawer");
    assert.equal(await page.locator("[data-profile-settings]").isVisible(), true,
      "the profile action sheet links directly to Settings");
    await page.locator("[data-profile-actions-close]").click();
    await page.locator("#profile-actions-sheet").waitFor({ state: "hidden" });
    await page.locator("#profile-note").click();
    await page.locator("#note-text").fill("A note above my photo");
    await page.locator("#save-note").click();
    await page.locator("#profile-note").waitFor({ state: "visible" });
    assert.equal((await page.locator("#profile-note").innerText()).trim(), "A note above my photo");
    const notePlacement = await page.evaluate(() => {
      const note = document.querySelector("#profile-note").getBoundingClientRect();
      const photo = document.querySelector(".profile-avatar").getBoundingClientRect();
      return { noteBottom: note.bottom, photoTop: photo.top };
    });
    assert.ok(notePlacement.noteBottom < notePlacement.photoTop, "the saved Note should sit above the profile photo");
    assert.equal(await page.locator(".profile-screen").evaluate(element => getComputedStyle(element).backgroundColor), "rgb(255, 255, 255)");
    assert.equal(await page.locator('[data-testid="quote-strip"], [data-testid="quote-viewer"], [data-quote-open]').count(), 0,
      "the profile has no Quote shelf or Quote viewer");
    assert.equal(await page.locator('[data-collection-create], [data-collection-open]').count(), 0);
    await page.locator("[data-post-cover-edit]").first().click();
    await page.locator('[data-cover-template="night"]').click();
    await page.locator("#ot-post-cover-save").click();
    await page.locator(".profile-post-media .ot-profile-cover-template.is-night").waitFor({ state: "visible" });
    assert.equal(await page.locator(".profile-name").evaluate(element => getComputedStyle(element).color), "rgb(22, 24, 35)");
    await page.locator("#profile-actions-open").click();
    await page.locator(".profile-action-sheet.on").waitFor({ state: "visible" });
    assert.match(await page.locator(".profile-action-sheet").innerText(), /Your profile[\s\S]*Settings[\s\S]*Log out/);
    assert.doesNotMatch(await page.locator(".profile-action-sheet").innerText(), /App menu/);
    for (const selector of ["#logout", "#playall"]) {
      const action = page.locator(selector);
      await action.waitFor({ state: "visible" });
      assert.ok(await action.evaluate(element => element.getBoundingClientRect().height >= 40), `${selector} should have a usable tap target`);
    }
    assert.equal(await page.locator(".profile-page").evaluate(element => element.scrollWidth <= element.clientWidth), true);
    if (process.env.OLDTIME_THEME_SCREENSHOTS) {
      await page.screenshot({ path: "/tmp/oldtime-profile-theme.png" });
    }
    await page.locator("[data-profile-actions-close]").click();
    await page.locator("#profile-actions-open").click();
    await page.locator("[data-profile-settings]").click();
    await page.locator(".settings-home").waitFor({ state: "visible" });
    assert.equal(await page.locator('[data-settings="data-transfer"]').count(), 0);
    assert.doesNotMatch(await page.locator(".settings-home").innerText(), /Transfer old data/);
    await page.locator("#settings-back").click();
    await page.locator(".profile-page").waitFor({ state: "visible" });
    await page.locator('.nav [data-tab="profile"]').click();
    await page.locator(".profile-page").waitFor({ state: "visible" });

    await page.setViewportSize({ width:402, height:650 });
    await page.locator("#edit").click();
    for (const selector of ["#savep-header", "#savep"]) {
      const placement = await page.locator(selector).evaluate(button => {
        const rect = button.getBoundingClientRect();
        const nav = document.querySelector(".nav").getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return {
          visible: rect.top >= 0 && rect.bottom <= nav.top,
          clickable: hit === button || button.contains(hit),
          background: getComputedStyle(button).backgroundColor
        };
      });
      assert.ok(placement.visible, `${selector} must stay above bottom navigation on a short phone`);
      assert.ok(placement.clickable, `${selector} must not be covered by another element`);
      assert.equal(placement.background, "rgb(213, 31, 50)");
    }
    if (process.env.OLDTIME_THEME_SCREENSHOTS) {
      await page.screenshot({ path: "/tmp/oldtime-profile-editor-save.png" });
    }
    await page.locator("#nm").fill("Profile Save Test");
    await page.locator("#bio").fill("Saved from the header");
    await page.locator("#savep-header").click();
    await page.locator(".profile-screen").waitFor({ state:"visible" });
    assert.equal(await page.locator(".profile-name").innerText(), "Profile Save Test");
    await page.reload();
    await page.locator('.nav [data-tab="profile"]').click();
    await page.locator(".profile-screen").waitFor({ state:"visible" });
    assert.equal(await page.locator(".profile-name").innerText(), "Profile Save Test");
    await page.locator("#edit").click();
    assert.equal(await page.locator("#bio").inputValue(), "Saved from the header");
    await page.locator("#city").fill("Test City");
    await page.locator("#savep").click();
    await page.locator(".profile-screen").waitFor({ state:"visible" });
    assert.match(await page.locator(".profile-city").innerText(), /Test City/);
    await page.setViewportSize({ width:402, height:874 });

    await page.locator('.nav [data-tab="updates"]').click();
    await page.locator("#create-open").click();
    await page.locator('.ch-primary[data-ch="studio"]').click();
    await page.locator(".creative-editor.is-studio").waitFor({ state: "visible" });
    await page.locator('.ce-menu.ce-quick > summary').click();
    await page.locator('[data-ce-add="text"]').click();
    await page.locator("#ce-inline-text").fill("Only my Close Friends should see this");
    await page.locator("#ce-text-done").click();
    await page.locator(".ce-share-menu > summary").click();
    await page.locator("#ce-share-toggle").click();
    assert.equal((await page.locator('#ce-destination option[value="post"]').innerText()).trim(), "Main feed");
    assert.equal((await page.locator('#ce-destination option[value="community"]').innerText()).trim(), "Community");
    assert.equal(await page.locator("#ce-other-feed-label").innerText(), "Also share to Community");
    await page.locator("#ce-other-feed").check();
    await page.locator("#ce-destination").selectOption("community");
    assert.equal(await page.locator("#ce-other-feed-label").innerText(), "Also share to Main feed");
    await page.locator("#ce-destination").selectOption("story");
    await page.locator(".ce-panel .ce-sheet-done").click();
    await page.locator('.ce-menu:has([data-ce-add="sticker"]) > summary').click();
    const mediaBefore=await page.locator("#ce-canvas").boundingBox();
    await page.locator('[data-ce-add="sticker"]').click();
    const mediaWithTray=await page.locator("#ce-canvas").boundingBox();
    const trayGeometry=await page.locator("#ce-sticker-flow").evaluate(element=>({width:element.clientWidth,scrollWidth:element.scrollWidth}));
    assert.ok(mediaBefore&&mediaWithTray);
    assert.ok(Math.abs(mediaBefore.height-mediaWithTray.height)<1,"sticker tray overlays the full-screen canvas");
    assert.ok(trayGeometry.width>0&&trayGeometry.scrollWidth>=trayGeometry.width*2,"library and configuration stay in one horizontal tray");
    await page.locator('[data-ce-sticker="hey-word"]').click();
    const promptState=await page.evaluate(()=>{
      const get=id=>document.querySelector(id), flow=get("#ce-sticker-flow"), page=get("#ce-sticker-config-page");
      const prompt=get("#ce-hey-word-prompt"), controls=get("#ce-hey-word-controls");
      return {destination:get("#ce-destination")?.value,kind:get("#ce-sticker-kind")?.value,enabled:get("#ce-hey-word-enabled")?.checked,
        controlsHidden:controls?.hidden,promptHidden:prompt?.hidden,promptRect:prompt?.getBoundingClientRect().toJSON(),
        flow:{left:flow?.scrollLeft,width:flow?.clientWidth,total:flow?.scrollWidth},pageRect:page?.getBoundingClientRect().toJSON(),
        panel:get("#ce-panel")?.dataset.sheet,display:getComputedStyle(get("#ce-panel")).display};
    });
    assert.equal(await page.locator("#ce-hey-word-prompt").isVisible(),true,JSON.stringify(promptState));
    await page.locator("#ce-hey-word-prompt").fill("Show the moment you felt proud");
    await page.locator("#ce-sticker-add").click();
    await page.locator('.ce-menu:has([data-ce-add="sticker"]) > summary').click();
    await page.locator('[data-ce-add="sticker"]').click();
    await page.locator('[data-ce-sticker="poll"]').click();
    await page.locator("#ce-sticker-value").fill("What should we do next?");
    await page.locator("#ce-sticker-options").fill("Run, Walk");
    await page.locator("#ce-sticker-add").click();
    await page.locator("#ce-sticker-edit-text").fill("Best pace?");
    await page.locator("#ce-sticker-edit-choice-a").fill("Steady");
    await page.locator("#ce-sticker-edit-choice-b").fill("Fast");
    await page.locator(".ce-panel .ce-sheet-done").click();
    await page.locator(".ce-share-menu > summary").click();
    await page.locator("#ce-share-toggle").click();
    await page.locator("#ce-visibility").selectOption("close-friends");
    await page.locator("#ce-publish").click();
    await page.waitForFunction(() => !document.querySelector(".creative-editor") ||
      Boolean(document.querySelector("#ce-error")?.textContent.trim()), null, { timeout: 15000 });
    const editorError = await page.locator("#ce-error").textContent().catch(() => "");
    assert.ok(!editorError?.trim(), `Studio Story publish error: ${editorError}; API calls: ${storyApiCalls.join(", ")}`);
    await page.waitForFunction(() => !document.querySelector(".creative-editor"), null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("oldtime-v1")).stories.length), 0,
      "a cloud Studio Story must not be copied into device-local Story storage");
    assert.ok(publishedStory?.hasMedia && studioMediaReserved, "the rendered Story should use a confirmed Supabase media asset");

    showRepostFixture = true;
    const repostFeedResponse = page.waitForResponse(response =>
      response.url().includes("/api/feed") && response.request().method() === "GET"
    );
    await page.reload({ waitUntil: "networkidle" });
    await repostFeedResponse;
    await page.locator("#create-open").waitFor({ state: "visible" });
    await page.locator('.nav [data-tab="communities"]').click();
    const remixCounter = page.locator('[data-testid="card-community-post-browser-repost-post"] .community-post-remix-count');
    assert.equal(await remixCounter.count(), 0,
      "Community cards omit the diagonal Remix badge shown in the attached screenshot");
    assert.deepEqual(await page.locator('[data-testid="card-community-post-browser-repost-post"] .community-post-actions').evaluate(element =>
      [...element.children].map(child => child.matches("[data-like]") ? "like"
        : child.matches("[data-comment]") ? "comment"
          : child.matches("[data-repost]") ? "repost"
            : child.matches("[data-share]") ? "share"
              : child.matches("[data-save]") ? "save" : "unknown")
    ), ["like", "comment", "repost", "share", "save"],
    "Community action positions remain aligned after removing the Remix badge");
    const communitySharePath = await page.locator('[data-testid="card-community-post-browser-repost-post"] .community-post-actions [data-share] .navic path').getAttribute("d");
    assert.match(communitySharePath, /^M13\.5 4\.5 21 12l-7\.5 7\.5/,
      "Community posts use the same curved forward-arrow share icon as Home");
    const communityIconStyle = await page.locator('[data-testid="card-community-post-browser-repost-post"] .community-post-actions').evaluate(element =>
      [...element.querySelectorAll("svg")].map(svg => [svg.getAttribute("fill"), svg.getAttribute("stroke-width"), svg.getAttribute("stroke-linecap")])
    );
    assert.equal(communityIconStyle.length, 5);
    assert.ok(communityIconStyle.every(([fill, width, cap]) => fill === "none" && width === "1.8" && cap === "round"),
      "Community social icons use consistent thin rounded outlines while unselected");
    const communityBounds = await page.locator(".community-screen").evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, width: rect.width, viewport: window.innerWidth };
    });
    assert.ok(communityBounds.left <= 1 && communityBounds.width >= communityBounds.viewport - 1,
      "Community feed extends to the full iPhone viewport width");
    const homeFeedReload = page.waitForResponse(response =>
      response.url().includes("/api/feed") && response.request().method() === "GET"
    );
    await page.reload({ waitUntil: "networkidle" });
    await homeFeedReload;
    await page.locator("#create-open").waitFor({ state: "visible" });
    await page.locator('.nav [data-tab="updates"]').click();
    const repostButton = page.locator('.clip[data-id="browser-repost-post"] .act[data-repost]');
    const homeActions = page.locator('.clip[data-id="browser-repost-post"] .rail');
    assert.equal(await repostButton.count(), 0,
      "The full-screen Home rail has no direct Repost button");
    assert.equal(await homeActions.locator(".act[data-save]").count(), 1,
      "the Home feed keeps its bookmark action beside the other social actions");
    const renderedSharePath = await homeActions.locator("[data-share] .navic path").getAttribute("d");
    assert.match(renderedSharePath, /^M13\.5 4\.5 21 12l-7\.5 7\.5/,
      "Home uses the curved forward-arrow share icon from the supplied reference");
    const homeIconStyle = await homeActions.evaluate(element =>
      [...element.querySelectorAll(".act .navic")].map(svg => [svg.getAttribute("fill"), svg.getAttribute("stroke-width"), svg.getAttribute("stroke-linecap")])
    );
    assert.equal(homeIconStyle.length, 4);
    assert.ok(homeIconStyle.every(([fill, width, cap]) => fill === "none" && width === "1.8" && cap === "round"),
      "Home feed social icons use the same thin rounded outline style as Community");
    const homeIconPresentation = await homeActions.evaluate(element => {
      const share = element.querySelector("[data-share]");
      const save = element.querySelector("[data-save]");
      return {
        iconSize: Number(element.querySelector("[data-like] .navic").getBoundingClientRect().width),
        saveColor: getComputedStyle(save).color,
        countColors: [...element.querySelectorAll(".act-count")].map(node => getComputedStyle(node).color),
        shareLabel: share.querySelector(".act-label")?.textContent?.trim(),
      };
    });
    assert.equal(homeIconPresentation.iconSize, 34);
    assert.equal(homeIconPresentation.saveColor, "rgb(255, 255, 255)");
    assert.ok(homeIconPresentation.countColors.every(color => color === "rgb(255, 255, 255)"));
    assert.equal(homeIconPresentation.shareLabel, "Share");
    const fullScreenBounds = await page.locator("#feed .clip:not(.post-detail)").first().evaluate(element => {
      const clip = element.getBoundingClientRect();
      const feed = document.querySelector("#feed").getBoundingClientRect();
      return { clipWidth: clip.width, feedWidth: feed.width, clipHeight: clip.height, feedHeight: feed.height, viewport: window.innerWidth };
    });
    assert.ok(fullScreenBounds.clipWidth >= fullScreenBounds.viewport - 1, JSON.stringify(fullScreenBounds));
    assert.ok(Math.abs(fullScreenBounds.clipHeight - fullScreenBounds.feedHeight) < 2,
      "Home feed remains full-screen and the snap page fills its viewport");
    await homeActions.locator(".act[data-share]").click();
    for (const action of ["data-share-repost", "data-share-save", "data-share-story", "data-share-friends"]) {
      await page.locator(`[${action}]`).waitFor({ state: "visible" });
    }
    await page.locator("[data-share-friends]").click();
    await page.locator("[data-share-search]").waitFor({ state: "visible", timeout: 5000 }).catch(async failure => {
      const state = await page.evaluate(() => ({
        search: !!document.querySelector("[data-share-search]"),
        error: document.querySelector("[data-sheet-error]")?.textContent?.trim() || "",
        sheetText: document.querySelector("#sheet")?.innerText || document.querySelector(".sheet")?.innerText || "",
      }));
      throw new Error(`Friends picker did not open: ${JSON.stringify(state)}; ${failure.message}`);
    });
    assert.equal((await page.locator("[data-sheet-error]").innerText()).trim(), "",
      "Opening the Friends picker does not show a missing Share-handler error");
    await page.locator("[data-share-back]").click();
    const repostResponse = page.waitForResponse(response =>
      response.url().includes("/api/posts/browser-repost-post/repost") &&
      response.request().method() === "PUT"
    );
    await page.locator("[data-share-repost]").click();
    await repostResponse;
    assert.equal(await page.locator(".reposted-float").count(), 0,
      "Reposting does not add a black animated badge");
    assert.equal(await page.locator('.clip[data-id="browser-repost-post"] .act[data-repost]').count(), 0);
    await page.locator('.clip[data-id="browser-repost-post"] .act[data-share]').click();
    await page.locator('[data-share-repost][aria-pressed="true"]').waitFor({ state: "visible" });
    const removeRepostResponse = page.waitForResponse(response =>
      response.url().includes("/api/posts/browser-repost-post/repost") &&
      response.request().method() === "DELETE"
    );
    await page.locator("[data-share-repost]").click();
    await removeRepostResponse;
    assert.equal(await page.locator(".reposted-float").count(), 0);
    await page.locator('.clip[data-id="browser-repost-post"] .act[data-share]').click();
    await page.locator("[data-share-story]").click();
    await page.locator(".creative-editor").waitFor({ state: "visible" });
    await page.locator("#ce-destination").waitFor({ state: "attached" });
    assert.equal(await page.locator("#ce-destination").inputValue(), "story",
      "Share to Status opens the existing composer in Story mode");
    await page.locator("#ce-close").click();

    const signupContext = await browser.newContext({ viewport: { width: 402, height: 874 } });
    await signupContext.route("**/api/**", isolateApi);
    const signupPage = await signupContext.newPage();
    await signupPage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    await signupPage.locator("#signup").click();
    await signupPage.locator("#signup-form").waitFor({ state: "visible" });
    assert.deepEqual(await signupPage.locator("#signup-form input").evaluateAll(inputs => inputs.map(input => input.id)),
      ["su-email", "su-user", "su-pass"], "registration asks only for the three required account details");
    assert.equal(await signupPage.locator("#su-user").getAttribute("pattern"), "[A-Za-z0-9_]{3,24}");
    assert.equal(await signupPage.locator("#su-pass").getAttribute("minlength"), "8");
    if (process.env.OLDTIME_THEME_SCREENSHOTS) {
      await signupPage.screenshot({ path: "/tmp/oldtime-technologies-signup.png" });
    }
    await signupContext.close();

    assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join("; ")}`);
    await context.close();
  } finally {
    await browser?.close();
    await server.close();
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
    if (originalBasePath === undefined) delete process.env.BASE_PATH;
    else process.env.BASE_PATH = originalBasePath;
  }
});

