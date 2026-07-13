// ============================================================================
// VALENIXIA FREEMIUM ENGINE — Tier System, Feature Gates, Upgrade Modals
// Version: 1.0.0
// All plans are FREE during beta — limits enforced so the system is tested.
// Flip window.__valenixiaPlan to a paid tier to unlock features.
// ============================================================================
"use strict";
(function() {

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
    displayName: "Valenixia Basic",
    monthlyPKR: 0, annualPKR: 0, lifetimePKR: null,
    devices: 1, transactionsPerMonth: 100, products: 50, customers: 50, employees: 1,
    transactionHistoryDays: 1, receiptBranding: "valenixia",
    backup: false, fbrCompliance: false, multiDeviceSync: false, apiAccess: false,
    analytics: "none", importLimit: 0, support: "community"
  },
  [PLANS.STARTER]: {
    displayName: "Valenixia Growth",
    monthlyPKR: 2499, annualPKR: 24999, lifetimePKR: 49999,
    devices: 1, transactionsPerMonth: Infinity, products: 500, customers: Infinity, employees: 3,
    transactionHistoryDays: 7, receiptBranding: "custom",
    backup: "manual", fbrCompliance: false, multiDeviceSync: false, apiAccess: false,
    analytics: "basic", importLimit: 50, support: "whatsapp"
  },
  [PLANS.GROWTH]: {
    displayName: "Valenixia Pro",
    monthlyPKR: 5999, annualPKR: 59999, lifetimePKR: 119999,
    devices: 3, transactionsPerMonth: Infinity, products: Infinity, customers: Infinity, employees: 10,
    transactionHistoryDays: Infinity, receiptBranding: "custom",
    backup: "auto_daily", fbrCompliance: true, multiDeviceSync: true, apiAccess: false,
    analytics: "advanced", importLimit: Infinity, support: "priority"
  },
  [PLANS.PRO]: {
    displayName: "Valenixia Business",
    monthlyPKR: 12999, annualPKR: 129999, lifetimePKR: 249999,
    devices: 10, transactionsPerMonth: Infinity, products: Infinity, customers: Infinity, employees: 50,
    transactionHistoryDays: Infinity, receiptBranding: "white_label",
    backup: "auto_daily", fbrCompliance: true, multiDeviceSync: true, apiAccess: true,
    analytics: "full", importLimit: Infinity, support: "phone"
  },
  [PLANS.ENTERPRISE]: {
    displayName: "Valenixia Enterprise",
    monthlyPKR: null, annualPKR: null, lifetimePKR: null,
    devices: Infinity, transactionsPerMonth: Infinity, products: Infinity, customers: Infinity, employees: Infinity,
    transactionHistoryDays: Infinity, receiptBranding: "white_label",
    backup: "auto_realtime", fbrCompliance: true, multiDeviceSync: true, apiAccess: true,
    analytics: "full", importLimit: Infinity, support: "dedicated"
  }
};

const ADDONS = [
  { id: "extra_device",  name: "Extra Device",      pricePKR: 999,   period: "/month" },
  { id: "extra_branch",  name: "Extra Branch",       pricePKR: 4999,  period: "/month" },
  { id: "fbr_module",    name: "FBR Compliance",     pricePKR: 1499,  period: "/month" },
  { id: "extra_backup",  name: "Daily Auto-Backup",  pricePKR: 499,   period: "/month" },
  { id: "setup_onsite",  name: "On-site Setup",      pricePKR: 15000, period: " one-time" }
];

const TIER_TO_PLAN = {
  TRIAL: "growth", STANDARD: "starter", STARTER: "starter",
  GROWTH: "growth", PRO: "pro", ENTERPRISE: "enterprise"
};

function getCurrentPlan() {
  const saved = localStorage.getItem('valenixia_plan');
  if (saved) {
    window.__valenixiaPlan = saved;
    return saved;
  }
  const tier = (window.__valenixiaTier || "STARTER").toUpperCase();
  const mapped = TIER_TO_PLAN[tier] || PLANS.STARTER;
  window.__valenixiaPlan = mapped;
  return mapped;
}

function getLimits() {
  return PLAN_LIMITS[getCurrentPlan()] || PLAN_LIMITS[PLANS.FREE];
}

function can(feature) {
  const limits = getLimits();
  const map = {
    "checkout": true, "receipt_print": true, "nayapay_qr": true, "voice_input": true,
    "whatsapp_share": true, "email_share": true, "offline_mode": true, "thermal_receipt": true,
    "product_catalog": limits.products > 0,
    "customer_database": limits.customers > 0,
    "transaction_history": limits.transactionHistoryDays > 0,
    "full_history": limits.transactionHistoryDays === Infinity,
    "staff_management": limits.employees > 1,
    "multi_device_sync": limits.multiDeviceSync,
    "analytics": limits.analytics !== "none",
    "advanced_analytics": ["advanced","full"].includes(limits.analytics),
    "full_analytics": limits.analytics === "full",
    "google_drive_backup": !!limits.backup,
    "auto_backup": ["auto_daily","auto_realtime"].includes(limits.backup),
    "excel_import": limits.importLimit > 0,
    "unlimited_import": limits.importLimit === Infinity,
    "fbr_compliance": limits.fbrCompliance,
    "api_access": limits.apiAccess,
    "white_label": limits.receiptBranding === "white_label",
    "custom_receipt": ["custom","white_label"].includes(limits.receiptBranding),
    "receipt_no_watermark": limits.receiptBranding !== "valenixia",
    "promotions": ["advanced","full"].includes(limits.analytics),
    "loyalty": ["advanced","full"].includes(limits.analytics),
    "inventory_forecast": limits.analytics === "full",
    "multi_branch": limits.devices > 3,
    "priority_support": ["priority","phone","dedicated"].includes(limits.support),
    "supplier_management": limits.transactionHistoryDays > 1,
    "purchase_orders": limits.transactionHistoryDays > 1,
    "credit_ledger": limits.analytics !== "none",
    "barcode_generation": limits.products > 50,
    "low_stock_alerts": limits.analytics !== "none",
    "audit_log_export": limits.analytics === "full"
  };
  return map[feature] !== undefined ? map[feature] : false;
}
window.can = can;

function checkLimit(type, currentCount) {
  const limits = getLimits();
  const limitMap = {
    products: limits.products, customers: limits.customers, employees: limits.employees,
    devices: limits.devices, transactions_per_month: limits.transactionsPerMonth,
    import_rows: limits.importLimit
  };
  const limit = limitMap[type];
  if (limit === undefined || limit === Infinity) return { allowed: true };
  if (currentCount >= limit) return { allowed: false, limit, current: currentCount,
    reason: "Limit reached: " + limit + " " + type + " on " + getLimits().displayName };
  return { allowed: true, limit, remaining: limit - currentCount };
}
window.checkLimit = checkLimit;

function getMonthlyTransactionCount() {
  const now = new Date();
  const monthKey = "vx_tx_" + now.getFullYear() + "_" + now.getMonth();
  const stored = JSON.parse(localStorage.getItem(monthKey) || "{\"count\":0}");
  return { count: stored.count, monthKey };
}

function incrementMonthlyTransactionCount() {
  const { count, monthKey } = getMonthlyTransactionCount();
  localStorage.setItem(monthKey, JSON.stringify({ count: count + 1 }));
  return count + 1;
}
window.getMonthlyTransactionCount = getMonthlyTransactionCount;
window.incrementMonthlyTransactionCount = incrementMonthlyTransactionCount;

function isLimitReached() {
  const { count } = getMonthlyTransactionCount();
  const limits = getLimits();
  const limit = limits.transactionsPerMonth;
  return { blocked: count >= limit, current: count, limit };
}
window.isLimitReached = isLimitReached;

function getTrialStatus() {
  const trialStart = parseInt(localStorage.getItem("valenixia_trial_start") || "0");
  if (!trialStart) return { phase: "none" };
  const now = Date.now();
  const daysElapsed = Math.floor((now - trialStart) / 86400000);
  const daysLeft = 14 - daysElapsed;
  if (daysLeft > 3)  return { phase: "active", daysLeft };
  if (daysLeft > 0)  return { phase: "warning", daysLeft };
  if (daysLeft > -1) return { phase: "grace", hoursLeft: Math.max(0, 24 + daysLeft * 24) };
  return { phase: "expired" };
}
window.getTrialStatus = getTrialStatus;

function applyReceiptBranding(receiptData) {
  const limits = getLimits();
  if (limits.receiptBranding === "valenixia") {
    receiptData.footerText = (receiptData.footerText ? receiptData.footerText + "\n\n" : "")
      + "---\nPowered by Valenixia POS\nvalenixia.com | Free for small shops";
  }
  return receiptData;
}
window.applyReceiptBranding = applyReceiptBranding;

function formatPKR(amount) {
  if (!amount && amount !== 0) return "Contact Us";
  if (amount === 0) return "Free";
  return "Rs. " + Number(amount).toLocaleString("en-PK");
}

function showUpgradeModal(featureName) {
  document.getElementById("__vx-upgrade-modal")?.remove();
  const current = getCurrentPlan();
  const plans = [PLANS.STARTER, PLANS.GROWTH, PLANS.PRO, PLANS.ENTERPRISE];

  const planRows = plans.map(function(p) {
    const l = PLAN_LIMITS[p];
    const isCurrent = p === current;
    const border = isCurrent ? "2px solid #10b981" : "1px solid rgba(255,255,255,0.08)";
    const badge = isCurrent ? "<span style='background:#10b981;color:#000;font-size:9px;font-weight:800;padding:2px 6px;border-radius:999px;margin-left:6px;'>CURRENT</span>" : "";
    const lifetimeRow = l.lifetimePKR ? "<span style='font-size:10px;color:#f59e0b;'>Lifetime: " + formatPKR(l.lifetimePKR) + "</span>" : "";
    return "<div style='border:" + border + ";border-radius:8px;padding:12px;background:rgba(255,255,255,0.02);margin-bottom:8px;'>"
      + "<div style='display:flex;align-items:center;margin-bottom:4px;'><span style='font-size:13px;font-weight:800;color:#fff;'>" + l.displayName + "</span>" + badge + "</div>"
      + "<div style='display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:4px;'>"
      + "<span style='font-size:13px;color:#10b981;font-weight:700;'>" + formatPKR(l.monthlyPKR) + "/mo</span>"
      + "<span style='font-size:11px;color:#64748b;'>" + formatPKR(l.annualPKR) + "/yr</span>"
      + lifetimeRow + "</div>"
      + "<div style='font-size:10px;color:#64748b;'>" + (l.devices === Infinity ? "Unlimited" : l.devices) + " device(s) &middot; " + (l.products === Infinity ? "Unlimited" : l.products) + " products &middot; " + (l.employees === Infinity ? "Unlimited" : l.employees) + " staff</div>"
      + "</div>";
  }).join("");

  const addonRows = ADDONS.map(function(a) {
    return "<div style='display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;padding:3px 0;'><span>" + a.name + "</span><span style='color:#f59e0b;font-weight:700;'>" + formatPKR(a.pricePKR) + a.period + "</span></div>";
  }).join("");

  const overlay = document.createElement("div");
  overlay.id = "__vx-upgrade-modal";
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:rgba(5,5,8,0.96);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);overflow-y:auto;";
  overlay.innerHTML = "<div style='max-width:480px;width:100%;background:#0d0d12;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:28px;box-shadow:0 32px 64px rgba(0,0,0,0.8);'>"
    + "<div style='text-align:center;margin-bottom:20px;'><div style='font-size:36px;margin-bottom:8px;'>&#x26A1;</div>"
    + "<h2 style='font-size:18px;font-weight:800;color:#fff;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em;'>Upgrade to Unlock</h2>"
    + "<p style='font-size:12px;color:#94a3b8;margin:0;'>" + (featureName ? "<strong style='color:#10b981;'>" + featureName + "</strong> requires a paid plan." : "Get more power for your business.") + "</p>"
    + "<p style='font-size:11px;color:#f59e0b;margin-top:8px;font-weight:600;'>&#x1F389; All features FREE during beta &mdash; subscribe to lock in early pricing.</p></div>"
    + planRows
    + "<div style='background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:8px;padding:12px;margin-bottom:16px;'>"
    + "<div style='font-size:10px;font-weight:700;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em;'>Available Add-Ons</div>"
    + addonRows + "</div>"
    + "<div style='display:flex;flex-direction:column;gap:10px;'>"
    + "<button id='__vx-upgrade-notify' style='height:44px;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.4);color:#10b981;font-size:13px;font-weight:700;border-radius:8px;cursor:pointer;font-family:inherit;'>&#x1F4F1; Notify Me When Plans Launch</button>"
    + "<button id='__vx-upgrade-close' style='height:40px;background:transparent;border:1px solid rgba(255,255,255,0.06);color:#64748b;font-size:12px;font-weight:600;border-radius:8px;cursor:pointer;font-family:inherit;'>Continue with Current Plan</button>"
    + "</div></div>";

  document.body.appendChild(overlay);
  document.getElementById("__vx-upgrade-close").addEventListener("click", function() { overlay.remove(); });
  document.getElementById("__vx-upgrade-notify").addEventListener("click", async function() {
    const phone = await showModal({
      title: "Get Early Access",
      message: "Enter your WhatsApp number. Early subscribers get 30% off launch pricing.",
      type: "info",
      actions: [{ id: "ok", label: "Notify Me", style: "primary" }, { id: "cancel", label: "Skip", style: "secondary" }],
      input: { placeholder: "03001234567", defaultValue: "" }
    });
    if (phone && phone !== "cancel" && phone !== "ok" && phone.length > 5) {
      localStorage.setItem("vx_beta_notify_phone", phone);
      overlay.remove();
      if (window.showNotificationToast) showNotificationToast("Saved! We will notify you on WhatsApp when plans launch.", null, 4000);
    }
  });
}
window.showUpgradeModal = showUpgradeModal;

function renderTrialBanner() {
  const status = getTrialStatus();
  const existing = document.getElementById("vx-trial-banner");
  if (existing) existing.remove();
  if (status.phase === "none" || status.phase === "active") return;
  const banner = document.createElement("div");
  banner.id = "vx-trial-banner";
  if (status.phase === "warning") {
    banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:linear-gradient(90deg,#f59e0b,#ef4444);color:#000;text-align:center;font-size:12px;font-weight:700;padding:8px 16px;cursor:pointer;";
    banner.textContent = "Trial ends in " + status.daysLeft + " day" + (status.daysLeft !== 1 ? "s" : "") + " — Subscribe to keep all features.";
    banner.addEventListener("click", function() { showUpgradeModal("Trial expiring soon"); });
  } else if (status.phase === "grace") {
    banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#ef4444;color:#fff;text-align:center;font-size:12px;font-weight:700;padding:8px 16px;cursor:pointer;";
    banner.textContent = "Grace period: " + status.hoursLeft + "h remaining. App goes read-only after expiry.";
    banner.addEventListener("click", function() { showUpgradeModal("Grace period"); });
  }
  document.body.prepend(banner);
}
window.renderTrialBanner = renderTrialBanner;

window.PLANS = PLANS;
window.PLAN_LIMITS = PLAN_LIMITS;
window.getCurrentPlan = getCurrentPlan;
window.getLimits = getLimits;

})();
