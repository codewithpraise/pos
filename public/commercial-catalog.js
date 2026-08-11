// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - SINGLE AUTHORITATIVE COMMERCIAL CATALOG
// Single source of truth for all Tier Plans, Add-ons, Entitlements, and Limits.
// Consumed by Subscription Page, Settings Page, Admin Portal, and Feature Gates.
// ============================================================================

(function(global) {
  'use strict';

  const COMMERCIAL_PLANS = {
    STARTER: {
      id: 'STARTER',
      name: 'Starter Register',
      price_pkr: 3499,
      billing_cycle: 'monthly',
      terminal_limit: 1,
      branch_limit: 1,
      badge: 'ENTRY TIER',
      tagline: 'Essential offline-first POS for single counter shops.',
      features: [
        '1 Register Terminal License',
        'Fast Checkout & ESC/POS Thermal Printing',
        'Product Catalog & Real-Time Local Stock',
        'Customer Directory & Credit Khata Ledger',
        'Suppliers & Purchase Ledger',
        'Sales Analytics & Profit Reports'
      ],
      included_addons: []
    },
    GROWTH: {
      id: 'GROWTH',
      name: 'Growth (Pro Store)',
      price_pkr: 6999,
      billing_cycle: 'monthly',
      terminal_limit: 3,
      branch_limit: 1,
      badge: 'MOST POPULAR',
      tagline: 'Multi-device real-time sync for growing retail & restaurants.',
      features: [
        'Up to 3 Register Terminals per Store',
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
      price_pkr: 11999,
      billing_cycle: 'monthly',
      terminal_limit: 10,
      branch_limit: 5,
      badge: 'ENTERPRISE HQ',
      tagline: 'Multi-branch retail chain & FBR tax compliant commerce engine.',
      features: [
        'Up to 10 Register Terminals & 5 Store Branches',
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
      price_pkr: 2999,
      billing_cycle: 'monthly',
      description: 'Tier-1 FBR / PRAL digital fiscal invoice tagging with QR code generation & automatic queue syncing.',
      icon: '🏛️',
      included_in: ['ENTERPRISE']
    },
    MULTI_STORE: {
      id: 'MULTI_STORE',
      name: 'Multi-Branch HQ Stock Transfer & Analytics',
      category: 'MULTI_BRANCH',
      price_pkr: 3999,
      billing_cycle: 'monthly',
      description: 'Centralized HQ stock transfer requests, multi-outlet sales aggregation, and inventory consolidation.',
      icon: '🏬',
      included_in: ['ENTERPRISE']
    },
    WHATSAPP_RECEIPTS: {
      id: 'WHATSAPP_RECEIPTS',
      name: 'Automated WhatsApp Digital Receipts',
      category: 'MARKETING',
      price_pkr: 1499,
      billing_cycle: 'monthly',
      description: 'Send instant PDF transaction receipts and credit statements directly to customers WhatsApp numbers.',
      icon: '💬',
      included_in: ['GROWTH', 'ENTERPRISE']
    },
    CUSTOM_ROLES: {
      id: 'CUSTOM_ROLES',
      name: 'Custom Staff Granular RBAC & Security Logs',
      category: 'SECURITY',
      price_pkr: 1999,
      billing_cycle: 'monthly',
      description: 'Define custom cashier, supervisor, and inventory manager permissions with immutable audit trails.',
      icon: '🛡️',
      included_in: ['ENTERPRISE']
    },
    DATA_PORTABILITY: {
      id: 'DATA_PORTABILITY',
      name: 'Full Automated Cloud Backup & Data Export',
      category: 'DATA',
      price_pkr: 1499,
      billing_cycle: 'monthly',
      description: 'Automated Google Drive daily database backups and scheduled CSV/Excel business reporting exports.',
      icon: '☁️',
      included_in: ['ENTERPRISE']
    }
  };

  global.ValenixiaCommercialCatalog = {
    COMMERCIAL_PLANS,
    COMMERCIAL_ADDONS
  };

  global.COMMERCIAL_CATALOG = {
    TIERS: COMMERCIAL_PLANS,
    ADDONS: COMMERCIAL_ADDONS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { COMMERCIAL_PLANS, COMMERCIAL_ADDONS, COMMERCIAL_CATALOG: global.COMMERCIAL_CATALOG };
  }
})(typeof window !== 'undefined' ? window : global);
