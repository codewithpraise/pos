// ============================================================================
// VERCEL SERVERLESS FUNCTION: POST /api/claims/approve
// Approves customer upgrade claim & updates cloud store tier
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
    console.warn('[ClaimsApprove] Supabase client init error:', e.message);
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
    const { claimId, claim_id, hwid, targetTier, target_tier, daysToAdd, isLifetime } = req.body || {};
    const effectiveClaimId = String(claimId || claim_id || '').trim();
    if (!effectiveClaimId) {
      return res.status(400).json({ error: 'Missing claimId' });
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const days = parseInt(daysToAdd || 30, 10);
    const expiresAtMs = isLifetime ? null : (now + days * 24 * 60 * 60 * 1000);
    const expiresAtIso = expiresAtMs ? new Date(expiresAtMs).toISOString() : null;

    let resolvedTier = (targetTier || target_tier || 'STARTER').toUpperCase();

    // 1. Update in-memory cache
    if (global.__valenixiaCloudClaimsCache) {
      const cached = global.__valenixiaCloudClaimsCache.find(c => String(c.id).trim() === effectiveClaimId || String(c.rawId).trim() === effectiveClaimId);
      if (cached) {
        cached.status = 'APPROVED';
        cached.resolvedAt = nowIso;
        if (!targetTier && cached.targetTier) {
          resolvedTier = cached.targetTier.toUpperCase();
        }
      }
    }

    // 2. Update Supabase
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        // Update payment_proofs
        await supabase
          .from('payment_proofs')
          .update({
            status: 'approved',
            updated_at: nowIso
          })
          .or(`id.eq.${effectiveClaimId},rrn_reference.eq.${effectiveClaimId}`);

        // Update stores table
        const targetHwid = hwid || (global.__valenixiaCloudClaimsCache ? (global.__valenixiaCloudClaimsCache.find(c => String(c.id).trim() === effectiveClaimId)?.hwid) : null);
        if (targetHwid && targetHwid !== 'DEV-HWID-UNKNOWN') {
          const cleanHwid = String(targetHwid).trim().toUpperCase();
          const isHex32 = cleanHwid.length === 32 && /^[0-9a-fA-F]{32}$/.test(cleanHwid);
          const formattedUuid = isHex32
            ? `${cleanHwid.slice(0,8)}-${cleanHwid.slice(8,12)}-${cleanHwid.slice(12,16)}-${cleanHwid.slice(16,20)}-${cleanHwid.slice(20,32)}`.toLowerCase()
            : cleanHwid;

          const conds = [`id.eq.${cleanHwid}`, `id.eq.${cleanHwid.toLowerCase()}`];
          if (formattedUuid !== cleanHwid) conds.push(`id.eq.${formattedUuid}`);

          await supabase
            .from('stores')
            .update({
              tier: resolvedTier,
              plan: resolvedTier.toLowerCase(),
              subscription_start_time: nowIso,
              expires_at: expiresAtIso,
              is_active: true,
              updated_at: nowIso
            })
            .or(conds.join(','));
        }
      } catch (sbErr) {
        console.warn('[ClaimsApprove] Supabase update warning:', sbErr.message);
      }
    }

    return res.status(200).json({
      ok: true,
      success: true,
      claimId: effectiveClaimId,
      status: 'APPROVED',
      targetTier: resolvedTier,
      expiresAt: expiresAtIso,
      expiresAtMs: expiresAtMs,
      startTime: nowIso
    });
  } catch (err) {
    console.error('[ClaimsApprove] Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
