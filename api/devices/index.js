// ============================================================================
// VERCEL SERVERLESS FUNCTION: /api/devices (Unified Devices Management)
// Handles GET (list), POST /api/devices/register, approve, reject
// ============================================================================

'use strict';

const { registerDeviceSupabase } = require('../../lib/device-registration-service');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;
const _rateLimitStore = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const entry = _rateLimitStore.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    _rateLimitStore.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return true;
  return false;
}

module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const urlPath = req.url || '';
  const action = (req.query?.action || req.body?.action || '').toLowerCase();
  const isRegister = urlPath.includes('/register') || action === 'register';
  const isApprove = urlPath.includes('/approve') || action === 'approve';
  const isReject = urlPath.includes('/reject') || action === 'reject';

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const JWT_SECRET   = process.env.JWT_SECRET;

  // ── ACTION: APPROVE DEVICE ──
  if (isApprove && req.method === 'POST') {
    const { nodeId } = req.body || {};
    if (!nodeId) return res.status(400).json({ error: 'nodeId is required.' });
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(200).json({ status: 'APPROVED', nodeId, mode: 'STANDALONE_LOCAL' });

    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      await supabase.from('approved_devices').update({ status: 'APPROVED', approved_at: new Date().toISOString() }).eq('node_id', nodeId);
      return res.status(200).json({ status: 'APPROVED', nodeId });
    } catch (err) {
      return res.status(200).json({ status: 'APPROVED', nodeId, mode: 'OFFLINE_FALLBACK' });
    }
  }

  // ── ACTION: REJECT DEVICE ──
  if (isReject && req.method === 'POST') {
    const { nodeId } = req.body || {};
    if (!nodeId) return res.status(400).json({ error: 'nodeId is required.' });
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(200).json({ status: 'REJECTED', nodeId, mode: 'STANDALONE_LOCAL' });

    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      await supabase.from('approved_devices').update({ status: 'REJECTED' }).eq('node_id', nodeId);
      return res.status(200).json({ status: 'REJECTED', nodeId });
    } catch (err) {
      return res.status(200).json({ status: 'REJECTED', nodeId, mode: 'OFFLINE_FALLBACK' });
    }
  }

  // ── ACTION: REGISTER DEVICE ──
  if (isRegister || (req.method === 'POST' && (req.body?.nodeId || req.body?.platform))) {
    const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    if (isRateLimited(clientIp)) {
      return res.status(429).json({ error: 'Too many registration requests. Please wait before retrying.' });
    }

    const { nodeId, deviceName, platform, userAgent } = req.body || {};
    if (!nodeId || typeof nodeId !== 'string' || nodeId.trim().length === 0) {
      return res.status(400).json({ error: 'nodeId is required.' });
    }

    const sanitizedNodeId = nodeId.trim().slice(0, 128);
    if (!/^[a-zA-Z0-9_\-]+$/.test(sanitizedNodeId)) {
      return res.status(400).json({ error: 'nodeId contains invalid characters.' });
    }

    if (!SUPABASE_URL || !SUPABASE_KEY || !JWT_SECRET) {
      return res.status(200).json({ status: 'OFFLINE_MODE', nodeId: sanitizedNodeId });
    }

    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const result = await registerDeviceSupabase({
        nodeId: sanitizedNodeId,
        deviceName: (deviceName || '').slice(0, 128),
        userAgent: (userAgent || req.headers['user-agent'] || '').slice(0, 256),
        platform: (platform || 'WEB').slice(0, 32),
        supabase,
        jwtSecret: JWT_SECRET
      });
      return res.status(200).json(result);
    } catch (err) {
      return res.status(200).json({ status: 'OFFLINE_MODE', nodeId: sanitizedNodeId });
    }
  }

  // ── ACTION: GET /api/devices (LIST DEVICES) ──
  if (req.method === 'GET') {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
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
  }

  return res.status(405).json({ error: 'Method not allowed.' });
};
