import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class Storage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

globalThis.localStorage = new Storage();
globalThis.sessionStorage = new Storage();
globalThis.window = { addEventListener() {}, dispatchEvent() {} };
sessionStorage.setItem("oldtime-cloud-session-v1", JSON.stringify({
  accessToken: "test-session",
  expiresAt: Date.now() + 10 * 60_000,
  account: { id: "cloud-owner" },
}));

let indexedDbReads = 0;
globalThis.indexedDB = {
  open() {
    indexedDbReads++;
    throw new Error("Device media should not be read.");
  },
};
let fetchHandler = async () => new Response(JSON.stringify({ error: "Cloud media is unavailable." }), {
  status: 404, headers: { "Content-Type": "application/json" },
});
globalThis.fetch = (...args) => fetchHandler(...args);

const { mediaUrl, putLocalMedia, invalidateMediaUrl, shouldRetryMediaUpload } = await import("./local-media.js");

test("unavailable cloud media never falls back to a device-only copy", async () => {
  await assert.rejects(
    () => mediaUrl("oldtime-media:8f6014c8-9bb0-4a25-a619-0a9b9d48f663"),
    /Cloud media is unavailable/,
  );
  assert.equal(indexedDbReads, 0);
});

test("cloud uploads do not depend on IndexedDB", async () => {
  const uploadCalls = [];
  fetchHandler = async (url, options) => {
    uploadCalls.push({ url: String(url), method: options?.method || "GET" });
    if (String(url).includes("/upload")) {
      return new Response(JSON.stringify({ ready: true }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Unexpected request." }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  };
  const uploaded = await putLocalMedia(new Blob(["new-media"], { type: "image/png" }));
  assert.match(uploaded, /^oldtime-media:[0-9a-f-]{36}$/i);
  assert.equal(uploadCalls.some(call => call.url.includes("/upload") && call.method === "POST"), true);
  assert.equal(indexedDbReads, 0);
});

test("Studio feed publishing reaches the shared publisher instead of an offline-only blocker", async () => {
  const source = await readFile(new URL("./creative-editor.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Studio feed media is not connected to Supabase yet/);
  assert.match(source, /await publishCreativeProject\(project, blobs/);
});

test("expired signed links can be renewed without device media", async () => {
  const reference = "oldtime-media:716c0eda-9860-4c35-bb40-6b5af8ea6270";
  let requests = 0;
  fetchHandler = async () => new Response(JSON.stringify({
    url: `https://media.example.test/signed-${++requests}`,
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  assert.equal(await mediaUrl(reference), "https://media.example.test/signed-1");
  assert.equal(await mediaUrl(reference), "https://media.example.test/signed-1");
  invalidateMediaUrl(reference);
  assert.equal(await mediaUrl(reference), "https://media.example.test/signed-2");
  assert.equal(indexedDbReads, 0);
});

test("quota-restricted media requests pause rather than refetching every tile", async () => {
  const now = Date.now;
  let time = now();
  let requests = 0;
  Date.now = () => time;
  fetchHandler = async () => {
    requests++;
    return new Response(JSON.stringify({ error: "Quota temporarily exceeded." }), {
      status: 402, headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await assert.rejects(() => mediaUrl("oldtime-media:56d726fe-0781-46bd-81df-b5abf553d119"), { status: 402 });
    await assert.rejects(() => mediaUrl("oldtime-media:e5c728ce-78eb-4164-ac47-98b7a143e555"), { status: 402 });
    assert.equal(requests, 1);
    time += 61_000;
    await assert.rejects(() => mediaUrl("oldtime-media:e5c728ce-78eb-4164-ac47-98b7a143e555"), { status: 402 });
    assert.equal(requests, 2);
    time += 61_000;
    fetchHandler = async () => {
      requests++;
      return new Response(JSON.stringify({ url: "https://media.example.test/recovered" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    };
    assert.equal(await mediaUrl("oldtime-media:e5c728ce-78eb-4164-ac47-98b7a143e555"), "https://media.example.test/recovered");
    assert.equal(requests, 3);
  } finally {
    Date.now = now;
  }
});

test("uploads do not retry quota, authentication, or rejected-size errors", () => {
  for (const status of [401, 402, 403, 413]) {
    assert.equal(shouldRetryMediaUpload({ originalResponse: { getStatus: () => status } }, 0, {}), false);
  }
  assert.equal(shouldRetryMediaUpload({ originalResponse: { getStatus: () => 503 } }, 0, {}), true);
});
