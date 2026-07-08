const WebSocket = require('ws');
const wsUrl = process.argv[2];
if (!wsUrl) {
  console.error('Browser WebSocket URL is required as first argument.');
  process.exit(1);
}
console.log('Connecting to:', wsUrl);
const ws = new WebSocket(wsUrl);
ws.on('open', () => {
  console.log('Connected. Creating target http://localhost:3000...');
  ws.send(JSON.stringify({
    id: 1,
    method: 'Target.createTarget',
    params: { url: 'http://localhost:3000' }
  }));
});
ws.on('message', (data) => {
  console.log('Response:', data.toString());
  process.exit(0);
});
ws.on('error', (err) => {
  console.error('WS Error:', err);
  process.exit(1);
});
setTimeout(() => {
  console.error('Timeout');
  process.exit(1);
}, 5000);
