// ============================================================================
// VALENIXIA FREEMIUM ENGINE — Tier System, Feature Gates, Upgrade Modals
// Version: 1.0.0
// All plans are FREE during beta — limits enforced so the system is tested.
// Flip window.__valenixiaPlan to a paid tier to unlock features.
// ============================================================================
"use strict";
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
    devices: 1, branches: 1, transactionsPerDay: 20, transactionsPerMonth: 50, products: 25, customers: 50, employees: 1,
    buybacks: 5,
    transactionHistoryDays: 30, receiptBranding: "valenixia",
    backup: "manual", fbrCompliance: false, multiDeviceSync: false, apiAccess: false,
    analytics: "basic", importLimit: 25, support: "community"
  },
  [PLANS.STARTER]: {
    displayName: "Valenixia Starter",
    monthlyPKR: 3499, lifetimePKR: 79000,
    devices: 1, branches: 1, transactionsPerDay: Infinity, transactionsPerMonth: Infinity, products: Infinity, customers: Infinity, employees: 5,
    buybacks: Infinity,
    transactionHistoryDays: Infinity, receiptBranding: "custom",
    backup: "manual", fbrCompliance: true, multiDeviceSync: false, apiAccess: false,
    analytics: "basic", importLimit: Infinity, support: "whatsapp"
  },
  [PLANS.GROWTH]: {
    displayName: "Valenixia Pro",
    monthlyPKR: 6999, annualPKR: 69999, lifetimePKR: 149000,
    devices: 2, branches: 1, transactionsPerDay: Infinity, transactionsPerMonth: Infinity, products: Infinity, customers: Infinity, employees: 20,
    buybacks: Infinity,
    transactionHistoryDays: Infinity, receiptBranding: "custom",
    backup: "auto_daily", fbrCompliance: true, multiDeviceSync: true, apiAccess: false,
    analytics: "advanced", importLimit: Infinity, support: "priority"
  },
  [PLANS.PRO]: {
    displayName: "Valenixia Pro",
    monthlyPKR: 6999, lifetimePKR: 149000,
    devices: 2, branches: 1, transactionsPerDay: Infinity, transactionsPerMonth: Infinity, products: Infinity, customers: Infinity, employees: 50,
    buybacks: Infinity,
    transactionHistoryDays: Infinity, receiptBranding: "white_label",
    backup: "auto_daily", fbrCompliance: true, multiDeviceSync: true, apiAccess: true,
    analytics: "advanced", importLimit: Infinity, support: "phone"
  },
  [PLANS.ENTERPRISE]: {
    displayName: "Valenixia Enterprise",
    monthlyPKR: 11999, lifetimePKR: 249000,
    devices: 3, branches: 2, transactionsPerDay: Infinity, transactionsPerMonth: Infinity, products: Infinity, customers: Infinity, employees: Infinity,
    buybacks: Infinity,
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
  // Priority 0: Authoritative Approved Payment Claim in local store
  try {
    const claims = window.ValenixiaClaimsManager 
      ? window.ValenixiaClaimsManager.getAll() 
      : JSON.parse(localStorage.getItem('valenixia_admin_claims') || '[]');
    const approved = claims.find(c => c && c.status === 'APPROVED');
    if (approved) {
      let claimTier = 'STARTER';
      if (approved.targetTier) {
        claimTier = approved.targetTier.toUpperCase();
      } else if (approved.module && approved.module.toLowerCase().includes('enterprise')) {
        claimTier = 'ENTERPRISE';
      } else if (approved.module && (approved.module.toLowerCase().includes('pro') || approved.module.toLowerCase().includes('growth'))) {
        claimTier = 'PRO';
      }
      if (VALID_TIERS.includes(claimTier)) {
        window.__valenixiaTier = claimTier;
        window.__valenixiaPlan = PLANS[claimTier] || PLANS.PRO;
        return claimTier;
      }
    }
  } catch (_) {}

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

  // Priority 3: Store-Scoped Preference Tier (Isolates stores on same device)
  const storeTier = (window.__valenixiaState && window.__valenixiaState.preferences && window.__valenixiaState.preferences['store_subscription_tier']) || (window.__valenixiaState && window.__valenixiaState.currentTier);
  if (storeTier && VALID_TIERS.includes(String(storeTier).toUpperCase())) {
    const norm = String(storeTier).toUpperCase();
    window.__valenixiaTier = norm;
    window.__valenixiaPlan = PLANS[norm] || PLANS.FREE;
    return norm;
  }

  // Priority 4: Scoped store storage key (valenixia_store_{storeId}_tier)
  try {
    const storeId = (window.__valenixiaState?.preferences?.store_id) || (typeof localStorage !== 'undefined' && localStorage.getItem('valenixia_store_id'));
    if (storeId) {
      const scopedTier = (localStorage.getItem(`valenixia_store_${storeId}_tier`) || '').toUpperCase();
      if (VALID_TIERS.includes(scopedTier)) {
        window.__valenixiaTier = scopedTier;
        window.__valenixiaPlan = PLANS[scopedTier] || PLANS.FREE;
        return scopedTier;
      }
    }
  } catch (_) {}

  // Priority 5: Fallback to stored tier (MUST default to FREE for unverified stores/devices)
  const rawStored = (typeof localStorage !== 'undefined' ? (localStorage.getItem('valenixia_tier') || '') : '').toUpperCase();
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
  // Free Tier (Basic Single-Counter)
  'checkout': 'FREE',
  'catalog': 'FREE',
  'history': 'FREE',
  'customers': 'FREE',
  'settings': 'FREE',
  'deals': 'FREE',
  'dashboard': 'FREE',
  'business-hub': 'FREE',
  'apps-download': 'FREE',
  'catalog-manager': 'FREE',
  'inventory': 'FREE',
  'customer-buyback': 'FREE',
  'buyback': 'FREE',
  'platform-admin': 'FREE',

  // Starter Tier Views & Modules (PKR 3,499/mo)
  'suppliers': 'STARTER',
  'analytics': 'STARTER',
  'credit-book': 'STARTER',
  'khata': 'STARTER',
  'customer-khata': 'STARTER',

  // Growth / Pro Tier Views & Modules (PKR 6,999/mo)
  'logs': 'PRO', // System Health, CRDT Broadcast & Sync Stream logs
  'sync-logs': 'PRO',
  'system-health': 'PRO',
  'kds': 'PRO',
  'petty-cash': 'PRO',
  'attendance': 'PRO',
  'staff': 'PRO',
  'label-designer': 'PRO',
  'inventory-ai': 'PRO',
  'inventory-forecast': 'PRO',
  'loyalty': 'PRO',
  'marketing': 'PRO',
  'automated-whatsapp': 'PRO',
  'stock-transfer': 'PRO',
  'customer-buyback': 'FREE',
  'buyback': 'FREE',
  'multi-device': 'PRO',
  'cloud-backup': 'PRO',
  'google_drive_backup': 'PRO',

  // Enterprise HQ Tier Views & Modules (PKR 11,999/mo)
  'fbr-fiscal': 'ENTERPRISE',
  'fbr_fiscal': 'ENTERPRISE',
  'fbr': 'ENTERPRISE',
  'speech-coach': 'ENTERPRISE',
  'data-portability': 'ENTERPRISE',
  'multi-store': 'ENTERPRISE',
  'multi_store': 'ENTERPRISE',
  'custom-roles': 'ENTERPRISE',
  'custom_roles': 'ENTERPRISE',
  'chain-operations': 'ENTERPRISE'
};

const FEATURE_DISPLAY_NAMES = {
  'suppliers': 'Suppliers & Distributor Ledger',
  'analytics': 'Financial Reports & Sales Analytics',
  'credit-book': 'Customer Khata & Udhaar Credit Ledger',
  'khata': 'Customer Khata & Udhaar Credit Ledger',
  'customer-khata': 'Customer Khata & Udhaar Credit Ledger',
  'customer-buyback': 'Customer Device Buy-In & Legal Transfer Ledger',
  'logs': 'CRDT Sync Stream & System Diagnostics',
  'sync-logs': 'Live Replication Stream & Sync Logs',
  'system-health': 'System Health & Engine Diagnostics',
  'kds': 'Kitchen Display System (KDS)',
  'petty-cash': 'Petty Cash Float & Z-Report Reconciliation',
  'attendance': 'Staff Time Clock & Attendance Tracking',
  'staff': 'Cashier Security PINs & Staff Management',
  'label-designer': 'Barcode Label & Shelf Tag Studio',
  'inventory-ai': 'Statistical Inventory Reorder & Dead-Stock Forecast',
  'inventory-forecast': 'Statistical Inventory Reorder & Dead-Stock Forecast',
  'loyalty': 'VIP Loyalty Club & Customer Cashback Wallet',
  'marketing': 'SMS & WhatsApp Marketing Broadcast Studio',
  'automated-whatsapp': 'Automated WhatsApp Receipt Delivery',
  'stock-transfer': 'Inter-Branch Stock Transfer (STN) Manifests',
  'multi-device': 'Multi-Device Real-Time Cloud Sync & Backup',
  'google_drive_backup': 'Automated Cloud Database Backup',
  'cloud-backup': 'Real-Time Cloud Backup & Replication',
  'fbr-fiscal': 'Official FBR Fiscal POS & PRAL Tax Integration',
  'fbr_fiscal': 'Official FBR Fiscal POS & PRAL Tax Integration',
  'fbr': 'Official FBR Fiscal POS & PRAL Tax Integration',
  'speech-coach': 'Audio Sales Pitch Evaluation Engine',
  'data-portability': 'Full Data Portability & Cross-Chain Export',
  'multi-store': 'Multi-Store Central HQ Dashboard',
  'multi_store': 'Multi-Store Central HQ Dashboard',
  'custom-roles': 'Custom Staff Roles & Granular RBAC Permissions',
  'custom_roles': 'Custom Staff Roles & Granular RBAC Permissions',
  'chain-operations': 'Enterprise Multi-Branch Chain Operations'
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

    let existingStartMs = parseInt(localStorage.getItem('valenixia_subscription_start_time') || '0', 10);
    if (isNaN(existingStartMs) || existingStartMs <= 0) {
      if (typeof ValenixiaDB !== 'undefined' && ValenixiaDB.get) {
        const pref = await ValenixiaDB.get('local_preferences', 'valenixia_subscription_start_time').catch(() => null);
        if (pref && pref.value_payload) existingStartMs = parseInt(pref.value_payload, 10);
      }
    }
    if (isNaN(existingStartMs) || existingStartMs <= 0) {
      existingStartMs = Date.now();
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
    }

    let data = null;
    if (serverBase && !serverBase.startsWith('file:')) {
      try {
        const startParam = existingStartMs ? '&start_time=' + encodeURIComponent(new Date(existingStartMs).toISOString()) : '';
        const endpoint = serverBase + '/api/subscription/status' + (hwid ? '?hwid=' + encodeURIComponent(hwid) + startParam : '');
        const resp = await fetch(endpoint, {
          headers: {
            ...(hwid ? { 'x-device-hwid': hwid } : {}),
            ...(existingStartMs ? { 'x-subscription-start-time': new Date(existingStartMs).toISOString() } : {})
          }
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
              created_at: rows[0].created_at || rows[0].updated_at,
              subscription_start_time: rows[0].subscription_start_time || rows[0].created_at,
              expires_at: rows[0].expires_at
            };
          }
        }
      } catch (_) {}
    }

    const fetchedTier = data && data.tier ? String(data.tier).toUpperCase() : (localStorage.getItem('valenixia_tier') || 'FREE').toUpperCase();
    const currentActive = getActiveTier();
    const currentRank = TIER_HIERARCHY[currentActive] ?? 0;
    const incomingRank = TIER_HIERARCHY[fetchedTier] ?? 0;
    if (currentRank > incomingRank) {
      // Local approved claim/tier takes precedence over un-synced server default
      return;
    }

    if (VALID_TIERS.includes(fetchedTier)) {
      window.__valenixiaTier = fetchedTier;
      window.__valenixiaPlan = PLANS[fetchedTier] || PLANS.FREE;
      const prevTier = window.__lastSyncedTier || localStorage.getItem('valenixia_tier') || fetchedTier;
      const tierChanged = window.__lastSyncedTier && window.__lastSyncedTier !== fetchedTier;
      window.__lastSyncedTier = fetchedTier;

      try {
        localStorage.setItem('valenixia_tier', fetchedTier);
        if (data?.billing_cycle) localStorage.setItem('valenixia_billing_cycle', data.billing_cycle);
        if (data?.trial_used !== undefined) localStorage.setItem('valenixia_trial_used', data.trial_used ? 'true' : 'false');
        
        const serverStartIso = data?.subscription_start_time || data?.start_time || data?.created_at;
        const serverStartMs = serverStartIso ? Date.parse(serverStartIso) : NaN;

        const serverExpIso = data?.expires_at;
        const serverExpMs = data?.expires_at_ms || (serverExpIso ? Date.parse(serverExpIso) : NaN);

        // ── Server Start Time Guard ─────────────────────────────────────────────
        const serverSource = data?.source || '';
        const isServerInitializedFresh = serverSource === 'device_initialized' || serverSource === 'local_fallback';

        if (!isNaN(serverStartMs) && serverStartMs > 0 && !isServerInitializedFresh) {
          const startDiff = serverStartMs - existingStartMs;
          const serverIsEarlier = (existingStartMs <= 0) || (startDiff < -300000);
          if (serverIsEarlier) {
            existingStartMs = serverStartMs;
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
          }
        } else if ((existingStartMs <= 0) && !isServerInitializedFresh && !isNaN(serverStartMs) && serverStartMs > 0) {
          existingStartMs = serverStartMs;
          localStorage.setItem('valenixia_subscription_start_time', String(existingStartMs));
        }

        // ── Server Expiry Guard ─────────────────────────────────────────────────
        const currentExpMs = parseInt(localStorage.getItem('valenixia_subscription_expires_at') || '0', 10);
        if (!isNaN(serverExpMs) && serverExpMs > 0 && !isServerInitializedFresh) {
          const expDiff = Math.abs(serverExpMs - currentExpMs);
          if (currentExpMs === 0 || expDiff > 300000) {
            localStorage.setItem('valenixia_subscription_expires_at', String(serverExpMs));
            if (typeof ValenixiaDB !== 'undefined' && ValenixiaDB.put) {
              ValenixiaDB.put('local_preferences', {
                key: 'valenixia_subscription_expires_at',
                value_type: 'STR',
                value_payload: String(serverExpMs),
                is_idempotent_flag: 0,
                updated_at: Date.now()
              }).catch(() => {});
            }
          }
        } else if (currentExpMs === 0 && existingStartMs > 0) {
          const initialExp = existingStartMs + (30 * 24 * 60 * 60 * 1000);
          localStorage.setItem('valenixia_subscription_expires_at', String(initialExp));
          if (typeof ValenixiaDB !== 'undefined' && ValenixiaDB.put) {
            ValenixiaDB.put('local_preferences', {
              key: 'valenixia_subscription_expires_at',
              value_type: 'STR',
              value_payload: String(initialExp),
              is_idempotent_flag: 0,
              updated_at: Date.now()
            }).catch(() => {});
          }
        }
      } catch(_) {}

      const prevExpNum = parseInt(window.__lastSyncedExp || '0', 10);
      const curExpNum = parseInt(localStorage.getItem('valenixia_subscription_expires_at') || '0', 10);
      const expChanged = prevExpNum > 0 && curExpNum > 0 && Math.abs(prevExpNum - curExpNum) > 300000;
      window.__lastSyncedExp = String(curExpNum);

      // Only trigger full UI re-renders on genuine state mutations or initial boot
      if (tierChanged || expChanged || !window.__initialTierRendered) {
        window.__initialTierRendered = true;
        if (typeof applyTierLocks === 'function') applyTierLocks(fetchedTier);
        if (typeof renderNavbarByTier === 'function') renderNavbarByTier(fetchedTier);
        if (typeof applyTierRestrictions === 'function') applyTierRestrictions();
        if (typeof renderLicenseInfoCard === 'function') renderLicenseInfoCard();
      }

      if (tierChanged && prevTier !== 'TRIAL') {
        if (typeof showNotificationToast === 'function') {
          showNotificationToast(` Subscription License Sync: Active Plan is ${fetchedTier}.`, 'info', 4000);
        }
      }
    }
  } catch (e) {}
}
if (typeof window !== 'undefined') {
  setTimeout(syncOnlineSubscriptionTier, 500);
  setInterval(syncOnlineSubscriptionTier, 30000); // 30-second stable cloud sync

  // Listen for real-time tier mutations across app
  window.addEventListener('valenixia_tier_changed', (e) => {
    const newTier = e.detail && e.detail.tier ? e.detail.tier : getActiveTier();
    window.__valenixiaTier = newTier;
    if (typeof applyTierLocks === 'function') applyTierLocks(newTier);
    if (typeof renderNavbarByTier === 'function') renderNavbarByTier(newTier);
    if (typeof applyTierRestrictions === 'function') applyTierRestrictions();
    if (typeof renderLicenseInfoCard === 'function') renderLicenseInfoCard();
    if (window.ValenixiaSubscription && typeof window.ValenixiaSubscription.refresh === 'function') {
      window.ValenixiaSubscription.refresh();
    }
  });

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const tierBus = new BroadcastChannel('valenixia_tier_bus');
      tierBus.onmessage = (e) => {
        if (e.data && e.data.tier) {
          window.__valenixiaTier = e.data.tier;
          if (typeof applyTierLocks === 'function') applyTierLocks(e.data.tier);
          if (typeof renderNavbarByTier === 'function') renderNavbarByTier(e.data.tier);
          if (typeof applyTierRestrictions === 'function') applyTierRestrictions();
          if (typeof renderLicenseInfoCard === 'function') renderLicenseInfoCard();
          if (window.ValenixiaSubscription && typeof window.ValenixiaSubscription.refresh === 'function') {
            window.ValenixiaSubscription.refresh();
          }
        }
      };
    } catch (_) {}
  }
}
window.syncOnlineSubscriptionTier = syncOnlineSubscriptionTier;

// ── STRICT TIER-CHANGE RESET & ADDITIVE SAME-TIER RENEWAL ENGINE ─────────────
function applySubscriptionUpgrade(newTier = 'PRO', daysToAdd = 30) {
  const normTier = String(newTier).toUpperCase();
  const currentTier = (typeof getActiveTier === 'function' ? getActiveTier() : (window.__valenixiaTier || localStorage.getItem('valenixia_tier') || 'FREE')).toUpperCase();
  const currentExpMs = parseInt(localStorage.getItem('valenixia_subscription_expires_at') || '0', 10);
  const now = Date.now();

  // Tier-change vs Same-tier Stacking Logic:
  // - If renewing the SAME tier and active time remains -> Stack additively (currentExpMs + additionalMs)
  // - If upgrading or switching to a DIFFERENT tier (e.g. STARTER -> ENTERPRISE) -> Start fresh 30-day countdown from now (now + additionalMs)!
  const isSameTierRenewal = (currentTier === normTier) && (currentExpMs > now);
  const baseTime = isSameTierRenewal ? currentExpMs : now;
  const additionalMs = (daysToAdd || 30) * 24 * 60 * 60 * 1000;
  const newExpiresAt = baseTime + additionalMs;

  localStorage.setItem('valenixia_tier', normTier);
  localStorage.setItem('valenixia_subscription_expires_at', String(newExpiresAt));
  localStorage.setItem('valenixia_subscription_start_time', String(now));
  localStorage.setItem('valenixia_trial_active', 'false');
  window.__valenixiaTier = normTier;
  window.__valenixiaPlan = PLANS[normTier] || PLANS.PRO;

  if (typeof ValenixiaDB !== 'undefined' && ValenixiaDB.put) {
    ValenixiaDB.put('local_preferences', {
      key: 'valenixia_subscription_expires_at',
      value_type: 'STR',
      value_payload: String(newExpiresAt),
      is_idempotent_flag: 0,
      updated_at: now
    }).catch(() => {});
    ValenixiaDB.put('local_preferences', {
      key: 'valenixia_subscription_start_time',
      value_type: 'STR',
      value_payload: String(now),
      is_idempotent_flag: 0,
      updated_at: now
    }).catch(() => {});
    ValenixiaDB.put('local_preferences', {
      key: 'valenixia_tier',
      value_type: 'STR',
      value_payload: normTier,
      is_idempotent_flag: 0,
      updated_at: now
    }).catch(() => {});
  }

  const remainingDays = Math.ceil((newExpiresAt - now) / (24 * 60 * 60 * 1000));
  console.log(`[FreemiumEngine] Subscription upgraded to ${normTier}. Added ${daysToAdd} days. Total remaining: ${remainingDays} days (expires: ${new Date(newExpiresAt).toISOString()})`);

  if (typeof applyTierLocks === 'function') applyTierLocks(normTier);
  if (typeof renderNavbarByTier === 'function') renderNavbarByTier(normTier);
  if (typeof applyTierRestrictions === 'function') applyTierRestrictions();
  if (typeof renderLicenseInfoCard === 'function') renderLicenseInfoCard();
  if (window.ValenixiaSubscription && typeof window.ValenixiaSubscription.refresh === 'function') {
    window.ValenixiaSubscription.refresh();
  }

  // Cross-component broadcast
  try {
    window.dispatchEvent(new CustomEvent('valenixia_tier_changed', { detail: { tier: normTier, expiresAt: newExpiresAt } }));
  } catch(_) {}

  return {
    tier: normTier,
    expiresAt: newExpiresAt,
    remainingDays
  };
}
window.applySubscriptionUpgrade = applySubscriptionUpgrade;


// ── DAILY ROLLING QUOTA RESET & COUNTDOWN ENGINE ─────────────────────────
function getNextMidnightMs() {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return tomorrow.getTime();
}

function getMidnightRemainingSeconds() {
  const remainingMs = Math.max(0, getNextMidnightMs() - Date.now());
  return Math.floor(remainingMs / 1000);
}

function formatCountdown(totalSec) {
  const hrs  = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

window.getNextMidnightMs = getNextMidnightMs;
window.getMidnightRemainingSeconds = getMidnightRemainingSeconds;
window.formatCountdown = formatCountdown;

function getDailyTransactionCount() {
  const now = new Date();
  const dateKey = "vx_tx_daily_" + now.getFullYear() + "_" + String(now.getMonth() + 1).padStart(2, '0') + "_" + String(now.getDate()).padStart(2, '0');
  const stored = JSON.parse(localStorage.getItem(dateKey) || "{\"count\":0}");
  return { count: stored.count || 0, dateKey };
}

function incrementDailyTransactionCount() {
  const { count, dateKey } = getDailyTransactionCount();
  const newCount = count + 1;
  localStorage.setItem(dateKey, JSON.stringify({ count: newCount }));
  return newCount;
}
window.getDailyTransactionCount = getDailyTransactionCount;
window.incrementDailyTransactionCount = incrementDailyTransactionCount;

function checkLimit(type, currentCount) {
  const limits = getLimits();
  const limitMap = {
    products: limits.products,
    customers: limits.customers,
    employees: limits.employees,
    devices: limits.devices,
    buybacks: limits.buybacks,
    daily_transactions: limits.transactionsPerDay,
    transactions_per_day: limits.transactionsPerDay,
    transactions_per_month: limits.transactionsPerMonth,
    monthly_transactions: limits.transactionsPerMonth,
    import_rows: limits.importLimit
  };
  const limit = limitMap[type];
  if (limit === undefined || limit === Infinity) return { allowed: true };

  const resetMs = getNextMidnightMs();
  const remSec = getMidnightRemainingSeconds();
  const formattedCountdown = formatCountdown(remSec);

  if (currentCount >= limit) {
    let friendlyName = type.replace(/_/g, ' ');
    return {
      allowed: false,
      limit,
      current: currentCount,
      resetMs,
      formattedCountdown,
      reason: `Free Tier Quota reached (${currentCount}/${limit} ${friendlyName}). Free daily quota resets at midnight (in ${formattedCountdown}). Upgrade to Starter or Pro to unlock unlimited access.`
    };
  }
  return { allowed: true, limit, remaining: limit - currentCount, resetMs, formattedCountdown };
}
window.checkLimit = checkLimit;

function getMonthlyTransactionCount() {
  if (window.__vxSession && window.__vxSession.invoiceCount !== undefined) {
    return { count: window.__vxSession.invoiceCount, monthKey: "server_synced" };
  }
  const now = new Date();
  const monthKey = "vx_tx_" + now.getFullYear() + "_" + now.getMonth();
  const stored = JSON.parse(localStorage.getItem(monthKey) || "{\"count\":0}");
  return { count: stored.count || 0, monthKey };
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
  
  // 1. Check daily transaction limit (Free tier default 20/day)
  if (limits.transactionsPerDay !== Infinity) {
    const { count: dailyCount } = getDailyTransactionCount();
    if (dailyCount >= limits.transactionsPerDay) {
      return { blocked: true, type: 'daily_transactions', current: dailyCount, limit: limits.transactionsPerDay, period: 'day' };
    }
  }

  // 2. Check monthly transaction limit (Free tier default 50/month)
  if (limits.transactionsPerMonth !== Infinity) {
    const { count: monthlyCount } = getMonthlyTransactionCount();
    if (monthlyCount >= limits.transactionsPerMonth) {
      return { blocked: true, type: 'transactions_per_month', current: monthlyCount, limit: limits.transactionsPerMonth, period: 'month' };
    }
  }

  return { blocked: false, current: 0, limit: Infinity };
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

// ── Contextual Paywall / Upgrade Modal ──────────────────────────────────────
function showUpgradeModal(featureName, requiredTier) {
  if (typeof can === 'function' && can(featureName)) return;
  const existing = document.getElementById("paywall-modal");
  if (existing) existing.remove();

  const activeTier = getActiveTier();
  const inferredReq = featureName ? FEATURE_TIER_REQ[featureName] : null;
  let rawReq = (requiredTier || inferredReq || 'PRO').toUpperCase();
  if (rawReq === 'GROWTH') rawReq = 'PRO';
  const reqTier = rawReq;

  const cleanName = (FEATURE_DISPLAY_NAMES[featureName] || (featureName ? featureName.replace(/[-_]/g, ' ') : 'PREMIUM FEATURE')).toUpperCase();

  // Tier metadata definitions
  const PLAN_CARDS_DATA = {
    STARTER: {
      id: 'STARTER',
      name: 'Starter Register',
      price: 'Rs. 3,499',
      features: '1 Terminal · Suppliers & Distributors · Financial Analytics · Credit Khata',
      buttonText: activeTier === 'STARTER' ? 'Current Plan' : 'Select Starter',
      themeColor: '#06b6d4'
    },
    PRO: {
      id: 'PRO',
      name: 'Growth (Pro Store)',
      price: 'Rs. 6,999',
      features: '2 Terminals · Real-Time Sync · KDS & Statistical Forecast',
      buttonText: (activeTier === 'PRO' || activeTier === 'GROWTH') ? 'Current Plan' : 'Upgrade Growth (Pro)',
      themeColor: '#10b981'
    },
    ENTERPRISE: {
      id: 'ENTERPRISE',
      name: 'Enterprise HQ',
      price: 'Rs. 11,999',
      features: '3 Terminals & 2 Branches · FBR Fiscal POS · Multi-Store HQ',
      buttonText: activeTier === 'ENTERPRISE' ? 'Current Plan' : 'Upgrade Enterprise HQ',
      themeColor: '#f59e0b'
    }
  };

  // Determine which plan cards to render:
  let targetPlans = ['STARTER', 'PRO', 'ENTERPRISE'];
  if (reqTier === 'ENTERPRISE') {
    targetPlans = ['ENTERPRISE'];
  } else if (reqTier === 'PRO' || reqTier === 'GROWTH') {
    targetPlans = ['PRO', 'ENTERPRISE'];
  }

  // Check if this modal was triggered by a daily free quota exhaustion
  const isFreeQuotaFeature = featureName && (featureName.toLowerCase().includes('quota') || featureName.toLowerCase().includes('buyback') || featureName.toLowerCase().includes('import') || featureName.toLowerCase().includes('limit'));

  // Header Subtitle & Explanation
  let subText = '';
  if (reqTier === 'ENTERPRISE') {
    subText = `This feature is exclusively available on the <strong style="color:#f59e0b;">Enterprise HQ Plan</strong>.<br><span style="font-size:12px;color:#94a3b8;">Starter and Growth plans do not include this feature. Upgrade to Enterprise to unlock instant access.</span>`;
  } else if (reqTier === 'PRO' || reqTier === 'GROWTH') {
    subText = `This feature requires the <strong style="color:#10b981;">Growth (Pro) Plan</strong> or higher.<br><span style="font-size:12px;color:#94a3b8;">Upgrade to Growth or Enterprise to unlock multi-device sync, KDS, logs, and advanced tools.</span>`;
  } else {
    subText = `This feature requires the <strong style="color:#06b6d4;">Starter Plan</strong> or higher.<br><span style="font-size:12px;color:#94a3b8;">Active Plan: Valenixia ${activeTier}</span>`;
  }

  const modal = document.createElement("div");
  modal.id = "paywall-modal";
  modal.className = "modal-overlay active";
  modal.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(5,5,10,0.92);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);overflow-y:auto;";

  const remSec = getMidnightRemainingSeconds();
  const liveCountdownStr = formatCountdown(remSec);

  const cardsHtml = targetPlans.map(tierKey => {
    const p = PLAN_CARDS_DATA[tierKey];
    const isExact = tierKey === reqTier;
    const isCurrent = (tierKey === activeTier) || (tierKey === 'PRO' && activeTier === 'GROWTH');
    return `
      <div style="background:${isExact ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)'};border:${isExact ? `2px solid ${p.themeColor}` : (isCurrent ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.08)')};border-radius:16px;padding:20px;text-align:center;position:relative;display:flex;flex-direction:column;justify-content:space-between;${isExact ? `box-shadow:0 0 28px ${p.themeColor}33;` : ''}">
        ${isExact ? `<div style="position:absolute;top:-11px;left:50%;transform:translateX(-50%);background:${p.themeColor};color:#000;font-size:9.5px;font-weight:900;padding:2px 10px;border-radius:99px;text-transform:uppercase;letter-spacing:0.5px;">REQUIRED PLAN</div>` : ''}
        <div>
          <div style="font-size:12px;font-weight:800;color:${p.themeColor};text-transform:uppercase;letter-spacing:0.5px;margin-top:${isExact ? '4px' : '0'};">${p.name}</div>
          <div style="font-size:20px;font-weight:900;color:#fff;margin:8px 0 4px;">${p.price}<span style="font-size:11px;font-weight:400;color:#94a3b8;">/mo</span></div>
          <div style="font-size:11px;color:#94a3b8;line-height:1.4;margin-bottom:16px;">${p.features}</div>
        </div>
        <button class="__btn-select-tier" data-tier="${p.id}" style="width:100%;min-height:38px;padding:8px 10px;background:${isCurrent ? 'rgba(255,255,255,0.1)' : p.themeColor};border:none;color:${isCurrent ? '#fff' : '#000'};font-size:11.5px;font-weight:900;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;text-align:center;white-space:normal!important;word-break:keep-all!important;hyphens:none!important;line-height:1.25!important;box-sizing:border-box!important;transition:transform 0.15s ease, opacity 0.15s ease;">
          ${p.buttonText}
        </button>
      </div>
    `;
  }).join("");

  modal.innerHTML = `
    <div style="width:100%;max-width:${targetPlans.length === 1 ? '420px' : (targetPlans.length === 2 ? '540px' : '680px')};background:#0f111a;border:1px solid rgba(255,255,255,0.12);border-radius:24px;padding:28px 24px;box-shadow:0 24px 64px rgba(0,0,0,0.95);color:#fff;font-family:sans-serif;margin:auto;position:relative;box-sizing:border-box;">
      
      <button id="__paywall-close-btn" type="button" aria-label="Close" style="position:absolute;top:16px;right:16px;width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#94a3b8;font-size:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;line-height:1;transition:all 0.15s ease;">×</button>

      <div style="text-align:center;margin-bottom:20px;padding-right:20px;padding-left:20px;">
        <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;background:${reqTier==='ENTERPRISE'?'rgba(245,158,11,0.15)':'rgba(16,185,129,0.15)'};border:1px solid ${reqTier==='ENTERPRISE'?'rgba(245,158,11,0.4)':'rgba(16,185,129,0.4)'};border-radius:50%;font-size:26px;margin-bottom:12px;">
          🔒
        </div>
        <h2 style="font-size:19px;font-weight:900;margin:0 0 8px;color:#fff;letter-spacing:-0.3px;">
          ${cleanName} LOCKED
        </h2>
        <p style="font-size:13px;color:#cbd5e1;margin:0;line-height:1.5;">
          ${subText}
        </p>

        ${isFreeQuotaFeature ? `
        <!-- Daily Quota Live Reset Countdown Banner -->
        <div style="margin-top:14px; padding:8px 14px; border-radius:10px; background:rgba(255,179,71,0.1); border:1px solid rgba(255,179,71,0.3); font-size:11.5px; font-weight:700; color:#fbbf24; display:inline-flex; align-items:center; gap:8px;">
          <span>⏳ Daily Free Quota resets at midnight in:</span>
          <span id="vx-modal-live-countdown" style="font-family:monospace; font-weight:900; font-size:13px; color:#ffffff; background:rgba(0,0,0,0.4); padding:2px 8px; border-radius:5px;">${liveCountdownStr}</span>
        </div>` : ''}
      </div>

      <!-- Plan Cards Grid -->
      <div style="display:grid;grid-template-columns:${targetPlans.length === 1 ? '1fr' : 'repeat(auto-fit, minmax(200px, 1fr))'};gap:14px;margin-bottom:24px;">
        ${cardsHtml}
      </div>

      <!-- Action Footer -->
      <div style="display:flex;gap:12px;">
        <button id="__paywall-dismiss" style="flex:1;height:42px;background:transparent;border:1px solid rgba(255,255,255,0.15);color:#94a3b8;font-size:12.5px;font-weight:700;border-radius:10px;cursor:pointer;">
          Return to Checkout
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
  document.getElementById("__paywall-close-btn")?.addEventListener("click", handleDismiss);
  modal.addEventListener("click", (e) => { if (e.target === modal) handleDismiss(); });

  modal.querySelectorAll(".__btn-select-tier").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const selectedTier = btn.dataset.tier;
      const curTier = getActiveTier();

      if (selectedTier === curTier || (selectedTier === 'PRO' && curTier === 'GROWTH')) {
        modal.remove();
        return;
      }

      modal.remove();
      if (typeof window.switchActiveScreen === 'function') {
        window.switchActiveScreen('subscription');
      }
      if (window.ValenixiaSubscription && typeof window.ValenixiaSubscription.selectPlan === 'function') {
        window.ValenixiaSubscription.selectPlan(selectedTier);
      }
    });
  });
}
window.showUpgradeModal = showUpgradeModal;
window.showPaywallModal = showUpgradeModal;

// ── Smart Free Tier Quota Limit Reached Modal ──────────────────────────────
function showLimitReachedModal(limitType, currentCount, maxLimit) {
  const existing = document.getElementById("limit-reached-modal") || document.getElementById("paywall-modal");
  if (existing) existing.remove();

  const limits = getLimits();
  const remSec = getMidnightRemainingSeconds();
  const countdownStr = formatCountdown(remSec);

  let limitTitle = 'Free Plan Limit Reached';
  let limitDesc = '';
  let countStr = '';

  if (limitType === 'daily_transactions' || limitType === 'transactions' || limitType === 'daily_transactions_quota') {
    const cur = currentCount !== undefined ? currentCount : (getDailyTransactionCount().count);
    const max = maxLimit || limits.transactionsPerDay || 20;
    limitTitle = 'Daily Sales Quota Reached';
    countStr = `${cur} / ${max} Daily Sales Used`;
    limitDesc = `You have completed all <strong>${max} daily transactions</strong> included in the <strong>Free Basic Plan</strong> for today.<br><br>The free quota will automatically replenish at midnight (in <strong>${countdownStr}</strong>). Upgrade to <strong>Starter</strong> to process unlimited sales immediately without downtime.`;
  } else if (limitType === 'products' || limitType === 'catalog') {
    const cur = currentCount !== undefined ? currentCount : (window.state?.catalog?.length || 25);
    const max = maxLimit || limits.products || 25;
    limitTitle = 'Product Inventory Limit Reached';
    countStr = `${cur} / ${max} SKUs Registered`;
    limitDesc = `You have reached the maximum limit of <strong>${max} products</strong> allowed on the <strong>Free Basic Plan</strong>.<br><br>Upgrade to the <strong>Starter Plan</strong> to unlock <strong>Unlimited Products &amp; Catalog SKUs</strong> with full barcode scanning and inventory tracking.`;
  } else if (limitType === 'customers') {
    const cur = currentCount !== undefined ? currentCount : (window.state?.customers?.length || 50);
    const max = maxLimit || limits.customers || 50;
    limitTitle = 'Customer Directory Limit Reached';
    countStr = `${cur} / ${max} Customers Saved`;
    limitDesc = `You have reached the maximum limit of <strong>${max} customer records</strong> allowed on the <strong>Free Basic Plan</strong>.<br><br>Upgrade to <strong>Starter</strong> or <strong>Pro</strong> to store unlimited customers with loyalty points and credit history.`;
  } else if (limitType === 'employees' || limitType === 'staff') {
    limitTitle = 'Staff PIN & Cashier Limit Reached';
    countStr = `1 / 1 Cashier Active`;
    limitDesc = `The Free Basic Plan supports a single primary terminal operator. To register multiple staff members, manager PINs, and shift logs, upgrade to <strong>Starter</strong> or <strong>Growth (Pro)</strong>.`;
  } else if (limitType === 'import_rows') {
    limitTitle = 'Batch Import Size Limit';
    countStr = `${currentCount || 25}+ Rows Detected`;
    limitDesc = `Bulk Excel / CSV inventory import is limited to 25 items on Free Basic. Upgrade to <strong>Starter</strong> for unlimited bulk catalog imports.`;
  } else if (limitType === 'buybacks') {
    limitTitle = 'Device Buyback Limit Reached';
    countStr = `5 / 5 Buybacks Today`;
    limitDesc = `Daily device buyback and customer trade-in records reached. Upgrade to <strong>Starter</strong> for unlimited trade-in transactions.`;
  } else {
    limitTitle = 'Plan Limit Reached';
    limitDesc = `You have reached the free tier allowance for this feature. Upgrade to <strong>Starter</strong> to unlock unlimited access.`;
  }

  const modal = document.createElement("div");
  modal.id = "limit-reached-modal";
  modal.className = "modal-overlay active";
  modal.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(5,7,15,0.92);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);overflow-y:auto;";

  modal.innerHTML = `
    <div style="width:100%;max-width:520px;background:#0d111c;border:1px solid rgba(245,158,11,0.35);border-radius:24px;padding:28px 24px;box-shadow:0 24px 64px rgba(0,0,0,0.95), 0 0 30px rgba(245,158,11,0.15);color:#fff;font-family:var(--font-sans, system-ui, sans-serif);margin:auto;position:relative;box-sizing:border-box;">
      
      <button id="__limit-close-btn" type="button" aria-label="Close" style="position:absolute;top:16px;right:16px;width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#94a3b8;font-size:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;line-height:1;transition:all 0.15s ease;">×</button>

      <div style="text-align:center;margin-bottom:20px;padding:0 10px;">
        <div style="display:inline-flex;align-items:center;justify-content:center;width:60px;height:60px;background:rgba(245,158,11,0.15);border:2px solid rgba(245,158,11,0.4);border-radius:50%;font-size:28px;margin-bottom:12px;box-shadow:0 0 20px rgba(245,158,11,0.25);">
          ⚠️
        </div>
        <div style="display:inline-block;padding:3px 10px;border-radius:12px;background:rgba(245,158,11,0.2);color:#f59e0b;font-size:10px;font-weight:900;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;">FREE TIER QUOTA LIMIT</div>
        <h2 style="font-size:20px;font-weight:900;margin:0 0 6px;color:#fff;letter-spacing:-0.3px;">
          ${limitTitle}
        </h2>
        ${countStr ? `<div style="font-size:12px;font-family:var(--font-mono, monospace);font-weight:800;color:#38bdf8;margin-bottom:12px;">📊 ${countStr}</div>` : ''}
        <div style="font-size:13px;color:#cbd5e1;line-height:1.5;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);padding:12px;border-radius:12px;text-align:left;">
          ${limitDesc}
        </div>
      </div>

      <!-- High-Converting Starter Tier Offer Card -->
      <div style="background:linear-gradient(135deg, rgba(6,182,212,0.12), rgba(16,185,129,0.08));border:1.5px solid rgba(6,182,212,0.4);border-radius:16px;padding:16px;margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div>
            <span style="font-size:10px;font-weight:900;color:#06b6d4;text-transform:uppercase;letter-spacing:0.5px;">RECOMMENDED SOLUTION</span>
            <div style="font-size:16px;font-weight:900;color:#fff;">Valenixia Starter Plan</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:18px;font-weight:900;color:#00d68f;">Rs. 3,499<span style="font-size:10px;color:#94a3b8;font-weight:500;">/mo</span></div>
            <span style="font-size:9px;color:#cbd5e1;">Instant Activation</span>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;color:#e2e8f0;margin-bottom:14px;">
          <div style="display:flex;align-items:center;gap:6px;"><span style="color:#00d68f;font-weight:900;">✓</span> Unlimited Daily Sales</div>
          <div style="display:flex;align-items:center;gap:6px;"><span style="color:#00d68f;font-weight:900;">✓</span> Unlimited Inventory SKUs</div>
          <div style="display:flex;align-items:center;gap:6px;"><span style="color:#00d68f;font-weight:900;">✓</span> Suppliers &amp; Ledger</div>
          <div style="display:flex;align-items:center;gap:6px;"><span style="color:#00d68f;font-weight:900;">✓</span> Financial P&amp;L Analytics</div>
          <div style="display:flex;align-items:center;gap:6px;"><span style="color:#00d68f;font-weight:900;">✓</span> Customer Credit Khata</div>
          <div style="display:flex;align-items:center;gap:6px;"><span style="color:#00d68f;font-weight:900;">✓</span> Clean Thermal Printing</div>
        </div>

        <button id="__btn-limit-upgrade-starter" type="button" style="width:100%;padding:11px;background:linear-gradient(135deg, #06b6d4, #00d68f);color:#0f172a;font-size:13px;font-weight:900;border:none;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 4px 16px rgba(6,182,212,0.35);transition:all 0.15s ease;">
          <span>⚡ Upgrade to Starter Plan Now</span>
          <span style="font-size:14px;">→</span>
        </button>
      </div>

      <!-- Action Links -->
      <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;">
        <button id="__btn-limit-view-plans" type="button" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:#cbd5e1;font-size:11.5px;font-weight:700;padding:8px 14px;border-radius:8px;cursor:pointer;">
          Compare All Plans
        </button>
        <button id="__btn-limit-enter-claim" type="button" style="background:transparent;border:1px solid rgba(0,214,143,0.3);color:#00d68f;font-size:11.5px;font-weight:700;padding:8px 14px;border-radius:8px;cursor:pointer;">
          Enter Payment Claim
        </button>
        <button id="__limit-dismiss" type="button" style="background:transparent;border:none;color:#64748b;font-size:11.5px;cursor:pointer;padding:8px 10px;">
          Close
        </button>
      </div>

    </div>
  `;

  document.body.appendChild(modal);

  const dismiss = () => modal.remove();
  document.getElementById("__limit-close-btn")?.addEventListener("click", dismiss);
  document.getElementById("__limit-dismiss")?.addEventListener("click", dismiss);
  modal.addEventListener("click", (e) => { if (e.target === modal) dismiss(); });

  document.getElementById("__btn-limit-upgrade-starter")?.addEventListener("click", () => {
    modal.remove();
    if (typeof window.switchActiveScreen === 'function') {
      window.switchActiveScreen('subscription');
    }
    if (window.ValenixiaSubscription && typeof window.ValenixiaSubscription.selectPlan === 'function') {
      window.ValenixiaSubscription.selectPlan('STARTER');
    }
  });

  document.getElementById("__btn-limit-view-plans")?.addEventListener("click", () => {
    modal.remove();
    if (typeof window.switchActiveScreen === 'function') {
      window.switchActiveScreen('subscription');
    }
    if (window.ValenixiaSubscription && typeof window.ValenixiaSubscription.activateTab === 'function') {
      window.ValenixiaSubscription.activateTab('plans');
    }
  });

  document.getElementById("__btn-limit-enter-claim")?.addEventListener("click", () => {
    modal.remove();
    if (typeof window.switchActiveScreen === 'function') {
      window.switchActiveScreen('subscription');
    }
    if (window.ValenixiaSubscription && typeof window.ValenixiaSubscription.activateTab === 'function') {
      window.ValenixiaSubscription.activateTab('claim');
    }
  });
}
window.showLimitReachedModal = showLimitReachedModal;

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

