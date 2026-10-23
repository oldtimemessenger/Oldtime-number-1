import test from "node:test";
import assert from "node:assert/strict";
import { publishRenderedPost, originalPublicationMedia } from "./media-publication.js";

test("an unchanged video uploads its original bytes; edits cannot bypass rendering", () => {
  const blob = new Blob(["original-video"], { type: "video/mp4" });
  const blobs = new Map([["source", blob]]);
  const asset = { videoWidth: 1080, videoHeight: 1920 };
  const project = { width: 1080, height: 1920, duration: 10, layers: [],
    background: { kind: "video", media: "source", videoEdit: { sourceDuration: 10, clips: [{ in: 0, out: 10, speed: 1 }] } } };
  assert.equal(originalPublicationMedia(project, blobs, asset), blob);
  for (const modify of [
    value => { value.layers.push({ kind: "text" }); },
    value => { value.background.mirror = true; },
    value => { value.background.crop = { x: .1, y: 0, width: .9, height: 1 }; },
    value => { value.background.adjustments = { brightness: 120 }; },
    value => { value.background.videoEdit.clips[0].speed = 2; },
    value => { value.background.videoEdit.clips[0].in = 1; },
    value => { value.width = 1920; value.height = 1080; },
  ]) {
    const edited = structuredClone(project); modify(edited);
    assert.equal(originalPublicationMedia(edited, blobs, asset), null);
  }
});

test("rendered image compositions attach confirmed media to a real feed post", async () => {
  const blobs = [new Blob(["edited-photo"], { type: "image/png" }), new Blob(["second"], { type: "image/png" })];
  const ids = ["9f4decc0-446d-41be-96dd-1e0c792a8ec1", "9f4decc0-446d-41be-96dd-1e0c792a8ec2"];
  const seen = [];
  const result = await publishRenderedPost({ blobs, active: () => true, text: "Caption", visibility: "public", place: null,
    upload: async blob => { seen.push(await blob.text()); return `oldtime-media:${ids[seen.length - 1]}`; },
    createPost: async (text, fields) => { assert.equal(text, "Caption"); assert.deepEqual(fields.mediaIds, ids); return { id: "post", ...fields }; } });
  assert.deepEqual(seen, ["edited-photo", "second"]);
  assert.equal(result.id, "post");
});
test("resumable upload progress is forwarded per rendered attachment", async () => {
  const ids = ["9f4decc0-446d-41be-96dd-1e0c792a8ec1", "9f4decc0-446d-41be-96dd-1e0c792a8ec2"];
  const progress = [];
  let uploadIndex = 0;
  await publishRenderedPost({
    blobs: [new Blob(["first"]), new Blob(["second"])],
    active: () => true,
    onProgress: value => progress.push(value),
    upload: async (_blob, onProgress) => {
      onProgress(.5);
      return `oldtime-media:${ids[uploadIndex++]}`;
    },
    createPost: async (_text, fields) => fields,
  });
  assert.deepEqual(progress, [
    { fraction: .5, index: 0, total: 2 },
    { fraction: .5, index: 1, total: 2 },
  ]);
});
test("failed uploads and ended sessions cannot publish text-only substitutes", async () => {
  let published = false;
  const options = { blobs: [new Blob(["media"])], active: () => true, createPost: () => { published = true; } };
  await assert.rejects(publishRenderedPost({ ...options, upload: async () => { throw new Error("Upload interrupted"); } }), /interrupted/);
  let active = true;
  await assert.rejects(publishRenderedPost({ ...options, active: () => active, upload: async () => {
    active = false; return "oldtime-media:9f4decc0-446d-41be-96dd-1e0c792a8ec1";
  } }), /session/);
  assert.equal(published, false);
});
test("empty rendered output cannot become an invisible text post", async () => {
  await assert.rejects(publishRenderedPost({ blobs: [], active: () => true }), /empty/);
});
