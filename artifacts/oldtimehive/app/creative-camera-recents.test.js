import test from "node:test";
import assert from "node:assert/strict";
import { boundedRecentPhotos, loadRecentPhotos, prepareRecentPhoto } from "./creative-camera-recents.js";
const row = (id, ownerId, createdAt, size = 3) => ({
  id, ownerId, createdAt, blob: { size }, thumbnail: { size: 1 },
});
test("recent photos belong to the current account and are newest first", () => {
  const records = [row("old", "a", 1), row("other", "b", 9), row("new", "a", 3)];
  assert.deepEqual(boundedRecentPhotos(records, "a").map(x=>x.id), ["new", "old"]);
  assert.equal(records[0].id, "old");
});
test("recents bound both count and byte storage without discarding originals", () => {
  const records = [row("new","a",3),row("middle","a",2),row("old","a",1)];
  assert.deepEqual(boundedRecentPhotos(records,"a",2,100).map(x=>x.id),["new","middle"]);
  assert.deepEqual(boundedRecentPhotos(records,"a",24,8).map(x=>x.id),["new","middle"]);
  assert.equal(records.length,3);
});
test("unavailable storage and non-photo inputs fail explicitly", async () => {
  await assert.rejects(loadRecentPhotos(""), /Sign in/);
  await assert.rejects(loadRecentPhotos("a"), /unavailable/);
  await assert.rejects(prepareRecentPhoto(new Blob(["video"],{type:"video/mp4"})), /Choose a photo/);
});
