const WebSocket = require('ws');
const http = require('http');

http.get('http://localhost:9222/json', (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    const pages = JSON.parse(data);
    const page = pages.find(p => p.url && p.url.includes('localhost:3000') && p.type === 'page');
    if (!page) { console.log('NO_PAGE'); process.exit(1); }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    
    ws.on('open', async () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable', params: {} }));
      ws.send(JSON.stringify({ id: 2, method: 'Log.enable', params: {} }));
      
      const checkScript = `(() => {
        const errorEl = document.getElementById('auth-error');
        return JSON.stringify({
          errorText: errorEl ? errorEl.textContent : 'NO_ERROR_EL',
          pinLength: typeof state !== 'undefined' ? state.currentPin.length : 'state_undefined',
          activeCashier: typeof state !== 'undefined' ? state.activeCashier : 'state_undefined',
          terminalRole: typeof state !== 'undefined' ? state.terminalRole : 'state_undefined'
        });
      })()`;
      ws.send(JSON.stringify({ id: 3, method: 'Runtime.evaluate', params: { expression: checkScript, returnByValue: true } }));
    });
    
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.method === 'Log.entryAdded') {
        console.log('CONSOLE_LOG:', JSON.stringify(msg.params.entry));
      }
      if (msg.id === 3) {
        console.log('EVAL_RESULT:', msg.result.result.value);
        setTimeout(() => { ws.close(); }, 1000);
      }
    });
  });
});
