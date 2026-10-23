import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("Community keeps global Chat separate and provides a working repost action", () => {
  const source = read("app.js");
  for (const view of ["updates", "communities", "search", "chat", "profile"]) {
    assert.ok(source.includes(`data-tab="${view}"`));
  }
  assert.match(source, /<button class="icon" data-tab="search" aria-label="Search"/);
  assert.ok(source.includes('id="community-note-open" aria-label="Create post or Note" title="Create post or Note">${ic.plus}</button>'));
  assert.doesNotMatch(source, /community-more-open|data-blast-tool|blast-tools-title|blast-event-title/);
  assert.match(source, /data-repost="\$\{esc\(post\.id\)\}".*fmt\(repostCount\)/);
  assert.match(source, /data-comment="\$\{esc\(post\.id\)\}".*fmt\(commentCount\)/);
  assert.match(source, /data-save="\$\{esc\(post\.id\)\}".*fmt\(saveCount\)/);
  assert.match(source, /data-testid="button-nav-search"/);
  assert.doesNotMatch(source, /nav-create-button|button-nav-create-post/);
  const nav = source.match(/<nav class="nav \$[\s\S]*?<\/nav>/)?.[0] || "";
  assert.deepEqual([...nav.matchAll(/data-tab="([^"]+)"/g)].map(match => match[1]), [
    "updates", "communities", "search", "chat", "profile"
  ]);
  for (const route of ["communities", "chat", "get-on-board"]) {
    assert.ok(source.includes(`data-drawer-route="${route}"`));
  }
  for (const excluded of ["live", "tournaments", "sports"]) {
    assert.ok(!source.includes(`data-drawer-route="${excluded}"`));
  }
});

test("Create keeps Studio and Camera while hiding Quote creation", () => {
  const hub = read("creation-hub.js");
  for (const action of ['["studio", "Oldtime Studio"', '["camera", "Camera"']) {
    assert.ok(hub.includes(action));
  }
  assert.match(hub, /const primaryActions = \[[\s\S]*?\["camera", "Camera", icons\.camera\]/);
  assert.doesNotMatch(hub, /\["quote",\s*"Quote"/);
  assert.doesNotMatch(hub, /startQuote|onQuote/);
  assert.match(hub, /class="ch-primary-icon"/);
  assert.doesNotMatch(hub, /Recent on this device|loadRecentPhotos|data-ch-recents/);
  assert.match(hub, /data-ch-close/);
});

test("Messages start new online chats separately from read-only archives", () => {
  const chat = read("chat.js");
  const store = read("store.js");
  const sendMessage = store.slice(store.indexOf("async sendCloudChatMessage"), store.indexOf("async updateCloudChatState"));
  assert.match(chat, /find\(x => !x\.legacyArchive/);
  assert.match(chat, /api\.searchCloudUsers\(query\)/);
  assert.match(chat, /data-pick=/);
  assert.match(chat, /putLocalMedia/);
  assert.doesNotMatch(chat, /fileToData/);
  assert.doesNotMatch(sendMessage, /method:\s*"PUT"/);
  assert.match(store, /\.filter\(room => room\.messages\.length > 0 \|\| room\.draft\.trim\(\)\.length > 0\)/);
});

test("new message opens a one-to-one inbox directly and group picks can be removed", () => {
  const chat = read("chat.js");
  assert.match(chat, /const conversationId = ensureConvo\(\[personId\]\)/);
  assert.match(chat, /ctx\.setChat\(conversationId\)/);
  assert.match(chat, /id="chat-compose-selected"/);
  assert.match(chat, /data-remove-pick=/);
  assert.match(chat, /id="chat-compose-action"/);
  assert.match(chat, /Create group/);
  assert.doesNotMatch(chat, /"Start chat"/);
});

test("Profile exposes Settings directly and migrates legacy data in the background", () => {
  const source = read("app.js");
  assert.match(source, /data-profile-settings/);
  assert.doesNotMatch(source, /data-profile-app-menu/);
  assert.doesNotMatch(source, /data-transfer|Transfer old data/);
  assert.match(source, /migrateLegacyAccountDataInBackground/);
  assert.match(source, /api\.migrateCloudTextPosts\(\{ retry: true \}\)/);
  assert.match(source, /api\.migrateCloudStories\(\{ retry: true \}\)/);
  assert.match(source, /api\.migrateLegacyChatArchives\(\{ retry: true \}\)/);
  assert.match(source, /migrateLegacyCreativeDrafts/);
});
