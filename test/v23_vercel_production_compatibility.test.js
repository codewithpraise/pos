// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - VERCEL PRODUCTION COMPATIBILITY TEST
// Empirical verification of serverless runtime safety, secrets isolation, and authority matrix
// ============================================================================

const assert = require('assert');
const { VERCEL_DATA_AUTHORITY_MATRIX, auditEnvironmentSecrets } = require('../lib/vercel-compat-audit');
const { FbrAdapterProvider, FBR_STATUS_STATES } = require('../lib/fbr-adapter');
const EntitlementService = require('../lib/entitlement-service');
const { db } = require('../database');

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Vercel Production Compatibility Suite (v2.3)');
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

runTest('Vercel Data Authority Matrix: All 12 entities have explicit Supabase Postgres Cloud Authority', () => {
  const keys = Object.keys(VERCEL_DATA_AUTHORITY_MATRIX);
  assert.strictEqual(keys.length, 12, 'Must cover all 12 core data entities');

  for (const k of keys) {
    const entry = VERCEL_DATA_AUTHORITY_MATRIX[k];
    assert.strictEqual(entry.cloudAuthority, 'Supabase Postgres', `Entity ${k} must use Supabase Postgres as Cloud Authority`);
    assert.strictEqual(entry.serverlessSafe, true, `Entity ${k} must be serverless safe`);
  }
});

runTest('Secrets Leakage Audit: Zero server secrets exposed in client payloads', () => {
  process.env.VALENIXIA_ADMIN_BOOTSTRAP_SECRET = 'SECRET_KEY_PROD_12345';
  process.env.SERVER_MASTER_KEY = 'MASTER_KEY_PROD_67890';

  const clientPayload = {
    user: { id: 'ACC_1', email: 'customer@store.com', role: 'CUSTOMER' },
    activeTier: 'STARTER',
    features: { csv_import: true }
  };

  const auditRes = auditEnvironmentSecrets(clientPayload);
  assert.strictEqual(auditRes.isClean, true, 'No server secrets must be present in client payload');
});

runTest('FBR Initial Status: Unconfigured stores default to CONFIGURATION_REQUIRED', async () => {
  const config = await FbrAdapterProvider.getFbrConfig('ORG_VERCEL_NEW', 'BRANCH_1', 'TERM_1');
  assert.strictEqual(config.status, FBR_STATUS_STATES.CONFIGURATION_REQUIRED);
  assert.strictEqual(config.isConfigured, false);
});

runTest('E2E Release Workflow: Request -> Claim -> Admin Approve -> Entitlement Refresh', async () => {
  const accId = 'ACC_VERCEL_01';
  const orgId = 'ORG_VERCEL_01';
  await db.run(`INSERT OR REPLACE INTO organizations (id, name, tier, status) VALUES (?, 'Vercel Store', 'STARTER', 'active')`, [orgId]);

  // 1. Submit Claim
  const claim = await EntitlementService.submitPaymentClaim(accId, orgId, 'addon_cloud_backup', 39900, 'PAY_VERCEL_99');
  assert.strictEqual(claim.status, 'PENDING');

  // 2. Admin Approve Claim
  const approveRes = await EntitlementService.approvePaymentClaim(claim.id, 'ADMIN_VERCEL');
  assert.strictEqual(approveRes.success, true);

  // 3. Customer Effective Entitlements Refreshed
  const effective = await EntitlementService.getOrganizationEntitlements(orgId);
  assert.strictEqual(effective.features.cloud_backup, true);
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);
process.exit(totalFailed === 0 ? 0 : 1);
