// ============================================================================
// VERCEL SERVERLESS FUNCTION: GET /api/devices
// ============================================================================
// Lists approved and pending terminals / paired devices.
// Backed by Supabase with automatic offline/standalone fallback.
// ============================================================================

'use strict';

module.exports = async function handler(req, res) {
  // CORS & Security Headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    // Graceful standalone fallback: return primary active terminal
    return res.status(200).json({
      status: 'OK',
      source: 'LOCAL_STANDALONE',
      devices: [
        {
          node_id: 'terminal_pc_master',
          device_name: 'Master Terminal (Primary Register)',
          user_agent: req.headers['user-agent'] || 'Valenixia POS Native Host',
          approved_at: Date.now(),
          status: 'APPROVED'
        }
      ]
    });
  }

  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data, error } = await supabase
      .from('approved_devices')
      .select('*')
      .order('approved_at', { ascending: false });

    if (error) {
      console.warn('[DevicesAPI] Supabase query error:', error.message);
      return res.status(200).json({
        status: 'OK',
        source: 'FALLBACK',
        devices: [
          {
            node_id: 'terminal_pc_master',
            device_name: 'Master Terminal (Primary Register)',
            user_agent: req.headers['user-agent'] || 'Valenixia POS Native Host',
            approved_at: Date.now(),
            status: 'APPROVED'
          }
        ]
      });
    }

    const devices = (data && data.length > 0) ? data : [
      {
        node_id: 'terminal_pc_master',
        device_name: 'Master Terminal (Primary Register)',
        user_agent: req.headers['user-agent'] || 'Valenixia POS Native Host',
        approved_at: Date.now(),
        status: 'APPROVED'
      }
    ];

    return res.status(200).json({
      status: 'OK',
      source: 'SUPABASE',
      devices
    });

  } catch (err) {
    console.error('[DevicesAPI] Internal handler error:', err.message);
    return res.status(200).json({
      status: 'OK',
      source: 'OFFLINE_RECOVERY',
      devices: [
        {
          node_id: 'terminal_pc_master',
          device_name: 'Master Terminal (Primary Register)',
          user_agent: req.headers['user-agent'] || 'Valenixia POS Native Host',
          approved_at: Date.now(),
          status: 'APPROVED'
        }
      ]
    });
  }
};
