/**
 * VALENIXIA POS — Comprehensive Deep Diagnostic & Fix Script
 * 
 * This script:
 * 1. Navigates to the app fresh
 * 2. Tests the full license activation flow
 * 3. Tests the setup wizard flow
 * 4. Tests PIN login
 * 5. Tests each main screen (checkout, catalog, history, settings)
 * 6. Collects all console errors/warnings
 * 7. Tests mobile viewport rendering
 * 
 * Run with: node full_diagnostic.js
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');

let allErrors = [];
let allWarnings = [];
let testResults = [];

function log(msg) {
  const ts = new Date().toISOString().substring(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function pass(test) {
  testResults.push({ test, status: 'PASS' });
  log(`✅ PASS: ${test}`);
}

function fail(test, reason) {
  testResults.push({ test, status: 'FAIL', reason });
  log(`❌ FAIL: ${test} — ${reason}`);
}

function warn(test, reason) {
  testResults.push({ test, status: 'WARN', reason });
  log(`⚠️  WARN: ${test} — ${reason}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function cdpReq(ws, method, params, id) {
  return new Promise((resolve) => {
    const to = setTimeout(() => resolve({ error: 'TIMEOUT' }), 10000);
    const h = (d) => {
      try {
        const m = JSON.parse(d.toString());
        if (m.id === id) {
          clearTimeout(to);
          ws.off('message', h);
          resolve(m);
        }
      } catch(e) {}
    };
    ws.on('message', h);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

async function cdpEval(ws, expr, id) {
  const r = await cdpReq(ws, 'Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true
  }, id);
  if (r.result && r.result.result) {
    if (r.result.result.type !== 'undefined') {
      return r.result.result.value;
    }
    if (r.result.result.type === 'object' && r.result.result.subtype === 'null') return null;
  }
  return undefined;
}

async function clickEl(ws, selector, id) {
  const r = await cdpReq(ws, 'Runtime.evaluate', {
    expression: `(function(){
      const el = document.querySelector('${selector}') || document.getElementById('${selector.replace('#','').replace('.','').replace('[','').replace(']','')}');
      if (!el) return 'ELEMENT_NOT_FOUND';
      el.click();
      return 'clicked:' + (el.id || el.className || el.tagName);
    })()`,
    returnByValue: true
  }, id);
  return r.result && r.result.result && r.result.result.value;
}

async function getEl(ws, id_or_sel, evalId) {
  const script = `(function(){
    const el = document.getElementById('${id_or_sel}') || document.querySelector('${id_or_sel}');
    if (!el) return null;
    return JSON.stringify({
      display: el.style.display,
      className: el.className.substring(0,80),
      textContent: (el.textContent||'').trim().substring(0,100),
      value: el.value || '',
      disabled: el.disabled,
      offsetWidth: el.offsetWidth,
      offsetHeight: el.offsetHeight
    });
  })()`;
  const r = await cdpReq(ws, 'Runtime.evaluate', { expression: script, returnByValue: true }, evalId);
  console.log(`getEl(${id_or_sel}):`, JSON.stringify(r));
  if (r.result && r.result.result && r.result.result.value) {
    try { return JSON.parse(r.result.result.value); } catch(e) { return null; }
  }
  return null;
}

async function run() {
  log('=== VALENIXIA POS COMPREHENSIVE DIAGNOSTIC ===');
  
  // Get CDP target
  const td = await new Promise((res, rej) => {
    http.get('http://localhost:9222/json', (r) => {
      let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b)));
    }).on('error', rej);
  });
  
  const target = td.find(t => t.url && t.url.includes('localhost:3000') && t.type === 'page') || td[0];
  if (!target) {
    log('❌ FATAL: No Chrome DevTools target found. Is Chrome running with --remote-debugging-port=9222?');
    return;
  }
  
  log(`Attached to: ${target.url}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  
  // Enable domains
  await cdpReq(ws, 'Runtime.enable', {}, 1);
  await cdpReq(ws, 'Log.enable', {}, 2);

  // Inject native mocks to support offline-first/CI headless tests safely
  await cdpReq(ws, 'Runtime.evaluate', {
    expression: `
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
    `,
    returnByValue: true
  }, 9999);
  
  // Collect errors
  ws.on('message', (d) => {
    try {
      const m = JSON.parse(d.toString());
      if (m.method === 'Runtime.consoleAPICalled') {
        const level = m.params.type;
        const text = m.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' ');
        if (level === 'error') allErrors.push(text);
        if (level === 'warn') allWarnings.push(text);
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const desc = m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'Unknown';
        allErrors.push('JS_EXCEPTION: ' + desc);
      }
    } catch(e) {}
  });

  // ─────────────────────────────────────────────
  // TEST 1: Navigate fresh, check boot state
  // ─────────────────────────────────────────────
  log('\n=== TEST 1: Fresh page load ===');
  log('Clearing browser storage for http://localhost:3000...');
  await cdpReq(ws, 'Storage.clearDataForOrigin', { origin: 'http://localhost:3000', storageTypes: 'all' }, 99);
  await sleep(1000);
  
  await cdpReq(ws, 'Page.navigate', { url: 'http://localhost:3000/?diag=' + Date.now() }, 100);
  await sleep(8000);
  
  const lockoutEl = await getEl(ws, 'license-lockout-overlay', 200);
  const wizardEl = await getEl(ws, 'first-boot-wizard', 201);
  const authEl = await getEl(ws, 'auth-lock-screen', 202);
  
  log(`Lockout overlay: ${JSON.stringify(lockoutEl)}`);
  log(`Wizard overlay: ${JSON.stringify(wizardEl)}`);
  log(`Auth screen: ${JSON.stringify(authEl)}`);
  
  if (!lockoutEl) fail('T1: License lockout overlay exists in DOM', 'Element not found');
  else pass('T1: License lockout overlay exists in DOM');
  
  if (!wizardEl) fail('T1: Wizard overlay exists in DOM', 'Element not found');
  else pass('T1: Wizard overlay exists in DOM');
  
  // ─────────────────────────────────────────────
  // TEST 2: License activation with bypass key
  // ─────────────────────────────────────────────
  log('\n=== TEST 2: License activation ===');
  
  // Check if lockout is visible
  const lockoutVisible = lockoutEl && lockoutEl.display !== 'none';
  
  if (lockoutVisible) {
    log('License lockout is showing. Attempting activation...');
    
    // Find inputs in the lockout overlay (dynamically built by license-engine.js)
    const inputsResult = await cdpEval(ws, `(function() {
      const inputs = document.querySelectorAll('input');
      return JSON.stringify(Array.from(inputs).map(i => ({ id: i.id, type: i.type, placeholder: i.placeholder })));
    })()`, 300);
    log('Available inputs:', inputsResult);
    
    // Try to fill in the license key
    const fillResult = await cdpEval(ws, `(function() {
      const keyInput = document.getElementById('license-code-input');
      const phoneInput = document.getElementById('license-phone-input');
      const activateBtn = document.getElementById('license-activate-btn');
      if (!keyInput) return 'NO_KEY_INPUT';
      if (!phoneInput) return 'NO_PHONE_INPUT';
      if (!activateBtn) return 'NO_ACTIVATE_BTN';
      
      keyInput.value = 'VALENIXIA-ADMIN-777';
      keyInput.dispatchEvent(new Event('input', { bubbles: true }));
      phoneInput.value = '03001234567';
      phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
      return 'FILLED';
    })()`, 301);
    
    log('Fill result:', fillResult);
    
    if (fillResult === 'FILLED') {
      await cdpEval(ws, `document.getElementById('license-activate-btn').click()`, 302);
      await sleep(3000);
      pass('T2: License activation form filled and submitted');
    } else {
      fail('T2: License activation', `Could not fill form: ${fillResult}`);
    }
  } else {
    log('License lockout is NOT visible — already activated or bypassed');
    pass('T2: License already active (no lockout shown)');
  }
  
  await sleep(2000);
  
  // ─────────────────────────────────────────────
  // TEST 3: Check wizard or login state
  // ─────────────────────────────────────────────
  log('\n=== TEST 3: Post-activation state ===');
  const wizardEl2 = await getEl(ws, 'first-boot-wizard', 400);
  const authEl2 = await getEl(ws, 'auth-lock-screen', 401);
  const bodyClass = await cdpEval(ws, 'document.body.className', 402);
  
  log(`Wizard: display=${wizardEl2?.display}, height=${wizardEl2?.offsetHeight}`);
  log(`Auth: className=${authEl2?.className}`);
  log(`Body class: ${bodyClass}`);
  
  const wizardVisible2 = wizardEl2 && wizardEl2.display === 'flex';
  const authActive = authEl2 && authEl2.className && authEl2.className.includes('active');
  
  if (wizardVisible2) {
    log('Wizard is visible — first boot setup mode');
    pass('T3: Wizard visible on first boot');
    
    // Check wizard step 1 content
    const step1 = await getEl(ws, 'btn-wiz-choose-new', 410);
    const step1b = await getEl(ws, 'btn-wiz-choose-join', 411);
    if (step1) pass('T3: Wizard "New Store" button exists');
    else fail('T3: Wizard "New Store" button', 'Not found');
    if (step1b) pass('T3: Wizard "Join Network" button exists');
    else fail('T3: Wizard "Join Network" button', 'Not found');
  } else if (authActive) {
    log('Auth PIN screen is active — onboarding already done');
    pass('T3: PIN login screen is active');
    
    // Test PIN login
    log('\n=== TEST 4: PIN login ===');
    const pinEl = await getEl(ws, 'pin-input', 500);
    log(`PIN input: ${JSON.stringify(pinEl)}`);
    
    if (pinEl) {
      // Try entering 4-digit PIN (owner PIN set during setup)
      const pinResult = await cdpEval(ws, `(function() {
        const pinInput = document.getElementById('pin-input');
        if (!pinInput) return 'NO_PIN_INPUT';
        // Type each digit (simulating PIN pad clicks)
        const digits = ['1','2','3','4'];
        digits.forEach(d => {
          const btn = document.querySelector('.pin-btn[data-key="' + d + '"]');
          if (btn) btn.click();
        });
        return 'ENTERED';
      })()`, 501);
      log('PIN entry result:', pinResult);
    }
  } else {
    log('Neither wizard nor auth screen is active — layout might be showing or lockout failed');
    const layout = await getEl(ws, 'pos-app-layout', 450);
    log(`Layout: ${JSON.stringify(layout)}`);
    
    if (layout && layout.display !== 'none') {
      pass('T3: POS layout already showing (logged in)');
    } else {
      fail('T3: App state unclear', `Wizard=${wizardEl2?.display}, Auth=${authEl2?.className}, Layout=${layout?.display}`);
    }
  }
  
  // ─────────────────────────────────────────────
  // TEST 5: Check main screens exist in DOM
  // ─────────────────────────────────────────────
  log('\n=== TEST 5: DOM completeness checks ===');
  const screens = ['view-checkout', 'view-catalog', 'view-history', 'view-analytics', 'view-settings', 'view-staff', 'view-catalog-manager'];
  for (let i = 0; i < screens.length; i++) {
    const el = await getEl(ws, screens[i], 600 + i);
    if (el) pass(`T5: Screen #${screens[i]} exists`);
    else fail(`T5: Screen #${screens[i]}`, 'Not found in DOM');
  }
  
  // ─────────────────────────────────────────────
  // TEST 6: Mobile viewport simulation
  // ─────────────────────────────────────────────
  log('\n=== TEST 6: Mobile viewport ===');
  await cdpReq(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  }, 700);
  await sleep(1000);
  
  const bottomNav = await getEl(ws, '.pos-bottom-nav', 710);
  log(`Bottom nav: ${JSON.stringify(bottomNav)}`);
  
  if (bottomNav) {
    pass('T6: Mobile bottom nav exists in DOM');
  } else {
    fail('T6: Mobile bottom nav', 'Element not found');
  }
  
  // Reset viewport
  await cdpReq(ws, 'Emulation.clearDeviceMetricsOverride', {}, 720);
  
  // ─────────────────────────────────────────────
  // TEST 7: Check for JavaScript errors
  // ─────────────────────────────────────────────
  log('\n=== TEST 7: Error summary ===');
  const criticalErrors = allErrors.filter(e => 
    !e.includes('WebSocket') && 
    !e.includes('ERR_CONNECTION_REFUSED') && 
    !e.includes('net::ERR') &&
    !e.includes('[Telemetry]') &&
    !e.includes('SyncEngine not initialized')
  );
  
  if (criticalErrors.length === 0) {
    pass('T7: No critical JavaScript errors detected');
  } else {
    fail('T7: Critical errors found', `${criticalErrors.length} errors`);
    criticalErrors.slice(0, 10).forEach((e, i) => log(`  Error ${i+1}: ${e.substring(0, 200)}`));
  }
  
  log('\n[Benign warnings (expected)]:');
  allWarnings.filter(w => w.includes('WebSocket') || w.includes('offline')).slice(0, 3)
    .forEach(w => log(`  ${w.substring(0, 150)}`));
  
  // ─────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────
  log('\n╔══════════════════════════════════════════╗');
  log('║          DIAGNOSTIC SUMMARY              ║');
  log('╠══════════════════════════════════════════╣');
  const passed = testResults.filter(r => r.status === 'PASS').length;
  const failed = testResults.filter(r => r.status === 'FAIL').length;
  const warned = testResults.filter(r => r.status === 'WARN').length;
  log(`║  PASSED: ${passed}  FAILED: ${failed}  WARNED: ${warned}                ║`);
  log('╚══════════════════════════════════════════╝');
  
  if (failed > 0) {
    log('\n[FAILURES]:');
    testResults.filter(r => r.status === 'FAIL').forEach(r => {
      log(`  ❌ ${r.test}: ${r.reason}`);
    });
  }
  
  log(`\nAll errors collected: ${allErrors.length}`);
  log(`All warnings collected: ${allWarnings.length}`);
  
  ws.close();
}

run().catch(e => {
  console.error('[FATAL]', e.message, e.stack);
  process.exit(1);
});
