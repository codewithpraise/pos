// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - ADDON MARKETPLACE & MONETIZATION TEST
// Empirical verification of addon catalog, request lifecycle, deterministic math, and PKR pricing
// ============================================================================

const assert = require('assert');
const { ADDON_CATALOG, AddonService } = require('../lib/addon-service');
const { AddonRequestService, ADDON_REQUEST_STATUSES } = require('../lib/addon-request-service');
const InventoryIntelligenceEngine = require('../lib/inventory-intelligence');
const NotificationRuleEngine = require('../lib/notification-rules');

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Addon Marketplace & Monetization Suite (v2.3)');
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

runTest('FBR Exclusivity: FBR Digital Invoicing exists as optional paid addon (Rs. 2,499 one-time)', () => {
  const fbrAddon = AddonService.getAddonById('addon_fbr_digital_invoicing');
  assert.ok(fbrAddon, 'FBR add-on must exist in master catalog');
  assert.strictEqual(fbrAddon.priceMinor, 249900, 'Price must be Rs. 2,499 (249900 minor units)');
  assert.strictEqual(fbrAddon.billingInterval, 'ONE_TIME');
  assert.strictEqual(fbrAddon.status, 'AVAILABLE_NOW');
});

runTest('Addon Catalog Launcher Status: 3 Available Now, Remainder Coming Soon', () => {
  const catalog = AddonService.getCatalog('ALL');
  const availableNow = catalog.filter(a => a.status === 'AVAILABLE_NOW');
  const comingSoon = catalog.filter(a => a.status === 'COMING_SOON');

  assert.strictEqual(availableNow.length, 3, 'Must have exactly 3 initial AVAILABLE_NOW add-ons');
  assert.ok(availableNow.some(a => a.id === 'addon_fbr_digital_invoicing'));
  assert.ok(availableNow.some(a => a.id === 'addon_smart_stock_alerts'));
  assert.ok(availableNow.some(a => a.id === 'addon_cloud_backup'));

  assert.ok(comingSoon.length >= 6, 'Remaining advanced add-ons must be marked COMING_SOON');
});

runTest('Addon Request Lifecycle: REQUESTED -> APPROVED -> ACTIVE', async () => {
  const accId = 'ACC_MARKET_01';
  const orgId = 'ORG_MARKET_01';

  // 1. Submit Request
  const req = await AddonRequestService.createRequest(accId, orgId, 'addon_smart_stock_alerts');
  assert.strictEqual(req.status, ADDON_REQUEST_STATUSES.REQUESTED);

  // 2. Admin Approve & Activate
  const updated = await AddonRequestService.updateRequestStatus(req.requestId, ADDON_REQUEST_STATUSES.ACTIVE);
  assert.strictEqual(updated.status, ADDON_REQUEST_STATUSES.ACTIVE);

  // 3. Verify Active Status
  const isActive = await AddonService.isAddonActive(orgId, 'addon_smart_stock_alerts');
  assert.strictEqual(isActive, true);
});

runTest('Deterministic Smart Stock Math: Average Daily Sales, Days Remaining & Reorder Point', () => {
  const product = {
    sku: 'SKU_COLA',
    name: 'Coca Cola 1.5L',
    stock_level: 14,
    supplier_lead_time_days: 2,
    safety_stock_units: 4,
    preferred_order_qty: 30
  };

  // 150 sold over 30 days = 5 units/day
  const metrics = InventoryIntelligenceEngine.calculateProductMetrics(product, 150, 30);
  assert.strictEqual(metrics.averageDailySales, 5);
  assert.strictEqual(metrics.estimatedDaysRemaining, 2.8); // 14 / 5 = 2.8 days
  assert.strictEqual(metrics.reorderPoint, 14); // (5 * 2) + 4 = 14
  assert.strictEqual(metrics.alertSeverity, 'HIGH');
  assert.strictEqual(metrics.alertStatus, 'REORDER_RECOMMENDED');
});

runTest('Deterministic Notification Engine: Deduplication & Cooldown', () => {
  const notifEngine = new NotificationRuleEngine();

  const audit = {
    actionableAlerts: [
      {
        sku: 'SKU_MILK',
        name: 'Super Milk 1L',
        alertSeverity: 'CRITICAL',
        suggestedReorderQty: 50
      }
    ]
  };

  const firstPass = notifEngine.evaluateInventoryAlerts(audit);
  assert.strictEqual(firstPass.length, 1);
  assert.strictEqual(firstPass[0].severity, 'CRITICAL');
  assert.ok(firstPass[0].what.includes('0 units remaining'));
  assert.strictEqual(firstPass[0].actionLabel, 'Create Purchase Order');

  // Immediate second pass (within cooldown) must produce 0 duplicate notifications
  const secondPass = notifEngine.evaluateInventoryAlerts(audit);
  assert.strictEqual(secondPass.length, 0, 'Notification must be suppressed by cooldown');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);
process.exit(totalFailed === 0 ? 0 : 1);
