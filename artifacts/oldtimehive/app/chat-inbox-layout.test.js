import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = name => readFileSync(new URL(name, import.meta.url), "utf8");
const chat = read("chat.js");
const styles = read("styles.css");
const icons = read("icons.js");
const inbox = chat.slice(chat.indexOf('<section class="screen on light chat-list-screen">'), chat.indexOf('let listFilter = "all"'));
const header = inbox.slice(inbox.indexOf('<div class="chat-list-topline">'), inbox.indexOf('<div class="chat-note-field">'));

test("inbox filter control is in the header and the visible All chip is removed", () => {
  assert.match(header, /id="chat-filter-open"[^>]*>\$\{ic\.settings\}/);
  assert.doesNotMatch(inbox, /chat-filter-control|chat-filter-label|>All</);
  assert.match(inbox, /data-more-filter="all"[^>]*>.*Every chat/);
});

test("inbox removes duplicate bookmark and overflow controls while keeping search, settings, compose, and folders", () => {
  assert.match(header, /id="toggle-chat-search"/);
  assert.match(header, /id="chat-filter-open"[^>]*aria-label="Filters"/);
  assert.doesNotMatch(header, /id="saved"|id="chat-more"/);
  assert.match(header, /id="newchat"/);
  assert.match(inbox, /\["primary","Primary"\]/);
  assert.match(inbox, /\["requests","Requests"\]/);
  assert.match(inbox, /\["general","General"\]/);
  assert.match(inbox, /id="more-saved"/);
  assert.match(inbox, /<h2>Filters<\/h2>/);
  assert.match(inbox, /id="more-folders" aria-expanded="true"/);
  assert.match(inbox, /id="chat-folder-options">/);
  assert.match(icons, /sendUp: '<path d="M12 19V5m-7 7 7-7 7 7"/);
});

test("folder tabs fill the row as compact rounded controls", () => {
  assert.match(styles, /\.chat-inbox-tabs \{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.chat-inbox-tab \{[^}]*min-height:42px[^}]*border-radius:999px/);
});

test("outside taps close inbox search and clear its filter", () => {
  assert.match(chat, /document\.addEventListener\("click", searchOutside\)/);
  assert.match(chat, /!e\.target\.closest\?\.\("#chat-search-panel"\).*closeSearch\(\)/);
  assert.match(chat, /searchInput\.value = ""/);
});

test("selected inbox filters and Saved card use flat colors without glow", () => {
  assert.match(styles, /\.chat-option\[aria-checked="true"\] \{[^}]*box-shadow:none[^}]*background:#f2f3f5/);
  assert.match(styles, /\.chat-option\[aria-checked="true"\] \.chat-option-radio \{[^}]*box-shadow:none/);
  assert.match(styles, /\.chat-organize-card \{[^}]*background:#fff[^}]*box-shadow:none/);
  assert.match(styles, /\.chat-organize-icon \{[^}]*background:#fff[^}]*box-shadow:none/);
  assert.match(styles, /\.chat-organize-card #more-saved \{[^}]*box-shadow:none/);
  assert.doesNotMatch(styles, /\.chat-organize-card \{[^}]*linear-gradient/);
});

test("empty chats offer a real waving sticker and the composer expands for full text", () => {
  assert.match(chat, /Say hi by sending a sticker/);
  assert.match(chat, /id="send-hi-sticker"[^>]*>.*👋/);
  assert.match(chat, /pushMsg\(id, \{ kind: "sticker", body: "👋" \}, ownerId\)/);
  assert.match(chat, /<textarea id="msg" rows="1"/);
  assert.match(chat, /e\.currentTarget\.form\?\.requestSubmit\(\)/);
  assert.match(styles, /\.chat-composer textarea \{[^}]*max-height:112px/);
  assert.match(styles, /\.conversation-screen \.message-body \{[^}]*white-space:pre-wrap/);
  assert.match(styles, /\.chat-option-icon \{[^}]*border-radius:0[^}]*background:transparent/);
});

test("message bubbles size to their content and keep sender and receiver alignment", () => {
  assert.match(styles, /\.conversation-screen \.bubble-msg \{[^}]*height:auto[^}]*min-height:0[^}]*flex:0 0 auto/);
  assert.match(styles, /\.conversation-screen \.bubble-msg\.mine \{[^}]*align-self:flex-end/);
  assert.match(styles, /\.conversation-screen \.bubble-msg\.theirs \{[^}]*align-self:flex-start/);
  assert.match(styles, /\.conversation-screen \.message-row \{[^}]*background:transparent/);
  assert.match(chat, /<div class="message-body">\$\{body\(m, c\.legacyArchive\)\}<\/div>/);
  assert.match(chat, /<div \$\{messageRow\}><div class="bubble-msg/);
  assert.match(chat, /messageDayLabel\(m\.created\)/);
  assert.match(chat, /const time = cluster\.endsCluster \? `<span class="message-time">/);
  assert.match(chat, /const metadata = flags \|\| footer \?/);
  assert.match(chat, /messageDetails = \[messageDateTime\(m\.created\), m\.edited \? "Edited" : ""\]/);
  assert.match(chat, /<div \$\{messageRow\}><div class="bubble-msg[\s\S]*\$\{metadata\}<\/div>`;/);
  assert.match(chat, /String\(m\.body \|\| ""\)\.replace\(\/\\r\\n\?\/g, "\\n"\)\.trim\(\)/);
});
