/* ============================================================================
   NEXOVA POS — OFFLINE CONNECTIVITY & STATUS BADGE MODULE
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
  // Initial connectivity check
  updateOfflineBanner(navigator.onLine);

  window.addEventListener('online',  () => updateOfflineBanner(true));
  window.addEventListener('offline', () => updateOfflineBanner(false));
}

// Automatically initialize on module load
initOfflineListeners();

// Expose globally for backward compatibility
window.updateOfflineBanner = updateOfflineBanner;
window.updateSyncStatusBadge = updateSyncStatusBadge;
