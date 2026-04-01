// Service Worker simples para PWA
const CACHE_NAME = 'nossagrana-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // PWA minimal requires a fetch handler, even if it does nothing but network fallback.
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
