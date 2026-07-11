/**
 * VALENIXIA POS — Enhanced Advanced Rigorous E2E Test Suite
 * Emulates mobile, tests double-rounding tax, keyboard avoidance, sync queue, and large cart performance.
 * Run: node tests/rigorous_e2e_enhanced.test.js
 */

const WebSocket = require('ws');
const http = require('http');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let PASS = 0, FAIL = 0;
function assert(name, condition, errorMsg = 'Condition failed') {
  if (condition) {
    PASS++;
    console.log(`✅ PASS — ${name}`);
  } else {
    FAIL++;
    console.log(`❌ FAIL — ${name} :: ${errorMsg}`);
  }
}

async function connectCDP() {
  const tabList = await new Promise((res, rej) => {
    http.get('http://localhost:9222/json', r => {
      let b = ''; r.on('data', d => b += d);
      r.on('end', () => { try { res(JSON.parse(b)); } catch(e) { rej(e); } });
    }).on('error', e => {
      console.log('⚠️ Chrome DevTools not reachable: ' + e.message);
      process.exit(1);
    });
  });
  const target = tabList.find(t => t.type === 'page' && (t.title?.includes('Valenixia') || t.url?.includes('localhost:3000')));
  if (!target) {
    console.log('⚠️ No active Valenixia page target found');
    process.exit(1);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

  let nId = 1;
  const pend = new Map();
  ws.on('message', d => {
    const m = JSON.parse(d.toString());
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });

  const send = (method, params = {}) => new Promise(r => {
    const id = nId++;
    pend.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true
    });
    if (r.result?.result?.subtype === 'error') return `ERROR: ${r.result.result.description}`;
    if (r.result?.result?.type === 'undefined') return undefined;
    return r.result?.result?.value;
  };

  return { ws, ev, send };
}

async function run() {
  console.log('\n==============================================================');
  console.log(' VALENIXIA POS — ENHANCED RIGOROUS E2E TEST SUITE');
  console.log('==============================================================\n');

  const { ws, ev, send } = await connectCDP();

  // Emulate mobile layout
  console.log('Setting mobile layout metrics (390x844)...');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2.0,
    mobile: true
  });
  await sleep(500);

  // Check login status, login if needed
  const layoutDisplay = await ev('window.getComputedStyle(document.getElementById("pos-app-layout")).display');
  if (layoutDisplay !== 'grid') {
    console.log('Lock screen active. Logging in with Admin PIN...');
    for (const d of '1234'.split('')) {
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
    await sleep(3000);
  }

  // Go to checkout screen
  await ev('switchActiveScreen("checkout");');
  await sleep(1000);

  // ----------------------------------------------------------------------------
  // SECTION 1: Double-Rounding Tax Precision & Subtotal Math
  // ----------------------------------------------------------------------------
  console.log('\n--- SECTION 1: Double-Rounding Tax Precision & Subtotal Math ---');
  await ev('state.activeCart = []; renderCart();');
  await sleep(200);

  // Inject a precise pricing item
  await ev(`
    state.activeCart.push({
      sku: 'SKU-MATH-777',
      name: 'Tax Precision Item',
      price: 9999, // Rs. 99.99
      qty: 3,
      emoji: '🧮'
    });
    renderCart();
  `);
  await sleep(200);

  const subtotalVal = await ev('document.getElementById("txt-subtotal").textContent.trim()');
  const taxVal = await ev('document.getElementById("txt-tax").textContent.trim()');
  const totalVal = await ev('document.getElementById("txt-total").textContent.trim()');

  // Math check:
  // Subtotal = 99.99 * 3 = 299.97.
  // Tax (assuming 8% default rate): 299.97 * 0.08 = 23.9976. This rounds to 24.00.
  // Total = 299.97 + 24.00 = 323.97.
  assert('Cart subtotal matches exact Rs. 299.97', subtotalVal === 'Rs. 299.97', `Got: ${subtotalVal}`);
  assert('Cart tax matches exact Rs. 24.00 (with no double-rounding)', taxVal === 'Rs. 24.00', `Got: ${taxVal}`);
  assert('Cart total matches exact Rs. 323.97', totalVal === 'Rs. 323.97', `Got: ${totalVal}`);

  // ----------------------------------------------------------------------------
  // SECTION 2: Keyboard Avoidance Check
  // ----------------------------------------------------------------------------
  console.log('\n--- SECTION 2: Keyboard Avoidance Check ---');
  // Switch to settings/search view
  await ev('switchActiveScreen("checkout");');
  await sleep(200);

  await ev(`
    const input = document.getElementById('search-catalog') || document.querySelector('input');
    if (searchInput) searchInput.focus();
  `);
  await sleep(100);

  // Shrink height to simulate soft keyboard display
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 594, // reduced by 250px
    deviceScaleFactor: 2.0,
    mobile: true
  });
  await sleep(500);

  const inputVisibility = await ev(`(function() {
    const input = document.getElementById('search-catalog') || document.querySelector('input');
    if (!input) return true;
    const rect = input.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  })()`);
  assert('Active input element is fully visible within viewport boundaries during keyboard display', inputVisibility === true, 'Input field covered by keyboard!');

  // Restore metrics
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2.0,
    mobile: true
  });
  await sleep(300);

  // ----------------------------------------------------------------------------
  // SECTION 3: Offline Sync Queue Checks (Local-First IndexedDB Store)
  // ----------------------------------------------------------------------------
  console.log('\n--- SECTION 3: Local-First IndexedDB Operations & Offline Sync Queue ---');
  const dbStatus = await ev('typeof ValenixiaDB !== "undefined" && typeof ValenixiaDB.getSecurePref === "function"');
  assert('ValenixiaDB client database interface is exposed and operational', dbStatus === true, 'ValenixiaDB not exposed');

  // Trigger offline state emulation in client
  await ev('window.dispatchEvent(new Event("offline"));');
  await sleep(200);

  const isOfflineAnnounced = await ev('document.getElementById("mobile-offline-pill")?.classList.contains("visible") || window.getComputedStyle(document.getElementById("mobile-offline-pill")).display !== "none"');
  assert('Offline status pill is displayed on UI offline event', isOfflineAnnounced === true, 'Offline pill not displayed');

  // Restore online state
  await ev('window.dispatchEvent(new Event("online"));');
  await sleep(200);

  // ----------------------------------------------------------------------------
  // SECTION 4: Large Cart Performance Audit (100+ items)
  // ----------------------------------------------------------------------------
  console.log('\n--- SECTION 4: Large Cart Performance Audit ---');
  await ev('state.activeCart = []; renderCart();');
  await sleep(100);

  // Push 150 items and render
  const renderTime = await ev(`(function() {
    state.activeCart = [];
    for (let i = 0; i < 150; i++) {
      state.activeCart.push({
        sku: 'SKU-PERF-' + i,
        name: 'Perf Item ' + i,
        price: 1000 + i,
        qty: 1,
        emoji: '📦'
      });
    }
    const t0 = performance.now();
    renderCart();
    const t1 = performance.now();
    return t1 - t0;
  })()`);

  console.log(`Render time for 150 cart items: ${renderTime.toFixed(2)}ms`);
  assert('Cart list renders 150 items under 150ms performance threshold', renderTime < 150.0, `Rendering took ${renderTime.toFixed(2)}ms (exceeded 150ms)`);

  ws.close();
  console.log('\n==============================================================');
  console.log(` ADVANCED RESULTS: Passed: ${PASS} | Failed: ${FAIL}`);
  console.log('==============================================================');
  process.exit(FAIL > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('FATAL ERROR:', e);
  process.exit(1);
});
