// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - LEGAL ACCEPTANCE VERSIONING TEST
// Verifies versioned legal documents and user acceptance tracking
// ============================================================================

const assert = require('assert');

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Legal Acceptance Versioning Suite (v2.3)');
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

class LegalAcceptanceTracker {
  constructor() {
    this.currentDocVersions = {
      EULA: '1.2.0',
      PRIVACY: '1.0.0',
      TERMS: '2.0.0'
    };
    this.userAcceptances = new Map();
  }

  recordAcceptance(accountId, docType, version) {
    const key = `${accountId}_${docType}`;
    this.userAcceptances.set(key, { docType, version, acceptedAt: Date.now() });
  }

  requiresReAcceptance(accountId, docType) {
    const key = `${accountId}_${docType}`;
    const record = this.userAcceptances.get(key);
    if (!record) return true;
    return record.version !== this.currentDocVersions[docType];
  }
}

runTest('Legal Versioning: User accepts Terms v1.0.0 -> Document version updated to v2.0.0 -> User MUST re-accept', () => {
  const legal = new LegalAcceptanceTracker();
  const accountId = 'ACC_USER_101';

  legal.recordAcceptance(accountId, 'TERMS', '1.0.0');
  
  // Terms version is bumped to 2.0.0 in system
  const needsReAccept = legal.requiresReAcceptance(accountId, 'TERMS');
  assert.strictEqual(needsReAccept, true, 'User must re-accept when document version changes');

  // User accepts new version 2.0.0
  legal.recordAcceptance(accountId, 'TERMS', '2.0.0');
  assert.strictEqual(legal.requiresReAcceptance(accountId, 'TERMS'), false, 'Re-acceptance cleared');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);
process.exit(totalFailed === 0 ? 0 : 1);
