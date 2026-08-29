// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM — JEWELLERY & BULLION ENGINE (OFFLINE-FIRST)
// Version 3.3.0 — Merchant-Controlled Gold & Silver Rates, Karat Valuation & Compliance
// ============================================================================

(function(globalScope) {
  'use strict';

  // Conversion Constants: 1 Tola (تولہ) = 11.6638 Grams (گرام)
  const TOLA_TO_GRAMS = 11.6638;
  const GOLD_RATES_STORAGE_KEY = 'valenixia_gold_rates';

  // Legal & Regulatory Safety Notice for Merchant & Customer Protection
  const LEGAL_SAFETY_DISCLAIMER = `LEGAL NOTICE & DISCLAIMER: All bullion market rates, metal purities (Karats), stone valuations, wastage allowances (karta), and making charges are configured independently and manually by store management for internal commercial calculation and sales quotation. Valenixia POS is an offline point-of-sale utility and does not provide financial, market, assay, or legal advisory. Purity certification and agreed transaction valuations remain the sole legal responsibility of the transacting merchant and customer under prevailing local weights and measures regulations.`;

  // Standard Purity Ratios against 24K Pure Gold
  const PURITY_RATIOS = {
    '24K': 1.0,           // 99.9% Pure Gold
    '22K': 22.0 / 24.0,   // ~91.67% Standard Jewellery Gold
    '21K': 21.0 / 24.0,   // ~87.5% Gulf / Middle East Gold
    '18K': 18.0 / 24.0,   // ~75.0% Diamond / Stone Setting Gold
    '14K': 14.0 / 24.0,   // ~58.33% Modern Gold
    '925': 1.0            // 92.5% Sterling Silver (Independent Silver Rate)
  };

  // Baseline Fallback Rates (PKR per Tola) — Fully customisable by storekeeper
  const DEFAULT_RATES = {
    unit: 'tola', // 'tola' | 'gram'
    updatedAt: Date.now(),
    updatedBy: 'Store Manager',
    base24kTola: 275000, // PKR per tola for 24K Pure Gold
    silverTola: 3250,    // PKR per tola for 925 Sterling Silver
    rates: {
      '24K': { perTola: 275000, perGram: Math.round(275000 / TOLA_TO_GRAMS) },
      '22K': { perTola: Math.round(275000 * (22 / 24)), perGram: Math.round((275000 * (22 / 24)) / TOLA_TO_GRAMS) },
      '21K': { perTola: Math.round(275000 * (21 / 24)), perGram: Math.round((275000 * (21 / 24)) / TOLA_TO_GRAMS) },
      '18K': { perTola: Math.round(275000 * (18 / 24)), perGram: Math.round((275000 * (18 / 24)) / TOLA_TO_GRAMS) },
      '14K': { perTola: Math.round(275000 * (14 / 24)), perGram: Math.round((275000 * (14 / 24)) / TOLA_TO_GRAMS) },
      '925': { perTola: 3250, perGram: Math.round(3250 / TOLA_TO_GRAMS) }
    },
    defaultMakingPerGram: 2500, // PKR per gram labour
    defaultWastagePct: 2.0      // 2% default wastage / karta
  };

  // In-memory active rates cache
  let currentRates = loadRates();

  /**
   * Load rates from local storage with offline fallback
   */
  function loadRates() {
    try {
      const raw = localStorage.getItem(GOLD_RATES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.rates && parsed.rates['24K']) {
          return Object.assign({}, DEFAULT_RATES, parsed);
        }
      }
    } catch (e) {
      console.warn('[JewelleryEngine] Error loading stored rates, using defaults:', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_RATES));
  }

  /**
   * Save shopkeeper rates to local storage & memory, and trigger UI updates
   */
  function saveRates(newRates) {
    currentRates = Object.assign({}, currentRates, newRates, {
      updatedAt: Date.now(),
      updatedBy: (window.state && window.state.activeCashier && window.state.activeCashier.name) || 'Store Manager'
    });

    try {
      localStorage.setItem(GOLD_RATES_STORAGE_KEY, JSON.stringify(currentRates));
      if (window.state) {
        if (!window.state.preferences) window.state.preferences = {};
        window.state.preferences.gold_rates = currentRates;
      }
    } catch (e) {
      console.warn('[JewelleryEngine] Error saving rates to localStorage:', e);
    }

    renderGoldRateTicker();
    updateJewelPricingDisplays();

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('valenixia:gold-rates-updated', { detail: currentRates }));
    }

    return currentRates;
  }

  /**
   * Derive karat rates from base 24K and silver per-tola values
   */
  function deriveRates(base24kTola, silverTola) {
    const b24 = Number(base24kTola) || DEFAULT_RATES.base24kTola;
    const sil = Number(silverTola) || DEFAULT_RATES.silverTola;

    const rates = {
      '24K': { perTola: Math.round(b24), perGram: Math.round(b24 / TOLA_TO_GRAMS) },
      '22K': { perTola: Math.round(b24 * (22 / 24)), perGram: Math.round((b24 * (22 / 24)) / TOLA_TO_GRAMS) },
      '21K': { perTola: Math.round(b24 * (21 / 24)), perGram: Math.round((b24 * (21 / 24)) / TOLA_TO_GRAMS) },
      '18K': { perTola: Math.round(b24 * (18 / 24)), perGram: Math.round((b24 * (18 / 24)) / TOLA_TO_GRAMS) },
      '14K': { perTola: Math.round(b24 * (14 / 24)), perGram: Math.round((b24 * (14 / 24)) / TOLA_TO_GRAMS) },
      '925': { perTola: Math.round(sil), perGram: Math.round(sil / TOLA_TO_GRAMS) }
    };

    return { base24kTola: b24, silverTola: sil, rates };
  }

  /**
   * Get rate per gram for a specific karat
   */
  function getRatePerGram(karat = '22K') {
    const k = String(karat || '22K').toUpperCase().trim();
    if (currentRates.rates && currentRates.rates[k]) {
      return currentRates.rates[k].perGram || Math.round(currentRates.rates[k].perTola / TOLA_TO_GRAMS);
    }
    if (k === '925' || k.includes('SILVER')) {
      return (currentRates.rates && currentRates.rates['925'] && currentRates.rates['925'].perGram) || Math.round(DEFAULT_RATES.silverTola / TOLA_TO_GRAMS);
    }
    const ratio = PURITY_RATIOS[k] || (22 / 24);
    const b24 = currentRates.base24kTola || DEFAULT_RATES.base24kTola;
    return Math.round((b24 * ratio) / TOLA_TO_GRAMS);
  }

  /**
   * Get rate per tola for a specific karat
   */
  function getRatePerTola(karat = '22K') {
    const k = String(karat || '22K').toUpperCase().trim();
    if (currentRates.rates && currentRates.rates[k]) {
      return currentRates.rates[k].perTola;
    }
    const ratio = PURITY_RATIOS[k] || (22 / 24);
    const b24 = currentRates.base24kTola || DEFAULT_RATES.base24kTola;
    return Math.round(b24 * ratio);
  }

  /**
   * Price Calculation for Jewellery Piece
   */
  function calculatePiecePrice(spec = {}) {
    const karat = (spec.karat || '22K').toUpperCase().trim();
    const weightG = Math.max(0, parseFloat(spec.weight_g || spec.netWeightGrams || spec.weight || 0));
    const ratePerGram = spec.ratePerGramOverride !== undefined ? spec.ratePerGramOverride : getRatePerGram(karat);
    
    // Wastage / Karta
    const wastagePct = Math.max(0, parseFloat(spec.wastage_pct !== undefined ? spec.wastage_pct : (currentRates.defaultWastagePct || 0)));
    const metalBaseValue = weightG * ratePerGram;
    const wastageValue = metalBaseValue * (wastagePct / 100);
    const totalMetalValue = metalBaseValue + wastageValue;

    // Making Charges / Labour
    const makingType = spec.making_type || 'fixed'; // 'fixed' | 'per_gram'
    let makingValue = 0;
    if (makingType === 'per_gram') {
      const feePerGram = parseFloat(spec.making_fee || spec.makingCharge || currentRates.defaultMakingPerGram || 0);
      makingValue = weightG * feePerGram;
    } else {
      makingValue = parseFloat(spec.making_fee || spec.makingCharge || 0);
    }

    // Stone / Diamond Valuation
    const stoneValue = Math.max(0, parseFloat(spec.stone_price || spec.stoneValue || 0));
    const stoneWeightCarats = parseFloat(spec.stone_weight_ct || 0);
    const stoneDesc = spec.stone_desc || spec.stoneDetails || '';

    // Total Calculation
    const grandTotal = Math.round(totalMetalValue + makingValue + stoneValue);
    const grandTotalMinor = grandTotal * 100; // in minor units (paisa)

    return {
      karat,
      weightG,
      ratePerGram,
      ratePerTola: getRatePerTola(karat),
      metalBaseValue: Math.round(metalBaseValue),
      wastagePct,
      wastageValue: Math.round(wastageValue),
      totalMetalValue: Math.round(totalMetalValue),
      makingType,
      makingValue: Math.round(makingValue),
      stoneValue: Math.round(stoneValue),
      stoneWeightCarats,
      stoneDesc,
      grandTotal,
      grandTotalMinor
    };
  }

  /**
   * Calculate Gold / Bullion / Old Jewellery Trade-In Valuation
   * @param {Object} spec
   * @param {string} spec.karat - '24K' | '22K' | '21K' | '18K' | '14K' | '925'
   * @param {number} spec.grossWeightGrams - Gross scale weight in grams
   * @param {number} spec.stoneDeductionGrams - Deducted weight for stones, enamel, beads, wax
   * @param {number} [spec.wastagePct] - Melting / Katt % deduction (e.g. 2.0%)
   * @param {number} [spec.goldRatePerGram] - Rate override (optional, defaults to currentRates)
   * @param {number} [spec.goldRatePerTola] - Rate per tola override (optional)
   * @returns {Object} Full breakdown of trade-in value
   */
  function calculateGoldTradeIn(spec) {
    if (!spec) return null;
    const karat = spec.karat || '22K';
    const grossWeight = Math.max(0, parseFloat(spec.grossWeightGrams || spec.grossWeight || 0));
    const stoneDeduction = Math.max(0, parseFloat(spec.stoneDeductionGrams || spec.stoneWeight || 0));
    const netWeight = Math.max(0, parseFloat((grossWeight - stoneDeduction).toFixed(3)));
    
    const wastagePct = Math.max(0, parseFloat(spec.wastagePct !== undefined ? spec.wastagePct : (spec.kattPct !== undefined ? spec.kattPct : (currentRates.defaultWastagePct || 2.0))));
    
    let ratePerGram = 0;
    if (spec.goldRatePerGram && spec.goldRatePerGram > 0) {
      ratePerGram = parseFloat(spec.goldRatePerGram);
    } else if (spec.goldRatePerTola && spec.goldRatePerTola > 0) {
      ratePerGram = parseFloat(spec.goldRatePerTola) / TOLA_TO_GRAMS;
    } else {
      ratePerGram = getRatePerGram(karat);
    }

    const effectiveWeightGrams = Math.max(0, parseFloat((netWeight * (1 - (wastagePct / 100))).toFixed(3)));
    const grossValuation = netWeight * ratePerGram;
    const kattDeductionVal = grossValuation * (wastagePct / 100);
    const netValuation = Math.round(effectiveWeightGrams * ratePerGram);
    const netValuationMinor = netValuation * 100;

    return {
      karat,
      grossWeight,
      stoneDeduction,
      netWeight,
      wastagePct,
      ratePerGram: Math.round(ratePerGram),
      ratePerTola: Math.round(ratePerGram * TOLA_TO_GRAMS),
      grossValuation: Math.round(grossValuation),
      kattDeductionVal: Math.round(kattDeductionVal),
      effectiveWeightGrams,
      netValuation,
      valuationPKR: netValuation,
      netValuationMinor
    };
  }

  /**
   * Render Topbar Gold & Bullion Rate Ticker without emojis
   */
  function renderGoldRateTicker() {
    const tickerContainer = document.getElementById('gold-rate-ticker-container') || document.getElementById('topbar-center-context');
    if (!tickerContainer) return;

    const currentMode = (typeof localStorage !== 'undefined' && localStorage.getItem('valenixia_shop_mode')) ||
                        (window.state && window.state.preferences && (window.state.preferences.shop_mode || window.state.preferences.store_type)) || 'simple-retail';
    
    const isJewellery = (currentMode === 'jewellery');

    if (!isJewellery) {
      if (document.getElementById('gold-rate-ticker-badge')) {
        document.getElementById('gold-rate-ticker-badge').style.display = 'none';
      }
      return;
    }

    const r24 = currentRates.rates['24K'] || { perTola: 275000, perGram: 23577 };
    const r22 = currentRates.rates['22K'] || { perTola: 252083, perGram: 21612 };
    const r21 = currentRates.rates['21K'] || { perTola: 240625, perGram: 20630 };
    const sil = currentRates.rates['925'] || { perTola: 3250, perGram: 279 };

    const fmt = (num) => Number(num).toLocaleString('en-PK');

    let badge = document.getElementById('gold-rate-ticker-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'gold-rate-ticker-badge';
      badge.className = 'gold-rate-ticker-badge';
      tickerContainer.appendChild(badge);
    }

    badge.style.display = 'inline-flex';
    badge.innerHTML = `
      <div class="gold-ticker-inner" onclick="window.ValenixiaJewellery.openGoldRatesModal()" title="Click to view and adjust Daily Gold & Silver Rates (Set by Storekeeper)">
        <span class="gold-ticker-label">BULLION RATES:</span>
        <div class="gold-ticker-rates">
          <span class="ticker-item"><strong class="k-tag">24K:</strong> Rs. ${fmt(r24.perTola)}<small>/Tola</small></span>
          <span class="ticker-sep">•</span>
          <span class="ticker-item"><strong class="k-tag">22K:</strong> Rs. ${fmt(r22.perTola)}<small>/Tola</small></span>
          <span class="ticker-sep">•</span>
          <span class="ticker-item"><strong class="k-tag">21K:</strong> Rs. ${fmt(r21.perTola)}<small>/Tola</small></span>
          <span class="ticker-sep">•</span>
          <span class="ticker-item silver-item"><strong class="k-tag">Silver:</strong> Rs. ${fmt(sil.perTola)}<small>/Tola</small></span>
        </div>
        <button type="button" class="gold-ticker-edit-btn" aria-label="Adjust daily gold rates">
          <span>Set Rates</span>
        </button>
      </div>
    `;
  }

  /**
   * Open Daily Bullion & Gold Rates Manager Modal
   */
  function openGoldRatesModal() {
    const modal = document.getElementById('modal-gold-rates');
    if (!modal) {
      console.warn('[JewelleryEngine] modal-gold-rates DOM element not found');
      return;
    }

    try { if (typeof window.playAudioSignal === 'function') window.playAudioSignal('click'); } catch (_) {}

    let activeUnit = currentRates.unit || 'tola'; // 'tola' | 'gram'

    const updateModalUI = () => {
      const btnTola = document.getElementById('btn-rate-unit-tola');
      const btnGram = document.getElementById('btn-rate-unit-gram');
      if (btnTola && btnGram) {
        btnTola.classList.toggle('active', activeUnit === 'tola');
        btnGram.classList.toggle('active', activeUnit === 'gram');
      }

      const karats = ['24K', '22K', '21K', '18K', '14K', '925'];
      karats.forEach(k => {
        const val = currentRates.rates[k] ? (activeUnit === 'tola' ? currentRates.rates[k].perTola : currentRates.rates[k].perGram) : 0;
        const input = document.getElementById(`input-rate-${k.toLowerCase()}`);
        if (input) {
          input.value = val;
        }
        const unitLbl = document.getElementById(`lbl-unit-${k.toLowerCase()}`);
        if (unitLbl) {
          unitLbl.textContent = activeUnit === 'tola' ? 'PKR / Tola' : 'PKR / Gram';
        }
        const convertedSub = document.getElementById(`sub-rate-${k.toLowerCase()}`);
        if (convertedSub) {
          const tolaVal = currentRates.rates[k]?.perTola || 0;
          const gramVal = currentRates.rates[k]?.perGram || 0;
          convertedSub.textContent = activeUnit === 'tola' 
            ? `approx. Rs. ${gramVal.toLocaleString('en-PK')} / gram`
            : `approx. Rs. ${tolaVal.toLocaleString('en-PK')} / tola`;
        }
      });

      const defaultMakingInput = document.getElementById('input-default-making');
      if (defaultMakingInput) defaultMakingInput.value = currentRates.defaultMakingPerGram || 2500;
      
      const defaultWastageInput = document.getElementById('input-default-wastage');
      if (defaultWastageInput) defaultWastageInput.value = currentRates.defaultWastagePct || 2.0;

      const updatedBadge = document.getElementById('gold-rates-last-updated');
      if (updatedBadge) {
        const d = new Date(currentRates.updatedAt || Date.now());
        updatedBadge.textContent = `Manual Storekeeper Rates • Last updated: ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} by ${currentRates.updatedBy || 'Storekeeper'}`;
      }
    };

    const btnTola = document.getElementById('btn-rate-unit-tola');
    const btnGram = document.getElementById('btn-rate-unit-gram');
    if (btnTola && !btnTola.dataset.bound) {
      btnTola.dataset.bound = 'true';
      btnTola.addEventListener('click', () => {
        activeUnit = 'tola';
        updateModalUI();
      });
    }
    if (btnGram && !btnGram.dataset.bound) {
      btnGram.dataset.bound = 'true';
      btnGram.addEventListener('click', () => {
        activeUnit = 'gram';
        updateModalUI();
      });
    }

    const cardBody = modal.querySelector('.modal-body');
    if (cardBody && !cardBody.dataset.stepBound) {
      cardBody.dataset.stepBound = 'true';
      cardBody.addEventListener('click', (e) => {
        const stepBtn = e.target.closest('.rate-step-btn');
        if (!stepBtn) return;
        e.preventDefault();
        
        const karat = stepBtn.getAttribute('data-karat');
        const delta = parseInt(stepBtn.getAttribute('data-delta') || '0', 10);
        if (!karat || !delta) return;

        if (currentRates.rates[karat]) {
          if (activeUnit === 'tola') {
            currentRates.rates[karat].perTola = Math.max(100, (currentRates.rates[karat].perTola || 0) + delta);
            currentRates.rates[karat].perGram = Math.round(currentRates.rates[karat].perTola / TOLA_TO_GRAMS);
          } else {
            currentRates.rates[karat].perGram = Math.max(10, (currentRates.rates[karat].perGram || 0) + delta);
            currentRates.rates[karat].perTola = Math.round(currentRates.rates[karat].perGram * TOLA_TO_GRAMS);
          }
          if (karat === '24K') {
            currentRates.base24kTola = currentRates.rates['24K'].perTola;
          } else if (karat === '925') {
            currentRates.silverTola = currentRates.rates['925'].perTola;
          }
          updateModalUI();
        }
      });

      modal.querySelectorAll('.rate-bulk-shift-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const pct = parseFloat(btn.getAttribute('data-pct') || '0');
          if (!pct) return;

          const factor = 1 + (pct / 100);
          ['24K', '22K', '21K', '18K', '14K'].forEach(k => {
            if (currentRates.rates[k]) {
              currentRates.rates[k].perTola = Math.round(currentRates.rates[k].perTola * factor);
              currentRates.rates[k].perGram = Math.round(currentRates.rates[k].perTola / TOLA_TO_GRAMS);
            }
          });
          currentRates.base24kTola = currentRates.rates['24K'].perTola;
          updateModalUI();
          if (typeof window.showNotificationToast === 'function') {
            window.showNotificationToast(`Shifted all gold rates by ${pct > 0 ? '+' : ''}${pct}%`, 'info', 2000);
          }
        });
      });

      const btnDerive = document.getElementById('btn-derive-all-karats');
      if (btnDerive) {
        btnDerive.addEventListener('click', (e) => {
          e.preventDefault();
          const b24 = currentRates.rates['24K']?.perTola || DEFAULT_RATES.base24kTola;
          const sil = currentRates.rates['925']?.perTola || DEFAULT_RATES.silverTola;
          const derived = deriveRates(b24, sil);
          currentRates.rates = derived.rates;
          currentRates.base24kTola = derived.base24kTola;
          currentRates.silverTola = derived.silverTola;
          updateModalUI();
          if (typeof window.showNotificationToast === 'function') {
            window.showNotificationToast('Calculated standard 22K, 21K, 18K & 14K rates from 24K.', 'success', 2500);
          }
        });
      }
    }

    ['24k', '22k', '21k', '18k', '14k', '925'].forEach(kLower => {
      const input = document.getElementById(`input-rate-${kLower}`);
      if (input && !input.dataset.bound) {
        input.dataset.bound = 'true';
        input.addEventListener('input', () => {
          const k = kLower.toUpperCase();
          const val = parseFloat(input.value || '0');
          if (currentRates.rates[k]) {
            if (activeUnit === 'tola') {
              currentRates.rates[k].perTola = val;
              currentRates.rates[k].perGram = Math.round(val / TOLA_TO_GRAMS);
            } else {
              currentRates.rates[k].perGram = val;
              currentRates.rates[k].perTola = Math.round(val * TOLA_TO_GRAMS);
            }
            if (k === '24K') currentRates.base24kTola = currentRates.rates['24K'].perTola;
            if (k === '925') currentRates.silverTola = currentRates.rates['925'].perTola;

            const convertedSub = document.getElementById(`sub-rate-${kLower}`);
            if (convertedSub) {
              const tolaVal = currentRates.rates[k]?.perTola || 0;
              const gramVal = currentRates.rates[k]?.perGram || 0;
              convertedSub.textContent = activeUnit === 'tola' 
                ? `approx. Rs. ${gramVal.toLocaleString('en-PK')} / gram`
                : `approx. Rs. ${tolaVal.toLocaleString('en-PK')} / tola`;
            }
          }
        });
      }
    });

    const btnSave = document.getElementById('btn-save-gold-rates');
    if (btnSave && !btnSave.dataset.bound) {
      btnSave.dataset.bound = 'true';
      btnSave.addEventListener('click', () => {
        const defMaking = parseFloat(document.getElementById('input-default-making')?.value || '2500');
        const defWastage = parseFloat(document.getElementById('input-default-wastage')?.value || '2.0');
        currentRates.defaultMakingPerGram = defMaking;
        currentRates.defaultWastagePct = defWastage;
        currentRates.unit = activeUnit;

        saveRates(currentRates);
        modal.classList.remove('active');

        try { if (typeof window.playAudioSignal === 'function') window.playAudioSignal('success'); } catch (_) {}
        if (typeof window.showNotificationToast === 'function') {
          window.showNotificationToast('Daily bullion & gold rates saved and applied to register.', 'success', 3500);
        }
      });
    }

    const btnClose = document.getElementById('btn-close-gold-rates');
    const btnCancel = document.getElementById('btn-cancel-gold-rates');
    const closeFn = () => modal.classList.remove('active');
    if (btnClose && !btnClose.dataset.bound) { btnClose.dataset.bound = 'true'; btnClose.addEventListener('click', closeFn); }
    if (btnCancel && !btnCancel.dataset.bound) { btnCancel.dataset.bound = 'true'; btnCancel.addEventListener('click', closeFn); }

    updateModalUI();
    modal.classList.add('active');
  }

  /**
   * Open Jewellery Item Valuation & Customization Counter Modal
   */
  function openJewelPricingModal(prod, onApplyCallback) {
    if (!prod) return;
    const modal = document.getElementById('modal-jewel-pricing');
    if (!modal) {
      if (typeof onApplyCallback === 'function') {
        onApplyCallback(prod);
      }
      return;
    }

    try { if (typeof window.playAudioSignal === 'function') window.playAudioSignal('click'); } catch (_) {}

    let modeFields = {};
    try {
      modeFields = (typeof prod.mode_fields === 'string') ? JSON.parse(prod.mode_fields || '{}') : (prod.mode_fields || {});
    } catch (_) {}

    let activeKarat = modeFields.karat || prod.karat || '22K';
    let activeWeight = parseFloat(modeFields.weight_g || prod.netWeightGrams || prod.weight_g || 10.0);
    let activeMakingFee = parseFloat(modeFields.making_fee || prod.makingCharge || currentRates.defaultMakingPerGram * activeWeight || 25000);
    let activeMakingType = modeFields.making_type || 'fixed';
    let activeWastagePct = parseFloat(modeFields.wastage_pct !== undefined ? modeFields.wastage_pct : currentRates.defaultWastagePct || 2.0);
    let activeStoneVal = parseFloat(modeFields.stone_price || prod.stoneValue || 0);
    let activeStoneDesc = modeFields.stone_desc || prod.stoneDetails || '';
    let activeCertId = modeFields.cert_id || prod.certificateId || '';

    const titleEl = document.getElementById('jewel-modal-prod-title');
    const skuEl = document.getElementById('jewel-modal-prod-sku');
    if (titleEl) titleEl.textContent = prod.name;
    if (skuEl) skuEl.textContent = `SKU: ${prod.sku} | Category: ${prod.category || 'Jewellery'}`;

    const karatSelect = document.getElementById('jewel-modal-karat-select');
    const weightInput = document.getElementById('jewel-modal-weight-input');
    const rateGramDisplay = document.getElementById('jewel-modal-rate-gram-display');
    const wastageInput = document.getElementById('jewel-modal-wastage-input');
    const makingFeeInput = document.getElementById('jewel-modal-making-input');
    const makingTypeSelect = document.getElementById('jewel-modal-making-type');
    const stoneValInput = document.getElementById('jewel-modal-stone-val-input');
    const stoneDescInput = document.getElementById('jewel-modal-stone-desc-input');
    const certInput = document.getElementById('jewel-modal-cert-input');

    if (karatSelect) karatSelect.value = activeKarat;
    if (weightInput) weightInput.value = activeWeight;
    if (wastageInput) wastageInput.value = activeWastagePct;
    if (makingFeeInput) makingFeeInput.value = activeMakingFee;
    if (makingTypeSelect) makingTypeSelect.value = activeMakingType;
    if (stoneValInput) stoneValInput.value = activeStoneVal || '';
    if (stoneDescInput) stoneDescInput.value = activeStoneDesc;
    if (certInput) certInput.value = activeCertId;

    const refreshModalCalc = () => {
      const k = karatSelect ? karatSelect.value : activeKarat;
      const w = parseFloat(weightInput?.value || '0');
      const was = parseFloat(wastageInput?.value || '0');
      const mf = parseFloat(makingFeeInput?.value || '0');
      const mt = makingTypeSelect ? makingTypeSelect.value : 'fixed';
      const stVal = parseFloat(stoneValInput?.value || '0');
      const stDesc = stoneDescInput ? stoneDescInput.value.trim() : '';
      const cert = certInput ? certInput.value.trim() : '';

      const calc = calculatePiecePrice({
        karat: k,
        weight_g: w,
        wastage_pct: was,
        making_fee: mf,
        making_type: mt,
        stone_price: stVal,
        stone_desc: stDesc
      });

      if (rateGramDisplay) {
        rateGramDisplay.textContent = `Applied Rate: Rs. ${calc.ratePerGram.toLocaleString('en-PK')} / g (Rs. ${calc.ratePerTola.toLocaleString('en-PK')} / tola)`;
      }

      const metalValEl = document.getElementById('jewel-modal-calc-metal-val');
      const wastageValEl = document.getElementById('jewel-modal-calc-wastage-val');
      const makingValEl = document.getElementById('jewel-modal-calc-making-val');
      const stoneValEl = document.getElementById('jewel-modal-calc-stone-val');
      const grandTotalEl = document.getElementById('jewel-modal-calc-grand-total');

      if (metalValEl) metalValEl.textContent = `Rs. ${calc.metalBaseValue.toLocaleString('en-PK')}`;
      if (wastageValEl) wastageValEl.textContent = `+ Rs. ${calc.wastageValue.toLocaleString('en-PK')} (${was}%)`;
      if (makingValEl) makingValEl.textContent = `+ Rs. ${calc.makingValue.toLocaleString('en-PK')}`;
      if (stoneValEl) stoneValEl.textContent = `+ Rs. ${calc.stoneValue.toLocaleString('en-PK')}`;
      if (grandTotalEl) grandTotalEl.textContent = `Rs. ${calc.grandTotal.toLocaleString('en-PK')}`;

      return Object.assign({}, calc, { certId: cert });
    };

    [karatSelect, weightInput, wastageInput, makingFeeInput, makingTypeSelect, stoneValInput, stoneDescInput, certInput].forEach(el => {
      if (el && !el.dataset.bound) {
        el.dataset.bound = 'true';
        el.addEventListener('input', refreshModalCalc);
        el.addEventListener('change', refreshModalCalc);
      }
    });

    modal.querySelectorAll('.jewel-weight-step-btn').forEach(btn => {
      if (!btn.dataset.bound) {
        btn.dataset.bound = 'true';
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const delta = parseFloat(btn.getAttribute('data-delta') || '0');
          if (weightInput) {
            const currentW = parseFloat(weightInput.value || '0');
            weightInput.value = Math.max(0.01, parseFloat((currentW + delta).toFixed(3)));
            refreshModalCalc();
          }
        });
      }
    });

    const btnApply = document.getElementById('btn-jewel-modal-apply');
    if (btnApply) {
      btnApply.onclick = (e) => {
        e.preventDefault();
        const finalCalc = refreshModalCalc();
        modal.classList.remove('active');

        if (typeof onApplyCallback === 'function') {
          onApplyCallback(prod, finalCalc);
        }
      };
    }
  }

  /**
   * Open Gold Trade-In & Old Gold Exchange Appraisal Modal
   * @param {Object} options
   * @param {Function} onApplyCallback
   */
  function openGoldTradeInModal(options, onApplyCallback) {
    let modal = document.getElementById('modal-gold-tradein');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-gold-tradein';
      modal.className = 'pos-modal-overlay';
      modal.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.75); backdrop-filter: blur(8px); display: none; align-items: center; justify-content: center; z-index: 9999; padding: 16px; box-sizing: border-box;';
      modal.innerHTML = `
        <div class="pos-modal-card" style="background: var(--bg-surface-elevated, #11141a); border: 1px solid var(--border-titanium, rgba(255,255,255,0.15)); border-radius: 14px; max-width: 580px; width: 100%; max-height: 92vh; overflow-y: auto; box-shadow: 0 24px 60px rgba(0,0,0,0.5); display: flex; flex-direction: column; box-sizing: border-box;">
          
          <!-- Modal Header -->
          <div style="padding: 16px 20px; border-bottom: 1px solid var(--border-titanium, rgba(255,255,255,0.1)); display: flex; justify-content: space-between; align-items: center; background: rgba(245,158,11,0.06); box-sizing: border-box;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 34px; height: 34px; border-radius: 8px; background: rgba(245,158,11,0.15); border: 1px solid rgba(245,158,11,0.4); display: flex; align-items: center; justify-content: center; color: #f59e0b;">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20"/><path d="M10 3l2 6 2-6"/></svg>
              </div>
              <div>
                <h3 style="margin: 0; font-size: 15px; font-weight: 900; color: var(--text-white, #fff); letter-spacing: -0.2px;">Old Gold &amp; Jewellery Trade-In Calculator</h3>
                <span style="font-size: 11px; color: #f59e0b; font-weight: 700;">سونے کا تبادلہ اور ویلیویشن</span>
              </div>
            </div>
            <button type="button" id="btn-close-gold-tradein-modal-x" class="action-btn" style="background: transparent; border: none; font-size: 20px; color: var(--text-gray, #94a3b8); cursor: pointer; padding: 4px 8px;">&times;</button>
          </div>

          <!-- Modal Body -->
          <div class="modal-body-wrapper" style="padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; box-sizing: border-box;">
            
            <!-- Item Description -->
            <div>
              <label for="gold-tradein-item-name" style="font-size: 11px; font-weight: 700; color: var(--text-white, #fff); display: block; margin-bottom: 4px;">Item Description / Category *</label>
              <input type="text" id="gold-tradein-item-name" class="pos-input" placeholder="e.g. 22K Old Bridal Bangles / Kangan (چوڑیاں)" value="22K Old Jewellery Exchange" style="font-size: 12px; width: 100%; box-sizing: border-box;" aria-label="Item Description">
            </div>

            <!-- Karat & Market Rate Row -->
            <div class="buyback-2col-grid">
              <div>
                <label for="gold-tradein-karat" style="font-size: 11px; font-weight: 700; color: var(--text-white, #fff); display: block; margin-bottom: 4px;">Karat Purity Grade *</label>
                <select id="gold-tradein-karat" class="pos-input" style="font-size: 12px; font-weight: 700; color: #f59e0b; width: 100%; box-sizing: border-box;" aria-label="Karat Grade">
                  <option value="24K">24K Pure Gold (99.9%)</option>
                  <option value="22K" selected>22K Standard Jewellery (91.6%)</option>
                  <option value="21K">21K Gulf Gold (87.5%)</option>
                  <option value="18K">18K Diamond / Gem Setting (75.0%)</option>
                  <option value="14K">14K Commercial Gold (58.3%)</option>
                  <option value="925">925 Sterling Silver</option>
                </select>
              </div>
              <div>
                <label for="gold-tradein-rate-gram" style="font-size: 11px; font-weight: 700; color: var(--text-white, #fff); display: block; margin-bottom: 4px;">Agreed Rate / Gram (PKR) *</label>
                <div class="pos-input-group gold-focus">
                  <span class="pos-input-prefix gold-text">Rs.</span>
                  <input type="number" id="gold-tradein-rate-gram" class="pos-input" placeholder="e.g. 21612" min="1" step="1" style="font-size: 13px; font-weight: 800;" aria-label="Rate Per Gram">
                </div>
              </div>
            </div>

            <!-- Weight Breakdown: Gross, Stone, Net -->
            <div class="buyback-calc-card">
              <div class="buyback-weight-grid">
                <div>
                  <label for="gold-tradein-gross-weight" style="font-size: 10.5px; font-weight: 700; color: var(--text-white, #fff); display: block; margin-bottom: 4px;">Gross Scale Wt (g) *</label>
                  <input type="number" id="gold-tradein-gross-weight" class="pos-input" placeholder="0.000" min="0.01" step="0.001" value="10.000" style="font-size: 13px; font-weight: 800; width: 100%; box-sizing: border-box;" aria-label="Gross Weight">
                </div>
                <div>
                  <label for="gold-tradein-stone-deduction" style="font-size: 10.5px; font-weight: 700; color: var(--text-white, #fff); display: block; margin-bottom: 4px;">Stone/Beads Wt (g)</label>
                  <input type="number" id="gold-tradein-stone-deduction" class="pos-input" placeholder="0.000" min="0" step="0.001" value="0.000" style="font-size: 13px; font-weight: 800; color: #ef4444; width: 100%; box-sizing: border-box;" aria-label="Stone Deduction">
                </div>
                <div>
                  <label style="font-size: 10.5px; font-weight: 700; color: var(--accent-emerald, #00d68f); display: block; margin-bottom: 4px;">Net Metal Wt (g)</label>
                  <div id="gold-tradein-net-weight-display" class="buyback-net-wt-display">10.000 g</div>
                </div>
              </div>

              <!-- Quick Step Buttons -->
              <div style="display: flex; gap: 6px; align-items: center; justify-content: flex-end; flex-wrap: wrap; margin-top: 4px;">
                <span style="font-size: 10.5px; color: var(--text-gray, #94a3b8); margin-right: auto;">Quick Adjust Gross:</span>
                <button type="button" class="action-btn gold-tradein-step-btn" data-delta="0.5" style="font-size: 11px; padding: 3px 8px; border-radius: 6px;">+0.5g</button>
                <button type="button" class="action-btn gold-tradein-step-btn" data-delta="1.0" style="font-size: 11px; padding: 3px 8px; border-radius: 6px;">+1.0g</button>
                <button type="button" class="action-btn gold-tradein-step-btn" data-delta="5.0" style="font-size: 11px; padding: 3px 8px; border-radius: 6px;">+5.0g</button>
                <button type="button" class="action-btn gold-tradein-step-btn" data-delta="-1.0" style="font-size: 11px; padding: 3px 8px; border-radius: 6px;">-1.0g</button>
              </div>
            </div>

            <!-- Melting / Katt % & Wastage -->
            <div class="buyback-2col-grid" style="align-items: center;">
              <div>
                <label for="gold-tradein-katt-pct" style="font-size: 11px; font-weight: 700; color: var(--text-white, #fff); display: block; margin-bottom: 4px;">Melting Loss / Katt (% کاٹ)</label>
                <div class="pos-input-group gold-focus">
                  <input type="number" id="gold-tradein-katt-pct" class="pos-input" placeholder="e.g. 2.0" min="0" max="50" step="0.1" value="2.0" style="font-size: 12px; font-weight: 700;" aria-label="Melting Katt Percentage">
                  <span class="pos-input-suffix gold-text">%</span>
                </div>
              </div>
              <div style="background: rgba(255,255,255,0.02); padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-titanium, rgba(255,255,255,0.08));">
                <span style="font-size: 10px; color: var(--text-gray, #94a3b8); display: block; margin-bottom: 2px;">Pure Melt Yield:</span>
                <div id="gold-tradein-effective-weight-display" style="font-size: 12px; font-weight: 800; color: var(--text-white, #fff);">9.800 g (98.0%)</div>
              </div>
            </div>

            <!-- Customer Legal Details (Brief) -->
            <div class="buyback-2col-grid" style="border-top: 1px solid var(--border-titanium, rgba(255,255,255,0.08)); padding-top: 10px;">
              <div>
                <label for="gold-tradein-seller-name" style="font-size: 10.5px; font-weight: 700; color: var(--text-white, #fff); display: block; margin-bottom: 4px;">Seller Name</label>
                <input type="text" id="gold-tradein-seller-name" class="pos-input" placeholder="Walk-in Client" style="font-size: 11.5px; width: 100%; box-sizing: border-box;" aria-label="Seller Name">
              </div>
              <div>
                <label for="gold-tradein-seller-cnic" style="font-size: 10.5px; font-weight: 700; color: var(--text-white, #fff); display: block; margin-bottom: 4px;">CNIC / Phone #</label>
                <input type="text" id="gold-tradein-seller-cnic" class="pos-input" placeholder="CNIC or Mobile #" style="font-size: 11.5px; width: 100%; box-sizing: border-box;" aria-label="Seller CNIC or Phone">
              </div>
            </div>

            <!-- Total Valuation Banner -->
            <div class="buyback-valuation-card">
              <div>
                <span class="val-title">Total Trade-In Valuation</span>
                <span class="val-sub">Net Metal &times; Rate &minus; Melting Katt</span>
              </div>
              <div>
                <span id="gold-tradein-total-valuation-display" class="val-amount">Rs. 0</span>
              </div>
            </div>

          </div>

          <!-- Modal Footer Actions -->
          <div style="padding: 14px 20px; border-top: 1px solid var(--border-titanium, rgba(255,255,255,0.1)); display: flex; gap: 10px; justify-content: flex-end; background: rgba(0,0,0,0.08); box-sizing: border-box;">
            <button type="button" id="btn-cancel-gold-tradein-modal" class="action-btn" style="font-size: 12px; padding: 8px 16px;">Cancel</button>
            <button type="button" id="btn-apply-gold-tradein-cart" class="action-btn action-success" style="font-size: 12px; font-weight: 800; padding: 8px 18px; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 4px 14px rgba(0,214,143,0.3);">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              Apply Trade-In Credit to Order
            </button>
          </div>

        </div>
      `;
      document.body.appendChild(modal);
    }

    try { if (typeof window.playAudioSignal === 'function') window.playAudioSignal('click'); } catch (_) {}

    const itemNameInput = modal.querySelector('#gold-tradein-item-name');
    const karatSelect = modal.querySelector('#gold-tradein-karat');
    const rateInput = modal.querySelector('#gold-tradein-rate-gram');
    const grossWeightInput = modal.querySelector('#gold-tradein-gross-weight');
    const stoneDeductionInput = modal.querySelector('#gold-tradein-stone-deduction');
    const kattInput = modal.querySelector('#gold-tradein-katt-pct');
    const sellerNameInput = modal.querySelector('#gold-tradein-seller-name');
    const sellerCnicInput = modal.querySelector('#gold-tradein-seller-cnic');
    const netWeightDisplay = modal.querySelector('#gold-tradein-net-weight-display');
    const effWeightDisplay = modal.querySelector('#gold-tradein-effective-weight-display');
    const totalValuationDisplay = modal.querySelector('#gold-tradein-total-valuation-display');

    if (options && options.sellerName && sellerNameInput) sellerNameInput.value = options.sellerName;
    if (options && options.sellerPhone && sellerCnicInput) sellerCnicInput.value = options.sellerPhone;

    // Set initial rate based on karat
    const updateRateFromKarat = () => {
      const k = karatSelect.value;
      const r = getRatePerGram(k);
      if (rateInput) rateInput.value = r;
    };
    updateRateFromKarat();

    const refreshCalc = () => {
      const karat = karatSelect ? karatSelect.value : '22K';
      const grossW = parseFloat(grossWeightInput?.value || '0');
      const stoneW = parseFloat(stoneDeductionInput?.value || '0');
      const katt = parseFloat(kattInput?.value || '0');
      const rateG = parseFloat(rateInput?.value || '0');

      const calc = calculateGoldTradeIn({
        karat,
        grossWeightGrams: grossW,
        stoneDeductionGrams: stoneW,
        wastagePct: katt,
        goldRatePerGram: rateG
      });

      if (netWeightDisplay) netWeightDisplay.textContent = `${calc.netWeight.toFixed(3)} g`;
      if (effWeightDisplay) effWeightDisplay.textContent = `${calc.effectiveWeightGrams.toFixed(3)} g (${(100 - calc.wastagePct).toFixed(1)}%)`;
      if (totalValuationDisplay) totalValuationDisplay.textContent = `Rs. ${calc.netValuation.toLocaleString('en-PK')}`;

      return calc;
    };

    karatSelect.onchange = () => {
      updateRateFromKarat();
      refreshCalc();
    };
    if (rateInput) rateInput.oninput = refreshCalc;
    if (grossWeightInput) grossWeightInput.oninput = refreshCalc;
    if (stoneDeductionInput) stoneDeductionInput.oninput = refreshCalc;
    if (kattInput) kattInput.oninput = refreshCalc;

    modal.querySelectorAll('.gold-tradein-step-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        const delta = parseFloat(btn.getAttribute('data-delta') || '0');
        if (grossWeightInput) {
          const cur = parseFloat(grossWeightInput.value || '0');
          grossWeightInput.value = Math.max(0.01, parseFloat((cur + delta).toFixed(3)));
          refreshCalc();
        }
      };
    });

    const closeModal = () => {
      modal.classList.remove('active');
      modal.style.display = 'none';
    };

    const btnCloseX = modal.querySelector('#btn-close-gold-tradein-modal-x');
    const btnCancel = modal.querySelector('#btn-cancel-gold-tradein-modal');
    if (btnCloseX) btnCloseX.onclick = closeModal;
    if (btnCancel) btnCancel.onclick = closeModal;

    const btnApply = modal.querySelector('#btn-apply-gold-tradein-cart');
    if (btnApply) {
      btnApply.onclick = (e) => {
        e.preventDefault();
        const calc = refreshCalc();
        if (!calc || calc.netValuation <= 0) {
          if (typeof window.showNotificationToast === 'function') {
            window.showNotificationToast('Please enter a valid weight and rate for gold valuation.', 'warning');
          }
          return;
        }

        const tradeInRecord = {
          id: 'bb_gold_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
          voucher_no: `VCH-GOLD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
          item_type: 'GOLD',
          brand: 'Gold Trade-In',
          model: `${calc.karat} Old Gold (${calc.netWeight}g)`,
          seller_name: sellerNameInput?.value?.trim() || 'Walk-in Client',
          seller_phone: sellerCnicInput?.value?.trim() || '',
          seller_cnic: sellerCnicInput?.value?.trim() || '',
          karat: calc.karat,
          gross_weight_g: calc.grossWeight,
          stone_deduction_g: calc.stoneDeduction,
          net_weight_g: calc.netWeight,
          rate_per_gram: calc.ratePerGram,
          rate_per_tola: calc.ratePerTola,
          wastage_katt_pct: calc.wastagePct,
          effective_weight_g: calc.effectiveWeightGrams,
          payout_paise: calc.netValuationMinor,
          payout_method: 'STORE_CREDIT',
          added_to_inventory: true,
          notes: itemNameInput?.value?.trim() || 'Old gold exchange trade-in voucher',
          created_at: Date.now()
        };

        if (typeof window.saveBuybackRecord === 'function') {
          window.saveBuybackRecord(tradeInRecord).catch(() => {});
        }

        closeModal();

        if (typeof onApplyCallback === 'function') {
          onApplyCallback(tradeInRecord, calc);
        } else if (typeof window.applyTradeInToCart === 'function') {
          window.applyTradeInToCart(tradeInRecord);
        }
      };
    }

    refreshCalc();
    modal.classList.add('active');
    modal.style.display = 'flex';
  }

  function updateJewelPricingDisplays() {
    // Keep agreed checkout prices intact
  }

  function init() {
    currentRates = loadRates();
    renderGoldRateTicker();

    window.addEventListener('valenixia:store-mode-changed', () => {
      renderGoldRateTicker();
    });

    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          setTimeout(renderGoldRateTicker, 100);
        });
      } else {
        setTimeout(renderGoldRateTicker, 100);
      }
    }
  }

  // Export public API to global scope
  globalScope.ValenixiaJewellery = {
    TOLA_TO_GRAMS,
    PURITY_RATIOS,
    DEFAULT_RATES,
    LEGAL_SAFETY_DISCLAIMER,
    getRates: () => currentRates,
    getRatePerGram,
    getRatePerTola,
    calculatePiecePrice,
    calculateGoldTradeIn,
    saveRates,
    deriveRates,
    renderGoldRateTicker,
    openGoldRatesModal,
    openJewelPricingModal,
    openGoldTradeInModal,
    init
  };

  init();

})(typeof window !== 'undefined' ? window : global);

