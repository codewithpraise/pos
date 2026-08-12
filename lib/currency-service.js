// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - CENTRALIZED CURRENCY & MONEY SERVICE
// Canonical currency rules: PKR, Rs. prefix, 2 minor units (paise/cents). Zero $ literals.
// ============================================================================

const CurrencyService = {
  CURRENCY_CODE: 'PKR',
  CURRENCY_SYMBOL: 'Rs.',
  MINOR_UNITS: 2,
  LOCALE: 'en-PK',

  /**
   * Format minor units (paise/cents) into display currency string
   * e.g., 349900 -> "Rs. 3,499.00"
   */
  format(paiseOrCents) {
    const amount = Number(paiseOrCents || 0) / 100;
    return `${this.CURRENCY_SYMBOL} ${amount.toLocaleString(this.LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },

  /**
   * Format major PKR amount into display currency string
   * e.g., 3499 -> "Rs. 3,499.00"
   */
  formatMajor(pkrAmount) {
    const amount = Number(pkrAmount || 0);
    return `${this.CURRENCY_SYMBOL} ${amount.toLocaleString(this.LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },

  /**
   * Compute Cart Total Invariant:
   * sum(line items) + tax + fees - discounts = total
   * On empty cart, fees (like FBR service fee) are strictly 0.
   */
  calculateCartTotal(items = [], taxPaise = 0, feePaise = 0, discountPaise = 0) {
    if (!items || !Array.isArray(items) || items.length === 0) {
      return {
        subtotal: 0,
        tax: 0,
        fee: 0,
        discount: 0,
        total: 0
      };
    }

    let subtotal = 0;
    items.forEach(item => {
      const price = Number(item.price_minor_units !== undefined ? item.price_minor_units : (item.price || 0));
      const qty = Number(item.quantity || 1);
      subtotal += Math.round(price * qty);
    });

    const tax = Number(taxPaise || 0);
    const fee = Number(feePaise || 0);
    const discount = Number(discountPaise || 0);
    const total = Math.max(0, subtotal + tax + fee - discount);

    return {
      subtotal,
      tax,
      fee,
      discount,
      total
    };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CurrencyService;
} else if (typeof window !== 'undefined') {
  window.ValenixiaCurrency = CurrencyService;
  window.CurrencyService = CurrencyService;
}
