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
    setTimeout(() => { ws.removeListener('message', handler); resolve({ result: { value: 'EVAL_TIMEOUT' } }); }, 10000);
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

http.get('http://localhost:9222/json', async (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', async () => {
    const pages = JSON.parse(data);
    const page = pages.find(p => p.url && p.url.includes('localhost:3000') && p.type === 'page');
    if (!page) { console.log('NO_PAGE'); process.exit(1); }
    
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 600;
    
    ws.on('open', async () => {
      ws.send(JSON.stringify({ id: id++, method: 'Runtime.enable', params: {} }));
      
      // 1. Force mobile view emulation
      console.log('Setting mobile viewport emulation (390x844)...');
      ws.send(JSON.stringify({ id: id++, method: 'Emulation.setDeviceMetricsOverride', params: {
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        mobile: true
      }}));
      
      // 2. Clear localStorage and reload
      console.log('Clearing localStorage and reloading for clean test...');
      await cdpEval(ws, `(function() {
        localStorage.clear();
        return 'LOCALSTORAGE_CLEARED';
      })()`, id++);
      
      ws.send(JSON.stringify({ id: id++, method: 'Page.reload', params: { ignoreCache: true } }));
      await sleep(5000);

      // PHASE 1: License Activation  
      console.log('\n--- PHASE 1: License Activation ---');
      let r = await cdpEval(ws, `(function() {
        const keyField = document.getElementById('license-code-input');
        const phoneField = document.getElementById('license-phone-input');
        const btn = document.getElementById('license-activate-btn');
        if (!keyField) return 'ERROR: no key field';
        keyField.value = 'VALENIXIA-ADMIN-777';
        if (phoneField) phoneField.value = '03001234567';
        if (!btn) return 'ERROR: no activate btn';
        
        window.alert = function(msg) { console.log('MOCKED ALERT:', msg); };
        btn.click();
        return 'ACTIVATION_SUBMITTED';
      })()`, id++);
      console.log('P1_ACTIVATE:', r?.result?.value);
      
      console.log('Waiting 5s for license verification + page reload...');
      await sleep(6000);

      // PHASE 2: Wizard
      console.log('\n--- PHASE 2: Setup Wizard ---');
      r = await cdpEval(ws, `(function() {
        const btn = document.getElementById('btn-wiz-choose-new');
        if (!btn) return 'ERROR: no btn-wiz-choose-new';
        btn.click();
        return 'CLICKED_STANDALONE';
      })()`, id++);
      console.log('P2_STEP1:', r?.result?.value);
      await sleep(1000);

      r = await cdpEval(ws, `(function() {
        const name = document.getElementById('wizard-store-name');
        const tax = document.getElementById('wizard-tax-rate');
        if (name) name.value = 'Mobile E2E Shop';
        if (tax) tax.value = '10';
        const btn = document.getElementById('btn-wiz-next');
        if (!btn) return 'ERROR: no next btn';
        btn.click();
        return 'STEP2_DONE';
      })()`, id++);
      console.log('P2_STEP2:', r?.result?.value);
      await sleep(1000);

      r = await cdpEval(ws, `(function() {
        const pin = document.getElementById('wizard-admin-pin');
        const pass = document.getElementById('wizard-sync-passphrase');
        if (pin) pin.value = '1234';
        if (pass) pass.value = 'testpass123';
        const btn = document.getElementById('btn-wiz-next');
        if (btn) btn.click();
        return 'STEP3_DONE';
      })()`, id++);
      console.log('P2_STEP3:', r?.result?.value);
      await sleep(1000);

      r = await cdpEval(ws, `(function() {
        const eula = document.getElementById('wizard-eula-checkbox');
        if (eula) { eula.checked = true; eula.dispatchEvent(new Event('change')); }
        const btn = document.getElementById('btn-wiz-next');
        if (btn) { btn.click(); return 'LAUNCH_CLICKED'; }
        return 'NO_LAUNCH_BUTTON';
      })()`, id++);
      console.log('P2_STEP4_LAUNCH:', r?.result?.value);
      
      console.log('Waiting 6s for database bootstrap...');
      await sleep(7000);

      // PHASE 3: PIN Login via Pin Pad
      console.log('\n--- PHASE 3: Lock Screen PIN Entry ---');
      r = await cdpEval(ws, `(function() {
        const pad = document.getElementById('pin-pad');
        if (!pad) return 'ERROR: pin-pad not found';
        
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
        return 'ERROR: Enter button not found';
      })()`, id++);
      console.log('P3_LOGIN:', r?.result?.value);
      
      console.log('Waiting 3s for login processing...');
      await sleep(3500);

      // PHASE 4: Layout and UI Sizing Inspections on Mobile Viewport
      console.log('\n--- PHASE 4: Responsive Layout Audit ---');
      r = await cdpEval(ws, `(function() {
        const audits = {};
        
        // 1. Bottom Navigation Bar visibility and height
        const bottomNav = document.querySelector('.pos-bottom-nav');
        if (bottomNav) {
          const style = window.getComputedStyle(bottomNav);
          const rect = bottomNav.getBoundingClientRect();
          audits.bottomNav = {
            display: style.display,
            visibility: style.visibility,
            height: rect.height,
            width: rect.width,
            top: rect.top,
            bottom: rect.bottom,
            zIndex: style.zIndex
          };
        } else {
          audits.bottomNav = 'MISSING';
        }
        
        // 2. Sidebar display status on mobile (should be none or hidden)
        const sidebar = document.querySelector('.pos-sidebar');
        if (sidebar) {
          audits.sidebar = {
            display: window.getComputedStyle(sidebar).display
          };
        } else {
          audits.sidebar = 'MISSING';
        }
        
        // 3. Current active view screen container height and overflow
        const activeView = document.querySelector('.content-view.active');
        if (activeView) {
          const rect = activeView.getBoundingClientRect();
          audits.activeView = {
            id: activeView.id,
            display: window.getComputedStyle(activeView).display,
            height: rect.height,
            width: rect.width
          };
        } else {
          audits.activeView = 'NONE_ACTIVE';
        }
        
        // 4. Overlays check
        audits.overlays = {
          lockout: document.getElementById('license-lockout-overlay') ? 'present' : 'absent',
          wizard: document.getElementById('first-boot-wizard')?.style.display,
          lockscreenActive: document.getElementById('auth-lock-screen')?.classList.contains('active')
        };
        
        // 5. Check console log stack
        audits.logs = window.__valenixiaLogs || [];
        
        return JSON.stringify(audits);
      })()`, id++);
      
      console.log('\n=== MOBILE LAYOUT AUDIT RESULTS ===\n', r?.result?.value);
      
      ws.close();
      process.exit(0);
    });
    ws.on('error', e => { console.log('WS_ERR:', e.message); process.exit(1); });
    setTimeout(() => { console.log('TIMEOUT'); ws.close(); process.exit(0); }, 50000);
  });
}).on('error', e => console.log('HTTP_ERR:', e.message));
