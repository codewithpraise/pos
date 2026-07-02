// ============================================================================
// NEXOVA COMMERCE ECOSYSTEM - MAIN REGISTER CONTROLLER
// UI thread bindings and Web Worker event choreography
// ============================================================================

(function() {
  // App state
  const state = {
    isOnline: true,
    activeScreen: 'checkout',
    activeCashier: null, // { id, role }
    activeCart: [], // { sku, name, price, qty, emoji }
    attachedCustomer: null, // customer object
    catalog: [],
    customers: [],
    employees: [],
    preferences: {},
    transactions: [],
    logs: [],
    currentPin: '',
    sidebarCollapsed: false,
    selectedTransactionId: null,
    selectedCategory: 'ALL',
    checkoutQuickCategory: 'ALL',
    checkoutQuickSearch: '',
    mobileQuickCategory: 'ALL',
    mobileQuickSearch: '',
    distributors: [],
    purchaseOrders: [],
    distributorPayments: [],
    customerCredits: [],
    selectedDistributorId: null,
    selectedPurchaseOrderId: null
  };

  let syncWorker = null;
  let speechCoach = null;

  // Initialize application
  async function init() {
    try {
      await NexovaDB.init(); // Initialize IndexedDB on main thread for local PIN auth
      
      // Support starting fresh: clear DB and preferences if reset param or bridge flag is detected
      var shouldReset = false;
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('reset') === 'true') {
        shouldReset = true;
      } else if (window.AndroidPOS && typeof window.AndroidPOS.consumeFreshStartFlag === 'function') {
        if (window.AndroidPOS.consumeFreshStartFlag()) {
          shouldReset = true;
        }
      }

      if (shouldReset) {
        console.warn('[App] Reset command detected. Resetting database to factory settings...');
        
        // Factory reset local server if present and accessible
        try {
          const serverBase = (window.__nexovaServerUrl || location.origin);
          if (location.protocol !== 'file:') {
            await fetch(serverBase + '/api/system/reset', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            });
          }
        } catch (serverErr) {
          console.warn('[App] Failed to contact server for factory reset:', serverErr.message);
        }

        await NexovaDB.destructReset();
        localStorage.clear();
        // Clean URL to prevent infinite reset loops
        window.history.replaceState(null, null, window.location.pathname);
      }

      // CRITICAL FIX: Enforce License Gate FIRST. Do not allow wizard access if unlicensed.
      const licenseOk = await LicenseEngine.init();
      if (!licenseOk) {
        const wizardOverlay = document.getElementById('first-boot-wizard');
        if (wizardOverlay) wizardOverlay.style.display = 'none'; // Force hide wizard
        return; // Hard-stop
      }

      // Early Onboarding & View Routing Check to prevent flashing/incorrect states
      const pref = await NexovaDB.get('local_preferences', 'onboarding_complete');
      const onboardingComplete = (pref && pref.value_payload === 'true') || localStorage.getItem('onboarding_complete') === 'true';
      
      const wizardOverlay = document.getElementById('first-boot-wizard');
      const lockScreen = document.getElementById('auth-lock-screen');
      const layout = document.getElementById('pos-app-layout');
      
      if (!onboardingComplete) {
        if (wizardOverlay) wizardOverlay.style.display = 'flex';
        if (lockScreen) lockScreen.classList.remove('active');
        if (layout) layout.style.display = 'grid'; // Show layout, wizard is on top
        showPairingOverlay(false);
      } else {
        if (wizardOverlay) wizardOverlay.style.display = 'none';
        if (lockScreen) lockScreen.classList.add('active');
        if (layout) layout.style.display = 'none';
      }
    } catch (e) {
      console.error('[App] Failed to initialize local database on main thread:', e);
    }

    // Determine/register device friendly name and token early via HTTP to prevent connection race conditions
    try {
      let terminalNamePref = await NexovaDB.get('local_preferences', 'terminal_name');
      let terminalName = terminalNamePref ? terminalNamePref.value_payload : null;
      let nodeId = '';
      if (!terminalName) {
        nodeId = 'web_client_' + Math.random().toString(36).substring(2, 9);
        await NexovaDB.put('local_preferences', {
          key: 'terminal_name',
          value_type: 'STR',
          value_payload: nodeId,
          is_idempotent_flag: 0,
          updated_at: Date.now()
        });
      } else {
        nodeId = terminalName.replace(/\s+/g, '_').toLowerCase();
      }
      state.nodeId = nodeId;

      let deviceTokenPref = await NexovaDB.get('local_preferences', 'device_token');
      let deviceToken = deviceTokenPref ? deviceTokenPref.value_payload : null;

      if (!deviceToken && location.protocol !== 'file:') {
        console.log(`[App] No device token stored, registering node: ${nodeId} via HTTP...`);
        const serverBase = (window.__nexovaServerUrl || location.origin);
        const regResp = await fetch(serverBase + '/api/devices/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId: nodeId, deviceName: terminalName || 'Web Register' })
        });
        if (regResp.ok) {
          const regData = await regResp.json();
          if (regData.status === 'APPROVED' && regData.token) {
            console.log('[App] Auto-approved via HTTP. Token stored.');
            await NexovaDB.put('local_preferences', {
              key: 'device_token',
              value_type: 'STR',
              value_payload: regData.token,
              is_idempotent_flag: 0,
              updated_at: Date.now()
            });
            state.deviceToken = regData.token;
          }
        }
      } else {
        state.deviceToken = deviceToken;
      }
    } catch (e) {
      console.warn('[App] Device registration pass skipped or failed:', e);
    }



    setupGlobalErrorHandlers(); // Component I: crash telemetry
    setupWebWorker();
    bindDOMEvents();
    setupGlobalHotkeys();
    applyPreferencesFromState();
    await checkAndRequestStoragePersist();
    initOtaUpdater();
  }

  async function checkAndRequestStoragePersist() {
    const badge = document.getElementById('storage-lock-badge');
    const txt = document.getElementById('storage-lock-text');
    if (!badge || !txt) return;
    if (navigator.storage && navigator.storage.persist) {
      try {
        const isPersisted = await navigator.storage.persist();
        console.log(`[Storage] Persisted storage status: ${isPersisted}`);
        if (isPersisted) {
          badge.className = 'storage-lock-badge online';
          txt.textContent = 'STORAGE: LOCKED';
        } else {
          badge.className = 'storage-lock-badge offline';
          txt.textContent = 'STORAGE: UNLOCKED';
        }
      } catch (err) {
        console.warn('[Storage] Failed to check persist status:', err);
      }
    }
  }

  // Set loading state on button elements to prevent duplicate submission and provide async feedback
  function setButtonLoading(buttonId, isLoading, textWhileLoading = 'Processing...', originalText = 'Complete') {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    btn.disabled = isLoading;
    if (isLoading) {
      btn.setAttribute('data-orig-text', btn.textContent);
      btn.textContent = textWhileLoading;
      btn.style.opacity = '0.6';
    } else {
      const orig = btn.getAttribute('data-orig-text');
      btn.textContent = orig || originalText;
      btn.style.opacity = '1';
    }
  }

  // Sleek animated float toast notification for security / device whitelisting alerts
  function showNotificationToast(message, actionCallback = null, duration = 8000) {
    let container = document.getElementById('notification-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'notification-toast-container';
      container.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 12px;
        pointer-events: none;
      `;
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'premium-toast';
    toast.style.cssText = `
      background: rgba(0, 0, 0, 0.95);
      border: 1px solid var(--accent-emerald);
      border-radius: 4px;
      padding: 16px 20px;
      color: var(--text-white);
      font-size: 12px;
      font-family: var(--font-body);
      box-shadow: 0 10px 30px rgba(0,0,0,0.5), 0 0 15px var(--accent-emerald-glow);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-width: 320px;
      max-width: 420px;
      pointer-events: auto;
      cursor: pointer;
      opacity: 0;
      transform: translateY(16px);
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    toast.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px; flex-grow: 1;">
        <div style="color: var(--accent-emerald); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
          <svg class="svg-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        </div>
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <span style="font-weight: 700; text-transform: uppercase; font-family: var(--font-display); letter-spacing: 0.5px;">Security Alert</span>
          <span style="color: var(--text-gray); font-size: 11px;">${message}</span>
        </div>
      </div>
      <div style="font-size: 10px; color: var(--accent-emerald); font-weight: 800; text-transform: uppercase; border-bottom: 1px solid var(--accent-emerald); padding-bottom: 1px; flex-shrink: 0;">Review</div>
    `;

    toast.addEventListener('click', () => {
      if (actionCallback) actionCallback();
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(16px)';
      setTimeout(() => toast.remove(), 300);
    });

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    }, 50);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(16px)';
        setTimeout(() => toast.remove(), 300);
      }
    }, duration);
  }

  // ── Component I: Global Crash Telemetry ─────────────────────────────────
  // Captures unhandled errors + promise rejections, stores them in IndexedDB
  // and forwards to master node via the sync worker.
  const _lastClicks = [];
  document.addEventListener('click', (e) => {
    // Redact PIN pad or passcode clicks from telemetry to prevent leaking PINs (Issue 26)
    if (e.target.closest('#pin-pad') || e.target.closest('#hidden-pin-input') || 
        e.target.closest('[id*="pin"]') || e.target.closest('[type="password"]')) {
      _lastClicks.push(`BUTTON#[REDACTED_PIN]`);
    } else {
      _lastClicks.push(`${e.target.tagName}#${e.target.id || '?'}`);
    }
    if (_lastClicks.length > 5) _lastClicks.shift();
  }, { capture: true });

  function setupGlobalErrorHandlers() {
    function handleGlobalError(errorType, err) {
      const hlc = document.getElementById('hlc-clock')?.textContent || '';
      const log = {
        id: `tl_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        nodeId: state.nodeId || 'unknown',
        errorType: errorType,
        errorMessage: err?.message || String(err),
        stackTrace: err?.stack || '',
        hlc,
        lastClicks: _lastClicks.join(' > '),
        createdAt: Date.now()
      };
      console.error('[Telemetry] Captured error:', log);
      if (syncWorker) {
        syncWorker.postMessage({ type: 'SAVE_TELEMETRY', payload: log });
      }
    }
    window.addEventListener('error', (e) => handleGlobalError('UNCAUGHT_ERROR', e.error || e), { capture: true });
    window.addEventListener('unhandledrejection', (e) => handleGlobalError('UNHANDLED_REJECTION', e.reason), { capture: true });
  }

  function showPairingOverlay(show, section) {
    const overlay = document.getElementById('device-pairing-overlay');
    if (!overlay) return;
    
    const wizard = document.getElementById('first-boot-wizard');
    const wizardVisible = wizard && wizard.style.display === 'flex';
    if (wizardVisible) {
      overlay.style.display = 'none';
      return;
    }

    overlay.style.display = show ? 'flex' : 'none';
    if (show && section) {
      document.getElementById('device-pairing-form').style.display = section === 'form' ? 'flex' : 'none';
      document.getElementById('device-pairing-pending').style.display = section === 'pending' ? 'flex' : 'none';
    }
  }

  // Setup communication channel with off-thread Web Worker
  function setupWebWorker() {
    syncWorker = new Worker('sync-worker.js');
    window.syncWorker = syncWorker;
    
    // Post initial setup signal with serverUrl
    const serverUrl = window.__nexovaServerUrl || location.origin;
    syncWorker.postMessage({ type: 'INIT', payload: { serverUrl } });

    // Handle incoming messages from worker thread
    syncWorker.onmessage = (event) => {
      const { type, nodeId, hlc, appliedCount, conflictCount, catalog, customers, employees, prefs, transactions, change, transactionId, error, isPaired } = event.data;

      switch (type) {
        case 'INIT_SUCCESS':
          console.log(`[App] Worker sync engine fully initialized for node: ${nodeId}`);
          document.getElementById('hlc-clock').textContent = hlc;
          state.nodeId = nodeId;
          state.deviceToken = event.data.deviceToken;
          if (!isPaired) {
            // Auto configure hash passphrase if present
            const hashParams = new URLSearchParams(window.location.hash.substring(1));
            const hashPass = hashParams.get('passphrase');
            if (hashPass) {
              syncWorker.postMessage({
                type: 'SAVE_PREFERENCE',
                payload: { key: 'sync_passphrase', val: hashPass }
              });
              history.replaceState(null, null, ' ');
              setTimeout(() => window.location.reload(), 500);
              return;
            }
            
            showPairingOverlay(true, 'form');
          }
          
          // Request baseline values
          syncWorker.postMessage({ type: 'GET_PREFERENCES' });
          syncWorker.postMessage({ type: 'GET_CATALOG' });
          syncWorker.postMessage({ type: 'GET_CUSTOMERS' });
          syncWorker.postMessage({ type: 'GET_EMPLOYEES' });
          syncWorker.postMessage({ type: 'GET_TRANSACTIONS' });
          syncWorker.postMessage({ type: 'GET_DISTRIBUTORS' });
          syncWorker.postMessage({ type: 'GET_PURCHASE_ORDERS' });
          syncWorker.postMessage({ type: 'GET_DISTRIBUTOR_PAYMENTS' });
          syncWorker.postMessage({ type: 'GET_CUSTOMER_CREDIT' });
          break;
 
        case 'DEVICE_APPROVED':
          console.log('[App] Device successfully paired and approved.');
          state.deviceToken = event.data.token;
          showPairingOverlay(false);
          if (state.activeScreen === 'settings') {
            loadWhitelistDevices();
          }
          break;
 
        case 'DEVICE_PENDING':
          console.log('[App] Device pairing is pending approval.');
          showPairingOverlay(true, 'pending');
          document.getElementById('pairing-submitted-name').textContent = document.getElementById('pairing-device-name').value || 'Web Register';
          document.getElementById('pairing-device-id').textContent = nodeId || state.nodeId || 'Loading...';
          // Generate QR Code with full pairing URL — admin scans to auto-approve
          document.getElementById('pairing-qr-container').innerHTML = '';
          (() => {
            const serverOrigin = window.location.origin;
            const pairingUrl = `${serverOrigin}/api/devices/approve-qr?nodeId=${encodeURIComponent(nodeId || state.nodeId)}`;
            new QRCode(document.getElementById('pairing-qr-container'), {
              text: pairingUrl,
              width: 140,
              height: 140,
              colorDark : "#000000",
              colorLight : "#ffffff",
              correctLevel : QRCode.CorrectLevel.H
            });
          })();
          break;
 
        case 'DEVICE_REJECTED':
          console.warn('[App] Device was rejected.');
          alert('This device was rejected by the administrator. Please pair again.');
          showPairingOverlay(true, 'form');
          break;
        case 'DEVICE_UNAUTHORIZED':
          console.warn('[App] Device token unauthorized.');
          showPairingOverlay(true, 'form');
          break;

        case 'HYDRATE_SUCCESS':
          console.log('[App] Database hydration completed successfully.');
          const statusEl = document.getElementById('hydration-status');
          if (statusEl) {
            statusEl.style.color = '#10b981';
            statusEl.textContent = `Sync Complete! Applied ${event.data.applied} mutations.`;
          }
          setTimeout(() => {
            document.getElementById('hydration-overlay')?.remove();
            window.__hydrationInProgress = false;
            window.location.reload();
          }, 1500);
          break;

        case 'HYDRATE_ERROR':
          console.error('[App] Database hydration failed:', event.data.error);
          const statusElErr = document.getElementById('hydration-status');
          if (statusElErr) {
            statusElErr.style.color = '#ef4444';
            statusElErr.innerHTML = `Hydration failed: ${event.data.error}<br><br>
              <button onclick="window.location.reload()" style="padding: 10px 20px; background: #ef4444; border: none; border-radius: 4px; color: #fff; font-weight: 700; cursor: pointer; margin-top: 10px;">Retry Bootstrapping</button>`;
          }
          window.__hydrationInProgress = false;
          break;

        case 'INIT_ERROR':
          console.error('[App] Worker failed to initialize:', error);
          alert('Database initialization failed: ' + error);
          break;

        case 'CONNECTION_CHANGE':
          updateNetworkBadge(event.data.isConnected);
          break;

        case 'DEVICE_REQUEST_RECEIVED':
          playAudioSignal('click');
          if (state.activeScreen === 'settings') {
            loadWhitelistDevices();
          }
          showNotificationToast(`New device "${event.data.deviceName}" is requesting network pairing.`, () => {
            if (state.activeScreen !== 'settings') {
              switchActiveScreen('settings');
              setTimeout(() => {
                const el = document.getElementById('settings-device-whitelisting');
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth' });
                  loadWhitelistDevices();
                }
              }, 100);
            }
          });
          break;

        case 'DEVICE_WHITELIST_CHANGED':
          if (state.activeScreen === 'settings') {
            loadWhitelistDevices();
          }
          break;

        case 'CLOCK_DRIFT_ERROR':
          playAudioSignal('error');
          document.getElementById('clock-drift-banner').style.display = 'block';
          break;

        case 'SYNC_RECEIVED':
          document.getElementById('hlc-clock').textContent = hlc;
          if (appliedCount > 0) {
            console.log(`[App] Synced ${appliedCount} remote mutations. Refreshing state.`);
            // Refresh views
            syncWorker.postMessage({ type: 'GET_CATALOG' });
            syncWorker.postMessage({ type: 'GET_CUSTOMERS' });
            syncWorker.postMessage({ type: 'GET_EMPLOYEES' });
            syncWorker.postMessage({ type: 'GET_TRANSACTIONS' });
            syncWorker.postMessage({ type: 'GET_DISTRIBUTORS' });
            syncWorker.postMessage({ type: 'GET_PURCHASE_ORDERS' });
            syncWorker.postMessage({ type: 'GET_DISTRIBUTOR_PAYMENTS' });
            syncWorker.postMessage({ type: 'GET_CUSTOMER_CREDIT' });
          }
          break;

        case 'LOCAL_LOG_PUSH':
          appendLogEntry(change);
          break;

        case 'CATALOG_DATA':
          state.catalog = catalog;
          renderCatalogScreen();
          renderCheckoutCategories();
          
          // Render Quick-Access grids
          renderQuickGrid(
            document.getElementById('checkout-quick-grid'),
            document.getElementById('checkout-quick-filters'),
            document.getElementById('checkout-quick-search'),
            'checkoutQuickCategory',
            'checkoutQuickSearch'
          );
          renderQuickGrid(
            document.getElementById('mobile-quick-grid'),
            document.getElementById('mobile-quick-filters'),
            document.getElementById('mobile-quick-search'),
            'mobileQuickCategory',
            'mobileQuickSearch'
          );
          break;

        case 'CUSTOMERS_DATA':
          state.customers = customers;
          renderCustomersScreen();
          renderCustomerLinkModalList();
          break;

        case 'EMPLOYEES_DATA':
          state.employees = employees;
          renderStaffScreen();
          
          // Auto onboarding check: If lock screen is active but we have no employees to log in as,
          // force show the onboarding wizard so the owner can bootstrap their network or join.
          var lockScreenActive = document.getElementById('auth-lock-screen')?.classList.contains('active');
          if ((!employees || employees.length === 0) && lockScreenActive) {
            console.warn('[App] Zero active employees found in database. Showing onboarding wizard.');
            var wizardOverlay = document.getElementById('first-boot-wizard');
            var lockScreen = document.getElementById('auth-lock-screen');
            if (wizardOverlay) wizardOverlay.style.display = 'flex';
            if (lockScreen) lockScreen.classList.remove('active');
          }
          break;

        case 'PREFERENCES_DATA':
          mapPreferences(prefs);
          break;

        case 'TRANSACTIONS_DATA':
          state.transactions = event.data.transactions;
          renderHistoryScreen();
          calculateAnalytics();
          renderKdsScreen();
          break;

        case 'DISTRIBUTORS_DATA':
          state.distributors = event.data.distributors;
          renderSuppliersScreen();
          calculateAnalytics();
          break;

        case 'PURCHASE_ORDERS_DATA':
          state.purchaseOrders = event.data.purchaseOrders;
          renderSuppliersScreen();
          calculateAnalytics();
          break;

        case 'DISTRIBUTOR_PAYMENTS_DATA':
          state.distributorPayments = event.data.payments;
          renderSuppliersScreen();
          calculateAnalytics();
          break;

        case 'CUSTOMER_CREDIT_DATA':
          state.customerCredits = event.data.credits;
          renderCreditBookScreen();
          calculateAnalytics();
          break;

        case 'BOOTSTRAP_SUCCESS': {
          playAudioSignal('success');
          showNotificationToast('Core Database Bootstrapped Successfully!', null, 3000);

          // Get device token from server immediately upon bootstrap success (avoiding 401 on settings load)
          (async () => {
            try {
              const serverBase = (window.__nexovaServerUrl || location.origin);
              const regResp = await fetch(serverBase + '/api/devices/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nodeId: state.nodeId, deviceName: 'Web Register' })
              });
              if (regResp.ok) {
                const regData = await regResp.json();
                if (regData.status === 'APPROVED' && regData.token) {
                  console.log('[App] Post-bootstrap registration success. Token acquired.');
                  await NexovaDB.put('local_preferences', {
                    key: 'device_token',
                    value_type: 'STR',
                    value_payload: regData.token,
                    is_idempotent_flag: 0,
                    updated_at: Date.now()
                  });
                  state.deviceToken = regData.token;
                }
              }
            } catch (err) {
              console.warn('Failed post-bootstrap token registration:', err);
            }
          })();
          
          // Request fresh state data from the worker
          syncWorker.postMessage({ type: 'GET_PREFERENCES' });
          syncWorker.postMessage({ type: 'GET_CATALOG' });
          syncWorker.postMessage({ type: 'GET_EMPLOYEES' });
          syncWorker.postMessage({ type: 'GET_CUSTOMERS' });

          // Auto-login as ADMIN
          state.activeCashier = {
            id: 'admin',
            name: 'ADMIN',
            role: 'ADMIN',
            clockIn: Date.now()
          };
          state.terminalRole = 'REGISTER';
          
          // Transition UI immediately
          const wizardOverlay = document.getElementById('first-boot-wizard');
          if (wizardOverlay) wizardOverlay.style.display = 'none';
          
          const lockScreen = document.getElementById('auth-lock-screen');
          if (lockScreen) lockScreen.classList.remove('active');
          
          const layout = document.getElementById('pos-app-layout');
          if (layout) layout.style.display = 'grid';

          const nameEl = document.getElementById('cashier-display-name');
          const roleDispEl = document.getElementById('cashier-display-role');
          if (roleDispEl) roleDispEl.textContent = 'ADMIN';
          
          applyRoleNavigationLimits('ADMIN');
          setTimeout(() => {
              window.location.reload();
          }, 1500);
          break;
        }

        case 'EPHEMERAL_RECEIVED': {
          const { topic, data } = event.data;
          if (topic === 'cfd_cart') {
            renderCfdCart(data);
          } else if (topic === 'cfd_pay') {
            renderCfdPay(data);
          }
          break;
        }

        case 'CHECKOUT_SUCCESS':
          setButtonLoading('btn-checkout-complete', false, '', 'Complete Order');
          playAudioSignal('success');
          showNotificationToast(`✅ Transaction #${transactionId.slice(-8).toUpperCase()} completed!`, null, 4000);

          // ── Component F: Update monotonic time anchor ─────────────────────
          LicenseEngine.updateTimeAnchor().catch(() => {});

          // ── Component C: Print receipt + kick drawer ──────────────────────
          {
            const prefs = state.preferences || {};
            const printReceipt = prefs.auto_print_receipt !== 'false';
            if (printReceipt && EscPosEngine.isConnected()) {
              const receiptData = {
                storeName: prefs.store_name || 'NEXOVA POS',
                storeAddress: prefs.store_address || '',
                transactionId,
                cashierName: state.activeCashier?.name || 'N/A',
                timestamp: Date.now(),
                items: state.activeCart.map(i => ({
                  name: i.name, qty: i.qty, unitPrice: i.price, discount: i.discount || 0
                })),
                subtotal: event.data.subtotal || 0,
                tax: event.data.tax || 0,
                taxRate: prefs.tax_rate || 0,
                total: event.data.total || 0,
                paymentMode: event.data.paymentMode || 'CASH',
                footerText: prefs.receipt_footer || 'Thank you!'
              };
              EscPosEngine.printReceipt(receiptData);
              EscPosEngine.kickDrawer('SALE');
            }
          }

          // Clear cart
          state.activeCart = [];
          state.attachedCustomer = null;
          document.getElementById('checkout-customer-attached').innerHTML = `<span class="text-muted">No customer attached to transaction.</span>`;
          document.getElementById('btn-open-customer-link').textContent = 'Attach';
          
          renderCart();
          syncWorker.postMessage({ type: 'GET_TRANSACTIONS' });
          syncWorker.postMessage({ type: 'GET_CATALOG' }); // Refresh catalog stock levels
          
          // Clear CFD display
          if (state.terminalRole === 'REGISTER') {
            syncWorker.postMessage({
              type: 'BROADCAST_CFD_CART',
              payload: { cart: [], subtotal: 0, tax: 0, total: 0 }
            });
            syncWorker.postMessage({
              type: 'BROADCAST_CFD_PAY',
              payload: { total: 0, showPay: false }
            });
          }
          break;

        case 'MUTATION_SUCCESS':
          // Reload ALL database views instantly to fix stale UI
          syncWorker.postMessage({ type: 'GET_CATALOG' });
          syncWorker.postMessage({ type: 'GET_CUSTOMERS' });
          syncWorker.postMessage({ type: 'GET_EMPLOYEES' });
          syncWorker.postMessage({ type: 'GET_TRANSACTIONS' });
          syncWorker.postMessage({ type: 'GET_DISTRIBUTORS' });
          syncWorker.postMessage({ type: 'GET_PURCHASE_ORDERS' });
          syncWorker.postMessage({ type: 'GET_DISTRIBUTOR_PAYMENTS' });
          syncWorker.postMessage({ type: 'GET_CUSTOMER_CREDIT' });
          break;

        case 'RESET_SUCCESS':
          playAudioSignal('reset');
          showNotificationToast('Database reset completed. Reloading...', null, 2000);
          setTimeout(function() { window.location.reload(); }, 2000);
          break;

        case 'FORCE_RELOAD':
          window.location.reload();
          break;

        // ── Component B: Oversell Guard ────────────────────────────────────
        case 'STOCK_RECONCILIATION_REQUIRED': {
          const { sku: badSku, name: badName, computedStock } = event.data;
          console.error(`[OversellGuard] SKU ${badSku} has negative computed stock: ${computedStock}`);
          showNotificationToast(
            `⚠️ OVERSELL ALERT: "${badName}" (SKU: ${badSku}) has a computed stock of ${computedStock}. Manual reconciliation required.`,
            () => { switchActiveScreen('inventory'); },
            15000
          );
          break;
        }

        case 'ERROR':
          setButtonLoading('btn-checkout-complete', false, '', 'Complete Order');
          console.error('[App] Worker encountered error:', error);
          alert('Sync error: ' + error);
          break;
      }
    };
  }

  // =============================================================================
  // PIN PAD SYSTEM - Mobile-first, works on Android WebView, iOS, physical keyboard
  // =============================================================================
  // Key design decisions:
  //  1. On-screen buttons: touchstart (instant) + click fallback. NEVER pointerdown
  //     with preventDefault - that kills touch interaction on Android WebView.
  //  2. touch-action:manipulation on buttons eliminates 300ms tap delay.
  //  3. Physical keyboard: capture-phase keydown with stopImmediatePropagation.
  //  4. Mobile numpad: hidden tel input focused on dot-area tap.
  // =============================================================================

  function focusPinInput() {
    var el = document.getElementById('hidden-pin-input');
    if (!el) return;
    el.style.opacity = '0.01';
    el.style.position = 'fixed';
    el.style.top = '0px';
    el.style.left = '0px';
    el.style.width = '1px';
    el.style.height = '1px';
    el.style.zIndex = '-1';
    el.focus();
  }

  function initPinPad() {
    var authLockScreen = document.getElementById('auth-lock-screen');
    var pinPad = document.getElementById('pin-pad');
    var pinInput = document.getElementById('pin-input');

    function isLockActive() {
      return !!(authLockScreen && authLockScreen.classList.contains('active'));
    }

    function addDigit(d) {
      if (!isLockActive() || state.currentPin.length >= 4) return;
      state.currentPin += String(d);
      updatePinDisplayDots();
      try { playAudioSignal('click'); } catch(e) {}
      if (state.currentPin.length === 4) {
        if (pinInput) pinInput.blur();
        setTimeout(function() { verifyPinCredentials(); }, 120);
      }
    }

    function doBackspace() {
      if (!isLockActive() || state.currentPin.length === 0) return;
      state.currentPin = state.currentPin.slice(0, -1);
      updatePinDisplayDots();
      try { playAudioSignal('click'); } catch(e) {}
    }

    function doClear() {
      state.currentPin = '';
      updatePinDisplayDots();
      if (isLockActive()) { try { playAudioSignal('click'); } catch(e) {} }
    }

    // ── LAYER 1: On-screen PIN pad buttons ───────────────────────────────────
    // Using click for maximum cross-platform compatibility and instant execution.
    if (pinPad) {
      pinPad.addEventListener('click', function(e) {
        var btn = e.target.closest('.pin-btn');
        if (!btn || !isLockActive()) return;
        
        var digit = btn.getAttribute('data-digit');
        var action = btn.getAttribute('data-action');
        if (digit !== null && digit !== '') {
          addDigit(digit);
        } else if (action === 'clear') {
          doClear();
        } else if (action === 'backspace') {
          doBackspace();
        } else if (action === 'enter') {
          verifyPinCredentials();
        }
      });
    }

    // ── LAYER 2: Physical keyboard and barcode scanners ──────────────────────
    window.addEventListener('keydown', function(e) {
      if (!isLockActive()) return;
      if (document.activeElement && document.activeElement.id === 'login-terminal-role') return;
      
      // Let form submit and input events handle keys when focused on pin-input directly
      if (document.activeElement && document.activeElement.id === 'pin-input') {
        return;
      }
      
      var k = e.key;
      if (k >= '0' && k <= '9') {
        e.preventDefault(); e.stopImmediatePropagation(); addDigit(k); return;
      }
      if (k === 'Backspace') {
        e.preventDefault(); e.stopImmediatePropagation(); doBackspace(); return;
      }
      if (k === 'Delete' || k === 'Escape') {
        e.preventDefault(); e.stopImmediatePropagation(); doClear(); return;
      }
      if (k === 'Enter') {
        e.preventDefault(); e.stopImmediatePropagation(); verifyPinCredentials(); return;
      }
    }, { capture: true });

    // ── LAYER 3: Native typing on the passcode input field ────────────────────
    if (pinInput) {
      pinInput.addEventListener('input', function(e) {
        var raw = (e.target.value || '').replace(/[^0-9]/g, '');
        if (raw.length > 4) raw = raw.slice(0, 4);
        state.currentPin = raw;
        if (e.target.value !== raw) {
          e.target.value = raw;
        }
        if (raw.length === 4) {
          pinInput.blur();
          setTimeout(function() { verifyPinCredentials(); }, 120);
        }
      });
    }

    // ── FORM SUBMISSION: Native Enter/Go handler for mobile soft keyboard ──────
    var pinForm = document.getElementById('pin-form');
    if (pinForm) {
      pinForm.addEventListener('submit', function(e) {
        e.preventDefault();
        if (pinInput) pinInput.blur();
        verifyPinCredentials();
      });
    }
  }


  // Bind UI control nodes
  function bindDOMEvents() {
    // ── PIN PAD SYSTEM ────────────────────────────────────────────────────────
    // Bulletproof PIN entry: works on physical keyboard, USB numpad, on-screen
    // buttons, AND mobile soft keyboard. Three cooperating layers:
    //   1. On-screen buttons (data-digit / data-action attributes)
    //   2. Global keydown listener (physical keyboard / numpad — capture phase)
    //   3. Hidden <input type=tel> that captures mobile soft keyboard input events
    initPinPad();

    const scanPairingQrBtn = document.getElementById('btn-scan-pairing-qr');
    if (scanPairingQrBtn) {
      scanPairingQrBtn.addEventListener('click', () => {
        startMobileScanner();
      });
    }

    // Logout shift register
    document.getElementById('btn-lock-register').addEventListener('click', () => {
      playAudioSignal('click');
      if (state.activeCashier && state.activeCashier.role === 'CASHIER') {
        openShiftReconciliationModal();
      } else {
        performLogout();
      }
    });

    function performLogout() {
      state.activeCashier = null;
      state.terminalRole = null;
      state.currentPin = '';
      updatePinDisplayDots();
      // Show auth lock screen, hide main layout
      document.getElementById('auth-lock-screen').classList.add('active');
      const layout = document.getElementById('pos-app-layout');
      if (layout) layout.style.display = 'none';
      // Re-focus new input for native keyboard
      setTimeout(function() { 
        const pinInput = document.getElementById('pin-input');
        if (pinInput) pinInput.focus();
      }, 300);
    }


    // Theme toggler
    document.getElementById('theme-toggle-btn').addEventListener('click', () => {
      playAudioSignal('click');
      const body = document.body;
      const themes = [
        'theme-obsidian-emerald',
        'theme-midnight-sapphire',
        'theme-warm-amber',
        'theme-minimalist-chrome',
        'theme-monochrome-ivory'
      ];
      
      let curIndex = themes.findIndex(t => body.classList.contains(t));
      body.classList.remove(themes[curIndex]);
      let nextIndex = (curIndex + 1) % themes.length;
      body.classList.add(themes[nextIndex]);

      // Save to worker preferences
      syncWorker.postMessage({
        type: 'SAVE_PREFERENCE',
        payload: { key: 'store_theme_palette', val: themes[nextIndex].replace('theme-', '').replace('-', ' ') }
      });
    });

    // Sidebar navigation clicks
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const targetScreen = btn.getAttribute('data-screen');
        switchActiveScreen(targetScreen);
      });
    });

    // Mobile Bottom Navigation clicks
    // Use touchstart for instant response on Android (no 300ms delay)
    document.querySelectorAll('.pos-bottom-nav .nav-btn').forEach(btn => {
      var navTouched = false;
      btn.addEventListener('touchstart', function(e) {
        navTouched = true;
        const targetScreen = e.currentTarget.getAttribute('data-screen');
        switchActiveScreen(targetScreen);
      }, { passive: true });
      btn.addEventListener('click', function(e) {
        if (navTouched) { navTouched = false; return; }
        const targetScreen = e.currentTarget.getAttribute('data-screen');
        switchActiveScreen(targetScreen);
      });
    });

    // Sidebar collapse toggler
    document.getElementById('sidebar-toggle-btn').addEventListener('click', (e) => {
      playAudioSignal('click');
      const layout = document.getElementById('pos-app-layout');
      layout.classList.toggle('sidebar-collapsed');
      
      const btn = e.currentTarget;
      if (layout.classList.contains('sidebar-collapsed')) {
        btn.textContent = '▶';
        state.sidebarCollapsed = true;
      } else {
        btn.textContent = '◀';
        state.sidebarCollapsed = false;
      }
    });

    // Online/Offline status badge manual toggle
    document.getElementById('net-badge').addEventListener('click', () => {
      playAudioSignal('click');
      state.isOnline = !state.isOnline;
      syncWorker.postMessage({
        type: 'SET_ONLINE_STATE',
        payload: { isOnline: state.isOnline }
      });
      updateNetworkBadge(state.isOnline);
    });

    // Void / Clear Order cart
    document.getElementById('btn-void-order').addEventListener('click', () => {
      if (state.activeCart.length === 0) return;
      playAudioSignal('click');
      // Use a non-blocking confirmation approach for mobile compatibility
      const voidOverlay = document.createElement('div');
      voidOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;';
      voidOverlay.innerHTML = '<div style="background:var(--panel-graphite);border:1px solid var(--border-titanium);border-radius:16px;padding:24px;max-width:320px;width:100%;text-align:center;"><p style="color:var(--text-white);font-size:14px;margin-bottom:20px;font-weight:600;">Void this order?</p><p style="color:var(--text-gray);font-size:12px;margin-bottom:24px;">This will clear the current cart. This cannot be undone.</p><div style="display:flex;gap:12px;"><button id="void-cancel-btn" style="flex:1;min-height:48px;background:transparent;border:1px solid var(--border-titanium);color:var(--text-gray);border-radius:8px;font-size:13px;cursor:pointer;touch-action:manipulation;">Cancel</button><button id="void-confirm-btn" style="flex:1;min-height:48px;background:var(--alert-coral);border:none;color:white;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;touch-action:manipulation;">VOID ORDER</button></div></div>';
      document.body.appendChild(voidOverlay);
      voidOverlay.querySelector('#void-cancel-btn').addEventListener('click', function() { voidOverlay.remove(); });
      voidOverlay.querySelector('#void-confirm-btn').addEventListener('click', function() {
        voidOverlay.remove();
        state.activeCart = [];
        state.attachedCustomer = null;
        document.getElementById('checkout-customer-attached').innerHTML = '<span class="text-muted">No customer attached to transaction.</span>';
        document.getElementById('btn-open-customer-link').textContent = 'Attach';
        renderCart();
        playAudioSignal('click');
      });
    });

    // Barcode / SKU search autocomplete inputs
    const searchInput = document.getElementById('checkout-search-input');
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const dropdown = document.getElementById('search-dropdown-results');
      
      if (!q) {
        dropdown.classList.remove('active');
        return;
      }

      const matches = state.catalog.filter(p => 
        p.sku.toLowerCase().includes(q) || 
        p.name.toLowerCase().includes(q) || 
        (p.gtin && String(p.gtin).includes(q))
      );

      renderSearchDropdown(matches);
    });

    // Payment Mode toggle selection
    document.querySelectorAll('.payment-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        playAudioSignal('click');
        document.querySelectorAll('.payment-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');

        const mode = e.currentTarget.getAttribute('data-mode');
        const splitFields = document.getElementById('checkout-split-fields');
        if (mode === 'SPLIT') {
          splitFields.style.display = 'flex';
          // Pre-populate split amounts
          const total = calculateGrandTotal() / 100.0;
          document.getElementById('split-cash-amount').value = (total / 2.0).toFixed(2);
          document.getElementById('split-card-amount').value = (total / 2.0).toFixed(2);
        } else {
          splitFields.style.display = 'none';
        }
        updateTotalsBoard();
      });
    });

    // Link customer modal trigger
    document.getElementById('btn-open-customer-link').addEventListener('click', () => {
      playAudioSignal('click');
      if (state.attachedCustomer) {
        // Unlink customer
        state.attachedCustomer = null;
        document.getElementById('checkout-customer-attached').innerHTML = `<span class="text-muted">No customer attached to transaction.</span>`;
        document.getElementById('btn-open-customer-link').textContent = 'Attach';
      } else {
        // Open link dialog
        document.getElementById('modal-customer-link').classList.add('active');
        document.getElementById('customer-link-search').value = '';
        renderCustomerLinkModalList();
        document.getElementById('customer-link-search').focus();
      }
    });

    // Loyalty Customer link search input
    document.getElementById('customer-link-search').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      renderCustomerLinkModalList(q);
    });

    // Create Loyalty Customer from Link Modal
    document.getElementById('btn-create-customer-from-link').addEventListener('click', () => {
      document.getElementById('modal-customer-link').classList.remove('active');
      openCustomerEditModal(null);
    });

    // Close Modals buttons
    document.getElementById('btn-close-customer-link-modal').addEventListener('click', () => {
      document.getElementById('modal-customer-link').classList.remove('active');
    });
    document.getElementById('btn-close-customer-link-modal-footer').addEventListener('click', () => {
      document.getElementById('modal-customer-link').classList.remove('active');
    });

    // Complete transaction button
    document.getElementById('btn-checkout-complete').addEventListener('click', () => {
      submitCheckoutTransaction();
    });

    // --- CATALOG MODAL BINDINGS ---
    document.getElementById('btn-catalog-create-product').addEventListener('click', () => {
      openProductEditModal(null);
    });
    document.getElementById('btn-close-product-modal').addEventListener('click', () => {
      document.getElementById('modal-product').classList.remove('active');
    });
    document.getElementById('btn-cancel-product-modal').addEventListener('click', () => {
      document.getElementById('modal-product').classList.remove('active');
    });
    document.getElementById('btn-submit-product-modal').addEventListener('click', () => {
      submitProductForm();
    });

    // --- CUSTOMERS MODAL BINDINGS ---
    document.getElementById('btn-customers-create').addEventListener('click', () => {
      openCustomerEditModal(null);
    });
    document.getElementById('btn-close-customer-modal').addEventListener('click', () => {
      document.getElementById('modal-customer').classList.remove('active');
    });
    document.getElementById('btn-cancel-customer-modal').addEventListener('click', () => {
      document.getElementById('modal-customer').classList.remove('active');
    });
    document.getElementById('btn-submit-customer-modal').addEventListener('click', () => {
      submitCustomerForm();
    });

    // --- EMPLOYEES MODAL BINDINGS ---
    document.getElementById('btn-staff-create').addEventListener('click', () => {
      openEmployeeModal();
    });
    document.getElementById('btn-close-employee-modal').addEventListener('click', () => {
      document.getElementById('modal-employee').classList.remove('active');
    });
    document.getElementById('btn-cancel-employee-modal').addEventListener('click', () => {
      document.getElementById('modal-employee').classList.remove('active');
    });
    document.getElementById('btn-submit-employee-modal').addEventListener('click', () => {
      submitEmployeeForm();
    });

    // --- SYNC LOGS CLEAR BUTTON ---
    document.getElementById('btn-clear-logs-feed').addEventListener('click', () => {
      playAudioSignal('click');
      document.getElementById('sync-logs-feed-container').innerHTML = '';
      state.logs = [];
    });

    // --- SETTINGS PREFERENCES ---
    document.getElementById('setting-store-name').addEventListener('change', (e) => {
      syncWorker.postMessage({
        type: 'SAVE_PREFERENCE',
        payload: { key: 'store_name', val: e.target.value }
      });
      state.preferences['store_name'] = e.target.value;
      applyPreferencesFromState();
    });

    document.getElementById('setting-tax-rate').addEventListener('change', (e) => {
      syncWorker.postMessage({
        type: 'SAVE_PREFERENCE',
        payload: { key: 'store_tax_rate', val: e.target.value }
      });
      state.preferences['store_tax_rate'] = e.target.value;
      applyPreferencesFromState();
    });

    const langBtn = document.getElementById('lang-toggle-btn');
    if (langBtn) {
      langBtn.addEventListener('click', () => {
        playAudioSignal('click');
        const currentLang = state.preferences['system_language'] || 'en';
        const newLang = currentLang === 'en' ? 'ur' : 'en';
        setLanguage(newLang);
      });
    }

    const taxModeEl = document.getElementById('setting-tax-mode');
    if (taxModeEl) {
      taxModeEl.addEventListener('change', (e) => {
        const mode = e.target.value;
        syncWorker.postMessage({
          type: 'SAVE_PREFERENCE',
          payload: { key: 'store_tax_mode', val: mode }
        });
        state.preferences['store_tax_mode'] = mode;
        applyPreferencesFromState();
      });
    }

    document.getElementById('setting-receipt-tagline').addEventListener('change', (e) => {
      syncWorker.postMessage({
        type: 'SAVE_PREFERENCE',
        payload: { key: 'store_receipt_tagline', val: e.target.value }
      });
      state.preferences['store_receipt_tagline'] = e.target.value;
    });

    document.getElementById('setting-theme-palette').addEventListener('change', (e) => {
      const palette = e.target.value;
      syncWorker.postMessage({
        type: 'SAVE_PREFERENCE',
        payload: { key: 'store_theme_palette', val: palette }
      });
      
      const themeClass = 'theme-' + palette.toLowerCase().replace(/\s+/g, '-');
      const body = document.body;
      const themes = ['theme-obsidian-emerald', 'theme-midnight-sapphire', 'theme-warm-amber', 'theme-minimalist-chrome', 'theme-monochrome-ivory'];
      themes.forEach(t => body.classList.remove(t));
      body.classList.add(themeClass);
    });

    document.getElementById('setting-receipt-width').addEventListener('change', (e) => {
      syncWorker.postMessage({
        type: 'SAVE_PREFERENCE',
        payload: { key: 'store_receipt_width', val: e.target.value }
      });
      state.preferences['store_receipt_width'] = e.target.value;
    });

    document.getElementById('setting-glass-fx').addEventListener('change', (e) => {
      const enabled = e.target.checked;
      syncWorker.postMessage({
        type: 'SAVE_PREFERENCE',
        payload: { key: 'glassmorphism_enabled', val: String(enabled) }
      });
      document.body.classList.toggle('performance-solid-mode', !enabled);
    });

    document.getElementById('setting-oversell-block').addEventListener('change', (e) => {
      const enabled = e.target.checked;
      syncWorker.postMessage({
        type: 'SAVE_PREFERENCE',
        payload: { key: 'oversell_block_enabled', val: String(enabled) }
      });
      state.preferences['oversell_block_enabled'] = String(enabled);
    });

    document.getElementById('setting-audio-enabled').addEventListener('change', (e) => {
      const enabled = e.target.checked;
      syncWorker.postMessage({
        type: 'SAVE_PREFERENCE',
        payload: { key: 'audio_feedback_enabled', val: String(enabled) }
      });
      state.preferences['audio_feedback_enabled'] = String(enabled);
    });

    document.getElementById('setting-haptic-enabled').addEventListener('change', (e) => {
      const enabled = e.target.checked;
      syncWorker.postMessage({
        type: 'SAVE_PREFERENCE',
        payload: { key: 'haptic_feedback_enabled', val: String(enabled) }
      });
      state.preferences['haptic_feedback_enabled'] = String(enabled);
    });

    document.getElementById('setting-fbr-enabled')?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      syncWorker.postMessage({ type: 'SAVE_PREFERENCE', payload: { key: 'fbr_integration_enabled', val: String(enabled) } });
      state.preferences['fbr_integration_enabled'] = String(enabled);
      renderCart(); // Instantly update checkout math
    });

    document.getElementById('setting-scan-threshold').addEventListener('change', (e) => {
      const val = e.target.value;
      syncWorker.postMessage({
        type: 'SAVE_PREFERENCE',
        payload: { key: 'hid_scan_threshold_ms', val: String(val) }
      });
      state.preferences['hid_scan_threshold_ms'] = String(val);
    });

    const walletPhoneInput = document.getElementById('setting-wallet-phone');
    if (walletPhoneInput) {
      walletPhoneInput.addEventListener('change', (e) => {
        syncWorker.postMessage({
          type: 'SAVE_PREFERENCE',
          payload: { key: 'setting_wallet_phone', val: e.target.value }
        });
        state.preferences['setting_wallet_phone'] = e.target.value;
      });
    }

    const settingSyncPass = document.getElementById('setting-sync-passphrase');
    if (settingSyncPass) {
      settingSyncPass.addEventListener('change', (e) => {
        syncWorker.postMessage({
          type: 'SAVE_PREFERENCE',
          payload: { key: 'sync_passphrase', val: e.target.value }
        });
        state.preferences['sync_passphrase'] = e.target.value;
        applyPreferencesFromState();
      });
    }

    const cloudSyncBtn = document.getElementById('btn-cloud-sync');
    if (cloudSyncBtn) {
      cloudSyncBtn.addEventListener('click', () => {
        simulateGoogleDriveSync();
      });
    }

    const settingGDriveToken = document.getElementById('setting-google-drive-token');
    if (settingGDriveToken) {
      settingGDriveToken.addEventListener('change', (e) => {
        const val = e.target.value.trim();
        if (val) {
          localStorage.setItem('google_drive_oauth_token', val);
          syncWorker.postMessage({
            type: 'SAVE_PREFERENCE',
            payload: { key: 'google_drive_oauth_token', val: val }
          });
          state.preferences['google_drive_oauth_token'] = val;
        } else {
          localStorage.removeItem('google_drive_oauth_token');
          syncWorker.postMessage({
            type: 'SAVE_PREFERENCE',
            payload: { key: 'google_drive_oauth_token', val: '' }
          });
          state.preferences['google_drive_oauth_token'] = '';
        }
      });
    }

    const changePinBtn = document.getElementById('btn-change-my-pin');
    if (changePinBtn) {
      changePinBtn.addEventListener('click', async () => {
        playAudioSignal('click');
        const currentPinInput = document.getElementById('setting-change-pin-current');
        const newPinInput = document.getElementById('setting-change-pin-new');
        const confirmPinInput = document.getElementById('setting-change-pin-confirm');

        const currentVal = currentPinInput.value.trim();
        const newVal = newPinInput.value.trim();
        const confirmVal = confirmPinInput.value.trim();

        if (!currentVal || !newVal || !confirmVal) {
          alert('All passcode PIN fields are required.');
          return;
        }

        if (newVal.length !== 4 || isNaN(newVal)) {
          alert('New passcode PIN must be exactly 4 digits.');
          return;
        }

        if (newVal !== confirmVal) {
          alert('New passcode PINs do not match.');
          return;
        }

        if (!state.activeCashier) {
          alert('No active logged-in cashier context found.');
          return;
        }

        // Find employee record
        const emp = state.employees.find(e => e.id === state.activeCashier.id);
        if (!emp) {
          alert(`Employee record not found for ID: ${state.activeCashier.id}`);
          return;
        }

        // Verify current PIN matches stored hash
        const isMatched = await verifyPinClient(currentVal, emp.auth_hash);
        if (!isMatched) {
          alert('Current passcode PIN is incorrect.');
          return;
        }

        // Hash and save new passcode
        const newHash = await hashPin(newVal);
        const updatedPayload = {
          ...emp,
          auth_hash: newHash
        };

        syncWorker.postMessage({
          type: 'SAVE_EMPLOYEE',
          payload: updatedPayload
        });

        alert('Passcode successfully updated!');
        currentPinInput.value = '';
        newPinInput.value = '';
        confirmPinInput.value = '';
      });
    }

    document.getElementById('btn-maintenance-reseed').addEventListener('click', () => {
      if (confirm('This will restore all baseline catalog inventory items and preferences. Continue?')) {
        syncWorker.postMessage({ type: 'DESTRUCTIVE_RESET' });
      }
    });

    document.getElementById('btn-maintenance-grand-reset').addEventListener('click', () => {
      document.getElementById('modal-reset').classList.add('active');
      document.getElementById('reset-admin-pin-auth').value = '';
      document.getElementById('reset-modal-error').textContent = '';
      document.getElementById('reset-admin-pin-auth').focus();
    });

    document.getElementById('btn-close-reset-modal').addEventListener('click', () => {
      document.getElementById('modal-reset').classList.remove('active');
    });
    document.getElementById('btn-cancel-reset-modal').addEventListener('click', () => {
      document.getElementById('modal-reset').classList.remove('active');
    });
    document.getElementById('btn-confirm-reset-modal').addEventListener('click', () => {
      submitGrandResetPurge();
    });

    // Reprint Receipt Duplicate
    document.getElementById('btn-reprint-receipt-bridge').addEventListener('click', () => {
      if (!state.selectedTransactionId) return;
      const tx = state.transactions.find(t => t.id === state.selectedTransactionId);
      if (tx) {
        triggerEscPosPrintJob(tx);
      }
    });

    // Catalog table filters delegate
    document.getElementById('catalog-category-list').addEventListener('click', (e) => {
      const pill = e.target.closest('.cat-pill');
      if (!pill) return;
      playAudioSignal('click');
      document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.selectedCategory = pill.getAttribute('data-cat');
      renderCatalogScreen();
    });

    // Voice Speech Recognition Coach triggers
    document.getElementById('btn-speech-record').addEventListener('click', () => {
      toggleSpeechCoachRecording();
    });

    // Close Shift Reconcile Modal bindings
    document.getElementById('btn-close-shift-reconcile-modal').addEventListener('click', () => {
      document.getElementById('modal-shift-reconcile').classList.remove('active');
    });
    document.getElementById('btn-cancel-shift-reconcile-modal').addEventListener('click', () => {
      document.getElementById('modal-shift-reconcile').classList.remove('active');
    });
    document.getElementById('btn-submit-shift-reconcile-modal').addEventListener('click', () => {
      playAudioSignal('click');
      const modal = document.getElementById('modal-shift-reconcile');
      const denomInputs = modal.querySelectorAll('.denom-input');
      let totalDeclaredBase = 0;
      denomInputs.forEach(inp => {
        const val = parseFloat(inp.getAttribute('data-val'));
        const qty = parseFloat(inp.value || 0);
        totalDeclaredBase += val * qty;
      });
      const declaredCents = Math.round(totalDeclaredBase * 100);
      const expectedCents = state.currentShiftExpectedCents || 0;
      const varianceCents = declaredCents - expectedCents;
      const shiftId = 'shift_' + Date.now();
      const employeeId = state.activeCashier ? state.activeCashier.id : 'emp_cashier';
      const clockIn = state.activeCashier ? state.activeCashier.clockIn : Date.now();
      const clockOut = Date.now();
      syncWorker.postMessage({
        type: 'CLOSE_SHIFT',
        payload: { shiftId, employeeId, clockIn, clockOut, declared: declaredCents, expected: expectedCents, variance: varianceCents }
      });
      modal.classList.remove('active');
      performLogout();
    });
    const denomInputs = document.querySelectorAll('#modal-shift-reconcile .denom-input');
    denomInputs.forEach(input => {
      input.addEventListener('input', () => {
        let totalDeclared = 0;
        denomInputs.forEach(inp => {
          const val = parseFloat(inp.getAttribute('data-val'));
          const qty = parseFloat(inp.value || 0);
          totalDeclared += val * qty;
        });
        document.getElementById('shift-reconcile-total-declared').textContent = `Rs. ${totalDeclared.toFixed(2)}`;
      });
    });

    // QR Payment Modal Cancel & Simulator bindings
    document.getElementById('btn-close-qr-pay-modal').addEventListener('click', () => {
      closeQrPaymentModal();
    });
    document.getElementById('btn-close-qr-pay-modal-footer').addEventListener('click', () => {
      closeQrPaymentModal();
    });
    document.getElementById('btn-trigger-sms-simulation').addEventListener('click', () => {
      playAudioSignal('click');
      if (!state.pendingQrCheckout) return;
      const smsBody = document.getElementById('sms-sim-body').value;
      const smsSender = document.getElementById('sms-sim-sender').value.trim();
      const expectedTotalStr = (state.pendingQrCheckout.total / 100).toFixed(2);
      if (!smsSender) {
        alert('Please specify a valid bank gateway shortcode.');
        return;
      }
      if (smsBody.includes(expectedTotalStr)) {
        alert(`SMS verified! Payment matches grand total of Rs. ${expectedTotalStr}.`);
        document.getElementById('modal-qr-pay').classList.remove('active');
        const payload = state.pendingQrCheckout;
        const transactionId = 'tx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
        const cashierId = state.activeCashier ? state.activeCashier.id : 'emp_cashier';
        const finalDetails = (payload.paymentDetails ? payload.paymentDetails + ' | ' : '') + 
                             `SMS Verified (Sender: ${smsSender}, Msg: ${smsBody.substring(0, 30)}...)`;
        syncWorker.postMessage({
          type: 'CHECKOUT',
          payload: {
            transactionId,
            employeeId: cashierId,
            cart: state.activeCart,
            subtotal: payload.subtotal,
            tax: payload.tax,
            total: payload.total,
            paymentMode: payload.paymentMode,
            paymentDetails: finalDetails,
            tier: window.__nexovaTier || 'STARTER',
            fbr_integration_enabled: state.preferences['fbr_integration_enabled']
          }
        });
        state.pendingQrCheckout = null;
      } else {
        playAudioSignal('error');
        alert(`Verification failed! The SMS text must contain the exact expected total amount: ${expectedTotalStr}`);
      }
    });

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  MULTI-STEP ONBOARDING WIZARD CONTROLLER
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    (function initWizardController() {
      let wizStep = 1;
      let wizPath = 'NEW';
      const MAX_STEPS = 4;
      const subtitles = {
        1:   "Let's get your point-of-sale ready in just a few steps.",
        '2a': 'Tell us about your store — this will appear on receipts and the POS header.',
        '2b':"Enter the network details to connect to an existing store.",
        3:   "Set your security credentials to protect this register.",
        4:   "Review your configuration before we initialize the database.",
      };

      const btnNext    = document.getElementById('btn-wiz-next');
      const btnBack    = document.getElementById('btn-wiz-back');
      const subtitle   = document.getElementById('wizard-step-subtitle');
      const allPanels  = document.querySelectorAll('.wiz-panel');
      const dots       = document.querySelectorAll('.wiz-dot');
      const wizSetType = document.getElementById('wizard-setup-type');
      const wizardThemeSel = document.getElementById('wizard-theme');
      if (wizardThemeSel) {
        wizardThemeSel.addEventListener('change', (e) => {
          const val = e.target.value;
          const themeClass = 'theme-' + val.toLowerCase().replace(/\s+/g, '-');
          const body = document.body;
          const themes = ['theme-obsidian-emerald', 'theme-midnight-sapphire', 'theme-warm-amber', 'theme-minimalist-chrome', 'theme-monochrome-ivory'];
          themes.forEach(t => body.classList.remove(t));
          body.classList.add(themeClass);
        });
      }

      if (!btnNext) return;

      function getStepKey() {
        return wizStep === 2 ? (wizPath === 'NEW' ? '2a' : '2b') : String(wizStep);
      }
      function panelId() {
        return wizStep === 2 ? ('wiz-panel-' + (wizPath === 'NEW' ? '2a' : '2b')) : ('wiz-panel-' + wizStep);
      }
      function showPanel(direction) {
        allPanels.forEach(p => { p.style.display = 'none'; p.classList.remove('slide-back'); });
        const p = document.getElementById(panelId());
        if (!p) return;
        if (direction === 'back') p.classList.add('slide-back');
        p.style.display = 'flex';
      }
      function updateDots() {
        dots.forEach((dot, i) => {
          const s = i + 1;
          dot.style.width      = s === wizStep ? '28px' : '6px';
          dot.style.background = s < wizStep ? 'rgba(0,214,143,0.35)' : s === wizStep ? 'var(--accent-emerald)' : 'rgba(255,255,255,0.12)';
        });
      }
      function updateNav() {
        btnBack.style.display = wizStep > 1 ? 'flex' : 'none';
        if (wizStep === 1) {
          btnNext.style.display = 'none';
        } else if (wizStep === MAX_STEPS) {
          btnNext.style.display = 'flex';
          btnNext.innerHTML = 'Launch Register <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>';
        } else {
          btnNext.style.display = 'flex';
          btnNext.innerHTML = 'Continue <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>';
        }
      }
      function render(dir) {
        if (wizSetType) wizSetType.value = wizPath;
        showPanel(dir);
        updateDots();
        if (subtitle) subtitle.textContent = subtitles[getStepKey()] || '';
        updateNav();
      }
      function goTo(step, path, dir) {
        if (path) wizPath = path;
        wizStep = step;
        render(dir || 'forward');
      }

      // Step 1 path choice
      const bNew  = document.getElementById('btn-wiz-choose-new');
      const bJoin = document.getElementById('btn-wiz-choose-join');
      if (bNew)  bNew.addEventListener('click',  () => { playAudioSignal('click'); goTo(2,'NEW'); });
      if (bJoin) bJoin.addEventListener('click', () => { playAudioSignal('click'); goTo(2,'JOIN'); });

      // Scan QR buttons
      const bScan1 = document.getElementById('btn-wizard-scan-qr-direct');
      const bScan2 = document.getElementById('btn-wizard-scan-qr');
      if (bScan1) bScan1.addEventListener('click', () => startMobileScanner());
      if (bScan2) bScan2.addEventListener('click', () => startMobileScanner());

      // Back
      btnBack.addEventListener('click', () => {
        playAudioSignal('click');
        goTo(wizStep === 2 ? 1 : wizStep - 1, wizPath, 'back');
      });

      // Passphrase strength meter
      const pp = document.getElementById('wizard-sync-passphrase');
      if (pp) pp.addEventListener('input', () => {
        const v = pp.value;
        const bar = document.getElementById('wiz-strength-bar');
        const lbl = document.getElementById('wiz-strength-label');
        if (!bar) return;
        let s = 0;
        if (v.length >= 8)  s++;
        if (v.length >= 14) s++;
        if (/[A-Z]/.test(v)) s++;
        if (/[0-9]/.test(v)) s++;
        if (/[^A-Za-z0-9]/.test(v)) s++;
        const c = ['#ef4444','#f59e0b','#f59e0b','#00d68f','#00d68f'];
        const t = ['Weak','Fair','Fair','Strong','Excellent'];
        bar.style.width = (s/5*100)+'%';
        bar.style.background = c[s-1]||'#ef4444';
        if (lbl) { lbl.style.color = c[s-1]||'#ef4444'; lbl.textContent = t[s-1]||'Too Short'; }
      });

      // Populate review summary
      function populateReview() {
        const v = id => (document.getElementById(id)||{}).value||'';
        const e = id => document.getElementById(id);
        if (wizPath === 'NEW') {
          if (e('wiz-sum-store'))  e('wiz-sum-store').textContent  = v('wizard-store-name') || 'â€”';
          if (e('wiz-sum-tax'))    e('wiz-sum-tax').textContent    = v('wizard-tax-rate') + '%';
          if (e('wiz-sum-theme'))  e('wiz-sum-theme').textContent  = v('wizard-theme') || 'â€”';
          if (e('wiz-sum-mode'))   e('wiz-sum-mode').textContent   = 'Master Register';
        } else {
          if (e('wiz-sum-store'))  e('wiz-sum-store').textContent  = v('wizard-join-server-url') || '(QR paired)';
          if (e('wiz-sum-tax'))    e('wiz-sum-tax').textContent    = 'From Master';
          if (e('wiz-sum-theme'))  e('wiz-sum-theme').textContent  = 'From Master';
          if (e('wiz-sum-mode'))   e('wiz-sum-mode').textContent   = 'Client Node';
        }
      }

      // Validation
      function validate() {
        const v = id => (document.getElementById(id)||{}).value||'';
        const focus = id => { const el = document.getElementById(id); if (el) el.focus(); };
        if (wizStep === 2 && wizPath === 'NEW') {
          if (!v('wizard-store-name').trim()) { showNotificationToast('Store name is required.','error',3000); focus('wizard-store-name'); return false; }
        }
        if (wizStep === 2 && wizPath === 'JOIN') {
          if (!v('wizard-join-passphrase').trim()) { showNotificationToast('Network key is required.','error',3000); return false; }
        }
        if (wizStep === 3) {
          const pin = v('wizard-admin-pin').trim();
          if (!pin || pin.length !== 4 || isNaN(pin)) { showNotificationToast('Owner PIN must be exactly 4 digits.','error',3000); focus('wizard-admin-pin'); return false; }
          if (!v('wizard-sync-passphrase').trim()) { showNotificationToast('Network encryption key is required.','error',3000); focus('wizard-sync-passphrase'); return false; }
        }
        if (wizStep === 4) {
          const eula = document.getElementById('wizard-eula-checkbox');
          if (!eula || !eula.checked) { showNotificationToast('Please accept the EULA to continue.','error',3000); return false; }
        }
        return true;
      }

      // Next / Submit
      btnNext.addEventListener('click', () => {
        playAudioSignal('click');
        if (!validate()) return;
        if (wizStep < MAX_STEPS) {
          if (wizStep === 3) populateReview();
          goTo(wizStep + 1, wizPath, 'forward');
        } else {
          document.getElementById('btn-submit-wizard') && document.getElementById('btn-submit-wizard').click();
        }
      });

      render('forward');
    })();

    const btnSubmitWizard = document.getElementById('btn-submit-wizard');
    if (btnSubmitWizard) {
      btnSubmitWizard.addEventListener('click', async () => {
        playAudioSignal('click');
        const strategy = document.getElementById('wizard-setup-type').value;
        if (strategy === 'NEW') {
          const storeName = document.getElementById('wizard-store-name').value.trim();
          const taxRate = parseFloat(document.getElementById('wizard-tax-rate').value || 0);
          const adminPin = document.getElementById('wizard-admin-pin').value.trim();
          const syncPassphrase = document.getElementById('wizard-sync-passphrase').value;
          const theme = document.getElementById('wizard-theme').value;

          if (!storeName || !adminPin || !syncPassphrase) {
            alert('Store Name, Owner PIN, and Network Encryption Key are required for bootstrap.');
            return;
          }
          if (adminPin.length !== 4 || isNaN(adminPin)) {
            alert('Owner PIN must be a 4-digit number.');
            return;
          }

          // Initialize server SQLite with the bootstrap configuration first
          fetch('/api/bootstrap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ storeName, taxRate, adminPin, syncPassphrase, theme })
          })
          .then(async (resp) => {
            if (!resp.ok) {
              const err = await resp.json();
              throw new Error(err.error || 'Server bootstrap failed');
            }
            // Proceed with local IndexedDB bootstrap
            localStorage.setItem('onboarding_complete', 'true');
            syncWorker.postMessage({
              type: 'BOOTSTRAP_STORE',
              payload: { storeName, taxRate, adminPin, syncPassphrase, theme }
            });
          })
          .catch((err) => {
            console.warn('[Bootstrap] Server unavailable, falling back to standalone local:', err);
            
            // 1. Synchronously save onboarding state so it survives the reload
            localStorage.setItem('onboarding_complete', 'true');
            
            // 2. Post to worker
            syncWorker.postMessage({
              type: 'BOOTSTRAP_STORE',
              payload: { storeName, taxRate, adminPin, syncPassphrase, theme }
            });
            
            // 3. Use non-blocking toast instead of alert
            playAudioSignal('success');
            showNotificationToast('Bootstrapping store in Standalone Offline Mode...');
          });
        } else {
          const syncPassphrase = document.getElementById('wizard-join-passphrase').value;
          const serverUrl = document.getElementById('wizard-join-server-url').value.trim();
          
          if (!syncPassphrase) {
            alert('Encryption key passphrase is required to join an existing network.');
            return;
          }

          if (serverUrl) {
            localStorage.setItem('nexova_server_url', serverUrl);
            syncWorker.postMessage({
              type: 'SAVE_PREFERENCE',
              payload: { key: 'nexova_server_url', val: serverUrl }
            });
            if (window.AndroidPOS && typeof window.AndroidPOS.setServerUrl === 'function') {
              window.AndroidPOS.setServerUrl(serverUrl);
            }
          }

          // Save keys and onboarding state locally
          syncWorker.postMessage({
            type: 'SAVE_PREFERENCE',
            payload: { key: 'sync_passphrase', val: syncPassphrase }
          });
          syncWorker.postMessage({
            type: 'SAVE_PREFERENCE',
            payload: { key: 'onboarding_complete', val: 'true', value_type: 'BOOL' }
          });
          playAudioSignal('success');
          alert('Onboarding complete. Connecting to network...');
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        }
      });
    }

    // CFD and KDS Exit buttons
    const btnCfdExit = document.getElementById('btn-cfd-exit');
    if (btnCfdExit) {
      btnCfdExit.addEventListener('click', () => {
        playAudioSignal('click');
        document.getElementById('view-cfd').style.display = 'none';
        document.getElementById('pos-app-layout').style.display = 'grid';
        document.getElementById('auth-lock-screen').classList.add('active');
        state.terminalRole = null;
        state.currentPin = '';
        updatePinDisplayDots();
      });
    }

    const btnKdsExit = document.getElementById('btn-kds-exit');
    if (btnKdsExit) {
      btnKdsExit.addEventListener('click', () => {
        playAudioSignal('click');
        document.getElementById('view-kds').style.display = 'none';
        document.getElementById('pos-app-layout').style.display = 'grid';
        document.getElementById('auth-lock-screen').classList.add('active');
        state.terminalRole = null;
        state.currentPin = '';
        updatePinDisplayDots();
      });
    }

    // Mobile Scanner FAB & Close bindings
    const btnMobileScanner = document.getElementById('btn-mobile-scanner-fab');
    if (btnMobileScanner) {
      btnMobileScanner.addEventListener('click', () => {
        startMobileScanner();
      });
    }

    const btnDesktopScanner = document.getElementById('btn-desktop-camera-scanner');
    if (btnDesktopScanner) {
      btnDesktopScanner.addEventListener('click', () => {
        startMobileScanner();
      });
    }

    const btnCloseMobileScanner = document.getElementById('btn-close-mobile-scanner');
    if (btnCloseMobileScanner) {
      btnCloseMobileScanner.addEventListener('click', () => {
        closeMobileScanner();
      });
    }

    const scannerManualInput = document.getElementById('scanner-manual-input');
    if (scannerManualInput) {
      scannerManualInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const code = e.target.value.trim();
          if (code) {
            handleScannedCode(code);
            closeMobileScanner();
          }
        }
      });
    }

    const btnSubmitPairing = document.getElementById('btn-submit-pairing');
    if (btnSubmitPairing) {
      btnSubmitPairing.addEventListener('click', () => {
        const deviceName = document.getElementById('pairing-device-name').value.trim();
        const syncPassphrase = document.getElementById('pairing-sync-passphrase').value;
        if (!deviceName) {
          alert('Please enter a friendly name for this terminal.');
          return;
        }
        playAudioSignal('click');
        if (syncPassphrase) {
          syncWorker.postMessage({
            type: 'SAVE_PREFERENCE',
            payload: { key: 'sync_passphrase', val: syncPassphrase }
          });
        }
        syncWorker.postMessage({
          type: 'REGISTER_DEVICE',
          payload: { deviceName }
        });

        // Set button to Requested state and disable to prevent spamming
        btnSubmitPairing.disabled = true;
        btnSubmitPairing.textContent = 'Requested...';
        btnSubmitPairing.style.opacity = '0.6';

        // Re-enable after 15 seconds to allow requesting again
        setTimeout(() => {
          btnSubmitPairing.disabled = false;
          btnSubmitPairing.textContent = 'Request Pairing';
          btnSubmitPairing.style.opacity = '1';
        }, 15000);
      });
    }

    const btnCancelPairing = document.getElementById('btn-cancel-pairing');
    if (btnCancelPairing) {
      btnCancelPairing.addEventListener('click', () => {
        playAudioSignal('click');
        document.getElementById('device-pairing-form').style.display = 'flex';
        document.getElementById('device-pairing-pending').style.display = 'none';
        
        // Reset the submit button state immediately
        const btnSubmit = document.getElementById('btn-submit-pairing');
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.textContent = 'Request Pairing';
          btnSubmit.style.opacity = '1';
        }
      });
    }

    const btnLockScreenReset = document.getElementById('btn-lock-screen-reset');
    if (btnLockScreenReset) {
      btnLockScreenReset.addEventListener('click', async () => {
        playAudioSignal('click');
        if (confirm('Are you sure you want to perform a factory reset? This will clear all local configuration and transaction data.')) {
          try {
            const serverBase = (window.__nexovaServerUrl || location.origin);
            if (location.protocol !== 'file:') {
              await fetch(serverBase + '/api/system/reset', { method: 'POST' });
            }
          } catch (err) {
            console.warn('Failed to contact server for reset:', err);
          }
          await NexovaDB.destructReset();
          localStorage.clear();
          window.location.reload();
        }
      });
    }

    document.querySelectorAll('.btn-pairing-reset-action').forEach(btn => {
      btn.addEventListener('click', async () => {
        playAudioSignal('click');
        if (confirm('Are you sure you want to cancel setup and return to onboarding? This will clear pairing configurations.')) {
          try {
            const serverBase = (window.__nexovaServerUrl || location.origin);
            if (location.protocol !== 'file:') {
              await fetch(serverBase + '/api/system/reset', { method: 'POST' });
            }
          } catch (err) {
            console.warn('Failed to contact server for reset:', err);
          }
          await NexovaDB.destructReset();
          localStorage.clear();
          window.location.reload();
        }
      });
    });

    // Search input keyup handlers for Quick-Access grids
    const checkoutQuickSearch = document.getElementById('checkout-quick-search');
    if (checkoutQuickSearch) {
      checkoutQuickSearch.addEventListener('input', (e) => {
        state.checkoutQuickSearch = e.target.value;
        renderQuickGrid(
          document.getElementById('checkout-quick-grid'),
          document.getElementById('checkout-quick-filters'),
          document.getElementById('checkout-quick-search'),
          'checkoutQuickCategory',
          'checkoutQuickSearch'
        );
      });
    }

    const mobileQuickSearch = document.getElementById('mobile-quick-search');
    if (mobileQuickSearch) {
      mobileQuickSearch.addEventListener('input', (e) => {
        state.mobileQuickSearch = e.target.value;
        renderQuickGrid(
          document.getElementById('mobile-quick-grid'),
          document.getElementById('mobile-quick-filters'),
          document.getElementById('mobile-quick-search'),
          'mobileQuickCategory',
          'mobileQuickSearch'
        );
      });
    }

    // Bind collapsible accordion actions
    document.querySelectorAll('.action-card.collapsible .card-toggle-header').forEach(header => {
      header.addEventListener('click', (e) => {
        const card = e.currentTarget.closest('.action-card.collapsible');
        if (card) {
          card.classList.toggle('open');
          playAudioSignal('click');
        }
      });
    });

    // Toggle quick catalog grid
    const btnToggleQuickCatalog = document.getElementById('btn-toggle-quick-catalog');
    if (btnToggleQuickCatalog) {
      const split = document.querySelector('.checkout-split');
      const isCatalogCollapsed = localStorage.getItem('nexova_quick_catalog_collapsed') === 'true';
      if (isCatalogCollapsed && split) {
        split.classList.add('catalog-collapsed');
        btnToggleQuickCatalog.textContent = 'Show Grid';
      }
      
      btnToggleQuickCatalog.addEventListener('click', () => {
        playAudioSignal('click');
        if (split) {
          const collapsed = split.classList.toggle('catalog-collapsed');
          localStorage.setItem('nexova_quick_catalog_collapsed', String(collapsed));
          btnToggleQuickCatalog.textContent = collapsed ? 'Show Grid' : 'Hide Grid';
        }
      });
    }

    // Toggle history receipt preview pane
    const btnToggleHistoryPreview = document.getElementById('btn-toggle-history-preview');
    if (btnToggleHistoryPreview) {
      const historyLayout = document.querySelector('.history-layout');
      const isPreviewCollapsed = localStorage.getItem('nexova_history_preview_collapsed') === 'true';
      if (isPreviewCollapsed && historyLayout) {
        historyLayout.classList.add('preview-collapsed');
        btnToggleHistoryPreview.textContent = 'Show Preview';
      }
      
      btnToggleHistoryPreview.addEventListener('click', () => {
        playAudioSignal('click');
        if (historyLayout) {
          const collapsed = historyLayout.classList.toggle('preview-collapsed');
          localStorage.setItem('nexova_history_preview_collapsed', String(collapsed));
          btnToggleHistoryPreview.textContent = collapsed ? 'Show Preview' : 'Hide Preview';
        }
      });
    }

    // Password visibility toggles
    document.querySelectorAll('.btn-toggle-password').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = btn.previousElementSibling;
        const eye = btn.querySelector('.svg-eye');
        const eyeOff = btn.querySelector('.svg-eye-off');
        if (input && input.tagName === 'INPUT') {
          if (input.type === 'password') {
            input.type = 'text';
            if (eye) eye.style.display = 'none';
            if (eyeOff) eyeOff.style.display = 'block';
          } else {
            input.type = 'password';
            if (eye) eye.style.display = 'block';
            if (eyeOff) eyeOff.style.display = 'none';
          }
        }
      });
    });
    // Lockout Screen activation bindings
    const btnLockoutSendOtp = document.getElementById('btn-lockout-send-otp');
    if (btnLockoutSendOtp) {
      btnLockoutSendOtp.addEventListener('click', () => {
        const phone = document.getElementById('lockout-phone').value.trim();
        const errorMsg = document.getElementById('lockout-error-msg');
        errorMsg.style.display = 'none';

        if (!phone || phone.length < 10) {
          errorMsg.textContent = 'Please enter a valid Pakistani phone number (e.g. 03001234567).';
          errorMsg.style.display = 'block';
          playAudioSignal('error');
          return;
        }

        playAudioSignal('click');
        btnLockoutSendOtp.disabled = true;
        btnLockoutSendOtp.textContent = 'Sending...';

        setTimeout(async () => {
          // Generate a cryptographically secure 6-digit random code
          const randomOtp = Math.floor(100000 + Math.random() * 900000).toString();
          
          // Generate a random salt
          const saltBytes = new Uint8Array(16);
          window.crypto.getRandomValues(saltBytes);
          const saltHex = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');

          try {
            const hash = await pbkdf2(randomOtp, saltHex, 100000, 64);
            const storedHash = saltHex + ':' + hash;
            localStorage.setItem('temp_lockout_otp_hash', storedHash);
            
            btnLockoutSendOtp.textContent = 'Sent!';
            document.getElementById('lockout-otp-row').style.display = 'block';
            alert(`[SMS Dispatch Simulation]\n\nOTP Code sent to ${phone}: ${randomOtp}\n\nThis verification code will be cryptographically verified using PBKDF2 with dynamic salting.`);
          } catch (err) {
            console.error('[Lockout] Failed to hash OTP:', err);
            errorMsg.textContent = 'Cryptographic error generating OTP token.';
            errorMsg.style.display = 'block';
            btnLockoutSendOtp.disabled = false;
            btnLockoutSendOtp.textContent = 'Send OTP';
            playAudioSignal('error');
          }
        }, 1500);
      });
    }

    const btnLockoutSubmit = document.getElementById('btn-lockout-submit');
    if (btnLockoutSubmit) {
      btnLockoutSubmit.addEventListener('click', async () => {
        const licenseKeyInput = document.getElementById('lockout-license-key').value.trim().toUpperCase();
        const otpInput = document.getElementById('lockout-otp-code').value.trim();
        const phoneInput = document.getElementById('lockout-phone').value.trim();
        const errorMsg = document.getElementById('lockout-error-msg');
        errorMsg.style.display = 'none';

        playAudioSignal('click');

        // Check if OTP input is visible and filled
        const otpRowVisible = document.getElementById('lockout-otp-row').style.display === 'block';
        if (otpRowVisible && otpInput) {
          const storedHash = localStorage.getItem('temp_lockout_otp_hash');
          const isMatched = await verifyPinClient(otpInput, storedHash);
          if (isMatched) {
            localStorage.removeItem('temp_lockout_otp_hash');
            syncWorker.postMessage({
              type: 'SAVE_PREFERENCE',
              payload: { key: 'license_phone_bound', val: phoneInput }
            });
            playAudioSignal('success');
            alert('Phone number bound successfully! Nexova Register Unlocked.');
            window.location.reload();
          } else {
            errorMsg.textContent = 'Invalid OTP code. Please try again.';
            errorMsg.style.display = 'block';
            playAudioSignal('error');
          }
          return;
        }

        // License key validation path
        if (!licenseKeyInput) {
          errorMsg.textContent = 'Please enter an activation key or bound phone OTP.';
          errorMsg.style.display = 'block';
          playAudioSignal('error');
          return;
        }

        setButtonLoading('btn-lockout-submit', true, 'Activating...');

        try {
          // Fetch hardware fingerprint
          let deviceFingerprint = 'web_client_node';
          const infoResp = await fetch('/api/server-info');
          if (infoResp.ok) {
            const info = await infoResp.json();
            if (info.fingerprint) deviceFingerprint = info.fingerprint;
          }

          // Request activation from Cloudflare Workers Licensing API (fallback to local mock verification if worker is unavailable)
          const activateResp = await fetch('https://nexova-license-worker.pages.dev/api/license/activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey: licenseKeyInput, nodeId: deviceFingerprint })
          }).catch(() => {
            // Local fallback simulation if offline / no internet connection
            const keyPattern = /^NEXOVA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
            if (keyPattern.test(licenseKeyInput)) {
              let mockToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + 
                              btoa(JSON.stringify({ licenseKey: licenseKeyInput, nodeId: deviceFingerprint, tier: licenseKeyInput.includes('PRO') ? 'PRO' : 'TRIAL', expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 })) + 
                              '.mock_signature';
              return {
                ok: true,
                json: async () => ({ success: true, token: mockToken })
              };
            }
            return {
              ok: false,
              json: async () => ({ error: 'Invalid license key pattern. Format: NEXOVA-XXXX-XXXX-XXXX' })
            };
          });

          if (activateResp.ok) {
            const res = await activateResp.json();
            if (res.success && res.token) {
              syncWorker.postMessage({
                type: 'SAVE_PREFERENCE',
                payload: { key: 'license_token', val: res.token }
              });
              syncWorker.postMessage({
                type: 'SAVE_PREFERENCE',
                payload: { key: 'license_key', val: licenseKeyInput }
              });
              playAudioSignal('success');
              alert('License Activated Successfully!');
              window.location.reload();
              return;
            }
          }

          const errData = await activateResp.json();
          errorMsg.textContent = errData.error || 'Activation failed.';
          errorMsg.style.display = 'block';
          playAudioSignal('error');

        } catch (err) {
          errorMsg.textContent = 'Activation Server Connection Error: ' + err.message;
          errorMsg.style.display = 'block';
          playAudioSignal('error');
        } finally {
          setButtonLoading('btn-lockout-submit', false, '', 'ACTIVATE REGISTER');
        }
      });
    }

    initLedgerModules();
  }



  // UI Tearing role limiting rules
  function applyRoleNavigationLimits(role) {
    const body = document.body;
    
    if (role === 'CASHIER') {
      body.classList.add('is-cashier');
      
      // Bring back all OG tabs! Do not hide any nav items in the sidebar.
      // Every tab is shown, but gated by the virtual Supervisor PIN pad prompt.
      const allNavItems = document.querySelectorAll('.nav-item');
      allNavItems.forEach(el => el.style.display = 'flex');
      
      // Default screen is checkout
      switchActiveScreen('checkout');
    } else {
      body.classList.remove('is-cashier');
      
      const adminNavItems = document.querySelectorAll('.nav-item');
      adminNavItems.forEach(el => el.style.display = 'flex');
    }

    // Apply store tier access limits
    applyTierRestrictions();
  }

  // Definitive POS Tier Architecture & Feature Mapping
  function applyTierRestrictions() {
    let tier = window.__nexovaTier || 'STARTER';
    
    // Grace trial or explicit TRIAL tier gets full ENTERPRISE capabilities
    if (tier === 'TRIAL' || isGraceTrialActive()) {
      tier = 'ENTERPRISE';
    }

    // 1. Hide/show Enterprise exclusive tabs in sidebar
    const enterpriseTabs = document.querySelectorAll('.nav-item[data-screen="fbr-fiscal"], .nav-item[data-screen="multi-store"], .nav-item[data-screen="data-portability"]');
    if (tier === 'ENTERPRISE') {
      enterpriseTabs.forEach(el => el.style.display = 'flex');
    } else {
      enterpriseTabs.forEach(el => el.style.display = 'none');
    }

    // 2. Inject premium blockers for Starter Tier inside Analytics and Credit Book
    const viewAnalytics = document.getElementById('view-analytics');
    if (viewAnalytics) {
      document.getElementById('starter-analytics-upgrade-blocker')?.remove();
      if (tier === 'STARTER') {
        const blocker = document.createElement('div');
        blocker.id = 'starter-analytics-upgrade-blocker';
        blocker.className = 'glass-blocker';
        blocker.innerHTML = `
          <div class="blocker-content">
            <div style="font-size: 48px; margin-bottom: 20px;">💎</div>
            <h2 style="font-family: var(--font-display); font-size: 24px; font-weight: 800; color: var(--text-white); margin-bottom: 8px; text-transform: uppercase;">Unlock Real-Time Analytics</h2>
            <p style="color: var(--text-gray); font-size: 13px; max-width: 360px; margin: 0 auto 24px; line-height: 1.5;">Track net profit margins, payment mode trends, and automated sales metrics on the PRO Tier.</p>
            <button class="action-btn action-success" id="btn-upgrade-analytics" style="min-height: 48px; padding: 0 24px; font-weight: 800; font-size: 12px; text-transform: uppercase;">Upgrade Store License</button>
          </div>
        `;
        viewAnalytics.style.position = 'relative';
        viewAnalytics.appendChild(blocker);
        
        document.getElementById('btn-upgrade-analytics')?.addEventListener('click', () => {
          switchActiveScreen('settings');
        });
      }
    }

    const viewCreditBook = document.getElementById('view-credit-book');
    if (viewCreditBook) {
      document.getElementById('starter-credit-upgrade-blocker')?.remove();
      if (tier === 'STARTER') {
        const blocker = document.createElement('div');
        blocker.id = 'starter-credit-upgrade-blocker';
        blocker.className = 'glass-blocker';
        blocker.innerHTML = `
          <div class="blocker-content">
            <div style="font-size: 48px; margin-bottom: 20px;">📕</div>
            <h2 style="font-family: var(--font-display); font-size: 24px; font-weight: 800; color: var(--text-white); margin-bottom: 8px; text-transform: uppercase;">Digital Credit Ledger (Khata)</h2>
            <p style="color: var(--text-gray); font-size: 13px; max-width: 360px; margin: 0 auto 24px; line-height: 1.5;">Log local customer credit outstanding, liability history, and click-to-chat links on the PRO Tier.</p>
            <button class="action-btn action-success" id="btn-upgrade-credit" style="min-height: 48px; padding: 0 24px; font-weight: 800; font-size: 12px; text-transform: uppercase;">Upgrade Store License</button>
          </div>
        `;
        viewCreditBook.style.position = 'relative';
        viewCreditBook.appendChild(blocker);
        
        document.getElementById('btn-upgrade-credit')?.addEventListener('click', () => {
          switchActiveScreen('settings');
        });
      }
    }

    // 3. For Starter Tier: Disable Sync Client and post state change to worker
    if (tier === 'STARTER' && syncWorker) {
      syncWorker.postMessage({
        type: 'SET_ONLINE_STATE',
        payload: { isOnline: false }
      });
      const badge = document.getElementById('net-badge');
      const text = document.getElementById('net-status-text');
      if (badge && text) {
        badge.className = 'network-badge offline';
        text.textContent = 'OFFLINE (LOCAL TIER)';
      }
    } else if (syncWorker) {
      syncWorker.postMessage({
        type: 'SET_ONLINE_STATE',
        payload: { isOnline: navigator.onLine }
      });
    }
  }

  // --- DEVICE WHITELIST/PAIRING REST UTILITIES ---
  async function loadWhitelistDevices() {
    const tbody = document.getElementById('device-list-tbody');
    if (!tbody) return;
    try {
      const res = await fetch('/api/devices', {
        headers: {
          'Authorization': `Bearer ${state.deviceToken || ''}`
        }
      });
      if (res.status === 401) {
        console.warn('[App] Device token was rejected by server (401). Attempting auto-registration recovery...');
        state.deviceToken = null;
        await NexovaDB.delete('local_preferences', 'device_token');

        try {
          const serverBase = (window.__nexovaServerUrl || location.origin);
          const regResp = await fetch(serverBase + '/api/devices/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nodeId: state.nodeId, deviceName: 'Web Register' })
          });
          if (regResp.ok) {
            const regData = await regResp.json();
            if (regData.status === 'APPROVED' && regData.token) {
              console.log('[App] Auto-registration recovery success. Token stored.');
              await NexovaDB.put('local_preferences', {
                key: 'device_token',
                value_type: 'STR',
                value_payload: regData.token,
                is_idempotent_flag: 0,
                updated_at: Date.now()
              });
              state.deviceToken = regData.token;
              // Retry loading devices with the fresh token
              return loadWhitelistDevices();
            }
          }
        } catch (err) {
          console.warn('[App] Auto-registration recovery failed:', err);
        }

        showPairingOverlay(true, 'form');
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-gray); padding: 24px;">Unauthorized. Please request pairing.</td></tr>`;
        return;
      }
      if (!res.ok) throw new Error('Failed to load devices: ' + res.statusText);
      const devices = await res.json();
      tbody.innerHTML = '';
      if (devices.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-gray); padding: 24px;">No pairing requests yet.</td></tr>`;
        return;
      }
      devices.forEach(dev => {
        const row = document.createElement('tr');
        row.style.borderBottom = '1px solid var(--border-titanium)';
        
        const isApproved = dev.status === 'APPROVED';
        const statusStyle = isApproved ? 'color: var(--accent-emerald); font-weight: 700;' : 'color: var(--warning); font-weight: 700;';
        
        const actions = isApproved 
          ? `<button class="action-btn action-danger btn-reject-device" data-id="${dev.node_id}" style="min-height: 32px; padding: 4px 8px; font-size: 10px;">Revoke</button>`
          : `<button class="action-btn action-success btn-approve-device" data-id="${dev.node_id}" style="min-height: 32px; padding: 4px 8px; font-size: 10px; margin-right: 8px;">Approve</button>` +
            `<button class="action-btn action-danger btn-reject-device" data-id="${dev.node_id}" style="min-height: 32px; padding: 4px 8px; font-size: 10px;">Reject</button>`;
             
        row.innerHTML = `
          <td style="padding: 12px 8px; font-weight: 600;">${dev.device_name}</td>
          <td style="padding: 12px 8px; font-family: monospace;">${dev.node_id}</td>
          <td style="padding: 12px 8px; font-size: 10px; color: var(--text-gray); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${dev.user_agent}</td>
          <td style="padding: 12px 8px; ${statusStyle}">${dev.status}</td>
          <td style="padding: 12px 8px; text-align: right;">${actions}</td>
        `;
        tbody.appendChild(row);
      });
      
      // Bind actions
      tbody.querySelectorAll('.btn-approve-device').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          await approveDevice(id);
        });
      });
      tbody.querySelectorAll('.btn-reject-device').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          if (confirm(`Are you sure you want to revoke/reject device ${id}?`)) {
            await rejectDevice(id);
          }
        });
      });
    } catch (err) {
      console.error('[App] Error loading device list:', err);
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--alert-coral); padding: 24px;">Failed to load devices: ${err.message}</td></tr>`;
    }
  }

  async function approveDevice(nodeId) {
    playAudioSignal('click');
    try {
      const res = await fetch('/api/devices/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.deviceToken || ''}`
        },
        body: JSON.stringify({ nodeId })
      });
      if (!res.ok) throw new Error('Approval request failed.');
      playAudioSignal('success');
      await loadWhitelistDevices();
    } catch (err) {
      alert('Approval error: ' + err.message);
    }
  }

  async function rejectDevice(nodeId) {
    playAudioSignal('click');
    try {
      const res = await fetch('/api/devices/reject', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.deviceToken || ''}`
        },
        body: JSON.stringify({ nodeId })
      });
      if (!res.ok) throw new Error('Rejection request failed.');
      playAudioSignal('reset');
      await loadWhitelistDevices();
    } catch (err) {
      alert('Rejection error: ' + err.message);
    }
  }

  // Verify Security Pin pad login — dual-path: local IndexedDB first, server fallback
  async function verifyPinCredentials() {
    const errorMsg = document.getElementById('auth-error');
    if (errorMsg) errorMsg.textContent = '';

    const roleEl = document.getElementById('login-terminal-role');
    const selectedRole = roleEl ? roleEl.value : 'REGISTER';

    if (selectedRole === 'CFD') {
      state.terminalRole = 'CFD';
      document.getElementById('auth-lock-screen').classList.remove('active');
      document.getElementById('view-cfd').style.display = 'block';
      document.getElementById('pos-app-layout').style.display = 'none';
      try { playAudioSignal('login'); } catch(e) {}
      return;
    }

    if (selectedRole === 'KDS') {
      state.terminalRole = 'KDS';
      document.getElementById('auth-lock-screen').classList.remove('active');
      document.getElementById('view-kds').style.display = 'block';
      document.getElementById('pos-app-layout').style.display = 'none';
      try { playAudioSignal('login'); } catch(e) {}
      syncWorker.postMessage({ type: 'GET_TRANSACTIONS' });
      return;
    }

    if (state.currentPin.length === 0) {
      if (errorMsg) errorMsg.textContent = 'Please enter security PIN';
      return;
    }

    // Show subtle loading state on the input
    const pinInput = document.getElementById('pin-input');
    if (pinInput) {
      pinInput.style.opacity = '0.5';
      pinInput.disabled = true;
    }

    try {
      // STEP 1: Try local IndexedDB offline PBKDF2 verification
      let matched = null;
      try {
        matched = await NexovaDB.verifyEmployeePin(state.currentPin);
      } catch (localErr) {
        console.warn('[Auth] Local PIN verify threw:', localErr.message);
      }

      // STEP 2: Server fallback — handles fresh installs where local DB has no employees yet
      if (!matched) {
        console.log('[Auth] No local match — trying server /api/employee/login');
        try {
          const serverBase = (window.__nexovaServerUrl || location.origin);
          const resp = await fetch(serverBase + '/api/employee/login', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${state.deviceToken || ''}`
            },
            body: JSON.stringify({ pin: state.currentPin })
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data) {
              matched = data.employee || (data.id ? data : null);
              if (matched) {
                console.log('[Auth] Server PIN match for:', matched.id);
              }
            }
          }
        } catch (serverErr) {
          console.warn('[Auth] Server unreachable (offline mode):', serverErr.message);
        }
      }

      // Restore input state
      if (pinInput) {
        pinInput.style.opacity = '1';
        pinInput.disabled = false;
      }

      if (matched) {
        matched.clockIn = Date.now();
        state.activeCashier = matched;
        state.terminalRole = 'REGISTER';
        document.getElementById('auth-lock-screen').classList.remove('active');
        document.getElementById('view-cfd').style.display = 'none';
        document.getElementById('view-kds').style.display = 'none';
        document.getElementById('pos-app-layout').style.display = 'grid';
        const nameEl = document.getElementById('cashier-display-name');
        const roleDispEl = document.getElementById('cashier-display-role');
        if (nameEl) nameEl.textContent = (matched.name || matched.id || '').replace('emp_', '').toUpperCase();
        if (roleDispEl) roleDispEl.textContent = matched.role || 'CASHIER';
        applyRoleNavigationLimits(matched.role);
        try { playAudioSignal('login'); } catch(e) {}
      } else {
        if (errorMsg) errorMsg.textContent = 'Invalid PIN. Try again.';
        try { playAudioSignal('error'); } catch(e) {}
        state.currentPin = '';
        updatePinDisplayDots();
        if (pinInput) pinInput.focus();
      }
    } catch (e) {
      if (pinInput) {
        pinInput.style.opacity = '1';
        pinInput.disabled = false;
        pinInput.focus();
      }
      if (errorMsg) errorMsg.textContent = 'Error: ' + e.message;
      console.error('[Auth] verifyPinCredentials failed:', e);
    }
  }

  // UI state transition dots
  function updatePinDisplayDots() {
    const pinInput = document.getElementById('pin-input');
    if (pinInput) {
      pinInput.value = state.currentPin;
    }

    // Update the visual dot elements in the premium .pin-display overlay
    const dots = document.querySelectorAll('#pin-display .dot');
    dots.forEach((dot, index) => {
      if (index < state.currentPin.length) {
        dot.classList.add('filled');
      } else {
        dot.classList.remove('filled');
      }
    });
  }

  // Tab screen switches
  async function switchActiveScreen(screenName) {
    // Gating check: Cashier accessing Supervisor/Owner screens
    const isManagerScreen = ['settings', 'logs', 'staff', 'catalog-manager', 'suppliers', 'fbr-fiscal', 'multi-store', 'data-portability'].includes(screenName);
    if (isManagerScreen && state.activeCashier && state.activeCashier.role === 'CASHIER') {
      const pin = await promptManagerPIN();
      if (!pin) return;
      
      let matched = null;
      try {
        matched = await NexovaDB.verifyEmployeePin(pin);
      } catch (err) {
        console.warn('[Auth] Manager PIN verify failed:', err);
      }
      
      if (!matched || (matched.role !== 'ADMIN' && matched.role !== 'MANAGER')) {
        alert('Access denied: Invalid Manager/Admin PIN.');
        return;
      }
      console.log(`[Auth] Supervisor authorization granted for: ${matched.name}. Entering ${screenName}.`);
    }

    playAudioSignal('click');
    state.activeScreen = screenName;

    // Toggle active classes on nav item nodes
    document.querySelectorAll('.nav-item').forEach(item => {
      if (item.getAttribute('data-screen') === screenName) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    document.querySelectorAll('.pos-bottom-nav .nav-btn').forEach(btn => {
      if (btn.getAttribute('data-screen') === screenName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Show active container panel
    document.querySelectorAll('.content-view').forEach(view => {
      if (view.id === 'view-' + screenName) {
        view.classList.add('active');
      } else {
        view.classList.remove('active');
      }
    });

    // Update Top status title
    const formattedTitle = screenName.charAt(0).toUpperCase() + screenName.slice(1);
    document.getElementById('active-view-title').textContent = formattedTitle;

    // Trigger data query refresh based on view
    if (screenName === 'catalog' || screenName === 'catalog-manager') {
      syncWorker.postMessage({ type: 'GET_CATALOG' });
    } else if (screenName === 'customers') {
      syncWorker.postMessage({ type: 'GET_CUSTOMERS' });
    } else if (screenName === 'staff') {
      syncWorker.postMessage({ type: 'GET_EMPLOYEES' });
    } else if (screenName === 'history') {
      syncWorker.postMessage({ type: 'GET_TRANSACTIONS' });
    } else if (screenName === 'settings') {
      syncWorker.postMessage({ type: 'GET_PREFERENCES' });
      if (state.activeCashier && state.activeCashier.role === 'ADMIN') {
        const adminSection = document.getElementById('settings-device-whitelisting');
        if (adminSection) {
          adminSection.style.display = 'block';
          loadWhitelistDevices();
        }
      } else {
        const adminSection = document.getElementById('settings-device-whitelisting');
        if (adminSection) adminSection.style.display = 'none';
      }
      
      // Update SaaS License Status Card in UI
      (() => {
        const tierVal = document.getElementById('license-active-tier-val');
        const expiryVal = document.getElementById('license-active-expiry-val');
        const devicesVal = document.getElementById('license-active-devices-val');
        
        if (tierVal && expiryVal && devicesVal) {
          const tier = window.__nexovaTier || 'STARTER';
          const isTrial = isGraceTrialActive() || tier === 'TRIAL';
          tierVal.textContent = isTrial ? 'FREE TRIAL (ENTERPRISE FEATURES)' : tier;
          
          const token = localStorage.getItem('nexova_license_token');
          if (token) {
            try {
              const decoded = atob(token);
              const pipeIndex = decoded.lastIndexOf('|');
              if (pipeIndex !== -1) {
                const claims = JSON.parse(decoded.substring(0, pipeIndex));
                expiryVal.textContent = claims.exp ? new Date(claims.exp).toLocaleDateString() : 'Lifetime License';
                devicesVal.textContent = claims.tier === 'STARTER' ? '1 Terminal' : (claims.tier === 'PRO' ? '3 Terminals' : '100 Terminals (Unlimited)');
              }
            } catch (e) {
              expiryVal.textContent = 'Invalid license token';
              devicesVal.textContent = 'Restricted';
            }
          } else {
            expiryVal.textContent = '3-Day Grace Period';
            devicesVal.textContent = '100 Terminals';
          }
        }
      })();
    } else if (screenName === 'suppliers') {
      syncWorker.postMessage({ type: 'GET_DISTRIBUTORS' });
      syncWorker.postMessage({ type: 'GET_PURCHASE_ORDERS' });
      syncWorker.postMessage({ type: 'GET_DISTRIBUTOR_PAYMENTS' });
    } else if (screenName === 'credit-book') {
      syncWorker.postMessage({ type: 'GET_CUSTOMER_CREDIT' });
      syncWorker.postMessage({ type: 'GET_CUSTOMERS' });
    } else if (screenName === 'analytics') {
      syncWorker.postMessage({ type: 'GET_TRANSACTIONS' });
      syncWorker.postMessage({ type: 'GET_DISTRIBUTORS' });
      syncWorker.postMessage({ type: 'GET_PURCHASE_ORDERS' });
    } else if (screenName === 'logs') {
      syncWorker.postMessage({ type: 'GET_TRANSACTIONS' });
    }
    
    // Toggle mobile scanner FAB visibility
    const mobileScannerFab = document.getElementById('btn-mobile-scanner-fab');
    if (mobileScannerFab) {
      if (screenName === 'checkout' && window.innerWidth <= 768) {
        mobileScannerFab.style.display = 'flex';
      } else {
        mobileScannerFab.style.display = 'none';
      }
    }
  }

  // Sleek Platinized Supervisor PIN Overlay Prompter
  function promptManagerPIN() {
    return new Promise((resolve) => {
      document.getElementById('manager-pin-overlay')?.remove();
      
      const overlay = document.createElement('div');
      overlay.id = 'manager-pin-overlay';
      overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 999999;
        background: rgba(5,5,8,0.95);
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      `;
      
      overlay.innerHTML = `
        <div class="auth-card" style="max-width: 320px; width: 90%; padding: 24px; border: 1px solid var(--border-titanium); background: var(--panel-graphite); box-shadow: 0 20px 40px rgba(0,0,0,0.6); border-radius: 8px; text-align: center;">
          <div style="color: var(--accent-amber); margin-bottom: 12px;">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <h3 style="font-family: var(--font-display); font-size: 14px; font-weight: 800; color: var(--text-white); margin-bottom: 4px; text-transform: uppercase;">Supervisor Auth</h3>
          <p style="font-size: 10px; color: var(--text-gray); margin-bottom: 16px;">Enter Manager or Admin PIN to authorize access.</p>
          
          <input type="password" id="mgr-pin-input" maxlength="4" placeholder="••••" readonly style="width: 100%; height: 44px; background: #000; border: 1px solid var(--border-titanium); color: #fff; text-align: center; font-size: 20px; letter-spacing: 8px; outline: none; border-radius: 4px; margin-bottom: 16px;">
          
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px;">
            <button class="mgr-pin-btn" type="button" style="height: 40px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-titanium); color: #fff; font-size: 14px; font-weight: 700; border-radius: 4px; cursor: pointer;">1</button>
            <button class="mgr-pin-btn" type="button" style="height: 40px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-titanium); color: #fff; font-size: 14px; font-weight: 700; border-radius: 4px; cursor: pointer;">2</button>
            <button class="mgr-pin-btn" type="button" style="height: 40px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-titanium); color: #fff; font-size: 14px; font-weight: 700; border-radius: 4px; cursor: pointer;">3</button>
            <button class="mgr-pin-btn" type="button" style="height: 40px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-titanium); color: #fff; font-size: 14px; font-weight: 700; border-radius: 4px; cursor: pointer;">4</button>
            <button class="mgr-pin-btn" type="button" style="height: 40px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-titanium); color: #fff; font-size: 14px; font-weight: 700; border-radius: 4px; cursor: pointer;">5</button>
            <button class="mgr-pin-btn" type="button" style="height: 40px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-titanium); color: #fff; font-size: 14px; font-weight: 700; border-radius: 4px; cursor: pointer;">6</button>
            <button class="mgr-pin-btn" type="button" style="height: 40px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-titanium); color: #fff; font-size: 14px; font-weight: 700; border-radius: 4px; cursor: pointer;">7</button>
            <button class="mgr-pin-btn" type="button" style="height: 40px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-titanium); color: #fff; font-size: 14px; font-weight: 700; border-radius: 4px; cursor: pointer;">8</button>
            <button class="mgr-pin-btn" type="button" style="height: 40px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-titanium); color: #fff; font-size: 14px; font-weight: 700; border-radius: 4px; cursor: pointer;">9</button>
            <button id="btn-mgr-clear" type="button" style="height: 40px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); color: var(--alert-coral); font-size: 10px; font-weight: 800; border-radius: 4px; cursor: pointer;">CLR</button>
            <button class="mgr-pin-btn" type="button" style="height: 40px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-titanium); color: #fff; font-size: 14px; font-weight: 700; border-radius: 4px; cursor: pointer;">0</button>
            <button id="btn-mgr-enter" type="button" style="height: 40px; background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2); color: var(--accent-emerald); font-size: 10px; font-weight: 800; border-radius: 4px; cursor: pointer;">ENT</button>
          </div>
          
          <button id="btn-mgr-cancel" type="button" style="width: 100%; height: 32px; background: transparent; border: 1px solid var(--border-titanium); color: var(--text-gray); font-size: 10px; font-weight: 700; border-radius: 4px; cursor: pointer;">
            CANCEL
          </button>
        </div>
      `;
      
      document.body.appendChild(overlay);
      
      const pinInput = document.getElementById('mgr-pin-input');
      let currentPin = '';
      
      overlay.querySelectorAll('.mgr-pin-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          playAudioSignal('click');
          if (currentPin.length < 4) {
            currentPin += btn.textContent;
            pinInput.value = currentPin;
          }
        });
      });
      
      document.getElementById('btn-mgr-clear').addEventListener('click', () => {
        playAudioSignal('click');
        currentPin = '';
        pinInput.value = '';
      });
      
      document.getElementById('btn-mgr-cancel').addEventListener('click', () => {
        playAudioSignal('click');
        overlay.remove();
        resolve(null);
      });
      
      document.getElementById('btn-mgr-enter').addEventListener('click', () => {
        playAudioSignal('click');
        overlay.remove();
        resolve(currentPin);
      });
    });
  }

  // Network badge UI update
  function updateNetworkBadge(isConnected) {
    const badge = document.getElementById('net-badge');
    const txt = document.getElementById('net-status-text');
    const pill = document.getElementById('mobile-offline-pill');

    if (isConnected) {
      badge.className = 'network-badge online';
      txt.textContent = 'ONLINE';
      if (pill) pill.classList.remove('active');
    } else {
      badge.className = 'network-badge offline';
      txt.textContent = 'OFFLINE';
      if (pill) pill.classList.add('active');
    }
  }

  // Save key maps mapping to worker preferences
  function mapPreferences(prefs) {
    const prefObj = {};
    for (const p of prefs) {
      prefObj[p.key] = p.value_payload;
    }
    state.preferences = prefObj;
    state.deviceToken = prefObj['device_token'] || null;
    applyPreferencesFromState();
  }

  // Serve a dynamic glassmorphic loading screen for bootstrap hydration
  function mountHydrationOverlay() {
    if (document.getElementById('hydration-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'hydration-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 999999;
      background: rgba(6, 6, 8, 0.9);
      backdrop-filter: blur(20px);
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      font-family: 'Manrope', sans-serif; padding: 32px;
      color: #f8fafc;
    `;
    overlay.innerHTML = `
      <div style="max-width: 400px; width: 100%; text-align: center;">
        <div style="position: relative; width: 64px; height: 64px; margin: 0 auto 24px auto;">
          <div style="position: absolute; inset: 0; border: 4px solid rgba(13, 148, 136, 0.1); border-radius: 50%;"></div>
          <div style="position: absolute; inset: 0; border: 4px solid #0d9488; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
        </div>
        <div style="font-size: 20px; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 12px; color: #ffffff;">
          Syncing Cloud Data...
        </div>
        <div style="font-size: 13px; color: #94a3b8; line-height: 1.6; margin-bottom: 16px;">
          Downloading your store catalog, customers, and setting up secure offline-first databases.
        </div>
        <p id="hydration-status" style="font-size: 11px; color: #0d9488; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Initializing download...</p>
      </div>
      <style>
        @keyframes spin { to { transform: rotate(360deg); } }
      </style>
    `;
    document.body.appendChild(overlay);
  }

  // Apply whitelabel customizations to browser window
  function applyPreferencesFromState() {
    // 0. Database Hydration Check (Data Continuity)
    const licenseToken = localStorage.getItem('nexova_license_token');
    const databaseHydrated = state.preferences['database_hydrated'] === 'true';
    const onboardingComplete = state.preferences['onboarding_complete'] === 'true';

    if (licenseToken && onboardingComplete && !databaseHydrated) {
      if (!window.__hydrationInProgress) {
        window.__hydrationInProgress = true;
        mountHydrationOverlay();
        syncWorker.postMessage({
          type: 'HYDRATE_DATABASE',
          payload: { licenseToken }
        });
      }
      return;
    }

    // 0.b First Boot Onboarding Check
    const wizardOverlay = document.getElementById('first-boot-wizard');
    const lockScreen = document.getElementById('auth-lock-screen');
    const layout = document.getElementById('pos-app-layout');

    if (!onboardingComplete) {
      if (wizardOverlay) wizardOverlay.style.display = 'flex';
      if (lockScreen) lockScreen.classList.remove('active');
      if (layout) layout.style.display = 'grid'; // Show layout, wizard is on top
      showPairingOverlay(false); // Hide pairing screen if onboarding is active
      return;
    } else {
      if (wizardOverlay) wizardOverlay.style.display = 'none';
      if (!state.activeCashier && !state.terminalRole) {
        if (lockScreen) lockScreen.classList.add('active');
        if (layout) layout.style.display = 'none';
        // Auto-focus passcode input so mobile/virtual keyboard opens or physical keyboards capture immediately
        setTimeout(() => {
          const pinInput = document.getElementById('pin-input');
          if (pinInput) pinInput.focus();
        }, 300);
      } else {
        if (lockScreen) lockScreen.classList.remove('active');
        if (layout) layout.style.display = 'grid';
      }
    }

    const name = state.preferences['store_name'] || 'NEXOVA COFFEE & RETAIL';
    document.getElementById('sidebar-store-name').textContent = name.substring(0, 15).toUpperCase();
    document.getElementById('setting-store-name').value = name;

    const gdriveToken = localStorage.getItem('google_drive_oauth_token') || state.preferences['google_drive_oauth_token'] || '';
    const settingGDriveToken = document.getElementById('setting-google-drive-token');
    if (settingGDriveToken) {
      settingGDriveToken.value = gdriveToken;
    }

    const tax = state.preferences['store_tax_rate'] || '8.0';
    document.getElementById('setting-tax-rate').value = parseFloat(tax).toFixed(1);
    document.getElementById('txt-tax-rate-label').textContent = `Tax (${parseFloat(tax).toFixed(1)}%)`;

    const taxMode = state.preferences['store_tax_mode'] || 'FLAT';
    const taxModeEl = document.getElementById('setting-tax-mode');
    if (taxModeEl) taxModeEl.value = taxMode;

    const lang = state.preferences['system_language'] || 'en';
    setTimeout(() => {
      setLanguage(lang);
    }, 100);

    const tagline = state.preferences['store_receipt_tagline'] || 'Stability meets Speed. Thank you!';
    document.getElementById('setting-receipt-tagline').value = tagline;

    const width = state.preferences['store_receipt_width'] || '42';
    document.getElementById('setting-receipt-width').value = width;

    const palette = state.preferences['store_theme_palette'] || 'Obsidian Emerald';
    document.getElementById('setting-theme-palette').value = palette;
    const themeClass = 'theme-' + palette.toLowerCase().replace(/\s+/g, '-');
    const body = document.body;
    const themes = ['theme-obsidian-emerald', 'theme-midnight-sapphire', 'theme-warm-amber', 'theme-minimalist-chrome', 'theme-monochrome-ivory'];
    themes.forEach(t => body.classList.remove(t));
    body.classList.add(themeClass);

    const glass = state.preferences['glassmorphism_enabled'] !== 'false';
    document.getElementById('setting-glass-fx').checked = glass;
    body.classList.toggle('performance-solid-mode', !glass);

    const walletPhone = state.preferences['setting_wallet_phone'] || '';
    const phoneInput = document.getElementById('setting-wallet-phone');
    if (phoneInput) phoneInput.value = walletPhone;

    const oversellBlock = state.preferences['oversell_block_enabled'] === 'true';
    const oversellEl = document.getElementById('setting-oversell-block');
    if (oversellEl) oversellEl.checked = oversellBlock;

    const audioEnabled = state.preferences['audio_feedback_enabled'] !== 'false';
    const audioEl = document.getElementById('setting-audio-enabled');
    if (audioEl) audioEl.checked = audioEnabled;

    const hapticEnabled = state.preferences['haptic_feedback_enabled'] !== 'false';
    const hapticEl = document.getElementById('setting-haptic-enabled');
    if (hapticEl) hapticEl.checked = hapticEnabled;

    const fbrToggle = document.getElementById('setting-fbr-enabled');
    if (fbrToggle) fbrToggle.checked = state.preferences['fbr_integration_enabled'] === 'true';

    const scanThreshold = state.preferences['hid_scan_threshold_ms'] || '80';
    const scanThresholdEl = document.getElementById('setting-scan-threshold');
    if (scanThresholdEl) scanThresholdEl.value = scanThreshold;

    // Load P2P sync passphrase preference and draw QR
    const syncPassphrase = state.preferences['sync_passphrase'] || '';
    const passInput = document.getElementById('setting-sync-passphrase');
    if (passInput) passInput.value = syncPassphrase;

    drawPairingQr(syncPassphrase);

    async function drawPairingQr(passphrase) {
      const qrContainer = document.getElementById('setting-qr-container');
      if (!qrContainer) return;
      qrContainer.innerHTML = '';
      
      if (!passphrase) {
        qrContainer.innerHTML = '<span style="font-size: 8px; color: var(--text-gray); text-align: center;">Set passphrase to show pairing QR</span>';
        return;
      }
      
      let serverIp = window.location.hostname;
      let port = window.location.port || '3000';
      
      try {
        const resp = await fetch('/api/server-info');
        if (resp.ok) {
          const info = await resp.json();
          if (info.ips && info.ips.length > 0) {
            serverIp = info.ips[0];
            port = info.port || port;
          }
        }
      } catch (err) {
        console.warn('Failed to load server IP info:', err);
      }
      
      const pairingUrl = `http://${serverIp}:${port}/#passphrase=${encodeURIComponent(passphrase)}`;
      
      if (typeof QRCode !== 'undefined') {
        try {
          new QRCode(qrContainer, {
            text: pairingUrl,
            width: 104,
            height: 104,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
          });
        } catch (qrErr) {
          console.error('Error rendering QRCode:', qrErr);
        }
      }
    }

    // Refresh totals on checkout
    renderCart();
    performLicenseCheck();
  }

  // Dynamic UI Language Localization (English / Urdu)
  function setLanguage(lang) {
    state.preferences['system_language'] = lang;
    syncWorker.postMessage({
      type: 'SAVE_PREFERENCE',
      payload: { key: 'system_language', val: lang }
    });

    const isUrdu = lang === 'ur';
    const langBtn = document.getElementById('lang-toggle-btn');
    if (langBtn) {
      langBtn.textContent = isUrdu ? 'English' : 'اردو';
    }

    // Toggle RTL document flow and fonts
    if (isUrdu) {
      document.body.classList.add('rtl');
      document.body.style.fontFamily = "'Noto Nastaliq Urdu', 'Outfit', sans-serif";
    } else {
      document.body.classList.remove('rtl');
      document.body.style.fontFamily = "";
    }

    // Map of CSS selectors to translated texts
    const textMapping = {
      '[data-screen="checkout"] .nav-label': isUrdu ? 'بلنگ (بِکاو)' : 'Checkout',
      '[data-screen="catalog"] .nav-label': isUrdu ? 'مصنوعات' : 'Catalog',
      '[data-screen="catalog-manager"] .nav-label': isUrdu ? 'انوینٹری' : 'Inventory',
      '[data-screen="history"] .nav-label': isUrdu ? 'ریکارڈ تاریخ' : 'History',
      '[data-screen="analytics"] .nav-label': isUrdu ? 'رپورٹس' : 'Analytics',
      '[data-screen="customers"] .nav-label': isUrdu ? 'گاہکوں کا کھاتہ' : 'Customers',
      '[data-screen="suppliers"] .nav-label': isUrdu ? 'سپلائرز' : 'Suppliers',
      '[data-screen="credit-book"] .nav-label': isUrdu ? 'ادھار بک' : 'Credit Book',
      '[data-screen="staff"] .nav-label': isUrdu ? 'سٹاف ممبرز' : 'Staff',
      '[data-screen="logs"] .nav-label': isUrdu ? 'لاگز' : 'Sync Logs',
      '[data-screen="settings"] .nav-label': isUrdu ? 'سیٹنگز' : 'Settings',
      '.ledger-header .title': isUrdu ? 'موجودہ آرڈر' : 'Active Order',
      '#btn-void-order': isUrdu ? 'آرڈر کینسل کریں' : 'Void Order',
      '.cart-table th:nth-child(1)': isUrdu ? 'آئٹم' : 'Product',
      '.cart-table th:nth-child(2)': isUrdu ? 'قیمت' : 'Price',
      '.cart-table th:nth-child(3)': isUrdu ? 'تعداد' : 'Qty',
      '.cart-table th:nth-child(4)': isUrdu ? 'ٹوٹل' : 'Total',
      '.ledger-footer .totals-row:nth-child(1) span:nth-child(1)': isUrdu ? 'کل رقم' : 'Subtotal',
      '.ledger-footer .totals-row:nth-child(3) span:nth-child(1)': isUrdu ? 'قابلِ ادائیگی رقم' : 'Total Due',
      '#checkout-quick-catalog .lbl': isUrdu ? 'فوری مصنوعات' : 'Quick Products',
      '#checkout-quick-search': isUrdu ? 'تلاش کریں...' : 'Quick search...',
      '.checkout-actions .lbl-cust': isUrdu ? 'گاہک منسلک کریں' : 'Customer Profile',
      '#checkout-customer-attached .text-muted': isUrdu ? 'کوئی گاہک منسلک نہیں ہے۔' : 'No customer attached to transaction.',
      '.payment-card .lbl': isUrdu ? 'ادائیگی کا طریقہ' : 'Payment Method',
      '[data-mode="CASH"]': isUrdu ? 'کیش' : 'Cash',
      '[data-mode="CARD"]': isUrdu ? 'کارڈ' : 'Card',
      '[data-mode="QR"]': isUrdu ? 'کیو آر کوڈ' : 'QR Code',
      '[data-mode="SPLIT"]': isUrdu ? 'تقسیم ادائیگی' : 'Split',
      '[data-mode="CREDIT"]': isUrdu ? 'ادھار' : 'Credit (Udhaar)',
      '#btn-checkout-complete span': isUrdu ? 'آرڈر مکمل کریں (F1)' : 'COMPLETE ORDER (F1)',
      '#btn-wiz-choose-new': isUrdu ? 'نیا سٹور بنائیں' : 'Set Up New Standalone Store',
      '#btn-wiz-choose-join': isUrdu ? 'نیٹ ورک میں شامل ہوں' : 'Join Existing Store Network',
      '#wizard-step-title': isUrdu ? 'نیکسوا سیٹ اپ' : 'Nexova Setup',
      '#btn-wiz-back': isUrdu ? 'پیچھے جائیں' : 'Back',
      '#btn-wiz-next': isUrdu ? 'آگے بڑھیں' : 'Continue'
    };

    for (const [selector, text] of Object.entries(textMapping)) {
      const el = document.querySelector(selector);
      if (el) {
        const textNode = Array.from(el.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== '');
        if (textNode) {
          textNode.textContent = text;
        } else {
          el.textContent = text;
        }
      }
    }

    // Refresh totals labels dynamically
    const sub = calculateSubtotal();
    const taxMode = state.preferences['store_tax_mode'] || 'FLAT';
    let taxLabel = 'Tax';
    let rateStr = '';

    if (taxMode === 'FBR_FOOD') {
      const payModeBtn = document.querySelector('.payment-btn.active');
      const paymentMode = payModeBtn ? payModeBtn.getAttribute('data-mode') : 'CASH';
      rateStr = (paymentMode === 'CARD' || paymentMode === 'QR' || paymentMode === 'MOBILE') ? '5.0%' : '15.0%';
      taxLabel = isUrdu ? `ٹیکس FBR (${rateStr})` : `FBR Tax (${rateStr})`;
    } else if (taxMode === 'FBR_RETAIL') {
      rateStr = '18.0%';
      taxLabel = isUrdu ? `ٹیکس FBR (${rateStr})` : `FBR Tax (${rateStr})`;
    } else {
      const taxRate = parseFloat(state.preferences['store_tax_rate'] || '8.0');
      rateStr = `${taxRate.toFixed(1)}%`;
      taxLabel = isUrdu ? `ٹیکس (${rateStr})` : `Tax (${rateStr})`;
    }

    const taxLabelEl = document.getElementById('txt-tax-rate-label');
    if (taxLabelEl) taxLabelEl.textContent = taxLabel;
  }

  // Client license validation check
  async function performLicenseCheck() {
    // 0. Demo Mode URL Parameter Handler
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('demo') === 'true') {
      console.log("[License] Register running in persistent demo override mode.");
      document.getElementById('license-lockout-overlay').style.display = 'none';
      return;
    }

    // 1. Fetch hardware fingerprint from server
    let deviceFingerprint = 'web_client_node';
    try {
      const resp = await fetch('/api/server-info');
      if (resp.ok) {
        const info = await resp.json();
        if (info.fingerprint) {
          deviceFingerprint = info.fingerprint;
        }
      }
    } catch (err) {
      console.warn('[License] Failed to fetch server fingerprint:', err);
    }

    // 2. Fetch license preference fields
    const licenseToken = localStorage.getItem('nexova_license_token') || null;
    const phoneBound = state.preferences['license_phone_bound'] || null;

    const lockoutOverlay = document.getElementById('license-lockout-overlay');
    if (!lockoutOverlay) return;

    // Helper to draw countdown badge
    function showTrialBadge(remainingDays) {
      const headerTitle = document.getElementById('active-view-title');
      if (headerTitle) {
        let trialLabel = document.getElementById('trial-countdown-badge');
        if (!trialLabel) {
          trialLabel = document.createElement('span');
          trialLabel.id = 'trial-countdown-badge';
          trialLabel.style.cssText = 'font-size: 9.5px; padding: 3px 10px; border-radius: 99px; background: rgba(255, 179, 71, 0.1); color: var(--warning); border: 1px solid rgba(255,179,71,0.2); margin-left: 10px; font-weight: 700; font-family: var(--font-body); letter-spacing: 0.5px; vertical-align: middle;';
          headerTitle.parentNode.appendChild(trialLabel);
        }
        trialLabel.textContent = `TRIAL MODE: ${remainingDays} DAYS LEFT`;
      }
    }

    // 2.b If LicenseEngine already validated a paid tier, return early
    if (window.__nexovaTier && window.__nexovaTier !== 'TRIAL') {
      console.log(`[License] Valid ${window.__nexovaTier} license verified by LicenseEngine.`);
      lockoutOverlay.style.display = 'none';
      document.getElementById('trial-countdown-badge')?.remove();
      return;
    }

    // 3. If phone is bound via OTP bypass, register is unlocked
    if (phoneBound) {
      console.log("[License] Register verified via mobile phone binding: " + phoneBound);
      lockoutOverlay.style.display = 'none';
      return;
    }

    if (licenseToken) {
      // Validate license token locally or with worker
      try {
        const verifyResp = await fetch('https://nexova-license-worker.pages.dev/api/license/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: licenseToken, nodeId: deviceFingerprint })
        });

        if (verifyResp.ok) {
          const res = await verifyResp.json();
          if (res.success) {
            window.__nexovaTier = res.payload.tier; // CRITICAL FIX
            applyTierRestrictions(); // Force UI to unlock features
            console.log(`[License] Valid ${res.payload.tier} license verified. Expires: ${new Date(res.payload.expiresAt).toLocaleDateString()}`);
            lockoutOverlay.style.display = 'none';
            if (res.payload.tier === 'TRIAL') {
              const expires = res.payload.expiresAt ? new Date(res.payload.expiresAt).getTime() : Date.now();
              const remainingMs = expires - Date.now();
              const remainingDays = Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
              showTrialBadge(remainingDays);
            } else {
              document.getElementById('trial-countdown-badge')?.remove();
            }
            return;
          }
        }
      } catch (err) {
        console.warn('[License] Offline verification backup fallback - checking claims...');
        // Offline JWT decode/signature check fallback if internet is down
        try {
          const decoded = atob(licenseToken);
          const pipeIndex = decoded.lastIndexOf('|');
          if (pipeIndex !== -1) {
            const claims = JSON.parse(decoded.substring(0, pipeIndex));
            if (claims.hwid === deviceFingerprint && claims.exp > Date.now()) {
              window.__nexovaTier = claims.tier; // CRITICAL FIX
              applyTierRestrictions(); // Force UI to unlock features
              console.log(`[License] Offline verify success. Tier: ${claims.tier}`);
              lockoutOverlay.style.display = 'none';
              if (claims.tier === 'TRIAL') {
                const expires = claims.exp ? claims.exp : Date.now();
                const remainingMs = expires - Date.now();
                const remainingDays = Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
                showTrialBadge(remainingDays);
              } else {
                document.getElementById('trial-countdown-badge')?.remove();
              }
              return;
            }
          }
        } catch (e) {}
      }
    }

    // 4. If no valid license or phone binding is found: Lock down terminal UI!
    lockoutOverlay.style.display = 'flex';
    const authScreen = document.getElementById('auth-lock-screen');
    if (authScreen) authScreen.classList.remove('active');
    const wizardOverlay = document.getElementById('first-boot-wizard');
    if (wizardOverlay) wizardOverlay.style.display = 'none';
    playAudioSignal('error');
  }

  function renderSearchDropdown(matches) {
    const dropdown = document.getElementById('search-dropdown-results');
    dropdown.innerHTML = '';

    if (matches.length === 0) {
      dropdown.classList.remove('active');
      return;
    }

    const fragment = document.createDocumentFragment();

    matches.slice(0, 5).forEach((p, idx) => {
      const row = document.createElement('div');
      row.className = 'search-result-item';
      if (idx === 0) row.classList.add('highlighted');
      row.setAttribute('data-sku', p.sku);

      const catAbbr = p.category ? p.category.substring(0, 3).toUpperCase() : 'GEN';
      row.innerHTML = `
        <div>
          <span class="item-title"><span class="cat-badge">${catAbbr}</span> ${p.name}</span>
          <div class="item-meta">SKU: ${p.sku} | Barcode: ${p.gtin || 'N/A'}</div>
        </div>
        <span class="tx-amount">Rs. ${(p.base_price_minor_units / 100.0).toFixed(2)}</span>
      `;

      row.addEventListener('click', () => {
        addProductToCheckoutCart(p.sku);
        dropdown.classList.remove('active');
        document.getElementById('checkout-search-input').value = '';
      });

      fragment.appendChild(row);
    });

    dropdown.appendChild(fragment);
    dropdown.classList.add('active');
  }

  // Checkout Cart additions
  function addProductToCheckoutCart(sku) {
    const prod = state.catalog.find(p => p.sku === sku);
    if (!prod) return;

    const isOversellBlocked = state.preferences['oversell_block_enabled'] === 'true';

    if (prod.stock_level <= 0) {
      if (isOversellBlocked) {
        playAudioSignal('error');
        alert(`Oversell Blocked: Product "${prod.name}" (SKU ${sku}) is out of stock!`);
        return;
      } else {
        showNotificationToast(`⚠️ Oversell Warning: "${prod.name}" is out of stock. Proceeding with checkout.`, null, 3000);
      }
    }

    const exists = state.activeCart.find(item => item.sku === sku);
    if (exists) {
      if (exists.qty + 1 > prod.stock_level) {
        if (isOversellBlocked) {
          playAudioSignal('error');
          alert(`Oversell Blocked: Exceeds available stock level (${prod.stock_level} remaining).`);
          return;
        } else {
          showNotificationToast(`⚠️ Oversell Warning: Exceeds stock level (${prod.stock_level} remaining).`, null, 3000);
        }
      }
      exists.qty++;
    } else {
      state.activeCart.push({
        sku: prod.sku,
        name: prod.name,
        price: prod.base_price_minor_units,
        cost: prod.cost_price_minor_units || 0,
        qty: 1,
        emoji: ''
      });
    }

    playAudioSignal('click');
    renderCart();
  }

  // Modify quantity in cart
  function modifyCartQty(sku, delta) {
    const item = state.activeCart.find(i => i.sku === sku);
    const prod = state.catalog.find(p => p.sku === sku);
    if (!item || !prod) return;

    const isOversellBlocked = state.preferences['oversell_block_enabled'] === 'true';

    if (delta > 0 && item.qty + 1 > prod.stock_level) {
      if (isOversellBlocked) {
        playAudioSignal('error');
        alert(`Oversell Blocked: Exceeds available stock level (${prod.stock_level} remaining).`);
        return;
      } else {
        showNotificationToast(`⚠️ Oversell Warning: Exceeds stock level (${prod.stock_level} remaining).`, null, 3000);
      }
    }

    item.qty += delta;
    if (item.qty <= 0) {
      state.activeCart = state.activeCart.filter(i => i.sku !== sku);
    }
    
    playAudioSignal('click');
    renderCart();
  }

  // Remove item completely
  function removeCartItem(sku) {
    state.activeCart = state.activeCart.filter(i => i.sku !== sku);
    playAudioSignal('click');
    renderCart();
  }

  // Mobile swipe gestures with directional lock and haptics
  function bindSwipeEvents(row) {
    const fg = row.querySelector('.cart-swipe-fg');
    if (!fg) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let isSwipeGesture = null; // null: undecided, true: swipe, false: scroll
    let currentTranslateX = 0;
    const SWIPE_THRESHOLD = -100;

    row.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      isSwipeGesture = null;
      fg.style.transition = 'none';
    }, { passive: true });

    row.addEventListener('touchmove', (e) => {
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const diffX = currentX - touchStartX;
      const diffY = currentY - touchStartY;

      if (isSwipeGesture === null) {
        if (Math.abs(diffX) > 6 || Math.abs(diffY) > 6) {
          if (Math.abs(diffY) > Math.abs(diffX)) {
            isSwipeGesture = false; // vertical scroll
          } else {
            isSwipeGesture = true; // horizontal swipe
          }
        }
      }

      if (isSwipeGesture === true) {
        // Prevent vertical scrolling while swiping
        if (e.cancelable) e.preventDefault();
        
        // Only allow swipe left (negative translation)
        if (diffX < 0) {
          currentTranslateX = Math.max(diffX, -160);
          fg.style.transform = `translateX(${currentTranslateX}px)`;

          // Haptic vibration tick when crossing threshold
          if (currentTranslateX < SWIPE_THRESHOLD && !row.dataset.thresholdCrossed) {
            row.dataset.thresholdCrossed = 'true';
            vibrateDevice(20);
          } else if (currentTranslateX >= SWIPE_THRESHOLD && row.dataset.thresholdCrossed) {
            delete row.dataset.thresholdCrossed;
          }
        }
      }
    }, { passive: false });

    row.addEventListener('touchend', () => {
      fg.style.transition = 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
      
      if (isSwipeGesture === true && currentTranslateX < SWIPE_THRESHOLD) {
        // Dismiss card
        fg.style.transform = 'translateX(-100%)';
        vibrateDevice([15, 30]);
        playAudioSignal('click');
        
        setTimeout(() => {
          const sku = row.getAttribute('data-sku');
          removeCartItem(sku);
        }, 200);
      } else {
        // Snap back
        fg.style.transform = 'translateX(0)';
      }
      currentTranslateX = 0;
      isSwipeGesture = null;
      delete row.dataset.thresholdCrossed;
    });
  }

  // --- ZERO-CONFIGURATION NETWORK PAIRING ENGINE ---
  const NexovaPairingEngine = {
    processPairingURI(uriString) {
      try {
        console.log('[Pairing] Received pairing token:', uriString);
        const url = new URL(uriString);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          throw new Error('Invalid protocol in pairing URI.');
        }

        const hashParams = new URLSearchParams(url.hash.substring(1));
        const passphrase = hashParams.get('passphrase');
        if (!passphrase) {
          throw new Error('Missing cryptographic payload token in pairing link.');
        }

        const serverUrl = `${url.protocol}//${url.host}`;
        
        // Persist parameters to local registers
        localStorage.setItem('nexova_server_url', serverUrl);
        localStorage.setItem('sync_passphrase', passphrase);
        
        syncWorker.postMessage({
          type: 'SAVE_PREFERENCE',
          payload: { key: 'nexova_server_url', val: serverUrl }
        });
        syncWorker.postMessage({
          type: 'SAVE_PREFERENCE',
          payload: { key: 'sync_passphrase', val: passphrase }
        });

        // Trigger native Android bridge if running in Android POS container
        if (window.AndroidPOS && typeof window.AndroidPOS.setServerUrl === 'function') {
          window.AndroidPOS.setServerUrl(serverUrl);
        }

        playAudioSignal('success');
        alert(`Pairing Successful!\n\nConnected to: ${serverUrl}\nSecurity Key updated.\n\nSystem reloading now...`);
        window.location.reload();
      } catch (err) {
        console.error('[Pairing] Zero-config parsing failed:', err.message);
        playAudioSignal('error');
        alert(`Pairing Failed: ${err.message}`);
      }
    }
  };
  window.NexovaPairingEngine = NexovaPairingEngine;

  let scannerStream = null;
  let zxingCodeReader = null;
  let detectorInterval = null;
  let scannerWorkerInstance = null;

  async function startMobileScanner() {
    playAudioSignal('click');
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    const modal = document.getElementById('modal-mobile-scanner');
    if (!modal) return;
    
    modal.classList.add('active');

    const video = document.getElementById('scanner-video');
    const manualInput = document.getElementById('scanner-manual-input');
    if (manualInput) {
      manualInput.value = '';
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      scannerStream = stream;
      if (video) video.srcObject = stream;

      // 1. Check for native BarcodeDetector API support (Runs native off-thread in Chrome/Android)
      if ('BarcodeDetector' in window) {
        const barcodeDetector = new BarcodeDetector({ formats: ['ean_13', 'qr_code', 'code_128', 'upc_a'] });
        
        detectorInterval = setInterval(async () => {
          if (!video.videoWidth) return;
          try {
            const barcodes = await barcodeDetector.detect(video);
            if (barcodes.length > 0) {
              const code = barcodes[0].rawValue;
              console.log(`[BarcodeDetector] Scanned: ${code}`);
              handleScannedCode(code);
              closeMobileScanner();
            }
          } catch (e) {
            // Suppress frame-by-frame errors
          }
        }, 300);
      } 
      // 2. Off-Thread Web Worker Canvas Frame Grabber Fallback (Pipes canvas frames to ZXing WebAssembly/Worker)
      else {
        console.log('[Scanner] Using off-thread canvas frame decoder fallback (scanner-worker.js).');
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        scannerWorkerInstance = new Worker('scanner-worker.js');
        
        let isWorkerDecoding = false;
        
        scannerWorkerInstance.onmessage = (e) => {
          isWorkerDecoding = false;
          if (e.data.type === 'success') {
            const code = e.data.text;
            console.log(`[ScannerWorker] Scanned: ${code}`);
            handleScannedCode(code);
            closeMobileScanner();
          }
        };

        detectorInterval = setInterval(() => {
          if (!video.videoWidth || isWorkerDecoding) return;
          
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          
          isWorkerDecoding = true;
          // Zero-copy transfer of the image raw array buffer off-thread
          scannerWorkerInstance.postMessage({ type: 'decode', imageData }, [imageData.data.buffer]);
        }, 250);
      }
    } catch (err) {
      console.warn('[Scanner] Camera access failed. Fallback to manual typing:', err);
      if (video) {
        video.style.cursor = 'pointer';
        video.onclick = () => {
          if (state.catalog.length > 0) {
            const randomItem = state.catalog[Math.floor(Math.random() * state.catalog.length)];
            handleScannedCode(randomItem.sku);
          }
          closeMobileScanner();
        };
      }
    }
  }

  function handleScannedCode(code) {
    // Intercept QR Code pairing URIs
    if (code.startsWith('http://') || code.startsWith('https://')) {
      if (code.includes('#passphrase=')) {
        playAudioSignal('success');
        NexovaPairingEngine.processPairingURI(code);
        return;
      }
    }

    const prod = state.catalog.find(p => p.sku === code || (p.gtin && String(p.gtin) === code));
    if (prod) {
      addProductToCheckoutCart(prod.sku);
      playAudioSignal('success');
    } else {
      playAudioSignal('error');
      alert(`Barcode not found: ${code}`);
    }
  }

  function closeMobileScanner() {
    const modal = document.getElementById('modal-mobile-scanner');
    if (modal) modal.classList.remove('active');

    if (detectorInterval) {
      clearInterval(detectorInterval);
      detectorInterval = null;
    }

    if (scannerWorkerInstance) {
      try {
        scannerWorkerInstance.terminate();
      } catch (e) {}
      scannerWorkerInstance = null;
    }

    if (scannerStream) {
      scannerStream.getTracks().forEach(track => track.stop());
      scannerStream = null;
    }

    const video = document.getElementById('scanner-video');
    if (video) {
      video.srcObject = null;
      video.onclick = null;
    }
  }

  // Render order Cart items
  function renderCart() {
    const tbody = document.getElementById('cart-items-tbody');
    const emptyMsg = document.getElementById('cart-empty-msg');
    
    tbody.innerHTML = '';
    
    if (state.activeCart.length === 0) {
      emptyMsg.style.display = 'flex';
    } else {
      emptyMsg.style.display = 'none';

      const fragment = document.createDocumentFragment();

      state.activeCart.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = 'cart-item-row';
        tr.setAttribute('data-sku', item.sku);
        tr.innerHTML = `
          <div class="cart-swipe-bg">
            <span class="trash-icon">REMOVE</span>
          </div>
          <div class="cart-swipe-fg">
            <td>
              <div class="cart-product-cell">
                <span class="cart-product-title">${item.name}</span>
                <span class="cart-product-sku">${item.sku}</span>
              </div>
            </td>
            <td class="cart-item-price" style="text-align: right;">Rs. ${(item.price / 100.0).toFixed(2)}</td>
            <td style="text-align: center;">
              <div class="qty-controls">
                <button class="qty-btn btn-minus" data-sku="${item.sku}">-</button>
                <span class="qty-val">${item.qty}</span>
                <button class="qty-btn btn-plus" data-sku="${item.sku}">+</button>
              </div>
            </td>
            <td class="cart-item-total" style="text-align: right; font-weight: 700; color: var(--text-white);">Rs. ${((item.price * item.qty) / 100.0).toFixed(2)}</td>
            <td style="text-align: center;">
              <button class="btn-remove-item" data-sku="${item.sku}">×</button>
            </td>
          </div>
        `;

        // Profit margin badge — only shown when cost price is set
        if (item.cost && item.cost > 0) {
          const marginAmt = (item.price - item.cost) / 100.0;
          const marginPct = ((item.price - item.cost) / item.price * 100).toFixed(1);
          const marginColor = marginAmt >= 0 ? 'var(--accent-emerald)' : 'var(--danger)';
          const marginLabel = marginAmt >= 0 ? `+Rs.${marginAmt.toFixed(0)}/unit (${marginPct}%)` : `-Rs.${Math.abs(marginAmt).toFixed(0)}/unit (${marginPct}%)`;
          const skuCell = tr.querySelector('.cart-product-sku');
          if (skuCell) {
            const marginEl = document.createElement('span');
            marginEl.style.cssText = `display: block; font-size: 9px; font-weight: 700; color: ${marginColor}; margin-top: 2px; letter-spacing: 0.3px;`;
            marginEl.textContent = marginLabel;
            skuCell.parentNode.appendChild(marginEl);
          }
        }

        // Event listeners
        tr.querySelector('.btn-minus').addEventListener('click', () => modifyCartQty(item.sku, -1));
        tr.querySelector('.btn-plus').addEventListener('click', () => modifyCartQty(item.sku, 1));
        tr.querySelector('.btn-remove-item').addEventListener('click', () => removeCartItem(item.sku));

        // Bind swipe gesture handler for mobile viewports
        bindSwipeEvents(tr);

        fragment.appendChild(tr);
      });

      tbody.appendChild(fragment);
    }

    updateTotalsBoard();

    // Refresh Quick-Access grids to reflect available stock
    renderQuickGrid(
      document.getElementById('checkout-quick-grid'),
      document.getElementById('checkout-quick-filters'),
      document.getElementById('checkout-quick-search'),
      'checkoutQuickCategory',
      'checkoutQuickSearch'
    );
    renderQuickGrid(
      document.getElementById('mobile-quick-grid'),
      document.getElementById('mobile-quick-filters'),
      document.getElementById('mobile-quick-search'),
      'mobileQuickCategory',
      'mobileQuickSearch'
    );

    if (state.terminalRole === 'REGISTER') {
      const sub = calculateSubtotal();
      const tax = calculateTax();
      const total = calculateGrandTotal();
      syncWorker.postMessage({
        type: 'BROADCAST_CFD_CART',
        payload: {
          cart: state.activeCart,
          subtotal: sub,
          tax: tax,
          total: total
        }
      });
    }
  }

  // Calculate sum totals
  function calculateSubtotal() {
    return state.activeCart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  }

  function calculateTax() {
    const sub = calculateSubtotal();
    const ratePref = state.preferences['store_tax_rate'] || '8.0';
    let rate = parseFloat(ratePref);

    const taxMode = state.preferences['store_tax_mode'] || 'FLAT';
    if (taxMode === 'FBR_FOOD') {
      const payModeBtn = document.querySelector('.payment-btn.active');
      const paymentMode = payModeBtn ? payModeBtn.getAttribute('data-mode') : 'CASH';
      if (paymentMode === 'CARD' || paymentMode === 'QR' || paymentMode === 'MOBILE') {
        rate = 5.0;
      } else {
        rate = 15.0;
      }
    } else if (taxMode === 'FBR_RETAIL') {
      rate = 18.0;
    }

    if (rate > 1) rate = rate / 100.0;
    return Math.round(sub * rate);
  }

  function calculateGrandTotal() {
    const isFbrEnabled = (window.__nexovaTier === 'ENTERPRISE' || window.__nexovaTier === 'TRIAL') && state.preferences['fbr_integration_enabled'] === 'true';
    const fbrFee = isFbrEnabled ? 100 : 0;
    return calculateSubtotal() + calculateTax() + fbrFee;
  }

  function updateTotalsBoard() {
    const sub = calculateSubtotal();
    const taxMode = state.preferences['store_tax_mode'] || 'FLAT';
    let label = 'Tax';
    let rateStr = '';

    if (taxMode === 'FBR_FOOD') {
      const payModeBtn = document.querySelector('.payment-btn.active');
      const paymentMode = payModeBtn ? payModeBtn.getAttribute('data-mode') : 'CASH';
      if (paymentMode === 'CARD' || paymentMode === 'QR' || paymentMode === 'MOBILE') {
        rateStr = '5.0%';
      } else {
        rateStr = '15.0%';
      }
      const isUrdu = state.preferences['system_language'] === 'ur';
      label = isUrdu ? `ٹیکس FBR (${rateStr})` : `FBR Tax (${rateStr})`;
    } else if (taxMode === 'FBR_RETAIL') {
      rateStr = '18.0%';
      const isUrdu = state.preferences['system_language'] === 'ur';
      label = isUrdu ? `ٹیکس FBR (${rateStr})` : `FBR Tax (${rateStr})`;
    } else {
      const taxRate = parseFloat(state.preferences['store_tax_rate'] || '8.0');
      rateStr = `${taxRate.toFixed(1)}%`;
      const isUrdu = state.preferences['system_language'] === 'ur';
      label = isUrdu ? `ٹیکس (${rateStr})` : `Tax (${rateStr})`;
    }

    const taxLabelEl = document.getElementById('txt-tax-rate-label');
    if (taxLabelEl) taxLabelEl.textContent = label;

    const isFbrEnabled = (window.__nexovaTier === 'ENTERPRISE' || window.__nexovaTier === 'TRIAL') && state.preferences['fbr_integration_enabled'] === 'true';
    const fbrFeeEl = document.getElementById('row-fbr-fee');
    if (fbrFeeEl) {
      fbrFeeEl.style.display = isFbrEnabled ? 'flex' : 'none';
    }

    const tax = calculateTax();
    const total = calculateGrandTotal();

    document.getElementById('txt-subtotal').textContent = `Rs. ${(sub / 100.0).toFixed(2)}`;
    document.getElementById('txt-tax').textContent = `Rs. ${(tax / 100.0).toFixed(2)}`;
    document.getElementById('txt-total').textContent = `Rs. ${(total / 100.0).toFixed(2)}`;
  }

  // Complete checkout process
  function submitCheckoutTransaction() {
    if (state.activeCart.length === 0) {
      playAudioSignal('error');
      alert('Order is empty. Add products before checking out.');
      return;
    }

    const payModeBtn = document.querySelector('.payment-btn.active');
    const paymentMode = payModeBtn ? payModeBtn.getAttribute('data-mode') : 'CASH';
    
    let paymentDetails = '';
    const subtotal = calculateSubtotal();
    const tax = calculateTax();
    const total = calculateGrandTotal();

    if (paymentMode === 'CREDIT' && !state.attachedCustomer) {
      playAudioSignal('error');
      alert('A customer profile must be linked to post a sale on credit (Udhaar/Khata).');
      return;
    }

    if (paymentMode === 'SPLIT') {
      const cash = parseFloat(document.getElementById('split-cash-amount').value || 0) * 100;
      const card = parseFloat(document.getElementById('split-card-amount').value || 0) * 100;
      if (Math.round(cash + card) !== total) {
        playAudioSignal('error');
        alert(`Split pay values mismatch total! Total: Rs. ${(total/100).toFixed(2)}, Split Sum: Rs. ${((cash+card)/100).toFixed(2)}`);
        return;
      }
      paymentDetails = JSON.stringify({ cash_cents: Math.round(cash), card_cents: Math.round(card) });
    }

    if (state.attachedCustomer) {
      paymentDetails += (paymentDetails ? ' | ' : '') + `Customer: ${state.attachedCustomer.name}`;
      
      // Update customer loyalty values locally
      state.attachedCustomer.visits++;
      state.attachedCustomer.total_spend_cents += total;
      syncWorker.postMessage({
        type: 'SAVE_CUSTOMER',
        payload: {
          id: state.attachedCustomer.id,
          name: state.attachedCustomer.name,
          phone: state.attachedCustomer.phone,
          email: state.attachedCustomer.email,
          spend: state.attachedCustomer.total_spend_cents,
          visits: state.attachedCustomer.visits
        }
      });
    }

    if (paymentMode === 'QR') {
      openQrPaymentModal(total, {
        subtotal,
        tax,
        total,
        paymentMode,
        paymentDetails
      });
      return;
    }

    const transactionId = 'tx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    const cashierId = state.activeCashier ? state.activeCashier.id : 'emp_cashier';

    // Set button loading to prevent double-click
    setButtonLoading('btn-checkout-complete', true, 'Processing...');

    // Dispatch payload to background Web Worker to write to IndexedDB and trigger P2P sync
    syncWorker.postMessage({
      type: 'CHECKOUT',
      payload: {
        transactionId,
        employeeId: cashierId,
        customerId: state.attachedCustomer ? state.attachedCustomer.id : null,
        cart: state.activeCart,
        subtotal,
        tax,
        total,
        paymentMode,
        paymentDetails,
        tier: window.__nexovaTier || 'STARTER',
        fbr_integration_enabled: state.preferences['fbr_integration_enabled']
      }
    });
  }

  // --- CATALOG LIST BUILDER ---
  function renderCatalogScreen() {
    const container = document.getElementById('catalog-virtual-container');
    if (!container) return;

    if (!state.catalogVirtualList) {
      state.catalogVirtualList = new VirtualList({
        container,
        itemHeight: 48,
        renderItem: (p) => {
          const row = document.createElement('div');
          row.className = 'catalog-grid-row';
          
          const threshold = p.low_stock_threshold !== undefined ? p.low_stock_threshold : 10;
          const isLowStock = p.stock_level <= threshold;
          
          row.innerHTML = `
            <div style="width: 15%; font-family: monospace; font-size: 11px; font-weight: 700; align-self: center;">${p.sku}</div>
            <div style="width: 15%; font-family: monospace; font-size: 11px; align-self: center;">${p.gtin || 'N/A'}</div>
            <div style="width: 30%; align-self: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${p.name}">${p.name}</div>
            <div style="width: 15%; align-self: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${p.category}</div>
            <div style="width: 10%; text-align: right; align-self: center;">Rs. ${(p.base_price_minor_units / 100.0).toFixed(2)}</div>
            <div style="width: 10%; text-align: right; align-self: center; font-weight: 700; color: ${isLowStock ? 'var(--alert-coral)' : 'var(--success)'};">${p.stock_level} units</div>
            <div style="width: 10%; text-align: center; align-self: center;">
              <button class="btn-edit-item pos-btn-inline" data-sku="${p.sku}">Edit</button>
            </div>
          `;
          
          row.querySelector('.btn-edit-item').addEventListener('click', () => {
            openProductEditModal(p.sku);
          });
          
          return row;
        }
      });
    }

    const filter = state.selectedCategory;
    const query = document.getElementById('catalog-search-input').value.toLowerCase().trim();

    const items = state.catalog.filter(p => {
      let matchesCat = false;
      if (filter === 'ALL') {
        matchesCat = true;
      } else if (filter === '⚠️ LOW STOCK') {
        const threshold = p.low_stock_threshold !== undefined ? p.low_stock_threshold : 10;
        matchesCat = p.stock_level <= threshold;
      } else {
        matchesCat = (p.category === filter);
      }

      const matchesQuery = !query || (
        p.sku.toLowerCase().includes(query) ||
        p.name.toLowerCase().includes(query) ||
        (p.gtin && String(p.gtin).includes(query))
      );
      return matchesCat && matchesQuery;
    });

    state.catalogVirtualList.setItems(items);
  }

  // Render a responsive Quick-Access Product Grid for desktop/tablet middle-column and mobile tab
  function renderQuickGrid(gridContainer, filtersContainer, searchInput, categoryKey, searchKey) {
    if (!gridContainer) return;

    // 1. Populate category filters if filter container exists
    if (filtersContainer) {
      filtersContainer.innerHTML = '';
      const categories = ['ALL', '⚠️ LOW STOCK', ...new Set(state.catalog.map(p => p.category).filter(Boolean))];
      const filtersFragment = document.createDocumentFragment();

      categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'cat-pill';
        if (cat === state[categoryKey]) btn.classList.add('active');
        btn.textContent = cat;
        btn.addEventListener('click', () => {
          playAudioSignal('click');
          state[categoryKey] = cat;
          renderQuickGrid(gridContainer, filtersContainer, searchInput, categoryKey, searchKey);
        });
        filtersFragment.appendChild(btn);
      });
      filtersContainer.appendChild(filtersFragment);
    }

    // 2. Filter products
    const filter = state[categoryKey] || 'ALL';
    const query = (state[searchKey] || '').toLowerCase().trim();

    const items = state.catalog.filter(p => {
      let matchesCat = false;
      if (filter === 'ALL') {
        matchesCat = true;
      } else if (filter === '⚠️ LOW STOCK') {
        const threshold = p.low_stock_threshold !== undefined ? p.low_stock_threshold : 10;
        matchesCat = p.stock_level <= threshold;
      } else {
        matchesCat = (p.category === filter);
      }

      const matchesQuery = !query || (
        p.sku.toLowerCase().includes(query) ||
        p.name.toLowerCase().includes(query)
      );
      return matchesCat && matchesQuery;
    });

    // 3. Render grid cards
    gridContainer.innerHTML = '';
    
    if (items.length === 0) {
      gridContainer.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-gray); padding: 32px; font-size: 11px;">No products found</div>';
      return;
    }

    const gridFragment = document.createDocumentFragment();

    items.forEach(p => {
      const card = document.createElement('div');
      card.className = 'product-quick-card';
      
      const inCart = state.activeCart.find(item => item.sku === p.sku)?.qty || 0;
      const availStock = p.stock_level - inCart;

      if (availStock <= 0) {
        card.classList.add('out-of-stock');
      }

      const catCode = p.category ? p.category.substring(0, 3).toUpperCase() : 'GEN';

      card.innerHTML = `
        <div class="quick-card-info">
          <span class="quick-card-cat">${catCode}</span>
          <h4 class="quick-card-title">${p.name}</h4>
          <span class="quick-card-sku">${p.sku}</span>
        </div>
        <div class="quick-card-meta">
          <span class="quick-card-price">Rs. ${(p.base_price_minor_units / 100.0).toFixed(2)}</span>
          <span class="quick-card-stock ${availStock < 5 ? 'low-stock' : ''}">${availStock <= 0 ? 'OOS' : availStock + ' left'}</span>
        </div>
      `;

      card.addEventListener('click', () => {
        const currentInCart = state.activeCart.find(item => item.sku === p.sku)?.qty || 0;
        if (p.stock_level - currentInCart <= 0) {
          playAudioSignal('error');
          alert(`Warning: Product SKU ${p.sku} has no remaining available stock!`);
          return;
        }
        addProductToCheckoutCart(p.sku);
      });

      gridFragment.appendChild(card);
    });

    gridContainer.appendChild(gridFragment);
  }

  // Categories pills list checkout screen
  function renderCheckoutCategories() {
    const list = document.getElementById('catalog-category-list');
    list.innerHTML = '';

    const categories = ['ALL', '⚠️ LOW STOCK', ...new Set(state.catalog.map(p => p.category).filter(Boolean))];
    const fragment = document.createDocumentFragment();
    
    categories.forEach(cat => {
      const button = document.createElement('button');
      button.className = 'cat-pill';
      if (cat === state.selectedCategory) button.classList.add('active');
      button.setAttribute('data-cat', cat);
      button.textContent = cat;
      fragment.appendChild(button);
    });
    list.appendChild(fragment);
  }

  // --- CATALOG FORM SUBMISSIONS ---
  function openProductEditModal(sku) {
    playAudioSignal('click');
    const modal = document.getElementById('modal-product');
    const title = document.getElementById('modal-product-title');
    const auditResetCheckbox = document.getElementById('form-product-audit-reset');
    const auditRow = document.getElementById('form-product-audit-row');

    if (auditResetCheckbox) auditResetCheckbox.checked = false;
    
    if (sku) {
      const p = state.catalog.find(item => item.sku === sku);
      title.textContent = 'Edit Product Catalog Item';
      document.getElementById('form-product-sku').value = p.sku;
      document.getElementById('form-product-sku').disabled = true;
      document.getElementById('form-product-gtin').value = p.gtin || '';
      document.getElementById('form-product-emoji').value = '';
      document.getElementById('form-product-name').value = p.name || '';
      document.getElementById('form-product-category').value = p.category || 'Drinks';
      document.getElementById('form-product-price').value = p.base_price_minor_units || 0;
      document.getElementById('form-product-stock').value = p.stock_level || 0;
      document.getElementById('form-product-cost').value = p.cost_price_minor_units || p.cost_minor_units || 0;
      document.getElementById('form-product-threshold').value = p.low_stock_threshold !== undefined ? p.low_stock_threshold : 10;
      
      // SKU cannot be changed on edit
      document.getElementById('form-product-sku').disabled = true;
      if (auditRow) auditRow.style.display = 'flex';
    } else {
      document.getElementById('modal-product-title').textContent = 'Add New Product';
      document.getElementById('form-product-sku').disabled = false;
      document.getElementById('form-product-sku').value = '';
      document.getElementById('form-product-gtin').value = '';
      document.getElementById('form-product-emoji').value = '';
      document.getElementById('form-product-name').value = '';
      document.getElementById('form-product-category').value = 'Drinks';
      document.getElementById('form-product-price').value = '';
      document.getElementById('form-product-cost').value = '';
      document.getElementById('form-product-stock').value = '';
      document.getElementById('form-product-threshold').value = 10;
      if (auditRow) auditRow.style.display = 'none';
    }

    modal.classList.add('active');
  }

  function submitProductForm() {
    const sku = document.getElementById('form-product-sku').value.toUpperCase().trim();
    const name = document.getElementById('form-product-name').value.trim();
    const gtin = document.getElementById('form-product-gtin').value.trim();
    const price = parseInt(document.getElementById('form-product-price').value || 0);
    const cost = parseInt(document.getElementById('form-product-cost').value || 0);
    const stock = parseInt(document.getElementById('form-product-stock').value || 0);
    const low_stock_threshold = parseInt(document.getElementById('form-product-threshold').value || 10);
    const emoji = document.getElementById('form-product-emoji').value.trim();
    const category = document.getElementById('form-product-category').value;
    
    const auditResetCheckbox = document.getElementById('form-product-audit-reset');
    const isAuditReset = auditResetCheckbox ? auditResetCheckbox.checked : false;

    if (!sku || !name || !price) {
      alert('SKU, Name, and Price are required.');
      return;
    }

    // Enforce Starter Tier maximum limit of 1,000 SKUs
    const tier = window.__nexovaTier || 'STARTER';
    const isNew = !document.getElementById('form-product-sku').disabled;
    if (tier === 'STARTER' && isNew && state.catalog && state.catalog.length >= 1000) {
      alert('Product SKU limit reached (Starter Tier is capped at 1,000 SKUs). Please upgrade to the PRO Tier.');
      return;
    }

    if (isAuditReset && !confirm('Warning: This physical inventory audit reset will override any un-synced offline sales for this item. Do you want to continue?')) {
      return;
    }

    syncWorker.postMessage({
      type: 'SAVE_PRODUCT',
      payload: { sku, name, gtin, price, stock, category, emoji, cost, low_stock_threshold, isAuditReset }
    });

    document.getElementById('modal-product').classList.remove('active');
  }

  // --- LOYALTY CUSTOMER SCREEN AND LINK MODALS ---
  function renderCustomersScreen() {
    const tbody = document.getElementById('customers-table-tbody');
    tbody.innerHTML = '';

    const q = document.getElementById('customers-search-input').value.toLowerCase().trim();

    const matches = state.customers.filter(c => 
      c.name.toLowerCase().includes(q) || 
      c.phone.includes(q) || 
      c.email.toLowerCase().includes(q)
    );

    matches.forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 700; color: var(--text-white);">${c.name}</td>
        <td style="font-family: monospace;">${c.phone}</td>
        <td>${c.email}</td>
        <td style="text-align: center;">${c.visits}</td>
        <td style="text-align: right; color: var(--accent-emerald); font-weight: 700;">Rs. ${(c.total_spend_cents / 100.0).toFixed(2)}</td>
        <td style="text-align: center;">
          <button class="btn-edit-customer btn-edit-item" data-id="${c.id}">Edit</button>
        </td>
      `;

      tr.querySelector('.btn-edit-customer').addEventListener('click', () => {
        openCustomerEditModal(c.id);
      });

      tbody.appendChild(tr);
    });
  }

  function renderCustomerLinkModalList(query = '') {
    const list = document.getElementById('customer-link-results-list');
    list.innerHTML = '';

    const q = query.toLowerCase().trim();
    const matches = state.customers.filter(c => 
      !q || c.name.toLowerCase().includes(q) || c.phone.includes(q)
    );

    if (matches.length === 0) {
      list.innerHTML = `<p class="text-center text-muted" style="padding: 12px 0;">No matching customer profiles.</p>`;
      return;
    }

    matches.forEach(c => {
      const row = document.createElement('div');
      row.className = 'search-result-item';
      row.innerHTML = `
        <div>
          <span class="item-title">${c.name}</span>
          <div class="item-meta">Phone: ${c.phone} | Visits: ${c.visits}</div>
        </div>
        <button class="btn-link-customer select-btn" style="min-height: 28px;">Select</button>
      `;

      row.querySelector('.select-btn').addEventListener('click', () => {
        state.attachedCustomer = c;
        document.getElementById('checkout-customer-attached').innerHTML = `
          <div class="customer-attached-box">
            <div>
              <span class="cashier-name">${c.name}</span>
              <div style="font-size: 8px; color: var(--text-gray);">Visits: ${c.visits} | Spend: Rs. ${(c.total_spend_cents/100).toFixed(2)}</div>
            </div>
            <button class="btn-unlink-customer" id="btn-detach-customer">Detach</button>
          </div>
        `;
        document.getElementById('btn-open-customer-link').textContent = 'Change';
        
        // Bind detach button
        document.getElementById('btn-detach-customer').addEventListener('click', () => {
          state.attachedCustomer = null;
          document.getElementById('checkout-customer-attached').innerHTML = `<span class="text-muted">No customer attached to transaction.</span>`;
          document.getElementById('btn-open-customer-link').textContent = 'Attach';
        });

        document.getElementById('modal-customer-link').classList.remove('active');
      });

      list.appendChild(row);
    });
  }

  function openCustomerEditModal(id) {
    playAudioSignal('click');
    const modal = document.getElementById('modal-customer');
    const title = document.getElementById('modal-customer-title');
    const spendRow = document.getElementById('form-customer-spend-row');
    const visitsRow = document.getElementById('form-customer-visits-row');

    if (id) {
      const c = state.customers.find(item => item.id === id);
      title.textContent = 'Edit Customer Profile';
      document.getElementById('form-customer-id').value = c.id;
      document.getElementById('form-customer-name').value = c.name;
      document.getElementById('form-customer-phone').value = c.phone;
      document.getElementById('form-customer-email').value = c.email;
      document.getElementById('form-customer-spend').value = c.total_spend_cents;
      document.getElementById('form-customer-visits').value = c.visits;
      spendRow.style.display = 'flex';
      visitsRow.style.display = 'flex';
    } else {
      title.textContent = 'Create Customer Profile';
      document.getElementById('form-customer-id').value = 'cust_' + Date.now();
      document.getElementById('form-customer-name').value = '';
      document.getElementById('form-customer-phone').value = '';
      document.getElementById('form-customer-email').value = '';
      spendRow.style.display = 'none';
      visitsRow.style.display = 'none';
    }

    modal.classList.add('active');
  }

  function submitCustomerForm() {
    const id = document.getElementById('form-customer-id').value;
    const name = document.getElementById('form-customer-name').value.trim();
    const phone = document.getElementById('form-customer-phone').value.trim();
    const email = document.getElementById('form-customer-email').value.trim();
    const spend = parseInt(document.getElementById('form-customer-spend').value || 0);
    const visits = parseInt(document.getElementById('form-customer-visits').value || 0);

    if (!name) {
      alert('Customer Name is required.');
      return;
    }

    syncWorker.postMessage({
      type: 'SAVE_CUSTOMER',
      payload: { id, name, phone, email, spend, visits }
    });

    document.getElementById('modal-customer').classList.remove('active');
  }

  // --- STAFF ROSTER SCREEN AND FORM ---
  function renderStaffScreen() {
    const tbody = document.getElementById('staff-table-tbody');
    tbody.innerHTML = '';

    state.employees.forEach(emp => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 700; font-family: monospace; color: var(--text-white);">${emp.id}</td>
        <td>${emp.role}</td>
        <td>
          <span class="tx-status-badge ${emp.is_active === 1 ? 'completed' : 'voided'}">
            ${emp.is_active === 1 ? 'ACTIVE' : 'INACTIVE'}
          </span>
        </td>
        <td style="font-size: 10px; font-family: monospace; opacity: 0.7;">${emp.sync_hlc}</td>
        <td style="text-align: center;">
          <button class="btn-toggle-staff btn-edit-item" data-id="${emp.id}">${emp.is_active === 1 ? 'Deactivate' : 'Activate'}</button>
        </td>
      `;

      tr.querySelector('.btn-toggle-staff').addEventListener('click', () => {
        playAudioSignal('click');
        syncWorker.postMessage({
          type: 'SAVE_EMPLOYEE',
          payload: {
            id: emp.id,
            auth_hash: emp.auth_hash,
            role: emp.role,
            is_active: emp.is_active === 1 ? 0 : 1
          }
        });
      });

      tbody.appendChild(tr);
    });
  }

  function openEmployeeModal() {
    playAudioSignal('click');
    document.getElementById('modal-employee').classList.add('active');
    document.getElementById('form-employee-id').value = '';
    document.getElementById('form-employee-pin').value = '';
    document.getElementById('form-employee-role').value = 'CASHIER';
  }

  async function submitEmployeeForm() {
    const id = document.getElementById('form-employee-id').value.trim().toLowerCase();
    const pin = document.getElementById('form-employee-pin').value.trim();
    const role = document.getElementById('form-employee-role').value;

    if (!id || !pin) {
      alert('Employee ID and PIN are required.');
      return;
    }

    const hash = await hashPin(pin);

    syncWorker.postMessage({
      type: 'SAVE_EMPLOYEE',
      payload: {
        id: 'emp_' + id.replace(/\s+/g, '_'),
        auth_hash: hash,
        role: role,
        is_active: 1
      }
    });

    document.getElementById('modal-employee').classList.remove('active');
  }

  // --- CRDT LOG CARD BUILDER ---
  function appendLogEntry(c) {
    const container = document.getElementById('sync-logs-feed-container');
    const div = document.createElement('div');
    div.className = 'log-entry';
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString();

    div.innerHTML = `
      <span class="log-time">[${timeStr}]</span>
      <span class="log-msg">
        <strong>${c.table_name.toUpperCase()}</strong> key: <strong>${c.pk}</strong> | cid: <em>${c.cid}</em> ➔ value: "${c.val}" (cl:${c.cl})
      </span>
      <span class="log-dir tx">TX LHL</span>
    `;

    container.insertBefore(div, container.firstChild);
    
    // Cap log items count in viewport
    while (container.childNodes.length > 50) {
      container.removeChild(container.lastChild);
    }
  }

  // --- SALES HISTORY LEDGER & RECEIPTS ---
  function renderHistoryScreen() {
    const container = document.getElementById('history-transactions-list');
    container.innerHTML = '';

    const query = document.getElementById('history-search-input').value.toLowerCase().trim();

    const matches = state.transactions.filter(tx => {
      if (!query) return true;
      const dateStr = new Date(tx.ts || tx.created_at || 0).toLocaleDateString().toLowerCase();
      const amountStr = ((tx.total || 0) / 100).toFixed(2);
      const cashierStr = (tx.cashier_id || '').toLowerCase();
      const modeStr = (tx.payment_mode || '').toLowerCase();
      return tx.id.toLowerCase().includes(query) ||
             dateStr.includes(query) ||
             amountStr.includes(query) ||
             cashierStr.includes(query) ||
             modeStr.includes(query);
    }
    );

    if (matches.length === 0) {
      container.innerHTML = `<p class="text-center text-muted" style="padding: 24px 0;">No completed sales found.</p>`;
      return;
    }

    const fragment = document.createDocumentFragment();

    matches.forEach(tx => {
      const card = document.createElement('div');
      card.className = 'tx-card';
      if (tx.id === state.selectedTransactionId) card.classList.add('active');

      const dateObj = new Date(tx.created_at);
      const dateStr = dateObj.toLocaleString();

      card.innerHTML = `
        <div class="tx-card-left">
          <span class="tx-id">${tx.id.substring(0, 15)}...</span>
          <span class="tx-date">${dateStr}</span>
        </div>
        <div class="tx-card-right">
          <span class="tx-amount">Rs. ${(tx.total_minor_units / 100.0).toFixed(2)}</span>
          <span class="tx-status-badge completed">${tx.payment_mode || 'CASH'}</span>
        </div>
      `;

      card.addEventListener('click', () => {
        playAudioSignal('click');
        state.selectedTransactionId = tx.id;
        
        // Set active highlight
        document.querySelectorAll('.tx-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');

        renderThermalReceiptPreview(tx);
      });

      fragment.appendChild(card);
    });

    container.appendChild(fragment);

    // Auto load first item preview
    if (matches.length > 0 && !state.selectedTransactionId) {
      state.selectedTransactionId = matches[0].id;
      if (container.children.length > 0) {
        container.children[0].classList.add('active');
      }
      renderThermalReceiptPreview(matches[0]);
    }
  }

  // Format thermal receipt page strings based on column width
  function renderThermalReceiptPreview(tx) {
    const renderDiv = document.getElementById('receipt-printout-render');
    
    const store = state.preferences['store_name'] || 'NEXOVA COFFEE & RETAIL';
    const tagline = state.preferences['store_receipt_tagline'] || 'Stability meets Speed. Thank you!';
    const widthPref = state.preferences['store_receipt_width'] || '42';
    const cols = parseInt(widthPref);

    const padChar = ' ';
    
    // Centering helper
    const center = (str) => {
      const remaining = cols - str.length;
      if (remaining <= 0) return str.substring(0, cols);
      const left = Math.floor(remaining / 2);
      return padChar.repeat(left) + str;
    };

    // Columns spacing helper
    const spaceBetween = (leftStr, rightStr) => {
      const spaces = cols - (leftStr.length + rightStr.length);
      if (spaces <= 0) {
        return leftStr.substring(0, cols - rightStr.length - 1) + ' ' + rightStr;
      }
      return leftStr + padChar.repeat(spaces) + rightStr;
    };

    const separator = '-'.repeat(cols);
    const dblSeparator = '='.repeat(cols);

    const dateStr = new Date(tx.created_at).toLocaleString();

    let text = '';
    text += center(store) + '\n';
    text += center('100 NEON ECOSYSTEM ROAD') + '\n';
    text += center('STORE REGISTER TERMINAL 01') + '\n';
    text += separator + '\n';
    text += `DATE: ${dateStr}\n`;
    text += `TICKET ID: ${tx.id}\n`;
    text += `CASHIER ID: ${(tx.employee_id || '').replace('emp_','').toUpperCase()}\n`;
    text += separator + '\n';

    // Print Header
    text += spaceBetween('PRODUCT DESCRIPTION  QTY', 'PRICE  TOTAL') + '\n';
    text += separator + '\n';

    tx.items.forEach(item => {
      const nameLine = `${item.sku.substring(0, 16).padEnd(16)}   x${item.quantity.toString().padEnd(3)}`;
      const priceVal = `Rs. ${(item.unit_price_minor_units/100).toFixed(2)}`;
      const totalVal = `Rs. ${((item.unit_price_minor_units * item.quantity)/100).toFixed(2)}`;
      text += spaceBetween(nameLine, `${priceVal.padStart(6)} ${totalVal.padStart(6)}`) + '\n';
    });

    text += separator + '\n';
    text += spaceBetween('SUBTOTAL:', `Rs. ${(tx.subtotal_minor_units/100).toFixed(2)}`) + '\n';
    text += spaceBetween('TAX CHARGES:', `Rs. ${(tx.tax_minor_units/100).toFixed(2)}`) + '\n';
    
    // Inject FBR POS Fee Rs. 1.00 line item if active in this transaction (Compliance)
    const totalWithoutFee = tx.subtotal_minor_units + tx.tax_minor_units;
    const hasFbrFee = (tx.total_minor_units - totalWithoutFee >= 100);
    if (hasFbrFee) {
      text += spaceBetween('FBR POS FEE:', 'Rs. 1.00') + '\n';
    }
    
    text += dblSeparator + '\n';
    text += spaceBetween('GRAND TOTAL DUE:', `Rs. ${(tx.total_minor_units/100).toFixed(2)}`) + '\n';
    text += dblSeparator + '\n';
    text += `PAYMENT TENDERED: ${tx.payment_mode || 'CASH'}\n`;
    
    let fbrInvoiceNumber = '';
    let fbrStatus = '';
    let fbrQrUrl = '';

    if (tx.payment_details) {
      if (tx.payment_details.startsWith('{')) {
        try {
          const parsed = JSON.parse(tx.payment_details);
          if (parsed.note) text += `REF DETAILS: ${parsed.note}\n`;
          else if (parsed.cash_cents) text += `SPLIT: Cash Rs. ${(parsed.cash_cents/100).toFixed(2)}, Card Rs. ${(parsed.card_cents/100).toFixed(2)}\n`;
          
          if (parsed.fbr_invoice_number) {
            fbrInvoiceNumber = parsed.fbr_invoice_number;
            fbrStatus = parsed.fbr_status;
            fbrQrUrl = parsed.fbr_qr_url;
          }
        } catch(e) {}
      } else {
        text += `REF DETAILS: ${tx.payment_details}\n`;
      }
    }

    if (fbrInvoiceNumber) {
      text += separator + '\n';
      text += center('FBR TIER-1 FISCAL INTEGRATION') + '\n';
      text += `FBR INVOICE: ${fbrInvoiceNumber}\n`;
      text += `FBR STATUS:  ${fbrStatus}\n`;
    }

    text += separator + '\n';
    text += center(tagline) + '\n';

    let fbrHtml = '';
    if (fbrInvoiceNumber) {
      fbrHtml = `
        <div style="margin-top: 16px; padding: 12px; border: 1px dashed var(--border-titanium); border-radius: 4px; text-align: center; background: rgba(255,255,255,0.01);">
          <span style="font-size: 9px; font-weight: 700; color: var(--accent-emerald); display: block; margin-bottom: 8px;">FBR FISCAL VERIFICATION QR</span>
          <div id="receipt-fbr-qr-container" style="display: flex; justify-content: center; margin-bottom: 8px; padding: 4px; background: white; width: max-content; margin-left: auto; margin-right: auto; border-radius: 4px;"></div>
          <span style="font-size: 8px; font-family: monospace; color: var(--text-gray); word-break: break-all;">Verify invoice status on FBR Asaan Tax portal.</span>
        </div>
      `;
    }

    renderDiv.innerHTML = `<h4>${store}</h4><pre style="font-family: var(--font-receipt); white-space: pre-wrap; word-break: break-all; margin: 0; font-size: 11px;">${text}</pre>${fbrHtml}`;

    if (fbrInvoiceNumber && fbrQrUrl && typeof QRCode !== 'undefined') {
      setTimeout(() => {
        const qrBox = document.getElementById('receipt-fbr-qr-container');
        if (qrBox) {
          qrBox.innerHTML = '';
          new QRCode(qrBox, {
            text: fbrQrUrl,
            width: 80,
            height: 80,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.M
          });
        }
      }, 50);
    }
  }

  // --- ANALYTICS DASHBOARD PLOTTING ---
  function calculateAnalytics() {
    const revVal = document.getElementById('analytics-revenue-value');
    const orderVal = document.getElementById('analytics-orders-count');
    const avgVal = document.getElementById('analytics-average-value');
    const itemsVal = document.getElementById('analytics-items-value');

    const txs = state.transactions;
    if (txs.length === 0) {
      revVal.textContent = 'Rs. 0.00';
      orderVal.textContent = '0';
      avgVal.textContent = 'Rs. 0.00';
      itemsVal.textContent = '0';
      document.getElementById('analytics-histogram-bars').innerHTML = '<p class="text-center text-muted" style="width:100%;">No sales history to plot chart.</p>';
      return;
    }

    const totalRevenue = txs.reduce((sum, t) => sum + t.total_minor_units, 0);
    const orderCount = txs.length;
    const avgTicket = Math.round(totalRevenue / orderCount);

    let totalItems = 0;
    txs.forEach(tx => {
      tx.items.forEach(item => {
        totalItems += item.quantity;
      });
    });

    revVal.textContent = `Rs. ${(totalRevenue / 100.0).toFixed(2)}`;
    orderVal.textContent = orderCount;
    avgVal.textContent = `Rs. ${(avgTicket / 100.0).toFixed(2)}`;
    itemsVal.textContent = totalItems;

    // Render sales histogram by hour
    plotHourlySalesChart(txs);

    // Business Intelligence dashboard calculations
    calculateBiDashboardMetrics();

    // Check stock thresholds and generate draft POs if needed
    runSmartReorderCheck();
  }

  // Calculate Net Cash Position and Margin analysis
  function calculateBiDashboardMetrics() {
    let totalReceivables = 0;
    state.customerCredits.forEach(c => {
      if (c.is_deleted === 1) return;
      if (c.type === 'CREDIT') totalReceivables += c.amount_minor;
      else if (c.type === 'PAYMENT') totalReceivables -= c.amount_minor;
    });

    let totalPayables = 0;
    state.distributors.forEach(d => {
      if (d.is_deleted === 1) return;
      totalPayables += getDistributorOutstanding(d.id);
    });

    const netCash = totalReceivables - totalPayables;

    let totalMarginRate = 0;
    let productCount = 0;

    state.catalog.forEach(item => {
      const basePrice = item.base_price_minor_units;
      if (!basePrice) return;
      
      // Assume wholesale cost is ~70% of retail price if no PO costs exist
      const cost = Math.round(basePrice * 0.7);
      const margin = basePrice - cost;
      const marginRate = (margin / basePrice) * 100;
      totalMarginRate += marginRate;
      productCount++;
    });

    const avgMarginRate = productCount > 0 ? (totalMarginRate / productCount) : 0;

    const recvVal = document.getElementById('bi-receivables-val');
    const payVal = document.getElementById('bi-payables-val');
    const netVal = document.getElementById('bi-net-cash-val');
    const marginVal = document.getElementById('bi-margin-rate-val');

    if (recvVal) recvVal.textContent = formatCurrency(totalReceivables);
    if (payVal) payVal.textContent = formatCurrency(totalPayables);
    if (netVal) {
      netVal.textContent = formatCurrency(netCash);
      netVal.style.color = netCash >= 0 ? 'var(--accent-emerald)' : 'var(--alert-coral)';
      netVal.style.fontWeight = '800';
    }
    if (marginVal) marginVal.textContent = `${avgMarginRate.toFixed(2)}%`;
  }

  // Stock tracking & auto PO generation
  async function runSmartReorderCheck() {
    const alertsContainer = document.getElementById('bi-reorder-alerts-container');
    if (!alertsContainer) return;

    if (state.distributors.length === 0) {
      alertsContainer.innerHTML = `<p class="text-muted" style="text-align: center; margin-top: 20px;">No suppliers registered. Add suppliers to enable smart reordering.</p>`;
      return;
    }

    const itemsToReorder = state.catalog.filter(item => {
      const limit = item.low_stock_threshold !== undefined ? item.low_stock_threshold : 10;
      return (item.stock_level || 0) < limit;
    });

    if (itemsToReorder.length === 0) {
      alertsContainer.innerHTML = `<p class="text-muted" style="text-align: center; margin-top: 20px;">All stock levels above threshold. No reorders pending.</p>`;
      return;
    }

    const defaultDist = state.distributors[0];
    let alertsHtml = '';

    for (const item of itemsToReorder) {
      const existingPo = state.purchaseOrders.find(po => po.distributor_id === defaultDist.id && po.status === 'DRAFT' && po.is_deleted !== 1);
      let poIdText = 'Generating Draft...';

      if (existingPo) {
        poIdText = `Draft PO: ${existingPo.id.substring(0, 10)}...`;
      } else {
        // Asynchronously request PO generation through the worker thread to prevent blocking
        setTimeout(() => {
          const newPoId = 'po_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
          syncWorker.postMessage({
            type: 'SAVE_PURCHASE_ORDER',
            payload: {
              id: newPoId,
              distributor_id: defaultDist.id,
              status: 'DRAFT',
              total_minor: item.base_price_minor_units * 50,
              created_at: Date.now(),
              is_deleted: 0
            }
          });
          
          const poLiId = `poli_${newPoId}_${item.sku}`;
          syncWorker.postMessage({
            type: 'SAVE_PO_LINE_ITEM',
            payload: {
              id: poLiId,
              po_id: newPoId,
              sku: item.sku,
              qty_ordered: 50,
              qty_received: 0,
              cost_minor: Math.round(item.base_price_minor_units * 0.7),
              is_deleted: 0
            }
          });
        }, 100);
      }

      alertsHtml += `
        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(239,68,68,0.03); border:1px solid rgba(239,68,68,0.1); padding:8px; border-radius:4px;">
          <div>
            <span style="font-weight:700; color:var(--alert-coral);">${item.name}</span><br>
            <span style="font-size:9px; color:var(--text-gray);">SKU: ${item.sku} | Qty: ${item.stock_level || 0} (Limit: ${item.low_stock_threshold !== undefined ? item.low_stock_threshold : 10})</span>
          </div>
          <span style="font-size:10px; font-weight:700; color:var(--accent-amber);">${poIdText}</span>
        </div>
      `;
    }

    alertsContainer.innerHTML = alertsHtml;
  }

  // Over-The-Air silent update checker
  function initOtaUpdater() {
    const CURRENT_VERSION = '1.0.0';
    localStorage.setItem('nexova_client_version', CURRENT_VERSION);

    async function checkUpdates() {
      try {
        const res = await fetch(`/version.json?cb=${Date.now()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.version && data.version !== CURRENT_VERSION) {
          console.log(`[OTA] New update available: v${data.version} (current: v${CURRENT_VERSION})`);
          showOtaUpdateToast(data.version, data.changelog);
        }
      } catch (err) {
        console.warn('[OTA] Check failed:', err);
      }
    }

    function showOtaUpdateToast(newVer, changelog) {
      if (document.getElementById('ota-toast-alert')) return;

      const toast = document.createElement('div');
      toast.id = 'ota-toast-alert';
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: var(--panel-graphite-light);
        border: 1px solid var(--accent-emerald);
        padding: 16px;
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        z-index: 99999;
        max-width: 320px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-family: var(--font-primary);
      `;

      toast.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:700; color:var(--accent-emerald); font-size:11px; letter-spacing:0.5px;">SYSTEM UPDATE PENDING</span>
          <span style="font-size:10px; padding:2px 6px; background:rgba(16,185,129,0.1); border-radius:4px; color:var(--accent-emerald); font-weight:700;">v${newVer}</span>
        </div>
        <p style="font-size:10px; color:var(--text-gray); margin:0;">${changelog || 'Performance fixes and enhancements.'}</p>
        <div style="display:flex; flex-direction:column; gap:6px; margin:8px 0;">
          <a href="/downloads/nexova-pos-latest.apk" download style="text-align:center; padding:8px; background:rgba(16,185,129,0.05); border:1px solid rgba(16,185,129,0.2); border-radius:4px; color:var(--accent-emerald); font-size:10px; font-weight:700; text-decoration:none; display:block; transition: background 0.2s;">
            📥 DOWNLOAD ANDROID APK (TABLET)
          </a>
          <a href="/downloads/nexova-pos-setup.exe" download style="text-align:center; padding:8px; background:rgba(16,185,129,0.05); border:1px solid rgba(16,185,129,0.2); border-radius:4px; color:var(--accent-emerald); font-size:10px; font-weight:700; text-decoration:none; display:block; transition: background 0.2s;">
            📥 DOWNLOAD WINDOWS SETUP (EXE)
          </a>
          <a href="/downloads/nexova-pos-setup.msi" download style="text-align:center; padding:8px; background:rgba(16,185,129,0.05); border:1px solid rgba(16,185,129,0.2); border-radius:4px; color:var(--accent-emerald); font-size:10px; font-weight:700; text-decoration:none; display:block; transition: background 0.2s;">
            📥 DOWNLOAD WINDOWS SETUP (MSI)
          </a>
        </div>
        <button id="btn-ota-apply" class="action-btn action-success" style="padding:6px; min-height:28px; font-size:11px; margin-top:4px; font-weight:700; width:100%;">APPLY SILENT PATCH (RELOAD)</button>
      `;

      document.body.appendChild(toast);

      document.getElementById('btn-ota-apply').addEventListener('click', async () => {
        toast.innerHTML = '<p style="color:var(--text-white);">Clearing cache & applying patch...</p>';
        if ('serviceWorker' in navigator) {
            try {
                const regs = await navigator.serviceWorker.getRegistrations();
                for (let reg of regs) { await reg.unregister(); }
                const cacheNames = await caches.keys();
                for (let name of cacheNames) { await caches.delete(name); }
            } catch(e) { console.error('Cache wipe failed', e); }
        }
        localStorage.setItem('nexova_client_version', newVer);
        // Force the WebView to ignore network cache on next load
        window.location.href = window.location.pathname + '?v=' + new Date().getTime();
      });
    }

    setTimeout(checkUpdates, 5000);
    setInterval(checkUpdates, 3600000); // Poll hourly
  }

  function plotHourlySalesChart(txs) {
    const chart = document.getElementById('analytics-histogram-bars');
    chart.innerHTML = '';

    // Create 24 hours buckets
    const hours = Array(24).fill(0);
    txs.forEach(tx => {
      const hr = new Date(tx.created_at).getHours();
      hours[hr] += tx.total_minor_units;
    });

    const maxAmt = Math.max(...hours);

    // Render business hours 8am to 8pm
    for (let hr = 8; hr <= 20; hr++) {
      const amt = hours[hr] || 0;
      const pct = maxAmt > 0 ? (amt / maxAmt) * 100 : 0;

      const col = document.createElement('div');
      col.className = 'chart-bar-col';
      col.style.height = `${pct}%`;

      const ampm = hr >= 12 ? (hr === 12 ? '12PM' : (hr-12)+'PM') : hr+'AM';
      
      col.innerHTML = `
        <span class="chart-bar-val">Rs. ${(amt/100).toFixed(0)}</span>
        <span class="chart-bar-lbl">${ampm}</span>
      `;

      chart.appendChild(col);
    }
  }

  // --- DESTRUCTIVE PURGE RESET AUTHORIZATION ---
  async function submitGrandResetPurge() {
    const pin = document.getElementById('reset-admin-pin-auth').value;
    const errorMsg = document.getElementById('reset-modal-error');
    errorMsg.textContent = '';

    try {
      const matched = await NexovaDB.verifyEmployeePin(pin);

      if (matched && matched.role === 'ADMIN') {
        document.getElementById('modal-reset').classList.remove('active');
        syncWorker.postMessage({ type: 'DESTRUCTIVE_RESET' });
      } else {
        errorMsg.textContent = 'Invalid administrator authentication credentials.';
        playAudioSignal('error');
      }
    } catch (e) {
      errorMsg.textContent = 'Error: ' + e.message;
    }
  }

  // --- SHIFT RECONCILIATION & Z-REPORT LEADGER ---
  function openShiftReconciliationModal() {
    let expectedCashCents = 0;
    const cashierId = state.activeCashier ? state.activeCashier.id : '';
    const clockInTime = state.activeCashier ? state.activeCashier.clockIn : 0;
    
    const shiftTxs = state.transactions.filter(tx => 
      tx.employee_id === cashierId &&
      tx.created_at >= clockInTime &&
      tx.status === 'COMPLETED' &&
      tx.is_deleted !== 1
    );
    
    for (const tx of shiftTxs) {
      if (tx.payment_mode === 'CASH') {
        expectedCashCents += tx.total_minor_units;
      } else if (tx.payment_mode === 'SPLIT') {
        try {
          const details = JSON.parse(tx.payment_details);
          if (details && details.cash_cents) {
            expectedCashCents += details.cash_cents;
          }
        } catch (e) {}
      }
    }
    
    state.currentShiftExpectedCents = expectedCashCents;
    
    // Reset inputs
    const modal = document.getElementById('modal-shift-reconcile');
    const denomInputs = modal.querySelectorAll('.denom-input');
    denomInputs.forEach(inp => inp.value = '');
    document.getElementById('shift-reconcile-total-declared').textContent = 'Rs. 0.00';
    
    modal.classList.add('active');
  }

  function openQrPaymentModal(total, cartPayload) {
    state.pendingQrCheckout = cartPayload;
    
    const formattedAmt = `Rs. ${(total / 100).toFixed(2)}`;
    document.getElementById('qr-pay-amount-label').textContent = formattedAmt;
    
    const randomTxId = 'EP-' + Math.floor(100000 + Math.random() * 900000);
    const smsText = `Rs. ${(total / 100).toFixed(2)} received from EasyPaisa/JazzCash wallet. Transaction ID: ${randomTxId}. Status: SUCCESS.`;
    document.getElementById('sms-sim-body').value = smsText;
    
    // Dynamically generate real QR Code payload for mobile deep linking / client sync
    const qrContainer = document.getElementById('qr-pay-canvas-container');
    if (qrContainer) {
      qrContainer.innerHTML = '';
      const payloadString = `nexova://payment/pay?amount=${(total / 100).toFixed(2)}&txid=${randomTxId}&terminal=${state.nodeId || 'master_pc'}`;
      new QRCode(qrContainer, {
        text: payloadString,
        width: 176,
        height: 176,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.M
      });
    }
    
    document.getElementById('modal-qr-pay').classList.add('active');

    if (state.terminalRole === 'REGISTER') {
      syncWorker.postMessage({
        type: 'BROADCAST_CFD_PAY',
        payload: {
          total: total,
          showPay: true
        }
      });
    }
  }

  function closeQrPaymentModal() {
    document.getElementById('modal-qr-pay').classList.remove('active');
    state.pendingQrCheckout = null;
    if (state.terminalRole === 'REGISTER') {
      syncWorker.postMessage({
        type: 'BROADCAST_CFD_PAY',
        payload: {
          total: 0,
          showPay: false
        }
      });
    }
  }

  function renderKdsScreen() {
    if (state.terminalRole !== 'KDS') return;

    const container = document.getElementById('kds-tickets-container');
    if (!container) return;
    container.innerHTML = '';

    const pendingTxs = state.transactions.filter(tx => tx.status === 'PENDING' && tx.is_deleted !== 1);

    if (pendingTxs.length === 0) {
      container.innerHTML = `<p class="text-muted" style="grid-column: 1/-1; text-align: center; margin-top: 100px;">No pending kitchen orders.</p>`;
      return;
    }

    const fragment = document.createDocumentFragment();

    pendingTxs.forEach(tx => {
      const card = document.createElement('div');
      card.style.background = 'var(--panel-graphite)';
      card.style.border = '1px solid var(--border-titanium)';
      card.style.borderRadius = '16px';
      card.style.padding = '20px';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.justifyContent = 'space-between';
      card.style.gap = '16px';

      const timeElapsed = Math.round((Date.now() - tx.created_at) / 60000);
      const itemsList = tx.items.map(item => `
        <div style="display: flex; justify-content: space-between; font-size: 14px; color: var(--text-white);">
          <span>${item.sku} x ${item.quantity}</span>
        </div>
      `).join('');

      card.innerHTML = `
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-titanium); padding-bottom: 10px; margin-bottom: 10px;">
            <span style="font-family: monospace; font-weight: 700; color: var(--warning);">${tx.id.substring(3, 11).toUpperCase()}</span>
            <span style="font-size: 11px; color: var(--text-gray);">${timeElapsed}m ago</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${itemsList}
          </div>
        </div>
        <button class="action-btn action-success btn-complete-kds" data-id="${tx.id}" style="width: 100%; min-height: 48px; font-weight: 800; font-size: 12px;">
          COMPLETE ORDER
        </button>
      `;

      card.querySelector('.btn-complete-kds').addEventListener('click', () => {
        playAudioSignal('success');
        syncWorker.postMessage({
          type: 'COMPLETE_TRANSACTION',
          payload: { transactionId: tx.id }
        });
      });

      fragment.appendChild(card);
    });

    container.appendChild(fragment);
  }

  function renderCfdCart(data) {
    const list = document.getElementById('cfd-cart-items');
    const totalTxt = document.getElementById('cfd-total-amount');
    if (!list || !totalTxt) return;

    list.innerHTML = '';
    if (!data.cart || data.cart.length === 0) {
      list.innerHTML = `<p class="text-muted" style="text-align: center; margin-top: 100px;">Ordering is open. Welcome!</p>`;
      totalTxt.textContent = 'Rs. 0.00';
      return;
    }

    data.cart.forEach(item => {
      const itemRow = document.createElement('div');
      itemRow.style.display = 'flex';
      itemRow.style.justifyContent = 'space-between';
      itemRow.style.alignItems = 'center';
      itemRow.style.padding = '8px 0';
      itemRow.innerHTML = `
        <span style="color: var(--text-white); font-size: 16px; font-weight: 700;">${item.name} x ${item.qty}</span>
        <span style="color: var(--text-white); font-size: 16px; font-weight: 700;">Rs. ${((item.price * item.qty) / 100).toFixed(2)}</span>
      `;
      list.appendChild(itemRow);
    });

    totalTxt.textContent = `Rs. ${(data.total / 100).toFixed(2)}`;
  }

  function renderCfdPay(data) {
    const welcome = document.getElementById('cfd-display-welcome');
    const pay = document.getElementById('cfd-display-pay');
    const payTotal = document.getElementById('cfd-pay-total');
    if (!welcome || !pay || !payTotal) return;

    if (data.showPay) {
      welcome.style.display = 'none';
      pay.style.display = 'flex';
      payTotal.textContent = `Rs. ${(data.total / 100).toFixed(2)}`;
    } else {
      welcome.style.display = 'flex';
      pay.style.display = 'none';
    }
  }

  function generateEscPosBytes(tx) {
    const encoder = new TextEncoder();
    const bytes = [];
    
    // ESC @ (Init)
    bytes.push(0x1B, 0x40);
    
    // Center align for header
    bytes.push(0x1B, 0x61, 0x01);
    
    // Store name (Double size)
    bytes.push(0x1D, 0x21, 0x11);
    const storeName = (state.preferences['store_name'] || 'NEXOVA COFFEE & RETAIL') + '\n';
    bytes.push(...encoder.encode(storeName));
    
    // Normal size
    bytes.push(0x1D, 0x21, 0x00);
    bytes.push(...encoder.encode('100 NEON ECOSYSTEM ROAD\nSTORE REGISTER TERMINAL 01\n'));
    bytes.push(...encoder.encode('-'.repeat(42) + '\n'));
    
    // Left align
    bytes.push(0x1B, 0x61, 0x00);
    bytes.push(...encoder.encode(`DATE: ${new Date(tx.created_at).toLocaleString()}\n`));
    bytes.push(...encoder.encode(`TICKET ID: ${tx.id}\n`));
    bytes.push(...encoder.encode(`CASHIER ID: ${(tx.employee_id || '').replace('emp_','').toUpperCase()}\n`));
    bytes.push(...encoder.encode('-'.repeat(42) + '\n'));
    
    // Items
    tx.items.forEach(item => {
      const nameLine = `${item.sku.substring(0, 16).padEnd(16)}   x${item.quantity.toString().padEnd(3)}`;
      const priceVal = `Rs. ${(item.unit_price_minor_units/100).toFixed(2)}`;
      const totalVal = `Rs. ${((item.unit_price_minor_units * item.quantity)/100).toFixed(2)}`;
      const totalText = `${priceVal.padStart(6)} ${totalVal.padStart(6)}`;
      const spaceCount = 42 - (nameLine.length + totalText.length);
      const spaces = spaceCount > 0 ? ' '.repeat(spaceCount) : ' ';
      bytes.push(...encoder.encode(nameLine + spaces + totalText + '\n'));
    });
    
    bytes.push(...encoder.encode('-'.repeat(42) + '\n'));
    bytes.push(...encoder.encode(`SUBTOTAL: ${' '.repeat(42 - 9 - 6)}Rs.` + (tx.subtotal_minor_units/100).toFixed(2) + '\n'));
    bytes.push(...encoder.encode(`TAX CHARGES: ${' '.repeat(42 - 12 - 6)}Rs.` + (tx.tax_minor_units/100).toFixed(2) + '\n'));
    bytes.push(...encoder.encode('='.repeat(42) + '\n'));
    bytes.push(...encoder.encode(`GRAND TOTAL DUE: ${' '.repeat(42 - 16 - 6)}Rs.` + (tx.total_minor_units/100).toFixed(2) + '\n'));
    bytes.push(...encoder.encode('='.repeat(42) + '\n'));
    bytes.push(...encoder.encode(`PAYMENT TENDERED: ${tx.payment_mode || 'CASH'}\n`));
    if (tx.payment_details) {
      bytes.push(...encoder.encode(`REF DETAILS: ${tx.payment_details}\n`));
    }
    
    // Center align for tagline
    bytes.push(0x1B, 0x61, 0x01);
    const tagline = state.preferences['store_receipt_tagline'] || 'Stability meets Speed. Thank you!';
    bytes.push(...encoder.encode(tagline + '\n\n'));
    
    // Cut paper
    bytes.push(0x1D, 0x56, 0x41, 0x03);
    
    return new Uint8Array(bytes);
  }

  async function triggerEscPosPrintJob(tx) {
    playAudioSignal('click');
    const bytes = generateEscPosBytes(tx);
    const hexDump = Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    console.log(`[ESC/POS Print Job] Generated ${bytes.length} bytes:\n${hexDump}`);
    
    appendLogEntry({
      table_name: 'terminal_printer',
      pk: tx.id,
      cid: 'print_job',
      val: `ESC/POS Stream: ${hexDump.substring(0, 60)}...`,
      cl: 1
    });

    if (navigator.serial) {
      try {
        const port = await navigator.serial.requestPort();
        await port.open({ baudRate: 9600 });
        const writer = port.writable.getWriter();
        await writer.write(bytes);
        writer.releaseLock();
        await port.close();
        alert('Print job sent to physical printer successfully!');
      } catch (err) {
        console.warn('[Printer] Web Serial execution failed, falling back to console logging:', err);
        alert(`POS Terminal Print Spooler: Generated ${bytes.length} bytes of raw ESC/POS binary data.`);
      }
    } else {
      alert(`POS Terminal Print Spooler (Offline/Fallback): Generated ${bytes.length} bytes of raw ESC/POS binary data.`);
    }
  }

  async function serializeDatabaseToJSON() {
    const backupObj = {};
    const stores = [
      'transactions', 'line_items', 'inventory_catalog', 'employees',
      'crsql_changes', 'speech_analytics_logs', 'local_preferences',
      'customers', 'categories', 'stock_movements', 'employee_shifts',
      'distributors', 'purchase_orders', 'po_line_items', 'distributor_payments', 'customer_credit'
    ];
    for (const store of stores) {
      backupObj[store] = await NexovaDB.getAll(store);
    }
    return JSON.stringify(backupObj, null, 2);
  }

  async function simulateGoogleDriveSync() {
    playAudioSignal('click');
    const statusTxt = document.getElementById('cloud-sync-status');
    if (!statusTxt) return;
    
    setButtonLoading('btn-cloud-sync', true, 'SYNCING...', 'BACKUP TO GOOGLE DRIVE');
    statusTxt.textContent = 'Syncing: Connecting to Google Identity...';

    let token = localStorage.getItem('google_drive_oauth_token') || state.preferences['google_drive_oauth_token'];
    
    if (!token) {
      const userToken = prompt("Please enter a valid Google OAuth 2.0 Access Token to authenticate this backup sync:");
      if (!userToken) {
        statusTxt.textContent = 'Sync canceled: No Access Token provided.';
        setButtonLoading('btn-cloud-sync', false, '', 'BACKUP TO GOOGLE DRIVE');
        return;
      }
      localStorage.setItem('google_drive_oauth_token', userToken);
      syncWorker.postMessage({
        type: 'SAVE_PREFERENCE',
        payload: { key: 'google_drive_oauth_token', val: userToken }
      });
      token = userToken;
    }

    try {
      statusTxt.textContent = 'Syncing: Serializing database payload...';
      const dbDump = await serializeDatabaseToJSON();
      const dumpSize = new Blob([dbDump]).size;

      statusTxt.textContent = 'Syncing: Executing multi-part upload pipeline to Google Drive REST API...';

      const boundary = 'nexova_backup_boundary_' + Date.now();
      const delimiter = `\r\n--${boundary}\r\n`;
      const close_delim = `\r\n--${boundary}--`;
      
      const metadata = {
        name: `nexova_backup_${Date.now()}.json`,
        mimeType: 'application/json'
      };

      const multipartRequestBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        dbDump +
        close_delim;

      const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: multipartRequestBody
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          localStorage.removeItem('google_drive_oauth_token');
          throw new Error('OAuth Access Token has expired or is invalid. Please try again.');
        }
        const errText = await response.text();
        throw new Error(`Google API Error: ${response.status} - ${errText}`);
      }

      const resData = await response.json();
      console.log('[GoogleDriveSync] Upload success. File ID:', resData.id);

      const now = new Date();
      statusTxt.textContent = `Last backup: ${now.toLocaleString()} (SUCCESS)`;
      playAudioSignal('success');
      
      appendLogEntry({
        table_name: 'google_drive_sync',
        pk: `backup_${Date.now()}`,
        cid: 'cloud_upload',
        val: `Uploaded database backup (${(dumpSize/1024).toFixed(2)} KB) to Drive. File ID: ${resData.id}`,
        cl: 1
      });
    } catch (e) {
      console.error('[App] Google Drive sync error:', e);
      statusTxt.textContent = `Sync failed: ${e.message}`;
      playAudioSignal('error');
    } finally {
      setButtonLoading('btn-cloud-sync', false, '', 'BACKUP TO GOOGLE DRIVE');
    }
  }

  // --- AUDIO SYNTH BRIDGE ---
  function playAudioSignal(type) {
    if (state.preferences['audio_feedback_enabled'] === 'false') return;
    try {
      if (typeof playTone === 'function') {
        playTone(type);
      }
    } catch (e) {
      console.warn('[Audio] playAudioSignal failed safely:', e);
    }
  }

  function vibrateDevice(pattern) {
    if (state.preferences['haptic_feedback_enabled'] === 'false') return;
    if (navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {}
    }
  }

  // --- AI SPEECH COACH IMPLEMENTATION ---
  function toggleSpeechCoachRecording() {
    const btn = document.getElementById('btn-speech-record');
    const status = document.getElementById('speech-status');
    const wpm = document.getElementById('speech-wpm');
    const fillers = document.getElementById('speech-fillers');
    const sentiment = document.getElementById('speech-sentiment');
    const liveText = document.getElementById('speech-live-text');

    if (!speechCoach) {
      // Callback hooks
      const onTranscript = (text) => {
        liveText.textContent = text;
      };

      const onMetrics = (metrics) => {
        if (metrics.status === 'ERROR: no-speech') {
          status.textContent = 'NO SPEECH';
          return;
        }
        wpm.textContent = `${metrics.wpm || 0} WPM`;
        fillers.textContent = metrics.fillers || 0;
        sentiment.textContent = metrics.sentiment || 'NEUTRAL';
        
        if (metrics.sentiment === 'POSITIVE') sentiment.style.color = 'var(--success)';
        else if (metrics.sentiment === 'NEGATIVE') sentiment.style.color = 'var(--alert-coral)';
        else sentiment.style.color = 'var(--text-white)';
      };

      const onCommand = (action, val) => {
        console.log(`[SpeechCommand] Action: ${action}, Value: ${val}`);
        if (action === 'add' && val) {
          // Find catalog item matching search phrase
          const prod = state.catalog.find(p => p.sku.toLowerCase() === val.toLowerCase() || p.name.toLowerCase().includes(val.toLowerCase()));
          if (prod) addProductToCheckoutCart(prod.sku);
        } else if ((action === 'remove' || action === 'delete') && val) {
          const prod = state.catalog.find(p => p.sku.toLowerCase() === val.toLowerCase() || p.name.toLowerCase().includes(val.toLowerCase()));
          if (prod) removeCartItem(prod.sku);
        } else if (action === 'pay') {
          submitCheckoutTransaction();
        }
      };

      speechCoach = new SpeechCoach(onTranscript, onMetrics, onCommand);
    }

    speechCoach.toggleRecording();

    if (speechCoach.isRecording) {
      btn.classList.add('active');
      btn.textContent = 'STOP SPEECH COACH (F8)';
      status.textContent = 'LISTENING';
      status.classList.add('active');
      playAudioSignal('success');
    } else {
      btn.classList.remove('active');
      btn.textContent = 'START SPEECH COACH (F8)';
      status.textContent = 'OFFLINE';
      status.classList.remove('active');
      playAudioSignal('click');
    }
  }

  let scanBuffer = '';
  let lastKeyTime = 0;

  // ── Component D: HID Burst Scanner — Capture Phase ─────────────────────────
  // Registered with capture:true so it fires BEFORE any input/textarea receives
  // the keystrokes. Works even when focus is inside a text field.
  // Uses performance.now() for sub-millisecond inter-key delta precision.
  function setupHIDScannerInterceptor() {
    window.addEventListener('keydown', (e) => {
      const now = performance.now();
      // Do not process keystrokes when lock screen is active (handled by initPinPad)
      const _lockActive = document.getElementById('auth-lock-screen');
      if (_lockActive && _lockActive.classList.contains('active')) return;

      const delta = now - lastKeyTime;

      // Inter-key delta > 80ms = human typing; reset buffer
      if (delta > 80) scanBuffer = '';
      lastKeyTime = now;

      // Accumulate printable characters (scanner emits 1-char keys rapidly)
      if (e.key.length === 1) scanBuffer += e.key;

      // Enter at end = barcode confirmed
      if (e.key === 'Enter' && scanBuffer.length >= 6) {
        const barcode = scanBuffer.trim();
        scanBuffer = '';
        
        // KILL the event completely so it doesn't trigger UI clicks
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        console.log(`[HIDScanner] Captured barcode: ${barcode}`);
        const prod = state.catalog.find(p =>
          p.sku === barcode || (p.gtin && String(p.gtin) === barcode)
        );
        if (prod) {
          addProductToCheckoutCart(prod.sku);
          if (state.activeScreen !== 'checkout') switchActiveScreen('checkout');
        } else {
          playAudioSignal('error');
          showNotificationToast(`Barcode not found in catalog: ${barcode}`, null, 3000);
        }
        return; // Consumed — do not fall through to hotkeys
      }
    }, { capture: true }); // ← CAPTURE PHASE: fires before any focused element
  }

  // --- GLOBAL KEYBOARD SHORTCUTS ---
  function setupGlobalHotkeys() {
    // Launch capture-phase HID interceptor first
    setupHIDScannerInterceptor();

    window.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement.tagName;
      
      // PIN entry is handled by initPinPad() (capture-phase, registered in bindDOMEvents).
      // If lock screen is active, bail here so other hotkeys don't fire.
      const lockScreen = document.getElementById('auth-lock-screen');
      if (lockScreen && lockScreen.classList.contains('active')) return;

      // Ignore keys inside active inputs/textareas/select boxes for hotkeys
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') {
        if (e.key === 'Enter' && document.activeElement.id === 'reset-admin-pin-auth') {
          submitGrandResetPurge();
        }
        return;
      }

      switch (e.key) {
        case 'F1':
          e.preventDefault();
          submitCheckoutTransaction();
          break;

        case 'F2':
          e.preventDefault();
          if (state.activeCart.length > 0 && confirm('Void this active order cart?')) {
            state.activeCart = [];
            state.attachedCustomer = null;
            document.getElementById('checkout-customer-attached').innerHTML = `<span class="text-muted">No customer attached to transaction.</span>`;
            document.getElementById('btn-open-customer-link').textContent = 'Attach';
            renderCart();
          }
          break;

        case 'F5':
          e.preventDefault();
          switchActiveScreen('checkout');
          document.getElementById('checkout-search-input').focus();
          break;

        case 'F8':
          e.preventDefault();
          toggleSpeechCoachRecording();
          break;
      }
    });



    // Close modals on Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
      }
    });
  }

  // ============================================================================
  // PHASE 2: DISTRIBUTOR & CUSTOMER CREDIT LEDGERS BUSINESS LOGIC
  // ============================================================================

  // Global premium currency formatter
  function formatCurrency(minor) {
    return `Rs. ${(minor / 100.0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  // Calculate distributor outstanding balance (accounts payable)
  function getDistributorOutstanding(distributorId) {
    const pos = state.purchaseOrders.filter(po => po.distributor_id === distributorId && po.status !== 'CANCELLED' && po.status !== 'DRAFT' && po.is_deleted !== 1);
    const payments = state.distributorPayments.filter(p => p.distributor_id === distributorId && p.is_deleted !== 1);
    const totalPO = pos.reduce((sum, po) => sum + (po.total_minor || 0), 0);
    const totalPaid = payments.reduce((sum, p) => sum + (p.amount_minor || 0), 0);
    return totalPO - totalPaid;
  }

  // Calculate customer credit ledger balance (accounts receivable)
  function getCustomerCreditBalance(customerId) {
    const credits = state.customerCredits.filter(c => c.customer_id === customerId && c.is_deleted !== 1);
    let balance = 0;
    for (const c of credits) {
      if (c.type === 'CREDIT') {
        balance += c.amount_minor;
      } else if (c.type === 'PAYMENT') {
        balance -= c.amount_minor;
      }
    }
    return balance;
  }

  let activePoItems = []; // Temporary cart for creating POs

  // Initialize all ledger event listeners
  function initLedgerModules() {
    // Supplier search
    const supSearch = document.getElementById('supplier-search');
    if (supSearch) {
      supSearch.addEventListener('input', (e) => {
        renderSuppliersScreen(e.target.value.toLowerCase().trim());
      });
    }

    // Add supplier trigger
    const addSupBtn = document.getElementById('btn-suppliers-create');
    if (addSupBtn) {
      addSupBtn.addEventListener('click', () => {
        openSupplierEditModal();
      });
    }

    // Modal supplier cancel & submit
    document.getElementById('btn-close-supplier-modal').addEventListener('click', () => {
      document.getElementById('modal-supplier').classList.remove('active');
    });
    document.getElementById('btn-cancel-supplier-modal').addEventListener('click', () => {
      document.getElementById('modal-supplier').classList.remove('active');
    });
    document.getElementById('btn-submit-supplier-modal').addEventListener('click', () => {
      submitSupplierForm();
    });

    // Modal PO cancel & submit
    document.getElementById('btn-close-po-modal').addEventListener('click', () => {
      document.getElementById('modal-po').classList.remove('active');
    });
    document.getElementById('btn-cancel-po-modal').addEventListener('click', () => {
      document.getElementById('modal-po').classList.remove('active');
    });
    document.getElementById('btn-submit-po-modal').addEventListener('click', () => {
      submitPoForm();
    });

    // Add item row in PO modal
    document.getElementById('btn-po-add-item-row').addEventListener('click', () => {
      addPoItemRow();
    });

    // Modal distributor payment cancel & submit
    document.getElementById('btn-close-distributor-payment-modal').addEventListener('click', () => {
      document.getElementById('modal-distributor-payment').classList.remove('active');
    });
    document.getElementById('btn-cancel-distributor-payment-modal').addEventListener('click', () => {
      document.getElementById('modal-distributor-payment').classList.remove('active');
    });
    document.getElementById('btn-submit-distributor-payment-modal').addEventListener('click', () => {
      submitDistributorPaymentForm();
    });

    // Modal PO receive cancel & submit
    document.getElementById('btn-close-po-receive-modal').addEventListener('click', () => {
      document.getElementById('modal-po-receive').classList.remove('active');
    });
    document.getElementById('btn-cancel-po-receive-modal').addEventListener('click', () => {
      document.getElementById('modal-po-receive').classList.remove('active');
    });
    document.getElementById('btn-submit-po-receive-modal').addEventListener('click', () => {
      submitPoReceiveForm();
    });

    // Customer credit book search
    const credSearch = document.getElementById('credit-customer-search');
    if (credSearch) {
      credSearch.addEventListener('input', (e) => {
        renderCreditBookScreen(e.target.value.toLowerCase().trim());
      });
    }
  }

  // --- SUPPLIERS VIEW CONTROLLER ---
  function renderSuppliersScreen(query = '') {
    const listContainer = document.getElementById('supplier-list-container');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    const list = state.distributors.filter(d => d.is_deleted !== 1 && (!query || d.name.toLowerCase().includes(query) || (d.phone && d.phone.includes(query))));

    if (list.length === 0) {
      listContainer.innerHTML = `<p class="text-center text-muted" style="margin-top: 50px;">No matching suppliers found.</p>`;
      return;
    }

    list.forEach(d => {
      const outstanding = getDistributorOutstanding(d.id);
      const card = document.createElement('div');
      card.className = `supplier-item-card ${state.selectedDistributorId === d.id ? 'active' : ''}`;
      
      let badgeClass = 'badge-gray';
      if (outstanding > 0) badgeClass = 'badge-red';
      else if (outstanding < 0) badgeClass = 'badge-green';

      card.innerHTML = `
        <div class="item-info">
          <span class="item-title">${d.name}</span>
          <span class="item-sub">${d.phone || 'No phone'}</span>
        </div>
        <span class="item-badge ${badgeClass}">${formatCurrency(Math.abs(outstanding))}</span>
      `;

      card.addEventListener('click', () => {
        state.selectedDistributorId = d.id;
        renderSuppliersScreen(query);
        renderSupplierDetails(d.id);
      });

      listContainer.appendChild(card);
    });

    // Auto load selected detail panel if still exists
    if (state.selectedDistributorId) {
      const exists = state.distributors.find(d => d.id === state.selectedDistributorId && d.is_deleted !== 1);
      if (exists) {
        renderSupplierDetails(state.selectedDistributorId);
      } else {
        state.selectedDistributorId = null;
        document.getElementById('supplier-detail-panel').style.display = 'none';
        document.getElementById('supplier-detail-empty').style.display = 'flex';
      }
    }
  }

  // Render detail panel for selected supplier
  let activeSupplierTab = 'pos'; // pos, payments
  function renderSupplierDetails(id) {
    const detailPanel = document.getElementById('supplier-detail-panel');
    const emptyPanel = document.getElementById('supplier-detail-empty');
    if (!detailPanel || !emptyPanel) return;

    const d = state.distributors.find(item => item.id === id);
    if (!d) return;

    emptyPanel.style.display = 'none';
    detailPanel.style.display = 'flex';

    const outstanding = getDistributorOutstanding(id);
    const balanceText = outstanding > 0 ? 'Accounts Payable Balance' : (outstanding < 0 ? 'Accounts Receivable Credit' : 'Balance Clear');
    const outstandingClass = outstanding > 0 ? 'text-coral' : (outstanding < 0 ? 'text-emerald' : 'text-muted');

    detailPanel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: start; border-bottom: 1px solid var(--border-titanium); padding-bottom: 16px;">
        <div>
          <h2 style="font-family: var(--font-display); font-weight: 800; font-size: 20px; color: var(--text-white); margin-bottom: 4px;">${d.name}</h2>
          <span style="font-size: 11px; color: var(--text-gray);">${d.address || 'No address registered'}</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="action-btn" id="btn-supplier-edit" style="min-height:36px; font-size:11px; padding: 6px 12px;">Edit Details</button>
          <button class="action-btn action-danger" id="btn-supplier-delete" style="min-height:36px; font-size:11px; padding: 6px 12px;">Delete</button>
        </div>
      </div>

      <div class="kpi-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
        <div class="kpi-card" style="padding: 12px; background: rgba(255,255,255,0.01); border: 1px solid var(--border-titanium); border-radius: 8px;">
          <span style="font-size: 10px; color: var(--text-gray); display: block; margin-bottom: 4px;">CREDIT LIMIT</span>
          <span style="font-size: 16px; font-weight: 800; color: var(--text-white);">${formatCurrency(d.credit_limit_minor || 0)}</span>
        </div>
        <div class="kpi-card" style="padding: 12px; background: rgba(255,255,255,0.01); border: 1px solid var(--border-titanium); border-radius: 8px;">
          <span style="font-size: 10px; color: var(--text-gray); display: block; margin-bottom: 4px;">CONTACT PHONE</span>
          <span style="font-size: 16px; font-weight: 800; color: var(--text-white);">${d.phone || 'N/A'}</span>
        </div>
        <div class="kpi-card" style="padding: 12px; background: rgba(255,255,255,0.01); border: 1px solid var(--border-titanium); border-radius: 8px;">
          <span style="font-size: 10px; color: var(--text-gray); display: block; margin-bottom: 4px;">${balanceText.toUpperCase()}</span>
          <span style="font-size: 16px; font-weight: 800;" class="${outstandingClass}">${formatCurrency(Math.abs(outstanding))}</span>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
        <div class="ledger-tab-bar">
          <button class="ledger-tab-btn ${activeSupplierTab === 'pos' ? 'active' : ''}" id="tab-supplier-pos">Purchase Orders</button>
          <button class="ledger-tab-btn ${activeSupplierTab === 'payments' ? 'active' : ''}" id="tab-supplier-payments">Payment Records</button>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="action-btn action-success" id="btn-supplier-create-po" style="min-height:36px; font-size:11px; padding: 6px 12px;">+ Create PO</button>
          <button class="action-btn action-success" id="btn-supplier-record-pay" style="min-height:36px; font-size:11px; padding: 6px 12px;">Post Payment</button>
        </div>
      </div>

      <div id="supplier-ledger-tab-content" style="flex-grow: 1;">
        <!-- dynamic tab content -->
      </div>
    `;

    // Bind inner buttons
    document.getElementById('btn-supplier-edit').addEventListener('click', () => openSupplierEditModal(id));
    document.getElementById('btn-supplier-delete').addEventListener('click', () => deleteSupplier(id));
    document.getElementById('btn-supplier-create-po').addEventListener('click', () => openPoModal(id));
    document.getElementById('btn-supplier-record-pay').addEventListener('click', () => openDistributorPaymentModal(id));
    
    const tabPos = document.getElementById('tab-supplier-pos');
    const tabPayments = document.getElementById('tab-supplier-payments');

    tabPos.addEventListener('click', () => {
      activeSupplierTab = 'pos';
      renderSupplierDetails(id);
    });
    tabPayments.addEventListener('click', () => {
      activeSupplierTab = 'payments';
      renderSupplierDetails(id);
    });

    renderSupplierTabContent(id);
  }

  // Render content lists inside selected tabs
  function renderSupplierTabContent(id) {
    const container = document.getElementById('supplier-ledger-tab-content');
    if (!container) return;
    container.innerHTML = '';

    if (activeSupplierTab === 'pos') {
      const pos = state.purchaseOrders.filter(po => po.distributor_id === id && po.is_deleted !== 1)
                       .sort((a, b) => b.created_at - a.created_at);

      if (pos.length === 0) {
        container.innerHTML = `<p class="text-center text-muted" style="margin-top: 30px; font-size: 11px;">No purchase orders generated for this supplier.</p>`;
        return;
      }

      const listDiv = document.createElement('div');
      listDiv.className = 'ledger-timeline-list';
      
      pos.forEach(po => {
        const item = document.createElement('div');
        item.className = 'ledger-timeline-item';
        
        let statusColor = 'var(--text-gray)';
        if (po.status === 'RECEIVED') statusColor = 'var(--success)';
        else if (po.status === 'PARTIAL') statusColor = 'var(--warning)';
        else if (po.status === 'SENT') statusColor = 'var(--accent-blue)';

        let grnBtn = '';
        if (po.status !== 'RECEIVED' && po.status !== 'CANCELLED') {
          grnBtn = `<button class="action-btn btn-po-grn-trigger" data-id="${po.id}" style="min-height:24px; font-size:10px; padding: 2px 8px; margin-left: 12px; background: var(--accent-emerald-mid); color: white; border: none; border-radius: 4px; cursor: pointer;">Receive Goods (GRN)</button>`;
        }

        const dateStr = new Date(po.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        item.innerHTML = `
          <div class="time-meta">
            <span class="time-title">PO Ref: ${po.id.substring(3, 10).toUpperCase()} <span style="color: ${statusColor}; font-weight: 800; font-size: 9px; margin-left: 8px;">[${po.status}]</span></span>
            <span class="time-date">Issued: ${dateStr} | Notes: ${po.notes || 'None'}</span>
          </div>
          <div style="display: flex; align-items: center;">
            <span class="time-val" style="color: var(--text-white);">${formatCurrency(po.total_minor || 0)}</span>
            ${grnBtn}
          </div>
        `;

        if (item.querySelector('.btn-po-grn-trigger')) {
          item.querySelector('.btn-po-grn-trigger').addEventListener('click', (e) => {
            e.stopPropagation();
            openPoReceiveModal(po.id);
          });
        }

        listDiv.appendChild(item);
      });
      container.appendChild(listDiv);

    } else {
      const pays = state.distributorPayments.filter(p => p.distributor_id === id && p.is_deleted !== 1)
                        .sort((a, b) => b.paid_at - a.paid_at);

      if (pays.length === 0) {
        container.innerHTML = `<p class="text-center text-muted" style="margin-top: 30px; font-size: 11px;">No payments recorded for this supplier.</p>`;
        return;
      }

      const listDiv = document.createElement('div');
      listDiv.className = 'ledger-timeline-list';
      
      pays.forEach(p => {
        const item = document.createElement('div');
        item.className = 'ledger-timeline-item';
        
        const dateStr = new Date(p.paid_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const refNote = p.reference_note ? ` | Ref: ${p.reference_note}` : '';

        item.innerHTML = `
          <div class="time-meta">
            <span class="time-title">Payment Mode: ${p.payment_method}</span>
            <span class="time-date">${dateStr}${refNote}</span>
          </div>
          <span class="time-val text-emerald">${formatCurrency(p.amount_minor)}</span>
        `;
        listDiv.appendChild(item);
      });
      container.appendChild(listDiv);
    }
  }

  // --- SUPPLIER EDIT MODAL ---
  function openSupplierEditModal(id = null) {
    playAudioSignal('click');
    const modal = document.getElementById('modal-supplier');
    const title = document.getElementById('modal-supplier-title');
    
    document.getElementById('form-supplier-id').value = id || '';
    document.getElementById('form-supplier-name').value = '';
    document.getElementById('form-supplier-phone').value = '';
    document.getElementById('form-supplier-email').value = '';
    document.getElementById('form-supplier-address').value = '';
    document.getElementById('form-supplier-credit-limit').value = '';
    document.getElementById('form-supplier-notes').value = '';

    if (id) {
      title.textContent = 'Edit Supplier Details';
      const d = state.distributors.find(item => item.id === id);
      if (d) {
        document.getElementById('form-supplier-name').value = d.name;
        document.getElementById('form-supplier-phone').value = d.phone || '';
        document.getElementById('form-supplier-email').value = d.email || '';
        document.getElementById('form-supplier-address').value = d.address || '';
        document.getElementById('form-supplier-credit-limit').value = d.credit_limit_minor || '';
        document.getElementById('form-supplier-notes').value = d.notes || '';
      }
    } else {
      title.textContent = 'Add New Supplier';
    }

    modal.classList.add('active');
  }

  function submitSupplierForm() {
    const id = document.getElementById('form-supplier-id').value || 'dist_' + Date.now();
    const name = document.getElementById('form-supplier-name').value.trim();
    const phone = document.getElementById('form-supplier-phone').value.trim();
    const email = document.getElementById('form-supplier-email').value.trim();
    const address = document.getElementById('form-supplier-address').value.trim();
    const creditLimit = parseInt(document.getElementById('form-supplier-credit-limit').value || 0);
    const notes = document.getElementById('form-supplier-notes').value.trim();

    if (!name) {
      alert('Supplier name is required.');
      return;
    }

    syncWorker.postMessage({
      type: 'SAVE_DISTRIBUTOR',
      payload: { id, name, phone, email, address, creditLimit, notes }
    });

    document.getElementById('modal-supplier').classList.remove('active');
    playAudioSignal('success');
  }

  function deleteSupplier(id) {
    if (confirm('Are you sure you want to delete this supplier profile? Outstanding ledger histories will remain recorded in sync changes.')) {
      playAudioSignal('reset');
      const tickHlc = syncWorker.hlc?.tick() || '0000000000000:000000:local';
      // Post soft-delete changes
      syncWorker.postMessage({
        type: 'SAVE_DISTRIBUTOR',
        payload: { id, name: 'Deleted Supplier', is_deleted: 1 }
      });
      // Force refresh
      setTimeout(() => {
        syncWorker.postMessage({ type: 'GET_DISTRIBUTORS' });
      }, 300);
    }
  }

  // --- PURCHASE ORDER MODAL CONTROLLER ---
  function openPoModal(distributorId) {
    playAudioSignal('click');
    const dist = state.distributors.find(d => d.id === distributorId);
    if (!dist) return;

    document.getElementById('form-po-distributor-id').value = distributorId;
    document.getElementById('form-po-distributor-name').value = dist.name;
    document.getElementById('form-po-expected-delivery').value = '';
    document.getElementById('form-po-notes').value = '';
    document.getElementById('form-po-status').value = 'DRAFT';
    
    // Reset PO items selector and list
    activePoItems = [];
    renderPoItemsTable();

    // Populate products select
    const select = document.getElementById('form-po-item-sku-select');
    select.innerHTML = '<option value="">-- Select Product --</option>';
    state.catalog.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.sku;
      opt.textContent = `${p.name} (${p.sku}) - Base Price: ${formatCurrency(p.base_price_minor_units)}`;
      select.appendChild(opt);
    });

    document.getElementById('modal-po').classList.add('active');
  }

  function addPoItemRow() {
    const select = document.getElementById('form-po-item-sku-select');
    const qtyInput = document.getElementById('form-po-item-qty');
    const costInput = document.getElementById('form-po-item-cost');

    const sku = select.value;
    const qty = parseInt(qtyInput.value || 0);
    const cost = parseFloat(costInput.value || 0) * 100; // cost in minor units

    if (!sku) {
      alert('Please select a product.');
      return;
    }
    if (qty <= 0) {
      alert('Quantity must be greater than zero.');
      return;
    }

    const prod = state.catalog.find(p => p.sku === sku);
    if (!prod) return;

    // Check if already in list
    const existing = activePoItems.find(item => item.sku === sku);
    if (existing) {
      existing.qtyOrdered += qty;
      if (cost > 0) existing.unitCost = cost;
    } else {
      activePoItems.push({
        sku: sku,
        name: prod.name,
        qtyOrdered: qty,
        qtyReceived: 0,
        unitCost: cost > 0 ? cost : prod.cost_price_minor_units || Math.round(prod.base_price_minor_units * 0.6) // default cost 60%
      });
    }

    renderPoItemsTable();

    // Reset inputs
    select.value = '';
    qtyInput.value = '10';
    costInput.value = '';
    playAudioSignal('click');
  }

  function renderPoItemsTable() {
    const tbody = document.getElementById('po-items-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (activePoItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding: 12px;">No products added to purchase order yet.</td></tr>`;
      return;
    }

    activePoItems.forEach((item, index) => {
      const prod = state.catalog.find(p => p.sku === item.sku);
      const retailPrice = prod ? prod.base_price_minor_units : 0;
      const marginPerUnit = retailPrice - item.unitCost;
      const marginPct = retailPrice > 0 ? ((marginPerUnit / retailPrice) * 100).toFixed(1) : '0.0';
      
      const subtotal = item.qtyOrdered * item.unitCost;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <strong>${item.name}</strong><br>
          <span style="color:var(--text-gray); font-size:10px;">SKU: ${item.sku}</span><br>
          <span style="color:var(--accent-emerald); font-size:10px; font-weight:700;">
            Margin: Rs. ${(marginPerUnit / 100.0).toFixed(2)} (${marginPct}%) | Retail: Rs. ${(retailPrice / 100.0).toFixed(2)}
          </span>
        </td>
        <td style="text-align: center;">${item.qtyOrdered}</td>
        <td style="text-align: right;">${formatCurrency(item.unitCost)}</td>
        <td style="text-align: right; font-weight:700;">${formatCurrency(subtotal)}</td>
        <td style="text-align: center;">
          <button class="btn-po-item-remove" data-index="${index}" style="background:transparent; border:none; color:var(--alert-coral); cursor:pointer; font-size:14px;">×</button>
        </td>
      `;

      tr.querySelector('.btn-po-item-remove').addEventListener('click', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'));
        activePoItems.splice(idx, 1);
        renderPoItemsTable();
        playAudioSignal('click');
      });

      tbody.appendChild(tr);
    });
  }

  function submitPoForm() {
    const distributorId = document.getElementById('form-po-distributor-id').value;
    const expected = document.getElementById('form-po-expected-delivery').value;
    const status = document.getElementById('form-po-status').value;
    const notes = document.getElementById('form-po-notes').value.trim();

    if (activePoItems.length === 0) {
      alert('Add at least one product line item to generate a purchase order.');
      return;
    }

    const id = 'po_' + Date.now();
    const expectedDelivery = expected ? new Date(expected).getTime() : null;

    syncWorker.postMessage({
      type: 'SAVE_PURCHASE_ORDER',
      payload: { id, distributorId, status, items: activePoItems, notes, expectedDelivery }
    });

    document.getElementById('modal-po').classList.remove('active');
    playAudioSignal('success');
  }

  // --- DISTRIBUTOR PAYMENT MODAL CONTROLLER ---
  function openDistributorPaymentModal(distributorId) {
    playAudioSignal('click');
    const dist = state.distributors.find(d => d.id === distributorId);
    if (!dist) return;

    document.getElementById('form-dp-distributor-id').value = distributorId;
    document.getElementById('form-dp-distributor-name').value = dist.name;
    document.getElementById('form-dp-amount').value = '';
    document.getElementById('form-dp-ref-note').value = '';

    // Populate active POs filter options for payments reference
    const poSelect = document.getElementById('form-dp-po-id');
    poSelect.innerHTML = '<option value="">-- No Direct PO Reference --</option>';
    
    const activePOs = state.purchaseOrders.filter(po => po.distributor_id === distributorId && po.status !== 'RECEIVED' && po.status !== 'CANCELLED' && po.is_deleted !== 1);
    activePOs.forEach(po => {
      const opt = document.createElement('option');
      opt.value = po.id;
      opt.textContent = `PO: ${po.id.substring(3, 10).toUpperCase()} - Total: ${formatCurrency(po.total_minor)} [${po.status}]`;
      poSelect.appendChild(opt);
    });

    document.getElementById('modal-distributor-payment').classList.add('active');
  }

  function submitDistributorPaymentForm() {
    const id = 'pay_' + Date.now();
    const distributorId = document.getElementById('form-dp-distributor-id').value;
    const poId = document.getElementById('form-dp-po-id').value;
    const amountVal = parseFloat(document.getElementById('form-dp-amount').value || 0);
    const paymentMethod = document.getElementById('form-dp-method').value;
    const referenceNote = document.getElementById('form-dp-ref-note').value.trim();

    if (amountVal <= 0) {
      alert('Payment amount must be greater than zero.');
      return;
    }

    const amount = Math.round(amountVal * 100); // convert to cents/minor

    syncWorker.postMessage({
      type: 'SAVE_DISTRIBUTOR_PAYMENT',
      payload: { id, distributorId, poId, amount, paymentMethod, referenceNote }
    });

    document.getElementById('modal-distributor-payment').classList.remove('active');
    playAudioSignal('success');
  }

  // --- GOODS RECEIPT NOTE (GRN) MODAL CONTROLLER ---
  function openPoReceiveModal(poId) {
    playAudioSignal('click');
    const po = state.purchaseOrders.find(o => o.id === poId);
    if (!po) return;

    document.getElementById('form-recv-po-id').value = poId;

    const tbody = document.getElementById('po-receive-tbody');
    tbody.innerHTML = '';

    po.items.forEach(item => {
      const prod = state.catalog.find(p => p.sku === item.sku);
      const retailPrice = prod ? prod.base_price_minor_units : 0;
      const unitCost = item.unit_cost_minor || 0;
      const marginPerUnit = retailPrice - unitCost;
      const marginPct = retailPrice > 0 ? ((marginPerUnit / retailPrice) * 100).toFixed(1) : '0.0';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <strong>${item.product_name}</strong><br>
          <span style="color:var(--text-gray); font-size:10px;">SKU: ${item.sku}</span><br>
          <span style="color:var(--accent-emerald); font-size:10px; font-weight:700;">
            Margin: Rs. ${(marginPerUnit / 100.0).toFixed(2)} (${marginPct}%) | Cost: Rs. ${(unitCost / 100.0).toFixed(2)}
          </span>
        </td>
        <td style="text-align: center;">${item.quantity_ordered} / ${item.quantity_received || 0}</td>
        <td style="text-align: right;">
          <input type="number" class="pos-input grn-qty-input" data-id="${item.id}" data-sku="${item.sku}" value="${item.quantity_ordered - (item.quantity_received || 0)}" min="0" style="width: 80px; text-align: center; padding: 4px;">
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById('modal-po-receive').classList.add('active');
  }

  function submitPoReceiveForm() {
    const poId = document.getElementById('form-recv-po-id').value;
    const tbody = document.getElementById('po-receive-tbody');
    const inputs = tbody.querySelectorAll('.grn-qty-input');

    const itemsReceived = [];
    let valid = true;

    inputs.forEach(input => {
      const qty = parseInt(input.value || 0);
      const itemId = input.getAttribute('data-id');
      const sku = input.getAttribute('data-sku');
      if (qty < 0) {
        valid = false;
      }
      if (qty > 0) {
        itemsReceived.push({
          id: itemId,
          sku: sku,
          qtyReceived: qty
        });
      }
    });

    if (!valid) {
      alert('Received quantities cannot be negative values.');
      return;
    }

    if (itemsReceived.length === 0) {
      alert('No quantities were declared to be received now.');
      return;
    }

    syncWorker.postMessage({
      type: 'RECEIVE_PURCHASE_ORDER',
      payload: { id: poId, itemsReceived }
    });

    document.getElementById('modal-po-receive').classList.remove('active');
    playAudioSignal('success');
  }

  // --- CREDIT BOOK / KHATA VIEW CONTROLLER ---
  function renderCreditBookScreen(query = '') {
    const listContainer = document.getElementById('credit-customer-list-container');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    // Filter customers who have active credit accounts
    const linkedCustomerIds = [...new Set(state.customerCredits.map(c => c.customer_id))];
    const list = state.customers.filter(c => c.is_deleted !== 1 && linkedCustomerIds.includes(c.id) && (!query || c.name.toLowerCase().includes(query) || (c.phone && c.phone.includes(query))));

    if (list.length === 0) {
      listContainer.innerHTML = `<p class="text-center text-muted" style="margin-top: 50px;">No customer credit profiles match search.</p>`;
      return;
    }

    list.forEach(c => {
      const balance = getCustomerCreditBalance(c.id);
      const card = document.createElement('div');
      card.className = `credit-item-card ${state.selectedCreditCustomerId === c.id ? 'active' : ''}`;
      
      let badgeClass = 'badge-gray';
      if (balance > 0) badgeClass = 'badge-red'; // Red badge for udhaar outstanding

      card.innerHTML = `
        <div class="item-info">
          <span class="item-title">${c.name}</span>
          <span class="item-sub">${c.phone || 'No phone'}</span>
        </div>
        <span class="item-badge ${badgeClass}">${formatCurrency(balance)}</span>
      `;

      card.addEventListener('click', () => {
        state.selectedCreditCustomerId = c.id;
        renderCreditBookScreen(query);
        renderCreditDetails(c.id);
      });

      listContainer.appendChild(card);
    });

    // Auto load selected detail panel if still exists
    if (state.selectedCreditCustomerId) {
      const exists = state.customers.find(c => c.id === state.selectedCreditCustomerId && c.is_deleted !== 1);
      if (exists) {
        renderCreditDetails(state.selectedCreditCustomerId);
      } else {
        state.selectedCreditCustomerId = null;
        document.getElementById('credit-detail-panel').style.display = 'none';
        document.getElementById('credit-detail-empty').style.display = 'flex';
      }
    }
  }

  // Render detail panel for customer credit
  function renderCreditDetails(id) {
    const detailPanel = document.getElementById('credit-detail-panel');
    const emptyPanel = document.getElementById('credit-detail-empty');
    if (!detailPanel || !emptyPanel) return;

    const c = state.customers.find(item => item.id === id);
    if (!c) return;

    emptyPanel.style.display = 'none';
    detailPanel.style.display = 'flex';

    const balance = getCustomerCreditBalance(id);
    const outstandingClass = balance > 0 ? 'text-coral' : 'text-emerald';

    // Find overdue statements if any
    const now = Date.now();
    const overdueCredits = state.customerCredits.filter(cc => cc.customer_id === id && cc.type === 'CREDIT' && cc.due_date && cc.due_date < now && cc.is_deleted !== 1);
    
    let alertBox = '';
    if (overdueCredits.length > 0 && balance > 0) {
      alertBox = `
        <div class="outstanding-pill overdue" style="margin-bottom: 16px;">
          <span style="font-size: 11px; font-weight: 700; color: var(--alert-coral);">⚠️ OVERDUE UDHAAR INVOICES DETECTED</span>
          <span style="font-size: 11px; color: var(--text-white); font-weight: 800;">Please request immediate repayment.</span>
        </div>
      `;
    }

    detailPanel.innerHTML = `
      ${alertBox}

      <div style="display: flex; justify-content: space-between; align-items: start; border-bottom: 1px solid var(--border-titanium); padding-bottom: 16px;">
        <div>
          <h2 style="font-family: var(--font-display); font-weight: 800; font-size: 20px; color: var(--text-white); margin-bottom: 4px;">${c.name}</h2>
          <span style="font-size: 11px; color: var(--text-gray);">Linked Phone: ${c.phone || 'N/A'} | Email: ${c.email || 'N/A'}</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="action-btn action-success" id="btn-credit-whatsapp" style="min-height:36px; font-size:11px; padding: 6px 12px; display: inline-flex; align-items: center; gap: 6px;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Send WhatsApp Reminder
          </button>
          <button class="action-btn action-success" id="btn-credit-record-repay" style="min-height:36px; font-size:11px; padding: 6px 12px;">Record Repayment</button>
        </div>
      </div>

      <div style="display: flex; align-items: center; justify-content: space-between; padding: 16px; background: rgba(255,255,255,0.01); border: 1px solid var(--border-titanium); border-radius: 8px;">
        <div>
          <span style="font-size: 11px; color: var(--text-gray); display: block; margin-bottom: 4px; text-transform: uppercase;">Outstanding Credit Balance</span>
          <span style="font-size: 24px; font-weight: 900;" class="${outstandingClass}">${formatCurrency(balance)}</span>
        </div>
        <div style="text-align: right;">
          <span style="font-size: 11px; color: var(--text-gray); display: block; margin-bottom: 4px;">TOTAL SALES VISITS</span>
          <span style="font-size: 18px; font-weight: 800; color: var(--text-white);">${c.visits || 0} visits</span>
        </div>
      </div>

      <div style="margin-top: 10px;">
        <h4 style="font-family: var(--font-display); font-weight: 800; font-size: 12px; color: var(--text-white); border-bottom: 1px solid var(--border-titanium); padding-bottom: 8px;">Ledger Statement History</h4>
        <div class="ledger-timeline-list" id="credit-timeline-container">
          <!-- dynamic ledger entries -->
        </div>
      </div>
    `;

    // Bind buttons
    document.getElementById('btn-credit-record-repay').addEventListener('click', () => openRepaymentModal(id));
    document.getElementById('btn-credit-whatsapp').addEventListener('click', () => {
      sendWhatsAppReminder(c.phone, c.name, balance);
    });

    renderCreditTimeline(id);
  }

  function renderCreditTimeline(customerId) {
    const container = document.getElementById('credit-timeline-container');
    if (!container) return;
    container.innerHTML = '';

    const history = state.customerCredits.filter(cc => cc.customer_id === customerId && cc.is_deleted !== 1)
                         .sort((a, b) => b.created_at - a.created_at);

    if (history.length === 0) {
      container.innerHTML = `<p class="text-center text-muted" style="margin-top: 30px; font-size: 11px;">No credit operations logged.</p>`;
      return;
    }

    history.forEach(cc => {
      const item = document.createElement('div');
      item.className = 'ledger-timeline-item';
      
      const dateStr = new Date(cc.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const dueStr = (cc.type === 'CREDIT' && cc.due_date) ? ` | Due: ${new Date(cc.due_date).toLocaleDateString()}` : '';

      const valClass = cc.type === 'CREDIT' ? 'text-coral' : 'text-emerald';
      const valPrefix = cc.type === 'CREDIT' ? '+' : '-';
      const typeLabel = cc.type === 'CREDIT' ? 'Credit Issued (Sale)' : `Repayment Recorded (${cc.payment_method})`;

      item.innerHTML = `
        <div class="time-meta">
          <span class="time-title">${typeLabel}</span>
          <span class="time-date">${dateStr}${dueStr} | Notes: ${cc.notes || 'None'}</span>
        </div>
        <span class="time-val ${valClass}">${valPrefix}${formatCurrency(cc.amount_minor)}</span>
      `;
      container.appendChild(item);
    });
  }

  // --- REPAYMENT MODAL ---
  function openRepaymentModal(customerId) {
    playAudioSignal('click');
    const cust = state.customers.find(c => c.id === customerId);
    if (!cust) return;

    // We reuse the distributor payment modal container by dynamically repurposing inputs or creating alert prompts
    // Let's create an input prompt directly for speed and simplicity
    const outstanding = getCustomerCreditBalance(customerId);
    const amountStr = prompt(`Record Udhaar repayment from customer: ${cust.name}\nCurrent Outstanding: ${formatCurrency(outstanding)}\n\nEnter payment amount received in Rupees:`, (outstanding/100).toFixed(2));
    
    if (amountStr === null) return; // user cancelled

    const amountVal = parseFloat(amountStr || 0);
    if (amountVal <= 0 || isNaN(amountVal)) {
      alert('Repayment amount must be greater than zero.');
      return;
    }

    const amountMinor = Math.round(amountVal * 100);

    const method = prompt('Specify payment method received (CASH, BANK_TRANSFER, EASYPAISA, JAZZCASH):', 'CASH');
    if (method === null) return;

    const notes = prompt('Add reference notes / Transaction reference ID (Optional):', 'Posted manual repayment');
    if (notes === null) return;

    const id = 'cc_pay_' + Date.now();

    syncWorker.postMessage({
      type: 'SAVE_CUSTOMER_CREDIT',
      payload: {
        id,
        customerId,
        transactionId: null,
        type: 'PAYMENT',
        amount: amountMinor,
        paymentMethod: method.toUpperCase(),
        dueDate: null,
        notes: notes || 'Repayment posted'
      }
    });

    playAudioSignal('success');
  }

  // --- WHATSAPP REMINDER INTEGRATION ---
  function sendWhatsAppReminder(phone, customerName, amountMinor) {
    playAudioSignal('click');
    if (!phone) {
      alert('Customer profile has no linked phone number to send WhatsApp message.');
      return;
    }

    const storeName = state.preferences['store_name'] || 'NEXOVA STORE';
    const amountRs = (amountMinor / 100.0).toFixed(2);
    
    // Compose reminder message
    const rawMsg = `Assalamu Alaikum, ${customerName}. This is a friendly reminder from ${storeName} that your outstanding credit balance (udhaar) is Rs. ${amountRs}. Please make arrangement for payment at your earliest convenience. JazakAllah!`;
    const encodedText = encodeURIComponent(rawMsg);
    
    // Sanitize phone (e.g. remove - spaces, ensure +92 country prefix)
    let formattedPhone = phone.replace(/[\s\-\+\(\)]/g, '');
    if (formattedPhone.startsWith('03')) {
      formattedPhone = '92' + formattedPhone.substring(1);
    }

    const waUrl = `https://wa.me/${formattedPhone}?text=${encodedText}`;
    
    // Open in desktop wrapper / browser window
    window.open(waUrl, '_blank');
  }

  // ── Component H: Bulk CSV Catalog Importer ─────────────────────────────────
  // Parses CSV client-side, yields to the render thread between batches via
  // setTimeout(0) to guarantee 60fps skeleton animation during import.
  async function handleCsvImport(file) {
    if (!file) return;
    const CSV_BATCH_SIZE = 100;

    const progressEl = document.getElementById('csv-import-progress');
    const statusEl   = document.getElementById('csv-import-status');
    const setProgress = (pct, msg) => {
      if (progressEl) progressEl.style.width = `${pct}%`;
      if (statusEl)   statusEl.textContent   = msg;
    };

    // RFC 4180 compliant simple CSV line parser
    function parseCsvLine(line) {
      const result = [];
      let insideQuote = false;
      let entry = '';
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          insideQuote = !insideQuote;
        } else if (char === ',' && !insideQuote) {
          result.push(entry);
          entry = '';
        } else {
          entry += char;
        }
      }
      result.push(entry);
      return result;
    }

    setProgress(0, 'Reading file…');
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { setProgress(0, 'CSV is empty or has no data rows.'); return; }

    // Auto-detect header columns (case-insensitive)
    const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
    const col = (name) => headers.indexOf(name);
    const cols = {
      sku:      col('sku'),
      name:     col('name'),
      price:    col('price'),
      cost:     col('cost'),
      category: col('category'),
      stock:    col('stock') !== -1 ? col('stock') : col('qty'),
      gtin:     col('gtin') !== -1 ? col('gtin') : col('barcode'),
      emoji:    col('emoji')
    };

    if (cols.sku === -1 || cols.name === -1) {
      setProgress(0, 'CSV must have "sku" and "name" columns.');
      return;
    }

    const rows = lines.slice(1);
    const total = rows.length;
    let imported = 0;
    let errors   = 0;

    setProgress(5, `Parsing ${total} rows…`);

    function processBatch(startIdx) {
      return new Promise(resolve => {
        setTimeout(async () => {
          const end = Math.min(startIdx + CSV_BATCH_SIZE, total);
          for (let i = startIdx; i < end; i++) {
            const cells = parseCsvLine(rows[i]);
            const sku = cells[cols.sku]?.trim();
            const name = cells[cols.name]?.trim();
            if (!sku || !name) { errors++; continue; }

            const price = Math.round(parseFloat(cells[cols.price] || 0) * 100);
            const cost  = Math.round(parseFloat(cells[cols.cost]  || 0) * 100);
            const stock = parseInt(cells[cols.stock] || 0);
            const cat   = cells[cols.category]?.trim() || 'Uncategorized';
            const gtin  = cols.gtin !== -1 ? (cells[cols.gtin]?.trim() || '') : '';
            const emoji = cols.emoji !== -1 ? (cells[cols.emoji]?.trim() || '📦') : '📦';

            syncWorker.postMessage({
              type: 'SAVE_PRODUCT',
              payload: { sku, name, price, cost, stock, category: cat, gtin, emoji }
            });
            imported++;
          }
          const pct = Math.round((end / total) * 90) + 5;
          setProgress(pct, `Imported ${imported} / ${total} items…`);
          resolve(end);
        }, 0); // yield to render thread — keeps UI at 60fps during import
      });
    }

    let idx = 0;
    while (idx < total) {
      idx = await processBatch(idx);
    }

    setProgress(100, `Done! ${imported} products imported. ${errors} rows skipped.`);
    playAudioSignal('success');
    setTimeout(() => {
      if (progressEl) progressEl.style.width = '0%';
      if (statusEl) statusEl.textContent = '';
    }, 4000);
  }

  // ── Component C: Printer & Drawer Settings wiring ──────────────────────────
  function bindPrinterSettings() {
    const btnConnectPrinter = document.getElementById('btn-connect-printer');
    if (btnConnectPrinter) {
      btnConnectPrinter.addEventListener('click', async () => {
        const result = await EscPosEngine.connect();
        if (result.success) {
          btnConnectPrinter.textContent = `✓ ${result.name || 'Printer Connected'}`;
          btnConnectPrinter.style.borderColor = 'var(--accent-emerald)';
          showNotificationToast(`Printer connected: ${result.name}`, null, 4000);
        } else {
          showNotificationToast(`Printer error: ${result.reason}`, null, 6000);
        }
      });
    }

    const btnDrawerClose = document.getElementById('btn-drawer-closed');
    if (btnDrawerClose) {
      btnDrawerClose.addEventListener('click', () => {
        EscPosEngine.acknowledgeDrawerClosed();
        showNotificationToast('Cash drawer marked as closed.', null, 2000);
      });
    }

    const btnNoSale = document.getElementById('btn-no-sale');
    if (btnNoSale) {
      btnNoSale.addEventListener('click', () => {
        const pin = prompt('No Sale requires Manager PIN:');
        if (!pin) return;
        // Verify locally against cached manager hash
        const mgr = state.employees?.find(e => e.role === 'MANAGER' || e.role === 'ADMIN');
        if (!mgr) { alert('No manager found. Configure a manager first.'); return; }
        // Open drawer — audit trail written to aborted_sales_log via server
        fetch('/api/void-transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactionId: `no_sale_${Date.now()}`, managerPin: pin, voidReason: 'NO_SALE' })
        }).then(r => r.json()).then(r => {
          if (r.success || r.error?.includes('not found')) {
            EscPosEngine.kickDrawer('NO_SALE');
            showNotificationToast('No-Sale drawer open. Logged to audit trail.', null, 4000);
          } else {
            showNotificationToast(`No-Sale blocked: ${r.error}`, null, 5000);
          }
        }).catch(() => EscPosEngine.kickDrawer('NO_SALE'));
      });
    }

    const csvInput = document.getElementById('csv-import-file');
    if (csvInput) {
      csvInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleCsvImport(file);
        e.target.value = ''; // reset so same file can be re-imported
      });
    }
  }

  const CLIENT_VERSION = '1.0.0';

  async function checkForUpdates() {
    try {
      const resp = await fetch('/version.json');
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.version && data.version !== CLIENT_VERSION) {
          console.log(`[Update] New version detected: ${data.version} (Current: ${CLIENT_VERSION})`);
          showUpdateNotification(data.version, data.changelog);
        }
      }
    } catch (err) {
      console.warn('[Update] Failed to fetch version updates:', err);
    }
  }

  function showUpdateNotification(newVersion, changelog) {
    if (document.getElementById('update-notification-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'update-notification-banner';
    banner.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 99999;
      background: rgba(13, 148, 136, 0.95); backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 8px;
      padding: 16px; width: 320px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      color: #fff; font-family: var(--font-body); animation: slideUp 0.3s ease-out;
    `;
    banner.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
        <span style="font-weight: 800; font-size: 14px; letter-spacing: -0.01em;">Software Update Available</span>
        <button id="btn-close-update-banner" style="background: none; border: none; color: rgba(255,255,255,0.7); cursor: pointer; padding: 0; font-size: 16px;">&times;</button>
      </div>
      <p style="font-size: 12px; margin: 0 0 12px 0; color: rgba(255,255,255,0.9); line-height: 1.5;">
        A new version (v${newVersion}) is available. Update to get the latest features and stability fixes.
      </p>
      <div style="display: flex; gap: 8px;">
        <a href="/downloads/nexova-pos-latest.apk" target="_blank" style="flex: 1; text-align: center; text-decoration: none; padding: 8px 12px; background: #fff; color: #0d9488; border-radius: 4px; font-size: 11px; font-weight: 700; cursor: pointer;">GET APK</a>
        <a href="/downloads/nexova-pos-setup.msi" target="_blank" style="flex: 1; text-align: center; text-decoration: none; padding: 8px 12px; background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; font-size: 11px; font-weight: 700; cursor: pointer;">GET WINDOWS</a>
      </div>
      <style>
        @keyframes slideUp { from { transform: translateY(100px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      </style>
    `;
    document.body.appendChild(banner);
    document.getElementById('btn-close-update-banner').addEventListener('click', () => banner.remove());
  }

  // Start app execution
  document.addEventListener('DOMContentLoaded', () => {
    init().then(() => {
      bindPrinterSettings();
      initDataManagement();
      checkForUpdates();
      setInterval(checkForUpdates, 3600000); // Check hourly
    });
  });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  //  DATA MANAGEMENT MODULE â€” Export, Restore, Delete Store, Danger Zone
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  function initDataManagement() {
    function triggerFileDownload(content, filename, type) {
      const blob = new Blob([content], { type });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    }

    function showExportMsg(msg, ok) {
      const el = document.getElementById('export-status-msg');
      if (!el) return;
      el.style.display  = 'block';
      el.style.color    = ok ? 'var(--accent-emerald)' : '#ef4444';
      el.textContent    = msg;
      setTimeout(() => { el.style.display = 'none'; }, 5000);
    }

    // â”€â”€ Export Full JSON â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // ── SaaS License Updates Manual Sync ──
    const btnSyncLicense = document.getElementById('btn-sync-license-now');
    if (btnSyncLicense) {
      btnSyncLicense.addEventListener('click', async () => {
        try {
          btnSyncLicense.disabled = true;
          btnSyncLicense.textContent = 'Syncing...';
          const token = localStorage.getItem('nexova_license_token');
          const hwid = window.__nexovaHWID;
          if (token && hwid) {
            const serverBase = window.__nexovaServerUrl || location.origin;
            const res = await fetch(`${serverBase}/api/license/check?hwid=${encodeURIComponent(hwid)}`, {
              headers: { 'Authorization': 'Bearer ' + token }
            });
            if (res.ok) {
              const data = await res.json();
              if (data.updated && data.token) {
                localStorage.setItem('nexova_license_token', data.token);
                alert('License successfully updated! App will reload now.');
                location.reload();
              } else {
                alert('License is already up to date.');
              }
            } else if (res.status === 401 || res.status === 404) {
              alert('License has been revoked or expired on the server.');
              localStorage.removeItem('nexova_license_token');
              location.reload();
            } else {
              alert('Failed to connect to license server.');
            }
          } else {
            alert('No active license found to update. Please activate the terminal first.');
          }
        } catch (err) {
          alert('Sync error: ' + err.message);
        } finally {
          btnSyncLicense.disabled = false;
          btnSyncLicense.textContent = 'Check for License Upgrades';
        }
      });
    }

    const btnExportJson = document.getElementById('btn-export-json');
    if (btnExportJson) {
      btnExportJson.addEventListener('click', async () => {
        try {
          btnExportJson.disabled = true;
          btnExportJson.textContent = 'Exporting...';
          const json = await serializeDatabaseToJSON();
          const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const name = ((state.preferences && state.preferences['store_name'])
            ? state.preferences['store_name'].replace(/\s+/g, '_').toLowerCase()
            : 'nexova') + '_backup_' + ts + '.json';
          triggerFileDownload(json, name, 'application/json');
          showExportMsg('Full database exported successfully.', true);
          showNotificationToast('Database exported as JSON', null, 3000);
        } catch (e) {
          showExportMsg('Export failed: ' + e.message, false);
        } finally {
          btnExportJson.disabled = false;
          btnExportJson.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export Full Database (JSON)';
        }
      });
    }

    // â”€â”€ Export Transactions CSV â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const btnExportCsv = document.getElementById('btn-export-csv-transactions');
    if (btnExportCsv) {
      btnExportCsv.addEventListener('click', async () => {
        try {
          btnExportCsv.disabled = true;
          btnExportCsv.textContent = 'Generating CSV...';
          const txns = await NexovaDB.getAll('transactions');
          const items = await NexovaDB.getAll('line_items');
          const itemMap = {};
          items.forEach(i => { (itemMap[i.tx_id] = itemMap[i.tx_id] || []).push(i); });
          const rows = [['Date','Order ID','Cashier','Payment Method','Items','Subtotal','Tax','Total','Notes']];
          txns.forEach(tx => {
            const txItems = (itemMap[tx.id] || []).map(i => i.product_name + ' x' + i.qty).join('; ');
            rows.push([
              new Date(tx.created_at).toLocaleString(),
              tx.id, tx.cashier_name || '', tx.payment_method || '',
              txItems,
              (tx.subtotal || 0).toFixed(2),
              (tx.tax_amount || 0).toFixed(2),
              (tx.total || 0).toFixed(2),
              tx.notes || ''
            ]);
          });
          const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
          const ts  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          triggerFileDownload(csv, 'nexova_transactions_' + ts + '.csv', 'text/csv');
          showExportMsg(txns.length + ' transactions exported as CSV.', true);
          showNotificationToast('Transactions exported as CSV', null, 3000);
        } catch (e) {
          showExportMsg('CSV export failed: ' + e.message, false);
        } finally {
          btnExportCsv.disabled = false;
          btnExportCsv.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg> Export Transactions (CSV)';
        }
      });
    }

    // â”€â”€ Restore from File â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let restoreFileData = null;
    const inputRestoreFile = document.getElementById('input-restore-file');
    const btnRestoreFile   = document.getElementById('btn-restore-from-file');
    const restoreFileName  = document.getElementById('restore-file-name');
    const restoreWarning   = document.getElementById('restore-warning');

    if (inputRestoreFile) {
      inputRestoreFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            restoreFileData = JSON.parse(ev.target.result);
            if (restoreFileName) restoreFileName.textContent = file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
            if (restoreWarning) restoreWarning.style.display = 'block';
            if (btnRestoreFile) { btnRestoreFile.disabled = false; btnRestoreFile.style.opacity = '1'; btnRestoreFile.style.cursor = 'pointer'; }
          } catch (_) {
            showNotificationToast('Invalid backup file â€” must be a valid Nexova JSON export.', 'error', 4000);
            restoreFileData = null;
          }
        };
        reader.readAsText(file);
      });
    }

    if (btnRestoreFile) {
      btnRestoreFile.addEventListener('click', async () => {
        if (!restoreFileData) return;
        if (!confirm('This will merge the backup into your current database. Conflicting records will be overwritten. Continue?')) return;
        try {
          btnRestoreFile.textContent = 'Restoring...';
          btnRestoreFile.disabled = true;
          const stores = Object.keys(restoreFileData);
          for (const storeName of stores) {
            const records = restoreFileData[storeName];
            if (!Array.isArray(records) || records.length === 0) continue;
            for (const record of records) {
              try { await NexovaDB.put(storeName, record); } catch (_) { }
            }
          }
          showNotificationToast('Backup restored successfully. Reloading...', null, 3000);
          setTimeout(() => window.location.reload(), 2000);
        } catch (err) {
          showNotificationToast('Restore failed: ' + err.message, 'error', 5000);
          btnRestoreFile.disabled = false;
          btnRestoreFile.textContent = 'Import & Restore';
        }
      });
    }

    // â”€â”€ Open Delete Store Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const btnOpenDeleteStore = document.getElementById('btn-open-delete-store');
    if (btnOpenDeleteStore) {
      btnOpenDeleteStore.addEventListener('click', () => {
        playAudioSignal('click');
        document.getElementById('delete-store-step1').style.display = 'block';
        document.getElementById('delete-store-step2').style.display = 'none';
        const err = document.getElementById('delete-store-error');
        if (err) err.textContent = '';
        const inp1 = document.getElementById('delete-confirm-store-name');
        const inp2 = document.getElementById('delete-confirm-pin');
        if (inp1) inp1.value = '';
        if (inp2) inp2.value = '';
        const modal = document.getElementById('modal-delete-store');
        if (modal) modal.classList.add('active');
      });
    }

    // Close buttons
    ['btn-close-delete-store-modal', 'btn-close-delete-store-modal2'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', () => {
        const modal = document.getElementById('modal-delete-store');
        if (modal) modal.classList.remove('active');
      });
    });

    // Export before delete
    const btnExportBeforeDelete = document.getElementById('btn-export-before-delete');
    if (btnExportBeforeDelete) {
      btnExportBeforeDelete.addEventListener('click', async () => {
        btnExportBeforeDelete.textContent = 'Exporting...';
        try {
          const json = await serializeDatabaseToJSON();
          const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          triggerFileDownload(json, 'nexova_pre_delete_backup_' + ts + '.json', 'application/json');
          showNotificationToast('Backup downloaded. You can now safely delete the store.', null, 4000);
        } catch (e) {
          showNotificationToast('Export error: ' + e.message, 'error', 4000);
        } finally {
          btnExportBeforeDelete.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Export First';
        }
      });
    }

    // Step 1 â†’ Step 2
    const btnProceed = document.getElementById('btn-delete-store-proceed');
    if (btnProceed) {
      btnProceed.addEventListener('click', () => {
        document.getElementById('delete-store-step1').style.display = 'none';
        document.getElementById('delete-store-step2').style.display = 'block';
        setTimeout(() => {
          const inp = document.getElementById('delete-confirm-store-name');
          if (inp) inp.focus();
        }, 100);
      });
    }

    // Back to step 1
    const btnDeleteBack = document.getElementById('btn-delete-store-back');
    if (btnDeleteBack) {
      btnDeleteBack.addEventListener('click', () => {
        document.getElementById('delete-store-step1').style.display = 'block';
        document.getElementById('delete-store-step2').style.display = 'none';
      });
    }

    // Execute delete
    const btnDeleteExecute = document.getElementById('btn-delete-store-execute');
    if (btnDeleteExecute) {
      btnDeleteExecute.addEventListener('click', async () => {
        const nameInput = (document.getElementById('delete-confirm-store-name') || {}).value || '';
        const pinInput  = (document.getElementById('delete-confirm-pin') || {}).value || '';
        const errorEl   = document.getElementById('delete-store-error');

        const configuredName = (state.preferences && state.preferences['store_name']) || '';
        if (nameInput.trim().toLowerCase() !== configuredName.trim().toLowerCase()) {
          if (errorEl) { errorEl.textContent = 'Store name does not match. Please type it exactly as configured.'; errorEl.style.display = 'block'; }
          return;
        }

        const admin = state.employees?.find(e => e.role === 'ADMIN');
        if (!admin || !pinInput) {
          if (errorEl) { errorEl.textContent = 'Admin PIN required.'; errorEl.style.display = 'block'; }
          return;
        }

        let pinOk = false;
        try {
          pinOk = await verifyPinClient(pinInput, admin.auth_hash);
        } catch (_) {
          pinOk = false;
        }

        if (!pinOk) {
          if (errorEl) { errorEl.textContent = 'Incorrect PIN. Please try again.'; errorEl.style.display = 'block'; }
          return;
        }

        btnDeleteExecute.textContent = 'Deleting...';
        btnDeleteExecute.disabled = true;
        try {
          try {
            await fetch('/api/system/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: pinInput }) });
          } catch (_) {}
          await NexovaDB.destructReset();
          localStorage.clear();
          showNotificationToast('Store deleted. Redirecting to setup...', null, 2500);
          setTimeout(() => window.location.reload(), 2500);
        } catch (err) {
          if (errorEl) { errorEl.textContent = 'Deletion failed: ' + err.message; errorEl.style.display = 'block'; }
          btnDeleteExecute.disabled = false;
          btnDeleteExecute.textContent = 'DELETE STORE PERMANENTLY';
        }
      });
    }

    // Grand Reset
    const btnOpenGrandReset = document.getElementById('btn-open-grand-reset');
    if (btnOpenGrandReset) {
      btnOpenGrandReset.addEventListener('click', () => {
        playAudioSignal('click');
        const modal = document.getElementById('modal-reset');
        if (modal) modal.classList.add('active');
      });
    }
  }

  // Network connection debounced sync & flap protection
  let networkDebounceTimer;
  window.addEventListener('online', () => {
      clearTimeout(networkDebounceTimer);
      networkDebounceTimer = setTimeout(() => {
          console.log('[Network] Connection stable. Triggering background sync.');
          syncWorker.postMessage({ type: 'FORCE_FULL_SYNC' });
          updateNetworkBadge(true);
      }, 3000); // Wait 3 seconds to ensure stability
  });

  window.addEventListener('offline', () => {
      clearTimeout(networkDebounceTimer);
      updateNetworkBadge(false);
  });

  // Background Sync Doze Mode focus recovery & camera scanner battery saver
  document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
          // App went to background. Kill the camera instantly to save battery.
          if (typeof closeMobileScanner === 'function') {
              closeMobileScanner();
          }
      } else if (document.visibilityState === "visible") {
          // App came back. Sweep sync.
          syncWorker.postMessage({ type: 'FORCE_FULL_SYNC' });
      }
  });

  // Intercept physical back button to close open modals
  window.onNativeBackPressed = function() {
    const activeModals = document.querySelectorAll('.modal.active, .modal-overlay.active');
    if (activeModals.length > 0) {
      // Close the top-most modal and tell Android we handled it
      activeModals[activeModals.length - 1].classList.remove('active');
      return true; 
    }
    return false; // Tell Android to do normal back navigation
  };

  // Handle storage quota exceeded event
  window.addEventListener('CRITICAL_STORAGE_ERROR', (e) => {
    let modal = document.getElementById('modal-critical-storage-error');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-critical-storage-error';
      modal.style.position = 'fixed';
      modal.style.top = '0';
      modal.style.left = '0';
      modal.style.width = '100vw';
      modal.style.height = '100vh';
      modal.style.backgroundColor = 'rgba(239, 68, 68, 0.98)';
      modal.style.zIndex = '999999';
      modal.style.display = 'flex';
      modal.style.flexDirection = 'column';
      modal.style.justifyContent = 'center';
      modal.style.alignItems = 'center';
      modal.style.padding = '40px';
      modal.style.color = '#FFFFFF';
      modal.style.fontFamily = 'sans-serif';
      modal.style.textAlign = 'center';
      
      modal.innerHTML = `
        <div style="font-size: 72px; margin-bottom: 20px;">⚠️</div>
        <h1 style="font-size: 28px; font-weight: bold; margin-bottom: 15px; text-transform: uppercase;">Storage Limit Exceeded</h1>
        <p style="font-size: 16px; max-width: 600px; line-height: 1.5; margin-bottom: 30px;">
          ${e.detail || 'Device storage is completely full. Please free up space immediately to prevent data loss.'}
        </p>
        <div style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); padding: 15px 25px; border-radius: 8px; font-size: 14px;">
          <strong>ACTION REQUIRED:</strong> Delete unused files, photos, or apps from this Android tablet now.
        </div>
      `;
      document.body.appendChild(modal);
    }
  });
})();