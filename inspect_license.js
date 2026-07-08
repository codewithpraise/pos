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

  const send=(method,params)=>new Promise(r=>{const id=nId++;pend.set(id,r);ws.send(JSON.stringify({id,method,params}));});
  const ev=expr=>new Promise(r=>{
    const id=nId++;pend.set(id,r);
    ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true,awaitPromise:true}}));
  });

  const get=async expr=>{const r=await ev(expr);return r?.result?.result?.value;};

  await send('Runtime.enable',{});

  // Check license data in localStorage
  const licToken = await get('localStorage.getItem("valenixia_license_token")');
  const onboarding = await get('localStorage.getItem("onboarding_complete")');
  const hydrated = await get('localStorage.getItem("database_hydrated")');
  const serverUrl = await get('localStorage.getItem("valenixia_server_url")||"none"');
  
  console.log('=== LOCALSTORAGE STATE ===');
  console.log('license_token:', licToken ? licToken.substring(0,80)+'...' : 'NOT SET');
  console.log('onboarding_complete:', onboarding);
  console.log('database_hydrated:', hydrated);
  console.log('server_url:', serverUrl);
  
  // Check if license lockout overlay is in DOM
  const lockoutOverlay = await get('!!document.getElementById("license-lockout-overlay")');
  const lockoutDisplay = await get('(function(){var el=document.getElementById("license-lockout-overlay");return el?window.getComputedStyle(el).display:"absent";}())');
  console.log('\n=== OVERLAYS ===');
  console.log('license-lockout-overlay exists:', lockoutOverlay, 'display:', lockoutDisplay);
  
  // Check pending payment overlay
  const pendingOverlay = await get('!!document.getElementById("license-pending-overlay")');
  console.log('license-pending-overlay exists:', pendingOverlay);

  // Check clock tamper overlay
  const clockOverlay = await get('!!document.getElementById("clock-tamper-overlay")');
  console.log('clock-tamper-overlay exists:', clockOverlay);

  // Check if there are any fixed overlays blocking content  
  const fixedElements = await get('JSON.stringify(Array.from(document.querySelectorAll("[style*=\\"z-index: 999\\"],[style*=\\"z-index:999\\"]")).map(el=>({id:el.id,class:el.className.substring(0,40),display:el.style.display})))');
  console.log('\nFixed high-z elements:', fixedElements);

  // Run license init manually to see what happens
  console.log('\n=== MANUAL LICENSE DEBUG ===');
  const debugResult = await get(`(async function(){
    try {
      var stored = localStorage.getItem("valenixia_license_token");
      var isSecureCtx = !!(crypto && crypto.subtle);
      var isLocalhost = location.hostname==="localhost"||location.hostname==="127.0.0.1";
      var isHttpCtx = !isSecureCtx || (location.protocol==="http:"&&!isLocalhost);
      return JSON.stringify({
        hasToken: !!stored,
        tokenStart: stored?stored.substring(0,40):"none",
        isSecureContext: isSecureCtx,
        isLocalhost: isLocalhost,
        isHttpContext: isHttpCtx,
        protocol: location.protocol,
        hostname: location.hostname
      });
    } catch(e) { return "ERR:"+e.message; }
  })()`);
  console.log('License debug:', debugResult);
  
  ws.close();
}

main().catch(e=>console.log('ERR',e.message));
