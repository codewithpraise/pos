#!/usr/bin/env node
// ============================================================================
// NEXOVA POS - Self-contained Unit & Integration Test Suite
// Zero-dependency — uses Node.js built-in `assert` module
// Run: node tests/unit.test.js
// ============================================================================
'use strict';

const assert = require('assert');
const path   = require('path');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}\n     ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}\n     ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════');
console.log('  NEXOVA POS — Unit Tests');
console.log('══════════════════════════════════════════════════\n');

// ── 1. Validator Tests ───────────────────────────────────────────────────────
console.log('▶ lib/validator.js');
const { validate, validateAll, sanitizeHtml, PATTERNS } = require('../lib/validator');

test('STORE_NAME — valid 2-80 char name accepted', () => {
  const r = validate('STORE_NAME', 'Ali Bhai Store');
  assert.strictEqual(r.ok, true, r.error);
});
test('STORE_NAME — empty string rejected', () => {
  assert.strictEqual(validate('STORE_NAME', '').ok, false);
});
test('STORE_NAME — single char rejected', () => {
  assert.strictEqual(validate('STORE_NAME', 'A').ok, false);
});
test('ADMIN_PIN — 4-digit numeric PIN accepted', () => {
  assert.strictEqual(validate('ADMIN_PIN', '1234').ok, true);
});
test('ADMIN_PIN — 12-digit numeric PIN accepted', () => {
  assert.strictEqual(validate('ADMIN_PIN', '123456789012').ok, true);
});
test('ADMIN_PIN — letters rejected', () => {
  assert.strictEqual(validate('ADMIN_PIN', 'abcd').ok, false);
});
test('ADMIN_PIN — 3 digits rejected', () => {
  assert.strictEqual(validate('ADMIN_PIN', '123').ok, false);
});
test('SYNC_PASSPHRASE — 8-char printable accepted', () => {
  assert.strictEqual(validate('SYNC_PASSPHRASE', 'Ab1!Ab1!').ok, true);
});
test('SYNC_PASSPHRASE — 7-char rejected (too short)', () => {
  assert.strictEqual(validate('SYNC_PASSPHRASE', 'Ab1!Ab1').ok, false);
});
test('TAX_RATE — 0 accepted', () => {
  assert.strictEqual(validate('TAX_RATE', '0').ok, true);
});
test('TAX_RATE — 17.5 accepted', () => {
  assert.strictEqual(validate('TAX_RATE', '17.5').ok, true);
});
test('TAX_RATE — 100 accepted', () => {
  assert.strictEqual(validate('TAX_RATE', '100').ok, true);
});
test('TAX_RATE — 101 rejected', () => {
  assert.strictEqual(validate('TAX_RATE', '101').ok, false);
});
test('UUID — valid UUID v4 accepted', () => {
  assert.strictEqual(validate('UUID', '550e8400-e29b-41d4-a716-446655440000').ok, true);
});
test('UUID — non-UUID rejected', () => {
  assert.strictEqual(validate('UUID', 'not-a-uuid').ok, false);
});
test('VAL_TYPE — string accepted', () => {
  assert.strictEqual(validate('VAL_TYPE', 'string').ok, true);
});
test('VAL_TYPE — number accepted', () => {
  assert.strictEqual(validate('VAL_TYPE', 'number').ok, true);
});
test('VAL_TYPE — boolean accepted', () => {
  assert.strictEqual(validate('VAL_TYPE', 'boolean').ok, true);
});
test('VAL_TYPE — object accepted', () => {
  assert.strictEqual(validate('VAL_TYPE', 'object').ok, true);
});
test('VAL_TYPE — arbitrary string rejected', () => {
  assert.strictEqual(validate('VAL_TYPE', 'integer').ok, false);
});
test('validateAll — returns multiple errors', () => {
  const r = validateAll({ pin: { rule: 'ADMIN_PIN', value: 'xx' }, name: { rule: 'STORE_NAME', value: 'A' } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.errors.length, 2);
});
test('validateAll — passes when all fields valid', () => {
  const r = validateAll({ pin: { rule: 'ADMIN_PIN', value: '9999' }, name: { rule: 'STORE_NAME', value: 'My Shop' } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.errors.length, 0);
});
test('sanitizeHtml — strips script tags', () => {
  const result = sanitizeHtml('<script>alert(1)</script>Hello');
  assert.ok(!result.includes('<script'), `Should not contain <script: "${result}"`);
  assert.ok(result.includes('Hello'));
});
test('sanitizeHtml — strips HTML tags', () => {
  const result = sanitizeHtml('<b>Bold</b> text');
  assert.strictEqual(result, 'Bold text');
});
test('sanitizeHtml — encodes ampersand', () => {
  const result = sanitizeHtml('a & b');
  assert.ok(result.includes('&amp;'));
});
test('sanitizeHtml — handles non-string gracefully', () => {
  assert.strictEqual(sanitizeHtml(null), '');
  assert.strictEqual(sanitizeHtml(undefined), '');
});

// ── 2. Logger Tests ──────────────────────────────────────────────────────────
console.log('\n▶ lib/logger.js');
const logger = require('../lib/logger');

test('logger.info — does not throw', () => {
  assert.doesNotThrow(() => logger.info('Test', 'info message', { key: 'val' }));
});
test('logger.warn — does not throw', () => {
  assert.doesNotThrow(() => logger.warn('Test', 'warn message'));
});
test('logger.error — does not throw with Error object', () => {
  assert.doesNotThrow(() => logger.error('Test', 'error message', new Error('test error')));
});
test('logger.debug — does not throw', () => {
  assert.doesNotThrow(() => logger.debug('Test', 'debug message'));
});

// ── 3. Type Inference Logic Tests ────────────────────────────────────────────
console.log('\n▶ Type inference engine (mirrors database.js / client-db.js logic)');

function inferType(val) {
  if (val === null || val === undefined) return 'string';
  if (val === 'true' || val === 'false') return 'boolean';
  if (val !== '' && !isNaN(Number(val)) && !/^\s*$/.test(val)) return 'number';
  if ((val.startsWith('{') && val.endsWith('}')) || (val.startsWith('[') && val.endsWith(']'))) {
    try { JSON.parse(val); return 'object'; } catch (_) {}
  }
  return 'string';
}

function parseValue(val, valType) {
  if (val === null) return null;
  let type = valType;
  if (!type || type === 'string') type = inferType(val);
  if (type === 'number') return Number(val);
  if (type === 'boolean') return (val === 'true' || val === '1' || val === 1);
  if (type === 'object') { try { return JSON.parse(val); } catch (_) { return val; } }
  return val;
}

test('inferType — "true" → boolean', () => assert.strictEqual(inferType('true'), 'boolean'));
test('inferType — "false" → boolean', () => assert.strictEqual(inferType('false'), 'boolean'));
test('inferType — "123" → number', () => assert.strictEqual(inferType('123'), 'number'));
test('inferType — "1.5" → number', () => assert.strictEqual(inferType('1.5'), 'number'));
test('inferType — "0" → number', () => assert.strictEqual(inferType('0'), 'number'));
test('inferType — "-99" → number', () => assert.strictEqual(inferType('-99'), 'number'));
test('inferType — "" → string (not number)', () => assert.strictEqual(inferType(''), 'string'));
test('inferType — "  " → string (whitespace, not number)', () => assert.strictEqual(inferType('  '), 'string'));
test('inferType — "{}" → object', () => assert.strictEqual(inferType('{}'), 'object'));
test('inferType — "[]" → object', () => assert.strictEqual(inferType('[]'), 'object'));
test('inferType — valid JSON string → object', () => assert.strictEqual(inferType('{"a":1}'), 'object'));
test('inferType — invalid JSON → string', () => assert.strictEqual(inferType('{bad json}'), 'string'));
test('inferType — plain text → string', () => assert.strictEqual(inferType('Hello World'), 'string'));

test('parseValue — "123" with type number → 123 (number)', () => {
  assert.strictEqual(parseValue('123', 'number'), 123);
  assert.strictEqual(typeof parseValue('123', 'number'), 'number');
});
test('parseValue — "true" with type boolean → true (boolean)', () => {
  assert.strictEqual(parseValue('true', 'boolean'), true);
  assert.strictEqual(typeof parseValue('true', 'boolean'), 'boolean');
});
test('parseValue — "false" with type boolean → false (boolean)', () => {
  assert.strictEqual(parseValue('false', 'boolean'), false);
});
test('parseValue — "1" with type boolean → true', () => {
  assert.strictEqual(parseValue('1', 'boolean'), true);
});
test('parseValue — JSON with type object → parsed object', () => {
  const r = parseValue('{"x":42}', 'object');
  assert.deepStrictEqual(r, { x: 42 });
});
test('parseValue — null → null', () => {
  assert.strictEqual(parseValue(null, 'string'), null);
});
test('parseValue — "123" with no type → infers number', () => {
  assert.strictEqual(parseValue('123', null), 123);
});
test('parseValue — "true" with no type → infers boolean', () => {
  assert.strictEqual(parseValue('true', null), true);
});
test('parseValue — "hello" with no type → stays string', () => {
  assert.strictEqual(parseValue('hello', null), 'hello');
});

// ── 4. Circuit Breaker Logic Tests ───────────────────────────────────────────
console.log('\n▶ Circuit breaker logic (mirrors supabase-sync.js)');

function makeCircuit(failLimit = 3, resetMs = 500) {
  return {
    failures: 0, openUntil: 0, failLimit, resetMs,
    isOpen() { return Date.now() < this.openUntil; },
    recordFailure() {
      this.failures++;
      if (this.failures >= this.failLimit) {
        this.openUntil = Date.now() + this.resetMs;
      }
    },
    recordSuccess() { this.failures = 0; this.openUntil = 0; }
  };
}

test('circuit — starts closed', () => {
  const c = makeCircuit();
  assert.strictEqual(c.isOpen(), false);
});
test('circuit — opens after failLimit failures', () => {
  const c = makeCircuit(3);
  c.recordFailure(); c.recordFailure(); c.recordFailure();
  assert.strictEqual(c.isOpen(), true);
});
test('circuit — stays closed before failLimit', () => {
  const c = makeCircuit(3);
  c.recordFailure(); c.recordFailure();
  assert.strictEqual(c.isOpen(), false);
});
test('circuit — resets after success', () => {
  const c = makeCircuit(2);
  c.recordFailure(); c.recordFailure();
  assert.strictEqual(c.isOpen(), true);
  c.recordSuccess();
  assert.strictEqual(c.isOpen(), false);
  assert.strictEqual(c.failures, 0);
});

// ── 5. val_type whitelist Tests ───────────────────────────────────────────────
console.log('\n▶ val_type whitelist (mirrors supabase-sync.js validateAndSanitizeChange)');

const VALID_VAL_TYPES = new Set(['string', 'number', 'boolean', 'object']);
function sanitizeChange(row) {
  const valType = row.val_type || 'string';
  if (!VALID_VAL_TYPES.has(valType)) return null;
  return { ...row, val_type: valType };
}

test('whitelist — string accepted', () => assert.notStrictEqual(sanitizeChange({ val_type: 'string' }), null));
test('whitelist — number accepted', () => assert.notStrictEqual(sanitizeChange({ val_type: 'number' }), null));
test('whitelist — boolean accepted', () => assert.notStrictEqual(sanitizeChange({ val_type: 'boolean' }), null));
test('whitelist — object accepted', () => assert.notStrictEqual(sanitizeChange({ val_type: 'object' }), null));
test('whitelist — integer rejected', () => assert.strictEqual(sanitizeChange({ val_type: 'integer' }), null));
test('whitelist — null val_type defaults to string', () => assert.notStrictEqual(sanitizeChange({ val_type: null }), null));
test('whitelist — undefined val_type defaults to string', () => assert.notStrictEqual(sanitizeChange({}), null));
test('whitelist — XSS attempt rejected', () => assert.strictEqual(sanitizeChange({ val_type: '<script>' }), null));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n  Failed tests:');
  failures.forEach(f => console.log(`    - ${f.name}: ${f.error}`));
}
console.log('══════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
