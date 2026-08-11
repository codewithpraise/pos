// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM — MASTER FEATURE REGISTRY & AUTHORIZATION CATALOG
// Single source of truth for commercial features, plans, add-ons, scopes, and roles.
// ============================================================================
"use strict";

const FEATURE_REGISTRY = {
  "whatsapp.receipts": {
    featureKey: "whatsapp.receipts",
    displayName: "WhatsApp Digital Receipts & Customer Messaging",
    type: "ADDON_REQUIRED",
    addonId: "WHATSAPP_RECEIPTS",
    requiredPlan: "ANY",
    scope: "ORGANIZATION",
    dependencies: [],
    roles: ["owner", "admin", "branch_manager", "cashier"],
    apiActions: ["receipt.send_whatsapp", "whatsapp.send"],
    frontendEntrypoints: ["public/digital-receipt.js", "public/app.js (#btn-credit-whatsapp)"],
    backendEndpoints: ["/api/receipts/whatsapp", "/api/whatsapp/send"],
    databaseTables: ["organization_addons", "entitlement_audit_log"],
    auditEvent: "WHATSAPP_RECEIPT_SENT"
  },

  "fbr.fiscal": {
    featureKey: "fbr.fiscal",
    displayName: "FBR Digital POS Invoicing & Real-Time Tax Reporting",
    type: "ADDON_REQUIRED",
    addonId: "FBR_FISCAL",
    requiredPlan: "ANY",
    scope: "ORGANIZATION",
    dependencies: [],
    roles: ["owner", "admin", "branch_manager", "cashier"],
    apiActions: ["fbr.invoice.submit", "fbr.status.check"],
    frontendEntrypoints: ["public/app.js (#setting-tax-mode)"],
    backendEndpoints: ["/api/fbr/invoice", "/api/fbr/status"],
    databaseTables: ["organization_addons", "fbr_invoices", "entitlement_audit_log"],
    auditEvent: "FBR_INVOICE_SUBMITTED"
  },

  "inventory.smartStock": {
    featureKey: "inventory.smartStock",
    displayName: "Smart Stock Alerts & Predictive Reorder Engine",
    type: "ADDON_REQUIRED",
    addonId: "SMART_STOCK",
    requiredPlan: "ANY",
    scope: "ORGANIZATION",
    dependencies: [],
    roles: ["owner", "admin", "branch_manager"],
    apiActions: ["inventory.reorder_alerts", "inventory.autogenerate_po"],
    frontendEntrypoints: ["public/app.js (#view-catalog)"],
    backendEndpoints: ["/api/inventory/reorder-alerts", "/api/inventory/autogenerate-po"],
    databaseTables: ["organization_addons", "inventory_catalog", "entitlement_audit_log"],
    auditEvent: "SMART_STOCK_EVALUATED"
  },

  "suppliers.purchaseManager": {
    featureKey: "suppliers.purchaseManager",
    displayName: "Supplier Purchase Order Management & Receiving Ledger",
    type: "ADDON_REQUIRED",
    addonId: "SUPPLIERS_PURCHASE",
    requiredPlan: "ANY",
    scope: "ORGANIZATION",
    dependencies: [],
    roles: ["owner", "admin", "branch_manager"],
    apiActions: ["purchase_order.create", "purchase_order.receive"],
    frontendEntrypoints: ["public/app.js (#view-suppliers)"],
    backendEndpoints: ["/api/purchase-orders/create", "/api/purchase-orders/list"],
    databaseTables: ["organization_addons", "purchase_orders", "entitlement_audit_log"],
    auditEvent: "PURCHASE_ORDER_CREATED"
  },

  "customers.loyalty": {
    featureKey: "customers.loyalty",
    displayName: "Customer Loyalty Points & Rewards Program",
    type: "ADDON_REQUIRED",
    addonId: "LOYALTY_REWARDS",
    requiredPlan: "ANY",
    scope: "ORGANIZATION",
    dependencies: [],
    roles: ["owner", "admin", "branch_manager", "cashier"],
    apiActions: ["loyalty.points_redeem", "loyalty.balance_check"],
    frontendEntrypoints: ["public/app.js (#view-customers)"],
    backendEndpoints: ["/api/loyalty/points/redeem", "/api/loyalty/balance"],
    databaseTables: ["organization_addons", "customer_loyalty_ledger", "entitlement_audit_log"],
    auditEvent: "LOYALTY_POINTS_REDEEMED"
  },

  "analytics.advanced": {
    featureKey: "analytics.advanced",
    displayName: "Executive Financial Analytics & Margin Heatmaps",
    type: "ADDON_REQUIRED",
    addonId: "ADVANCED_ANALYTICS",
    requiredPlan: "PRO",
    scope: "ORGANIZATION",
    dependencies: [],
    roles: ["owner", "admin"],
    apiActions: ["analytics.margins", "analytics.trends"],
    frontendEntrypoints: ["public/app.js (#view-analytics)"],
    backendEndpoints: ["/api/analytics/margins", "/api/analytics/hourly-trends"],
    databaseTables: ["organization_addons", "analytics_snapshots", "entitlement_audit_log"],
    auditEvent: "ADVANCED_ANALYTICS_VIEWED"
  },

  "system.cloudBackup": {
    featureKey: "system.cloudBackup",
    displayName: "Automated Encrypted Offsite Cloud Backups",
    type: "ADDON_REQUIRED",
    addonId: "CLOUD_BACKUP",
    requiredPlan: "ANY",
    scope: "ORGANIZATION",
    dependencies: [],
    roles: ["owner", "admin"],
    apiActions: ["backup.cloud_push", "backup.status_check"],
    frontendEntrypoints: ["public/app.js (#setting-backup-btn)"],
    backendEndpoints: ["/api/backup/push-cloud", "/api/backup/status"],
    databaseTables: ["organization_addons", "backups_log", "entitlement_audit_log"],
    auditEvent: "CLOUD_BACKUP_EXECUTED"
  },

  "branches.advancedOps": {
    featureKey: "branches.advancedOps",
    displayName: "Multi-Branch Stock Transfers & HQ Network Ops",
    type: "ADDON_REQUIRED",
    addonId: "MULTI_STORE",
    requiredPlan: "PRO",
    scope: "BRANCH",
    dependencies: ["multi_branch"],
    roles: ["owner", "admin", "branch_manager"],
    apiActions: ["branch.stock_transfer", "branch.network_stock"],
    frontendEntrypoints: ["public/app.js (#view-catalog-manager)"],
    backendEndpoints: ["/api/branches/transfer-stock", "/api/branches/network-stock"],
    databaseTables: ["organization_addons", "branch_transfers", "entitlement_audit_log"],
    auditEvent: "STOCK_TRANSFER_INITIATED"
  },

  "staff.proPermissions": {
    featureKey: "staff.proPermissions",
    displayName: "Granular Multi-Role Staff Permissions (RBAC)",
    type: "ADDON_REQUIRED",
    addonId: "STAFF_PRO",
    requiredPlan: "PRO",
    scope: "ORGANIZATION",
    dependencies: [],
    roles: ["owner", "admin"],
    apiActions: ["staff.custom_roles", "staff.permissions_update"],
    frontendEntrypoints: ["public/app.js (#view-staff)"],
    backendEndpoints: ["/api/staff/custom-roles", "/api/staff/permissions"],
    databaseTables: ["organization_addons", "staff_roles", "entitlement_audit_log"],
    auditEvent: "CUSTOM_ROLE_CREATED"
  },

  "staff.auditLogs": {
    featureKey: "staff.auditLogs",
    displayName: "Cryptographic Hash-Chained System Security Audit Trail",
    type: "ADDON_REQUIRED",
    addonId: "AUDIT_LOGS",
    requiredPlan: "PRO",
    scope: "ORGANIZATION",
    dependencies: [],
    roles: ["owner", "admin", "auditor"],
    apiActions: ["audit_logs.export", "audit_logs.verify"],
    frontendEntrypoints: ["public/app.js (#view-logs)"],
    backendEndpoints: ["/api/audit-logs/export", "/api/audit-logs/verify-chain"],
    databaseTables: ["organization_addons", "audit_logs", "entitlement_audit_log"],
    auditEvent: "AUDIT_LOG_EXPORTED"
  },

  "reports.accountant": {
    featureKey: "reports.accountant",
    displayName: "Exportable General Ledger & Tax Accountant Reports",
    type: "ADDON_REQUIRED",
    addonId: "ACCOUNTANT_REPORTS",
    requiredPlan: "PRO",
    scope: "ORGANIZATION",
    dependencies: [],
    roles: ["owner", "admin", "accountant"],
    apiActions: ["reports.general_ledger", "reports.p_and_l"],
    frontendEntrypoints: ["public/app.js (#view-analytics)"],
    backendEndpoints: ["/api/reports/general-ledger", "/api/reports/p-and-l"],
    databaseTables: ["organization_addons", "entitlement_audit_log"],
    auditEvent: "ACCOUNTANT_REPORT_GENERATED"
  }
};

const LEGACY_KEY_MAP = {
  'smart_stock': 'inventory.smartStock',
  'smart_stock_alerts': 'inventory.smartStock',
  'fbr_fiscalization': 'fbr.fiscal',
  'fbr': 'fbr.fiscal',
  'whatsapp_receipts': 'whatsapp.receipts',
  'cloud_backup': 'system.cloudBackup',
  'suppliers_purchase': 'suppliers.purchaseManager',
  'loyalty_rewards': 'customers.loyalty',
  'advanced_analytics': 'analytics.advanced',
  'multi_store': 'branches.advancedOps',
  'staff_pro': 'staff.proPermissions',
  'audit_logs': 'staff.auditLogs',
  'accountant_reports': 'reports.accountant'
};

function getFeatureDefinition(featureKey) {
  if (!featureKey) return null;
  const canonicalKey = LEGACY_KEY_MAP[featureKey] || featureKey;
  return FEATURE_REGISTRY[canonicalKey] || null;
}

function getAllFeatures() {
  return Object.values(FEATURE_REGISTRY);
}

module.exports = {
  FEATURE_REGISTRY,
  LEGACY_KEY_MAP,
  getFeatureDefinition,
  getAllFeatures
};
