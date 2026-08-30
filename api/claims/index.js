// ============================================================================
// VERCEL SERVERLESS FUNCTION: /api/claims (Unified Claims & Lifecycle Manager)
// Supports GET (list), POST (create), and lifecycle actions (approve, reject, downgrade)
// ============================================================================

'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wzvwyfyefbdrqscxhwsf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6dnd5ZnllZmJkcnFzY3hod3NmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MzU3ODUsImV4cCI6MjA5ODQxMTc4NX0.W9O6U4tqETM6BcEjX7evt3LunpIZOC5c7wcZht2ajuk';

// In-memory cache for serverless execution lifecycle
if (!global.__valenixiaCloudClaimsCache) {
  global.__valenixiaCloudClaimsCache = [];
}

function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const { createClient } = require('@supabase/supabase-js');
    return createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  } catch (e) {
    console.warn('[ClaimsAPI] Supabase client init error:', e.message);
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-device-hwid');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const urlPath = req.url || '';
  const action = (req.query?.action || req.body?.action || '').toLowerCase();
  const isApprove = urlPath.includes('/approve') || action === 'approve';
  const isReject = urlPath.includes('/reject') || action === 'reject';
  const isDowngrade = urlPath.includes('/downgrade') || action === 'downgrade';

  // ── ACTION: APPROVE CLAIM ──
  if (isApprove) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    try {
      const { claimId, claim_id, hwid, targetTier, target_tier, daysToAdd, isLifetime } = req.body || {};
      const effectiveClaimId = String(claimId || claim_id || '').trim();
      if (!effectiveClaimId) return res.status(400).json({ error: 'Missing claimId' });

      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const days = parseInt(daysToAdd || 30, 10);
      const expiresAtMs = isLifetime ? null : (now + days * 24 * 60 * 60 * 1000);
      const expiresAtIso = expiresAtMs ? new Date(expiresAtMs).toISOString() : null;
      let resolvedTier = (targetTier || target_tier || 'STARTER').toUpperCase();

      if (global.__valenixiaCloudClaimsCache) {
        const cached = global.__valenixiaCloudClaimsCache.find(c => String(c.id).trim() === effectiveClaimId || String(c.rawId).trim() === effectiveClaimId);
        if (cached) {
          cached.status = 'APPROVED';
          cached.resolvedAt = nowIso;
          if (!targetTier && cached.targetTier) resolvedTier = cached.targetTier.toUpperCase();
        }
      }

      const supabase = getSupabaseClient();
      if (supabase) {
        try {
          await supabase
            .from('payment_proofs')
            .update({ status: 'approved', updated_at: nowIso })
            .or(`id.eq.${effectiveClaimId},rrn_reference.eq.${effectiveClaimId}`);

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
          console.warn('[ClaimsAPI] Supabase approve warning:', sbErr.message);
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
      return res.status(500).json({ error: err.message });
    }
  }

  // ── ACTION: REJECT CLAIM ──
  if (isReject) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    try {
      const { claimId, claim_id, reason } = req.body || {};
      const effectiveClaimId = String(claimId || claim_id || '').trim();
      if (!effectiveClaimId) return res.status(400).json({ error: 'Missing claimId' });

      const nowIso = new Date().toISOString();
      if (global.__valenixiaCloudClaimsCache) {
        const cached = global.__valenixiaCloudClaimsCache.find(c => String(c.id).trim() === effectiveClaimId || String(c.rawId).trim() === effectiveClaimId);
        if (cached) {
          cached.status = 'REJECTED';
          cached.resolvedAt = nowIso;
        }
      }

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
          console.warn('[ClaimsAPI] Supabase reject warning:', sbErr.message);
        }
      }

      return res.status(200).json({
        ok: true,
        success: true,
        claimId: effectiveClaimId,
        status: 'REJECTED'
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── ACTION: DOWNGRADE TIER ──
  if (isDowngrade) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
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
          console.warn('[ClaimsAPI] Supabase downgrade warning:', sbErr.message);
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
      return res.status(500).json({ error: err.message });
    }
  }

  // ── GET: LIST CLAIMS ──
  if (req.method === 'GET') {
    try {
      const supabase = getSupabaseClient();
      let dbClaims = [];

      if (supabase) {
        try {
          const { data, error } = await supabase
            .from('payment_proofs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100);

          if (!error && Array.isArray(data)) {
            dbClaims = data.map(p => {
              const planId = (p.plan_id || 'STARTER').toUpperCase();
              const statusUpper = (p.status || 'pending').toUpperCase();
              const dateStr = p.created_at ? new Date(p.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
              const amountNum = parseFloat(p.amount) || (planId === 'ENTERPRISE' ? 14999 : (planId === 'PRO' ? 6999 : 2999));
              return {
                id: p.id && String(p.id).startsWith('CLM-') ? p.id : (p.claim_id || ('CLM-' + String(p.id || '').slice(0, 8).toUpperCase())),
                rawId: p.id,
                hwid: p.hwid || p.user_id || 'DEV-HWID-UNKNOWN',
                storeName: p.store_name || `Store (${String(p.user_id || p.hwid || '').slice(0, 8)})`,
                ownerName: p.owner_name || 'Store Merchant',
                phone: p.phone || '—',
                category: p.category || 'General Retail',
                module: p.module || `${planId} Plan`,
                targetTier: planId,
                rrn: p.rrn_reference || p.rrn || '—',
                amount: `PKR ${amountNum.toLocaleString()}`,
                amountVal: amountNum,
                date: dateStr,
                timestamp: p.created_at ? new Date(p.created_at).getTime() : Date.now(),
                status: statusUpper === 'APPROVED' ? 'APPROVED' : (statusUpper === 'REJECTED' ? 'REJECTED' : 'PENDING'),
                resolvedAt: p.updated_at || null
              };
            });
          }
        } catch (dbErr) {
          console.warn('[ClaimsAPI] Supabase fetch warning:', dbErr.message);
        }
      }

      const mergedMap = new Map();
      global.__valenixiaCloudClaimsCache.forEach(c => { if (c && c.id) mergedMap.set(String(c.id).trim(), c); });
      dbClaims.forEach(c => { if (c && c.id) mergedMap.set(String(c.id).trim(), c); });

      const allClaims = Array.from(mergedMap.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      return res.status(200).json({
        ok: true,
        success: true,
        count: allClaims.length,
        claims: allClaims
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: CREATE NEW CLAIM ──
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const id = body.id || ('CLM-' + Math.floor(100000 + Math.random() * 900000));
      const hwid = body.hwid || req.headers['x-device-hwid'] || 'DEV-HWID-UNKNOWN';
      const storeName = body.storeName || body.store_name || 'Valenixia Commercial Store';
      const ownerName = body.ownerName || body.owner_name || 'Store Merchant';
      const phone = body.phone || '+92 331 5133226';
      const category = body.category || 'General Retail';
      const targetTier = (body.targetTier || body.plan_id || 'PRO').toUpperCase();
      const moduleName = body.module || `${targetTier} Plan (MONTHLY)`;
      const rrn = body.rrn || body.rrn_reference || ('WA_TX_' + Math.random().toString(36).substring(2, 8).toUpperCase());
      const amountVal = parseFloat(body.amountVal || body.amount || (targetTier === 'ENTERPRISE' ? 14999 : (targetTier === 'PRO' ? 6999 : 2999)));
      const date = body.date || new Date().toISOString().split('T')[0];
      const timestamp = body.timestamp || Date.now();
      const status = (body.status || 'PENDING').toUpperCase();

      const newClaim = {
        id,
        hwid,
        storeName,
        ownerName,
        phone,
        category,
        module: moduleName,
        targetTier,
        rrn,
        amount: `PKR ${amountVal.toLocaleString()}`,
        amountVal,
        date,
        timestamp,
        status
      };

      const existingIdx = global.__valenixiaCloudClaimsCache.findIndex(c => c.id === id || (c.rrn && c.rrn === rrn));
      if (existingIdx >= 0) {
        global.__valenixiaCloudClaimsCache[existingIdx] = newClaim;
      } else {
        global.__valenixiaCloudClaimsCache.unshift(newClaim);
      }

      const supabase = getSupabaseClient();
      if (supabase) {
        try {
          await supabase.from('payment_proofs').upsert({
            id: id,
            user_id: hwid,
            plan_id: targetTier,
            mode: 'subscription',
            rrn_reference: rrn,
            amount: amountVal,
            proof_image_url: body.proofUrl || '',
            status: status.toLowerCase(),
            created_at: new Date(timestamp).toISOString(),
            updated_at: new Date(timestamp).toISOString()
          }, { onConflict: 'id' });
        } catch (sbErr) {
          console.warn('[ClaimsAPI] Supabase payment_proofs insert warning:', sbErr.message);
        }
      }

      return res.status(201).json({
        ok: true,
        success: true,
        claim: newClaim
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
