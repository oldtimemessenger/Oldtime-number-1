import test from "node:test";
import assert from "node:assert/strict";
import { promoteCloudMediaSources } from "./local-media.js";

function image(reference) {
  const attributes = new Map([["src", reference]]);
  return {
    dataset: {}, getAttribute: key => attributes.get(key),
    removeAttribute: key => attributes.delete(key),
    matches: selector => selector.includes('src^="oldtime-media:"') && reference.startsWith("oldtime-media:"),
    querySelectorAll: () => [],
  };
}
test("cloud avatars and inline media use the authenticated loader instead of an invalid URL scheme", () => {
  const element = image("oldtime-media:56c759e4-fc7b-478a-82dd-e006849d4ed0");
  promoteCloudMediaSources(element);
  assert.equal(element.getAttribute("src"), undefined);
  assert.equal(element.dataset.localMedia, "oldtime-media:56c759e4-fc7b-478a-82dd-e006849d4ed0");
  assert.equal(element.dataset.loadedMedia, "");
});
test("ordinary bundled and HTTPS images retain their source", () => {
  for (const reference of ["/brand/avatars/blue.svg", "https://example.test/image.png"]) {
    const element = image(reference);
    promoteCloudMediaSources(element);
    assert.equal(element.getAttribute("src"), reference);
    assert.equal(element.dataset.localMedia, undefined);
  }
});
