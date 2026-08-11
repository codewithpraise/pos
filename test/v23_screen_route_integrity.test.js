// ============================================================================
// VALENIXIA COMMERCE POS — Route Matrix & DOM Screen Integrity Tests
// Verifies that exactly 1 screen is visible per route and Checkout NEVER
// overlaps non-checkout screens.
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

async function runRouteIntegrityTests() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  VALENIXIA POS — Route & Screen Integrity Matrix');
  console.log('══════════════════════════════════════════════════\n');

  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  const cssPath = path.join(__dirname, '..', 'public', 'style.css');
  const compCssPath = path.join(__dirname, '..', 'public', 'styles', 'components.css');
  const bootJsPath = path.join(__dirname, '..', 'public', 'bootstrap-init.js');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8') + '\n' + fs.readFileSync(compCssPath, 'utf8');
  const bootJs = fs.readFileSync(bootJsPath, 'utf8');

  const dom = new JSDOM(html, {
    url: 'https://valenixia-pos.vercel.app/',
    runScripts: 'dangerously',
    resources: 'usable'
  });

  const { window } = dom;
  const { document } = window;

  // Inject styles into DOM head
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // Evaluate bootstrap-init.js in window scope
  window.eval(bootJs);

  let passed = 0;
  let failed = 0;

  function testRoute(screenId, expectedName) {
    if (typeof window.switchActiveScreen === 'function') {
      window.switchActiveScreen(screenId);
    } else {
      throw new Error('window.switchActiveScreen is not defined!');
    }

    const targetId = screenId.startsWith('view-') ? screenId : 'view-' + screenId;
    const allViews = Array.from(document.querySelectorAll('.content-view'));
    const activeViews = allViews.filter(v => v.classList.contains('active'));
    const visibleViews = allViews.filter(v => v.style.display !== 'none');
    const checkoutView = document.getElementById('view-checkout');
    const isCheckoutVisible = checkoutView && checkoutView.style.display !== 'none' && checkoutView.classList.contains('active');

    try {
      assert.strictEqual(activeViews.length, 1, `Route ${screenId}: Expected exactly 1 active view class, got ${activeViews.length}`);
      assert.strictEqual(visibleViews.length, 1, `Route ${screenId}: Expected exactly 1 visible view, got ${visibleViews.length}`);
      assert.strictEqual(visibleViews[0].id, targetId, `Route ${screenId}: Active visible view ID ${visibleViews[0].id} does not match expected target ${targetId}`);

      if (screenId !== 'checkout' && screenId !== 'view-checkout') {
        assert.strictEqual(isCheckoutVisible, false, `Route ${screenId}: Checkout view is VISIBLE when user is on ${expectedName}!`);
      }

      console.log(`  ✅ Route /${screenId.replace('view-', '')} (${expectedName}) -> Active: ${visibleViews[0].id} | Checkout Visible: NO | Single View: YES`);
      passed++;
    } catch (err) {
      console.error(`  ❌ Route /${screenId} FAILED:`, err.message);
      failed++;
    }
  }

  const routeMatrix = [
    { id: 'checkout', name: 'Checkout' },
    { id: 'catalog', name: 'Quick Catalog' },
    { id: 'catalog-manager', name: 'Inventory Catalog' },
    { id: 'deals', name: 'Deals & Combos' },
    { id: 'history', name: 'Sales Log' },
    { id: 'customers', name: 'Customer Directory' },
    { id: 'analytics', name: 'Analytics & Kamai' },
    { id: 'suppliers', name: 'Suppliers' },
    { id: 'staff', name: 'Staff Management' },
    { id: 'credit-book', name: 'Credit Book (Udhaar)' },
    { id: 'settings', name: 'Settings' },
    { id: 'logs', name: 'Sync Audit Logs' },
    { id: 'subscription', name: 'Subscription Vault' }
  ];

  console.log('▶ Testing Screen Route Matrix:');
  routeMatrix.forEach(r => testRoute(r.id, r.name));

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runRouteIntegrityTests().catch(err => {
  console.error('Fatal route integrity test error:', err);
  process.exit(1);
});
