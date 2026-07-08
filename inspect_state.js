const http = require('http');
const WebSocket = require('ws');

async function main() {
  const tabs = await new Promise((res,rej)=>{
    http.get('http://localhost:9222/json', r=>{
      let b=''; r.on('data',d=>b+=d);
      r.on('end',()=>{ try{res(JSON.parse(b));}catch(e){rej(e);} });
    }).on('error', e=>{ console.log('Chrome not reachable:', e.message); process.exit(0); });
  });

  console.log('Open tabs:', tabs.map(t=>t.url+' ['+t.type+']').join('\n  '));

  const target = tabs.find(t => t.type === 'page' && (t.title?.includes('Valenixia') || t.url?.includes('localhost:3000') || t.faviconUrl?.includes('localhost:3000') || tabs.filter(x => x.type === 'page').length === 1));
  if (!target) { console.log('No page target found'); return; }
  console.log('\nConnecting to:', target.url);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ ws.once('open',res); ws.once('error',e=>{ console.log('WS error',e.message); process.exit(0); }); });

  let nId=1; const pend=new Map();
  ws.on('message',d=>{ const m=JSON.parse(d); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);} });

  const ev = (expr)=>new Promise(r=>{
    const id=nId++;
    pend.set(id,r);
    ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
  });

  const get = async (expr) => {
    const r = await ev(expr);
    return r?.result?.result?.value;
  };

  // Warmup
  await get('document.readyState');

  const results = {
    readyState: await get('document.readyState'),
    title: await get('document.title'),
    wizDisplay: await get('(function(){var el=document.getElementById("first-boot-wizard");return el?window.getComputedStyle(el).display:"MISSING";}())'),
    authDisplay: await get('(function(){var el=document.getElementById("auth-lock-screen");return el?window.getComputedStyle(el).display:"MISSING";}())'),
    authClass:   await get('(function(){var el=document.getElementById("auth-lock-screen");return el?el.className:"MISSING";}())'),
    layoutDisplay: await get('(function(){var el=document.getElementById("pos-app-layout");return el?window.getComputedStyle(el).display:"MISSING";}())'),
    layoutStyleDisplay: await get('(function(){var el=document.getElementById("pos-app-layout");return el?el.style.display:"MISSING";}())'),
    tier: await get('window.__valenixiaTier||"NOT-SET"'),
    syncWorker: await get('typeof syncWorker!=="undefined"?"ok":"missing"'),
    bodyClass: await get('document.body.className'),
    currentTheme: await get('(function(){var themes=["theme-obsidian-emerald","theme-midnight-sapphire","theme-warm-amber","theme-minimalist-chrome","theme-monochrome-ivory"];return themes.find(t=>document.body.classList.contains(t))||"none";}())'),
  };

  console.log('\n--- DOM STATE ---');
  for (const [k,v] of Object.entries(results)) {
    console.log(`  ${k.padEnd(20)}: ${v}`);
  }

  ws.close();
}

main().catch(e=>{ console.log('FATAL:', e.message); });
