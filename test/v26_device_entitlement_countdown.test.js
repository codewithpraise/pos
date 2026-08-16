// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM — HARDWARE ENTITLEMENT & COUNTDOWN INTEGRITY SUITE
// Tests persistent hardware entitlements, countdown continuity across store resets,
// strict HWID isolation, and anti-loophole expiration guarantees.
// ============================================================================

const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('\n════════════════════════════════════════════════════════════════');
console.log('  VALENIXIA POS v2.6.x HARDWARE ENTITLEMENT & COUNTDOWN TEST SUITE');
console.log('════════════════════════════════════════════════════════════════\n');

let totalPassed = 0;
let totalFailed = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    totalPassed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error('    Error:', err.message);
    totalFailed++;
  }
}

async function main() {
  const {
    initDatabase,
    db,
    getHardwareEntitlement,
    setHardwareEntitlement,
    factoryResetDatabase
  } = require('../database');

  await initDatabase('test_terminal_entitlement_01');

  // --- 1. Schema & Table Integrity ---
  await runTest('hardware_entitlements table exists with required schema', async () => {
    const tableInfo = await db.all("PRAGMA table_info(hardware_entitlements)");
    const columnNames = tableInfo.map(c => c.name);
    assert.ok(columnNames.includes('hwid'), 'Must have hwid column');
    assert.ok(columnNames.includes('tier'), 'Must have tier column');
    assert.ok(columnNames.includes('first_activated_at'), 'Must have first_activated_at column');
    assert.ok(columnNames.includes('subscription_start_time'), 'Must have subscription_start_time column');
    assert.ok(columnNames.includes('expires_at'), 'Must have expires_at column');
    assert.ok(columnNames.includes('duration_ms'), 'Must have duration_ms column');
    assert.ok(columnNames.includes('trial_used'), 'Must have trial_used column');
  });

  // --- 2. setHardwareEntitlement and getHardwareEntitlement ---
  const testHwid = 'TEST_DEVICE_HWID_ENTERPRISE_999';
  const initialStartTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago
  const initialExpiryTime = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(); // 20 days remaining

  await runTest('setHardwareEntitlement records Enterprise tier and custom expiration', async () => {
    const ent = await setHardwareEntitlement(testHwid, {
      tier: 'ENTERPRISE',
      billing_cycle: 'MONTHLY',
      subscription_start_time: initialStartTime,
      expires_at: initialExpiryTime,
      duration_ms: 30 * 24 * 60 * 60 * 1000,
      approved_by: 'SUPER_ADMIN'
    });

    assert.strictEqual(ent.hwid, testHwid);
    assert.strictEqual(ent.tier, 'ENTERPRISE');
    assert.strictEqual(ent.subscription_start_time, initialStartTime);
    assert.strictEqual(ent.expires_at, initialExpiryTime);
  });

  // --- 3. Store Deletion / Factory Reset Persistence Guarantee ---
  await runTest('factoryResetDatabase() preserves hardware_entitlements table completely', async () => {
    // Insert some transient store data
    await db.run("INSERT OR REPLACE INTO local_preferences (key, value_payload) VALUES ('store_name', 'Temporary Store')");
    
    // Execute full factory reset / store deletion
    await factoryResetDatabase();

    // Verify local preferences were wiped
    const pref = await db.get("SELECT * FROM local_preferences WHERE key = 'store_name'");
    assert.strictEqual(pref, undefined, 'local_preferences should be wiped on store reset');

    // Verify hardware_entitlements for the device is 100% INTACT
    const preservedEnt = await getHardwareEntitlement(testHwid);
    assert.ok(preservedEnt, 'Hardware entitlement must survive store deletion');
    assert.strictEqual(preservedEnt.hwid, testHwid);
    assert.strictEqual(preservedEnt.tier, 'ENTERPRISE');
    assert.strictEqual(preservedEnt.subscription_start_time, initialStartTime, 'Start timestamp must not change on reset');
    assert.strictEqual(preservedEnt.expires_at, initialExpiryTime, 'Expiration timestamp must not change on reset');
  });

  // --- 4. Countdown Drift Invariant ---
  await runTest('Countdown remaining duration is monotonic and does not reset to full 30 days on new store', async () => {
    const ent = await getHardwareEntitlement(testHwid);
    const expiresAtMs = Date.parse(ent.expires_at);
    const remainingMs = expiresAtMs - Date.now();
    const remainingDays = Math.round(remainingMs / (24 * 60 * 60 * 1000));

    assert.ok(remainingDays <= 21 && remainingDays >= 19, `Remaining days must be ~20 days (was ${remainingDays}), not 30 days`);
  });

  // --- 5. Billing Cycles & Lifetime Plan Handling ---
  const lifetimeHwid = 'TEST_DEVICE_LIFETIME_888';
  await runTest('Lifetime subscription has null expires_at and persistent entitlement', async () => {
    const ent = await setHardwareEntitlement(lifetimeHwid, {
      tier: 'ENTERPRISE',
      billing_cycle: 'LIFETIME',
      expires_at: null,
      notes: 'Lifetime License'
    });

    assert.strictEqual(ent.tier, 'ENTERPRISE');
    assert.strictEqual(ent.billing_cycle, 'LIFETIME');
    assert.strictEqual(ent.expires_at, null);

    const fetched = await getHardwareEntitlement(lifetimeHwid);
    assert.strictEqual(fetched.expires_at, null);
  });

  // --- 6. Anti-Spoofing & Hardware Isolation ---
  const unapprovedHwid = 'UNAPPROVED_RANDOM_DEVICE_001';
  await runTest('Unregistered device does not inherit Enterprise tier from other devices', async () => {
    const ent = await getHardwareEntitlement(unapprovedHwid);
    assert.strictEqual(ent, undefined, 'Unapproved device should have no hardware entitlement');
  });

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log(`  RESULTS: ${totalPassed} passed, ${totalFailed} failed.`);
  console.log('════════════════════════════════════════════════════════════════\n');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
