// ============================================================================
// VERCEL SERVERLESS FUNCTION: /api/claims
// GET: List all customer upgrade claims across all stores & devices
// POST: Submit a new customer upgrade claim (from Native App or Web)
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
    console.warn('[ClaimsAPI] Supabase client init error:', e.message);
    return null;
  }
}

// In-memory fallback cache for serverless invocation lifecycle
if (!global.__valenixiaCloudClaimsCache) {
  global.__valenixiaCloudClaimsCache = [];
}

module.exports = async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-device-hwid');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const supabase = getSupabaseClient();

  // ── GET: Fetch All Claims ─────────────────────────────────────────────────
  if (req.method === 'GET') {
    let cloudClaims = [];
    if (supabase) {
      try {
        // Query payment_proofs
        const { data: proofs, error: pErr } = await supabase
          .from('payment_proofs')
          .select('*')
          .order('created_at', { ascending: false });

        if (!pErr && Array.isArray(proofs)) {
          cloudClaims = proofs.map(p => {
            const planId = (p.plan_id || 'STARTER').toUpperCase();
            const statusUpper = (p.status || 'pending').toUpperCase();
            const dateStr = p.created_at ? new Date(p.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
            const amountNum = parseFloat(p.amount) || 0;
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
      } catch (err) {
        console.warn('[ClaimsAPI] Supabase fetch warning:', err.message);
      }
    }

    // Merge with in-memory cache
    const mergedMap = new Map();
    (global.__valenixiaCloudClaimsCache || []).forEach(c => {
      if (c && c.id) mergedMap.set(String(c.id).trim(), c);
    });
    cloudClaims.forEach(c => {
      if (c && c.id) mergedMap.set(String(c.id).trim(), c);
    });

    const allClaims = Array.from(mergedMap.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    return res.status(200).json({
      ok: true,
      success: true,
      count: allClaims.length,
      claims: allClaims
    });
  }

  // ── POST: Submit New Claim ────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const id = body.id || ('CLM-' + Math.floor(100000 + Math.random() * 900000));
      const hwid = body.hwid || req.headers['x-device-hwid'] || 'DEV-HWID-LOCAL-NODE';
      const storeName = body.storeName || body.store_name || 'Valenixia Commercial Store';
      const ownerName = body.ownerName || body.owner_name || 'Store Merchant';
      const phone = body.phone || '+92 331 5133226';
      const category = body.category || 'General Retail';
      const targetTier = (body.targetTier || body.plan_id || 'PRO').toUpperCase();
      const moduleName = body.module || `${targetTier} Plan (MONTHLY)`;
      const rrn = body.rrn || body.rrn_reference || ('WA_TX_' + Math.random().toString(36).substring(2, 8).toUpperCase());
      const amountVal = parseFloat(body.amountVal || body.amount || 6999);
      const date = body.date || new Date().toISOString().split('T')[0];
      const timestamp = body.timestamp || Date.now();
      const status = (body.status || 'PENDING').toUpperCase();

      const standardizedClaim = {
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

      // Add to in-memory cache
      global.__valenixiaCloudClaimsCache = global.__valenixiaCloudClaimsCache || [];
      const existingIdx = global.__valenixiaCloudClaimsCache.findIndex(c => c.id === id || (c.rrn && c.rrn === rrn));
      if (existingIdx >= 0) {
        global.__valenixiaCloudClaimsCache[existingIdx] = standardizedClaim;
      } else {
        global.__valenixiaCloudClaimsCache.unshift(standardizedClaim);
      }

      // Persist to Supabase if available
      if (supabase) {
        try {
          // 1. Insert into payment_proofs
          await supabase.from('payment_proofs').upsert({
            id: (id.startsWith('CLM-') ? undefined : id),
            user_id: hwid,
            plan_id: targetTier,
            rrn_reference: rrn,
            amount: amountVal,
            proof_image_url: '',
            status: status.toLowerCase(),
            created_at: new Date(timestamp).toISOString(),
            updated_at: new Date(timestamp).toISOString()
          }, { onConflict: 'rrn_reference' }).catch(() => {});

          // 2. Ensure store record exists with HWID
          const cleanHwid = String(hwid).trim().toUpperCase();
          const isHex32 = cleanHwid.length === 32 && /^[0-9a-fA-F]{32}$/.test(cleanHwid);
          const formattedUuid = isHex32
            ? `${cleanHwid.slice(0,8)}-${cleanHwid.slice(8,12)}-${cleanHwid.slice(12,16)}-${cleanHwid.slice(16,20)}-${cleanHwid.slice(20,32)}`.toLowerCase()
            : cleanHwid;

          await supabase.from('stores').upsert({
            id: formattedUuid,
            name: storeName,
            phone: phone,
            email: `${cleanHwid.slice(0, 8).toLowerCase()}@valenixia.local`,
            tier: 'STARTER',
            plan: 'starter',
            is_active: true,
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' }).catch(() => {});
        } catch (sbErr) {
          console.warn('[ClaimsAPI] Supabase save error:', sbErr.message);
        }
      }

      return res.status(201).json({
        ok: true,
        success: true,
        message: 'Claim recorded successfully',
        claim: standardizedClaim
      });
    } catch (err) {
      console.error('[ClaimsAPI] Post error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
