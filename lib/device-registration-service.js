// ============================================================================
// VALENIXIA — SHARED DEVICE REGISTRATION SERVICE
// Used by: server.js (SQLite adapter) and api/devices/register.js (Supabase adapter)
// Both paths share identical business logic; only the persistence adapter differs.
// ============================================================================

'use strict';

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Token generation — self-contained, no external deps
// Signs a 30-day JWT using HS256 with the provided secret.
// ---------------------------------------------------------------------------
function generateDeviceToken(nodeId, role, secret) {
  if (!secret) throw new Error('JWT secret is required for token generation.');
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp     = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ sub: nodeId, role, exp })).toString('base64url');
  const sig     = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

// ---------------------------------------------------------------------------
// Master-node detection
// On the LOCAL server: web_client_* and web_node_* are auto-approved as MASTER.
// On VERCEL (serverless): NO auto-approval based on nodeId prefix.
//   Only explicitly allowlisted IDs from env config are MASTER.
//   All other devices register as TERMINAL (PENDING until admin-approved).
// ---------------------------------------------------------------------------
function isMasterNodeLocal(nodeId) {
  if (!nodeId || typeof nodeId !== 'string') return false;
  const nid = nodeId.toLowerCase();
  return (
    nid === 'terminal_pc_master' ||
    nid.includes('master') ||
    nid.startsWith('valenixia_master') ||
    nid.startsWith('web_client_') ||
    nid.startsWith('web_node_')
  );
}

function isMasterNodeServerless(nodeId) {
  // On Vercel, only explicitly configured master node IDs are approved as MASTER.
  // Set VALENIXIA_MASTER_NODE_IDS as comma-separated list in Vercel env vars.
  const allowlist = (process.env.VALENIXIA_MASTER_NODE_IDS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  if (!allowlist.length) return false;
  return allowlist.includes((nodeId || '').toLowerCase());
}

// ---------------------------------------------------------------------------
// SQLite Adapter — used by local Express server (server.js)
// db: the sqlite-async db instance imported from database.js
// jwtSecret: the server's live JWT secret (loaded after loadServerPassphrase())
// ---------------------------------------------------------------------------
async function registerDeviceSQLite({ nodeId, deviceName, userAgent, db, jwtSecret }) {
  if (!nodeId) throw new Error('nodeId is required.');

  const isMaster = isMasterNodeLocal(nodeId);
  let status = null;

  // Fetch existing record
  const existing = await db.get(
    'SELECT status FROM approved_devices WHERE node_id = ?',
    [nodeId]
  );

  if (isMaster) {
    // Master nodes are always APPROVED
    status = 'APPROVED';
    if (!existing) {
      await db.run(
        "INSERT INTO approved_devices (node_id, device_name, user_agent, approved_at, status) VALUES (?, ?, ?, ?, 'APPROVED')",
        [nodeId, deviceName || 'Master Node', userAgent || '', Date.now()]
      );
    } else if (existing.status !== 'APPROVED') {
      await db.run(
        "UPDATE approved_devices SET status = 'APPROVED' WHERE node_id = ?",
        [nodeId]
      );
    }
  } else if (existing && existing.status === 'APPROVED') {
    status = 'APPROVED';
  } else {
    // Register as PENDING — idempotent (INSERT OR IGNORE)
    status = 'PENDING';
    await db.run(
      "INSERT OR IGNORE INTO approved_devices (node_id, device_name, user_agent, approved_at, status) VALUES (?, ?, ?, ?, 'PENDING')",
      [nodeId, deviceName || 'Web Register', userAgent || '', null]
    );
  }

  if (status === 'APPROVED') {
    const role  = isMaster ? 'MASTER' : 'TERMINAL';
    const token = generateDeviceToken(nodeId, role, jwtSecret);
    return { status: 'APPROVED', token, nodeId };
  }

  return { status: 'PENDING', nodeId };
}

// ---------------------------------------------------------------------------
// Supabase Adapter — used by Vercel serverless function
// supabase: a @supabase/supabase-js client instance
// jwtSecret: process.env.JWT_SECRET (must be set in Vercel env vars)
// ---------------------------------------------------------------------------
async function registerDeviceSupabase({ nodeId, deviceName, userAgent, platform, supabase, jwtSecret }) {
  if (!nodeId) throw new Error('nodeId is required.');
  if (!supabase) throw new Error('Supabase client is required.');
  if (!jwtSecret) throw new Error('JWT_SECRET env var is required on Vercel.');

  const isMaster = isMasterNodeServerless(nodeId);

  // Fetch existing record — ignore missing table errors (PGRST205)
  let existing = null;
  let tableMissing = false;

  try {
    const { data, error } = await supabase
      .from('approved_devices')
      .select('status, role')
      .eq('node_id', nodeId)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
        tableMissing = true;
      } else {
        console.warn('[DeviceRegSupabase] Select warning:', error.message);
      }
    } else {
      existing = data;
    }
  } catch (err) {
    tableMissing = true;
  }

  let status = existing ? existing.status : null;

  if (!existing && !tableMissing) {
    // New device — register as PENDING (MASTER if allowlisted)
    const newStatus = isMaster ? 'APPROVED' : 'PENDING';
    const newRole   = isMaster ? 'MASTER' : 'TERMINAL';
    const { error } = await supabase.from('approved_devices').insert({
      node_id:         nodeId,
      device_name:     deviceName || 'Web Register',
      user_agent:      userAgent  || '',
      platform:        platform   || 'WEB',
      status:          newStatus,
      role:            newRole,
      registered_at:   Date.now(),
      approved_at:     isMaster ? Date.now() : null,
    });
    if (error && error.code !== 'PGRST205') {
      console.warn('[DeviceRegSupabase] Insert warning:', error.message);
    }
    status = newStatus;
  } else if (isMaster && existing && existing.status !== 'APPROVED' && !tableMissing) {
    // Upgrade allowlisted master to APPROVED
    const { error } = await supabase
      .from('approved_devices')
      .update({ status: 'APPROVED', role: 'MASTER', approved_at: Date.now() })
      .eq('node_id', nodeId);
    if (error) console.warn('[DeviceRegSupabase] Upgrade warning:', error.message);
    status = 'APPROVED';
  } else if (tableMissing) {
    // Table does not exist in Supabase yet — default to PENDING (or APPROVED for master)
    status = isMaster ? 'APPROVED' : 'PENDING';
  }

  if (status === 'APPROVED') {
    const role  = (existing?.role === 'MASTER' || isMaster) ? 'MASTER' : 'TERMINAL';
    const token = generateDeviceToken(nodeId, role, jwtSecret);
    return { status: 'APPROVED', token, nodeId };
  }

  return { status: 'PENDING', nodeId };
}

module.exports = {
  registerDeviceSQLite,
  registerDeviceSupabase,
  generateDeviceToken,
  isMasterNodeLocal,
  isMasterNodeServerless,
};
