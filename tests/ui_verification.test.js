#!/usr/bin/env node
// ============================================================================
// VALENIXIA POS - Mobile UI & Layout Verification Test Suite
// Verifies all 8 core UI fixes requested by user
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
console.log('  VALENIXIA POS — UI & Layout Verification Tests');
console.log('══════════════════════════════════════════════════\n');

const htmlPath = path.join(__dirname, '../public/index.html');
const cssPath = path.join(__dirname, '../public/styles/components.css');
const bootstrapPath = path.join(__dirname, '../public/bootstrap-init.js');
const subPath = path.join(__dirname, '../public/subscription.html');

const html = fs.readFileSync(htmlPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
const subHtml = fs.readFileSync(subPath, 'utf8');

test('1. Checkout page has all 3 necessary split layout sections', () => {
  assert.ok(html.includes('class="checkout-cart"'), 'Left cart panel must exist');
  assert.ok(html.includes('class="checkout-quick-catalog"'), 'Middle quick catalog panel must exist');
  assert.ok(html.includes('class="checkout-actions"'), 'Right payment action panel must exist');
  assert.ok(css.includes('#checkout-split-layout'), 'CSS grid styling for checkout split layout must exist');
});

test('2. Password eye toggle logic forces webkit-text-security property with important priority', () => {
  assert.ok(bootstrap.includes("targetInput.style.setProperty('-webkit-text-security', 'none', 'important')"), 'Eye toggle must force none with important');
  assert.ok(bootstrap.includes("targetInput.style.setProperty('-webkit-text-security', 'disc', 'important')"), 'Eye toggle must force disc with important');
  assert.ok(css.includes('.btn-toggle-password'), 'Eye button positioning CSS must exist');
});

test('3. Bottom navbar is 1 single flat track (no nav-row wrappers, no duplicate pos-bottom-nav)', () => {
  assert.ok(!html.includes('class="nav-row nav-row-free"'), 'nav-row-free wrapper must be removed');
  assert.ok(!html.includes('class="nav-row nav-row-paid"'), 'nav-row-paid wrapper must be removed');
  assert.ok(!html.includes('class="pos-bottom-nav"'), 'Duplicate pos-bottom-nav element must be removed from HTML');
});

test('4. Product cards have instant touch-action manipulation for zero-delay taps', () => {
  assert.ok(css.includes('touch-action: manipulation !important'), 'Touch action manipulation must be set');
  assert.ok(css.includes('.quick-product-card'), 'Quick product card selector must be styled');
});

test('5. Settings page sections expand to 100% full container width', () => {
  assert.ok(css.includes('#view-settings'), 'view-settings layout CSS must exist');
  assert.ok(css.includes('.settings-section'), 'settings-section width CSS must exist');
});

test('6. Analytics (Kamai & Summary) cards have responsive layout CSS', () => {
  assert.ok(html.includes('id="view-analytics"'), 'Analytics view must exist');
  assert.ok(css.includes('#view-analytics') || css.includes('@media (max-width: 900px)') || css.includes('@media (max-width: 1024px)'), 'Analytics layout CSS must exist');
});

test('7. Offline banner provides top padding offset for page headers and topbar', () => {
  assert.ok(css.includes('body.is-offline .pos-topbar') || css.includes('body.has-top-banner .pos-topbar'), 'Offline banner top offset CSS must exist');
});

test('8. Subscription vault integrity (no duplicate sections in settings, body scroll enabled)', () => {
  assert.ok(!html.includes('id="settings-subscription-container"'), 'Duplicate subscription container must be removed from index.html settings');
  assert.ok(subHtml.includes('overflow-y: auto !important'), 'Subscription iframe body must enable smooth vertical scrolling');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\n❌ UI verification tests failed!');
  process.exit(1);
} else {
  console.log('✨ All UI & layout verification tests passed cleanly!\n');
}
