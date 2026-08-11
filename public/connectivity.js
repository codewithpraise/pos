// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - 4-SIGNAL REAL-TIME CONNECTIVITY ENGINE v2.4.6
// Tracks 4 signals: NETWORK STATE, BACKEND STATE, SYNC STATE, and POS OPERATING MODE
// Calculates projected state:
// - ONLINE: Browser network reachable AND backend probe responding 200 OK
// - DEGRADED: Browser network reachable BUT backend probe failing or sync delayed
// - OFFLINE: Browser physical network interface disconnected
// Exposes window.__VALENIXIA_CONNECTIVITY__() for forensic diagnostics.
// ============================================================================

(function(global) {
  'use strict';

  class ConnectivityMonitor {
    constructor() {
      this.signals = {
        NETWORK: (typeof navigator !== 'undefined' && navigator.onLine),
        BACKEND: true,
        SYNC: 'HEALTHY',
        POS: 'OPERATIONAL'
      };

      this.status = this.signals.NETWORK ? 'ONLINE' : 'OFFLINE';
      this.reason = this.signals.NETWORK ? 'REACHABLE' : 'NETWORK_UNAVAILABLE';
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = 0;
      this.lastProbeTime = null;
      this.lastSuccessfulProbeTime = null;
      this.probeLatencyMs = 0;
      this.listeners = new Set();
      this.checkInterval = null;
      this.initialized = false;
    }

    init() {
      if (this.initialized) return;
      this.initialized = true;

      // React immediately to physical browser network state changes
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => this.handleOnlineEvent());
        window.addEventListener('offline', () => this.handleOfflineEvent());
      }

      this.syncStateWithNavigator();

      // Periodic background health probe every 15 seconds
      this.checkInterval = setInterval(() => this.probeConnectivity(), 15000);
      this.probeConnectivity();

      // Expose authoritative diagnostic function on global window
      if (typeof window !== 'undefined') {
        window.__VALENIXIA_CONNECTIVITY__ = () => this.getDiagnosticSnapshot();
      }

      console.log(`[ConnectivityEngine v2.4.6] Initialized. Initial status: ${this.status}`);
    }

    syncStateWithNavigator() {
      if (typeof navigator !== 'undefined') {
        this.signals.NETWORK = !!navigator.onLine;
        if (!this.signals.NETWORK) {
          this.updateState('OFFLINE', 'NETWORK_UNAVAILABLE');
        }
      }
    }

    handleOnlineEvent() {
      console.log('[ConnectivityEngine] Physical network ONLINE event received.');
      this.signals.NETWORK = true;
      this.consecutiveFailures = 0;
      this.probeConnectivity();
    }

    handleOfflineEvent() {
      console.log('[ConnectivityEngine] Physical network OFFLINE event received.');
      this.signals.NETWORK = false;
      this.signals.BACKEND = false;
      this.updateState('OFFLINE', 'NETWORK_UNAVAILABLE');
    }

    async probeConnectivity() {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        this.signals.NETWORK = false;
        this.signals.BACKEND = false;
        this.updateState('OFFLINE', 'NETWORK_UNAVAILABLE');
        return;
      }

      this.signals.NETWORK = true;
      const startTime = performance.now();
      this.lastProbeTime = Date.now();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const baseUrl = global.__valenixiaServerUrl || (location.protocol === 'file:' ? 'http://localhost:8080' : location.origin);
        const healthUrl = baseUrl + '/api/health?cb=' + Date.now();

        let response;
        try {
          response = await fetch(healthUrl, {
            method: 'GET',
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
            credentials: 'same-origin',
            signal: controller.signal
          });
        } catch (_) {
          const fallbackUrl = baseUrl + '/healthz?cb=' + Date.now();
          response = await fetch(fallbackUrl, {
            method: 'GET',
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
            credentials: 'same-origin',
            signal: controller.signal
          });
        }

        clearTimeout(timeoutId);
        this.probeLatencyMs = Math.round(performance.now() - startTime);

        if (response && response.ok) {
          this.signals.BACKEND = true;
          this.consecutiveFailures = 0;
          this.consecutiveSuccesses++;
          this.lastSuccessfulProbeTime = Date.now();
          this.updateState('ONLINE', 'REACHABLE');
        } else {
          this.handleProbeFailure('HTTP_' + (response ? response.status : 'UNKNOWN'));
        }
      } catch (err) {
        clearTimeout(timeoutId);
        this.probeLatencyMs = Math.round(performance.now() - startTime);
        this.handleProbeFailure(err.name === 'AbortError' ? 'FETCH_TIMEOUT' : 'FETCH_FAILED');
      }
    }

    handleProbeFailure(reasonCode) {
      this.signals.BACKEND = false;
      this.consecutiveFailures++;
      this.consecutiveSuccesses = 0;

      // If browser is physically online but 2 consecutive backend probes fail -> DEGRADED
      if (this.signals.NETWORK) {
        if (this.consecutiveFailures >= 2) {
          this.updateState('DEGRADED', reasonCode);
        } else {
          // 1st transient failure -> remain ONLINE until 2nd failure confirms
          this.updateState('ONLINE', 'PROBE_RETRYING');
        }
      } else {
        this.updateState('OFFLINE', 'NETWORK_UNAVAILABLE');
      }
    }

    updateState(newStatus, reason) {
      const changed = this.status !== newStatus || this.reason !== reason;
      this.status = newStatus;
      this.reason = reason;

      if (changed) {
        console.log(`[ConnectivityEngine v2.4.6] Status changed -> ${newStatus} (${reason}) [Failures: ${this.consecutiveFailures}]`);
        this.updateDOM();
        this.notifyListeners();
      }
    }

    updateDOM() {
      if (typeof document === 'undefined') return;

      const badge = document.getElementById('net-badge');
      const text = document.getElementById('net-status-text');
      const offlineBanner = document.getElementById('offline-banner');

      if (badge) {
        badge.classList.remove('online', 'degraded', 'offline');
        if (this.status === 'ONLINE') {
          badge.classList.add('online');
        } else if (this.status === 'DEGRADED') {
          badge.classList.add('degraded');
        } else {
          badge.classList.add('offline');
        }
      }

      if (text) {
        text.textContent = this.status;
      }

      if (offlineBanner) {
        if (this.status === 'OFFLINE') {
          offlineBanner.style.display = 'flex';
          document.body.classList.add('is-offline');
        } else {
          offlineBanner.style.display = 'none';
          document.body.classList.remove('is-offline');
        }
      }

      if (global.state) {
        global.state.isOnline = (this.status === 'ONLINE' || this.status === 'DEGRADED');
      }
    }

    setSyncSignal(status) {
      this.signals.SYNC = String(status || 'SYNCED').toUpperCase();
      if (typeof document !== 'undefined') {
        const syncBadge = document.getElementById('sync-badge');
        const syncText = document.getElementById('sync-status-text');
        if (syncText) syncText.textContent = this.signals.SYNC;
        if (syncBadge) {
          syncBadge.className = 'network-badge ' + this.signals.SYNC.toLowerCase();
          const dot = syncBadge.querySelector('.badge-dot');
          if (dot) {
            if (this.signals.SYNC === 'SYNCED') {
              dot.style.background = '#3b82f6';
            } else if (this.signals.SYNC === 'SYNCING' || this.signals.SYNC === 'QUEUED') {
              dot.style.background = '#f59e0b';
            } else {
              dot.style.background = '#ef4444';
            }
          }
        }
      }
      if (this.signals.SYNC === 'DELAYED' || this.signals.SYNC === 'FAILED' || this.signals.SYNC === 'DISCONNECTED') {
        if (this.status === 'ONLINE') this.updateState('DEGRADED', 'SYNC_' + this.signals.SYNC);
      }
    }

    setPosSignal(status) {
      this.signals.POS = status;
    }

    subscribe(callback) {
      if (typeof callback === 'function') {
        this.listeners.add(callback);
      }
      return () => this.listeners.delete(callback);
    }

    notifyListeners() {
      const snapshot = this.getDiagnosticSnapshot();
      this.listeners.forEach(cb => {
        try { cb(snapshot); } catch (_) {}
      });
    }

    getStatus() {
      const snap = this.getDiagnosticSnapshot();
      return Object.assign({ status: this.status, signals: Object.assign({}, this.signals), browserOnline: typeof navigator !== 'undefined' ? navigator.onLine : true }, snap);
    }

    getDiagnosticSnapshot() {
      return {
        state: this.status,
        reason: this.reason,
        browserNetwork: !!this.signals.NETWORK,
        backendReachability: !!this.signals.BACKEND,
        syncHealth: this.signals.SYNC || 'HEALTHY',
        posOperatingMode: this.signals.POS || 'OPERATIONAL',
        lastProbeAt: this.lastProbeTime ? new Date(this.lastProbeTime).toISOString() : null,
        lastSuccessfulProbeAt: this.lastSuccessfulProbeTime ? new Date(this.lastSuccessfulProbeTime).toISOString() : null,
        consecutiveFailures: this.consecutiveFailures,
        consecutiveSuccesses: this.consecutiveSuccesses,
        probeLatencyMs: this.probeLatencyMs
      };
    }
  }

  const monitor = new ConnectivityMonitor();
  global.ConnectivityMonitor = monitor;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => monitor.init());
    } else {
      monitor.init();
    }
  }
})(typeof window !== 'undefined' ? window : global);
