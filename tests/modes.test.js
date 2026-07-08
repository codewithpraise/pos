#!/usr/bin/env node
// ============================================================================
// NEXOVA POS - Shop Modes Schema & Validation Integration Tests
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
      for (const v of parsed.variants) {
        if (typeof v.size !== 'string' || typeof v.color !== 'string') return false;
      }
    }
  } else if (mode === 'food-restaurant') {
    if (parsed.modifiers && !Array.isArray(parsed.modifiers)) return false;
    if (parsed.modifiers) {
      for (const m of parsed.modifiers) {
        if (typeof m.name !== 'string' || typeof m.price !== 'number') return false;
      }
    }
  } else if (mode === 'services-appointments') {
    if (parsed.duration !== undefined && typeof parsed.duration !== 'number') return false;
    if (parsed.buffer !== undefined && typeof parsed.buffer !== 'number') return false;
    if (parsed.staff && !Array.isArray(parsed.staff)) return false;
  } else if (mode === 'electronics-highvalue') {
    if (parsed.warranty_months !== undefined && typeof parsed.warranty_months !== 'number') return false;
    if (parsed.serial_required !== undefined && typeof parsed.serial_required !== 'boolean') return false;
  }
  return true;
}

console.log('\n══════════════════════════════════════════════════');
console.log('  NEXOVA POS — Shop Modes Schema & Validation Tests');
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

  // ── 3. Test Diagnostics Report ────────────────────────────────────────────
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
