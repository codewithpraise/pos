// ============================================================================
// VERCEL SERVERLESS FUNCTION: POST /api/claims/downgrade
// Downgrades subscriber tier in cloud
// ============================================================================

'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wzvwyfyefbdrqscxhwsf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6dnd5ZnllZmJkcnFzY3hod3NmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MzU3ODUsImV4cCI6MjA5ODQxMTc4NX0.W9O6U4tqETM6BcEjX7evt3LunpIZOC5c7wcZht2ajuk';

function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const { createClient } = require('@supabase/supabase-js');
    return createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  } catch (e) {
    console.warn('[ClaimsDowngrade] Supabase client init error:', e.message);
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { subscriberId, hwid, targetTier, daysToAdd } = req.body || {};
    const effectiveTier = (targetTier || 'FREE').toUpperCase();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const days = parseInt(daysToAdd !== undefined ? daysToAdd : (effectiveTier === 'FREE' ? 0 : 30), 10);
    const expiresAtMs = effectiveTier === 'FREE' ? 0 : (now + days * 24 * 60 * 60 * 1000);
    const expiresAtIso = expiresAtMs ? new Date(expiresAtMs).toISOString() : null;

    const supabase = getSupabaseClient();
    if (supabase && hwid && hwid !== 'DEV-HWID-UNKNOWN') {
      try {
        const cleanHwid = String(hwid).trim().toUpperCase();
        const isHex32 = cleanHwid.length === 32 && /^[0-9a-fA-F]{32}$/.test(cleanHwid);
        const formattedUuid = isHex32
          ? `${cleanHwid.slice(0,8)}-${cleanHwid.slice(8,12)}-${cleanHwid.slice(12,16)}-${cleanHwid.slice(16,20)}-${cleanHwid.slice(20,32)}`.toLowerCase()
          : cleanHwid;

        const conds = [`id.eq.${cleanHwid}`, `id.eq.${cleanHwid.toLowerCase()}`];
        if (formattedUuid !== cleanHwid) conds.push(`id.eq.${formattedUuid}`);

        await supabase
          .from('stores')
          .update({
            tier: effectiveTier,
            plan: effectiveTier.toLowerCase(),
            subscription_start_time: nowIso,
            expires_at: expiresAtIso,
            is_active: effectiveTier !== 'FREE',
            updated_at: nowIso
          })
          .or(conds.join(','));
      } catch (sbErr) {
        console.warn('[ClaimsDowngrade] Supabase update warning:', sbErr.message);
      }
    }

    return res.status(200).json({
      ok: true,
      success: true,
      subscriberId,
      targetTier: effectiveTier,
      expiresAt: expiresAtIso,
      expiresAtMs: expiresAtMs
    });
  } catch (err) {
    console.error('[ClaimsDowngrade] Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
