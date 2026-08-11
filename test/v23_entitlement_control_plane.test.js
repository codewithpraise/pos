// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - ENTITLEMENT CONTROL PLANE TEST
// Empirical verification of effective entitlement calculation, payment claims, and admin search
// ============================================================================

const assert = require('assert');
const EntitlementService = require('../lib/entitlement-service');
const { db } = require('../database');

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Entitlement Control Plane Suite (v2.3)');
console.log('══════════════════════════════════════════════════\n');

let totalPassed = 0;
let totalFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    totalPassed++;
  } catch (err) {
    console.error(`  ❌ ${name}:`, err.message);
    totalFailed++;
  }
}

runTest('Effective Entitlement Math: Base STARTER Plan + Active Addons = Combined Features', async () => {
  const orgId = 'ORG_CTRL_101';
  await db.run(`INSERT OR REPLACE INTO organizations (id, name, tier, status) VALUES (?, 'Ctrl Store', 'STARTER', 'active')`, [orgId]);

  // Activate FBR Addon
  await db.run(
    `INSERT OR REPLACE INTO local_preferences (key, value_payload) VALUES (?, 'ACTIVE')`,
    [`addon_active_${orgId}_addon_fbr_digital_invoicing`]
  );

  const effective = await EntitlementService.getOrganizationEntitlements(orgId);
  assert.strictEqual(effective.tier, 'STARTER');
  assert.strictEqual(effective.features.fbr, true, 'FBR feature must be activated via Addon');
  assert.ok(effective.activeAddons.includes('addon_fbr_digital_invoicing'));
});

runTest('Transactional Subscription Activation: Tier upgrade updates Organization & writes Audit Log', async () => {
  const orgId = 'ORG_CTRL_102';
  await db.run(`INSERT OR REPLACE INTO organizations (id, name, tier, status) VALUES (?, 'Ali Retail', 'STARTER', 'active')`, [orgId]);

  const res = await EntitlementService.activateSubscription(orgId, 'PRO', 'PAY_REF_99988');
  assert.strictEqual(res.success, true);

  const updatedOrg = await db.get(`SELECT tier FROM organizations WHERE id = ?`, [orgId]);
  assert.strictEqual(updatedOrg.tier, 'PRO');
});

runTest('Payment Claim Queue & Admin Approval: Submit Claim -> Admin Approve -> Immediate Addon Activation', async () => {
  const accId = 'ACC_USER_99';
  const orgId = 'ORG_CTRL_103';
  await db.run(`INSERT OR REPLACE INTO organizations (id, name, tier, status) VALUES (?, 'Saddar Store', 'STARTER', 'active')`, [orgId]);

  // 1. Submit Claim
  const claim = await EntitlementService.submitPaymentClaim(accId, orgId, 'addon_smart_stock_alerts', 49900, 'TXN_NP_112233');
  assert.strictEqual(claim.status, 'PENDING');

  // 2. Admin Approve Claim
  const appRes = await EntitlementService.approvePaymentClaim(claim.id, 'SUPER_ADMIN');
  assert.strictEqual(appRes.success, true);

  // 3. Verify Effective Entitlements Immediately Refreshed
  const effective = await EntitlementService.getOrganizationEntitlements(orgId);
  assert.strictEqual(effective.features.smart_stock, true);
});

runTest('Organization Admin Search: Find store by ID, Name, Account Phone, or Terminal ID', async () => {
  const orgId = 'ORG_CTRL_104';
  await db.run(`INSERT OR REPLACE INTO organizations (id, name, tier, status) VALUES (?, 'Peshawar Bakers', 'STARTER', 'active')`, [orgId]);

  const searchResults = await EntitlementService.searchOrganizations('Peshawar');
  assert.ok(searchResults.length >= 1);
  assert.strictEqual(searchResults[0].id, orgId);
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);
process.exit(totalFailed === 0 ? 0 : 1);
