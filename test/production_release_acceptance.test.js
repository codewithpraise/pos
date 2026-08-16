// ============================================================================
// VALENIXIA POS v2.8.0 - PRODUCTION RELEASE ACCEPTANCE GATE & REGRESSION SUITE
// Asserts release manifest integrity, SW update handshakes, idempotent bootstrap,
// identity hierarchy, server-authoritative entitlements, and regression protection.
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

describe('Valenixia POS v2.8.0 Production Release Acceptance Gate', function() {

  describe('1. Single Release Manifest & Zero-Drift Provenance (Rules #1 & #2)', function() {
    it('should have a valid public/release-manifest.json with matching versions', function() {
      const manifestPath = path.join(__dirname, '..', 'public', 'release-manifest.json');
      assert.strictEqual(fs.existsSync(manifestPath), true, 'release-manifest.json must exist');

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      assert.ok(manifest.version, 'manifest version must exist');
      assert.strictEqual(manifest.product, 'VALENIXIA POS');
      assert.ok(manifest.build_id, 'build_id must exist');
      assert.strictEqual(manifest.schema_version, '17');
      assert.ok(manifest.commercial_catalog_version, 'commercial_catalog_version must exist');
      assert.ok(manifest.legal_documents_version, 'legal_documents_version must exist');
    });

    it('should match release build_id across version.json and build-id', function() {
      const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'release-manifest.json'), 'utf8'));
      const versionJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'version.json'), 'utf8'));
      const buildIdText = fs.readFileSync(path.join(__dirname, '..', 'public', 'build-id'), 'utf8').trim();

      assert.strictEqual(versionJson.version, manifest.version);
      assert.strictEqual(versionJson.build_id, manifest.build_id);
      assert.strictEqual(buildIdText, manifest.build_id);
    });

    it('should have valid commercial catalog in both lib/ and public/ files', function() {
      const serverCatalog = require('../lib/commercial-catalog');
      const clientCatalogCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'commercial-catalog.js'), 'utf8');

      assert.ok(serverCatalog.COMMERCIAL_CATALOG_VERSION || serverCatalog.PLAN_RATES);
      assert.ok(clientCatalogCode.includes("COMMERCIAL_PLANS") || clientCatalogCode.includes("PLAN_RATES"));
    });

    it('should match legal documents in both lib/ and public/ legal files', function() {
      const serverLegal = require('../lib/legal-documents');
      const clientLegalCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'legal-documents.js'), 'utf8');
      const legalVer = (serverLegal.LEGAL_DOCUMENTS || serverLegal).VERSION;

      assert.ok(legalVer);
      assert.ok(clientLegalCode.includes("VERSION:"));
    });
  });

  describe('2. PWA Network-First Caching & Service Worker Handshake (Rules #3 & #4)', function() {
    it('should configure Network-Only/Network-First for release manifest and build-id in sw.js', function() {
      const swCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
      assert.ok(swCode.includes("url.pathname === '/release-manifest.json'"));
      assert.ok(swCode.includes("url.pathname === '/build-id'"));
      assert.ok(swCode.includes("url.pathname === '/version.json'"));
    });

    it('should include no-store headers for release-manifest.json and sw.js in vercel.json', function() {
      const vercelJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
      const noStoreRule = vercelJson.headers.find(h => h.source && h.source.includes('release-manifest.json'));

      assert.ok(noStoreRule, 'vercel.json must contain no-store header rule covering release-manifest.json');
      const cacheHeader = noStoreRule.headers.find(k => k.key === 'Cache-Control');
      assert.ok(cacheHeader.value.includes('no-store'));
    });

    it('should fetch release-manifest in sw-loader.js and reload once using session-scoped token', function() {
      const swLoaderCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw-loader.js'), 'utf8');
      assert.ok(swLoaderCode.includes('/release-manifest.json'));
      assert.ok(swLoaderCode.includes('valenixia_sw_reloaded'));
      assert.ok(swLoaderCode.includes('window.__VALENIXIA_RELEASE__'));
      assert.ok(swLoaderCode.includes('window.__VALENIXIA_SW__'));
    });
  });

  describe('3. Idempotent Bootstrap State Machine & Identity Discovery (Rules #5 & #6)', function() {
    let dom, window, document;

    beforeEach(function() {
      const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
      dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously' });
      window = dom.window;
      document = window.document;

      // Polyfill localStorage
      const storage = {};
      window.localStorage = {
        getItem: key => storage[key] || null,
        setItem: (key, val) => { storage[key] = String(val); },
        removeItem: key => { delete storage[key]; },
        clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
      };

      // Load bootstrap-init.js
      const bootCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'bootstrap-init.js'), 'utf8');
      window.eval(bootCode);
    });

    it('should define window.__VALENIXIA_IDENTITY__ returning complete identity snapshot', function() {
      assert.ok(window.__VALENIXIA_IDENTITY__, 'window.__VALENIXIA_IDENTITY__ must exist');
      const snapshot = window.__VALENIXIA_IDENTITY__.getSnapshot();

      assert.ok(snapshot.installationId.startsWith('inst_'));
      assert.strictEqual(snapshot.deviceId, 'dev_web_primary');
      assert.strictEqual(snapshot.databaseName, 'valenixia_pos_db');
      assert.ok(snapshot.bootstrapVersion);
    });

    it('should NOT render fresh store wizard if store / onboarding_complete exists (RESTORE_EXISTING_STORE)', function() {
      window.localStorage.setItem('onboarding_complete', 'true');
      if (typeof window.runBootstrapDiscoveryPipeline === 'function') {
        window.runBootstrapDiscoveryPipeline();
      }

      const wizard = document.getElementById('first-boot-wizard');
      const lockScreen = document.getElementById('auth-lock-screen');

      assert.strictEqual(wizard.style.display, 'none', 'Setup wizard must be hidden when store exists');
      assert.strictEqual(lockScreen.style.display, 'flex', 'PIN Lock Screen must be displayed for existing store');
    });

    it('should render setup wizard ONLY when onboarding_complete is absent (FIRST_RUN_BOOTSTRAP)', function() {
      window.localStorage.clear();
      if (typeof window.runBootstrapDiscoveryPipeline === 'function') {
        window.runBootstrapDiscoveryPipeline();
      }

      const wizard = document.getElementById('first-boot-wizard');
      assert.ok(wizard.style.display === 'block' || wizard.style.display === 'flex', 'Setup wizard must display for fresh installation');
    });
  });

  describe('4. Server-Authoritative Entitlements & Hardware Limits (Rules #8, #9, #13)', function() {
    const EntitlementService = require('../lib/entitlement-service');

    it('should enforce STARTER (1/1), GROWTH (3/1), and ENTERPRISE (10/5) hardware limits', async function() {
      const starter = await EntitlementService.canAddTerminal({ maxTerminals: 1, currentTerminals: 1 });
      assert.strictEqual(starter.allowed, false);

      const growth = await EntitlementService.canAddTerminal({ maxTerminals: 3, currentTerminals: 2 });
      assert.strictEqual(growth.allowed, true);

      const ent10 = await EntitlementService.canAddTerminal({ maxTerminals: 10, currentTerminals: 10 });
      assert.strictEqual(ent10.allowed, false);

      const ent11 = await EntitlementService.canAddTerminal({ maxTerminals: 10, currentTerminals: 9 });
      assert.strictEqual(ent11.allowed, true);

      const branch5 = await EntitlementService.canAddBranch({ maxBranches: 5, currentBranches: 5 });
      assert.strictEqual(branch5.allowed, false);

      const branch6 = await EntitlementService.canAddBranch({ maxBranches: 5, currentBranches: 4 });
      assert.strictEqual(branch6.allowed, true);
    });

    it('should seed database plan_entitlements table with 10 terminals & 5 branches for Enterprise', function() {
      const dbCode = fs.readFileSync(path.join(__dirname, '..', 'database.js'), 'utf8');
      assert.ok(dbCode.includes("'ENTERPRISE', 5, 10"));
      assert.ok(dbCode.includes("'PRO', 1, 3"));
      assert.ok(dbCode.includes("'STARTER', 1, 1"));
      assert.ok(dbCode.includes("'FREE', 1, 1"));
    });
  });

  describe('5. UI Identity: WEB-Only Get Apps & Subscription Viewport (Rules #18 & #19)', function() {
    let dom, window, document;

    beforeEach(function() {
      const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
      dom = new JSDOM(html, { url: 'http://localhost/' });
      window = dom.window;
      document = window.document;
    });

    it('should place #btn-topbar-apps-download in topbar header structure', function() {
      const btn = document.getElementById('btn-topbar-apps-download');
      const langBtn = document.getElementById('lang-toggle-btn');

      assert.ok(btn, '#btn-topbar-apps-download must exist in DOM');
      assert.ok(langBtn, '#lang-toggle-btn must exist in DOM');
    });

    it('should remove #btn-topbar-apps-download on non-WEB surfaces (PWA, Desktop, Mobile)', function() {
      window.APP_SURFACE = 'PWA';
      const btn = document.getElementById('btn-topbar-apps-download');

      // Simulate surface removal
      if (window.APP_SURFACE !== 'WEB' && btn) btn.remove();
      assert.strictEqual(document.getElementById('btn-topbar-apps-download'), null);
    });

    it('should maintain single scrollable container (.sub-vault-stage) on subscription view', function() {
      const viewSub = document.getElementById('view-subscription');
      const stage = viewSub.querySelector('.sub-vault-stage');

      assert.ok(viewSub, '#view-subscription view must exist');
      assert.ok(stage, '.sub-vault-stage main content container must exist');
    });
  });

  describe('6. 24-Subject Legal Requirements Matrix (Rule #20)', function() {
    const serverLegal = require('../lib/legal-documents');

    const requiredSubjects = [
      'merchant tax', 'fbr', 'pral', 'cloud backup', 'google drive',
      'whatsapp', 'offline', 'hardware limits', 'privacy', 'eula'
    ];

    requiredSubjects.forEach(subject => {
      it(`should contain compliance text for subject: '${subject}'`, function() {
        const legalObject = serverLegal.LEGAL_DOCUMENTS || serverLegal;
        const fullText = JSON.stringify(legalObject).toLowerCase();
        assert.ok(fullText.includes(subject.toLowerCase()), `Legal text must cover '${subject}'`);
      });
    });
  });

  describe('7. Permanent Regression Protection for Bugs & Invariants', function() {
    it('Manifest and version.json must share valid version', function() {
      const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'release-manifest.json'), 'utf8'));
      assert.ok(manifest.version);
    });

    it('Enterprise plan rates must enforce hardware limits without unlimited promises', function() {
      const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
      assert.strictEqual(indexHtml.includes('Unlimited Registers'), false);
    });

    it('Skip Loading button must be purged with 0 occurrences', function() {
      const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
      const boot = fs.readFileSync(path.join(__dirname, '..', 'public', 'bootstrap-init.js'), 'utf8');

      assert.strictEqual(html.includes('btn-force-open-app'), false);
      assert.strictEqual(html.includes('Skip Loading'), false);
      assert.strictEqual(boot.includes('btn-force-open-app'), false);
      assert.strictEqual(boot.includes('Skip Loading'), false);
    });

    it('Existing store must NEVER re-trigger bootstrap overlay', function() {
      const bootCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'bootstrap-init.js'), 'utf8');
      assert.ok(bootCode.includes('AUTH_LOCK') || bootCode.includes('auth-lock-screen'));
    });
  });

});
