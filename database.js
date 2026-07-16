// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - SECURE LOCAL DATABASE LAYER (WAL MODE)
// Powered by SQLite with asynchronous Promise wrappers & change logging
// ============================================================================

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const { HLC, shouldApplyDelta } = require('./crdt-engine');

const dbPath = path.join(__dirname, 'valenixia.db');
let sqliteDb = null;
let currentHlc = null;
let currentDbVersion = 0; // Incremented on each local transaction change

// Schema version: increment when adding columns/tables that clients must have before syncing
const SERVER_SCHEMA_VERSION = 11;
module.exports && Object.assign(module.exports, { SERVER_SCHEMA_VERSION });

// Secure PBKDF2 password hashing helper (OWASP approved, zero external dependencies)
function hashPin(pin, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(pin, salt, 100000, 64, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

// Timing-safe PIN verification using crypto.timingSafeEqual to prevent timing attacks.
// Both buffers must be the same length; if not, return false immediately (no timing leak
// because the PBKDF2 hash is always 128 hex chars — length differences only occur if the
// stored hash is corrupt, which is a hard fail regardless).
function verifyPin(pin, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, hash] = storedHash.split(':');
  const checkHash = crypto.pbkdf2Sync(pin, salt, 100000, 64, 'sha256').toString('hex');
  // Use timingSafeEqual to prevent timing oracle attacks on PIN comparison
  const hashBuf  = Buffer.from(hash,      'utf8');
  const checkBuf = Buffer.from(checkHash, 'utf8');
  if (hashBuf.length !== checkBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, checkBuf);
}

// Database-backed PIN brute-force prevention helpers
async function checkPinLockout(attemptKey) {
  const row = await db.get("SELECT attempt_count, lockout_until FROM pin_lockout_log WHERE attempt_key = ?", [attemptKey]);
  if (!row) return { locked: false, minsLeft: 0 };
  if (row.lockout_until && row.lockout_until > Date.now()) {
    const minsLeft = Math.ceil((row.lockout_until - Date.now()) / 60000);
    return { locked: true, minsLeft };
  }
  // Lockout expired - clean up or return unlocked
  if (row.lockout_until && row.lockout_until <= Date.now()) {
    await db.run("UPDATE pin_lockout_log SET attempt_count = 0, lockout_until = NULL WHERE attempt_key = ?", [attemptKey]);
  }
  return { locked: false, minsLeft: 0 };
}

async function recordPinFailure(attemptKey, maxAttempts = 5, lockoutMinutes = 15) {
  const now = Date.now();
  const row = await db.get("SELECT attempt_count FROM pin_lockout_log WHERE attempt_key = ?", [attemptKey]);
  if (!row) {
    await db.run(
      "INSERT INTO pin_lockout_log (attempt_key, attempt_count, lockout_until, last_attempt_at, created_at) VALUES (?, 1, NULL, ?, ?)",
      [attemptKey, now, now]
    );
  } else {
    const newCount = row.attempt_count + 1;
    let lockoutUntil = null;
    if (newCount >= maxAttempts) {
      lockoutUntil = now + (lockoutMinutes * 60000);
    }
    await db.run(
      "UPDATE pin_lockout_log SET attempt_count = ?, lockout_until = ?, last_attempt_at = ? WHERE attempt_key = ?",
      [newCount, lockoutUntil, now, attemptKey]
    );
  }
}

async function clearPinLockout(attemptKey) {
  await db.run("DELETE FROM pin_lockout_log WHERE attempt_key = ?", [attemptKey]);
}


// Strict in-process Write Queue to serialize database writes & prevent interleaved transactions in WAL mode
const writeQueue = {
  queue: Promise.resolve(),
  enqueue(op) {
    // Create chain link that returns the result of the operation
    const nextLink = this.queue.then(() => op());
    // Keep the queue moving even if this operation failed
    this.queue = nextLink.catch(() => {});
    return nextLink;
  }
};

// Asynchronous wrapper for sqlite3 commands (enforces write queue serialization)
const db = {
  run(sql, params = []) {
    return writeQueue.enqueue(() => new Promise((resolve, reject) => {
      sqliteDb.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    }));
  },
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      sqliteDb.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      sqliteDb.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  exec(sql) {
    return writeQueue.enqueue(() => new Promise((resolve, reject) => {
      sqliteDb.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    }));
  },
  async beginImmediate() {
    // Serialise the transaction lock through the writeQueue so BEGIN IMMEDIATE
    // cannot race with other enqueued writes.
    return writeQueue.enqueue(async () => {
      await new Promise((resolve, reject) => {
        sqliteDb.run('BEGIN IMMEDIATE TRANSACTION;', (err) => {
          if (err) reject(err); else resolve();
        });
      });
    });
  },
  async commit() {
    await new Promise((resolve, reject) => {
      sqliteDb.run('COMMIT;', (err) => {
        if (err) reject(err); else resolve();
      });
    });
  },
  async rollback() {
    try {
      await new Promise((resolve, reject) => {
        sqliteDb.run('ROLLBACK;', (err) => {
          if (err) reject(err); else resolve();
        });
      });
    } catch (_) { /* safe to swallow — connection may already be clean */ }
  }
};

// No separate Mutex needed — transaction serialisation is handled by writeQueue.enqueue
// in beginImmediate above.

// Initialize Database & WAL mode
async function initDatabase(terminalId) {
  currentHlc = new HLC(terminalId || 'terminal_pc_01');
  
  // Migration check: Copy old valenixia.db if it exists and valenixia.db doesn't
  const oldDbPath = path.join(__dirname, 'valenixia.db');
  if (fs.existsSync(oldDbPath) && !fs.existsSync(dbPath)) {
    try {
      fs.copyFileSync(oldDbPath, dbPath);
      console.log('[Database] Migrated valenixia.db to valenixia.db successfully.');
    } catch (err) {
      console.error('[Database] Failed to migrate valenixia.db to valenixia.db:', err.message);
    }
  }

  sqliteDb = new sqlite3.Database(dbPath);
  
  // Enable WAL + maximum durability under power failure
  await db.exec('PRAGMA journal_mode = WAL;');
  await db.exec('PRAGMA foreign_keys = ON;');
  await db.exec('PRAGMA synchronous = FULL;');  // Survive sudden power cuts at cost of ~10% write speed
  await db.exec('PRAGMA busy_timeout = 5000;');
  await db.exec('PRAGMA journal_size_limit = 6144000;');

  try { await db.exec('PRAGMA strict = ON;'); } catch(e) {} // SQLite ≥3.37 strict type enforcement

  console.log('[Database] Schema version:', SERVER_SCHEMA_VERSION);
  console.log('[Database] Executing SQLite index maintenance pass...');
  try {
    await db.exec('PRAGMA reindex;');
    await db.exec('PRAGMA vacuum;');
    await db.exec('PRAGMA analyze;');
    console.log('[Database] SQLite optimization pass completed.');
  } catch (err) {
    console.warn('[Database] SQLite optimization pass was bypassed:', err.message);
  }
  
  // 1. Ensure local_preferences table exists first so we can track schema version
  await db.exec(`
    CREATE TABLE IF NOT EXISTS local_preferences (
      key TEXT PRIMARY KEY,
      value_type TEXT,
      val_type TEXT DEFAULT 'string',
      value_payload TEXT,
      is_idempotent_flag INTEGER,
      updated_at INTEGER
    );
  `);

  // Ensure val_type column exists (in case the table was created by an older schema version)
  try {
    const columns = await db.all("PRAGMA table_info(local_preferences)");
    if (!columns.some(col => col.name === 'val_type')) {
      await db.exec("ALTER TABLE local_preferences ADD COLUMN val_type TEXT DEFAULT 'string'");
    }
  } catch (e) {
    console.warn('[Database] Failed to check/add val_type to local_preferences:', e.message);
  }

  // 2. Read current schema version from local_preferences
  let currentVersion = 0;
  try {
    const row = await db.get("SELECT value_payload FROM local_preferences WHERE key = 'schema_version'");
    if (row && row.value_payload) {
      currentVersion = parseInt(row.value_payload) || 0;
    }
  } catch (e) {
    // If column value_payload didn't exist or table has issue, default to 0
  }

  console.log(`[Database] Startup schema version check: current = v${currentVersion}, target = v${SERVER_SCHEMA_VERSION}`);

  // 3. Run incremental migrations
  for (let v = currentVersion + 1; v <= SERVER_SCHEMA_VERSION; v++) {
    console.log(`[Database] Migrating database schema to version v${v}...`);
    if (v === 1) {
      // Create all basic domain tables
      await db.exec(`
        -- Domain 1: Transaction & LineItem Core Ledger
        CREATE TABLE IF NOT EXISTS transactions (
          id TEXT PRIMARY KEY,
          employee_id TEXT,
          terminal_id TEXT,
          subtotal_minor_units INTEGER,
          tax_minor_units INTEGER,
          total_minor_units INTEGER,
          status TEXT, -- DRAFT, HELD, COMPLETED, VOIDED
          payment_mode TEXT DEFAULT 'CASH',
          payment_details TEXT DEFAULT '',
          created_at INTEGER,
          updated_at INTEGER,
          sync_hlc TEXT,
          is_dirty INTEGER,
          is_deleted INTEGER
        );

        CREATE TABLE IF NOT EXISTS line_items (
          id TEXT PRIMARY KEY,
          transaction_id TEXT,
          sku TEXT,
          quantity INTEGER,
          unit_price_minor_units INTEGER,
          applied_discount_minor_units INTEGER,
          sync_hlc TEXT,
          is_deleted INTEGER,
          FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
          FOREIGN KEY(sku) REFERENCES inventory_catalog(sku) ON DELETE RESTRICT
        );

        -- Domain 2: Inventory & Stock Management
        CREATE TABLE IF NOT EXISTS inventory_catalog (
          sku TEXT PRIMARY KEY,
          gtin TEXT UNIQUE,
          name TEXT,
          base_price_minor_units INTEGER,
          stock_level INTEGER,
          reserved_stock INTEGER,
          search_vector TEXT,
          col_version INTEGER,
          sync_hlc TEXT
        );

        -- Domain 3: Employee Access & Security
        CREATE TABLE IF NOT EXISTS employees (
          id TEXT PRIMARY KEY,
          auth_hash TEXT,
          biometric_token TEXT,
          role TEXT, -- CASHIER, MANAGER, ADMIN
          is_active INTEGER,
          sync_hlc TEXT
        );

        -- Domain 4: Sync Queues & CRDT Delta payloads
        CREATE TABLE IF NOT EXISTS crsql_changes (
          table_name TEXT,
          pk TEXT,
          cid TEXT,
          val TEXT,
          col_version INTEGER,
          db_version INTEGER,
          site_id TEXT,
          cl INTEGER, -- causal length (1 for active, 0 for tombstone/delete)
          sync_hlc TEXT,
          PRIMARY KEY (table_name, pk, cid)
        );

        -- Domain 5: Speech Analytics & Fraud Logs
        CREATE TABLE IF NOT EXISTS speech_analytics_logs (
          id TEXT PRIMARY KEY,
          transaction_id TEXT,
          utterance_duration_ms INTEGER,
          speaker_diarization_tag TEXT,
          filler_word_count INTEGER,
          sentiment_score REAL,
          flagged_fraud_risk INTEGER,
          disfluency_markers TEXT, -- JSON Array
          sync_hlc TEXT,
          FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
        );

        -- Domain 7: Customers
        CREATE TABLE IF NOT EXISTS customers (
          id TEXT PRIMARY KEY,
          name TEXT,
          phone TEXT,
          email TEXT,
          total_spend_cents INTEGER DEFAULT 0,
          visits INTEGER DEFAULT 0,
          created_at INTEGER,
          sync_hlc TEXT
        );

        -- Domain 8: Categories
        CREATE TABLE IF NOT EXISTS categories (
          name TEXT PRIMARY KEY,
          sync_hlc TEXT
        );

        -- Domain 9: Stock Movements
        CREATE TABLE IF NOT EXISTS stock_movements (
          id TEXT PRIMARY KEY,
          sku TEXT,
          change_qty INTEGER,
          reason TEXT,
          created_at INTEGER,
          sync_hlc TEXT
        );

        -- Domain 10: Employee Shifts
        CREATE TABLE IF NOT EXISTS employee_shifts (
          id TEXT PRIMARY KEY,
          employee_id TEXT,
          clock_in INTEGER,
          clock_out INTEGER,
          sync_hlc TEXT
        );

        -- Domain 11: Approved Devices Whitelist
        CREATE TABLE IF NOT EXISTS approved_devices (
          node_id TEXT PRIMARY KEY,
          device_name TEXT,
          user_agent TEXT,
          approved_at INTEGER,
          status TEXT
        );

        -- Domain 12: Distributors (Suppliers)
        CREATE TABLE IF NOT EXISTS distributors (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          phone TEXT,
          email TEXT,
          address TEXT,
          credit_limit_minor INTEGER DEFAULT 0,
          notes TEXT,
          created_at INTEGER,
          sync_hlc TEXT,
          is_deleted INTEGER DEFAULT 0
        );

        -- Domain 13: Purchase Orders
        CREATE TABLE IF NOT EXISTS purchase_orders (
          id TEXT PRIMARY KEY,
          distributor_id TEXT NOT NULL,
          status TEXT DEFAULT 'DRAFT', -- DRAFT, SENT, CONFIRMED, PARTIAL, RECEIVED, CANCELLED
          total_minor INTEGER DEFAULT 0,
          notes TEXT,
          expected_delivery INTEGER,
          created_at INTEGER,
          updated_at INTEGER,
          sync_hlc TEXT,
          is_deleted INTEGER DEFAULT 0
        );

        -- Domain 14: Purchase Order Line Items
        CREATE TABLE IF NOT EXISTS po_line_items (
          id TEXT PRIMARY KEY,
          po_id TEXT NOT NULL,
          sku TEXT,
          product_name TEXT,
          quantity_ordered INTEGER,
          quantity_received INTEGER DEFAULT 0,
          unit_cost_minor INTEGER,
          sync_hlc TEXT,
          is_deleted INTEGER DEFAULT 0
        );

        -- Domain 15: Distributor Payments
        CREATE TABLE IF NOT EXISTS distributor_payments (
          id TEXT PRIMARY KEY,
          distributor_id TEXT NOT NULL,
          po_id TEXT,
          amount_minor INTEGER NOT NULL,
          payment_method TEXT DEFAULT 'CASH',
          reference_note TEXT,
          paid_at INTEGER,
          sync_hlc TEXT,
          is_deleted INTEGER DEFAULT 0
        );

        -- Domain 16: Customer Credit Ledger (Udhaar/Khata)
        CREATE TABLE IF NOT EXISTS customer_credit (
          id TEXT PRIMARY KEY,
          customer_id TEXT NOT NULL,
          transaction_id TEXT,
          type TEXT, -- CREDIT, PAYMENT
          amount_minor INTEGER NOT NULL,
          payment_method TEXT DEFAULT 'CASH',
          due_date INTEGER,
          notes TEXT,
          created_at INTEGER,
          sync_hlc TEXT,
          is_deleted INTEGER DEFAULT 0
        );

        -- Domain 17: FBR E-Invoice Offline Submission Queue (Rule 150XC)
        CREATE TABLE IF NOT EXISTS fbr_submissions (
          id TEXT PRIMARY KEY,
          transaction_id TEXT NOT NULL,
          invoice_number TEXT NOT NULL,
          usin TEXT,
          invoice_payload TEXT NOT NULL,
          total_minor INTEGER NOT NULL,
          tax_minor INTEGER NOT NULL,
          status TEXT DEFAULT 'PENDING',
          retry_count INTEGER DEFAULT 0,
          fbr_response TEXT,
          fbr_response_code INTEGER,
          fbr_error_details TEXT,
          created_at INTEGER NOT NULL,
          submitted_at INTEGER,
          sync_hlc TEXT
        );

        CREATE TABLE IF NOT EXISTS aborted_sales_log (
          id TEXT PRIMARY KEY,
          cashier_id TEXT,
          manager_id TEXT,
          items_json TEXT,
          total_minor INTEGER,
          void_reason TEXT,
          created_at INTEGER,
          sync_hlc TEXT
        );

        CREATE TABLE IF NOT EXISTS telemetry_logs (
          id TEXT PRIMARY KEY,
          node_id TEXT,
          error_type TEXT,
          error_message TEXT,
          stack_trace TEXT,
          hlc TEXT,
          last_clicks TEXT,
          created_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS license_store (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS stores (
          id TEXT PRIMARY KEY,
          phone TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          tier TEXT NOT NULL DEFAULT 'TRIAL',
          mode TEXT NOT NULL DEFAULT 'subscription',
          status TEXT NOT NULL DEFAULT 'active',
          expires_at INTEGER, -- Unix timestamp in ms
          license_key TEXT,
          hardware_limit INTEGER
        );

        CREATE TABLE IF NOT EXISTS devices (
          id TEXT PRIMARY KEY,
          store_id TEXT,
          hardware_id TEXT UNIQUE NOT NULL,
          device_name TEXT NOT NULL,
          is_active INTEGER DEFAULT 1,
          FOREIGN KEY(store_id) REFERENCES stores(id)
        );

        CREATE TABLE IF NOT EXISTS activation_codes (
          code TEXT PRIMARY KEY,
          store_id TEXT,
          phone TEXT NOT NULL,
          is_used INTEGER DEFAULT 0,
          expires_at INTEGER NOT NULL, -- Unix timestamp in ms
          FOREIGN KEY(store_id) REFERENCES stores(id)
        );

        CREATE TABLE IF NOT EXISTS pending_payments (
          id TEXT PRIMARY KEY,
          store_id TEXT,
          tier TEXT NOT NULL,
          mode TEXT NOT NULL,
          amount_paid_minor_units INTEGER NOT NULL,
          gateway TEXT NOT NULL,
          transaction_reference TEXT UNIQUE NOT NULL,
          status TEXT DEFAULT 'PENDING',
          verification_notes TEXT,
          created_at INTEGER,
          verified_at INTEGER,
          FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
        );
      `);
    } else if (v === 2) {
      // Run ALTER TABLE operations to support incremental column additions
      const alters = [
        "ALTER TABLE inventory_catalog ADD COLUMN category TEXT DEFAULT 'Uncategorized';",
        "ALTER TABLE inventory_catalog ADD COLUMN emoji TEXT DEFAULT '';",
        "ALTER TABLE inventory_catalog ADD COLUMN cost_price_minor_units INTEGER DEFAULT 0;",
        "ALTER TABLE transactions ADD COLUMN payment_mode TEXT DEFAULT 'CASH';",
        "ALTER TABLE transactions ADD COLUMN payment_details TEXT DEFAULT '';",
        "ALTER TABLE employee_shifts ADD COLUMN declared_cash_minor_units INTEGER DEFAULT 0;",
        "ALTER TABLE employee_shifts ADD COLUMN expected_cash_minor_units INTEGER DEFAULT 0;",
        "ALTER TABLE employee_shifts ADD COLUMN variance_minor_units INTEGER DEFAULT 0;",
        "ALTER TABLE inventory_catalog ADD COLUMN is_deleted INTEGER DEFAULT 0;",
        "ALTER TABLE employees ADD COLUMN is_deleted INTEGER DEFAULT 0;",
        "ALTER TABLE customers ADD COLUMN is_deleted INTEGER DEFAULT 0;",
        "ALTER TABLE transactions ADD COLUMN discount_minor_units INTEGER DEFAULT 0;",
        "ALTER TABLE inventory_catalog ADD COLUMN low_stock_threshold INTEGER DEFAULT 10;",
        "ALTER TABLE inventory_catalog ADD COLUMN stock_additions INTEGER DEFAULT 0;",
        "ALTER TABLE inventory_catalog ADD COLUMN stock_subtractions INTEGER DEFAULT 0;",
        "ALTER TABLE transactions ADD COLUMN voided_transaction_id TEXT;",
        "ALTER TABLE transactions ADD COLUMN void_reason TEXT;",
        "ALTER TABLE fbr_submissions ADD COLUMN usin TEXT;",
        "ALTER TABLE fbr_submissions ADD COLUMN fbr_response_code INTEGER;",
        "ALTER TABLE fbr_submissions ADD COLUMN fbr_error_details TEXT;"
      ];
      for (const sql of alters) {
        // Parse table and column name from ALTER TABLE statement to guard with PRAGMA
        const match = sql.match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/);
        if (match) {
          const [, tbl, col] = match;
          const cols = await db.all(`PRAGMA table_info(${tbl})`);
          const exists = cols.some(c => c.name === col);
          if (exists) continue; // Column already present — skip safely
        }
        try { await db.exec(sql); } catch (e) {
          console.warn(`[Database] v2 ALTER skipped (${e.message}): ${sql.trim().substring(0, 60)}`);
        }
      }
    } else if (v === 3) {
      // Version 3: Add val_type and backfill it
      try {
        await db.exec("ALTER TABLE crsql_changes ADD COLUMN val_type TEXT DEFAULT 'string';");
      } catch (e) { /* ignore if already exists */ }
      
      // Perform detailed value-type inference backfills
      try {
        const rows = await db.all("SELECT rowid, val FROM crsql_changes WHERE val_type IS NULL OR val_type = 'string'");
        for (const row of rows) {
          let inferredType = 'string';
          const val = row.val;
          if (val === 'true' || val === 'false') {
            inferredType = 'boolean';
          } else if (val !== null && val !== '' && !isNaN(Number(val)) && !/^\s*$/.test(val)) {
            inferredType = 'number';
          } else if (val !== null && ((val.startsWith('{') && val.endsWith('}')) || (val.startsWith('[') && val.endsWith(']')))) {
            try {
              JSON.parse(val);
              inferredType = 'object';
            } catch (jsonErr) {}
          }
          if (inferredType !== 'string') {
            await db.run("UPDATE crsql_changes SET val_type = ? WHERE rowid = ?", [inferredType, row.rowid]);
          }
        }
        console.log(`[Database] Backfilled val_type column values dynamically.`);
      } catch (backfillErr) {
        console.error('[Database] Failed to backfill val_type column in v3 migration:', backfillErr.message);
      }
    } else if (v === 4) {
      // Version 4: Commission Tracking + Persistent Activation Audit Trail
      await db.exec(`
        -- Sales Agent Roster (links to employees table)
        CREATE TABLE IF NOT EXISTS sales_agents (
          id TEXT PRIMARY KEY,
          employee_id TEXT NOT NULL UNIQUE,
          commission_rate_bps INTEGER NOT NULL DEFAULT 300,
          is_active INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL,
          FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE
        );

        -- Per-Activation Commission Ledger
        CREATE TABLE IF NOT EXISTS commission_earnings (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          activation_code TEXT NOT NULL,
          store_id TEXT NOT NULL,
          tier TEXT NOT NULL,
          gross_amount_minor INTEGER NOT NULL,
          commission_minor_units INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING',
          ip_address TEXT,
          fingerprint_hash TEXT,
          activated_at INTEGER NOT NULL,
          paid_at INTEGER,
          reversed_at INTEGER,
          reversal_reason TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY(agent_id) REFERENCES sales_agents(id),
          FOREIGN KEY(store_id) REFERENCES stores(id)
        );

        -- Persistent brute-force lockout tracking (survives server restarts)
        CREATE TABLE IF NOT EXISTS failed_activation_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          attempt_key TEXT NOT NULL,
          ip_address TEXT,
          hwid TEXT,
          lockout_until INTEGER DEFAULT 0,
          attempt_count INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL,
          last_attempt_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_failed_act_key ON failed_activation_attempts(attempt_key);
      `);
    } else if (v === 5) {
      // Version 5: Commission Fraud Tracking and Refined Refund Logic
      try {
        await db.exec(`
          ALTER TABLE commission_earnings ADD COLUMN device_id TEXT;
          ALTER TABLE commission_earnings ADD COLUMN user_agent TEXT;
          ALTER TABLE commission_earnings ADD COLUMN requires_review INTEGER DEFAULT 0;
          ALTER TABLE commission_earnings ADD COLUMN review_notes TEXT;
          ALTER TABLE commission_earnings ADD COLUMN reviewed_by TEXT;
          ALTER TABLE commission_earnings ADD COLUMN reviewed_at INTEGER;
          ALTER TABLE commission_earnings ADD COLUMN refund_amount_paisa INTEGER DEFAULT 0;
        `);
        console.log('[Database] Migrated commission_earnings to v5.');
      } catch (err) {
        console.error('[Database] Failed to alter commission_earnings in v5:', err.message);
      }
    } else if (v === 6) {
      // Version 6: Whitelist Audit Trails & Batch Action Idempotency
      try {
        await db.exec(`
          CREATE TABLE IF NOT EXISTS trusted_whitelist (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            value TEXT UNIQUE NOT NULL,
            status TEXT DEFAULT 'ACTIVE',
            created_by TEXT,
            created_at INTEGER,
            deleted_by TEXT,
            deleted_at INTEGER
          );

          CREATE TABLE IF NOT EXISTS idempotent_actions (
            action_key TEXT PRIMARY KEY,
            processed_at INTEGER NOT NULL,
            response_payload TEXT
          );
        `);

        // Seed default trusted IP and HWIDs if they don't exist
        const now = Date.now();
        const defaultSeeds = [
          { type: 'IP', value: '127.0.0.1' },
          { type: 'IP', value: '::1' },
          { type: 'IP', value: 'localhost' },
          { type: 'HWID', value: 'MOCK_ADMIN_HWID' },
          { type: 'HWID', value: 'TEST-HWID' }
        ];

        for (const seed of defaultSeeds) {
          await db.run(
            `INSERT INTO trusted_whitelist (id, type, value, status, created_by, created_at)
             VALUES (?, ?, ?, 'ACTIVE', 'SYSTEM', ?)
             ON CONFLICT(value) DO NOTHING`,
            [require('crypto').randomUUID(), seed.type, seed.value, now]
          );
        }

        console.log('[Database] Migrated database schema to v6 (trusted_whitelist and idempotent_actions).');
      } catch (err) {
        console.error('[Database] Failed to migrate database schema in v6:', err.message);
      }
    } else if (v === 7) {
      try {
        await db.exec(`
          ALTER TABLE inventory_catalog ADD COLUMN mode_fields TEXT DEFAULT '{}';
          ALTER TABLE inventory_catalog ADD COLUMN image_url TEXT DEFAULT '';
        `);
        console.log('[Database] Migrated database schema to v7 (inventory_catalog mode_fields & image_url).');
      } catch (err) {
        console.error('[Database] Failed to migrate database schema in v7:', err.message);
      }
    } else if (v === 8) {
      try {
        await db.exec(`
          CREATE TABLE IF NOT EXISTS payment_proofs (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            plan_id TEXT NOT NULL,
            mode TEXT NOT NULL DEFAULT 'subscription',
            rrn_reference TEXT UNIQUE NOT NULL,
            amount REAL NOT NULL,
            proof_image_url TEXT,
            status TEXT DEFAULT 'pending',
            rejection_reason TEXT,
            created_at INTEGER,
            updated_at INTEGER
          );
          CREATE INDEX IF NOT EXISTS idx_payment_proofs_user ON payment_proofs(user_id);
          CREATE INDEX IF NOT EXISTS idx_payment_proofs_rrn ON payment_proofs(rrn_reference);
        `);
        console.log('[Database] Migrated database schema to v8 (payment_proofs table).');
      } catch (err) {
        console.error('[Database] Failed to migrate database schema in v8:', err.message);
      }
    } else if (v === 9) {
      try {
        await db.exec(`
          CREATE TABLE IF NOT EXISTS admin_audit_log (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            action TEXT NOT NULL,
            details TEXT,
            created_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action ON admin_audit_log(action);
        `);
        console.log('[Database] Migrated database schema to v9 (admin_audit_log table).');
      } catch (err) {
        console.error('[Database] Failed to migrate database schema in v9:', err.message);
      }
    } else if (v === 10) {
      try {
        await db.exec(`
          ALTER TABLE stores ADD COLUMN purchased_at INTEGER;
          ALTER TABLE stores ADD COLUMN amc_paid_until INTEGER;
          ALTER TABLE stores ADD COLUMN fbr_enabled INTEGER DEFAULT 0;
          ALTER TABLE stores ADD COLUMN fbr_integrator TEXT;
        `);
        console.log('[Database] Migrated database schema to v10 (stores purchased_at, amc_paid_until, fbr_enabled & fbr_integrator).');
      } catch (err) {
        console.error('[Database] Failed to migrate database schema in v10:', err.message);
      }
    } else if (v === 11) {
      try {
        await db.exec(`
          CREATE TABLE IF NOT EXISTS pin_lockout_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            attempt_key TEXT NOT NULL,
            attempt_count INTEGER NOT NULL DEFAULT 1,
            lockout_until INTEGER,
            last_attempt_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_pin_lockout_key ON pin_lockout_log(attempt_key);
        `);
        console.log('[Database] Migrated database schema to v11 (pin_lockout_log table).');
      } catch (err) {
        console.error('[Database] Failed to migrate database schema in v11:', err.message);
      }
    }

    // Atomically write new schema version
    await db.run(
      "INSERT OR REPLACE INTO local_preferences (key, val_type, value_payload, updated_at) VALUES ('schema_version', 'string', ?, ?)",
      [v.toString(), Date.now()]
    );
  }

  // Create indexing matrices to optimize reads/writes
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_transactions_status_created ON transactions(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_transactions_hlc_dirty ON transactions(sync_hlc, is_dirty);
    CREATE INDEX IF NOT EXISTS idx_line_items_tx ON line_items(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_line_items_sku ON line_items(sku);
    CREATE INDEX IF NOT EXISTS idx_speech_tx ON speech_analytics_logs(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_speech_fraud ON speech_analytics_logs(flagged_fraud_risk);
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_dist ON purchase_orders(distributor_id);
    CREATE INDEX IF NOT EXISTS idx_po_line_items_po ON po_line_items(po_id);
    CREATE INDEX IF NOT EXISTS idx_distributor_payments_dist ON distributor_payments(distributor_id);
    CREATE INDEX IF NOT EXISTS idx_customer_credit_cust ON customer_credit(customer_id);
    CREATE INDEX IF NOT EXISTS idx_fbr_submissions_status ON fbr_submissions(status, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fbr_submissions_usin ON fbr_submissions(usin);
    CREATE INDEX IF NOT EXISTS idx_payments_ref ON pending_payments(transaction_reference);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON pending_payments(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_commission_earnings_status ON commission_earnings(status, activated_at) WHERE status = 'PENDING';
    CREATE INDEX IF NOT EXISTS idx_sales_agents_employee ON sales_agents(employee_id);
  `);

  // Load the current db_version from crsql_changes to resume correctly
  const maxDbVer = await db.get('SELECT MAX(db_version) as max_ver FROM crsql_changes');
  currentDbVersion = (maxDbVer && maxDbVer.max_ver) ? maxDbVer.max_ver : 0;

  // Auto-approve Master PC
  await db.run(
    "INSERT OR REPLACE INTO approved_devices (node_id, device_name, user_agent, approved_at, status) VALUES (?, ?, ?, ?, ?)",
    [terminalId, 'Master Register PC', 'Node.js Runtime', Date.now(), 'APPROVED']
  );
  await db.run(
    "INSERT OR REPLACE INTO approved_devices (node_id, device_name, user_agent, approved_at, status) VALUES (?, ?, ?, ?, ?)",
    ['valenixia_master_pc_01', 'Master Register PC (Web UI)', 'Browser UI', Date.now(), 'APPROVED']
  );

  // Ensure db_generation_id exists in local_preferences
  const genRow = await db.get("SELECT value_payload FROM local_preferences WHERE key = 'db_generation_id'");
  if (!genRow) {
    const newGenId = crypto.randomUUID();
    await db.run(
      "INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES ('db_generation_id', 'STR', ?, 0, ?)",
      [newGenId, Date.now()]
    );
    await logLocalChange('local_preferences', 'db_generation_id', 'value_payload', newGenId, 1, 1, currentHlc.tick());
    console.log('[Database] Initialized db_generation_id:', newGenId);
  }

  // Ensure sync_salt exists in local_preferences
  const saltRow = await db.get("SELECT value_payload FROM local_preferences WHERE key = 'sync_salt'");
  if (!saltRow) {
    const randomSalt = crypto.randomBytes(16).toString('hex');
    await db.run(
      "INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES ('sync_salt', 'STR', ?, 0, ?)",
      [randomSalt, Date.now()]
    );
    console.log('[Database] Initialized random sync_salt.');
  }

  // Run seeding if inventory is empty
  const hasInventory = await db.get('SELECT COUNT(*) as count FROM inventory_catalog');
  if (hasInventory.count === 0) {
    await seedDatabase();
  }
}

// Seed the database with realistic retail items & employee accounts
async function seedDatabase() {
  await db.beginImmediate();
  try {
    const siteId = currentHlc.nodeId;
    const now = Date.now();
    
    // Seed Employees
    const empAdminId = crypto.randomUUID();
    const empCashierId = crypto.randomUUID();
    
    const adminHlc = currentHlc.tick();
    await db.run(
      'INSERT INTO employees (id, auth_hash, biometric_token, role, is_active, sync_hlc) VALUES (?, ?, ?, ?, ?, ?)',
      [empAdminId, hashPin('1234'), 'secure_biometric_admin_token', 'ADMIN', 1, adminHlc]
    );
    await logLocalChange('employees', empAdminId, 'auth_hash', hashPin('1234'), 1, 1, adminHlc);
    await logLocalChange('employees', empAdminId, 'role', 'ADMIN', 1, 1, adminHlc);
    await logLocalChange('employees', empAdminId, 'is_active', 1, 1, 1, adminHlc);

    const cashierHlc = currentHlc.tick();
    await db.run(
      'INSERT INTO employees (id, auth_hash, biometric_token, role, is_active, sync_hlc) VALUES (?, ?, ?, ?, ?, ?)',
      [empCashierId, hashPin('5678'), 'secure_biometric_cashier_token', 'CASHIER', 1, cashierHlc]
    );
    await logLocalChange('employees', empCashierId, 'auth_hash', hashPin('5678'), 1, 1, cashierHlc);
    await logLocalChange('employees', empCashierId, 'role', 'CASHIER', 1, 1, cashierHlc);
    await logLocalChange('employees', empCashierId, 'is_active', 1, 1, 1, cashierHlc);

    // Seed Customers (3 real profiles)
    const seedCustomers = [
      { id: 'cust_alexander', name: 'Alexander Mercer', phone: '+1-555-0199', email: 'alex.mercer@proton.me', spend: 58240, visits: 42 },
      { id: 'cust_elena', name: 'Elena Rostova', phone: '+1-555-0248', email: 'elena.rostova@designhaus.co', spend: 39450, visits: 29 },
      { id: 'cust_marcus', name: 'Marcus Vance', phone: '+1-555-0312', email: 'marcus.vance@vancecap.com', spend: 18420, visits: 15 }
    ];

    for (const c of seedCustomers) {
      const custHlc = currentHlc.tick();
      await db.run(
        'INSERT INTO customers (id, name, phone, email, total_spend_cents, visits, created_at, sync_hlc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [c.id, c.name, c.phone, c.email, c.spend, c.visits, now, custHlc]
      );
      await logLocalChange('customers', c.id, 'name', c.name, 1, 1, custHlc);
      await logLocalChange('customers', c.id, 'phone', c.phone, 1, 1, custHlc);
      await logLocalChange('customers', c.id, 'email', c.email, 1, 1, custHlc);
      await logLocalChange('customers', c.id, 'total_spend_cents', c.spend, 1, 1, custHlc);
      await logLocalChange('customers', c.id, 'visits', c.visits, 1, 1, custHlc);
    }

    // Seed Inventory (12 items)
    const seedCatalog = [
      { sku: 'COFFEE-ESP', gtin: '0000000000001', name: 'Signature Espresso', price: 350, qty: 100 },
      { sku: 'COFFEE-LAT', gtin: '0000000000002', name: 'Cold Brew Latte', price: 475, qty: 80 },
      { sku: 'COFFEE-CBD', gtin: '0000000000003', name: 'Nitro Cold Brew', price: 550, qty: 60 },
      { sku: 'PASTRY-CRO', gtin: '0000000000004', name: 'Butter Croissant', price: 325, qty: 40 },
      { sku: 'PASTRY-MUF', gtin: '0000000000005', name: 'Blueberry Muffin', price: 375, qty: 30 },
      { sku: 'PASTRY-COK', gtin: '0000000000006', name: 'Choco Chip Cookie', price: 250, qty: 50 },
      { sku: 'TECH-CHG',  gtin: '0000000000007', name: 'Rapid USB-C Charger', price: 1999, qty: 25 },
      { sku: 'TECH-CBL',  gtin: '0000000000008', name: 'Braid Type-C Cable 1m', price: 999, qty: 45 },
      { sku: 'RETAIL-MUG', gtin: '0000000000009', name: 'Valenixia Ceramic Mug', price: 1450, qty: 20 },
      { sku: 'RETAIL-TSH', gtin: '0000000000010', name: 'Nova Cotton Tee (L)', price: 2499, qty: 15 },
      { sku: 'RETAIL-BAG', gtin: '0000000000011', name: 'Canvas Tote Bag', price: 1200, qty: 35 },
      { sku: 'WATER-SPK', gtin: '0000000000012', name: 'Sparkling Mineral Water', price: 200, qty: 120 }
    ];

    for (const item of seedCatalog) {
      const itemHlc = currentHlc.tick();
      await db.run(
        'INSERT INTO inventory_catalog (sku, gtin, name, base_price_minor_units, stock_level, reserved_stock, search_vector, col_version, sync_hlc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [item.sku, item.gtin, item.name, item.price, item.qty, 0, `${item.sku} ${item.name} ${item.gtin}`.toLowerCase(), 1, itemHlc]
      );
      
      // Log individual columns to CRDT ledger
      await logLocalChange('inventory_catalog', item.sku, 'gtin', item.gtin, 1, 1, itemHlc);
      await logLocalChange('inventory_catalog', item.sku, 'name', item.name, 1, 1, itemHlc);
      await logLocalChange('inventory_catalog', item.sku, 'base_price_minor_units', item.price, 1, 1, itemHlc);
      await logLocalChange('inventory_catalog', item.sku, 'stock_level', item.qty, 1, 1, itemHlc);
      await logLocalChange('inventory_catalog', item.sku, 'reserved_stock', 0, 1, 1, itemHlc);
    }

    // Seed Local Preferences
    await db.run('INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['onboarding_complete', 'BOOL', 'true', 1, now]
    );
    await db.run('INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['store_tax_rate', 'STR', '0.08', 0, now]
    );
    await db.run('INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['store_name', 'STR', 'VALENIXIA COFFEE & RETAIL', 0, now]
    );
    await db.run('INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['store_theme_palette', 'STR', 'Obsidian Emerald', 0, now]
    );
    await db.run('INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['store_logo_emoji', 'STR', 'V', 0, now]
    );
    await db.run('INSERT INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['store_receipt_tagline', 'STR', 'Stability meets Speed. Thank you!', 0, now]
    );
    await db.run('INSERT INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['whitelabel_show_branding', 'STR', 'true', 0, now]
    );
    await db.run('INSERT INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['glassmorphism_enabled', 'STR', 'true', 0, now]
    );
    await db.run('INSERT INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['terminal_name', 'STR', 'Valenixia Master PC 01', 0, now]
    );
    await db.run('INSERT INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['store_receipt_width', 'STR', '42', 0, now]
    );

    await db.commit();
  } catch (error) {
    await db.rollback();
    console.error('Seeding transaction failed:', error);
    throw error;
  }
}

// Log column mutations into the CRDT changes catalog
async function logLocalChange(tableName, pk, cid, val, colVersion, cl, syncHlc) {
  currentDbVersion++;
  const siteId = currentHlc.nodeId;
  const valStr = val === null ? null : String(val);
  
  let valType = 'string';
  if (typeof val === 'number') {
    valType = 'number';
  } else if (typeof val === 'boolean') {
    valType = 'boolean';
  } else if (val && typeof val === 'object') {
    valType = 'object';
  }
  
  await db.run(`
    INSERT INTO crsql_changes (table_name, pk, cid, val, val_type, col_version, db_version, site_id, cl, sync_hlc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(table_name, pk, cid) DO UPDATE SET
      val = excluded.val,
      val_type = excluded.val_type,
      col_version = excluded.col_version,
      db_version = excluded.db_version,
      site_id = excluded.site_id,
      cl = excluded.cl,
      sync_hlc = excluded.sync_hlc
  `, [tableName, pk, cid, valStr, valType, colVersion, currentDbVersion, siteId, cl, syncHlc]);
}

// Fetch all local changes since a given db_version
async function getChangesSince(version) {
  return await db.all(
    'SELECT * FROM crsql_changes WHERE db_version > ? ORDER BY db_version ASC',
    [version]
  );
}

let dbQueue = Promise.resolve();

// Apply incoming delta-changes from a remote terminal node
async function applyRemoteChanges(changes) {
  return new Promise((resolve, reject) => {
    dbQueue = dbQueue.then(async () => {
      try {
        const result = await applyRemoteChangesInternal(changes);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function recalculateCachedStock(sku) {
  const baseStockRow = await db.get(
    "SELECT val, sync_hlc FROM crsql_changes WHERE table_name = 'inventory_catalog' AND pk = ? AND cid = 'stock_level'",
    [sku]
  );
  const baseStock = baseStockRow ? Number(baseStockRow.val) : 0;
  const baseHlc = baseStockRow ? baseStockRow.sync_hlc : '0000000000000:000000:seed';

  const deltas = await db.all(
    "SELECT val FROM crsql_changes WHERE table_name = 'inventory_catalog_counters' AND pk LIKE ? AND cid = 'delta' AND sync_hlc > ?",
    [sku + '/%', baseHlc]
  );
  let totalDelta = 0;
  for (const row of deltas) {
    totalDelta += Number(row.val);
  }

  const finalStock = Math.max(0, baseStock + totalDelta);
  await db.run(
    "UPDATE inventory_catalog SET stock_level = ? WHERE sku = ?",
    [finalStock, sku]
  );
  console.log(`[Database] Recalculated stock for ${sku}: base=${baseStock} (${baseHlc}), delta=${totalDelta}, final=${finalStock}`);
  return finalStock;
}

async function applyRemoteChangesInternal(changes) {
  if (!Array.isArray(changes) || changes.length === 0) return { applied: 0, conflicts: 0 };
  
  let appliedCount = 0;
  let conflictCount = 0;

  await db.beginImmediate();
  try {
    for (const change of changes) {
      // Tick local HLC with remote clock to capture causal path
      currentHlc.merge(change.sync_hlc);
      
      // Get existing local record version of this column from crsql_changes
      const local = await db.get(
        'SELECT col_version, sync_hlc FROM crsql_changes WHERE table_name = ? AND pk = ? AND cid = ?',
        [change.table_name, change.pk, change.cid]
      );
      
      const shouldApply = shouldApplyDelta(local, change);
      
      if (shouldApply) {
        appliedCount++;
        const valType = change.val_type || 'string';
        // Apply write directly to the target schema table
        await applyChangeToSchema(change.table_name, change.pk, change.cid, change.val, change.cl, valType);
        
        // Log the change into our crsql_changes virtual catalog (mark db_version higher)
        currentDbVersion++;
        await db.run(`
          INSERT INTO crsql_changes (table_name, pk, cid, val, val_type, col_version, db_version, site_id, cl, sync_hlc)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(table_name, pk, cid) DO UPDATE SET
            val = excluded.val,
            val_type = excluded.val_type,
            col_version = excluded.col_version,
            db_version = excluded.db_version,
            site_id = excluded.site_id,
            cl = excluded.cl,
            sync_hlc = excluded.sync_hlc
        `, [change.table_name, change.pk, change.cid, change.val, valType, change.col_version, currentDbVersion, change.site_id, change.cl, change.sync_hlc]);

        // Recalculate stock level if PN delta changes or manual stock updates occur
        if (change.table_name === 'inventory_catalog_counters') {
          const sku = change.pk.split('/')[0];
          await recalculateCachedStock(sku);
        } else if (change.table_name === 'inventory_catalog' && change.cid === 'stock_level') {
          await recalculateCachedStock(change.pk);
        }
      } else {
        conflictCount++;
      }
    }
    await db.commit();
  } catch (error) {
    await db.rollback();
    console.error('Failed applying remote changes:', error);
    throw error;
  }
  
  return { applied: appliedCount, conflicts: conflictCount };
}

// Dynamically updates a single column value in the main tables based on delta CRDTs
async function applyChangeToSchema(tableName, pk, cid, val, cl, valType = 'string') {
  // Strict sanitization of dynamic column name to prevent SQL injection
  if (cid && !/^[a-zA-Z0-9_]+$/.test(cid)) {
    throw new Error(`Security Exception: Invalid column identifier '${cid}'`);
  }
  if (cl === 0) {
    if (tableName === 'transactions') {
      await db.run('UPDATE transactions SET is_deleted = 1, status = ? WHERE id = ?', ['VOIDED', pk]);
    } else if (tableName === 'line_items') {
      await db.run('UPDATE line_items SET is_deleted = 1 WHERE id = ?', [pk]);
    } else if (tableName === 'inventory_catalog') {
      await db.run('UPDATE inventory_catalog SET is_deleted = 1 WHERE sku = ?', [pk]);
    } else if (tableName === 'employees') {
      await db.run('UPDATE employees SET is_deleted = 1, is_active = 0 WHERE id = ?', [pk]);
    } else if (tableName === 'customers') {
      await db.run('UPDATE customers SET is_deleted = 1 WHERE id = ?', [pk]);
    } else if (tableName === 'local_preferences') {
      await db.run('DELETE FROM local_preferences WHERE key = ?', [pk]);
    } else if (tableName === 'distributors') {
      await db.run('UPDATE distributors SET is_deleted = 1 WHERE id = ?', [pk]);
    } else if (tableName === 'purchase_orders') {
      await db.run('UPDATE purchase_orders SET is_deleted = 1 WHERE id = ?', [pk]);
    } else if (tableName === 'po_line_items') {
      await db.run('UPDATE po_line_items SET is_deleted = 1 WHERE id = ?', [pk]);
    } else if (tableName === 'distributor_payments') {
      await db.run('UPDATE distributor_payments SET is_deleted = 1 WHERE id = ?', [pk]);
    } else if (tableName === 'customer_credit') {
      await db.run('UPDATE customer_credit SET is_deleted = 1 WHERE id = ?', [pk]);
    }
    return;
  }

  // Parse values back to correct types based on valType
  // IMPORTANT: trust val_type column — only apply heuristics if type is genuinely unknown ('string')
  let parsedVal = val;
  if (val !== null) {
    if (valType === 'number') {
      parsedVal = Number(val);
    } else if (valType === 'boolean') {
      parsedVal = (val === 'true' || val === '1' || val === 1);
    } else if (valType === 'object') {
      try {
        parsedVal = JSON.parse(val);
      } catch (e) {
        parsedVal = val; // fallback: keep as string if corrupt
      }
    }
    // valType === 'string' (or legacy unset): keep parsedVal = val as-is
  }

  // Check if target record exists. If not, insert a skeletal record to populate.
  if (tableName === 'transactions') {
    const exists = await db.get('SELECT 1 FROM transactions WHERE id = ?', [pk]);
    if (!exists) {
      await db.run('INSERT INTO transactions (id, status, is_deleted, created_at) VALUES (?, ?, 0, ?)', [pk, 'DRAFT', Date.now()]);
    }
    await db.run(`UPDATE transactions SET ${cid} = ?, updated_at = ? WHERE id = ?`, [parsedVal, Date.now(), pk]);
  } 
  
  else if (tableName === 'line_items') {
    const exists = await db.get('SELECT 1 FROM line_items WHERE id = ?', [pk]);
    if (!exists) {
      let txId = null;
      if (pk.startsWith('li_')) {
        txId = pk.split('_').slice(1, -1).join('_');
      }
      await db.run('INSERT INTO line_items (id, transaction_id, sku, quantity, unit_price_minor_units, applied_discount_minor_units, is_deleted) VALUES (?, ?, ?, 1, 0, 0, 0)', [pk, txId, 'COFFEE-ESP']);
    }
    await db.run(`UPDATE line_items SET ${cid} = ? WHERE id = ?`, [parsedVal, pk]);
  }
  
  else if (tableName === 'inventory_catalog') {
    const exists = await db.get('SELECT 1 FROM inventory_catalog WHERE sku = ?', [pk]);
    if (!exists) {
      await db.run('INSERT INTO inventory_catalog (sku, stock_level, reserved_stock, name, base_price_minor_units) VALUES (?, 0, 0, ?, 0)', [pk, pk]);
    }
    await db.run(`UPDATE inventory_catalog SET ${cid} = ? WHERE sku = ?`, [parsedVal, pk]);
  }
  
  else if (tableName === 'employees') {
    const exists = await db.get('SELECT 1 FROM employees WHERE id = ?', [pk]);
    if (!exists) {
      await db.run('INSERT INTO employees (id, is_active) VALUES (?, 1)', [pk]);
    }
    await db.run(`UPDATE employees SET ${cid} = ? WHERE id = ?`, [parsedVal, pk]);
  }
  
  else if (tableName === 'local_preferences') {
    const exists = await db.get('SELECT 1 FROM local_preferences WHERE key = ?', [pk]);
    if (!exists) {
      await db.run('INSERT INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES (?, "STR", "", 0, ?)', [pk, Date.now()]);
    }
    await db.run(`UPDATE local_preferences SET ${cid} = ?, updated_at = ? WHERE key = ?`, [val, Date.now(), pk]);
  }
  
  else if (tableName === 'customers') {
    const exists = await db.get('SELECT 1 FROM customers WHERE id = ?', [pk]);
    if (!exists) {
      await db.run('INSERT INTO customers (id, name, phone, email, total_spend_cents, visits, created_at) VALUES (?, ?, "", "", 0, 0, ?)', [pk, pk, Date.now()]);
    }
    await db.run(`UPDATE customers SET ${cid} = ? WHERE id = ?`, [parsedVal, pk]);
  }

  else if (tableName === 'categories') {
    const exists = await db.get('SELECT 1 FROM categories WHERE name = ?', [pk]);
    if (!exists) {
      await db.run('INSERT INTO categories (name) VALUES (?)', [pk]);
    }
    await db.run(`UPDATE categories SET ${cid} = ? WHERE name = ?`, [parsedVal, pk]);
  }

  else if (tableName === 'stock_movements') {
    const exists = await db.get('SELECT 1 FROM stock_movements WHERE id = ?', [pk]);
    if (!exists) {
      await db.run('INSERT INTO stock_movements (id, created_at) VALUES (?, ?)', [pk, Date.now()]);
    }
    await db.run(`UPDATE stock_movements SET ${cid} = ? WHERE id = ?`, [parsedVal, pk]);
  }

  else if (tableName === 'employee_shifts') {
    const exists = await db.get('SELECT 1 FROM employee_shifts WHERE id = ?', [pk]);
    if (!exists) {
      await db.run('INSERT INTO employee_shifts (id, clock_in) VALUES (?, ?)', [pk, Date.now()]);
    }
    await db.run(`UPDATE employee_shifts SET ${cid} = ? WHERE id = ?`, [parsedVal, pk]);
  }

  else if (tableName === 'distributors') {
    const exists = await db.get('SELECT 1 FROM distributors WHERE id = ?', [pk]);
    if (!exists) {
      await db.run('INSERT INTO distributors (id, name, created_at, is_deleted) VALUES (?, ?, ?, 0)', [pk, pk, Date.now()]);
    }
    await db.run(`UPDATE distributors SET ${cid} = ? WHERE id = ?`, [parsedVal, pk]);
  }

  else if (tableName === 'purchase_orders') {
    const exists = await db.get('SELECT 1 FROM purchase_orders WHERE id = ?', [pk]);
    if (!exists) {
      await db.run('INSERT INTO purchase_orders (id, distributor_id, status, created_at, is_deleted) VALUES (?, "unknown", "DRAFT", ?, 0)', [pk, Date.now()]);
    }
    await db.run(`UPDATE purchase_orders SET ${cid} = ?, updated_at = ? WHERE id = ?`, [parsedVal, Date.now(), pk]);
  }

  else if (tableName === 'po_line_items') {
    const exists = await db.get('SELECT 1 FROM po_line_items WHERE id = ?', [pk]);
    if (!exists) {
      await db.run('INSERT INTO po_line_items (id, po_id, quantity_ordered, quantity_received, unit_cost_minor, is_deleted) VALUES (?, "unknown", 0, 0, 0, 0)', [pk]);
    }
    await db.run(`UPDATE po_line_items SET ${cid} = ? WHERE id = ?`, [parsedVal, pk]);
  }

  else if (tableName === 'distributor_payments') {
    const exists = await db.get('SELECT 1 FROM distributor_payments WHERE id = ?', [pk]);
    if (!exists) {
      await db.run('INSERT INTO distributor_payments (id, distributor_id, amount_minor, paid_at, is_deleted) VALUES (?, "unknown", 0, ?, 0)', [pk, Date.now()]);
    }
    await db.run(`UPDATE distributor_payments SET ${cid} = ? WHERE id = ?`, [parsedVal, pk]);
  }

  else if (tableName === 'customer_credit') {
    const exists = await db.get('SELECT 1 FROM customer_credit WHERE id = ?', [pk]);
    if (!exists) {
      await db.run('INSERT INTO customer_credit (id, customer_id, amount_minor, created_at, is_deleted) VALUES (?, "unknown", 0, ?, 0)', [pk, Date.now()]);
    }
    await db.run(`UPDATE customer_credit SET ${cid} = ? WHERE id = ?`, [parsedVal, pk]);
  }
}

// ── Device Whitelist Management ────────────────────────────────────────────
async function getDeviceStatus(nodeId) {
  const row = await db.get('SELECT status FROM approved_devices WHERE node_id = ?', [nodeId]);
  return row ? row.status : null;
}

async function addPendingDevice(nodeId, name, userAgent) {
  await db.run(
    'INSERT OR IGNORE INTO approved_devices (node_id, device_name, user_agent, approved_at, status) VALUES (?, ?, ?, ?, ?)',
    [nodeId, name || 'Unknown Device', userAgent || 'Unknown', null, 'PENDING']
  );
}

async function approveDevice(nodeId) {
  await db.run(
    "UPDATE approved_devices SET status = 'APPROVED', approved_at = ? WHERE node_id = ?",
    [Date.now(), nodeId]
  );
}

async function rejectDevice(nodeId) {
  await db.run('DELETE FROM approved_devices WHERE node_id = ?', [nodeId]);
}

async function getPendingDevices() {
  return await db.all("SELECT * FROM approved_devices WHERE status = 'PENDING'");
}

async function getAllDevices() {
  return await db.all("SELECT * FROM approved_devices");
}

// ── CRDT Tombstone Garbage Collection ──────────────────────────────────────
// Safe to call only when ALL registered nodes have ACK'd changes up to safeVersion.
// Called automatically weekly by the server's GC scheduler.
async function pruneAcknowledgedChanges(safeVersion) {
  if (!safeVersion || safeVersion < 1) return 0;
  const result = await db.run(
    'DELETE FROM crsql_changes WHERE db_version <= ?',
    [safeVersion]
  );
  console.log(`[GC] Pruned CRDT log entries up to version ${safeVersion}. Rows affected: ${result.changes || 0}`);
  return result.changes || 0;
}

// ── Immutable Ledger: Void via Contra-Entry ─────────────────────────────────
// Never deletes transactions. Creates a mirror negative entry.
async function createVoidContraEntry(originalTransactionId, managerId, voidReason) {
  const original = await db.get('SELECT * FROM transactions WHERE id = ?', [originalTransactionId]);
  if (!original) throw new Error(`Transaction ${originalTransactionId} not found.`);
  if (original.status === 'VOIDED') throw new Error('Transaction is already voided.');

  const contraId = `void_${originalTransactionId}_${Date.now()}`;
  const now = Date.now();
  const hlc = currentHlc ? currentHlc.now() : String(now);
  await db.beginImmediate();
  try {
    // Mark original as VOIDED
    await db.run(
      `UPDATE transactions SET status = 'VOIDED', voided_transaction_id = ?, void_reason = ?, updated_at = ?, sync_hlc = ? WHERE id = ?`,
      [contraId, voidReason || 'Manager void', now, hlc, originalTransactionId]
    );
    // Create contra-entry (negative mirror)
    await db.run(
      `INSERT INTO transactions (id, employee_id, terminal_id, subtotal_minor_units, tax_minor_units, total_minor_units, status, payment_mode, payment_details, created_at, updated_at, sync_hlc, is_dirty, is_deleted, voided_transaction_id, void_reason)
       VALUES (?, ?, ?, ?, ?, ?, 'VOID_CONTRA', ?, '', ?, ?, ?, 1, 0, ?, ?)`,
      [
        contraId, managerId, original.terminal_id,
        -(original.subtotal_minor_units || 0),
        -(original.tax_minor_units || 0),
        -(original.total_minor_units || 0),
        original.payment_mode || 'CASH',
        now, now, hlc,
        originalTransactionId, voidReason || 'Manager void'
      ]
    );
    await db.commit();
    console.log(`[Ledger] Void contra-entry created: ${contraId} for ${originalTransactionId}`);
    return contraId;
  } catch (err) {
    await db.rollback();
    throw err;
  }
}

// ── Monotonic Time Anchor ───────────────────────────────────────────────────
async function updateSecureTimeAnchor() {
  try {
    await db.run(
      `INSERT INTO license_store (key, value, updated_at) VALUES ('last_known_secure_time', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [String(Date.now()), Date.now()]
    );
  } catch (e) { /* non-fatal */ }
}

// ── Telemetry log storage ───────────────────────────────────────────────────
async function saveTelemetryLog(log) {
  try {
    await db.run(
      `INSERT OR IGNORE INTO telemetry_logs (id, node_id, error_type, error_message, stack_trace, hlc, last_clicks, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [log.id, log.nodeId, log.errorType, log.errorMessage, log.stackTrace, log.hlc, log.lastClicks, log.createdAt || Date.now()]
    );
  } catch (e) { /* non-fatal */ }
}

async function factoryResetDatabase() {
  await db.beginImmediate();
  try {
    const tables = [
      'transactions', 'line_items', 'inventory_catalog', 'employees',
      'crsql_changes', 'speech_analytics_logs', 'local_preferences',
      'customers', 'categories', 'stock_movements', 'employee_shifts',
      'approved_devices', 'distributors', 'purchase_orders', 'po_line_items',
      'distributor_payments', 'customer_credit', 'fbr_submissions',
      'aborted_sales_log', 'telemetry_logs'
    ];
    for (const table of tables) {
      await db.run(`DELETE FROM ${table};`);
    }
    await db.commit();
    console.log('[Database] Full database factory reset completed successfully.');
  } catch (err) {
    await db.rollback();
    throw err;
  }
}

module.exports = {
  initDatabase,
  db,
  verifyPin,
  hashPin,
  checkPinLockout,
  recordPinFailure,
  clearPinLockout,
  getChangesSince,
  applyRemoteChanges,
  compactTombstones: pruneAcknowledgedChanges, // backward-compat alias
  pruneAcknowledgedChanges,
  createVoidContraEntry,
  updateSecureTimeAnchor,
  saveTelemetryLog,
  factoryResetDatabase,
  logLocalChange,
  recalculateCachedStock,
  getDeviceStatus,
  addPendingDevice,
  approveDevice,
  rejectDevice,
  getPendingDevices,
  getAllDevices,
  SERVER_SCHEMA_VERSION,
  getHlc: () => currentHlc,
  getDbVersion: () => currentDbVersion
};

