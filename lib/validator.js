// ============================================================================
// NEXOVA POS - Zero-Dependency Input Validator
// Provides regex-based sanity checks for all sensitive API inputs
// ============================================================================

'use strict';

// ── Patterns ─────────────────────────────────────────────────────────────────

const PATTERNS = {
  // Store name: 2-80 chars, printable, no control chars
  STORE_NAME: /^[\p{L}\p{N}\p{P}\p{Zs}]{2,80}$/u,
  // Admin PIN: 4-12 digits only
  ADMIN_PIN: /^\d{4,12}$/,
  // Sync passphrase: 8-128 printable ASCII chars
  SYNC_PASSPHRASE: /^[\x20-\x7E]{8,128}$/,
  // Tax rate: 0-100, up to 2 decimal places
  TAX_RATE: /^(100(\.0{0,2})?|\d{1,2}(\.\d{1,2})?)$/,
  // UUID v4
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  // Node ID: alphanumeric + underscore/hyphen, 3-64 chars
  NODE_ID: /^[a-zA-Z0-9_-]{3,64}$/,
  // SKU: alphanumeric + dash/underscore, 1-64 chars
  SKU: /^[a-zA-Z0-9_-]{1,64}$/,
  // Phone: E.164 or Pakistani local formats
  PHONE: /^(\+92|0)[0-9]{9,10}$/,
  // Email: basic RFC-compliant
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  // Positive integer
  POS_INT: /^\d+$/,
  // val_type whitelist
  VAL_TYPE: /^(string|number|boolean|object)$/,
};

/**
 * Validate a single value against a named pattern.
 * @param {string} ruleName - one of the keys in PATTERNS
 * @param {*} value
 * @returns {{ ok: boolean, error?: string }}
 */
function validate(ruleName, value) {
  const pattern = PATTERNS[ruleName];
  if (!pattern) return { ok: false, error: `Unknown validation rule: ${ruleName}` };
  if (value === undefined || value === null) return { ok: false, error: `${ruleName}: value is required` };
  const str = String(value);
  if (!pattern.test(str)) return { ok: false, error: `${ruleName}: invalid format` };
  return { ok: true };
}

/**
 * Validate multiple fields at once.
 * @param {Record<string, { rule: string, value: * }>} fields
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateAll(fields) {
  const errors = [];
  for (const [fieldName, { rule, value }] of Object.entries(fields)) {
    const result = validate(rule, value);
    if (!result.ok) errors.push(`[${fieldName}] ${result.error}`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Strip HTML/script tags from a string to mitigate XSS in stored user content.
 * @param {string} str
 * @returns {string}
 */
function sanitizeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
}

/**
 * Middleware factory: validates req.body fields before handler runs.
 * Usage: app.post('/route', requireBody({ storeName: 'STORE_NAME' }), handler)
 * @param {Record<string, string>} schema - { bodyField: 'RULE_NAME' }
 * @returns Express middleware
 */
function requireBody(schema) {
  return (req, res, next) => {
    const fields = Object.fromEntries(
      Object.entries(schema).map(([field, rule]) => [field, { rule, value: req.body[field] }])
    );
    const { ok, errors } = validateAll(fields);
    if (!ok) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    next();
  };
}

module.exports = { validate, validateAll, sanitizeHtml, requireBody, PATTERNS };
