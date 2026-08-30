// ============================================================================
// VERCEL SERVERLESS FUNCTION: POST /api/claims/reject
// Rejects customer upgrade claim in cloud
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
    console.warn('[ClaimsReject] Supabase client init error:', e.message);
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
    const { claimId, claim_id, reason } = req.body || {};
    const effectiveClaimId = String(claimId || claim_id || '').trim();
    if (!effectiveClaimId) {
      return res.status(400).json({ error: 'Missing claimId' });
    }

    const nowIso = new Date().toISOString();

    // 1. Update in-memory cache
    if (global.__valenixiaCloudClaimsCache) {
      const cached = global.__valenixiaCloudClaimsCache.find(c => String(c.id).trim() === effectiveClaimId || String(c.rawId).trim() === effectiveClaimId);
      if (cached) {
        cached.status = 'REJECTED';
        cached.resolvedAt = nowIso;
      }
    }

    // 2. Update Supabase
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase
          .from('payment_proofs')
          .update({
            status: 'rejected',
            rejection_reason: reason || 'Rejected by platform admin',
            updated_at: nowIso
          })
          .or(`id.eq.${effectiveClaimId},rrn_reference.eq.${effectiveClaimId}`);
      } catch (sbErr) {
        console.warn('[ClaimsReject] Supabase update warning:', sbErr.message);
      }
    }

    return res.status(200).json({
      ok: true,
      success: true,
      claimId: effectiveClaimId,
      status: 'REJECTED'
    });
  } catch (err) {
    console.error('[ClaimsReject] Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
