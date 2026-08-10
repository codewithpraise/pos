/* ============================================================================
   VALENIXIA COMMERCE ECOSYSTEM — SUBSCRIPTION & BILLING ENGINE
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
  const isMobileNative = !!(window.AndroidPOS || window.Android || window.AndroidHardware || (window.location.protocol === 'file:' && navigator.userAgent.includes('Android')));
  const isDesktopNative = !!(window.electron || window.isDesktopApp || window.desktopNative || window.__VALENIXIA_DESKTOP__);
  const isWeb = !isMobileNative && !isDesktopNative;
  
  const subDownloadBtn = document.getElementById('sub-download-apps-btn');
  if (subDownloadBtn) {
    subDownloadBtn.style.display = isWeb ? 'inline-flex' : 'none';
  }

  // ── 2. Pricing Matrix & Cycle Switcher ──────────────────────────────────────
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

  if (btnMonthly) {
    btnMonthly.addEventListener('click', () => updatePrices('subscription'));
  }
  if (btnLifetime) {
    btnLifetime.addEventListener('click', () => updatePrices('lifetime'));
  }

  // ── 3. Active Tier & Button Synchronization ─────────────────────────────────
  const isTrialActive = localStorage.getItem('valenixia_trial_active') === 'true';
  const activeTier = isTrialActive ? 'GROWTH' : (typeof window.getActiveTier === 'function' ? window.getActiveTier() : (window.__valenixiaTier || 'GROWTH')).toUpperCase();
  const tierPill = document.getElementById('badge-active-tier-pill');
  const txtExpiry = document.getElementById('txt-license-expiry');
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
      const formContainer = document.getElementById('billing-upgrade-form-container');
      const selectedTierInput = document.getElementById('form-billing-selected-tier');
      const amountInput = document.getElementById('form-billing-amount');

      const currentPrices = pricingData[currentCycle] || pricingData.subscription;
      const tierData = currentPrices[targetTier] || currentPrices.STARTER;

      if (selectedTierInput) selectedTierInput.value = `${targetTier}_${currentCycle.toUpperCase()}`;
      if (amountInput) amountInput.value = tierData.amount;

      if (formContainer) {
        formContainer.style.display = 'block';
        formContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });

  const btnCancel = document.getElementById('btn-billing-upgrade-cancel');
  if (btnCancel) {
    btnCancel.addEventListener('click', () => {
      const formContainer = document.getElementById('billing-upgrade-form-container');
      if (formContainer) formContainer.style.display = 'none';
    });
  }

  // ── 4. File Upload Preview & Proof Form Submission ──────────────────────────
  const fileInput = document.getElementById('form-billing-file');
  const fileNameDisplay = document.getElementById('form-billing-file-name');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && fileNameDisplay) {
        fileNameDisplay.textContent = file.name;
      }
    });
  }

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
            mode: currentCycle
          })
        });
        const data = await res.json();

        if (res.ok) {
          if (typeof showNotificationToast === 'function') showNotificationToast('✅ Upgrade claim submitted! Payment screenshot sent for verification.', 'success', 4000);
          else alert('Upgrade claim submitted successfully!');

          const formContainer = document.getElementById('billing-upgrade-form-container');
          if (formContainer) formContainer.style.display = 'none';

          // Append to history table
          const tbody = document.getElementById('billing-history-tbody');
          if (tbody) {
            const todayStr = new Date().toLocaleDateString();
            const row = document.createElement('tr');
            row.style.borderBottom = '1px solid rgba(255,255,255,0.06)';
            row.innerHTML = `
              <td style="padding:10px;">${todayStr}</td>
              <td style="padding:10px; font-weight:700; color:var(--accent-emerald);">${planId.split('_')[0]}</td>
              <td style="padding:10px; font-family:var(--font-mono);">PKR ${amount.toLocaleString()}</td>
              <td style="padding:10px; font-family:var(--font-mono);">${rrn}</td>
              <td style="padding:10px;"><span style="padding:2px 8px; border-radius:12px; background:rgba(245,158,11,0.15); color:#f59e0b; font-size:10px; font-weight:700;">PENDING VERIFICATION</span></td>
            `;
            if (tbody.querySelector('td[colspan]')) tbody.innerHTML = '';
            tbody.prepend(row);
          }
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

  // ── 5. Free Trial Activation ────────────────────────────────────────────────
  // IMPORTANT: This must go through the real server pipeline (/api/onboard →
  // /api/license/activate) so the trial is server-registered, HWID-bound, and
  // cryptographically signed exactly like any paid tier.
  // STORAGE_KEY_LICENSE matches the constant in license-engine.js ('valenixia_license_token').
  const STORAGE_KEY_LICENSE = 'valenixia_license_token';

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
      // Collect user info — pull from the billing form fields if filled, else prompt
      const storedName  = (await ValenixiaDB.getSecurePref('store_name').catch(() => null))
                        || localStorage.getItem('valenixia_store_name') || '';
      const storedEmail = (await ValenixiaDB.getSecurePref('store_email').catch(() => null))
                        || localStorage.getItem('valenixia_store_email') || '';
      const storedPhone = (await ValenixiaDB.getSecurePref('store_phone').catch(() => null))
                        || localStorage.getItem('valenixia_store_phone') || '';

      // Require at minimum a phone number — it's the activation key
      if (!storedPhone) {
        const phone = prompt('Enter your registered phone number to start the free trial (e.g. +923001234567):');
        if (!phone || phone.trim().length < 10) {
          alert('A valid phone number is required to start the trial.');
          return;
        }
        localStorage.setItem('valenixia_store_phone', phone.trim());
      }

      const name  = storedName  || 'Trial Store';
      const email = storedEmail || `trial_${Date.now()}@valenixia.local`;
      const phone = storedPhone || localStorage.getItem('valenixia_store_phone') || '';

      btnTrial.disabled = true;
      btnTrial.textContent = 'Activating Trial…';

      try {
        const serverBase = window.__valenixiaServerUrl
                        || (window.parent !== window && window.parent.__valenixiaServerUrl)
                        || location.origin;

        // Step 1 — generate HWID so the server can bind the trial to this device
        // ValenixiaDB exposes generateHWID-equivalent via the parent frame OR we
        // derive from LicenseEngine if available, otherwise fallback to a canvas hash.
        let hwid = '';
        if (window.parent !== window && window.parent.LicenseEngine && typeof window.parent.LicenseEngine.generateHWID === 'function') {
          hwid = await window.parent.LicenseEngine.generateHWID();
        } else if (window.LicenseEngine && typeof window.LicenseEngine.generateHWID === 'function') {
          hwid = await window.LicenseEngine.generateHWID();
        } else {
          // Minimal canvas fingerprint fallback — same components LicenseEngine uses
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          ctx.textBaseline = 'top';
          ctx.font = '14px Arial';
          ctx.fillText('ValenixiaPOS-HWID-Seed', 2, 2);
          const components = [
            navigator.userAgent, navigator.language,
            String(screen.width * screen.height), String(screen.colorDepth),
            String(navigator.hardwareConcurrency || 0), String(navigator.deviceMemory || 0),
            new Intl.DateTimeFormat().resolvedOptions().timeZone,
            canvas.toDataURL().slice(-128)
          ].join('|');
          // djb2 hash — deterministic
          let h = 5381;
          for (let i = 0; i < components.length; i++) { h = ((h << 5) + h) ^ components.charCodeAt(i); h = h >>> 0; }
          hwid = h.toString(16).toUpperCase().padStart(8, '0').repeat(4).slice(0, 32);
        }

        // Step 2 — register as a TRIAL store (server checks HWID uniqueness to block repeat claims)
        const onboardRes = await fetch(serverBase + '/api/onboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, phone, tier: 'TRIAL', mode: 'subscription', hwid })
        });
        const onboardData = await onboardRes.json();

        if (!onboardRes.ok) {
          const msg = onboardData.error || 'Registration failed.';
          // 409 = HWID already trialed; surface a useful message
          const friendly = onboardRes.status === 409
            ? 'A free trial has already been claimed on this device. Please activate your license with the 6-digit code from your email.'
            : msg;
          alert(friendly);
          btnTrial.disabled = false;
          btnTrial.textContent = 'Start 7-Day Free Trial';
          return;
        }

        if (!onboardData.code) {
          throw new Error('Server did not return an activation code.');
        }

        // Step 3 — auto-activate to get the signed Ed25519 token
        const activateRes = await fetch(serverBase + '/api/license/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: onboardData.code, phone, hwid, deviceName: 'POS Terminal' })
        });
        const activateData = await activateRes.json();

        if (!activateRes.ok || !activateData.token) {
          throw new Error(activateData.error || 'Activation handshake failed.');
        }

        // Step 4 — store the cryptographically signed token in the secure DB
        // This is the ONLY place __valenixiaTier gets updated — via license-engine's
        // verifyToken() on next reload, NOT from a raw client-side assignment here.
        await ValenixiaDB.setSecurePref(STORAGE_KEY_LICENSE, activateData.token);
        await ValenixiaDB.setSecurePref('last_server_verify_time', String(Date.now())).catch(() => {});

        // Step 5 — navigate back, let license-engine.init() re-verify the token
        // and set window.__valenixiaTier from the verified payload on reload.
        if (window.self !== window.top && window.parent && typeof window.parent.switchActiveScreen === 'function') {
          window.parent.showNotificationToast?.('✅ 7-Day Free Trial activated! Reloading…', 'success', 3000);
          setTimeout(() => location.reload(), 1200);
        } else {
          alert('7-Day Free Trial activated! The app will now reload.');
          location.reload();
        }

      } catch (err) {
        console.error('[Trial] Activation error:', err);
        alert('Trial activation failed: ' + err.message + '\n\nPlease check your connection and try again.');
        btnTrial.disabled = false;
        btnTrial.textContent = 'Start 7-Day Free Trial';
      }
    });
  }
}; // end initSubscriptionPage

if (document.readyState === 'interactive' || document.readyState === 'complete') {
  initSubscriptionPage();
} else {
  document.addEventListener('DOMContentLoaded', initSubscriptionPage);
}
