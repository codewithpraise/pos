// ============================================================================
// VERCEL SERVERLESS FUNCTION: POST /api/devices/register
// ============================================================================
// Canonical device-registration endpoint for the Vercel/static deployment.
// Backed by Supabase. Shares business logic with server.js via
// lib/device-registration-service.js.
//
// Request:  POST /api/devices/register
//           Content-Type: application/json
//           Body: { nodeId, deviceName?, platform?, userAgent? }
//
// Response:
//   200: { status: "APPROVED", token: "<jwt>", nodeId }
//   200: { status: "OFFLINE_MODE" }   ← when Supabase/JWT not configured
//   400: { error: "nodeId is required." }
//   405: (method not allowed)
//   500: { error: "Internal server error." }
// ============================================================================

'use strict';

const { registerDeviceSupabase } = require('../../lib/device-registration-service');

// Rate limiting — simple in-memory per-IP (resets on cold start, acceptable for serverless)
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX       = 20;        // max 20 registrations per IP per minute
const _rateLimitStore      = new Map();

function isRateLimited(ip) {
  const now   = Date.now();
  const entry = _rateLimitStore.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    _rateLimitStore.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return true;
  return false;
}

// Parse request body — Vercel auto-parses JSON bodies but this ensures compatibility
async function parseBody(req) {
  // If Vercel already parsed the body, use it directly
  if (req.body && typeof req.body === 'object') return req.body;

  // Otherwise read raw stream
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch (_) { resolve({}); }
    });
    req.on('error', () => resolve({}));
    // Safety timeout
    setTimeout(() => resolve({}), 3000);
  });
}

module.exports = async function handler(req, res) {
  // CORS headers — allow the Vercel deployment origin
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://valenixia-pos.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  // Rate limiting
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many registration requests. Please wait before retrying.' });
  }

  // Parse body with fallback
  const body = await parseBody(req);
  const { nodeId, deviceName, platform, userAgent } = body;

  if (!nodeId || typeof nodeId !== 'string' || nodeId.trim().length === 0) {
    return res.status(400).json({ error: 'nodeId is required.' });
  }

  // Sanitize nodeId — alphanumeric, underscore, hyphen, max 128 chars
  const sanitizedNodeId = nodeId.trim().slice(0, 128);
  if (!/^[a-zA-Z0-9_\-]+$/.test(sanitizedNodeId)) {
    return res.status(400).json({ error: 'nodeId contains invalid characters.' });
  }

  // Validate env vars — if missing, return OFFLINE_MODE (200) so the client can continue gracefully
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const JWT_SECRET   = process.env.JWT_SECRET;

  if (!SUPABASE_URL || !SUPABASE_KEY || !JWT_SECRET) {
    // Not a fatal error — client should continue in offline/local mode
    console.warn('[DeviceRegister] Supabase/JWT env vars not configured — returning OFFLINE_MODE.');
    return res.status(200).json({ status: 'OFFLINE_MODE', nodeId: sanitizedNodeId });
  }

  let supabase;
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  } catch (err) {
    console.error('[DeviceRegister] Supabase client creation failed:', err.message);
    // Return OFFLINE_MODE gracefully instead of 503
    return res.status(200).json({ status: 'OFFLINE_MODE', nodeId: sanitizedNodeId });
  }

  try {
    const result = await registerDeviceSupabase({
      nodeId:     sanitizedNodeId,
      deviceName: (deviceName || '').slice(0, 128),
      userAgent:  (userAgent  || req.headers['user-agent'] || '').slice(0, 256),
      platform:   (platform   || 'WEB').slice(0, 32),
      supabase,
      jwtSecret:  JWT_SECRET,
    });

    // Return status with no sensitive internals
    return res.status(200).json(result);

  } catch (err) {
    console.error('[DeviceRegister] Registration failed:', err.message);
    // Return OFFLINE_MODE instead of 500 — client can still work locally
    return res.status(200).json({ status: 'OFFLINE_MODE', nodeId: sanitizedNodeId });
  }
};
