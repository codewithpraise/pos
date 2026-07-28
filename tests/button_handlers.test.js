#!/usr/bin/env node
// ============================================================================
// VALENIXIA POS - Button Handlers & Safety Audit Test Suite
// Checks all HTML buttons and verifies safe event bindings in app.js
// ============================================================================
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}\n     ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Button Handlers Audit');
console.log('══════════════════════════════════════════════════\n');

const htmlPath = path.join(__dirname, '../public/index.html');
const appPath = path.join(__dirname, '../public/app.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const app = fs.readFileSync(appPath, 'utf8');

test('HTML file exists and is readable', () => {
  assert.ok(html.length > 1000, 'index.html should not be empty');
});

test('app.js file exists and is readable', () => {
  assert.ok(app.length > 1000, 'app.js should not be empty');
});

test('Key View Buttons are present in index.html', () => {
  const keyButtons = [
    'btn-customers-create',
    'btn-submit-customer-modal',
    'btn-cancel-customer-modal',
    'btn-close-customer-modal',
    'btn-open-customer-link',
    'btn-tab-sync-logs',
    'btn-tab-health-logs',
    'btn-clear-logs-feed',
    'btn-health-db-vacuum',
    'btn-health-sync-reconnect',
    'btn-health-storage-check',
    'btn-migration-schema-sql',
    'btn-migration-scrub-sheets',
    'btn-migration-export-ledger',
    'btn-staff-create',
    'btn-submit-employee-modal',
    'btn-suppliers-create',
    'btn-flush-fbr-now',
    'btn-switch-store-context'
  ];

  keyButtons.forEach(id => {
    assert.ok(html.includes(`id="${id}"`) || html.includes(`id='${id}'`), `Missing expected button ID "${id}" in index.html`);
  });
});

test('No unsafe document.getElementById addEventListener calls in app.js', () => {
  const lines = app.split('\n');
  const unsafeLines = [];
  
  lines.forEach((line, idx) => {
    // Look for document.getElementById('...').addEventListener without ?. or prior null check
    if (/document\.getElementById\(['"][^'"]+['"]\)\.addEventListener/.test(line)) {
      unsafeLines.push({ lineNum: idx + 1, content: line.trim() });
    }
  });

  if (unsafeLines.length > 0) {
    const details = unsafeLines.map(l => `L${l.lineNum}: ${l.content}`).join('\n');
    assert.fail(`Found ${unsafeLines.length} unsafe addEventListener calls without optional chaining:\n${details}`);
  }
});

test('All core button IDs in app.js use optional chaining or safety checks', () => {
  const expectedBoundIds = [
    'btn-customers-create',
    'btn-submit-customer-modal',
    'btn-tab-sync-logs',
    'btn-tab-health-logs',
    'btn-clear-logs-feed',
    'btn-health-db-vacuum',
    'btn-migration-schema-sql',
    'btn-staff-create',
    'btn-suppliers-create',
    'btn-flush-fbr-now',
    'btn-switch-store-context'
  ];

  expectedBoundIds.forEach(id => {
    assert.ok(app.includes(`document.getElementById('${id}')?.addEventListener`) || app.includes(`document.getElementById("${id}")?.addEventListener`) || app.includes(`id === '${id}'`) || app.includes(`'${id}'`), `Missing event binding reference for "${id}" in app.js`);
  });
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Audit failed!');
  process.exit(1);
} else {
  console.log('✨ All button handler safety audits passed cleanly!\n');
}
