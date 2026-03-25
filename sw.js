// GAPOSA EEE Attendance — Service Worker v3
const CACHE_NAME = 'gaposa-eee-v3';
const FACE_API_CACHE = 'gaposa-faceapi-v1';

// Core app files to cache immediately
const CORE_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Face-API model files (cached separately so app works offline)
const MODEL_BASE = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
const MODEL_FILES = [
  MODEL_BASE + 'tiny_face_detector_model-weights_manifest.json',
  MODEL_BASE + 'tiny_face_detector_model-shard1',
  MODEL_BASE + 'face_landmark_68_tiny_model-weights_manifest.json',
  MODEL_BASE + 'face_landmark_68_tiny_model-shard1',
  MODEL_BASE + 'face_recognition_model-weights_manifest.json',
  MODEL_BASE + 'face_recognition_model-shard1',
  MODEL_BASE + 'face_recognition_model-shard2'
];

// Face-API JS bundle
const FACE_API_JS = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';

// Google Fonts (cache on first use)
const FONT_URLS = [
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap'
];

// ── INSTALL ───────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing GAPOSA EEE v3...');
  event.waitUntil(
    Promise.all([
      // Cache core app files
      caches.open(CACHE_NAME).then(cache => {
        console.log('[SW] Caching core files');
        return cache.addAll(CORE_FILES).catch(err => {
          console.warn('[SW] Core cache partial fail:', err);
        });
      }),
      // Pre-cache face-api models for offline use
      caches.open(FACE_API_CACHE).then(cache => {
        console.log('[SW] Pre-caching face-api models...');
        return cache.addAll([FACE_API_JS, ...MODEL_FILES]).catch(err => {
          console.warn('[SW] Model pre-cache fail (will cache on first use):', err);
        });
      })
    ]).then(() => {
      console.log('[SW] Install complete');
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE ──────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== FACE_API_CACHE)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => {
      console.log('[SW] Activated — claiming clients');
      return self.clients.claim();
    })
  );
});

// ── FETCH ─────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension and other non-http
  if (!url.startsWith('http')) return;

  // Face-API models & JS — cache first, then network
  if (url.includes('vladmandic/face-api') || url.includes('face-api.js@0.22.2')) {
    event.respondWith(cacheFirst(event.request, FACE_API_CACHE));
    return;
  }

  // Google Fonts — stale-while-revalidate
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    event.respondWith(staleWhileRevalidate(event.request, CACHE_NAME));
    return;
  }

  // jsdelivr CDN (other libs) — cache first
  if (url.includes('cdn.jsdelivr.net')) {
    event.respondWith(cacheFirst(event.request, FACE_API_CACHE));
    return;
  }

  // Core app files — network first with cache fallback
  event.respondWith(networkFirst(event.request, CACHE_NAME));
});

// ── STRATEGIES ────────────────────────────────────────────────

// Cache first (best for models/static assets)
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    console.warn('[SW] cacheFirst fetch failed:', request.url);
    return new Response('Offline — resource not cached', { status: 503 });
  }
}

// Network first with cache fallback (best for app shell)
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Return index.html for navigation requests (SPA fallback)
    if (request.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('You are offline and this resource is not cached.', { status: 503 });
  }
}

// Stale while revalidate (best for fonts)
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || fetchPromise;
}

// ── BACKGROUND SYNC / MESSAGE ─────────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});
