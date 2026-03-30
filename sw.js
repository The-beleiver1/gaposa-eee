// GAPOSA EEE Attendance System — Service Worker
// Required for PWA install prompt to appear in Chrome

const CACHE_NAME = 'gaposa-eee-v1';

// On install — cache nothing critical (app needs Firebase which requires network)
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

// On activate — clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first, fall back to cache for the main HTML only
self.addEventListener('fetch', (e) => {
  // Only cache GET requests to the same origin
  if (e.request.method !== 'GET') return;
  
  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Cache the main HTML page
        if (e.request.mode === 'navigate') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      })
      .catch(() => {
        // If offline, serve cached version of the page
        return caches.match(e.request);
      })
  );
});
