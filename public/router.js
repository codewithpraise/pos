// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - SINGLE AUTHORITATIVE SCREEN ROUTER
// Permanent Mounted Shell Architecture: All 18 screen containers remain mounted
// in the DOM. Router atomically controls visibility (hidden, aria-hidden, inert,
// display: none !important vs display: inherit) to guarantee 100% single-view isolation.
// ============================================================================

(function(global) {
  'use strict';

  if (typeof global.requestAnimationFrame !== 'function') {
    global.requestAnimationFrame = function(cb) {
      return setTimeout(cb, 0);
    };
  }

  global.routeGeneration = global.routeGeneration || 0;

  // Failure-Isolated DOM Render Target Helper
  function requireRenderTarget(screenId, targetId) {
    if (!targetId) return null;
    const el = document.getElementById(targetId);
    if (!el) {
      console.warn(`[RenderContractViolation] Screen '${screenId}' required target '#${targetId}' not found in DOM.`);
      return null;
    }
    return el;
  }
  global.requireRenderTarget = requireRenderTarget;

  const SCREEN_REGISTRY = Object.freeze({
    'dashboard': {
      viewId: 'view-dashboard',
      title: 'Business Operations Hub',
      renderer: 'renderDashboardScreen',
      renderTargets: ['dash-tx-count', 'dash-cash-till', 'dash-timeline-list']
    },
    'checkout': {
      viewId: 'view-checkout',
      title: 'Checkout Terminal',
      renderer: 'renderCheckoutScreen',
      renderTargets: ['cart-items-tbody', 'txt-total', 'checkout-quick-grid']
    },
    'catalog': {
      viewId: 'view-catalog',
      title: 'Product Catalog',
      renderer: 'renderQuickCatalog',
      renderTargets: ['mobile-quick-grid']
    },
    'catalog-manager': {
      viewId: 'view-catalog-manager',
      title: 'Inventory Ledger',
      renderer: 'renderCatalogScreen',
      renderTargets: ['catalog-virtual-container']
    },
    'deals': {
      viewId: 'view-deals',
      title: 'Deals & Bundles',
      renderer: 'renderDealsScreen',
      renderTargets: ['deals-list-container']
    },
    'customer-buyback': {
      viewId: 'view-customer-buyback',
      title: 'Device Buy-In & Trade-In',
      renderer: 'renderCustomerBuybackScreen',
      renderTargets: ['buyback-records-list']
    },
    'history': {
      viewId: 'view-history',
      title: 'Transaction History',
      renderer: 'renderHistoryScreen',
      renderTargets: ['history-transactions-list']
    },
    'customers': {
      viewId: 'view-customers',
      title: 'Customer Directory',
      renderer: 'renderCustomersScreen',
      renderTargets: ['customers-table-tbody']
    },
    'analytics': {
      viewId: 'view-analytics',
      title: 'Analytics Dashboard',
      renderer: 'renderAnalyticsScreen',
      renderTargets: ['analytics-revenue-value']
    },
    'suppliers': {
      viewId: 'view-suppliers',
      title: 'Suppliers & Ledger',
      renderer: 'renderSuppliersScreen',
      renderTargets: ['supplier-list-container']
    },
    'staff': {
      viewId: 'view-staff',
      title: 'Staff Roster',
      renderer: 'renderStaffScreen',
      renderTargets: ['staff-table-tbody']
    },
    'credit-book': {
      viewId: 'view-credit-book',
      title: 'Credit Book (Khata)',
      renderer: 'renderCreditBookScreen',
      renderTargets: ['credit-customer-list-container']
    },
    'settings': {
      viewId: 'view-settings',
      title: 'Shop Settings',
      renderer: 'renderSettingsScreen',
      renderTargets: ['setting-store-name']
    },
    'logs': {
      viewId: 'view-logs',
      title: 'System & Sync Logs',
      renderer: 'renderSyncLogsFeed',
      renderTargets: ['sync-logs-feed-container']
    },
    'subscription': {
      viewId: 'view-subscription',
      title: 'Subscription & Billing',
      renderer: 'renderSubscriptionScreen',
      renderTargets: ['billing-history-tbody']
    },
    'kds': {
      viewId: 'view-kds',
      title: 'Kitchen Display (KDS)',
      renderer: 'renderKdsScreen',
      renderTargets: ['kds-ticket-board']
    },
    'petty-cash': {
      viewId: 'view-petty-cash',
      title: 'Petty Cash & Float Ledger',
      renderer: 'renderPettyCashScreen',
      renderTargets: ['petty-cash-tbody']
    },
    'attendance': {
      viewId: 'view-attendance',
      title: 'Staff Time Clock & Payroll',
      renderer: 'renderAttendanceScreen',
      renderTargets: ['attendance-tbody']
    },
    'label-designer': {
      viewId: 'view-label-designer',
      title: 'Barcode Label & Tag Studio',
      renderer: 'renderLabelDesignerScreen',
      renderTargets: ['label-designer-preview']
    },
    'inventory-ai': {
      viewId: 'view-inventory-ai',
      title: 'Stock Velocity & Demand Forecast',
      renderer: 'renderInventoryAiScreen',
      renderTargets: ['inventory-ai-cards']
    },
    'loyalty': {
      viewId: 'view-loyalty',
      title: 'VIP Loyalty & Cashback Wallet',
      renderer: 'renderLoyaltyScreen',
      renderTargets: ['loyalty-tiers-grid']
    },
    'marketing': {
      viewId: 'view-marketing',
      title: 'Marketing Broadcast Studio',
      renderer: 'renderMarketingScreen',
      renderTargets: ['marketing-templates-grid']
    },
    'stock-transfer': {
      viewId: 'view-stock-transfer',
      title: 'Inter-Branch Stock Transfer',
      renderer: 'renderStockTransferScreen',
      renderTargets: ['stock-transfer-list']
    },
    'fbr-fiscal': {
      viewId: 'view-fbr-fiscal',
      title: 'FBR Fiscal Integration',
      renderer: 'renderFbrFiscalScreen',
      renderTargets: ['fbr-status-val']
    },
    'multi-store': {
      viewId: 'view-multi-store',
      title: 'Multi-Store HQ',
      renderer: 'renderMultiStoreScreen',
      renderTargets: ['multi-store-select']
    },
    'data-portability': {
      viewId: 'view-data-portability',
      title: 'Data Portability',
      renderer: 'renderDataPortabilityScreen',
      renderTargets: ['btn-export-json']
    },
    'platform-admin': {
      viewId: 'view-platform-admin',
      title: 'Platform Admin',
      renderer: 'renderPlatformAdminScreen',
      renderTargets: ['admin-claims-queue-tbody', 'admin-active-subscribers-tbody']
    },
    'apps-download': {
      viewId: 'view-apps-download',
      title: 'Download Apps',
      renderer: 'renderAppsDownloadScreen',
      renderTargets: ['btn-download-apk']
    }
  });

  const SCREEN_MAP = {};
  Object.keys(SCREEN_REGISTRY).forEach(key => {
    SCREEN_MAP[key] = SCREEN_REGISTRY[key].viewId;
  });

  class ValenixiaRouter {
    constructor() {
      this.currentScreen = null;
      this.rootContainer = null;
      this.initialized = false;
      this.SCREEN_REGISTRY = SCREEN_REGISTRY;
    }

    init() {
      if (this.initialized) return;

      const pane = document.querySelector('.pos-content-pane');
      if (!pane) {
        console.warn('[Router] .pos-content-pane not found yet; deferring router init.');
        return;
      }

      this.rootContainer = pane;
      this.rootContainer.id = 'app-screen-root';
      this.initialized = true;

      // Register popstate listener for browser history back/forward navigation
      window.addEventListener('popstate', () => {
        const route = this.resolveRouteFromLocation();
        this.navigateTo(route, { push: false });
      });

      console.log(`[Router] Initialized authoritative single-screen router with permanent mounted shells (${Object.keys(SCREEN_REGISTRY).length} screens).`);
    }

    resolveRouteFromLocation() {
      const hash = (window.location.hash || '').replace('#', '').replace('/', '');
      if (hash && SCREEN_MAP[hash]) return hash;
      const path = (window.location.pathname || '').replace('/', '');
      if (path && SCREEN_MAP[path]) return path;
      return 'checkout';
    }

    navigateTo(screenId, options = {}) {
      const { push = false } = options;
      if (!screenId) screenId = 'checkout';

      if (!this.initialized) {
        this.init();
      }

      const cleanName = screenId.replace('view-', '');
      
      // Domain-specific screen isolation (KDS is only accessible in hospitality/restaurant modes)
      if (cleanName === 'kds' || cleanName === 'fullscreen-kds') {
        const isSupported = typeof global.isKdsSupported === 'function' ? global.isKdsSupported() : (function() {
          const mode = (global.state && global.state.preferences && (global.state.preferences.shop_mode || global.state.preferences.store_type)) || (typeof localStorage !== 'undefined' && localStorage.getItem('valenixia_shop_mode')) || 'simple-retail';
          return mode === 'food-restaurant' || mode === 'bakery-cafe' || mode === 'restaurant' || mode === 'cafe';
        })();
        if (!isSupported) {
          if (typeof global.showNotificationToast === 'function') {
            global.showNotificationToast('Kitchen Display System (KDS) is only available for Restaurant & Café store modes.', 'info', 4000);
          }
          return this.navigateTo('checkout', { push: false });
        }
      }

      if (cleanName === 'customer-buyback') {
        const isSupported = (global.ValenixiaStoreModes && typeof global.ValenixiaStoreModes.isBuybackSupported === 'function')
          ? global.ValenixiaStoreModes.isBuybackSupported()
          : (typeof global.isBuybackSupported === 'function' ? global.isBuybackSupported() : false);
        if (!isSupported) {
          if (typeof global.showNotificationToast === 'function') {
            global.showNotificationToast('Customer Trade-In & Buyback is only available for Mobile & Jewellery store modes.', 'info', 4000);
          }
          return this.navigateTo('checkout', { push: false });
        }
      }

      // Master Platform Admin Security Gate Check
      if (cleanName === 'platform-admin') {
        if (typeof global.isMasterAdminAuthenticated === 'function' && !global.isMasterAdminAuthenticated()) {
          if (typeof global.requestMasterAdminAccess === 'function') {
            global.requestMasterAdminAccess();
          }
          return false;
        }
      }

      // Feature Tier & Freemium Access Gate
      if (cleanName !== 'checkout' && cleanName !== 'settings' && cleanName !== 'subscription' && cleanName !== 'apps-download' && cleanName !== 'platform-admin') {
        if (typeof global.can === 'function' && !global.can(cleanName)) {
          if (typeof global.showUpgradeModal === 'function') {
            global.showUpgradeModal(cleanName);
          } else if (typeof global.showPaywallModal === 'function') {
            global.showPaywallModal(cleanName);
          }
          return false;
        }
      }

      const targetId = screenId.startsWith('view-') ? screenId : (SCREEN_MAP[cleanName] || 'view-' + cleanName);
      
      const pane = this.rootContainer || document.querySelector('.pos-content-pane');
      if (!pane) {
        console.error('[Router] Cannot navigate: .pos-content-pane missing!');
        return false;
      }

      const targetView = document.getElementById(targetId);
      if (!targetView) {
        console.error(`[Router] Cannot navigate: target view '${targetId}' missing from DOM!`);
        return false;
      }

      // 1. Increment route generation token to invalidate stale async renders
      global.routeGeneration = (global.routeGeneration || 0) + 1;

      // 2. ATOMIC VISIBILITY TRANSITION across all mounted .content-view elements
      const allViews = Array.from(pane.querySelectorAll('.content-view'));
      allViews.forEach(view => {
        if (view.id === targetId) {
          view.hidden = false;
          view.removeAttribute('hidden');
          view.setAttribute('aria-hidden', 'false');
          view.inert = false;
          view.style.removeProperty('display');
          view.classList.add('active');
        } else {
          view.hidden = true;
          view.setAttribute('hidden', 'true');
          view.setAttribute('aria-hidden', 'true');
          view.inert = true;
          view.style.setProperty('display', 'none', 'important');
          view.classList.remove('active');
        }
      });

      this.currentScreen = cleanName;

      if (global.ValenixiaOverflowMenu && typeof global.ValenixiaOverflowMenu.close === 'function') {
        global.ValenixiaOverflowMenu.close();
      }

      if (global.state) {
        global.state.activeScreen = cleanName;
      }

      // 3. Update Navigation Bar UI & Active Buttons & Center Active Tab in Mobile Viewport
      let activeNavElement = null;
      document.querySelectorAll('.nav-item, .sidebar-nav .nav-item, .pos-bottom-nav .nav-btn, .pos-bottom-nav .nav-item').forEach(item => {
        const itemScreen = item.getAttribute('data-screen');
        const isActive = (itemScreen === cleanName || item.id === 'nav-' + cleanName);
        item.classList.toggle('active', isActive);
        if (isActive && !activeNavElement) {
          activeNavElement = item;
        }
      });
      if (activeNavElement) {
        try {
          const sidebar = document.querySelector('.pos-sidebar');
          const sidebarNav = document.querySelector('.sidebar-nav');
          const container = (sidebarNav && sidebarNav.scrollWidth > (sidebar ? sidebar.clientWidth : 0)) ? sidebarNav : sidebar;
          if (container && typeof container.scrollTo === 'function') {
            const containerWidth = container.clientWidth || window.innerWidth;
            const targetLeft = activeNavElement.offsetLeft - (containerWidth / 2) + (activeNavElement.clientWidth / 2);
            container.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
          } else {
            activeNavElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          }
        } catch (_) {}
      }

      // 4. Update Top Navigation Bar Title
      const regMeta = SCREEN_REGISTRY[cleanName];
      const formattedTitle = regMeta ? regMeta.title : cleanName.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
      const activeViewTitleEl = document.getElementById('active-view-title');
      if (activeViewTitleEl) activeViewTitleEl.textContent = formattedTitle;

      if (push && window.history && window.history.pushState) {
        try {
          window.history.pushState({ screen: cleanName }, '', '#' + cleanName);
        } catch (_) {}
      }

      // 5. Execute Single Visible View Invariant Check
      this.assertSingleVisibleView(cleanName);

      // 6. Trigger deferred screen render through real handlers or scheduleScreenRender
      if (global.scheduleScreenRender) {
        global.scheduleScreenRender(cleanName);
      } else if (global.__realHandlers && typeof global.__realHandlers.switchActiveScreen === 'function') {
        try {
          global.__realHandlers.switchActiveScreen(cleanName);
        } catch (_) {}
      }

      return true;
    }

    assertSingleVisibleView(expectedScreen) {
      const pane = this.rootContainer || document.querySelector('.pos-content-pane');
      if (!pane) return true;

      const views = Array.from(pane.querySelectorAll('.content-view'));
      const activeViews = views.filter(v => v.classList.contains('active') && !v.hidden);

      if (activeViews.length !== 1) {
        const err = `[Router Invariant Violation] Expected exactly 1 active view, found ${activeViews.length}`;
        console.error(err, activeViews);
        if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test') {
          throw new Error(err);
        }
      }

      if (expectedScreen) {
        const targetId = 'view-' + expectedScreen.replace('view-', '');
        const activeId = activeViews[0]?.id;
        if (activeId !== targetId) {
          console.error(`[Router Invariant Mismatch] Expected active view '${targetId}', but found '${activeId}'`);
        }
      }

      return true;
    }

    getRenderedGeometry() {
      const pane = this.rootContainer || document.querySelector('.pos-content-pane');
      if (!pane) return [];
      const views = Array.from(pane.querySelectorAll('.content-view'));
      return views.map(child => {
        const rect = child.getBoundingClientRect();
        const mainEl = child.querySelector('.screen-main') || child;
        const style = window.getComputedStyle(mainEl);
        return {
          id: child.id,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          visible: !child.hidden && child.style.display !== 'none',
          scrollHeight: mainEl.scrollHeight,
          clientHeight: mainEl.clientHeight,
          scrollTop: mainEl.scrollTop,
          overflowY: style.overflowY
        };
      });
    }
  }

  const router = new ValenixiaRouter();

  // Export single authoritative router API
  global.ValenixiaRouter = router;
  global.SCREEN_REGISTRY = SCREEN_REGISTRY;
  global.navigateTo = function(screenId, opts) {
    return router.navigateTo(screenId, opts);
  };
  global.ValenixiaRouter = router;
  global.switchActiveScreen = function(screenId) {
    return router.navigateTo(screenId, { push: false });
  };
  global.assertSingleVisibleView = function(screenId) {
    return router.assertSingleVisibleView(screenId);
  };

  // 100% READ-ONLY Screen Integrity Diagnostic (ZERO DOM mutations or route changes)
  global.checkScreenIntegrity = function() {
    const registryKeys = Object.keys(SCREEN_REGISTRY);
    const report = {
      totalRegistered: registryKeys.length,
      presentInDOM: 0,
      missingInDOM: [],
      duplicateIDs: [],
      activeView: router.currentScreen,
      ok: true
    };

    const idCounts = {};
    document.querySelectorAll('.content-view').forEach(el => {
      idCounts[el.id] = (idCounts[el.id] || 0) + 1;
    });

    Object.keys(idCounts).forEach(id => {
      if (idCounts[id] > 1) {
        report.duplicateIDs.push({ id: id, count: idCounts[id] });
      }
    });

    registryKeys.forEach(key => {
      const viewId = SCREEN_REGISTRY[key].viewId;
      const el = document.getElementById(viewId);
      if (el) {
        report.presentInDOM++;
      } else {
        report.missingInDOM.push(viewId);
      }
    });

    report.ok = (report.presentInDOM === registryKeys.length) && (report.duplicateIDs.length === 0);
    return report;
  };

  // Automated Real Layout Metrics Diagnostic Exposer
  global.__VALENIXIA_LAYOUT_DIAGNOSTICS__ = function() {
    const integrity = global.checkScreenIntegrity();
    const activeViewId = 'view-' + (router.currentScreen || 'checkout');
    const activeEl = document.getElementById(activeViewId);
    const scrollOwner = activeEl ? (activeEl.querySelector('.screen-main') || activeEl) : null;
    const computedStyle = scrollOwner ? window.getComputedStyle(scrollOwner) : null;

    return {
      activeViewId: activeViewId,
      scrollOwnerSelector: scrollOwner ? (scrollOwner === activeEl ? '#' + activeViewId : '#' + activeViewId + ' .screen-main') : null,
      scrollHeight: scrollOwner ? scrollOwner.scrollHeight : 0,
      clientHeight: scrollOwner ? scrollOwner.clientHeight : 0,
      scrollTop: scrollOwner ? scrollOwner.scrollTop : 0,
      overflowY: computedStyle ? computedStyle.overflowY : 'unknown',
      integrity: integrity,
      geometry: router.getRenderedGeometry()
    };
  };

  global.__VALENIXIA_BOOT__ = Object.freeze({
    version: '2.4.5',
    fingerprint: 'v2.4.5-layout-strict-connectivity-ok',
    timestamp: Date.now()
  });

  document.addEventListener('DOMContentLoaded', () => {
    router.init();
    const initialRoute = router.resolveRouteFromLocation();
    router.navigateTo(initialRoute, { push: false });
  });

})(typeof window !== 'undefined' ? window : global);
