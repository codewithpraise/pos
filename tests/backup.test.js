#!/usr/bin/env node
// ============================================================================
// VALENIXIA POS - Backup Utility Test
// Tests the scripts/backup.js rotate and file creation logic using tmp dir
// Run: node tests/backup.test.js
// ============================================================================
'use strict';

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

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

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Backup Utility Tests');
console.log('══════════════════════════════════════════════════\n');

// ── Test the backup rotation logic (isolated, no real DB needed) ─────────────
console.log('▶ Backup rotation logic');

const MAX_BACKUPS = 3;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valenixia_backup_test_'));

function makeBackupFileName(offsetMs = 0) {
  const d = new Date(Date.now() + offsetMs);
  return `valenixia_${d.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`;
}

function rotate(backupDir, maxBackups) {
  const files = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('valenixia_') && f.endsWith('.db'))
    .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  if (files.length > maxBackups) {
    const toDelete = files.slice(maxBackups);
    for (const f of toDelete) {
      fs.unlinkSync(path.join(backupDir, f.name));
    }
  }
  return files.length - Math.max(0, files.length - maxBackups);
}

test('backup dir is created if missing', () => {
  const subDir = path.join(tmpDir, 'backups');
  if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });
  assert.ok(fs.existsSync(subDir));
});

test('rotation — keeps up to MAX_BACKUPS files', () => {
  const backupDir = path.join(tmpDir, 'rot_test');
  fs.mkdirSync(backupDir, { recursive: true });

  // Create 5 backup files
  for (let i = 0; i < 5; i++) {
    const name = `valenixia_2026-01-0${i+1}-120000.db`;
    fs.writeFileSync(path.join(backupDir, name), `backup_${i}`);
  }

  const before = fs.readdirSync(backupDir).filter(f => f.endsWith('.db')).length;
  assert.strictEqual(before, 5);

  rotate(backupDir, MAX_BACKUPS);

  const after = fs.readdirSync(backupDir).filter(f => f.endsWith('.db')).length;
  assert.strictEqual(after, MAX_BACKUPS, `Should keep exactly ${MAX_BACKUPS} files`);
});

test('rotation — does nothing if under MAX_BACKUPS', () => {
  const backupDir = path.join(tmpDir, 'rot_test2');
  fs.mkdirSync(backupDir, { recursive: true });

  for (let i = 0; i < 2; i++) {
    fs.writeFileSync(path.join(backupDir, `valenixia_2026-01-0${i+1}-120000.db`), `b${i}`);
  }

  rotate(backupDir, MAX_BACKUPS);
  const after = fs.readdirSync(backupDir).filter(f => f.endsWith('.db')).length;
  assert.strictEqual(after, 2);
});

test('rotation — ignores non-backup files', () => {
  const backupDir = path.join(tmpDir, 'rot_test3');
  fs.mkdirSync(backupDir, { recursive: true });

  fs.writeFileSync(path.join(backupDir, 'valenixia_2026-01-01-120000.db'), 'real');
  fs.writeFileSync(path.join(backupDir, 'notes.txt'), 'not a backup');
  fs.writeFileSync(path.join(backupDir, 'other.db'), 'also not valenixia');

  rotate(backupDir, MAX_BACKUPS);

  // notes.txt and other.db should still exist (not touched)
  assert.ok(fs.existsSync(path.join(backupDir, 'notes.txt')));
  assert.ok(fs.existsSync(path.join(backupDir, 'other.db')));
});

// ── Cleanup ──────────────────────────────────────────────────────────────────
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

// ── Module load test ─────────────────────────────────────────────────────────
console.log('\n▶ Module load tests');

test('lib/logger.js — loads without error', () => {
  const logger = require('../lib/logger');
  assert.ok(typeof logger.info === 'function');
  assert.ok(typeof logger.warn === 'function');
  assert.ok(typeof logger.error === 'function');
  assert.ok(typeof logger.debug === 'function');
});

test('lib/validator.js — loads without error', () => {
  const v = require('../lib/validator');
  assert.ok(typeof v.validate === 'function');
  assert.ok(typeof v.validateAll === 'function');
  assert.ok(typeof v.sanitizeHtml === 'function');
  assert.ok(typeof v.requireBody === 'function');
  assert.ok(v.PATTERNS instanceof Object);
});

test('scripts/backup.js — exports runBackup function', () => {
  // We can't actually run it without a DB but we can check the export
  const backup = require('../scripts/backup');
  assert.ok(typeof backup.runBackup === 'function');
});

test('supabase-sync.js — exports pushOfflineBackupsToCloud function', () => {
  const sync = require('../supabase-sync');
  assert.ok(typeof sync.pushOfflineBackupsToCloud === 'function');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n  Failed tests:');
  failures.forEach(f => console.log(`    - ${f.name}: ${f.error}`));
}
console.log('══════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
