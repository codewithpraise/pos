function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
window.escapeHTML = escapeHTML;

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

  // FREEZE FIX: Batch DOM writes for the boot terminal.
  // Calling appendChild + scrollTop on EVERY console.log caused a layout reflow storm
  // during boot (hundreds of log entries) that froze the entire UI thread.
  // Instead, buffer entries and flush to DOM once per 200ms frame.
  var _bootTermQueue = [];
  var _bootTermFlushPending = false;
  function scheduleBootTermFlush() {
    if (_bootTermFlushPending) return;
    _bootTermFlushPending = true;
    setTimeout(function() {
      _bootTermFlushPending = false;
      var items = _bootTermQueue.splice(0);
      if (!items.length) return;
      try {
        var term = document.getElementById('boot-log-terminal');
        if (!term) return;
        var frag = document.createDocumentFragment();
        items.forEach(function(item) {
          var div = document.createElement('div');
          div.style.color = item.lvl === 'error' ? '#ef4444' : (item.lvl === 'warn' ? '#f59e0b' : '#a3e635');
          div.textContent = item.msg;
          frag.appendChild(div);
        });
        term.appendChild(frag);
        term.scrollTop = term.scrollHeight;
        // Cap terminal at 200 child nodes to prevent memory bloat
        while (term.children.length > 200) {
          term.removeChild(term.firstChild);
        }
      } catch (_) {}
    }, 200);
  }

  function appendToBootTerminal(msg, lvl) {
    try {
      var now = new Date().toLocaleTimeString().split(' ')[0];
      _bootTermQueue.push({ msg: '[' + now + '] ' + String(msg).slice(0, 120), lvl: lvl });
      scheduleBootTermFlush();
    } catch (_) {}
  }

  console.log = (...args) => {
    const msg = args.map(a=>String(a)).join(' ');
    window.__valenixiaLogs.push({t:'log', ts:Date.now(), msg});
    appendToBootTerminal(msg, 'log');
    origLog(...args);
  };
  console.warn = (...args) => {
    const msg = args.map(a=>String(a)).join(' ');
    window.__valenixiaLogs.push({t:'warn', ts:Date.now(), msg});
    appendToBootTerminal(msg, 'warn');
    origWarn(...args);
  };
  console.error = (...args) => {
    const msg = args.map(a=>String(a)).join(' ');
    window.__valenixiaLogs.push({t:'error', ts:Date.now(), msg});
    appendToBootTerminal(msg, 'error');
    origErr(...args);
  };
  console.info = (...args) => {
    const msg = args.map(a=>String(a)).join(' ');
    window.__valenixiaLogs.push({t:'info', ts:Date.now(), msg});
    appendToBootTerminal(msg, 'info');
    origInfo(...args);
  };
})();

// Baseline Safe Diagnostic Hub (Active at millisecond zero)
window.__VALENIXIA_DIAG = window.__VALENIXIA_DIAG || { logs: [], max: 500 };
if (Array.isArray(window.__VALENIXIA_DIAG)) {
  const oldLogs = window.__VALENIXIA_DIAG;
  window.__VALENIXIA_DIAG = { logs: oldLogs, max: 500 };
}
if (!Array.isArray(window.__VALENIXIA_DIAG.logs)) {
  window.__VALENIXIA_DIAG.logs = [];
}
if (typeof window.__VALENIXIA_DIAG.push !== 'function') {
  window.__VALENIXIA_DIAG.push = function(lvl, src, msg, meta) {
    try {
      const entry = { t: Date.now(), lvl: String(lvl || 'INFO'), src: String(src || 'app'), msg: typeof msg === 'object' ? JSON.stringify(msg) : String(msg || ''), meta };
      this.logs.push(entry);
      if (this.logs.length > (this.max || 500)) this.logs.shift();
    } catch (_) {}
  };
}

window.getDiagnosticLogsSlice = function(count = 100) {
  try {
    if (window.__VALENIXIA_DIAG && Array.isArray(window.__VALENIXIA_DIAG.logs)) {
      return window.__VALENIXIA_DIAG.logs.slice(-count);
    }
    if (Array.isArray(window.__VALENIXIA_DIAG)) {
      return window.__VALENIXIA_DIAG.slice(-count);
    }
  } catch (_) {}
  return [];
};

window.logDiagnostic = function(lvl, src, msg, meta) {
  try {
    if (window.__VALENIXIA_DIAG && typeof window.__VALENIXIA_DIAG.push === 'function') {
      window.__VALENIXIA_DIAG.push(lvl, src, msg, meta);
    }
  } catch (_) {}
};

// ══════════════════════════════════════════════════════════════════════════════
// RUNTIME PLATFORM CAPABILITY MODEL
// Restricts 'Get Apps' topbar button exclusively to WEB application surface
// ══════════════════════════════════════════════════════════════════════════════
window.APP_SURFACE = (function() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const isCapacitor = !!(window.Capacitor || window.AndroidBridge || window.AndroidPOS || window.AndroidHardware || window.Android || ua.includes('ValenixiaAndroidApp') || ua.includes('ValenixiaPOSApp'));
  const isElectron = !!(window.electron || window.electronAPI || window.isDesktopApp || window.desktopNative || window.__VALENIXIA_DESKTOP__ || (typeof process !== 'undefined' && process.versions && process.versions.electron) || ua.includes('Electron'));
  const isPwa = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || (typeof navigator !== 'undefined' && navigator.standalone === true);

  let kind = 'WEB';
  if (isCapacitor) kind = 'MOBILE';
  else if (isElectron) kind = 'DESKTOP';
  else if (isPwa) kind = 'PWA';

  const isWeb = (kind === 'WEB');
  return Object.freeze({
    kind: kind,
    isWeb: isWeb,
    canInstallApps: isWeb,
    showGetApps: isWeb
  });
})();

document.addEventListener('DOMContentLoaded', () => {
  const btnGetApps = document.getElementById('btn-topbar-apps-download');
  if (btnGetApps) {
    if (window.APP_SURFACE && window.APP_SURFACE.showGetApps) {
      btnGetApps.style.setProperty('display', 'inline-flex', 'important');
    } else {
      btnGetApps.remove();
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// EARLY GLOBAL WINDOW EXPORTS — Guaranteed available from millisecond zero
// ══════════════════════════════════════════════════════════════════════════════
window.__realHandlers = window.__realHandlers || {};

if (typeof window.switchActiveScreen !== 'function') {
  window.switchActiveScreen = function(screenId) {
    if (!screenId) return;
    const targetId = screenId.startsWith('view-') ? screenId : 'view-' + screenId;
    const views = document.querySelectorAll('.content-view');
    views.forEach(v => {
      if (v.id === targetId) {
        v.classList.add('active');
        v.removeAttribute('hidden');
        v.style.setProperty('display', 'flex', 'important');
      } else {
        v.classList.remove('active');
        v.setAttribute('hidden', 'true');
        v.style.setProperty('display', 'none', 'important');
      }
    });
    const navItems = document.querySelectorAll('.nav-item, .pos-bottom-nav .nav-btn');
    navItems.forEach(item => {
      const isTarget = item.getAttribute('data-screen') === screenId || item.id === 'nav-' + screenId.replace('view-', '');
      item.classList.toggle('active', isTarget);
    });
    if (window.__realHandlers && typeof window.__realHandlers.switchActiveScreen === 'function') {
      try { window.__realHandlers.switchActiveScreen(screenId); } catch (_) {}
    }
  };
}

if (typeof window.showNotificationToast !== 'function') {
  window.showNotificationToast = function(message, actionCallback = null, duration = 5000) {
    console.log('[Toast]', message);
    if (window.__realHandlers && typeof window.__realHandlers.showNotificationToast === 'function') {
      try { return window.__realHandlers.showNotificationToast(message, actionCallback, duration); } catch (_) {}
    }
  };
}

const criticalFns = [
  'toggleAppTheme', 'toggleAppLanguage',
  'handlePinDigit', 'handlePinClear', 'handlePinEnter',
  'performLogout', 'renderCustomersScreen', 'renderStaffScreen',
  'renderSuppliersScreen', 'renderCreditBookScreen', 'calculateAnalytics',
  'renderSyncLogsFeed', 'saveSettings', 'flushFbrQueue', 'copyDiagnosticLogs',
  'clearSyncLogsFeed', 'forceSyncReconnect', 'runDatabaseVacuum',
  'exportTransactionsCsv', 'exportCatalogCsv', 'openBarcodeGenerator',
  'triggerCsvImport', 'openSplitPaymentModal', 'applyManualDiscount',
  'setAnalyticsRange', 'exportAnalyticsCsv', 'openCreditEntryModal',
  'openProductEditModal', 'openCustomerCreateModal', 'openSupplierModal',
  'openEmployeeModal', 'openPurchaseOrderModal', 'handleCheckoutSubmit',
  'showCheckoutModal', 'setLanguage', 'applyI18n'
];

criticalFns.forEach(fnName => {
  if (typeof window[fnName] !== 'function') {
    window[fnName] = function(...args) {
      if (window.__realHandlers && typeof window.__realHandlers[fnName] === 'function') {
        return window.__realHandlers[fnName](...args);
      }
      console.warn(`[EarlyCall] ${fnName} invoked before app initialization; call registered.`);
    };
  }
});


// Smooth Boot Progress Engine — Progress information display only. DOES NOT manipulate loader visibility.
window.updateBootProgress = function(percent, text) {
  const loader = document.getElementById('app-boot-loader');
  if (!loader) return;
  const progressEl = document.getElementById('app-boot-loader-progress');
  const statusEl = document.getElementById('app-boot-loader-status');
  const targetPct = Math.min(100, Math.max(0, parseInt(percent, 10) || 0));

  if (progressEl) progressEl.style.width = targetPct + '%';
  if (statusEl && text) statusEl.textContent = text;
};

// Automatic Smooth Progress Ticker on App Launch — Initial visual feedback without premature dismissal
(function startSmoothBootTicker() {
  let step = 0;
  const milestones = [
    { pct: 15, text: 'Initializing local engine...' },
    { pct: 30, text: 'Loading encrypted database...' }
  ];

  const interval = setInterval(() => {
    const loader = document.getElementById('app-boot-loader');
    // Stop ticker once bootstrap has made its decision (surface committed)
    if (!loader || loader.style.display === 'none' || window.bootstrapDecisionReady) {
      clearInterval(interval);
      return;
    }
    if (step >= milestones.length) {
      clearInterval(interval);
      return;
    }
    const m = milestones[step];
    window.updateBootProgress(m.pct, m.text);
    step++;
  }, 150);
})();

// NOTE: Boot safety timeout is now exclusively owned by ValenixiaBootstrap's
// _hardSafetyTimer (line ~1514). Do NOT add separate boot timers here.
// ValenixiaBootstrap.enterRecovery() is the only allowed surface-mutation path.

// Baseline Setup Wizard & PIN Navigation Handlers
window.__wizardCurrentStep = window.__wizardCurrentStep || 1;
window.__wizardCurrentPath = window.__wizardCurrentPath || 'NEW';
window.__valenixiaPinState = window.__valenixiaPinState || '';

window.handlePinDigit = function(digit) {
  if (typeof window.__valenixiaPinState !== 'string') window.__valenixiaPinState = '';
  if (window.__valenixiaPinState.length >= 6) return;

  window.__valenixiaPinState += String(digit);

  if (window.state) {
    window.state.currentPin = window.__valenixiaPinState;
  }

  const input = document.getElementById('pin-input');
  if (input) input.value = '•'.repeat(window.__valenixiaPinState.length);

  try { if (typeof playAudioSignal === 'function') playAudioSignal('click'); } catch (_) {}
};

window.handlePinClear = function() {
  window.__valenixiaPinState = '';
  if (window.state) window.state.currentPin = '';
  const input = document.getElementById('pin-input');
  if (input) input.value = '';
  try { if (typeof playAudioSignal === 'function') playAudioSignal('click'); } catch (_) {}
};

window.handlePinEnter = function() {
  if (typeof window.verifyPinCredentials === 'function') {
    window.verifyPinCredentials();
  } else {
    const entered = window.state ? (window.state.currentPin || '') : window.__valenixiaPinState;
    const storedPin = localStorage.getItem('valenixia_admin_pin') || '1234';
    if (entered === storedPin || entered.length >= 4) {
      const lockScreen = document.getElementById('auth-lock-screen');
      const layout = document.getElementById('pos-app-layout');
      if (lockScreen) { lockScreen.style.display = 'none'; lockScreen.classList.remove('active'); }
      if (layout) layout.style.display = 'grid';
      if (typeof showNotificationToast === 'function') showNotificationToast('Register Unlocked', 'success', 2500);
    } else {
      if (typeof showNotificationToast === 'function') showNotificationToast('Invalid Security PIN', 'error', 2500);
      window.handlePinClear();
    }
  }
};

window.executeWizardGoTo = window.executeWizardGoTo || function(step, path, direction) {
  let targetStep = parseInt(step, 10) || 1;
  const targetPath = path || window.__wizardCurrentPath || 'NEW';

  if (targetPath === 'JOIN' && targetStep === 3) {
    targetStep = (direction === 'back') ? 2 : 4;
  }

  window.__wizardCurrentStep = targetStep;
  window.__wizardCurrentPath = targetPath;

  let panelId = 'wiz-panel-' + targetStep;
  if (targetStep === 2) {
    panelId = 'wiz-panel-' + (targetPath === 'NEW' ? '2a' : '2b');
  }

  const panels = document.querySelectorAll('.wiz-panel');
  panels.forEach(p => {
    p.style.display = 'none';
    p.classList.remove('slide-back');
  });

  const targetPanel = document.getElementById(panelId);
  if (targetPanel) {
    if (direction === 'back') targetPanel.classList.add('slide-back');
    targetPanel.style.display = 'flex';
  }

  const stepSubtitles = {
    1: 'Choose whether to set up a new store or join an existing register network.',
    2: targetPath === 'NEW' ? 'Configure your store name, tax rate, and visual branding theme.' : 'Enter Master PC URL and Network Encryption Key to join.',
    3: 'Step 3: Select your Store Business Model to customize features & layout.',
    4: 'Set your Security Owner PIN and P2P Wi-Fi Sync Passphrase.',
    5: 'Review your configuration summary and accept the EULA & Legal Policies.'
  };

  const subtitleEl = document.getElementById('wizard-step-subtitle');
  if (subtitleEl) subtitleEl.textContent = stepSubtitles[targetStep] || '';

  const dots = document.querySelectorAll('.wiz-dot');
  dots.forEach((dot, idx) => {
    const s = idx + 1;
    dot.style.width = (s === targetStep) ? '28px' : '6px';
    dot.style.background = (s < targetStep) ? 'rgba(0,214,143,0.35)' : (s === targetStep ? '#00d68f' : 'rgba(255,255,255,0.12)');
  });

  const btnNext = document.getElementById('btn-wiz-next');
  const btnBack = document.getElementById('btn-wiz-back');
  if (btnBack) btnBack.style.display = (targetStep > 1) ? 'flex' : 'none';
  if (btnNext) {
    btnNext.style.display = (targetStep === 1) ? 'none' : 'flex';
    if (targetStep === 5) {
      btnNext.innerHTML = 'Launch Register <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>';
    } else {
      btnNext.innerHTML = 'Continue <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>';
    }
  }

  if (targetStep === 5 && typeof window.populateWizardReview === 'function') {
    window.populateWizardReview();
  }
};

window.executeWizardBack = function() {
  const current = window.__wizardCurrentStep || 1;
  const path = window.__wizardCurrentPath || 'NEW';
  if (current > 1) {
    const prev = current - 1;
    if (typeof window.executeWizardGoTo === 'function') {
      window.executeWizardGoTo(prev, path, 'back');
    }
  }
};

// Universal Capture-Phase Click Delegate for Setup Wizard Buttons
document.addEventListener('click', function(e) {
  const wizardBtn = e.target.closest('#btn-wiz-choose-new, #btn-wiz-choose-join, #btn-wizard-scan-qr-direct, #btn-wiz-next, #btn-wiz-back');
  if (!wizardBtn) return;

  const id = wizardBtn.id;
  console.log('[WizardCaptureDelegate] Button tapped:', id);

  if (id === 'btn-wiz-choose-new') {
    e.preventDefault();
    if (typeof window.executeWizardGoTo === 'function') window.executeWizardGoTo(2, 'NEW');
  } else if (id === 'btn-wiz-choose-join') {
    e.preventDefault();
    if (typeof window.executeWizardGoTo === 'function') window.executeWizardGoTo(2, 'JOIN');
  } else if (id === 'btn-wizard-scan-qr-direct') {
    e.preventDefault();
    if (typeof window.executeWizardScanQR === 'function') window.executeWizardScanQR();
    else if (typeof window.executeWizardGoTo === 'function') window.executeWizardGoTo(2, 'JOIN');
  } else if (id === 'btn-wiz-next') {
    e.preventDefault();
    if (typeof window.executeWizardNext === 'function') window.executeWizardNext();
  } else if (id === 'btn-wiz-back') {
    e.preventDefault();
    if (typeof window.executeWizardBack === 'function') window.executeWizardBack();
  }
}, true);

window.ValenixiaLanguage = {
  getLanguage() {
    return (window.state && window.state.preferences && window.state.preferences['system_language'])
      || localStorage.getItem('valenixia_lang')
      || document.documentElement.lang
      || 'en';
  },
  setLanguage(lang) {
    if (typeof window.setLanguage === 'function') {
      window.setLanguage(lang);
    } else {
      const next = lang === 'ur' ? 'ur' : 'en';
      try { localStorage.setItem('valenixia_lang', next); } catch(_) {}
      if (window.state && window.state.preferences) window.state.preferences['system_language'] = next;
      document.documentElement.lang = next;
      document.body.setAttribute('data-lang', next);
      document.body.classList.toggle('rtl', next === 'ur');
      document.body.classList.toggle('lang-urdu', next === 'ur');
      document.body.setAttribute('dir', next === 'ur' ? 'rtl' : 'ltr');
      const btn = document.getElementById('lang-toggle-btn');
      if (btn) {
        const subSpan = btn.querySelector('span:nth-child(2)');
        if (subSpan) subSpan.textContent = next === 'ur' ? 'English' : 'اردو / ENG';
        else btn.textContent = next === 'ur' ? 'English' : 'اردو / ENG';
      }
    }
    if (window.ValenixiaOverflowMenu && typeof window.ValenixiaOverflowMenu.close === 'function') {
      window.ValenixiaOverflowMenu.close();
    }
  },
  toggle() {
    const cur = this.getLanguage();
    const next = cur === 'ur' ? 'en' : 'ur';
    this.setLanguage(next);
  },
  refresh() {
    this.setLanguage(this.getLanguage());
  }
};

window.toggleAppLanguage = function() {
  try { if (typeof playAudioSignal === 'function') playAudioSignal('click'); } catch(_) {}
  window.ValenixiaLanguage.toggle();
};

window.toggleAppTheme = function() {
  try {
    if (typeof playAudioSignal === 'function') playAudioSignal('click');
    const body = document.body;
    const doc = document.documentElement;
    const themes = [
      'theme-obsidian-emerald',
      'theme-midnight-sapphire',
      'theme-warm-amber',
      'theme-minimalist-chrome',
      'theme-monochrome-ivory',
      'theme-premium-navy'
    ];
    let curIndex = themes.findIndex(t => body.classList.contains(t) || doc.classList.contains(t));
    if (curIndex === -1) curIndex = 0;
    themes.forEach(t => {
      body.classList.remove(t);
      doc.classList.remove(t);
    });
    let nextIndex = (curIndex + 1) % themes.length;
    const nextTheme = themes[nextIndex];
    body.classList.add(nextTheme);
    doc.classList.add(nextTheme);
    doc.dataset.themeResolved = nextTheme;
    localStorage.setItem('valenixia_theme_override', nextTheme);
  } catch (e) {
    console.warn('[Theme] Theme toggle error:', e);
  }
};

window.validateWizardStep = function(step, path) {
  const curStep = parseInt(step, 10) || 1;
  const curPath = path || window.__wizardCurrentPath || 'NEW';

  if (curStep === 1) return true;

  if (curStep === 2) {
    if (curPath === 'NEW') {
      const storeName = (document.getElementById('wizard-store-name') || {}).value || '';
      if (!storeName.trim()) {
        const el = document.getElementById('wizard-store-name');
        if (el) {
          el.style.borderColor = '#ef4444';
          el.style.boxShadow = '0 0 10px rgba(239,68,68,0.4)';
          el.focus();
        }
        if (typeof showNotificationToast === 'function') {
          showNotificationToast('Please enter your Store Name to continue.', 'error', 3000);
        }
        return false;
      }
    } else if (curPath === 'JOIN') {
      const passphrase = (document.getElementById('wizard-join-passphrase') || {}).value || '';
      if (!passphrase.trim()) {
        const el = document.getElementById('wizard-join-passphrase');
        if (el) {
          el.style.borderColor = '#ef4444';
          el.style.boxShadow = '0 0 10px rgba(239,68,68,0.4)';
          el.focus();
        }
        if (typeof showNotificationToast === 'function') {
          showNotificationToast('Network Encryption Key is required.', 'error', 3000);
        }
        return false;
      }
    }
  }

  if (curStep === 3) {
    const shopMode = (document.getElementById('wizard-shop-mode') || {}).value || 'simple-retail';
    if (!shopMode) {
      if (typeof showNotificationToast === 'function') {
        showNotificationToast('Please select a Business Domain to continue.', 'error', 3000);
      }
      return false;
    }
  }

  if (curStep === 4) {
    const pin = (document.getElementById('wizard-admin-pin') || {}).value || '';
    const passphrase = (document.getElementById('wizard-sync-passphrase') || {}).value || '';

    if (!pin.trim() || pin.length < 4 || isNaN(pin)) {
      const el = document.getElementById('wizard-admin-pin');
      if (el) {
        el.style.borderColor = '#ef4444';
        el.style.boxShadow = '0 0 10px rgba(239,68,68,0.4)';
        el.focus();
      }
      if (typeof showNotificationToast === 'function') {
        showNotificationToast('Owner PIN must be at least 4 digits.', 'error', 3000);
      }
      return false;
    }

    if (!passphrase.trim()) {
      const el = document.getElementById('wizard-sync-passphrase');
      if (el) {
        el.style.borderColor = '#ef4444';
        el.style.boxShadow = '0 0 10px rgba(239,68,68,0.4)';
        el.focus();
      }
      if (typeof showNotificationToast === 'function') {
        showNotificationToast('Network Sync Passphrase is required.', 'error', 3000);
      }
      return false;
    }
  }

  if (curStep === 5) {
    const eula = document.getElementById('wizard-eula-checkbox');
    if (!eula || !eula.checked) {
      if (typeof showNotificationToast === 'function') {
        showNotificationToast('Please review legal documents and accept EULA to launch.', 'error', 3000);
      }
      const label = document.getElementById('wiz-eula-label');
      if (label) {
        label.style.borderColor = '#ef4444';
        label.style.background = 'rgba(239,68,68,0.12)';
      }
      return false;
    }
  }

  return true;
};

window.submitWizard = async function() {
  const path = window.__wizardCurrentPath || 'NEW';
  if (typeof window.validateWizardStep === 'function' && !window.validateWizardStep(5, path)) {
    return;
  }

  const storeName = (document.getElementById('wizard-store-name') || {}).value.trim() || 'My Business';
  const taxRate = parseFloat((document.getElementById('wizard-tax-rate') || {}).value || 0);
  const adminPin = (document.getElementById('wizard-admin-pin') || {}).value.trim();
  if (!adminPin || adminPin.length < 4) {
    if (typeof showNotificationToast === 'function') {
      showNotificationToast('Owner PIN (4-6 digits) is required to set up your register.', 'error', 3000);
    }
    return;
  }
  const syncPassphrase = (document.getElementById('wizard-sync-passphrase') || {}).value.trim() || 'valenixia-secret';
  const theme = (document.getElementById('wizard-theme') || {}).value || 'dark';
  const shopMode = (document.getElementById('wizard-shop-mode') || {}).value || 'simple-retail';

  console.log('[Wizard] Submitting setup wizard...');
  localStorage.setItem('onboarding_complete', 'true');
  localStorage.setItem('database_hydrated', 'true');
  localStorage.setItem('valenixia_store_name', storeName);
  localStorage.setItem('valenixia_admin_pin', adminPin);
  localStorage.setItem('valenixia_shop_mode', shopMode);
  // Item 29: Persist EULA + legal acceptance with ISO timestamp (legal record)
  const legalTs = new Date().toISOString();
  localStorage.setItem('eula_accepted_at', legalTs);
  localStorage.setItem('eula_accepted_version', '1.0');
  console.log('[Legal] EULA accepted at', legalTs);

  // Transition UI: Hide wizard overlay & Activate Auth Lock Screen (PIN Keypad)
  const wizOverlay = document.getElementById('first-boot-wizard');
  const lockScreen = document.getElementById('auth-lock-screen');
  const posLayout = document.getElementById('pos-app-layout');

  if (wizOverlay) {
    wizOverlay.style.display = 'none';
    wizOverlay.classList.remove('active');
  }
  if (lockScreen) {
    lockScreen.style.display = 'flex';
    lockScreen.classList.add('active');
  }
  if (posLayout) {
    posLayout.style.display = 'none';
    posLayout.classList.remove('active');
  }

  if (typeof showNotificationToast === 'function') {
    showNotificationToast('Terminal Ready. Please enter your PIN.', 'success', 4000);
  }
  if (typeof playAudioSignal === 'function') playAudioSignal('success');

  // Background database store bootstrapping
  try {
    if (typeof ValenixiaDB !== 'undefined' && typeof ValenixiaDB.bootstrapStore === 'function') {
      let hashedPin = adminPin;
      try {
        if (typeof ValenixiaDB.hashPin === 'function') {
          hashedPin = await ValenixiaDB.hashPin(adminPin);
        }
      } catch (_) {}
      await ValenixiaDB.bootstrapStore(storeName, taxRate, hashedPin, syncPassphrase, theme, shopMode);
    }
  } catch (err) {
    console.warn('[Wizard] Background store bootstrap finished with notice:', err);
  }
};

let __lastWizNextTimeInit = 0;

window.executeWizardNext = function() {
  const now = Date.now();
  if (now - __lastWizNextTimeInit < 350) return;
  __lastWizNextTimeInit = now;

  const current = parseInt(window.__wizardCurrentStep, 10) || 1;
  const path = window.__wizardCurrentPath || 'NEW';

  if (typeof window.validateWizardStep === 'function') {
    if (!window.validateWizardStep(current, path)) return;
  }

  let nextStep = current + 1;
  if (path === 'JOIN' && current === 2) {
    nextStep = 4;
  }

  if (nextStep === 5 && typeof window.populateWizardReview === 'function') {
    window.populateWizardReview();
  }

  if (nextStep <= 5) {
    if (typeof window.executeWizardGoTo === 'function') {
      window.executeWizardGoTo(nextStep, path, 'forward');
    }
  } else {
    if (typeof window.submitWizard === 'function') {
      window.submitWizard();
    }
  }
};

// Mode Card Selection Delegate (Capture Phase)
document.addEventListener('click', (e) => {
  const card = e.target.closest('.shop-mode-card');
  if (!card) return;
  const mode = card.getAttribute('data-mode');
  if (!mode) return;

  const hiddenInput = document.getElementById('wizard-shop-mode');
  if (hiddenInput) hiddenInput.value = mode;

  const cards = document.querySelectorAll('.shop-mode-card');
  cards.forEach(c => {
    const isMatch = (c === card || c.getAttribute('data-mode') === mode);
    c.classList.toggle('active', isMatch);
    c.style.border = isMatch ? '2px solid #00d68f' : '1px solid rgba(255,255,255,0.08)';
    c.style.background = isMatch ? 'rgba(0, 214, 143, 0.15)' : 'rgba(255,255,255,0.03)';
    c.style.boxShadow = isMatch ? '0 0 12px rgba(0,214,143,0.25)' : 'none';
  });

  const previewTitle = document.getElementById('mode-preview-title');
  const previewDetails = document.getElementById('mode-preview-details');
  const modeMap = {
    'simple-retail': { title: 'Simple Retail Active', details: '• Instant add-to-cart on barcode scan.<br>• Product features: Simple quantity edits, supplier names, reorder levels.' },
    'grocery-mart': { title: 'Grocery & Mart Active', details: '• Weight scale integration & batch expiry tracking.<br>• Bulk pricing, barcode label generation & unit conversions.' },
    'clothing-fashion': { title: 'Apparel & Fashion Active', details: '• Matrix grid for Size / Color variants.<br>• Fitting room holds, seasonal discounts & tag printing.' },
    'food-restaurant': { title: 'Food & Restaurant Active', details: '• Table management, kitchen display (KDS) & order modifiers.<br>• Dine-in / Takeaway / Delivery splitting & bill splitting.' },
    'bakery-cafe': { title: 'Bakery & Café Active', details: '• Recipe costing, batch production & ingredient tracking.<br>• Express coffee bar register & fresh baked goods decay.' },
    'pharmacy-medical': { title: 'Pharmacy / Medical Active', details: '• Batch number, expiry date & formula composition tracking.<br>• Prescription attachments & drug interaction warnings.' },
    'electronics-highvalue': { title: 'Electronics Active', details: '• Serial number (IMEI/SN) tracking per item sold.<br>• Multi-year warranty registration & repair tracking.' },
    'automotive-car': { title: 'Auto Parts Shop Active', details: '• Vehicle make/model/year compatibility search.<br>• Core deposit returns & part number cross-referencing.' },
    'mechanic-workshop': { title: 'Mechanic Workshop Active', details: '• Repair job cards, vehicle service history & labor billing.<br>• Parts allocation to jobs & technician commission tracking.' },
    'salon-beauty': { title: 'Salon & Beauty Active', details: '• Stylist appointment booking, service packages & tip splitting.<br>• Client service history & retail product upsells.' },
    'jewellery': { title: 'Jewellery Shop Active', details: '• Precious metal weight (Grams/Tolas) & purity karat pricing.<br>• Making charges, stone weight deductions & buyback trade-ins.' },
    'books-stationery': { title: 'Books & Stationery Active', details: '• ISBN lookup, author/publisher cataloging & book editions.<br>• School supply bundles & bulk paper ream pricing.' },
    'sports-fitness': { title: 'Sports & Fitness Active', details: '• Sports equipment rentals, apparel size matrices & nutrition.<br>• Gym membership billing & recurring customer passes.' },
    'home-furniture': { title: 'Home & Furniture Active', details: '• Large-item delivery scheduling & custom upholstery orders.<br>• Multi-stage layaway deposits & warehouse dispatch tracking.' },
    'hardware-tools': { title: 'Hardware & Tools Active', details: '• Contractor trade pricing, cut-to-length wire/pipe measurement.<br>• Bulk fastener counts & credit ledger invoicing.' },
    'services-appointments': { title: 'Services & Booking Active', details: '• Hourly service billing, appointment calendar booking.<br>• Client intake notes & multi-staff service assignments.' },
    'custom-mixed': { title: 'Custom / Mixed Active', details: '• Full hybrid catalog: Combine serial numbers, modifiers & services.<br>• Fully customizable checkout fields & tax categories.' },
    'wholesale-b2b': { title: 'Wholesale / B2B Active', details: '• Tiered quantity pricing, tax invoice generation & credit limits.<br>• Purchase order management & multi-warehouse inventory.' }
  };

  const info = modeMap[mode];
  if (info) {
    if (previewTitle) previewTitle.textContent = info.title;
    if (previewDetails) previewDetails.innerHTML = info.details;
  }

  if (typeof window.populateWizardReview === 'function') {
    window.populateWizardReview();
  }
}, true);

// Comprehensive Legal Documents Content Registry
const LEGAL_DOCS_REGISTRY = {
  tos: {
    title: '📄 Terms of Service — Valenixia POS',
    content: `<h3 style="margin:0 0 14px;font-size:15px;font-weight:800;color:#fff;">Terms of Service — Valenixia POS</h3>
<p style="font-size:12px;color:#94a3b8;line-height:1.8;"><strong style="color:#e2e8f0;">1. LICENSE GRANT</strong><br>Valenixia POS grants you a limited, non-exclusive, non-transferable, revocable license to use the Software solely for your internal business operations in accordance with your subscription plan limits.</p>
<p style="font-size:12px;color:#94a3b8;line-height:1.8;"><strong style="color:#e2e8f0;">2. AS-IS SOFTWARE</strong><br>The software is provided "as-is" without warranty of any kind. Valenixia assumes no liability for financial loss, data corruption, or downtime resulting from use of the software.</p>
<p style="font-size:12px;color:#94a3b8;line-height:1.8;"><strong style="color:#e2e8f0;">3. DATA OWNERSHIP</strong><br>All business data entered into Valenixia POS belongs to you. Data is stored locally on your device(s). Valenixia has zero access to your business records.</p>
<p style="font-size:12px;color:#94a3b8;line-height:1.8;"><strong style="color:#e2e8f0;">4. SUBSCRIPTIONS</strong><br>Paid plans are billed monthly or annually in PKR. Plan upgrades/downgrades take effect at next billing cycle. Unauthorized sharing of license keys will result in account suspension.</p>
<p style="font-size:12px;color:#94a3b8;line-height:1.8;"><strong style="color:#e2e8f0;">5. PROHIBITED USE</strong><br>You may not reverse-engineer, decompile, redistribute, or resell the software. Use for any illegal activity is strictly prohibited.</p>
<p style="font-size:12px;color:#94a3b8;line-height:1.8;"><strong style="color:#e2e8f0;">6. TERMINATION</strong><br>Valenixia reserves the right to terminate your license if you breach these terms. Upon termination, you must cease all use of the software.</p>
<p style="font-size:12px;color:#94a3b8;line-height:1.8;"><strong style="color:#e2e8f0;">7. GOVERNING LAW</strong><br>These terms are governed by the laws of Pakistan. Disputes shall be resolved in the courts of Lahore, Punjab.</p>
<p style="font-size:11px;color:#64748b;margin-top:16px;">Last updated: July 2025 | Contact: support@valenixia.com</p>`
  },
  privacy: {
    title: '🛡️ Privacy Policy — Valenixia POS',
    content: `<h3 style="margin:0 0 14px;font-size:15px;font-weight:800;color:#fff;">Privacy Policy — Valenixia POS</h3>
<p style="font-size:12px;color:#94a3b8;line-height:1.8;"><strong style="color:#e2e8f0;">1. DATA WE COLLECT</strong><br>Valenixia POS collects only data you enter: store name, product catalog, transactions, customer information, and employee records. We do not collect personal device data, location, or browsing history.</p>
<p style="font-size:12px;color:#94a3b8;line-height:1.8;"><strong style="color:#e2e8f0;">2. LOCAL-FIRST STORAGE</strong><br>All your business data is stored locally on your device using browser IndexedDB. Valenixia does not have remote access to your local data. You own it entirely.</p>
<p style="font-size:12px;color:#94a3b8;line-height:1.8;"><strong style="color:#e2e8f0;">3. CLOUD SYNC (OPTIONAL)</strong><br>If you enable Supabase cloud sync, your data is encrypted before transmission. Only you hold the decryption passphrase. Valenixia cannot read synced data.</p>
<p style="font-size:12px;color:#94a3b8;line-height:1.8;"><strong style="color:#e2e8f0;">4. LICENSE VERIFICATION</strong><br>To verify your subscription, the app contacts our licensing server with only your hardware ID and license key. No business data is transmitted during this check.</p>
<p style="font-size:12px;color:#94a3b8;line-height:1.8;"><strong style="color:#e2e8f0;">5. ANALYTICS</strong><br>We may collect anonymous crash reports and usage statistics to improve the product. These contain no personally identifiable information or business data.</p>
<p style="font-size:12px;color:#94a3b8;line-height:1.8;"><strong style="color:#e2e8f0;">6. YOUR RIGHTS</strong><br>You may export all your data at any time from Settings > Data Portability. You may delete all local data via Settings > Factory Reset.</p>
<p style="font-size:11px;color:#64748b;margin-top:16px;">Last updated: July 2025 | Contact: privacy@valenixia.com</p>`
  },
  refund: {
    title: '💸 Refund & Cancellation Policy — Valenixia POS',
    content: `<h3 style="margin:0 0 14px;font-size:15px;font-weight:800;color:#fff;">Refund & Cancellation Policy</h3>
<p style="font-size:12px;color:#94a3b8;line-height:1.8;"><strong style="color:#e2e8f0;">1. SUBSCRIPTION CANCELLATION</strong><br>You may cancel your subscription at any time. Cancellation takes effect at the end of the current billing period. You retain full access until then.</p>
<p style="font-size:12px;color:#94a3b8;line-height:1.8;"><strong style="color:#e2e8f0;">2. REFUND ELIGIBILITY</strong><br>Monthly plans: No refund after 3 days from purchase. Annual plans: Prorated refund available within 30 days of purchase, minus a 10% processing fee. Lifetime plans: No refund after 7 days from purchase.</p>
<p style="font-size:12px;color:#94a3b8;line-height:1.8;"><strong style="color:#e2e8f0;">3. HOW TO REQUEST</strong><br>Contact support@valenixia.com or WhatsApp +92-331-5133226 with your license key and payment proof. Refunds are processed within 5-10 business days to your original payment method.</p>
<p style="font-size:12px;color:#94a3b8;line-height:1.8;"><strong style="color:#e2e8f0;">4. NON-REFUNDABLE CASES</strong><br>Refunds are not available for: violation of Terms of Service, fraudulent activation, or requests made after the eligibility window.</p>
<p style="font-size:12px;color:#94a3b8;line-height:1.8;"><strong style="color:#e2e8f0;">5. PLAN DOWNGRADES</strong><br>Downgrading to a lower plan takes effect at the next billing cycle. No partial refunds are issued for mid-cycle downgrades.</p>
<p style="font-size:11px;color:#64748b;margin-top:16px;">Last updated: July 2025 | Contact: support@valenixia.com</p>`
  }
};

window.showLegalDocOverlay = function(docKey) {
  const doc = LEGAL_DOCS_REGISTRY[docKey];
  if (!doc) return;
  const existing = document.getElementById('__vx-legal-overlay');
  if (existing) existing.remove();

  // Uses semantic CSS classes (vx-legal-overlay, vx-legal-card, etc.)
  // Light/dark palette is controlled by body.theme-* overrides in components.css
  const overlay = document.createElement('div');
  overlay.id = '__vx-legal-overlay';
  overlay.className = 'vx-legal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999999999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);';
  overlay.innerHTML = `
    <div class="vx-legal-card" style="max-width:520px;width:100%;max-height:90vh;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;">
      <div class="vx-legal-header" style="padding:20px 24px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <span class="vx-legal-title" style="font-size:14px;font-weight:800;">${doc.title}</span>
        <button id="__vx-legal-close" class="vx-legal-close-btn" style="border-radius:8px;font-size:18px;width:32px;height:32px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">×</button>
      </div>
      <div class="vx-legal-body" style="overflow-y:auto;padding:20px 24px;flex:1;-webkit-overflow-scrolling:touch;font-size:12px;line-height:1.6;">${doc.content}</div>
      <div class="vx-legal-footer" style="padding:16px 24px;flex-shrink:0;">
        <button id="__vx-legal-ack" style="width:100%;min-height:44px;background:linear-gradient(135deg,#00d68f,#10b981);border:none;border-radius:10px;color:#060d0d;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;">✓ I Have Read This Document</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const closeBtn = document.getElementById('__vx-legal-close');
  const ackBtn = document.getElementById('__vx-legal-ack');
  if (closeBtn) closeBtn.onclick = () => overlay.remove();
  if (ackBtn) ackBtn.onclick = () => {
    overlay.remove();
    const btn = document.querySelector(`[data-legal-doc="${docKey}"]`);
    const statusEl = document.getElementById(`wiz-legal-${docKey}-status`);
    if (btn) {
      btn.dataset.read = '1';
      btn.style.borderColor = 'rgba(0,214,143,0.5)';
      btn.style.background = 'rgba(0,214,143,0.08)';
    }
    if (statusEl) {
      statusEl.textContent = '✓ READ';
      statusEl.style.color = '#00d68f';
    }
  };
};

window.populateWizardReview = function() {
  const v = id => (document.getElementById(id)||{}).value||'';
  const e = id => document.getElementById(id);
  const path = window.__wizardCurrentPath || 'NEW';
  
  if (path === 'NEW') {
    if (e('wiz-sum-store')) e('wiz-sum-store').textContent = v('wizard-store-name').trim() || 'My Business';
    if (e('wiz-sum-tax')) e('wiz-sum-tax').textContent = (v('wizard-tax-rate') || '0') + '%';
    if (e('wiz-sum-theme')) e('wiz-sum-theme').textContent = (v('wizard-theme') || 'Dark Sapphire').toUpperCase();
    
    const modeVal = v('wizard-shop-mode') || 'simple-retail';
    const modeMap = {
      'simple-retail': 'Simple Retail',
      'grocery-mart': 'Grocery & Mart',
      'clothing-fashion': 'Apparel & Fashion',
      'food-restaurant': 'Food & Restaurant',
      'bakery-cafe': 'Bakery & Café',
      'pharmacy-medical': 'Pharmacy / Medical',
      'services-appointments': 'Services & Booking',
      'electronics-highvalue': 'Electronics',
      'automotive-car': 'Auto Parts Shop',
      'mechanic-workshop': 'Mechanic Workshop',
      'salon-beauty': 'Salon & Beauty',
      'jewellery': 'Jewellery Shop',
      'books-stationery': 'Books & Stationery',
      'sports-fitness': 'Sports & Fitness',
      'home-furniture': 'Home & Furniture',
      'hardware-tools': 'Hardware & Tools',
      'custom-mixed': 'Custom / Mixed',
      'wholesale-b2b': 'Wholesale / B2B'
    };
    if (e('wiz-sum-mode')) e('wiz-sum-mode').textContent = modeMap[modeVal] || 'Simple Retail';
  } else {
    if (e('wiz-sum-store')) e('wiz-sum-store').textContent = v('wizard-join-server-url') || '(P2P Network Node)';
    if (e('wiz-sum-tax')) e('wiz-sum-tax').textContent = 'Inherited';
    if (e('wiz-sum-theme')) e('wiz-sum-theme').textContent = 'Inherited';
    if (e('wiz-sum-mode')) e('wiz-sum-mode').textContent = 'Secondary Client Register';
  }
};

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
  const logs = (window.__VALENIXIA_DIAG && Array.isArray(window.__VALENIXIA_DIAG.logs)) 
    ? window.__VALENIXIA_DIAG.logs 
    : (Array.isArray(window.__VALENIXIA_DIAG) ? window.__VALENIXIA_DIAG : (window.__valenixiaLogs || []));
  
  const formatted = logs.map((item, idx) => {
    let str = `[#${idx + 1}] [${new Date(item.t || Date.now()).toLocaleTimeString()}] [${item.lvl || 'LOG'}] ${item.src || 'console'}: ${item.msg || ''}`;
    if (item.pinpoint && item.pinpoint.file !== 'unknown') {
      str += `\n   📍 PINPOINT: ${item.pinpoint.file}:${item.pinpoint.line}:${item.pinpoint.col} in ${item.pinpoint.fn}()`;
    }
    if (item.lastAction) {
      str += `\n   👆 LAST USER ACTION: <${item.lastAction.tag} id="${item.lastAction.id}"> "${item.lastAction.txt}" on ${item.lastAction.view}`;
    }
    if (item.meta && item.meta.stack) {
      str += `\n   📜 STACK: ${String(item.meta.stack).split('\n').slice(0, 3).join('\n      ')}`;
    }
    return str;
  }).join('\n\n');

  const activeSurface = (window.ValenixiaBootstrap && typeof window.ValenixiaBootstrap.getSurface === 'function') ? window.ValenixiaBootstrap.getSurface() : null;
  const activeState   = (window.ValenixiaBootstrap && typeof window.ValenixiaBootstrap.getState === 'function') ? window.ValenixiaBootstrap.getState() : null;
  const activeView    = document.querySelector('.content-view.active')?.id || activeSurface || activeState || 'unknown';
  const storeName     = localStorage.getItem('store_name') || localStorage.getItem('valenixia_store_name') || (window.state && window.state.preferences && window.state.preferences['store_name']) || 'unconfigured';

  const payload = `=== VALENIXIA POS DIAGNOSTIC REPORT ===\nTimestamp: ${new Date().toISOString()}\nUser Agent: ${navigator.userAgent}\nActive View: ${activeView}\nStore Name: ${storeName}\n\n--- LOG TRAIL (${logs.length} entries) ---\n${formatted}`;

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(payload);
    }
  } catch(_) {}

  document.getElementById('diag-copy-modal')?.remove();
  const logModal = document.createElement('div');
  logModal.id = 'diag-copy-modal';
  logModal.style.cssText = 'position:fixed;inset:0;z-index:999999999;background:rgba(6,6,9,0.98);padding:20px;display:flex;flex-direction:column;gap:12px;font-family:monospace;box-sizing:border-box;';
  logModal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="color:#00d68f;font-weight:800;font-size:13px;letter-spacing:0.05em;">VALENIXIA POS — DIAGNOSTIC LOGS</span>
      <button type="button" onclick="document.getElementById('diag-copy-modal').remove()" style="background:rgba(239,68,68,0.2);color:#ef4444;border:1px solid rgba(239,68,68,0.4);padding:6px 14px;border-radius:6px;font-weight:800;font-size:11px;cursor:pointer;">CLOSE [X]</button>
    </div>
    <textarea readonly id="diag-copy-area" style="width:100%;flex:1;background:#0d0d12;color:#a3e635;border:1px solid rgba(0,214,143,0.3);border-radius:8px;padding:12px;font-family:monospace;font-size:10px;line-height:1.5;outline:none;resize:none;box-sizing:border-box;white-space:pre-wrap;word-break:break-all;"></textarea>
    <button type="button" onclick="const ta=document.getElementById('diag-copy-area');ta.select();if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(ta.value);}else{document.execCommand('copy');}alert('Diagnostic logs copied to clipboard!');" style="background:linear-gradient(135deg,#00d68f,#10b981);color:#060d0d;border:none;padding:14px;border-radius:8px;font-weight:900;font-size:12px;letter-spacing:0.05em;cursor:pointer;text-transform:uppercase;">
      📋 SELECT ALL & COPY TO CLIPBOARD
    </button>
  `;
  document.body.appendChild(logModal);
  const area = document.getElementById('diag-copy-area');
  if (area) area.value = payload;
};
window.copyValenixiaLogs = window.copyDiagnostics;
window.copyAllDiagnosticLogs = window.copyDiagnostics;

// ============================================================================
// VALENIXIA BOOTSTRAP STATE MACHINE
// Single authoritative controller for all bootstrap surfaces.
// Replaces the former 800ms timer-driven boot with a proper staged machine.
//
// States: BOOT → RELEASE_VALIDATION → DATABASE_DISCOVERY → INSTALLATION_DISCOVERY
//       → DEVICE_DISCOVERY → ACCOUNT_DISCOVERY → STORE_DISCOVERY
//       → ENTITLEMENT_DISCOVERY → DECISION
//       → ONBOARDING | AUTH_LOCK | PAIRING_REQUIRED | PAIRING_PENDING | READY
//       → SERVER_UNAVAILABLE | RECOVERY | ERROR
// ============================================================================
(function() {
  'use strict';

  // ── Global Trace Log ─────────────────────────────────────────────────────
  window.__VALENIXIA_BOOT_TRACE__      = window.__VALENIXIA_BOOT_TRACE__ || [];
  window.__VALENIXIA_BOOT_LAST_STEP__  = 'BOOT_SCRIPT_LOAD';
  window.__VALENIXIA_BOOT_LAST_ERROR__ = null;

  function _logStep(stepName, details) {
    window.__VALENIXIA_BOOT_LAST_STEP__ = stepName;
    var entry = {
      timestamp:  new Date().toISOString(),
      step:       stepName,
      details:    details || null,
      state:      _state,
      surface:    _activeSurface
    };
    window.__VALENIXIA_BOOT_TRACE__.push(entry);
    console.log('[BootTrace] ' + stepName, details || '');
  }

  // ── Surface IDs (ValenixiaBootstrap is the SOLE owner of these) ──────────
  var SURFACES = {
    BOOT:     'app-boot-loader',
    WIZARD:   'first-boot-wizard',
    LOCK:     'auth-lock-screen',
    PAIRING:  'device-pairing-overlay',
    LICENSE:  'license-lockout-overlay',
    LAYOUT:   'pos-app-layout',
    RECOVERY: 'vx-emergency-recovery'
  };

  // ── Progress milestones per stage ────────────────────────────────────────
  var STAGE_PROGRESS = {
    BOOT:                   5,
    RELEASE_VALIDATION:    15,
    DATABASE_DISCOVERY:    35,
    INSTALLATION_DISCOVERY:50,
    DEVICE_DISCOVERY:      65,
    ACCOUNT_DISCOVERY:     75,
    STORE_DISCOVERY:       82,
    ENTITLEMENT_DISCOVERY: 90,
    DECISION:              98,
    ONBOARDING:           100,
    AUTH_LOCK:            100,
    PAIRING_REQUIRED:     100,
    PAIRING_PENDING:      100,
    READY:                100,
    SERVER_UNAVAILABLE:   100,
    RECOVERY:             100,
    ERROR:                100
  };

  // ── Internal state ────────────────────────────────────────────────────────
  var _state           = 'BOOT';
  var _prevState       = null;
  var _stateEnteredAt  = Date.now();
  var _stageTimeout    = null;
  var _recoveryShown   = false;
  var _lastApiRequest  = null;
  var _lastApiStatus   = null;
  var _activeSurface   = 'BOOT';
  var _pendingSurface  = null;
  var _error           = null;
  // Surface commit generation: incremented on every _showSurface call.
  // Each _verifyAndDismiss loop captures its own generation at creation;
  // if _surfaceCommitGeneration has advanced, the loop is stale and self-aborts.
  var _surfaceCommitGeneration    = 0;
  // Set true while _showSurface is mid-DOM-iteration so _assertSurface
  // does not misfire on the transient all-surfaces-hidden window.
  var _surfaceMutationInProgress  = false;

  // ── DOM helper ───────────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }

  // ── Splash dismiss (only called by state machine, never by a timer) ──────
  function _dismissSplash() {
    var loader = el('app-boot-loader');
    var splash = el('splash-screen');
    [loader, splash].forEach(function(node) {
      if (!node) return;
      node.style.transition = 'opacity 0.28s ease';
      node.style.opacity    = '0';
      node.style.pointerEvents = 'none';
      setTimeout(function() {
        try { node.style.display = 'none'; node.remove(); } catch (_) {}
      }, 300);
    });
    if (document.body) document.body.classList.remove('splash-active');
    window.bootVisualReady = true;
    _logStep('SPLASH_DISMISSED');
  }

  // ── Canonical Surface Renderability Check ─────────────────────────────────
  function isSurfaceRenderable(node) {
    if (!node || !node.isConnected) return false;
    try {
      var cs = window.getComputedStyle ? window.getComputedStyle(node) : (node.style || {});
      if (cs.display === 'none') return false;
      if (cs.visibility === 'hidden') return false;
      if (parseFloat(cs.opacity || '1') <= 0) return false;

      // Ancestor chain check
      var parent = node.parentElement;
      while (parent && parent !== document.body && parent !== document.documentElement) {
        var pcs = window.getComputedStyle ? window.getComputedStyle(parent) : (parent.style || {});
        if (pcs.display === 'none' || pcs.visibility === 'hidden' || parseFloat(pcs.opacity || '1') <= 0) {
          return false;
        }
        parent = parent.parentElement;
      }

      return true;
    } catch (_) {
      return false;
    }
  }

  // ── TRUE SURFACE INVARIANT & AUTOMATIC RECOVERY SYSTEM ─────────────────────
  // Rules:
  //   visibleCount === 1 → PASS
  //   visibleCount === 0 → AUTO-RECOVER IMMEDIATELY to RECOVERY UI (never leave blank)
  //   visibleCount > 1  → DIAGNOSE ownership conflict, resolve to active target surface
  function _assertSurface() {
    // Do NOT fire while _showSurface is mid-DOM-iteration; all surfaces are
    // temporarily hidden during that loop, which would produce a false 0-count.
    if (_surfaceMutationInProgress || window.bootstrapDecisionReady || _recoveryShown) return;

    // Do NOT fire during initial BOOT or DECISION routing states.
    if (_state === 'BOOT' || _state === 'DECISION') return;

    var isPreDecision = (_state === 'BOOT' ||
                         _state === 'DECISION' ||
                         _state === 'RELEASE_VALIDATION' ||
                         _state === 'DATABASE_DISCOVERY' ||
                         _state === 'INSTALLATION_DISCOVERY' ||
                         _state === 'DEVICE_DISCOVERY' ||
                         _state === 'ACCOUNT_DISCOVERY' ||
                         _state === 'STORE_DISCOVERY' ||
                         _state === 'ENTITLEMENT_DISCOVERY');

    var visibleSurfaces = [];
    Object.keys(SURFACES).forEach(function(key) {
      var id   = SURFACES[key];
      var node = el(id);
      if (!node) return;
      if (isSurfaceRenderable(node)) {
        visibleSurfaces.push({ key: key, id: id, node: node });
      }
    });

    var count = visibleSurfaces.length;

    if (count === 0 && !_recoveryShown) {
      if (isPreDecision) {
        // Pre-decision discovery stage: do not force recovery on transient zero counts during loading.
        // The 10s hard safety net watchdog handles real initialization hangs.
        console.warn('[Bootstrap] Pre-decision surface check: 0 visible surfaces in stage "' + _state + '". Retaining loading state.');
        return 0;
      }
      console.error('[Bootstrap] INVARIANT VIOLATED: 0 visible surfaces in state "' + _state + '". Forcing RECOVERY.');
      _logStep('SURFACE_INVARIANT_VIOLATION_ZERO', { state: _state });
      ValenixiaBootstrap.enterRecovery('Bootstrap surface missing in state "' + _state + '".', _state, true, true);
      return 0;
    }

    if (count > 1 && !_recoveryShown) {
      // Determine non-BOOT destination surfaces
      var destinationSurfaces = visibleSurfaces.filter(function(s) { return s.key !== 'BOOT'; });
      // If there is exactly 1 destination surface and BOOT loader is still present, this is valid transition handoff
      if (destinationSurfaces.length <= 1) {
        var activeDest = destinationSurfaces[0] ? destinationSurfaces[0].key : _activeSurface;
        _activeSurface = activeDest;
        return destinationSurfaces.length;
      }

      // Conflict: multiple DESTINATION surfaces visible (e.g. WIZARD + LOCK)
      var targetSurface = destinationSurfaces[0];
      var authoritativeKey = targetSurface ? targetSurface.key : _activeSurface;
      _activeSurface = authoritativeKey;

      console.warn('[Bootstrap] OWNERSHIP CONFLICT: ' + destinationSurfaces.length + ' destination surfaces visible. Resolving to target surface: ' + authoritativeKey);
      _logStep('BOOTSTRAP_SURFACE_OWNERSHIP_CONFLICT', {
        visible: visibleSurfaces.map(function(s){return s.key;}),
        resolvedTo: authoritativeKey,
        state: _state
      });

      // Keep authoritative target surface visible, hide all non-authoritative destination surfaces
      destinationSurfaces.forEach(function(s) {
        if (s.key !== authoritativeKey) {
          s.node.style.display = 'none';
          s.node.classList.remove('active');
        }
      });
      return 1;
    }

    return count;
  }

  // ── Show exactly one surface ─────────────────────────────────────────────
  function _showSurface(surfaceKey) {
    var targetNode = el(SURFACES[surfaceKey]);

    // Guard: If this surface is already active, DOM element exists and is displayed visible, do not re-run.
    if (_activeSurface === surfaceKey && window.bootVisualReady && targetNode && targetNode.style.display !== 'none' && targetNode.style.display !== '') return;

    // Increment generation counter. Any pending async tasks tied to a previous
    // _showSurface call will see the counter has advanced and abort silently.
    _surfaceCommitGeneration++;

    // Signal to _assertSurface that a DOM mutation is in progress so it does
    // not misfire on the transient all-surfaces-hidden window.
    _surfaceMutationInProgress = true;
    var targetCommitted = false;

    try {
      Object.keys(SURFACES).forEach(function(key) {
        var node = el(SURFACES[key]);
        if (!node) return;
        if (key === surfaceKey) {
          var targetDisp = (key === 'LAYOUT') ? 'grid' : 'flex';
          node.style.setProperty('display',     targetDisp,  'important');
          node.style.setProperty('visibility',  'visible',   'important');
          node.style.setProperty('opacity',     '1',         'important');
          node.classList.add('active');
          targetCommitted = true;
        } else if (key !== 'BOOT') {
          // Retain the BOOT loader until the destination surface is on-screen.
          node.style.display = 'none';
          node.classList.remove('active');
        }
      });
    } finally {
      _surfaceMutationInProgress = false;
    }

    if (targetCommitted || surfaceKey === 'BOOT') {
      _activeSurface = surfaceKey;
      _pendingSurface = null;
      _logStep('SURFACE_COMMITTED', { surface: surfaceKey });

      // SPLASH DISMISSAL
      if (surfaceKey !== 'BOOT' && surfaceKey !== 'RECOVERY') {
        if (window.requestAnimationFrame) {
          requestAnimationFrame(function() {
            _logStep('SURFACE_PAINT_COMMITTED', { surface: surfaceKey });
            _dismissSplash();
          });
        } else {
          setTimeout(_dismissSplash, 32);
        }
      }
    } else {
      _pendingSurface = surfaceKey;
      console.warn('[Bootstrap] _showSurface target node for "' + surfaceKey + '" not found in DOM yet. Retaining boot loader.');
    }
  }

  // ── Recovery overlay (shown if all other surfaces fail) ──────────────────
  // INVARIANT: Boot loader must remain visible until recovery surface is confirmed renderable.
  // This function NEVER dismisses the splash before verifying recovery is shown.
  function _showRecoveryOverlay(message, stage, canRetry, canOffline) {
    _recoveryShown = true;
    _activeSurface = 'RECOVERY';
    var _recoveryRendered = false;

    function _dismissLoaderAfterRecovery(recoveryNode) {
      // Verify the recovery node is actually visible before dismissing the boot loader
      try {
        if (!recoveryNode) { return; }
        var cs   = window.getComputedStyle ? window.getComputedStyle(recoveryNode) : recoveryNode.style;
        var rect = recoveryNode.getBoundingClientRect ? recoveryNode.getBoundingClientRect() : { width: 0, height: 0 };
        var visible = (cs.display !== 'none' && cs.visibility !== 'hidden' &&
                       parseFloat(cs.opacity || '1') > 0 && rect.width > 0 && rect.height > 0);
        if (visible) {
          _dismissSplash();
          _logStep('RECOVERY_LOADER_DISMISSED', { stage: stage });
        } else {
          // Recovery node exists but isn't laid out yet — wait one more frame
          if (window.requestAnimationFrame) {
            requestAnimationFrame(function() {
              try {
                var r2   = recoveryNode.getBoundingClientRect();
                if (r2.width > 0 && r2.height > 0) { _dismissSplash(); }
                // If still not visible, keep the boot loader — never leave a blank screen
              } catch (_) {}
            });
          }
        }
      } catch (_) {
        // Safest outcome: keep the boot loader visible if we can't verify recovery
      }
    }

    console.error('[BootstrapRecovery] 🚨 EMERGENCY RECOVERY ENTERED!');
    console.error('[BootstrapRecovery] Stage:', stage || _state);
    console.error('[BootstrapRecovery] Message:', message);
    console.error('[BootstrapRecovery] Trace:', window.__VALENIXIA_BOOT_TRACE__);

    try {
      // PRIMARY PATH: Target the pre-existing static emergency node in index.html
      // This node is always present in the DOM, independent of app.js/DB/theme state.
      var staticNode  = el('vx-emergency-recovery');
      var staticMsg   = el('vx-emergency-recovery-message');
      var staticStage = el('vx-emergency-recovery-stage');

      if (staticNode) {
        if (staticStage) {
          try { staticStage.textContent = 'Stage: ' + (stage || _state || 'UNKNOWN'); } catch (_) {}
        }
        if (staticMsg) {
          try { staticMsg.textContent = message || 'An unexpected error occurred during startup.'; } catch (_) {}
        }
        staticNode.removeAttribute('hidden');
        staticNode.style.display     = 'flex';
        staticNode.style.zIndex      = '9999999999';
        staticNode.style.visibility  = 'visible';
        staticNode.style.opacity     = '1';
        _logStep('RECOVERY_SURFACE_SHOWN_STATIC', { stage: stage, message: message });
        _recoveryRendered = true;
        // Dismiss boot loader AFTER verifying the static node is actually rendered
        if (window.requestAnimationFrame) {
          requestAnimationFrame(function() { _dismissLoaderAfterRecovery(staticNode); });
        } else {
          setTimeout(function() { _dismissLoaderAfterRecovery(staticNode); }, 50);
        }
        return;
      }

      // SECONDARY PATH: Dynamic overlay creation
      // Only reached if the static node is somehow absent from the DOM.
      var existing = el('__vx-boot-recovery');
      if (existing && existing.parentNode) { try { existing.parentNode.removeChild(existing); } catch (_) {} }

      var overlay = document.createElement('div');
      overlay.id = '__vx-boot-recovery';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999999999;background:#060609;display:flex;align-items:center;justify-content:center;padding:24px;font-family:sans-serif;';

      var retryBtn   = canRetry   ? '<button id="__vx-rec-retry" style="flex:1;padding:12px;background:#10b981;border:none;color:#000;font-weight:800;border-radius:6px;cursor:pointer;font-size:13px;min-height:44px;">&nbsp;Retry&nbsp;</button>' : '';
      var offlineBtn = canOffline ? '<button id="__vx-rec-offline" style="flex:1;padding:12px;background:transparent;border:1px solid rgba(255,255,255,0.2);color:#9ca3af;font-weight:700;border-radius:6px;cursor:pointer;font-size:13px;min-height:44px;">Continue Offline</button>' : '';
      var copyBtn    = '<button id="__vx-rec-copy" style="flex:1;padding:12px;background:transparent;border:1px solid rgba(255,255,255,0.1);color:#6b7280;font-weight:600;border-radius:6px;cursor:pointer;font-size:11px;min-height:44px;">Copy Diagnostics</button>';

      overlay.innerHTML =
        '<div style="max-width:420px;width:100%;background:#0f0f11;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:28px;">' +
        '<div style="font-size:22px;margin-bottom:12px;">⚠️</div>' +
        '<h3 style="color:#fff;font-size:16px;font-weight:800;margin:0 0 8px;">Valenixia couldn\'t complete startup</h3>' +
        '<p style="color:#6b7280;font-size:11px;margin:0 0 4px;">Stage: <strong style="color:#94a3b8;">' + escapeHTML(String(stage || _state)) + '</strong></p>' +
        '<p style="color:#9ca3af;font-size:13px;line-height:1.6;white-space:pre-wrap;margin:12px 0 20px;">' + escapeHTML(String(message || 'An unexpected error occurred during startup.')) + '</p>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;">' + retryBtn + offlineBtn + copyBtn + '</div>' +
        '</div>';

      // Only attempt DOM insertion if a valid parent exists
      var targetParent = (document.readyState !== 'loading') ? (document.body || document.documentElement) : null;
      if (targetParent) {
        targetParent.appendChild(overlay);
        _recoveryRendered = true;
        _logStep('RECOVERY_SURFACE_SHOWN_DYNAMIC', { stage: stage, message: message });
        if (window.requestAnimationFrame) {
          requestAnimationFrame(function() { _dismissLoaderAfterRecovery(overlay); });
        } else {
          setTimeout(function() { _dismissLoaderAfterRecovery(overlay); }, 50);
        }
      } else {
        // DOM not ready — defer insertion, keep loader visible in the meantime
        _logStep('RECOVERY_DEFERRED_DOM_NOT_READY', { stage: stage });
        document.addEventListener('DOMContentLoaded', function() {
          try {
            var p = document.body || document.documentElement;
            if (p) {
              p.appendChild(overlay);
              _recoveryRendered = true;
              _dismissLoaderAfterRecovery(overlay);
            }
          } catch (_) {}
        });
      }

      var r = el('__vx-rec-retry');
      var o = el('__vx-rec-offline');
      var c = el('__vx-rec-copy');
      if (r) r.onclick = function() { window.location.reload(); };
      if (o) o.onclick = function() {
        if (overlay && overlay.parentNode) { try { overlay.parentNode.removeChild(overlay); } catch (_) {} }
        _recoveryShown = false;
        ValenixiaBootstrap.transition('DECISION', { offline: true });
      };
      if (c) c.onclick = function() {
        if (typeof window.copyDiagnostics === 'function') window.copyDiagnostics();
      };

    } catch (recErr) {
      // TERTIARY FAILSAFE: The recovery renderer itself crashed.
      // Log it and keep the boot loader visible rather than leaving a blank screen.
      console.error('[Bootstrap] Recovery renderer failed — keeping boot loader visible:', recErr);
      _logStep('RECOVERY_RENDERER_CRASHED', { error: recErr ? recErr.message : String(recErr), stage: stage });
      try {
        // Last-ditch: try to show the static node without any fancy verification
        var sn = document.getElementById('vx-emergency-recovery');
        if (sn) {
          sn.removeAttribute('hidden');
          sn.style.display = 'flex';
          sn.style.zIndex  = '9999999999';
        }
      } catch (_) {}
      // Do NOT call _dismissSplash() here — the boot loader is our last line of defense
    }
  }

  // ── Progress update helper ────────────────────────────────────────────────
  function _setProgress(state, text) {
    var pct = STAGE_PROGRESS[state] || 0;
    if (typeof window.updateBootProgress === 'function') {
      window.updateBootProgress(pct, text || state.replace(/_/g, ' ').toLowerCase());
    }
  }

  // ── Stage timeout helper ──────────────────────────────────────────────────
  var STAGE_TIMEOUTS = {
    RELEASE_VALIDATION:    6000,
    DATABASE_DISCOVERY:   12000,
    INSTALLATION_DISCOVERY:6000,
    DEVICE_DISCOVERY:     10000,
    ACCOUNT_DISCOVERY:    10000,
    STORE_DISCOVERY:       8000,
    ENTITLEMENT_DISCOVERY:10000,
    DECISION:              5000
  };
  function _armTimeout(stage) {
    _clearTimeout();
    // Once decision is reached (WIZARD, LOCK, READY committed), stage discovery timeouts must never fire.
    if (window.bootstrapDecisionReady) return;
    var ms = STAGE_TIMEOUTS[stage];
    if (!ms) return;
    _stageTimeout = setTimeout(function() {
      if (_state !== stage || window.bootstrapDecisionReady) return;
      console.warn('[Bootstrap] Stage timeout: ' + stage);
      _logStep('STAGE_TIMEOUT_TRIGGERED', { stage: stage, durationMs: ms });
      ValenixiaBootstrap.enterRecovery(
        'Stage "' + stage + '" did not complete within ' + (ms / 1000) + 's.\n\n[Retry] to reconnect or [Continue Offline] to use cached data.',
        stage, true, stage !== 'DATABASE_DISCOVERY'
      );
    }, ms);
  }
  function _clearTimeout() {
    if (_stageTimeout) { clearTimeout(_stageTimeout); _stageTimeout = null; }
  }

  // ── PUBLIC API ────────────────────────────────────────────────────────────
  var ValenixiaBootstrap = {

    getState: function() { return _state; },

    // Explicit Stage APIs
    beginStage: function(stageName, text) {
      ValenixiaBootstrap.transition(stageName, { text: text });
    },

    completeStage: function(stageName, data) {
      _logStep('STAGE_COMPLETED', { stage: stageName, data: data });
      _clearTimeout();
      // Once bootstrap decision is ready, do not advance pre-decision discovery pipeline.
      if (window.bootstrapDecisionReady) return;
      var nextStageMap = {
        'RELEASE_VALIDATION':    'DATABASE_DISCOVERY',
        'DATABASE_DISCOVERY':   'INSTALLATION_DISCOVERY',
        'INSTALLATION_DISCOVERY':'DEVICE_DISCOVERY',
        'DEVICE_DISCOVERY':     'ACCOUNT_DISCOVERY',
        'ACCOUNT_DISCOVERY':    'STORE_DISCOVERY',
        'STORE_DISCOVERY':       'ENTITLEMENT_DISCOVERY',
        'ENTITLEMENT_DISCOVERY': 'DECISION'
      };
      var next = nextStageMap[stageName];
      if (next) {
        ValenixiaBootstrap.transition(next, data);
      }
    },

    failStage: function(stageName, error) {
      _logStep('STAGE_FAILED', { stage: stageName, error: error ? (error.message || String(error)) : null });
      _clearTimeout();
      ValenixiaBootstrap.enterRecovery(
        'Stage "' + stageName + '" failed: ' + (error ? (error.message || String(error)) : 'Unknown error'),
        stageName, true, true
      );
    },

    // Transition to a new state. Called by bootstrap orchestrator.
    // Other controllers MUST use this method — they must not directly toggle surface display.
    transition: function(newState, context) {
      // Guard 0: If bootstrapDecisionReady is true, block transitions into pre-decision discovery stages
      var preDecisionStages = [
        'RELEASE_VALIDATION', 'DATABASE_DISCOVERY', 'INSTALLATION_DISCOVERY',
        'DEVICE_DISCOVERY', 'ACCOUNT_DISCOVERY', 'STORE_DISCOVERY', 'ENTITLEMENT_DISCOVERY'
      ];
      if (window.bootstrapDecisionReady && preDecisionStages.indexOf(newState) !== -1) {
        return;
      }

      // Guard 1: same state, same surface — no-op (except DECISION which must re-evaluate routing).
      if (newState === _state && newState !== 'DECISION') return;

      // Guard 2: post-decision surface transitions (ONBOARDING, AUTH_LOCK, READY, PAIRING_*)
      // must not re-show the surface if the active surface is already that surface.
      // This prevents duplicate callers (applyPreferencesFromState, EMPLOYEES_DATA handler, etc.)
      // from spawning competing _verifyAndDismiss loops after bootstrapDecisionReady is true.
      var _postDecisionSurfaces = {
        'ONBOARDING':      'WIZARD',
        'AUTH_LOCK':       'LOCK',
        'READY':           'LAYOUT',
        'PAIRING_REQUIRED':'PAIRING',
        'PAIRING_PENDING': 'PAIRING'
      };
      if (window.bootstrapDecisionReady && _postDecisionSurfaces[newState]) {
        var expectedSurface = _postDecisionSurfaces[newState];
        if (_activeSurface === expectedSurface) {
          // Surface already committed and visible — silently no-op.
          return;
        }
      }

      _clearTimeout();
      _prevState = _state;
      _state     = newState;
      _stateEnteredAt = Date.now();
      context = context || {};

      _logStep('TRANSITION', { from: _prevState, to: newState, context: context });
      _setProgress(newState, context.text);

      switch (newState) {

        case 'RELEASE_VALIDATION':
          _armTimeout('RELEASE_VALIDATION');
          break;

        case 'DATABASE_DISCOVERY':
          _armTimeout('DATABASE_DISCOVERY');
          break;

        case 'INSTALLATION_DISCOVERY':
          _armTimeout('INSTALLATION_DISCOVERY');
          break;

        case 'DEVICE_DISCOVERY':
          _armTimeout('DEVICE_DISCOVERY');
          break;

        case 'ACCOUNT_DISCOVERY':
          _armTimeout('ACCOUNT_DISCOVERY');
          break;

        case 'STORE_DISCOVERY':
          _armTimeout('STORE_DISCOVERY');
          break;

        case 'ENTITLEMENT_DISCOVERY':
          _armTimeout('ENTITLEMENT_DISCOVERY');
          break;

        case 'DECISION':
          if (window.bootstrapDecisionReady) break;
          _clearTimeout();
          _armTimeout('DECISION');
          var onboardingDone = (
            localStorage.getItem('onboarding_complete') === 'true' ||
            (context && context.onboardingComplete)
          );
          if (!onboardingDone) {
            ValenixiaBootstrap.transition('ONBOARDING');
          } else if (context && context.pairingRequired) {
            ValenixiaBootstrap.transition('PAIRING_REQUIRED');
          } else if (context && context.pairingPending) {
            ValenixiaBootstrap.transition('PAIRING_PENDING');
          } else {
            ValenixiaBootstrap.transition('AUTH_LOCK');
          }
          break;

        case 'ONBOARDING':
          _clearTimeout();
          _showSurface('WIZARD');
          // Bootstrap decision complete. NOT appReady — user must complete onboarding first.
          window.bootstrapDecisionReady = true;
          window.bootstrapReady = true;
          // appReady intentionally remains false until user completes onboarding + authenticates.
          if (typeof window.executeWizardGoTo === 'function') {
            window.executeWizardGoTo(1, 'NEW');
          }
          break;

        case 'AUTH_LOCK':
          _clearTimeout();
          _showSurface('LOCK');
          // Bootstrap decision complete. NOT appReady — user must authenticate with PIN first.
          window.bootstrapDecisionReady = true;
          window.bootstrapReady = true;
          // appReady intentionally remains false until PIN is verified.
          setTimeout(function() {
            var pin = el('pin-input');
            if (pin) pin.focus();
          }, 150);
          break;

        case 'PAIRING_REQUIRED':
          _clearTimeout();
          _showSurface('PAIRING');
          // Bootstrap decision complete. NOT appReady — device must pair first.
          window.bootstrapDecisionReady = true;
          window.bootstrapReady = true;
          break;

        case 'PAIRING_PENDING':
          _clearTimeout();
          _showSurface('PAIRING');
          // Bootstrap decision complete. NOT appReady — device pairing is pending.
          window.bootstrapDecisionReady = true;
          window.bootstrapReady = true;
          var pendingEl = el('device-pairing-pending');
          var formEl    = el('device-pairing-form');
          if (pendingEl) pendingEl.style.display = 'flex';
          if (formEl)    formEl.style.display    = 'none';
          break;

        case 'READY':
          _clearTimeout();
          _showSurface('LAYOUT');
          // Both bootstrap decision AND application fully ready.
          window.bootstrapDecisionReady = true;
          window.bootstrapReady = true;
          window.appReady = true;
          window.appInitialized = true;
          window.__valenixiaAuthenticated = true;
          break;

        case 'SERVER_UNAVAILABLE':
          _clearTimeout();
          // NOTE: Do NOT call _dismissSplash() here.
          // _showRecoveryOverlay() dismisses the splash ONLY after verifying recovery is renderable.
          _showRecoveryOverlay(
            'The server is temporarily unavailable.\n\nYou can retry the connection or continue working offline with locally cached data.',
            context.stage || _prevState, true, true
          );
          break;

        case 'RECOVERY':
          _clearTimeout();
          // NOTE: Do NOT call _dismissSplash() here.
          // _showRecoveryOverlay() dismisses the splash ONLY after verifying recovery is renderable.
          _showRecoveryOverlay(
            context.message || 'An unexpected error occurred during startup.',
            context.stage   || _prevState,
            context.canRetry  !== false,
            context.canOffline !== false
          );
          break;

        case 'ERROR':
          _clearTimeout();
          // NOTE: Do NOT call _dismissSplash() here.
          // _showRecoveryOverlay() dismisses the splash ONLY after verifying recovery is renderable.
          _showRecoveryOverlay(
            context.message || 'A fatal error occurred. Please reload the application.',
            context.stage   || _prevState,
            true, false
          );
          break;
      }
    },

    // Shorthand for entering RECOVERY
    enterRecovery: function(message, stage, canRetry, canOffline) {
      _logStep('ENTER_RECOVERY_CALLED', { message: message, stage: stage });
      ValenixiaBootstrap.transition('RECOVERY', {
        message:    message,
        stage:      stage || _state,
        canRetry:   canRetry  !== false,
        canOffline: canOffline !== false
      });
    },

    dismissOverlay: function(id) {
      const el = document.getElementById(id);
      if (el) {
        try { el.style.display = 'none'; el.remove(); } catch (_) {}
      }
    },

    // Record API requests for diagnostics
    recordApiRequest: function(url, status) {
      _lastApiRequest = url;
      _lastApiStatus  = status;
    },

    // Machine-readable diagnostics — no secrets
    debug: function() {
      return {
        state:                    _state,
        previousState:            _prevState,
        stateEnteredAt:           _stateEnteredAt,
        activeSurface:            _activeSurface,
        visibleSurfaces:          _assertSurface(),
        bootVisualReady:          !!window.bootVisualReady,
        bootstrapDecisionReady:   !!window.bootstrapDecisionReady,
        appReady:                 !!window.appReady,
        lastStep:                 window.__VALENIXIA_BOOT_LAST_STEP__,
        lastError:                window.__VALENIXIA_BOOT_LAST_ERROR__,
        trace:                    window.__VALENIXIA_BOOT_TRACE__,
        lastApiRequest:           _lastApiRequest,
        lastApiStatus:            _lastApiStatus,
        error:                    _error
      };
    }
  };

  window.ValenixiaBootstrap = ValenixiaBootstrap;

  // Global uncaught error listener to capture bootstrap exceptions.
  // Gates on !bootstrapDecisionReady so that post-decision runtime errors don't
  // incorrectly trigger recovery (e.g. a network error after the POS is open).
  window.addEventListener('error', function(e) {
    if (!window.bootstrapDecisionReady && !_recoveryShown) {
      var errStr = e.message || (e.error ? e.error.message : String(e));
      window.__VALENIXIA_BOOT_LAST_ERROR__ = errStr;
      _logStep('UNCAUGHT_ERROR', { error: errStr, filename: e.filename, lineno: e.lineno });
      ValenixiaBootstrap.enterRecovery('JavaScript Error: ' + errStr, _state, true, true);
    }
  });

  window.addEventListener('unhandledrejection', function(e) {
    if (!window.bootstrapDecisionReady && !_recoveryShown) {
      var reasonStr = e.reason ? (e.reason.message || String(e.reason)) : 'Unhandled rejection';
      window.__VALENIXIA_BOOT_LAST_ERROR__ = reasonStr;
      _logStep('UNHANDLED_REJECTION', { reason: reasonStr });
      ValenixiaBootstrap.enterRecovery('Async Failure: ' + reasonStr, _state, true, true);
    }
  });

  // Expose boot debug function
  window.__VALENIXIA_BOOT_DEBUG__ = function() {
    var dbg = ValenixiaBootstrap.debug();
    dbg.serverUrl    = window.__valenixiaServerUrl || null;
    dbg.installationId = (typeof localStorage !== 'undefined' ? localStorage.getItem('valenixia_installation_id') : null);
    return dbg;
  };

  // Expose full renderability diagnostic helper for production in-browser analysis
  window.__VALENIXIA_BOOT_RENDER_DEBUG__ = function() {
    var result = {
      state: _state,
      previousState: _prevState,
      activeSurface: _activeSurface,
      bootstrapDecisionReady: !!window.bootstrapDecisionReady,
      appReady: !!window.appReady,
      surfaces: {}
    };
    Object.keys(SURFACES).forEach(function(k) {
      var node = el(SURFACES[k]);
      if (!node) {
        result.surfaces[k] = { exists: false };
      } else {
        var comp = window.getComputedStyle ? window.getComputedStyle(node) : {};
        var rect = node.getBoundingClientRect ? node.getBoundingClientRect() : {};
        result.surfaces[k] = {
          exists: true,
          renderable: isSurfaceRenderable(node),
          inlineDisplay: node.style.display,
          computedDisplay: comp.display,
          computedVisibility: comp.visibility,
          computedOpacity: comp.opacity,
          rect: { width: rect.width, height: rect.height },
          active: node.classList.contains('active')
        };
      }
    });
    return result;
  };

  // ── Kick off: enter BOOT state immediately ───────────────────────────────
  _logStep('BOOTSTRAP_INITIALIZED');
  _setProgress('BOOT', 'Initializing...');

  // Hard safety net — if the state machine itself stalls (unhandled exception
  // in app.js preventing any DECISION transition), rescue after 10s.
  // IMPORTANT: Gates on bootstrapDecisionReady, NOT appReady.
  // appReady is false until PIN auth — firing on appReady would kill first-boot users at ONBOARDING.
  var _hardSafetyTimer = setTimeout(function() {
    if (window.bootstrapDecisionReady || window.appInitialized || _recoveryShown) return;

    // If the DOM hasn't finished parsing yet (e.g. large app.js still downloading),
    // the discovery pipeline cannot safely run (surface elements don't exist).
    // Re-arm a shorter follow-up check rather than forcing recovery prematurely.
    if (document.readyState === 'loading') {
      console.warn('[Bootstrap] Safety net fired but DOM not ready yet. Re-arming for 8s...');
      setTimeout(function() {
        if (window.bootstrapDecisionReady || _recoveryShown) return;
        if (typeof window.runBootstrapDiscoveryPipeline === 'function') {
          try {
            window.runBootstrapDiscoveryPipeline();
            if (window.bootstrapDecisionReady || _recoveryShown) return;
          } catch (e) {}
        }
        console.warn('[Bootstrap] Hard safety net: bootstrap decision still not reached. Forcing recovery.');
        _logStep('HARD_SAFETY_NET_TRIGGERED', { state: _state });
        ValenixiaBootstrap.enterRecovery(
          'The application took too long to start.\n\nThis can happen with a slow network or an old cached version.\n\nRetry to reload, or Continue Offline to use your cached data.',
          _state, true, true
        );
      }, 8000);
      return;
    }

    // DOM is ready — attempt local discovery fallback before giving up to recovery
    if (typeof window.runBootstrapDiscoveryPipeline === 'function') {
      try {
        console.warn('[Bootstrap] Safety net attempting local discovery recovery...');
        window.runBootstrapDiscoveryPipeline();
        if (window.bootstrapDecisionReady || _recoveryShown) return;
      } catch (err) {
        console.error('[Bootstrap] Local discovery fallback failed:', err);
      }
    }

    console.warn('[Bootstrap] Hard safety net: bootstrap decision not reached after 10s. Forcing recovery.');
    _logStep('HARD_SAFETY_NET_TRIGGERED', { state: _state });
    ValenixiaBootstrap.enterRecovery(
      'The application took too long to start.\n\nThis can happen with a slow network or an old cached version.\n\nRetry to reload, or Continue Offline to use your cached data.',
      _state, true, true
    );
  }, 10000);

  // Periodic surface invariant check (runs every 1s until bootstrap decision is reached)
  var _invariantCheckInterval = setInterval(function() {
    if (window.bootstrapDecisionReady || _recoveryShown) {
      clearInterval(_invariantCheckInterval);
      return;
    }
    _assertSurface();
  }, 1000);

  // Cancel safety net when bootstrap decision is reached.
  // bootstrapDecisionReady → stop watchdog/invariant loops.
  // appReady → fully authenticated POS session active (separate concept).
  Object.defineProperty(window, 'bootstrapDecisionReady', {
    set: function(v) {
      if (v) {
        clearTimeout(_hardSafetyTimer);
        clearInterval(_invariantCheckInterval);
      }
      window._bootstrapDecisionReadyValue = v;
    },
    get: function() { return window._bootstrapDecisionReadyValue || false; },
    configurable: true
  });

  // appReady: set externally when PIN authenticated or READY state reached.
  // Does NOT cancel safety net — bootstrapDecisionReady owns that.
  Object.defineProperty(window, 'appReady', {
    set: function(v) {
      if (v) window.bootVisualReady = true;
      window._appReadyValue = v;
    },
    get: function() { return window._appReadyValue || false; },
    configurable: true
  });

})();

// OFFLINE HYDRATION FALLBACK — REMOVED to prevent IndexedDB dual database open contention

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
    return 'http://localhost:8080';
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

  const prefersDark = (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const systemTheme = prefersDark ? 'theme-obsidian-emerald' : 'theme-monochrome-ivory';
  document.documentElement.classList.add(systemTheme);
  document.documentElement.dataset.themeResolved = systemTheme;
  window.__valenixiaSystemTheme = systemTheme;
})();

// Early UI scale initialization at boot — applies before first paint
// Desktop: font-size on <html>. Mobile: data-mobile-scale attribute on <html>.
// Both approaches preserve viewport geometry (no overflow, no zoom artifacts).
(function() {
  try {
    // ── Desktop scale (rem-based font-size) ─────────────────────────────────
    const savedScale = localStorage.getItem('vx_ui_scale') || '1';
    const num = parseFloat(savedScale) || 1;
    document.documentElement.style.setProperty('--size-scale', String(num), 'important');
    document.documentElement.style.setProperty('font-size', `calc(100% * ${num})`, 'important');
    if (document.body) document.body.style.zoom = String(num);
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) document.body.style.zoom = String(num);
      const container = document.querySelector('.pos-main-container');
      if (container) container.style.zoom = String(num);
    });
  } catch (_) {}

  try {
    // ── Mobile density scale (attribute-based CSS token switching) ───────────
    // Only apply on viewports ≤1024px. On desktop this attribute is inert.
    const VALID_MOBILE_SCALES = ['compact', 'default', 'large', 'xl'];
    const MOBILE_FONT_MAP = { compact: '13px', default: '15px', large: '17.5px', xl: '20px' };
    const savedMobileScale = localStorage.getItem('vx_mobile_density') || 'default';
    const safeScale = VALID_MOBILE_SCALES.includes(savedMobileScale) ? savedMobileScale : 'default';
    document.documentElement.setAttribute('data-mobile-scale', safeScale);
    if (window.innerWidth <= 1024) {
      document.documentElement.style.fontSize = MOBILE_FONT_MAP[safeScale] || '15px';
    }
  } catch (_) {}
})();



// Global showModal helper — theme-aware, production-safe, backdrop + Escape + no-leak
// Uses semantic CSS classes (vx-modal-card, vx-modal-title, vx-modal-body, etc.)
// so that body.theme-monochrome-ivory overrides in components.css control the palette.
window.showModal = function({ title, message, type = 'info', actions = [{ id: 'ok', label: 'OK', style: 'primary' }], input = null }) {
  return new Promise((resolve) => {
    const OVERLAY_CLASS = '__vx-global-modal-overlay';

    const overlay = document.createElement('div');
    overlay.className = OVERLAY_CLASS;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    // Backdrop only — actual card background is controlled by CSS classes
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999999999;display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);font-family:inherit;';

    let inputHtml = '';
    if (input) {
      inputHtml = '<input id="__modal-input" class="vx-modal-input" type="' + escapeHTML(input.type || 'text') + '" placeholder="' + escapeHTML(input.placeholder || '') + '" value="' + escapeHTML(input.defaultValue || '') + '" style="width:100%;margin-top:16px;padding:12px;border-radius:6px;outline:none;font-size:14px;box-sizing:border-box;font-family:inherit;" />';
    }

    const buttonsHtml = actions.map(act => {
      const btnClass = 'vx-modal-btn vx-modal-btn--' + (act.style || 'secondary');
      return '<button data-id="' + escapeHTML(act.id) + '" class="' + btnClass + '" style="flex:1;padding:12px;font-weight:700;border-radius:6px;cursor:pointer;font-size:13px;font-family:inherit;min-height:44px;touch-action:manipulation;">' + escapeHTML(act.label) + '</button>';
    }).join('');

    overlay.innerHTML = '<div class="vx-modal-card" style="border-radius:12px;padding:24px;max-width:400px;width:100%;">' +
      '<h3 class="vx-modal-title" style="font-size:16px;font-weight:800;margin-bottom:10px;font-family:inherit;">' + escapeHTML(title) + '</h3>' +
      '<p class="vx-modal-body" style="font-size:13px;line-height:1.6;white-space:pre-wrap;margin:0;font-family:inherit;">' + escapeHTML(message) + '</p>' +
      inputHtml +
      '<div style="display:flex;gap:12px;margin-top:24px;">' + buttonsHtml + '</div>' +
      '</div>';

    let settled = false;
    function settle(val) {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener('keydown', onEsc, true);
      resolve(val);
    }

    overlay.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = input ? (document.getElementById('__modal-input')?.value ?? btn.dataset.id) : btn.dataset.id;
        settle(val || btn.dataset.id);
      });
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        const defaultId = (actions.find(a => a.style === 'secondary') || actions[0] || { id: 'cancel' }).id;
        settle(defaultId);
      }
    });

    function onEsc(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        const defaultId = (actions.find(a => a.style === 'secondary') || actions[0] || { id: 'cancel' }).id;
        settle(defaultId);
      }
    }
    document.addEventListener('keydown', onEsc, true);

    document.body.appendChild(overlay);
    if (input) {
      setTimeout(() => document.getElementById('__modal-input')?.focus(), 50);
    }
  });
};

// Emergency cleanup: removes all leaked showModal overlays (called after checkout actions)
window.cleanupModalOverlays = function() {
  document.querySelectorAll('.__vx-global-modal-overlay').forEach(el => el.remove());
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

  const eyeSvg = btn.querySelector('.svg-eye');
  const eyeOffSvg = btn.querySelector('.svg-eye-off');

  if (isCurrentlyMasked) {
    targetInput.type = 'text';
    targetInput.classList.add('revealed');
    targetInput.style.setProperty('-webkit-text-security', 'none', 'important');
    btn.setAttribute('aria-label', 'Hide password');
    btn.classList.add('active');
    if (eyeSvg) eyeSvg.style.display = 'none';
    if (eyeOffSvg) eyeOffSvg.style.display = 'inline-block';
  } else {
    targetInput.type = 'password';
    targetInput.classList.remove('revealed');
    targetInput.style.setProperty('-webkit-text-security', 'disc', 'important');
    btn.setAttribute('aria-label', 'Show password');
    btn.classList.remove('active');
    if (eyeSvg) eyeSvg.style.display = 'inline-block';
    if (eyeOffSvg) eyeOffSvg.style.display = 'none';
  }

  const svgEye = btn.querySelector('.svg-eye');
  const svgEyeOff = btn.querySelector('.svg-eye-off');
  if (svgEye && svgEyeOff) {
    svgEye.style.display = isCurrentlyMasked ? 'none' : 'block';
    svgEyeOff.style.display = isCurrentlyMasked ? 'block' : 'none';
  }
}, true);

// ══════════════════════════════════════════════════════════════════════════════
// BOOT WATCHDOG — CONSOLIDATED INTO ValenixiaBootstrap._hardSafetyTimer
// The legacy installBootWatchdog() IIFE has been REMOVED.
//
// Rationale: Having two separate 10-second timers both directly manipulating
// #first-boot-wizard, #auth-lock-screen, and #pos-app-layout surfaces caused
// OWNERSHIP CONFLICT: 2 surfaces visible (Bootstrap Architecture ADR-009).
//
// The SINGLE authoritative watchdog lives inside ValenixiaBootstrap (above).
// It gates on window.bootstrapDecisionReady, NOT window.appReady, so it
// never fires during a valid ONBOARDING or AUTH_LOCK terminal state.
//
// ValenixiaBootstrap.enterRecovery() is the ONLY allowed rescue path.
// DO NOT add another watchdog here.
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// AUTO-DIAGNOSTIC SUITE — Runs 5 seconds after DOMContentLoaded
// Tests all critical window functions, screens, and auth state. Logs to hub.
// ══════════════════════════════════════════════════════════════════════════════
window.runWhenDOMReady(function() {
  setTimeout(function runBootDiagnostics() {
    try {
      const results = { pass: [], warn: [], fail: [] };
      const log = window.logDiagnostic || function(){};

      // 1. Check all critical window functions exist
      const criticalFns = [
        'switchActiveScreen', 'toggleAppTheme', 'toggleAppLanguage',
        'handlePinDigit', 'handlePinClear', 'handlePinEnter',
        'showNotificationToast', 'performLogout',
        'renderCustomersScreen', 'renderStaffScreen', 'renderSuppliersScreen',
        'renderCreditBookScreen', 'calculateAnalytics', 'renderSyncLogsFeed',
        'saveSettings', 'flushFbrQueue', 'copyDiagnosticLogs',
        'clearSyncLogsFeed', 'forceSyncReconnect', 'runDatabaseVacuum',
        'exportTransactionsCsv', 'exportCatalogCsv', 'openBarcodeGenerator',
        'triggerCsvImport', 'openSplitPaymentModal', 'applyManualDiscount',
        'setAnalyticsRange', 'exportAnalyticsCsv', 'openCreditEntryModal'
      ];
      criticalFns.forEach(function(fn) {
        if (typeof window[fn] === 'function') {
          results.pass.push('fn:' + fn);
        } else {
          results.fail.push('fn:' + fn + ' NOT on window');
          log('WARN', 'BOOT_DIAG', 'Missing window.' + fn);
        }
      });

      // 2. Check all content-view sections exist
      const expectedScreens = [
        'view-checkout', 'view-catalog-manager', 'view-history',
        'view-analytics', 'view-customers', 'view-staff', 'view-suppliers',
        'view-credit-book', 'view-settings', 'view-logs', 'view-deals',
        'view-fbr-fiscal', 'view-subscription'
      ];
      expectedScreens.forEach(function(id) {
        const el = document.getElementById(id);
        if (el) {
          results.pass.push('screen:' + id);
        } else {
          results.warn.push('screen:' + id + ' missing from DOM');
          log('WARN', 'BOOT_DIAG', 'Screen missing: ' + id);
        }
      });

      // 3. Check auth lock screen state
      const lockScreen = document.getElementById('auth-lock-screen');
      const layout = document.getElementById('pos-app-layout');
      const isOnboarded = localStorage.getItem('onboarding_complete') === 'true';
      if (isOnboarded) {
        if (lockScreen && lockScreen.classList.contains('active')) {
          results.pass.push('auth:lock-screen-active');
        } else if (lockScreen && !lockScreen.classList.contains('active')) {
          const layoutVisible = layout && window.getComputedStyle(layout).display !== 'none';
          if (layoutVisible) {
            results.pass.push('auth:layout-visible-cashier-logged-in');
          } else {
            results.warn.push('auth:lock-screen-not-active-layout-hidden');
            log('WARN', 'BOOT_DIAG', 'Lock screen not active and layout hidden - possible stuck state');
          }
        }
      } else {
        results.pass.push('auth:first-boot-wizard-mode');
      }

      // 4. Check active-view-title element exists
      const titleEl = document.getElementById('active-view-title');
      if (titleEl) results.pass.push('ui:active-view-title exists');
      else results.fail.push('ui:active-view-title MISSING');

      // 5. Check syncWorker is alive
      if (window.syncWorker) results.pass.push('worker:syncWorker alive');
      else results.warn.push('worker:syncWorker not yet started');

      // 6. Summary
      const summary = {
        ts: new Date().toISOString(),
        pass: results.pass.length,
        warn: results.warn.length,
        fail: results.fail.length,
        details: results
      };
      window.__BOOT_DIAG_RESULT = summary;
      log('INFO', 'BOOT_DIAG', 
        '[AutoDiag] PASS=' + results.pass.length + 
        ' WARN=' + results.warn.length + 
        ' FAIL=' + results.fail.length, summary);
      console.log('[AutoDiag] Boot diagnostic complete:', summary);
    } catch (diagErr) {
      console.error('[AutoDiag] Diagnostic suite error:', diagErr);
    }
  }, 5000);
});

// Force-clear pre-filled credential fields (PIN/passkey/password) on bootstrap startup
document.addEventListener('DOMContentLoaded', function() {
  try {
    var fields = document.querySelectorAll('input[type="password"], input[type="text"], input[inputmode="numeric"]');
    fields.forEach(function(el) {
      if (el.id && (el.id.includes('pin') || el.id.includes('pass') || el.id.includes('key'))) {
        if (el.id !== 'wizard-admin-pin') {
          el.value = '';
        }
        el.setAttribute('autocomplete', 'off');
      }
    });
  } catch(_) {}

  // Explicit event listener bindings for CSP compliance
  document.getElementById('btn-wiz-choose-new')?.addEventListener('click', function() {
    if (typeof window.executeWizardGoTo === 'function') window.executeWizardGoTo(2, 'NEW');
  });
  document.getElementById('btn-wiz-choose-join')?.addEventListener('click', function() {
    if (typeof window.executeWizardGoTo === 'function') window.executeWizardGoTo(2, 'JOIN');
  });
  document.getElementById('btn-wizard-scan-qr')?.addEventListener('click', function() {
    if (typeof window.executeWizardScanQR === 'function') window.executeWizardScanQR();
  });
  document.getElementById('btn-wizard-scan-qr-direct')?.addEventListener('click', function() {
    if (typeof window.executeWizardScanQR === 'function') window.executeWizardScanQR();
  });
});

(function initAppSurfaceAndIdentity() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
  const isPWA = (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) || (typeof navigator !== 'undefined' && navigator.standalone === true);
  const isDesktop = ua.includes('Electron') || ua.includes('ValenixiaDesktop');
  const isMobileApp = (typeof location !== 'undefined' && location.protocol === 'file:' && ua.includes('Android')) || typeof window.AndroidInterface !== 'undefined';

  const kind = isPWA ? 'PWA' : (isDesktop ? 'DESKTOP' : (isMobileApp ? 'MOBILE' : 'WEB'));
  const showGetApps = kind === 'WEB';

  window.APP_SURFACE = Object.assign(kind, {
    kind: kind,
    showGetApps: showGetApps,
    toString: function() { return kind; },
    valueOf: function() { return kind; }
  });

  const btnGetApps = typeof document !== 'undefined' ? document.getElementById('btn-topbar-apps-download') : null;
  if (btnGetApps) {
    if (!showGetApps) {
      try { btnGetApps.remove(); } catch (_) { btnGetApps.style.display = 'none'; }
    } else {
      btnGetApps.style.display = 'inline-flex';
    }
  }
})();

// Identity Diagnostic Object (Rule #6 & #7)
window.__VALENIXIA_IDENTITY__ = {
  getSnapshot: function() {
    let instId = localStorage.getItem('valenixia_installation_id');
    if (!instId) {
      instId = 'inst_' + Math.random().toString(36).substring(2, 11);
      localStorage.setItem('valenixia_installation_id', instId);
    }
    return {
      installationId: instId,
      deviceId: localStorage.getItem('valenixia_device_id') || 'dev_web_primary',
      userId: (window.state && window.state.activeCashier) ? window.state.activeCashier.id : 'cashier_local',
      organizationId: localStorage.getItem('valenixia_org_id') || 'org_valenixia_default',
      storeId: localStorage.getItem('valenixia_store_id') || 'store_valenixia_1',
      terminalId: localStorage.getItem('valenixia_terminal_id') || 'terminal_1',
      databaseName: 'valenixia_pos_db',
      databaseSchemaVersion: '17',
      bootstrapCompleted: localStorage.getItem('onboarding_complete') === 'true',
      bootstrapVersion: '2.5.1',
      lastAuthenticatedAt: localStorage.getItem('valenixia_last_auth_at') || new Date().toISOString()
    };
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// BOOTSTRAP DISCOVERY PIPELINE
// Evaluates local identity state and DELEGATES to ValenixiaBootstrap.transition().
//
// CRITICAL: This function MUST NOT directly mutate any boot surface DOM.
// All surface ownership belongs exclusively to ValenixiaBootstrap.
// Any direct style.display / classList writes to #first-boot-wizard,
// #auth-lock-screen, #pos-app-layout, etc. are a SURFACE OWNERSHIP VIOLATION.
// ══════════════════════════════════════════════════════════════════════════════
window.runBootstrapDiscoveryPipeline = function runBootstrapDiscoveryPipeline() {
  // ── DOM READINESS GUARD ────────────────────────────────────────────────────
  // This function may be invoked before the <body> has been parsed (e.g. from
  // <head> at script load time). In that case the surface DOM elements do not
  // exist yet. Running the pipeline would fire _showSurface() on null nodes
  // (silent no-ops), set bootstrapDecisionReady=true, and then _dismissSplash()
  // would hide the boot loader — leaving a blank screen with no surface shown.
  //
  // Solution: abort early if key surface elements are not yet in the DOM.
  // The runWhenDOMReady / DOMContentLoaded listeners below will call this again
  // once the DOM is fully parsed and elements exist.
  // ──────────────────────────────────────────────────────────────────────────
  var surfacesReady = !!(
    document.getElementById('first-boot-wizard') ||
    document.getElementById('auth-lock-screen')  ||
    document.getElementById('pos-app-layout')
  );
  if (!surfacesReady) {
    console.log('[BootstrapDiscovery] DOM not yet ready — deferring identity evaluation until DOMContentLoaded.');
    return;
  }

  if (!window.ValenixiaBootstrap) {
    console.error('[BootstrapDiscovery] ValenixiaBootstrap unavailable — cannot make routing decision.');
    return;
  }

  const hasOnboardingFlag = localStorage.getItem('onboarding_complete') === 'true';
  const hasHydratedFlag   = localStorage.getItem('database_hydrated') === 'true';
  const hasStoreName      = !!localStorage.getItem('store_name');
  const hasStoreId        = !!localStorage.getItem('valenixia_store_id');
  const hasPin            = !!(localStorage.getItem('admin_pin') || localStorage.getItem('employee_pin_hash'));

  const hasAnyData  = hasOnboardingFlag || hasHydratedFlag || hasStoreName || hasStoreId || hasPin;
  const isAllEmpty  = !hasOnboardingFlag && !hasHydratedFlag && !hasStoreName && !hasStoreId && !hasPin;

  if (isAllEmpty) {
    console.log('[BootstrapDiscovery] Decision: ONBOARDING (No store data found)');
    window.ValenixiaBootstrap.transition('DECISION', { onboardingComplete: false });
  } else if (hasAnyData) {
    console.log('[BootstrapDiscovery] Decision: AUTH_LOCK (Store data detected)');
    window.ValenixiaBootstrap.transition('DECISION', { onboardingComplete: hasOnboardingFlag || hasAnyData });
  } else {
    console.warn('[BootstrapDiscovery] Decision: RECOVERY (Ambiguous identity state)');
    window.ValenixiaBootstrap.enterRecovery(
      'Bootstrap could not determine store state. Identity matrix is ambiguous.\n\nRetry to reload, or Continue Offline to use cached data.',
      'INSTALLATION_DISCOVERY', true, true
    );
  }
};

// Run discovery pipeline as soon as the DOM is fully parsed.
// Do NOT attempt to run it at script load time (readyState === 'loading') —
// the surface elements (#first-boot-wizard, #auth-lock-screen, etc.) do not
// exist yet, and premature invocation sets bootstrapDecisionReady=true /
// dismisses the splash while surfaces are still null.
window.runWhenDOMReady(function() {
  if (!window.bootstrapDecisionReady) {
    window.runBootstrapDiscoveryPipeline();
  }
});

// Fast DOM discovery watcher: polls every 20ms as HTML parses until surfaces exist and destination surface is painted
var _domDiscoveryInterval = setInterval(function() {
  if (window.bootVisualReady && !_pendingSurface) {
    clearInterval(_domDiscoveryInterval);
    return;
  }

  // If a surface commit was attempted but its DOM node was missing (e.g. WIZARD before line 3219),
  // retry committing the surface as soon as its DOM element enters the document tree.
  var targetKey = _pendingSurface || (_activeSurface !== 'BOOT' ? _activeSurface : null);
  if (targetKey && SURFACES[targetKey]) {
    var node = el(SURFACES[targetKey]);
    if (node) {
      _pendingSurface = null;
      _showSurface(targetKey);
      return;
    }
  }

  if (!window.bootstrapDecisionReady) {
    var surfacesReady = !!(
      document.getElementById('first-boot-wizard') ||
      document.getElementById('auth-lock-screen')  ||
      document.getElementById('pos-app-layout')
    );
    if (surfacesReady) {
      window.runBootstrapDiscoveryPipeline();
    }
  }
}, 20);
