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

    const btnClose = document.getElementById('btn-close-jewel-pricing-modal');
    const btnCancel = document.getElementById('btn-cancel-jewel-pricing-modal');
    const closeFn = () => modal.classList.remove('active');
    if (btnClose) btnClose.onclick = closeFn;
    if (btnCancel) btnCancel.onclick = closeFn;

    refreshModalCalc();
    modal.classList.add('active');
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
    saveRates,
    deriveRates,
    renderGoldRateTicker,
    openGoldRatesModal,
    openJewelPricingModal,
    init
  };

  init();

})(typeof window !== 'undefined' ? window : global);
