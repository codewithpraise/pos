// Gated console logging for production hardening (ADR-005) — FIXED FOR MOBILE DIAGNOSTICS
(function() {
  const isLocal = window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1' || 
                  window.location.hostname === '10.0.2.2' ||
                  localStorage.getItem('valenixia_debug') === 'true';
  window.__valenixiaIsLocal = isLocal;
  
  // MOBILE FIX #16: Never silence console on mobile; pipe to diagnostic hub instead
  window.__valenixiaLogs = window.__valenixiaLogs || [];
  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origErr = console.error.bind(console);
  const origInfo = console.info.bind(console);

  console.log = (...args) => {
    window.__valenixiaLogs.push({t:'log', ts:Date.now(), msg:args.map(a=>String(a)).join(' ')});
    origLog(...args);
  };
  console.warn = (...args) => {
    window.__valenixiaLogs.push({t:'warn', ts:Date.now(), msg:args.map(a=>String(a)).join(' ')});
    origWarn(...args);
  };
  console.error = (...args) => {
    window.__valenixiaLogs.push({t:'error', ts:Date.now(), msg:args.map(a=>String(a)).join(' ')});
    origErr(...args);
  };
  console.info = (...args) => {
    window.__valenixiaLogs.push({t:'info', ts:Date.now(), msg:args.map(a=>String(a)).join(' ')});
    origInfo(...args);
  };
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

window.safeAtob = function(base64Str) {
    try {
        let str = String(base64Str).replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4 !== 0) str += '=';
        return atob(str);
    } catch (e) {
        if (window.__valenixiaIsLocal) {
            console.error('[safeAtob] CRITICAL DECODE FAILURE:', e.message);
            console.error('[safeAtob] Problematic String:', base64Str);
        }
        if (typeof drawCrashConsole === 'function') {
            drawCrashConsole('Base64 Decode Failure', 'safeAtob', 'Global', e);
        }
        throw e;
    }
};

// MOBILE DIAGNOSTIC HUB — FIX #3
window.__valenixiaLogs = window.__valenixiaLogs || [];
window.__valenixiaClickPath = [];

window.logDiagnostic = function(type, data) {
  const entry = {
    ts: Date.now(),
    type: type,
    data: data,
    ua: navigator.userAgent,
    url: location.href
  };
  window.__valenixiaLogs.push(entry);
};

// Capture click path for crash reconstruction
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action], [data-screen], [data-view], button, a');
  if (el) {
    window.__valenixiaClickPath.push({
      ts: Date.now(),
      tag: el.tagName,
      id: el.id,
      action: el.dataset.action || el.dataset.screen || el.dataset.view || el.textContent.slice(0,40)
    });
    if (window.__valenixiaClickPath.length > 50) window.__valenixiaClickPath.shift();
  }
}, true);

function drawCrashConsole(msg, source, lineno, error) {
    let consoleDiv = document.getElementById('valenixia-crash-console');
    if (!consoleDiv) {
        consoleDiv = document.createElement('div');
        consoleDiv.id = 'valenixia-crash-console';
        consoleDiv.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:50vh; background:rgba(0,0,0,0.95); color:#ff4444; z-index:999999999; overflow-y:auto; padding:20px; font-family:monospace; font-size:14px; border-bottom: 3px solid #ff0000;';
        
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

// Global error handlers
window.addEventListener('error', (e) => {
  window.logDiagnostic('JS_ERROR', {
    msg: e.message,
    file: e.filename,
    line: e.lineno,
    stack: e.error ? e.error.stack : ''
  });
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  const msg = reason ? (reason.message || String(reason)) : 'Unknown';
  const lowerMsg = String(msg).toLowerCase();
  
  if (lowerMsg.includes('failed to fetch') || lowerMsg.includes('networkerror') || lowerMsg.includes('load failed')) {
    return;
  }
  window.logDiagnostic('PROMISE_REJECTION', {
    reason: String(reason),
    stack: reason && reason.stack ? reason.stack : ''
  });
});

// Copy diagnostics to clipboard
window.copyDiagnostics = async function() {
  const payload = {
    logs: window.__valenixiaLogs.slice(-500),
    clicks: window.__valenixiaClickPath,
    timestamp: new Date().toISOString(),
    screen: {w: window.innerWidth, h: window.innerHeight},
    storage: {
      idb: !!window.indexedDB,
      localStorage: !!window.localStorage
    }
  };
  const text = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    alert('Diagnostics copied to clipboard.');
  } catch(e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    alert('Diagnostics copied.');
  }
};
window.copyAllDiagnosticLogs = window.copyDiagnostics;

// SPLASH SCREEN TIMEOUT — FIX #18
(function splashTimeout() {
  const hideSplash = () => {
    const splash = document.getElementById('splash-screen') || document.getElementById('app-boot-loader');
    if (splash) {
      splash.style.opacity = '0';
      splash.style.transition = 'opacity 0.5s ease';
      splash.style.pointerEvents = 'none';
      setTimeout(() => {
        splash.style.display = 'none';
        document.body.classList.remove('splash-active');
        console.log('[Bootstrap] Splash screen hidden.');
      }, 500);
    }
  };
  
  // Failsafe: force hide splash after 5 seconds regardless of init state
  setTimeout(hideSplash, 5000);
})();

// OFFLINE HYDRATION FALLBACK — FIX #17
(async function offlineHydration() {
  if (!window.indexedDB) return;
  try {
    const dbReq = indexedDB.open('valenixia_main', 1);
    dbReq.onupgradeneeded = (e) => {
      const db = e.target.result;
      // Create baseline stores if they don't exist
      const stores = ['transactions','line_items','inventory_catalog','crsql_changes',
                      'local_preferences','customers','categories','distributors',
                      'purchase_orders','po_line_items','distributor_payments',
                      'customer_credit','employees','speech_analytics_logs',
                      'stock_movements','employee_shifts','fbr_offline_queue',
                      'telemetry_logs','payment_proofs'];
      stores.forEach(s => {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, {keyPath: 'id'});
      });
      console.log('[Bootstrap] Offline hydration: baseline schema created.');
    };
    dbReq.onsuccess = () => {
      const db = dbReq.result;
      if (db.objectStoreNames.contains('inventory_catalog')) {
        const tx = db.transaction('inventory_catalog', 'readonly');
        const store = tx.objectStore('inventory_catalog');
        const countReq = store.count();
        countReq.onsuccess = () => {
          if (countReq.result === 0) {
            console.log('[Bootstrap] Empty catalog detected — ready for seeding.');
          }
        };
      }
    };
  } catch(e) {
    console.error('[Bootstrap] Offline hydration failed:', e);
  }
})();

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
    if (window.__valenixiaIsLocal) {
        console.log('[Bootstrap] Resolved backend server URL:', window.__valenixiaServerUrl);
    }
  } catch (err) {
    if (window.__valenixiaIsLocal) {
        console.error('[Bootstrap] URL Resolution Error:', err.message);
    }
    window.__valenixiaServerUrl = '';
  }
})();

// System Theme Detection
(function() {
  const ALL_THEMES = [
    'theme-obsidian-emerald',
    'theme-midnight-sapphire',
    'theme-warm-amber',
    'theme-minimalist-chrome',
    'theme-monochrome-ivory',
    'theme-premium-navy'
  ];

  const saved = localStorage.getItem('valenixia_theme_override');
  if (saved && ALL_THEMES.includes(saved)) {
    document.documentElement.classList.add(saved);
    document.documentElement.dataset.themeResolved = saved;
    return;
  }

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const systemTheme = prefersDark ? 'theme-obsidian-emerald' : 'theme-monochrome-ivory';
  document.documentElement.classList.add(systemTheme);
  document.documentElement.dataset.themeResolved = systemTheme;
  window.__valenixiaSystemTheme = systemTheme;
})();

// Global showModal helper
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

// Global click interceptor for tabnabbing
document.addEventListener('click', function(e) {
  const target = e.target.closest('a');
  if (target && target.getAttribute('target') === '_blank') {
    const rel = target.getAttribute('rel');
    if (!rel || !rel.includes('noopener') || !rel.includes('noreferrer')) {
      target.setAttribute('rel', 'noopener noreferrer');
    }
  }
}, true);

// Global DOM ready helper
window.runWhenDOMReady = function(fn) {
  if (typeof fn !== 'function') return;
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
};

// Delegated password & passcode eye toggle for bootstrap & setup wizard phase
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.password-toggle-btn, .btn-toggle-password, .eye-toggle, [data-action="toggle-password"]');
  if (!btn) return;

  e.preventDefault();
  e.stopPropagation();

  const container = btn.closest('.password-wrapper') || btn.parentElement;
  const targetInput = container ? container.querySelector('input') : (btn.dataset && btn.dataset.target ? document.getElementById(btn.dataset.target) : null);

  if (!targetInput) return;

  const isTypePassword = targetInput.type === 'password';
  const isSecuredCss = !targetInput.classList.contains('revealed') && 
    (targetInput.classList.contains('secure-input') || window.getComputedStyle(targetInput).webkitTextSecurity === 'disc');
  const isCurrentlyMasked = isTypePassword || isSecuredCss;

  if (isCurrentlyMasked) {
    targetInput.type = 'text';
    targetInput.classList.add('revealed');
    targetInput.style.webkitTextSecurity = 'none';
    btn.setAttribute('aria-label', 'Hide password');
    btn.classList.add('active');
  } else {
    targetInput.type = 'password';
    targetInput.classList.remove('revealed');
    targetInput.style.webkitTextSecurity = 'disc';
    btn.setAttribute('aria-label', 'Show password');
    btn.classList.remove('active');
  }

  const svgEye = btn.querySelector('.svg-eye');
  const svgEyeOff = btn.querySelector('.svg-eye-off');
  if (svgEye && svgEyeOff) {
    svgEye.style.display = isCurrentlyMasked ? 'none' : 'block';
    svgEyeOff.style.display = isCurrentlyMasked ? 'block' : 'none';
  }
}, true);
