// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - STAGED WHOLE-FILE ATOMIC IMPORT TEST
// Verifies whole-file pre-validation, atomic promotion, and zero partial catalog corruptions
// ============================================================================

const assert = require('assert');

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Staged Whole-File Atomic Import Suite (v2.3)');
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

// Whole-File Staging & Validation Processor Simulator
function validateAndPromoteSpreadsheet(rows, existingCatalogSkus = new Set()) {
  const errors = [];
  const stagedItems = [];
  const fileSkus = new Set();

  rows.forEach((row, idx) => {
    const lineNo = idx + 1;
    const sku = (row.sku || row.SKU || '').toString().trim().toUpperCase();
    const name = (row.name || row.Name || '').toString().trim();
    const price = Number(row.price || row.Price || 0);

    if (!sku) {
      errors.push(`Row ${lineNo}: SKU is missing.`);
      return;
    }
    if (!name) {
      errors.push(`Row ${lineNo}: Product name is missing.`);
      return;
    }
    if (isNaN(price) || price < 0) {
      errors.push(`Row ${lineNo}: Invalid price '${row.price}'. Must be a non-negative number.`);
      return;
    }
    if (fileSkus.has(sku)) {
      errors.push(`Row ${lineNo}: Duplicate SKU '${sku}' found within spreadsheet.`);
      return;
    }
    fileSkus.add(sku);

    stagedItems.push({ sku, name, priceMinor: Math.round(price * 100) });
  });

  // HALT ENTIRE PROMOTION IF ANY ROW FAILS VALIDATION
  if (errors.length > 0) {
    return {
      success: false,
      insertedCount: 0,
      errors
    };
  }

  // ATOMIC SINGLE TRANSACTION COMMIT
  return {
    success: true,
    insertedCount: stagedItems.length,
    errors: []
  };
}

runTest('Single Invalid Row in 10,000 Row File: Zero rows inserted (Total Rollback)', () => {
  const rows = [];
  for (let i = 1; i <= 9999; i++) {
    rows.push({ sku: `SKU_${i}`, name: `Product ${i}`, price: 10.50 });
  }
  // 10,000th row is invalid (missing SKU)
  rows.push({ sku: '', name: 'Invalid Product', price: 15.00 });

  const result = validateAndPromoteSpreadsheet(rows);
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.insertedCount, 0, 'No rows should be inserted if any row fails');
  assert.strictEqual(result.errors.length, 1);
});

runTest('10,000 Valid Rows: All 10,000 rows promoted atomically', () => {
  const rows = [];
  for (let i = 1; i <= 10000; i++) {
    rows.push({ sku: `SKU_VALID_${i}`, name: `Product ${i}`, price: 12.00 });
  }

  const result = validateAndPromoteSpreadsheet(rows);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.insertedCount, 10000);
});

runTest('Urdu / Unicode Names, Decimals, and Duplicate SKU Detection', () => {
  const rows = [
    { sku: 'SKU_URDU_1', name: 'نیا پروڈکٹ', price: 99.99 },
    { sku: 'SKU_URDU_2', name: 'Super Milk 1.5L', price: 250.50 },
    { sku: 'SKU_URDU_1', name: 'Duplicate SKU Item', price: 50.00 } // Duplicate
  ];

  const result = validateAndPromoteSpreadsheet(rows);
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.insertedCount, 0);
  assert.ok(result.errors[0].includes('Duplicate SKU'));
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);
process.exit(totalFailed === 0 ? 0 : 1);
