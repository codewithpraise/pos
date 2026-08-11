// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - PRODUCTION COMMERCIAL HARDENING TEST
// Empirical verification of payment claim idempotency, expiry policy, and catalog schema
// ============================================================================

const assert = require('assert');
const EntitlementService = require('../lib/entitlement-service');
const { ADDON_CATALOG, AddonService } = require('../lib/addon-service');
const { db } = require('../database');

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Production Commercial Hardening Suite (v2.3)');
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

runTest('Data-Driven Catalog Schema: Mandatory schema properties present on all items', () => {
  for (const addon of ADDON_CATALOG) {
    assert.ok(addon.id, 'Addon must have id');
    assert.ok(addon.name, 'Addon must have name');
    assert.ok(typeof addon.priceMinor === 'number', 'Addon must have integer priceMinor');
    assert.ok(addon.billingPeriod, 'Addon must specify billingPeriod');
    assert.ok(addon.status, 'Addon must specify status');
    assert.ok(addon.entitlementKeys && Array.isArray(addon.entitlementKeys), 'Addon must specify entitlementKeys array');
    assert.ok(addon.expiryPolicy, 'Addon must specify expiryPolicy');
  }
});

runTest('Commercial Boundary Notice: FBR addon specifies legal boundary disclaimer', () => {
  const fbr = AddonService.getAddonById('addon_fbr_digital_invoicing');
  assert.ok(fbr.commercialBoundaryNotice, 'FBR addon must have commercialBoundaryNotice');
  assert.ok(fbr.commercialBoundaryNotice.includes('Government/integrator registration, credentials, approvals, and any third-party charges remain separate'));
  assert.ok(fbr.setupChecklist && fbr.setupChecklist.length >= 4);
});

runTest('Payment Claim Approval Idempotency: Duplicate approval call returns alreadyApproved flag without double activation', async () => {
  const accId = 'ACC_IDEM_10';
  const orgId = 'ORG_IDEM_10';
  await db.run(`INSERT OR REPLACE INTO organizations (id, name, tier, status) VALUES (?, 'Idempotent Store', 'STARTER', 'active')`, [orgId]);

  const claim = await EntitlementService.submitPaymentClaim(accId, orgId, 'addon_cloud_backup', 39900, 'PAY_PROOF_777');
  
  // 1st Approval
  const res1 = await EntitlementService.approvePaymentClaim(claim.id, 'ADMIN_1');
  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.alreadyApproved, false);

  // 2nd Approval (Duplicate)
  const res2 = await EntitlementService.approvePaymentClaim(claim.id, 'ADMIN_1');
  assert.strictEqual(res2.success, true);
  assert.strictEqual(res2.alreadyApproved, true, 'Second approval attempt MUST return alreadyApproved = true');
});

runTest('Addon Expiry Policy: Expired addon transitions to EXPIRED & disables feature without deleting data', async () => {
  const orgId = 'ORG_EXP_99';
  await db.run(`INSERT OR REPLACE INTO organizations (id, name, tier, status) VALUES (?, 'Expiry Test Store', 'STARTER', 'active')`, [orgId]);

  // Insert an expired addon record (expired 1 hour ago)
  const expiredPayload = {
    status: 'ACTIVE',
    addonId: 'addon_smart_stock_alerts',
    organizationId: orgId,
    activatedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
    expiresAt: Date.now() - 60 * 60 * 1000 // Expired 1 hour ago
  };

  await db.run(
    `INSERT OR REPLACE INTO local_preferences (key, value_payload) VALUES (?, ?)`,
    [`addon_active_${orgId}_addon_smart_stock_alerts`, JSON.stringify(expiredPayload)]
  );

  const isActive = await AddonService.isAddonActive(orgId, 'addon_smart_stock_alerts');
  assert.strictEqual(isActive, false, 'Expired addon must return isActive = false');

  const effective = await EntitlementService.getOrganizationEntitlements(orgId);
  assert.strictEqual(effective.features.smart_stock, undefined, 'Feature entitlement must be disabled');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);
process.exit(totalFailed === 0 ? 0 : 1);
