import assert from "node:assert/strict";
import test from "node:test";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
globalThis.window = { addEventListener() {}, dispatchEvent() {} };
const { api, mutate } = await import("./store.js");

const account = { id: "cloud-story-owner", username: "story_owner", displayName: "Story Owner" };
const token = "c".repeat(43);
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const authResponse = () => response({
  accessToken: token,
  expiresAt: Date.now() + 60_000,
  account,
  tokenType: "Bearer",
});
const storyDto = (id, createdAt = Date.now(), hasMedia = false) => ({
  id,
  text: "Cloud Story",
  visibility: "public",
  hasMedia,
  ...(hasMedia ? { mediaType: "photo" } : {}),
  savedToProfile: false,
  viewerReaction: null,
  createdAt,
  expiresAt: createdAt + 86_400_000,
  author: { ...account, createdAt },
});

function withFetch(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    if (url === "/api/auth/login") return Promise.resolve(authResponse());
    if (url === "/api/auth/logout") return Promise.resolve(response({}, 204));
    return handler(url, options);
  };
  t.after(() => {
    api.logout();
    globalThis.fetch = original;
  });
}

test("cloud Stories load from the API without replacing existing device Stories", async t => {
  withFetch(t, async url => {
    assert.equal(url, "/api/stories");
    return response({ stories: [storyDto("cloud-story-1", Date.now(), true)] });
  });
  await api.login("story_owner", "fixture-password");
  const localStory = { id: "device-story", author: api.me().id, text: "Keep local", created: Date.now() };
  mutate(state => { state.stories = [localStory]; });

  await api.refreshCloudStories();

  assert.equal(api.authMode(), "cloud");
  assert.equal(api.stories().some(story => story.id === "cloud-story-1" && story.cloud), true);
  assert.equal(api.stories().find(story => story.id === "cloud-story-1").hasMedia, true);
  assert.equal(api.db().stories.some(story => story.id === "device-story"), true);
});

test("cloud Studio Story uploads its rendered Blob to Supabase and links the confirmed asset", async t => {
  const calls = [];
  withFetch(t, async (url, options) => {
    calls.push({ url, method: options.method, body: options.body, headers: options.headers });
    if (url === "/api/account/privacy") return response({ isPrivate: false, initialized: true });
    if (/^\/api\/media\/[^/]+\/upload$/.test(url)) return response({ ready: true });
    if (url === "/api/stories" && options.method === "POST") {
      return response({ story: storyDto("studio-cloud-story", Date.now(), true) }, 201);
    }
    if (url === "/api/stories") return response({ stories: [storyDto("studio-cloud-story", Date.now(), true)] });
    assert.fail(`Unexpected request: ${url}`);
  });
  await api.login("story_owner", "fixture-password");
  const mediaBlob = new Blob(["rendered PNG bytes"], { type: "image/png" });

  const created = await api.createCloudStory({ text: "Studio export", visibility: "public", mediaBlob });

  assert.equal(created.id, "studio-cloud-story");
  const reservation = calls.find(call => /^\/api\/media\/[^/]+\/upload$/.test(call.url));
  assert.equal(JSON.parse(reservation.body).contentType, "image/png");
  const storyRequest = calls.find(call => call.url === "/api/stories" && call.method === "POST");
  assert.ok(JSON.parse(storyRequest.body).mediaId);
  assert.equal(calls.some(call => call.url.includes("/stories/studio-cloud-story/media")), false);
  assert.equal(api.stories().some(story => story.id === "studio-cloud-story" && story.cloud), true);
  assert.equal(api.db().stories.some(story => story.id === "studio-cloud-story"), false);
});

test("publishing a cloud Story writes to the authenticated API", async t => {
  const calls = [];
  withFetch(t, async (url, options) => {
    calls.push({ url, method: options.method, body: options.body });
    if (url === "/api/account/privacy") return response({ isPrivate: false, initialized: true });
    if (url === "/api/stories" && options.method === "POST") {
      return response({ story: storyDto("created-cloud-story") }, 201);
    }
    if (url === "/api/stories") return response({ stories: [storyDto("created-cloud-story")] });
    assert.fail(`Unexpected request: ${url}`);
  });
  await api.login("story_owner", "fixture-password");

  const created = await api.createCloudStory({ text: "Saved online", visibility: "public" });

  assert.equal(created.id, "created-cloud-story");
  assert.deepEqual(calls.map(call => `${call.method} ${call.url}`), [
    "GET /api/account/privacy",
    "POST /api/stories",
    "GET /api/stories",
  ]);
  assert.deepEqual(JSON.parse(calls[1].body), { text: "Saved online", visibility: "public", commentsEnabled: true });
});

test("Story views, reactions, and owner activity use authenticated cloud routes", async t => {
  const calls = [];
  const viewer = { id: "story-viewer-id", username: "story_viewer", displayName: "Story Viewer" };
  withFetch(t, async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body });
    if (url === "/api/stories") return response({ stories: [storyDto("active-story")] });
    if (url.endsWith("/views")) return response({ recorded: true });
    if (url.endsWith("/reactions") && options.method === "PUT") {
      return response({ reaction: { emoji: "❤️", createdAt: Date.now() } });
    }
    if (url.endsWith("/reactions") && options.method === "DELETE") return response(null, 204);
    if (url.endsWith("/activity")) {
      return response({
        viewCount: 1,
        reactionCount: 1,
        viewers: [{ ...viewer, viewedAt: Date.now(), reaction: "❤️" }],
      });
    }
    assert.fail(`Unexpected request: ${url}`);
  });
  await api.login("story_owner", "fixture-password");
  await api.refreshCloudStories();

  assert.deepEqual(await api.recordCloudStoryView("active-story"), { recorded: true });
  assert.equal(await api.setCloudStoryReaction("active-story", "❤️"), "❤️");
  const activity = await api.loadCloudStoryActivity("active-story");
  assert.equal(activity.viewCount, 1);
  assert.equal(activity.reactionCount, 1);
  assert.deepEqual(activity.viewers[0], {
    ...viewer,
    viewedAt: activity.viewers[0].viewedAt,
    reaction: "❤️",
  });
  await api.removeCloudStoryReaction("active-story");

  assert.deepEqual(calls.map(call => `${call.method} ${call.url}`), [
    "GET /api/stories",
    "POST /api/stories/active-story/views",
    "PUT /api/stories/active-story/reactions",
    "GET /api/stories/active-story/activity",
    "DELETE /api/stories/active-story/reactions",
  ]);
  assert.deepEqual(JSON.parse(calls[2].body), { emoji: "❤️" });
  assert.equal(api.stories().find(story => story.id === "active-story").viewerReaction, null);
});

test("legacy Story media is removed from the device only after the cloud copy is confirmed", async t => {
  const createdAt = Date.now() - 5_000;
  const expiresAt = createdAt + 86_400_000;
  const sourceId = "legacy-story-1";
  const mediaDataUrl = "data:image/png;base64,legacy-image";
  const mediaBlob = new Blob(["legacy image bytes"], { type: "image/png" });
  const calls = [];
  withFetch(t, async (url, options = {}) => {
    if (url === "/api/account/privacy") return response({ isPrivate: false, initialized: true });
    if (url === mediaDataUrl) return { ok: true, blob: async () => mediaBlob };
    calls.push({ url, method: options.method || "GET", body: options.body });
    if (/^\/api\/media\/[^/]+\/upload$/.test(url)) return response({ ready: true });
    if (url === "/api/stories/import") {
      const payload = JSON.parse(options.body);
      return response({
        story: {
          id: "imported-story-id",
          sourceId: payload.sourceId,
          text: payload.text,
          visibility: payload.visibility,
          mediaType: payload.mediaType,
          hasMedia: Boolean(payload.mediaId),
          savedToProfile: payload.savedToProfile,
          commentsEnabled: payload.commentsEnabled,
          createdAt: payload.createdAt,
          expiresAt: payload.expiresAt
        },
        alreadyImported: calls.filter(call => call.url === url).length > 1
      });
    }
    assert.fail(`Unexpected request: ${url}`);
  });
  await api.login("story_owner", "fixture-password");
  mutate(state => {
    state.stories = [{
      id: sourceId,
      author: api.me().id,
      kind: "photo",
      media: mediaDataUrl,
      text: "Legacy Story",
      visibility: "friends",
      created: createdAt,
      expiresAt,
      savedToProfile: false,
      commentsEnabled: true
    }];
  });

  const result = await api.migrateCloudStories();

  assert.equal(result.confirmed, 1);
  assert.equal(result.pending, 0);
  assert.equal(api.db().stories.some(story => story.id === sourceId), false);
  assert.equal(calls.filter(call => call.url === "/api/stories/import").length, 1);
  assert.ok(JSON.parse(calls.find(call => call.url === "/api/stories/import").body).mediaId);
});
