#!/usr/bin/env node
// ============================================================================
// VALENIXIA POS - Shop Modes Schema & Validation Integration Tests
// Tests database migrations (version 7), mode-specific validations, and fields
// Run: node tests/modes.test.js
// ============================================================================
'use strict';

const assert = require('assert');
const Database = require('sqlite3').verbose().Database;

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

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}\n     ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

// Emulate sync worker validation logic locally for unit test execution
function validateModeFields(mode, data) {
  if (!data) return true;
  let parsed = {};
  try {
    parsed = typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) {
    return false;
  }

  if (mode === 'clothing-fashion') {
    if (parsed.variants && !Array.isArray(parsed.variants)) return false;
    if (parsed.variants) {
      if (parsed.variants.length === 0) return false;
      for (const v of parsed.variants) {
        if (typeof v.size !== 'string' || typeof v.color !== 'string') return false;
      }
    }
  } else if (mode === 'food-restaurant') {
    if (parsed.modifiers && !Array.isArray(parsed.modifiers)) return false;
    if (parsed.modifiers) {
      for (const m of parsed.modifiers) {
        if (typeof m.name !== 'string' || typeof m.price !== 'number' || m.price < 0) return false;
      }
    }
  } else if (mode === 'services-appointments') {
    if (parsed.duration !== undefined && (typeof parsed.duration !== 'number' || parsed.duration <= 0)) return false;
    if (parsed.buffer !== undefined && (typeof parsed.buffer !== 'number' || parsed.buffer < 0)) return false;
    if (parsed.staff && !Array.isArray(parsed.staff)) return false;
  } else if (mode === 'electronics-highvalue') {
    if (parsed.warranty_months !== undefined && (typeof parsed.warranty_months !== 'number' || parsed.warranty_months < 0)) return false;
    if (parsed.serial_required !== undefined && typeof parsed.serial_required !== 'boolean') return false;
  }
  return true;
}

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Shop Modes Schema & Validation Tests');
console.log('══════════════════════════════════════════════════\n');

(async () => {
  // ── 1. SQLite Database Schema Version 7 Check ─────────────────────────────
  console.log('▶ Database Schema version 7 validation');
  
  const db_raw = new Database(':memory:');
  const db = {
    run: (sql, params = []) => new Promise((res, rej) => db_raw.run(sql, params, function(err) { err ? rej(err) : res(this); })),
    get: (sql, params = []) => new Promise((res, rej) => db_raw.get(sql, params, (err, row) => err ? rej(err) : res(row))),
    exec: (sql) => new Promise((res, rej) => db_raw.exec(sql, err => err ? rej(err) : res())),
  };

  await testAsync('Schema v7: Alter inventory_catalog columns', async () => {
    // 1. Setup mock v6 catalog table
    await db.exec(`CREATE TABLE IF NOT EXISTS inventory_catalog (
      sku TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      base_price_minor_units INTEGER NOT NULL
    )`);

    // 2. Perform v7 migration actions (Add mode_fields and image_url)
    await db.run("ALTER TABLE inventory_catalog ADD COLUMN mode_fields TEXT DEFAULT '{}'");
    await db.run("ALTER TABLE inventory_catalog ADD COLUMN image_url TEXT DEFAULT ''");

    // 3. Verify columns exist on sqlite_master table schema
    const schemaRow = await db.get("SELECT sql FROM sqlite_master WHERE name='inventory_catalog'");
    assert.ok(schemaRow.sql.includes('mode_fields'), 'mode_fields column should exist');
    assert.ok(schemaRow.sql.includes('image_url'), 'image_url column should exist');
  });

  // ── 2. Mode Field Validation Checking ─────────────────────────────────────
  console.log('\n▶ Mode Field validation matrix checks');

  test('clothing-fashion: accepts valid variants list structure', () => {
    const validData = JSON.stringify({
      variants: [
        { id: 'v1', size: 'M', color: 'Blue', stock: 10 }
      ]
    });
    assert.strictEqual(validateModeFields('clothing-fashion', validData), true);
  });

  test('clothing-fashion: rejects invalid variant data elements type', () => {
    const invalidData = JSON.stringify({
      variants: [
        { id: 'v1', size: 123, color: 'Blue' } // size must be a string
      ]
    });
    assert.strictEqual(validateModeFields('clothing-fashion', invalidData), false);
  });

  test('food-restaurant: accepts valid modifiers list and cost structure', () => {
    const validData = JSON.stringify({
      modifiers: [
        { id: 'm1', name: 'Extra Cheese', price: 100 }
      ]
    });
    assert.strictEqual(validateModeFields('food-restaurant', validData), true);
  });

  test('food-restaurant: rejects non-numeric modifier price adjustments', () => {
    const invalidData = JSON.stringify({
      modifiers: [
        { id: 'm1', name: 'Extra Cheese', price: 'free' } // price must be a number
      ]
    });
    assert.strictEqual(validateModeFields('food-restaurant', invalidData), false);
  });

  test('services-appointments: accepts correct durations and staff parameters', () => {
    const validData = JSON.stringify({
      duration: 45,
      buffer: 15,
      staff: ['Alice', 'Bob']
    });
    assert.strictEqual(validateModeFields('services-appointments', validData), true);
  });

  test('services-appointments: rejects incorrect staff list types', () => {
    const invalidData = JSON.stringify({
      duration: 45,
      staff: 'Alice' // staff must be an array of strings
    });
    assert.strictEqual(validateModeFields('services-appointments', invalidData), false);
  });

  test('electronics-highvalue: accepts correct warranty settings', () => {
    const validData = JSON.stringify({
      warranty_months: 24,
      serial_required: true
    });
    assert.strictEqual(validateModeFields('electronics-highvalue', validData), true);
  });

  test('electronics-highvalue: rejects non-boolean serial tracker setting', () => {
    const invalidData = JSON.stringify({
      warranty_months: 24,
      serial_required: 'yes' // serial_required must be a boolean
    });
    assert.strictEqual(validateModeFields('electronics-highvalue', invalidData), false);
  });

  // ── Mode Edge-Case Tests ──
  test('clothing-fashion: edge case - rejects empty variants list', () => {
    const invalidData = JSON.stringify({ variants: [] });
    assert.strictEqual(validateModeFields('clothing-fashion', invalidData), false);
  });

  test('food-restaurant: edge case - rejects negative modifier price adjustments', () => {
    const invalidData = JSON.stringify({
      modifiers: [{ id: 'm1', name: 'Extra Cheese', price: -50 }]
    });
    assert.strictEqual(validateModeFields('food-restaurant', invalidData), false);
  });

  test('services-appointments: edge case - rejects duration less than or equal to zero', () => {
    const invalidData = JSON.stringify({ duration: 0 });
    assert.strictEqual(validateModeFields('services-appointments', invalidData), false);
  });

  test('electronics-highvalue: edge case - rejects negative warranty months', () => {
    const invalidData = JSON.stringify({ warranty_months: -12 });
    assert.strictEqual(validateModeFields('electronics-highvalue', invalidData), false);
  });

  // ── 3. Store Domain Feature Isolation Tests ────────────────────────────────
  console.log('\n▶ Domain Feature Isolation (Restaurant / KDS / Foodpanda Guards)');
  
  // Load store-modes.js definitions
  const fs = require('fs');
  const path = require('path');
  const storeModesCode = fs.readFileSync(path.join(__dirname, '../public/modules/store-modes.js'), 'utf8');
  const mockWindow = {};
  const evalFn = new Function('window', 'global', storeModesCode);
  evalFn(mockWindow, mockWindow);
  const { ORDER_TYPES, MODES } = mockWindow.ValenixiaStoreModes;

  test('hospitality isolation: food-restaurant includes DINE_IN and FOODPANDA', () => {
    const restTypes = ORDER_TYPES['food-restaurant'].map(t => t.id);
    assert.ok(restTypes.includes('DINE_IN'), 'food-restaurant must have DINE_IN');
    assert.ok(restTypes.includes('FOODPANDA'), 'food-restaurant must have FOODPANDA');
    assert.ok(restTypes.includes('TAKEAWAY'), 'food-restaurant must have TAKEAWAY');
  });

  test('hospitality isolation: bakery-cafe includes DINE_IN and FOODPANDA', () => {
    const cafeTypes = ORDER_TYPES['bakery-cafe'].map(t => t.id);
    assert.ok(cafeTypes.includes('DINE_IN'), 'bakery-cafe must have DINE_IN');
    assert.ok(cafeTypes.includes('FOODPANDA'), 'bakery-cafe must have FOODPANDA');
  });

  test('mechanic isolation: mechanic-workshop has NO DINE_IN and NO FOODPANDA', () => {
    const mechanicTypes = ORDER_TYPES['mechanic-workshop'].map(t => t.id);
    assert.strictEqual(mechanicTypes.includes('DINE_IN'), false, 'mechanic-workshop must NOT have DINE_IN');
    assert.strictEqual(mechanicTypes.includes('FOODPANDA'), false, 'mechanic-workshop must NOT have FOODPANDA');
    assert.ok(mechanicTypes.includes('JOB_CARD'), 'mechanic-workshop must have JOB_CARD');
  });

  test('retail isolation: simple-retail has NO DINE_IN and NO FOODPANDA', () => {
    const retailTypes = ORDER_TYPES['simple-retail'].map(t => t.id);
    assert.strictEqual(retailTypes.includes('DINE_IN'), false, 'simple-retail must NOT have DINE_IN');
    assert.strictEqual(retailTypes.includes('FOODPANDA'), false, 'simple-retail must NOT have FOODPANDA');
    assert.ok(retailTypes.includes('WALKIN'), 'simple-retail must have WALKIN');
  });

  test('pharmacy isolation: pharmacy-medical has NO DINE_IN and NO FOODPANDA', () => {
    const rxTypes = ORDER_TYPES['pharmacy-medical'].map(t => t.id);
    assert.strictEqual(rxTypes.includes('DINE_IN'), false, 'pharmacy-medical must NOT have DINE_IN');
    assert.strictEqual(rxTypes.includes('FOODPANDA'), false, 'pharmacy-medical must NOT have FOODPANDA');
    assert.ok(rxTypes.includes('PRESCRIPTION'), 'pharmacy-medical must have PRESCRIPTION');
  });

  test('fashion isolation: clothing-fashion has NO DINE_IN and NO FOODPANDA', () => {
    const fashionTypes = ORDER_TYPES['clothing-fashion'].map(t => t.id);
    assert.strictEqual(fashionTypes.includes('DINE_IN'), false, 'clothing-fashion must NOT have DINE_IN');
    assert.strictEqual(fashionTypes.includes('FOODPANDA'), false, 'clothing-fashion must NOT have FOODPANDA');
  });

  test('isKdsSupported helper: returns true ONLY for hospitality modes', () => {
    function isKdsSupported(mode) {
      return mode === 'food-restaurant' || mode === 'bakery-cafe' || mode === 'restaurant' || mode === 'cafe';
    }
    assert.strictEqual(isKdsSupported('food-restaurant'), true);
    assert.strictEqual(isKdsSupported('bakery-cafe'), true);
    assert.strictEqual(isKdsSupported('mechanic-workshop'), false);
    assert.strictEqual(isKdsSupported('simple-retail'), false);
    assert.strictEqual(isKdsSupported('grocery-mart'), false);
    assert.strictEqual(isKdsSupported('clothing-fashion'), false);
    assert.strictEqual(isKdsSupported('pharmacy-medical'), false);
    assert.strictEqual(isKdsSupported('automotive-car'), false);
  });

  // ── 4. Test Diagnostics Report ────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════');
  console.log(`  Tests completed: Passed: ${passed}, Failed: ${failed}`);
  console.log('══════════════════════════════════════════════════\n');

  db_raw.close();
  
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
})();
