const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function cdpReq(ws, method, params, id) {
  return new Promise((resolve) => {
    const to = setTimeout(() => resolve({ error: 'TIMEOUT' }), 10000);
    const h = (d) => {
      try {
        const m = JSON.parse(d.toString());
        if (m.id === id) {
          clearTimeout(to);
          ws.off('message', h);
          resolve(m);
        }
      } catch(e) {}
    };
    ws.on('message', h);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

async function runVisualRegressionCheck() {
  console.log('[Visual Tests] Fetching Chrome targets...');
  
  const tabList = await new Promise((res, rej) => {
    http.get('http://localhost:9222/json', r => {
      let b = ''; 
      r.on('data', d => b += d);
      r.on('end', () => { 
        try { 
          res(JSON.parse(b)); 
        } catch(e) { 
          rej(e); 
        } 
      });
    }).on('error', e => { 
      console.error('❌ Failed to fetch Chrome DevTools endpoints. Verify Chrome is running on port 9222.');
      process.exit(1); 
    });
  });

  const target = tabList.find(t => t.url?.includes('localhost:3000') && t.type === 'page');
  if (!target) {
    console.error('❌ Target page (localhost:3000) not found in Chrome tabs.');
    process.exit(1);
  }

  console.log('[Visual Tests] Connecting to debugger at:', target.webSocketDebuggerUrl);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

  let id = 3000;
  
  // Enable Page module
  await cdpReq(ws, 'Page.enable', {}, id++);

  // Ensure output baseline folder exists
  const outputDir = path.join(__dirname, 'docs', 'images', 'visual-baselines');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const themes = [
    'theme-obsidian-emerald',
    'theme-midnight-sapphire',
    'theme-warm-amber',
    'theme-minimalist-chrome',
    'theme-monochrome-ivory',
    'theme-premium-navy'
  ];

  console.log('[Visual Tests] Beginning visual baseline captures...');

  for (const theme of themes) {
    console.log(`[Visual Tests] Testing theme: ${theme}`);
    
    // Evaluate script to swap theme on document body
    const script = `(function() {
      const body = document.body;
      const list = ${JSON.stringify(themes)};
      list.forEach(t => body.classList.remove(t));
      body.classList.add('${theme}');
      return document.body.className;
    })()`;

    await cdpReq(ws, 'Runtime.evaluate', { expression: script, returnByValue: true }, id++);
    
    // Allow animation/transition to settle
    await sleep(800);

    // Capture screenshot
    const shot = await cdpReq(ws, 'Page.captureScreenshot', { format: 'png', quality: 90 }, id++);
    
    if (shot.result && shot.result.data) {
      const buffer = Buffer.from(shot.result.data, 'base64');
      const filename = path.join(outputDir, `${theme}.png`);
      fs.writeFileSync(filename, buffer);
      console.log(`✅ Saved screenshot to: ${filename} (${buffer.length} bytes)`);
    } else {
      console.error(`❌ Failed to capture screenshot for theme: ${theme}`);
    }
  }

  ws.close();
  console.log('[Visual Tests] Visual regression run complete.');
}

runVisualRegressionCheck().catch(err => {
  console.error('[Visual Tests Fatal Error]', err);
  process.exit(1);
});
