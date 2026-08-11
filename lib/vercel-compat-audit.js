// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - VERCEL SERVERLESS COMPATIBILITY AUDITOR
// Production database authority, ephemeral filesystem isolation, and secrets audit
// ============================================================================

/**
 * Data Authority Matrix for Vercel Serverless Production Deployment
 */
const VERCEL_DATA_AUTHORITY_MATRIX = {
  accounts: { cloudAuthority: 'Supabase Postgres', localClient: 'Encrypted IndexedDB', serverlessSafe: true },
  organizations: { cloudAuthority: 'Supabase Postgres', localClient: 'Local SQLite Cache', serverlessSafe: true },
  branches: { cloudAuthority: 'Supabase Postgres', localClient: 'Local SQLite', serverlessSafe: true },
  approved_devices: { cloudAuthority: 'Supabase Postgres', localClient: 'Local SQLite', serverlessSafe: true },
  inventory_catalog: { cloudAuthority: 'Supabase Postgres', localClient: 'Local SQLite', serverlessSafe: true },
  transactions: { cloudAuthority: 'Supabase Postgres', localClient: 'Local SQLite', serverlessSafe: true },
  sync_outbox: { cloudAuthority: 'Supabase Postgres', localClient: 'Local SQLite', serverlessSafe: true },
  fbr_submissions: { cloudAuthority: 'Supabase Postgres', localClient: 'Local SQLite Queue', serverlessSafe: true },
  subscriptions: { cloudAuthority: 'Supabase Postgres', localClient: 'Serverless Entitlement API', serverlessSafe: true },
  organization_addons: { cloudAuthority: 'Supabase Postgres', localClient: 'Serverless Entitlement API', serverlessSafe: true },
  payment_claims: { cloudAuthority: 'Supabase Postgres', localClient: 'Serverless API Cache', serverlessSafe: true },
  audit_logs: { cloudAuthority: 'Supabase Postgres', localClient: 'Local SQLite', serverlessSafe: true }
};

/**
 * Audit Environment Secrets for Client Leakage
 */
function auditEnvironmentSecrets(clientPayload = {}) {
  const SERVER_ONLY_SECRETS = [
    'VALENIXIA_ADMIN_BOOTSTRAP_SECRET',
    'SERVER_MASTER_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'DB_ENCRYPTION_KEY',
    'GOOGLE_CLIENT_SECRET'
  ];

  const leakedSecrets = [];
  const payloadStr = JSON.stringify(clientPayload);

  for (const secretKey of SERVER_ONLY_SECRETS) {
    const secretVal = process.env[secretKey];
    if (secretVal && secretVal.length > 5 && payloadStr.includes(secretVal)) {
      leakedSecrets.push(secretKey);
    }
  }

  return {
    isClean: leakedSecrets.length === 0,
    leakedSecrets
  };
}

module.exports = {
  VERCEL_DATA_AUTHORITY_MATRIX,
  auditEnvironmentSecrets
};
