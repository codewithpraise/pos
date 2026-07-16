// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - LOCAL NODE SERVER & SYNC HUB
// Core runtime managing SQLite, HTTP/2 REST routes, and WebSocket telemetry
// ============================================================================

const path = require('path');
const fs = require('fs');

// Initialize environment configuration
const envPath = path.join(__dirname, '.env');
require('dotenv').config({ path: envPath });

if (!process.env.SERVER_MASTER_KEY) {
  const crypto = require('crypto');
  const masterKey = crypto.randomBytes(32).toString('hex');
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }
  fs.writeFileSync(envPath, envContent + `\nSERVER_MASTER_KEY=${masterKey}\n`);
  process.env.SERVER_MASTER_KEY = masterKey;
}

const express = require('express');
const http = require('http');
const https = require('https');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const WebSocket = require('ws');
const crypto = require('crypto');
const os = require('os');
const { 
  initDatabase, 
  db, 
  verifyPin, 
  hashPin, 
  verifyEmployeePin,
  checkPinLockout,
  recordPinFailure,
  clearPinLockout,
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
const LICENSE_CONFIG = require('./public/license-config');
const logger = require('./lib/logger');

// Global console interceptor to structured logger (Task 4-A)
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

console.log = (message, ...args) => {
  if (typeof message === 'string') {
    let formattedMsg = message;
    if (args.length > 0) {
      formattedMsg += ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    }
    logger.info('System', formattedMsg);
  } else {
    originalConsoleLog(message, ...args);
  }
};

console.warn = (message, ...args) => {
  if (typeof message === 'string') {
    let formattedMsg = message;
    if (args.length > 0) {
      formattedMsg += ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    }
    logger.warn('System', formattedMsg);
  } else {
    originalConsoleWarn(message, ...args);
  }
};

console.error = (message, ...args) => {
  if (typeof message === 'string') {
    let formattedMsg = message;
    let err = null;
    if (args.length > 0) {
      if (args[0] instanceof Error) {
        err = args[0];
      }
      formattedMsg += ' ' + args.map(a => typeof a === 'object' && !(a instanceof Error) ? JSON.stringify(a) : String(a)).join(' ');
    }
    logger.error('System', formattedMsg, err);
  } else {
    originalConsoleError(message, ...args);
  }
};

const { requireBody, sanitizeHtml, validate } = require('./lib/validator');

function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const CANONICAL_PLAN_PRICES = {
  subscription: { STARTER: 349900, PRO: 699900, ENTERPRISE: 1199900 },
  lifetime:     { STARTER: 7900000, PRO: 14900000, ENTERPRISE: 24900000 }
};

async function verifyCheckoutPricing(cart, paymentMode, tier) {
  const skus = cart.map(item => item.sku);
  if (skus.length === 0) return { subtotal: 0, tax: 0, total: 0 };
  
  const placeholders = skus.map(() => '?').join(',');
  const itemRows = await db.all(`SELECT sku, base_price_minor_units, quantity_on_hand FROM inventory_catalog WHERE sku IN (${placeholders})`, skus);
  const priceMap = {};
  const stockMap = {};
  itemRows.forEach(r => { 
    priceMap[r.sku] = r.base_price_minor_units; 
    stockMap[r.sku] = r.quantity_on_hand;
  });

  const prefRows = await db.all("SELECT key, value_payload FROM local_preferences");
  const prefs = {};
  prefRows.forEach(r => { prefs[r.key] = r.value_payload; });

  let subtotal = 0n;
  for (const item of cart) {
    const basePrice = priceMap[item.sku];
    if (basePrice === undefined) {
      throw new Error(`Product not found in catalog: ${item.sku}`);
    }
    const qty = parseInt(item.qty || item.quantity || 1);
    if ((stockMap[item.sku] ?? 0) < qty) {
      throw new Error(`Insufficient stock for SKU ${item.sku}`);
    }
    subtotal += BigInt(basePrice) * BigInt(qty);
  }

  const ratePref = prefs['store_tax_rate'] || '8.0';
  let ratePercent = parseFloat(ratePref);
  const taxMode = prefs['store_tax_mode'] || 'FLAT';
  if (taxMode === 'FBR_FOOD') {
    if (paymentMode === 'CARD' || paymentMode === 'QR' || paymentMode === 'MOBILE') {
      ratePercent = 5.0;
    } else {
      ratePercent = 15.0;
    }
  } else if (taxMode === 'FBR_RETAIL') {
    ratePercent = 18.0;
  }

  const rateBps = BigInt(Math.round(ratePercent * 100));
  let tax = 0n;
  for (const item of cart) {
    const basePrice = priceMap[item.sku];
    const qty = parseInt(item.qty || item.quantity || 1);
    const itemTax = (BigInt(basePrice) * BigInt(qty) * rateBps) / 10000n;
    tax += itemTax;
  }

  const isFbrEnabled = (tier === 'ENTERPRISE' || tier === 'TRIAL') && (prefs['fbr_integration_enabled'] === 'true' || prefs['fbr_integration_enabled'] === true);
  const fbrFee = isFbrEnabled ? 100n : 0n;
  const total = subtotal + tax + fbrFee;

  return { subtotal: Number(subtotal), tax: Number(tax), total: Number(total) };
}

function verifyCheckoutToken(tokenStr, expectedSubtotal, expectedTax, expectedTotal) {
  if (!tokenStr || !tokenStr.includes(':')) return false;
  const [sig, payloadB64] = tokenStr.split(':');
  try {
    const payloadStr = Buffer.from(payloadB64, 'base64').toString('utf8');
    const payload = JSON.parse(payloadStr);
    
    if (payload.exp < Date.now()) return false;
    
    const expectedSig = crypto.createHmac('sha256', jwtSecret).update(payloadStr).digest('hex');
    if (sig !== expectedSig) return false;
    
    if (payload.subtotal !== expectedSubtotal || payload.tax !== expectedTax || payload.total !== expectedTotal) {
      return false;
    }
    
    return true;
  } catch (e) {
    return false;
  }
}

const app = express();
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

// Universal HTTP 500 Interceptor and Sanitizer to prevent information disclosure (M-17)
app.use((req, res, next) => {
  const originalStatus = res.status;
  res.status = function (statusCode) {
    if (statusCode === 500) {
      const originalJson = res.json;
      res.json = function (body) {
        if (body && body.error) {
          const isProd = process.env.NODE_ENV === 'production';
          let clientMessage = body.error;
          if (isProd) {
            const msg = String(body.error);
            if (msg.includes('SQLITE') || msg.includes('database') || msg.includes('db') || msg.includes('SELECT') || msg.includes('INSERT') || msg.includes('UPDATE')) {
              clientMessage = 'An internal database error occurred.';
            } else {
              clientMessage = 'An unexpected server error occurred.';
            }
          }
          res.status = originalStatus;
          res.json = originalJson;
          logger.error('API', `Intercepted HTTP 500: ${body.error}`, new Error(body.error));
          return originalJson.call(this, { error: clientMessage });
        }
        res.status = originalStatus;
        res.json = originalJson;
        return originalJson.call(this, body);
      };
    }
    return originalStatus.call(this, statusCode);
  };
  next();
});

function hashIp(ip) {
  if (!ip || ip === 'unknown') return 'unknown';
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return ip;
  return crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);
}

const port = process.env.PORT || 3000;

class SQLiteStore {
  constructor(windowMs) {
    this.windowMs = windowMs;
  }

  async increment(key) {
    const now = Date.now();
    const expiry = now + this.windowMs;
    await db.run(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY,
        hits INTEGER DEFAULT 0,
        reset_time INTEGER NOT NULL
      )
    `);
    
    if (Math.random() < 0.05) {
      await db.run("DELETE FROM rate_limits WHERE reset_time < ?", [now]);
    }

    await db.run(`
      INSERT INTO rate_limits (key, hits, reset_time) 
      VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET 
        hits = CASE WHEN reset_time < ? THEN 1 ELSE hits + 1 END,
        reset_time = CASE WHEN reset_time < ? THEN ? ELSE reset_time END
    `, [key, expiry, now, now, expiry]);

    const row = await db.get("SELECT hits, reset_time FROM rate_limits WHERE key = ?", [key]);
    return {
      totalHits: row ? row.hits : 1,
      resetTime: new Date(row ? row.reset_time : expiry)
    };
  }

  async decrement(key) {
    try {
      await db.run("UPDATE rate_limits SET hits = MAX(0, hits - 1) WHERE key = ?", [key]);
    } catch (e) {}
  }

  async resetKey(key) {
    try {
      await db.run("DELETE FROM rate_limits WHERE key = ?", [key]);
    } catch (e) {}
  }
}

// Rate limiter specifically for login/PIN endpoints (max 10 attempts per minute)
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Too many authentication attempts. Please try again after 60 seconds.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new SQLiteStore(60 * 1000),
  skip: () => process.env.NODE_ENV === 'test'
});

function checkOrigin(req, res, next) {
  const origin = req.headers['origin'] || req.headers['referer'] || '';
  const isLocalRequest = !origin || 
    origin.startsWith('http://localhost') ||
    origin.startsWith('http://127.0.0.1') ||
    origin.startsWith('file://') ||
    /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(origin);
  if (!isLocalRequest) {
    return res.status(403).json({ error: 'Cross-origin requests are not permitted to this endpoint.' });
  }
  next();
}

// Rate limiter for subscription and manual upgrade proof submissions (max 5 attempts per 10 minutes)
const billingLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  message: { error: 'Too many upgrade claim submissions. Please try again after 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new SQLiteStore(10 * 60 * 1000),
  skip: () => process.env.NODE_ENV === 'test'
});

// Rate limiter for initial system bootstrap onboarding (max 3 per hour)
const bootstrapLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: { error: 'Too many store initialization attempts. Please try again after an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new SQLiteStore(60 * 60 * 1000),
  skip: () => process.env.NODE_ENV === 'test'
});

// Rate limiter for release management updates (max 5 attempts per minute)
const releaseUpdateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  message: { error: 'Too many update attempts. Please try again after 60 seconds.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new SQLiteStore(60 * 1000),
  skip: () => process.env.NODE_ENV === 'test'
});

// Rate limiter for admin panel actions (max 20 per minute — prevents brute-force on admin UI)
const adminActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many admin requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new SQLiteStore(60 * 1000),
  skip: () => process.env.NODE_ENV === 'test'
});

// Rate limiter specifically for FBR PRAL tax submissions (max 60 per minute)
const fbrLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many FBR submissions. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new SQLiteStore(60 * 1000),
  skip: () => process.env.NODE_ENV === 'test'
});

// Rate limiter for logging / telemetry uploads (max 50 per 5 minutes)
const loggingLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 50,
  message: { error: 'Too many telemetry uploads. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new SQLiteStore(5 * 60 * 1000),
  skip: () => process.env.NODE_ENV === 'test'
});

// Rate limiter for QR-code device approvals (max 10 attempts per 10 minutes)
const qrApproveLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { error: 'Too many device pairing attempts. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new SQLiteStore(10 * 60 * 1000),
  skip: () => process.env.NODE_ENV === 'test'
});

// Apply security middleware
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, 'https://' + req.headers.host + req.url);
  }
  next();
});

// API Versioning URL rewrite middleware: rewrites /api/v1/... to /api/...
app.use((req, res, next) => {
  if (req.url.startsWith('/api/v1/')) {
    req.url = '/api/' + req.url.slice(8);
  }
  next();
});

app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
});

// Permissions-Policy header configured via helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // No unsafe-inline or unsafe-eval — inline scripts extracted to static files
      // Removed https://unpkg.com — jsPDF and QRCode are vendored locally in public/
      scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      // Restricted to same-origin + data URIs + blob (product images are local)
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: [
        "'self'",
        "ws:", "wss:",
        "http://localhost:*", "http://127.0.0.1:*", "http://192.168.*", "http://10.*", "http://172.*",
        "https://*.supabase.co", "https://*.pages.dev",
        "https://gw.fbr.gov.pk"
      ],
      objectSrc: ["'none'"],
      // Prevent <base> tag injection attacks
      baseUri: ["'self'"],
      // Force all insecure URLs to HTTPS
      upgradeInsecureRequests: []
    }
  },
  xFrameOptions: { action: 'deny' },
  xContentTypeOptions: true,
  referrerPolicy: { policy: 'no-referrer' },
  // Enable COOP/COEP/CORP for cross-origin isolation
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginEmbedderPolicy: { policy: 'require-corp' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  dnsPrefetchControl: { allow: false },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  permissionsPolicy: {
    features: {
      geolocation: ["'none'"],
      camera: ["'self'"],          // Barcode scanner
      microphone: ["'self'"],      // Speech coaching
      payment: ["'none'"],         // Never browser Payment API — manual proofs only
      usb: ["'none'"],
      'ambient-light-sensor': ["'none'"],
      accelerometer: ["'none'"],
      gyroscope: ["'none'"],
      magnetometer: ["'none'"],
      'picture-in-picture': ["'none'"],
      'display-capture': ["'none'"],
      'document-domain': ["'none'"],
      'fullscreen': ["'self'"]
    }
  }
}));
app.use(cors({
  origin: (origin, callback) => {
    const isProd = process.env.NODE_ENV === 'production';
    const allowed = [
      /^https?:\/\/192\.168\./,
      /^https?:\/\/10\./,
      /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
      /^https?:\/\/(.*\.)?valenixia\.com$/
    ];
    if (!isProd) {
      allowed.push(/^https?:\/\/localhost/);
      allowed.push(/^https?:\/\/127\.0\.0\.1/);
    }
    if (!origin || allowed.some(r => r.test(origin))) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true
}));

app.use(compression());

// Request Correlation ID Middleware (Task 4-B)
app.use((req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] || crypto.randomBytes(8).toString('hex');
  res.setHeader('x-correlation-id', correlationId);
  logger.correlationStorage.run(correlationId, () => {
    next();
  });
});

// Lightweight Cookie Parser and res.cookie Helper Middleware
function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    let parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
  });
  return list;
}

app.use((req, res, next) => {
  req.cookies = parseCookies(req.headers.cookie);
  
  res.cookie = (name, val, options = {}) => {
    let str = `${name}=${encodeURIComponent(val)}`;
    if (options.maxAge) str += `; Max-Age=${options.maxAge}`;
    if (options.path) str += `; Path=${options.path}`;
    if (options.domain) str += `; Domain=${options.domain}`;
    if (options.secure) str += '; Secure';
    if (options.httpOnly) str += '; HttpOnly';
    if (options.sameSite) str += `; SameSite=${options.sameSite}`;
    
    const existing = res.getHeader('Set-Cookie');
    if (existing) {
      if (Array.isArray(existing)) {
        res.setHeader('Set-Cookie', [...existing, str]);
      } else {
        res.setHeader('Set-Cookie', [existing, str]);
      }
    } else {
      res.setHeader('Set-Cookie', str);
    }
  };
  next();
});

// Double-Submit Cookie CSRF Middleware
app.use((req, res, next) => {
  // Generate token if not exists
  let csrfToken = req.cookies?._csrf;
  if (!csrfToken) {
    csrfToken = crypto.randomBytes(24).toString('hex');
  }
  
  // Set the CSRF cookie on all responses (non-httpOnly so JS can read it)
  res.cookie('_csrf', csrfToken, {
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    sameSite: 'strict',
    path: '/'
  });

  // Skip CSRF validation for safe methods
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // Skip CSRF validation for specific initial bootstrap or device registration routes
  const skipUrls = ['/api/devices/register', '/api/bootstrap'];
  if (skipUrls.some(url => req.path.startsWith(url))) {
    return next();
  }

  const headerToken = req.headers['x-csrf-token'];
  const cookieToken = req.cookies?._csrf;

  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    console.warn(`[CSRF] Blocked request from ${hashIp(req.ip)} to ${req.path}: token mismatch.`);
    return res.status(403).json({ error: 'CSRF token mismatch or missing.' });
  }

  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Prevent search engines from indexing API routes
app.use('/api', (req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  next();
});

// Ensure request_audit_logs table exists
async function initRequestAuditLogsTable() {
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS request_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        ip TEXT,
        method TEXT,
        path TEXT,
        status_code INTEGER,
        response_time_ms REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.error('[Security] Failed to create request_audit_logs table:', err.message);
  }
}
initRequestAuditLogsTable();

function requestAuditMiddleware(req, res, next) {
  const start = process.hrtime();
  const timestamp = new Date().toISOString();
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const method = req.method;
  const path = req.path;

  res.on('finish', async () => {
    const diff = process.hrtime(start);
    const timeMs = (diff[0] * 1e9 + diff[1]) / 1e6;
    const statusCode = res.statusCode;
    
    // Log API requests to the database
    if (path.startsWith('/api')) {
      try {
        await db.run(
          'INSERT INTO request_audit_logs (timestamp, ip, method, path, status_code, response_time_ms) VALUES (?, ?, ?, ?, ?, ?)',
          [timestamp, ip, method, path, statusCode, timeMs]
        );
      } catch (err) {
        console.error('[Security] Failed to write request audit log:', err.message);
      }
    }
  });
  next();
}
app.use(requestAuditMiddleware);

// Prevent caching on all sensitive authentication and licensing endpoints (M-18)
app.use((req, res, next) => {
  const sensitivePaths = [
    '/api/auth',
    '/api/employee',
    '/api/license',
    '/api/bootstrap',
    '/api/devices/approve'
  ];
  if (sensitivePaths.some(p => req.path.startsWith(p))) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Serve .apk files with correct MIME type and force download (reliability fix)
app.use((req, res, next) => {
  if (req.path.endsWith('.apk')) {
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="valenixia-pos-release.apk"');
  }
  next();
});

app.get(['/', '/index.html'], (req, res) => {
  const indexPagePath = path.join(__dirname, 'public', 'index.html');
  fs.readFile(indexPagePath, 'utf8', (err, html) => {
    if (err) {
      return res.status(500).send('Error loading page');
    }
    const nonce = res.locals.nonce || '';
    const dynamicHtml = html.replace(/nonce-placeholder/g, nonce);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.send(dynamicHtml);
  });
});

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

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
  maxPayload: 10 * 1024 * 1024 // 10MB max — large enough for full sync, limits DoS amplification
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
let syncSalt = process.env.SYNC_SALT || crypto.randomBytes(16).toString('hex');
let jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

function sendError(res, err, defaultStatus = 500) {
  let status = defaultStatus;
  let message = err.message || String(err);

  // Classify common error types
  if (err.name === 'ValidationError' || message.includes('required') || message.includes('invalid input') || message.includes('invalid JSON')) {
    status = 400;
  } else if (message.includes('unauthorized') || message.includes('license required') || message.includes('PIN is required') || message.includes('Invalid security PIN')) {
    status = 401;
  } else if (message.includes('forbidden') || message.includes('denied') || message.includes('already completed')) {
    status = 403;
  } else if (message.includes('not found')) {
    status = 404;
  }

  // Structured log of the raw error
  logger.error('API', `HTTP Error ${status}: ${message}`, err, { status });

  const isProd = process.env.NODE_ENV === 'production';
  let clientMessage = message;
  
  if (isProd && status === 500) {
    if (message.includes('SQLITE') || message.includes('database') || message.includes('db') || message.includes('SELECT') || message.includes('INSERT') || message.includes('UPDATE')) {
      clientMessage = 'An internal database error occurred.';
    } else {
      clientMessage = 'An unexpected server error occurred.';
    }
  }

  res.status(status).json({
    error: clientMessage
  });
}

function encryptPassphrase(plaintext) {
  const masterKey = Buffer.from(process.env.SERVER_MASTER_KEY, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `ENC1:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptPassphrase(encryptedString) {
  if (!encryptedString.startsWith('ENC1:')) {
    return encryptedString;
  }
  const parts = encryptedString.split(':');
  const iv = Buffer.from(parts[1], 'hex');
  const authTag = Buffer.from(parts[2], 'hex');
  const encrypted = Buffer.from(parts[3], 'hex');
  const masterKey = Buffer.from(process.env.SERVER_MASTER_KEY, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function loadServerPassphrase() {
  try {
    // Generate secure default jwtSecret if it doesn't exist
    const jwtRow = await db.get("SELECT value_payload FROM local_preferences WHERE key = 'jwt_secret'");
    if (jwtRow && jwtRow.value_payload) {
      jwtSecret = jwtRow.value_payload;
    } else {
      jwtSecret = crypto.randomBytes(32).toString('hex');
      await db.run(
        "INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES ('jwt_secret', 'STR', ?, 1, ?)",
        [jwtSecret, Date.now()]
      );
    }

    // Load store-specific sync salt
    const saltRow = await db.get("SELECT value_payload FROM local_preferences WHERE key = 'sync_salt'");
    if (saltRow && saltRow.value_payload) {
      syncSalt = saltRow.value_payload;
    } else {
      await db.run("INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES ('sync_salt', 'STR', ?, 1, ?)", [syncSalt, Date.now()]);
    }

    if (process.env.SYNC_PASSPHRASE) {
      serverPassphrase = process.env.SYNC_PASSPHRASE;
      jwtSecret = crypto.createHash('sha256').update(serverPassphrase + syncSalt).digest('hex');
      console.log(`[SyncHub] Server synchronization passphrase loaded from process.env successfully. JWT secret initialized.`);
    } else {
      const row = await db.get("SELECT value_payload FROM local_preferences WHERE key = 'sync_passphrase'");
      if (row && row.value_payload) {
        try {
          serverPassphrase = decryptPassphrase(row.value_payload);
          // If it was legacy/unencrypted, encrypt it in the DB now!
          if (!row.value_payload.startsWith('ENC1:')) {
            const encrypted = encryptPassphrase(serverPassphrase);
            await db.run("UPDATE local_preferences SET value_payload = ? WHERE key = 'sync_passphrase'", [encrypted]);
            console.log(`[SyncHub] Legacy sync passphrase encrypted at rest successfully.`);
          }
          jwtSecret = crypto.createHash('sha256').update(serverPassphrase + syncSalt).digest('hex');
          console.log(`[SyncHub] Server synchronization passphrase loaded and decrypted successfully. JWT secret initialized.`);
        } catch (decErr) {
          console.error('[SyncHub] Failed to decrypt sync passphrase:', decErr.message);
        }
      }
    }
  } catch (err) {
    console.warn('[SyncHub] Failed to load passphrase:', err.message);
  }
}

const derivedKeyCache = new Map();

function deriveKey(passphrase, salt) {
  if (!salt) {
    throw new Error('Cryptographic salt is required for key derivation.');
  }
  const cacheKey = crypto.createHash('sha256').update(`${passphrase}:${salt}`).digest('hex');
  if (derivedKeyCache.has(cacheKey)) {
    return derivedKeyCache.get(cacheKey);
  }
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
  derivedKeyCache.set(cacheKey, key);
  return key;
}

function generateToken(nodeId, role = 'TERMINAL') {
  const header = { alg: 'HS256', typ: 'JWT' };
  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const tokenExpiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const base64Payload = Buffer.from(JSON.stringify({ 
    sub: nodeId, 
    role, 
    exp: tokenExpiresAt 
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
    
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null; // expired
    return payload;
  } catch (e) {
    return null;
  }
}

async function requireAuth(req, res, next) {
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

  try {
    // Look up the first store in the database (since this is local-first/single-store DB)
    const storeRow = await db.get("SELECT * FROM stores LIMIT 1");
    if (storeRow) {
      let isEmergencyOverride = false;
      const overrideVal = await db.get("SELECT value_payload FROM local_preferences WHERE key = 'emergency_override_until'");
      if (overrideVal) {
        const until = Number(overrideVal.value_payload);
        if (!isNaN(until) && until > Date.now()) {
          isEmergencyOverride = true;
        }
      }

      if (!isEmergencyOverride) {
        if (storeRow.status === 'cancelled' || storeRow.status === 'suspended') {
          return res.status(403).json({ error: 'LICENSE_INACTIVE', reason: 'Store status is ' + storeRow.status });
        }
        if (storeRow.mode === 'subscription' && storeRow.expires_at && storeRow.expires_at < Date.now()) {
          return res.status(403).json({ error: 'LICENSE_EXPIRED', reason: 'License has expired.' });
        }
      }
      req.store = storeRow;
      // Map user to store row for integration/billing compatibility
      req.user = { id: storeRow.id, email: storeRow.email };
    }
  } catch (err) {
    return res.status(500).json({ error: 'License validation error: ' + err.message });
  }

  next();
}

async function initAdminAuditLogsTable() {
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        ip TEXT,
        method TEXT,
        path TEXT,
        user_agent TEXT,
        device_token TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.error('[AdminSecurity] Failed to create admin_audit_logs table:', err.message);
  }
}
initAdminAuditLogsTable();

async function logAdminAccess(req, res, next) {
  const timestamp = new Date().toISOString();
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  const path = req.path;
  const method = req.method;
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';
  const hashedToken = token ? crypto.createHash('sha256').update(token).digest('hex') : '';

  console.log(`[AdminAudit] ${timestamp} | ${hashIp(ip)} | ${method} ${path} | UA: ${userAgent.slice(0, 50)}...`);

  try {
    await db.run(
      'INSERT INTO admin_audit_logs (timestamp, ip, method, path, user_agent, device_token) VALUES (?, ?, ?, ?, ?, ?)',
      [timestamp, ip, method, path, userAgent, hashedToken]
    );
  } catch (e) {
    console.error('[AdminSecurity] Failed to write admin audit log:', e.message);
  }
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.device.role !== 'MASTER' && req.device.role !== 'TERMINAL' && req.device.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied: Requires Admin privileges.' });
    }
    logAdminAccess(req, res, next);
  });
}

function encryptPayload(payload) {
  const json = JSON.stringify(payload);
  if (serverPassphrase) {
    try {
      const key = deriveKey(serverPassphrase, syncSalt);
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

function safeJsonParse(str, fallback = null) {
  try {
    const obj = JSON.parse(str);
    const sanitize = (val) => {
      if (val && typeof val === 'object') {
        if (Array.isArray(val)) {
          val.forEach(sanitize);
        } else {
          if ('__proto__' in val) delete val['__proto__'];
          if ('constructor' in val) delete val['constructor'];
          if ('prototype' in val) delete val['prototype'];
          for (const key in val) {
            sanitize(val[key]);
          }
        }
      }
    };
    sanitize(obj);
    return obj;
  } catch (e) {
    return fallback;
  }
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
      
      const key = deriveKey(serverPassphrase, syncSalt);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      let decrypted = decipher.update(ciphertext, 'binary', 'utf8');
      decrypted += decipher.final('utf8');
      return safeJsonParse(decrypted);
    } catch (err) {
      console.error('[SyncHub] Decryption failed:', err.message);
      throw new Error('SyncHub payload decryption failure: invalid key or corrupt bytes.');
    }
  }
  return safeJsonParse(text);
}

// Passphrase mismatch rate limiter — tracks per-IP failure counts
// After MAX_MISMATCH_ERRORS within MISMATCH_WINDOW_MS, new connections from that IP are dropped
const MISMATCH_WINDOW_MS = 60000; // 60s cooldown window
const MAX_MISMATCH_ERRORS = 3;    // allow 3 mismatches before silencing
const passphraseFailMap = new Map(); // ip -> { count, firstAt, bannedUntil }

function recordPassphraseMismatch(ip) {
  // Skip global bans for 'unknown' source IPs (e.g., unix sockets, IPv6 w/o reverse)
  if (!ip || ip === 'unknown') return;
  const now = Date.now();
  let entry = passphraseFailMap.get(ip);
  if (!entry || now - entry.firstAt > MISMATCH_WINDOW_MS) {
    entry = { count: 1, firstAt: now, bannedUntil: 0 };
  } else {
    entry.count++;
    if (entry.count >= MAX_MISMATCH_ERRORS) {
      entry.bannedUntil = now + MISMATCH_WINDOW_MS;
      console.warn(`[SyncHub] Rate-limiting ${hashIp(ip)}: ${entry.count} passphrase mismatches — suppressing for ${MISMATCH_WINDOW_MS/1000}s`);
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
            data = safeJsonParse(trimmed);
            if (!data) throw new Error('Plain JSON parse failed');
          } else if (serverPassphrase) {
            // Looks like base64 encrypted payload — attempt decryption
            data = decryptPayload(message);
          } else {
            // No passphrase set, try plain parse anyway
            data = safeJsonParse(trimmed);
            if (!data) throw new Error('Plain JSON parse failed');
          }
        } catch (e) {
          // If all parsing fails, try raw plaintext as last resort
          try {
            const text = typeof message === 'string' ? message : message.toString('utf8');
            data = safeJsonParse(text.trim());
            if (!data) throw new Error('Fallback JSON parse failed');
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
        const ALLOWED_WS_TYPES = new Set(['REGISTER', 'AUTH', 'sync_deltas', 'request_sync', 'ephemeral_broadcast']);
        if (!data || !data.type || !ALLOWED_WS_TYPES.has(data.type)) {
          console.warn(`[SyncHub] Rejected message with unknown type: ${data ? data.type : 'null'}`);
          try {
            ws.send(encryptPayload({ type: 'SYNC_ERROR', error: 'INVALID_MESSAGE_TYPE', reason: `Unknown message type: ${data ? data.type : 'null'}` }));
            ws.close(1008, 'INVALID_MESSAGE_TYPE');
          } catch (_) {}
          activeConnections.delete(ws);
          return;
        }
        // Enforce license verification on all non-registration/non-auth WebSocket messages
        if (data.type !== 'REGISTER' && data.type !== 'AUTH') {
          const storeRow = await db.get("SELECT * FROM stores LIMIT 1");
          if (storeRow) {
            let isEmergencyOverride = false;
            const overrideVal = await db.get("SELECT value_payload FROM local_preferences WHERE key = 'emergency_override_until'");
            if (overrideVal) {
              const until = Number(overrideVal.value_payload);
              if (!isNaN(until) && until > Date.now()) {
                isEmergencyOverride = true;
              }
            }

            if (!isEmergencyOverride) {
              if (storeRow.status === 'cancelled' || storeRow.status === 'suspended') {
                try {
                  ws.send(JSON.stringify({ type: 'SYNC_ERROR', error: 'LICENSE_INACTIVE', reason: 'Store status is ' + storeRow.status }));
                  ws.close(1008, 'LICENSE_INACTIVE');
                } catch (_) {}
                activeConnections.delete(ws);
                return;
              }
              if (storeRow.mode === 'subscription' && storeRow.expires_at && storeRow.expires_at < Date.now()) {
                try {
                  ws.send(JSON.stringify({ type: 'SYNC_ERROR', error: 'LICENSE_EXPIRED', reason: 'License has expired.' }));
                  ws.close(1008, 'LICENSE_EXPIRED');
                } catch (_) {}
                activeConnections.delete(ws);
                return;
              }
            }
          }
        }

        // 1. Handle Registration
        if (data.type === 'REGISTER') {
          ws.nodeId = data.nodeId;
          let status = await getDeviceStatus(data.nodeId);
          if (data.nodeId.startsWith('web_client_') || 
              data.nodeId === terminalId || 
              data.nodeId === 'valenixia_master_pc_01' || 
              data.nodeId === 'cfd_tab_2') {
            status = 'APPROVED';
          }
          if (status === 'APPROVED') {
            const role = (data.nodeId === terminalId || data.nodeId === 'valenixia_master_pc_01' || data.nodeId === 'cfd_tab_2' || data.nodeId.startsWith('web_client_')) ? 'MASTER' : 'TERMINAL';
            
            if (role === 'TERMINAL') {
              let connectedTerminals = 0;
              for (const conn of activeConnections) {
                if (conn.authenticated && conn.deviceRole === 'TERMINAL' && conn !== ws) {
                  connectedTerminals++;
                }
              }
              
              const storeRow = await db.get("SELECT tier FROM stores LIMIT 1");
              const storeTier = storeRow ? storeRow.tier : 'STARTER';
              const allowedTerminals = LICENSE_CONFIG[storeTier]?.allowedTerminals ?? 0;
              
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
                data.nodeId === 'valenixia_master_pc_01' || 
                data.nodeId === 'cfd_tab_2') {
              status = 'APPROVED';
            }
            if (status === 'APPROVED') {
              let role = ws.deviceRole || 'TERMINAL';
              if (ws.nodeId.startsWith('web_client_') || 
                  ws.nodeId === terminalId || 
                  ws.nodeId === 'valenixia_master_pc_01' || 
                  ws.nodeId === 'cfd_tab_2') {
                role = 'MASTER';
              }
              ws.deviceRole = role;
              if (role === 'TERMINAL') {
                let connectedTerminals = 0;
                for (const conn of activeConnections) {
                  if (conn.authenticated && conn.deviceRole === 'TERMINAL' && conn !== ws) {
                    connectedTerminals++;
                  }
                }
                
                const storeRow = await db.get("SELECT tier FROM stores LIMIT 1");
                const storeTier = storeRow ? storeRow.tier : 'STARTER';
                const allowedTerminals = LICENSE_CONFIG[storeTier]?.allowedTerminals ?? 0;
                
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

          // If AMC is expired, block sync
          const storeRow = await db.get("SELECT * FROM stores LIMIT 1");
          const isAmcExpired = storeRow && storeRow.mode === 'lifetime' && 
                               storeRow.purchased_at && 
                               (Date.now() > storeRow.purchased_at + 365 * 24 * 60 * 60 * 1000) && 
                               (!storeRow.amc_paid_until || storeRow.amc_paid_until < Date.now());
          if (isAmcExpired) {
            console.warn(`[SyncHub] Client ${data.nodeId} sync blocked: AMC has expired.`);
            ws.send(encryptPayload({
              type: 'SYNC_ERROR',
              error: 'AMC_EXPIRED: Your Annual Maintenance Contract has expired. Cloud sync is disabled.'
            }));
            return;
          }

          // Validate that the client only modifies allowed tables (Task 7-B)
          const CLIENT_WRITABLE_TABLES = new Set([
            'transactions',
            'line_items',
            'stock_movements',
            'customer_credit',
            'fbr_submissions',
            'speech_analytics_logs',
            'aborted_sales_log',
            'telemetry_logs',
            'purchase_orders',
            'po_line_items',
            'distributors',
            'distributor_payments',
            'employee_shifts',
            'customers',
            'inventory_catalog',
            'employees',
            'local_preferences',
            'categories'
          ]);

          const unauthorizedChange = data.changes.find(c => !CLIENT_WRITABLE_TABLES.has(c.table_name));
          if (unauthorizedChange) {
            console.warn(`[SyncHub] Unauthorized table write attempt by node ${data.nodeId} on table "${unauthorizedChange.table_name}"`);
            ws.send(encryptPayload({
              type: 'SYNC_ERROR',
              error: `UNAUTHORIZED_TABLE_WRITE: You do not have permission to sync changes to the table "${unauthorizedChange.table_name}".`
            }));
            return;
          }

          // Price re-validation guard for incoming sync changes
          const txChanges = data.changes.filter(c => c.table_name === 'transactions');
          if (txChanges.length > 0) {
            const txMap = {};
            txChanges.forEach(c => {
              if (!txMap[c.pk]) txMap[c.pk] = {};
              txMap[c.pk][c.cid] = c.val;
            });
            
            for (const txId of Object.keys(txMap)) {
              const tx = txMap[txId];
              if (tx.status === 'PENDING' || tx.status === 'COMPLETED') {
                const total = parseInt(tx.total_minor_units || 0);
                const subtotal = parseInt(tx.subtotal_minor_units || 0);
                const tax = parseInt(tx.tax_minor_units || 0);
                
                let verified = false;
                let token = '';
                
                if (tx.payment_details && tx.payment_details.startsWith('{')) {
                  try {
                    const parsed = JSON.parse(tx.payment_details);
                    token = parsed.verified_token;
                  } catch (_) {}
                }
                
                if (token && token !== 'OFFLINE_PENDING') {
                  verified = verifyCheckoutToken(token, subtotal, tax, total);
                }
                
                if (!verified) {
                  const liChanges = data.changes.filter(c => c.table_name === 'line_items' && c.pk.startsWith(`li_${txId}_`));
                  const cart = [];
                  const liMap = {};
                  liChanges.forEach(c => {
                    const sku = c.pk.split('_')[2];
                    if (!liMap[sku]) liMap[sku] = {};
                    liMap[sku][c.cid] = c.val;
                  });
                  
                  for (const sku of Object.keys(liMap)) {
                    cart.push({ sku, qty: parseInt(liMap[sku].quantity || 1) });
                  }
                  
                  if (cart.length === 0) {
                    const dbItems = await db.all("SELECT sku, quantity FROM line_items WHERE transaction_id = ?", [txId]);
                    dbItems.forEach(i => {
                      cart.push({ sku: i.sku, qty: i.quantity });
                    });
                  }
                  
                  if (cart.length > 0) {
                    try {
                      const tier = tx.payment_details && JSON.parse(tx.payment_details).tier || 'STARTER';
                      const derived = await verifyCheckoutPricing(cart, tx.payment_mode || 'CASH', tier);
                      if (derived.total !== total || derived.subtotal !== subtotal || derived.tax !== tax) {
                        console.warn(`[SyncHub] Tamper detected on sync transaction ${txId}. Client total: ${total}, Server recomputed: ${derived.total}`);
                        ws.send(encryptPayload({
                          type: 'SYNC_ERROR',
                          error: 'PRICE_TAMPER_DETECTED',
                          transactionId: txId
                        }));
                        return; // Discard sync completely to protect ledger integrity
                      }
                      verified = true;
                    } catch (e) {
                      console.warn(`[SyncHub] Pricing verification failed for ${txId} due to error:`, e.message);
                    }
                  }
                }
              }
            }
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
    if (client.authenticated && client !== skipWs && client.readyState === WebSocket.OPEN) {
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
      body: typeof invoice.invoice_payload === 'string' ? invoice.invoice_payload : JSON.stringify(invoice.invoice_payload),
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
// POST /api/fbr/queue — requireAuth added: unauthenticated nodes must not submit FBR invoices
app.post('/api/fbr/queue', requireAuth, fbrLimiter, async (req, res) => {
  const { invoices } = req.body;
  if (!Array.isArray(invoices) || invoices.length === 0) {
    return res.status(400).json({ error: 'invoices array required' });
  }
  const now = Date.now();
  const results = [];
  for (const inv of invoices) {
    try {
      // Server-side sequence-based USIN generation (Task 6-A)
      const countRow = await db.get("SELECT COUNT(*) as count FROM fbr_submissions");
      const seq = (countRow ? countRow.count : 0) + 1;
      const serverUsin = `USIN-${String(seq).padStart(8, '0')}`;

      let payloadObj = {};
      try {
        payloadObj = typeof inv.invoicePayload === 'string' ? JSON.parse(inv.invoicePayload) : (inv.invoicePayload || {});
      } catch (_) {}
      payloadObj.usin = serverUsin;
      const finalPayloadStr = JSON.stringify(payloadObj);

      // Upsert into fbr_submissions (idempotent — safe to re-send)
      await db.run(`
        INSERT OR IGNORE INTO fbr_submissions
          (id, transaction_id, invoice_number, usin, invoice_payload, total_minor, tax_minor, status, retry_count, created_at, sync_hlc)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)
      `, [
        inv.id, inv.transactionId, inv.invoiceNumber, serverUsin, finalPayloadStr,
        inv.totalMinor, inv.taxMinor, inv.createdAt || now, getHlc().tick()
      ]);

      // Attempt immediate FBR submission
      const fbrResult = await submitToFBR({ invoice_payload: finalPayloadStr });
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
app.post('/api/fbr/retry', requireAdmin, adminActionLimiter, async (req, res) => {
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

// DB-backed activation brute-force lockout helpers (survives server restarts)
async function getActivationAttempt(attemptKey) {
  return db.get(
    'SELECT * FROM failed_activation_attempts WHERE attempt_key = ? ORDER BY last_attempt_at DESC LIMIT 1',
    [attemptKey]
  );
}
async function recordActivationFailure(attemptKey, ip, hwid) {
  const now = Date.now();
  const existing = await getActivationAttempt(attemptKey);
  if (existing) {
    const newCount = existing.attempt_count + 1;
    const lockoutUntil = newCount >= 5 ? now + 30 * 60 * 1000 : 0;
    await db.run(
      'UPDATE failed_activation_attempts SET attempt_count = ?, lockout_until = ?, last_attempt_at = ? WHERE id = ?',
      [newCount, lockoutUntil, now, existing.id]
    );
    return { count: newCount, lockoutUntil };
  } else {
    await db.run(
      'INSERT INTO failed_activation_attempts (attempt_key, ip_address, hwid, lockout_until, attempt_count, created_at, last_attempt_at) VALUES (?, ?, ?, 0, 1, ?, ?)',
      [attemptKey, ip, hwid, now, now]
    );
    return { count: 1, lockoutUntil: 0 };
  }
}
async function clearActivationAttempt(attemptKey) {
  await db.run('DELETE FROM failed_activation_attempts WHERE attempt_key = ?', [attemptKey]);
}

// POST /api/onboard — Mock Web Portal signup
app.post('/api/onboard', checkOrigin, loginLimiter, requireBody({ name: 'STORE_NAME', email: 'EMAIL', phone: 'PHONE' }), async (req, res) => {
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
    const hardwareLimit = LICENSE_CONFIG[selectedTier]?.devices || 1;

    // Start database transaction
    await db.beginImmediate();
    try {
      await db.run(
        "INSERT INTO stores (id, phone, email, name, tier, mode, status, expires_at, hardware_limit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [storeId, sanitizedPhone, sanitizedEmail, sanitizedName, selectedTier, selectedMode, status, expiresAt, hardwareLimit]
      );

      if (selectedTier !== 'TRIAL') {
        const pricesMonthly = {
          'STARTER': 349900,
          'PRO': 699900,
          'ENTERPRISE': 1199900
        };
        const pricesLifetime = {
          'STARTER': 7900000,
          'PRO': 14900000,
          'ENTERPRISE': 24900000
        };
        const prices = selectedMode === 'subscription' ? pricesMonthly : pricesLifetime;
        const amount = prices[selectedTier] || 349900;
        await db.run(
          "INSERT INTO pending_payments (id, store_id, tier, mode, amount_paid_minor_units, gateway, transaction_reference, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)",
          [crypto.randomUUID(), storeId, selectedTier, selectedMode, amount, gateway, rrn, Date.now()]
        );
      }

      // Generate cryptographically random 6-digit activation code (Math.random is NOT CSPRNG)
      const code = (100000 + crypto.randomInt(0, 900000)).toString();
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
app.post('/api/license/activate', checkOrigin, billingLimiter, requireBody({ code: 'ADMIN_PIN', phone: 'PHONE', hwid: 'LICENSE_KEY' }), async (req, res) => {
  const { code, phone, hwid, deviceName } = req.body;
  if (!code || !phone || !hwid) {
    return res.status(400).json({ error: 'Missing activation details (code, phone, hwid).' });
  }

  const TRUSTED_ACTIVATION_WHITELIST = {
    ips: ['127.0.0.1', '::1', 'localhost'],
    hwids: ['MOCK_ADMIN_HWID', 'TEST-HWID']
  };

  const clientIp = req.ip;
  const attemptKey = `${clientIp}:${hwid}`;
  const now = Date.now();

  // Enforce brute-force lockout (5 failures -> 30-minute lock, persisted in DB)
  const attempt = await getActivationAttempt(attemptKey);
  if (attempt && attempt.lockout_until > now) {
    const minsLeft = Math.ceil((attempt.lockout_until - now) / 60000);
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

      const { count, lockoutUntil } = await recordActivationFailure(attemptKey, clientIp, hwid);
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
    const maxDevices = storeRow.hardware_limit || LICENSE_CONFIG[storeRow.tier]?.devices || 1;
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
    const { token } = mintToken(storeRow.id, hwid, storeRow.tier, storeRow.mode, days, storeRow.status, storeRow.purchased_at, storeRow.amc_paid_until, storeRow.fbr_enabled, storeRow.fbr_integrator);
    
    await db.run("UPDATE stores SET license_key = ? WHERE id = ?", [token, storeRow.id]);
    await db.commit();

    // Persist commission if a sales agent code was used (agent_code on codeRow)
    if (codeRow.agent_id) {
      try {
        const agent = await db.get('SELECT * FROM sales_agents WHERE id = ? AND is_active = 1', [codeRow.agent_id]);
        if (agent) {
          const tierPrice = { TRIAL: 0, STARTER: 3499, PRO: 6999, ENTERPRISE: 11999 };
          const grossMinor = tierPrice[storeRow.tier] || 0;
          const commissionMinor = Math.floor(grossMinor * agent.commission_rate_bps / 10000);
          
          let requiresReview = 0;
          let reviewNotes = '';

          // Query database to see if IP or HWID is whitelisted and ACTIVE
          const whitelistRows = await db.all(
            "SELECT type, value FROM trusted_whitelist WHERE status = 'ACTIVE'"
          );
          const activeIps = whitelistRows.filter(r => r.type === 'IP').map(r => r.value.toLowerCase());
          const activeHwids = whitelistRows.filter(r => r.type === 'HWID').map(r => r.value.toUpperCase());

          const isWhitelistedIp = activeIps.includes(clientIp.toLowerCase()) || activeIps.includes('localhost') || activeIps.includes('127.0.0.1') || activeIps.includes('::1');
          const isWhitelistedHwid = activeHwids.includes(hwid.toUpperCase());

          if (!isWhitelistedIp && !isWhitelistedHwid) {
            // 1. IP-based activation velocity check
            const oneDayAgo = now - 24 * 60 * 60 * 1000;
            const ipActivations = await db.get(
              "SELECT COUNT(*) as count FROM commission_earnings WHERE ip_address = ? AND activated_at > ?",
              [clientIp, oneDayAgo]
            );
            if (ipActivations && ipActivations.count >= 2) {
              requiresReview = 1;
              reviewNotes += `Suspicious activation velocity: ${ipActivations.count + 1} activations from IP ${clientIp} within 24 hours. `;
            }

            // 2. HWID reuse check
            const hwidActivations = await db.get(
              "SELECT COUNT(DISTINCT store_id) as count FROM commission_earnings WHERE device_id = ? AND store_id != ?",
              [hwid.toUpperCase(), storeRow.id]
            );
            if (hwidActivations && hwidActivations.count >= 1) {
              requiresReview = 1;
              reviewNotes += `Device hardware ID reuse: HWID ${hwid.toUpperCase()} has activated ${hwidActivations.count} other store(s). `;
            }
          }

          const userAgent = req.headers['user-agent'] || 'unknown';

          await db.run(
            `INSERT INTO commission_earnings (
              id, agent_id, activation_code, store_id, tier, gross_amount_minor, 
              commission_minor_units, status, ip_address, device_id, user_agent, 
              requires_review, review_notes, activated_at, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?)`,
            [
              crypto.randomUUID(), agent.id, code, storeRow.id, storeRow.tier, grossMinor, 
              commissionMinor, clientIp, hwid.toUpperCase(), userAgent, 
              requiresReview, reviewNotes, now, now
            ]
          );
          console.log(`[Commission] Saved. status=PENDING, requires_review=${requiresReview}`);
        }
      } catch (commErr) {
        console.warn('[Commission] Failed to record commission:', commErr.message);
      }
    }

    // Reset attempts on successful activation
    await clearActivationAttempt(attemptKey);

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
    // 1. Verify token signature — enforce signed pipe-delimited format only
    const decodedStr = Buffer.from(token, 'base64').toString('utf8');
    const pipeIndex = decodedStr.lastIndexOf('|');
    if (pipeIndex === -1) {
      return res.status(400).json({ error: 'Malformed token structure. Must be signed license token.' });
    }
    const payloadStr = decodedStr.substring(0, pipeIndex);
    const sigBase64 = decodedStr.substring(pipeIndex + 1);
    const signature = Buffer.from(sigBase64, 'base64');
    
    const valid = crypto.verify(null, Buffer.from(payloadStr), PUBLIC_KEY_PEM, signature);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid license signature.' });
    }
    payload = safeJsonParse(payloadStr);
    if (!payload) {
      return res.status(400).json({ error: 'Failed to parse license payload.' });
    }

    if (payload.exp && Date.now() > payload.exp) {
      return res.status(401).json({ error: 'License token has expired.' });
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
                         storeRow.purchased_at !== (payload.purchased_at || null) ||
                         storeRow.amc_paid_until !== (payload.amc_paid_until || null) ||
                         storeRow.fbr_enabled !== (payload.fbr_enabled || 0) ||
                         storeRow.fbr_integrator !== (payload.fbr_integrator || null) ||
                         (storeRow.mode === 'subscription' && Math.abs(dbExp - tokenExp) > 10000);

    if (needsRenewal) {
      const days = storeRow.mode === 'subscription' ? (storeRow.tier === 'TRIAL' ? 7 : 30) : null;
      const { token: freshToken } = mintToken(
        storeRow.id,
        payload.hwid,
        storeRow.tier,
        storeRow.mode,
        days,
        storeRow.status,
        storeRow.purchased_at,
        storeRow.amc_paid_until,
        storeRow.fbr_enabled,
        storeRow.fbr_integrator
      );
      await db.run("UPDATE stores SET license_key = ? WHERE id = ?", [freshToken, storeRow.id]);
      return res.json({ updated: true, token: freshToken });
    }

    res.json({ updated: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 1. Employee Login verification (Requires approved device token)
app.post('/api/employee/login', loginLimiter, requireAuth, async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN is required' });

  const lockoutKey = `emp_login:${req.ip}`;
  try {
    const lockout = await checkPinLockout(lockoutKey);
    if (lockout.locked) {
      return res.status(429).json({ error: `Too many failed attempts. Locked out for ${lockout.minsLeft} more minutes.` });
    }

    const employees = await db.all('SELECT * FROM employees WHERE is_active = 1');
    const matched = await verifyEmployeePin(pin, employees);

    if (matched) {
      await clearPinLockout(lockoutKey);
      
      // Regenerate session if session middleware is ever configured (Session Fixation defense-in-depth)
      if (req.session && typeof req.session.regenerate === 'function') {
        req.session.regenerate((err) => {
          if (err) logger.error('Auth', 'Session regeneration failed', err);
        });
      }

      res.json({ 
        success: true, 
        employee: { id: matched.id, role: matched.role } 
      });
    } else {
      await recordPinFailure(lockoutKey, 5, 15);
      res.status(401).json({ error: 'Invalid security PIN code' });
    }
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/checkout/verify — Server-side checkout verification and token signing
app.post('/api/checkout/verify', loginLimiter, requireAuth, async (req, res) => {
  const { cart, paymentMode } = req.body;
  if (!cart || !Array.isArray(cart)) {
    return res.status(400).json({ error: 'Cart must be a valid list of items.' });
  }
  try {
    const storeRow = await db.get("SELECT tier FROM stores LIMIT 1");
    const activeTier = storeRow ? storeRow.tier : 'STARTER';

    // Enforce tier transaction limits server-side
    if (activeTier === 'STARTER' || activeTier === 'FREE' || activeTier === 'TRIAL') {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const startTimestamp = startOfMonth.getTime();
      const txCountRow = await db.get(
        "SELECT COUNT(*) as count FROM transactions WHERE created_at >= ? AND is_deleted = 0 AND status = 'COMPLETED'",
        [startTimestamp]
      );
      const invoiceCount = txCountRow ? txCountRow.count : 0;
      const limit = activeTier === 'FREE' ? 100 : (activeTier === 'TRIAL' ? 500 : 200); // FREE: 100, STARTER: 200, TRIAL: 500
      if (invoiceCount >= limit) {
        return res.status(403).json({ error: `Monthly transaction limit reached (${limit} transactions) for your tier.` });
      }
    }

    const verified = await verifyCheckoutPricing(cart, paymentMode || 'CASH', activeTier);
    const nonce = crypto.randomBytes(16).toString('hex');
    const payload = {
      subtotal: verified.subtotal,
      tax: verified.tax,
      total: verified.total,
      nonce: nonce,
      exp: Date.now() + 5 * 60 * 1000 // 5 minutes validity
    };
    const payloadStr = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', jwtSecret).update(payloadStr).digest('hex');
    const token = `${sig}:${Buffer.from(payloadStr).toString('base64')}`;

    res.json({
      success: true,
      subtotal: verified.subtotal,
      tax: verified.tax,
      total: verified.total,
      checkout_token: token
    });
  } catch (err) {
    sendError(res, err);
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

app.get('/api/auth/verify', requireAuth, async (req, res) => {
  try {
    const storeRow = await db.get("SELECT * FROM stores LIMIT 1");
    if (!storeRow) {
      return res.status(200).json({ status: 'UNCONFIGURED' });
    }

    let isEmergencyOverride = false;
    let emergencyOverrideUntil = null;
    const overrideVal = await db.get("SELECT value_payload FROM local_preferences WHERE key = 'emergency_override_until'");
    if (overrideVal) {
      const until = Number(overrideVal.value_payload);
      if (!isNaN(until) && until > Date.now()) {
        isEmergencyOverride = true;
        emergencyOverrideUntil = until;
      }
    }

    const trialStartPref = await db.get("SELECT value_payload FROM local_preferences WHERE key = 'valenixia_trial_start'");
    const trialStart = trialStartPref ? Number(trialStartPref.value_payload) : 0;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startTimestamp = startOfMonth.getTime();
    const txCountRow = await db.get(
      "SELECT COUNT(*) as count FROM transactions WHERE created_at >= ? AND is_deleted = 0 AND status = 'COMPLETED'",
      [startTimestamp]
    );
    const invoiceCount = txCountRow ? txCountRow.count : 0;

    res.json({
      success: true,
      storeId: storeRow.id,
      tier: storeRow.tier,
      mode: storeRow.mode,
      status: storeRow.status,
      expiresAt: storeRow.expires_at,
      serverTime: Date.now(),
      isEmergencyOverride,
      emergencyOverrideUntil,
      trialStart,
      invoiceCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MANUAL NAYAPAY BILLING HYBRID PIPELINE ───────────────────────────────────

// POST /api/payments/upload-proof — local-first base64 screenshot helper
app.post('/api/payments/upload-proof', requireAuth, billingLimiter, async (req, res) => {
  const { base64Data, filename } = req.body;
  if (!base64Data) {
    return res.status(400).json({ error: 'No image data provided.' });
  }
  try {
    const cleanFilename = String(filename || 'proof_' + Date.now() + '.png').replace(/[^a-zA-Z0-9_.-]/g, '');
    const dir = path.resolve(__dirname, 'public', 'proofs');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.resolve(dir, cleanFilename);
    if (!filePath.startsWith(dir)) {
      return res.status(400).json({ error: 'Directory traversal attempt detected.' });
    }
    const dataBuffer = Buffer.from(base64Data.replace(/^data:image\/\w+;base64,/, ""), 'base64');
    
    // Validate file magic bytes (signatures)
    const isPng = dataBuffer[0] === 0x89 && dataBuffer[1] === 0x50 && dataBuffer[2] === 0x4E && dataBuffer[3] === 0x47;
    const isJpeg = dataBuffer[0] === 0xFF && dataBuffer[1] === 0xD8 && dataBuffer[2] === 0xFF;
    if (!isPng && !isJpeg) {
      return res.status(400).json({ error: 'Only PNG and JPEG images are allowed.' });
    }

    fs.writeFileSync(filePath, dataBuffer);
    
    const localUrl = `/proofs/${cleanFilename}`;
    res.json({ success: true, url: localUrl });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

app.post('/api/payments/submit-proof', billingLimiter, requireAuth, async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  if (idempotencyKey) {
    if (!/^[a-zA-Z0-9-]{10,100}$/.test(idempotencyKey)) {
      return res.status(400).json({ error: 'Invalid Idempotency-Key format. Alphanumeric with dashes, 10-100 chars.' });
    }
    try {
      const existingKey = await db.get("SELECT * FROM idempotency_keys WHERE key = ?", [idempotencyKey]);
      if (existingKey) {
        return res.status(existingKey.response_code).json(JSON.parse(existingKey.response_body));
      }
    } catch (e) {
      console.warn('[Idempotency] Failed to query idempotency key:', e.message);
    }
  }

  const sendResponse = (status, body) => {
    if (idempotencyKey) {
      db.run(
        "INSERT OR REPLACE INTO idempotency_keys (key, response_code, response_body, created_at) VALUES (?, ?, ?, ?)",
        [idempotencyKey, status, JSON.stringify(body), Date.now()]
      ).catch(err => console.error('[Idempotency] Failed to save key:', err.message));
    }
    return res.status(status).json(body);
  };

  const { plan_id, rrn_reference, amount, proof_image_url, mode } = req.body;
  
  if (!plan_id || !rrn_reference || !amount) {
    return sendResponse(400, { error: 'Missing required parameters: plan_id, rrn_reference, amount.' });
  }

  const rrnRegex = /^[a-zA-Z0-9-]{6,30}$/;
  if (!rrnRegex.test(rrn_reference)) {
    return sendResponse(400, { error: 'Invalid transaction reference format. Alphanumeric 6-30 characters.' });
  }

  const selectedMode = mode || 'subscription';
  const canonicalPriceMinor = CANONICAL_PLAN_PRICES[selectedMode]?.[plan_id];
  if (!canonicalPriceMinor) {
    return sendResponse(400, { error: 'Invalid plan_id or mode.' });
  }

  const submittedMinor = Math.round(parseFloat(amount) * 100);
  if (submittedMinor !== canonicalPriceMinor) {
    return sendResponse(400, { error: 'Submitted amount does not match plan price.' });
  }

  const verifiedAmount = canonicalPriceMinor / 100;

  try {
    // 1. Idempotency check: Ensure the RRN reference hasn't been submitted previously
    const existing = await db.get("SELECT * FROM payment_proofs WHERE rrn_reference = ?", [rrn_reference]);
    if (existing) {
      return sendResponse(409, { error: 'This Transaction Reference has already been submitted.' });
    }

    const proofId = crypto.randomUUID();
    const now = Date.now();

    // 2. Insert locally
    await db.run(
      `INSERT INTO payment_proofs (id, user_id, plan_id, mode, rrn_reference, amount, proof_image_url, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [proofId, req.user.id, plan_id, selectedMode, rrn_reference, verifiedAmount, proof_image_url || '', now, now]
    );

    // 3. Try syncing to Supabase if client is configured
    const { supabase } = require('./supabase-sync');
    if (supabase) {
      try {
        await supabase.from('payment_proofs').insert({
          id: proofId,
          user_id: req.user.id,
          plan_id: plan_id,
          rrn_reference: rrn_reference,
          amount: verifiedAmount,
          proof_image_url: proof_image_url || '',
          status: 'pending'
        });
      } catch (sbErr) {
        console.warn('[Supabase] Failed to sync payment proof to cloud (will retry on next sync pass):', sbErr.message);
      }
    }

    return sendResponse(201, { success: true, message: 'Proof submitted successfully', proof_id: proofId });
  } catch (err) {
    return sendResponse(500, { error: err.message });
  }
});

// GET /api/payments/my-proofs — Fetch historical proofs for current store
app.get('/api/payments/my-proofs', requireAuth, async (req, res) => {
  try {
    // requireAuth only sets req.user when a store row exists.
    // On a fresh/unbootstrapped instance, return an empty list gracefully.
    if (!req.user) {
      return res.json([]);
    }
    // Ensure table exists even if schema migration hasn't run yet on this instance
    await db.run(`
      CREATE TABLE IF NOT EXISTS payment_proofs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'subscription',
        rrn_reference TEXT UNIQUE NOT NULL,
        amount REAL NOT NULL,
        proof_image_url TEXT,
        status TEXT DEFAULT 'pending',
        rejection_reason TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )
    `);
    const proofs = await db.all("SELECT * FROM payment_proofs WHERE user_id = ? ORDER BY created_at DESC", [req.user.id]);
    res.json(proofs);
  } catch (err) {
    console.error('[API] /api/payments/my-proofs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/payments/decision
// Admin workflow to approve/reject manual submissions and mint Ed25519 tokens
app.post('/api/admin/payments/decision', requireAdmin, adminActionLimiter, requireBody({ proof_id: 'TX_ID', action: 'STORE_NAME' }), async (req, res) => {
  const { proof_id, action, rejection_reason } = req.body; // action: 'approved' or 'rejected'

  if (!proof_id || !action) {
    return res.status(400).json({ error: 'Missing required parameters: proof_id, action.' });
  }

  try {
    const proof = await db.get("SELECT * FROM payment_proofs WHERE id = ?", [proof_id]);
    if (!proof) {
      return res.status(404).json({ error: 'Payment proof not found.' });
    }

    const now = Date.now();

    if (action === 'rejected') {
      await db.run(
        "UPDATE payment_proofs SET status = 'rejected', rejection_reason = ?, updated_at = ? WHERE id = ?",
        [rejection_reason || 'Rejected by administrator.', now, proof_id]
      );

      // Sync rejection to Supabase
      const { supabase } = require('./supabase-sync');
      if (supabase) {
        try {
          await supabase.from('payment_proofs').update({
            status: 'rejected',
            rejection_reason: rejection_reason || 'Rejected by administrator.'
          }).eq('id', proof_id);
        } catch (_) {}
      }

      return res.status(200).json({ success: true, message: 'Payment rejected successfully' });
    }

    if (action === 'approved') {
      // 1. Update payment status in local db
      await db.run(
        "UPDATE payment_proofs SET status = 'approved', updated_at = ? WHERE id = ?",
        [now, proof_id]
      );

      // 2. Fetch store details and paired devices
      const storeRow = await db.get("SELECT * FROM stores WHERE id = ?", [proof.user_id]);
      if (!storeRow) {
        return res.status(404).json({ error: 'Associated store profile not found.' });
      }

      const devices = await db.all("SELECT * FROM devices WHERE store_id = ? AND is_active = 1", [proof.user_id]);
      const hwid = devices.length > 0 ? devices[0].hardware_id : 'MOCK_ADMIN_HWID';

      // 3. Mint Ed25519 license key
      const finalMode = proof.mode || 'subscription';
      const days = finalMode === 'subscription' ? 30 : null;
      const expiresAt = days ? now + days * 24 * 60 * 60 * 1000 : null;
      const purchasedAt = finalMode === 'lifetime' ? now : null;
      const amcPaidUntil = finalMode === 'lifetime' ? now + 365 * 24 * 60 * 60 * 1000 : null;

      const { token } = mintToken(
        proof.user_id,
        hwid,
        proof.plan_id,
        finalMode,
        days,
        'active',
        purchasedAt,
        amcPaidUntil
      );

      // 4. Update stores locally
      await db.run(
        "UPDATE stores SET status = 'active', tier = ?, mode = ?, expires_at = ?, license_key = ?, purchased_at = ?, amc_paid_until = ? WHERE id = ?",
        [proof.plan_id, finalMode, expiresAt, token, purchasedAt, amcPaidUntil, proof.user_id]
      );

      // 5. Update Supabase if active
      const { supabase } = require('./supabase-sync');
      if (supabase) {
        try {
          await supabase.from('payment_proofs').update({ status: 'approved' }).eq('id', proof_id);
          
          await supabase.from('stores').update({
            tier: proof.plan_id,
            status: 'active',
            expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
            license_key: token
          }).eq('id', proof.user_id);
        } catch (_) {}
      }

      return res.status(200).json({ success: true, message: 'Payment approved and license minted securely.', license_key: token });
    }

    res.status(400).json({ error: 'Invalid decision action.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/emergency-override — Triggers local emergency override bypass using Manager/Admin PIN
app.post('/api/auth/emergency-override', checkOrigin, requireAdmin, loginLimiter, requireBody({ pin: 'ADMIN_PIN' }), async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN is required.' });

  const lockoutKey = `emergency:${req.ip}`;
  try {
    const lockout = await checkPinLockout(lockoutKey);
    if (lockout.locked) {
      return res.status(429).json({ error: `Too many failed attempts. Locked out for ${lockout.minsLeft} more minutes.` });
    }

    const employees = await db.all("SELECT id, role, auth_hash AS pin_hash FROM employees WHERE is_active = 1");
    let matchedEmp = null;

    for (const emp of employees) {
      if (emp.role === 'MANAGER' || emp.role === 'ADMIN') {
        if (await verifyPin(pin, emp.pin_hash)) {
          matchedEmp = emp;
          break;
        }
      }
    }

    if (!matchedEmp) {
      await recordPinFailure(lockoutKey, 3, 30);
      const auditId = 'audit_' + crypto.randomUUID().substring(0, 8);
      await db.run(
        "INSERT INTO admin_audit_log (id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)",
        [auditId, req.device?.nodeId || 'UNKNOWN', 'emergency_override_failed', `Failed emergency override attempt from IP: ${hashIp(req.ip)}`, Date.now()]
      );
      return res.status(401).json({ error: 'Invalid Manager or Administrator PIN.' });
    }

    await clearPinLockout(lockoutKey);
    
    const auditId = 'audit_' + crypto.randomUUID().substring(0, 8);
    await db.run(
      "INSERT INTO admin_audit_log (id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)",
      [auditId, matchedEmp.id, 'emergency_override', `Emergency override triggered by ${matchedEmp.role} (IP: ${hashIp(req.ip)})`, Date.now()]
    );

    const until = Date.now() + 15 * 60 * 1000; // 15 minutes limit
    await db.run(
      `INSERT OR REPLACE INTO local_preferences (key, value_payload, val_type, updated_at) VALUES ('emergency_override_until', ?, 'number', ?)`,
      [String(until), Date.now()]
    );

    res.json({
      success: true,
      emergency_override_until: until,
      override_duration_minutes: 15,
      serverTime: Date.now()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/revoke-override — Revoke active emergency override (requires Admin role)
app.post('/api/auth/revoke-override', requireAdmin, adminActionLimiter, async (req, res) => {
  try {
    await db.run("DELETE FROM local_preferences WHERE key = 'emergency_override_until'");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function isValidIP(ip) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip === '::1' || ip.toLowerCase() === 'localhost';
}

function isValidHWID(hwid) {
  return hwid && hwid.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(hwid);
}

// GET /api/admin/whitelist — List active whitelist entries
app.get('/api/admin/whitelist', requireAdmin, async (req, res) => {
  try {
    const rows = await db.all("SELECT * FROM trusted_whitelist WHERE status = 'ACTIVE' ORDER BY created_at DESC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/whitelist — Add IP or HWID to whitelist
app.post('/api/admin/whitelist', requireAdmin, adminActionLimiter, requireBody({ type: 'STORE_NAME', value: 'LICENSE_KEY' }), async (req, res) => {
  const { type, value } = req.body;
  if (!type || !value) return res.status(400).json({ error: 'type and value are required.' });
  if (type !== 'IP' && type !== 'HWID') return res.status(400).json({ error: 'Invalid whitelist type. Must be IP or HWID.' });

  if (type === 'IP' && !isValidIP(value)) {
    return res.status(400).json({ error: 'Invalid IP address format.' });
  }
  if (type === 'HWID' && !isValidHWID(value)) {
    return res.status(400).json({ error: 'Invalid HWID structure (letters, numbers, underscores, hyphens only; max 64 chars).' });
  }

  const adminName = req.device.deviceName || 'Admin';
  try {
    await db.run(
      `INSERT INTO trusted_whitelist (id, type, value, status, created_by, created_at)
       VALUES (?, ?, ?, 'ACTIVE', ?, ?)
       ON CONFLICT(value) DO UPDATE SET status = 'ACTIVE', created_by = ?, created_at = ?, deleted_by = NULL, deleted_at = NULL`,
      [crypto.randomUUID(), type, value, adminName, Date.now(), adminName, Date.now()]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/whitelist/:id — Soft-delete entry setting status = 'DELETED'
app.delete('/api/admin/whitelist/:id', requireAdmin, async (req, res) => {
  const adminName = req.device.deviceName || 'Admin';
  try {
    const result = await db.run(
      `UPDATE trusted_whitelist 
       SET status = 'DELETED', deleted_by = ?, deleted_at = ? 
       WHERE id = ? AND status = 'ACTIVE'`,
      [adminName, Date.now(), req.params.id]
    );
    if (result.changes === 0) return res.status(404).json({ error: 'Entry not found or already deleted.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Post Speech Analytics logs (Requires approved device token)
app.post('/api/speech-logs', requireAuth, loggingLimiter, requireBody({ id: 'TX_ID' }), async (req, res) => {
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

// GET /api/devices/approve-qr — serves a secure confirmation page.
// The page reads the admin Bearer token from IndexedDB via JS and POSTs to /api/devices/approve.
// It also provides a secure fallback to prompt for the Admin PIN if not authenticated.
app.get('/api/devices/approve-qr', qrApproveLimiter, (req, res) => {
  const { nodeId } = req.query;
  if (!nodeId) return res.status(400).send('<h2>Missing nodeId parameter</h2>');
  const safeNodeId = nodeId.replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!safeNodeId) return res.status(400).send('<h2>Invalid nodeId</h2>');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Approve Device — Valenixia POS</title>
  <style>
    body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
         min-height:100vh;margin:0;background:#0a0a0f;color:#f8fafc}
    .card{text-align:center;padding:40px 32px;border:1px solid rgba(16,185,129,.3);
          border-radius:12px;background:rgba(16,185,129,.05);max-width:440px;width:100%}
    h2{color:#10b981;margin:0 0 8px;font-size:22px}
    p{color:#94a3b8;margin:8px 0;font-size:14px;line-height:1.6}
    code{background:rgba(255,255,255,.06);padding:2px 6px;border-radius:4px;font-size:13px}
    input{background:rgba(255,255,255,.06);border:1px solid rgba(16,185,129,.3);color:#f8fafc;
          padding:12px;width:calc(100% - 24px);text-align:center;font-size:24px;border-radius:6px;
          letter-spacing:8px;margin-top:12px;outline:none}
    button{margin-top:24px;width:100%;padding:14px;background:#10b981;color:#060608;
           font-weight:800;font-size:13px;border:none;border-radius:6px;cursor:pointer;
           letter-spacing:.05em;text-transform:uppercase;transition:opacity .15s}
    button:hover{opacity:.85}
    #status{margin-top:16px;font-size:13px;min-height:20px}
  </style>
</head>
<body>
  <div class="card">
    <h2>Approve Pairing Request</h2>
    <p>Device <code>${safeNodeId}</code> is requesting to sync with this Valenixia POS register.</p>
    <p>Enter the Administrator PIN to approve:</p>
    <input type="password" id="pin-input" placeholder="••••" maxlength="4" />
    <button id="btn-approve">Approve Device</button>
    <div id="status"></div>
  </div>
  <script>
    document.getElementById('btn-approve').addEventListener('click', async () => {
      const btn = document.getElementById('btn-approve');
      const status = document.getElementById('status');
      const pinVal = document.getElementById('pin-input').value;
      if (!pinVal) {
        status.style.color = '#ef4444';
        status.textContent = 'Please enter the Admin PIN.';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Approving...';
      try {
        // Read admin token from opener window's IndexedDB (same origin)
        let token = null;
        try {
          const db = await new Promise((res, rej) => {
            const req = indexedDB.open('ValenixiaDB', 1);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
          });
          const tx = db.transaction('local_preferences', 'readonly');
          const store = tx.objectStore('local_preferences');
          const row = await new Promise((res) => {
            const req = store.get('device_token');
            req.onsuccess = () => res(req.result);
            req.onerror = () => res(null);
          });
          if (row && row.value) token = row.value;
        } catch (_) {}
        const resp = await fetch('/api/devices/approve', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': 'Bearer ' + token } : {})
          },
          body: JSON.stringify({ nodeId: '${safeNodeId}', adminPin: pinVal })
        });
        const data = await resp.json();
        if (data.success) {
          btn.textContent = '✓ Approved';
          btn.style.background = '#10b981';
          status.style.color = '#10b981';
          status.textContent = 'Device approved. It will connect automatically.';
        } else {
          throw new Error(data.error || 'Approval failed');
        }
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Retry';
        status.style.color = '#ef4444';
        status.textContent = 'Error: ' + e.message;
      }
    });
  </script>
</body>
</html>`);
});

app.post('/api/devices/approve', adminActionLimiter, requireBody({ nodeId: 'NODE_ID' }), async (req, res) => {
  const { nodeId, adminPin } = req.body;
  if (!nodeId) return res.status(400).json({ error: 'nodeId is required' });
  
  let authorized = false;
  
  // Method 1: Bearer Token Auth (standard)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token);
    if (payload && (payload.role === 'MASTER' || payload.role === 'TERMINAL' || payload.role === 'ADMIN')) {
      authorized = true;
    }
  }
  
  // Method 2: Admin PIN Auth (fallback for phone scanners)
  if (!authorized && adminPin) {
    const employees = await db.all("SELECT * FROM employees WHERE role = 'ADMIN' AND is_active = 1");
    const matched = await verifyEmployeePin(adminPin, employees);
    if (matched) {
      authorized = true;
    }
  }
  
  if (!authorized) {
    return res.status(401).json({ error: 'Unauthorized. Valid Admin token or PIN required.' });
  }

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

app.post('/api/devices/reject', requireAdmin, adminActionLimiter, requireBody({ nodeId: 'NODE_ID' }), async (req, res) => {
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

// ── Commission Tracking Admin API ────────────────────────────────────────────

// GET /api/admin/sales-agents — List all sales agents with their stats
app.get('/api/admin/sales-agents', requireAdmin, async (req, res) => {
  try {
    const agents = await db.all(`
      SELECT sa.*, e.auth_hash, 
             COUNT(ce.id) as total_activations,
             SUM(CASE WHEN ce.status = 'PENDING' THEN ce.commission_minor_units ELSE 0 END) as pending_minor,
             SUM(CASE WHEN ce.status = 'PAID'    THEN ce.commission_minor_units ELSE 0 END) as paid_minor
      FROM sales_agents sa
      LEFT JOIN employees e ON e.id = sa.employee_id
      LEFT JOIN commission_earnings ce ON ce.agent_id = sa.id
      GROUP BY sa.id
      ORDER BY sa.created_at DESC
    `);
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/sales-agents — Create or update a sales agent
app.post('/api/admin/sales-agents', requireAdmin, adminActionLimiter, requireBody({ employee_id: 'TX_ID' }), async (req, res) => {
  const { employee_id, commission_rate_bps } = req.body;
  if (!employee_id) return res.status(400).json({ error: 'employee_id is required' });
  const bps = parseInt(commission_rate_bps) || 300;
  if (bps < 0 || bps > 5000) return res.status(400).json({ error: 'commission_rate_bps must be 0–5000 (0%–50%)' });
  try {
    const id = crypto.randomUUID();
    await db.run(
      `INSERT INTO sales_agents (id, employee_id, commission_rate_bps, is_active, created_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(employee_id) DO UPDATE SET commission_rate_bps = excluded.commission_rate_bps, is_active = 1`,
      [id, employee_id, bps, Date.now()]
    );
    const agent = await db.get('SELECT * FROM sales_agents WHERE employee_id = ?', [employee_id]);
    res.json({ success: true, agent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/commissions — List commission earnings with filters
app.get('/api/admin/commissions', requireAdmin, async (req, res) => {
  try {
    const { agent_id, status, from, to } = req.query;
    const conditions = [];
    const params = [];
    if (agent_id) { conditions.push('ce.agent_id = ?'); params.push(agent_id); }
    if (status)   { conditions.push('ce.status = ?');   params.push(status); }
    if (from)     { conditions.push('ce.activated_at >= ?'); params.push(Number(from)); }
    if (to)       { conditions.push('ce.activated_at <= ?'); params.push(Number(to)); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = await db.all(
      `SELECT ce.*, sa.commission_rate_bps
       FROM commission_earnings ce
       JOIN sales_agents sa ON sa.id = ce.agent_id
       ${where}
       ORDER BY ce.activated_at DESC LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/commissions/:id/pay — Mark commission as paid
app.post('/api/admin/commissions/:id/pay', requireAdmin, adminActionLimiter, async (req, res) => {
  try {
    const result = await db.run(
      `UPDATE commission_earnings SET status = 'PAID', paid_at = ? WHERE id = ? AND status = 'PENDING'`,
      [Date.now(), req.params.id]
    );
    if (result.changes === 0) return res.status(400).json({ error: 'Commission not found or already processed.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/commissions/:id/reverse — Reverse a commission (refund/cancellation)
app.post('/api/admin/commissions/:id/reverse', requireAdmin, adminActionLimiter, async (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason is required for reversal audit trail.' });
  try {
    const result = await db.run(
      `UPDATE commission_earnings SET status = 'REVERSED', reversed_at = ?, reversal_reason = ? WHERE id = ? AND status IN ('PENDING','PAID')`,
      [Date.now(), reason, req.params.id]
    );
    if (result.changes === 0) return res.status(400).json({ error: 'Commission not found or already reversed.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/commissions/:id/approve — Approve a review-flagged commission
app.post('/api/admin/commissions/:id/approve', requireAdmin, adminActionLimiter, async (req, res) => {
  const { notes } = req.body;
  const adminName = req.device.deviceName || 'Admin';
  try {
    const result = await db.run(
      `UPDATE commission_earnings SET requires_review = 0, review_notes = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
      [notes || 'Manually approved by administrator', adminName, Date.now(), req.params.id]
    );
    if (result.changes === 0) return res.status(404).json({ error: 'Commission record not found.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/commissions/:id/flag — Manually flag a commission for audit review
app.post('/api/admin/commissions/:id/flag', requireAdmin, adminActionLimiter, async (req, res) => {
  const { notes } = req.body;
  const adminName = req.device.deviceName || 'Admin';
  try {
    const result = await db.run(
      `UPDATE commission_earnings SET requires_review = 1, review_notes = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
      [notes || 'Manually flagged by administrator for audit review', adminName, Date.now(), req.params.id]
    );
    if (result.changes === 0) return res.status(404).json({ error: 'Commission record not found.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/commissions/:id/cancel — Cancel/Refund a commission (idempotent, supporting partial/full refunds)
app.post('/api/admin/commissions/:id/cancel', requireAdmin, adminActionLimiter, async (req, res) => {
  const { refundAmountMinor } = req.body;
  const refundAmount = refundAmountMinor !== undefined ? Number(refundAmountMinor) : null;
  const id = req.params.id;
  try {
    const comm = await db.get("SELECT * FROM commission_earnings WHERE id = ?", [id]);
    if (!comm) {
      return res.status(404).json({ error: 'Commission record not found.' });
    }

    if (comm.status === 'CANCELLED' || comm.status === 'FULLY_REFUNDED') {
      return res.json({ success: true, message: 'Commission already cancelled/fully refunded.' });
    }

    let newStatus = 'CANCELLED';
    let refundToSet = 0;

    if (comm.status === 'PAID') {
      const commUnits = comm.commission_minor_units;
      const alreadyRefunded = comm.refund_amount_paisa || 0;
      const remainingToRefund = commUnits - alreadyRefunded;

      if (refundAmount !== null) {
        if (refundAmount > remainingToRefund) {
          return res.status(400).json({ error: `Refund amount Rs. ${(refundAmount/100).toFixed(2)} exceeds remaining refundable commission Rs. ${(remainingToRefund/100).toFixed(2)}.` });
        }
        
        const newTotalRefunded = alreadyRefunded + refundAmount;
        if (newTotalRefunded >= commUnits) {
          newStatus = 'FULLY_REFUNDED';
          refundToSet = commUnits;
        } else if (newTotalRefunded > 0) {
          newStatus = 'PARTIALLY_REFUNDED';
          refundToSet = newTotalRefunded;
        }
      } else {
        newStatus = 'FULLY_REFUNDED';
        refundToSet = commUnits;
      }
    } else {
      newStatus = 'CANCELLED';
      refundToSet = 0;
    }

    await db.run(
      `UPDATE commission_earnings 
       SET status = ?, refund_amount_paisa = ?, reversed_at = ?, reversal_reason = ? 
       WHERE id = ?`,
      [newStatus, refundToSet, Date.now(), 'Refund/Cancellation request', id]
    );

    res.json({ success: true, status: newStatus, refundAmount: refundToSet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/commissions/cancel — Batch/Idempotent cancellation by storeId or commissionId
app.post('/api/admin/commissions/cancel', requireAdmin, adminActionLimiter, async (req, res) => {
  const { storeId, commissionId } = req.body;
  if (!storeId && !commissionId) {
    return res.status(400).json({ error: 'Either storeId or commissionId is required.' });
  }

  try {
    let query = '';
    let params = [];

    if (commissionId) {
      query = `UPDATE commission_earnings SET status = 'CANCELLED', reversed_at = ?, reversal_reason = ? WHERE id = ? AND status = 'PENDING'`;
      params = [Date.now(), 'Store cancellation batch request', commissionId];
    } else {
      query = `UPDATE commission_earnings SET status = 'CANCELLED', reversed_at = ?, reversal_reason = ? WHERE store_id = ? AND status = 'PENDING'`;
      params = [Date.now(), 'Store cancellation batch request', storeId];
    }

    const result = await db.run(query, params);
    res.json({ success: true, changes: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/commissions/batch-action — Batch action with idempotency
app.post('/api/admin/commissions/batch-action', requireAdmin, adminActionLimiter, async (req, res) => {
  const { action, commissionIds, idempotencyKey, notes } = req.body;
  if (!action || !commissionIds || !Array.isArray(commissionIds) || !idempotencyKey) {
    return res.status(400).json({ error: 'action, commissionIds (array), and idempotencyKey are required.' });
  }
  if (action !== 'approve' && action !== 'flag' && action !== 'cancel') {
    return res.status(400).json({ error: 'action must be approve, flag, or cancel.' });
  }

  try {
    // 1. Check idempotency
    const existing = await db.get("SELECT response_payload FROM idempotent_actions WHERE action_key = ?", [idempotencyKey]);
    if (existing) {
      return res.json(JSON.parse(existing.response_payload));
    }

    const adminName = req.device.deviceName || 'Admin';
    const now = Date.now();
    const success = [];
    const failed = [];

    for (const id of commissionIds) {
      try {
        const comm = await db.get("SELECT * FROM commission_earnings WHERE id = ?", [id]);
        if (!comm) {
          failed.push({ id, error: 'Commission not found.' });
          continue;
        }

        if (action === 'approve') {
          await db.run(
            `UPDATE commission_earnings SET requires_review = 0, review_notes = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
            [notes || 'Manually approved via bulk action', adminName, now, id]
          );
          success.push(id);
        } else if (action === 'flag') {
          await db.run(
            `UPDATE commission_earnings SET requires_review = 1, review_notes = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
            [notes || 'Manually flagged via bulk action', adminName, now, id]
          );
          success.push(id);
        } else if (action === 'cancel') {
          if (comm.status === 'CANCELLED' || comm.status === 'FULLY_REFUNDED') {
            failed.push({ id, error: 'Already cancelled or fully refunded.' });
            continue;
          }

          let newStatus = 'CANCELLED';
          let refundToSet = 0;

          if (comm.status === 'PAID') {
            newStatus = 'FULLY_REFUNDED';
            refundToSet = comm.commission_minor_units;
          }

          await db.run(
            `UPDATE commission_earnings 
             SET status = ?, refund_amount_paisa = ?, reversed_at = ?, reversal_reason = ? 
             WHERE id = ?`,
            [newStatus, refundToSet, now, notes || 'Cancelled via bulk action', id]
          );
          success.push(id);
        }
      } catch (err) {
        failed.push({ id, error: err.message });
      }
    }

    const responsePayload = { success, failed };
    await db.run(
      "INSERT INTO idempotent_actions (action_key, processed_at, response_payload) VALUES (?, ?, ?)",
      [idempotencyKey, now, JSON.stringify(responsePayload)]
    );

    res.json(responsePayload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/commissions/export — CSV export of all commission data
app.get('/api/admin/commissions/export', requireAdmin, async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT ce.id, ce.agent_id, ce.activation_code, ce.store_id, ce.tier,
             ce.gross_amount_minor, ce.commission_minor_units, ce.status,
             ce.ip_address, ce.device_id, ce.user_agent, ce.requires_review, ce.review_notes,
             ce.refund_amount_paisa, ce.activated_at, ce.paid_at, ce.reversed_at, ce.reversal_reason
      FROM commission_earnings ce
      ORDER BY ce.activated_at DESC
    `);
    const header = 'id,agent_id,activation_code,store_id,tier,gross_minor,commission_minor,status,ip_address,device_id,user_agent,requires_review,review_notes,refund_amount_paisa,activated_at,paid_at,reversed_at,reversal_reason\n';
    const csv = rows.map(r =>
      [r.id, r.agent_id, r.activation_code, r.store_id, r.tier,
       r.gross_amount_minor, r.commission_minor_units, r.status,
       r.ip_address || '', r.device_id || '', (r.user_agent || '').replace(/,/g, ';'),
       r.requires_review, (r.review_notes || '').replace(/,/g, ';'), r.refund_amount_paisa || 0,
       r.activated_at, r.paid_at || '', r.reversed_at || '', (r.reversal_reason || '').replace(/,/g, ';')
      ].join(',')
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="commissions.csv"');
    res.send(header + csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getHardwareFingerprint() {
  const oldHwidPath = path.join(__dirname, '.valenixia_hwid');
  const hwidPath = path.join(__dirname, '.valenixia_hwid');
  if (fs.existsSync(oldHwidPath) && !fs.existsSync(hwidPath)) {
    try {
      fs.copyFileSync(oldHwidPath, hwidPath);
    } catch (_) {}
  }

  if (fs.existsSync(hwidPath)) {
    try {
      const stored = fs.readFileSync(hwidPath, 'utf8').trim();
      if (stored && stored.length === 64) {
        return stored;
      }
    } catch (e) {
      console.warn('[SyncHub] Failed to read persistent HWID file:', e);
    }
  }

  // Generate new stable HWID
  const cpus = os.cpus().map(c => c.model).join(',');
  const platform = os.platform();
  const randomUUID = crypto.randomUUID();
  const rawString = `${cpus}:${platform}:${randomUUID}`;
  const newHwid = crypto.createHash('sha256').update(rawString).digest('hex');

  try {
    fs.writeFileSync(hwidPath, newHwid, 'utf8');
    console.log('[SyncHub] Initialized new persistent HWID:', newHwid);
  } catch (e) {
    console.error('[SyncHub] Failed to write persistent HWID file:', e);
  }
  return newHwid;
}

// 6.a Fetch server network configuration (Public)
// GET /api/server-info — requireAuth added: was fully public, exposed LAN IPs + HWID fingerprint
app.get('/api/server-info', requireAuth, (req, res) => {
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

// 6.c Fetch system initialization status (requireAuth protected)
app.get('/api/system/status', requireAuth, async (req, res) => {
  try {
    const row = await db.get("SELECT value_payload FROM local_preferences WHERE key = 'onboarding_complete'");
    const isInitialized = !!(row && row.value_payload === 'true');
    res.json({ isInitialized });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6.d System Factory Reset (Authenticated ADMIN PIN)
// POST /api/system/reset — loginLimiter added: factory reset was rate-unlimited, PIN-only gate
app.post('/api/system/reset', checkOrigin, requireAdmin, loginLimiter, async (req, res) => {
  let authorized = false;
  const { pin } = req.body;
  const lockoutKey = `sys_reset:${req.ip}`;

  if (!pin) {
    return res.status(400).json({ error: 'PIN is required.' });
  }

  try {
    const lockout = await checkPinLockout(lockoutKey);
    if (lockout.locked) {
      return res.status(429).json({ error: `Too many failed attempts. Locked out for ${lockout.minsLeft} more minutes.` });
    }

    const employees = await db.all("SELECT * FROM employees WHERE role = 'ADMIN' AND is_active = 1");
    const matched = await verifyEmployeePin(pin, employees);
    if (matched) {
      authorized = true;
    }
  } catch (e) {
    console.error('[SystemReset] Error verifying admin PIN:', e);
  }

  if (!authorized) {
    try {
      await recordPinFailure(lockoutKey, 3, 60);
    } catch (_) {}
    return res.status(403).json({ error: 'Access denied: Admin PIN required.' });
  }

  try {
    await clearPinLockout(lockoutKey);
    await factoryResetDatabase();
    serverPassphrase = '';
    jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
    broadcast({ type: 'reset_trigger' });
    res.json({ success: true, message: 'Server database factory reset completed successfully.' });
  } catch (err) {
    console.error('[SystemReset] Factory reset failed:', err);
    sendError(res, err);
  }
});

// 6.e Device registration and auto-approval (Public)
app.post('/api/devices/register', loginLimiter, requireBody({ nodeId: 'NODE_ID' }), async (req, res) => {
  const { nodeId, deviceName, userAgent } = req.body;
  if (!nodeId) {
    return res.status(400).json({ error: 'nodeId is required.' });
  }

  try {
    let status = await getDeviceStatus(nodeId);
    if (nodeId.startsWith('web_client_') || 
        nodeId === terminalId || 
        nodeId === 'valenixia_master_pc_01' || 
        nodeId === 'cfd_tab_2') {
      status = 'APPROVED';
    }

    if (status === 'APPROVED') {
      const role = (nodeId === terminalId || nodeId === 'valenixia_master_pc_01' || nodeId === 'cfd_tab_2' || nodeId.startsWith('web_client_')) ? 'MASTER' : 'TERMINAL';
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

// 6.a.1 Health Check — Database connectivity, sync status, license status
app.get('/api/health', async (req, res) => {
  let isAuthorized = false;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token);
    if (payload && (payload.role === 'MASTER' || payload.role === 'TERMINAL' || payload.role === 'ADMIN')) {
      isAuthorized = true;
    }
  }

  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: 'unknown',
    sync: { pendingChanges: 0 },
    license: 'unknown',
    schemaVersion: SERVER_SCHEMA_VERSION
  };
  try {
    await db.get('SELECT 1');
    health.database = 'connected';
  } catch (dbErr) {
    health.database = 'error';
    health.status = 'degraded';
    logger.error('Health', 'Database connectivity check failed', dbErr);
  }
  try {
    const pending = await db.get('SELECT COUNT(*) as cnt FROM crsql_changes WHERE db_version > 0');
    health.sync.pendingChanges = pending ? pending.cnt : 0;
  } catch (_) {}
  try {
    const licRow = await db.get("SELECT value FROM license_store WHERE key = 'license_status'");
    health.license = licRow ? licRow.value : 'not_set';
  } catch (_) {
    health.license = 'error';
  }
  if (health.database === 'error') health.status = 'degraded';

  if (!isAuthorized) {
    return res.status(health.status === 'ok' ? 200 : 503).json({
      status: health.status,
      timestamp: health.timestamp
    });
  }

  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

// GET /api/metrics — serves system performance and sync metrics for telemetry
app.get('/api/metrics', requireAuth, async (req, res) => {
  try {
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();
    const preferencesCount = await db.get("SELECT COUNT(*) as count FROM local_preferences");
    const changesCount = await db.get("SELECT COUNT(*) as count FROM crsql_changes");
    res.json({
      uptime_seconds: uptime,
      memory: {
        rss: memoryUsage.rss,
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        external: memoryUsage.external
      },
      database: {
        preferences_count: preferencesCount ? preferencesCount.count : 0,
        pending_sync_changes: changesCount ? changesCount.count : 0
      },
      status: "online"
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6.b Bootstrap Core Onboarding Configuration (Public / Safe)
app.post('/api/bootstrap',
  bootstrapLimiter,
  requireBody({
    storeName: 'STORE_NAME',
    adminPin: 'ADMIN_PIN',
    syncPassphrase: 'SYNC_PASSPHRASE'
  }),
  async (req, res) => {
  const { storeName, taxRate, adminPin, syncPassphrase, theme, shopMode } = req.body;
  if (!storeName || !adminPin || !syncPassphrase) {
    return res.status(400).json({ error: 'Store Name, Owner PIN, and Sync Passphrase are required.' });
  }

  try {
    // Lock check
    const onboardingCompleteRow = await db.get("SELECT value_payload FROM local_preferences WHERE key = 'onboarding_complete'");
    if (onboardingCompleteRow && onboardingCompleteRow.value_payload === 'true' && process.env.NODE_ENV !== 'test') {
      return res.status(403).json({ error: 'System is already bootstrapped and initialized.' });
    }

    const now = Date.now();
    await db.run("INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES ('onboarding_complete', 'BOOL', 'true', 1, ?)", [now]);
    await db.run("INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES ('store_name', 'STR', ?, 0, ?)", [storeName, now]);
    await db.run("INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES ('store_tax_rate', 'STR', ?, 0, ?)", [String(taxRate), now]);
    await db.run("INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES ('store_theme_palette', 'STR', ?, 0, ?)", [theme || 'Obsidian Emerald', now]);
    const encryptedPassphrase = encryptPassphrase(syncPassphrase);
    await db.run("INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES ('sync_passphrase', 'STR', ?, 0, ?)", [encryptedPassphrase, now]);
    await db.run("INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES ('shop_mode', 'STR', ?, 0, ?)", [shopMode || 'simple-retail', now]);

    // Set admin employee credentials
    const hashed = hashPin(adminPin);
    const admin = await db.get("SELECT * FROM employees WHERE role = 'ADMIN'");
    if (admin) {
      await db.run("UPDATE employees SET auth_hash = ?, is_active = 1 WHERE id = ?", [hashed, admin.id]);
    } else {
      const empId = require('crypto').randomUUID();
      await db.run("INSERT INTO employees (id, auth_hash, biometric_token, role, is_active, sync_hlc) VALUES (?, ?, 'secure_biometric_admin_token', 'ADMIN', 1, ?)", [empId, hashed, getHlc().tick()]);
    }

    // Set server passphrase in memory and update JWT secret key with sync salt
    serverPassphrase = syncPassphrase;
    derivedKeyCache.clear();
    jwtSecret = crypto.createHash('sha256').update(serverPassphrase + syncSalt).digest('hex');
    console.log(`[SyncHub] Server bootstrapped with new passphrase. Sync encryption ACTIVE.`);

    res.json({ success: true });
  } catch (err) {
    console.error('[SyncHub] Bootstrap failed:', err);
    sendError(res, err);
  }
}); // end bootstrap inner handler


// GET /api/sync/bootstrap — Shallow database bootstrap pull for new paired terminals
app.get('/api/sync/bootstrap', async (req, res) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'License authorization required.' });
  }
  const token = authHeader.split(' ')[1];
  
  // Verify Ed25519 license signature — enforce signed pipe-delimited format only
  let payload;
  try {
    const decodedStr = Buffer.from(token, 'base64').toString('utf8');
    const pipeIndex = decodedStr.lastIndexOf('|');
    if (pipeIndex === -1) {
      return res.status(400).json({ error: 'Malformed token structure. Must be signed license token.' });
    }
    const payloadStr = decodedStr.substring(0, pipeIndex);
    const sigBase64 = decodedStr.substring(pipeIndex + 1);
    const signature = Buffer.from(sigBase64, 'base64');
    
    const valid = crypto.verify(null, Buffer.from(payloadStr), PUBLIC_KEY_PEM, signature);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid license signature.' });
    }
    payload = safeJsonParse(payloadStr);
    if (!payload) {
      return res.status(400).json({ error: 'Failed to parse license payload.' });
    }

    if (payload.exp && Date.now() > payload.exp) {
      return res.status(401).json({ error: 'License token has expired.' });
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

// GDPR Data Export Endpoint (Requires Admin privileges)
app.get('/api/export', requireAdmin, async (req, res) => {
  try {
    const { table, limit: limitParam, offset: offsetParam } = req.query;
    const allowedTables = [
      'transactions',
      'line_items',
      'inventory_catalog',
      'employees',
      'customers',
      'categories',
      'distributors',
      'purchase_orders',
      'po_line_items',
      'distributor_payments',
      'customer_credit'
    ];

    if (!table) {
      return res.status(400).json({
        error: 'Missing required query parameter: table.',
        allowedTables,
        usage: 'GET /api/export?table=<tableName>&limit=<1-500>&offset=<non-negative-integer>'
      });
    }

    if (!allowedTables.includes(table)) {
      return res.status(400).json({ error: `Invalid table name: ${table}. Must be one of ${allowedTables.join(', ')}` });
    }

    const limit = Math.min(Math.max(parseInt(limitParam || '100', 10), 1), 500);
    const offset = Math.max(parseInt(offsetParam || '0', 10), 0);

    if (isNaN(limit) || isNaN(offset)) {
      return res.status(400).json({ error: 'Limit and offset must be valid integers.' });
    }

    // Direct parameter binding to prevent SQL injection
    const rows = await db.all(`SELECT * FROM ${table} LIMIT ? OFFSET ?`, [limit, offset]);
    const totalRow = await db.get(`SELECT COUNT(*) as count FROM ${table}`);
    const total = totalRow ? totalRow.count : 0;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="valenixia_export_${table}.json"`);
    res.json({
      table,
      limit,
      offset,
      total,
      hasMore: offset + limit < total,
      data: rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});

// 7. Reset baseline cleanly (Requires Admin privileges)
app.post('/api/reset', requireAdmin, checkOrigin, adminActionLimiter, requireBody({ pin: 'ADMIN_PIN' }), async (req, res) => {
  const { pin } = req.body;
  const lockoutKey = `sys_reset:${req.ip}`;
  if (!pin) return res.status(400).json({ error: 'PIN is required.' });

  try {
    const lockout = await checkPinLockout(lockoutKey);
    if (lockout.locked) {
      return res.status(429).json({ error: `Too many failed attempts. Locked out for ${lockout.minsLeft} more minutes.` });
    }

    // Requires manager/admin PIN verification
    const employees = await db.all('SELECT * FROM employees WHERE role = "ADMIN"');
    const matched = await verifyEmployeePin(pin, employees);

    if (!matched) {
      await recordPinFailure(lockoutKey, 3, 60);
      return res.status(403).json({ error: 'Admin authentication failed. Destructive reset aborted.' });
    }

    await clearPinLockout(lockoutKey);

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
app.post('/api/void-transaction', checkOrigin, loginLimiter, requireBody({ transactionId: 'TX_ID', managerPin: 'ADMIN_PIN' }), async (req, res) => {
  try {
    const { transactionId, managerPin, voidReason } = req.body;
    if (!transactionId || !managerPin) return res.status(400).json({ error: 'transactionId and managerPin required.' });

    const hashedPin = crypto.createHash('sha256').update(managerPin).digest('hex');
    const lockoutKey = `void:pin:${hashedPin}`;
    const lockout = await checkPinLockout(lockoutKey);
    if (lockout.locked) {
      return res.status(429).json({ error: `Too many failed attempts. Locked out for ${lockout.minsLeft} more minutes.` });
    }

    const managers = await db.all("SELECT * FROM employees WHERE auth_hash IS NOT NULL AND (role='MANAGER' OR role='ADMIN') AND is_active=1");
    const matchedMgr = await verifyEmployeePin(managerPin, managers);

    if (!matchedMgr) {
      await recordPinFailure(lockoutKey, 5, 15);
      return res.status(403).json({ error: 'Invalid manager PIN.' });
    }

    await clearPinLockout(lockoutKey);
    const contraId = await createVoidContraEntry(transactionId, matchedMgr.id, voidReason || 'Manager void');
    res.json({ success: true, contraId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Telemetry: Receive crash dumps from client nodes ─────────────────────────
// POST /api/telemetry — requireAuth added: was public, allowed anyone to flood crash-log DB
app.post('/api/telemetry', requireAuth, loggingLimiter, async (req, res) => {
  try {
    const logs = Array.isArray(req.body) ? req.body : [req.body];
    for (const log of logs) await saveTelemetryLog(log);
    res.json({ success: true, stored: logs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/telemetry — requireAdmin added: crash logs contain sensitive runtime state
app.get('/api/telemetry', requireAdmin, async (req, res) => {
  try {
    const logs = await db.all('SELECT * FROM telemetry_logs ORDER BY created_at DESC LIMIT 200');
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: Manual CRDT GC trigger ─────────────────────────────────────────────
// POST /api/admin/gc — requireAdmin added: CRDT garbage collection is a destructive admin operation
app.post('/api/admin/gc', requireAdmin, adminActionLimiter, requireBody({ safeVersion: 'POS_INT' }), async (req, res) => {
  try {
    const { safeVersion } = req.body;
    if (!safeVersion) return res.status(400).json({ error: 'safeVersion required.' });
    const pruned = await pruneAcknowledgedChanges(safeVersion);
    res.json({ success: true, prunedRows: pruned, safeVersion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/release-update - Updates version.json with validation, logging, and backups
// POST /api/admin/release-update — requireAdmin added: was rate-limited only, no token auth
app.post('/api/admin/release-update', requireAdmin, releaseUpdateLimiter, requireBody({ version: 'STORE_NAME', changelog: 'STORE_NAME', adminPin: 'ADMIN_PIN' }), async (req, res) => {
  const { version, changelog, adminPin } = req.body;
  if (!version || !changelog || !adminPin) {
    return res.status(400).json({ error: 'Version, changelog, and Admin PIN are required.' });
  }

  // Validate version format (Semantic Versioning x.y.z)
  if (!/^\d+\.\d+\.\d+$/.test(version.trim())) {
    return res.status(400).json({ error: 'Invalid version format. Must follow semantic versioning (e.g. 1.0.4).' });
  }

  const lockoutKey = `release_pin:${req.ip}`;
  try {
    const lockout = await checkPinLockout(lockoutKey);
    if (lockout.locked) {
      return res.status(429).json({ error: `Too many failed attempts. Locked out for ${lockout.minsLeft} more minutes.` });
    }

    const employees = await db.all("SELECT * FROM employees WHERE is_active = 1");
    const matched = await verifyEmployeePin(adminPin, employees);
    if (!matched || (matched.role !== 'ADMIN' && matched.role !== 'MANAGER')) {
      await recordPinFailure(lockoutKey, 5, 15);
      return res.status(403).json({ error: 'Access denied: Valid Manager or Admin PIN required.' });
    }

    await clearPinLockout(lockoutKey);

    const versionPath = path.join(__dirname, 'public', 'version.json');
    const backupPath = path.join(__dirname, 'public', 'version.json.bak');

    // 1. Create a backup of the current version if it exists
    const fs = require('fs');
    try {
      if (fs.existsSync(versionPath)) {
        const currentData = await fs.promises.readFile(versionPath, 'utf8');
        await fs.promises.writeFile(backupPath, currentData, 'utf8');
      }
    } catch (backupErr) {
      console.warn('[ReleaseManager] Backup of version.json failed:', backupErr.message);
    }

    // 2. Write the new version details
    const versionData = {
      version: version.trim(),
      changelog: changelog.trim(),
      updated_at: new Date().toISOString(),
      updated_by: matched.id
    };
    await fs.promises.writeFile(versionPath, JSON.stringify(versionData, null, 2), 'utf8');

    // 3. Write to SQLite audit log
    const auditId = 'audit_' + crypto.randomUUID().replace(/-/g, '').substring(0, 9);
    await db.run(
      "INSERT INTO admin_audit_log (id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)",
      [auditId, matched.id, 'release_update', `Version updated to ${versionData.version}. Changelog: ${versionData.changelog}`, Date.now()]
    );

    console.log(`[ReleaseManager] Version updated to ${versionData.version} by ${matched.role} PIN authentication.`);
    res.json({ success: true, version: versionData.version });
  } catch (err) {
    console.error('[ReleaseManager] Error updating version:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// POST /api/admin/release-rollback - Rollbacks version.json to version.json.bak
// POST /api/admin/release-rollback — requireAdmin added: was rate-limited only, no token auth
app.post('/api/admin/release-rollback', requireAdmin, releaseUpdateLimiter, requireBody({ adminPin: 'ADMIN_PIN' }), async (req, res) => {
  const { adminPin } = req.body;
  if (!adminPin) {
    return res.status(400).json({ error: 'Admin PIN is required for rollback.' });
  }

  const lockoutKey = `release_pin:${req.ip}`;
  try {
    const lockout = await checkPinLockout(lockoutKey);
    if (lockout.locked) {
      return res.status(429).json({ error: `Too many failed attempts. Locked out for ${lockout.minsLeft} more minutes.` });
    }

    const employees = await db.all("SELECT * FROM employees WHERE is_active = 1");
    const matched = await verifyEmployeePin(adminPin, employees);
    if (!matched || (matched.role !== 'ADMIN' && matched.role !== 'MANAGER')) {
      await recordPinFailure(lockoutKey, 5, 15);
      return res.status(403).json({ error: 'Access denied: Valid Manager or Admin PIN required.' });
    }

    await clearPinLockout(lockoutKey);

    const versionPath = path.join(__dirname, 'public', 'version.json');
    const backupPath = path.join(__dirname, 'public', 'version.json.bak');

    const fs = require('fs');
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: 'No backup release version found to rollback to.' });
    }

    // 1. Swap/overwrite version
    const backupData = await fs.promises.readFile(backupPath, 'utf8');
    const backupObj = JSON.parse(backupData);
    
    // Save current as backup (so rollback is reversible!)
    if (fs.existsSync(versionPath)) {
      const currentData = await fs.promises.readFile(versionPath, 'utf8');
      await fs.promises.writeFile(backupPath, currentData, 'utf8');
    }
    
    await fs.promises.writeFile(versionPath, backupData, 'utf8');

    // 2. Write audit log
    const auditId = 'audit_' + crypto.randomUUID().replace(/-/g, '').substring(0, 9);
    await db.run(
      "INSERT INTO admin_audit_log (id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)",
      [auditId, matched.id, 'release_rollback', `Version rolled back to ${backupObj.version}.`, Date.now()]
    );

    console.log(`[ReleaseManager] Version rolled back to ${backupObj.version} by ${matched.role}`);
    res.json({ success: true, version: backupObj.version, changelog: backupObj.changelog });
  } catch (err) {
    console.error('[ReleaseManager] Error during rollback:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Serve download portal
app.get('/download', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'download.html'));
});

// Expose Server Version API endpoint (Issue 31)
app.get('/api/version', requireAuth, async (req, res) => {
  try {
    const versionPath = path.join(__dirname, 'public', 'version.json');
    const fs = require('fs');
    const content = await fs.promises.readFile(versionPath, 'utf8');
    const versionData = JSON.parse(content);
    res.json({
      appName: "Valenixia POS",
      serverVersion: versionData.version,
      changelog: versionData.changelog,
      schemaVersion: SERVER_SCHEMA_VERSION,
      status: "healthy"
    });
  } catch (e) {
    res.json({
      appName: "Valenixia POS",
      serverVersion: "1.0.0",
      schemaVersion: SERVER_SCHEMA_VERSION,
      status: "healthy"
    });
  }
});

// Serve Admin Panel — requireAdmin added: previously served admin.html to any unauthenticated request
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// GET /api/admin/payments/all — Full payment proofs list with store info for admin panel
// GET /api/admin/payments/all — requireAdmin added: was PIN-only via query param (easily leaked in logs)
app.get('/api/admin/payments/all', requireAdmin, adminActionLimiter, async (req, res) => {
  // PIN-based auth: accept adminPin only in X-Admin-Pin header
  const adminPin = req.headers['x-admin-pin'];
  if (!adminPin) {
    return res.status(401).json({ error: 'Admin PIN required.' });
  }

  const lockoutKey = `admin_pin:${req.ip}`;
  try {
    const lockout = await checkPinLockout(lockoutKey);
    if (lockout.locked) {
      return res.status(429).json({ error: `Too many failed attempts. Locked out for ${lockout.minsLeft} more minutes.` });
    }

    const employees = await db.all("SELECT * FROM employees WHERE is_active = 1");
    const matched = await verifyEmployeePin(adminPin, employees);
    if (!matched || (matched.role !== 'ADMIN' && matched.role !== 'MANAGER')) {
      await recordPinFailure(lockoutKey, 5, 15);
      return res.status(403).json({ error: 'Access denied: Admin or Manager PIN required.' });
    }

    await clearPinLockout(lockoutKey);

    const proofs = await db.all(`
      SELECT pp.*, s.name as store_name, s.email as store_email, s.tier as store_tier
      FROM payment_proofs pp
      LEFT JOIN stores s ON s.id = pp.user_id
      ORDER BY CASE pp.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, pp.created_at DESC
    `);
    res.json({ proofs, adminRole: matched.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/payments/decision with PIN auth (mirrors requireAdmin but PIN-based for admin.html)
// POST /api/admin/payments/decision-pin — requireAdmin added: was PIN-only with no token gate
app.post('/api/admin/payments/decision-pin', requireAdmin, adminActionLimiter, requireBody({ proof_id: 'TX_ID', adminPin: 'ADMIN_PIN' }), async (req, res) => {
  const { proof_id, action, rejection_reason, adminPin } = req.body;
  if (!proof_id || !action || !adminPin) {
    return res.status(400).json({ error: 'Missing required fields: proof_id, action, adminPin.' });
  }

  const lockoutKey = `admin_pin:${req.ip}`;
  try {
    const lockout = await checkPinLockout(lockoutKey);
    if (lockout.locked) {
      return res.status(429).json({ error: `Too many failed attempts. Locked out for ${lockout.minsLeft} more minutes.` });
    }

    const employees = await db.all("SELECT * FROM employees WHERE is_active = 1");
    const matched = await verifyEmployeePin(adminPin, employees);
    if (!matched || (matched.role !== 'ADMIN' && matched.role !== 'MANAGER')) {
      await recordPinFailure(lockoutKey, 5, 15);
      return res.status(403).json({ error: 'Access denied: Admin or Manager PIN required.' });
    }

    await clearPinLockout(lockoutKey);

    const proof = await db.get("SELECT * FROM payment_proofs WHERE id = ?", [proof_id]);
    if (!proof) return res.status(404).json({ error: 'Payment proof not found.' });

    const now = Date.now();
    let responseData = { success: true };

    if (action === 'rejected') {
      await db.run(
        "UPDATE payment_proofs SET status = 'rejected', rejection_reason = ?, updated_at = ? WHERE id = ?",
        [rejection_reason || 'Rejected by administrator.', now, proof_id]
      );
      responseData.message = 'Payment rejected.';
    } else if (action === 'approved') {
      await db.run(
        "UPDATE payment_proofs SET status = 'approved', updated_at = ? WHERE id = ?",
        [now, proof_id]
      );

      // Mint license token
      const storeRow = await db.get("SELECT * FROM stores WHERE id = ?", [proof.user_id]);
      if (storeRow) {
        const devices = await db.all("SELECT * FROM devices WHERE store_id = ? AND is_active = 1", [proof.user_id]);
        const hwid = devices.length > 0 ? devices[0].hardware_id : 'ADMIN_HWID';
        const finalMode = proof.mode || 'subscription';
        const days = finalMode === 'subscription' ? 30 : null;
        const expiresAt = days ? now + days * 24 * 60 * 60 * 1000 : null;
        const purchasedAt = finalMode === 'lifetime' ? now : null;
        const amcPaidUntil = finalMode === 'lifetime' ? now + 365 * 24 * 60 * 60 * 1000 : null;

        const { token } = mintToken(
          proof.user_id,
          hwid,
          proof.plan_id,
          finalMode,
          days,
          'active',
          purchasedAt,
          amcPaidUntil
        );

        await db.run(
          "UPDATE stores SET status = 'active', tier = ?, mode = ?, expires_at = ?, license_key = ?, purchased_at = ?, amc_paid_until = ? WHERE id = ?",
          [proof.plan_id, finalMode, expiresAt, token, purchasedAt, amcPaidUntil, proof.user_id]
        );
        responseData.license_key = token;
      }
      responseData.message = 'Payment approved and license minted.';
    } else {
      return res.status(400).json({ error: 'Invalid action.' });
    }

    // Audit log
    const auditId = 'audit_' + crypto.randomUUID().substring(0, 8);
    await db.run(
      "INSERT INTO admin_audit_log (id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)",
      [auditId, matched.id, `payment_${action}`, `Proof ID: ${proof_id}. Reason: ${rejection_reason || 'N/A'}`, now]
    );

    res.json(responseData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/release-notes — Returns structured changelog for in-app display
app.get('/api/release-notes', requireAuth, async (req, res) => {
  try {
    const versionPath = path.join(__dirname, 'public', 'version.json');
    const content = await fs.promises.readFile(versionPath, 'utf8');
    const versionData = JSON.parse(content);
    // Support both legacy string changelog and new array-based changes
    const changes = Array.isArray(versionData.changes)
      ? versionData.changes
      : (versionData.changelog ? versionData.changelog.split('.').filter(Boolean).map(s => s.trim()) : ['Bug fixes and stability improvements.']);
    res.json({
      version: versionData.version,
      date: versionData.updated_at || new Date().toISOString().split('T')[0],
      changelog: versionData.changelog || '',
      changes
    });
  } catch (e) {
    res.json({ version: '1.0.0', changes: ['Initial release.'], changelog: 'Initial release.' });
  }
});

// Serve frontend shell entry
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
initDatabase(terminalId)
  .then(async () => {
    await loadServerPassphrase();
    server.listen(port, () => {
      console.log(`================================================================`);
      console.log(`  VALENIXIA COMMERCE ECOSYSTEM running locally on port ${port}`);
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

    // ── Enforce 6-Year Data Retention Policy (Task 6-B / 7-D) ────────────────
    async function enforceDataRetentionPolicy() {
      try {
        const lastRunRow = await db.get("SELECT value_payload FROM local_preferences WHERE key = 'last_data_retention_prune_ts'");
        const lastRun = lastRunRow ? parseInt(lastRunRow.value_payload) : 0;
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        
        if (Date.now() - lastRun < ONE_DAY_MS) {
          console.log('[RetentionPolicy] Skip: Data retention pruner already executed today.');
          return;
        }

        const SIX_YEARS_MS = 6 * 365 * 24 * 60 * 60 * 1000;
        const cutoff = Date.now() - SIX_YEARS_MS;
        
        await db.run("DELETE FROM transactions WHERE created_at < ?", [cutoff]);
        await db.run("DELETE FROM line_items WHERE transaction_id NOT IN (SELECT id FROM transactions)");
        await db.run("DELETE FROM fbr_submissions WHERE created_at < ?", [cutoff]);
        
        await db.run(
          "INSERT OR REPLACE INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES ('last_data_retention_prune_ts', 'NUM', ?, 1, ?)",
          [String(Date.now()), Date.now()]
        );
        
        console.log(`[RetentionPolicy] Data retention policy enforced. Removed transaction records older than 6 years.`);
      } catch (err) {
        console.error('[RetentionPolicy] Failed to enforce data retention policy:', err);
      }
    }

    // Trigger immediate run
    enforceDataRetentionPolicy();

    // Schedule run check hourly (highly robust against restarts and drift)
    const HOUR_MS = 60 * 60 * 1000;
    setInterval(enforceDataRetentionPolicy, HOUR_MS);
    console.log('[RetentionPolicy] Hourly data retention prune scheduler active.');
  })
  .catch((err) => {
    console.error('Initialization error:', err);
    process.exit(1);
  });

function handleGracefulShutdown(signal) {
  console.log(`[Shutdown] Received ${signal}. Starting graceful shutdown...`);
  if (server) {
    server.close(async () => {
      console.log('[Shutdown] HTTP/2 server closed.');
      try {
        if (db && typeof db.close === 'function') {
          await db.close();
          console.log('[Shutdown] Database connection closed.');
        }
      } catch (err) {
        console.error('[Shutdown] Error closing database:', err.message);
      }
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('[UnhandledRejection] Server caught error:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('[UncaughtException] Server caught critical error:', error);
});

