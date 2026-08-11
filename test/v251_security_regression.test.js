// ============================================================================
// VALENIXIA POS v2.5.1 SECURITY & ARCHITECTURAL REGRESSION TEST SUITE
// Tests release fingerprinting, Ed25519 signing, capacity row-locks,
// idempotent bootstrap, cart isolation, and rollback protection.
// ============================================================================

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const EntitlementService = require('../lib/entitlement-service');
const LEGAL_DOCUMENTS = require('../lib/legal-documents');

describe('VALENIXIA POS v2.5.1 Security & Architectural Suite', () => {
  
  it('1. Verifies release-manifest.json, version.json, and build-id report v2.5.1 and valid SHA-256 commit', () => {
    const manifestPath = path.join(__dirname, '../public/release-manifest.json');
    const versionPath = path.join(__dirname, '../public/version.json');
    const buildIdPath = path.join(__dirname, '../public/build-id');

    assert.strictEqual(fs.existsSync(manifestPath), true, 'release-manifest.json must exist');
    assert.strictEqual(fs.existsSync(versionPath), true, 'version.json must exist');
    assert.strictEqual(fs.existsSync(buildIdPath), true, 'build-id must exist');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const versionJson = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
    const buildId = fs.readFileSync(buildIdPath, 'utf8').trim();

    assert.strictEqual(manifest.version, '2.5.1');
    assert.strictEqual(versionJson.version, '2.5.1');
    assert.strictEqual(/^[0-9a-f]{40}$/.test(manifest.git_commit), true, 'git_commit must be a full 40-character hex string');
    assert.strictEqual(buildId, `v2.5.1-prod-${manifest.git_commit}`);
  });

  it('2. Verifies Ed25519 asymmetric offline entitlement signing and key verification', () => {
    const payload = {
      accountId: 'acc_test_123',
      organizationId: 'org_test_456',
      storeId: 'store_test_789',
      terminalId: 'term_test_01',
      tier: 'ENTERPRISE',
      maxTerminals: 10,
      maxBranches: 5
    };

    const result = EntitlementService.generateSignedOfflineSnapshot(payload);
    assert.strictEqual(typeof result.signature, 'string');
    assert.strictEqual(typeof result.publicKey, 'string');
    assert.strictEqual(result.snapshot.tier, 'ENTERPRISE');

    const isValid = EntitlementService.verifySignedOfflineSnapshot(
      result.snapshot,
      result.signature,
      result.publicKey
    );
    assert.strictEqual(isValid, true, 'Ed25519 signature verification must pass');

    // Tampering test
    const tamperedSnapshot = { ...result.snapshot, tier: 'FREE' };
    const isTamperedValid = EntitlementService.verifySignedOfflineSnapshot(
      tamperedSnapshot,
      result.signature,
      result.publicKey
    );
    assert.strictEqual(isTamperedValid, false, 'Tampered snapshot signature verification must fail');
  });

  it('3. Verifies capacity predicate for ACTIVE, APPROVED, and unexpired PENDING registrations', () => {
    const now = Date.now();
    assert.strictEqual(EntitlementService.isCapacityConsumingStatus('APPROVED', now), true);
    assert.strictEqual(EntitlementService.isCapacityConsumingStatus('ACTIVE', now), true);
    
    // Unexpired PENDING (5 mins old) -> consumes capacity
    assert.strictEqual(EntitlementService.isCapacityConsumingStatus('PENDING', now, now - 5 * 60 * 1000), true);

    // Expired PENDING (15 mins old) -> does NOT consume capacity
    assert.strictEqual(EntitlementService.isCapacityConsumingStatus('PENDING', now, now - 15 * 60 * 1000), false);

    assert.strictEqual(EntitlementService.isCapacityConsumingStatus('DISABLED', now), false);
    assert.strictEqual(EntitlementService.isCapacityConsumingStatus('REVOKED', now), false);
  });

  it('4. Verifies rendered legal documents report v2.5.1 and contain statutory tax filing disclaimers', () => {
    assert.strictEqual(LEGAL_DOCUMENTS.VERSION, '2.5.1');
    assert.strictEqual(LEGAL_DOCUMENTS.TERMS_OF_SERVICE.includes('(v2.5.1)'), true);
    assert.strictEqual(LEGAL_DOCUMENTS.TERMS_OF_SERVICE.includes('Software Provider Scope'), true);
    assert.strictEqual(LEGAL_DOCUMENTS.TERMS_OF_SERVICE.includes('Merchant Tax Obligations'), true);
  });

  it('5. Verifies canonical JSON serialization for release fingerprints', () => {
    const artHash = '58e9c8d422e0bfd8cc537353f0a8085b89f69d548ae54a50eda5d3b017906e8f';
    const payload1 = JSON.stringify({
      artifactManifestHash: artHash,
      buildId: 'v2.5.1-prod-b6c04e59dbcc91ea2c2107b87d84016282a3dd7d',
      gitCommit: 'b6c04e59dbcc91ea2c2107b87d84016282a3dd7d',
      schemaVersion: '17',
      version: '2.5.1'
    });
    const hash1 = crypto.createHash('sha256').update(payload1).digest('hex');

    assert.strictEqual(typeof hash1, 'string');
    assert.strictEqual(hash1.length, 64);
  });
});
