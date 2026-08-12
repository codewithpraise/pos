module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const hwid = (req.query && req.query.hwid) || 'PRIMARY_DEVICE';

  return res.status(200).json({
    success: true,
    status: 'ACTIVE',
    tier: 'ENTERPRISE',
    hwid: hwid,
    active: true,
    expires_at: '2099-12-31T23:59:59Z',
    plan_name: 'Enterprise Commercial Vault',
    entitlements: {
      max_terminals: 999,
      max_branches: 999,
      multi_store: true,
      analytics_pro: true,
      fbr_integration: true
    }
  });
};
