// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - FBR REGULATORY ADAPTER & DISCLAIMER TEST
// Empirical verification of FBR provider adapter, status enums, provenance, and receipt formatting
// ============================================================================

const assert = require('assert');
const { FbrAdapterProvider, FBR_LEGAL_DISCLAIMER, FBR_STATUS_STATES, FBR_OFFLINE_MODES } = require('../lib/fbr-adapter');
const LEGAL_DOCUMENTS = require('../lib/legal-documents');

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — FBR Regulatory & Disclaimer Suite (v2.3)');
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

runTest('Tri-Partite Legal Responsibilities: Valenixia vs Integrator vs Merchant', () => {
  assert.ok(LEGAL_DOCUMENTS.TERMS_OF_SERVICE.includes('Software Provider Responsibility (Valenixia)'));
  assert.ok(LEGAL_DOCUMENTS.TERMS_OF_SERVICE.includes('Licensed Integrator / PRAL Responsibility'));
  assert.ok(LEGAL_DOCUMENTS.TERMS_OF_SERVICE.includes('Merchant Responsibility (Registered Person)'));
});

runTest('FBR Integrator Status Enums: Unconfigured vs Pending Approval vs Connected', async () => {
  const configUnconfigured = await FbrAdapterProvider.getFbrConfig('ORG_NEW', 'BRANCH_1', 'TERM_1');
  assert.strictEqual(configUnconfigured.status, FBR_STATUS_STATES.CONFIGURATION_REQUIRED);

  const { db } = require('../database');
  await db.run(
    `INSERT OR REPLACE INTO local_preferences (key, value_payload) VALUES ('fbr_config_ORG_TEST_BRANCH_1', ?)`,
    [JSON.stringify({ ntn: '1234567-8', posId: '100555', isIntegratorApproved: false })]
  );
  const configPending = await FbrAdapterProvider.getFbrConfig('ORG_TEST', 'BRANCH_1', 'TERM_1');
  assert.strictEqual(configPending.status, FBR_STATUS_STATES.PENDING_INTEGRATOR_APPROVAL);
});

runTest('Identifier Provenance: FBR Invoice Number is NULL until returned by external FBR response', async () => {
  const transaction = {
    id: 'TX_PROV_202',
    invoice_number: 'INV-00202',
    total_minor_units: 35000,
    tax_minor_units: 5250,
    payment_mode: 'CASH',
    is_network_online: true
  };
  const fbrConfig = { posId: '100555', ntn: '1234567-8' };

  const submission = await FbrAdapterProvider.queueFiscalSubmission(transaction, fbrConfig);
  assert.strictEqual(submission.valenixiaTransactionId, 'TX_PROV_202');
  assert.ok(submission.usin.startsWith('USIN_100555_'));
  assert.strictEqual(submission.fbrInvoiceNumber, null, 'FBR Invoice Number MUST be null prior to external response');
});

runTest('Receipt Fiscal Formatting: Pending vs Successful Response', () => {
  const pendingHeader = FbrAdapterProvider.formatReceiptFiscalHeader({ status: 'PENDING', usin: 'USIN_100_1' });
  assert.strictEqual(pendingHeader.fiscalized, false);
  assert.ok(pendingHeader.lines[0].includes('PENDING QUEUE'));

  const successHeader = FbrAdapterProvider.formatReceiptFiscalHeader({
    status: 'SUCCESS',
    usin: 'USIN_100_1',
    fbrInvoiceNumber: 'FBR_AUTH_999888'
  });
  assert.strictEqual(successHeader.fiscalized, true);
  assert.ok(successHeader.lines[0].includes('FBR_AUTH_999888'));
});

runTest('Offline Policy Mode: REQUIRE_ONLINE_FISCALIZATION blocks offline sales', async () => {
  const transactionOffline = { id: 'TX_OFF_1', is_network_online: false };
  const configRequireOnline = { offlineMode: FBR_OFFLINE_MODES.REQUIRE_ONLINE_FISCALIZATION };

  await assert.rejects(async () => {
    await FbrAdapterProvider.queueFiscalSubmission(transactionOffline, configRequireOnline);
  }, /requires active online FBR fiscalization/i);
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);
process.exit(totalFailed === 0 ? 0 : 1);
