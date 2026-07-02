// ============================================================================
// NEXOVA COMMERCE ECOSYSTEM - OFFLINE PWA SERVICE WORKER
// Caches core application assets for local-first operations
// ============================================================================

const CACHE_NAME = 'nexova-pos-cache-v6';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/client-db.js',
  '/client-audio.js',
  '/client-speech.js',
  '/client-sync.js',
  '/sync-worker.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/polyfill.min.js',
  '/NotoNastaliqUrdu-Regular.ttf',
  'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Literata:ital,opsz,wght@0,7..72,200..900;1,7..72,200..900&family=Manrope:wght@200..800&family=Outfit:wght@100..900&display=swap',
  'https://unpkg.com/@zxing/library@0.21.0/umd/index.min.js'
];

// Install Service Worker and cache all essential static shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Pre-caching offline POS assets');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate Service Worker and clean up stale caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch Interceptor: Network-First with Cache Fallback for static assets, network-only for api/sockets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Allow API routes and web sockets to bypass service worker cache
  if (url.pathname.startsWith('/api') || event.request.url.includes('ws://') || event.request.url.includes('wss://')) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request).then((networkResponse) => {
      if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
      }
      return networkResponse;
    }).catch(() => {
      // Fallback to cache if network fails
      return caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        // Fallback for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
