// UNIVERSAL BASE64-URL DECODER
window.safeAtob = function(base64Str) {
    try {
        // Replace URL-safe characters with standard Base64 characters
        let str = String(base64Str).replace(/-/g, '+').replace(/_/g, '/');
        // Pad the string with '=' until its length is a multiple of 4
        while (str.length % 4 !== 0) str += '=';
        return atob(str);
    } catch (e) {
        console.error('[safeAtob] CRITICAL DECODE FAILURE:', e.message);
        console.error('[safeAtob] Problematic String:', base64Str);
        if (typeof drawCrashConsole === 'function') {
            drawCrashConsole('Base64 Decode Failure', 'safeAtob', 'Global', e);
        }
        throw e;
    }
};

// BLACK BOX FLIGHT RECORDER
window.__nexovaLogs = [];

function drawCrashConsole(msg, source, lineno, error) {
    let consoleDiv = document.getElementById('nexova-crash-console');
    if (!consoleDiv) {
        consoleDiv = document.createElement('div');
        consoleDiv.id = 'nexova-crash-console';
        consoleDiv.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:50vh; background:rgba(0,0,0,0.95); color:#ff4444; z-index:999999999; overflow-y:auto; padding:20px; font-family:monospace; font-size:14px; border-bottom: 3px solid #ff0000;';
        
        // Add a close button
        const closeBtn = document.createElement('button');
        closeBtn.innerText = 'DISMISS LOGS (X)';
        closeBtn.style.cssText = 'background:#ff4444; color:#fff; padding:10px; border:none; margin-bottom:15px; font-weight:bold; width:100%;';
        closeBtn.onclick = () => consoleDiv.style.display = 'none';
        consoleDiv.appendChild(closeBtn);
        
        document.body.appendChild(consoleDiv);
    }
    
    consoleDiv.style.display = 'block';
    const logEntry = document.createElement('div');
    logEntry.style.marginBottom = '10px';
    logEntry.style.borderBottom = '1px solid #333';
    logEntry.style.paddingBottom = '5px';
    logEntry.innerHTML = `<strong>[CRASH]</strong> ${msg}<br><span style="color:#888;">File: ${source} (Line: ${lineno})</span><br><span style="color:#ffa500;">${error ? error.stack : 'No stack trace'}</span>`;
    consoleDiv.appendChild(logEntry);
}
window.drawCrashConsole = drawCrashConsole;

// 1. Catch all standard JavaScript runtime errors
window.onerror = function(msg, url, lineNo, columnNo, error) {
    const logStr = `Error: ${msg} at ${lineNo}:${columnNo}`;
    window.__nexovaLogs.push(logStr);
    console.error(logStr, error);
    drawCrashConsole(msg, url, lineNo, error);
    return false; 
};

// 2. Catch all asynchronous Promise failures (like failed fetch calls)
window.addEventListener('unhandledrejection', function(event) {
    const msg = 'Unhandled Promise: ' + (event.reason ? event.reason.message : 'Unknown');
    window.__nexovaLogs.push(msg);
    console.error(msg, event.reason);
    drawCrashConsole(msg, 'Async Promise', 'N/A', event.reason);
});

(function() {
  function resolveServerUrl() {
    if (window.AndroidPOS && typeof window.AndroidPOS.getServerUrl === 'function') {
      const nativeUrl = window.AndroidPOS.getServerUrl();
      if (nativeUrl && nativeUrl.trim() && !nativeUrl.startsWith('file:')) {
        return nativeUrl.trim();
      }
    }
    const localUrl = localStorage.getItem('nexova_server_url');
    if (localUrl && localUrl.trim()) {
      return localUrl.trim();
    }
    if (window.location.protocol !== 'file:') {
      return window.location.origin;
    }
    return 'http://localhost:3000';
  }
  window.__nexovaServerUrl = resolveServerUrl();
  console.log('[Bootstrap] Resolved backend server URL:', window.__nexovaServerUrl);
})();
