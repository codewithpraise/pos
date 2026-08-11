// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - GOOGLE DRIVE DISASTER RECOVERY INTEGRATION TEST
// Empirical backup encryption, SHA-256 verification, restore, and security test
// ============================================================================

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const GoogleDriveBackupManager = require('../lib/google-drive-backup');

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Google Drive Disaster Recovery Suite (v2.3)');
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

const mockDbPath = path.join(__dirname, 'mock_test_db.sqlite');
fs.writeFileSync(mockDbPath, 'VALENIXIA_MOCK_SQLITE_WAL_PAYLOAD_TEST');

runTest('Backup Snapshot Creation & Encryption', () => {
  const { manifest, encryptedPayload } = GoogleDriveBackupManager.createEncryptedSnapshot(mockDbPath, 'Passkey123');
  assert.ok(manifest.checksumSha256, 'Manifest must contain SHA-256 checksum');
  assert.ok(manifest.ivHex, 'Manifest must contain IV hex');
  assert.ok(manifest.authTagHex, 'Manifest must contain AES-GCM AuthTag hex');
  assert.ok(encryptedPayload.length > 0, 'Encrypted payload must be non-empty');
});

runTest('User-Transparent Drive Folder Resolution', () => {
  const folderPath = GoogleDriveBackupManager.getDriveFolderPath('ORG_99');
  assert.strictEqual(folderPath, 'Valenixia/Backups/ORG_99', 'Target folder must be Valenixia/Backups/<OrgId>/');
});

runTest('Drive Resumable Upload Preparation', () => {
  const { manifest, encryptedPayload } = GoogleDriveBackupManager.createEncryptedSnapshot(mockDbPath, 'Passkey123');
  const uploadPrep = GoogleDriveBackupManager.prepareDriveUpload('ORG_99', manifest, encryptedPayload);
  assert.strictEqual(uploadPrep.folderPath, 'Valenixia/Backups/ORG_99');
  assert.ok(uploadPrep.filename.startsWith('valenixia_backup_'));
});

runTest('Backup Decryption & SHA-256 Checksum Verification', () => {
  const key = 'Passkey123';
  const { manifest, encryptedPayload } = GoogleDriveBackupManager.createEncryptedSnapshot(mockDbPath, key);
  const decrypted = GoogleDriveBackupManager.verifyAndDecryptSnapshot(encryptedPayload, manifest, key);
  assert.strictEqual(decrypted.toString(), 'VALENIXIA_MOCK_SQLITE_WAL_PAYLOAD_TEST');
});

runTest('Corrupted Backup Rejection', () => {
  const key = 'Passkey123';
  const { manifest, encryptedPayload } = GoogleDriveBackupManager.createEncryptedSnapshot(mockDbPath, key);
  // Corrupt payload
  encryptedPayload[0] = encryptedPayload[0] ^ 0xFF;
  assert.throws(() => {
    GoogleDriveBackupManager.verifyAndDecryptSnapshot(encryptedPayload, manifest, key);
  }, /verification failed|cipher/i);
});

// Cleanup temp file
try { fs.unlinkSync(mockDbPath); } catch (_) {}

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);
process.exit(totalFailed === 0 ? 0 : 1);
