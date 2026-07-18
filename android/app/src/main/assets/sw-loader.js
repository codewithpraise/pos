if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    fetch('/version.json?cb=' + Date.now())
      .then(res => res.json())
      .then(data => {
        const version = data.version || '1.0.0';
        return navigator.serviceWorker.register(`/sw.js?v=${version}`);
      })
      .catch(() => {
        return navigator.serviceWorker.register('/sw.js?v=offline-fallback');
      })
      .then((reg) => console.log('[PWA] Service worker registered successfully. Scope:', reg.scope))
      .catch((err) => console.warn('[PWA] Service worker registration failed:', err));
  });
}
