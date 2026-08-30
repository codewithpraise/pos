const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- TESTING TIER FEATURE REDISTRIBUTION & STRICT FREE LIMITS ---');

// 1. Check freemium-engine.js source
const freemiumCode = fs.readFileSync(path.join(__dirname, '../public/freemium-engine.js'), 'utf8');

// Evaluate in sandbox
const sandbox = {
  window: {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {}
  },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  localStorage: {
    store: {},
    getItem(k) { return this.store[k] || null; },
    setItem(k, v) { this.store[k] = String(v); },
    removeItem(k) { delete this.store[k]; }
  },
  document: {
    getElementById() { return null; },
    querySelectorAll() { return []; },
    body: { appendChild() {} }
  },
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  Date: Date,
  Math: Math,
  parseInt: parseInt,
  parseFloat: parseFloat,
  isNaN: isNaN,
  Array: Array,
  Object: Object,
  String: String,
  Number: Number,
  Boolean: Boolean,
  JSON: JSON
};
sandbox.window = sandbox;

const fn = new Function('window', 'localStorage', 'document', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'Math', 'parseInt', 'parseFloat', 'isNaN', 'Array', 'Object', 'String', 'Number', 'Boolean', 'JSON', freemiumCode);

fn(
  sandbox.window, sandbox.localStorage, sandbox.document, sandbox.console, sandbox.setTimeout, sandbox.clearTimeout, sandbox.setInterval, sandbox.clearInterval, sandbox.Date, sandbox.Math, sandbox.parseInt, sandbox.parseFloat, sandbox.isNaN, sandbox.Array, sandbox.Object, sandbox.String, sandbox.Number, sandbox.Boolean, sandbox.JSON
);

const { can, getActiveTier, getLimits, checkLimit, isLimitReached } = sandbox.window;

// Test 1: Active Tier default for fresh store
console.log('1. Testing Fresh Store Active Tier Default...');
sandbox.window.__valenixiaTier = null;
sandbox.localStorage.removeItem('valenixia_tier');
const freshTier = getActiveTier();
console.log('   Fresh store active tier:', freshTier);
assert.strictEqual(freshTier, 'FREE', 'Fresh store should default to FREE tier');

// Test 2: Free Tier Limits
console.log('2. Testing Free Tier Limits...');
const freeLimits = getLimits('FREE');
console.log('   Free tier limits:', JSON.stringify(freeLimits));
assert.strictEqual(freeLimits.transactionsPerDay, 20);
assert.strictEqual(freeLimits.transactionsPerMonth, 50);
assert.strictEqual(freeLimits.products, 25);
assert.strictEqual(freeLimits.customers, 50);
assert.strictEqual(freeLimits.devices, 1);

// Test 3: checkLimit on Free tier
console.log('3. Testing checkLimit enforcement on Free tier...');
const prodUnder = checkLimit('products', 10);
assert.strictEqual(prodUnder.allowed, true);
const prodAtLimit = checkLimit('products', 25);
assert.strictEqual(prodAtLimit.allowed, false, 'Should block adding 26th product when 25 already exist');

const custUnder = checkLimit('customers', 40);
assert.strictEqual(custUnder.allowed, true);
const custAtLimit = checkLimit('customers', 50);
assert.strictEqual(custAtLimit.allowed, false, 'Should block adding 51st customer when 50 already exist');

// Test 4: Feature distribution in Growth vs Enterprise
console.log('4. Testing Feature Distribution (Growth vs Enterprise)...');

// Growth Tier
sandbox.window.__valenixiaTier = 'GROWTH';
assert.strictEqual(can('deals'), true, 'Growth should have deals & combos');
assert.strictEqual(can('kds'), true, 'Growth should have KDS');
assert.strictEqual(can('attendance'), true, 'Growth should have Attendance');
assert.strictEqual(can('label-designer'), true, 'Growth should have Barcode Studio');
assert.strictEqual(can('inventory-ai'), true, 'Growth should have Inventory alerts');
assert.strictEqual(can('multi-device'), true, 'Growth should have Multi-Device Sync');
assert.strictEqual(can('cloud-backup'), true, 'Growth should have Daily Cloud Backup');

// Growth should NOT have Enterprise features:
assert.strictEqual(can('loyalty'), false, 'Growth should NOT have VIP Loyalty');
assert.strictEqual(can('marketing'), false, 'Growth should NOT have SMS/WhatsApp Marketing Studio');
assert.strictEqual(can('automated-whatsapp'), false, 'Growth should NOT have Automated WhatsApp Receipts');
assert.strictEqual(can('stock-transfer'), false, 'Growth should NOT have Inter-Branch Stock Transfers');
assert.strictEqual(can('logs'), false, 'Growth should NOT have CRDT Replication Logs / Diagnostics');
assert.strictEqual(can('fbr-fiscal'), false, 'Growth should NOT have FBR Fiscal POS');
assert.strictEqual(can('multi-store'), false, 'Growth should NOT have Multi-Store HQ');
assert.strictEqual(can('custom-roles'), false, 'Growth should NOT have Custom RBAC Roles');

// Enterprise Tier
sandbox.window.__valenixiaTier = 'ENTERPRISE';
assert.strictEqual(can('loyalty'), true, 'Enterprise should have VIP Loyalty');
assert.strictEqual(can('marketing'), true, 'Enterprise should have SMS/WhatsApp Marketing Studio');
assert.strictEqual(can('automated-whatsapp'), true, 'Enterprise should have Automated WhatsApp Receipts');
assert.strictEqual(can('stock-transfer'), true, 'Enterprise should have Inter-Branch Stock Transfers');
assert.strictEqual(can('logs'), true, 'Enterprise should have Diagnostics & Sync Streams');
assert.strictEqual(can('fbr-fiscal'), true, 'Enterprise should have FBR Fiscal POS');
assert.strictEqual(can('multi-store'), true, 'Enterprise should have Multi-Store HQ');
assert.strictEqual(can('custom-roles'), true, 'Enterprise should have Custom RBAC Roles');
assert.strictEqual(can('data-portability'), true, 'Enterprise should have Full Data Portability');
assert.strictEqual(can('speech-coach'), true, 'Enterprise should have Speech Coach');

console.log('✅ ALL TIER REDISTRIBUTION & STRICT FREE LIMIT TESTS PASSED SUCCESSFULLY!');
