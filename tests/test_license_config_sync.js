/**
 * test_license_config_sync.js  — Part D verification
 *
 * Fails if public/license-config.js and lib/license-config.js ever diverge.
 * Run with: node tests/test_license_config_sync.js
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const root   = path.resolve(__dirname, '..');
const PUBLIC = path.join(root, 'public', 'license-config.js');
const LIB    = path.join(root, 'lib',    'license-config.js');

const pubContent = fs.readFileSync(PUBLIC, 'utf8');
const libContent = fs.readFileSync(LIB,    'utf8');

if (pubContent !== libContent) {
  console.error('FAIL: public/license-config.js and lib/license-config.js have diverged.');
  const pubLines = pubContent.split('\n');
  const libLines = libContent.split('\n');
  const maxLen   = Math.max(pubLines.length, libLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (pubLines[i] !== libLines[i]) {
      console.error('L' + (i+1) + ' public: ' + (pubLines[i] ?? '<missing>'));
      console.error('L' + (i+1) + ' lib:    ' + (libLines[i] ?? '<missing>'));
    }
  }
  process.exit(1);
}

const vm      = require('vm');
const sandbox = { module: { exports: {} } };
vm.runInNewContext(pubContent, sandbox);
const config  = sandbox.module.exports;

let pass = true;
for (const [tier, cfg] of Object.entries(config)) {
  if (typeof cfg.allowedTerminals !== 'number' || typeof cfg.devices !== 'number') continue;
  if (cfg.allowedTerminals < 1) {
    console.error('FAIL: LICENSE_CONFIG.' + tier + '.allowedTerminals (' + cfg.allowedTerminals + ') < 1');
    pass = false;
  }
  if (cfg.allowedTerminals > cfg.devices) {
    console.error('FAIL: LICENSE_CONFIG.' + tier + '.allowedTerminals (' + cfg.allowedTerminals + ') > devices (' + cfg.devices + ')');
    pass = false;
  }
}

if (!pass) process.exit(1);
console.log('PASS: license-config files are in sync and all tier limits are internally consistent.');
