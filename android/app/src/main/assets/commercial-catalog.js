// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - SINGLE CANONICAL COMMERCIAL CATALOG
// Single source of truth for all Tier Plans, Add-ons, Entitlements, and Limits.
// Consumed by Subscription Page, Settings Page, Admin Portal, and Feature Gates.
// ============================================================================

(function(global) {
  'use strict';

  const getAnnualPrice = function(monthlyPrice) {
    return Math.round((monthlyPrice * 12 * 85) / 100);
  };

  const COMMERCIAL_PLANS = {
    FREE: {
      id: 'FREE',
      name: 'Free Basic',
      price_monthly_pkr: 0,
      price_annual_pkr: 0,
      terminal_limit: 1,
      branch_limit: 1,
      extra_terminal_monthly_pkr: 0,
      extra_branch_monthly_pkr: 0,
      allows_branch_expansion: false,
      product_limit: 25,
      badge: 'FREE FOREVER',
      tagline: 'Basic trial register for small single-counter kiosks.',
      features: [
        '1 Register Terminal License & 1 Store Branch',
        'Basic Sales Checkout & Local Stock',
        'Max 25 Inventory Items'
      ],
      included_addons: []
    },
    STARTER: {
      id: 'STARTER',
      name: 'Starter Register',
      price_monthly_pkr: 3499,
      price_annual_pkr: getAnnualPrice(3499), // 35690
      terminal_limit: 1,
      branch_limit: 1,
      extra_terminal_monthly_pkr: 1200,
      extra_terminal_annual_pkr: getAnnualPrice(1200), // 12240
      extra_branch_monthly_pkr: 0,
      allows_branch_expansion: false,
      product_limit: 2147483647,
      badge: 'ENTRY TIER',
      tagline: 'Essential offline-first POS for single counter shops.',
      features: [
        '1 Register Terminal License & 1 Store Branch',
        'Fast Checkout & ESC/POS Thermal Printing',
        'Product Catalog & Real-Time Local Stock',
        'Customer Directory & Credit Khata Ledger',
        'Suppliers & Purchase Ledger',
        'Sales Analytics & Profit Reports'
      ],
      included_addons: []
    },
    GROWTH: {
      id: 'PRO',
      name: 'Growth (Pro Store)',
      price_monthly_pkr: 6999,
      price_annual_pkr: getAnnualPrice(6999), // 71390
      terminal_limit: 2,
      branch_limit: 1,
      extra_terminal_monthly_pkr: 1000,
      extra_terminal_annual_pkr: getAnnualPrice(1000), // 10200
      extra_branch_monthly_pkr: 3500,
      extra_branch_annual_pkr: getAnnualPrice(3500), // 35700
      allows_branch_expansion: true,
      product_limit: 2147483647,
      badge: 'MOST POPULAR',
      tagline: 'Multi-device real-time sync for growing retail & restaurants.',
      features: [
        '2 Included Terminals & 1 Included Branch',
        'Multi-Device Real-Time Cloud Sync & Backup',
        'Kitchen & Bar Ticket Routing (KOT)',
        'Staff Security PINs & Activity Audit Logs',
        'Automated WhatsApp Digital Receipts',
        'Advanced Margin & Stock Forecasting'
      ],
      included_addons: ['WHATSAPP_RECEIPTS']
    },
    PRO: {
      id: 'PRO',
      name: 'Growth (Pro Store)',
      price_monthly_pkr: 6999,
      price_annual_pkr: getAnnualPrice(6999), // 71390
      terminal_limit: 2,
      branch_limit: 1,
      extra_terminal_monthly_pkr: 1000,
      extra_terminal_annual_pkr: getAnnualPrice(1000),
      extra_branch_monthly_pkr: 3500,
      extra_branch_annual_pkr: getAnnualPrice(3500),
      allows_branch_expansion: true,
      product_limit: 2147483647,
      badge: 'MOST POPULAR',
      tagline: 'Multi-device real-time sync for growing retail & restaurants.',
      features: [
        '2 Included Terminals & 1 Included Branch',
        'Multi-Device Real-Time Cloud Sync & Backup',
        'Kitchen & Bar Ticket Routing (KOT)',
        'Staff Security PINs & Activity Audit Logs',
        'Automated WhatsApp Digital Receipts',
        'Advanced Margin & Stock Forecasting'
      ],
      included_addons: ['WHATSAPP_RECEIPTS']
    },
    ENTERPRISE: {
      id: 'ENTERPRISE',
      name: 'Enterprise HQ',
      price_monthly_pkr: 11999,
      price_annual_pkr: getAnnualPrice(11999), // 122390
      terminal_limit: 3,
      branch_limit: 2,
      extra_terminal_monthly_pkr: 800,
      extra_terminal_annual_pkr: getAnnualPrice(800), // 8160
      extra_branch_monthly_pkr: 3000,
      extra_branch_annual_pkr: getAnnualPrice(3000), // 30600
      allows_branch_expansion: true,
      product_limit: 2147483647,
      badge: 'ENTERPRISE HQ',
      tagline: 'Multi-branch retail chain & FBR tax compliant commerce engine.',
      features: [
        '3 Included Terminals & 2 Included Branches',
        'Official FBR Fiscal POS & PRAL Tax Integration',
        'Multi-Branch Central HQ Dashboard & Stock Transfers',
        'High-Security Audit Logs & Custom Staff Roles',
        'Data Export & Full Portability',
        '24/7 Priority Support & Onsite Hardware Setup'
      ],
      included_addons: ['FBR_FISCAL', 'MULTI_STORE', 'WHATSAPP_RECEIPTS', 'CUSTOM_ROLES', 'DATA_PORTABILITY']
    }
  };

  const COMMERCIAL_ADDONS = {
    FBR_FISCAL: {
      id: 'FBR_FISCAL',
      name: 'Official FBR Fiscal POS Integration',
      category: 'TAX_COMPLIANCE',
      price_monthly_pkr: 2499,
      price_annual_pkr: 2499,
      is_one_time: true,
      billing_cycle: 'one_time',
      description: 'Tier-1 FBR / PRAL digital fiscal invoice tagging with QR code generation & automatic queue syncing.',
      icon: '',
      entitlementKey: 'fbr.fiscal',
      grantedKeys: ['fbr.fiscal'],
      included_in: ['ENTERPRISE']
    },
    SMART_STOCK: {
      id: 'SMART_STOCK',
      name: 'Smart Stock Alerts & Expiry Risk',
      category: 'INVENTORY',
      price_monthly_pkr: 499,
      price_annual_pkr: getAnnualPrice(499),
      is_one_time: false,
      billing_cycle: 'recurring',
      description: 'Automated low stock alerts, reorder thresholds, and expiration risk forecasting.',
      icon: '',
      entitlementKey: 'inventory.smartStock',
      grantedKeys: ['inventory.smartStock'],
      included_in: []
    },
    PURCHASE_MANAGER: {
      id: 'PURCHASE_MANAGER',
      name: 'Purchase & Supplier Manager',
      category: 'INVENTORY',
      price_monthly_pkr: 799,
      price_annual_pkr: getAnnualPrice(799),
      is_one_time: false,
      billing_cycle: 'recurring',
      description: 'Supplier directory, purchase order generation, and stock intake ledger.',
      icon: '',
      entitlementKey: 'suppliers.purchaseManager',
      grantedKeys: ['suppliers.purchaseManager'],
      included_in: []
    },
    LOYALTY: {
      id: 'LOYALTY',
      name: 'Customer Loyalty & Store Credit',
      category: 'CUSTOMERS',
      price_monthly_pkr: 699,
      price_annual_pkr: getAnnualPrice(699),
      is_one_time: false,
      billing_cycle: 'recurring',
      description: 'Customer rewards points, automated cashback tiering, and store credit ledger.',
      icon: '',
      entitlementKey: 'customers.loyalty',
      grantedKeys: ['customers.loyalty'],
      included_in: []
    },
    ADVANCED_ANALYTICS: {
      id: 'ADVANCED_ANALYTICS',
      name: 'Advanced Analytics & Telemetry',
      category: 'ANALYTICS',
      price_monthly_pkr: 999,
      price_annual_pkr: getAnnualPrice(999),
      is_one_time: false,
      billing_cycle: 'recurring',
      description: 'COGS calculations, profit margin telemetry, and multi-dimensional analytics.',
      icon: '',
      entitlementKey: 'analytics.advanced',
      grantedKeys: ['analytics.advanced'],
      included_in: []
    },
    CLOUD_BACKUP: {
      id: 'CLOUD_BACKUP',
      name: 'Real-Time Cloud Backup & Sync',
      category: 'DATA',
      price_monthly_pkr: 399,
      price_annual_pkr: getAnnualPrice(399),
      is_one_time: false,
      billing_cycle: 'recurring',
      description: 'Automated encrypted database backups and continuous multi-device sync.',
      icon: '',
      entitlementKey: 'system.cloudBackup',
      grantedKeys: ['system.cloudBackup'],
      included_in: ['PRO', 'ENTERPRISE']
    },
    BRANCH_OPERATIONS: {
      id: 'BRANCH_OPERATIONS',
      name: 'Advanced Branch Operations & HQ',
      category: 'MULTI_BRANCH',
      price_monthly_pkr: 1499,
      price_annual_pkr: getAnnualPrice(1499),
      is_one_time: false,
      billing_cycle: 'recurring',
      description: 'Inter-branch stock transfer requests, centralized HQ inventory view, and outlet metrics.',
      icon: '',
      entitlementKey: 'branches.advancedOps',
      grantedKeys: ['branches.advancedOps'],
      requires_plan: ['PRO', 'ENTERPRISE'],
      included_in: ['ENTERPRISE']
    },
    STAFF_PRO: {
      id: 'STAFF_PRO',
      name: 'Staff Pro & Security PINs',
      category: 'SECURITY',
      price_monthly_pkr: 599,
      price_annual_pkr: getAnnualPrice(599),
      is_one_time: false,
      billing_cycle: 'recurring',
      description: 'Granular cashier security PINs, shift management, and role-based permissions.',
      icon: '',
      entitlementKey: 'staff.proPermissions',
      grantedKeys: ['staff.proPermissions'],
      included_in: ['PRO', 'ENTERPRISE']
    },
    AUDIT_LOGS: {
      id: 'AUDIT_LOGS',
      name: 'High Security Activity Audit Logs',
      category: 'SECURITY',
      price_monthly_pkr: 399,
      price_annual_pkr: getAnnualPrice(399),
      is_one_time: false,
      billing_cycle: 'recurring',
      description: 'Immutable cashier action audit logs, void tracking, and override history.',
      icon: '',
      entitlementKey: 'staff.auditLogs',
      grantedKeys: ['staff.auditLogs'],
      included_in: ['PRO', 'ENTERPRISE']
    },
    ACCOUNTANT_REPORTS: {
      id: 'ACCOUNTANT_REPORTS',
      name: 'Accountant Financial Reports',
      category: 'FINANCE',
      price_monthly_pkr: 699,
      price_annual_pkr: getAnnualPrice(699),
      is_one_time: false,
      billing_cycle: 'recurring',
      description: 'Tax filing export, trial balance generator, and Excel accounting statements.',
      icon: '',
      entitlementKey: 'reports.accountant',
      grantedKeys: ['reports.accountant'],
      included_in: []
    }
  };

  const COMMERCIAL_BUNDLES = {
    OPERATIONS_PACK: {
      id: 'OPERATIONS_PACK',
      name: 'Operations Pack',
      price_monthly_pkr: 2199,
      price_annual_pkr: getAnnualPrice(2199),
      description: 'Complete store operations: Smart Stock + Supplier Manager + Advanced Branch Operations.',
      icon: '',
      constituent_addons: ['SMART_STOCK', 'PURCHASE_MANAGER', 'BRANCH_OPERATIONS'],
      grantedKeys: ['inventory.smartStock', 'suppliers.purchaseManager', 'branches.advancedOps']
    },
    FINANCE_PACK: {
      id: 'FINANCE_PACK',
      name: 'Finance & Analytics Pack',
      price_monthly_pkr: 1699,
      price_annual_pkr: getAnnualPrice(1699),
      description: 'Complete financial intelligence: Advanced Analytics + Accountant Reports + Cloud Backup.',
      icon: '',
      constituent_addons: ['ADVANCED_ANALYTICS', 'ACCOUNTANT_REPORTS', 'CLOUD_BACKUP'],
      grantedKeys: ['analytics.advanced', 'reports.accountant', 'system.cloudBackup']
    },
    SECURITY_PACK: {
      id: 'SECURITY_PACK',
      name: 'Security & Staff Pack',
      price_monthly_pkr: 799,
      price_annual_pkr: getAnnualPrice(799),
      description: 'Complete staff control: Staff Pro & PINs + High Security Audit Logs.',
      icon: '',
      constituent_addons: ['STAFF_PRO', 'AUDIT_LOGS'],
      grantedKeys: ['staff.proPermissions', 'staff.auditLogs']
    }
  };

  const PROFESSIONAL_SERVICES = {
    HARDWARE_SETUP: {
      id: 'HARDWARE_SETUP',
      name: 'POS Hardware & Printer Setup',
      price_pkr: 1499,
      is_recurring: false,
      description: 'On-site or remote setup for ESC/POS thermal printers, cash drawers, and barcode scanners.'
    },
    DATA_MIGRATION: {
      id: 'DATA_MIGRATION',
      name: 'Data Migration & Catalog Onboarding',
      price_pkr: 2499,
      is_recurring: false,
      description: 'Data conversion, bulk Excel product catalog import, and customer ledger migration.'
    },
    CASHIER_TRAINING: {
      id: 'CASHIER_TRAINING',
      name: 'On-site Cashier Training Session',
      price_pkr: 1999,
      is_recurring: false,
      description: 'Dedicated training session for staff covering checkout, returns, and inventory intake.'
    },
    PRIORITY_SUPPORT: {
      id: 'PRIORITY_SUPPORT',
      name: 'Priority 24/7 Managed Support',
      price_pkr: 999,
      is_recurring: true,
      billing_cycle: 'monthly',
      description: 'Priority hotline support with guaranteed 30-minute SLA for register recovery.'
    }
  };

  const COMMERCIAL_CATALOG = {
    VERSION: 'v2.6.0-catalog-001',
    PLANS: COMMERCIAL_PLANS,
    ADDONS: COMMERCIAL_ADDONS,
    BUNDLES: COMMERCIAL_BUNDLES,
    SERVICES: PROFESSIONAL_SERVICES,
    getAnnualPrice: getAnnualPrice
  };

  global.ValenixiaCommercialCatalog = COMMERCIAL_CATALOG;
  global.COMMERCIAL_CATALOG = COMMERCIAL_CATALOG;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { COMMERCIAL_PLANS, COMMERCIAL_ADDONS, COMMERCIAL_BUNDLES, PROFESSIONAL_SERVICES, COMMERCIAL_CATALOG, getAnnualPrice };
  }
})(typeof window !== 'undefined' ? window : global);

