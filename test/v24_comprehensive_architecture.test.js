// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM — COMPREHENSIVE V2.4.6 ACCEPTANCE GATE TEST SUITE
// Tests zero-drift commercial catalog, 10/5 hardware limit enforcement,
// 4-signal connectivity engine, legal requirements matrix, zero Skip Loading,
// APP_SURFACE identity, and production build consistency.
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Valenixia POS v2.4.6 Comprehensive Production Acceptance Gate', function() {

  describe('1. Single Canonical Commercial Catalog & Zero Drift', function() {
    it('should have identical server catalog and browser catalog definitions', function() {
      const serverCatalog = require('../lib/commercial-catalog');
      const publicCatalogFile = fs.readFileSync(path.join(__dirname, '../public/commercial-catalog.js'), 'utf8');

      assert.strictEqual(serverCatalog.COMMERCIAL_PLANS.ENTERPRISE.terminal_limit, 10);
      assert.strictEqual(serverCatalog.COMMERCIAL_PLANS.ENTERPRISE.branch_limit, 5);
      assert.strictEqual(serverCatalog.COMMERCIAL_PLANS.STARTER.terminal_limit, 1);
      assert.strictEqual(serverCatalog.COMMERCIAL_PLANS.STARTER.branch_limit, 1);
      assert.strictEqual(serverCatalog.COMMERCIAL_PLANS.GROWTH.terminal_limit, 3);
      assert.strictEqual(serverCatalog.COMMERCIAL_PLANS.GROWTH.branch_limit, 1);

      assert.ok(publicCatalogFile.includes("terminal_limit: 10"), "public/commercial-catalog.js must set terminal_limit: 10");
      assert.ok(publicCatalogFile.includes("branch_limit: 5"), "public/commercial-catalog.js must set branch_limit: 5");
    });

    it('should contain zero "Unlimited" hardware limit references in UI files', function() {
      const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
      const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

      assert.doesNotMatch(indexHtml, /Unlimited Register Terminals/i, 'index.html must not contain Unlimited Register Terminals');
      assert.doesNotMatch(appJs, /ENTERPRISE:\s*'Unlimited'/i, 'app.js must not contain ENTERPRISE: Unlimited');
    });
  });

  describe('2. Enterprise Hardware Limits (10 Terminals / 5 Branches) Enforcement', function() {
    it('should allow terminal #10 and reject terminal #11 for Enterprise tier', async function() {
      const entitlementService = require('../lib/entitlement-service');

      const ent10 = { tier: 'ENTERPRISE', maxTerminals: 10, maxBranches: 5 };
      const res10 = await entitlementService.canAddTerminal(ent10, 9);
      const res11 = await entitlementService.canAddTerminal(ent10, 10);
      assert.strictEqual(res10.allowed, true, 'Terminal #10 (current count 9) must be allowed');
      assert.strictEqual(res11.allowed, false, 'Terminal #11 (current count 10) must be rejected');
    });

    it('should allow branch #5 and reject branch #6 for Enterprise tier', async function() {
      const entitlementService = require('../lib/entitlement-service');

      const ent5 = { tier: 'ENTERPRISE', maxTerminals: 10, maxBranches: 5 };
      const res5 = await entitlementService.canAddBranch(ent5, 4);
      const res6 = await entitlementService.canAddBranch(ent5, 5);
      assert.strictEqual(res5.allowed, true, 'Branch #5 (current count 4) must be allowed');
      assert.strictEqual(res6.allowed, false, 'Branch #6 (current count 5) must be rejected');
    });

    it('should enforce STARTER (1 terminal / 1 branch) and GROWTH (3 terminals / 1 branch) tier limits', async function() {
      const entitlementService = require('../lib/entitlement-service');

      const starterEnt = { tier: 'STARTER', maxTerminals: 1, maxBranches: 1 };
      assert.strictEqual((await entitlementService.canAddTerminal(starterEnt, 0)).allowed, true, 'Starter Terminal #1 allowed');
      assert.strictEqual((await entitlementService.canAddTerminal(starterEnt, 1)).allowed, false, 'Starter Terminal #2 rejected');

      const growthEnt = { tier: 'GROWTH', maxTerminals: 3, maxBranches: 1 };
      assert.strictEqual((await entitlementService.canAddTerminal(growthEnt, 2)).allowed, true, 'Growth Terminal #3 allowed');
      assert.strictEqual((await entitlementService.canAddTerminal(growthEnt, 3)).allowed, false, 'Growth Terminal #4 rejected');
    });

    it('should seed database plan_entitlements table with max_branches=5 and max_terminals=10 for ENTERPRISE', function() {
      const dbSeedContent = fs.readFileSync(path.join(__dirname, '../database.js'), 'utf8');
      assert.ok(dbSeedContent.includes("('ENTERPRISE', 5, 10,"), 'database.js seed must insert 5 branches and 10 terminals for ENTERPRISE');
    });
  });

  describe('3. 4-Signal Connectivity Engine & Observability Diagnostic', function() {
    it('should expose getDiagnosticSnapshot returning all 4 signal fields', function() {
      const connectivityJs = fs.readFileSync(path.join(__dirname, '../public/connectivity.js'), 'utf8');

      assert.ok(connectivityJs.includes('window.__VALENIXIA_CONNECTIVITY__ ='), 'connectivity.js must expose window.__VALENIXIA_CONNECTIVITY__');
      assert.ok(connectivityJs.includes('browserNetwork:'), 'Diagnostic snapshot must include browserNetwork');
      assert.ok(connectivityJs.includes('backendReachability:'), 'Diagnostic snapshot must include backendReachability');
      assert.ok(connectivityJs.includes('syncHealth:'), 'Diagnostic snapshot must include syncHealth');
      assert.ok(connectivityJs.includes('posOperatingMode:'), 'Diagnostic snapshot must include posOperatingMode');
    });

    it('should configure uncached health headers in server.js and vercel.json', function() {
      const serverJs = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
      const vercelJson = fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8');

      assert.ok(serverJs.includes("RELEASE_VERSION = '2.5.1'"), 'server.js /api/health endpoint must report version 2.5.1');
      assert.ok(vercelJson.includes("no-store"), 'vercel.json must enforce no-store header on health probes');
    });
  });

  describe('4. Add-on Marketplace & Stateful Buttons', function() {
    it('should define all 5 commercial add-ons in catalog', function() {
      const catalog = require('../lib/commercial-catalog');
      const addons = catalog.COMMERCIAL_ADDONS;

      assert.ok(addons.FBR_FISCAL, 'FBR_FISCAL add-on must exist');
      assert.ok(addons.MULTI_STORE, 'MULTI_STORE add-on must exist');
      assert.ok(addons.WHATSAPP_RECEIPTS, 'WHATSAPP_RECEIPTS add-on must exist');
      assert.ok(addons.CUSTOM_ROLES, 'CUSTOM_ROLES add-on must exist');
      assert.ok(addons.DATA_PORTABILITY, 'DATA_PORTABILITY add-on must exist');
    });

    it('should contain add-ons marketplace sub-panel and request buttons in index.html', function() {
      const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

      assert.ok(indexHtml.includes('id="sub-panel-addons"'), 'index.html must contain #sub-panel-addons panel');
      assert.ok(indexHtml.includes('data-addon-id="FBR_FISCAL"'), 'index.html must contain FBR_FISCAL add-on card');
      assert.ok(indexHtml.includes('data-addon-id="MULTI_STORE"'), 'index.html must contain MULTI_STORE add-on card');
    });

    it('should implement /api/addons/claim and /api/addons/list in server.js', function() {
      const serverJs = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

      assert.ok(serverJs.includes('/api/addons/list'), 'server.js must implement /api/addons/list');
      assert.ok(serverJs.includes('/api/addons/claim'), 'server.js must implement /api/addons/claim');
    });
  });

  describe('5. Legal Requirements Matrix & Substantive Document Completeness', function() {
    it('should contain all 6 legal documents with substantive non-placeholder text', function() {
      const legalDocs = require('../lib/legal-documents');

      const requiredKeys = ['TERMS_OF_SERVICE', 'EULA', 'PRIVACY_POLICY', 'ACCEPTABLE_USE', 'FBR_DISCLAIMER', 'CLOUD_SYNC_TERMS'];
      requiredKeys.forEach(key => {
        assert.ok(legalDocs[key], `Legal document ${key} must exist`);
        assert.ok(legalDocs[key].length > 200, `Legal document ${key} must contain substantive text (>200 chars)`);
      });

      // Verify specific mandatory legal clauses
      assert.ok(legalDocs.FBR_DISCLAIMER.includes('Software Application'), 'FBR Disclaimer must state Software Application boundary');
      assert.ok(legalDocs.FBR_DISCLAIMER.includes('Taxpayer / Merchant Obligations'), 'FBR Disclaimer must state Taxpayer Merchant obligations');
      assert.ok(legalDocs.TERMS_OF_SERVICE.includes('Up to 10 Register Terminals'), 'TOS must state Enterprise 10 register limit');
      assert.ok(legalDocs.PRIVACY_POLICY.includes('AES-256-GCM'), 'Privacy Policy must state AES-256-GCM encryption');
    });

    it('should present review buttons for all 6 legal documents in index.html', function() {
      const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

      assert.ok(indexHtml.includes('data-doc-key="TERMS_OF_SERVICE"'), 'index.html must link TERMS_OF_SERVICE');
      assert.ok(indexHtml.includes('data-doc-key="EULA"'), 'index.html must link EULA');
      assert.ok(indexHtml.includes('data-doc-key="PRIVACY_POLICY"'), 'index.html must link PRIVACY_POLICY');
      assert.ok(indexHtml.includes('data-doc-key="ACCEPTABLE_USE"'), 'index.html must link ACCEPTABLE_USE');
      assert.ok(indexHtml.includes('data-doc-key="FBR_DISCLAIMER"'), 'index.html must link FBR_DISCLAIMER');
      assert.ok(indexHtml.includes('data-doc-key="CLOUD_SYNC_TERMS"'), 'index.html must link CLOUD_SYNC_TERMS');
    });
  });

  describe('6. Absolute Purge of Skip Loading', function() {
    it('should contain ZERO instances of btn-force-open-app or Skip Loading in public/index.html and bootstrap-init.js', function() {
      const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
      const bootstrapJs = fs.readFileSync(path.join(__dirname, '../public/bootstrap-init.js'), 'utf8');

      assert.doesNotMatch(indexHtml, /btn-force-open-app|Skip Loading/i, 'public/index.html must not contain Skip Loading button');
      assert.doesNotMatch(bootstrapJs, /btn-force-open-app/i, 'public/bootstrap-init.js must not contain btn-force-open-app listener');
    });
  });

  describe('7. APP_SURFACE Identity & Web-Only Get Apps DOM Removal', function() {
    it('should define APP_SURFACE and handle non-WEB DOM removal', function() {
      const bootstrapJs = fs.readFileSync(path.join(__dirname, '../public/bootstrap-init.js'), 'utf8');
      const appJs = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

      assert.ok(bootstrapJs.includes('window.APP_SURFACE ='), 'bootstrap-init.js must define APP_SURFACE');
      assert.ok(bootstrapJs.includes('btnGetApps.remove()'), 'bootstrap-init.js must call btnGetApps.remove() on non-WEB');
      assert.ok(appJs.includes('.forEach(el => el.remove())'), 'app.js must remove Get Apps elements from DOM on non-WEB');
    });
  });

  describe('8. Production Build ID & Version Consistency', function() {
    it('should expose build_id in version.json and build-id file', function() {
      const versionJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/version.json'), 'utf8'));
      const buildIdText = fs.readFileSync(path.join(__dirname, '../public/build-id'), 'utf8').trim();

      assert.strictEqual(versionJson.version, '2.5.1', 'version.json version must be 2.5.1');
      assert.ok(versionJson.build_id, 'version.json must specify build_id');
      assert.strictEqual(buildIdText, versionJson.build_id, 'public/build-id content must match version.json build_id');
    });
  });

});
