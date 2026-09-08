// ============================================================================
// TEST: Subscription & Store Restoration Suite
// Verifies /api/subscription/restore functionality with phone, store name, and claim ID
// ============================================================================

const assert = require('assert');

async function runRestoreSuite() {
  console.log('--- Starting Subscription & Store Restoration Tests ---');

  const restoreHandler = require('../api/subscription/restore');

  // Test 1: Query without parameters returns 400
  let resStatus = 0;
  let resData = null;
  const mockRes = {
    setHeader: () => {},
    status: (code) => {
      resStatus = code;
      return {
        json: (data) => { resData = data; }
      };
    }
  };

  await restoreHandler({ method: 'GET', query: {} }, mockRes);
  assert.strictEqual(resStatus, 400, 'Empty query must return 400');
  assert.strictEqual(resData.ok, false, 'ok must be false');
  console.log('✔ Test 1 passed: Empty query returns 400.');

  // Test 2: Query for Native store returns 200 with matching store objects
  await restoreHandler({ method: 'GET', query: { query: 'Native' } }, mockRes);
  assert.strictEqual(resStatus, 200, 'Valid query must return 200');
  assert.strictEqual(resData.ok, true, 'ok must be true');
  assert.ok(Array.isArray(resData.stores), 'stores must be an array');
  assert.ok(resData.stores.length > 0, 'Found at least 1 matching store');
  const store = resData.stores[0];
  assert.ok(store.storeName, 'Store has storeName');
  assert.ok(store.tier, 'Store has tier');
  assert.ok(typeof store.daysRemaining === 'number', 'Store has daysRemaining');
  // Test 3: Client-side applyStoreRestoration routes directly to checkout and dismisses wizard
  console.log('--- Testing Client-Side applyStoreRestoration State & Routing ---');
  
  // Setup mock browser globals
  const mockLocalStorage = {};
  const mockSessionStorage = {};
  global.localStorage = {
    getItem: (k) => mockLocalStorage[k] || null,
    setItem: (k, v) => { mockLocalStorage[k] = String(v); },
    removeItem: (k) => { delete mockLocalStorage[k]; }
  };
  global.sessionStorage = {
    getItem: (k) => mockSessionStorage[k] || null,
    setItem: (k, v) => { mockSessionStorage[k] = String(v); },
    removeItem: (k) => { delete mockSessionStorage[k]; }
  };
  
  let transitionedState = null;
  let activeScreenRouted = null;
  let wizardDisplay = 'block';
  let wizardActive = true;
  let bodyClasses = new Set(['wizard-active']);

  global.window = {
    state: { activeScreen: 'wizard' },
    ValenixiaBootstrap: {
      transition: (st) => { transitionedState = st; }
    },
    switchActiveScreen: (sc) => {
      activeScreenRouted = sc;
      if (global.window.state) global.window.state.activeScreen = sc;
    },
    renderCheckoutScreen: () => {},
    playAudioSignal: () => {},
    triggerConfetti: () => {},
    showNotificationToast: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    CustomEvent: class CustomEvent { constructor(type, detail) { this.type = type; this.detail = detail; } }
  };
  global.CustomEvent = global.window.CustomEvent;

  const mockWizEl = {
    style: {
      setProperty: (prop, val) => {
        if (prop === 'display') wizardDisplay = val;
      }
    },
    classList: {
      remove: (c) => {
        if (c === 'active') wizardActive = false;
      }
    }
  };

  const mockLayoutEl = {
    style: { setProperty: () => {} },
    classList: { add: () => {} }
  };

  global.document = {
    getElementById: (id) => {
      if (id === 'first-boot-wizard') return mockWizEl;
      if (id === 'pos-app-layout') return mockLayoutEl;
      return null;
    },
    body: {
      classList: {
        remove: (c) => bodyClasses.delete(c),
        add: (c) => bodyClasses.add(c)
      }
    },
    documentElement: {
      classList: { add: () => {} }
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  // Require / execute subscription module
  const fs = require('fs');
  const path = require('path');
  const subCode = fs.readFileSync(path.join(__dirname, '../public/subscription.js'), 'utf8');
  eval(subCode);

  assert.ok(global.window.ValenixiaClaimsManager, 'ValenixiaClaimsManager must be exported to window');
  
  const testClaim = {
    id: 'CLM-TEST-001',
    targetTier: 'ENTERPRISE',
    storeName: 'Test Enterprise Mart',
    ownerName: 'Test Owner',
    phone: '03009998877',
    hwid: 'AND-TEST-HWID',
    expiresAt: Date.now() + 15 * 86400000
  };

  const applyRes = global.window.ValenixiaClaimsManager.applyStoreRestoration(testClaim);
  assert.strictEqual(applyRes.success, true, 'Restoration must succeed');
  assert.strictEqual(global.localStorage.getItem('onboarding_complete'), 'true', 'onboarding_complete must be true');
  assert.strictEqual(global.localStorage.getItem('valenixia_tier'), 'ENTERPRISE', 'Tier must be set to ENTERPRISE');
  assert.strictEqual(global.localStorage.getItem('valenixia_store_name'), 'Test Enterprise Mart', 'Store name must match');
  assert.strictEqual(transitionedState, 'READY', 'Bootstrap must transition to READY');
  assert.strictEqual(activeScreenRouted, 'checkout', 'Must route directly to checkout screen');
  assert.strictEqual(global.window.state.activeScreen, 'checkout', 'State activeScreen must be checkout');
  assert.strictEqual(wizardDisplay, 'none', 'Wizard display must be set to none');
  assert.strictEqual(wizardActive, false, 'Wizard active class must be removed');
  assert.strictEqual(bodyClasses.has('wizard-active'), false, 'Body must not have wizard-active class');
  assert.strictEqual(global.window.__valenixiaAuthenticated, true, 'User must be authenticated');
  assert.strictEqual(global.window.state.activeCashier.role, 'ADMIN', 'Active cashier must be ADMIN');

  console.log('✔ Test 3 passed: Client-side applyStoreRestoration successfully dismisses wizard, sets session, and routes directly to checkout!');

  console.log('--- All Subscription Restoration Tests Passed! ---');
}

runRestoreSuite().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

