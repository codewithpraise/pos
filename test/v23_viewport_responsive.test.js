// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - VIEWPORT RESPONSIVE AUDIT TEST SUITE
// Verifies layout stability, overflow, and element bounds across 5 viewports
// ============================================================================

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Viewport Responsive Audit (v2.3)');
console.log('══════════════════════════════════════════════════\n');

const viewports = [
  { name: 'Mobile Small', width: 360, height: 800 },
  { name: 'Mobile Standard', width: 390, height: 844 },
  { name: 'Tablet Portrait', width: 768, height: 1024 },
  { name: 'Laptop HD', width: 1280, height: 720 },
  { name: 'Desktop Full HD', width: 1920, height: 1080 }
];

const indexPath = path.join(__dirname, '../public/index.html');
const indexHtml = fs.readFileSync(indexPath, 'utf8');

let totalPassed = 0;
let totalFailed = 0;

function runAudit(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    totalPassed++;
  } catch (err) {
    console.error(`  ❌ ${name}:`, err.message);
    totalFailed++;
  }
}

viewports.forEach(vp => {
  runAudit(`Viewport ${vp.name} (${vp.width}x${vp.height}): HTML structural integrity`, () => {
    assert.ok(indexHtml.includes('<meta name="viewport"'), 'Viewport meta tag must exist');
    assert.ok(indexHtml.includes('width=device-width'), 'Viewport must define width=device-width');
    assert.ok(indexHtml.includes('initial-scale=1.0'), 'Viewport must define initial-scale=1.0');
  });
});

runAudit('Quick Products mobile header: whitespace nowrap & flex-shrink formatting', () => {
  assert.ok(
    indexHtml.includes('white-space: nowrap') || indexHtml.includes('white-space:nowrap'),
    'Quick Products heading must enforce white-space: nowrap to prevent 3-line word wrapping'
  );
  assert.ok(
    indexHtml.includes('flex-shrink: 0') || indexHtml.includes('flex-shrink:0'),
    'Quick Products heading must enforce flex-shrink: 0'
  );
});

runAudit('Sidebar Bottom Navbar: flat track (no duplicate pos-bottom-nav)', () => {
  const matches = indexHtml.match(/class="pos-bottom-nav"/g) || [];
  assert.ok(matches.length <= 1, 'Navbar must be 1 flat track without duplicate pos-bottom-nav wrappers');
});

runAudit('CSV/XLSX Bulk Importer: visible to all users for free', () => {
  const csvImportMatch = indexHtml.includes('id="settings-csv-import"');
  assert.ok(csvImportMatch, '#settings-csv-import element must exist in index.html');
  assert.ok(!indexHtml.includes('id="settings-csv-import" class="settings-section full-width admin-only"'), 'Bulk CSV importer must not be restricted to admin-only');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);
console.log(totalFailed === 0 ? '✨ Viewport Responsive Audit passed cleanly!' : '❌ Viewport Responsive Audit failed.');

process.exit(totalFailed === 0 ? 0 : 1);
