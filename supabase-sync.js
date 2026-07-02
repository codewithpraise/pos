// ============================================================================
// NEXOVA COMMERCE ECOSYSTEM - SUPABASE DISASTER RECOVERY ENGINE
// Asynchronously mirrors local SQLite CRDT delta logs to cloud control plane
// ============================================================================

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { db } = require('./database'); // Import our existing SQLite wrapper

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

async function pushOfflineBackupsToCloud() {
  if (!supabase) return;
  if (isSyncing) return; // Prevent concurrent sync runs
  isSyncing = true;

  try {
    // 1. Get the last db_version we successfully pushed to Supabase for this store
    const { data: lastPush, error: fetchErr } = await supabase
      .from('cloud_crdt_backups')
      .select('db_version')
      .eq('store_id', STORE_ID)
      .order('db_version', { ascending: false })
      .limit(1);

    if (fetchErr) throw fetchErr;

    const lastCloudVersion = lastPush && lastPush.length > 0 ? lastPush[0].db_version : 0;

    // 2. Fetch all local SQLite changes that happened AFTER that version
    // We order by db_version so that in case of limits, we sync sequentially
    const pendingChanges = await db.all(
      `SELECT * FROM crsql_changes WHERE db_version > ? ORDER BY db_version ASC LIMIT 1000`, 
      [lastCloudVersion]
    );

    if (!pendingChanges || pendingChanges.length === 0) {
      isSyncing = false;
      return; // Nothing to sync
    }

    console.log(`[CloudSync] Pushing ${pendingChanges.length} new transactions to Supabase...`);

    // 3. Format payload for Supabase
    const payload = pendingChanges.map(row => ({
      store_id: STORE_ID,
      table_name: row.table_name,
      pk: row.pk,
      cid: row.cid,
      val: row.val === null ? null : String(row.val),
      col_version: parseInt(row.col_version || 0),
      db_version: parseInt(row.db_version || 0),
      site_id: row.site_id,
      cl: parseInt(row.cl || 1),
      sync_hlc: row.sync_hlc
    }));

    // 4. Batch Upsert to Cloud
    const { error: insertErr } = await supabase
      .from('cloud_crdt_backups')
      .upsert(payload, { onConflict: 'store_id, table_name, pk, cid, sync_hlc' });

    if (insertErr) throw insertErr;

    console.log(`[CloudSync] Successfully backed up to Supabase. Latest cloud version: ${pendingChanges[pendingChanges.length - 1].db_version}`);

  } catch (err) {
    console.error(`[CloudSync] Cloud disaster recovery push failed (will retry later):`, err.message);
  } finally {
    isSyncing = false;
  }
}

// Export the daemon
module.exports = { pushOfflineBackupsToCloud, supabase };
