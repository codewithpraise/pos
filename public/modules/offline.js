/* ============================================================================
   VALENIXIA POS — OFFLINE CONNECTIVITY & STATUS BADGE MODULE
   Choreographs sync indicators and fixed top alert bars.
   ============================================================================ */

/**
 * Announce connection state changes and slide banner alerts.
 * @param {boolean} isOnline
 */
export function updateOfflineBanner(isOnline) {
  const banner = document.getElementById('offline-banner');
  const pill   = document.getElementById('mobile-offline-pill');
  const body   = document.body;

  if (!isOnline) {
    if (banner) banner.style.display = 'flex';
    if (pill)   pill.style.display   = 'flex';
    body.classList.add('is-offline');
    if (typeof window.announceToScreenReader === 'function') {
      window.announceToScreenReader('You are offline. Sales are being saved locally.');
    }
  } else {
    if (banner) banner.style.display = 'none';
    if (pill)   pill.style.display   = 'none';
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
