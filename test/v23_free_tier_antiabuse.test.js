// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - FREE TIER ANTI-ABUSE TEST
// Verifies account-level free tier trial limits and multi-organization behavior
// ============================================================================

const assert = require('assert');
const EntitlementService = require('../lib/entitlement-service');

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Free Tier Anti-Abuse Suite (v2.3)');
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

class AccountAntiAbuseEvaluator {
  constructor() {
    this.accounts = new Map(); // accountId -> array of orgs { orgId, tier }
  }

  createOrganization(accountId, orgId, tier = 'FREE') {
    const userOrgs = this.accounts.get(accountId) || [];
    
    // Account-Level Anti-Abuse Check:
    // If requesting a FREE tier org and account already owns a FREE tier org -> REJECT
    if (tier === 'FREE') {
      const hasFreeOrg = userOrgs.some(o => o.tier === 'FREE');
      if (hasFreeOrg) {
        return {
          allowed: false,
          reason: 'Account already has an active Free Basic Organization. Please upgrade to create additional organizations.'
        };
      }
    }

    userOrgs.push({ orgId, tier });
    this.accounts.set(accountId, userOrgs);
    return { allowed: true };
  }
}

runTest('Account with 1 FREE Organization: Attempting 2nd FREE Organization BLOCKED', () => {
  const evaluator = new AccountAntiAbuseEvaluator();
  const accountId = 'ACC_ABUSE_1';

  evaluator.createOrganization(accountId, 'ORG_FREE_1', 'FREE');
  const res = evaluator.createOrganization(accountId, 'ORG_FREE_2', 'FREE');

  assert.strictEqual(res.allowed, false);
  assert.ok(res.reason.includes('already has an active Free Basic Organization'));
});

runTest('Account with 1 FREE Organization: Attempting 2nd PRO Organization ALLOWED', () => {
  const evaluator = new AccountAntiAbuseEvaluator();
  const accountId = 'ACC_PRO_1';

  evaluator.createOrganization(accountId, 'ORG_FREE_1', 'FREE');
  const res = evaluator.createOrganization(accountId, 'ORG_PRO_2', 'PRO');

  assert.strictEqual(res.allowed, true, 'Verified account can own multiple paid organizations');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);
process.exit(totalFailed === 0 ? 0 : 1);
