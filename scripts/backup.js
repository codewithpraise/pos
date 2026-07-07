#!/usr/bin/env node
// ============================================================================
// NEXOVA POS - SQLite Online Backup Utility
// Uses SQLite's VACUUM INTO for a crash-safe, warm online copy.
// Run via: node scripts/backup.js
// ============================================================================

'use strict';

const path = require('path');
const fs   = require('fs');
const { db } = require('../database');

const BACKUP_DIR  = path.resolve(__dirname, '../backups');
const DB_PATH     = path.resolve(__dirname, '../nexova.db');
const MAX_BACKUPS = parseInt(process.env.MAX_BACKUPS || '7');  // keep last N copies

function timestamp() {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function runBackup() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const backupPath = path.join(BACKUP_DIR, `nexova_${timestamp()}.db`);
  console.log(`[Backup] Starting online backup → ${backupPath}`);

  try {
    // VACUUM INTO creates a defragmented, consistent copy while DB is live
    await db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

    const stat = fs.statSync(backupPath);
    console.log(`[Backup] Backup completed. Size: ${(stat.size / 1024).toFixed(1)} KB`);

    // Rotate old backups — keep only the most recent MAX_BACKUPS files
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('nexova_') && f.endsWith('.db'))
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
