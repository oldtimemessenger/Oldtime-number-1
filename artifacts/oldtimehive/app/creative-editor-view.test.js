import test from "node:test";
import assert from "node:assert/strict";
import { renderCreativeEditor } from "./creative-editor-view.js";

const ids = html => [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);

test("editor view keeps its camera controls but exposes no draft action", () => {
  const html = renderCreativeEditor(), foundIds = ids(html);
  assert.equal(foundIds.length, new Set(foundIds).size);
  for (const id of ["ce-shutter", "ce-photo", "ce-record", "ce-flash", "ce-camera-gallery-slot", "ce-publish", "ce-upload"]) {
    assert.ok(foundIds.includes(id), id);
  }
  for (const destination of ["feed", "story", "close-friends"]) {
    assert.match(html, new RegExp(`data-ce-share-destination="${destination}"`));
  }
  assert.doesNotMatch(html, /is-create-v2|data-ce-rail=|id="ce-next-action"/);
  assert.doesNotMatch(html, /Filters|ce-filter-button|ce-crop-overlay|Crop \/ Reframe/i);
  assert.doesNotMatch(html, /ce-save-exit|ce-exit-save|Save &amp; Exit|draft restored/i);
});

test("new Create preview has the single-screen tools and destinations", () => {
  const html = renderCreativeEditor({ editorVersion: "v2" }), foundIds = ids(html);
  assert.equal(foundIds.length, new Set(foundIds).size);
  for (const tool of ["text", "templates", "stickers", "overlay", "remove-bg", "canvas-color", "layers", "caption", "more", "draw", "trim"]) {
    assert.match(html, new RegExp(`data-ce-rail="${tool}"`));
  }
  assert.match(html, /data-ce-share-destination="feed"/);
  for (const visibility of ["public", "friends"]) {
    assert.match(html, new RegExp(`data-ce-feed-visibility="${visibility}"`));
  }
  assert.match(html, /id="ce-caption"/);
  assert.match(html, /data-ce-share-destination="feed"[^>]*>Main Feed/);
  assert.match(html, /data-ce-share-destination="story"[^>]*>Story/);
  assert.match(html, /data-ce-share-destination="close-friends"[^>]*>Close Friends/);
  assert.match(html, /id="ce-next-action"/);
  assert.match(html, /aria-label="Share"/);
  assert.match(html, /id="ce-empty-camera"/);
  assert.match(html, /id="ce-empty-upload"/);
  assert.match(html, /id="ce-empty-text"/);
  assert.match(html, /id="ce-sound-chip"/);
  assert.match(html, /id="ce-sound-upload"/);
  assert.match(html, /<option value="story"/);
  assert.doesNotMatch(html, /ce-save-exit|ce-exit-save|Save &amp; Exit|draft restored/i);
  for (const preset of ["plain", "editorial", "neon", "outline", "echo", "chrome", "gold", "extruded"]) {
    assert.match(html, new RegExp(`data-ce-text-preset="${preset}"`));
  }
  assert.doesNotMatch(html, /Filters|ce-filter-button|ce-crop-overlay|Crop \/ Reframe/i);
});

test("Story preview uses Story audiences rather than post visibility labels", () => {
  const html = renderCreativeEditor({ editorVersion: "v2", destination: "story" });
  assert.match(html, /data-ce-share-destination="story"[^>]*>Story/);
  assert.match(html, /data-ce-share-destination="close-friends"[^>]*>Close Friends/);
  assert.doesNotMatch(html, /data-ce-feed-visibility="friends"[^>]*>Friends &amp; Followers/);
});
