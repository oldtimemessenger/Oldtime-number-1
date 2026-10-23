import test from "node:test";
import assert from "node:assert/strict";
import { filterInbox, findMatchingMessage, inboxEmptyText, isGroupMembers, snippetAround } from "./inbox-helpers.js";

const chats = [
  { id: "a", name: "Ada", group: false, unread: 0, messages: ["see you at lunch", "ok bye"] },
  { id: "g", name: "Crew", group: true, unread: 2, messages: ["pizza tonight?", "late"] },
  { id: "v", name: "Vera", group: false, unread: 0, verified: true, followerCount: 12500, messages: ["hello"] },
];
const ad = { name: c => c.name, messages: c => c.messages, textOf: m => m, isGroup: c => c.group, unread: c => c.unread, unanswered: c => c.id === "a", verified: c => c.verified, followers10k: c => c.followerCount >= 10000 };

test("search shows the matching message and excludes non-matching chats", () => {
  const r = filterInbox(chats, { query: "pizza" }, ad);
  assert.deepEqual(r.map(x => x.item.id), ["g"]); assert.equal(r[0].match.text, "pizza tonight?");
  assert.deepEqual(filterInbox(chats, { query: "zzz" }, ad), []);
  assert.equal(filterInbox(chats, { query: "ada" }, ad)[0].match, null);
});
test("groups and unread scopes", () => {
  assert.deepEqual(filterInbox(chats, { filter: "groups" }, ad).map(x => x.item.id), ["g"]);
  assert.deepEqual(filterInbox(chats, { filter: "unread", query: "late" }, ad).map(x => x.item.id), ["g"]);
  assert.deepEqual(filterInbox(chats, { filter: "unanswered" }, ad).map(x => x.item.id), ["a"]);
  assert.deepEqual(filterInbox(chats, { filter: "groups", query: "lunch" }, ad), []);
});
test("verified and 10K follower filters use account data", () => {
  assert.deepEqual(filterInbox(chats, { filter: "verified" }, ad).map(x => x.item.id), ["v"]);
  assert.deepEqual(filterInbox(chats, { filter: "followers-10k" }, ad).map(x => x.item.id), ["v"]);
  assert.equal(inboxEmptyText({ filter: "verified" }), "No verified conversations.");
});
test("group needs three people total and empty states differ", () => {
  assert.equal(isGroupMembers(["a", "b"]), false); assert.equal(isGroupMembers(["a", "b", "c"]), true);
  assert.notEqual(inboxEmptyText({ filter: "groups" }), inboxEmptyText({ filter: "unread" }));
  assert.match(inboxEmptyText({ query: "x" }), /match/);
});
test("snippets centre on the match", () => {
  const long = `${"a ".repeat(60)}needle${" b".repeat(60)}`;
  assert.ok(snippetAround(long, "needle").includes("needle")); assert.ok(snippetAround(long, "needle").length < long.length);
  assert.equal(findMatchingMessage(["x"], "", m => m), null);
});
