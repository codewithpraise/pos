/* ============================================================================
   VALENIXIA COMMERCE ECOSYSTEM — SUBSCRIPTION & BILLING ENGINE v2.4.6
   ============================================================================ */

const initSubscriptionPage = async () => {
  // ── 1. Theme Synchronization ────────────────────────────────────────────────
  const savedTheme = localStorage.getItem('valenixia_theme') || 'theme-dark';
  document.documentElement.className = savedTheme.includes('light') ? 'light' : 'dark';
  document.body.className = savedTheme;

  // Apply light theme style overrides if light theme is active
  if (savedTheme.includes('light') || savedTheme.includes('ivory')) {
    document.body.style.backgroundColor = '#f4f6f9';
    document.body.style.color = '#0f172a';
    document.querySelectorAll('.cloud-vault-card, .pricing-card').forEach(el => {
      el.style.background = '#ffffff';
      el.style.borderColor = 'rgba(0,0,0,0.08)';
      el.style.color = '#0f172a';
    });
  }

  // ── Platform Check: Web-Only Download Button ──────────────────────────────
  const isWeb = window.APP_SURFACE === 'WEB' || (!window.AndroidPOS && !window.Android && !window.electron && !window.__VALENIXIA_DESKTOP__);
  const subDownloadBtn = document.getElementById('sub-download-apps-btn');
  if (subDownloadBtn) {
    subDownloadBtn.style.display = isWeb ? 'inline-flex' : 'none';
  }

  // ── 2. Sub-Tab Navigation Wiring ──────────────────────────────────────────
  const subNavItems = document.querySelectorAll('.subscription-sidebar .sub-nav-item');
  const subPanels = document.querySelectorAll('.subscription-main .sub-tab-panel');

  subNavItems.forEach(item => {
    item.addEventListener('click', (e) => {
      const targetSubtab = e.currentTarget.getAttribute('data-subtab');
      if (!targetSubtab) return;

      subNavItems.forEach(i => i.classList.remove('active'));
      subPanels.forEach(p => p.classList.remove('active'));

      e.currentTarget.classList.add('active');
      const targetPanel = document.getElementById(`sub-panel-${targetSubtab}`);
      if (targetPanel) {
        targetPanel.classList.add('active');
      }
    });
  });

  // ── 3. Device HWID Display & Copy Handler ──────────────────────────────────
  const hwidCodeEl = document.getElementById('billing-form-device-hwid');
  const copyHwidBtn = document.getElementById('btn-copy-billing-hwid');
  const hwidVal = window.__valenixiaHWID || localStorage.getItem('valenixia_hwid') || 'DEV-HWID-LOCAL-NODE';

  if (hwidCodeEl) hwidCodeEl.textContent = hwidVal;
  if (copyHwidBtn) {
    copyHwidBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(hwidVal).then(() => {
        if (typeof showNotificationToast === 'function') showNotificationToast('Device ID copied to clipboard!', 'success', 2500);
        else alert('Device ID copied!');
      }).catch(() => {
        alert('Device ID: ' + hwidVal);
      });
    });
  }

  // ── 4. Pricing Matrix & Cycle Switcher ──────────────────────────────────────
  let currentCycle = 'subscription'; // 'subscription' | 'lifetime'

  const pricingData = {
    subscription: {
      STARTER: { amount: 3499, text: 'PKR 3,499 / month' },
      PRO: { amount: 6999, text: 'PKR 6,999 / month' },
      ENTERPRISE: { amount: 11999, text: 'PKR 11,999 / month' }
    },
    lifetime: {
      STARTER: { amount: 79000, text: 'PKR 79,000 (Perpetual + AMC)' },
      PRO: { amount: 149000, text: 'PKR 149,000 (Perpetual + AMC)' },
      ENTERPRISE: { amount: 249000, text: 'PKR 249,000 (Perpetual + AMC)' }
    }
  };

  const btnMonthly = document.getElementById('btn-billing-cycle-monthly');
  const btnLifetime = document.getElementById('btn-billing-cycle-lifetime');
  const priceStarter = document.getElementById('price-val-STARTER');
  const pricePro = document.getElementById('price-val-PRO');
  const priceEnterprise = document.getElementById('price-val-ENTERPRISE');

  function updatePrices(cycle) {
    currentCycle = cycle;
    if (cycle === 'lifetime') {
      if (btnMonthly) {
        btnMonthly.style.background = 'transparent';
        btnMonthly.style.color = 'var(--text-gray)';
        btnMonthly.classList.remove('active');
      }
      if (btnLifetime) {
        btnLifetime.style.background = 'var(--accent-emerald)';
        btnLifetime.style.color = '#080810';
        btnLifetime.classList.add('active');
      }
      if (priceStarter) priceStarter.textContent = pricingData.lifetime.STARTER.text;
      if (pricePro) pricePro.textContent = pricingData.lifetime.PRO.text;
      if (priceEnterprise) priceEnterprise.textContent = pricingData.lifetime.ENTERPRISE.text;
    } else {
      if (btnLifetime) {
        btnLifetime.style.background = 'transparent';
        btnLifetime.style.color = 'var(--text-gray)';
        btnLifetime.classList.remove('active');
      }
      if (btnMonthly) {
        btnMonthly.style.background = 'var(--accent-emerald)';
        btnMonthly.style.color = '#080810';
        btnMonthly.classList.add('active');
      }
      if (priceStarter) priceStarter.textContent = pricingData.subscription.STARTER.text;
      if (pricePro) pricePro.textContent = pricingData.subscription.PRO.text;
      if (priceEnterprise) priceEnterprise.textContent = pricingData.subscription.ENTERPRISE.text;
    }
  }

  if (btnMonthly) btnMonthly.addEventListener('click', () => updatePrices('subscription'));
  if (btnLifetime) btnLifetime.addEventListener('click', () => updatePrices('lifetime'));

  // ── 5. Active Tier & Plan Selection Buttons ─────────────────────────────────
  const isTrialActive = localStorage.getItem('valenixia_trial_active') === 'true';
  const activeTier = isTrialActive ? 'GROWTH' : (typeof window.getActiveTier === 'function' ? window.getActiveTier() : (window.__valenixiaTier || 'GROWTH')).toUpperCase();
  const tierPill = document.getElementById('badge-active-tier-pill');
  const trialBanner = document.getElementById('free-trial-banner-card');

  if (tierPill) tierPill.textContent = isTrialActive ? '7-DAY FREE TRIAL (GROWTH)' : `${activeTier} TIER`;
  const isPaidOrGrowth = ['GROWTH', 'PRO', 'ENTERPRISE'].includes(activeTier);
  if (trialBanner && (isTrialActive || isPaidOrGrowth)) trialBanner.style.display = 'none';

  document.querySelectorAll('.btn-select-tier').forEach(btn => {
    const cardTier = btn.getAttribute('data-tier');
    const isCurrent = cardTier === activeTier || (cardTier === 'PRO' && (activeTier === 'GROWTH' || activeTier === 'PRO'));

    if (isCurrent) {
      btn.textContent = 'Current Active Plan';
      btn.disabled = true;
      btn.classList.add('active');
      btn.style.opacity = '0.75';
      btn.style.cursor = 'default';
    } else {
      btn.disabled = false;
      btn.classList.remove('active');
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      if (cardTier === 'STARTER') btn.textContent = 'Select Starter Plan';
      else if (cardTier === 'PRO' || cardTier === 'GROWTH') btn.textContent = 'Select Growth Plan';
      else if (cardTier === 'ENTERPRISE') btn.textContent = 'Select Enterprise Plan';
    }

    btn.addEventListener('click', (e) => {
      if (e.currentTarget.disabled) return;
      const targetTier = e.currentTarget.getAttribute('data-tier');
      const selectedTierInput = document.getElementById('form-billing-selected-tier');
      const amountInput = document.getElementById('form-billing-amount');

      const currentPrices = pricingData[currentCycle] || pricingData.subscription;
      const tierData = currentPrices[targetTier] || currentPrices.STARTER;

      if (selectedTierInput) selectedTierInput.value = `${targetTier}_${currentCycle.toUpperCase()}`;
      if (amountInput) amountInput.value = tierData.amount;

      // Switch to NayaPay tab & scroll to form
      const nayapaySubnav = document.querySelector('.sub-nav-item[data-subtab="nayapay"]');
      if (nayapaySubnav) nayapaySubnav.click();

      const formContainer = document.getElementById('billing-upgrade-form-container');
      if (formContainer) formContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // Fast-track WhatsApp message dispatch
      try {
        const storeIdPref = localStorage.getItem('valenixia_active_store_id') || 'Primary Store';
        const msgText = encodeURIComponent(`Hello Valenixia Team! I want to upgrade to the ${targetTier} plan (${currentCycle.toUpperCase()} - PKR ${tierData.amount}). Store Reference: ${storeIdPref}. Please send activation details.`);
        window.open(`https://wa.me/923315133226?text=${msgText}`, '_blank');
      } catch (_) {}
    });
  });

  const btnCancel = document.getElementById('btn-billing-upgrade-cancel');
  if (btnCancel) {
    btnCancel.addEventListener('click', () => {
      const overviewSubnav = document.querySelector('.sub-nav-item[data-subtab="overview"]');
      if (overviewSubnav) overviewSubnav.click();
    });
  }

  // ── 6. Add-ons Stateful Marketplace Actions ──────────────────────────────────
  document.querySelectorAll('.btn-addon-action').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const actionBtn = e.currentTarget;
      if (actionBtn.disabled) return;

      const addonId = actionBtn.getAttribute('data-addon-id');
      const catalog = window.COMMERCIAL_CATALOG || {};
      const addonMeta = (catalog.ADDONS || {})[addonId];

      actionBtn.disabled = true;
      actionBtn.textContent = 'Requesting Add-on…';

      try {
        const serverBase = window.__valenixiaServerUrl || location.origin;
        const res = await fetch(serverBase + '/api/addons/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            addonId: addonId,
            organizationId: localStorage.getItem('valenixia_org_id') || 'default_org',
            paymentRef: 'CLAIM_' + Date.now()
          })
        });

        const data = await res.json();
        if (res.ok) {
          actionBtn.textContent = 'Payment Under Review';
          actionBtn.style.background = 'rgba(245,158,11,0.15)';
          actionBtn.style.color = '#f59e0b';
          actionBtn.style.border = '1px solid rgba(245,158,11,0.3)';

          if (typeof showNotificationToast === 'function') {
            showNotificationToast(`✅ Request submitted for ${addonMeta ? addonMeta.name : addonId}. Review pending.`, 'success', 4000);
          } else {
            alert(`Request submitted for ${addonMeta ? addonMeta.name : addonId}.`);
          }
        } else {
          throw new Error(data.error || 'Add-on request failed.');
        }
      } catch (err) {
        actionBtn.disabled = false;
        actionBtn.textContent = 'Request Again';
        if (typeof showNotificationToast === 'function') {
          showNotificationToast(`Add-on error: ${err.message}`, 'error', 4000);
        } else {
          alert(`Add-on error: ${err.message}`);
        }
      }
    });
  });

  // ── 7. Proof Form Submission & Upgrade Claims ──────────────────────────────
  const proofForm = document.getElementById('billing-upgrade-proof-form');
  if (proofForm) {
    proofForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const planId = document.getElementById('form-billing-selected-tier')?.value || 'GROWTH_SUBSCRIPTION';
      const rrn = document.getElementById('form-billing-rrn')?.value?.trim();
      const amount = parseFloat(document.getElementById('form-billing-amount')?.value || 0);

      if (!rrn) {
        if (typeof showNotificationToast === 'function') showNotificationToast('Please enter your NayaPay Reference Number (RRN).', 'warning', 3000);
        else alert('Please enter your NayaPay Reference Number (RRN).');
        return;
      }

      const submitBtn = document.getElementById('btn-billing-upgrade-submit');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting Claim…'; }

      try {
        const serverBase = window.__valenixiaServerUrl || location.origin;
        const res = await fetch(serverBase + '/api/payments/submit-proof', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan_id: planId.split('_')[0],
            rrn_reference: rrn,
            amount: amount,
            mode: currentCycle,
            hwid: hwidVal
          })
        });
        const data = await res.json();

        if (res.ok) {
          if (typeof showNotificationToast === 'function') showNotificationToast('✅ Upgrade claim submitted! Payment reference logged.', 'success', 4000);
          else alert('Upgrade claim submitted successfully!');

          // Append to claims history table
          const tbody = document.getElementById('billing-history-tbody');
          if (tbody) {
            const todayStr = new Date().toLocaleDateString();
            const row = document.createElement('tr');
            row.style.borderBottom = '1px solid rgba(255,255,255,0.06)';
            row.innerHTML = `
              <td style="padding:10px;">${todayStr}</td>
              <td style="padding:10px; font-family:var(--font-mono); font-size:10px;">${hwidVal.slice(0,10)}...</td>
              <td style="padding:10px; font-weight:700; color:var(--accent-emerald);">${planId.split('_')[0]}</td>
              <td style="padding:10px; font-family:var(--font-mono);">PKR ${amount.toLocaleString()}</td>
              <td style="padding:10px; font-family:var(--font-mono);">${rrn}</td>
              <td style="padding:10px;"><span style="padding:2px 8px; border-radius:12px; background:rgba(245,158,11,0.15); color:#f59e0b; font-size:10px; font-weight:700;">UNDER REVIEW</span></td>
            `;
            if (tbody.querySelector('td[colspan]')) tbody.innerHTML = '';
            tbody.prepend(row);
          }

          // Switch to history sub-tab
          const historySubnav = document.querySelector('.sub-nav-item[data-subtab="history"]');
          if (historySubnav) historySubnav.click();

        } else {
          throw new Error(data.error || 'Submission failed.');
        }
      } catch (err) {
        if (typeof showNotificationToast === 'function') showNotificationToast(`Submission error: ${err.message}`, 'error', 4000);
        else alert(`Submission error: ${err.message}`);
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Upgrade Claim'; }
      }
    });
  }

  // ── 8. Free Trial Activation ────────────────────────────────────────────────
  const btnTrial = document.getElementById('btn-start-free-trial-subscription');
  if (btnTrial) {
    btnTrial.addEventListener('click', async () => {
      const liveTier = (window.__valenixiaTier || localStorage.getItem('valenixia_tier') || 'STARTER').toUpperCase();
      if (['GROWTH', 'PRO', 'ENTERPRISE'].includes(liveTier)) {
        if (typeof showNotificationToast === 'function') {
          showNotificationToast(`Free trial is only available for Starter tier users. You are already on active ${liveTier} tier.`, 'warning', 5000);
        } else {
          alert(`Free trial is only available for Starter tier users. You are already on active ${liveTier} tier.`);
        }
        return;
      }

      btnTrial.disabled = true;
      btnTrial.textContent = 'Activating Trial…';

      try {
        const serverBase = window.__valenixiaServerUrl || location.origin;
        const onboardRes = await fetch(serverBase + '/api/onboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Trial Store', email: `trial_${Date.now()}@valenixia.local`, phone: '03000000000', tier: 'TRIAL', mode: 'subscription', hwid: hwidVal })
        });
        const onboardData = await onboardRes.json();

        if (!onboardRes.ok) {
          throw new Error(onboardData.error || 'Trial registration failed.');
        }

        const activateRes = await fetch(serverBase + '/api/license/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: onboardData.code, phone: '03000000000', hwid: hwidVal, deviceName: 'POS Terminal' })
        });
        const activateData = await activateRes.json();

        if (!activateRes.ok || !activateData.token) {
          throw new Error(activateData.error || 'Trial activation failed.');
        }

        await ValenixiaDB.setSecurePref('valenixia_license_token', activateData.token);
        if (typeof showNotificationToast === 'function') showNotificationToast('✅ 7-Day Free Trial activated!', 'success', 3000);
        setTimeout(() => location.reload(), 1000);

      } catch (err) {
        alert('Trial activation error: ' + err.message);
        btnTrial.disabled = false;
        btnTrial.textContent = 'Start 7-Day Free Trial';
      }
    });
  }
};

if (document.readyState === 'interactive' || document.readyState === 'complete') {
  initSubscriptionPage();
} else {
  document.addEventListener('DOMContentLoaded', initSubscriptionPage);
}
