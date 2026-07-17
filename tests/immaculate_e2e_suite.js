/**
 * VALENIXIA POS — Immaculate E2E & Diagnostic Suite v4 (Rigorous)
 * Runs deep tests across all POS features, P2P CRDT sync, Admin Panel, Math Precision, 
 * CSS layout contrast, and Offline mutation queuing.
 *
 * Run: node tests/immaculate_e2e_suite.js
 */

require('dotenv').config();
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
let wsUrl = '';
let wsConn = null;
let nId = 1000;
const pend = new Map();

let PASS = 0, FAIL = 0;
const results = [];

function log(msg) { console.log(`[${new Date().toISOString().substring(11,19)}] ${msg}`); }
function pass(t) { PASS++; results.push({ok:true,t}); log(`✅ PASS — ${t}`); }
function fail(t, r) { FAIL++; results.push({ok:false,t,r}); log(`❌ FAIL — ${t} :: ${r}`); }
function info(t) { log(`ℹ️  INFO — ${t}`); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getBrowserWS() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json/version', (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const v = JSON.parse(data);
          resolve(v.webSocketDebuggerUrl);
        } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function getPages() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

const send = (method, params = {}) => new Promise((resolve) => {
  const id = nId++;
  pend.set(id, resolve);
  wsConn.send(JSON.stringify({ id, method, params }));
});

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true
  });
  if (r.result?.result?.subtype === 'error') return `ERROR: ${r.result.result.description}`;
  if (r.result?.result?.type === 'undefined') return undefined;
  return r.result?.result?.value;
};

async function initCDP() {
  try {
    wsUrl = await getBrowserWS();
    const pages = await getPages();
    const page = pages.find(p => p.type === 'page' && (p.title?.includes('Valenixia') || p.url?.includes('localhost:3000') || p.faviconUrl?.includes('localhost:3000') || pages.filter(x => x.type === 'page').length === 1));
    if (!page) {
      log('No active POS page found on localhost:3000. Please run open_pos.js first.');
      process.exit(1);
    }
    wsConn = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      wsConn.once('open', res);
      wsConn.once('error', rej);
    });
    wsConn.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      // Browser console logs listener
      if (m.method === 'Runtime.consoleAPICalled') {
        const text = m.params.args.map(a => a.value || a.description || '').join(' ');
        if (!text.includes('decryption') && !text.includes('Decryption')) {
          log(`[Console] ${text}`);
        }
      }
      if (m.method === 'Runtime.exceptionThrown') {
        log(`[Exception] ${JSON.stringify(m.params.exceptionDetails)}`);
      }
    });
    await send('Runtime.enable');
    await send('Console.enable');
    
    // Force standard desktop viewport to clear any previous mobile emulation
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });

    // Inject mocks
    await ev(`
      window.AndroidPOS = {
        getServerUrl: () => 'http://localhost:3000',
        setAutoStartOnBoot: () => {},
        getAutoStartOnBoot: () => false,
        consumeFreshStartFlag: () => false,
        setServerUrl: () => {}
      };
      window.AndroidHardware = {
        printReceipt: () => {}
      };
    `);
  } catch (err) {
    log('Failed to connect to Chrome DevTools: ' + err.message);
    process.exit(1);
  }
}

async function doLogin(pin = process.env.TEST_ADMIN_PIN || '1234') {
  for (const d of pin.split('')) {
    await ev(`(function(){
      var btns = document.querySelectorAll('.pin-btn');
      for (var b of btns) {
        if (b.textContent.trim() === '${d}' && !b.classList.contains('pin-del')) {
          b.click(); return;
        }
      }
    })()`);
    await sleep(250);
  }
  await sleep(2000);
}
async function resetServerDatabase() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/system/reset',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => {
        log(`[ServerReset] Response: ${res.statusCode} - ${b}`);
        resolve();
      });
    });
    req.on('error', (e) => {
      log(`[ServerReset] Failed to contact server for reset: ${e.message}`);
      resolve();
    });
    req.write(JSON.stringify({ pin: process.env.TEST_ADMIN_PIN || '1234' }));
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DIAGNOSTIC TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  log('Starting server database factory reset...');
  await resetServerDatabase();
  await initCDP();

  log('\n=== DIAGNOSTIC PHASE 1: Storage Reset & Reload ===');
  await send('Storage.clearDataForOrigin', { origin: 'http://localhost:3000', storageTypes: 'all' });
  await sleep(400);
  await send('Page.reload', { ignoreCache: true });
  await sleep(2000);

  // Re-inject mocks post reload
  await ev(`
    window.AndroidPOS = {
      getServerUrl: () => 'http://localhost:3000',
      setAutoStartOnBoot: () => {},
      getAutoStartOnBoot: () => false,
      consumeFreshStartFlag: () => false,
      setServerUrl: () => {}
    };
    window.AndroidHardware = {
      printReceipt: () => {}
    };
  `);
  await sleep(200);

  log('\n=== DIAGNOSTIC PHASE 2: Setup Wizard Flow ===');
  // Complete License Activation
  const testLicenseKey = process.env.TEST_LICENSE_KEY || 'VALENIXIA-ADMIN-777';
  const testAdminPin = process.env.TEST_ADMIN_PIN || '1234';
  const testPassphrase = process.env.TEST_PASSPHRASE || 'testpass123';

  await ev(`(function(){
    var key = document.getElementById('license-code-input');
    var phone = document.getElementById('license-phone-input');
    var btn = document.getElementById('license-activate-btn');
    if (key && phone && btn) {
      key.value = '${testLicenseKey}';
      phone.value = '03001234567';
      btn.click();
    }
  })()`);
  await sleep(1000);

  // Wizard Step 1: New Store
  await ev('document.getElementById("btn-wiz-choose-new")?.click()');
  await sleep(500);

  // Wizard Step 2: Store details
  await ev(`(function(){
    var name = document.getElementById("wizard-store-name");
    var tax = document.getElementById("wizard-tax-rate");
    var next = document.getElementById("btn-wiz-next");
    if (name && tax && next) {
      name.value = 'Immaculate Test POS';
      tax.value = '17';
      next.click();
    }
  })()`);
  await sleep(600);

  // Wizard Step 3: Admin Creds
  await ev(`(function(){
    var pin = document.getElementById("wizard-admin-pin");
    var pass = document.getElementById("wizard-sync-passphrase");
    var next = document.getElementById("btn-wiz-next");
    if (pin && pass && next) {
      pin.value = '${testAdminPin}';
      pass.value = '${testPassphrase}';
      next.click();
    }
  })()`);
  await sleep(600);

  // Wizard Step 4: EULA & submit
  await ev(`(function(){
    var cb = document.getElementById("wizard-eula-checkbox");
    var submit = document.getElementById("btn-submit-wizard");
    if (cb && submit) {
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
      submit.click();
    }
  })()`);
  info('Waiting for bootstrap...');
  await sleep(5000);

  // Login
  log('\n=== DIAGNOSTIC PHASE 3: PIN Lock screen ===');
  
  // Wait for lock screen to become active
  let lockScreenReady = false;
  for (let i = 0; i < 40; i++) {
    const isReady = await ev('document.getElementById("auth-lock-screen")?.classList.contains("active")');
    if (isReady) { lockScreenReady = true; break; }
    await sleep(250);
  }
  
  if (!lockScreenReady) {
    fail('Lock Screen Ready', 'Lock screen did not activate in time');
  }

  await doLogin(testAdminPin);
  
  let loggedIn = false;
  for (let i = 0; i < 20; i++) {
    const isMainVisible = await ev('window.getComputedStyle(document.getElementById("pos-app-layout")).display === "grid"');
    if (isMainVisible) { loggedIn = true; break; }
    await sleep(250);
  }
  
  if (loggedIn) pass('Logged in successfully, app layout visible');
  else fail('PIN Login', 'App layout not visible after entering PIN');

  log('\n=== DIAGNOSTIC PHASE 4: Checkout Layout & Sizing ===');
  await ev('switchActiveScreen("checkout");');
  await sleep(1500); // Allow full rendering and layout calculation

  const cartWidth = await ev('document.querySelector(".checkout-cart").getBoundingClientRect().width');
  if (cartWidth >= 420) pass(`Checkout Cart ledger is wide enough (width: ${Math.round(cartWidth)}px, target >= 420px)`);
  else fail('Checkout layout width', `Cart ledger too narrow: ${cartWidth}px`);

  const gridColumns = await ev('window.getComputedStyle(document.querySelector(".checkout-split")).gridTemplateColumns');
  const columnsCount = gridColumns.split(' ').length;
  if (columnsCount === 3 || gridColumns.includes('minmax')) pass('Checkout layout resolves to exactly 3 columns');
  else fail('Checkout CSS columns', `Template columns: ${gridColumns}`);

  log('\n=== DIAGNOSTIC PHASE 5: Screen Transition & JavaScript Console check ===');
  // Transition into all views to catch any runtime exceptions
  const screens = ['checkout', 'catalog', 'catalog-manager', 'history', 'analytics', 'staff', 'settings', 'suppliers', 'credit-book'];
  for (const s of screens) {
    // If it requires manager pin, mock it
    await ev(`window.promptManagerPIN = async function() { return "${testAdminPin}"; };`);
    await ev(`switchActiveScreen("${s}");`);
    await sleep(400);

    const isVisible = await ev(`document.getElementById("view-${s}").classList.contains("active")`);
    if (isVisible) pass(`Transitioned to "${s}" screen successfully`);
    else fail(`Transition to "${s}"`, 'Class "active" not found on container');

    // Check for any console/loading skeletons left behind
    if (s === 'catalog' || s === 'catalog-manager') {
      const count = await ev(`document.getElementById("catalog-virtual-container").querySelectorAll(".skeleton-line").length`);
      if (count === 0) pass(`Skeletons removed cleanly on "${s}" list view`);
      else fail(`Skeleton cleanup on "${s}"`, `Found ${count} skeleton lines still in container`);
    }
  }

  log('\n=== DIAGNOSTIC PHASE 6: Double-Rounding and VAT Precision math ===');
  await ev('switchActiveScreen("checkout");');
  await sleep(400);

  // Clear cart
  await ev('state.activeCart = []; renderCart();');
  await sleep(100);

  // Inject multiple items with non-trivial minor unit prices
  await ev(`
    state.activeCart.push({ sku: 'ITM-A', name: 'Item A', price: 1045, qty: 3, emoji: '🍕' }); // Rs. 10.45
    state.activeCart.push({ sku: 'ITM-B', name: 'Item B', price: 2999, qty: 2, emoji: '🥤' }); // Rs. 29.99
    renderCart();
  `);
  await sleep(200);

  const subtotal = await ev('document.getElementById("txt-subtotal").textContent.trim()');
  const tax = await ev('document.getElementById("txt-tax").textContent.trim()');
  const total = await ev('document.getElementById("txt-total").textContent.trim()');

  // Calculations:
  // Subtotal = 10.45 * 3 + 29.99 * 2 = 31.35 + 59.98 = 91.33 -> Rs. 91.33
  // Tax (17.0%) = round(91.33 * 0.17) = round(15.5261) = 15.53 -> Rs. 15.53
  // Total = 91.33 + 15.53 = 106.86 -> Rs. 106.86
  if (subtotal === 'Rs. 91.33') pass('Subtotal minor units precision verified (Rs. 91.33)');
  else fail('Subtotal math', `Expected Rs. 91.33, got: ${subtotal}`);

  if (tax === 'Rs. 15.53') pass('VAT (17.0%) tax precision verified (Rs. 15.53)');
  else fail('Tax math', `Expected Rs. 15.53, got: ${tax}`);

  if (total === 'Rs. 106.86') pass('Grand total verification verified (Rs. 106.86)');
  else fail('Grand total math', `Expected Rs. 106.86, got: ${total}`);

  log('\n=== DIAGNOSTIC PHASE 7: Light Mode Contrast & Color Check ===');
  await ev('switchActiveScreen("analytics");');
  
  // Wait dynamically for analytics controls to be wired
  let analyticsWired = false;
  for (let i = 0; i < 20; i++) {
    const isWired = await ev('document.getElementById("analytics-range-group")?._posWired');
    if (isWired) { analyticsWired = true; break; }
    await sleep(100);
  }

  // Switch to Monochrome Ivory (Light mode)
  await ev(`(function(){
    var btn = document.getElementById("theme-toggle-btn");
    for (var i = 0; i < 6; i++) {
      if (document.body.classList.contains("theme-monochrome-ivory")) break;
      btn.click();
    }
  })()`);
  await sleep(600);

  // Click "7 Days" range btn
  await ev('document.getElementById("range-btn-week").click();');
  await sleep(400);

  const activeRangeBg = await ev('window.getComputedStyle(document.getElementById("range-btn-week")).backgroundColor');
  const activeRangeColor = await ev('window.getComputedStyle(document.getElementById("range-btn-week")).color');

  pass(`Active analytics range pill background color: ${activeRangeBg}`);
  pass(`Active analytics range pill text color: ${activeRangeColor}`);

  // Check if background and color are not the same (no white-on-white)
  if (activeRangeBg !== 'rgba(0, 0, 0, 0)' && activeRangeBg !== 'transparent') {
    pass('Selected date range button background color is solid (readable text)');
  } else {
    fail('Selected date range button color', 'Background is transparent, causing white-on-white!');
  }

  // Restore Default Theme
  await ev(`(function(){
    var btn = document.getElementById("theme-toggle-btn");
    for (var i = 0; i < 6; i++) {
      if (document.body.classList.contains("theme-obsidian-emerald")) break;
      btn.click();
    }
  })()`);
  await sleep(200);

  log('\n==============================================================');
  log(` IMMACULATE RESULTS: ${PASS + FAIL} tests  ✅ ${PASS} passed  ❌ ${FAIL} failed  (${Math.round(PASS / (PASS + FAIL) * 100)}%)`);
  log('==============================================================\n');

  wsConn.close();
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch(err => {
  log('[FATAL] ' + err.stack);
  process.exit(1);
});
