const fs = require('fs');
const path = require('path');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

const dom = new JSDOM(html, {
  url: 'http://localhost:3000',
  runScripts: 'dangerously',
  resources: 'usable'
});

const { window } = dom;

console.log('Testing DOM structure and Window bindings...');

// Load scripts manually into JSDOM context
const bootstrapScript = fs.readFileSync(path.join(__dirname, '../public/bootstrap-init.js'), 'utf8');
const dealsScript = fs.readFileSync(path.join(__dirname, '../public/modules/deals-engine.js'), 'utf8');
const appScript = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

try {
  window.eval(bootstrapScript);
  console.log('✅ bootstrap-init.js evaluated.');
} catch (e) {
  console.error('❌ Error evaluating bootstrap-init.js:', e);
}

try {
  window.eval(dealsScript);
  console.log('✅ deals-engine.js evaluated.');
} catch (e) {
  console.error('❌ Error evaluating deals-engine.js:', e);
}

try {
  window.eval(appScript);
  console.log('✅ app.js evaluated.');
} catch (e) {
  console.error('❌ Error evaluating app.js:', e);
}

// Run boot diagnostics checklist
const criticalFns = [
  'switchActiveScreen', 'toggleAppTheme', 'toggleAppLanguage',
  'handlePinDigit', 'handlePinClear', 'handlePinEnter',
  'showNotificationToast', 'performLogout',
  'renderCustomersScreen', 'renderStaffScreen', 'renderSuppliersScreen',
  'renderCreditBookScreen', 'calculateAnalytics', 'renderSyncLogsFeed',
  'saveSettings', 'flushFbrQueue', 'copyDiagnosticLogs',
  'clearSyncLogsFeed', 'forceSyncReconnect', 'runDatabaseVacuum',
  'exportTransactionsCsv', 'exportCatalogCsv', 'openBarcodeGenerator',
  'triggerCsvImport', 'openSplitPaymentModal', 'applyManualDiscount',
  'setAnalyticsRange', 'exportAnalyticsCsv', 'openCreditEntryModal'
];

let missingFns = [];
criticalFns.forEach(fn => {
  if (typeof window[fn] !== 'function') {
    missingFns.push(fn);
  }
});

console.log('\n--- DIAGNOSTIC RESULTS ---');
console.log('Total critical functions checked:', criticalFns.length);
console.log('Missing functions count:', missingFns.length);

if (missingFns.length > 0) {
  console.error('❌ Missing window functions:', missingFns);
} else {
  console.log('✨ PERFECT! All 29 critical window functions exist on window!');
}

const expectedScreens = [
  'view-checkout', 'view-catalog-manager', 'view-history',
  'view-analytics', 'view-customers', 'view-staff', 'view-suppliers',
  'view-credit-book', 'view-settings', 'view-logs', 'view-deals',
  'view-fbr-fiscal', 'view-subscription'
];

let missingScreens = [];
expectedScreens.forEach(id => {
  if (!window.document.getElementById(id)) {
    missingScreens.push(id);
  }
});

console.log('\nExpected content-view screens checked:', expectedScreens.length);
console.log('Missing screens count:', missingScreens.length);

if (missingScreens.length > 0) {
  console.error('❌ Missing screens in DOM:', missingScreens);
} else {
  console.log('✨ PERFECT! All 13 screens exist in DOM!');
}
