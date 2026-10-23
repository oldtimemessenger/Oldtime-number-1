import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("feed, profile, and chat media are lazy rather than eagerly fetched", async () => {
  const [app, chat, loader, styles] = await Promise.all([
    readFile(new URL("./app.js", import.meta.url), "utf8"),
    readFile(new URL("./chat.js", import.meta.url), "utf8"),
    readFile(new URL("./local-media.js", import.meta.url), "utf8"),
    readFile(new URL("./styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(app, /loop playsinline preload="none"/);
  assert.match(app, /loading="lazy" decoding="async"/);
  assert.match(app, /muted playsinline preload="none"/);
  assert.match(chat, /controls playsinline preload="none"/);
  assert.match(loader, /rootMargin: "80px 0px"/);
  assert.match(loader, /element\.preload = "none"/);
  assert.doesNotMatch(loader, /element\.preload = .*"metadata"/);
  assert.match(loader, /element\.fetchPriority = rect\.bottom > 0 && rect\.top < window\.innerHeight \? "high" : "low"/);
  assert.match(loader, /const profileAvatar = element\.matches\("\.profile-avatar, \.story-avatar-action img, \.ring img"\)/);
  assert.match(loader, /if \(element\.tagName === "IMG" \|\| element\.tagName === "VIDEO"\) element\.hidden = true/);
  assert.match(loader, /element\.hidden = false;\s*element\.classList\.remove\("media-load-failed"\)/);
  assert.match(loader, /local-media-unavailable--cover/);
  assert.match(styles, /\.profile-cover > \.local-media-unavailable--cover\s*\{[^}]*position:absolute/);
  assert.match(styles, /\.profile-cover > img\.media-load-failed\s*\{\s*visibility:hidden/);
});

test("story rings and failed album media stay within their compact boxes", async () => {
  const [styles, collections, loader] = await Promise.all([
    readFile(new URL("./styles.css", import.meta.url), "utf8"),
    readFile(new URL("./profile-presentations.css", import.meta.url), "utf8"),
    readFile(new URL("./local-media.js", import.meta.url), "utf8"),
  ]);
  assert.match(styles, /\.story-avatar-action \.ring\s*\{[^}]*display:block;[^}]*box-sizing:border-box;[^}]*overflow:hidden/);
  assert.match(styles, /\.story-avatar-action \.ring img\s*\{[^}]*display:block;[^}]*box-sizing:border-box/);
  assert.match(collections, /\.ot-collection-tile \.media-load-failed\s*\{\s*display:none/);
  assert.match(collections, /\.ot-collection-tile \.local-media-unavailable > span\s*\{[^}]*position:static;[^}]*max-width:100%;[^}]*overflow:hidden/);
  assert.match(loader, /if \(cardThumb\) \{\s*notice\.append\(text\);/);
  assert.match(styles, /\.profile-cover > \.local-media-unavailable--cover\s*\{[^}]*top:calc\(max\(12px, env\(safe-area-inset-top, 0px\)\) \+ 50px\);[^}]*bottom:auto/);
});
