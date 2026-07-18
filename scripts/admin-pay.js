#!/usr/bin/env node
// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - SECURE ADMIN PAYMENT APPROVAL CLI
// Processes pending payments, activates store accounts, and renews licenses.
// ============================================================================

const sqlite3 = require('sqlite3');
const path = require('path');
const readline = require('readline');
const { mintToken } = require('./license-provisioner');

const dbPath = path.join(__dirname, '..', 'valenixia.db');
const db = new sqlite3.Database(dbPath);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function main() {
  console.log('============================================================================');
  console.log(' VALENIXIA POS - ADMIN PAYMENT APPROVAL & LICENSE MINTING CLI');
  console.log('============================================================================\n');
  try {
    const pendings = await query(`
      SELECT p.*, s.name as store_name, s.phone as store_phone 
      FROM pending_payments p 
      JOIN stores s ON p.store_id = s.id 
      WHERE p.status = 'PENDING'
    `);

    if (pendings.length === 0) {
      console.log('No pending payment approvals found in SQLite pending_payments.');
      db.close();
      rl.close();
      return;
    }

    console.log('Pending Payments List:');
    pendings.forEach((p, idx) => {
      console.log(`[${idx + 1}] ID: ${p.id.slice(0,8)}...`);
      console.log(`    Store   : ${p.store_name} (${p.store_phone})`);
      console.log(`    Tier    : ${p.tier} (${p.mode})`);
      console.log(`    Amount  : Rs. ${(p.amount_paid_minor_units / 100).toLocaleString()}`);
      console.log(`    Gateway : ${p.gateway}`);
      console.log(`    RRN     : ${p.transaction_reference}`);
      console.log('----------------------------------------------------------------------------');
    });

    rl.question('\nEnter the index to approve (1-' + pendings.length + '), or press Enter to quit: ', async (answer) => {
      const trimmed = answer.trim();
      if (!trimmed) {
        db.close();
        rl.close();
        return;
      }

      const num = parseInt(trimmed, 10);
      if (isNaN(num) || num < 1 || num > pendings.length) {
        console.error('[ERROR] Invalid index choice.');
        db.close();
        rl.close();
        return;
      }

      const selected = pendings[num - 1];
      console.log(`\nSelected Reference: ${selected.transaction_reference} for Store: ${selected.store_name}`);
      
      rl.question('Type "Approve" to confirm activation: ', async (confirmStr) => {
        if (confirmStr.trim().toLowerCase() !== 'approve') {
          console.log('[INFO] Aborted.');
          db.close();
          rl.close();
          return;
        }

        try {
          const now = Date.now();
          const expiresAt = selected.mode === 'subscription' 
            ? now + 30 * 24 * 60 * 60 * 1000 
            : null;

          // Start a transaction in SQLite
          await run('BEGIN IMMEDIATE;');
          
          // Re-verify that selected payment is still valid and PENDING to prevent race conditions
          const freshPending = await query(
            "SELECT p.*, s.name as store_name FROM pending_payments p JOIN stores s ON p.store_id = s.id WHERE p.id = ? AND p.status = 'PENDING'",
            [selected.id]
          );
          if (!freshPending || freshPending.length === 0) {
            throw new Error(`Pending payment record ${selected.id} is no longer pending or was already processed.`);
          }

          // Update pending_payments status
          await run(
            "UPDATE pending_payments SET status = 'APPROVED', verified_at = ? WHERE id = ?",
            [now, selected.id]
          );

          // Update stores tier, mode, status, and expires_at
          await run(
            "UPDATE stores SET status = 'active', tier = ?, mode = ?, expires_at = ? WHERE id = ?",
            [selected.tier, selected.mode, expiresAt, selected.store_id]
          );

          // Find paired devices for this store and re-mint upgraded license tokens
          const devices = await query("SELECT * FROM devices WHERE store_id = ?", [selected.store_id]);
          if (devices.length > 0) {
            console.log(`Re-minting license tokens for ${devices.length} registered terminal device(s)...`);
            const days = selected.mode === 'subscription' ? (selected.tier === 'TRIAL' ? 3 : 30) : null;
            for (const dev of devices) {
              const { token } = mintToken(selected.store_id, dev.hardware_id, selected.tier, selected.mode, days, 'active');
              await run("UPDATE stores SET license_key = ? WHERE id = ?", [token, selected.store_id]);
            }
          } else {
            console.log('[INFO] Store status set to active; token will automatically mint on first device activation.');
          }

          await run('COMMIT;');
          console.log('\n[SUCCESS] Payment successfully approved. Store is now active.');
        } catch (err) {
          try { await run('ROLLBACK;'); } catch (e) {}
          console.error('[ERROR] Failed to approve payment:', err.message);
        } finally {
          db.close();
          rl.close();
        }
      });
    });

  } catch (err) {
    console.error('[ERROR] Exception during execution:', err.message);
    db.close();
    rl.close();
  }
}

main();
