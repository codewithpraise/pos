const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { execSync } = require('child_process');

const VERSION = '2.6.0';
let GIT_COMMIT = 'badda34f768186762f400ba553eef5e7dc46a5b8';
try {
  GIT_COMMIT = execSync('git rev-parse HEAD', { cwd: path.join(__dirname, '..') }).toString().trim();
} catch (_) {}

const BUILD_ID = `v${VERSION}-prod-${GIT_COMMIT.slice(0, 7)}`;
const SCHEMA_VERSION = '17';

const publicDir = path.join(__dirname, '..', 'public');

// Files to include in artifact manifest
const assetFiles = [
  'index.html',
  'app.js',
  'bootstrap-init.js',
  'sw.js',
  'sw-loader.js',
  'commercial-catalog.js',
  'legal-documents.js',
  'connectivity.js',
  'version.json',
  'release-manifest.json',
  'build-id',
  'manifest.json'
].sort();

// 1. Write release-manifest.json
const releaseManifest = {
  product: 'VALENIXIA POS',
  version: VERSION,
  build_id: BUILD_ID,
  git_commit: GIT_COMMIT,
  environment: 'production',
  schema_version: SCHEMA_VERSION,
  commercial_catalog_version: VERSION,
  legal_documents_version: VERSION,
  minimum_client_version: VERSION,
  rollback_allowed: false,
  minimum_compatible_version: '2.6.0'
};
fs.writeFileSync(path.join(publicDir, 'release-manifest.json'), JSON.stringify(releaseManifest, null, 2) + '\n');

// 2. Write version.json
const versionJson = {
  version: VERSION,
  build_id: BUILD_ID,
  git_commit: GIT_COMMIT,
  updated_at: '2026-08-11',
  changelog: `Valenixia POS v${VERSION} Canonical Release Reconciliation, Identity Recovery & Production Integrity Lockdown.`,
  changes: [
    'Reconciled canonical release fingerprint across release-manifest.json, version.json, build-id, artifact-manifest.json, and /api/health',
    'Hardened explicit Express static routes for metadata endpoints with 0 text/html fallback',
    'Implemented 13-stage confidence matrix for idempotent bootstrap discovery without false store creation',
    'Enforced cart namespace isolation and copy-first order migration safeguards',
    'Built atomic row-level capacity locking and immutable subscription upgrade state machine',
    'Implemented asymmetric Ed25519 offline entitlement signing with key rotation support',
    'Separated Network Reachability (ONLINE) from Sync Engine Status (SYNCED) in topbar',
    'Enforced single vertical scroll owner on subscription vault stage with zero viewport clipping'
  ]
};
fs.writeFileSync(path.join(publicDir, 'version.json'), JSON.stringify(versionJson, null, 2) + '\n');

// 3. Write build-id
fs.writeFileSync(path.join(publicDir, 'build-id'), BUILD_ID + '\n');

// 4. Calculate artifact manifest
const artifacts = {};
for (const file of assetFiles) {
  const filePath = path.join(publicDir, file);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    artifacts[file] = {
      path: file,
      size: content.length,
      sha256: hash
    };
  }
}

const artifactManifest = {
  version: VERSION,
  git_commit: GIT_COMMIT,
  build_id: BUILD_ID,
  artifacts
};

const artifactManifestString = JSON.stringify(artifactManifest, null, 2) + '\n';
fs.writeFileSync(path.join(publicDir, 'artifact-manifest.json'), artifactManifestString);

const artifactManifestHash = crypto.createHash('sha256').update(artifactManifestString).digest('hex');

// 5. Canonical JSON serialized release fingerprint
const fingerprintPayload = JSON.stringify({
  artifactManifestHash,
  buildId: BUILD_ID,
  gitCommit: GIT_COMMIT,
  schemaVersion: SCHEMA_VERSION,
  version: VERSION
});
const releaseFingerprint = crypto.createHash('sha256').update(fingerprintPayload).digest('hex');

console.log('Manifest generation complete:');
console.log('VERSION:', VERSION);
console.log('BUILD_ID:', BUILD_ID);
console.log('ARTIFACT_MANIFEST_HASH:', artifactManifestHash);
console.log('RELEASE_FINGERPRINT:', releaseFingerprint);
