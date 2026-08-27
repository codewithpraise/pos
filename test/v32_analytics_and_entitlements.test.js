/**
 * Automated Verification: v3.2.0 Dynamic Analytics, Top Products & Entitlements
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Testing v3.2.0 Analytics & Zero-Mock Architecture ---');

// 1. Verify app.js Top Products & Zero-Mock Renderers
const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

assert(appJs.includes('renderTopProducts(txs)'), 'renderTopProducts function must exist');
assert(appJs.includes('No sales recorded in selected range') || appJs.includes('Items sold in the selected time range will rank here'), 'Dynamic empty state for Top Products must be present');
assert(!appJs.includes('<span style="font-size:10px;color:var(--text-gray);">Rs. 0 gross revenue</span>\n            </div>\n          `;\n        }).join'), 'Mock 0 revenue hardcode must be eliminated');

// 2. Verify Minor Units extraction logic
assert(appJs.includes('item.total_minor_units') && appJs.includes('item.unit_price_minor_units'), 'Minor units price fields must be checked');

// 3. Verify Version Bump & Manifests
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/manifest.json'), 'utf8'));
const versionJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/version.json'), 'utf8'));
const releaseManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/release-manifest.json'), 'utf8'));

assert.strictEqual(pkg.version, '3.2.0', 'package.json version must be 3.2.0');
assert.strictEqual(manifest.version, '3.2.0', 'manifest.json version must be 3.2.0');
assert.strictEqual(versionJson.version, '3.2.0', 'version.json version must be 3.2.0');
assert.strictEqual(releaseManifest.version, '3.2.0', 'release-manifest.json version must be 3.2.0');

// 4. Verify Serverless and Local Entitlements UUID support
const apiSub = fs.readFileSync(path.join(__dirname, '../api/subscription/status.js'), 'utf8');
assert(apiSub.includes('formattedUuid'), 'api/subscription/status.js must support formattedUuid');
assert(!apiSub.includes('/licenses'), 'Must not query non-existent /licenses table');
assert(!apiSub.includes('/subscriptions'), 'Must not query non-existent /subscriptions table');

// 5. Verify SRI generated in sw.js
const swJs = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
assert(swJs.includes('sha384-'), 'sw.js must contain SRI hashes');

console.log('✅ All v3.2.0 Analytics, Entitlements & Manifest tests PASSED!');
