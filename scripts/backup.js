#!/usr/bin/env node
// ============================================================================
// VALENIXIA POS - SQLite Online Backup Utility
// Uses SQLite's VACUUM INTO for a crash-safe, warm online copy.
// Run via: node scripts/backup.js
// ============================================================================

'use strict';

const path = require('path');
const fs   = require('fs');
const { db } = require('../database');

const BACKUP_DIR  = path.resolve(__dirname, '../backups');
const DB_PATH     = path.resolve(__dirname, '../valenixia.db');
const MAX_BACKUPS = parseInt(process.env.MAX_BACKUPS || '7');  // keep last N copies

function timestamp() {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function runBackup() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const backupPath = path.join(BACKUP_DIR, `valenixia_${timestamp()}.db`);
  
  // Enforce SQLite index maintenance pass as part of daily background backup instead of startup
  console.log('[Backup] Executing SQLite index maintenance pass (REINDEX, VACUUM, ANALYZE)...');
  try {
    await db.exec('PRAGMA reindex;');
    await db.exec('PRAGMA vacuum;');
    await db.exec('PRAGMA analyze;');
    console.log('[Backup] SQLite index maintenance pass completed.');
  } catch (err) {
    console.warn('[Backup] SQLite index maintenance pass bypassed:', err.message);
  }

  console.log(`[Backup] Starting online backup → ${backupPath}`);

  try {
    // VACUUM INTO creates a defragmented, consistent copy while DB is live
    await db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

    // Verify backup integrity
    const sqlite3 = require('sqlite3').verbose();
    const backupDb = new sqlite3.Database(backupPath);
    const checkResult = await new Promise((resolve, reject) => {
      backupDb.get('PRAGMA integrity_check', (err, row) => {
        backupDb.close();
        if (err) return reject(err);
        resolve(row.integrity_check);
      });
    });

    if (checkResult !== 'ok') {
      throw new Error(`Backup failed integrity_check: ${checkResult}`);
    }
    console.log('[Backup] Integrity check passed.');

    const stat = fs.statSync(backupPath);
    console.log(`[Backup] Backup completed. Size: ${(stat.size / 1024).toFixed(1)} KB`);

    // Rotate old backups — keep only the most recent MAX_BACKUPS files
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('valenixia_') && f.endsWith('.db'))
      .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    if (files.length > MAX_BACKUPS) {
      const toDelete = files.slice(MAX_BACKUPS);
      for (const f of toDelete) {
        fs.unlinkSync(path.join(BACKUP_DIR, f.name));
        console.log(`[Backup] Pruned old backup: ${f.name}`);
      }
    }

    return backupPath;
  } catch (err) {
    console.error('[Backup] Backup failed:', err.message);
    // Remove partial file if it exists
    if (fs.existsSync(backupPath)) {
      try { fs.unlinkSync(backupPath); } catch (_) {}
    }
    throw err;
  }
}

// Run immediately if called directly
if (require.main === module) {
  runBackup()
    .then(p => { console.log('[Backup] Done:', p); process.exit(0); })
    .catch(err => { console.error('[Backup] Fatal:', err.message); process.exit(1); });
}

module.exports = { runBackup };
