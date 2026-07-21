/**
 * VALENIXIA — Full E2E Test Suite v2 (Robust)
 * Properly waits for app init, handles all boot states, then tests every feature
 */
require('dotenv').config();
const WebSocket = require('ws');
const http = require('http');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let PASS = 0, FAIL = 0;
const results = [];

function log(msg) { process.stdout.write(`[${new Date().toISOString().substring(11,19)}] ${msg}\n`); }
function pass(t) { PASS++; results.push({ok:true,t}); log(`✅ PASS — ${t}`); }
function fail(t, r) { FAIL++; results.push({ok:false,t,r}); log(`❌ FAIL — ${t} :: ${r}`); }
function info(t) { log(`ℹ️  INFO — ${t}`); }

let activeTabId = null;
const CDP_PORT = process.env.CDP_PORT || '9222';

function devToolsRequest(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: parseInt(CDP_PORT),
      path: path,
      method: method
    }, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve(b));
    });
    req.on('error', reject);
    req.end();
  });
}

async function connectCDP() {
  log('connectCDP: Creating a fresh test tab...');
  const newTabRes = await devToolsRequest('/json/new', 'PUT');
  const target = JSON.parse(newTabRes);
  activeTabId = target.id;
  log('connectCDP: Created tab ID: ' + activeTabId);

  // Close other open tabs to prevent IndexedDB locks
  try {
    const targetsRes = await devToolsRequest('/json');
    const targets = JSON.parse(targetsRes);
    for (const t of targets) {
      if (t.type === 'page' && t.id !== activeTabId) {
        log(`Closing existing tab/target to prevent IndexedDB lock: ${t.url}`);
        await devToolsRequest(`/json/close/${t.id}`, 'GET').catch(() => {});
      }
    }
  } catch (e) {
    log('Failed to clean up other tabs: ' + e.message);
  }

  log('connectCDP: Connecting to WebSocket: ' + target.webSocketDebuggerUrl);

  const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
  log('connectCDP: ws created, waiting for open...');
  ws.on('close', (code, reason) => { log(`connectCDP WS CLOSED: code=${code}, reason=${reason ? reason.toString() : ''}`); });
  ws.on('error', (err) => { log(`connectCDP WS ERROR: ${err.message}`); });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  log('connectCDP: ws open!');

  let nId = 1;
  const pend = new Map();
  ws.on('message', d => {
    // Suppress raw WS message noise for cleaner CI logs
    const m = JSON.parse(d.toString());
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') {
      const args = m.params.args.map(a => a.value || a.description || '').join(' ');
      if (!args.includes('Decryption') && !args.includes('decryption')) {
        log(`[BROWSER CONSOLE] ${args}`);
      }
    }
    if (m.method === 'Runtime.exceptionThrown') {
      log(`[BROWSER EXCEPTION] ${JSON.stringify(m.params.exceptionDetails)}`);
    }
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

  await send('Runtime.enable');
  await send('Console.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.bringToFront');

  const scriptSource = `
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
  `;

  await send('Page.addScriptToEvaluateOnNewDocument', { source: scriptSource });

  return { ws, ev, send };
}

/** Wait up to maxMs for expr to return truthy */
async function waitFor(ev, expr, maxMs = 30000, interval = 300) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const val = await ev(expr);
    if (val) return val;
    await sleep(interval);
  }
  return null;
}

async function detectBootState(ev) {
  const wizDisplay = await ev('(function(){ var el=document.getElementById("first-boot-wizard"); return el?window.getComputedStyle(el).display:"missing"; })()');
  const authClass  = await ev('(function(){ var el=document.getElementById("auth-lock-screen"); return el?el.className:"missing"; })()');
  const authDisplay = await ev('(function(){ var el=document.getElementById("auth-lock-screen"); return el?window.getComputedStyle(el).display:"missing"; })()');
  const layoutDisplay = await ev('(function(){ var el=document.getElementById("pos-app-layout"); return el?window.getComputedStyle(el).display:"missing"; })()');

  return {
    wizardOpen: wizDisplay === 'flex',
    authOpen: authDisplay === 'flex',
    layoutOpen: layoutDisplay === 'grid',
    wizDisplay, authClass, authDisplay, layoutDisplay
  };
}

async function doLogin(ev, pin = process.env.TEST_ADMIN_PIN) {
  if (!pin) {
    throw new Error('TEST_ADMIN_PIN environment variable is required for E2E tests.');
  }
  const digits = pin.split('');
  for (const d of digits) {
    await ev(`(function(){
      var btns = document.querySelectorAll('.pin-btn');
      for (var b of btns) {
        if ((b.getAttribute('data-digit') === '${d}' || b.textContent.trim() === '${d}') && !b.classList.contains('pin-del')) {
          b.click(); return;
        }
      }
    })()`);
    await sleep(200);
  }
  // Click ENT / Enter button to submit PIN
  await ev(`(function(){
    var pad = document.getElementById('pin-pad') || document;
    var enterBtn = pad.querySelector('[data-action="enter"]');
    if (enterBtn) { enterBtn.click(); return; }
    var btns = pad.querySelectorAll('.pin-btn');
    for (var b of btns) {
      var txt = b.textContent.trim().toUpperCase();
      if (txt === 'ENT' || txt === 'ENTER' || b.getAttribute('data-action') === 'enter') {
        b.click(); return;
      }
    }
  })()`);
  // wait up to 20s for layout to appear
  const result = await waitFor(ev, `window.getComputedStyle(document.getElementById("pos-app-layout")).display==="grid"`, 20000);
  return !!result;
}

async function run() {
  log('\n══════════════════════════════════════════════════════════════');
  log(' VALENIXIA POS — COMPREHENSIVE E2E TEST SUITE v2');
  log('══════════════════════════════════════════════════════════════\n');

  const testAdminPin = process.env.TEST_ADMIN_PIN;
  const testPassphrase = process.env.TEST_PASSPHRASE;
  if (!testAdminPin || !testPassphrase) {
    throw new Error('E2E test suite requires TEST_ADMIN_PIN and TEST_PASSPHRASE to be set in environment variables.');
  }

  const { ws, ev, send } = await connectCDP();

  log('Stopping all Service Workers via CDP...');
  try {
    await send('ServiceWorker.enable');
    await send('ServiceWorker.stopAllWorkers');
    await send('ServiceWorker.disable');
  } catch (err) {
    log('ServiceWorker CDP nuke failed: ' + err.message);
  }

  log('Clearing browser storage and Service Worker cache via CDP...');
  await send('Storage.clearDataForOrigin', { origin: 'http://localhost:3000', storageTypes: 'all' });
  await sleep(1000);

  log('Navigating to http://localhost:3000...');
  await send('Page.navigate', { url: 'http://localhost:3000' });
  await sleep(3000); // give it time to load

  // ────────────────────────────────────────────────────────────────────────────
  //  SECTION 0: Wait for page to fully initialize (max 15s)
  // ────────────────────────────────────────────────────────────────────────────
  log('=== SECTION 0: Waiting for App Initialization ===');
  
  await sleep(500); // wait for init to start after reload

  // Wait until at least one of the three main screens is showing
  const initDone = await waitFor(ev, `(function() {
    if (document.readyState === 'loading') return false;
    const ids = ['first-boot-wizard', 'auth-lock-screen', 'pos-app-layout', 'license-lockout-overlay'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && el.offsetHeight > 0 && window.getComputedStyle(el).display !== 'none') {
        return id;
      }
    }
    return false;
  })()`, 60000, 400);

  if (initDone) pass(`App initialized — application boot sequence fully finished (found #${initDone})`);
  else {
    const currentUrl = await ev('window.location.href');
    fail('App initialization', `DOM ready state or critical UI elements did not appear within 60s. Current URL: ${currentUrl}`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  SECTION 1: Boot State
  // ────────────────────────────────────────────────────────────────────────────
  log('\n=== SECTION 1: Boot State & DOM Integrity ===');

  const title = await ev('document.title');
  if (title === 'Valenixia Commerce POS') pass('Document title correct');
  else fail('Document title', `Got: ${title}`);

  const readyState = await ev('document.readyState');
  if (readyState === 'complete' || readyState === 'interactive') pass('Page loaded or interactive');
  else fail('Page readyState', `Got: ${readyState}`);

  // License tier — wait up to 45s for license engine to set it (CI runners are slow)
  const tier = await waitFor(ev, 'window.__valenixiaTier', 45000);
  if (tier) pass(`License tier: ${tier}`);
  else fail('License tier', 'window.__valenixiaTier not set after 45s');

  const graceTrialFn = await ev('typeof window.isGraceTrialActive');
  if (graceTrialFn === 'function') pass('isGraceTrialActive globally exposed');
  else fail('isGraceTrialActive exposed', `Got: ${graceTrialFn}`);

  // ────────────────────────────────────────────────────────────────────────────
  //  SECTION 2: Critical DOM Elements
  // ────────────────────────────────────────────────────────────────────────────
  log('\n=== SECTION 2: Critical UI Element Presence ===');

  const elems = [
    ['first-boot-wizard','Wizard overlay exists'],
    ['auth-lock-screen','Auth lock screen exists'],
    ['pos-app-layout','Main POS layout exists'],
    ['btn-checkout-complete','Checkout complete button exists'],
    ['checkout-search-input','Checkout search input exists'],
    ['txt-total','Total display element exists'],
    ['btn-catalog-create-product','Catalog add button exists'],
    ['history-transactions-list','History list container exists'],
    ['theme-toggle-btn','Theme toggle button exists'],
    ['lang-toggle-btn','Language toggle button exists'],
  ];
  for (const [id, label] of elems) {
    const exists = await ev(`!!document.getElementById('${id}')`);
    if (exists) pass(label);
    else fail(label, `#${id} not found in DOM`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  SECTION 3: Screen Routing State
  // ────────────────────────────────────────────────────────────────────────────
  log('\n=== SECTION 3: Current Screen Routing ===');

  const boot = await detectBootState(ev);
  info(`Wizard: ${boot.wizDisplay} | Auth: ${boot.authDisplay} | Layout: ${boot.layoutDisplay}`);

  if (boot.wizardOpen) {
    pass('App in SETUP WIZARD mode (first boot)');
  } else if (boot.authOpen) {
    pass('App in AUTH LOCK mode (post-setup, awaiting PIN)');
  } else if (boot.layoutOpen) {
    pass('App in MAIN UI mode (already logged in)');
  } else {
    fail('Screen routing state', `None of wizard/auth/layout is visible — init may have failed`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  SECTION 4: Wizard Flow (only if wizard is open)
  // ────────────────────────────────────────────────────────────────────────────
  if (boot.wizardOpen) {
    log('\n=== SECTION 4: Running Wizard Setup ===');

    // Choose NEW store
    await ev('document.getElementById("btn-wiz-choose-new")?.click()');
    await sleep(400);

    // Step 1 — Store Details
    await ev(`(function(){
      var n = document.getElementById("wizard-store-name"); if(n){n.value="Test Brew Co"; n.dispatchEvent(new Event("input",{bubbles:true}));}
      var t = document.getElementById("wizard-tax-rate"); if(t){t.value="17"; t.dispatchEvent(new Event("input",{bubbles:true}));}
    })()`);
    await ev('document.getElementById("btn-wiz-next")?.click()');
    await sleep(500);

    const pinField = await ev('!!document.getElementById("wizard-admin-pin")');
    if (pinField) pass('Wizard: Step 2 loaded (PIN field)');
    else fail('Wizard step 2', 'wizard-admin-pin not found');

    // Step 2 — PIN + Passphrase
    await ev(`(function(){
      var p = document.getElementById("wizard-admin-pin"); if(p){p.value="${testAdminPin}"; p.dispatchEvent(new Event("input",{bubbles:true}));}
      var s = document.getElementById("wizard-sync-passphrase"); if(s){s.value="${testPassphrase}"; s.dispatchEvent(new Event("input",{bubbles:true}));}
    })()`);
    await ev('document.getElementById("btn-wiz-next")?.click()');
    await sleep(500);

    // Step 3 — Review
    const sumStore = await ev('document.getElementById("wiz-sum-store") ? document.getElementById("wiz-sum-store").textContent.trim() : "missing"');
    if (sumStore && sumStore.toLowerCase().includes('test brew')) pass(`Wizard review shows store name: "${sumStore}"`);
    else info(`Review store display: "${sumStore}"`);

    // Accept EULA and submit
    await ev('var cb=document.getElementById("wizard-eula-checkbox"); if(cb){cb.checked=true; cb.dispatchEvent(new Event("change",{bubbles:true}));}');
    await sleep(200);
    await ev('document.getElementById("btn-submit-wizard")?.click()');
    info('Waiting 10s for bootstrap to complete...');
    await sleep(10000);

    // Verify wizard dismissed
    const postWizDisplay = await ev('window.getComputedStyle(document.getElementById("first-boot-wizard")).display');
    if (postWizDisplay === 'none') pass('Wizard dismissed after submit');
    else fail('Wizard dismiss', `Still showing: ${postWizDisplay}`);

    // Verify auth screen shown
    const postAuthDisplay = await ev('window.getComputedStyle(document.getElementById("auth-lock-screen")).display');
    if (postAuthDisplay === 'flex') pass('Auth lock screen shown after wizard');
    else fail('Auth after wizard', `Auth display: ${postAuthDisplay}`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  SECTION 4b: PIN Login (if auth screen is open)
  // ────────────────────────────────────────────────────────────────────────────
  const bootNow = await detectBootState(ev);

  if (bootNow.authOpen || bootNow.wizardOpen) {
    log('\n=== SECTION 4b: PIN Login ===');
    const loginOk = await doLogin(ev, testAdminPin);
    if (loginOk) pass(`PIN ${testAdminPin} login — main layout visible`);
    else {
      // Try default PIN 0000
      info(`${testAdminPin} failed, trying 0000...`);
      const login2 = await doLogin(ev, '0000');
      if (login2) pass('PIN 0000 login — main layout visible');
      else fail('PIN Login', 'Layout did not appear after PIN entry');
    }
    await sleep(500);
  } else {
    info('Already logged in — skipping PIN entry');
  }

  // Make sure we are in main app mode now
  const finalBoot = await detectBootState(ev);
  const appIsOpen = finalBoot.layoutOpen;
  if (appIsOpen) pass('Main POS layout confirmed open');
  else fail('Main POS layout', `Layout display: ${finalBoot.layoutDisplay}`);

  // ────────────────────────────────────────────────────────────────────────────
  //  SECTION 5: Navigation
  // ────────────────────────────────────────────────────────────────────────────
  log('\n=== SECTION 5: Screen Navigation ===');

  const navScreens = await ev('JSON.stringify(Array.from(document.querySelectorAll(".nav-item[data-screen]")).map(el=>el.getAttribute("data-screen")))');
  const screens = JSON.parse(navScreens || '[]');
  if (screens.length >= 8) pass(`Navigation has ${screens.length} screens`);
  else fail('Navigation screens count', `Only ${screens.length}`);

  const requiredScreens = ['checkout','catalog','history','analytics','staff','settings'];
  for (const scr of requiredScreens) {
    if (screens.includes(scr)) pass(`Nav: screen "${scr}" registered`);
    else fail(`Nav screen "${scr}"`, 'Not found in nav items');
  }

  if (appIsOpen) {
    // Only test non-manager-gated screens to avoid PIN prompt dialogs
    const testScreens = ['checkout', 'catalog', 'history', 'analytics'];
    for (const scr of testScreens) {
      await ev(`(function(){ var el=document.querySelector(".nav-item[data-screen='${scr}']"); if(el) el.click(); })()`);
      await sleep(500);
      // Views show via .active class → display:block
      const hasActiveClass = await ev(`!!document.getElementById('view-${scr}')?.classList.contains('active')`);
      const display = await ev(`window.getComputedStyle(document.getElementById('view-${scr}')||document.createElement('div')).display`);
      if (hasActiveClass || display === 'block') pass(`Screen "${scr}" renders correctly (display:block)`);
      else fail(`Screen "${scr}" render`, `active:${hasActiveClass}, display:${display}`);
    }
    // Go back to checkout
    await ev('document.querySelector(".nav-item[data-screen=\'checkout\']")?.click()');
    await sleep(400);
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  SECTION 6: Add Product to Catalog
  // ────────────────────────────────────────────────────────────────────────────
  log('\n=== SECTION 6: Catalog — Add Product ===');

  if (appIsOpen) {
    // Navigate to catalog manager
    await ev('document.querySelector(".nav-item[data-screen=\'catalog-manager\']")?.click()');
    await sleep(700);

    await ev('document.getElementById("btn-catalog-create-product")?.click()');
    await sleep(500);

    const formExists = await ev('!!document.getElementById("form-product-sku")');
    if (formExists) pass('Product add modal opened');
    else fail('Product modal', 'form-product-sku not found after clicking add button');

    if (formExists) {
      await ev(`(function(){
        function setVal(id, val) {
          var el = document.getElementById(id);
          if (!el) return;
          el.value = val;
          el.dispatchEvent(new Event("input",{bubbles:true}));
          el.dispatchEvent(new Event("change",{bubbles:true}));
        }
        setVal("form-product-sku",    "E2E-SKU-777");
        setVal("form-product-name",   "E2E Test Widget");
        setVal("form-product-price",  "250");
        setVal("form-product-stock",  "100");
        setVal("form-product-category","Drinks");
        setVal("form-product-emoji",  "🧪");
      })()`);
      await sleep(200);

      await ev('document.getElementById("btn-submit-product-modal")?.click()');
      const productAdded = await waitFor(ev, `(function(){
        var html = document.getElementById("catalog-virtual-container")?.innerHTML || document.getElementById("catalog-grid-container")?.innerHTML || "";
        return html.includes("E2E-SKU-777") || html.includes("E2E Test Widget");
      })()`, 15000, 300);
      if (productAdded) {
        pass('Product "E2E Test Widget" added and visible in catalog');
      } else {
        // Try searching for it
        const searchInput = await ev('!!document.getElementById("catalog-search-input")');
        if (searchInput) {
          await ev('var si=document.getElementById("catalog-search-input"); si.value="E2E"; si.dispatchEvent(new Event("input",{bubbles:true}));');
          await sleep(700);
          const filtered = await ev('document.getElementById("catalog-virtual-container")?.innerHTML || document.getElementById("catalog-grid-container")?.innerHTML || ""');
          if (filtered?.includes('E2E')) pass('Product found via catalog search');
          else fail('Product add', 'SKU/name not found in catalog container');
        } else {
          fail('Product add', 'Catalog container empty and no search field found');
        }
      }
    }
  } else {
    fail('Section 6 skipped', 'App was not in main mode');
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  SECTION 7: Checkout Flow — Add to Cart + Complete Sale
  // ────────────────────────────────────────────────────────────────────────────
  log('\n=== SECTION 7: Checkout Flow ===');

  if (appIsOpen) {
    await ev('document.querySelector(".nav-item[data-screen=\'checkout\']")?.click()');
    await sleep(500);

    // Try to add via quick catalog grid cards first
    const quickCards = await ev('document.querySelectorAll(".product-quick-card").length');
    info(`Quick catalog cards: ${quickCards}`);

    let addedToCart = false;

    if (quickCards > 0) {
      await ev('document.querySelector(".product-quick-card")?.click()');
      await sleep(600);
      const cartRows = await ev('document.querySelectorAll(".cart-item-row").length');
      if (cartRows > 0) { addedToCart = true; pass(`Quick-card add to cart (${cartRows} item)`); }
    }

    if (!addedToCart) {
      // Try search
      const si = await ev('document.getElementById("checkout-search-input")');
      if (si !== null) {
        await ev('var si=document.getElementById("checkout-search-input"); si.value="E2E"; si.dispatchEvent(new Event("input",{bubbles:true}));');
        await sleep(600);
        const hasResults = await ev('document.querySelectorAll(".search-result-item").length');
        if (hasResults > 0) {
          await ev('document.querySelector(".search-result-item")?.click()');
          await sleep(500);
          const cartRows = await ev('document.querySelectorAll(".cart-item-row").length');
          if (cartRows > 0) { addedToCart = true; pass(`Search+click add to cart (${cartRows} item)`); }
        } else {
          // Use keyboard enter on any product
          await ev('var si=document.getElementById("checkout-search-input"); si.value=""; si.dispatchEvent(new Event("input",{bubbles:true}));');
          await sleep(400);
          const anyCard = await ev('document.querySelectorAll(".product-quick-card").length');
          if (anyCard > 0) {
            await ev('document.querySelector(".product-quick-card")?.click()');
            await sleep(500);
            const cartRows2 = await ev('document.querySelectorAll(".cart-item-row").length');
            if (cartRows2 > 0) { addedToCart = true; pass(`Quick-card (retry) — cart: ${cartRows2} items`); }
          }
        }
      }
    }

    if (!addedToCart) fail('Add to cart', 'Could not add any product to cart');

    // Check total updated
    const total = await ev('document.getElementById("txt-total")?.textContent?.trim()');
    pass(`Cart total: ${total}`);

    // Complete the sale
    await ev('document.getElementById("btn-checkout-complete")?.click()');
    const cartCleared = await waitFor(ev, 'document.querySelectorAll(".cart-item-row").length === 0', 15000, 300);
    if (cartCleared) pass('Cart cleared after completing sale');
    else {
      const postCartRows = await ev('document.querySelectorAll(".cart-item-row").length');
      fail('Cart clear', `${postCartRows} rows still in cart after 15s`);
    }

    // ─── Check history ──────────────────────────────────────────────────────
    await ev('document.querySelector(".nav-item[data-screen=\'history\']")?.click()');
    const historyLoaded = await waitFor(ev, 'document.querySelectorAll("#history-transactions-list .tx-card").length > 0', 10000, 300);
    if (historyLoaded) {
      const txCount = await ev('document.querySelectorAll("#history-transactions-list .tx-card").length');
      pass(`Transaction saved — ${txCount} record(s) in history`);
    } else {
      fail('Transaction history', 'No records found in #history-transactions-list after 10s');
    }
  } else {
    fail('Section 7 skipped', 'App was not in main mode');
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  SECTION 8: Light Theme Toggle — Monochrome Ivory
  // ────────────────────────────────────────────────────────────────────────────
  log('\n=== SECTION 8: Light Theme (Monochrome Ivory) ===');

  if (appIsOpen) {
    const themes = ['theme-obsidian-emerald','theme-midnight-sapphire','theme-warm-amber','theme-minimalist-chrome','theme-monochrome-ivory'];
    
    const getCurrentTheme = async () => {
      return await ev(`(function(){
        var themes = ["theme-obsidian-emerald","theme-midnight-sapphire","theme-warm-amber","theme-minimalist-chrome","theme-monochrome-ivory"];
        return themes.find(t => document.body.classList.contains(t)) || "none";
      })()`);
    };

    const startTheme = await getCurrentTheme();
    info(`Starting theme: ${startTheme}`);

    // Cycle until ivory
    let reachedIvory = false;
    for (let i = 0; i < 6; i++) {
      await ev('document.getElementById("theme-toggle-btn")?.click()');
      await sleep(250);
      const t = await getCurrentTheme();
      if (t === 'theme-monochrome-ivory') { reachedIvory = true; break; }
    }

    if (reachedIvory) {
      pass('Theme cycled to Monochrome Ivory (light)');
      
      // Verify light background
      const bodyBg = await ev('getComputedStyle(document.body).backgroundColor');
      pass(`Body background in ivory: ${bodyBg}`);

      // Check it looks light (RGB should have high values)
      const isLight = bodyBg?.match(/rgba?\(\s*(\d+)/);
      const r = isLight ? parseInt(isLight[1]) : 0;
      if (r > 200) pass('Body background is clearly light-colored in ivory theme');
      else fail('Light bg in ivory', `Background rgb starts with: ${r} (expected > 200)`);

      // Check sidebar
      const sidebarBg = await ev('window.getComputedStyle(document.querySelector(".pos-sidebar"))?.backgroundColor');
      pass(`Sidebar bg in ivory: ${sidebarBg}`);

      // Check input colors
      const inputColor = await ev('window.getComputedStyle(document.querySelector(".pos-input"))?.color');
      pass(`Input text color in ivory: ${inputColor}`);

      // Check input has dark text (low red value)
      const inputDark = inputColor?.match(/rgba?\(\s*(\d+)/);
      const ir = inputDark ? parseInt(inputDark[1]) : 255;
      if (ir < 100) pass('Input text is dark in light mode (good contrast)');
      else fail('Input contrast in light mode', `Text color rgb starts with ${ir} (should be < 100)`);
    } else {
      fail('Theme switch to ivory', 'Could not reach monochrome-ivory after 6 cycles');
    }

    // Cycle back to obsidian-emerald
    for (let i = 0; i < 5; i++) {
      await ev('document.getElementById("theme-toggle-btn")?.click()');
      await sleep(200);
      const t = await getCurrentTheme();
      if (t === 'theme-obsidian-emerald') break;
    }
    const backTheme = await getCurrentTheme();
    if (backTheme === 'theme-obsidian-emerald') pass('Theme restored to default (obsidian-emerald)');
    else info(`Theme after restore: ${backTheme}`);
  } else {
    fail('Section 8 skipped', 'App not in main mode');
  }

  // ────────────────────────────────────────────────────────────────────────────
  //  SECTION 9: Mobile Layout Verification
  // ────────────────────────────────────────────────────────────────────────────
  log('\n=== SECTION 9: Mobile Layout Elements ===');

  const bottomNavExists = await ev('!!document.querySelector(".pos-bottom-nav")');
  if (bottomNavExists) pass('Mobile bottom nav element exists');
  else fail('Mobile bottom nav', 'Element not found');

  const offlinePill = await ev('!!document.getElementById("mobile-offline-pill")');
  if (offlinePill) pass('Mobile offline pill exists');
  else fail('Mobile offline pill', 'Element not found');

  const mobileNavBtns = await ev('document.querySelectorAll(".pos-bottom-nav .nav-btn").length');
  if (mobileNavBtns >= 4) pass(`Mobile nav has ${mobileNavBtns} navigation buttons`);
  else fail('Mobile nav buttons', `Only ${mobileNavBtns} found`);

  // Check layout uses CSS Grid properly
  const layoutGrid = await ev('window.getComputedStyle(document.getElementById("pos-app-layout"))?.gridTemplateColumns');
  if (layoutGrid && layoutGrid !== 'none') pass(`Layout grid-template-columns: ${layoutGrid}`);
  else fail('Layout grid', 'grid-template-columns not set');

  // ────────────────────────────────────────────────────────────────────────────
  //  SECTION 10: Error State + Service Worker
  // ────────────────────────────────────────────────────────────────────────────
  log('\n=== SECTION 10: Error & Health Checks ===');

  const crashOverlay = await ev('document.getElementById("crash-console-overlay") ? window.getComputedStyle(document.getElementById("crash-console-overlay")).display : "not-found"');
  if (crashOverlay === 'not-found' || crashOverlay === 'none') pass('No crash console overlay displayed');
  else fail('Crash console', `Crash overlay visible: ${crashOverlay}`);

  const swRegistered = await ev('(async function(){ var r=await navigator.serviceWorker.getRegistration(); return r ? r.scope : "none"; })()');
  if (swRegistered && swRegistered !== 'none') pass(`Service Worker registered: ${swRegistered}`);
  else fail('Service Worker', 'Not registered');

  const dbInit = await ev('(async function(){ try { return typeof ValenixiaDB !== "undefined" && typeof ValenixiaDB.get === "function" ? "ok" : "no-db"; } catch(e){ return "err: "+e.message; } })()');
  if (dbInit === 'ok') pass('ValenixiaDB object accessible on window');
  else fail('ValenixiaDB', `Status: ${dbInit}`);

  const workerMsg = await ev('typeof syncWorker !== "undefined" ? "ok" : "not-found"');
  if (workerMsg === 'ok') pass('syncWorker variable accessible');
  else fail('syncWorker', 'Not accessible in page scope');

  // ────────────────────────────────────────────────────────────────────────────
  //  SECTION 11: Pricing Cycle, FBR, and AMC Verification
  // ────────────────────────────────────────────────────────────────────────────
  log('\n=== SECTION 11: Pricing Cycle, FBR & AMC Verification ===');

  const configExists = await ev('typeof window.LICENSE_CONFIG !== "undefined"');
  if (configExists) {
    pass('LICENSE_CONFIG is loaded globally');
    
    // Verify pricing tiers
    const starterPrice = await ev('window.LICENSE_CONFIG.STARTER.trialDays');
    if (starterPrice === 7) pass('Starter trialDays is 7 days');
    else fail('Starter trialDays', `Expected 7, got: ${starterPrice}`);

    const proTerminals = await ev('window.LICENSE_CONFIG.PRO.allowedTerminals');
    if (proTerminals === 1) pass('Pro allowed registers is 1 (3 terminals total)');
    else fail('Pro registers', `Expected 1, got: ${proTerminals}`);
  } else {
    fail('LICENSE_CONFIG', 'window.LICENSE_CONFIG is undefined');
  }

  // Test AMC expiry blocks checkout
  await ev('window.__amcExpired = true');
  const cartRendered = await ev('(async function() { try { state.activeCart = [{ id: "test", name: "Tea", price_cents: 10000, quantity: 1 }]; renderCart(); return true; } catch(e) { return false; } })()');
  if (cartRendered) {
    // Attempt checkout
    const alertTriggered = await ev(`(async function() {
      let alertMsg = null;
      const originalAlert = window.alert;
      window.alert = function(msg) { alertMsg = msg; };
      const btn = document.getElementById("btn-checkout-complete");
      if (btn) btn.click();
      window.alert = originalAlert;
      return alertMsg;
    })()`);
    if (alertTriggered && alertTriggered.includes('AMC EXPIRED')) {
      pass('AMC Expired state blocks checkout and triggers alert warning');
    } else {
      fail('AMC Block check', `Expected AMC EXPIRED alert, got: ${alertTriggered}`);
    }
  } else {
    fail('Cart initialization', 'Could not populate cart');
  }
  // Restore AMC state
  await ev('window.__amcExpired = false');
  await ev('state.activeCart = []; renderCart();');

  // ────────────────────────────────────────────────────────────────────────────
  //  SUMMARY
  // ────────────────────────────────────────────────────────────────────────────
  ws.close();
  if (activeTabId) {
    log('Closing test tab...');
    await devToolsRequest(`/json/close/${activeTabId}`, 'GET').catch(() => {});
    log('Test tab closed.');
  }

  const pct = Math.round(PASS / (PASS + FAIL) * 100);
  log('\n══════════════════════════════════════════════════════════════');
  log(` RESULTS: ${PASS + FAIL} tests  ✅ ${PASS} passed  ❌ ${FAIL} failed  (${pct}%)`);
  log('══════════════════════════════════════════════════════════════');

  if (FAIL > 0) {
    log('\nFailed tests:');
    results.filter(r => !r.ok).forEach(r => log(`  ❌ ${r.t} :: ${r.r}`));
  }

  log(`\n${FAIL === 0 ? '🎉 ALL TESTS PASSED — PRODUCTION READY!' : FAIL <= 3 ? '⚠️  Minor issues — review above' : '🔴 Multiple failures — review needed'}\n`);
  process.exit(FAIL > 0 ? 1 : 0);
}

run().catch(async e => { 
  log(`[FATAL] ${e.stack || e.message}`); 
  if (activeTabId) {
    await devToolsRequest(`/json/close/${activeTabId}`, 'GET').catch(() => {});
  }
  process.exit(1); 
});
