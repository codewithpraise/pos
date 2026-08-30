// ============================================================================
// VERCEL SERVERLESS FUNCTION: GET /api/subscription/status
// ============================================================================
// Authoritative Hardware-Bound Tier & Countdown Status for Serverless
// Matches live Supabase `stores` table schema.
// ============================================================================

'use strict';

module.exports = async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-device-hwid, x-subscription-start-time');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const rawHwid = (req.query && req.query.hwid) || req.headers['x-device-hwid'] || null;
  const cleanHwid = rawHwid ? String(rawHwid).trim().toUpperCase() : 'DEFAULT_DEVICE';
  const clientStartTime = (req.query && req.query.start_time) || req.headers['x-subscription-start-time'] || null;
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wzvwyfyefbdrqscxhwsf.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6dnd5ZnllZmJkcnFzY3hod3NmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MzU3ODUsImV4cCI6MjA5ODQxMTc4NX0.W9O6U4tqETM6BcEjX7evt3LunpIZOC5c7wcZht2ajuk';

  let effectiveTier = 'FREE';
  let subStartTime = clientStartTime || nowIso;
  let firstActivatedAt = clientStartTime || nowIso;
  let expiresAt = null;
  let durationMs = 30 * 24 * 60 * 60 * 1000;
  let billingCycle = 'MONTHLY';
  let status = 'active';
  let isAnchored = false;

  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      });

      const conds = [`id.eq.${cleanHwid}`, `id.eq.${cleanHwid.toLowerCase()}`];

      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .or(conds.join(','));

      if (!error && data && data.length > 0) {
        const store = data[0];
        effectiveTier = String(store.plan || store.tier || 'FREE').toUpperCase();
        subStartTime = store.subscription_start_time || store.created_at || store.updated_at || store.last_seen_at || subStartTime;
        firstActivatedAt = store.created_at || subStartTime;
        expiresAt = store.expires_at || null;
        if (!expiresAt && billingCycle !== 'LIFETIME') {
          const sMs = Date.parse(subStartTime) || nowMs;
          expiresAt = new Date(sMs + durationMs).toISOString();
        }
        status = store.is_active !== false ? 'active' : 'inactive';
        isAnchored = true;
      } else if (!error && cleanHwid !== 'DEFAULT_DEVICE') {
        // First time device connects: Anchor in cloud database so subsequent calls are 100% immutable
        try {
          const anchorStart = clientStartTime || nowIso;
          const anchorExp = new Date(Date.parse(anchorStart) + durationMs).toISOString();
          await supabase.from('stores').upsert([{
            id: cleanHwid,
            name: `Store (${cleanHwid.slice(0, 8)})`,
            plan: 'free',
            is_active: true,
            last_seen_at: anchorStart,
            created_at: anchorStart
          }], { onConflict: 'id' });
          subStartTime = anchorStart;
          firstActivatedAt = anchorStart;
          expiresAt = anchorExp;
          isAnchored = true;
        } catch (_) {
          // Non-fatal if anon key cannot insert
        }
      }
    } catch (err) {
      console.warn('[ServerlessSubscription] Supabase lookup warning:', err.message);
    }
  }

  if (!expiresAt && billingCycle !== 'LIFETIME') {
    const sMs = Date.parse(subStartTime) || nowMs;
    expiresAt = new Date(sMs + durationMs).toISOString();
  }

  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : (Date.parse(subStartTime) + durationMs);

  return res.status(200).json({
    ok: true,
    success: true,
    hwid: cleanHwid,
    tier: effectiveTier,
    plan: effectiveTier.toLowerCase(),
    billing_cycle: billingCycle,
    created_at: firstActivatedAt,
    first_activated_at: firstActivatedAt,
    start_time: subStartTime,
    subscription_start_time: subStartTime,
    expires_at: expiresAt,
    expires_at_ms: expiresAtMs,
    duration_ms: durationMs,
    server_time: nowMs,
    status: status,
    is_anchored: isAnchored
  });
};
