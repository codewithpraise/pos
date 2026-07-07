const http = require('http');
const WebSocket = require('ws');

async function main() {
  const tabs = await new Promise(res=>{
    http.get('http://localhost:9222/json', r=>{
      let b=''; r.on('data',d=>b+=d); r.on('end',()=>res(JSON.parse(b)));
    });
  });
  const target = tabs.find(t=>t.url&&t.url.includes('localhost:3000')&&t.type==='page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r=>{ws.once('open',r);});

  let nId=1; const pend=new Map();
  ws.on('message',d=>{const m=JSON.parse(d);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}});

  const ev=expr=>new Promise(r=>{
    const id=nId++;pend.set(id,r);
    ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
  });
  const get=async expr=>{const r=await ev(expr);return r?.result?.result?.value;};

  const count = await get('(async function(){try{var all=await NexovaDB.getAll("inventory_catalog"); return all?all.length:0;}catch(e){return "ERR:"+e.message;}}())');
  console.log('Catalog Count in IndexedDB:', count);

  const products = await get('(async function(){try{var all=await NexovaDB.getAll("inventory_catalog"); return all.map(p=>p.sku);}catch(e){return [];}}())');
  console.log('Catalog SKUs in IndexedDB:', products);

  ws.close();
}

main().catch(e=>console.log('ERR',e.message));
