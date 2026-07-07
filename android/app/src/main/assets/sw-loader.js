if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => console.log('[PWA] Service worker registered successfully. Scope:', reg.scope))
      .catch((err) => console.warn('[PWA] Service worker registration failed:', err));
  });
}
