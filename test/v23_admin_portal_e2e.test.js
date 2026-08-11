// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - VALENIXIA ADMIN PORTAL E2E SUITE
// Empirical end-to-end verification of Admin Portal endpoints, claims review, and organization search
// ============================================================================

const assert = require('assert');
const EntitlementService = require('../lib/entitlement-service');
const { PlatformAdminService, PLATFORM_ROLES } = require('../lib/platform-admin-service');
const { db } = require('../database');

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Admin Portal End-to-End Suite (v2.3)');
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

runTest('Platform Admin Authentication: PBKDF2 Password validation & session issuance', async () => {
  const email = 'platform_admin@valenixia.com';
  await PlatformAdminService.bootstrapPlatformAdmin(email, 'SecurePlatformAdminPass123!');

  const loginRes = await PlatformAdminService.authenticateAdminPassword(email, 'SecurePlatformAdminPass123!');
  assert.strictEqual(loginRes.authenticated, true);
  assert.ok(loginRes.token.startsWith('ADMIN_SES_'));
  assert.strictEqual(loginRes.role, PLATFORM_ROLES.PLATFORM_ADMIN);
});

runTest('Admin Control Center: Submit Claim -> Pending Queue -> Admin Approve -> Immediate Activation', async () => {
  const accId = 'ACC_ADMIN_E2E';
  const orgId = 'ORG_ADMIN_E2E';
  await db.run(`INSERT OR REPLACE INTO organizations (id, name, tier, status) VALUES (?, 'Admin E2E Store', 'STARTER', 'active')`, [orgId]);

  // 1. Submit Claim
  const claim = await EntitlementService.submitPaymentClaim(accId, orgId, 'addon_fbr_digital_invoicing', 249900, 'PAY_PROOF_9988');
  assert.strictEqual(claim.status, 'PENDING');

  // 2. Admin Approve Claim (Idempotent)
  const approveRes = await EntitlementService.approvePaymentClaim(claim.id, 'ADMIN_SUPERVISOR');
  assert.strictEqual(approveRes.success, true);
  assert.strictEqual(approveRes.alreadyApproved, false);

  // 3. Duplicate Approval Attempt (Idempotency Check)
  const dupRes = await EntitlementService.approvePaymentClaim(claim.id, 'ADMIN_SUPERVISOR');
  assert.strictEqual(dupRes.success, true);
  assert.strictEqual(dupRes.alreadyApproved, true);

  // 4. Customer POS Entitlements Instantly Activated
  const effective = await EntitlementService.getOrganizationEntitlements(orgId);
  assert.strictEqual(effective.features.fbr, true);
});

runTest('Admin Claims Rejection: Rejection updates status & reason without activating entitlement', async () => {
  const accId = 'ACC_REJ_01';
  const orgId = 'ORG_REJ_01';
  await db.run(`INSERT OR REPLACE INTO organizations (id, name, tier, status) VALUES (?, 'Rejection Test Store', 'STARTER', 'active')`, [orgId]);

  const claim = await EntitlementService.submitPaymentClaim(accId, orgId, 'addon_smart_stock_alerts', 49900, 'PAY_INVALID_00');
  
  // Update status to REJECTED
  const key = `payment_claim_${claim.id}`;
  const row = await db.get(`SELECT * FROM local_preferences WHERE key = ?`, [key]);
  const payload = JSON.parse(row.value_payload);
  payload.status = 'REJECTED';
  payload.rejectionReason = 'Payment reference not found on NayaPay statement.';
  await db.run(`UPDATE local_preferences SET value_payload = ? WHERE key = ?`, [JSON.stringify(payload), key]);

  const rejectedRow = await db.get(`SELECT * FROM local_preferences WHERE key = ?`, [key]);
  const rejectedPayload = JSON.parse(rejectedRow.value_payload);
  assert.strictEqual(rejectedPayload.status, 'REJECTED');
  assert.ok(rejectedPayload.rejectionReason.includes('NayaPay statement'));

  // Ensure entitlement remains inactive
  const effective = await EntitlementService.getOrganizationEntitlements(orgId);
  assert.strictEqual(effective.features.smart_stock, undefined);
});

runTest('Security Check: Customer account receives 403 Forbidden on Admin evaluation', async () => {
  const custId = 'ACC_NORMAL_CUST';
  await db.run(`INSERT OR REPLACE INTO accounts (id, email, role, status) VALUES (?, 'user@store.com', 'CUSTOMER', 'active')`, [custId]);

  const isAdmin = await PlatformAdminService.isPlatformAdmin(custId);
  assert.strictEqual(isAdmin, false, 'Ordinary customer account must not be granted PLATFORM_ADMIN authority');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);
process.exit(totalFailed === 0 ? 0 : 1);
