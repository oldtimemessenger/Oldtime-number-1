import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = name => readFileSync(new URL(name, import.meta.url), "utf8");
const chat = read("chat.js");
const contactDetails = chat.slice(chat.indexOf("function contactInfo"), chat.indexOf("function sharedPreview"));
const groupDetails = chat.slice(chat.indexOf("function info"), chat.indexOf("function contactInfo"));
const contactActions = chat.slice(chat.indexOf("async function toggleContactFollow"), chat.indexOf("function groupOptions"));

test("chat details no longer expose wallpaper customization controls", () => {
  assert.doesNotMatch(`${contactDetails}\n${groupDetails}`, /Customize chat|Change conversation wallpaper|id="(?:details-wall|wall)"/i);
  assert.doesNotMatch(contactActions, /Wallpaper/i);
});

test("cloud chat follow uses authenticated relationships and local follow checks missing profiles", () => {
  const followStart = contactActions.indexOf("async function toggleContactFollow");
  const followEnd = contactActions.indexOf("async function blockContact");
  const follow = contactActions.slice(followStart, followEnd);
  assert.ok(followStart >= 0 && followEnd > followStart);
  assert.match(follow, /api\.refreshCloudRelationships\(\)/);
  assert.match(follow, /api\.setCloudFollow\(other\.id,/);
  assert.match(follow, /if \(!currentProfile \|\| !targetProfile\)/);
  assert.match(contactDetails, /toggleContactFollow\(ctx, other, me\)/);
});

test("contact detail shortcuts, conversation actions, and safety actions are wired", () => {
  for (const action of [
    'ctx.$("#profile-shortcut").onclick',
    'ctx.$("#search-shortcut").onclick',
    'ctx.$("#mute-shortcut").onclick',
    'ctx.$("#options-shortcut").onclick',
    'ctx.$("#media").onclick',
    'ctx.$("#details-dis").onclick',
    'ctx.$("#details-hide").onclick',
    'ctx.$("#block").onclick',
    'ctx.$("#report").onclick',
  ]) assert.ok(contactDetails.includes(action), action);
  assert.match(contactDetails, /bindShared\(ctx\)/);
  assert.match(contactDetails, /syncCloudChatState\(id, ctx\)/);
  assert.match(contactActions, /api\.replaceCloudBlocks/);
  assert.match(contactActions, /api\.submitCloudReport/);
});

test("follower and following totals accept cloud counts or local relationship lists", () => {
  const countHelper = chat.slice(chat.indexOf("function relationshipCount"), chat.indexOf("async function toggleContactFollow"));
  assert.match(countHelper, /Array\.isArray\(value\)/);
  assert.match(countHelper, /Number\(value\)/);
  assert.match(contactDetails, /relationshipCount\(other\.followers\)/);
  assert.match(contactDetails, /relationshipCount\(other\.following\)/);
});
