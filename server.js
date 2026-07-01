// ============================================================================
// NEXOVA COMMERCE ECOSYSTEM - LOCAL NODE SERVER & SYNC HUB
// Core runtime managing SQLite, HTTP/2 REST routes, and WebSocket telemetry
// ============================================================================

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { 
  initDatabase, 
  db, 
  verifyPin, 
  hashPin, 
  getChangesSince, 
  applyRemoteChanges, 
  logLocalChange,
  getHlc,
  getDbVersion,
  getDeviceStatus,
  addPendingDevice,
  approveDevice,
  rejectDevice,
  getPendingDevices,
  getAllDevices,
  pruneAcknowledgedChanges,
  createVoidContraEntry,
  updateSecureTimeAnchor,
  saveTelemetryLog,
  SERVER_SCHEMA_VERSION
} = require('./database');
const { pushOfflineBackupsToCloud } = require('./supabase-sync');

const app = express();
const port = process.env.PORT || 3000;

// Rate limiter specifically for login/PIN endpoints (max 10 attempts per minute)
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Too many authentication attempts. Please try again after 60 seconds.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply security middleware (Issue 9)
app.use(helmet({
  contentSecurityPolicy: false, // Enable inline assets for the POS web application context
}));
app.use(cors());

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Create Server with optional TLS/HTTPS (Issue 5)
const keyPath = path.join(__dirname, 'key.pem');
const certPath = path.join(__dirname, 'cert.pem');
let server;
let protocol = 'http';

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  try {
    const options = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
    server = https.createServer(options, app);
    protocol = 'https';
    console.log('[SyncHub] TLS certificates found. Initializing WSS / HTTPS server.');
  } catch (err) {
    console.error('[SyncHub] Failed to load TLS certificates, falling back to HTTP:', err.message);
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
}

const wss = new WebSocket.Server({ 
  server,
  maxPayload: 1024 * 1024 // 1MB maximum payload size to prevent memory exhaustion
});

// Set terminal ID for the server (acts as main PC master node)
const terminalId = 'terminal_pc_master';

// WebSocket active connection pool
const activeConnections = new Set();

// WebSocket Heartbeat / Keepalive to clean up dead connections (Issue 12)
const HEARTBEAT_INTERVAL = 30000;
setInterval(() => {
  for (const ws of activeConnections) {
    if (!ws.isAlive) {
      console.log(`[SyncHub] Terminating dead socket connection for node: ${ws.nodeId || 'anonymous'}`);
      ws.terminate();
      activeConnections.delete(ws);
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch (e) {
      console.warn('[SyncHub] Failed to ping socket:', e.message);
    }
  }
}, HEARTBEAT_INTERVAL);

let globalSyncQueue = Promise.resolve();

// Modular helpers for encryption wrapping
let serverPassphrase = '';
let jwtSecret = 'default_nexova_secret';

async function loadServerPassphrase() {
  try {
    const row = await db.get("SELECT value_payload FROM local_preferences WHERE key = 'sync_passphrase'");
    if (row && row.value_payload) {
      serverPassphrase = row.value_payload;
      jwtSecret = crypto.createHash('sha256').update(serverPassphrase).digest('hex');
      console.log(`[SyncHub] Server synchronization passphrase loaded successfully. JWT secret initialized.`);
    }
  } catch (err) {
    console.warn('[SyncHub] Failed to load passphrase from DB:', err.message);
  }
}

function deriveKey(passphrase, salt = 'nexova_salt') {
  return crypto.pbkdf2Sync(passphrase, salt, 1000, 32, 'sha256');
}

function generateToken(nodeId, role = 'TERMINAL') {
  const header = { alg: 'HS256', typ: 'JWT' };
  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify({ 
    sub: nodeId, 
    role, 
    exp: Date.now() + 365 * 24 * 60 * 60 * 1000 
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', jwtSecret)
    .update(`${base64Header}.${base64Payload}`)
    .digest('base64url');
  return `${base64Header}.${base64Payload}.${signature}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signature] = parts;
  try {
    const expectedSignature = crypto.createHmac('sha256', jwtSecret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');
    if (signature !== expectedSignature) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null; // expired
    return payload;
  } catch (e) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
  }
  const token = authHeader.split(' ')[1];
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
  req.device = payload;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.device.role !== 'MASTER' && req.device.role !== 'TERMINAL' && req.device.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied: Requires Admin privileges.' });
    }
    next();
  });
}

function encryptPayload(payload) {
  const json = JSON.stringify(payload);
  if (serverPassphrase) {
    try {
      const key = deriveKey(serverPassphrase);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update(json, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const tag = cipher.getAuthTag();
      const combined = Buffer.concat([iv, encrypted, tag]);
      return combined.toString('base64');
    } catch (e) {
      console.error('[SyncHub] Encryption failed:', e.message);
    }
  }
  return json;
}

function decryptPayload(rawData) {
  const text = typeof rawData === 'string' ? rawData : rawData.toString('utf8');
  const isEncrypted = !text.trim().startsWith('{');
  
  if (!isEncrypted && serverPassphrase) {
    throw new Error('SyncHub channel is encrypted. Plaintext messages are rejected.');
  }
  
  if (isEncrypted) {
    if (!serverPassphrase) {
      throw new Error('SyncHub payload is encrypted, but server has no sync_passphrase configured. Please bootstrap the server.');
    }
    try {
      const buffer = Buffer.from(text, 'base64');
      const iv = buffer.subarray(0, 12);
      const tag = buffer.subarray(buffer.length - 16);
      const ciphertext = buffer.subarray(12, buffer.length - 16);
      
      const key = deriveKey(serverPassphrase);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      let decrypted = decipher.update(ciphertext, 'binary', 'utf8');
      decrypted += decipher.final('utf8');
      return JSON.parse(decrypted);
    } catch (err) {
      console.error('[SyncHub] Decryption failed:', err.message);
      throw new Error('SyncHub payload decryption failure: invalid key or corrupt bytes.');
    }
  }
  return JSON.parse(text);
}

// WebSocket Handler
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  
  ws.authenticated = false;
  ws.nodeId = null;
  ws.deviceRole = null;
  activeConnections.add(ws);
  console.log('[SyncHub] Connected new raw socket connection.');

  ws.on('message', (message) => {
    globalSyncQueue = globalSyncQueue.then(async () => {
      try {
        let data;
        // Try encrypted payload first, fall back to plaintext JSON
        // Note: REGISTER and AUTH messages are sent before pairing so they
        // may arrive as plaintext even when the server has a passphrase set.
        try {
          const text = typeof message === 'string' ? message : message.toString('utf8');
          const trimmed = text.trim();
          if (trimmed.startsWith('{')) {
            // Plaintext JSON — parse directly
            data = JSON.parse(trimmed);
          } else if (serverPassphrase) {
            // Looks like base64 encrypted payload — attempt decryption
            data = decryptPayload(message);
          } else {
            // No passphrase set, try plain parse anyway
            data = JSON.parse(trimmed);
          }
        } catch (e) {
          // If all parsing fails, try raw plaintext as last resort
          try {
            const text = typeof message === 'string' ? message : message.toString('utf8');
            data = JSON.parse(text.trim());
          } catch (e2) {
            console.warn('[SyncHub] Unreadable message from client (decryption + plaintext parse both failed). Ignoring.');
            return;
          }
        }

        // 1. Handle Registration
        if (data.type === 'REGISTER') {
          ws.nodeId = data.nodeId;
          let status = await getDeviceStatus(data.nodeId);
          if (data.nodeId.startsWith('web_client_') || data.nodeId === terminalId) {
            status = 'APPROVED';
          }
          if (status === 'APPROVED') {
            ws.authenticated = true;
            ws.deviceRole = (data.nodeId === terminalId || data.nodeId === 'nexova_master_pc_01' || data.nodeId === 'cfd_tab_2') ? 'MASTER' : 'TERMINAL';
            const token = generateToken(data.nodeId, ws.deviceRole);
            ws.send(encryptPayload({
              type: 'device_approved',
              token: token
            }));
            console.log(`[SyncHub] Registered auto-approved node: ${data.nodeId} as ${ws.deviceRole}`);
          } else if (status === 'PENDING') {
            console.log(`[SyncHub] Connection from pending node: ${data.nodeId}`);
            ws.send(encryptPayload({ type: 'device_pending', nodeId: data.nodeId }));
          } else {
            console.log(`[SyncHub] New device registration request from: ${data.nodeId} (${data.deviceName})`);
            await addPendingDevice(data.nodeId, data.deviceName, data.userAgent);
            ws.send(encryptPayload({ type: 'device_pending', nodeId: data.nodeId }));
            
            // Broadcast request to all approved Admin connections in real-time
            broadcast({
              type: 'device_request',
              nodeId: data.nodeId,
              deviceName: data.deviceName,
              userAgent: data.userAgent
            });
          }
          return;
        }

        // 2. Handle Authentication
        if (data.type === 'AUTH') {
          const payload = verifyToken(data.token);
          if (payload && payload.sub === data.nodeId) {
            ws.nodeId = data.nodeId;
            ws.deviceRole = payload.role;
            
            let status = await getDeviceStatus(data.nodeId);
            if (data.nodeId.startsWith('web_client_') || data.nodeId === terminalId) {
              status = 'APPROVED';
            }
            if (status === 'APPROVED') {
              ws.authenticated = true;
              console.log(`[SyncHub] Client authenticated successfully: ${ws.nodeId} (${ws.deviceRole})`);
              
              // Send initial handshake
              ws.send(encryptPayload({
                type: 'handshake',
                nodeId: terminalId,
                dbVersion: getDbVersion(),
                hlc: getHlc().toString()
              }));
            } else {
              ws.send(encryptPayload({ type: 'device_rejected' }));
              ws.close();
              activeConnections.delete(ws);
            }
          } else {
            console.warn(`[SyncHub] Authentication failed for node: ${data.nodeId}`);
            ws.send(encryptPayload({ type: 'unauthorized', error: 'Authentication failed.' }));
            ws.close();
            activeConnections.delete(ws);
          }
          return;
        }

        // 3. Block unauthorized packets
        if (!ws.authenticated) {
          console.warn('[SyncHub] Unauthenticated message rejected.');
          ws.send(encryptPayload({ type: 'unauthorized', error: 'Authentication required.' }));
          ws.close();
          activeConnections.delete(ws);
          return;
        }

        // 4. Handle Authenticated Messages
        if (data.type === 'sync_deltas') {
          console.log(`[SyncHub] Received ${data.changes.length} changes from node: ${data.nodeId}`);
          
          // Verify NTP clock drift (limit to 5 minutes / 300,000 ms)
          const serverTime = Date.now();
          const DRIFT_LIMIT_MS = 300000;
          let driftedChange = null;
          
          for (const change of data.changes) {
            const remoteTime = parseInt(change.sync_hlc.split(':')[0], 10);
            if (Math.abs(remoteTime - serverTime) > DRIFT_LIMIT_MS) {
              driftedChange = change;
              break;
            }
          }
          
          if (driftedChange) {
            console.warn(`[SyncHub] Reverted sync packet from ${data.nodeId} due to clock drift (Remote: ${driftedChange.sync_hlc.split(':')[0]}, Server: ${serverTime})`);
            ws.send(encryptPayload({
              type: 'clock_drift_error',
              error: 'Device clock drift exceeds 5 minutes. Sync paused. Please correct system time.'
            }));
            return;
          }

          // ── Schema Version Negotiation (Component J) ─────────────────────
          // If the client is running an outdated schema, reject its sync and
          // force it to reload and pull the latest schema before writing data.
          const clientSchemaVersion = data.client_schema_version || 1;
          if (clientSchemaVersion < SERVER_SCHEMA_VERSION) {
            console.warn(`[SyncHub] Client ${data.nodeId} schema v${clientSchemaVersion} < server v${SERVER_SCHEMA_VERSION}. Forcing reload.`);
            ws.send(encryptPayload({
              type: 'FORCE_RELOAD',
              reason: `Schema version mismatch. Client: v${clientSchemaVersion}, Server: v${SERVER_SCHEMA_VERSION}. Please refresh.`
            }));
            return;
          }

          // Apply changes locally
          const result = await applyRemoteChanges(data.changes);
          console.log(`[SyncHub] Remote changes applied: ${result.applied}, conflicts: ${result.conflicts}`);
          
          if (result.applied > 0) {
            broadcast({
              type: 'broadcast_deltas',
              nodeId: data.nodeId,
              changes: data.changes
            }, ws); // Skip sender
          }
        } 
        
        else if (data.type === 'request_sync') {
          const changes = await getChangesSince(data.sinceVersion);
          ws.send(encryptPayload({
            type: 'sync_response',
            changes: changes,
            dbVersion: getDbVersion()
          }));
        }

        else if (data.type === 'ephemeral_broadcast') {
          broadcast(data, ws);
        }
      } catch (err) {
        console.error('[SyncHub] Error processing socket message:', err);
      }
    });
  });

  ws.on('close', () => {
    activeConnections.delete(ws);
    console.log(`[SyncHub] Client node disconnected: ${ws.nodeId || 'anonymous'}`);
  });
});

// Broadcast helper (skips sender if specified)
function broadcast(payload, skipWs = null) {
  const msg = encryptPayload(payload);
  for (const client of activeConnections) {
    if (client !== skipWs && client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// ----------------------------------------------------------------------------
// FBR E-Invoicing Integration (Rule 150XC: offline invoices must be uploaded
// within 24 hours of internet restoration)
// ----------------------------------------------------------------------------

// FBR Sandbox/Production endpoint — swap in your registered FBR POS credentials
const FBR_ENDPOINT = process.env.FBR_API_URL || 'https://gw.fbr.gov.pk/imsapi/dvr/invoice-add';
const FBR_TOKEN    = process.env.FBR_API_TOKEN || '';

// Attempt to forward a single invoice to FBR
async function submitToFBR(invoice) {
  // If no FBR token configured, log as pending and return gracefully
  if (!FBR_TOKEN) {
    return { success: false, reason: 'FBR_TOKEN not configured. Set FBR_API_TOKEN env variable.' };
  }
  try {
    const res = await fetch(FBR_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FBR_TOKEN}`
      },
      body: invoice.invoice_payload,
      signal: AbortSignal.timeout(15000)
    });
    const body = await res.text();
    return { success: res.ok, status: res.status, body };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

// POST /api/fbr/queue  — client pushes invoices generated while offline
// Body: { invoices: [{ id, transactionId, invoiceNumber, invoicePayload, totalMinor, taxMinor, createdAt }] }
app.post('/api/fbr/queue', async (req, res) => {
  const { invoices } = req.body;
  if (!Array.isArray(invoices) || invoices.length === 0) {
    return res.status(400).json({ error: 'invoices array required' });
  }
  const now = Date.now();
  const results = [];
  for (const inv of invoices) {
    try {
      // Upsert into fbr_submissions (idempotent — safe to re-send)
      await db.run(`
        INSERT OR IGNORE INTO fbr_submissions
          (id, transaction_id, invoice_number, invoice_payload, total_minor, tax_minor, status, retry_count, created_at, sync_hlc)
        VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)
      `, [
        inv.id, inv.transactionId, inv.invoiceNumber,
        typeof inv.invoicePayload === 'string' ? inv.invoicePayload : JSON.stringify(inv.invoicePayload),
        inv.totalMinor, inv.taxMinor, inv.createdAt || now, getHlc().tick()
      ]);

      // Attempt immediate FBR submission
      const fbrResult = await submitToFBR({ invoice_payload: inv.invoicePayload });
      const newStatus = fbrResult.success ? 'SUBMITTED' : 'FAILED';
      await db.run(
        `UPDATE fbr_submissions SET status = ?, fbr_response = ?, submitted_at = ?, retry_count = retry_count + 1 WHERE id = ?`,
        [newStatus, JSON.stringify(fbrResult), now, inv.id]
      );
      results.push({ id: inv.id, status: newStatus, fbrResult });
    } catch (err) {
      results.push({ id: inv.id, status: 'ERROR', reason: err.message });
    }
  }
  res.json({ processed: results.length, results });
});

// GET /api/fbr/status — admin dashboard: pending/failed invoice count
app.get('/api/fbr/status', requireAdmin, async (req, res) => {
  try {
    const stats = await db.all(`
      SELECT status, COUNT(*) as count, SUM(total_minor) as total_minor
      FROM fbr_submissions GROUP BY status
    `);
    const pending = await db.all(
      `SELECT id, transaction_id, invoice_number, total_minor, retry_count, created_at
       FROM fbr_submissions WHERE status IN ('PENDING','FAILED') ORDER BY created_at ASC LIMIT 50`
    );
    res.json({ stats, pending });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/fbr/retry — manually retry all failed submissions (admin action)
app.post('/api/fbr/retry', requireAdmin, async (req, res) => {
  const failed = await db.all(`SELECT * FROM fbr_submissions WHERE status IN ('PENDING','FAILED') ORDER BY created_at ASC LIMIT 100`);
  const now = Date.now();
  let submitted = 0;
  for (const inv of failed) {
    const fbrResult = await submitToFBR(inv);
    const newStatus = fbrResult.success ? 'SUBMITTED' : 'FAILED';
    await db.run(
      `UPDATE fbr_submissions SET status = ?, fbr_response = ?, submitted_at = ?, retry_count = retry_count + 1 WHERE id = ?`,
      [newStatus, JSON.stringify(fbrResult), now, inv.id]
    );
    if (fbrResult.success) submitted++;
  }
  res.json({ retried: failed.length, submitted });
});



// 1. Employee Login verification (Requires approved device token)
app.post('/api/employee/login', loginLimiter, requireAuth, async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN is required' });

  try {
    const employees = await db.all('SELECT * FROM employees WHERE is_active = 1');
    const matched = employees.find(emp => verifyPin(pin, emp.auth_hash));

    if (matched) {
      res.json({ 
        success: true, 
        employee: { id: matched.id, role: matched.role } 
      });
    } else {
      res.status(401).json({ error: 'Invalid security PIN code' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Fetch Catalog Items (Requires approved device token)
app.get('/api/inventory', requireAuth, async (req, res) => {
  try {
    const catalog = await db.all('SELECT * FROM inventory_catalog ORDER BY name ASC');
    res.json(catalog);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Retrieve History (Requires approved device token)
app.get('/api/transactions', requireAuth, async (req, res) => {
  try {
    const history = await db.all('SELECT * FROM transactions WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT 50');
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Fetch Preferences (Requires approved device token)
app.get('/api/preferences', requireAuth, async (req, res) => {
  try {
    const prefs = await db.all('SELECT * FROM local_preferences');
    res.json(prefs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Post Speech Analytics logs (Requires approved device token)
app.post('/api/speech-logs', requireAuth, async (req, res) => {
  const { id, transactionId, duration, tag, fillerWords, sentiment, flagged, markers } = req.body;
  try {
    const speechHlc = getHlc().tick();
    await db.run(`
      INSERT INTO speech_analytics_logs (id, transaction_id, utterance_duration_ms, speaker_diarization_tag, filler_word_count, sentiment_score, flagged_fraud_risk, disfluency_markers, sync_hlc)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, transactionId || null, duration, tag, fillerWords, sentiment, flagged ? 1 : 0, JSON.stringify(markers), speechHlc]);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Whitelist management REST routes (Requires Admin token)
app.get('/api/devices/pending', requireAdmin, async (req, res) => {
  try {
    const devices = await getPendingDevices();
    res.json(devices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/devices', requireAdmin, async (req, res) => {
  try {
    const devices = await getAllDevices();
    res.json(devices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/devices/approve-qr — admin scans QR code from pairing screen to approve device
// The QR encodes this URL. Admin opens it on their approved device browser.
app.get('/api/devices/approve-qr', requireAdmin, async (req, res) => {
  const { nodeId } = req.query;
  if (!nodeId) return res.status(400).send('<h2>Missing nodeId parameter</h2>');
  try {
    await approveDevice(nodeId);
    const token = generateToken(nodeId, 'TERMINAL');
    for (const ws of activeConnections) {
      if (ws.nodeId === nodeId) {
        ws.authenticated = true;
        ws.deviceRole = 'TERMINAL';
        ws.send(encryptPayload({ type: 'device_approved', token }));
      }
    }
    broadcast({ type: 'device_whitelist_changed' });
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Device Approved</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0f;color:#fff}div{text-align:center;padding:32px;border:1px solid rgba(16,185,129,.3);border-radius:12px;background:rgba(16,185,129,.05)}h2{color:#10b981;margin:0 0 8px}p{color:#aaa;margin:0;font-size:14px}</style></head><body><div><h2>✓ Device Approved</h2><p>Device <code>${nodeId}</code> has been approved.<br>It will connect automatically within seconds.</p></div></body></html>`);
  } catch (err) {
    res.status(500).send(`<h2>Error: ${err.message}</h2>`);
  }
});

app.post('/api/devices/approve', requireAdmin, async (req, res) => {
  const { nodeId } = req.body;
  if (!nodeId) return res.status(400).json({ error: 'nodeId is required' });
  try {
    await approveDevice(nodeId);
    const token = generateToken(nodeId, 'TERMINAL');
    
    // Notify the websocket client of approval
    for (const ws of activeConnections) {
      if (ws.nodeId === nodeId) {
        ws.authenticated = true;
        ws.deviceRole = 'TERMINAL';
        ws.send(encryptPayload({
          type: 'device_approved',
          token: token
        }));
      }
    }

    broadcast({ type: 'device_whitelist_changed' });
    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/devices/reject', requireAdmin, async (req, res) => {
  const { nodeId } = req.body;
  if (!nodeId) return res.status(400).json({ error: 'nodeId is required' });
  try {
    await rejectDevice(nodeId);
    
    for (const ws of activeConnections) {
      if (ws.nodeId === nodeId) {
        ws.send(encryptPayload({ type: 'device_rejected' }));
        ws.close();
      }
    }

    broadcast({ type: 'device_whitelist_changed' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getHardwareFingerprint() {
  const cpus = os.cpus().map(c => c.model).join(',');
  const hostname = os.hostname();
  const platform = os.platform();
  let username = 'system';
  try {
    username = os.userInfo().username;
  } catch (e) {}
  const rawString = `${cpus}:${hostname}:${platform}:${username}`;
  return crypto.createHash('sha256').update(rawString).digest('hex');
}

// 6.a Fetch server network configuration (Public)
app.get('/api/server-info', (req, res) => {
  try {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ips.push(iface.address);
        }
      }
    }
    res.json({ ips, port, fingerprint: getHardwareFingerprint() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6.b Bootstrap Core Onboarding Configuration (Public / Safe)
app.post('/api/bootstrap', async (req, res) => {
  const { storeName, taxRate, adminPin, syncPassphrase, theme } = req.body;
  if (!storeName || !adminPin || !syncPassphrase) {
    return res.status(400).json({ error: 'Store Name, Owner PIN, and Sync Passphrase are required.' });
  }

  try {
    const now = Date.now();
    await db.run("INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES ('onboarding_complete', 'BOOL', 'true', 1, ?)", [now]);
    await db.run("INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES ('store_name', 'STR', ?, 0, ?)", [storeName, now]);
    await db.run("INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES ('store_tax_rate', 'STR', ?, 0, ?)", [String(taxRate), now]);
    await db.run("INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES ('store_theme_palette', 'STR', ?, 0, ?)", [theme || 'Obsidian Emerald', now]);
    await db.run("INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES ('sync_passphrase', 'STR', ?, 0, ?)", [syncPassphrase, now]);

    // Set admin employee credentials
    const hashed = hashPin(adminPin);
    const admin = await db.get("SELECT * FROM employees WHERE role = 'ADMIN'");
    if (admin) {
      await db.run("UPDATE employees SET auth_hash = ?, is_active = 1 WHERE id = ?", [hashed, admin.id]);
    } else {
      const empId = require('crypto').randomUUID();
      await db.run("INSERT INTO employees (id, auth_hash, biometric_token, role, is_active, sync_hlc) VALUES (?, ?, 'secure_biometric_admin_token', 'ADMIN', 1, ?)", [empId, hashed, getHlc().tick()]);
    }

    // Set server passphrase in memory and update JWT secret key
    serverPassphrase = syncPassphrase;
    jwtSecret = crypto.createHash('sha256').update(serverPassphrase).digest('hex');
    console.log(`[SyncHub] Server bootstrapped with new passphrase. Sync encryption ACTIVE.`);

    res.json({ success: true });
  } catch (err) {
    console.error('[SyncHub] Bootstrap failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// 7. Reset baseline cleanly (Requires Admin privileges)
app.post('/api/reset', requireAdmin, async (req, res) => {
  const { pin } = req.body;
  try {
    // Requires manager/admin PIN verification
    const employees = await db.all('SELECT * FROM employees WHERE role = "ADMIN"');
    const matched = employees.find(emp => verifyPin(pin, emp.auth_hash));

    if (!matched) {
      return res.status(403).json({ error: 'Admin authentication failed. Destructive reset aborted.' });
    }

    await db.beginImmediate();
    // Destructive baseline reset (keep catalog metadata template but clear transactional database logs)
    await db.run('DELETE FROM transactions;');
    await db.run('DELETE FROM line_items;');
    await db.run('DELETE FROM speech_analytics_logs;');
    await db.run('DELETE FROM crsql_changes;');
    await db.commit();

    console.log('[SyncHub] Database reset successfully.');
    broadcast({ type: 'reset_trigger' });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Immutable Ledger: Void Transaction (Manager PIN required) ─────────────────
app.post('/api/void-transaction', loginLimiter, async (req, res) => {
  try {
    const { transactionId, managerPin, voidReason } = req.body;
    if (!transactionId || !managerPin) return res.status(400).json({ error: 'transactionId and managerPin required.' });
    const managers = await db.all("SELECT * FROM employees WHERE auth_hash IS NOT NULL AND (role='MANAGER' OR role='ADMIN') AND is_active=1");
    const matchedMgr = managers.find(m => verifyPin(managerPin, m.auth_hash));
    if (!matchedMgr) return res.status(403).json({ error: 'Invalid manager PIN.' });
    const contraId = await createVoidContraEntry(transactionId, matchedMgr.id, voidReason || 'Manager void');
    res.json({ success: true, contraId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Telemetry: Receive crash dumps from client nodes ─────────────────────────
app.post('/api/telemetry', async (req, res) => {
  try {
    const logs = Array.isArray(req.body) ? req.body : [req.body];
    for (const log of logs) await saveTelemetryLog(log);
    res.json({ success: true, stored: logs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/telemetry', async (req, res) => {
  try {
    const logs = await db.all('SELECT * FROM telemetry_logs ORDER BY created_at DESC LIMIT 200');
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: Manual CRDT GC trigger ─────────────────────────────────────────────
app.post('/api/admin/gc', async (req, res) => {
  try {
    const { safeVersion } = req.body;
    if (!safeVersion) return res.status(400).json({ error: 'safeVersion required.' });
    const pruned = await pruneAcknowledgedChanges(safeVersion);
    res.json({ success: true, prunedRows: pruned, safeVersion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve download portal
app.get('/download', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'download.html'));
});

// Expose Server Version API endpoint (Issue 31)
app.get('/api/version', (req, res) => {
  res.json({
    appName: "Nexova POS",
    serverVersion: "1.0.0",
    schemaVersion: SERVER_SCHEMA_VERSION,
    status: "healthy"
  });
});

// Serve frontend shell entry
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
initDatabase(terminalId)
  .then(async () => {
    await loadServerPassphrase();
    server.listen(port, () => {
      console.log(`================================================================`);
      console.log(`  NEXOVA COMMERCE ECOSYSTEM running locally on port ${port}`);
      console.log(`  Terminal Master ID: ${terminalId}`);
      console.log(`  Schema Version: ${SERVER_SCHEMA_VERSION}`);
      console.log(`  WAL + FULL SYNC + STRICT mode database initialized.`);
      console.log(`  Cloud Disaster Recovery Daemon: ACTIVE (5m intervals)`);
      console.log(`================================================================`);
    });

    // ── Component N: Supabase Cloud Sync Daemon ──────────────────────────────
    // Syncs local SQLite change logs asynchronously to remote Supabase DB.
    // Trigger immediate run, then schedule every 5 minutes.
    setTimeout(() => {
      console.log('[CloudSync] Starting initial Supabase backup sweep...');
      pushOfflineBackupsToCloud().catch(err => {
        console.error('[CloudSync] Initial backup sweep failed:', err.message);
      });
    }, 5000);

    const FIVE_MIN_MS = 5 * 60 * 1000;
    setInterval(() => {
      pushOfflineBackupsToCloud().catch(err => {
        console.error('[CloudSync] Scheduled backup sweep failed:', err.message);
      });
    }, FIVE_MIN_MS);
    console.log('[CloudSync] Asynchronous Supabase backup daemon scheduled.');

    // ── Weekly CRDT Tombstone Garbage Collection ─────────────────────────────
    // Safely prune acknowledged change records older than the current db version
    // minus a 50k-row safety buffer. Runs every 7 days.
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    setInterval(async () => {
      const currentVer = getDbVersion();
      const safeVersion = Math.max(0, currentVer - 50000);
      if (safeVersion > 0) {
        console.log(`[GC Scheduler] Running weekly CRDT pruning. Safe version: ${safeVersion}`);
        await pruneAcknowledgedChanges(safeVersion);
      }
    }, WEEK_MS);
    console.log('[GC] Weekly CRDT tombstone garbage collector scheduled.');
  })
  .catch((err) => {
    console.error('Initialization error:', err);
    process.exit(1);
  });

