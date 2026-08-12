// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - BILLING & PAYMENT CLAIM SERVICE
// Server-controlled payment catalog, immutable quote snapshots, and idempotent payment claims.
// ============================================================================

const crypto = require('crypto');
const { db } = require('../database');
const { COMMERCIAL_CATALOG } = require('./commercial-catalog');

class BillingService {
  /**
   * Official Merchant Payment Destination Catalog (Server-Authoritative Source of Truth)
   */
  static getPaymentMethods() {
    return {
      version: COMMERCIAL_CATALOG.VERSION,
      currency: 'PKR',
      currencySymbol: 'Rs.',
      merchantName: 'VALENIXIA COMMERCE (PRIVATE) LIMITED',
      methods: [
        {
          id: 'nayapay_official',
          name: 'NayaPay Commercial Wallet',
          type: 'DIGITAL_WALLET',
          accountTitle: 'VALENIXIA POS',
          accountNumber: '0300-8253649',
          iban: 'PK43NAYA0000003008253649',
          instructions: 'Transfer exact quoted amount via NayaPay and include Quote ID in transfer reference note.'
        },
        {
          id: 'meezan_bank_official',
          name: 'Meezan Bank (Islamic Banking)',
          type: 'BANK_TRANSFER',
          accountTitle: 'VALENIXIA COMMERCE SMC PVT LTD',
          accountNumber: '01020108945612',
          iban: 'PK62MEZN0001020108945612',
          instructions: 'IBFT / Interbank funds transfer. Retain transaction reference number for claim submission.'
        }
      ]
    };
  }

  /**
   * Generate Immutable Quoted Price Snapshot
   */
  static async createQuote(params) {
    const { organizationId, planId, billingCycle = 'monthly', extraTerminals = 0, extraBranches = 0, selectedAddons = [] } = params || {};
    if (!organizationId) throw new Error('organizationId is required');

    const plan = COMMERCIAL_CATALOG.PLANS[planId || 'STARTER'] || COMMERCIAL_CATALOG.PLANS.STARTER;
    const catalogVersion = COMMERCIAL_CATALOG.VERSION;
    const isAnnual = billingCycle === 'annual';

    // Base plan price calculation
    let monthlyBase = plan.price_pkr;
    let extraTermPrice = extraTerminals * (plan.extra_terminal_pkr || 0);
    let extraBranchPrice = extraBranches * (plan.extra_branch_pkr || 0);

    let addonTotal = 0;
    const addonBreakdown = [];

    (selectedAddons || []).forEach(addonId => {
      const addon = COMMERCIAL_CATALOG.ADDONS[addonId];
      if (addon) {
        let price = addon.price_pkr;
        if (addon.billing_cycle === 'one_time') {
          addonBreakdown.push({ id: addon.id, name: addon.name, type: 'one_time', amount: price });
          addonTotal += price;
        } else {
          addonBreakdown.push({ id: addon.id, name: addon.name, type: 'monthly', amount: price });
          monthlyBase += price;
        }
      }
    });

    let planSubtotal = monthlyBase + extraTermPrice + extraBranchPrice;
    let finalPlanAmount = isAnnual ? Math.round(planSubtotal * 12 * 0.85) : planSubtotal;
    let totalDuePkr = finalPlanAmount + addonTotal;

    const quoteId = `VLX-Q-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const quoteRecord = {
      quoteId,
      organizationId,
      catalogVersion,
      planId: plan.id,
      billingCycle,
      includedTerminals: plan.terminal_limit,
      includedBranches: plan.branch_limit,
      extraTerminals,
      extraBranches,
      selectedAddons: addonBreakdown,
      baseMonthlyPkr: plan.price_pkr,
      totalDuePkr,
      status: 'ACTIVE',
      createdAt: Date.now(),
      expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000 // 14-day quote freeze
    };

    const key = `billing_quote_${quoteId}`;
    await db.run(
      `INSERT OR REPLACE INTO local_preferences (key, value_payload, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
      [key, JSON.stringify(quoteRecord)]
    );

    return quoteRecord;
  }

  /**
   * Fetch Quote by ID
   */
  static async getQuote(quoteId) {
    if (!quoteId) return null;
    const key = `billing_quote_${quoteId}`;
    const row = await db.get(`SELECT * FROM local_preferences WHERE key = ?`, [key]);
    if (!row) return null;
    try { return JSON.parse(row.value_payload); } catch (_) { return null; }
  }

  /**
   * Submit Idempotent Payment Claim
   */
  static async submitPaymentClaim(params) {
    const { quoteId, organizationId, paymentMethodId, paymentReference, idempotencyKey, submittedAmountPkr } = params || {};
    if (!quoteId || !organizationId || !paymentReference || !idempotencyKey) {
      throw new Error('quoteId, organizationId, paymentReference, and idempotencyKey are required');
    }

    // 1. Check Idempotency Key Server-Side
    const idemKey = `idempotency_claim_${idempotencyKey}`;
    const existingIdemRow = await db.get(`SELECT value_payload FROM local_preferences WHERE key = ?`, [idemKey]);
    if (existingIdemRow) {
      try {
        const existingClaim = JSON.parse(existingIdemRow.value_payload);
        return { success: true, idempotent: true, claim: existingClaim };
      } catch (_) {}
    }

    // 2. Validate Quote State & Expiry
    const quote = await this.getQuote(quoteId);
    if (!quote) throw new Error(`Quote '${quoteId}' not found.`);
    if (quote.organizationId !== organizationId) throw new Error('Organization boundary mismatch on quote.');
    if (quote.status === 'SETTLED') throw new Error('Quote has already been settled and activated.');
    if (quote.status === 'EXPIRED' || quote.expiresAt < Date.now()) throw new Error('Quote has expired. Please generate a new quote.');

    // 3. Create Payment Claim Record
    const claimId = `CLAIM_${Date.now()}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const claimRecord = {
      claimId,
      quoteId,
      organizationId,
      catalogVersion: quote.catalogVersion,
      quotedAmountPkr: quote.totalDuePkr,
      submittedAmountPkr: Number(submittedAmountPkr || quote.totalDuePkr),
      paymentMethodId: paymentMethodId || 'nayapay_official',
      paymentReference: paymentReference.toString().trim(),
      idempotencyKey,
      status: 'PENDING',
      submittedAt: Date.now()
    };

    const claimKey = `payment_claim_${claimId}`;
    await db.run(
      `INSERT INTO local_preferences (key, value_payload, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
      [claimKey, JSON.stringify(claimRecord)]
    );

    // Save Idempotency Index
    await db.run(
      `INSERT INTO local_preferences (key, value_payload, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
      [idemKey, JSON.stringify(claimRecord)]
    );

    return { success: true, idempotent: false, claim: claimRecord };
  }
}

module.exports = BillingService;
