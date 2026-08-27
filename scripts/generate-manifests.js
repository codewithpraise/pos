const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { execSync } = require('child_process');

const VERSION = '3.2.0';
let GIT_COMMIT = 'badda34f768186762f400ba553eef5e7dc46a5b8';
try {
  GIT_COMMIT = execSync('git rev-parse HEAD', { cwd: path.join(__dirname, '..') }).toString().trim();
} catch (_) {}

const BUILD_ID = `v${VERSION}-prod-${GIT_COMMIT.slice(0, 7)}`;
const SCHEMA_VERSION = '17';

const publicDir = path.join(__dirname, '..', 'public');

const assetFiles = [
  'index.html',
  'app.js',
  'barcode-decoder.js',
  'barcode-scanner.js',
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
  updated_at: '2026-08-27',
  changelog: `Valenixia POS v${VERSION} Real-Time Dynamic Analytics Engine, Top Products Revenue & Unit Velocity Leaderboards, Zero-Mock Empty States, Immutable Cloud Entitlements & PWA Performance Polish.`,
  changes: [
    'Fully dynamic Top Products by Units Sold (Velocity) and Revenue Leaderboard with paisa-safe revenue aggregation and catalog name resolution',
    'Replaced all static fallback and mock placeholders across Analytics with authentic dynamic zero-state messaging',
    'Enhanced multi-store branch performance telemetry matrix, Kamai business recommendations, and gold jewellery karat purity analytics',
    'Sanitized cloud database queries and hardened hardware-anchored device entitlement countdowns',
    'Optimized PWA installation lifecycle and eliminated console intervention warnings across desktop and mobile browsers'
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
