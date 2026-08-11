/* ============================================================================
   VALENIXIA COMMERCE ECOSYSTEM — SUBSCRIPTION & BILLING ENGINE v2.6.0
   Canonical Domain Controller: window.ValenixiaSubscription
   ============================================================================ */

(function() {
  'use strict';

  let isInitialized = false;
  let activeTab = 'overview';
  let activeCycle = 'subscription'; // 'subscription' | 'annual' | 'lifetime'
  let activePaymentRail = 'NAYAPAY';
  let activeQuote = null;

  const PAYMENT_RAILS = {
    NAYAPAY: {
      id: 'NAYAPAY',
      displayName: 'NayaPay Digital Wallet',
      instructions: 'Transfer funds to NayaPay Account 0331-5133226. Enter your 12-digit RRN / Reference number below.',
      requiresReference: true,
      refLabel: 'NayaPay RRN Reference'
    },
    BANK_TRANSFER: {
      id: 'BANK_TRANSFER',
      displayName: 'Direct Bank Transfer (IBAN)',
      instructions: 'Transfer funds to Meezan Bank IBAN PK80MEZN0001020304050607. Account Name: Valenixia Commerce. Enter Bank Transaction Ref below.',
      requiresReference: true,
      refLabel: 'Bank Transaction Ref / FT ID'
    },
    EASYPAISA: {
      id: 'EASYPAISA',
      displayName: 'Easypaisa Mobile Account',
      instructions: 'Send money via Easypaisa to 0331-5133226. Enter your TRX / Reference ID below.',
      requiresReference: true,
      refLabel: 'Easypaisa TRX ID'
    },
    JAZZCASH: {
      id: 'JAZZCASH',
      displayName: 'JazzCash Mobile Account',
      instructions: 'Send money via JazzCash to 0331-5133226. Enter your Transaction TID below.',
      requiresReference: true,
      refLabel: 'JazzCash TID Reference'
    }
  };

  const ValenixiaSubscription = {
    getState() {
      return {
        isInitialized,
        activeTab,
        activeCycle,
        activePaymentRail,
        activeQuote
      };
    },

    activateTab(tabName) {
      if (!tabName) return;
      const targetSubtab = tabName.toLowerCase();
      activeTab = targetSubtab;

      const subNavItems = document.querySelectorAll('.subscription-sidebar .sub-nav-item, #sub-vault-nav .sub-nav-item');
      const subPanels = document.querySelectorAll('.subscription-main .sub-tab-panel');

      subNavItems.forEach(item => {
        const itemTab = (item.getAttribute('data-subtab') || '').toLowerCase();
        if (itemTab === targetSubtab) {
          item.classList.add('active');
          item.setAttribute('aria-selected', 'true');
        } else {
          item.classList.remove('active');
          item.setAttribute('aria-selected', 'false');
        }
      });

      subPanels.forEach(panel => {
        const panelId = panel.id.replace('sub-panel-', '').toLowerCase();
        if (panelId === targetSubtab || (targetSubtab === 'payment' && panelId === 'nayapay')) {
          panel.classList.add('active');
          panel.removeAttribute('hidden');
        } else {
          panel.classList.remove('active');
          panel.setAttribute('hidden', 'true');
        }
      });

      console.log(`[ValenixiaSubscription] Activated sub-tab: ${targetSubtab}`);
    },

    selectPaymentRail(railId) {
      if (!PAYMENT_RAILS[railId]) return;
      activePaymentRail = railId;

      document.querySelectorAll('.payment-rail-btn').forEach(btn => {
        if (btn.getAttribute('data-rail') === railId) {
          btn.classList.add('active');
          btn.setAttribute('aria-selected', 'true');
        } else {
          btn.classList.remove('active');
          btn.setAttribute('aria-selected', 'false');
        }
      });

      const instructionsEl = document.getElementById('payment-rail-instructions');
      const labelEl = document.getElementById('payment-rail-ref-label');
      const rail = PAYMENT_RAILS[railId];

      if (instructionsEl) instructionsEl.textContent = rail.instructions;
      if (labelEl) labelEl.textContent = rail.refLabel;
    },

    async quote(params = {}) {
      try {
        const serverBase = window.__valenixiaServerUrl || location.origin;
        const res = await fetch(serverBase + '/api/subscription/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tier: params.tier || 'PRO',
            billingPeriod: params.billingPeriod || 'MONTHLY',
            additionalTerminals: params.additionalTerminals || 0,
            additionalBranches: params.additionalBranches || 0,
            addons: params.addons || [],
            idempotencyKey: 'QUOTE_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)
          })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to generate subscription quote.');
        }

        activeQuote = data.quote;
        return data.quote;
      } catch (err) {
        console.error('[ValenixiaSubscription] Quote generation error:', err.message);
        if (typeof showNotificationToast === 'function') {
          showNotificationToast(`Quote Error: ${err.message}`, 'error', 4000);
        }
        throw err;
      }
    },

    async selectPlan(tier) {
      if (!tier) return;
      const targetTier = tier.toUpperCase();
      const catalog = window.COMMERCIAL_CATALOG || {};
      const tierConfig = (catalog.TIERS || {})[targetTier];

      if (!tierConfig) {
        if (typeof showNotificationToast === 'function') {
          showNotificationToast(`Invalid plan selected: ${tier}`, 'error', 3000);
        }
        return;
      }

      try {
        const generatedQuote = await this.quote({
          tier: targetTier,
          billingPeriod: activeCycle === 'annual' ? 'ANNUAL' : 'MONTHLY',
          additionalTerminals: 0,
          additionalBranches: 0
        });

        const selectedTierInput = document.getElementById('form-billing-selected-tier');
        const amountInput = document.getElementById('form-billing-amount');

        if (selectedTierInput) selectedTierInput.value = `${targetTier}_${activeCycle.toUpperCase()}`;
        if (amountInput) amountInput.value = generatedQuote.totalAmountPkr;

        this.activateTab('payment');

        const formContainer = document.getElementById('billing-upgrade-form-container');
        if (formContainer) formContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        if (typeof showNotificationToast === 'function') {
          showNotificationToast(`Quote ${generatedQuote.quoteId} generated: PKR ${generatedQuote.totalAmountPkr.toLocaleString()}`, 'success', 3500);
        }
      } catch (_) {}
    },

    async selectAddon(addonId) {
      if (!addonId) return;
      try {
        const serverBase = window.__valenixiaServerUrl || location.origin;
        const res = await fetch(serverBase + '/api/addons/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            addonId: addonId,
            organizationId: localStorage.getItem('valenixia_org_id') || 'default_org',
            paymentRef: 'CLAIM_ADDON_' + Date.now()
          })
        });
        const data = await res.json();
        if (res.ok) {
          if (typeof showNotificationToast === 'function') {
            showNotificationToast(`✅ Add-on claim registered for ${addonId}. Pending review.`, 'success', 4000);
          } else alert(`Add-on claim registered for ${addonId}.`);
        } else {
          throw new Error(data.error || 'Add-on claim failed.');
        }
      } catch (err) {
        if (typeof showNotificationToast === 'function') {
          showNotificationToast(`Add-on error: ${err.message}`, 'error', 4000);
        } else alert(`Add-on error: ${err.message}`);
      }
    },

    async submitPaymentClaim(claimData) {
      const rrn = claimData.rrn || document.getElementById('form-billing-rrn')?.value?.trim();
      const planId = claimData.planId || document.getElementById('form-billing-selected-tier')?.value || 'PRO_MONTHLY';
      const amount = claimData.amount || parseFloat(document.getElementById('form-billing-amount')?.value || 0);

      if (!rrn) {
        if (typeof showNotificationToast === 'function') {
          showNotificationToast('Please enter your payment reference / transaction number.', 'warning', 3000);
        } else alert('Please enter your payment reference / transaction number.');
        return;
      }

      const submitBtn = document.getElementById('btn-billing-upgrade-submit');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting Claim…'; }

      try {
        const serverBase = window.__valenixiaServerUrl || location.origin;
        const hwidVal = window.__valenixiaHWID || localStorage.getItem('valenixia_hwid') || 'DEV-HWID-LOCAL-NODE';
        const res = await fetch(serverBase + '/api/payments/submit-proof', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan_id: planId.split('_')[0],
            rrn_reference: rrn,
            amount: amount,
            mode: activeCycle,
            rail: activePaymentRail,
            quote_id: activeQuote ? activeQuote.quoteId : null,
            hwid: hwidVal
          })
        });
        const data = await res.json();

        if (res.ok) {
          if (typeof showNotificationToast === 'function') {
            showNotificationToast('✅ Upgrade claim submitted! Reference logged for review.', 'success', 4000);
          } else alert('Upgrade claim submitted successfully!');

          this.activateTab('history');
        } else {
          throw new Error(data.error || 'Claim submission failed.');
        }
      } catch (err) {
        if (typeof showNotificationToast === 'function') {
          showNotificationToast(`Claim Error: ${err.message}`, 'error', 4000);
        } else alert(`Claim Error: ${err.message}`);
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Upgrade Claim'; }
      }
    },

    refresh() {
      const curTier = (typeof window.getActiveTier === 'function' ? window.getActiveTier() : (window.__valenixiaTier || 'GROWTH')).toUpperCase();
      const isTrialActive = localStorage.getItem('valenixia_trial_active') === 'true';

      const badgeEl = document.getElementById('badge-active-tier-pill');
      if (badgeEl) {
        badgeEl.textContent = isTrialActive ? '7-DAY FREE TRIAL' : `${curTier} TIER`;
      }

      const hwidCodeEl = document.getElementById('billing-form-device-hwid');
      const hwidVal = window.__valenixiaHWID || localStorage.getItem('valenixia_hwid') || 'DEV-HWID-LOCAL-NODE';
      if (hwidCodeEl) hwidCodeEl.textContent = hwidVal;
    },

    destroy() {
      isInitialized = false;
      console.log('[ValenixiaSubscription] Controller destroyed.');
    },

    init() {
      if (isInitialized) {
        this.refresh();
        return;
      }

      console.log('[ValenixiaSubscription] Initializing canonical subscription controller (v2.6.0)');

      // Bind Sub-Tab Navigation via Event Delegation
      const subVaultNav = document.getElementById('sub-vault-nav') || document.querySelector('.subscription-sidebar');
      if (subVaultNav) {
        subVaultNav.addEventListener('click', (e) => {
          const item = e.target.closest('.sub-nav-item');
          if (!item) return;
          const targetSubtab = item.getAttribute('data-subtab');
          if (targetSubtab) {
            this.activateTab(targetSubtab);
          }
        });
      }

      // Bind Plan Selection Buttons
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-select-tier');
        if (!btn || btn.disabled) return;
        const tier = btn.getAttribute('data-tier');
        if (tier) {
          this.selectPlan(tier);
        }
      });

      // Bind Add-on Action Buttons
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-addon-action');
        if (!btn || btn.disabled) return;
        const addonId = btn.getAttribute('data-addon-id');
        if (addonId) {
          this.selectAddon(addonId);
        }
      });

      // Bind Payment Rail Selectors
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('.payment-rail-btn');
        if (!btn) return;
        const railId = btn.getAttribute('data-rail');
        if (railId) {
          this.selectPaymentRail(railId);
        }
      });

      // Bind Copy HWID Button
      const btnCopyHwid = document.getElementById('btn-copy-billing-hwid');
      if (btnCopyHwid) {
        btnCopyHwid.addEventListener('click', (e) => {
          e.preventDefault();
          const hwidVal = window.__valenixiaHWID || localStorage.getItem('valenixia_hwid') || 'DEV-HWID-LOCAL-NODE';
          navigator.clipboard.writeText(hwidVal).then(() => {
            if (typeof showNotificationToast === 'function') showNotificationToast('Device ID copied to clipboard!', 'success', 2500);
            else alert('Device ID copied!');
          }).catch(() => alert('Device ID: ' + hwidVal));
        });
      }

      // Bind Payment Claim Form
      const proofForm = document.getElementById('billing-upgrade-proof-form');
      if (proofForm) {
        proofForm.addEventListener('submit', (e) => {
          e.preventDefault();
          this.submitPaymentClaim({});
        });
      }

      isInitialized = true;
      this.refresh();
    }
  };

  window.ValenixiaSubscription = ValenixiaSubscription;
  window.initSubscriptionPage = () => ValenixiaSubscription.init();

  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    ValenixiaSubscription.init();
  } else {
    document.addEventListener('DOMContentLoaded', () => ValenixiaSubscription.init());
  }
})();
