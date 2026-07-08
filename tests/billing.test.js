#!/usr/bin/env node
// ============================================================================
// NEXOVA POS - Manual Billing & Licensing Integration Test Suite
// Zero-dependency — uses Node.js built-in `assert` module
// ============================================================================
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { initDatabase, db } = require('../database');
const { mintToken } = require('../scripts/license-provisioner');

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

async function runAll() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  NEXOVA POS — Manual Billing & Licensing Tests');
  console.log('══════════════════════════════════════════════════\n');

  // Initialize DB before tests
  await initDatabase('test_terminal_node');

  // Seed test store if not exists
  const testStoreId = crypto.randomUUID();
  await db.run(
    "INSERT OR IGNORE INTO stores (id, phone, email, name, tier, mode, status, expires_at, hardware_limit) VALUES (?, ?, ?, ?, 'TRIAL', 'subscription', 'active', ?, 5)",
    [testStoreId, '03001234567', 'test@nexova.com', 'Test Billing Store', Date.now() + 86400000]
  );

  await testAsync('Payment proof insertion — records correctly to SQLite', async () => {
    const proofId = crypto.randomUUID();
    const rrn = 'RRN' + Date.now();
    
    await db.run(
      `INSERT INTO payment_proofs (id, user_id, plan_id, rrn_reference, amount, proof_image_url, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [proofId, testStoreId, 'PRO', rrn, 50000.0, '/proofs/img.png', Date.now(), Date.now()]
    );

    const row = await db.get("SELECT * FROM payment_proofs WHERE id = ?", [proofId]);
    assert.ok(row, 'Row should be found');
    assert.strictEqual(row.plan_id, 'PRO');
    assert.strictEqual(row.rrn_reference, rrn);
    assert.strictEqual(row.status, 'pending');
  });

  await testAsync('Payment proof duplicate check — unique constraint works', async () => {
    const rrn = 'RRN_DUP_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    
    // First insert
    await db.run(
      `INSERT INTO payment_proofs (id, user_id, plan_id, rrn_reference, amount, proof_image_url, status, created_at, updated_at)
       VALUES (?, ?, 'PRO', ?, 50000.0, '', 'pending', ?, ?)`,
      [crypto.randomUUID(), testStoreId, rrn, Date.now(), Date.now()]
    );

    // Second insert should fail unique constraint
    try {
      await db.run(
        `INSERT INTO payment_proofs (id, user_id, plan_id, rrn_reference, amount, proof_image_url, status, created_at, updated_at)
         VALUES (?, ?, 'PRO', ?, 50000.0, '', 'pending', ?, ?)`,
        [crypto.randomUUID(), testStoreId, rrn, Date.now(), Date.now()]
      );
      assert.fail('Unique constraint on rrn_reference should have failed.');
    } catch (err) {
      assert.ok(err.message.includes('UNIQUE constraint failed'), 'Should throw unique constraint error');
    }
  });

  await testAsync('Ed25519 Token Minting — signs and formats correctly', async () => {
    const storeId = crypto.randomUUID();
    const hwid = 'TEST-HARDWARE-ID';
    const tier = 'PRO';
    const mode = 'subscription';
    const days = 30;

    const { token, payload } = mintToken(storeId, hwid, tier, mode, days, 'active');
    
    assert.ok(token, 'Token should be generated');
    assert.strictEqual(payload.store_id, storeId);
    assert.strictEqual(payload.hwid, hwid);
    assert.strictEqual(payload.tier, tier);
    assert.ok(payload.exp > payload.iat, 'Expiry should be in the future');
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('\nFailures details:');
    failures.forEach(f => console.error(`  - ${f.name}: ${f.error}`));
    process.exit(1);
  } else {
    console.log('\nAll billing & licensing integration tests passed successfully!\n');
    process.exit(0);
  }
}

runAll().catch(err => {
  console.error(err);
  process.exit(1);
});
