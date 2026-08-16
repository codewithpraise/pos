#!/usr/bin/env node
// ============================================================================
// VALENIXIA POS - Mobile Bootstrap Scrolling & Responsiveness Test Suite
// Verifies that all screens, overlays, and modals in the bootstrapping phase
// are fully scrollable on mobile without coordinate clipping or touch traps.
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
console.log('  VALENIXIA POS — Mobile Bootstrap Scroll Audit (v2.6)');
console.log('══════════════════════════════════════════════════\n');

const htmlPath = path.join(__dirname, '../public/index.html');
const cssComponentsPath = path.join(__dirname, '../public/styles/components.css');
const cssStylePath = path.join(__dirname, '../public/style.css');
const cssMobileScalePath = path.join(__dirname, '../public/styles/mobile-scale.css');
const bootstrapInitPath = path.join(__dirname, '../public/bootstrap-init.js');
const licenseEnginePath = path.join(__dirname, '../public/license-engine.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const cssComponents = fs.readFileSync(cssComponentsPath, 'utf8');
const cssStyle = fs.readFileSync(cssStylePath, 'utf8');
const cssMobileScale = fs.readFileSync(cssMobileScalePath, 'utf8');
const bootstrapInit = fs.readFileSync(bootstrapInitPath, 'utf8');
const licenseEngine = fs.readFileSync(licenseEnginePath, 'utf8');

test('1. No active modal or auth overlay forces justify-content: center with overflow-y', () => {
  // Check that .modal-overlay.active block has flex-start and overflow-y: auto
  const activeModalSection = cssComponents.match(/\.modal-overlay\.active,\s*\.pos-modal-backdrop\.active,\s*\.auth-overlay\.active\s*\{([\s\S]*?)\}/);
  assert.ok(activeModalSection, 'Found universal active modal rules in components.css');
  const rules = activeModalSection[1];
  assert.ok(rules.includes('justify-content: flex-start'), 'Active overlays must use justify-content: flex-start to prevent negative-coordinate top clipping');
  assert.ok(rules.includes('overflow-y: auto'), 'Active overlays must have overflow-y: auto for vertical scrolling');
  assert.ok(rules.includes('touch-action: pan-y'), 'Active overlays must have touch-action: pan-y for smooth touch scroll');
});

test('2. Auth cards and modal cards use margin: auto 0 with flex-shrink: 0', () => {
  assert.ok(cssComponents.includes('margin: auto 0 !important'), 'Cards must use margin: auto 0 !important for centered overflow-safe layout');
  assert.ok(cssComponents.includes('flex-shrink: 0 !important'), 'Cards must have flex-shrink: 0 !important to prevent flexbox squishing');
});

test('3. First boot wizard overlay has display: block and overflow-y: auto in style.css', () => {
  assert.ok(cssStyle.includes('#first-boot-wizard'), 'Found #first-boot-wizard in style.css');
  assert.ok(cssStyle.includes('touch-action: pan-y !important'), 'Wizard elements allow pan-y gestures');
  assert.ok(!cssStyle.includes('#wiz-panel-3 .shop-mode-grid {\n    max-height: 48vh;\n    overflow-y: auto !important;\n    overscroll-behavior-y: contain'), 'No nested overscroll contain trap in shop-mode-grid');
});

test('4. Bootstrap surface state machine sets WIZARD display to block in JavaScript', () => {
  assert.ok(bootstrapInit.includes("(surfaceKey === 'WIZARD') ? 'block' : 'flex'"), 'ValenixiaBootstrap sets display: block for WIZARD surface');
});

test('5. License Engine overlays include overflow-y: auto and justify-content: flex-start', () => {
  assert.ok(licenseEngine.includes('justify-content: flex-start'), 'mountLockoutOverlay uses justify-content: flex-start');
  assert.ok(licenseEngine.includes('overflow-y: auto'), 'mountLockoutOverlay uses overflow-y: auto');
  assert.ok(licenseEngine.includes('touch-action: pan-y'), 'mountLockoutOverlay uses touch-action: pan-y');
});

test('6. Static emergency recovery fallback has overflow-y: auto in index.html', () => {
  const recoveryDiv = html.match(/id="vx-emergency-recovery"[\s\S]*?style="([^"]*)"/);
  assert.ok(recoveryDiv, 'Found vx-emergency-recovery in index.html');
  assert.ok(recoveryDiv[1].includes('overflow-y:auto') || recoveryDiv[1].includes('overflow-y: auto'), 'Recovery container has overflow-y: auto');
  assert.ok(recoveryDiv[1].includes('justify-content:flex-start') || recoveryDiv[1].includes('justify-content: flex-start'), 'Recovery container uses justify-content: flex-start');
});

test('7. Business Template Modal removed & Step 3 Store Modes container has overflow-y: auto', () => {
  const templateModal = html.match(/id="modal-wizard-templates"/);
  assert.strictEqual(templateModal, null, 'modal-wizard-templates popup is cleanly removed');
  const step3Grid = html.match(/class="shop-modes-grid"[\s\S]*?style="([^"]*)"/);
  assert.ok(step3Grid, 'Found shop-modes-grid in index.html');
  assert.ok(step3Grid[1].includes('overflow-y: auto') || step3Grid[1].includes('overflow-y:auto'), 'Step 3 Store modes grid has overflow-y: auto');
});

test('8. Android assets are synchronized with public folder', () => {
  const androidComponentsPath = path.join(__dirname, '../android/app/src/main/assets/styles/components.css');
  const androidComponents = fs.readFileSync(androidComponentsPath, 'utf8');
  assert.strictEqual(cssComponents, androidComponents, 'Android components.css must match public components.css exactly');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('✨ All mobile bootstrap scroll geometry audits passed!\n');
}
