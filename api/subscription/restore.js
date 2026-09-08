// ============================================================================
// VERCEL SERVERLESS FUNCTION: /api/subscription/restore (Cloud Store & Account Recovery)
// Searches Supabase `stores`, `payment_proofs`, and active claims by Phone, Claim ID, RRN, Store Name, or HWID
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
    console.warn('[RestoreAPI] Supabase client init error:', e.message);
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

  const queryRaw = (req.query?.query || req.query?.q || req.body?.query || '').trim();
  if (!queryRaw) {
    return res.status(400).json({ ok: false, success: false, error: 'Query parameter is required' });
  }

  const cleanQ = queryRaw.toUpperCase();
  const rawQ = queryRaw;
  const cleanPhone = rawQ.replace(/[\s\-\+\(\)]/g, '').replace(/^92/, '0');
  const now = Date.now();

  const candidatesMap = new Map();

  // 1. Search in-memory claims cache
  if (global.__valenixiaCloudClaimsCache && Array.isArray(global.__valenixiaCloudClaimsCache)) {
    global.__valenixiaCloudClaimsCache.forEach(c => {
      if (!c) return;
      const cPhone = (c.phone || '').replace(/[\s\-\+\(\)]/g, '').replace(/^92/, '0');
      const idMatch = c.id && String(c.id).toUpperCase().includes(cleanQ);
      const rrnMatch = c.rrn && String(c.rrn).toUpperCase().includes(cleanQ);
      const phoneMatch = cPhone && (cPhone.includes(cleanPhone) || (cleanPhone.length >= 7 && cleanPhone.includes(cPhone)));
      const hwidMatch = c.hwid && String(c.hwid).toUpperCase() === cleanQ;
      const storeMatch = c.storeName && String(c.storeName).toLowerCase().includes(rawQ.toLowerCase());

      if (idMatch || rrnMatch || phoneMatch || hwidMatch || storeMatch) {
        const tier = (c.targetTier || 'PRO').toUpperCase();
        const expMs = c.expiresAt ? (typeof c.expiresAt === 'number' ? c.expiresAt : Date.parse(c.expiresAt)) : (now + 30 * 86400000);
        const daysRemaining = Math.max(0, Math.ceil((expMs - now) / 86400000));
        const isNative = (c.hwid && (c.hwid.includes('AND-') || c.hwid.includes('MOBILE'))) || (c.platform === 'NATIVE') || (c.storeName && c.storeName.includes('Mobile'));

        candidatesMap.set(c.id || c.hwid, {
          id: c.id || ('STORE-' + (c.hwid || '01').slice(0, 8)),
          claim: c,
          hwid: c.hwid || '',
          storeName: c.storeName || 'Valenixia Commercial Store',
          ownerName: c.ownerName || 'Merchant',
          phone: c.phone || cleanPhone || '—',
          tier: tier,
          plan: tier.toLowerCase(),
          daysRemaining: daysRemaining,
          expiresAt: expMs,
          status: c.status || 'APPROVED',
          platform: isNative ? 'Android Native App' : 'Web Application'
        });
      }
    });
  }

  // 2. Search Supabase Cloud database
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      // 2a. Query `stores` table
      const { data: storesData } = await supabase
        .from('stores')
        .select('*')
        .or(`id.ilike.%${cleanQ}%,name.ilike.%${rawQ}%,region.ilike.%${cleanPhone}%`)
        .limit(20);

      if (Array.isArray(storesData)) {
        storesData.forEach(s => {
          const tier = String(s.plan || s.tier || 'PRO').toUpperCase();
          const createdMs = s.created_at ? Date.parse(s.created_at) : now;
          const expMs = s.expires_at ? Date.parse(s.expires_at) : (createdMs + 30 * 86400000);
          const daysRemaining = Math.max(0, Math.ceil((expMs - now) / 86400000));
          const isNative = s.id && (s.id.includes('AND') || s.id.includes('MOBILE') || s.id.includes('NATIVE'));

          if (!candidatesMap.has(s.id)) {
            candidatesMap.set(s.id, {
              id: 'STORE_' + s.id.slice(0, 8),
              claim: {
                id: 'STORE_' + s.id.slice(0, 8),
                hwid: s.id,
                storeName: s.name || `Store (${s.id.slice(0, 8)})`,
                ownerName: 'Store Merchant',
                phone: s.region || cleanPhone,
                targetTier: tier,
                status: 'APPROVED',
                expiresAt: expMs
              },
              hwid: s.id,
              storeName: s.name || `Store (${s.id.slice(0, 8)})`,
              ownerName: 'Store Merchant',
              phone: s.region || cleanPhone,
              tier: tier,
              plan: tier.toLowerCase(),
              daysRemaining: daysRemaining,
              expiresAt: expMs,
              status: s.is_active !== false ? 'APPROVED' : 'INACTIVE',
              platform: isNative ? 'Android Native App' : 'Web Application'
            });
          }
        });
      }

      // 2b. Query `payment_proofs` table
      const { data: proofsData } = await supabase
        .from('payment_proofs')
        .select('*')
        .or(`invoice_id.ilike.%${cleanQ}%,store_id.ilike.%${cleanQ}%,proof_url.ilike.%${cleanPhone}%,proof_url.ilike.%${rawQ}%`)
        .limit(20);

      if (Array.isArray(proofsData)) {
        proofsData.forEach(p => {
          let meta = {};
          if (p.proof_url && p.proof_url.startsWith('{')) {
            try { meta = JSON.parse(p.proof_url); } catch (_) {}
          }
          const tier = String(p.plan_id || meta.targetTier || 'PRO').toUpperCase();
          const pClaimId = meta.claimId || p.invoice_id || ('CLM-' + String(p.id).replace(/-/g, '').slice(0, 6).toUpperCase());
          const expMs = meta.expiresAt || (Date.now() + 30 * 86400000);
          const daysRemaining = Math.max(0, Math.ceil((expMs - now) / 86400000));
          const isNative = (meta.hwid && meta.hwid.includes('AND')) || meta.platform === 'NATIVE';

          candidatesMap.set(pClaimId, {
            id: pClaimId,
            claim: {
              id: pClaimId,
              hwid: meta.hwid || p.store_id,
              storeName: meta.storeName || `Store (${String(meta.hwid || p.store_id || '').slice(0, 8)})`,
              ownerName: meta.ownerName || 'Store Merchant',
              phone: meta.phone || cleanPhone,
              targetTier: tier,
              rrn: p.rrn_reference || meta.rrn || '—',
              status: 'APPROVED',
              expiresAt: expMs
            },
            hwid: meta.hwid || p.store_id || '',
            storeName: meta.storeName || `Store (${String(meta.hwid || p.store_id || '').slice(0, 8)})`,
            ownerName: meta.ownerName || 'Store Merchant',
            phone: meta.phone || cleanPhone,
            tier: tier,
            plan: tier.toLowerCase(),
            daysRemaining: daysRemaining,
            expiresAt: expMs,
            status: String(p.status || 'APPROVED').toUpperCase(),
            platform: isNative ? 'Android Native App' : 'Web Application'
          });
        });
      }
    } catch (e) {
      console.warn('[RestoreAPI] Cloud query error:', e.message);
    }
  }

  const stores = Array.from(candidatesMap.values());

  return res.status(200).json({
    ok: true,
    success: stores.length > 0,
    count: stores.length,
    stores: stores,
    message: stores.length > 0 ? `Found ${stores.length} matching store(s)` : 'No store accounts found matching your query.'
  });
};
