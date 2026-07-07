#!/usr/bin/env node
// ============================================================================
// SECURE CLOUD LICENSE PROVISIONER — PRODUCTION EDITION
// Signs license tokens using Ed25519 Private Key loaded from secure memory.
// Usage:
//   node scripts/license-provisioner.js --store=store_123 --hwid=FINGERPRINT --tier=PRO --mode=subscription --days=30
// ============================================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── Configuration ────────────────────────────────────────────────────────────
const PRIVATE_KEY_ENV = process.env.LICENSE_PRIVATE_KEY;
const PRIVATE_KEY_FILE = path.join(__dirname, '..', '.license-private.pem');

function loadPrivateKey() {
  // 1. Try secure memory environment variable first (Zero-disk deployment rule)
  if (PRIVATE_KEY_ENV) {
    try {
      if (PRIVATE_KEY_ENV.includes('-----BEGIN PRIVATE KEY-----')) {
        return PRIVATE_KEY_ENV;
      }
      // Base64 decoded key
      return Buffer.from(PRIVATE_KEY_ENV, 'base64').toString('utf8');
    } catch (e) {
      throw new Error(`Failed to decode LICENSE_PRIVATE_KEY from environment variable: ${e.message}`);
    }
  }

  // 2. Fallback to local disk file (Allowed only for local debugging/CLI tools)
  if (fs.existsSync(PRIVATE_KEY_FILE)) {
    console.warn('[WARN] LICENSE_PRIVATE_KEY env missing. Falling back to local .license-private.pem');
    return fs.readFileSync(PRIVATE_KEY_FILE, 'utf8');
  }

  throw new Error('Ed25519 Private Key was not found. Set the LICENSE_PRIVATE_KEY environment variable or create .license-private.pem');
}

function mintToken(storeId, hwid, tier, mode, days, status = 'active') {
  if (!storeId || !hwid || !tier || !mode) {
    throw new Error('Missing arguments for license minting. Required: storeId, hwid, tier, mode');
  }

  const allowedTiers = ['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE'];
  if (!allowedTiers.includes(tier)) {
    throw new Error(`Invalid tier: ${tier}. Allowed: ${allowedTiers.join(', ')}`);
  }

  const allowedModes = ['subscription', 'lifetime'];
  if (!allowedModes.includes(mode)) {
    throw new Error(`Invalid mode: ${mode}. Allowed: ${allowedModes.join(', ')}`);
  }

  const privateKey = loadPrivateKey();
  const iat = Date.now();
  
  let exp = null;
  if (mode === 'subscription') {
    const numDays = parseInt(days || 3); // Default to 3 days trial
    if (isNaN(numDays) || numDays <= 0) {
      throw new Error('Invalid subscription days value.');
    }
    exp = iat + (numDays * 24 * 60 * 60 * 1000);
  }

  const payload = JSON.stringify({
    store_id: storeId,
    hwid: hwid.toUpperCase(),
    tier,
    mode,
    status,
    exp,
    iat
  });

  const signature = crypto.sign(null, Buffer.from(payload), privateKey).toString('base64');
  const token = Buffer.from(`${payload}|${signature}`).toString('base64');

  return {
    token,
    payload: JSON.parse(payload)
  };
}

// ── CLI Parsing ──────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const flags = Object.fromEntries(
    args.filter(a => a.startsWith('--'))
      .map(a => {
        const [k, v] = a.slice(2).split('=');
        return [k, v];
      })
  );

  const store = flags.store || flags.storeId;
  const hwid = flags.hwid;
  const tier = flags.tier;
  const mode = flags.mode;
  const days = flags.days;

  if (args.length === 0 || flags.help || !store || !hwid || !tier || !mode) {
    console.log('Nexova POS License Provisioning Tool\n');
    console.log('Usage:');
    console.log('  node scripts/license-provisioner.js --store=<id> --hwid=<fingerprint> --tier=<TRIAL|STARTER|PRO|ENTERPRISE> --mode=<subscription|lifetime> [--days=<days>]\n');
    console.log('Example (Subscription):');
    console.log('  node scripts/license-provisioner.js --store=store_987 --hwid=B4FD7E3A9C8B1E --tier=PRO --mode=subscription --days=30\n');
    console.log('Example (Lifetime):');
    console.log('  node scripts/license-provisioner.js --store=store_987 --hwid=B4FD7E3A9C8B1E --tier=ENTERPRISE --mode=lifetime');
    process.exit(0);
  }

  try {
    const result = mintToken(store, hwid, tier, mode, days);
    console.log('\n=== MINTED LICENSE METADATA ===');
    console.log(JSON.stringify(result.payload, null, 2));
    console.log('\n=== ENCODED LICENSE KEY ===');
    console.log(result.token);
    console.log('\n[OK] Provisioning complete.');
  } catch (err) {
    console.error('[ERROR]', err.message);
    process.exit(1);
  }
}

module.exports = { mintToken };
