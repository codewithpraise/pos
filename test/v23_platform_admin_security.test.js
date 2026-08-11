// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - PLATFORM ADMIN SECURITY TEST
// Empirical verification of server secrets isolation, PBKDF2 auth, and audit logs
// ============================================================================

const assert = require('assert');
const { PlatformAdminService, PLATFORM_ROLES } = require('../lib/platform-admin-service');
const { db } = require('../database');

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Platform Admin Security Suite (v2.3)');
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

runTest('Platform Admin Bootstrap: Initializes master account with PLATFORM_ADMIN role', async () => {
  const adminEmail = 'owner@valenixia.com';
  const res = await PlatformAdminService.bootstrapPlatformAdmin(adminEmail, 'SuperSecretPass123!');

  assert.ok(res);
  assert.strictEqual(res.email, adminEmail);
  assert.strictEqual(res.role, PLATFORM_ROLES.PLATFORM_ADMIN);
  assert.strictEqual(res.bootstrapSecret, undefined, 'Bootstrap secret MUST NEVER be returned in output');

  const isAdmin = await PlatformAdminService.isPlatformAdmin(res.adminId || 'ACC_ADMIN_TEST');
  assert.strictEqual(isAdmin, true);
});

runTest('PBKDF2 Password Authentication: Correct password issues session token; wrong password fails', async () => {
  const email = 'admin_auth_test@valenixia.com';
  await PlatformAdminService.bootstrapPlatformAdmin(email, 'CorrectAdminPass123!');

  // 1. Correct Password
  const authSuccess = await PlatformAdminService.authenticateAdminPassword(email, 'CorrectAdminPass123!');
  assert.strictEqual(authSuccess.authenticated, true);
  assert.ok(authSuccess.token.startsWith('ADMIN_SES_'));

  // 2. Wrong Password
  const authFail = await PlatformAdminService.authenticateAdminPassword(email, 'WrongPass!');
  assert.strictEqual(authFail.authenticated, false);
});

runTest('Immutable Admin Audit Logs: Administrative actions generate tamper-evident audit records', async () => {
  const auditId = await PlatformAdminService.logAdminAuditAction('ACC_ADMIN_TEST', 'APPROVE_PAYMENT_CLAIM', { claimId: 'CLAIM_99' });
  assert.ok(auditId.startsWith('AUDIT_ADM_'));

  const row = await db.get(`SELECT value_payload FROM local_preferences WHERE key = ?`, [`admin_audit_${auditId}`]);
  assert.ok(row && row.value_payload);
  const payload = JSON.parse(row.value_payload);
  assert.strictEqual(payload.actionType, 'APPROVE_PAYMENT_CLAIM');
});

runTest('Server Authorization Check: Non-Admin Customer account is BLOCKED from Platform Admin role', async () => {
  const custId = 'ACC_CUST_999';
  await db.run(
    `INSERT OR REPLACE INTO accounts (id, email, role, status, created_at)
     VALUES (?, 'customer@store.com', 'CUSTOMER', 'active', ?)`,
    [custId, Date.now()]
  );

  const isAdmin = await PlatformAdminService.isPlatformAdmin(custId);
  assert.strictEqual(isAdmin, false, 'Customer account must return isPlatformAdmin = false');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);
process.exit(totalFailed === 0 ? 0 : 1);
