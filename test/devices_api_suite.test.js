const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Devices API & Whitelist Audit');
console.log('══════════════════════════════════════════════════\n');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

async function run() {
  await test('1. api/devices/index.js exists and handles GET /api/devices', async () => {
    const handler = require('../api/devices/index.js');
    assert.strictEqual(typeof handler, 'function', 'handler must be a function');
    
    let resHeaders = {};
    let resStatus = 0;
    let resJson = null;

    const req = {
      method: 'GET',
      headers: { 'user-agent': 'TestAgent/1.0' }
    };
    const res = {
      setHeader: (k, v) => { resHeaders[k] = v; },
      status: (s) => {
        resStatus = s;
        return {
          json: (j) => { resJson = j; return j; },
          end: () => {}
        };
      }
    };

    await handler(req, res);
    assert.strictEqual(resStatus, 200, 'Must return HTTP 200');
    assert.strictEqual(resJson.status, 'OK', 'Status must be OK');
    assert.ok(Array.isArray(resJson.devices), 'Devices must be an array');
    assert.ok(resJson.devices.length > 0, 'Devices must not be empty');
  });

  await test('2. api/devices/approve.js exists and handles POST /api/devices/approve', async () => {
    const handler = require('../api/devices/approve.js');
    assert.strictEqual(typeof handler, 'function', 'handler must be a function');

    let resStatus = 0;
    let resJson = null;

    const req = {
      method: 'POST',
      body: { nodeId: 'test_terminal_01' }
    };
    const res = {
      setHeader: () => {},
      status: (s) => {
        resStatus = s;
        return {
          json: (j) => { resJson = j; return j; },
          end: () => {}
        };
      }
    };

    await handler(req, res);
    assert.strictEqual(resStatus, 200, 'Must return HTTP 200');
    assert.strictEqual(resJson.status, 'APPROVED', 'Status must be APPROVED');
    assert.strictEqual(resJson.nodeId, 'test_terminal_01');
  });

  await test('3. api/devices/reject.js exists and handles POST /api/devices/reject', async () => {
    const handler = require('../api/devices/reject.js');
    assert.strictEqual(typeof handler, 'function', 'handler must be a function');

    let resStatus = 0;
    let resJson = null;

    const req = {
      method: 'POST',
      body: { nodeId: 'test_terminal_01' }
    };
    const res = {
      setHeader: () => {},
      status: (s) => {
        resStatus = s;
        return {
          json: (j) => { resJson = j; return j; },
          end: () => {}
        };
      }
    };

    await handler(req, res);
    assert.strictEqual(resStatus, 200, 'Must return HTTP 200');
    assert.strictEqual(resJson.status, 'REJECTED', 'Status must be REJECTED');
    assert.strictEqual(resJson.nodeId, 'test_terminal_01');
  });

  console.log('\n──────────────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('✨ All Device API Audits passed perfectly!\n');
  }
}

run();
