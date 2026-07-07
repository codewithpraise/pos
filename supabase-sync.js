// ============================================================================
// NEXOVA COMMERCE ECOSYSTEM - SUPABASE DISASTER RECOVERY ENGINE
// Asynchronously mirrors local SQLite CRDT delta logs to cloud control plane
// ============================================================================

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { db } = require('./database');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
const STORE_ID = process.env.STORE_TERMINAL_ID || 'default_store';

const supabase = (url && key) ? createClient(url, key, {
  global: {
    headers: {
      'x-store-id': STORE_ID
    }
  }
}) : null;

let isSyncing = false;

// ── Circuit Breaker ─────────────────────────────────────────────────────────
// Trips after CIRCUIT_FAIL_LIMIT sequential failures.
// Resets automatically after CIRCUIT_RESET_MS milliseconds.
const CIRCUIT_FAIL_LIMIT = 5;
const CIRCUIT_RESET_MS   = 60 * 1000; // 60 seconds

const circuit = {
  failures: 0,
  openUntil: 0,
  isOpen() { return Date.now() < this.openUntil; },
  recordFailure() {
    this.failures++;
    if (this.failures >= CIRCUIT_FAIL_LIMIT) {
      this.openUntil = Date.now() + CIRCUIT_RESET_MS;
      console.error(`[CloudSync] Circuit OPEN: ${CIRCUIT_FAIL_LIMIT} consecutive failures. Pausing sync for ${CIRCUIT_RESET_MS / 1000}s.`);
    }
  },
  recordSuccess() {
    this.failures = 0;
    this.openUntil = 0;
  }
};

// ── Valid val_type whitelist ─────────────────────────────────────────────────
const VALID_VAL_TYPES = new Set(['string', 'number', 'boolean', 'object']);

function validateAndSanitizeChange(row) {
  const valType = row.val_type || 'string';
  if (!VALID_VAL_TYPES.has(valType)) {
    console.warn(`[CloudSync] Rejected row with invalid val_type="${valType}" for ${row.table_name}.${row.pk}.${row.cid}`);
    return null;
  }
  // For object-type values, ensure they are serialised as a JSON string before upload
  let serialisedVal = row.val;
  if (serialisedVal !== null && valType === 'object' && typeof serialisedVal !== 'string') {
    serialisedVal = JSON.stringify(serialisedVal);
  } else if (serialisedVal !== null) {
    serialisedVal = String(serialisedVal);
  }
  return {
    store_id: STORE_ID,
    table_name: String(row.table_name || ''),
    pk: String(row.pk || ''),
    cid: String(row.cid || ''),
    val: serialisedVal,
    val_type: valType,
    col_version: parseInt(row.col_version || 0),
    db_version: parseInt(row.db_version || 0),
    site_id: String(row.site_id || ''),
    cl: parseInt(row.cl || 1),
    sync_hlc: String(row.sync_hlc || '')
  };
}

// ── Retry with exponential backoff + jitter ──────────────────────────────────
async function executeWithRetry(fn, maxRetries = 5, initialDelay = 1000) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const result = await fn();
      return result;
    } catch (err) {
      attempt++;
      const isTransient = !err.status || err.status >= 500 || err.message.includes('fetch') || err.message.includes('network');
      if (attempt >= maxRetries || !isTransient) throw err;
      // Jittered exponential backoff: base * 2^attempt + random jitter up to 1s
      const jitter = Math.random() * 1000;
      const delay = Math.min(initialDelay * Math.pow(2, attempt) + jitter, 30000);
      console.warn(`[CloudSync] Attempt ${attempt}/${maxRetries} failed. Retrying in ${Math.round(delay)}ms: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function pushOfflineBackupsToCloud() {
  if (!supabase) return;
  if (isSyncing) return;
  if (circuit.isOpen()) {
    console.warn('[CloudSync] Circuit is OPEN — skipping sync until reset window expires.');
    return;
  }
  isSyncing = true;

  try {
    // 1. Detect generation ID resets
    const localGenRow = await db.get("SELECT value_payload FROM local_preferences WHERE key = 'db_generation_id'");
    const localGenId = localGenRow ? localGenRow.value_payload : null;

    if (localGenId) {
      const remoteGen = await executeWithRetry(async () => {
        const { data, error } = await supabase
          .from('cloud_crdt_backups')
          .select('val')
          .eq('store_id', STORE_ID)
          .eq('table_name', 'local_preferences')
          .eq('pk', 'db_generation_id')
          .eq('cid', 'value_payload')
          .limit(1);
        if (error) throw error;
        return data;
      });

      const remoteGenId = remoteGen && remoteGen.length > 0 ? remoteGen[0].val : null;

      if (remoteGenId && remoteGenId !== localGenId) {
        // Generation mismatch: local DB was factory-reset. Halting cloud sync to
        // prevent overwriting the remote backup with stale or empty local data.
        // An operator must manually reconcile (reset the STORE_TERMINAL_ID or
        // clear cloud_crdt_backups) before sync can resume.
        console.error(`[CloudSync] GENERATION MISMATCH — SYNC HALTED.`);
        console.error(`  Local generation : ${localGenId}`);
        console.error(`  Remote generation: ${remoteGenId}`);
        console.error(`  Action required: resolve mismatch manually or re-onboard this store.`);
        isSyncing = false;
        return; // Safe halt — do NOT purge remote backup
      }
    }

    // 2. Get the last db_version we successfully pushed
    const lastPush = await executeWithRetry(async () => {
      const { data, error } = await supabase
        .from('cloud_crdt_backups')
        .select('db_version')
        .eq('store_id', STORE_ID)
        .order('db_version', { ascending: false })
        .limit(1);
      if (error) throw error;
      return data;
    });

    const lastCloudVersion = lastPush && lastPush.length > 0 ? lastPush[0].db_version : 0;

    // 3. Fetch local SQLite changes after that version
    const pendingChanges = await db.all(
      `SELECT * FROM crsql_changes WHERE db_version > ? ORDER BY db_version ASC LIMIT 1000`,
      [lastCloudVersion]
    );

    if (!pendingChanges || pendingChanges.length === 0) {
      isSyncing = false;
      return;
    }

    // 4. Validate and sanitize payload (reject invalid val_type rows)
    const payload = pendingChanges
      .map(validateAndSanitizeChange)
      .filter(Boolean);

    if (payload.length === 0) {
      console.warn('[CloudSync] No valid changes after validation — skipping push.');
      isSyncing = false;
      return;
    }

    console.log(`[CloudSync] Pushing ${payload.length} validated changes to Supabase (${pendingChanges.length - payload.length} rejected)...`);

    // 5. Batch Upsert to Cloud
    await executeWithRetry(async () => {
      const { error } = await supabase
        .from('cloud_crdt_backups')
        .upsert(payload, { onConflict: 'store_id, table_name, pk, cid, sync_hlc' });
      if (error) throw error;
    });

    circuit.recordSuccess();
    console.log(`[CloudSync] Successfully backed up to Supabase. Latest cloud version: ${pendingChanges[pendingChanges.length - 1].db_version}`);

  } catch (err) {
    circuit.recordFailure();
    console.error(`[CloudSync] Cloud disaster recovery push failed (circuit failures=${circuit.failures}):`, err.message);
  } finally {
    isSyncing = false;
  }
}

module.exports = { pushOfflineBackupsToCloud, supabase };
