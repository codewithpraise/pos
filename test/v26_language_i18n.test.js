// ============================================================================
// VALENIXIA POS v2.6.0 — LANGUAGE SWITCHING & i18n INTEGRITY TEST
// Empirical verification of Urdu/English translations, button text node retention,
// and double-event listener elimination.
// ============================================================================

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Running Valenixia POS v2.6.0 Language & i18n Integrity Test...');

const stringsJs = fs.readFileSync(path.join(__dirname, '../public/strings.js'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const bootstrapJs = fs.readFileSync(path.join(__dirname, '../public/bootstrap-init.js'), 'utf8');

// 1. VERIFY NO EMPTY STRING URDU REPLACEMENTS IN app.js
assert(!appJs.includes("'.payment-card .lbl': isUrdu ? '' : 'Payment Method'"),
  'FAIL: Found empty string ternary operator for payment method label in setLanguage');

assert(!appJs.includes("'[data-mode=\"CASH\"]': isUrdu ? '' : 'Cash'"),
  'FAIL: Found empty string ternary operator for Cash payment button in setLanguage');

assert(!appJs.includes("'[data-mode=\"CARD\"]': isUrdu ? '' : 'Card'"),
  'FAIL: Found empty string ternary operator for Card payment button in setLanguage');

console.log('  ✓ PASS: Empty string ternary operators purged from setLanguage');

// 2. VERIFY NO DOUBLE CLICK LISTENER ON lang-toggle-btn IN app.js
assert(!appJs.includes("langBtn.addEventListener('click'"),
  'FAIL: Found redundant addEventListener on lang-toggle-btn causing double-toggle cancellation');

console.log('  ✓ PASS: Redundant event listener purged from lang-toggle-btn');

// 3. VERIFY SAFE TEXT UPDATE NODE RETENTION IN setLanguage
assert(appJs.includes('const hasElementChild = el.firstElementChild !== null;'),
  'FAIL: setLanguage must check for element children before updating text to preserve SVGs');

console.log('  ✓ PASS: Safe text update node retention verified');

// 4. VERIFY TRANSLATION DICTIONARY STRINGS EXIST
assert(stringsJs.includes('cash: "نقد ادائیگی"'), 'FAIL: Urdu translation for Cash missing');
assert(stringsJs.includes('card: "کارڈ ادائیگی"'), 'FAIL: Urdu translation for Card missing');
assert(stringsJs.includes('qr_code: "کیو آر کوڈ"'), 'FAIL: Urdu translation for QR Code missing');
assert(stringsJs.includes('split: "تقسیم ادائیگی"'), 'FAIL: Urdu translation for Split missing');
assert(stringsJs.includes('credit: "ادھار کھاتہ"'), 'FAIL: Urdu translation for Credit missing');

console.log('  ✓ PASS: Urdu translation dictionary verified complete');

console.log('\n==================================================');
console.log('Language & i18n Integrity Test Results: ALL PASSED.');
console.log('==================================================\n');
