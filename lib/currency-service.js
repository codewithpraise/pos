/**
 * VALENIXIA COMMERCE ECOSYSTEM — CURRENCY & MONEY INVARIANT SERVICE
 * Enforces locale en-PK, symbol Rs., currency PKR, minor units 2, and empty cart invariants.
 */

class CurrencyService {
  static get LOCALE() { return 'en-PK'; }
  static get SYMBOL() { return 'Rs.'; }
  static get CURRENCY() { return 'PKR'; }
  static get MINOR_UNITS() { return 2; }

  /**
   * Format minor units (paisa) or major units (rupees) into standard Rs. formatted string.
   */
  static format(amount, isMinorUnits = true) {
    const numeric = Number(amount || 0);
    const major = isMinorUnits ? numeric / 100.0 : numeric;
    
    // Purge any $ signs and enforce Rs. prefix
    const formatted = Math.abs(major).toLocaleString('en-PK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    
    return `${major < 0 ? '-' : ''}Rs. ${formatted}`;
  }

  /**
   * Enforce Cart Money Invariant: sum(line items) + tax + fees - discounts = total.
   * On an empty cart, total is strictly 0 with 0 FBR fee.
   */
  static calculateCartTotals({ items = [], taxRatePercent = 0, isFbrEnabled = false, discountAmountMinor = 0 }) {
    if (!items || items.length === 0) {
      return {
        subtotalMinor: 0,
        taxMinor: 0,
        fbrFeeMinor: 0,
        discountMinor: 0,
        totalMinor: 0,
        subtotalFormatted: 'Rs. 0.00',
        taxFormatted: 'Rs. 0.00',
        fbrFeeFormatted: 'Rs. 0.00',
        totalFormatted: 'Rs. 0.00'
      };
    }

    let subtotalMinor = 0;
    items.forEach(item => {
      const price = Number(item.unit_price_minor_units || item.price_minor || Math.round(Number(item.price || 0) * 100));
      const qty = Number(item.quantity || item.qty || 1);
      subtotalMinor += price * qty;
    });

    const fbrFeeMinor = isFbrEnabled ? 100 : 0; // Rs. 1.00 = 100 minor units
    const discountMinor = Math.min(subtotalMinor, Math.max(0, Number(discountAmountMinor || 0)));

    const taxableBase = Math.max(0, subtotalMinor - discountMinor);
    const taxMinor = Math.round(taxableBase * (Number(taxRatePercent || 0) / 100.0));

    const totalMinor = taxableBase + taxMinor + fbrFeeMinor;

    return {
      subtotalMinor,
      taxMinor,
      fbrFeeMinor,
      discountMinor,
      totalMinor,
      subtotalFormatted: this.format(subtotalMinor, true),
      taxFormatted: this.format(taxMinor, true),
      fbrFeeFormatted: this.format(fbrFeeMinor, true),
      totalFormatted: this.format(totalMinor, true)
    };
  }
}

module.exports = CurrencyService;
