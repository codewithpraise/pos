// ============================================================================
// VALENIXIA POS - Zero-Dependency Structured Logger
// Outputs JSON-formatted log lines to stdout (info/debug) and stderr (warn/error)
// ============================================================================

'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const correlationStorage = new AsyncLocalStorage();

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LEVELS[process.env.LOG_LEVEL] ?? (process.env.NODE_ENV === 'production' ? LEVELS.info : LEVELS.debug);
const IS_PROD = process.env.NODE_ENV === 'production';

function maskPII(str) {
  if (typeof str !== 'string') return str;
  return str
    // PEM private key blocks
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    // Bearer & Raw JWT tokens
    .replace(/\b(Bearer\s+)[A-Za-z0-9-_.\/+=]+/gi, '$1[REDACTED_TOKEN]')
    .replace(/\beyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]+\b/g, '[REDACTED_JWT]')
    // Sensitive key-value pairs (quoted and unquoted, case-insensitive)
    .replace(/("?(?:token|passphrase|secret|password|pin|adminPin|admin_pin|apiKey|api_key|authToken|auth_token|deviceToken|device_token|jwt_secret|master_key|auth_hash|sync_salt)"?\s*[:=]\s*)"[^"]+"/gi, '$1"[REDACTED]"')
    .replace(/("?(?:token|passphrase|secret|password|pin|adminPin|admin_pin|apiKey|api_key|authToken|auth_token|deviceToken|device_token|jwt_secret|master_key|auth_hash|sync_salt)"?\s*[:=]\s*)[^\s,}]+/gi, '$1[REDACTED]')
    // Phone numbers (E.164 and Pakistani format)
    .replace(/(\+92|0)[0-9]{9,10}/g, '[PHONE_REDACTED]')
    // Email addresses
    .replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]')
    // CNIC (Pakistan national ID)
    .replace(/\b\d{5}-\d{7}-\d{1}\b/g, '[CNIC_REDACTED]');
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  try {
    const json = JSON.stringify(meta);
    return JSON.parse(maskPII(json));
  } catch (e) {
    return meta;
  }
}

/**
 * Write a single structured log line.
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} component - calling module / subsystem tag
 * @param {string} message
 * @param {object} [meta] - optional key-value metadata
 */
function log(level, component, message, meta = {}) {
  if (LEVELS[level] < CURRENT_LEVEL) return;

  const correlationId = correlationStorage.getStore();
  const sanitizedMessage = maskPII(message);
  const sanitizedMeta = sanitizeMeta(meta);
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    component,
    message: sanitizedMessage,
    correlationId,
    ...sanitizedMeta
  });

  if (level === 'warn' || level === 'error') {
    process.stderr.write(entry + '\n');
  } else {
    process.stdout.write(entry + '\n');
  }
}

const logger = {
  debug: (component, message, meta) => log('debug', component, message, meta),
  info:  (component, message, meta) => log('info',  component, message, meta),
  warn:  (component, message, meta) => log('warn',  component, message, meta),
  /**
   * Log an error. In production, strips stack traces from the output line
   * (they are still written to stderr at full detail via the 'stack' field
   * only in development builds).
   */
  error: (component, message, err, meta = {}) => {
    const extra = { ...meta };
    if (err instanceof Error) {
      extra.errMessage = err.message;
      if (!IS_PROD) extra.stack = err.stack;
    }
    log('error', component, message, extra);

    // Stub Sentry telemetry integration for production crash reporting
    if (IS_PROD) {
      try {
        if (global.Sentry && typeof global.Sentry.captureException === 'function') {
          global.Sentry.captureException(err || new Error(message), {
            tags: { component },
            extra
          });
        }
      } catch (_) {}
    }
  },
  correlationStorage: correlationStorage
};

module.exports = logger;
