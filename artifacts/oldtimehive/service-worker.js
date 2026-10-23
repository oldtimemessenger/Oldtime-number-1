// Build placeholders are filled by pwa-build.ts, including hashed JS/CSS names.
const BUILD_VERSION = "__BUILD_VERSION__";
const CACHE_NAME = `old-time-shell-${BUILD_VERSION}`;
const SHELL_FILES = ["__PRECACHE_FILES__"];
const SHELL_URLS = new Set(SHELL_FILES.map(path => new URL(path, self.registration.scope).href));
const INDEX_URL = new URL("./index.html", self.registration.scope).href;

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll([...SHELL_URLS])));
  // Do not forcibly replace the worker during an active edit or upload.
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith("old-time-shell-") && key !== CACHE_NAME)
        .map(key => caches.delete(key)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  // Private responses, API data, writes, and media uploads must never be cached.
  if (request.method !== "GET" || url.origin !== self.location.origin ||
      request.headers.has("Authorization") || /^\/api(?:\/|$)/.test(url.pathname)) return;
  if (request.mode === "navigate" &&
      (url.href.split("?")[0] === self.registration.scope || url.href.split("?")[0] === INDEX_URL)) {
    event.respondWith(fetch(request).catch(async () =>
      (await caches.match(INDEX_URL)) || Response.error()));
    return;
  }
  if (!SHELL_URLS.has(url.href)) return;
  event.respondWith(caches.match(request).then(response => response || fetch(request)));
});
