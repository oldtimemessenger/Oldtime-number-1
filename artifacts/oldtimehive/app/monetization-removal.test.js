import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { renderBlastSettingsDrawer } from "./blast-settings-drawer.js";
import { renderBlastInfo } from "./blast-info.js";

const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const ctx = {
  esc: value => String(value),
  icon: name => `<svg data-icon="${name}"></svg>`,
  page: (title, body) => `<main><h1>${title}</h1>${body}</main>`
};

test("Blast drawer retains social and information links without paid features", () => {
  const html = renderBlastSettingsDrawer(ctx);
  for (const view of ["friends", "guidelines", "privacy"]) {
    assert.match(html, new RegExp(`data-blast-nav="${view}"`));
  }
  assert.doesNotMatch(html, /gifts|coins|membership|badge|revenue|payout|preferences/i);
  assert.match(html, /role="dialog"/);
  assert.match(html, /data-blast-drawer-close/);
});

test("guidelines and privacy still render without monetization notices", () => {
  const guidelines = renderBlastInfo({ name: "guidelines" }, ctx);
  const privacy = renderBlastInfo({ name: "privacy" }, ctx);
  assert.match(guidelines, /Community guidelines/);
  assert.match(guidelines, /Respect &amp; Safety/);
  assert.match(privacy, /Privacy summary/);
  assert.match(privacy, /Only me posts stay private/);
  assert.doesNotMatch(guidelines + privacy, /gifts|coins|checkout|payout|blue badge|subscriptions/i);
});

test("removed purchase code has no remaining UI entry points", () => {
  assert.equal(existsSync(new URL("./blast-monetization.js", import.meta.url)), false);
  const source = ["app.js", "blast.js", "blast-store.js", "blast.css"].map(read).join("\n");
  assert.doesNotMatch(source, /blast-monetization|pmembership|openCreatorMembership|\/api\/memberships|renderBlastMoney|bindBlastMoney|topUpBlastCoins|sendBlastGift|requestBlastPayout|membership-|blast-wallet|blast-coin|blast-gift/);
});

test("Blast opens the unified community and notes experience and binds its screens", () => {
  const source = read("blast.js");
  assert.match(source, /let activeView = \{ name: "notes" \}/);
  assert.match(source, /social\.bindBlastSocial/);
  assert.match(source, /notes\.bindBlastVideoNotes/);
  assert.match(source, /composer\.bindBlastNoteComposer/);
  assert.ok(source.includes('const requested = next?.name === "hub" ? { name: "notes" } : next;'));
  assert.ok(source.includes('includes(requested?.name) ? requested : { name: "notes" };'));
  assert.match(source, /setBlastView\(nextView\)/);
});
