// ============================================================================
// VALENIXIA FREEMIUM ENGINE — Tier System, Feature Gates, Upgrade Modals
// Version: 1.0.0
// All plans are FREE during beta — limits enforced so the system is tested.
// Flip window.__valenixiaPlan to a paid tier to unlock features.
// ============================================================================
"use strict";
console.log('%c[VALENIXIA-DIAG-FREEMIUM] Freemium Engine v1.0.5 Initialized at ' + new Date().toISOString() + ' | SubStartTS: ' + localStorage.getItem('valenixia_subscription_start_time'), 'color:#3b82f6;font-weight:bold;');
(function() {

  let currentSession = null;
  const loadTime = Date.now();
  Object.defineProperty(window, '__vxSession', {
    get: () => currentSession,
    set: (val) => {
      const secondsSinceLoad = (Date.now() - loadTime) / 1000;
      if (secondsSinceLoad > 300 && currentSession && val && val.tier !== currentSession.tier && !val.verifiedByServer) {
        console.warn('[Security] Unauthorized tier modification blocked.');
        return;
      }
      currentSession = val ? Object.freeze(val) : null;
    },
    configurable: false
  });

// ── Plan Definitions ─────────────────────────────────────────────────────────
const PLANS = {
  FREE:       "free",
  STARTER:    "starter",
  GROWTH:     "growth",
  PRO:        "pro",
  ENTERPRISE: "enterprise"
};

const PLAN_LIMITS = {
  [PLANS.FREE]: {
    displayName: "Valenixia Free Basic",
    monthlyPKR: 0, annualPKR: 0, lifetimePKR: null,
    devices: 1, branches: 1, transactionsPerMonth: Infinity, products: 25, customers: Infinity, employees: 1,
    transactionHistoryDays: Infinity, receiptBranding: "valenixia",
    backup: "manual", fbrCompliance: true, multiDeviceSync: false, apiAccess: false,
    analytics: "basic", importLimit: Infinity, support: "community"
  },
  [PLANS.STARTER]: {
    displayName: "Valenixia Starter",
    monthlyPKR: 3499, lifetimePKR: 79000,
    devices: 1, branches: 1, transactionsPerMonth: Infinity, products: Infinity, customers: Infinity, employees: 5,
    transactionHistoryDays: Infinity, receiptBranding: "custom",
    backup: "manual", fbrCompliance: true, multiDeviceSync: false, apiAccess: false,
    analytics: "basic", importLimit: Infinity, support: "whatsapp"
  },
  [PLANS.GROWTH]: {
    displayName: "Valenixia Pro",
    monthlyPKR: 6999, annualPKR: 69999, lifetimePKR: 149000,
    devices: 2, branches: 1, transactionsPerMonth: Infinity, products: Infinity, customers: Infinity, employees: 20,
    transactionHistoryDays: Infinity, receiptBranding: "custom",
    backup: "auto_daily", fbrCompliance: true, multiDeviceSync: true, apiAccess: false,
    analytics: "advanced", importLimit: Infinity, support: "priority"
  },
  [PLANS.PRO]: {
    displayName: "Valenixia Pro",
    monthlyPKR: 6999, lifetimePKR: 149000,
    devices: 2, branches: 1, transactionsPerMonth: Infinity, products: Infinity, customers: Infinity, employees: 50,
    transactionHistoryDays: Infinity, receiptBranding: "white_label",
    backup: "auto_daily", fbrCompliance: true, multiDeviceSync: true, apiAccess: true,
    analytics: "advanced", importLimit: Infinity, support: "phone"
  },
  [PLANS.ENTERPRISE]: {
    displayName: "Valenixia Enterprise",
    monthlyPKR: 11999, lifetimePKR: 249000,
    devices: 3, branches: 2, transactionsPerMonth: Infinity, products: Infinity, customers: Infinity, employees: Infinity,
    transactionHistoryDays: Infinity, receiptBranding: "white_label",
    backup: "auto_realtime", fbrCompliance: true, multiDeviceSync: true, apiAccess: true,
    analytics: "full", importLimit: Infinity, support: "dedicated"
  }
};

const ADDONS = [
  { id: "extra_device",  name: "Extra Terminal (1st)",     pricePKR: 1200,  period: "/month" },
  { id: "extra_device_vol", name: "Extra Terminal (2-5)",   pricePKR: 1000,  period: "/month" },
  { id: "extra_branch",  name: "Extra Branch (incl 2 term)", pricePKR: 3500, period: "/month" },
  { id: "setup_onsite",  name: "On-site Setup",            pricePKR: 15000, period: " one-time" }
];

const TIER_TO_PLAN = {
  TRIAL: "growth", STANDARD: "starter", STARTER: "starter",
  GROWTH: "growth", PRO: "pro", ENTERPRISE: "enterprise"
};

// ── Active Tier Determination ────────────────────────────────────────────────
const VALID_TIERS = ['FREE', 'STARTER', 'GROWTH', 'PRO', 'ENTERPRISE'];

function getActiveTier() {
  // Priority 1: Use dynamically synced online tier if available
  if (window.__valenixiaTier && VALID_TIERS.includes(window.__valenixiaTier)) {
    window.__valenixiaPlan = PLANS[window.__valenixiaTier] || PLANS.FREE;
    return window.__valenixiaTier;
  }

  // Priority 2: Use the server-verified license token payload
  if (window.__valenixiaLicensePayload && window.__valenixiaLicensePayload.tier) {
    const tokenTier = String(window.__valenixiaLicensePayload.tier).toUpperCase();
    if (VALID_TIERS.includes(tokenTier)) {
      window.__valenixiaTier = tokenTier;
      window.__valenixiaPlan = PLANS[tokenTier] || PLANS.FREE;
      return tokenTier;
    }
  }

  // Priority 3: Fallback to stored tier (MUST default to FREE for new devices per policy)
  const rawStored = (localStorage.getItem('valenixia_tier') || '').toUpperCase();
  const storedTier = VALID_TIERS.includes(rawStored) ? rawStored : 'FREE';
  window.__valenixiaTier = storedTier;
  window.__valenixiaPlan = PLANS[storedTier] || PLANS.FREE;
  return storedTier;
}

function getLimits() {
  const tier = getActiveTier();
  const planKey = PLANS[tier] || PLANS.FREE;
  return PLAN_LIMITS[planKey] || PLAN_LIMITS[PLANS.FREE];
}
window.getLimits = getLimits;

// Feature Requirements Matrix
const FEATURE_TIER_REQ = {
  'checkout': 'FREE',
  'catalog': 'FREE',
  'history': 'FREE',
  'customers': 'FREE',
  'settings': 'FREE',
  'deals': 'FREE',
  'catalog-manager': 'FREE',
  'inventory': 'FREE',
  'analytics': 'FREE',
  'suppliers': 'FREE',
  'credit-book': 'FREE',
  'khata': 'FREE',
  'logs': 'FREE',
  'staff': 'FREE',
  'apps-download': 'FREE',
  'dashboard': 'FREE',
  'business-hub': 'FREE',
  'kds': 'PRO',
  'petty-cash': 'PRO',
  'attendance': 'PRO',
  'label-designer': 'PRO',
  'inventory-ai': 'PRO',
  'inventory-forecast': 'PRO',
  'loyalty': 'PRO',
  'marketing': 'PRO',
  'automated-whatsapp': 'PRO',
  'stock-transfer': 'PRO',
  'multi-device': 'PRO',
  'fbr-fiscal': 'ENTERPRISE',
  'speech-coach': 'ENTERPRISE',
  'data-portability': 'ENTERPRISE',
  'multi-store': 'ENTERPRISE'
};

const TIER_HIERARCHY = { FREE: 0, STARTER: 1, GROWTH: 2, PRO: 3, ENTERPRISE: 4 };

function can(feature) {
  const reqTier = FEATURE_TIER_REQ[feature] || 'FREE';

  // Check if license is expired for non-FREE features
  if (reqTier !== 'FREE') {
    const payload = window.__valenixiaLicensePayload;
    if (payload && payload.exp && Date.now() > payload.exp && payload.mode !== 'lifetime') {
      console.warn(`[FreemiumEngine] Access to "${feature}" blocked: License expired.`);
      return false;
    }
  }

  const currentTier = getActiveTier();
  const currentRank = TIER_HIERARCHY[currentTier] ?? 0;
  const reqRank = TIER_HIERARCHY[reqTier] ?? 0;
  return currentRank >= reqRank;
}
window.can = can;

// Background online Supabase subscription tier fetcher
async function syncOnlineSubscriptionTier() {
  if (!navigator.onLine) return;
  try {
    const serverBase = window.__valenixiaServerUrl || (location.protocol === 'file:' ? 'http://localhost:8080' : location.origin);
    let hwid = window.__valenixiaHWID || '';
    if (!hwid && window.AndroidPOS && typeof window.AndroidPOS.getDeviceID === 'function') {
      try { hwid = window.AndroidPOS.getDeviceID(); } catch(_) {}
    }
    if (!hwid && typeof localStorage !== 'undefined') {
      try { hwid = localStorage.getItem('valenixia_hwid') || ''; } catch(_) {}
    }

    let data = null;
    if (serverBase && !serverBase.startsWith('file:')) {
      try {
        const endpoint = serverBase + '/api/subscription/status' + (hwid ? '?hwid=' + encodeURIComponent(hwid) : '');
        const resp = await fetch(endpoint, {
          headers: hwid ? { 'x-device-hwid': hwid } : {}
        });
        if (resp.ok) data = await resp.json();
      } catch (_) {}
    }

    // Direct Supabase REST Cloud fallback if local server is unreachable or on Android file://
    if ((!data || !data.tier) && hwid) {
      try {
        const supaUrl = 'https://wzvwyfyefbdrqscxhwsf.supabase.co';
        const supaKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6dnd5ZnllZmJkcnFzY3hod3NmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MzU3ODUsImV4cCI6MjA5ODQxMTc4NX0.W9O6U4tqETM6BcEjX7evt3LunpIZOC5c7wcZht2ajuk';
        const supaResp = await fetch(`${supaUrl}/rest/v1/stores?id=eq.${encodeURIComponent(hwid)}`, {
          headers: {
            'apikey': supaKey,
            'Authorization': `Bearer ${supaKey}`
          }
        });
        if (supaResp.ok) {
          const rows = await supaResp.json();
          if (rows && rows.length > 0) {
            data = {
              tier: String(rows[0].plan || rows[0].tier || 'FREE').toUpperCase(),
              created_at: rows[0].created_at || rows[0].updated_at
            };
          }
        }
      } catch (_) {}
    }

    const fetchedTier = data && data.tier ? String(data.tier).toUpperCase() : (localStorage.getItem('valenixia_tier') || 'FREE').toUpperCase();
    if (VALID_TIERS.includes(fetchedTier)) {
      window.__valenixiaTier = fetchedTier;
      window.__valenixiaPlan = PLANS[fetchedTier] || PLANS.FREE;
      const prevTier = window.__lastSyncedTier || localStorage.getItem('valenixia_tier') || fetchedTier;
      const tierChanged = window.__lastSyncedTier && window.__lastSyncedTier !== fetchedTier;
      window.__lastSyncedTier = fetchedTier;

      try {
        localStorage.setItem('valenixia_tier', fetchedTier);
        const serverStartIso = data?.subscription_start_time || data?.start_time || data?.created_at;
        const serverStartMs = serverStartIso ? Date.parse(serverStartIso) : NaN;
        
        let existingStartMs = parseInt(localStorage.getItem('valenixia_subscription_start_time'), 10);
        // Only initialize start time if missing. NEVER reset existing countdown timer for established devices!
        if (isNaN(existingStartMs) || existingStartMs <= 0) {
          existingStartMs = (!isNaN(serverStartMs) && serverStartMs > 0) ? serverStartMs : Date.now();
          localStorage.setItem('valenixia_subscription_start_time', String(existingStartMs));
          if (typeof ValenixiaDB !== 'undefined' && ValenixiaDB.put) {
            ValenixiaDB.put('local_preferences', {
              key: 'valenixia_subscription_start_time',
              value_type: 'STR',
              value_payload: String(existingStartMs),
              is_idempotent_flag: 0,
              updated_at: Date.now()
            }).catch(() => {});
          }
        } else if (!isNaN(serverStartMs) && serverStartMs > 0 && serverStartMs < existingStartMs) {
          existingStartMs = serverStartMs;
          localStorage.setItem('valenixia_subscription_start_time', String(existingStartMs));
        }
      } catch(_) {}

      if (typeof applyTierLocks === 'function') applyTierLocks(fetchedTier);
      if (typeof renderNavbarByTier === 'function') renderNavbarByTier(fetchedTier);
      if (typeof applyTierRestrictions === 'function') applyTierRestrictions();
      if (typeof renderLicenseInfoCard === 'function') renderLicenseInfoCard();

      if (tierChanged && prevTier !== 'TRIAL') {
        if (typeof showNotificationToast === 'function') {
          showNotificationToast(`🚀 Subscription License Sync: Active Plan is ${fetchedTier}.`, 'info', 4000);
        }
      }
    }
  } catch (e) {}
}
if (typeof window !== 'undefined') {
  setTimeout(syncOnlineSubscriptionTier, 500);
  setInterval(syncOnlineSubscriptionTier, 5000); // 5-second dynamic cloud sync
}
window.syncOnlineSubscriptionTier = syncOnlineSubscriptionTier;


function checkLimit(type, currentCount) {
  const limits = getLimits();
  const limitMap = {
    products: limits.products,
    customers: limits.customers,
    employees: limits.employees,
    devices: limits.devices,
    transactions_per_month: limits.transactionsPerMonth,
    import_rows: limits.importLimit
  };
  const limit = limitMap[type];
  if (limit === undefined || limit === Infinity) return { allowed: true };
  if (currentCount >= limit) {
    return {
      allowed: false,
      limit,
      current: currentCount,
      reason: `Limit reached: ${currentCount}/${limit} ${type} on ${limits.displayName}`
    };
  }
  return { allowed: true, limit, remaining: limit - currentCount };
}
window.checkLimit = checkLimit;

function getMonthlyTransactionCount() {
  if (window.__vxSession && window.__vxSession.invoiceCount !== undefined) {
    return { count: window.__vxSession.invoiceCount, monthKey: "server_synced" };
  }
  const now = new Date();
  const monthKey = "vx_tx_" + now.getFullYear() + "_" + now.getMonth();
  const stored = JSON.parse(localStorage.getItem(monthKey) || "{\"count\":0}");
  return { count: stored.count, monthKey };
}

function incrementMonthlyTransactionCount() {
  if (window.__vxSession && window.__vxSession.invoiceCount !== undefined) {
    const updated = {
      ...window.__vxSession,
      invoiceCount: window.__vxSession.invoiceCount + 1
    };
    window.__vxSession = updated;
    return window.__vxSession.invoiceCount;
  }
  const { count, monthKey } = getMonthlyTransactionCount();
  localStorage.setItem(monthKey, JSON.stringify({ count: count + 1 }));
  return count + 1;
}
window.getMonthlyTransactionCount = getMonthlyTransactionCount;
window.incrementMonthlyTransactionCount = incrementMonthlyTransactionCount;

function isLimitReached() {
  const limits = getLimits();
  if (limits.transactionsPerMonth === Infinity) return { blocked: false, current: 0, limit: Infinity };
  const { count } = getMonthlyTransactionCount();
  if (count >= limits.transactionsPerMonth) {
    return { blocked: true, current: count, limit: limits.transactionsPerMonth };
  }
  return { blocked: false, current: count, limit: limits.transactionsPerMonth };
}
window.isLimitReached = isLimitReached;

function getTrialStatus() {
  return { phase: "active", tier: getActiveTier() };
}
window.getTrialStatus = getTrialStatus;

function applyReceiptBranding(receiptData) {
  const tier = getActiveTier();
  if (tier === 'FREE') {
    if (!receiptData.footerText || !receiptData.footerText.includes('Powered by Valenixia')) {
      receiptData.footerText = (receiptData.footerText || '') + '\nPowered by Valenixia POS (Free Tier)';
    }
  }
  return receiptData;
}
window.applyReceiptBranding = applyReceiptBranding;

function formatPKR(amount) {
  if (!amount && amount !== 0) return "Contact Us";
  if (amount === 0) return "Free";
  return "Rs. " + Number(amount).toLocaleString("en-PK");
}

// ── Interactive Paywall / Upgrade Modal ──────────────────────────────────────
function showUpgradeModal(featureName, requiredTier = 'GROWTH') {
  if (typeof can === 'function' && can(featureName)) return;
  const existing = document.getElementById("paywall-modal");
  if (existing) existing.remove();

  const activeTier = getActiveTier();
  const reqTier = (requiredTier || FEATURE_TIER_REQ[featureName] || 'GROWTH').toUpperCase();

  const modal = document.createElement("div");
  modal.id = "paywall-modal";
  modal.className = "modal-overlay active";
  modal.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(5,5,10,0.92);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);overflow-y:auto;";

  modal.innerHTML = `
    <div style="width:100%;max-width:540px;background:#11111a;border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:28px;box-shadow:0 24px 64px rgba(0,0,0,0.9);color:#fff;font-family:sans-serif;margin:auto;">
      
      <div style="text-align:center;margin-bottom:24px;">
        <div style="display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.4);border-radius:50%;font-size:32px;margin-bottom:12px;box-shadow:0 0 24px rgba(245,158,11,0.2);">
          🔒
        </div>
        <h2 style="font-size:20px;font-weight:900;margin:0 0 6px;color:#fff;letter-spacing:-0.3px;">
          ${featureName ? featureName.toUpperCase().replace('-', ' ') : 'PREMIUM FEATURE'} LOCKED
        </h2>
        <p style="font-size:13px;color:#94a3b8;margin:0;line-height:1.5;">
          This feature requires the <strong style="color:#f59e0b;">${reqTier} Plan</strong> or higher.<br>
          Your active plan is <span style="color:#10b981;font-weight:700;">Valenixia ${activeTier}</span>.
        </p>
      </div>

      <!-- Plan Cards Grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:12px;margin-bottom:24px;">
        
        <!-- Starter Card -->
        <div style="background:rgba(255,255,255,0.03);border:1px solid ${activeTier==='STARTER'?'#10b981':'rgba(255,255,255,0.08)'};border-radius:14px;padding:16px;text-align:center;">
          <div style="font-size:11px;font-weight:800;color:#94a3b8;text-transform:uppercase;">Starter</div>
          <div style="font-size:16px;font-weight:900;color:#fff;margin:6px 0 2px;">Rs. 3,499<span style="font-size:10px;font-weight:400;color:#64748b;">/mo</span></div>
          <div style="font-size:10px;color:#64748b;margin-bottom:12px;">500 Products · Inventory & Deals</div>
          <button class="__btn-select-tier" data-tier="STARTER" style="width:100%;padding:8px;background:${activeTier==='STARTER'?'#10b981':'rgba(255,255,255,0.1)'};border:none;color:#fff;font-size:11px;font-weight:700;border-radius:8px;cursor:pointer;">
            ${activeTier==='STARTER'?'Current Plan':'Select Starter'}
          </button>
        </div>

        <!-- Growth Card (Recommended) -->
        <div style="background:rgba(16,185,129,0.08);border:2px solid #10b981;border-radius:14px;padding:16px;text-align:center;position:relative;box-shadow:0 0 20px rgba(16,185,129,0.15);">
          <div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#10b981;color:#000;font-size:9px;font-weight:900;padding:2px 8px;border-radius:99px;text-transform:uppercase;">RECOMMENDED</div>
          <div style="font-size:11px;font-weight:800;color:#10b981;text-transform:uppercase;margin-top:4px;">Growth (Pro)</div>
          <div style="font-size:16px;font-weight:900;color:#fff;margin:6px 0 2px;">Rs. 5,999<span style="font-size:10px;font-weight:400;color:#64748b;">/mo</span></div>
          <div style="font-size:10px;color:#94a3b8;margin-bottom:12px;">Full Catalog Products · Analytics & Sync</div>
          <button class="__btn-select-tier" data-tier="GROWTH" style="width:100%;padding:8px;background:#10b981;border:none;color:#000;font-size:11px;font-weight:900;border-radius:8px;cursor:pointer;">
            ${activeTier==='GROWTH'?'Current Plan':'Upgrade Growth'}
          </button>
        </div>

        <!-- Enterprise Card -->
        <div style="background:rgba(255,255,255,0.03);border:1px solid ${activeTier==='ENTERPRISE'?'#10b981':'rgba(255,255,255,0.08)'};border-radius:14px;padding:16px;text-align:center;">
          <div style="font-size:11px;font-weight:800;color:#94a3b8;text-transform:uppercase;">Enterprise</div>
          <div style="font-size:16px;font-weight:900;color:#fff;margin:6px 0 2px;">Rs. 11,999<span style="font-size:10px;font-weight:400;color:#64748b;">/mo</span></div>
          <div style="font-size:10px;color:#64748b;margin-bottom:12px;">FBR Fiscal · Multi-Store & Portability</div>
          <button class="__btn-select-tier" data-tier="ENTERPRISE" style="width:100%;padding:8px;background:${activeTier==='ENTERPRISE'?'#10b981':'rgba(255,255,255,0.1)'};border:none;color:#fff;font-size:11px;font-weight:700;border-radius:8px;cursor:pointer;">
            ${activeTier==='ENTERPRISE'?'Current Plan':'Upgrade Enterprise'}
          </button>
        </div>

      </div>

      <!-- Action Footer -->
      <div style="display:flex;gap:12px;">
        <button id="__paywall-dismiss" style="flex:1;height:44px;background:transparent;border:1px solid rgba(255,255,255,0.15);color:#94a3b8;font-size:13px;font-weight:700;border-radius:10px;cursor:pointer;">
          Dismiss
        </button>
      </div>

    </div>
  `;

  document.body.appendChild(modal);

  // Deep Dismiss Handler: if currently on an unauthorized screen, force return to checkout
  const handleDismiss = () => {
    modal.remove();
    if (featureName && typeof window.can === 'function' && !window.can(featureName)) {
      if (typeof window.switchActiveScreen === 'function') {
        window.switchActiveScreen('checkout');
      }
    }
  };

  document.getElementById("__paywall-dismiss")?.addEventListener("click", handleDismiss);
  modal.addEventListener("click", (e) => { if (e.target === modal) handleDismiss(); });


  // ── Secure plan selection: redirect to subscription page only ──────────────
  // SECURITY: Tier upgrades are ONLY permitted server-side via /api/admin/payments/decision
  // after manual payment verification. Client-side tier writes are NOT allowed.
  modal.querySelectorAll(".__btn-select-tier").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const selectedTier = btn.dataset.tier;
      const currentTier = getActiveTier();

      // If user clicks their current plan button, just dismiss
      if (selectedTier === currentTier) {
        modal.remove();
        return;
      }

      modal.remove();
      // Redirect to the subscription/contact page — no local tier write
      if (typeof window.switchActiveScreen === 'function') {
        window.switchActiveScreen('subscription');
      } else {
        // Fallback: open the subscription page
        const subUrl = (window.__valenixiaServerUrl || location.origin) + '/subscription.html?tier=' + selectedTier;
        window.open(subUrl, '_blank', 'noopener,noreferrer');
      }

      if (window.showNotificationToast) {
        window.showNotificationToast('To upgrade, please complete payment via the subscription page.', 'info', 4000);
      }
    });
  });
}
window.showUpgradeModal = showUpgradeModal;
window.showPaywallModal = showUpgradeModal;

function renderTrialBanner() {
  const existing = document.getElementById("vx-trial-banner");
  if (existing) existing.remove();
}
window.renderTrialBanner = renderTrialBanner;

window.PLANS = PLANS;
window.PLAN_LIMITS = PLAN_LIMITS;
window.getActiveTier = getActiveTier;

// Initialize GROWTH tier as default
getActiveTier();

})();

