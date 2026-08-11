// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - ATOMIC RELEASE & SERVICE WORKER LOADER v2.5.0
// Guarantees zero release drift, controlled SW update handshake, and Network-First shell
// ============================================================================

(function() {
  'use strict';

  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;

  let isUpdating = false;

  window.addEventListener('load', async () => {
    try {
      // 1. Fetch Authoritative Release Manifest with zero-cache control
      const manifestRes = await fetch('/release-manifest.json?cb=' + Date.now(), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-store' }
      });

      let manifest = { version: '2.5.0', build_id: 'v2.5.0-prod-20260811.2015' };
      if (manifestRes.ok) {
        try { manifest = await manifestRes.json(); } catch (_) {}
      }

      const activeBuildId = manifest.build_id || manifest.version || 'v2.5.0';
      window.VALENIXIA_BUILD_ID = activeBuildId;

      // Expose Release Provenance Diagnostics
      window.__VALENIXIA_RELEASE__ = Object.freeze({
        product: manifest.product || 'VALENIXIA POS',
        version: manifest.version || '2.5.0',
        buildId: activeBuildId,
        gitCommit: manifest.git_commit || 'fcb1d6e',
        createdAt: manifest.created_at || '2026-08-11T20:15:00Z',
        environment: manifest.environment || 'production',
        schemaVersion: manifest.schema_version || '17',
        catalogVersion: manifest.commercial_catalog_version || '2.5.0',
        legalVersion: manifest.legal_documents_version || '2.5.0'
      });

      console.log(`[ReleaseProvenance v2.5.0] Authoritative Build ID: ${activeBuildId} (Version: ${manifest.version})`);

      // 2. Register Service Worker with explicit version query
      const reg = await navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(activeBuildId)}`);

      // Expose Service Worker Diagnostics
      window.__VALENIXIA_SW__ = {
        scope: reg.scope,
        scriptURL: (reg.active || reg.installing || reg.waiting)?.scriptURL || '/sw.js',
        activeVersion: activeBuildId,
        controlled: !!navigator.serviceWorker.controller
      };

      // 3. Handle Service Worker Version Update Handshake
      reg.addEventListener('updatefound', () => {
        const installingWorker = reg.installing;
        if (!installingWorker) return;

        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[PWA Release Sync] New version ready — requesting skipWaiting.');
            installingWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });

      // 4. Reload client ONCE when controller changes to activate new SW safely
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (isUpdating) return;
        const reloadToken = sessionStorage.getItem('valenixia_sw_reloaded');
        if (reloadToken !== activeBuildId) {
          isUpdating = true;
          sessionStorage.setItem('valenixia_sw_reloaded', activeBuildId);
          console.log('[PWA Release Sync] Atomic SW transition — reloading once.');
          window.location.reload();
        }
      });

    } catch (err) {
      console.warn('[PWA Release Sync] Manifest fetch / SW registration fallback:', err);
      navigator.serviceWorker.register('/sw.js?v=fallback');
    }
  });
})();
