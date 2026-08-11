// ============================================================================
// VALENIXIA COMMERCE POS — Permanent Screen Shells & Atomic Visibility Test
// Verifies permanent mounting of all view shells in #app-screen-root and
// strict 0x0 rendered geometry / hidden attributes for inactive views.
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

async function runRenderedGeometryTests() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  VALENIXIA POS — Permanent Screen Shell Geometry Audit');
  console.log('══════════════════════════════════════════════════\n');

  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  const cssPath = path.join(__dirname, '..', 'public', 'style.css');
  const compCssPath = path.join(__dirname, '..', 'public', 'styles', 'components.css');
  const bootJsPath = path.join(__dirname, '..', 'public', 'bootstrap-init.js');
  const routerJsPath = path.join(__dirname, '..', 'public', 'router.js');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8') + '\n' + fs.readFileSync(compCssPath, 'utf8');
  const bootJs = fs.readFileSync(bootJsPath, 'utf8');
  const routerJs = fs.readFileSync(routerJsPath, 'utf8');

  const dom = new JSDOM(html, {
    url: 'https://valenixia-pos.vercel.app/',
    runScripts: 'dangerously',
    resources: 'usable'
  });

  const { window } = dom;
  const { document } = window;

  // Mock offset dimensions for JSDOM
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { get() { return this.style.display === 'none' || this.hidden ? 0 : 1024; } });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { get() { return this.style.display === 'none' || this.hidden ? 0 : 768; } });
  window.HTMLElement.prototype.getBoundingClientRect = function() {
    if (!this.ownerDocument.body.contains(this) || this.style.display === 'none' || this.hidden) {
      return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({ width: 0, height: 0 }) };
    }
    return { width: 1024, height: 768, top: 0, left: 0, right: 1024, bottom: 768, x: 0, y: 0, toJSON: () => ({ width: 1024, height: 768 }) };
  };

  // Inject CSS
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // Evaluate router.js and bootstrap-init.js in window context
  window.eval(routerJs);
  window.eval(bootJs);

  window.ValenixiaRouter.init();

  let passed = 0;
  let failed = 0;

  function auditRouteGeometry(screenId, screenName) {
    window.ValenixiaRouter.navigateTo(screenId);

    const root = document.getElementById('app-screen-root');
    const rootChildren = Array.from(root.querySelectorAll('.content-view'));
    const targetId = screenId.startsWith('view-') ? screenId : 'view-' + screenId;

    const targetViewInRoot = root.querySelector('#' + targetId);
    const checkoutViewInRoot = root.querySelector('#view-checkout');

    const targetRect = targetViewInRoot ? targetViewInRoot.getBoundingClientRect() : { width: 0, height: 0 };
    const checkoutRect = checkoutViewInRoot ? checkoutViewInRoot.getBoundingClientRect() : { width: 0, height: 0 };

    try {
      // 1. Verify permanent shell existence
      assert.strictEqual(targetViewInRoot !== null, true, `Route /${screenId}: Target view '${targetId}' missing from DOM!`);
      assert.strictEqual(targetRect.width > 0 && targetRect.height > 0, true, `Route /${screenId}: Active view rect is 0x0!`);
      assert.strictEqual(targetViewInRoot.hidden, false, `Route /${screenId}: Active view has hidden attribute!`);
      assert.strictEqual(targetViewInRoot.classList.contains('active'), true, `Route /${screenId}: Active view missing .active class!`);

      // 2. Verify inactive views have display: none, hidden = true, and 0x0 rects
      if (screenId !== 'checkout' && screenId !== 'view-checkout') {
        assert.strictEqual(checkoutViewInRoot !== null, true, `Route /${screenId}: Checkout shell missing from DOM!`);
        assert.strictEqual(checkoutViewInRoot.hidden, true, `Route /${screenId}: Inactive checkout view missing hidden attribute!`);
        assert.strictEqual(checkoutViewInRoot.getAttribute('aria-hidden'), 'true', `Route /${screenId}: Inactive checkout view missing aria-hidden!`);
        assert.strictEqual(checkoutViewInRoot.inert, true, `Route /${screenId}: Inactive checkout view is not inert!`);
        assert.strictEqual(checkoutRect.width, 0, `Route /${screenId}: Checkout width > 0 on non-checkout route!`);
        assert.strictEqual(checkoutRect.height, 0, `Route /${screenId}: Checkout height > 0 on non-checkout route!`);
      }

      // 3. Single visible view invariant assertion
      assert.strictEqual(window.assertSingleVisibleView(screenId), true, `Route /${screenId}: assertSingleVisibleView failed!`);

      console.log(`  ✅ Route /${screenId.replace('view-', '')} (${screenName}) -> Permanent Shells: ${rootChildren.length} | Active Rect: ${targetRect.width}x${targetRect.height} | Inactive Checkout Rect: ${checkoutRect.width}x${checkoutRect.height} | Invariant Check: PASSED`);
      passed++;
    } catch (err) {
      console.error(`  ❌ Route /${screenId} FAILED:`, err.message);
      failed++;
    }
  }

  const routes = [
    { id: 'checkout', name: 'Checkout' },
    { id: 'catalog', name: 'Quick Catalog' },
    { id: 'catalog-manager', name: 'Inventory Catalog' },
    { id: 'deals', name: 'Deals & Combos' },
    { id: 'history', name: 'Sales Log' },
    { id: 'customers', name: 'Customer Directory' },
    { id: 'analytics', name: 'Analytics & Kamai' },
    { id: 'suppliers', name: 'Suppliers' },
    { id: 'staff', name: 'Staff Management' },
    { id: 'credit-book', name: 'Credit Book' },
    { id: 'settings', name: 'Settings' },
    { id: 'logs', name: 'Sync Audit Logs' },
    { id: 'subscription', name: 'Subscription Vault' }
  ];

  console.log('▶ Auditing Permanent Mounted Shells & Atomic Visibility:');
  routes.forEach(r => auditRouteGeometry(r.id, r.name));

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runRenderedGeometryTests().catch(err => {
  console.error('Fatal rendered geometry test error:', err);
  process.exit(1);
});
