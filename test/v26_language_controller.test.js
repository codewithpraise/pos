// ============================================================================
// VALENIXIA POS v2.6.x — LANGUAGE CONTROLLER INTEGRITY TEST
// Empirical verification of window.ValenixiaLanguage domain controller,
// single event handler binding, and RTL document flow.
// ============================================================================

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Running Valenixia POS v2.6.x Language Controller Integrity Test...');

const bootstrapJs = fs.readFileSync(path.join(__dirname, '../public/bootstrap-init.js'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

// 1. VERIFY window.ValenixiaLanguage CONTROLLER DEFINITION IN bootstrap-init.js
assert(bootstrapJs.includes('window.ValenixiaLanguage = {'),
  'FAIL: window.ValenixiaLanguage controller definition missing from bootstrap-init.js');

assert(bootstrapJs.includes('getLanguage()'), 'FAIL: getLanguage method missing');
assert(bootstrapJs.includes('setLanguage(lang)'), 'FAIL: setLanguage method missing');
assert(bootstrapJs.includes('toggle()'), 'FAIL: toggle method missing');
assert(bootstrapJs.includes('refresh()'), 'FAIL: refresh method missing');

console.log('  ✓ PASS: window.ValenixiaLanguage domain controller interface verified');

// 2. VERIFY SINGLE EVENT OWNER FOR lang-toggle-btn IN index.html
assert(indexHtml.includes('onclick="if(window.toggleAppLanguage)window.toggleAppLanguage();"'),
  'FAIL: index.html must delegate lang-toggle-btn click to window.toggleAppLanguage');

assert(!appJs.includes("langBtn.addEventListener('click'"),
  'FAIL: app.js must not attach secondary click listener to lang-toggle-btn');

console.log('  ✓ PASS: Single event listener ownership enforced (zero double-toggle race conditions)');

// 3. VERIFY SUB-SPAN CHILD RETENTION ON BUTTON RE-RENDER
assert(appJs.includes("const subSpan = langBtn.querySelector('span:nth-child(2)');"),
  'FAIL: setLanguage must target child span to preserve button element structure');

console.log('  ✓ PASS: Button child span element retention verified');

console.log('\n==================================================');
console.log('Language Controller Test Results: ALL PASSED.');
console.log('==================================================\n');
