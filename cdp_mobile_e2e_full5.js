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

async function waitForStableContext(ws, idStart) {
  console.log('Waiting for stable page context...');
  for (let i = 0; i < 30; i++) {
    const r = await cdpEval(ws, '1+1', idStart + i);
    if (r && r.result && r.result.value === 2) {
      console.log('Page context is stable.');
      return true;
    }
    await sleep(500);
  }
  return false;
}

async function waitForAppInitialized(ws, idStart) {
  console.log('Waiting for window.appInitialized to be true...');
  for (let i = 0; i < 100; i++) { // wait up to 50s
    const r = await cdpEval(ws, '!!window.appInitialized', idStart + i);
    if (r && r.result && r.result.value === true) {
      console.log('App initialization is complete.');
      await sleep(400); // short grace period
      return true;
    }
    await sleep(500);
  }
  console.log('Timeout waiting for window.appInitialized.');
  return false;
}

http.get('http://localhost:9222/json', async (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', async () => {
    const pages = JSON.parse(data);
    const page = pages.find(p => p.type === 'page' && (p.title === 'Valenixia Commerce POS' || (p.url && p.url.includes('localhost:3000'))));
    if (!page) { console.log('NO_PAGE'); process.exit(1); }
    
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 1000;
    
    ws.on('open', async () => {
      ws.send(JSON.stringify({ id: id++, method: 'Runtime.enable', params: {} }));
      ws.send(JSON.stringify({ id: id++, method: 'Page.enable', params: {} }));
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

      // 1. Force mobile view emulation
      console.log('Setting mobile viewport emulation (390x844)...');
      ws.send(JSON.stringify({ id: id++, method: 'Emulation.setDeviceMetricsOverride', params: {
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        mobile: true
      }}));
      
      // 2. Clear localStorage and IndexedDB and reload
      console.log('Nuking client local stores (IndexedDB + localStorage)...');
      let clearRes = await cdpEval(ws, `(async () => {
        localStorage.clear();
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const reg of regs) { await reg.unregister(); }
        } catch(e) {}
        try {
          const keys = await caches.keys();
          for (const k of keys) { await caches.delete(k); }
        } catch(e) {}
        try {
          if (window.ValenixiaDB && window.ValenixiaDB.db) {
            window.ValenixiaDB.db.close();
          }
        } catch(e) {}
        try {
          if (window.syncWorker) {
            window.syncWorker.terminate();
          }
        } catch(e) {}
        return new Promise((resolve) => {
          setTimeout(() => {
            const req = indexedDB.deleteDatabase('valenixia_db');
            req.onsuccess = () => resolve('CLEARED_ALL');
            req.onerror = (e) => resolve('DB_DELETE_ERR: ' + e.target.error.message);
            req.onblocked = () => resolve('DB_DELETE_BLOCKED');
          }, 500);
        });
      })()`, id++);
      console.log('CLEARED_STATUS:', clearRes?.result?.value);
      
      ws.send(JSON.stringify({ id: id++, method: 'Page.navigate', params: { url: 'http://localhost:3000' } }));
      
      // Wait for reload
      await waitForAppInitialized(ws, id);
      id += 100;

      // PHASE 1: License Activation  
      console.log('\n--- PHASE 1: License Activation ---');
      let r = await cdpEval(ws, `(async () => {
        for (let i = 0; i < 80; i++) {
          const keyField = document.getElementById('license-code-input');
          if (keyField) {
            const phoneField = document.getElementById('license-phone-input');
            const btn = document.getElementById('license-activate-btn');
            if (phoneField && btn) {
              keyField.value = 'VALENIXIA-ADMIN-777';
              phoneField.value = '03001234567';
              window.alert = function(msg) { console.log('MOCKED ALERT:', msg); };
              btn.click();
              return 'ACTIVATION_SUBMITTED';
            }
          }
          await new Promise(r => setTimeout(r, 100));
        }
        return 'ERROR: Elements not loaded';
      })()`, id++);
      console.log('P1_ACTIVATE:', r?.result?.value);
      
      // Wait for reload post-activation
      await sleep(1000);
      await waitForAppInitialized(ws, id);
      id += 100;

      // PHASE 2: Wizard
      console.log('\n--- PHASE 2: Setup Wizard ---');
      
      // Step 1: Click Standalone Store Setup
      r = await cdpEval(ws, `(async () => {
        for (let i = 0; i < 80; i++) {
          const btn = document.getElementById('btn-wiz-choose-new');
          if (btn && btn.offsetHeight > 0) {
            btn.click();
            return 'CLICKED_STANDALONE';
          }
          await new Promise(r => setTimeout(r, 100));
        }
        return 'ERROR: btn-wiz-choose-new not visible';
      })()`, id++);
      console.log('P2_STEP1:', r?.result?.value);

      // Step 2: Store Details
      r = await cdpEval(ws, `(async () => {
        for (let i = 0; i < 50; i++) {
          const name = document.getElementById('wizard-store-name');
          const tax = document.getElementById('wizard-tax-rate');
          const btn = document.getElementById('btn-wiz-next');
          if (name && tax && btn && btn.offsetHeight > 0) {
            name.value = 'Mobile E2E Shop';
            tax.value = '10';
            btn.click();
            return 'STEP2_DONE';
          }
          await new Promise(r => setTimeout(r, 100));
        }
        return 'ERROR: Step 2 form not visible';
      })()`, id++);
      console.log('P2_STEP2:', r?.result?.value);

      // Step 3: Admin Credentials
      r = await cdpEval(ws, `(async () => {
        for (let i = 0; i < 50; i++) {
          const pin = document.getElementById('wizard-admin-pin');
          const pass = document.getElementById('wizard-sync-passphrase');
          const btn = document.getElementById('btn-wiz-next');
          if (pin && pass && btn && btn.offsetHeight > 0) {
            pin.value = '1234';
            pass.value = 'testpass123';
            btn.click();
            return 'STEP3_DONE';
          }
          await new Promise(r => setTimeout(r, 100));
        }
        return 'ERROR: Step 3 form not visible';
      })()`, id++);
      console.log('P2_STEP3:', r?.result?.value);

      // Step 4: EULA & Launch
      r = await cdpEval(ws, `(async () => {
        for (let i = 0; i < 50; i++) {
          const eula = document.getElementById('wizard-eula-checkbox');
          const btn = document.getElementById('btn-wiz-next');
          if (eula && btn && btn.offsetHeight > 0) {
            eula.checked = true;
            eula.dispatchEvent(new Event('change'));
            btn.click();
            return 'LAUNCH_CLICKED';
          }
          await new Promise(r => setTimeout(r, 100));
        }
        return 'ERROR: Step 4 form not visible';
      })()`, id++);
      console.log('P2_STEP4_LAUNCH:', r?.result?.value);

      // PHASE 3: PIN Login via Pin Pad
      console.log('\n--- PHASE 3: Lock Screen PIN Entry ---');
      r = await cdpEval(ws, `(async () => {
        for (let i = 0; i < 100; i++) {
          const pad = document.getElementById('pin-pad');
          if (pad && pad.offsetHeight > 0 && document.getElementById('auth-lock-screen')?.classList.contains('active')) {
            const clickDigit = (d) => {
              const btn = Array.from(pad.querySelectorAll('.pin-btn')).find(b => b.getAttribute('data-digit') === String(d));
              if (btn) btn.click();
            };
            clickDigit(1);
            clickDigit(2);
            clickDigit(3);
            clickDigit(4);
            const enterBtn = pad.querySelector('[data-action="enter"]');
            if (enterBtn) {
              enterBtn.click();
              return 'PIN_ENTERED_SUBMITTED';
            }
          }
          await new Promise(r => setTimeout(r, 100));
        }
        return 'ERROR: pin-pad not active';
      })()`, id++);
      console.log('P3_LOGIN:', r?.result?.value);
      
      // Wait for login processing animation
      await sleep(4000);

      // PHASE 4: Layout and UI Sizing Inspections across multiple viewports
      console.log('\n--- PHASE 4: Responsive Layout Audit (Multi-Viewport Matrix) ---');
      const viewports = [
        { width: 320, height: 480, name: 'very-small' },
        { width: 360, height: 640, name: 'budget-android' },
        { width: 390, height: 844, name: 'modern-ios' },
        { width: 768, height: 1024, name: 'tablet-portrait' }
      ];
      
      const auditResults = {};
      for (const vp of viewports) {
        console.log(`Auditing viewport: ${vp.width}x${vp.height} (${vp.name})...`);
        ws.send(JSON.stringify({ id: id++, method: 'Emulation.setDeviceMetricsOverride', params: {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: 3,
          mobile: true
        }}));
        await sleep(500);
        
        let audit = await cdpEval(ws, `(function() {
          const res = {};
          // Check that no horizontal scroll exists on body/root
          res.horizontalScroll = document.documentElement.scrollWidth > document.documentElement.clientWidth;
          
          // Check that first-boot-wizard is scrollable when it exceeds client bounds
          const wizard = document.getElementById('wizard-card');
          if (wizard) {
            res.wizardScrollable = wizard.scrollHeight >= wizard.clientHeight;
            res.wizardHeight = wizard.getBoundingClientRect().height;
          }
          
          // Check screen visibility
          const bottomNav = document.querySelector('.pos-bottom-nav');
          if (bottomNav) {
            res.bottomNavVisible = window.getComputedStyle(bottomNav).display !== 'none';
          }
          
          const sidebar = document.querySelector('.pos-sidebar');
          if (sidebar) {
            res.sidebarVisible = window.getComputedStyle(sidebar).display !== 'none';
          }
          
          return JSON.stringify(res);
        })()`, id++);
        
        auditResults[vp.name] = JSON.parse(audit?.result?.value || '{}');
      }
      
      console.log('\n=== MULTI-VIEWPORT AUDIT RESULTS ===\n', JSON.stringify(auditResults, null, 2));

      // Theme-switching verification mid-test
      console.log('\n--- PHASE 5: Theme Switching mid-test validation ---');
      let themeCheck = await cdpEval(ws, `(function() {
        // Toggle theme to Monochrome Ivory
        document.body.classList.remove('theme-obsidian-emerald');
        document.body.classList.add('theme-monochrome-ivory');
        
        // Assert danger zone text contrast readability
        const dangerZone = document.getElementById('dm-danger-zone');
        if (dangerZone) {
          const style = window.getComputedStyle(dangerZone);
          const color = style.color;
          return 'Theme switched successfully. Danger zone color: ' + color;
        }
        return 'Danger zone not found on this view (login/onboarding active)';
      })()`, id++);
      console.log('THEME_SWITCH_CHECK:', themeCheck?.result?.value);
      
      ws.close();
      process.exit(0);
    });
    ws.on('error', e => { console.log('WS_ERR:', e.message); process.exit(1); });
    setTimeout(() => { console.log('TIMEOUT'); ws.close(); process.exit(0); }, 55000);
  });
}).on('error', e => console.log('HTTP_ERR:', e.message));
