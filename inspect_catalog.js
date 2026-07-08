const http = require('http');
const WebSocket = require('ws');

async function main() {
  const tabs = await new Promise(res=>{
    http.get('http://localhost:9222/json', r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>res(JSON.parse(b)));});
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

  // Navigate to catalog-manager screen
  await get('(function(){var el=document.querySelector(".nav-item[data-screen=\'catalog-manager\']");if(el)el.click();}())');
  await new Promise(r=>setTimeout(r,600));

  // Check what catalog containers exist
  const containers = await get('JSON.stringify(Array.from(document.querySelectorAll("[id*=catalog]")).map(el=>({id:el.id,class:el.className.substring(0,50),children:el.children.length,html:el.innerHTML.substring(0,100)})))');
  console.log('Catalog containers:', containers);

  // Check quick catalog
  const quickCatalog = await get('JSON.stringify(Array.from(document.querySelectorAll("[id*=quick],[class*=quick]")).map(el=>({id:el.id,class:el.className.substring(0,50),children:el.children.length})))');
  console.log('Quick catalog containers:', quickCatalog);

  // Check how many products are in local catalog state
  const catalogCount = await get('(async function(){try{var all=await ValenixiaDB.getAll("catalog"); return all?all.length:0;}catch(e){return "ERR:"+e.message;}}())');
  console.log('Catalog count in IndexedDB:', catalogCount);

  // Check worker state
  const workerCatalog = await get('typeof state !== "undefined" && state.catalog ? state.catalog.length : "state not accessible"');
  console.log('Worker catalog in state:', workerCatalog);

  ws.close();
}

main().catch(e=>console.log('ERR',e.message));
