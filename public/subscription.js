/* ============================================================================
   VALENIXIA COMMERCE ECOSYSTEM — SUBSCRIPTION & BILLING ENGINE
   ============================================================================ */

document.addEventListener('DOMContentLoaded', async () => {
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

  // ── 3. Plan Selection & Form Population ─────────────────────────────────────
  document.querySelectorAll('.btn-select-tier').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tier = e.currentTarget.getAttribute('data-tier');
      const formContainer = document.getElementById('billing-upgrade-form-container');
      const selectedTierInput = document.getElementById('form-billing-selected-tier');
      const amountInput = document.getElementById('form-billing-amount');

      const currentPrices = pricingData[currentCycle] || pricingData.subscription;
      const tierData = currentPrices[tier] || currentPrices.STARTER;

      if (selectedTierInput) selectedTierInput.value = `${tier}_${currentCycle.toUpperCase()}`;
      if (amountInput) amountInput.value = tierData.amount;

      if (formContainer) {
        formContainer.style.display = 'block';
        formContainer.scrollIntoView({ behavior: 'smooth' });
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

  // ── 4. File Upload Preview ──────────────────────────────────────────────────
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

  // ── 5. Free Trial Activation ────────────────────────────────────────────────
  const btnTrial = document.getElementById('btn-start-free-trial-subscription');
  if (btnTrial) {
    btnTrial.addEventListener('click', async () => {
      window.__valenixiaTier = 'TRIAL';
      localStorage.setItem('valenixia_override_tier', 'TRIAL');
      if (window.showNotificationToast) {
        showNotificationToast('7-Day Free Pro Trial activated! Redirecting to POS...', 'success', 3000);
      }
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 800);
    });
  }
});
