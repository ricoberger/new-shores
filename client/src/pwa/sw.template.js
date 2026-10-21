// New Shores service worker: caches the app shell only (ARCHITECTURE §5;
// the game requires connectivity). Generated into dist/sw.js by the
// build (vite.config.ts) with the shell file list and a version.
//
// - Precaches the shell at install; cache-first for the shell's files
//   (hashed assets, manifest, icons), network-first with the cached
//   index.html as fallback for navigations.
// - Never intercepts /api/ (HTTP or WebSocket), other origins or non-GET
//   requests: the API is always the network's, so "Server unreachable"
//   is what the player sees without connectivity.
// - A new version waits until the page approves (SKIP_WAITING message);
//   old caches are deleted on activate.
/* global self, caches, fetch, URL */
const VERSION = "__SW_VERSION__";
const SHELL = __SW_SHELL__;
const PREFIX = "new-shores-shell-";
const CACHE = PREFIX + VERSION;
const shellPaths = new Set(SHELL);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const cached = (await caches.match("/index.html", { cacheName: CACHE })) || (await caches.match("/", { cacheName: CACHE }));
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { cacheName: CACHE, ignoreSearch: true });
  return cached || fetch(request);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }
  if (shellPaths.has(url.pathname)) event.respondWith(cacheFirst(request));
});
