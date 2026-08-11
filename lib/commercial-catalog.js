// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - SINGLE CANONICAL COMMERCIAL CATALOG
// Single source of truth for all Tier Plans, Add-ons, Entitlements, and Limits.
// Consumed by Subscription Page, Settings Page, Admin Portal, and Feature Gates.
// ============================================================================

const COMMERCIAL_PLANS = {
  FREE: {
    id: 'FREE',
    name: 'Free Basic',
    price_pkr: 0,
    billing_cycle: 'monthly',
    terminal_limit: 1,
    branch_limit: 1,
    extra_terminal_pkr: 0,
    extra_branch_pkr: 0,
    product_limit: 25,
    badge: 'FREE FOREVER',
    tagline: 'Basic trial register for small single-counter kiosks.',
    features: [
      '1 Register Terminal & 1 Store Branch',
      'Max 25 Inventory Items (Upgrade for unlimited)',
      'Basic Sales Checkout & Local Stock'
    ],
    included_addons: []
  },
  STARTER: {
    id: 'STARTER',
    name: 'Starter Register',
    price_pkr: 3499,
    billing_cycle: 'monthly',
    terminal_limit: 1,
    branch_limit: 1,
    extra_terminal_pkr: 1200,
    extra_branch_pkr: null, // Branch expansion requires Pro
    product_limit: 2147483647,
    badge: 'ENTRY TIER',
    tagline: 'Essential offline-first POS for single counter shops.',
    features: [
      '1 Included Register Terminal & 1 Included Branch',
      'Unlimited Inventory Catalog & Core POS',
      'Offline-First Local Storage Engine',
      'Free CSV / XLS / XLSX Data Import',
      'Optional FBR Tax Capability Boundary',
      'Add extra terminal: PKR 1,200/mo (Branch expansion requires Pro)'
    ],
    included_addons: []
  },
  GROWTH: {
    id: 'GROWTH',
    name: 'Growth (Pro Store)',
    price_pkr: 6999,
    billing_cycle: 'monthly',
    terminal_limit: 2,
    branch_limit: 1,
    extra_terminal_pkr: 1000,
    extra_branch_pkr: 3500,
    product_limit: 2147483647,
    badge: 'MOST POPULAR',
    tagline: 'Multi-device real-time sync for growing retail & restaurants.',
    features: [
      '2 Included Register Terminals & 1 Included Branch',
      'Multi-Device Real-Time Cloud Sync & Backup',
      'Deals, Combos & Promotional Engine',
      'Kitchen & Bar Ticket Routing (KOT)',
      'Automated WhatsApp Digital Receipts',
      'Add extra terminal: PKR 1,000/mo | Extra branch: PKR 3,500/mo'
    ],
    included_addons: ['WHATSAPP_RECEIPTS']
  },
  PRO: {
    id: 'PRO',
    name: 'Growth (Pro Store)',
    price_pkr: 6999,
    billing_cycle: 'monthly',
    terminal_limit: 2,
    branch_limit: 1,
    extra_terminal_pkr: 1000,
    extra_branch_pkr: 3500,
    product_limit: 2147483647,
    badge: 'MOST POPULAR',
    tagline: 'Multi-device real-time sync for growing retail & restaurants.',
    features: [
      '2 Included Register Terminals & 1 Included Branch',
      'Multi-Device Real-Time Cloud Sync & Backup',
      'Deals, Combos & Promotional Engine',
      'Kitchen & Bar Ticket Routing (KOT)',
      'Automated WhatsApp Digital Receipts',
      'Add extra terminal: PKR 1,000/mo | Extra branch: PKR 3,500/mo'
    ],
    included_addons: ['WHATSAPP_RECEIPTS']
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    name: 'Enterprise HQ',
    price_pkr: 11999,
    billing_cycle: 'monthly',
    terminal_limit: 3,
    branch_limit: 2,
    extra_terminal_pkr: 800,
    extra_branch_pkr: 3000,
    product_limit: 2147483647,
    badge: 'ENTERPRISE HQ',
    tagline: 'Multi-branch retail chain & FBR tax compliant commerce engine.',
    features: [
      '3 Included Register Terminals & 2 Included Branches',
      'Official FBR Fiscal POS & PRAL Tax Integration',
      'Multi-Branch Central HQ Dashboard & Stock Transfers',
      'Enterprise Multi-Branch Analytics & Operations',
      'High-Security Audit Logs & Custom Staff Roles',
      'Add extra terminal: PKR 800/mo | Extra branch: PKR 3,000/mo'
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
    entitlementKey: 'fbrPos',
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
    entitlementKey: 'multiStoreHq',
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
    entitlementKey: 'whatsappReceipts',
    included_in: ['GROWTH', 'PRO', 'ENTERPRISE']
  },
  CUSTOM_ROLES: {
    id: 'CUSTOM_ROLES',
    name: 'Custom Staff Granular RBAC & Security Logs',
    category: 'SECURITY',
    price_pkr: 1999,
    billing_cycle: 'monthly',
    description: 'Define custom cashier, supervisor, and inventory manager permissions with immutable audit trails.',
    icon: '🛡️',
    entitlementKey: 'customRbac',
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
    entitlementKey: 'dataPortability',
    included_in: ['ENTERPRISE']
  }
};

const COMMERCIAL_CATALOG = {
  VERSION: '2.5.0',
  PLANS: COMMERCIAL_PLANS,
  ADDONS: COMMERCIAL_ADDONS
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    COMMERCIAL_PLANS,
    COMMERCIAL_ADDONS,
    COMMERCIAL_CATALOG
  };
} else if (typeof window !== 'undefined') {
  window.ValenixiaCommercialCatalog = COMMERCIAL_CATALOG;
  window.COMMERCIAL_CATALOG = COMMERCIAL_CATALOG;
}
