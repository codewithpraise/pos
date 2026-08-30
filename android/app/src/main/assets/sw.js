// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - OFFLINE PWA SERVICE WORKER
// Caches core application assets for local-first operations
// v10 - Cache-busting refresh, PASSPHRASE_MISMATCH auto-recovery
// ============================================================================

// Console gating in Service Worker context to prevent console pollution
if (!self.location.search.includes('debug=true')) {
  const noop = () => {};
  console.log = noop;
  console.warn = noop;
  console.info = noop;
}

const urlParams = new URLSearchParams(self.location.search);
const buildVersion = urlParams.get('v') || 'v3.2.0-prod-valenixia-pos';
const CACHE_NAME = `valenixia-pos-cache-${buildVersion}`;
const ASSETS_TO_CACHE = [
  { url: '/', integrity: '' },
  { url: '/index.html', integrity: '' },
  { url: '/style.css', integrity: '' },
  { url: '/styles/design-tokens.css', integrity: '' },
  { url: '/styles/themes.css', integrity: '' },
  { url: '/styles/animations.css', integrity: '' },
  { url: '/styles/components.css', integrity: '' },
  { url: '/app.js', integrity: 'sha384-tQiPznt7qv8iRqYOndRX+xwXM/y6J8DrFkjJIwRFSDO9pvACdN6jcPH5AxaS4uLn' },
  { url: '/router.js', integrity: '' },
  { url: '/commercial-catalog.js', integrity: '' },
  { url: '/legal-documents.js', integrity: '' },
  { url: '/barcode-decoder.js', integrity: '' },
  { url: '/barcode-scanner.js', integrity: '' },
  { url: '/modules/ui.js', integrity: '' },
  { url: '/modules/animations.js', integrity: '' },
  { url: '/modules/offline.js', integrity: '' },
  { url: '/modules/keyboard.js', integrity: '' },
  { url: '/client-db.js', integrity: 'sha384-ycA6M0hq7VmRXNOinS+thlsGfSfsBwHUNewREqPEPDeC6WtHSS8HBIF9GPGRPwwJ' },
  { url: '/client-audio.js', integrity: 'sha384-dzfXcrClk7pat6tYQU3aJLGFAsJYZU+tbF2rng81DIlBp+iUkOMe5TfNLe9va3f9' },
  { url: '/client-speech.js', integrity: 'sha384-7W67xTwgWUVhwx4BuvdTRftJfKk/2TH/JVX0FQy18uTcjM2CFaRvzRq/GRhW5e8k' },
  { url: '/client-sync.js', integrity: 'sha384-dvzrIevtShpBfj3wmA+zFMChJ4QAQRWSLqsTq5I4J0SztsioY8irVJLJzLC/ZLKc' },
  { url: '/sync-worker.js', integrity: 'sha384-h94c9kKYlBF1Qv0xp4I7mixb2dDeoAp3/gJ/NG+4InFcPyonx+lXQpNNvMo7/Bro' },
  { url: '/manifest.json', integrity: '' },
  { url: '/icon-192.png', integrity: '' },
  { url: '/icon-512.png', integrity: '' },
  { url: '/polyfill.min.js', integrity: 'sha384-P1J6VFE0IBOGvQjC3qf5YzjpdKWZ5EkHW4kGwsHnyLXMvhRbGJ01arDKwVqcdkUG' },
  { url: '/NotoNastaliqUrdu-Regular.ttf', integrity: '' },
  { url: '/dompurify.min.js', integrity: 'sha384-piCcpDdJ7qVeK4Tv8Z6Hpcr3ZBIgP16TxQTPVfsLFdZ5uDgwc3Y8Ho7oUnqf12qu' },
  { url: '/jspdf.umd.min.js', integrity: 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk' },
  { url: '/zxing.min.js', integrity: 'sha384-ET1PhbRYLe6k2AXPuFZAF+LZYXgMwkHwqrsbw4PobRULALuRP1buPYV++5ODebL5' }
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
  return new Response('<html><body><h2>Valenixia POS Ãƒ¢Ã¢š¬Ã¢â‚¬Å“ Offline</h2><p>Please connect to your local server.</p></body></html>', {
    status: 503,
    headers: { 'Content-Type': 'text/html' }
  });
}

// Install Service Worker and cache all essential static shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Pre-caching offline POS assets (v16)');
      // Add assets one-by-one so a single 404 doesn't abort the whole install
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(item => {
          const url = item.url;
          const integrity = item.integrity;
          const options = { cache: 'no-cache' };
          if (integrity) {
            options.integrity = integrity;
          }
          const req = new Request(url, options);
          return cache.add(req).catch(() => {
            console.warn('[ServiceWorker] Failed to pre-cache with integrity check:', url);
          });
        })
      );
    }).then(() => {
      // skipWaiting makes the new SW activate immediately without waiting for
      // existing clients to close. claim() is intentionally deferred to activate.
      return self.skipWaiting();
    })
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
    // clients.claim() is only valid inside activate — calling it elsewhere
    // throws InvalidStateError: Only the active worker can claim clients.
    ).then(() => self.clients.claim())
  );
});

// Fetch Interceptor
// - WebSocket upgrade requests: never intercept (let browser handle natively)
// - API routes + version.json: network-only, offline -> 503 JSON (no unhandled rejections)
// - Static assets: network-first, fall back to cache, then 503
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. WebSocket upgrade requests -- these arrive as http(s):// but with
  //    mode 'websocket'. The browser handles them natively; never call
  //    event.respondWith() or fetch() on them.
  if (request.mode === 'websocket') {
    return; // Let browser handle WebSocket upgrades natively
  }

  // 2. Cross-origin requests (Google Fonts, Supabase, etc.) -- never intercept.
  //    Attempting to fetch() external URLs that are blocked by CSP produces
  //    a 503 in the console. Let the browser handle these directly.
  if (url.origin !== self.location.origin) {
    return;
  }

  // 3. Binary and package downloads (.apk, .exe, .msi, .zip, /downloads/)
  //    Never intercept downloads in Service Worker - let browser native download manager handle them.
  if (
    url.pathname.startsWith('/downloads/') ||
    url.pathname.endsWith('.apk') ||
    url.pathname.endsWith('.exe') ||
    url.pathname.endsWith('.msi') ||
    url.pathname.endsWith('.zip')
  ) {
    return;
  }

  // 4. Dynamic/server-side routes: network-only with clean offline fallback
  const isDynamic =
    url.pathname.startsWith('/api/') ||
    url.pathname === '/version.json' ||
    url.pathname === '/release-manifest.json' ||
    url.pathname === '/build-id' ||
    url.pathname === '/artifact-manifest.json' ||
    url.pathname.startsWith('/version') ||
    url.pathname === '/healthz' ||
    url.pathname.startsWith('/healthz');

  if (isDynamic) {
    event.respondWith(
      fetch(request).catch((err) => {
        console.warn('[ServiceWorker] Offline - dynamic request failed:', url.pathname, err.message);
        return offlineJsonResponse('Server offline: ' + err.message, 503);
      })
    );
    return;
  }

  // 5. Static assets: network-first -> cache -> offline fallback
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
            cache.put(request, responseToCache).catch(() => {});
          });
        }
        return networkResponse;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          // Navigation fallback Ãƒ¢Ã¢â‚¬ Ã¢â‚¬â„¢ serve shell
          if (request.mode === 'navigate') {
            return caches.match('/index.html').then(r => r || offlineHtmlResponse());
          }
          // All other misses Ãƒ¢Ã¢â‚¬ Ã¢â‚¬â„¢ 503
          return offlineJsonResponse('Asset unavailable offline', 503);
        })
      )
  );
});

// Message handler Ãƒ¢Ã¢š¬Ã¢â‚¬ clients can send control messages to the SW
self.addEventListener('message', (event) => {
  const { type } = event.data || {};

  // IDB_CLOSE_FOR_UPGRADE: a tab's IndexedDB open request is blocked because
  // this SW holds an old version connection open. Signal all clients to close
  // their IndexedDB connections so the upgrade can proceed.
  if (type === 'IDB_CLOSE_FOR_UPGRADE') {
    console.warn('[ServiceWorker] Received IDB_CLOSE_FOR_UPGRADE Ãƒ¢Ã¢š¬Ã¢â‚¬ broadcasting to all clients to close IDB connections.');
    self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
      clients.forEach(client => {
        client.postMessage({ type: 'IDB_CLOSE_AND_RELOAD' });
      });
    });
  }

  // SKIP_WAITING: activate the new SW immediately
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // TERMINATE: Safely close database connections and unregister service worker
  if (type === 'TERMINATE') {
    console.warn('[ServiceWorker] TERMINATE received. Unregistering...');
    self.registration.unregister().then((success) => {
      if (success) {
        console.log('[ServiceWorker] Unregistered successfully.');
      }
    });
  }
});
