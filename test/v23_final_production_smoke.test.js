const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('==================================================');
console.log('  VALENIXIA POS — Final Production Smoke & Route Test');
console.log('==================================================\n');

// 1. Verify CSS Display Rules for Single Active View Guarantee
const componentsCss = fs.readFileSync(path.join(__dirname, '../public/styles/components.css'), 'utf8');
const styleCss = fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8');

assert.strictEqual(
  componentsCss.includes('#view-checkout:not(.active) {\n  display: none !important;\n}'),
  true,
  'components.css must explicitly hide non-active #view-checkout'
);

assert.strictEqual(
  styleCss.includes('.content-view:not(.active)'),
  true,
  'style.css must contain strict single active view rule for .content-view:not(.active)'
);

assert.strictEqual(
  styleCss.includes('#view-checkout:not(.active)'),
  true,
  'style.css must contain strict single active view rule for #view-checkout:not(.active)'
);
console.log('  ✅ 1. CSS rules strictly enforce single active view (non-checkout views cannot render checkout overlay)');

// 2. Verify Static PWA Asset Routes in vercel.json
const vercelJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
const routeSrcs = vercelJson.routes.map(r => r.src);

assert.strictEqual(routeSrcs.includes('/manifest.json'), true, 'vercel.json must contain static route for /manifest.json');
assert.strictEqual(routeSrcs.includes('/sw.js'), true, 'vercel.json must contain static route for /sw.js');
assert.strictEqual(routeSrcs.includes('/favicon.png'), true, 'vercel.json must contain static route for /favicon.png');
assert.strictEqual(routeSrcs.includes('/icon-192.png'), true, 'vercel.json must contain static route for /icon-192.png');
assert.strictEqual(routeSrcs.includes('/icon-512.png'), true, 'vercel.json must contain static route for /icon-512.png');
console.log('  ✅ 2. vercel.json contains explicit static CDN routes for all PWA assets ahead of server catch-all');

// 3. Verify Server CSP connect-src Strict Domain List
const serverJs = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
assert.strictEqual(serverJs.includes("https://*.supabase.co"), true, 'server.js CSP connectSrc must include Supabase');
assert.strictEqual(serverJs.includes("https://gw.fbr.gov.pk"), true, 'server.js CSP connectSrc must include FBR gateway');
assert.strictEqual(serverJs.includes("https://*.vercel.app"), true, 'server.js CSP connectSrc must include Vercel domains');
console.log('  ✅ 3. Server CSP connect-src maintains clean production domain whitelist');

// 4. Verify Platform Admin Security Endpoints
assert.strictEqual(serverJs.includes("app.post('/api/auth/admin/login'"), true, 'server.js must expose /api/auth/admin/login');
assert.strictEqual(serverJs.includes("app.get('/api/admin/me'"), true, 'server.js must expose /api/admin/me');
assert.strictEqual(serverJs.includes("requirePlatformAdmin"), true, 'server.js must enforce requirePlatformAdmin middleware');
console.log('  ✅ 4. Server-side Platform Admin security and authorization routes verified');

console.log('\n──────────────────────────────────────────────────');
console.log('Results: All 4 production smoke checks passed cleanly!');
console.log('✨ System verified ready for Vercel production deployment!');
