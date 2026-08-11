// ============================================================================
// VALENIXIA POS v2.6.x — HARD SERVER AUTHORIZATION MATRIX & ENTITLEMENT TEST
// Empirical verification of feature-gating matrix across 5 lifecycle states,
// signed offline snapshots, and server-side identity resolution.
// ============================================================================

const assert = require('assert');
const { initDatabase, db } = require('../database');
const { FEATURE_REGISTRY, getFeatureDefinition } = require('../lib/feature-registry');
const EntitlementService = require('../lib/entitlement-service');
const { AddonService } = require('../lib/addon-service');

console.log('🧪 Running Valenixia POS v2.6.x Authorization Matrix & Entitlement Hardening Test...');

async function runSuite() {
  await initDatabase();

  const testOrgId = `ORG_MATRIX_TEST_${Date.now()}`;

  // 1. VERIFY MASTER FEATURE REGISTRY INVARIANTS
  const features = Object.values(FEATURE_REGISTRY);
  assert(features.length >= 11, 'Feature registry must contain at least 11 commercial features');

  features.forEach(f => {
    assert(f.featureKey, 'Feature key required');
    assert(f.type === 'ADDON_REQUIRED' || f.type === 'PLAN_INCLUDED', 'Invalid feature type');
    assert(f.addonId, 'Addon ID required');
  });

  console.log(`  ✓ PASS: Master Feature Registry verified (${features.length} registered features)`);

  // 2. VERIFY HARD AUTHORIZATION MATRIX ACROSS 5 LIFECYCLE STATES
  const targetAddon = 'WHATSAPP_RECEIPTS';
  const targetFeature = 'whatsapp.receipts';

  // State A: NO_ADDON / DEFAULT
  const noAddonRes = await EntitlementService.authorizeFeature({ organizationId: testOrgId, featureKey: targetFeature });
  assert.strictEqual(noAddonRes.allowed, false, 'State NO_ADDON: Must DENY feature access');
  assert.strictEqual(noAddonRes.code, 'ADDON_NOT_APPROVED', 'State NO_ADDON: Reason must be ADDON_NOT_APPROVED');

  // State B: PENDING (Payment Claim Submitted)
  const claim = await EntitlementService.submitPaymentClaim('acc_test', testOrgId, 'addon_whatsapp_receipts', 99900, 'RRN_WA_123');
  assert.strictEqual(claim.status, 'PENDING', 'Payment claim must be PENDING');

  const pendingRes = await EntitlementService.authorizeFeature({ organizationId: testOrgId, featureKey: targetFeature });
  assert.strictEqual(pendingRes.allowed, false, 'State PENDING: Must DENY feature access');

  // State C: APPROVED (Admin Approval)
  const approveRes = await EntitlementService.approvePaymentClaim(claim.id, 'ADMIN_TEST');
  assert.strictEqual(approveRes.success, true, 'Admin approval must succeed');

  const approvedRes = await EntitlementService.authorizeFeature({ organizationId: testOrgId, featureKey: targetFeature });
  assert.strictEqual(approvedRes.allowed, true, 'State APPROVED: Must ALLOW feature access');
  assert.strictEqual(approvedRes.code, 'AUTHORIZED', 'State APPROVED: Code must be AUTHORIZED');

  // State D: REVOKED (Admin Revocation)
  const revokeRes = await EntitlementService.revokeAddon(testOrgId, 'addon_whatsapp_receipts', 'ADMIN_TEST', 'Fraud check');
  assert.strictEqual(revokeRes.success, true, 'Admin revoke must succeed');

  const revokedRes = await EntitlementService.authorizeFeature({ organizationId: testOrgId, featureKey: targetFeature });
  assert.strictEqual(revokedRes.allowed, false, 'State REVOKED: Must DENY feature access');

  // State E: EXPIRED (Expired Add-on)
  const expiredPayload = {
    status: 'ACTIVE',
    addonId: 'addon_whatsapp_receipts',
    organizationId: testOrgId,
    expiresAt: Date.now() - 3600000 // 1 hour ago
  };
  await db.run(
    `INSERT OR REPLACE INTO local_preferences (key, value_payload) VALUES (?, ?)`,
    [`addon_active_${testOrgId}_addon_whatsapp_receipts`, JSON.stringify(expiredPayload)]
  );

  const expiredRes = await EntitlementService.authorizeFeature({ organizationId: testOrgId, featureKey: targetFeature });
  assert.strictEqual(expiredRes.allowed, false, 'State EXPIRED: Must DENY feature access');

  console.log('  ✓ PASS: 5-State Entitlement Authorization Matrix verified (NO_ADDON, PENDING, APPROVED, REVOKED, EXPIRED)');

  // 3. VERIFY SIGNED OFFLINE SNAPSHOT CRYPTOGRAPHY (Ed25519)
  const pubKey = EntitlementService.getPublicVerificationKey();
  assert(pubKey, 'Public verification key must exist');

  const verificationRes = EntitlementService.verifySignedOfflineSnapshot(
    approvedRes.snapshot,
    approvedRes.signature,
    pubKey
  );
  assert.strictEqual(verificationRes, true, 'Ed25519 Signed Offline Snapshot signature verification must PASS');

  // Tampered snapshot must fail
  const tamperedSnapshot = JSON.parse(JSON.stringify(approvedRes.snapshot));
  tamperedSnapshot.subscription.tier = 'ENTERPRISE';
  const tamperedVerification = EntitlementService.verifySignedOfflineSnapshot(
    tamperedSnapshot,
    approvedRes.signature,
    pubKey
  );
  assert.strictEqual(tamperedVerification, false, 'Tampered snapshot signature verification must FAIL');

  console.log('  ✓ PASS: Ed25519 Cryptographic Entitlement Snapshot signing and tamper detection verified');

  // 4. VERIFY SERVER-SIDE IDENTITY RESOLUTION (No Client Parameter Spoofing)
  const mockReq = {
    headers: {
      'x-user-id': 'USR_HEADER_123',
      'x-organization-id': testOrgId,
      'x-terminal-id': 'TERM_HEADER_456',
      'x-user-role': 'cashier'
    }
  };

  const resolvedIdentity = await EntitlementService.resolveIdentity(mockReq);
  assert.strictEqual(resolvedIdentity.userId, 'USR_HEADER_123');
  assert.strictEqual(resolvedIdentity.terminalId, 'TERM_HEADER_456');

  // Role restriction test: cashier trying to execute admin-only feature
  const roleRestrictedRes = await EntitlementService.authorizeFeature({
    req: mockReq,
    organizationId: testOrgId,
    featureKey: 'analytics.advanced',
    action: 'analytics.margins'
  });
  assert.strictEqual(roleRestrictedRes.allowed, false, 'Cashier role must be DENIED access to admin-only feature');

  console.log('  ✓ PASS: Server identity resolution and role-based scope enforcement verified');

  console.log('\n==================================================');
  console.log('Authorization Matrix Test Results: ALL PASSED.');
  console.log('==================================================\n');
}

runSuite().catch(err => {
  console.error('\n❌ Test Failure:', err);
  process.exit(1);
});
