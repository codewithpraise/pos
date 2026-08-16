// ============================================================================
// VERCEL SERVERLESS FUNCTION: GET /api/subscription/status
// ============================================================================
// Authoritative Hardware-Bound Tier & Countdown Status for Serverless
// ============================================================================

'use strict';

module.exports = async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-device-hwid');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const rawHwid = (req.query && req.query.hwid) || req.headers['x-device-hwid'] || null;
  const cleanHwid = rawHwid ? String(rawHwid).trim().toUpperCase() : 'DEFAULT_DEVICE';
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  let effectiveTier = 'STARTER';
  let subStartTime = nowIso;
  let firstActivatedAt = nowIso;
  let expiresAt = null;
  let durationMs = 30 * 24 * 60 * 60 * 1000;
  let billingCycle = 'MONTHLY';
  let status = 'active';

  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      });

      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .or(`id.eq.${cleanHwid},id.eq.${cleanHwid.toLowerCase()}`);

      if (!error && data && data.length > 0) {
        const store = data[0];
        effectiveTier = String(store.plan || store.tier || 'STARTER').toUpperCase();
        subStartTime = store.subscription_start_time || store.created_at || store.updated_at || nowIso;
        firstActivatedAt = store.created_at || subStartTime;
        expiresAt = store.expires_at || null;
        if (!expiresAt) {
          expiresAt = new Date(Date.parse(subStartTime) + durationMs).toISOString();
        }
        status = store.is_active !== false ? 'active' : 'inactive';
      }
    } catch (err) {
      console.warn('[ServerlessSubscription] Supabase lookup warning:', err.message);
    }
  }

  if (!expiresAt && billingCycle !== 'LIFETIME') {
    expiresAt = new Date(Date.parse(subStartTime) + durationMs).toISOString();
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
    status: status
  });
};
