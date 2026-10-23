import test from "node:test";
import assert from "node:assert/strict";
import { defaultRemixState, applyLayout, snapLayer, layerBounds, drawRemix } from "./remix-compositor.js";
import { foregroundConfidence, resampleConfidence, refineMatte } from "./remix-matte.js";
import { renderAudioPanel, renderRemixStudio } from "./audio-remix-view.js";

class Storage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
globalThis.localStorage = new Storage(); globalThis.sessionStorage = new Storage();
globalThis.window = { addEventListener() {}, dispatchEvent() {} };
localStorage.setItem("oldtime-v1", JSON.stringify({
  session: "creator", users: ["creator", "viewer"].map(id => ({ id, name: id, username: id, followers: [], following: [], friends: [], closeFriends: [], private: false })),
  posts: [{ id: "source", author: "creator", kind: "video", sound: "City Loop", media: ["data:video/webm;base64,test"], visibility: "public", saves: [], likes: [], comments: [] }]
}));
const { api, mutate } = await import("./store.js");
const { audioSource, audioTitle, savedAudio, audioSaved, saveAudio, removeSavedAudio, audioUses } = await import("./audio-library.js");

test("audio library stores account-private references, persists, and supports removal", () => {
  const source = api.post("source");
  saveAudio(source);
  assert.equal(audioSaved(source), true);
  assert.equal(savedAudio()[0].title, "City Loop");
  assert.equal(audioTitle(source), "City Loop");
  assert.deepEqual(JSON.parse(localStorage.getItem("oldtime-v1")).users[0].savedAudioIds, ["source"]);
  mutate(db => { db.session = "viewer"; });
  assert.deepEqual(savedAudio(), []);
  saveAudio(source);
  mutate(db => { db.session = "creator"; });
  removeSavedAudio("source");
  assert.deepEqual(savedAudio(), []);
  mutate(db => { db.session = "viewer"; });
  assert.equal(savedAudio().length, 1);
});
test("reuse, remixes, and saved audio cannot bypass source deletion or privacy", () => {
  mutate(db => db.posts.push({ id: "remix", author: "viewer", kind: "video", media: ["data:video/webm;base64,new"], audioSourcePostId: "source", remixOf: "source", visibility: "public", saves: [], likes: [], comments: [] }));
  assert.equal(audioSource(api.post("remix")).id, "source");
  assert.equal(audioUses(api.post("source")), 2);
  mutate(db => { db.posts[0].visibility = "only-me"; });
  assert.equal(api.canSeePost(api.post("remix")), false);
  assert.equal(audioSource(api.post("remix")), null);
  assert.deepEqual(savedAudio(), []);
  assert.throws(() => saveAudio(api.post("remix")), /unavailable/);
  mutate(db => { db.session = "creator"; db.posts[0].visibility = "public"; db.posts[1].audioSourcePostId = "remix"; });
  assert.equal(api.canSeePost(api.post("remix")), false, "circular references fail closed");
  mutate(db => { db.posts[1].audioSourcePostId = "source"; db.posts = db.posts.filter(post => post.id !== "source"); });
  assert.equal(api.canSeePost(api.post("remix")), false);
});
test("split divider, freeform, cutout layouts, and all snap targets have real geometry", () => {
  const state = defaultRemixState();
  assert.equal(state.layout, "cutout");
  assert.equal(state.cutout, true);
  assert.equal(state.layers.original.size, 100);
  applyLayout(state, "split");
  state.divider = 30;
  assert.deepEqual(layerBounds(state, "original", 100, 200), { x: 0, y: 0, width: 30, height: 200 });
  assert.equal(layerBounds(state, "me", 100, 200).width, 70);
  applyLayout(state, "floating");
  assert.equal(state.layers.original.size, 100);
  assert.equal(state.cutout, false);
  assert.equal(state.layers.me.size, 58);
  applyLayout(state, "background");
  assert.equal(state.layers.me.size, 58);
  assert.equal(state.cutout, true);
  assert.equal(state.layers.me.border, "none");
  const layer = { size: 20, x: 0, y: 0 };
  for (const [position, x, y] of [["top-left", 13, 13], ["top", 50, 13], ["top-right", 87, 13], ["left", 13, 50], ["center", 50, 50], ["right", 87, 50], ["bottom-left", 13, 87], ["bottom", 50, 87], ["bottom-right", 87, 87]]) {
    snapLayer(layer, position); assert.equal(layer.x, x); assert.equal(layer.y, y);
  }
  applyLayout(state, "solo");
  assert.equal(layerBounds(state, "original", 100, 200), null);
  assert.throws(() => applyLayout(state, "bad"), /layout/);
});
test("selfie foreground confidence keeps the PERSON, not an inverted camera background", () => {
  const mask = { width: 3, height: 1, getAsFloat32Array: () => new Float32Array([0, 1, 0]) };
  const foreground = foregroundConfidence([mask], ["selfie"]);
  const confidence = resampleConfidence(foreground, 3, 1);
  const rgba = new Uint8ClampedArray([10, 40, 80, 255, 190, 130, 90, 255, 10, 40, 80, 255]);
  refineMatte(rgba, confidence, 3, 1);
  assert.equal(rgba[3], 0);
  assert.equal(rgba[7], 255, "centre person stays visible");
  assert.equal(rgba[11], 0, "camera background disappears");
  assert.deepEqual([...rgba.slice(4, 7)], [190, 130, 90], "opaque subject stays sharp and unchanged");
});
test("matte creates a soft, narrow contour, preserves interiors, and gates temporal smoothing on motion", () => {
  const width = 11, confidence = new Float32Array([0, 0, 0, .1, .3, .5, .7, .9, 1, 1, 1]);
  const frame = () => new Uint8ClampedArray(Array.from({ length: width }, () => [130, 110, 90, 255]).flat());
  const rgba = frame(), old = refineMatte(rgba, confidence, width, 1);
  const soft = old.alpha.filter(a => a > 0 && a < 1);
  assert.ok(soft.length >= 1 && soft.length <= 3);
  assert.deepEqual([...rgba.slice(32, 35)], [130, 110, 90]);
  const changed = confidence.slice(); changed[5] = .52;
  const stable = refineMatte(frame(), changed, width, 1, old);
  const fresh = refineMatte(frame(), changed, width, 1);
  assert.ok(Math.abs(stable.alpha[5] - old.alpha[5]) < Math.abs(fresh.alpha[5] - old.alpha[5]));
  const movingFrame = frame(); movingFrame.fill(230);
  const moving = refineMatte(movingFrame, changed, width, 1, old);
  const movingFresh = refineMatte(movingFrame.slice(), changed, width, 1);
  assert.equal(moving.alpha[5], movingFresh.alpha[5], "moving edges do not inherit stale opacity");
});
test("all foreground modes draw the original scene underneath Me; cutout has no frame or cropped hands", () => {
  const drawOrder = [], strokes = [], scales = [];
  const ctx = new Proxy({ drawImage: (source, ...args) => { drawOrder.push(source.name); scales.push(args); }, stroke: () => strokes.push(true) }, { get: (obj, key) => obj[key] || (() => {}) });
  const canvas = { width: 100, height: 200, getContext: () => ctx };
  const original = { name: "scene", width: 100, height: 200 }, me = { name: "person", width: 100, height: 100 };
  const state = defaultRemixState();
  state.layers.me.border = "glow"; state.layers.me.shape = "circle";
  drawRemix(canvas, state, original, me, { frame: () => me });
  assert.deepEqual(drawOrder, ["scene", "person"]);
  assert.equal(strokes.length, 0, "no fake contour outline");
  assert.equal(scales[1][2], scales[1][3], "square subject stays square instead of cover-cropping");
  drawOrder.length = 0;
  applyLayout(state, "floating"); drawRemix(canvas, state, original, me);
  assert.deepEqual(drawOrder, ["scene", "person"], "Floating must never put the original on top of my camera");
});
test("audio and studio renderers escape data and expose real controls, not global destinations", () => {
  const panel = renderAudioPanel({ post: { id: "safe", kind: "video", soundTitle: '<script>alert("x")</script>' }, library: [{ id: "track", title: '"track"', author: "A" }] });
  assert.ok(panel.includes("&lt;script&gt;"));
  assert.ok(panel.includes('data-audio-library="track"'));
  assert.ok(panel.includes("data-audio-reuse"));
  const studio = renderRemixStudio({ mode: "reuse" });
  assert.ok(studio.includes('value="solo"'));
  assert.ok(studio.includes('id="studio-cutout"'));
  assert.match(studio, /id="studio-publish"[^>]*disabled/);
});
