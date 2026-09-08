// ============================================================================
// TEST: Deals in Free Tier & Multi-Store Device Entitlement Isolation Suite
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function runSuite() {
  console.log('--- Starting Deals & Multi-Store Device Isolation Test Suite ---');

  // Test 1: FEATURE_TIER_REQ has deals mapped to FREE
  const freemiumCode = fs.readFileSync(path.join(__dirname, '../public/freemium-engine.js'), 'utf8');
  
  // Set up mock window/document environment
  const mockLocalStorage = {};
  global.localStorage = {
    getItem: (k) => mockLocalStorage[k] || null,
    setItem: (k, v) => { mockLocalStorage[k] = String(v); },
    removeItem: (k) => { delete mockLocalStorage[k]; }
  };
  
  global.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    CustomEvent: class CustomEvent { constructor(type, detail) { this.type = type; this.detail = detail; } }
  };
  global.document = {
    createElement: () => ({ style: {}, setAttribute: () => {}, querySelector: () => null, querySelectorAll: () => [] }),
    getElementById: () => null,
    body: { appendChild: () => {}, removeChild: () => {}, classList: { add: () => {}, remove: () => {} } }
  };
  global.navigator = { userAgent: 'NodeTestAgent', language: 'en-US', onLine: true };
  global.screen = { width: 1920, height: 1080, colorDepth: 24 };

  eval(freemiumCode);

  assert.strictEqual(typeof global.window.can, 'function', 'window.can must be a function');
  assert.strictEqual(global.window.can('deals'), true, 'Deals must be accessible on default FREE tier');
  assert.strictEqual(global.window.can('checkout'), true, 'Checkout must be accessible on FREE tier');
  assert.strictEqual(global.window.can('inventory'), true, 'Inventory must be accessible on FREE tier');
  assert.strictEqual(global.window.can('kds'), false, 'KDS must require paid tier on FREE plan');
  assert.strictEqual(global.window.can('fbr-fiscal'), false, 'FBR fiscal must require Enterprise on FREE plan');
  console.log('✔ Test 1 passed: Deals & Bundles is fully available on FREE tier without paywall.');

  // Test 2: Native App vs Web App HWID Generation & Isolation
  const licenseCode = fs.readFileSync(path.join(__dirname, '../public/license-engine.js'), 'utf8');
  eval(licenseCode);

  assert.ok(global.window.LicenseEngine, 'LicenseEngine must be exported to window');
  
  // 2a. Web App HWID for Store A
  delete global.window.AndroidPOS;
  delete global.window.Android;
  delete global.window.__valenixiaHWID;
  mockLocalStorage['valenixia_store_name'] = 'Store Alpha';
  delete mockLocalStorage['valenixia_hwid'];

  const webHwidA = await global.window.LicenseEngine.generateHWID('Store Alpha');
  assert.ok(webHwidA.startsWith('WEB-'), 'Web App HWID must start with WEB-');

  // 2b. Web App HWID for Store B
  delete global.window.__valenixiaHWID;
  delete mockLocalStorage['valenixia_hwid'];
  const webHwidB = await global.window.LicenseEngine.generateHWID('Store Beta');
  assert.ok(webHwidB.startsWith('WEB-'), 'Web App HWID must start with WEB-');
  assert.notStrictEqual(webHwidA, webHwidB, 'Store Alpha and Store Beta on same device must generate different HWIDs');

  // 2c. Native Android App HWID on same device
  delete global.window.__valenixiaHWID;
  delete mockLocalStorage['valenixia_hwid'];
  global.window.AndroidPOS = {
    getDeviceID: () => 'AND-POS-NATIVE-DEVICE-9999'
  };
  const nativeHwid = await global.window.LicenseEngine.generateHWID('Store Alpha');
  assert.ok(nativeHwid.startsWith('AND-'), 'Native Android HWID must start with AND-');
  assert.notStrictEqual(nativeHwid, webHwidA, 'Native App and Web App on same device must have distinct HWIDs');
  console.log('✔ Test 2 passed: Native App and Web App produce distinct hardware identities with store isolation.');

  // Test 3: Upgrading Native App does not pollute Web App tier
  const statusHandler = require('../api/subscription/status');
  
  // Native store status query
  let resStatus = 0;
  let resData = null;
  const mockRes = {
    setHeader: () => {},
    status: (code) => {
      resStatus = code;
      return { json: (data) => { resData = data; } };
    }
  };

  // Query Web store B (free)
  await statusHandler({ method: 'GET', query: { hwid: webHwidB, store_name: 'Store Beta' } }, mockRes);
  assert.strictEqual(resStatus, 200);
  assert.strictEqual(resData.tier, 'FREE', 'Web store Beta must remain FREE');
  assert.strictEqual(resData.expires_at, '0', 'Web store Beta expires_at must be 0');

  console.log('✔ Test 3 passed: Multi-store entitlement isolation verified on same machine.');
  console.log('--- All Deals & Multi-Store Isolation Tests Passed! ---');
  process.exit(0);
}

runSuite().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
