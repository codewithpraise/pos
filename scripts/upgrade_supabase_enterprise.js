require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const supaUrl = process.env.SUPABASE_URL || 'https://wzvwyfyefbdrqscxhwsf.supabase.co';
const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6dnd5ZnllZmJkcnFzY3hod3NmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MzU3ODUsImV4cCI6MjA5ODQxMTc4NX0.W9O6U4tqETM6BcEjX7evt3LunpIZOC5c7wcZht2ajuk';

console.log('Connecting to Supabase:', supaUrl);
const supabase = createClient(supaUrl, supaKey);

async function upgradeSupabase() {
  console.log('\n=== UPGRADING ALL SUPABASE STORES / DEVICES TO ENTERPRISE TIER ===');
  
  // 1. Fetch all stores in Supabase
  const { data: stores, error: fetchErr } = await supabase.from('stores').select('*');
  if (fetchErr) {
    console.warn('Error fetching stores:', fetchErr.message);
  } else {
    console.log(`Found ${stores ? stores.length : 0} stores in Supabase.`);
    for (const store of (stores || [])) {
      console.log(`Upgrading store ${store.id} (${store.name || 'unnamed'}) to ENTERPRISE...`);
      const { error: updateErr } = await supabase
        .from('stores')
        .update({
          plan: 'enterprise',
          is_active: true
        })
        .eq('id', store.id);
      if (updateErr) {
        console.error(`Failed to update store ${store.id}:`, updateErr.message);
      } else {
        console.log(`✅ Store ${store.id} successfully upgraded to ENTERPRISE.`);
      }
    }
  }

  // 2. Upsert default master HWID and common HWIDs to Supabase as ENTERPRISE
  const knownHwids = [
    'BE4DAD7445FC1AE5BCEA630460A4312D',
    '91349748AFE9DBFEFCA1C84F8F6ABB75',
    'terminal_pc_master',
    'valenixia_master_pc_01',
    'device_android_mobile'
  ];

  for (const hwid of knownHwids) {
    const { data: existing } = await supabase.from('stores').select('*').eq('id', hwid);
    if (!existing || existing.length === 0) {
      console.log(`Auto-provisioning master HWID ${hwid} to ENTERPRISE tier in Supabase...`);
      await supabase.from('stores').insert({
        id: hwid,
        name: 'Master Enterprise Terminal (' + hwid.slice(0, 8) + ')',
        plan: 'enterprise',
        is_active: true,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: new Date().toISOString()
      });
      console.log(`✅ Provisioned ${hwid} as ENTERPRISE.`);
    } else {
      await supabase.from('stores').update({ plan: 'enterprise', is_active: true }).eq('id', hwid);
      console.log(`✅ Verified ${hwid} is ENTERPRISE.`);
    }
  }

  // 3. Update local SQLite database (valenixia.db)
  const dbPath = path.join(__dirname, '..', process.env.DB_FILE || 'valenixia.db');
  console.log('\nUpdating local SQLite database at:', dbPath);
  if (fs.existsSync(dbPath)) {
    const localDb = new sqlite3.Database(dbPath);
    localDb.run("UPDATE stores SET tier = 'ENTERPRISE'", function(err) {
      if (err) {
        console.warn('Local SQLite update note:', err.message);
      } else {
        console.log(`✅ Local database stores table updated (${this.changes} rows updated to ENTERPRISE).`);
      }
      localDb.close();
      console.log('\n=== SUPABASE & LOCAL ENTERPRISE UPGRADE COMPLETE ===\n');
    });
  } else {
    console.log('Local db file does not exist yet at:', dbPath);
    console.log('\n=== SUPABASE ENTERPRISE UPGRADE COMPLETE ===\n');
  }
}

upgradeSupabase();
