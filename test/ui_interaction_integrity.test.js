// ============================================================================
// VALENIXIA POS v2.6.0 — AUTOMATED UI SURFACES & INTERACTION INTEGRITY SUITE
// Tests Interaction Contracts, Canonical Controller Teardown, Legal Modals, Topbar CSS Grid, and String Purge.
// ============================================================================

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Running Valenixia POS UI Surface & Interaction Integrity Test Suite...\n');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}\n     ${err.message}`);
    failCount++;
  }
}

// ----------------------------------------------------------------------------
// TEST 1: Obsolete Commercial String Purge Verification
// ----------------------------------------------------------------------------
test('Obsolete Commercial Strings Purged Across Codebase', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const subJs = fs.readFileSync(path.join(__dirname, '../public/subscription.js'), 'utf8');

  const forbiddenStrings = [
    'Unlimited Register Terminals',
    'Unlimited Terminals',
    'Up to 3 Register Terminals',
    'Pay via NayaPay'
  ];

  forbiddenStrings.forEach(str => {
    assert.strictEqual(
      indexHtml.includes(str),
      false,
      `Forbidden legacy string "${str}" found in index.html`
    );
    assert.strictEqual(
      appJs.includes(str),
      false,
      `Forbidden legacy string "${str}" found in app.js`
    );
    assert.strictEqual(
      subJs.includes(str),
      false,
      `Forbidden legacy string "${str}" found in subscription.js`
    );
  });
});

// ----------------------------------------------------------------------------
// TEST 2: Legal Document Modal Overlay Container
// ----------------------------------------------------------------------------
test('Legal Document Overlay Container Exists in index.html', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.ok(
    indexHtml.includes('id="modal-legal-document"'),
    '#modal-legal-document container missing from index.html'
  );
  assert.ok(
    indexHtml.includes('id="legal-doc-modal-title"'),
    '#legal-doc-modal-title missing from index.html'
  );
  assert.ok(
    indexHtml.includes('id="legal-doc-modal-content"'),
    '#legal-doc-modal-content missing from index.html'
  );
});

// ----------------------------------------------------------------------------
// TEST 3: Canonical Legal Document Attributes Standardized
// ----------------------------------------------------------------------------
test('Legal Document Trigger Buttons Standardized to data-legal-document', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  
  // Assert no legacy attributes remain
  const docKeyMatches = indexHtml.match(/data-doc-key=/g) || [];
  const docMatches = indexHtml.match(/data-legal-doc=/g) || [];
  assert.strictEqual(
    docKeyMatches.length,
    0,
    `Found ${docKeyMatches.length} legacy data-doc-key attributes in index.html`
  );
  assert.strictEqual(
    docMatches.length,
    0,
    `Found ${docMatches.length} legacy data-legal-doc attributes in index.html`
  );

  // Assert canonical attributes exist
  const canonicalMatches = indexHtml.match(/data-legal-document=/g) || [];
  assert.ok(
    canonicalMatches.length >= 12,
    `Expected at least 12 data-legal-document triggers, found ${canonicalMatches.length}`
  );
});

// ----------------------------------------------------------------------------
// TEST 4: Topbar CSS Grid Structure & Overflow Prevention
// ----------------------------------------------------------------------------
test('Topbar Enforces 3-Region CSS Grid Layout & Removes Padding Corruption', () => {
  const componentsCss = fs.readFileSync(path.join(__dirname, '../public/styles/components.css'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

  // Check topbar 3 regions
  assert.ok(indexHtml.includes('class="topbar-left"'), 'topbar-left missing');
  assert.ok(indexHtml.includes('class="topbar-center"'), 'topbar-center missing');
  assert.ok(indexHtml.includes('class="topbar-right"'), 'topbar-right missing');

  // Check topbar overflow wrapper
  assert.ok(indexHtml.includes('id="btn-topbar-overflow-toggle"'), 'btn-topbar-overflow-toggle missing');
  assert.ok(indexHtml.includes('id="topbar-overflow-menu"'), 'topbar-overflow-menu missing');

  // Check CSS Grid rules
  assert.ok(
    componentsCss.includes('grid-template-columns: auto minmax(0, 1fr) auto'),
    'CSS Grid 3-region template missing in components.css'
  );
});

// ----------------------------------------------------------------------------
// TEST 5: Subscription Controller Single Ownership
// ----------------------------------------------------------------------------
test('Subscription Domain Controller Exposes window.ValenixiaSubscription Interface', () => {
  const subJs = fs.readFileSync(path.join(__dirname, '../public/subscription.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

  assert.ok(
    subJs.includes('window.ValenixiaSubscription = ValenixiaSubscription;'),
    'ValenixiaSubscription controller not exported to window'
  );
  assert.ok(
    appJs.includes('window.ValenixiaSubscription.init()'),
    'app.js does not delegate initSubscriptionPage to window.ValenixiaSubscription'
  );
});

// ----------------------------------------------------------------------------
// SUMMARY REPORT
// ----------------------------------------------------------------------------
console.log(`\n==================================================`);
console.log(`Test Execution Results: ${passCount} PASSED, ${failCount} FAILED.`);
console.log(`==================================================\n`);

if (failCount > 0) {
  process.exit(1);
}
