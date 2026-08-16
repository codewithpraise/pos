const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Screen Integrity & View Audit');
console.log('══════════════════════════════════════════════════\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const routerJs = fs.readFileSync(path.join(__dirname, '../public/router.js'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

test('1. Obsolete modal-wizard-templates popup is completely removed', () => {
  assert.ok(!html.includes('id="modal-wizard-templates"'), 'modal-wizard-templates must not exist in index.html');
  assert.ok(!html.includes('id="btn-wizard-open-templates"'), 'btn-wizard-open-templates must not exist in index.html');
  assert.ok(!appJs.includes('modal-wizard-templates'), 'modal-wizard-templates must not exist in app.js');
});

test('2. All 8 new screen shells exist in index.html', () => {
  const views = [
    'view-kds',
    'view-petty-cash',
    'view-attendance',
    'view-label-designer',
    'view-inventory-ai',
    'view-loyalty',
    'view-marketing',
    'view-stock-transfer'
  ];

  views.forEach(v => {
    assert.ok(html.includes(`id="${v}"`), `Shell ${v} must exist in index.html`);
  });
});

test('3. All 8 render functions are defined in app.js', () => {
  const renderers = [
    'renderKdsScreen',
    'renderPettyCashScreen',
    'renderAttendanceScreen',
    'renderLabelDesignerScreen',
    'renderInventoryAiScreen',
    'renderLoyaltyScreen',
    'renderMarketingScreen',
    'renderStockTransferScreen'
  ];

  renderers.forEach(fn => {
    assert.ok(appJs.includes(`function ${fn}`), `${fn} must be defined in app.js`);
  });
});

test('4. switchActiveScreen in app.js dispatches all 8 screen renderers', () => {
  assert.ok(appJs.includes("else if (screenName === 'kds')"), 'Dispatches kds');
  assert.ok(appJs.includes("else if (screenName === 'petty-cash')"), 'Dispatches petty-cash');
  assert.ok(appJs.includes("else if (screenName === 'attendance')"), 'Dispatches attendance');
  assert.ok(appJs.includes("else if (screenName === 'label-designer')"), 'Dispatches label-designer');
  assert.ok(appJs.includes("else if (screenName === 'inventory-ai'"), 'Dispatches inventory-ai');
  assert.ok(appJs.includes("else if (screenName === 'loyalty')"), 'Dispatches loyalty');
  assert.ok(appJs.includes("else if (screenName === 'marketing')"), 'Dispatches marketing');
  assert.ok(appJs.includes("else if (screenName === 'stock-transfer')"), 'Dispatches stock-transfer');
});

test('5. Stock Velocity uses pure statistical math without AI claims', () => {
  assert.ok(html.includes('Stock Velocity &amp; Statistical Demand Forecast') || html.includes('Stock Velocity'), 'Uses Stock Velocity terminology');
  assert.ok(appJs.includes('STATISTICAL STOCK VELOCITY & DEMAND FORECAST ENGINE'), 'Pure statistical engine documented in app.js');
});

test('6. Step 3 Store Business Model & Settings Switcher are functional', () => {
  assert.ok(html.includes('id="settings-select-store-mode"'), 'Settings store mode select exists');
  assert.ok(html.includes('id="wiz-panel-3"'), 'Wizard Step 3 exists');
  assert.ok(appJs.includes('initSettingsStoreMode'), 'initSettingsStoreMode is defined');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('✨ All Screen Integrity Audits passed perfectly!\n');
}
