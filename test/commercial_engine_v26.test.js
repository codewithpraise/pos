const assert = require('assert');
const path = require('path');
const crypto = require('crypto');
process.on('unhandledRejection', () => {});

async function runCommercialEngineTests() {
  console.log('=== RUNNING COMMERCIAL ENGINE V2.6.0 REGRESSION TESTS ===\n');

  // Test 1: Catalog Integer Math & Rounding Formula
  console.log('Test 1: Catalog Integer Math & Rounding Formula');
  const { COMMERCIAL_PLANS, getAnnualPrice } = require('../public/commercial-catalog');

  assert.strictEqual(getAnnualPrice(3499), 35690, 'Starter annual price must be 35,690');
  assert.strictEqual(getAnnualPrice(6999), 71390, 'Pro annual price must be 71,390');
  assert.strictEqual(getAnnualPrice(11999), 122390, 'Enterprise annual price must be 122,390');

  assert.strictEqual(COMMERCIAL_PLANS.STARTER.price_annual_pkr, 35690);
  assert.strictEqual(COMMERCIAL_PLANS.PRO.price_annual_pkr, 71390);
  assert.strictEqual(COMMERCIAL_PLANS.ENTERPRISE.price_annual_pkr, 122390);
  console.log('✅ Test 1 Passed: Catalog annual prices match Math.round(monthly * 12 * 85 / 100) exactly.\n');

  // Test 2: Database Layer & Append-Only Triggers
  console.log('Test 2: Database Initialization & Append-Only Triggers');
  const { initDatabase, db } = require('../database');
  await initDatabase('test_terminal_v26');

  // Insert a test billing_event
  const eventId = `test_event_${Date.now()}`;
  const quoteId = `test_quote_${Date.now()}`;
  const idempotencyKey = `idemp_${Date.now()}_${Math.random()}`;

  const genesisHash = crypto.createHash('sha256').update('GENESIS_HASH' + eventId).digest('hex');

  await db.run(`
    INSERT INTO billing_events (
      event_id, account_id, org_id, quote_id, event_type, plan_tier,
      billing_cycle, additional_terminals, additional_branches, active_addons_json,
      amount_pkr, currency, payment_reference, claim_id, effective_at, expires_at,
      created_at, actor_user_id, event_version, idempotency_key, source, metadata_json,
      reversal_of_event_id, previous_state_hash, event_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    eventId, 'acc_test', 'org_test', quoteId, 'BASE_SUBSCRIPTION', 'PRO',
    'MONTHLY', 1, 0, '[]', 7999, 'PKR', 'REF_TEST_123', 'CLAIM_TEST_123',
    Date.now(), Date.now() + 2592000000, Date.now(), 'user_test', 1, idempotencyKey,
    'VALENIXIA_COMMERCE_ENGINE', '{}', null, 'GENESIS_HASH', genesisHash
  ]);

  const inserted = await db.get("SELECT * FROM billing_events WHERE event_id = ?", [eventId]);
  assert.ok(inserted, 'Billing event should be inserted');
  assert.strictEqual(inserted.amount_pkr, 7999);

  // Test UPDATE rejection by DB trigger
  let updateError = null;
  await db.run("UPDATE billing_events SET amount_pkr = 99999 WHERE event_id = ?", [eventId]).catch(err => {
    updateError = err;
  });
  assert.ok(updateError, 'UPDATE on billing_events must be rejected by database trigger');
  assert.ok(updateError.message.includes('append-only'), 'Error message must specify append-only restriction');

  // Test DELETE rejection by DB trigger
  let deleteError = null;
  await db.run("DELETE FROM billing_events WHERE event_id = ?", [eventId]).catch(err => {
    deleteError = err;
  });
  assert.ok(deleteError, 'DELETE on billing_events must be rejected by database trigger');
  assert.ok(deleteError.message.includes('append-only'), 'Error message must specify append-only restriction');

  console.log('✅ Test 2 Passed: SQLite triggers enforce append-only billing_events immutability.\n');

  // Test 3: Idempotency Key Constraint
  console.log('Test 3: Idempotency Key Duplicate Rejection');
  let duplicateError = null;
  await db.run(`
    INSERT INTO billing_events (
      event_id, account_id, org_id, quote_id, event_type, plan_tier,
      billing_cycle, additional_terminals, additional_branches, active_addons_json,
      amount_pkr, currency, payment_reference, claim_id, effective_at, expires_at,
      created_at, actor_user_id, event_version, idempotency_key, source, metadata_json,
      reversal_of_event_id, previous_state_hash, event_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    `event_dup_${Date.now()}`, 'acc_test', 'org_test', quoteId, 'BASE_SUBSCRIPTION', 'PRO',
    'MONTHLY', 1, 0, '[]', 7999, 'PKR', 'REF_TEST_123', 'CLAIM_TEST_123',
    Date.now(), Date.now() + 2592000000, Date.now(), 'user_test', 1, idempotencyKey,
    'VALENIXIA_COMMERCE_ENGINE', '{}', null, 'GENESIS_HASH', genesisHash
  ]).catch(err => {
    duplicateError = err;
  });
  assert.ok(duplicateError, 'Duplicate idempotency_key insertion must be rejected by UNIQUE constraint');
  console.log('✅ Test 3 Passed: Idempotency key UNIQUE constraint verified.\n');

  console.log('=== ALL COMMERCIAL ENGINE TESTS PASSED SUCCESSFULLY ===');
}

runCommercialEngineTests().catch(err => {
  console.error('❌ Test Failure:', err);
  process.exit(1);
});
