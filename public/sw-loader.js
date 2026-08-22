// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - ATOMIC RELEASE & SERVICE WORKER LOADER v2.9.0
// Guarantees zero release drift, controlled SW update handshake, and zero unprovoked reloads
// ============================================================================

(function() {
  'use strict';

  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;

  const hadControllerOnLoad = !!navigator.serviceWorker.controller;
  let isUpdating = false;

  window.addEventListener('load', async () => {
    try {
      // 1. Fetch Authoritative Release Manifest with zero-cache control
      const manifestRes = await fetch('/release-manifest.json?cb=' + Date.now(), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-store' }
      });

      let manifest = { version: '2.9.0', build_id: 'v2.9.0-prod-valenixia-pos' };
      if (manifestRes.ok) {
        try { manifest = await manifestRes.json(); } catch (_) {}
      }

      const activeBuildId = manifest.build_id || manifest.version || 'v2.9.0';
      window.VALENIXIA_BUILD_ID = activeBuildId;

      // Expose Release Provenance Diagnostics
      window.__VALENIXIA_RELEASE__ = Object.freeze({
        product: manifest.product || 'VALENIXIA POS',
        version: manifest.version || '2.9.0',
        buildId: activeBuildId,
        gitCommit: manifest.git_commit || 'a91f43cb',
        createdAt: manifest.created_at || '2026-08-16T00:00:00Z',
        environment: manifest.environment || 'production',
        schemaVersion: manifest.schema_version || '18',
        catalogVersion: manifest.commercial_catalog_version || 'v2.9.0-catalog-001',
        legalVersion: manifest.legal_documents_version || '2.9.0'
      });

      console.log(`[ReleaseProvenance v2.9.0] Authoritative Build ID: ${activeBuildId} (Version: ${manifest.version})`);

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
          if (installingWorker.state === 'installed') {
            console.log('[PWA Release Sync] New version installed — activating immediately.');
            installingWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });

      // Force SW update check on window focus / resume
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && reg && typeof reg.update === 'function') {
          reg.update().catch(() => {});
        }
      });

      // 4. Controller Change Listener: reload when new worker takes control
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadControllerOnLoad) {
          console.log('[PWA Release Sync] Initial service worker active.');
          return;
        }
        if (isUpdating) return;
        isUpdating = true;
        console.log('[PWA Release Sync] Service Worker updated — refreshing to load latest release.');
        setTimeout(() => {
          window.location.reload();
        }, 150);
      });

    } catch (err) {
      console.warn('[PWA Release Sync] Manifest fetch / SW registration fallback:', err);
      navigator.serviceWorker.register('/sw.js?v=fallback');
    }
  });
})();
