/**
 * Service Worker — offline support + asset caching.
 * Bump CACHE_NAME version to force clients to pick up new files.
 */

const CACHE_NAME = "ecofuels-attendance-v11";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/employee.html",
  "/admin.html",
  "/css/style.css",
  "/css/employee.css",
  "/css/admin.css",
  "/css/chat.css",
  "/js/firebase-config.js",
  "/js/utils.js",
  "/js/geo-utils.js",
  "/js/face-utils.js",
  "/js/employee.js",
  "/js/chat.js",
  "/js/requests-employee.js",
  "/js/auth.js",
  "/js/admin.js",
  "/js/calendar.js",
  "/js/reports.js",
  "/js/requests-admin.js",
  "/js/pwa-install.js",
  "/favicon.svg",
  "/manifest.json",
  "/icons/logo.jpg"
];

/* ---- Install: cache all static assets ---- */
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ---- Activate: remove old caches ---- */
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---- Fetch strategy ----
   - Our own static files  -> cache-first  (fast, works offline)
   - Firebase / CDN / APIs -> network-only (always fresh, skip SW)
*/
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  const url = new URL(e.request.url);

  // Skip external origins — let Firebase SDK handle its own requests
  if (url.origin !== self.location.origin) return;

  const isNavigation = e.request.mode === "navigate";
  const isAppAsset = /\.(?:html|css|js)$/.test(url.pathname);

  // App HTML/CSS/JS should refresh immediately so PWA updates are visible.
  if (isNavigation || isAppAsset) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then((cached) => {
          if (cached) return cached;
          if (isNavigation) return caches.match("/index.html");
        }))
    );
    return;
  }

  // Cache-first for other same-origin files
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) {
        // Serve from cache and refresh in background
        fetch(e.request)
          .then((res) => {
            if (res && res.status === 200) {
              caches.open(CACHE_NAME)
                .then((cache) => cache.put(e.request, res));
            }
          })
          .catch(() => {}); // ignore network errors on background refresh
        return cached;
      }

      // Not in cache → fetch from network and cache it
      return fetch(e.request).then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // Offline and not cached — return offline page for navigation requests
        if (e.request.mode === "navigate") {
          return caches.match("/index.html");
        }
      });
    })
  );
});
