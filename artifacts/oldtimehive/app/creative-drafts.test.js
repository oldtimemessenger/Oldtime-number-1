import test from "node:test";
import assert from "node:assert/strict";
import { prepareCloudCreativeDraft, prepareCreativeDraft, restoreCreativeDraft, saveCreativeDraft } from "./creative-drafts.js";

test("draft media survives revoked URLs, including pages, Quote return and Carousel shots", async () => {
  const blob = new Blob(["original photo bytes"], { type: "image/png" });
  const video = new Blob(["original video bytes"], { type: "video/webm" });
  const project = { background: { kind: "video", media: "blob:video", videoEdit: { speed: .5 } },
    layers: [{ kind: "text", text: "Keep my quote", x: .25 }, { kind: "image", media: "blob:photo" }],
    pages: [{ background: { kind: "photo", media: "blob:photo" }, layers: [] }] };
  const state = { caption: "Saved caption", visibility: "close-friends", workspace: "studio",
    quoteReturn: { project: { background: { media: "blob:photo" }, layers: [] } },
    capture: { mode: "carousel", shots: [{ media: "blob:photo", scene: { background: { media: "blob:photo" } } }] } };
  const saved = prepareCreativeDraft(project, state, new Map([["blob:photo", blob], ["blob:video", video],
    ["blob:unused", new Blob(["unused"])] ]));
  assert.equal(saved.media.length, 2, "only referenced bytes are stored");
  assert.equal(project.background.media, "blob:video", "saving does not mutate the open editor");
  let count = 0;
  const reopened = restoreCreativeDraft(structuredClone(saved), () => `blob:restored-${++count}`);
  assert.equal(reopened.project.layers[0].text, "Keep my quote");
  assert.equal(reopened.project.background.videoEdit.speed, .5);
  assert.equal(reopened.project.background.media, "blob:restored-1");
  assert.equal(reopened.project.pages[0].background.media, reopened.project.layers[1].media);
  assert.equal(reopened.state.quoteReturn.project.background.media, reopened.project.layers[1].media);
  assert.equal(reopened.state.capture.shots[0].scene.background.media, reopened.project.layers[1].media);
  assert.equal(reopened.state.caption, "Saved caption");
  assert.equal(reopened.state.visibility, "close-friends");
  assert.equal(await saved.media[0][1].text(), "original video bytes");
});

test("missing media fails explicitly instead of saving a broken draft", () => {
  assert.throws(() => prepareCreativeDraft({ background: { media: "blob:lost" } }, {}, new Map()), /Upload it again/);
  assert.throws(() => prepareCreativeDraft({ background: { media: "live-camera" } }, {}, new Map()), /Capture your photo/);
  assert.throws(() => restoreCreativeDraft({ version: 1, project: { background: { media: "blob:lost" } }, media: [] }, () => ""), /unavailable/);
});

test("durable local-media handles and source links remain intact", () => {
  const project = { background: { media: "oldtime-media:existing" }, layers: [
    { kind: "comment", source: { postId: "original-post", commentId: "comment" } }] };
  const reopened = restoreCreativeDraft(prepareCreativeDraft(project, {}, new Map()), () => assert.fail("no new blob"));
  assert.deepEqual(reopened.project, project);
});

test("draft packaging uploads referenced bytes and stores only cloud media references", async () => {
  const mediaId = "123e4567-e89b-12d3-a456-426614174000";
  const source = new Blob(["photo bytes"], { type: "image/png" });
  const draft = prepareCreativeDraft({ background: { media: "blob:photo" }, layers: [] }, {}, new Map([["blob:photo", source]]));
  const stored = await prepareCloudCreativeDraft(draft, async blob => {
    assert.equal(await blob.text(), "photo bytes");
    return `oldtime-media:${mediaId}`;
  });
  assert.equal(stored.project.background.media, `oldtime-media:${mediaId}`);
  assert.deepEqual(stored.media, [`oldtime-media:${mediaId}`]);
  assert.doesNotMatch(JSON.stringify(stored), /blob:|data:image/);
});

test("draft save requires a cloud account and never writes a new device draft", async () => {
  await assert.rejects(saveCreativeDraft("owner", "create:camera", {}), /Sign in to your account/);
});
