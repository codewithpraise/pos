// ============================================================================
// VALENIXIA POS v2.4.4 COMPREHENSIVE ARCHITECTURAL SUITE
// Tests permanent screen shells, render contract targets, single-view isolation,
// 1000 worker messages + 100 rapid route changes, failure isolation, connectivity states,
// and commercial/legal feature regressions.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

describe('Valenixia POS v2.4.4 Comprehensive Architectural Verification', () => {
  let dom;
  let window;
  let document;

  beforeAll(() => {
    const htmlPath = path.join(__dirname, '../public/index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    dom = new JSDOM(htmlContent, {
      url: 'http://localhost:8080/#checkout',
      runScripts: 'dangerously',
      resources: 'usable'
    });

    window = dom.window;
    document = window.document;

    // Load scripts in order
    const scripts = [
      'public/connectivity.js',
      'public/router.js',
      'public/commercial-catalog.js',
      'public/legal-documents.js',
      'public/freemium-engine.js',
      'public/app.js'
    ];

    scripts.forEach(scriptPath => {
      const fullPath = path.join(__dirname, '../', scriptPath);
      if (fs.existsSync(fullPath)) {
        const code = fs.readFileSync(fullPath, 'utf8');
        window.eval(code);
      }
    });

    // Mock minimal state
    window.state = {
      activeScreen: 'checkout',
      screenDirty: {},
      catalog: [],
      activeCart: [],
      customers: [],
      employees: []
    };
  });

  afterAll(() => {
    if (dom) dom.window.close();
  });

  test('Test A: All 18 permanent screen shells exist in DOM simultaneously', () => {
    const registry = window.SCREEN_REGISTRY;
    expect(registry).toBeDefined();

    const keys = Object.keys(registry);
    expect(keys.length).toBe(18);

    keys.forEach(routeKey => {
      const viewId = registry[routeKey].viewId;
      const shell = document.getElementById(viewId);
      expect(shell).not.toBeNull();
      expect(shell.classList.contains('content-view')).toBe(true);
    });
  });

  test('Test B: All registered renderer contract DOM targets exist inside shells', () => {
    const registry = window.SCREEN_REGISTRY;

    Object.keys(registry).forEach(routeKey => {
      const meta = registry[routeKey];
      meta.renderTargets.forEach(tId => {
        const el = document.getElementById(tId);
        expect(el).not.toBeNull();
      });
    });
  });

  test('Test C: ValenixiaRouter enforces exactly 1 active view on every route', () => {
    const router = window.ValenixiaRouter;
    expect(router).toBeDefined();

    const routes = Object.keys(window.SCREEN_REGISTRY);

    routes.forEach(route => {
      const success = router.navigateTo(route, { push: false });
      expect(success).toBe(true);

      const activeViews = Array.from(document.querySelectorAll('.content-view.active'));
      expect(activeViews.length).toBe(1);
      expect(activeViews[0].id).toBe(window.SCREEN_REGISTRY[route].viewId);

      const hiddenViews = Array.from(document.querySelectorAll('.content-view')).filter(v => v.hidden);
      expect(hiddenViews.length).toBe(17);
    });
  });

  test('Test D: Zero duplicate DOM IDs across the entire document', () => {
    const allElements = Array.from(document.querySelectorAll('[id]'));
    const idCounts = {};

    allElements.forEach(el => {
      const id = el.id;
      if (id) {
        idCounts[id] = (idCounts[id] || 0) + 1;
      }
    });

    const duplicates = Object.keys(idCounts).filter(id => idCounts[id] > 1);
    expect(duplicates).toEqual([]);
  });

  test('Test E: Stress Matrix — 100 rapid route switches + 1000 worker messages execute with 0 errors', () => {
    const router = window.ValenixiaRouter;
    const routes = Object.keys(window.SCREEN_REGISTRY);

    let errorCount = 0;
    const origError = window.console.error;
    window.console.error = (...args) => {
      errorCount++;
      origError(...args);
    };

    // Simulate 1000 worker state messages interleaved with 100 route switches
    for (let i = 0; i < 1000; i++) {
      window.state.catalog.push({ sku: `SKU_${i}`, name: `Item ${i}`, price: 100 });
      if (i % 10 === 0) {
        const targetRoute = routes[i % routes.length];
        router.navigateTo(targetRoute, { push: false });
      }
    }

    window.console.error = origError;
    expect(errorCount).toBe(0);
    expect(window.routeGeneration).toBeGreaterThanOrEqual(100);
  });

  test('Test F: Failure Isolation — missing render target logs warning without crashing app', () => {
    let warnLogged = false;
    const origWarn = window.console.warn;
    window.console.warn = (...args) => {
      if (args[0] && String(args[0]).includes('[RenderContractViolation]')) {
        warnLogged = true;
      }
      origWarn(...args);
    };

    const target = window.requireRenderTarget('staff', 'non-existent-target-id');
    window.console.warn = origWarn;

    expect(target).toBeNull();
    expect(warnLogged).toBe(true);
  });

  test('Test G: Real-Time Connectivity Subsystem state transitions', async () => {
    const monitor = window.ConnectivityMonitor;
    expect(monitor).toBeDefined();

    // Test OFFLINE
    monitor.handleOfflineEvent();
    let status = monitor.getStatus();
    expect(status.status).toBe('OFFLINE');
    expect(status.reason).toBe('NETWORK_UNAVAILABLE');

    // Test ONLINE with successful mock fetch
    window.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, version: '2.4.4' })
    });

    await monitor.probeConnectivity();
    status = monitor.getStatus();
    expect(status.status).toBe('ONLINE');
    expect(status.reason).toBe('REACHABLE');

    // Test DEGRADED with failed backend response
    window.fetch = jest.fn().mockRejectedValue(new Error('Network timeout'));
    await monitor.probeConnectivity();
    status = monitor.getStatus();
    expect(status.status).toBe('DEGRADED');
    expect(status.reason).toBe('BACKEND_UNREACHABLE');
  });

  test('Test H: Commercial Catalog & Legal Document Center Regressions', () => {
    expect(window.COMMERCIAL_CATALOG).toBeDefined();
    expect(window.COMMERCIAL_CATALOG.TIERS).toBeDefined();
    expect(window.COMMERCIAL_CATALOG.ADDONS).toBeDefined();

    expect(window.LEGAL_DOCUMENTS).toBeDefined();
    expect(window.LEGAL_DOCUMENTS.TERMS_OF_SERVICE).toBeDefined();
    expect(window.LEGAL_DOCUMENTS.EULA).toBeDefined();
  });

  test('Test I: Global Diagnostic Inspection Snapshot (__VALENIXIA_DIAGNOSTICS__)', () => {
    const diag = window.__VALENIXIA_DIAGNOSTICS__;
    expect(diag).toBeDefined();

    const snapshot = diag.getSnapshot();
    expect(snapshot.buildId).toBeDefined();
    expect(snapshot.mountedScreensCount).toBe(18);
    expect(snapshot.visibleScreens.length).toBe(1);
    expect(snapshot.missingShells).toHaveLength(0);
    expect(snapshot.duplicateIds).toHaveLength(0);
    expect(snapshot.connectivity).toBeDefined();
  });
});
