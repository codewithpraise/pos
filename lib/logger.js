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
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    component,
    message,
    correlationId,
    ...meta
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
