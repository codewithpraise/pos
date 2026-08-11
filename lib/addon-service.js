// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - DATA-DRIVEN ADDON CATALOG SCHEMA
// Explicit lifecycle, entitlement keys, setup requirements, and expiry policies
// ============================================================================

const { db } = require('../database');

/**
 * Data-Driven Master Addon Catalog Definition
 */
const ADDON_CATALOG = [
  {
    id: 'addon_fbr_digital_invoicing',
    name: 'FBR Digital Invoicing',
    category: 'COMPLIANCE',
    priceMinor: 249900, // Rs. 2,499
    billingPeriod: 'ONE_TIME',
    status: 'AVAILABLE_NOW',
    badge: 'MOST REQUESTED',
    shortDescription: 'FBR fiscal setup, submission queue, and invoice number tracking.',
    benefits: [
      'Guided PRAL & licensed integrator setup wizard',
      'Non-blocking offline submission queue & retry engine',
      'Authoritative FBR USIN & QR receipt printing'
    ],
    entitlementKeys: ['fbr', 'fbr_fiscalization'],
    setupRequired: true,
    activationMethod: 'ADMIN_APPROVAL',
    expiryPolicy: 'PERPETUAL_ONETIME',
    commercialBoundaryNotice: 'FBR Integration Setup — We configure Valenixia for your approved FBR/authorized integration pathway. Government/integrator registration, credentials, approvals, and any third-party charges remain separate where applicable.',
    setupChecklist: [
      'Confirm business eligibility for FBR electronic invoicing',
      'Select PRAL or licensed integrator pathway',
      'Obtain required NTN/STRN authorization credentials',
      'Enter credentials into Valenixia for validation',
      'Run test transaction to confirm Production Connected status'
    ]
  },
  {
    id: 'addon_smart_stock_alerts',
    name: 'Smart Stock Alerts',
    category: 'INVENTORY',
    priceMinor: 49900, // Rs. 499/mo
    billingPeriod: 'MONTHLY',
    status: 'AVAILABLE_NOW',
    badge: 'POPULAR',
    shortDescription: 'Deterministic inventory reorder points and stockout warnings.',
    benefits: [
      'Average daily sales velocity tracking',
      'Automated reorder point & safety stock math',
      'Critical stockout notifications'
    ],
    entitlementKeys: ['smart_stock'],
    setupRequired: false,
    activationMethod: 'ADMIN_APPROVAL',
    expiryPolicy: 'DISABLE_FEATURE_PRESERVE_DATA',
    setupChecklist: [
      'Set supplier lead time in product settings',
      'Configure minimum safety stock thresholds'
    ]
  },
  {
    id: 'addon_cloud_backup',
    name: 'Automatic Cloud Backup',
    category: 'OPERATIONS',
    priceMinor: 39900, // Rs. 399/mo
    billingPeriod: 'MONTHLY',
    status: 'AVAILABLE_NOW',
    badge: 'ESSENTIAL',
    shortDescription: 'Encrypted daily database backups to your personal Google Drive.',
    benefits: [
      'AES-256-GCM encrypted snapshot backups',
      'Direct upload to user Google Drive storage',
      'One-click disaster recovery restore'
    ],
    entitlementKeys: ['cloud_backup'],
    setupRequired: true,
    activationMethod: 'ADMIN_APPROVAL',
    expiryPolicy: 'DISABLE_FEATURE_PRESERVE_DATA',
    setupChecklist: [
      'Authenticate with personal Google Drive account',
      'Grant application backup folder permissions'
    ]
  },
  {
    id: 'addon_purchase_manager',
    name: 'Purchase & Supplier Manager',
    category: 'INVENTORY',
    priceMinor: 79900, // Rs. 799/mo
    billingPeriod: 'MONTHLY',
    status: 'COMING_SOON',
    shortDescription: 'Supplier catalog management and automated purchase orders.',
    benefits: [
      'Supplier product mapping & cost tracking',
      'One-click Purchase Order generation from stock alerts',
      'Partial & full inventory receiving'
    ],
    entitlementKeys: ['purchase_orders'],
    setupRequired: false,
    activationMethod: 'ADMIN_APPROVAL',
    expiryPolicy: 'DISABLE_FEATURE_PRESERVE_DATA'
  },
  {
    id: 'addon_loyalty_rewards',
    name: 'Loyalty & Customer Rewards',
    category: 'CUSTOMERS',
    priceMinor: 69900, // Rs. 699/mo
    billingPeriod: 'MONTHLY',
    status: 'COMING_SOON',
    shortDescription: 'Customer reward points, tiers, and store credit.',
    benefits: [
      'Points per rupee spending allocation',
      'Store credit redemption at checkout',
      'Click-to-chat WhatsApp customer links'
    ],
    entitlementKeys: ['customer_loyalty'],
    setupRequired: false,
    activationMethod: 'ADMIN_APPROVAL',
    expiryPolicy: 'DISABLE_FEATURE_PRESERVE_DATA'
  },
  {
    id: 'addon_advanced_analytics',
    name: 'Advanced Analytics',
    category: 'REPORTS',
    priceMinor: 99900, // Rs. 999/mo
    billingPeriod: 'MONTHLY',
    status: 'COMING_SOON',
    shortDescription: 'Comprehensive sales, profit margin, and category telemetry.',
    benefits: [
      'Gross profit & profit margin breakdown',
      'Fast vs slow moving catalog analysis',
      'Rule-based "Needs Attention" business audit'
    ],
    entitlementKeys: ['advanced_analytics'],
    setupRequired: false,
    activationMethod: 'ADMIN_APPROVAL',
    expiryPolicy: 'DISABLE_FEATURE_PRESERVE_DATA'
  },
  {
    id: 'addon_advanced_branch_ops',
    name: 'Advanced Branch Operations',
    category: 'OPERATIONS',
    priceMinor: 149900, // Rs. 1,499/mo
    billingPeriod: 'MONTHLY',
    status: 'COMING_SOON',
    shortDescription: 'Multi-branch performance metrics and stock transfers.',
    benefits: [
      'Inter-branch stock transfer management',
      'Cross-branch sales & margin comparison',
      'Branch-specific inventory alerts'
    ],
    entitlementKeys: ['branch_transfers'],
    setupRequired: false,
    activationMethod: 'ADMIN_APPROVAL',
    expiryPolicy: 'DISABLE_FEATURE_PRESERVE_DATA'
  },
  {
    id: 'addon_staff_pro',
    name: 'Staff & Attendance Pro',
    category: 'OPERATIONS',
    priceMinor: 59900, // Rs. 599/mo
    billingPeriod: 'MONTHLY',
    status: 'COMING_SOON',
    shortDescription: 'Granular cashier permissions and shift accountability.',
    benefits: [
      'PIN-based shift tracking & cash drawer audits',
      'Role-based permission enforcement',
      'Sales & void tracking by employee'
    ],
    entitlementKeys: ['staff_pro'],
    setupRequired: false,
    activationMethod: 'ADMIN_APPROVAL',
    expiryPolicy: 'DISABLE_FEATURE_PRESERVE_DATA'
  },
  {
    id: 'addon_accountant_reports',
    name: 'Accountant Reports',
    category: 'REPORTS',
    priceMinor: 69900, // Rs. 699/mo
    billingPeriod: 'MONTHLY',
    status: 'COMING_SOON',
    shortDescription: 'Exportable financial ledgers, tax reports, and valuations.',
    benefits: [
      'Formatted CSV & XLSX accounting exports',
      'Inventory valuation & cash reconciliation',
      'Daily/Monthly tax breakdown tables'
    ],
    entitlementKeys: ['accountant_reports', 'reports.accountant'],
    setupRequired: false,
    activationMethod: 'ADMIN_APPROVAL',
    expiryPolicy: 'DISABLE_FEATURE_PRESERVE_DATA'
  },
  {
    id: 'addon_whatsapp_receipts',
    name: 'WhatsApp Receipts & Messaging',
    category: 'CUSTOMER_ENGAGEMENT',
    priceMinor: 99900, // Rs. 999/mo
    billingPeriod: 'MONTHLY',
    status: 'AVAILABLE_NOW',
    badge: 'NEW',
    shortDescription: 'Send digital receipts and customer notifications on WhatsApp.',
    benefits: [
      'Instant digital PDF & text receipt sharing via WhatsApp',
      'No per-message API surcharge',
      'Automated customer credit reminders'
    ],
    entitlementKeys: ['whatsappReceipts', 'whatsapp_receipts', 'whatsapp.receipts'],
    setupRequired: false,
    activationMethod: 'ADMIN_APPROVAL',
    expiryPolicy: 'DISABLE_FEATURE_PRESERVE_DATA'
  },
  {
    id: 'addon_audit_logs',
    name: 'Audit Trail & Action Logs',
    category: 'SECURITY',
    priceMinor: 49900, // Rs. 499/mo
    billingPeriod: 'MONTHLY',
    status: 'AVAILABLE_NOW',
    badge: 'SECURITY',
    shortDescription: 'Cryptographic hash-chained system action logs and security history.',
    benefits: [
      'Immutable cryptographic hash-chain verification',
      'Exportable CSV audit trail for compliance',
      'Detailed employee action history'
    ],
    entitlementKeys: ['audit_logs', 'staff.auditLogs'],
    setupRequired: false,
    activationMethod: 'ADMIN_APPROVAL',
    expiryPolicy: 'DISABLE_FEATURE_PRESERVE_DATA'
  }
];

class AddonService {
  static getCatalog(category = 'ALL') {
    if (category === 'ALL') return ADDON_CATALOG;
    return ADDON_CATALOG.filter(a => a.category === category);
  }

  static getAddonById(addonId) {
    if (!addonId) return null;
    const cleanId = addonId.toLowerCase().trim();
    return ADDON_CATALOG.find(a => 
      a.id === addonId || 
      a.id === `addon_${cleanId}` || 
      a.id.toLowerCase().includes(cleanId) ||
      (a.entitlementKeys && a.entitlementKeys.some(k => k.toLowerCase() === cleanId))
    ) || null;
  }

  static async getOrganizationAddons(organizationId) {
    const records = await db.all(
      `SELECT * FROM addon_pricing WHERE active = 1`
    );
    return records;
  }

  static async isAddonActive(organizationId, addonId) {
    const record = await db.get(
      `SELECT * FROM local_preferences WHERE key = ?`,
      [`addon_active_${organizationId}_${addonId}`]
    );

    if (!record || !record.value_payload) return false;

    try {
      const payload = JSON.parse(record.value_payload);
      if (payload.status !== 'ACTIVE') return false;

      // Expiry Check
      if (payload.expiresAt && Date.now() > payload.expiresAt) {
        payload.status = 'EXPIRED';
        await db.run(`UPDATE local_preferences SET value_payload = ? WHERE key = ?`, [
          JSON.stringify(payload),
          `addon_active_${organizationId}_${addonId}`
        ]);
        return false;
      }
      return true;
    } catch (_) {
      return record.value_payload === 'ACTIVE';
    }
  }

  static async getAddonLifecycleState(organizationId, addonId) {
    const activeRecord = await db.get(
      `SELECT * FROM local_preferences WHERE key = ?`,
      [`addon_active_${organizationId}_${addonId}`]
    );

    if (activeRecord && activeRecord.value_payload) {
      try {
        const payload = JSON.parse(activeRecord.value_payload);
        if (payload.status === 'ACTIVE') {
          if (payload.expiresAt && payload.expiresAt - Date.now() < 7 * 86400000) {
            return 'EXPIRING';
          }
          return 'ACTIVE';
        }
        if (payload.status === 'REVOKED') return 'REVOKED';
        if (payload.status === 'EXPIRED') return 'EXPIRED';
      } catch (_) {}
    }

    const claimRows = await db.all(
      `SELECT * FROM local_preferences WHERE key LIKE 'payment_claim_%'`
    );

    for (const row of claimRows) {
      try {
        const claim = JSON.parse(row.value_payload);
        if (claim.organizationId === organizationId && (claim.addonId === addonId || claim.planId === addonId)) {
          if (claim.status === 'PENDING' || claim.status === 'UNDER_REVIEW') return 'UNDER_REVIEW';
          if (claim.status === 'PAYMENT_CLAIMED' || claim.status === 'SUBMITTED') return 'PAYMENT_CLAIMED';
        }
      } catch (_) {}
    }

    return 'LOCKED';
  }

  static async classifyEntitlements(organizationId) {
    const addonRows = await db.all(
      `SELECT * FROM local_preferences WHERE key LIKE ?`,
      [`addon_active_${organizationId}_%`]
    );

    const classifications = [];

    for (const r of addonRows) {
      const addonId = r.key.replace(`addon_active_${organizationId}_`, '');
      let payload = {};
      try { payload = JSON.parse(r.value_payload); } catch (_) {}

      let category = 'UNKNOWN';

      if (payload.activatedBy === 'ADMIN' || payload.activatedBy === 'PLATFORM_ADMIN') {
        category = 'ADMIN_GRANTED';
      } else if (payload.paymentRef || payload.rrn_reference) {
        category = 'VALID_PAID';
      } else if (payload.isGrandfathered) {
        category = 'VALID_GRANDFATHERED';
      } else {
        category = 'INVALID_ORPHANED';
      }

      classifications.push({
        addonId,
        status: payload.status || 'UNKNOWN',
        category,
        activatedAt: payload.activatedAt || null,
        expiresAt: payload.expiresAt || null,
        activatedBy: payload.activatedBy || null
      });
    }

    return {
      organizationId,
      total: classifications.length,
      validPaid: classifications.filter(c => c.category === 'VALID_PAID'),
      validGrandfathered: classifications.filter(c => c.category === 'VALID_GRANDFATHERED'),
      adminGranted: classifications.filter(c => c.category === 'ADMIN_GRANTED'),
      invalidOrphaned: classifications.filter(c => c.category === 'INVALID_ORPHANED'),
      classifications
    };
  }
}

module.exports = {
  ADDON_CATALOG,
  AddonService
};
