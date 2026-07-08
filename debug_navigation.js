const http = require('http');
const WebSocket = require('ws');

async function main() {
  const tabs = await new Promise((res,rej)=>{
    http.get('http://localhost:9222/json', r=>{
      let b=''; r.on('data',d=>b+=d);
      r.on('end',()=>{ try{res(JSON.parse(b));}catch(e){rej(e);} });
    }).on('error',rej);
  });
  const t = tabs.find(x => x.url && x.url.includes('localhost:3000') && x.type === 'page');
  if(!t) { console.log('No page target found'); return; }

  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.once('open', r));

  let nId=1;
  const send = (method, params={}) => new Promise(r => {
    const id=nId++;
    ws.send(JSON.stringify({id, method, params}));
    ws.once('message', d => {
      const m = JSON.parse(d);
      if(m.id === id) r(m);
    });
  });

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', {expression: expr, returnByValue: true, awaitPromise: true});
    return r.result?.result?.value;
  };

  // Test set background vs backgroundColor
  await ev('switchActiveScreen("analytics");');
  await new Promise(r => setTimeout(r, 100));

  await ev('document.getElementById("range-btn-week").style.background = "var(--accent-emerald)";');
  const bgComputed = await ev('window.getComputedStyle(document.getElementById("range-btn-week")).backgroundColor');

  await ev('document.getElementById("range-btn-week").style.backgroundColor = "var(--accent-emerald)";');
  const bgColorComputed = await ev('window.getComputedStyle(document.getElementById("range-btn-week")).backgroundColor');

  console.log('--- COLOR TEST RESULTS ---');
  console.log('Using style.background:', bgComputed);
  console.log('Using style.backgroundColor:', bgColorComputed);

  ws.close();
}

main().catch(console.error);
