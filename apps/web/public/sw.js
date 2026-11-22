/* RAILGUARD AI service worker: makes the Inspector Review screen usable with no network.
 * - App shell + static assets: stale-while-revalidate
 * - Navigations: network first, falling back to the cached page, then to /review
 * - API calls are never cached here (the app keeps its own IndexedDB review queue)
 */
const VERSION = 'rg-v1';
const SHELL = ['/review', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // API, tiles, R2: not cached here

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          void caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(
          async () =>
            (await caches.match(req)) || (await caches.match('/review')) || Response.error(),
        ),
    );
    return;
  }
  if (
    url.pathname.startsWith('/_next/static') ||
    /\.(?:png|svg|ico|woff2?|css|js)$/.test(url.pathname)
  ) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((res) => {
          const copy = res.clone();
          void caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        });
        return hit || net;
      }),
    );
  }
});
