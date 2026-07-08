const http = require('http');
const WebSocket = require('ws');

async function main() {
  const tabs = await new Promise((res)=>{
    http.get('http://localhost:9222/json', r=>{
      let b=''; r.on('data',d=>b+=d);
      r.on('end',()=>res(JSON.parse(b)));
    });
  });

  console.log('ACTIVE TABS:', tabs);
  const target = tabs.find(t=>t.type==='page' && (t.title==='Valenixia Commerce POS' || (t.url&&t.url.includes('localhost:3000'))));
  if (!target) {
    console.error('No localhost:3000 tab found!');
    process.exit(1);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r=>{ws.once('open',r);});

  let nId=1; const pend=new Map(); const events=[];
  ws.on('message',d=>{
    const m=JSON.parse(d);
    if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}
    if(m.method==='Runtime.consoleAPICalled'){
      const args=m.params.args.map(a=>a.value||a.description||'').join(' ');
      events.push({type:m.params.type, text:args});
    }
    if(m.method==='Runtime.exceptionThrown'){
      events.push({type:'EXCEPTION', text: JSON.stringify(m.params.exceptionDetails)});
    }
  });

  const send=(method,params)=>new Promise(r=>{const id=nId++;pend.set(id,r);ws.send(JSON.stringify({id,method,params}));});
  const ev=(expr)=>new Promise(r=>{
    const id=nId++;pend.set(id,r);
    ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
  });

  await send('Runtime.enable',{});
  await send('Console.enable',{});

  // Force reload and capture events
  console.log('Reloading page...');
  await send('Page.enable',{});
  await send('Page.navigate',{url:'http://localhost:3000'});
  
  // Wait for load + init to complete
  await new Promise(r=>setTimeout(r,5000));

  console.log('\n--- CONSOLE EVENTS (last 30) ---');
  const relevant = events.filter(e=>e.type==='EXCEPTION'||(e.text&&!e.text.includes('Decryption')&&!e.text.includes('decryption')));
  relevant.slice(-30).forEach(e=>console.log(`[${e.type.toUpperCase()}] ${e.text?.substring(0,200)}`));

  // Check state after reload
  const get = async(expr)=>{
    const r=await ev(expr);
    return r?.result?.result?.value;
  };

  const wizD = await get('(function(){var el=document.getElementById("first-boot-wizard");return el?window.getComputedStyle(el).display:"MISSING";}())');
  const authD = await get('(function(){var el=document.getElementById("auth-lock-screen");return el?window.getComputedStyle(el).display:"MISSING";}())');
  const layD  = await get('(function(){var el=document.getElementById("pos-app-layout");return el?window.getComputedStyle(el).display:"MISSING";}())');
  const tier  = await get('window.__valenixiaTier||"NOT-SET"');

  console.log('\n--- STATE AFTER RELOAD ---');
  console.log('  wizard:', wizD, '| auth:', authD, '| layout:', layD, '| tier:', tier);

  ws.close();
}

main().catch(e=>{console.log('ERR',e.message);});
