// Gated console logging for production hardening (ADR-005)
(function() {
  const isLocal = window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1' || 
                  window.location.hostname === '10.0.2.2' ||
                  localStorage.getItem('valenixia_debug') === 'true';
  
  if (!isLocal) {
    const noop = () => {};
    console.log = noop;
    console.warn = noop;
    console.info = noop;
    console.error = noop;
  }
})();

window.escapeHTML = function(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

// UNIVERSAL BASE64-URL DECODER
window.safeAtob = function(base64Str) {
    try {
        // Replace URL-safe characters with standard Base64 characters
        let str = String(base64Str).replace(/-/g, '+').replace(/_/g, '/');
        // Pad the string with '=' until its length is a multiple of 4
        while (str.length % 4 !== 0) str += '=';
        return atob(str);
    } catch (e) {
        // Redacted for production security (leaks strings in console)
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || localStorage.getItem('valenixia_debug') === 'true') {
            console.error('[safeAtob] CRITICAL DECODE FAILURE:', e.message);
            console.error('[safeAtob] Problematic String:', base64Str);
        }
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
    logEntry.innerHTML = `<strong>[CRASH]</strong> ${escapeHTML(msg)}<br><span style="color:#888;">File: ${escapeHTML(source)} (Line: ${escapeHTML(lineno)})</span><br><span style="color:#ffa500;">${error ? escapeHTML(error.stack) : 'No stack trace'}</span>`;
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
    throw new Error('server_url not configured');
  }
  try {
    window.__valenixiaServerUrl = resolveServerUrl();
    console.log('[Bootstrap] Resolved backend server URL:', window.__valenixiaServerUrl);
  } catch (err) {
    console.error('[Bootstrap] URL Resolution Error:', err.message);
    window.__valenixiaServerUrl = '';
  }
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

// --- GLOBAL showModal HELPER ---
window.showModal = function({ title, message, type = 'info', actions = [{ id: 'ok', label: 'OK', style: 'primary' }], input = null }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:999999999;display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(4px);font-family:sans-serif;';
    let inputHtml = '';
    if (input) {
      inputHtml = '<input id="__modal-input" type="' + escapeHTML(input.type || 'text') + '" placeholder="' + escapeHTML(input.placeholder || '') + '" value="' + escapeHTML(input.defaultValue || '') + '" style="width:100%;margin-top:16px;padding:12px;background:#1a1a1a;border:1px solid rgba(255,255,255,0.1);color:#fff;border-radius:6px;outline:none;font-size:14px;" />';
    }
    const buttonsHtml = actions.map(act => {
      const bg = act.style === 'danger' ? '#ef4444' : (act.style === 'primary' ? '#10b981' : 'transparent');
      const border = act.style === 'secondary' ? '1px solid rgba(255,255,255,0.15)' : 'none';
      const color = act.style === 'secondary' ? '#9ca3af' : '#fff';
      return '<button data-id="' + escapeHTML(act.id) + '" style="flex:1;padding:12px;background:' + bg + ';border:' + border + ';color:' + color + ';font-weight:700;border-radius:6px;cursor:pointer;font-size:13px;font-family:inherit;">' + escapeHTML(act.label) + '</button>';
    }).join('');
    overlay.innerHTML = '<div style="background:#0f0f11;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;max-width:400px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,0.5);"><h3 style="color:#fff;font-size:16px;font-weight:800;margin-bottom:10px;font-family:inherit;">' + escapeHTML(title) + '</h3><p style="color:#9ca3af;font-size:13px;line-height:1.6;white-space:pre-wrap;margin:0;font-family:inherit;">' + escapeHTML(message) + '</p>' + inputHtml + '<div style="display:flex;gap:12px;margin-top:24px;">' + buttonsHtml + '</div></div>';
    document.body.appendChild(overlay);
    if (input) {
      setTimeout(() => document.getElementById('__modal-input')?.focus(), 50);
    }
    overlay.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = input ? document.getElementById('__modal-input').value : btn.dataset.id;
        overlay.remove();
        resolve(val || btn.dataset.id);
      });
    });
  });
};

// Global click interceptor to prevent tabnabbing vulnerability
document.addEventListener('click', function(e) {
  const target = e.target.closest('a');
  if (target && target.getAttribute('target') === '_blank') {
    const rel = target.getAttribute('rel');
    if (!rel || !rel.includes('noopener') || !rel.includes('noreferrer')) {
      target.setAttribute('rel', 'noopener noreferrer');
    }
  }
}, true);
