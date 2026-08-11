// ============================================================================
// VALENIXIA POS v2.6.0 — SUBSCRIPTION VAULT GEOMETRY & CATALOG INTEGRITY TEST
// Validates single vertical scroll owner, 0 outer padding void, inactive tab
// layout non-participation, and canonical commercial catalog consistency.
// ============================================================================

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Running Valenixia POS v2.6.0 Subscription Geometry & Commercial Test...');

const componentsCss = fs.readFileSync(path.join(__dirname, '../public/styles/components.css'), 'utf8');
const mobileScaleCss = fs.readFileSync(path.join(__dirname, '../public/styles/mobile-scale.css'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const { COMMERCIAL_PLANS, COMMERCIAL_ADDONS } = require('../lib/commercial-catalog.js');

// 1. VERIFY NO COMPOUNDING PADDING-BOTTOM VOID ON #view-subscription OR .subscription-layout
assert(!componentsCss.includes('#view-subscription,\n.subscription-layout,\n.subscription-main,\n.sub-vault-stage {\n  overflow-y: auto !important;\n  max-height: 100% !important;\n  padding-bottom: 80px !important;\n}'),
  'FAIL: Found compounding 80px padding-bottom block on subscription containers');

// 2. VERIFY #view-subscription IS EXEMPTED FROM CONTENT-VIEW BOTTOM PADDING OVERRIDES
assert(componentsCss.includes('.content-view:not(#view-checkout):not(#view-subscription)'),
  'FAIL: components.css must exempt #view-subscription from document content-view bottom padding');

assert(mobileScaleCss.includes('.content-view:not(#view-checkout):not(#view-subscription)'),
  'FAIL: mobile-scale.css must exempt #view-subscription from document content-view bottom padding');

console.log('  ✓ PASS: Exemption contract enforced for #view-subscription in CSS');

// 3. VERIFY INACTIVE SUB-TAB PANELS DO NOT PARTICIPATE IN LAYOUT
assert(componentsCss.includes('.sub-tab-panel:not(.active) {\n  display: none !important;\n}'),
  'FAIL: Inactive sub-tab panels must have display: none !important to prevent layout participation');

console.log('  ✓ PASS: Inactive sub-tab panels hidden from layout participation');

// 4. VERIFY CANONICAL COMMERCIAL CATALOG TIER PRICES & LIMITS
assert.strictEqual(COMMERCIAL_PLANS.STARTER.price_pkr, 3499, 'STARTER price must be 3499');
assert.strictEqual(COMMERCIAL_PLANS.STARTER.terminal_limit, 1, 'STARTER terminal limit must be 1');
assert.strictEqual(COMMERCIAL_PLANS.STARTER.branch_limit, 1, 'STARTER branch limit must be 1');
assert.strictEqual(COMMERCIAL_PLANS.STARTER.extra_terminal_pkr, 1200, 'STARTER extra terminal rate must be 1200');

assert.strictEqual(COMMERCIAL_PLANS.PRO.price_pkr, 6999, 'PRO price must be 6999');
assert.strictEqual(COMMERCIAL_PLANS.PRO.terminal_limit, 2, 'PRO terminal limit must be 2');
assert.strictEqual(COMMERCIAL_PLANS.PRO.branch_limit, 1, 'PRO branch limit must be 1');
assert.strictEqual(COMMERCIAL_PLANS.PRO.extra_terminal_pkr, 1000, 'PRO extra terminal rate must be 1000');
assert.strictEqual(COMMERCIAL_PLANS.PRO.extra_branch_pkr, 3500, 'PRO extra branch rate must be 3500');

assert.strictEqual(COMMERCIAL_PLANS.ENTERPRISE.price_pkr, 11999, 'ENTERPRISE price must be 11999');
assert.strictEqual(COMMERCIAL_PLANS.ENTERPRISE.terminal_limit, 3, 'ENTERPRISE terminal limit must be 3');
assert.strictEqual(COMMERCIAL_PLANS.ENTERPRISE.branch_limit, 2, 'ENTERPRISE branch limit must be 2');
assert.strictEqual(COMMERCIAL_PLANS.ENTERPRISE.extra_terminal_pkr, 800, 'ENTERPRISE extra terminal rate must be 800');
assert.strictEqual(COMMERCIAL_PLANS.ENTERPRISE.extra_branch_pkr, 3000, 'ENTERPRISE extra branch rate must be 3000');

console.log('  ✓ PASS: Commercial catalog pricing and inclusions verified canonical');

// 5. VERIFY PURGE OF OBSOLETE "UP TO 10 TERMINALS" OR "UNLIMITED BRANCHES" STRINGS
assert(!indexHtml.includes('Up to 10 Register Terminals &amp; 5 Store Branches'),
  'FAIL: Obsolete "Up to 10 Register Terminals" string found in index.html');
assert(!indexHtml.includes('Up to 3 Register Terminals'),
  'FAIL: Obsolete "Up to 3 Register Terminals" string found in index.html');

console.log('  ✓ PASS: Obsolete plan marketing strings purged from HTML');

// 6. VERIFY CAPACITY CALCULATOR WIDGET EXISTS IN HTML
assert(indexHtml.includes('id="subscription-capacity-calculator"'),
  'FAIL: Capacity calculator widget missing from index.html');
assert(indexHtml.includes('id="cap-terminals-summary"'),
  'FAIL: Terminal capacity summary element missing from index.html');

console.log('  ✓ PASS: Capacity calculator widget integrated in index.html');

console.log('\n==================================================');
console.log('Geometry & Commercial Test Results: ALL PASSED.');
console.log('==================================================\n');
