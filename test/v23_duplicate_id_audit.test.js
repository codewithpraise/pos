// ============================================================================
// VALENIXIA COMMERCE POS — Permanent Mounted Shells Duplicate ID Audit
// Scans index.html to guarantee zero duplicate element IDs exist across all
// permanently mounted screen containers.
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function runDuplicateIdAudit() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  VALENIXIA POS — Duplicate DOM ID Audit');
  console.log('══════════════════════════════════════════════════\n');

  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const dom = new JSDOM(html);
  const { document } = dom.window;

  const allElementsWithId = Array.from(document.querySelectorAll('[id]'));
  const idCounts = new Map();
  const duplicateIds = [];

  allElementsWithId.forEach(el => {
    const id = el.id.trim();
    if (!id) return;
    const current = idCounts.get(id) || 0;
    idCounts.set(id, current + 1);
    if (current === 1) {
      duplicateIds.push(id);
    }
  });

  console.log(`▶ Audited ${allElementsWithId.length} total elements with IDs across index.html.`);

  if (duplicateIds.length > 0) {
    console.error(`  ❌ FAIL: Found ${duplicateIds.length} duplicate ID(s) in DOM:`, duplicateIds);
    duplicateIds.forEach(dupId => {
      console.error(`     - Duplicate ID: #${dupId} (Count: ${idCounts.get(dupId)})`);
    });
    process.exit(1);
  }

  console.log('  ✅ PASSED: Zero duplicate DOM IDs found across permanently mounted screen shells!');
  console.log('\n──────────────────────────────────────────────────');
  console.log('Results: 1 passed, 0 failed\n');
  process.exit(0);
}

runDuplicateIdAudit();
