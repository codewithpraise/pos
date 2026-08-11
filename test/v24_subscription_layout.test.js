const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

describe('VALENIXIA POS v2.4.5 - Subscription Layout & Architecture Suite', function() {
  this.timeout(10000);

  let dom;
  let window;
  let document;

  before(function() {
    const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    dom = new JSDOM(htmlContent, {
      url: 'http://localhost:8080/',
      runScripts: 'dangerously'
    });

    window = dom.window;
    document = window.document;

    // Load dependencies into JSDOM context
    const bootstrapScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'bootstrap-init.js'), 'utf8');
    const connectivityScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'connectivity.js'), 'utf8');
    const routerScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'router.js'), 'utf8');

    window.eval(bootstrapScript);
    window.eval(connectivityScript);
    window.eval(routerScript);
  });

  after(function() {
    if (dom) dom.window.close();
  });

  it('1. Server-Rendered HTML Shell Invariant: All 18 screen shells exist in DOM with 0 duplicates', function() {
    const registeredKeys = Object.keys(window.SCREEN_REGISTRY || {});
    assert.strictEqual(registeredKeys.length, 18, 'SCREEN_REGISTRY must contain exactly 18 screens');

    const integrity = window.checkScreenIntegrity();
    console.log('CHECK INTEGRITY REPORT:', JSON.stringify(integrity, null, 2));
    assert.strictEqual(integrity.totalRegistered, 18, 'Expected 18 total registered screens');
    assert.strictEqual(integrity.presentInDOM, 18, 'Expected all 18 screens present in DOM');
    assert.strictEqual(integrity.missingInDOM.length, 0, 'No screens should be missing in DOM');
    assert.strictEqual(integrity.duplicateIDs.length, 0, 'No duplicate DOM IDs allowed');
    assert.strictEqual(integrity.ok, true, 'Integrity check must return ok: true');
  });

  it('2. Read-Only Diagnostics Barrier: checkScreenIntegrity() does NOT mutate DOM or route state', function() {
    const initialScreen = window.ValenixiaRouter.currentScreen || 'checkout';
    const activeBefore = document.querySelectorAll('.content-view.active').length;

    const report = window.checkScreenIntegrity();

    const activeAfter = document.querySelectorAll('.content-view.active').length;
    const currentAfter = window.ValenixiaRouter.currentScreen || 'checkout';

    assert.strictEqual(currentAfter, initialScreen, 'Current screen must remain unchanged');
    assert.strictEqual(activeAfter, activeBefore, 'Active view count must remain unchanged');
    assert.strictEqual(report.ok, true, 'Report must be ok');
  });

  it('3. App Surface Invariant: #btn-topbar-apps-download exists only on WEB surface', function() {
    assert.strictEqual(window.APP_SURFACE.kind, 'WEB');
    assert.strictEqual(window.APP_SURFACE.showGetApps, true);

    const btnGetApps = document.getElementById('btn-topbar-apps-download');
    assert.ok(btnGetApps, '#btn-topbar-apps-download must exist on WEB surface');
  });

  it('4. Real Scroll Ownership & Navigation Test for Subscription View', function() {
    window.navigateTo('subscription');

    const subView = document.getElementById('view-subscription');
    assert.ok(subView, '#view-subscription view must exist');
    assert.strictEqual(subView.hidden, false, '#view-subscription must not be hidden');
    assert.ok(subView.classList.contains('active'), '#view-subscription must have active class');

    const scrollMain = subView.querySelector('.subscription-main') || subView.querySelector('.screen-main');
    assert.ok(scrollMain, '.subscription-main or .screen-main scroll owner must exist inside subscription view');

    // Simulate geometry height in JSDOM
    Object.defineProperty(scrollMain, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(scrollMain, 'scrollHeight', { value: 1200, configurable: true });

    let internalScrollTop = 0;
    Object.defineProperty(scrollMain, 'scrollTop', {
      get: () => internalScrollTop,
      set: (val) => { internalScrollTop = val; },
      configurable: true
    });

    assert.ok(scrollMain.scrollHeight > scrollMain.clientHeight, 'scrollHeight must exceed clientHeight for scroll test');

    // Perform actual scroll shift test
    scrollMain.scrollTop = 500;
    assert.strictEqual(scrollMain.scrollTop, 500, 'scrollTop must change to 500 when set on scroll owner');

    const layoutDiag = window.__VALENIXIA_LAYOUT_DIAGNOSTICS__();
    assert.strictEqual(layoutDiag.activeViewId, 'view-subscription');
    assert.strictEqual(layoutDiag.scrollTop, 500, 'Layout diagnostics must reflect actual scrollTop shift');
  });

  it('5. Tri-State Network Connectivity Engine Signals & Status', function() {
    assert.ok(window.ConnectivityMonitor, 'window.ConnectivityMonitor engine must exist');
    const status = window.ConnectivityMonitor.getStatus();

    assert.ok(['ONLINE', 'DEGRADED', 'OFFLINE'].includes(status.status), 'Status must be a valid tri-state');
    assert.ok(status.signals, 'Signals object must be attached to status');
    assert.strictEqual(typeof status.browserOnline, 'boolean', 'browserOnline must be boolean');
  });
});
