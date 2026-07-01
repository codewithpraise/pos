// scripts/test_crdt.js
// Automated test suite for Nexova CRDT and Hybrid Logical Clock engine
const assert = require('assert');
const { HLC, shouldApplyDelta } = require('../crdt-engine');

console.log('--- STARTING CRDT ENGINE TEST SUITE ---');

try {
  // Test 1: HLC String formatting and parsing
  console.log('Running Test 1: HLC formatting/parsing...');
  const clock = new HLC('node_A');
  clock.l = 1719600000000;
  clock.c = 5;
  const hlcStr = clock.toString();
  assert.strictEqual(hlcStr, '001719600000000:000005:node_A', 'HLC string representation mismatch');
  
  const parsed = HLC.parse(hlcStr);
  assert.strictEqual(parsed.l, 1719600000000);
  assert.strictEqual(parsed.c, 5);
  assert.strictEqual(parsed.nodeId, 'node_A');
  console.log('[PASS] Test 1');

  // Test 2: HLC Tick and physical time ordering
  console.log('Running Test 2: HLC tick logical counter...');
  const clockB = new HLC('node_B');
  const t1 = clockB.tick();
  const t2 = clockB.tick();
  assert.ok(t2 > t1, 'Subsequent ticks must produce strictly greater HLC strings');
  console.log('[PASS] Test 2');

  // Test 3: HLC Ticks lamport counter comparison
  console.log('Running Test 3: HLC clock compare logic...');
  const hlc1 = '001719600000000:000001:node_A';
  const hlc2 = '001719600000000:000002:node_A';
  const hlc3 = '001719600000001:000000:node_A';
  assert.strictEqual(HLC.compare(hlc1, hlc2), -1);
  assert.strictEqual(HLC.compare(hlc2, hlc1), 1);
  assert.strictEqual(HLC.compare(hlc3, hlc2), 1);
  assert.strictEqual(HLC.compare(hlc1, hlc1), 0);
  console.log('[PASS] Test 3');

  // Test 4: shouldApplyDelta resolution (Last-Write-Wins)
  console.log('Running Test 4: shouldApplyDelta conflict resolution...');
  const localVal = { col_version: 1, sync_hlc: '001719600000000:000001:node_A' };
  
  // Case A: Incoming has higher column version
  const incomingA = { col_version: 2, sync_hlc: '001719600000000:000001:node_A' };
  assert.strictEqual(shouldApplyDelta(localVal, incomingA), true, 'Higher column version must win');

  // Case B: Incoming has lower column version
  const incomingB = { col_version: 0, sync_hlc: '001719600000000:000005:node_A' };
  assert.strictEqual(shouldApplyDelta(localVal, incomingB), false, 'Lower column version must lose even with higher HLC');

  // Case C: Same col version, higher HLC timestamp
  const incomingC = { col_version: 1, sync_hlc: '001719600000000:000002:node_A' };
  assert.strictEqual(shouldApplyDelta(localVal, incomingC), true, 'Higher logical HLC must win');

  // Case D: Same col version, lower HLC timestamp
  const incomingD = { col_version: 1, sync_hlc: '001719599999999:000009:node_A' };
  assert.strictEqual(shouldApplyDelta(localVal, incomingD), false, 'Lower HLC timestamp must lose');
  console.log('[PASS] Test 4');

  console.log('\n======================================');
  console.log('  ALL CRDT AND HLC TESTS PASSED OK');
  console.log('======================================');
} catch (err) {
  console.error('\n[FAIL] Test suite crashed with error:', err.message);
  process.exit(1);
}