/*
 * ColdReach service worker (v1.18.0).
 *
 * Privacy rule that must never change: this worker NEVER caches API
 * responses, page HTML, or anything behind sign in. ColdReach is a
 * multi tenant product, so a cached signed in page could show one
 * workspace's data to another person on a shared device. Page and
 * API requests always go to the network. Only fingerprinted static
 * assets (/_next/static), the PWA icons, and the public offline page
 * are cached.
 */
const VERSION = "coldreach-pwa-1.18.0";
const PRECACHE = `${VERSION}-precache`;
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline";

const PRECACHE_URLS = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== PRECACHE && key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.ico"
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // API traffic: network only, never intercepted, never cached.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Page navigations: network first. If the network is gone, show
  // the cached offline page. The page response itself is not cached.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(PRECACHE);
        const offline = await cache.match(OFFLINE_URL);
        return (
          offline ||
          new Response("You are offline.", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          })
        );
      }),
    );
    return;
  }

  // Static assets: cache first, refresh the cache from the network.
  // These URLs are content hashed, so a cached copy is always the
  // copy that URL will ever mean.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          return cached;
        }
        const response = await fetch(request);
        if (response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      }),
    );
  }
});
