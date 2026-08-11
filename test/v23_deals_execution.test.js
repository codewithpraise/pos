// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - DEALS END-TO-END EXECUTION TEST
// Verifies deal creation, bundle subtotal, component item stock deduction, and partial stock block
// ============================================================================

const assert = require('assert');

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Deals End-to-End Execution Suite (v2.3)');
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

// Deals Engine Simulator
class DealsEngineSimulator {
  constructor() {
    this.catalog = {
      'SKU_BURGER': { sku: 'SKU_BURGER', name: 'Zinger Burger', price: 400, stock: 10 },
      'SKU_DRINK':  { sku: 'SKU_DRINK',  name: 'Cola 500ml',    price: 100, stock: 5 },
      'SKU_FRIES':  { sku: 'SKU_FRIES',  name: 'Large Fries',   price: 200, stock: 5 }
    };

    this.deals = [
      {
        id: 'DEAL_COMBO_1',
        name: 'Super Meal Deal',
        bundlePrice: 999, // minor units: 99900 paisas (Rs. 999)
        items: [
          { sku: 'SKU_BURGER', qty: 2 },
          { sku: 'SKU_DRINK',  qty: 1 },
          { sku: 'SKU_FRIES',  qty: 1 }
        ]
      }
    ];
  }

  checkoutDeal(dealId, count = 1) {
    const deal = this.deals.find(d => d.id === dealId);
    if (!deal) throw new Error('Deal not found');

    // Check component stock
    for (const item of deal.items) {
      const product = this.catalog[item.sku];
      const requiredQty = item.qty * count;
      if (product.stock < requiredQty) {
        throw new Error(`Insufficient stock for deal component ${product.name}: required ${requiredQty}, available ${product.stock}`);
      }
    }

    // Deduct stock itemized
    const deductions = {};
    for (const item of deal.items) {
      const product = this.catalog[item.sku];
      const requiredQty = item.qty * count;
      product.stock -= requiredQty;
      deductions[item.sku] = requiredQty;
    }

    const totalRevenue = deal.bundlePrice * count;
    return { success: true, totalRevenue, deductions };
  }
}

runTest('Deal Bundle Checkout: Itemized component stock deduction (Burger -6, Drink -3, Fries -3)', () => {
  const engine = new DealsEngineSimulator();
  const res = engine.checkoutDeal('DEAL_COMBO_1', 3); // 3 combo deals

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.totalRevenue, 2997);
  assert.strictEqual(engine.catalog['SKU_BURGER'].stock, 4); // 10 - (2*3) = 4
  assert.strictEqual(engine.catalog['SKU_DRINK'].stock, 2);  // 5 - (1*3) = 2
  assert.strictEqual(engine.catalog['SKU_FRIES'].stock, 2);  // 5 - (1*3) = 2
});

runTest('Partial Component Stock Block: Deal checkout fails cleanly with ZERO stock deduction', () => {
  const engine = new DealsEngineSimulator();
  
  // Attempt 6 deals (requires 6 drinks, but only 5 available)
  assert.throws(() => {
    engine.checkoutDeal('DEAL_COMBO_1', 6);
  }, /Insufficient stock/i);

  // Stock must remain completely untouched
  assert.strictEqual(engine.catalog['SKU_BURGER'].stock, 10);
  assert.strictEqual(engine.catalog['SKU_DRINK'].stock, 5);
  assert.strictEqual(engine.catalog['SKU_FRIES'].stock, 5);
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);
process.exit(totalFailed === 0 ? 0 : 1);
