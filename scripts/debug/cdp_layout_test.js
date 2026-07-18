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
      ws.send(JSON.stringify({ id: 1, method: 'Emulation.setDeviceMetricsOverride', params: {
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        mobile: true
      }}));
      ws.send(JSON.stringify({ id: 2, method: 'Page.reload', params: {} }));
      
      setTimeout(() => {
        const checkScript = `(() => {
          const results = {};
          const bottomNav = document.querySelector('.pos-bottom-nav');
          if (bottomNav) {
            const rect = bottomNav.getBoundingClientRect();
            results.bottomNav = {
              display: window.getComputedStyle(bottomNav).display,
              visibility: window.getComputedStyle(bottomNav).visibility,
              rect: { top: rect.top, bottom: rect.bottom, height: rect.height, left: rect.left, right: rect.right }
            };
          }
          const sidebar = document.querySelector('.pos-sidebar');
          if (sidebar) {
            results.sidebar = {
              display: window.getComputedStyle(sidebar).display
            };
          }
          const body = document.body;
          results.body = {
            width: body.clientWidth,
            height: body.clientHeight,
            overflow: window.getComputedStyle(body).overflow
          };
          return JSON.stringify(results);
        })()`;
        ws.send(JSON.stringify({ id: 3, method: 'Runtime.evaluate', params: { expression: checkScript, returnByValue: true } }));
      }, 3000);
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id === 3) {
        console.log('LAYOUT_RESULT:', msg.result.result.value);
        ws.close();
      }
    });
  });
});
