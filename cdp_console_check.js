const WebSocket = require('ws');
const http = require('http');

function devToolsRequest(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 9223,
      path: path,
      method: method
    }, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve(b));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('Fetching active tabs from port 9223...');
  const tabsRes = await devToolsRequest('/json');
  const tabs = JSON.parse(tabsRes);
  
  const target = tabs.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
  if (!target) {
    console.error('No localhost:3000 page found! Active pages:', tabs.map(t => `${t.title} (${t.url})`));
    process.exit(1);
  }
  
  console.log('Connecting to target:', target.title, target.url);
  const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
  
  let id = 1;
  const send = (method, params = {}) => {
    const msgId = id++;
    ws.send(JSON.stringify({ id: msgId, method, params }));
    return msgId;
  };
  
  ws.on('open', () => {
    console.log('WebSocket open!');
    send('Runtime.enable');
    
    setTimeout(() => {
      console.log('Evaluating boot loader status...');
      send('Runtime.evaluate', { expression: `document.getElementById('app-boot-loader-status')?.textContent`, returnByValue: true });
      
      console.log('Evaluating ValenixiaDB status...');
      send('Runtime.evaluate', { expression: `window.ValenixiaDB ? (window.ValenixiaDB.db ? "db-ok" : "db-null") : "no-valenixiadb"`, returnByValue: true });
      
      console.log('Evaluating appInitialized...');
      send('Runtime.evaluate', { expression: `window.appInitialized`, returnByValue: true });
    }, 1000);
  });
  
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id) {
      console.log(`Response ID ${msg.id}:`, JSON.stringify(msg.result || msg.error || msg));
    } else {
      console.log('Event:', msg.method, JSON.stringify(msg.params));
    }
  });
  
  setTimeout(() => {
    console.log('Timeout. Exiting.');
    ws.close();
    process.exit(0);
  }, 6000);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
