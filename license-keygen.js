#!/usr/bin/env node
// ============================================================================
// VALENIXIA LICENSE KEYGEN TOOL — DEVELOPER USE ONLY. NEVER SHIP TO CLIENTS.
// Ed25519 Asymmetric License Generation & Signing System
// Usage:
//   node license-keygen.js generate
//   node license-keygen.js sign --hwid=<fingerprint> --tier=PRO --days=365
//   node license-keygen.js verify --token=<base64_token> --hwid=<fingerprint>
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const DEFAULT_PRIVATE_KEY_DIR = path.join(os.homedir(), '.valenixia');
const PRIVATE_KEY_PATH = process.env.LICENSE_PRIVATE_KEY_PATH ||
  path.join(DEFAULT_PRIVATE_KEY_DIR, '.license-private.pem');
const PUBLIC_KEY_PATH  = path.join(__dirname, 'public-license-key.pem');

const TIERS = ['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE'];

function generateKeyPair() {
  const targetPrivateKeyPath = PRIVATE_KEY_PATH;
  if (fs.existsSync(targetPrivateKeyPath)) {
    console.error('[ERROR] Private key already exists at', targetPrivateKeyPath);
    console.error('        Delete it manually to regenerate (destructive action).');
    process.exit(1);
  }
  const targetDir = path.dirname(targetPrivateKeyPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  fs.writeFileSync(targetPrivateKeyPath, privateKey, { mode: 0o600 });
  fs.writeFileSync(PUBLIC_KEY_PATH,  publicKey);
  console.log('[OK] Ed25519 key pair generated.');
  console.log('     Private key (KEEP SECRET, OFFLINE):', targetPrivateKeyPath);
  console.log('     Public key (embed in POS source):',   PUBLIC_KEY_PATH);
  console.log('\n=== PUBLIC KEY (paste into license-engine.js) ===');
  console.log(publicKey);
}

function signLicense(hwid, tier, days) {
  if (!hwid || !tier || !days) {
    console.error('[ERROR] Usage: node license-keygen.js sign --hwid=<hash> --tier=PRO --days=365');
    process.exit(1);
  }
  if (!TIERS.includes(tier)) {
    console.error('[ERROR] Invalid tier. Must be one of:', TIERS.join(', '));
    process.exit(1);
  }
  const activeKeyPath = PRIVATE_KEY_PATH;
  if (!fs.existsSync(activeKeyPath)) {
    console.error('[ERROR] Private key not found. Run: node license-keygen.js generate');
    process.exit(1);
  }

  const privateKey = fs.readFileSync(activeKeyPath, 'utf8');
  const exp = Date.now() + (parseInt(days) * 24 * 60 * 60 * 1000);
  const issuedAt = Date.now();

  const payload = JSON.stringify({ hwid, tier, exp, iat: issuedAt });
  const signature = crypto.sign(null, Buffer.from(payload), privateKey).toString('base64');
  const token = Buffer.from(`${payload}|${signature}`).toString('base64');

  const expDate = new Date(exp).toISOString().split('T')[0];
  console.log(`\n[OK] License generated for HWID: ${hwid}`);
  console.log(`     Tier: ${tier} | Expires: ${expDate} (${days} days)`);
  console.log('\n=== LICENSE TOKEN (send to client) ===');
  console.log(token);
}

function verifyLicense(token, hwid) {
  if (!fs.existsSync(PUBLIC_KEY_PATH)) {
    console.error('[ERROR] Public key not found at', PUBLIC_KEY_PATH);
    process.exit(1);
  }
  try {
    const publicKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const pipeIndex = decoded.lastIndexOf('|');
    const payloadStr  = decoded.substring(0, pipeIndex);
    const sigBase64   = decoded.substring(pipeIndex + 1);
    const signature   = Buffer.from(sigBase64, 'base64');
    const payload     = JSON.parse(payloadStr);

    const valid = crypto.verify(null, Buffer.from(payloadStr), publicKey, signature);
    if (!valid) { console.error('[FAIL] Signature invalid.'); process.exit(1); }
    if (payload.hwid !== hwid) { console.error(`[FAIL] HWID mismatch. Token HWID: ${payload.hwid}`); process.exit(1); }
    if (payload.exp < Date.now()) { console.error('[FAIL] License expired:', new Date(payload.exp).toISOString()); process.exit(1); }

    console.log('[OK] License VALID');
    console.log('     HWID:', payload.hwid);
    console.log('     Tier:', payload.tier);
    console.log('     Expires:', new Date(payload.exp).toISOString());
  } catch (err) {
    console.error('[ERROR] Could not verify token:', err.message);
    process.exit(1);
  }
}

// ─── CLI argument parser ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const command = args[0];
const flags = Object.fromEntries(
  args.slice(1)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, v] = a.slice(2).split('='); return [k, v]; })
);

switch (command) {
  case 'generate': generateKeyPair(); break;
  case 'sign':     signLicense(flags.hwid, flags.tier, flags.days); break;
  case 'verify':   verifyLicense(flags.token, flags.hwid); break;
  default:
    console.log('Valenixia License Keygen Tool\n');
    console.log('  node license-keygen.js generate');
    console.log('  node license-keygen.js sign --hwid=<hash> --tier=PRO --days=365');
    console.log('  node license-keygen.js verify --token=<base64> --hwid=<hash>');
}
