/**
 * VALENIXIA POS — Enhanced Mobile Viewport & Touch Target E2E Test Suite
 * Emulates mobile devices via CDP and audits layout, touch targets, and responsiveness.
 * Run: node tests/mobile_e2e_enhanced.test.js
 */

const WebSocket = require('ws');
const http = require('http');

function cdpEval(ws, script, id) {
  return new Promise((resolve) => {
    const msg = { id, method: 'Runtime.evaluate', params: { expression: script, awaitPromise: true, returnByValue: true } };
    ws.send(JSON.stringify(msg));
    const handler = (raw) => {
      const m = JSON.parse(raw);
      if (m.id === id) { ws.removeListener('message', handler); resolve(m.result); }
    };
    ws.on('message', handler);
    setTimeout(() => { ws.removeListener('message', handler); resolve(null); }, 8000);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
  return ws;
}

let passed = 0, failed = 0;
function assert(name, condition, errorMsg = 'Condition failed') {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS — ${name}`);
  } else {
    failed++;
    console.log(`  ❌ FAIL — ${name} :: ${errorMsg}`);
  }
}

async function run() {
  console.log('\n==============================================================');
  console.log(' VALENIXIA POS — ENHANCED MOBILE E2E TEST SUITE');
  console.log('==============================================================\n');

  const ws = await connectCDP();
  let id = 3000;

  ws.send(JSON.stringify({ id: id++, method: 'Runtime.enable', params: {} }));
  ws.send(JSON.stringify({ id: id++, method: 'Page.enable', params: {} }));

  // Emulate mobile and reload
  console.log('Injecting Android interface mocks...');
  ws.send(JSON.stringify({
    id: id++,
    method: 'Page.addScriptToEvaluateOnNewDocument',
    params: {
      source: `
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
      `
    }
  }));
  await sleep(200);

  console.log('Reloading page with Android mocks active...');
  ws.send(JSON.stringify({ id: id++, method: 'Page.reload', params: {} }));
  await sleep(4000);

  // Check if onboarding is active, and complete it or bypass to login
  const isWizActive = await cdpEval(ws, '!!document.getElementById("first-boot-wizard")', id++);
  if (isWizActive?.result?.value) {
    console.log('Onboarding active. Completing setup wizard...');
    // Complete Wizard Standalone Mode
    await cdpEval(ws, `(async () => {
      const btn = document.getElementById('btn-wiz-choose-new');
      if (btn) btn.click();
    })()`, id++);
    await sleep(800);
    await cdpEval(ws, `(async () => {
      const name = document.getElementById('wizard-store-name');
      const tax = document.getElementById('wizard-tax-rate');
      const btn = document.getElementById('btn-wiz-next');
      if (name) name.value = 'E2E Mobile Shop';
      if (tax) tax.value = '8.5';
      if (btn) btn.click();
    })()`, id++);
    await sleep(800);
    const testPin = process.env.TEST_ADMIN_PIN;
    const testPass = process.env.TEST_PASSPHRASE;
    if (!testPin) throw new Error("Environment variable TEST_ADMIN_PIN is required for E2E testing but is not set.");
    if (!testPass) throw new Error("Environment variable TEST_PASSPHRASE is required for E2E testing but is not set.");
    await cdpEval(ws, `(async () => {
      const pin = document.getElementById('wizard-admin-pin');
      const pass = document.getElementById('wizard-sync-passphrase');
      const btn = document.getElementById('btn-wiz-next');
      if (pin) pin.value = '${testPin}';
      if (pass) pass.value = '${testPass}';
      if (btn) btn.click();
    })()`, id++);
    await sleep(800);
    await cdpEval(ws, `(async () => {
      const eula = document.getElementById('wizard-eula-checkbox');
      const btn = document.getElementById('btn-wiz-next');
      if (eula) { eula.checked = true; eula.dispatchEvent(new Event('change')); }
      if (btn) btn.click();
    })()`, id++);
    await sleep(4000);
  }

  // Check if lock screen is active, and log in
  const isLockScreen = await cdpEval(ws, 'document.getElementById("auth-lock-screen")?.classList.contains("active")', id++);
  if (isLockScreen?.result?.value) {
    const testPin = process.env.TEST_ADMIN_PIN;
    if (!testPin) throw new Error("Environment variable TEST_ADMIN_PIN is required for E2E testing but is not set.");
    console.log('Logging in with admin pin...');
    await cdpEval(ws, `(async () => {
      const pad = document.getElementById('pin-pad');
      const clickDigit = (d) => {
        const btn = Array.from(pad.querySelectorAll('.pin-btn')).find(b => b.getAttribute('data-digit') === String(d));
        if (btn) btn.click();
      };
      for (const d of '${testPin}'.split('')) {
        clickDigit(d);
      }
      const ent = pad.querySelector('[data-action="enter"]');
      if (ent) ent.click();
    })()`, id++);
    await sleep(3000);
  }

  const viewports = [
    { width: 390, height: 844, name: 'iPhone 12' },
    { width: 393, height: 851, name: 'Pixel 5' },
    { width: 768, height: 1024, name: 'iPad (Tablet)' }
  ];

  for (const vp of viewports) {
    console.log(`\nTesting viewport: ${vp.name} (${vp.width}x${vp.height})`);
    ws.send(JSON.stringify({ id: id++, method: 'Emulation.setDeviceMetricsOverride', params: {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 2.0,
      mobile: true
    }}));
    await sleep(600);

    // 1. Viewport Overflow Check
    const overflow = await cdpEval(ws, `(function() {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    })()`, id++);
    assert(`${vp.name}: Viewport has no horizontal overflow`, overflow?.result?.value === false, 'Horizontal scroll detected!');

    // 2. Navigation Bar Consistency Check
    const navLayout = await cdpEval(ws, `(function() {
      const bottomNav = document.querySelector('.pos-bottom-nav');
      const sidebar = document.querySelector('.pos-sidebar');
      const bottomNavDisp = bottomNav ? window.getComputedStyle(bottomNav).display : 'none';
      const sidebarDisp = sidebar ? window.getComputedStyle(sidebar).display : 'none';
      return { bottomNavDisp, sidebarDisp };
    })()`, id++);
    const navVal = navLayout?.result?.value || {};
    if (vp.width <= 768) {
      assert(`${vp.name}: Bottom nav bar is visible on mobile viewports`, navVal.bottomNavDisp !== 'none', 'Bottom nav hidden on mobile!');
      assert(`${vp.name}: Sidebar navigation is hidden on mobile viewports`, navVal.sidebarDisp === 'none', 'Sidebar visible on mobile!');
    } else {
      assert(`${vp.name}: Sidebar navigation is visible on tablet/desktop viewports`, navVal.sidebarDisp !== 'none', 'Sidebar hidden on tablet!');
    }

    // 3. Touch Target Sizing (Strict 48px check)
    const touchTargets = await cdpEval(ws, `(function() {
      const elements = Array.from(document.querySelectorAll('.pin-btn, .pos-bottom-nav .nav-item, .category-pill, .product-quick-card'));
      const violations = [];
      elements.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 48 || rect.height < 48) {
          violations.push({
            tag: el.tagName,
            class: el.className,
            width: rect.width,
            height: rect.height,
            text: el.textContent.trim().substring(0, 15)
          });
        }
      });
      return JSON.stringify(violations);
    })()`, id++);
    const violations = JSON.parse(touchTargets?.result?.value || '[]');
    assert(`${vp.name}: Touch targets are compliance size (>= 48px)`, violations.length === 0, `Found ${violations.length} violations: ${JSON.stringify(violations)}`);

    // 4. Keyboard Avoidance viewport shrinking check
    console.log('  Simulating soft keyboard display (reducing viewport height by 250px)...');
    ws.send(JSON.stringify({ id: id++, method: 'Emulation.setDeviceMetricsOverride', params: {
      width: vp.width,
      height: vp.height - 250,
      deviceScaleFactor: 2.0,
      mobile: true
    }}));
    await sleep(600);

    const checkInputVis = await cdpEval(ws, `(function() {
      // Focus on active search or numeric input if available
      const searchInput = document.getElementById('search-catalog') || document.querySelector('input');
      if (searchInput) {
        searchInput.focus();
        const rect = searchInput.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      }
      return true; // No input found to check
    })()`, id++);
    assert(`${vp.name}: Active inputs remain visible and interactive under keyboard simulation`, checkInputVis?.result?.value === true, 'Focused input covered by simulated keyboard!');

    // Restore full size
    ws.send(JSON.stringify({ id: id++, method: 'Emulation.setDeviceMetricsOverride', params: {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 2.0,
      mobile: true
    }}));
    await sleep(300);
  }

  ws.close();
  console.log('\n==============================================================');
  console.log(` RESULTS: Passed: ${passed} | Failed: ${failed}`);
  console.log('==============================================================');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('FATAL ERROR:', e);
  process.exit(1);
});
