/* ============================================================================
   VALENIXIA POS — OFFLINE CONNECTIVITY & STATUS BADGE MODULE
   Choreographs sync indicators and fixed top alert bars.
   ============================================================================ */
if (typeof exports === 'undefined') var exports = (typeof window !== 'undefined' ? (window.exports = window.exports || {}) : {});


/**
 * Announce connection state changes and slide banner alerts.
 * @param {boolean} isOnline
 */
export function updateOfflineBanner(isOnline) {
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

    // Show for 2 seconds, then fade out and leave yellow status dot
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

/**
 * Update the sync status badge in the topbar (if it exists).
 * @param {'syncing'|'synced'|'offline'} status
 */
export function updateSyncStatusBadge(status) {
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

export function initOfflineListeners() {
  try {
    // Initial connectivity check
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

// Auto-initialization removed — app.js manages online/offline listeners centrally
// to prevent triple-conflict flicker. Call initOfflineListeners() explicitly if needed.

// Expose globally for backward compatibility
window.updateOfflineBanner = updateOfflineBanner;
window.updateSyncStatusBadge = updateSyncStatusBadge;
