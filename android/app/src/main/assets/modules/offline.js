/* ============================================================================
   VALENIXIA POS — OFFLINE CONNECTIVITY & STATUS BADGE MODULE
   Choreographs sync indicators and fixed top alert bars.
   ============================================================================ */

function updateOfflineBanner(isOnline) {
  const banner = document.getElementById('offline-banner');
  const pill   = document.getElementById('mobile-offline-pill');
  const dot    = document.getElementById('offline-status-dot');
  const body   = document.body;

  if (window.__offlineBannerTimeout) clearTimeout(window.__offlineBannerTimeout);

  if (!isOnline) {
    if (dot) dot.style.display = 'block';
    if (banner) {
      banner.style.display = 'flex';
      banner.style.opacity = '1';
      banner.style.transition = 'opacity 0.5s ease';
    }
    if (pill) pill.style.display = 'none';

    window.__offlineBannerTimeout = setTimeout(() => {
      if (banner) {
        banner.style.opacity = '0';
        setTimeout(() => {
          if (banner) banner.style.display = 'none';
        }, 500);
      }
    }, 2000);

    if (typeof window.announceToScreenReader === 'function') {
      window.announceToScreenReader('You are offline. Sales are being saved locally.');
    }
  } else {
    if (banner) {
      banner.style.opacity = '0';
      banner.style.display = 'none';
    }
    if (pill) pill.style.display = 'none';
    if (dot)  dot.style.display  = 'none';
    body.classList.remove('is-offline');
    if (typeof window.announceToScreenReader === 'function') {
      window.announceToScreenReader('Connection restored. Syncing your data.');
    }
  }
}

function updateSyncStatusBadge(status) {
  const badge = document.querySelector('.sync-status-badge');
  if (!badge) return;

  badge.className = 'sync-status-badge';
  badge.classList.add(status);

  if (status === 'syncing') {
    badge.innerHTML = '<span class="spin-icon" aria-hidden="true">↻</span> Syncing…';
  } else if (status === 'synced') {
    badge.innerHTML = '✓ Synced';
  } else {
    badge.innerHTML = '⚡ Offline';
  }
}

function initOfflineListeners() {
  try {
    updateOfflineBanner(navigator.onLine);

    window.addEventListener('online',  () => {
      try {
        updateOfflineBanner(true);
      } catch (err) {
        console.error('[OfflineModule] Failed to update banner on online event:', err);
      }
    });
    window.addEventListener('offline', () => {
      try {
        updateOfflineBanner(false);
      } catch (err) {
        console.error('[OfflineModule] Failed to update banner on offline event:', err);
      }
    });
  } catch (e) {
    console.error('[OfflineModule] Failed to initialize offline listeners:', e);
  }
}

if (typeof window !== 'undefined') {
  window.updateOfflineBanner = updateOfflineBanner;
  window.updateSyncStatusBadge = updateSyncStatusBadge;
  window.initOfflineListeners = initOfflineListeners;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { updateOfflineBanner, updateSyncStatusBadge, initOfflineListeners };
}
