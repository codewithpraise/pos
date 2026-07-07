// ============================================================================
// NEXOVA COMMERCE ECOSYSTEM - OFFLINE PWA SERVICE WORKER
// Caches core application assets for local-first operations
// v7 - Hardened fetch handler: no unhandled rejections, no undefined responses
// ============================================================================

const CACHE_NAME = 'nexova-pos-cache-v7';
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

// Helper: build a clean offline JSON response
function offlineJsonResponse(msg, status) {
  return new Response(JSON.stringify({ error: msg, offline: true }), {
    status: status || 503,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Helper: build a clean offline HTML response for navigation misses
function offlineHtmlResponse() {
  return new Response('<html><body><h2>Nexova POS – Offline</h2><p>Please connect to your local server.</p></body></html>', {
    status: 503,
    headers: { 'Content-Type': 'text/html' }
  });
}

// Install Service Worker and cache all essential static shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Pre-caching offline POS assets (v7)');
      // Add assets one-by-one so a single 404 doesn't abort the whole install
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(url => cache.add(url).catch(() => {
          console.warn('[ServiceWorker] Failed to pre-cache:', url);
        }))
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean up stale caches and claim all clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing stale cache:', name);
            return caches.delete(name);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch Interceptor
// - WebSocket upgrade requests: never intercept (let browser handle natively)
// - API routes + version.json: network-only, offline → 503 JSON (no unhandled rejections)
// - Static assets: network-first, fall back to cache, then 503
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. WebSocket upgrade requests — these arrive as http(s):// but with
  //    mode 'websocket'. The browser handles them natively; never call
  //    event.respondWith() or fetch() on them.
  if (request.mode === 'websocket') {
    return; // Let browser handle WebSocket upgrades natively
  }

  // 2. Dynamic/server-side routes: network-only with clean offline fallback
  const isDynamic =
    url.pathname.startsWith('/api/') ||
    url.pathname === '/version.json' ||
    url.pathname.startsWith('/version');

  if (isDynamic) {
    event.respondWith(
      fetch(request).catch((err) => {
        console.warn('[ServiceWorker] Offline – dynamic request failed:', url.pathname, err.message);
        return offlineJsonResponse('Server offline: ' + err.message, 503);
      })
    );
    return;
  }

  // 3. Static assets: network-first → cache → offline fallback
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // Only cache successful same-origin responses
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          (networkResponse.type === 'basic' || networkResponse.type === 'cors')
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          // Navigation fallback → serve shell
          if (request.mode === 'navigate') {
            return caches.match('/index.html').then(r => r || offlineHtmlResponse());
          }
          // All other misses → 503
          return offlineJsonResponse('Asset unavailable offline', 503);
        })
      )
  );
});
