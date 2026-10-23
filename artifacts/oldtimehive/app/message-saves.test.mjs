import { test } from "node:test";
import assert from "node:assert/strict";
import { toggleMessageSaved, messageIsSaved } from "./message-saves.js";
const fixture = () => ({ convos: [{ id: "room", members: ["a", "b"], messages: [{ id: "msg", body: "Hello" }] }] });
test("saving and unsaving update the bookmark and saved index without duplicates", () => {
  const db = fixture(), message = db.convos[0].messages[0];
  assert.equal(toggleMessageSaved(db, "room", "msg", "a"), true);
  assert.equal(messageIsSaved(message, "a"), true);
  assert.deepEqual(db.saved, ["msg"]);
  assert.equal(toggleMessageSaved(db, "room", "msg", "a"), false);
  assert.equal(messageIsSaved(message, "a"), false);
  assert.deepEqual(db.saved, []);
});
test("bookmarks are private to the person who saves the message", () => {
  const db = fixture(), message = db.convos[0].messages[0];
  toggleMessageSaved(db, "room", "msg", "a");
  assert.equal(messageIsSaved(message, "b"), false);
  toggleMessageSaved(db, "room", "msg", "b");
  toggleMessageSaved(db, "room", "msg", "a");
  assert.equal(messageIsSaved(message, "b"), true);
});
test("legacy saved data remains visible and can be unsaved", () => {
  const db = fixture(), message = db.convos[0].messages[0];
  message.starred = true;
  assert.equal(messageIsSaved(message, "a"), true);
  toggleMessageSaved(db, "room", "msg", "a");
  assert.equal(messageIsSaved(message, "a"), false);
});
test("non-members, expired and view-once messages cannot be bookmarked", () => {
  const db = fixture(), message = db.convos[0].messages[0];
  assert.throws(() => toggleMessageSaved(db, "room", "msg", "stranger"), /unavailable/);
  message.viewOnce = true;
  assert.throws(() => toggleMessageSaved(db, "room", "msg", "a"), /cannot be saved/);
  message.viewOnce = false; message.expired = true;
  assert.throws(() => toggleMessageSaved(db, "room", "msg", "a"), /cannot be saved/);
});
