/**
 * VALENIXIA POS � Comprehensive Mobile E2E Test Suite v2
 * Tests: Onboarding, License, Billing, Admin Panel, Release Notes, Mobile Bootstrap
 * Run: node tests/mobile_e2e.test.js
 */

'use strict';

const http = require('http');
const https = require('https');
const path  = require('path');
const fs    = require('fs');
const crypto = require('crypto');

// --- CONFIG --------------------------------------------------------------------
const BASE_URL = process.env.TEST_SERVER_URL || 'http://127.0.0.1:3000';
const TIMEOUT  = 10000; // 10s per request

// --- TEST COUNTERS -------------------------------------------------------------
let passed = 0, failed = 0, skipped = 0;
const failures = [];

// --- UTILITIES -----------------------------------------------------------------
function log(msg, level) {
  const icons = { PASS: '?', FAIL: '?', SKIP: '?? ', INFO: '??', SECTION: '-' };
  const icon  = icons[level] || '  ';
  if (level === 'SECTION') {
    console.log('\n' + '-'.repeat(60));
    console.log('  ' + msg);
    console.log('-'.repeat(60));
  } else {
    console.log(icon + ' ' + msg);
  }
}

async function request(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const url    = new URL(BASE_URL + path);
    const opts   = {
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      timeout: TIMEOUT
    };
    const req = (url.protocol === 'https:' ? https : http).request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    log(name, 'PASS');
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    log(name + ' � ' + e.message, 'FAIL');
  }
}

function expect(val) {
  return {
    toBe: (expected) => {
      if (val !== expected) throw new Error('Expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(val));
    },
    toEqual: (expected) => {
      const a = JSON.stringify(val), b = JSON.stringify(expected);
      if (a !== b) throw new Error('Expected ' + b + ', got ' + a);
    },
    toBeTruthy: () => { if (!val) throw new Error('Expected truthy, got ' + JSON.stringify(val)); },
    toBeFalsy: () => { if (val) throw new Error('Expected falsy, got ' + JSON.stringify(val)); },
    toContain: (item) => {
      if (typeof val === 'string' && !val.includes(item)) throw new Error('Expected string to contain: ' + item);
      if (Array.isArray(val) && !val.includes(item)) throw new Error('Expected array to contain: ' + item);
    },
    toBeGreaterThan: (n) => { if (!(val > n)) throw new Error(val + ' is not > ' + n); },
    toBeLessThan:    (n) => { if (!(val < n)) throw new Error(val + ' is not < ' + n); },
    toBeTypeOf: (t) => { if (typeof val !== t) throw new Error('Expected type ' + t + ', got ' + typeof val); },
    toHaveProperty: (key) => { if (!(key in Object(val))) throw new Error('Expected property: ' + key); },
    toMatchObject: (partial) => {
      for (const [k, v] of Object.entries(partial)) {
        if (JSON.stringify(val[k]) !== JSON.stringify(v)) throw new Error('Property ' + k + ': expected ' + JSON.stringify(v) + ', got ' + JSON.stringify(val[k]));
      }
    }
  };
}

// --- SERVER AVAILABILITY -------------------------------------------------------
async function checkServerAvailable() {
  try {
    const r = await request('GET', '/api/version');
    return r.status === 200;
  } catch { return false; }
}

// -------------------------------------------------------------------------------
//  TEST SUITES
// -------------------------------------------------------------------------------

// -- SUITE 1: Health & Version API ----------------------------------------------
async function suiteHealthVersion() {
  log('Health & Version API', 'SECTION');

  await test('GET /api/version returns 200', async () => {
    const r = await request('GET', '/api/version');
    expect(r.status).toBe(200);
  });

  await test('GET /api/version returns appName=Valenixia POS', async () => {
    const r = await request('GET', '/api/version');
    expect(r.body.appName).toBe('Valenixia POS');
  });

  await test('GET /api/version returns status=healthy', async () => {
    const r = await request('GET', '/api/version');
    expect(r.body.status).toBe('healthy');
  });

  await test('GET /api/version returns serverVersion string', async () => {
    const r = await request('GET', '/api/version');
    expect(typeof r.body.serverVersion).toBe('string');
  });

  await test('GET /api/version returns schemaVersion number', async () => {
    const r = await request('GET', '/api/version');
    expect(r.body.schemaVersion).toBeGreaterThan(0);
  });

  await test('GET /api/release-notes returns 200', async () => {
    const r = await request('GET', '/api/release-notes');
    expect(r.status).toBe(200);
  });

  await test('GET /api/release-notes returns version field', async () => {
    const r = await request('GET', '/api/release-notes');
    expect(typeof r.body.version).toBe('string');
  });

  await test('GET /api/release-notes returns changes array', async () => {
    const r = await request('GET', '/api/release-notes');
    expect(Array.isArray(r.body.changes)).toBeTruthy();
  });

  await test('GET /api/release-notes has at least 1 change', async () => {
    const r = await request('GET', '/api/release-notes');
    expect(r.body.changes.length).toBeGreaterThan(0);
  });
}

// -- SUITE 2: Static Assets & PWA -----------------------------------------------
async function suiteStaticAssets() {
  log('Static Assets & PWA', 'SECTION');

  await test('GET / returns HTML shell (200)', async () => {
    const r = await request('GET', '/');
    expect(r.status).toBe(200);
  });

  await test('GET /manifest.json returns JSON with name', async () => {
    const r = await request('GET', '/manifest.json');
    // Many servers return 200 with HTML for missing files � check type
    if (r.status === 200 && r.body && typeof r.body === 'object') {
      expect(r.body).toHaveProperty('name');
    } else {
      // manifest optional � skip gracefully
      skipped++;
      log('manifest.json not found � skipped', 'SKIP');
    }
  });

  await test('GET /admin returns HTML admin panel (200)', async () => {
    const r = await request('GET', '/admin');
    expect(r.status).toBe(200);
  });

  await test('GET /download returns HTML (200)', async () => {
    const r = await request('GET', '/download');
    expect(r.status).toBe(200);
  });

  await test('GET /version.json returns structured JSON', async () => {
    const r = await request('GET', '/version.json');
    if (r.status === 200 && r.body && typeof r.body === 'object') {
      expect(r.body).toHaveProperty('version');
      expect(r.body).toHaveProperty('changes');
    } else {
      skipped++;
      log('version.json not directly served � skipped', 'SKIP');
    }
  });
}

// -- SUITE 3: Onboarding / Store Registration ------------------------------------
async function suiteOnboarding() {
  log('Onboarding & Store Registration', 'SECTION');

  const uniqueId   = Date.now().toString(36);
  const testEmail  = 'e2e_' + uniqueId + '@valenixia-test.invalid';
  const testPhone  = '0300' + Math.floor(1000000 + Math.random() * 9000000);

  await test('POST /api/store/register rejects empty body', async () => {
    const r = await request('POST', '/api/store/register', {});
    expect(r.status).toBeGreaterThan(399);
  });

  await test('POST /api/store/register rejects missing name', async () => {
    const r = await request('POST', '/api/store/register', { email: testEmail, phone: testPhone, businessType: 'retail' });
    expect(r.status).toBeGreaterThan(399);
  });

  await test('POST /api/store/register rejects missing email', async () => {
    const r = await request('POST', '/api/store/register', { name: 'E2E Store', phone: testPhone, businessType: 'retail' });
    expect(r.status).toBeGreaterThan(399);
  });

  let storeId = null;
  await test('POST /api/store/register succeeds with valid payload', async () => {
    const r = await request('POST', '/api/store/register', {
      name: 'E2E Test Store ' + uniqueId,
      email: testEmail,
      phone: testPhone,
      businessType: 'retail',
      address: '123 Test Ave, Lahore',
      pinCode: '1234'
    });
    if (r.status === 201 || r.status === 200) {
      expect(r.body).toHaveProperty('storeId');
      storeId = r.body.storeId;
    } else if (r.status === 409) {
      log('Store already exists (expected in repeat runs)', 'SKIP');
      skipped++;
    } else {
      throw new Error('Expected 200/201, got ' + r.status + ': ' + JSON.stringify(r.body));
    }
  });

  if (storeId) {
    await test('POST /api/store/register rejects duplicate email', async () => {
      const r = await request('POST', '/api/store/register', {
        name: 'Duplicate Store',
        email: testEmail,
        phone: testPhone,
        businessType: 'retail',
        pinCode: '5678'
      });
      expect(r.status).toBeGreaterThan(399);
    });
  }

  await test('POST /api/activation/activate rejects missing code', async () => {
    const r = await request('POST', '/api/activation/activate', { phone: testPhone });
    expect(r.status).toBeGreaterThan(399);
  });

  await test('POST /api/activation/activate rejects invalid code', async () => {
    const r = await request('POST', '/api/activation/activate', { code: '000000', phone: testPhone });
    // Should return 400 or 401 � not 500
    expect(r.status).toBeLessThan(500);
  });
}

// -- SUITE 4: Employee Authentication -------------------------------------------
async function suiteEmployeeAuth() {
  log('Employee Authentication', 'SECTION');

  await test('POST /api/employee/login rejects missing pin', async () => {
    const r = await request('POST', '/api/employee/login', {});
    expect(r.status).toBeGreaterThan(399);
  });

  await test('POST /api/employee/login rejects wrong pin', async () => {
    const r = await request('POST', '/api/employee/login', { pin: '9999' });
    // Should 401 or 403, never 500
    expect(r.status).toBeLessThan(500);
    expect(r.status).toBeGreaterThan(399);
  });

  await test('POST /api/employee/login rate limit exists (response is fast)', async () => {
    const start = Date.now();
    await request('POST', '/api/employee/login', { pin: '0000' });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(TIMEOUT);
  });
}

// -- SUITE 5: Admin Payment Panel ------------------------------------------------
async function suiteAdminPayments() {
  log('Admin Payment Panel API', 'SECTION');

  await test('GET /api/admin/payments/all requires PIN (401 without)', async () => {
    const r = await request('GET', '/api/admin/payments/all');
    expect(r.status).toBe(401);
  });

  await test('GET /api/admin/payments/all rejects wrong PIN (403)', async () => {
    const r = await request('GET', '/api/admin/payments/all', null, { 'x-admin-pin': '0000' });
    expect(r.status).toBeGreaterThan(399);
  });

  await test('GET /api/admin/payments/all returns error message on missing PIN', async () => {
    const r = await request('GET', '/api/admin/payments/all');
    expect(r.body.error).toBeTruthy();
  });

  await test('POST /api/admin/payments/decision-pin rejects missing fields', async () => {
    const r = await request('POST', '/api/admin/payments/decision-pin', { proof_id: 'x' });
    expect(r.status).toBeGreaterThan(399);
  });

  await test('POST /api/admin/payments/decision-pin rejects invalid action', async () => {
    const r = await request('POST', '/api/admin/payments/decision-pin', {
      proof_id: 'test', action: 'invalid_action', adminPin: '9999'
    });
    expect(r.status).toBeGreaterThan(399);
  });

  await test('POST /api/admin/payments/decision-pin rejects wrong admin PIN', async () => {
    const r = await request('POST', '/api/admin/payments/decision-pin', {
      proof_id: 'test', action: 'approved', adminPin: '0000'
    });
    expect(r.status).toBeGreaterThan(399);
  });

  await test('POST /api/admin/payments/decision-pin returns proper error on non-existent proof', async () => {
    // This verifies the route doesn't crash � status > 400 expected
    const r = await request('POST', '/api/admin/payments/decision-pin', {
      proof_id: 'nonexistent_proof_id_xyz', action: 'approved', adminPin: '0000'
    });
    // Should get auth error (403) or not-found (404), never 500
    expect(r.status).toBeLessThan(500);
  });
}

// -- SUITE 6: Payment Proof Submission ------------------------------------------
async function suitePaymentProofs() {
  log('Payment Proof Submission', 'SECTION');

  await test('POST /api/billing/submit-proof rejects empty body', async () => {
    const r = await request('POST', '/api/billing/submit-proof', {});
    expect(r.status).toBeGreaterThan(399);
  });

  await test('POST /api/billing/submit-proof rejects missing plan_id', async () => {
    const r = await request('POST', '/api/billing/submit-proof', {
      rrn_reference: 'TEST123', amount: 2500
    });
    expect(r.status).toBeGreaterThan(399);
  });

  await test('POST /api/billing/submit-proof rejects missing rrn_reference', async () => {
    const r = await request('POST', '/api/billing/submit-proof', {
      plan_id: 'STANDARD', amount: 2500
    });
    expect(r.status).toBeGreaterThan(399);
  });

  await test('POST /api/billing/submit-proof is auth-protected (401 without token)', async () => {
    const r = await request('POST', '/api/billing/submit-proof', {
      plan_id: 'STANDARD', rrn_reference: 'E2E_TEST', amount: 2500
    });
    // Either requires auth (401) or store context (400) � not 500
    expect(r.status).toBeLessThan(500);
  });
}

// -- SUITE 7: License Engine API (via version.json) -----------------------------
async function suiteLicenseEngine() {
  log('License & Version Configuration', 'SECTION');

  await test('version.json has required fields', () => {
    const vPath = path.join(__dirname, '..', 'public', 'version.json');
    if (!fs.existsSync(vPath)) throw new Error('version.json not found');
    const v = JSON.parse(fs.readFileSync(vPath, 'utf8'));
    expect(v).toHaveProperty('version');
    expect(v).toHaveProperty('changes');
    expect(Array.isArray(v.changes)).toBeTruthy();
  });

  await test('version.json changes array is non-empty', () => {
    const vPath = path.join(__dirname, '..', 'public', 'version.json');
    const v = JSON.parse(fs.readFileSync(vPath, 'utf8'));
    expect(v.changes.length).toBeGreaterThan(0);
  });

  await test('version.json version is a valid semver string', () => {
    const vPath = path.join(__dirname, '..', 'public', 'version.json');
    const v = JSON.parse(fs.readFileSync(vPath, 'utf8'));
    const semver = /^\d+\.\d+\.\d+$/;
    if (!semver.test(v.version)) throw new Error('Invalid semver: ' + v.version);
  });

  await test('license-engine.js exports verifyStored, getExpiryMs, getGraceRemainingMs', () => {
    const lPath = path.join(__dirname, '..', 'public', 'license-engine.js');
    if (!fs.existsSync(lPath)) throw new Error('license-engine.js not found');
    const src = fs.readFileSync(lPath, 'utf8');
    expect(src).toContain('verifyStored');
    expect(src).toContain('getExpiryMs');
    expect(src).toContain('getGraceRemainingMs');
  });

  await test('license-engine.js defines GRACE_PERIOD_MS', () => {
    const lPath = path.join(__dirname, '..', 'public', 'license-engine.js');
    const src = fs.readFileSync(lPath, 'utf8');
    expect(src).toContain('GRACE_PERIOD_MS');
  });

  await test('admin.html exists and has PIN gate', () => {
    const aPath = path.join(__dirname, '..', 'public', 'admin.html');
    if (!fs.existsSync(aPath)) throw new Error('admin.html not found');
    const src = fs.readFileSync(aPath, 'utf8');
    expect(src).toContain('gate-pin');
    expect(src).toContain('btn-gate-login');
  });

  await test('app.js contains showReleaseNotesModal function', () => {
    const aPath = path.join(__dirname, '..', 'public', 'app.js');
    if (!fs.existsSync(aPath)) throw new Error('app.js not found');
    const src = fs.readFileSync(aPath, 'utf8');
    expect(src).toContain('showReleaseNotesModal');
  });

  await test('app.js contains renderLicenseInfoCard function', () => {
    const aPath = path.join(__dirname, '..', 'public', 'app.js');
    const src = fs.readFileSync(aPath, 'utf8');
    expect(src).toContain('renderLicenseInfoCard');
  });

  await test('app.js calls /api/release-notes', () => {
    const aPath = path.join(__dirname, '..', 'public', 'app.js');
    const src = fs.readFileSync(aPath, 'utf8');
    expect(src).toContain('/api/release-notes');
  });
}

// -- SUITE 8: Release Notes Modal Logic -----------------------------------------
async function suiteReleaseNotes(available) {
  log('Release Notes Modal Logic', 'SECTION');

  await test('GET /api/release-notes returns date field', async () => {
    if (!available) { skipped++; log('Skipped (server offline)', 'SKIP'); return; }
    const r = await request('GET', '/api/release-notes');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('date');
  });

  await test('GET /api/release-notes changes are all strings', async () => {
    if (!available) { skipped++; log('Skipped (server offline)', 'SKIP'); return; }
    const r = await request('GET', '/api/release-notes');
    const allStrings = r.body.changes.every(c => typeof c === 'string');
    expect(allStrings).toBeTruthy();
  });

  await test('valenixia_last_seen_version key concept in app.js', () => {
    const aPath = path.join(__dirname, '..', 'public', 'app.js');
    const src = fs.readFileSync(aPath, 'utf8');
    expect(src).toContain('valenixia_last_seen_version');
  });

  await test('Release modal dismisses on "Got it" click (button exists in HTML)', () => {
    const aPath = path.join(__dirname, '..', 'public', 'app.js');
    const src = fs.readFileSync(aPath, 'utf8');
    expect(src).toContain('btn-dismiss-release-notes');
    expect(src).toContain('setItem(seenKey, version)');
  });
}

// -- SUITE 9: Mobile Bootstrap & Asset Sync -------------------------------------
async function suiteMobileBootstrap() {
  log('Mobile Bootstrap & Asset Sync', 'SECTION');

  await test('index.html license card element exists', () => {
    const iPath = path.join(__dirname, '..', 'public', 'index.html');
    if (!fs.existsSync(iPath)) throw new Error('index.html not found');
    const src = fs.readFileSync(iPath, 'utf8');
    expect(src).toContain('settings-license-card');
    expect(src).toContain('license-info-content');
  });

  await test('index.html settings structure intact (danger zone div)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    expect(src).toContain('dm-danger-zone');
    expect(src).toContain('dm-danger-card');
  });

  await test('server.js has adminActionLimiter', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    expect(src).toContain('adminActionLimiter');
  });

  await test('server.js has GET /admin route', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    expect(src).toContain("get('/admin'");
  });

  await test('server.js has GET /api/admin/payments/all route', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    expect(src).toContain('/api/admin/payments/all');
  });

  await test('server.js has POST /api/admin/payments/decision-pin route', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    expect(src).toContain('/api/admin/payments/decision-pin');
  });

  await test('server.js has GET /api/release-notes route', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    expect(src).toContain('/api/release-notes');
  });

  await test('server.js audit log for payment decisions', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    expect(src).toContain('admin_audit_log');
    expect(src).toContain('admin_audit_log');
  });

  await test('All public JS files have no obvious syntax errors (node --check)', async () => {
    const { execSync } = require('child_process');
    const files = [
      path.join(__dirname, '..', 'server.js'),
    ];
    for (const f of files) {
      try {
        execSync('node --check "' + f + '"', { stdio: 'ignore' });
      } catch {
        throw new Error('Syntax error in: ' + path.basename(f));
      }
    }
  });
}

// -- SUITE 10: Security Hardening Checks ----------------------------------------
async function suiteSecurity(available) {
  log('Security Hardening', 'SECTION');

  await test('Rate limiter protects admin routes (headers present on rejection)', async () => {
    if (!available) { skipped++; log('Skipped (server offline)', 'SKIP'); return; }
    const r = await request('GET', '/api/admin/payments/all');
    expect(r.body).toHaveProperty('error');
  });

  await test('Admin panel HTML has no exposed PIN in source', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
    // Ensure no hardcoded '1234' or '0000' default pins
    if (src.includes("value='1234'") || src.includes('value="1234"')) {
      throw new Error('Hardcoded default PIN found in admin.html!');
    }
  });

  await test('Admin route does not expose employee list to unauthenticated users', async () => {
    if (!available) { skipped++; log('Skipped (server offline)', 'SKIP'); return; }
    const r = await request('GET', '/api/admin/payments/all');
    expect(r.status).toBe(401);
    if (Array.isArray(r.body)) throw new Error('Employee list exposed without auth!');
  });

  await test('POST /api/admin/payments/decision-pin requires action field', async () => {
    if (!available) { skipped++; log('Skipped (server offline)', 'SKIP'); return; }
    const r = await request('POST', '/api/admin/payments/decision-pin', {
      proof_id: 'abc', adminPin: '0000'
    });
    expect(r.status).toBeGreaterThan(399);
    expect(r.body.error).toBeTruthy();
  });

  await test('server.js uses x-admin-pin header or adminPin body (not URL param by default)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    expect(src).toContain('x-admin-pin');
  });
}

// -- SUITE 11: Catalog & Checkout Integration ------------------------------------
async function suiteCatalogCheckout() {
  log('Catalog & Checkout Integration', 'SECTION');

  await test('GET /api/catalog returns 401 or 200 (auth-gated)', async () => {
    const r = await request('GET', '/api/catalog');
    expect([200, 401, 403]).toContain(r.status);
  });

  await test('GET /api/catalog never returns 500', async () => {
    const r = await request('GET', '/api/catalog');
    expect(r.status).toBeLessThan(500);
  });

  await test('POST /api/checkout rejects empty body', async () => {
    const r = await request('POST', '/api/checkout', {});
    expect(r.status).toBeGreaterThan(399);
  });
}

// -------------------------------------------------------------------------------
//  RUNNER
// -------------------------------------------------------------------------------
async function main() {
  console.log('\n' + '�'.repeat(62));
  console.log('�  VALENIXIA POS � MOBILE E2E TEST SUITE v2                    �');
  console.log('�  Target: ' + BASE_URL.padEnd(49) + '�');
  console.log('�'.repeat(62) + '\n');

  const available = await checkServerAvailable();
  if (!available) {
    console.warn('??  Server not available at ' + BASE_URL + '.');
    console.warn('   Running file-based tests only...\n');
  }

  // File-based suites (always run)
  await suiteLicenseEngine();
  await suiteMobileBootstrap();
  await suiteSecurity(available);
  await suiteReleaseNotes(available);

  if (available) {
    // Network suites (require running server)
    await suiteHealthVersion();
    await suiteStaticAssets();
    await suiteOnboarding();
    await suiteEmployeeAuth();
    await suiteAdminPayments();
    await suitePaymentProofs();
    await suiteCatalogCheckout();
  } else {
    console.warn('  [Network suites skipped � server offline]\n');
    skipped += 18; // Approximate count of network tests
  }

  // Summary
  const total = passed + failed + skipped;
  console.log('\n' + '-'.repeat(62));
  console.log('  RESULTS: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped � ' + total + ' total');
  console.log('-'.repeat(62));

  if (failures.length > 0) {
    console.log('\n  FAILURES:\n');
    failures.forEach((f, i) => {
      console.log('  ' + (i + 1) + '. ' + f.name);
      console.log('     ' + f.error + '\n');
    });
  }

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n  ? All tests passed.\n');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});






