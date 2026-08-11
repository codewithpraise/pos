if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      console.log('[PWA] New Service Worker activated — refreshing page shell once.');
      window.location.reload();
    }
  });

  window.addEventListener('load', () => {
    fetch('/version.json?cb=' + Date.now())
      .then(res => res.json())
      .then(data => {
        const version = data.build_id || data.version || '2.3.0';
        window.VALENIXIA_BUILD_ID = version;
        console.log('[PWA] Active Production Build ID:', version);
        return navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(version)}`);
      })
      .catch(() => {
        return navigator.serviceWorker.register('/sw.js?v=offline-fallback');
      })
      .then((reg) => {
        console.log('[PWA] Service worker registered successfully. Scope:', reg.scope);
        if (reg) {
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('[PWA] New version ready — requesting skipWaiting.');
                  newWorker.postMessage({ type: 'SKIP_WAITING' });
                }
              });
            }
          });
        }
      })
      .catch((err) => console.warn('[PWA] Service worker registration failed:', err));
  });
}
