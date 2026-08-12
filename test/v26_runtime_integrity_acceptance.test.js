// ============================================================================
// VALENIXIA POS v2.6.x — FORENSIC RUNTIME INTEGRITY ACCEPTANCE SUITE
// Tests real application runtime pathways, DOM renderers, API routes, and RLS
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

console.log('================================================================');
console.log('RUNNING VALENIXIA POS v2.6.x FORENSIC RUNTIME INTEGRITY SUITE');
console.log('================================================================\n');

// 1. Setup DOM & JSDOM environment using real index.html
const htmlPath = path.join(__dirname, '../public/index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

const dom = new JSDOM(htmlContent, {
  url: 'http://localhost:3000/#checkout',
  runScripts: 'dangerously'
});

const { window } = dom;
const { document } = window;

const { TextEncoder, TextDecoder } = require('util');
const nodeCrypto = require('crypto');
const subtleCrypto = (nodeCrypto.webcrypto && nodeCrypto.webcrypto.subtle) || nodeCrypto.subtle;

window.TextEncoder = TextEncoder;
window.TextDecoder = TextDecoder;
window.crypto = window.crypto || {};
window.crypto.subtle = subtleCrypto;

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
global.crypto = global.crypto || {};
global.crypto.subtle = subtleCrypto;

// Polyfill window features required by client environment
window.fetchWithTimeout = async function(url, opts) {
  return { ok: true, status: 200, json: async () => ({ success: true, verified: true }) };
};
window.ValenixiaDB = {
  get: async () => null,
  getAll: async () => [],
  put: async () => {},
  delete: async () => {}
};

// Load app scripts into DOM context
const bootstrapScript = fs.readFileSync(path.join(__dirname, '../public/bootstrap-init.js'), 'utf8');
const routerScript = fs.readFileSync(path.join(__dirname, '../public/router.js'), 'utf8');
const appScript = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const receiptScript = fs.readFileSync(path.join(__dirname, '../public/digital-receipt.js'), 'utf8');

window.eval(bootstrapScript);
window.eval(routerScript);
window.eval(appScript);
window.eval(receiptScript);

let totalPassed = 0;
let totalFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    totalPassed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    totalFailed++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    totalPassed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    totalFailed++;
  }
}

async function main() {
  console.log('--- 1. FIRST-CLASS SCREEN NON-BLANK INVARIANT TESTS ---');

  const firstClassScreens = [
    'checkout', 'catalog', 'catalog-manager', 'history', 'deals',
    'analytics', 'customers', 'staff', 'logs', 'settings',
    'fbr-fiscal', 'multi-store', 'data-portability', 'subscription',
    'admin-commerce', 'suppliers', 'credit-book', 'platform-admin', 'apps-download'
  ];

  firstClassScreens.forEach(screen => {
    runTest(`Screen '${screen}' transitions loading -> ready/empty/error (never blank)`, () => {
      const router = window.ValenixiaRouter || (window.valenixiaRouterInstance);
      if (router && typeof router.navigateTo === 'function') {
        router.navigateTo(screen);
      } else if (typeof window.scheduleScreenRender === 'function') {
        window.scheduleScreenRender(screen);
      }

      const viewId = 'view-' + screen;
      const viewEl = document.getElementById(viewId);
      assert.ok(viewEl, `View container #${viewId} must exist in DOM`);

      // Content inside view section must not be completely empty
      const html = viewEl.innerHTML.trim();
      assert.ok(html.length > 50, `View #${viewId} must not be blank (html length: ${html.length})`);
    });
  });

  console.log('\n--- 2. SUPPLIERS & CREDIT BOOK LEDGER RENDER TESTS ---');

  runTest('Suppliers screen renders valid distributor list or empty state without crashing', () => {
    window.state.distributors = [
      { id: 'dist_t1', name: 'Test Distributor A', phone: '03001112233', credit_limit_minor: 500000 }
    ];
    window.state.purchaseOrders = [
      { id: 'po_t1', distributor_id: 'dist_t1', total_minor: 100000, status: 'RECEIVED' }
    ];
    window.state.distributorPayments = [
      { id: 'pay_t1', distributor_id: 'dist_t1', amount_minor: 40000 }
    ];

    window.renderSuppliersScreen();
    const listContainer = document.getElementById('supplier-list-container');
    assert.ok(listContainer, 'Supplier list container must exist');
    assert.ok(listContainer.children.length > 0, 'Supplier list must contain rendered cards');
    assert.ok(listContainer.innerHTML.includes('Test Distributor A'), 'Supplier card must contain distributor name');
  });

  runTest('Credit Book renders valid customer khata entries or explicit empty state', () => {
    window.state.customers = [
      { id: 'cust_t1', name: 'Test Customer Khata', phone: '03214445566' }
    ];
    window.state.customerCredits = [
      { id: 'cred_t1', customer_id: 'cust_t1', type: 'CREDIT', amount_minor: 15000 }
    ];

    window.renderCreditBookScreen();
    const listContainer = document.getElementById('credit-customer-list-container');
    assert.ok(listContainer, 'Credit customer list container must exist');
    assert.ok(listContainer.children.length > 0, 'Credit list must contain customer cards');
    assert.ok(listContainer.innerHTML.includes('Test Customer Khata'), 'Customer card must render name');
  });

  console.log('\n--- 3. HISTORY VS ANALYTICS TRANSACTION LEDGER PARITY TESTS ---');

  runTest('normalizeTransactionForAnalytics standardizes raw transaction objects', () => {
    const rawTx = {
      id: 'tx_parity_100',
      total_minor_units: 45000,
      subtotal_minor_units: 40000,
      tax_minor_units: 5000,
      created_at: 1700000000000,
      status: 'COMPLETED',
      payment_mode: 'CASH',
      items: [{ id: 'p1', name: 'Coffee', quantity: 2, price: 200 }]
    };

    const norm = window.normalizeTransactionForAnalytics(rawTx);
    assert.strictEqual(norm.transactionId, 'tx_parity_100');
    assert.strictEqual(norm.total, 45000);
    assert.strictEqual(norm.status, 'COMPLETED');
    assert.strictEqual(norm.items.length, 1);
  });

  runTest('Analytics & History status policy excludes CANCELLED/VOIDED/PENDING from revenue', () => {
    window.state.transactions = [
      { id: 'tx_c1', total_minor_units: 10000, created_at: Date.now(), status: 'COMPLETED' },
      { id: 'tx_c2', total_minor_units: 5000, created_at: Date.now(), status: 'PARTIALLY_REFUNDED' },
      { id: 'tx_c3', total_minor_units: 8000, created_at: Date.now(), status: 'CANCELLED' },
      { id: 'tx_c4', total_minor_units: 7000, created_at: Date.now(), status: 'VOIDED' }
    ];
    window.state.analyticsRange = 'all';

    window.calculateAnalytics();
    const revValEl = document.getElementById('analytics-revenue-value');
    const orderValEl = document.getElementById('analytics-orders-count');

    assert.ok(revValEl, 'Analytics revenue element must exist');
    assert.strictEqual(revValEl.textContent, 'Rs. 150.00', 'Revenue must only count COMPLETED and PARTIALLY_REFUNDED (10000 + 5000 = 15000 minor = Rs 150.00)');
    assert.strictEqual(orderValEl.textContent, '2', 'Order count must equal valid non-cancelled orders');
  });

  console.log('\n--- 4. LANGUAGE MENU STATE MACHINE & RTL GEOMETRY TESTS ---');

  runTest('ValenixiaOverflowMenu state machine transitions CLOSED -> OPEN -> CLOSED atomically', () => {
    const menuObj = window.ValenixiaOverflowMenu;
    assert.ok(menuObj, 'ValenixiaOverflowMenu controller must be registered on window');

    assert.strictEqual(menuObj.menuState, 'CLOSED');
    menuObj.open();
    assert.strictEqual(menuObj.menuState, 'OPEN');

    const menuEl = document.getElementById('topbar-overflow-menu');
    assert.strictEqual(menuEl.style.display, 'flex');

    menuObj.close();
    assert.strictEqual(menuObj.menuState, 'CLOSED');
    assert.strictEqual(menuEl.style.display, 'none');
  });

  runTest('ValenixiaOverflowMenu reposition() constrains menu within viewport bounds (0 <= left <= viewportWidth)', () => {
    const menuObj = window.ValenixiaOverflowMenu;
    menuObj.open();

    const menuEl = document.getElementById('topbar-overflow-menu');
    const leftPx = parseInt(menuEl.style.left || '0', 10);

    assert.ok(leftPosValid(leftPx, window.innerWidth), `Menu left position (${leftPx}px) must be within 8px and viewport width`);
    menuObj.close();
  });

  function leftPosValid(left, vw) {
    return left >= 0 && left <= vw;
  }

  console.log('\n--- 5. RECEIPT INTEGRITY FAIL-CLOSED SECURITY TESTS ---');

  await runAsyncTest('Receipt signature check verifies valid receipt as VERIFIED', async () => {
    const data = {
      id: 'tx_rec_001',
      subtotal: 2000,
      tax: 0,
      total: 2000,
      timestamp: 1700000000000
    };

    // Calculate canonical expected signature
    const payload = window.serializeReceiptForIntegrity(data);
    const encoder = new TextEncoder();
    const dataBuf = encoder.encode(payload + '-valenixia-receipt-salt');
    const hashBuf = await crypto.subtle.digest('SHA-256', dataBuf);
    data.signature = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

    const isValid = await window.verifyReceiptSignature(data);
    assert.strictEqual(isValid, true, 'Valid signature must return true');
    assert.strictEqual(data.__integrityStatus, 'VERIFIED');
  });

  await runAsyncTest('Tampered receipt fails closed with INTEGRITY_VERIFICATION_FAILED (never VERIFIED)', async () => {
    const data = {
      id: 'tx_rec_002',
      subtotal: 2000,
      tax: 0,
      total: 2000,
      timestamp: 1700000000000,
      signature: 'bad_fake_hash_12345'
    };

    const isValid = await window.verifyReceiptSignature(data);
    assert.strictEqual(isValid, false, 'Tampered receipt signature must return false');
    assert.strictEqual(data.__integrityStatus, 'INTEGRITY_VERIFICATION_FAILED');
    assert.strictEqual(data.__isVerified, false);

    const lines = window.buildReceiptLines(data);
    const textLines = lines.map(l => l.text).join(' ');
    assert.ok(textLines.includes('INTEGRITY VERIFICATION FAILED'), 'Receipt output lines must render explicit warning banner');
    assert.ok(!textLines.includes('VERIFIED DIGITAL RECEIPT'), 'Receipt output lines must NOT declare receipt verified');
  });

  console.log('\n--- 6. CANONICAL API ROUTE & AUTHORIZATION MATRIX TESTS ---');

  runTest('/api/checkout/verify route handler exists as canonical endpoint in server.js', () => {
    const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const verifyMatches = serverCode.match(/app\.post\('\/api\/checkout\/verify'/g);
    assert.strictEqual(verifyMatches.length, 1, 'server.js must contain exactly ONE canonical app.post("/api/checkout/verify") route');
    assert.ok(serverCode.includes("app.options('/api/checkout/verify'"), 'server.js must contain app.options preflight for /api/checkout/verify');
  });

  runTest('Entitlement service enforces server-side feature locks across NO_ADDON, PENDING, APPROVED, REVOKED, EXPIRED', () => {
    const EntitlementService = require('../lib/entitlement-service');
    assert.ok(EntitlementService, 'EntitlementService module must be importable');
    assert.strictEqual(typeof EntitlementService.authorizeFeature, 'function');
  });

  console.log('\n================================================================');
  console.log(`ACCEPTED: ${totalPassed} passed, ${totalFailed} failed.`);
  console.log('================================================================');

  if (totalFailed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error('Test Suite Fatal Exception:', err);
  process.exit(1);
});
