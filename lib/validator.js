// ============================================================================
// VALENIXIA POS - Input Validator with Zod
// Provides strict type and structure validation for all sensitive API inputs
// ============================================================================

'use strict';

const { z } = require('zod');

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
  // Transaction ID: tx_* or no_sale_* formats (alphanumeric/dash/underscore, 3-64 chars)
  TX_ID: /^[a-zA-Z0-9_-]{3,64}$/,
  // License key: alphanumeric/dash/underscore, 3-64 chars
  LICENSE_KEY: /^[a-zA-Z0-9_-]{3,64}$/,
};

const SCHEMAS = {
  STORE_NAME: z.string().min(2).max(80),
  ADMIN_PIN: z.string().regex(/^\d{4,12}$/),
  SYNC_PASSPHRASE: z.string().min(8).max(128).regex(/^[\x20-\x7E]*$/),
  TAX_RATE: z.union([
    z.number().min(0).max(100),
    z.string().regex(/^(100(\.0{0,2})?|\d{1,2}(\.\d{1,2})?)$/)
  ]),
  UUID: z.string().uuid(),
  NODE_ID: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  SKU: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  PHONE: z.string().regex(/^(\+92|0)[0-9]{9,10}$/),
  EMAIL: z.string().email(),
  POS_INT: z.union([
    z.number().int().nonnegative(),
    z.string().regex(/^\d+$/)
  ]),
  VAL_TYPE: z.enum(['string', 'number', 'boolean', 'object']),
  TX_ID: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  LICENSE_KEY: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_-]+$/),
};

/**
 * Validate a single value against a named pattern.
 * @param {string} ruleName - one of the keys in PATTERNS
 * @param {*} value
 * @returns {{ ok: boolean, error?: string }}
 */
function validate(ruleName, value) {
  const schema = SCHEMAS[ruleName];
  if (!schema) return { ok: false, error: `Unknown validation rule: ${ruleName}` };
  if (value === undefined || value === null) return { ok: false, error: `${ruleName}: value is required` };
  
  const result = schema.safeParse(value);
  if (!result.success) {
    return { ok: false, error: `${ruleName}: ${result.error.issues[0].message}` };
  }
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
