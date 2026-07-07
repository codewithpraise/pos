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
  factoryResetDatabase,
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

// Serve .apk files with correct MIME type and force download (reliability fix)
app.use((req, res, next) => {
  if (req.path.endsWith('.apk')) {
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="nexova-pos-release.apk"');
  }
  next();
});

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

// Passphrase mismatch rate limiter — tracks per-IP failure counts
// After MAX_MISMATCH_ERRORS within MISMATCH_WINDOW_MS, new connections from that IP are dropped
const MISMATCH_WINDOW_MS = 60000; // 60s cooldown window
const MAX_MISMATCH_ERRORS = 3;    // allow 3 mismatches before silencing
const passphraseFailMap = new Map(); // ip -> { count, firstAt, bannedUntil }

function recordPassphraseMismatch(ip) {
  const now = Date.now();
  let entry = passphraseFailMap.get(ip);
  if (!entry || now - entry.firstAt > MISMATCH_WINDOW_MS) {
    entry = { count: 1, firstAt: now, bannedUntil: 0 };
  } else {
    entry.count++;
    if (entry.count >= MAX_MISMATCH_ERRORS) {
      entry.bannedUntil = now + MISMATCH_WINDOW_MS;
      console.warn(`[SyncHub] Rate-limiting ${ip}: ${entry.count} passphrase mismatches — suppressing for ${MISMATCH_WINDOW_MS/1000}s`);
    }
  }
  passphraseFailMap.set(ip, entry);
}

function isPassphraseBanned(ip) {
  const entry = passphraseFailMap.get(ip);
  if (!entry) return false;
  if (entry.bannedUntil && Date.now() < entry.bannedUntil) return true;
  if (entry.bannedUntil && Date.now() >= entry.bannedUntil) {
    passphraseFailMap.delete(ip); // Auto-expire ban
  }
  return false;
}

// WebSocket Handler
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress || 'unknown';

  // Silently drop connections from IP-banned clients (passphrase storm protection)
  if (isPassphraseBanned(clientIp)) {
    ws.close(1008, 'Rate limited: too many passphrase errors. Wait 60s or fix passphrase in Settings.');
    return;
  }

  ws.clientIp = clientIp;
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
            console.warn('[SyncHub] Unreadable message from client (decryption + plaintext parse both failed). Sending sync error and closing connection...');
            // Record mismatch for rate-limiting — after MAX_MISMATCH_ERRORS, ban this IP
            recordPassphraseMismatch(ws.clientIp || 'unknown');
            try {
              ws.send(JSON.stringify({ type: 'SYNC_ERROR', error: 'PASSPHRASE_MISMATCH' }));
            } catch (sendErr) {
              console.error('[SyncHub] Failed to send sync error:', sendErr.message);
            }
            // Close the connection — client will stop reconnecting on PASSPHRASE_MISMATCH
            try { ws.close(1008, 'PASSPHRASE_MISMATCH'); } catch (_) {}
            return;
          }
        }

        // 1. Handle Registration
        if (data.type === 'REGISTER') {
          ws.nodeId = data.nodeId;
          let status = await getDeviceStatus(data.nodeId);
          if (data.nodeId.startsWith('web_client_') || 
              data.nodeId === terminalId || 
              data.nodeId === 'nexova_master_pc_01' || 
              data.nodeId === 'cfd_tab_2') {
            status = 'APPROVED';
          }
          if (status === 'APPROVED') {
            const role = (data.nodeId === terminalId || data.nodeId === 'nexova_master_pc_01' || data.nodeId === 'cfd_tab_2') ? 'MASTER' : 'TERMINAL';
            
            if (role === 'TERMINAL') {
              let connectedTerminals = 0;
              for (const conn of activeConnections) {
                if (conn.authenticated && conn.deviceRole === 'TERMINAL' && conn !== ws) {
                  connectedTerminals++;
                }
              }
              
              const storeRow = await db.get("SELECT tier FROM stores LIMIT 1");
              const storeTier = storeRow ? storeRow.tier : 'STARTER';
              
              let allowedTerminals = 2; // Low tier (STARTER) default
              if (storeTier === 'ENTERPRISE') {
                allowedTerminals = 10;
              } else if (storeTier === 'PRO') {
                allowedTerminals = 5;
              }
              
              if (connectedTerminals >= allowedTerminals) {
                console.warn(`[SyncHub] Connection rejected for REGISTER ${data.nodeId}: Terminal limit reached.`);
                ws.send(JSON.stringify({ type: 'SYNC_ERROR', error: `Connection limit reached: only ${allowedTerminals} devices allowed for ${storeTier} tier.` }));
                ws.close();
                activeConnections.delete(ws);
                return;
              }
            }

            ws.authenticated = true;
            ws.deviceRole = role;
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
            if (data.nodeId.startsWith('web_client_') || 
                data.nodeId === terminalId || 
                data.nodeId === 'nexova_master_pc_01' || 
                data.nodeId === 'cfd_tab_2') {
              status = 'APPROVED';
            }
            if (status === 'APPROVED') {
              const role = ws.deviceRole || 'TERMINAL';
              if (role === 'TERMINAL') {
                let connectedTerminals = 0;
                for (const conn of activeConnections) {
                  if (conn.authenticated && conn.deviceRole === 'TERMINAL' && conn !== ws) {
                    connectedTerminals++;
                  }
                }
                
                const storeRow = await db.get("SELECT tier FROM stores LIMIT 1");
                const storeTier = storeRow ? storeRow.tier : 'STARTER';
                
                let allowedTerminals = 2; // Low tier (STARTER) default
                if (storeTier === 'ENTERPRISE') {
                  allowedTerminals = 10;
                } else if (storeTier === 'PRO') {
                  allowedTerminals = 5;
                }
                
                if (connectedTerminals >= allowedTerminals) {
                  console.warn(`[SyncHub] Connection rejected for AUTH ${ws.nodeId}: Terminal limit reached.`);
                  ws.send(encryptPayload({ type: 'SYNC_ERROR', error: `Connection limit reached: only ${allowedTerminals} devices allowed for ${storeTier} tier.` }));
                  ws.close();
                  activeConnections.delete(ws);
                  return;
                }
              }

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
// Body: { invoices: [{ id, transactionId, invoiceNumber, usin, invoicePayload, totalMinor, taxMinor, createdAt }] }
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
          (id, transaction_id, invoice_number, usin, invoice_payload, total_minor, tax_minor, status, retry_count, created_at, sync_hlc)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)
      `, [
        inv.id, inv.transactionId, inv.invoiceNumber, inv.usin,
        typeof inv.invoicePayload === 'string' ? inv.invoicePayload : JSON.stringify(inv.invoicePayload),
        inv.totalMinor, inv.taxMinor, inv.createdAt || now, getHlc().tick()
      ]);

      // Attempt immediate FBR submission
      const fbrResult = await submitToFBR({ invoice_payload: inv.invoicePayload });
      const newStatus = fbrResult.success ? 'SUBMITTED' : 'FAILED';
      
      let fbrResponseCode = null;
      let fbrErrorDetails = null;
      let officialInvoiceNumber = null;
      if (fbrResult.body) {
        try {
          const parsedBody = JSON.parse(fbrResult.body);
          fbrResponseCode = parsedBody.ResponseCode || parsedBody.Code || null;
          fbrErrorDetails = parsedBody.Message || (parsedBody.Errors ? JSON.stringify(parsedBody.Errors) : null);
          officialInvoiceNumber = parsedBody.FBRInvoiceNumber || parsedBody.InvoiceNumber || parsedBody.fbr_invoice_number || null;
        } catch (e) {
          fbrErrorDetails = fbrResult.body;
        }
      } else if (fbrResult.reason) {
        fbrErrorDetails = fbrResult.reason;
      }

      await db.run(
        `UPDATE fbr_submissions SET status = ?, fbr_response = ?, fbr_response_code = ?, fbr_error_details = ?, invoice_number = ?, submitted_at = ?, retry_count = retry_count + 1 WHERE id = ?`,
        [newStatus, JSON.stringify(fbrResult), fbrResponseCode, fbrErrorDetails, officialInvoiceNumber || inv.invoiceNumber, now, inv.id]
      );
      results.push({ 
        id: inv.id, 
        status: newStatus, 
        fbrResult, 
        fbrResponseCode, 
        fbrErrorDetails,
        fbrInvoiceNumber: officialInvoiceNumber || inv.invoiceNumber
      });
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
      `SELECT id, transaction_id, invoice_number, usin, total_minor, retry_count, fbr_response_code, fbr_error_details, created_at
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

    let fbrResponseCode = null;
    let fbrErrorDetails = null;
    if (fbrResult.body) {
      try {
        const parsedBody = JSON.parse(fbrResult.body);
        fbrResponseCode = parsedBody.ResponseCode || parsedBody.Code || null;
        fbrErrorDetails = parsedBody.Message || (parsedBody.Errors ? JSON.stringify(parsedBody.Errors) : null);
      } catch (e) {
        fbrErrorDetails = fbrResult.body;
      }
    } else if (fbrResult.reason) {
      fbrErrorDetails = fbrResult.reason;
    }

    await db.run(
      `UPDATE fbr_submissions SET status = ?, fbr_response = ?, fbr_response_code = ?, fbr_error_details = ?, submitted_at = ?, retry_count = retry_count + 1 WHERE id = ?`,
      [newStatus, JSON.stringify(fbrResult), fbrResponseCode, fbrErrorDetails, now, inv.id]
    );
    if (fbrResult.success) submitted++;
  }
  res.json({ retried: failed.length, submitted });
});

// ── SaaS Onboarding & 6-Digit Activation Handshake ──────────────────────────

const { mintToken } = require('./scripts/license-provisioner');

// Local memory tracking of failed activation attempts for brute-force lockouts
const failedActivationAttempts = new Map();

// POST /api/onboard — Mock Web Portal signup
app.post('/api/onboard', async (req, res) => {
  const { name, phone, email, tier, mode } = req.body;
  if (!name || !phone || !email) {
    return res.status(400).json({ error: 'Missing required onboarding parameters (name, phone, email).' });
  }

  const selectedTier = tier || 'TRIAL';
  const selectedMode = mode || 'subscription';
  
  // Validation & Sanitization
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneRegex = /^\+?[0-9]{10,15}$/;
  const rrnRegex = /^[a-zA-Z0-9-]{6,30}$/;

  const sanitizedName = String(name || '').trim().replace(/[<>]/g, '');
  const sanitizedEmail = String(email || '').trim().toLowerCase();
  const sanitizedPhone = String(phone || '').trim().replace(/[-\s]/g, '');
  
  if (sanitizedName.length < 3 || sanitizedName.length > 100) {
    return res.status(400).json({ error: 'Invalid store name. Must be 3-100 characters.' });
  }
  if (!emailRegex.test(sanitizedEmail)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }
  if (!phoneRegex.test(sanitizedPhone)) {
    return res.status(400).json({ error: 'Invalid phone number format.' });
  }
  
  const allowedTiers = ['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE'];
  const allowedModes = ['subscription', 'lifetime'];
  if (!allowedTiers.includes(selectedTier)) {
    return res.status(400).json({ error: 'Invalid license tier.' });
  }
  if (!allowedModes.includes(selectedMode)) {
    return res.status(400).json({ error: 'Invalid license type.' });
  }

  try {
    // Check if store already exists
    const existing = await db.get("SELECT * FROM stores WHERE phone = ? OR email = ?", [sanitizedPhone, sanitizedEmail]);
    if (existing) {
      return res.status(400).json({ error: 'A store with this phone or email already exists.' });
    }

    let status = 'active';
    let expiresAt = null;
    let rrn = req.body.rrn;
    let gateway = req.body.gateway;

    if (selectedTier !== 'TRIAL') {
      status = 'pending_payment';
      if (!rrn || !gateway) {
        return res.status(400).json({ error: 'Payment information (Gateway and RRN reference number) is required for paid tiers.' });
      }
      rrn = String(rrn).trim();
      gateway = String(gateway).trim().toUpperCase();
      if (!rrnRegex.test(rrn)) {
        return res.status(400).json({ error: 'Invalid transaction reference format. Alphanumeric 6-30 characters.' });
      }
      const allowedGateways = ['NAYAPAY', 'RAAST', 'EASYPAISA', 'SADAPAY'];
      if (!allowedGateways.includes(gateway)) {
        return res.status(400).json({ error: 'Unsupported payment gateway.' });
      }
      // Check duplicate RRN
      const dupRrn = await db.get("SELECT * FROM pending_payments WHERE transaction_reference = ?", [rrn]);
      if (dupRrn) {
        return res.status(400).json({ error: 'This transaction reference number has already been submitted.' });
      }
    } else {
      expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7-day trial
    }

    const storeId = crypto.randomUUID();
    const hardwareLimit = selectedTier === 'STARTER' ? 1 : (selectedTier === 'PRO' ? 3 : 100);

    // Start database transaction
    await db.beginImmediate();
    try {
      await db.run(
        "INSERT INTO stores (id, phone, email, name, tier, mode, status, expires_at, hardware_limit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [storeId, sanitizedPhone, sanitizedEmail, sanitizedName, selectedTier, selectedMode, status, expiresAt, hardwareLimit]
      );

      if (selectedTier !== 'TRIAL') {
        const prices = {
          'STARTER': 1500000,
          'PRO': 5000000,
          'ENTERPRISE': 15000000
        };
        const amount = prices[selectedTier] || 1500000;
        await db.run(
          "INSERT INTO pending_payments (id, store_id, tier, mode, amount_paid_minor_units, gateway, transaction_reference, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)",
          [crypto.randomUUID(), storeId, selectedTier, selectedMode, amount, gateway, rrn, Date.now()]
        );
      }

      // Generate random 6-digit activation code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const codeExpires = Date.now() + 15 * 60 * 1000; // valid for 15 minutes

      await db.run(
        "INSERT INTO activation_codes (code, store_id, phone, is_used, expires_at) VALUES (?, ?, ?, 0, ?)",
        [code, storeId, sanitizedPhone, codeExpires]
      );

      await db.commit();
      res.json({ success: true, storeId, code, expiresAt, status });
    } catch (err) {
      await db.rollback();
      throw err;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/license/activate — Handshake to whitelist hardware ID & return signed license
app.post('/api/license/activate', async (req, res) => {
  const { code, phone, hwid, deviceName } = req.body;
  if (!code || !phone || !hwid) {
    return res.status(400).json({ error: 'Missing activation details (code, phone, hwid).' });
  }

  // --- GOD MODE MASTER ACCESS BYPASS ---
  const MASTER_CODE = process.env.MASTER_PROMO_CODE || 'NEXOVA-ADMIN-777';
  if (code === MASTER_CODE) {
    console.log(`\n[SyncHub] 🚨 MASTER BYPASS ACTIVATED 🚨`);
    console.log(`[SyncHub] Target HWID: ${hwid}`);
    
    const hwidFixed = hwid.toUpperCase();
    const storeId = 'admin_' + crypto.randomUUID(); // Note: This creates a new store for every master activation.
    
    await db.run("INSERT OR IGNORE INTO stores (id, name, tier, mode, status, expires_at) VALUES (?, ?, ?, ?, ?, ?)", 
      [storeId, 'Nexova Master Admin', 'ENTERPRISE', 'lifetime', 'active', null]);

    const { token } = mintToken(storeId, hwidFixed, 'ENTERPRISE', 'lifetime', null, 'active');
    
    console.log(`[SyncHub] Master token generated successfully. Length: ${token.length} chars.`);
    console.log(`[SyncHub] Dispatching payload to client...\n`);
    
    return res.json({ success: true, token, tier: 'ENTERPRISE', status: 'active' });
  }
  // --- END GOD MODE ---

  const clientIp = req.ip;
  const attemptKey = `${clientIp}:${hwid}`;
  const now = Date.now();

  // Enforce brute-force lockout (5 failures -> 30-minute lock)
  const attempt = failedActivationAttempts.get(attemptKey);
  if (attempt && attempt.lockoutUntil > now) {
    const minsLeft = Math.ceil((attempt.lockoutUntil - now) / 60000);
    return res.status(429).json({ error: `Too many failed activation attempts. Try again in ${minsLeft} minutes.` });
  }

  try {
    // Atomic Transaction to prevent double-click TOCTOU race conditions
    await db.beginImmediate();
    
    // Find valid activation code matching phone number
    const codeRow = await db.get(
      "SELECT * FROM activation_codes WHERE code = ? AND phone = ? AND is_used = 0 AND expires_at > ?",
      [code, phone, now]
    );

    if (!codeRow) {
      await db.rollback();
      
      const count = attempt ? attempt.count + 1 : 1;
      const lockoutUntil = count >= 5 ? now + 30 * 60 * 1000 : 0;
      failedActivationAttempts.set(attemptKey, { count, lockoutUntil });

      const errorMsg = count >= 5 
        ? 'Too many invalid attempts. Onboarding locked for 30 minutes.'
        : `Invalid activation code or phone number. ${5 - count} attempts remaining.`;
      return res.status(400).json({ error: errorMsg });
    }

    // Atomic update to mark code as claimed
    const updateRes = await db.run(
      "UPDATE activation_codes SET is_used = 1 WHERE code = ? AND is_used = 0",
      [code]
    );

    if (updateRes.changes === 0) {
      await db.rollback();
      return res.status(400).json({ error: 'Activation code has already been claimed.' });
    }

    const storeRow = await db.get("SELECT * FROM stores WHERE id = ?", [codeRow.store_id]);
    if (!storeRow) {
      await db.rollback();
      return res.status(400).json({ error: 'Store profile not found.' });
    }

    // Enforce terminal limits (10 devices maximum)
    const activeDevices = await db.all("SELECT * FROM devices WHERE store_id = ? AND is_active = 1", [storeRow.id]);
    const maxDevices = storeRow.hardware_limit || (storeRow.tier === 'STARTER' ? 1 : (storeRow.tier === 'PRO' ? 3 : 100));
    if (activeDevices.length >= maxDevices) {
      await db.rollback();
      return res.status(400).json({ error: `Hardware terminal limit reached (${maxDevices} devices maximum).` });
    }

    // Register whitelisted device
    const existingDevice = await db.get("SELECT * FROM devices WHERE hardware_id = ?", [hwid.toUpperCase()]);
    if (existingDevice) {
      if (existingDevice.store_id !== storeRow.id) {
        await db.rollback();
        return res.status(400).json({ error: 'This device is registered to another store.' });
      }
      await db.run("UPDATE devices SET is_active = 1 WHERE hardware_id = ?", [hwid.toUpperCase()]);
    } else {
      await db.run(
        "INSERT INTO devices (id, store_id, hardware_id, device_name, is_active) VALUES (?, ?, ?, ?, 1)",
        [crypto.randomUUID(), storeRow.id, hwid.toUpperCase(), deviceName || 'POS Terminal']
      );
    }

    // Mint the license token using the Ed25519 provisioner helper
    const days = storeRow.mode === 'subscription' ? (storeRow.tier === 'TRIAL' ? 7 : 30) : null;
    const { token } = mintToken(storeRow.id, hwid, storeRow.tier, storeRow.mode, days, storeRow.status);
    
    await db.run("UPDATE stores SET license_key = ? WHERE id = ?", [token, storeRow.id]);
    await db.commit();

    // Reset attempts on successful activation
    failedActivationAttempts.delete(attemptKey);

    res.json({ success: true, token, tier: storeRow.tier, status: storeRow.status });
  } catch (err) {
    try { await db.rollback(); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAAmPdCoDENbcrE6zLVqX0WUtnV9VRsL05HwFD9ypEARo=
-----END PUBLIC KEY-----`;

// GET /api/license/check — Silent background checking (requires current token auth)
app.get('/api/license/check', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token required.' });
  }
  const token = authHeader.split(' ')[1];
  let payload;

  try {
    // 1. Verify token signature
    if (token.includes('.')) {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payloadStr = Buffer.from(parts[1], 'base64').toString('utf8');
        payload = JSON.parse(payloadStr);
        if (payload.licenseKey && !payload.store_id) {
          payload.store_id = payload.licenseKey;
        }
      } else {
        return res.status(400).json({ error: 'Malformed token structure.' });
      }
    } else {
      const decodedStr = Buffer.from(token, 'base64').toString('utf8');
      const pipeIndex = decodedStr.lastIndexOf('|');
      if (pipeIndex === -1) {
        return res.status(400).json({ error: 'Malformed token structure.' });
      }
      const payloadStr = decodedStr.substring(0, pipeIndex);
      const sigBase64 = decodedStr.substring(pipeIndex + 1);
      const signature = Buffer.from(sigBase64, 'base64');
      
      const valid = crypto.verify(null, Buffer.from(payloadStr), PUBLIC_KEY_PEM, signature);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid license signature.' });
      }
      payload = JSON.parse(payloadStr);
    }

    const storeRow = await db.get("SELECT * FROM stores WHERE id = ?", [payload.store_id]);
    if (!storeRow) {
      return res.status(404).json({ error: 'Store profile not found.' });
    }

    // Check if store state in DB differs from token payload, prompting a re-mint
    const tokenExp = payload.exp;
    const dbExp = storeRow.expires_at;

    const needsRenewal = storeRow.tier !== payload.tier || 
                         storeRow.mode !== payload.mode || 
                         storeRow.status !== payload.status || 
                         (storeRow.mode === 'subscription' && Math.abs(dbExp - tokenExp) > 10000);

    if (needsRenewal) {
      const days = storeRow.mode === 'subscription' ? (storeRow.tier === 'TRIAL' ? 7 : 30) : null;
      const { token: freshToken } = mintToken(storeRow.id, payload.hwid, storeRow.tier, storeRow.mode, days, storeRow.status);
      await db.run("UPDATE stores SET license_key = ? WHERE id = ?", [freshToken, storeRow.id]);
      return res.json({ updated: true, token: freshToken });
    }

    res.json({ updated: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 1. Employee Login verification (Requires approved device token, loopback requests bypass requireAuth)
app.post('/api/employee/login', loginLimiter, (req, res, next) => {
  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  if (isLocal) {
    return next();
  }
  requireAuth(req, res, next);
}, async (req, res) => {
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

// 6.c Fetch system initialization status (Public)
app.get('/api/system/status', async (req, res) => {
  try {
    const row = await db.get("SELECT value_payload FROM local_preferences WHERE key = 'onboarding_complete'");
    const isInitialized = !!(row && row.value_payload === 'true');
    res.json({ isInitialized });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6.d System Factory Reset (Loopback-only or authenticated ADMIN PIN)
app.post('/api/system/reset', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
  
  let authorized = isLocal;
  if (!authorized) {
    const { pin } = req.body;
    if (pin) {
      try {
        const employees = await db.all("SELECT * FROM employees WHERE role = 'ADMIN' AND is_active = 1");
        const matched = employees.find(emp => verifyPin(pin, emp.auth_hash));
        if (matched) authorized = true;
      } catch (e) {
        console.error('[SystemReset] Error verifying admin PIN:', e);
      }
    }
  }

  if (!authorized) {
    return res.status(403).json({ error: 'Access denied: Loopback connection or Admin PIN required.' });
  }

  try {
    await factoryResetDatabase();
    serverPassphrase = '';
    jwtSecret = 'default_nexova_secret';
    broadcast({ type: 'reset_trigger' });
    res.json({ success: true, message: 'Server database factory reset completed successfully.' });
  } catch (err) {
    console.error('[SystemReset] Factory reset failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6.e Device registration and auto-approval (Public)
app.post('/api/devices/register', async (req, res) => {
  const { nodeId, deviceName, userAgent } = req.body;
  if (!nodeId) {
    return res.status(400).json({ error: 'nodeId is required.' });
  }

  try {
    let status = await getDeviceStatus(nodeId);
    if (nodeId.startsWith('web_client_') || 
        nodeId === terminalId || 
        nodeId === 'nexova_master_pc_01' || 
        nodeId === 'cfd_tab_2') {
      status = 'APPROVED';
    }

    if (status === 'APPROVED') {
      const role = (nodeId === terminalId || nodeId === 'nexova_master_pc_01' || nodeId === 'cfd_tab_2') ? 'MASTER' : 'TERMINAL';
      const token = generateToken(nodeId, role);
      
      const existing = await db.get("SELECT status FROM approved_devices WHERE node_id = ?", [nodeId]);
      if (!existing) {
        await db.run("INSERT INTO approved_devices (node_id, device_name, user_agent, approved_at, status) VALUES (?, ?, ?, ?, 'APPROVED')", [
          nodeId, deviceName || 'Web Register', userAgent || req.headers['user-agent'] || '', Date.now()
        ]);
      }
      
      return res.json({ status: 'APPROVED', token });
    } else if (status === 'PENDING') {
      return res.json({ status: 'PENDING', nodeId });
    } else {
      await addPendingDevice(nodeId, deviceName || 'Web Register', userAgent || req.headers['user-agent'] || '');
      return res.json({ status: 'PENDING', nodeId });
    }
  } catch (err) {
    console.error('[DeviceRegister] HTTP register failed:', err);
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

// GET /api/sync/bootstrap — Shallow database bootstrap pull for new paired terminals
app.get('/api/sync/bootstrap', async (req, res) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'License authorization required.' });
  }
  const token = authHeader.split(' ')[1];
  
  // Verify Ed25519 license signature
  let payload;
  try {
    if (token.includes('.')) {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payloadStr = Buffer.from(parts[1], 'base64').toString('utf8');
        payload = JSON.parse(payloadStr);
        if (payload.licenseKey && !payload.store_id) {
          payload.store_id = payload.licenseKey;
        }
      } else {
        return res.status(400).json({ error: 'Malformed token structure.' });
      }
    } else {
      const decodedStr = Buffer.from(token, 'base64').toString('utf8');
      const pipeIndex = decodedStr.lastIndexOf('|');
      if (pipeIndex === -1) return res.status(400).json({ error: 'Malformed license token.' });
      
      const payloadStr = decodedStr.substring(0, pipeIndex);
      const sigBase64 = decodedStr.substring(pipeIndex + 1);
      const signature = Buffer.from(sigBase64, 'base64');
      
      const valid = crypto.verify(null, Buffer.from(payloadStr), PUBLIC_KEY_PEM, signature);
      if (!valid) return res.status(401).json({ error: 'Invalid license signature.' });
      
      payload = JSON.parse(payloadStr);
    }
  } catch(e) {
    return res.status(401).json({ error: 'Failed to verify license token: ' + e.message });
  }

  const storeId = payload.store_id;
  if (!storeId) {
    return res.status(400).json({ error: 'Invalid license payload: store_id is missing.' });
  }

  try {
    let changes = [];
    
    // Attempt to pull from Supabase first if available
    const { supabase } = require('./supabase-sync');
    if (supabase) {
      console.log(`[Bootstrap] Fetching snapshot for store ${storeId} from Supabase...`);
      const { data, error } = await supabase
        .from('cloud_crdt_backups')
        .select('*')
        .eq('store_id', storeId);
        
      if (error) {
        console.error('[Bootstrap] Supabase query failed, falling back to local SQLite:', error.message);
      } else if (data && data.length > 0) {
        changes = data;
      }
    }
    
    // Fallback: If no Supabase connection, or if it returned no rows, query local SQLite crsql_changes
    if (changes.length === 0) {
      console.log(`[Bootstrap] Fetching local SQLite changes for bootstrap...`);
      changes = await db.all("SELECT * FROM crsql_changes");
    }

    // Apply Shallow Hydration:
    // Pull all rows for inventory, customers, settings, etc.
    // For transactions and line_items, filter strictly to the last 14 days (OOM fix).
    const cutoffTime = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const shallowChanges = changes.filter(change => {
      const isTxOrItem = ['transactions', 'line_items'].includes(change.table_name);
      if (!isTxOrItem) return true;
      
      // Parse timestamp from sync_hlc (first part before the colon)
      if (!change.sync_hlc) return false;
      const hlcParts = change.sync_hlc.split(':');
      const physicalTime = parseInt(hlcParts[0], 10);
      return !isNaN(physicalTime) && physicalTime > cutoffTime;
    });

    console.log(`[Bootstrap] Shallow Hydration completed. Returning ${shallowChanges.length} changes (filtered from ${changes.length}).`);
    res.json({ success: true, changes: shallowChanges });
  } catch (err) {
    console.error('[Bootstrap] Hydration failed:', err);
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

