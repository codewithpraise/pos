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
window.__valenixiaLogs = [];

function drawCrashConsole(msg, source, lineno, error) {
    let consoleDiv = document.getElementById('valenixia-crash-console');
    if (!consoleDiv) {
        consoleDiv = document.createElement('div');
        consoleDiv.id = 'valenixia-crash-console';
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
    window.__valenixiaLogs.push(logStr);
    console.error(logStr, error);
    
    // Ignore cross-origin script errors or network load failures
    const lowerMsg = String(msg || '').toLowerCase();
    if (lowerMsg.includes('script error') || lowerMsg.includes('load failed') || lowerMsg.includes('failed to fetch')) {
        return false;
    }
    
    drawCrashConsole(msg, url, lineNo, error);
    return false; 
};

// 2. Catch all asynchronous Promise failures (like failed fetch calls)
window.addEventListener('unhandledrejection', function(event) {
    const reason = event.reason;
    const msg = reason ? (reason.message || String(reason)) : 'Unknown';
    const lowerMsg = String(msg).toLowerCase();
    
    // Ignore expected network / fetch connectivity errors from triggering the crash console
    if (lowerMsg.includes('failed to fetch') || lowerMsg.includes('networkerror') || lowerMsg.includes('load failed') || lowerMsg.includes('network') || lowerMsg.includes('fetch')) {
        console.warn('[Bootstrap] Ignored network rejection:', msg);
        return;
    }
    
    window.__valenixiaLogs.push('Unhandled Promise: ' + msg);
    console.error('Unhandled Promise:', reason);
    drawCrashConsole(msg, 'Async Promise', 'N/A', reason);
});

(function() {
  function resolveServerUrl() {
    if (window.AndroidPOS && typeof window.AndroidPOS.getServerUrl === 'function') {
      const nativeUrl = window.AndroidPOS.getServerUrl();
      if (nativeUrl && nativeUrl.trim() && !nativeUrl.startsWith('file:')) {
        return nativeUrl.trim();
      }
    }
    const localUrl = localStorage.getItem('valenixia_server_url');
    if (localUrl && localUrl.trim()) {
      return localUrl.trim();
    }
    if (window.location.protocol !== 'file:') {
      return window.location.origin;
    }
    return 'http://localhost:3000';
  }
  window.__valenixiaServerUrl = resolveServerUrl();
  console.log('[Bootstrap] Resolved backend server URL:', window.__valenixiaServerUrl);
})();

// ── System Theme Detection (runs before first paint to prevent FOUC) ────────
(function() {
  const ALL_THEMES = [
    'theme-obsidian-emerald',
    'theme-midnight-sapphire',
    'theme-warm-amber',
    'theme-minimalist-chrome',
    'theme-monochrome-ivory',
    'theme-premium-navy'
  ];

  // 1. Try saved preference (fastest path for returning users)
  const saved = localStorage.getItem('valenixia_theme_override');
  if (saved && ALL_THEMES.includes(saved)) {
    document.documentElement.classList.add(saved);
    document.documentElement.dataset.themeResolved = saved;
    return;
  }

  // 2. Fall back to OS preference
  //    Light OS  → Monochrome Ivory (clean light mode)
  //    Dark OS   → Obsidian Emerald (default dark — jewel-tone precision)
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const systemTheme = prefersDark ? 'theme-obsidian-emerald' : 'theme-monochrome-ivory';
  document.documentElement.classList.add(systemTheme);
  document.documentElement.dataset.themeResolved = systemTheme;
  window.__valenixiaSystemTheme = systemTheme;

  // 3. Watch for OS theme changes at runtime (e.g., macOS auto dark/light)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    // Only react if the user has never manually set a theme preference
    if (localStorage.getItem('valenixia_theme_override')) return;
    const next = e.matches ? 'theme-obsidian-emerald' : 'theme-monochrome-ivory';
    ALL_THEMES.forEach(t => document.body.classList.remove(t));
    document.body.classList.add(next);
    window.__valenixiaSystemTheme = next;
    console.log('[Theme] OS theme changed, switching to:', next);
  });
})();
