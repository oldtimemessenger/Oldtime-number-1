import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

test("service worker ignores API responses, authenticated requests, writes and unknown media", () => {
  const events = {};
  const source = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8")
    .replace('"__BUILD_VERSION__"', '"test"')
    .replace('["__PRECACHE_FILES__"]', '["./index.html","./assets/app-test.js"]');
  vm.runInNewContext(source, {
    self: { registration: { scope: "https://example.test/" }, location: { origin: "https://example.test" },
      addEventListener: (name, handler) => { events[name] = handler; } },
    URL, Set, Response,
    caches: { match: async () => new Response("cached public asset") },
  });
  for (const request of [
    new Request("https://example.test/api/feed"),
    new Request("https://example.test/api"),
    new Request("https://example.test/assets/app-test.js", { headers: { Authorization: "Bearer test-only" } }),
    new Request("https://example.test/assets/app-test.js", { method: "POST", body: "fixture" }),
    new Request("https://example.test/private-photo.jpg"),
    new Request("https://foreign.test/assets/app-test.js"),
  ]) {
    events.fetch({ request, respondWith: () => assert.fail("Private or unrelated resource was intercepted") });
  }
  let cached = false;
  events.fetch({ request: new Request("https://example.test/assets/app-test.js"),
    respondWith: () => { cached = true; } });
  assert.equal(cached, true);
});
