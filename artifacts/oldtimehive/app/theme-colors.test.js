import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const root = css.match(/:root\s*\{([\s\S]*?)\}/)[1];

test("ordinary screens use neutral light backgrounds and dark foregrounds", () => {
  assert.match(root, /--bg:\s*#ffffff;/);
  assert.match(root, /--panel:\s*#f2f3f5;/);
  assert.match(root, /--text:\s*#17191d;/);
  assert.match(css, /html, body, #app\s*\{[^}]*background:\s*var\(--bg\)/);
});

test("profile and existing white screens stay white", () => {
  for (const selector of ["profile-screen", "chat-list-screen", "account-settings-screen", "edit-profile-screen"]) {
    assert.match(css, new RegExp(`\\.${selector}\\s*\\{[^}]*background:\\s*#fff`));
  }
  assert.match(css, /\.profile-nav\s*\{[^}]*background:rgba\(255,255,255/);
  assert.match(css, /\.profile-topbar\s*\{[^}]*color:#fff/);
});

test("video feed foregrounds and bottom navigation remain readable over media", () => {
  assert.match(css, /\.clip\s*\{[^}]*color:#fff/);
  assert.match(css, /\.home-discovery-header\s*\{[^}]*color:#fff/);
  assert.match(css, /\.media-feed-phone > \.nav\s*\{[^}]*background:#090a0c/);
  assert.match(css, /\.media-feed-phone > \.nav button\.on\s*\{[^}]*color:#fff/);
  assert.match(app, /\$\{mediaFeedScreen \? "media-feed-phone" : ""\}/);
});

test("the Create sheet and fields use separate neutral light surfaces", () => {
  assert.match(css, /\.panel\s*\{[^}]*background:\s*var\(--panel\)/);
  assert.match(css, /\.field\s*\{[^}]*background:\s*#f2f3f5[^}]*color:var\(--text\)/);
  assert.match(css, /\.seg button\.on\s*\{[^}]*color:\s*#fff/);
  assert.doesNotMatch(root, /#151c1b|#202a28|#263330/);
});
