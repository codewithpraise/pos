module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  return res.status(200).json({
    success: true,
    name: 'Valenixia POS Cloud Node',
    version: '2.6.0',
    status: 'ONLINE',
    time: new Date().toISOString(),
    node_id: 'valenixia_cloud_primary'
  });
};
