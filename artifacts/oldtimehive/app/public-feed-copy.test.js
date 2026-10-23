import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");

test("internal post migration notices and controls are absent from public screens", () => {
  assert.doesNotMatch(app, /Device post migration|Retry text-post upload|cloud-post-migration|migrationMessages|migrationNotice/);
});

test("public screens do not include extra device-storage or sync notices", () => {
  const files = [
    "app.js", "blast-video-note-view.js", "blast-video-note-composer.js",
    "blast-settings-drawer.js", "blast-social.js", "blast-info.js",
    "experiences.js", "comms/index.js", "chat.js"
  ];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /bvn-device-note|bvn-settings-device|bvn-settings-footnote|stay[s]? on this device|saved on this device|not sync|not synced|device-local draft|secure server-side wallet|occurs in this build|Share a short camera note|Send a video note to start this conversation/i, file);
  }
});
