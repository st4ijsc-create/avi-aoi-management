/*
 * Phase 5 WS5.1 — Conservative service worker for the SYNAPSE PWA.
 *
 * Deliberately cautious to avoid stale-content footguns on a factory terminal:
 *  - NEVER caches API / tRPC / socket / SSE (always network).
 *  - Navigations: network-first; on success it REFRESHES the cached app shell,
 *    and offline it falls back to that shell so a reload still renders the SPA
 *    (B11 — reload-while-offline previously showed a blank white screen).
 *  - Static assets (Vite hashed js/css/img/font): stale-while-revalidate, so the
 *    core bundle the shell needs is kept warm for offline reloads.
 *  - skipWaiting + clients.claim so updates apply promptly; old caches pruned.
 */
const CACHE = "avi-aoi-v2";
const SHELL = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

function isBypassed(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/trpc") ||
    url.pathname.startsWith("/api/trpc") ||
    url.pathname.startsWith("/api/socket.io") ||
    url.pathname.startsWith("/api/stream")
  );
}

// Serve the cached SPA shell for any navigation (covers deep SPA routes like
// /operator, /andon — none of which are their own cached document).
function offlineShell() {
  return caches.match("/index.html").then((r) => r || caches.match("/"));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || isBypassed(url)) return; // always network

  // Navigations → network-first; keep the cached shell FRESH on every success so
  // an offline reload renders the last-known-good SPA instead of a blank page.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/index.html", copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => offlineShell()),
    );
    return;
  }

  // Static assets → stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
