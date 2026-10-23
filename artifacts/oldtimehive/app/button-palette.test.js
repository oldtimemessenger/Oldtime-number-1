import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./button-palette.css", import.meta.url), "utf8");
const token = name => css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{3,6})`, "i"))[1].toLowerCase();
const lum = hex => { const h = hex.length === 4 ? [...hex.slice(1)].map(c => c + c).join("") : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };

test("button label pairs meet 4.5:1", () => {
  for (const [bg, fg] of [["bp-neutral", "bp-neutral-on"], ["bp-black", "bp-black-on"], ["bp-orange", "bp-orange-on"], ["bp-orange-press", "bp-orange-on"], ["bp-disabled-bg", "bp-disabled-ink"]])
    assert.ok(ratio(token(bg), token(fg)) >= 4.5, `${bg}/${fg}`);
  assert.ok(ratio(token("bp-soft"), "#15171b") >= 4.5, "soft on dark chrome");
  assert.ok(ratio(token("bp-orange"), "#ffffff") >= 4.5, "orange on light chrome");
});
test("primary actions use solid glossy red with white text and no glass or blur", () => {
  assert.doesNotMatch(css, /backdrop-filter|@supports|rgba\(255,\s*210/i);
  assert.ok(ratio(token("bp-orange"), "#ffffff") >= 4.5);
  assert.ok(ratio("#12458f", "#ffffff") >= 4.5);
});
test("login is predominantly red with neutral controls and the smaller supplied logo", () => {
  const auth = readFileSync(new URL("./auth-brand.css", import.meta.url), "utf8");
  assert.match(auth, /background:#990000/);
  assert.match(auth, /aspect-ratio:845\/1024/); assert.match(auth, /object-fit:contain/); assert.match(auth,/background:transparent/);
  assert.ok(ratio("#ffffff","#161823")>=4.5);
  for(const ink of ["#ffffff","#e7e7e9"]) assert.ok(ratio("#990000",ink)>=4.5);
  assert.doesNotMatch(auth,/mask-image/);
  assert.match(auth,/width:min\(88px,24vw\)/);
  assert.match(auth,/align-self:center/);
  assert.match(readFileSync(new URL("./app.js", import.meta.url), "utf8"), /brand\/oldtime-login-red\.png/);
  assert.doesNotMatch(css,/#12458f|#0d3470|#8fb4f0/);
});
test("brand red is reserved for primary actions while black stays the secondary accent", () => {
  assert.equal(token("bp-orange"), "#d51f32");
  assert.equal(token("accent-gold"), "#0f1419");
  assert.equal(token("brand-red"),token("bp-orange"));
  assert.match(css,/linear-gradient\(180deg,#ed3545 0%,var\(--bp-orange\) 100%\)/);
});
test("transparent gallery glyph and strip are not repainted by the palette", () => {
  assert.doesNotMatch(css, /ce-camera-gallery-slot[^{]*\{[^}]*background/);
  assert.doesNotMatch(css, /\.ce-strip-upload\s*\{[^}]*background/);
  assert.doesNotMatch(css, /(^|\n)\s*(button|\.creative-editor button|\[type=button\])\s*[,{]/);
});
test("feature controls and legacy color aliases use the shared app palette",()=>{
  assert.equal(token("brand-red"),token("bp-orange"));
  for(const selector of [".audio-panel .ap-primary",".settings-save-bar > button",".phone .blast-screen .blast-primary",".bvn-editor-screen .bvn-share-submit",".ct-btn:not(.ghost)",".ap-btn:not(.ghost)"]) assert.ok(css.includes(selector),selector);
  assert.match(css,/background:linear-gradient\(180deg,#ed3545 0%,var\(--bp-orange\) 100%\)!important; color:#fff!important/);
  assert.match(css,/\.account-settings-screen \.settings-content \.btn\.ghost\s*\{[^}]*var\(--bp-neutral\)!important/);
  assert.match(css,/\.blast-screen \.blast-primary:disabled/);
});

test("feed actions use neutral outlines, pink likes, blue saves, and neutral repost states", () => {
  assert.equal(token("bp-orange"), "#d51f32");
  const ci = readFileSync(new URL("./compact-interface.css", import.meta.url), "utf8");
  const feed = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(ci, /--feed-action:#536471/);
  assert.match(ci, /--feed-like:#e0245e/);
  assert.match(ci, /--feed-save:#1d9bf0/);
  assert.match(ci, /--feed-repost:#536471/);
  assert.match(feed, /button\.is-active\[data-like\]\s*\{\s*color:#e0245e/);
  assert.match(feed, /button\.is-active\[data-save\]\s*\{\s*color:#1d9bf0/);
  assert.match(feed, /button\.is-active\[data-repost\]\s*\{\s*color:#536471/);
  assert.match(feed, /community-feed-tabs button\.on::after[^}]*background:#0f1419/);
  assert.ok(feed.includes("background:#f8f9fb"), "posts use a subtle gray surface");
  assert.ok(feed.includes("grid-template-columns:repeat(5,minmax(0,1fr))"), "post actions keep evenly aligned positions without a Remix badge");
  assert.ok(feed.includes("margin:5px 0 0 47px"), "actions align with the post text rather than the avatar");
  assert.match(ci, /--notification-accent:#f4212e/);
  assert.match(ci, /--serif: var\(--font\)/);
  assert.doesNotMatch(ci, /Fraunces/);
  assert.ok(ratio("#f4212e", "#ffffff") >= 3.5);
});

test("feed social icons share a rounded outline style, with fill only for selected states", () => {
  const icons = readFileSync(new URL("./icons.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const liveView = readFileSync(new URL("./live-view.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(icons, /export function icon\(name, filled = false, strokeWidth = 1\.8\)/);
  assert.match(icons, /icons\.commentFilled = icon\("comment"\)/);
  assert.match(icons, /icons\.repost = icon\("repost"\)/);
  assert.match(icons, /icons\.share = icon\("share"\)/);
  assert.match(icons, /share: '<path d="M13\.5 4\.5 21 12l-7\.5 7\.5v-4\.8c-4\.8 0-8 1\.5-10 5\.3\.5-6\.7 3\.8-10\.2 10-10\.2V4\.5Z"\/>'/);
  assert.match(liveView, /import \{ icons as appIcons \} from "\.\/icons\.js";/);
  assert.match(liveView, /data-share aria-label="Share Live">\$\{appIcons\.share\}/);
  assert.doesNotMatch(liveView, /share: '<path/);
  assert.ok(app.includes("${ic.share}"), "app share actions use the shared outline icon");
  assert.ok(app.includes("${liked ? ic.heartOn : ic.heart}"), "unliked posts use the same outline heart as the reference");
  assert.match(app, /data-save="\$\{p\.id\}"[^>]*aria-pressed="\$\{saved\}"[^>]*>\$\{saved \? ic\.bookmarkOn : ic\.bookmark\}<span class="act-count">\$\{fmt\(saveCount\)\}/);
  assert.match(styles, /#feed \.clip:not\(\.post-detail\) \.rail \.act-count/);
  assert.match(styles, /#feed \.clip:not\(\.post-detail\) \.rail \.act\[data-save\]\.on \{ color:#fff; \}/);
  assert.match(styles, /#feed \.clip:not\(\.post-detail\) \.rail \.act-label \{ color:#fff!important/);
});
