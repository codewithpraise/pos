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
// EARLY GLOBAL WINDOW EXPORTS — Guaranteed available from millisecond zero
// ══════════════════════════════════════════════════════════════════════════════
window.__realHandlers = window.__realHandlers || {};

if (typeof window.switchActiveScreen !== 'function') {
  window.switchActiveScreen = function(screenId) {
    if (!screenId) return;
    const views = document.querySelectorAll('.content-view');
    views.forEach(v => {
      v.style.display = 'none';
      v.classList.remove('active');
    });
    const target = document.getElementById(screenId);
    if (target) {
      target.style.display = 'block';
      target.classList.add('active');
    }
    const navItems = document.querySelectorAll('.nav-item');
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


// Smooth Boot Progress Engine
window.updateBootProgress = function(percent, text) {
  const loader = document.getElementById('app-boot-loader');
  if (!loader) return;
  const progressEl = document.getElementById('app-boot-loader-progress');
  const statusEl = document.getElementById('app-boot-loader-status');
  const targetPct = Math.min(100, Math.max(0, parseInt(percent, 10) || 0));

  if (progressEl) progressEl.style.width = targetPct + '%';
  if (statusEl && text) statusEl.textContent = text;

  if (targetPct >= 100) {
    loader.style.pointerEvents = 'none';
    loader.style.transition = 'opacity 0.35s ease';
    loader.style.opacity = '0';
    setTimeout(() => {
      try { loader.style.display = 'none'; loader.remove(); } catch (_) {}
    }, 350);
  }
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
    if (!loader || loader.style.display === 'none' || window.appInitialized) {
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

// HARD MAXIMUM BOOT TIMEOUT: If the async boot chain hangs for any reason (DB migration,
// network call, license check), force-dismiss the boot overlay after 10 seconds.
// Without this, a stuck boot loader at z-index:99999 blocks ALL touch input on the screen.
(function installBootSafetyNet() {
  var BOOT_MAX_MS = 10000;
  var bootSafetyTimer = setTimeout(function() {
    if (window.appInitialized) return; // App finished normally, nothing to do
    var loader = document.getElementById('app-boot-loader');
    if (!loader || loader.style.display === 'none') return;
    console.warn('[BootSafety] Boot exceeded ' + BOOT_MAX_MS + 'ms. Force-dismissing loader to unblock touch input.');
    try {
      loader.style.transition = 'opacity 0.4s ease';
      loader.style.opacity = '0';
      loader.style.pointerEvents = 'none';
      setTimeout(function() {
        try { loader.style.display = 'none'; } catch(_) {}
      }, 420);
    } catch(_) {}
  }, BOOT_MAX_MS);
  // Cancel the safety timer cleanly if app initializes normally
  var _origUpdateBoot = window.updateBootProgress;
  window.updateBootProgress = function(percent, text) {
    if (_origUpdateBoot) _origUpdateBoot(percent, text);
    if (parseInt(percent, 10) >= 100) {
      clearTimeout(bootSafetyTimer);
    }
  };
})();

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

window.toggleAppLanguage = function() {
  try {
    if (typeof playAudioSignal === 'function') playAudioSignal('click');
    const cur = localStorage.getItem('valenixia_lang') || 'en';
    const next = cur === 'ur' ? 'en' : 'ur';
    localStorage.setItem('valenixia_lang', next);
    if (window.state && window.state.preferences) window.state.preferences['system_language'] = next;
    const btn = document.getElementById('lang-toggle-btn');
    if (btn) btn.textContent = next === 'ur' ? 'English' : 'اردو';
    document.body.classList.toggle('lang-urdu', next === 'ur');
    if (typeof window.applyI18n === 'function') window.applyI18n(next);
  } catch (e) {
    console.warn('[Lang] Language toggle error:', e);
  }
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

  const overlay = document.createElement('div');
  overlay.id = '__vx-legal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999999999;background:rgba(5,5,8,0.97);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(10px);';
  overlay.innerHTML = `
    <div style="max-width:520px;width:100%;max-height:90vh;background:#0d0d12;border:1px solid rgba(255,255,255,0.12);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 32px 64px rgba(0,0,0,0.8);">
      <div style="padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <span style="font-size:14px;font-weight:800;color:#fff;">${doc.title}</span>
        <button id="__vx-legal-close" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#94a3b8;font-size:18px;width:32px;height:32px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">×</button>
      </div>
      <div style="overflow-y:auto;padding:20px 24px;flex:1;-webkit-overflow-scrolling:touch;color:#cbd5e1;font-size:12px;line-height:1.6;">${doc.content}</div>
      <div style="padding:16px 24px;border-top:1px solid rgba(255,255,255,0.08);flex-shrink:0;">
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

  const payload = `=== VALENIXIA POS DIAGNOSTIC REPORT ===\nTimestamp: ${new Date().toISOString()}\nUser Agent: ${navigator.userAgent}\nActive View: ${document.querySelector('.content-view.active')?.id || 'unknown'}\nStore Name: ${localStorage.getItem('valenixia_store_name') || 'unconfigured'}\n\n--- LOG TRAIL (${logs.length} entries) ---\n${formatted}`;

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

// SPLASH SCREEN TIMEOUT — Fast Boot & View Router
(function splashTimeout() {
  const hideSplash = () => {
    const loader = document.getElementById('app-boot-loader');
    if (loader && typeof window.updateBootProgress === 'function') {
      window.updateBootProgress(100, 'Ready');
    }
    const splashScreen = document.getElementById('splash-screen');
    const bootLoader = document.getElementById('app-boot-loader');
    [splashScreen, bootLoader].forEach(el => {
      if (el) {
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.25s ease';
        el.style.pointerEvents = 'none';
        setTimeout(() => {
          try { el.style.display = 'none'; el.remove(); } catch (_) {}
        }, 250);
      }
    });
    if (document.body && document.body.classList) document.body.classList.remove('splash-active');
    console.log('[Bootstrap] Splash and boot loaders hidden.');

        // ROUTING: Check if onboarding is completed in localStorage
        const isSetupComplete = localStorage.getItem('onboarding_complete') === 'true';

        const wiz = document.getElementById('first-boot-wizard');
        const lock = document.getElementById('auth-lock-screen');
        const layout = document.getElementById('pos-app-layout');

        if (isSetupComplete) {
          // Returning user: hide wizard, hide layout, show lock screen for PIN auth
          if (wiz) { wiz.style.display = 'none'; wiz.classList.remove('active'); }
          if (layout) layout.style.display = 'none';
          if (lock)   { lock.classList.add('active'); lock.style.display = 'flex'; }
        } else {
          // New install -> Show Setup Wizard Step 1
          if (wiz) { wiz.style.display = 'flex'; wiz.classList.add('active'); }
          if (lock)   { lock.style.display = 'none'; lock.classList.remove('active'); }
          if (layout) layout.style.display = 'none';
        }

        // SAFETY NET: If nothing is visible after 4s, force the lock screen or wizard to show
        setTimeout(function() {
          try {
            const layoutDisp = layout ? (layout.style.display || window.getComputedStyle(layout).display) : 'none';
            const isLayoutVis = layoutDisp !== 'none';
            const anyVisible = (
              (wiz && (wiz.style.display === 'flex' || wiz.classList.contains('active'))) ||
              (lock && (lock.classList.contains('active') || lock.style.display === 'flex')) ||
              isLayoutVis
            );
            if (!anyVisible) {
              console.warn('[Bootstrap] Safety net: nothing visible after 4s. Forcing correct view.');
              if (localStorage.getItem('onboarding_complete') === 'true') {
                const lk = document.getElementById('auth-lock-screen');
                const lay = document.getElementById('pos-app-layout');
                if (lk) { lk.classList.add('active'); lk.style.display = 'flex'; }
                if (lay) lay.style.display = 'none';
              } else {
                const wz = document.getElementById('first-boot-wizard');
                if (wz) { wz.style.display = 'flex'; wz.classList.add('active'); }
                const p1 = document.getElementById('wiz-panel-1');
                if (p1) p1.style.display = 'flex';
              }
            }
          } catch(e) { console.error('[Bootstrap] Safety net error:', e); }
        }, 4000);
    };
  
  // Fast Failsafe: hide splash after 800ms
  setTimeout(hideSplash, 800);
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



// Global showModal helper — production-safe with backdrop dismiss, Escape key, and no-leak guarantee
window.showModal = function({ title, message, type = 'info', actions = [{ id: 'ok', label: 'OK', style: 'primary' }], input = null }) {
  return new Promise((resolve) => {
    // Unique class so we can find and nuke orphans later
    const OVERLAY_CLASS = '__vx-global-modal-overlay';

    const overlay = document.createElement('div');
    overlay.className = OVERLAY_CLASS;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:999999999;display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);font-family:sans-serif;';

    let inputHtml = '';
    if (input) {
      inputHtml = '<input id="__modal-input" type="' + escapeHTML(input.type || 'text') + '" placeholder="' + escapeHTML(input.placeholder || '') + '" value="' + escapeHTML(input.defaultValue || '') + '" style="width:100%;margin-top:16px;padding:12px;background:#1a1a1a;border:1px solid rgba(255,255,255,0.1);color:#fff;border-radius:6px;outline:none;font-size:14px;box-sizing:border-box;" />';
    }
    const buttonsHtml = actions.map(act => {
      const bg = act.style === 'danger' ? '#ef4444' : (act.style === 'primary' ? '#10b981' : 'transparent');
      const border = act.style === 'secondary' ? '1px solid rgba(255,255,255,0.15)' : 'none';
      const color = act.style === 'secondary' ? '#9ca3af' : '#fff';
      return '<button data-id="' + escapeHTML(act.id) + '" style="flex:1;padding:12px;background:' + bg + ';border:' + border + ';color:' + color + ';font-weight:700;border-radius:6px;cursor:pointer;font-size:13px;font-family:inherit;min-height:44px;touch-action:manipulation;">' + escapeHTML(act.label) + '</button>';
    }).join('');

    overlay.innerHTML = '<div id="__vx-modal-card" style="background:#0f0f11;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;max-width:400px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,0.5);"><h3 style="color:#fff;font-size:16px;font-weight:800;margin-bottom:10px;font-family:inherit;">' + escapeHTML(title) + '</h3><p style="color:#9ca3af;font-size:13px;line-height:1.6;white-space:pre-wrap;margin:0;font-family:inherit;">' + escapeHTML(message) + '</p>' + inputHtml + '<div style="display:flex;gap:12px;margin-top:24px;">' + buttonsHtml + '</div></div>';

    let settled = false;
    function settle(val) {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener('keydown', onEsc, true);
      resolve(val);
    }

    // Button click handlers
    overlay.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = input ? (document.getElementById('__modal-input')?.value ?? btn.dataset.id) : btn.dataset.id;
        settle(val || btn.dataset.id);
      });
    });

    // Backdrop click (clicking outside the card) → dismiss with first action id (usually 'cancel' or 'ok')
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        const defaultId = (actions.find(a => a.style === 'secondary') || actions[0] || { id: 'cancel' }).id;
        settle(defaultId);
      }
    });

    // Escape key to dismiss
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
// BOOT WATCHDOG — Prevents stuck loading screen on first install or DB failure
// If the loader is still visible after 30 seconds, force it away and show the
// app (which will then show either the wizard or lock screen based on state).
// ══════════════════════════════════════════════════════════════════════════════
(function installBootWatchdog() {
  const WATCHDOG_MS = 10000; // 10 seconds maximum fail-safe timeout
  const watchdogTimer = setTimeout(function() {
    try {
      if (document.getElementById('license-lockout-overlay')) {
        console.log('[Watchdog] License lockout overlay active; skipping watchdog auto-dismissal.');
        const loader = document.getElementById('app-boot-loader');
        if (loader) { try { loader.style.display = 'none'; loader.remove(); } catch(_) {} }
        return;
      }
      const splash = document.getElementById('splash-screen');
      const loader = document.getElementById('app-boot-loader');
      if (loader || splash) {
        console.warn('[Watchdog] Boot task incomplete after 10s. Force-dismissing bootloader to prevent frozen screen.');
        [splash, loader].forEach(el => {
          if (el && el.style.display !== 'none') {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.2s';
            setTimeout(() => { try { el.style.display = 'none'; el.remove(); } catch(_) {} }, 200);
          }
        });

        // Best-effort: ensure we're showing SOMETHING after loader is gone
        const lockScreen = document.getElementById('auth-lock-screen');
        const layout = document.getElementById('pos-app-layout');
        const wizard = document.getElementById('first-boot-wizard');
        const isOnboarded = localStorage.getItem('onboarding_complete') === 'true';

        if (!isOnboarded) {
          if (wizard) wizard.style.display = 'flex';
        } else {
          if (lockScreen) lockScreen.classList.add('active');
          if (layout) layout.style.display = 'none';
        }
      }
    } catch (err) {
      console.error('[Watchdog] Error in boot watchdog:', err);
    }
  }, WATCHDOG_MS);

  // Cancel watchdog if loader is removed normally (app booted fine)
  const observer = new MutationObserver(function(mutations) {
    const loader = document.getElementById('app-boot-loader');
    if (!loader || loader.style.display === 'none') {
      clearTimeout(watchdogTimer);
      observer.disconnect();
    }
  });
  window.runWhenDOMReady(function() {
    const loader = document.getElementById('app-boot-loader');
    if (loader) observer.observe(loader, { attributes: true, attributeFilter: ['style'] });
    else clearTimeout(watchdogTimer);
  });
})();

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
  document.getElementById('btn-force-open-app')?.addEventListener('click', function() {
    if (typeof window.updateBootProgress === 'function') window.updateBootProgress(100, 'Ready');
  });
});
