/**
 * VALENIXIA COMMERCE ECOSYSTEM — COMMERCIAL CATALOG & QUOTE SNAPSHOT SERVICE
 * Versioned immutable plan rates, add-ons, terms, and quote pricing snapshots.
 */

const COMMERCIAL_CATALOG_VERSION = 'v2.6.0-2026-Q3';
const COMMERCIAL_CATALOG_EFFECTIVE_AT = '2026-07-01T00:00:00.000Z';

const PLAN_RATES = {
  STARTER: {
    id: 'STARTER',
    displayName: 'Starter POS Plan',
    monthlyPricePKR: 3499,
    price_pkr: 3499,
    includedTerminals: 1,
    includedBranches: 1,
    extraTerminalPricePKR: 1200,
    extraBranchPricePKR: 0,
    allowExtraBranches: false
  },
  PRO: {
    id: 'PRO',
    displayName: 'Professional POS Plan',
    monthlyPricePKR: 6999,
    price_pkr: 6999,
    includedTerminals: 2,
    includedBranches: 1,
    extraTerminalPricePKR: 1000,
    extraBranchPricePKR: 3500,
    allowExtraBranches: true
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    displayName: 'Enterprise Multi-Store POS',
    monthlyPricePKR: 11999,
    price_pkr: 11999,
    includedTerminals: 3,
    includedBranches: 2,
    extraTerminalPricePKR: 800,
    extraBranchPricePKR: 3000,
    allowExtraBranches: true
  }
};

const ADDON_RATES = {
  FBR_FISCAL_POS: {
    id: 'FBR_FISCAL_POS',
    displayName: 'FBR Fiscal POS Integration',
    pricingType: 'ONE_TIME',
    pricePKR: 2499,
    price_pkr: 2499
  },
  WHATSAPP_RECEIPTS: {
    id: 'WHATSAPP_RECEIPTS',
    displayName: 'WhatsApp Digital Receipts',
    pricingType: 'MONTHLY',
    pricePKR: 1499,
    price_pkr: 1499
  },
  ADVANCED_INVENTORY: {
    id: 'ADVANCED_INVENTORY',
    displayName: 'Advanced Inventory & Batch Expiry',
    pricingType: 'MONTHLY',
    pricePKR: 1999,
    price_pkr: 1999
  }
};

class CommercialCatalogService {
  static getCatalogVersion() {
    return COMMERCIAL_CATALOG_VERSION;
  }

  static getCatalog() {
    return {
      version: COMMERCIAL_CATALOG_VERSION,
      effectiveAt: COMMERCIAL_CATALOG_EFFECTIVE_AT,
      plans: PLAN_RATES,
      addons: ADDON_RATES
    };
  }

  static calculateQuote({ planId, extraTerminals = 0, extraBranches = 0, billingCycle = 'MONTHLY', addons = [] }) {
    const plan = PLAN_RATES[planId?.toUpperCase()] || PLAN_RATES.STARTER;
    const baseMonthly = plan.monthlyPricePKR;

    const termAddonMonthly = Math.max(0, extraTerminals) * plan.extraTerminalPricePKR;
    const branchAddonMonthly = plan.allowExtraBranches ? Math.max(0, extraBranches) * plan.extraBranchPricePKR : 0;

    const totalMonthlyRaw = baseMonthly + termAddonMonthly + branchAddonMonthly;

    let planCostFinal = totalMonthlyRaw;
    if (billingCycle === 'ANNUAL') {
      planCostFinal = Math.round(totalMonthlyRaw * 12 * 0.85); // 15% annual discount
    }

    let addonOneTimeTotal = 0;
    let addonMonthlyTotal = 0;

    const processedAddons = [];
    (addons || []).forEach(addonId => {
      const addonKey = typeof addonId === 'string' ? addonId.toUpperCase() : addonId;
      const rate = ADDON_RATES[addonKey];
      if (rate) {
        if (rate.pricingType === 'ONE_TIME') {
          addonOneTimeTotal += rate.pricePKR;
          processedAddons.push({ id: rate.id, name: rate.displayName, type: 'ONE_TIME', pricePKR: rate.pricePKR });
        } else {
          const addonCost = billingCycle === 'ANNUAL' ? Math.round(rate.pricePKR * 12 * 0.85) : rate.pricePKR;
          addonMonthlyTotal += addonCost;
          processedAddons.push({ id: rate.id, name: rate.displayName, type: 'MONTHLY', pricePKR: addonCost });
        }
      }
    });

    const totalDueNow = planCostFinal + addonOneTimeTotal + (billingCycle === 'ANNUAL' ? addonMonthlyTotal : addonMonthlyTotal);

    return {
      catalogVersion: COMMERCIAL_CATALOG_VERSION,
      planId: plan.id,
      planDisplayName: plan.displayName,
      billingCycle,
      includedTerminals: plan.includedTerminals,
      includedBranches: plan.includedBranches,
      extraTerminals: Math.max(0, extraTerminals),
      extraBranches: plan.allowExtraBranches ? Math.max(0, extraBranches) : 0,
      planCostFinal,
      processedAddons,
      addonOneTimeTotal,
      addonMonthlyTotal,
      totalDueNowPKR: totalDueNow
    };
  }

  static createQuoteSnapshot(params) {
    const quoteData = this.calculateQuote(params);
    const quoteId = `VLX-Q-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

    return {
      quoteId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      snapshot: quoteData
    };
  }
}

module.exports = {
  COMMERCIAL_CATALOG_VERSION,
  COMMERCIAL_CATALOG_EFFECTIVE_AT,
  PLAN_RATES,
  COMMERCIAL_PLANS: PLAN_RATES,
  ADDON_RATES,
  CommercialCatalogService
};
