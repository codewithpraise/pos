module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  return res.status(200).json({
    success: true,
    status: 'APPROVED',
    tier: 'ENTERPRISE',
    features: {
      multi_store: true,
      unlimited_terminals: true,
      cloud_sync: true,
      analytics_custom_range: true,
      khata_ledger: true
    }
  });
};
