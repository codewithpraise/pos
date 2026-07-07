#!/usr/bin/env node
// ============================================================================
// NEXOVA POS - Database Integration Tests
// Tests the SQLite database wrapper, migrations, PIN hashing, and type safety
// Run: node tests/db.test.js
// ============================================================================
'use strict';

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

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

console.log('\n══════════════════════════════════════════════════');
console.log('  NEXOVA POS — Database Integration Tests');
console.log('══════════════════════════════════════════════════\n');

// Use a throw-away in-memory SQLite for testing (no external DB needed)
const Database = require('sqlite3').verbose().Database;
const db_raw = new Database(':memory:');
const db = {
  run: (sql, params = []) => new Promise((res, rej) => db_raw.run(sql, params, function(err) { err ? rej(err) : res(this); })),
  get: (sql, params = []) => new Promise((res, rej) => db_raw.get(sql, params, (err, row) => err ? rej(err) : res(row))),
  all: (sql, params = []) => new Promise((res, rej) => db_raw.all(sql, params, (err, rows) => err ? rej(err) : res(rows))),
  exec: (sql) => new Promise((res, rej) => db_raw.exec(sql, err => err ? rej(err) : res())),
};

(async () => {
  // ── 1. Basic SQLite connectivity ───────────────────────────────────────────
  console.log('▶ SQLite connectivity');
  await testAsync('db.get — SELECT 1 returns row', async () => {
    const row = await db.get('SELECT 1 AS n');
    assert.strictEqual(row.n, 1);
  });

  // ── 2. Schema creation ─────────────────────────────────────────────────────
  console.log('\n▶ Schema creation');
  await testAsync('CREATE TABLE — local_preferences', async () => {
    await db.run(`CREATE TABLE IF NOT EXISTS local_preferences (
      key TEXT PRIMARY KEY,
      value_payload TEXT,
      val_type TEXT NOT NULL DEFAULT 'string'
    )`);
    const row = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='local_preferences'");
    assert.ok(row, 'Table local_preferences should exist');
  });

  await testAsync('CREATE TABLE — crsql_changes', async () => {
    await db.run(`CREATE TABLE IF NOT EXISTS crsql_changes (
      table_name TEXT, pk TEXT, cid TEXT, val TEXT, val_type TEXT DEFAULT 'string',
      col_version INTEGER, db_version INTEGER, site_id TEXT, cl INTEGER, sync_hlc TEXT
    )`);
    const row = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='crsql_changes'");
    assert.ok(row, 'Table crsql_changes should exist');
  });

  // ── 3. local_preferences CRUD ─────────────────────────────────────────────
  console.log('\n▶ local_preferences CRUD');
  await testAsync('INSERT into local_preferences', async () => {
    await db.run("INSERT INTO local_preferences (key, value_payload, val_type) VALUES (?, ?, ?)", ['schema_version', '3', 'number']);
    const row = await db.get("SELECT value_payload, val_type FROM local_preferences WHERE key = 'schema_version'");
    assert.strictEqual(row.value_payload, '3');
    assert.strictEqual(row.val_type, 'number');
  });

  await testAsync('UPDATE local_preferences', async () => {
    await db.run("UPDATE local_preferences SET value_payload = ? WHERE key = ?", ['4', 'schema_version']);
    const row = await db.get("SELECT value_payload FROM local_preferences WHERE key = 'schema_version'");
    assert.strictEqual(row.value_payload, '4');
  });

  await testAsync('SELECT missing key returns undefined', async () => {
    const row = await db.get("SELECT value_payload FROM local_preferences WHERE key = 'nonexistent'");
    assert.strictEqual(row, undefined);
  });

  // ── 4. crsql_changes type safety ──────────────────────────────────────────
  console.log('\n▶ crsql_changes val_type column');
  await testAsync('INSERT row with val_type number', async () => {
    await db.run(`INSERT INTO crsql_changes (table_name, pk, cid, val, val_type, col_version, db_version, site_id, cl, sync_hlc)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, ['transactions', 'pk1', 'amount', '5000', 'number', 1, 1, 'site1', 1, 'hlc1']);
    const row = await db.get("SELECT val_type FROM crsql_changes WHERE pk = 'pk1'");
    assert.strictEqual(row.val_type, 'number');
  });

  await testAsync('INSERT row with val_type boolean', async () => {
    await db.run(`INSERT INTO crsql_changes (table_name, pk, cid, val, val_type, col_version, db_version, site_id, cl, sync_hlc)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, ['settings', 'pk2', 'is_active', 'true', 'boolean', 1, 2, 'site1', 1, 'hlc2']);
    const row = await db.get("SELECT val_type FROM crsql_changes WHERE pk = 'pk2'");
    assert.strictEqual(row.val_type, 'boolean');
  });

  await testAsync('NULL val row accepted', async () => {
    await db.run(`INSERT INTO crsql_changes (table_name, pk, cid, val, val_type, col_version, db_version, site_id, cl, sync_hlc)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, ['products', 'pk3', 'description', null, 'string', 1, 3, 'site1', 1, 'hlc3']);
    const row = await db.get("SELECT val FROM crsql_changes WHERE pk = 'pk3'");
    assert.strictEqual(row.val, null);
  });

  await testAsync('db.all — returns multiple rows', async () => {
    const rows = await db.all('SELECT * FROM crsql_changes ORDER BY db_version ASC');
    assert.ok(Array.isArray(rows));
    assert.strictEqual(rows.length, 3);
  });

  // ── 5. PIN hashing logic (mirrors database.js hashPin) ────────────────────
  console.log('\n▶ PIN hashing (PBKDF2 mirrors)');
  const crypto = require('crypto');

  function hashPin(pin) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(pin, salt, 100000, 32, 'sha256').toString('hex');
    return `${salt}:${hash}`;
  }

  function verifyPin(pin, storedHash) {
    const [salt, hash] = storedHash.split(':');
    const attempt = crypto.pbkdf2Sync(pin, salt, 100000, 32, 'sha256').toString('hex');
    return attempt === hash;
  }

  test('hashPin — produces salt:hash format', () => {
    const result = hashPin('1234');
    assert.ok(result.includes(':'), 'Should contain colon separator');
    const parts = result.split(':');
    assert.strictEqual(parts.length, 2);
    assert.ok(parts[0].length > 0);
    assert.ok(parts[1].length > 0);
  });

  test('verifyPin — correct PIN passes', () => {
    const stored = hashPin('9999');
    assert.strictEqual(verifyPin('9999', stored), true);
  });

  test('verifyPin — wrong PIN fails', () => {
    const stored = hashPin('9999');
    assert.strictEqual(verifyPin('8888', stored), false);
  });

  test('hashPin — two hashes of same PIN are different (salt randomness)', () => {
    const a = hashPin('1234');
    const b = hashPin('1234');
    assert.notStrictEqual(a, b, 'Different salts should produce different stored hashes');
  });

  // ── 6. SQL injection guard (parameterized query test) ─────────────────────
  console.log('\n▶ SQL injection safety');
  await testAsync('Parameterized query — SQL injection in value does not escape', async () => {
    const malicious = "'; DROP TABLE local_preferences; --";
    await db.run("INSERT INTO local_preferences (key, value_payload) VALUES (?, ?)", ['injection_test', malicious]);
    const row = await db.get("SELECT value_payload FROM local_preferences WHERE key = 'injection_test'");
    assert.strictEqual(row.value_payload, malicious, 'Value should be stored literally, not executed');
    // Table should still exist
    const tbl = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='local_preferences'");
    assert.ok(tbl, 'Table should still exist after injection attempt');
  });

  // ─────────────────────────────────────────────────────────────────────────
  db_raw.close();

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n  Failed tests:');
    failures.forEach(f => console.log(`    - ${f.name}: ${f.error}`));
  }
  console.log('══════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
})();
