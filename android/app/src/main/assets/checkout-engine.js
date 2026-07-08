// VALENIXIA COMMERCE ECOSYSTEM - CHECKOUT & TAX CALCULATION ENGINE
// Decoupled integer-basis tax math to prevent floating point accumulator errors

(function() {
  const globalScope = typeof self !== 'undefined' ? self : window;

  const CheckoutEngine = {
    // Calculates subtotal in minor units (cents/paisas)
    calculateSubtotal(cart) {
      if (!cart || !Array.isArray(cart)) return 0;
      return cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    },

    // Calculates tax using integer-basis math to avoid IEEE 754 precision issues
    calculateTax(cart, preferences, paymentMode) {
      if (!cart || !Array.isArray(cart)) return 0;
      const prefs = preferences || {};
      
      const ratePref = prefs['store_tax_rate'] || '8.0';
      let ratePercent = parseFloat(ratePref);

      const taxMode = prefs['store_tax_mode'] || 'FLAT';
      if (taxMode === 'FBR_FOOD') {
        if (paymentMode === 'CARD' || paymentMode === 'QR' || paymentMode === 'MOBILE') {
          ratePercent = 5.0;
        } else {
          ratePercent = 15.0;
        }
      } else if (taxMode === 'FBR_RETAIL') {
        ratePercent = 18.0;
      }

      // Convert rate to basis points (e.g. 8.5% -> 850 bps) to use integer math
      const rateBps = Math.round(ratePercent * 100);

      // Sum rounded tax per item using basis point arithmetic: (price * qty * bps) / 10000
      return cart.reduce((sum, item) => {
        const itemTax = Math.round((item.price * item.qty * rateBps) / 10000);
        return sum + itemTax;
      }, 0);
    },

    // Calculates grand total in minor units including FBR fee
    calculateGrandTotal(cart, preferences, paymentMode, tier) {
      const sub = this.calculateSubtotal(cart);
      const tax = this.calculateTax(cart, preferences, paymentMode);
      
      const prefs = preferences || {};
      const isFbrEnabled = (tier === 'ENTERPRISE' || tier === 'TRIAL') && (prefs['fbr_integration_enabled'] === 'true' || prefs['fbr_integration_enabled'] === true);
      const fbrFee = isFbrEnabled ? 100 : 0;
      
      return sub + tax + fbrFee;
    }
  };

  globalScope.CheckoutEngine = CheckoutEngine;
})();
