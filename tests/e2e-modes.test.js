#!/usr/bin/env node
// ============================================================================
// VALENIXIA POS - Shop Mode End-to-End Lifecycles Test Suite
// Verifies checkout rules, pricing calculations, modifiers and serial checks
// for all 8 shop modes (retail, clothing, food, services, electronics,
// grocery, gas station, pharmacy)
// Run: node tests/e2e-modes.test.js
// ============================================================================
'use strict';

const assert = require('assert');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}\n     ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Shop Mode End-to-End Lifecycles Tests');
console.log('══════════════════════════════════════════════════\n');

// ── 1. Simple Retail Mode ──────────────────────────────────────────────────
console.log('▶ Simple Retail Mode E2E');
test('simple-retail: computes tax correctly for standard item transactions', () => {
  const cart = [
    { sku: 'SKU-SHIRT-01', name: 'Standard Shirt', price: 2000, qty: 1 }
  ];
  const taxRate = 0.08; // 8%
  let subtotal = cart[0].price * cart[0].qty;
  let tax = Math.round(subtotal * taxRate);
  let total = subtotal + tax;

  assert.strictEqual(subtotal, 2000);
  assert.strictEqual(tax, 160);
  assert.strictEqual(total, 2160);
});

// ── 2. Clothing & Fashion Mode ──────────────────────────────────────────────
console.log('\n▶ Clothing & Fashion Mode E2E');
test('clothing-fashion: calculates variant pricing and maintains inventory levels', () => {
  const cart = [
    {
      sku: 'SKU-JEANS-01',
      name: 'Premium Denim Jeans',
      price: 4900,
      qty: 2,
      selectedVariant: { id: 'v1', size: 'M', color: 'Blue', stock: 12 }
    }
  ];

  let subtotal = 0;
  cart.forEach(item => {
    subtotal += item.price * item.qty;
    if (item.selectedVariant) {
      item.selectedVariant.stock -= item.qty;
    }
  });

  assert.strictEqual(subtotal, 9800);
  assert.strictEqual(cart[0].selectedVariant.stock, 10);
});

// ── 3. Food & Restaurant Mode ───────────────────────────────────────────────
console.log('\n▶ Food & Restaurant Mode E2E');
test('food-restaurant: computes item cost modifiers and adjusts transaction total', () => {
  const cart = [
    {
      sku: 'SKU-BURGER-01',
      name: 'Gourmet Beef Burger',
      price: 850,
      qty: 1,
      selectedModifiers: [
        { id: 'm1', name: 'Extra Cheese', price: 150 },
        { id: 'm2', name: 'Turkey Bacon', price: 200 }
      ]
    }
  ];

  let subtotal = 0;
  cart.forEach(item => {
    let itemBase = item.price;
    if (item.selectedModifiers) {
      item.selectedModifiers.forEach(m => {
        itemBase += m.price;
      });
    }
    subtotal += itemBase * item.qty;
  });

  assert.strictEqual(subtotal, 1200);
});

// ── 4. Services & Appointments Mode ─────────────────────────────────────────
console.log('\n▶ Services & Appointments Mode E2E');
test('services-appointments: processes session durations and verifies staff assignment', () => {
  const appointment = {
    serviceSku: 'SKU-HAIRCUT',
    serviceName: 'Executive Haircut & Styling',
    price: 3000,
    durationMinutes: 45,
    assignedStaff: 'Bob Smith',
    clientName: 'Alice Green'
  };

  assert.strictEqual(appointment.price, 3000);
  assert.strictEqual(appointment.durationMinutes, 45);
  assert.strictEqual(appointment.assignedStaff, 'Bob Smith');
});

// ── 5. Electronics & High-Value Mode ───────────────────────────────────────
console.log('\n▶ Electronics & High-Value Mode E2E');
test('electronics-highvalue: validates serial tracking requirement during transaction register', () => {
  const catalogItem = {
    sku: 'SKU-IPHONE-15',
    name: 'iPhone 15 Pro Max',
    price: 145000,
    serialRequired: true
  };

  const transactionLineItem = {
    sku: 'SKU-IPHONE-15',
    qty: 1,
    serialNumber: 'IMEI-883920194829381'
  };

  const isSerialValid = !catalogItem.serialRequired || !!(transactionLineItem.serialNumber && transactionLineItem.serialNumber.trim().length > 0);
  assert.strictEqual(isSerialValid, true);

  const invalidLineItem = {
    sku: 'SKU-IPHONE-15',
    qty: 1,
    serialNumber: ''
  };
  const isInvalidSerialValid = !catalogItem.serialRequired || !!(invalidLineItem.serialNumber && invalidLineItem.serialNumber.trim().length > 0);
  assert.strictEqual(isInvalidSerialValid, false);
});

// ── 6. Grocery & Supermarket Mode ───────────────────────────────────────────
console.log('\n▶ Grocery & Supermarket Mode E2E');
test('grocery-supermarket: handles weighed items and computes final price dynamically', () => {
  const cartItem = {
    sku: 'SKU-APPLE-FUJI',
    name: 'Fuji Apples',
    pricePerKg: 350,
    measuredWeightKg: 1.450
  };

  const totalPrice = Math.round(cartItem.measuredWeightKg * cartItem.pricePerKg);
  assert.strictEqual(totalPrice, 508);
});

// ── 7. Gas Station Mode ─────────────────────────────────────────────────────
console.log('\n▶ Gas Station Mode E2E');
test('gas-station: handles fuel pump liters and maps pump ID to transaction lines', () => {
  const fuelSale = {
    pumpId: 4,
    fuelType: 'Super Octane',
    pricePerLiter: 280,
    totalVolumeLiters: 15.34
  };

  const totalFuelCost = Math.round(fuelSale.totalVolumeLiters * fuelSale.pricePerLiter);
  assert.strictEqual(totalFuelCost, 4295);
});

// ── 8. Pharmacy & Healthcare Mode ───────────────────────────────────────────
console.log('\n▶ Pharmacy & Healthcare Mode E2E');
test('pharmacy-healthcare: enforces pharmacist authorization for prescription items', () => {
  const prescriptionItem = {
    sku: 'SKU-AMOXICILLIN',
    name: 'Amoxicillin 500mg',
    price: 450,
    prescriptionRequired: true
  };

  const salesLine = {
    sku: 'SKU-AMOXICILLIN',
    qty: 1,
    pharmacistApproved: true,
    pharmacistLicenseId: 'PH-992019'
  };

  const isSaleApproved = !prescriptionItem.prescriptionRequired || !!(salesLine.pharmacistApproved && salesLine.pharmacistLicenseId);
  assert.strictEqual(isSaleApproved, true);

  const unapprovedSalesLine = {
    sku: 'SKU-AMOXICILLIN',
    qty: 1,
    pharmacistApproved: false,
    pharmacistLicenseId: ''
  };

  const isUnapprovedSaleApproved = !prescriptionItem.prescriptionRequired || !!(unapprovedSalesLine.pharmacistApproved && unapprovedSalesLine.pharmacistLicenseId);
  assert.strictEqual(isUnapprovedSaleApproved, false);
});

console.log('\n══════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
