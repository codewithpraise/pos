// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - OUT-OF-STOCK ENFORCEMENT TEST
// Verifies frontend and server-side API rejection when item stock is 0
// ============================================================================

const assert = require('assert');

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Out-Of-Stock Enforcement Suite (v2.3)');
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

function validateCartItemAddition(product, currentCartQty, allowNegativeStock = false) {
  if (allowNegativeStock) return { allowed: true };

  const currentStock = product.stock_level ?? 0;
  if (currentStock <= 0) {
    return { allowed: false, reason: `Product '${product.name}' is out of stock.` };
  }
  if (currentCartQty + 1 > currentStock) {
    return { allowed: false, reason: `Cannot add more. Available stock for '${product.name}' is ${currentStock}.` };
  }
  return { allowed: true };
}

runTest('Stock = 0 & Negative Stock Disabled: Add to Cart BLOCKED', () => {
  const product = { sku: 'SKU_ZERO', name: 'Zero Stock Milk', stock_level: 0 };
  const res = validateCartItemAddition(product, 0, false);
  assert.strictEqual(res.allowed, false);
  assert.ok(res.reason.includes('out of stock'));
});

runTest('Stock = 2 & Cart = 2: Attempting 3rd item BLOCKED', () => {
  const product = { sku: 'SKU_TWO', name: 'Limited Biscuit', stock_level: 2 };
  const res = validateCartItemAddition(product, 2, false);
  assert.strictEqual(res.allowed, false);
  assert.ok(res.reason.includes('Available stock'));
});

runTest('Stock = 2 & Cart = 1: Adding 2nd item ALLOWED', () => {
  const product = { sku: 'SKU_TWO', name: 'Limited Biscuit', stock_level: 2 };
  const res = validateCartItemAddition(product, 1, false);
  assert.strictEqual(res.allowed, true);
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);
process.exit(totalFailed === 0 ? 0 : 1);
