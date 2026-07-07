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
      
      setTimeout(() => {
        const checkScript = `(function() {
          const results = {};
          try {
            const bottomNav = document.querySelector('.pos-bottom-nav');
            if (bottomNav) {
              const rect = bottomNav.getBoundingClientRect();
              results.bottomNav = {
                display: window.getComputedStyle(bottomNav).display,
                visibility: window.getComputedStyle(bottomNav).visibility,
                rect: { top: rect.top, bottom: rect.bottom, height: rect.height }
              };
            } else {
              results.bottomNav = 'NOT_FOUND';
            }
            results.url = window.location.href;
            results.lockoutVisible = !!document.getElementById('license-lockout-overlay');
          } catch(e) {
            results.error = e.message;
          }
          return JSON.stringify(results);
        })()`;
        ws.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { expression: checkScript, returnByValue: true } }));
      }, 1000);
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id === 2) {
        console.log('RAW_RESULT:', JSON.stringify(msg, null, 2));
        ws.close();
      }
    });
  });
});
