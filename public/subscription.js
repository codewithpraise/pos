/* ============================================================================
   VALENIXIA COMMERCE ECOSYSTEM — SUBSCRIPTION & BILLING ENGINE v3.0.0
   Canonical Domain Controller: window.ValenixiaSubscription
   ============================================================================ */

(function() {
  'use strict';

  let isInitialized = false;
  let activeTab = 'overview';
  let activeCycle = 'subscription'; // 'subscription' (Monthly) | 'lifetime' (Perpetual + AMC)
  let activePaymentRail = 'NAYAPAY';
  let activeQuote = null;

  const PRICING_MATRIX = {
    subscription: {
      STARTER: { pkr: 3499, label: 'PKR 3,499', period: '/ month', note: '1 Included Terminal & 1 Included Branch' },
      PRO: { pkr: 6999, label: 'PKR 6,999', period: '/ month', note: '2 Included Terminals & 1 Included Branch' },
      ENTERPRISE: { pkr: 11999, label: 'PKR 11,999', period: '/ month', note: '3 Included Terminals & 2 Included Branches' }
    },
    lifetime: {
      STARTER: { pkr: 35000, label: 'PKR 35,000', period: 'one-time + PKR 5,000/yr AMC', note: '1 Terminal License (Perpetual)' },
      PRO: { pkr: 75000, label: 'PKR 75,000', period: 'one-time + PKR 12,000/yr AMC', note: '2 Terminal License (Perpetual)' },
      ENTERPRISE: { pkr: 149000, label: 'PKR 149,000', period: 'one-time + PKR 20,000/yr AMC', note: '3 Terminals + 2 Branches (Perpetual)' }
    }
  };

  const ADDON_PRICING = {
    FBR_FISCAL: { pkr: 2999, name: 'FBR Fiscal POS' },
    MULTI_STORE: { pkr: 3999, name: 'Multi-Store HQ' },
    MULTISTORE_HQ: { pkr: 3999, name: 'Multi-Store HQ' },
    WHATSAPP_RECEIPTS: { pkr: 1499, name: 'WhatsApp Receipts' },
    CUSTOM_ROLES: { pkr: 1999, name: 'Custom Roles & RBAC' },
    CUSTOM_RBAC: { pkr: 1999, name: 'Custom Roles & RBAC' },
    DATA_PORTABILITY: { pkr: 1499, name: 'Automated Backup & Export' }
  };

  const PAYMENT_RAILS = {
    NAYAPAY: {
      id: 'NAYAPAY',
      displayName: 'NayaPay Digital Wallet',
      instructions: 'Transfer funds to NayaPay Account 0331-5133226 (Title: MUHAMMAD SOBAN ALI). Enter your transaction reference number below.',
      requiresReference: true,
      refLabel: 'NayaPay RRN Reference'
    },
    BANK_TRANSFER: {
      id: 'BANK_TRANSFER',
      displayName: 'Direct Bank Transfer (IBAN)',
      instructions: 'Transfer funds to NayaPay IBAN PK47NAYA1234503315133226. Title: MUHAMMAD SOBAN ALI.',
      requiresReference: true,
      refLabel: 'Bank Transaction Ref / FT ID'
    },
    EASYPAISA: {
      id: 'EASYPAISA',
      displayName: 'Easypaisa Mobile Account',
      instructions: 'Send money via Easypaisa to 0331-5133226 (Title: MUHAMMAD SOBAN ALI).',
      requiresReference: true,
      refLabel: 'Easypaisa TRX ID'
    },
    JAZZCASH: {
      id: 'JAZZCASH',
      displayName: 'JazzCash Mobile Account',
      instructions: 'Send money via JazzCash to 0331-5133226 (Title: MUHAMMAD SOBAN ALI).',
      requiresReference: true,
      refLabel: 'JazzCash TID Reference'
    }
  };

  // Centralized Claims & Entitlements Store Manager (Cloud-Synchronized & Offline-Resilient)
  const ValenixiaClaimsManager = {
    STORAGE_KEY: 'valenixia_admin_claims',
    SUBSCRIBERS_KEY: 'valenixia_admin_subscribers',
    OFFLINE_QUEUE_KEY: 'valenixia_offline_claims_queue',
    isSyncing: false,

    getAll() {
      try {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch (_) {}
      return [];
    },

    save(claims) {
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(claims));
        window.dispatchEvent(new CustomEvent('valenixia_claims_changed', { detail: { claims } }));
        if (typeof BroadcastChannel !== 'undefined') {
          try {
            const bc = new BroadcastChannel('valenixia_claims_bus');
            bc.postMessage({ type: 'CLAIMS_UPDATED', claims });
            bc.close();
          } catch (_) {}
        }
        if (window.syncWorker) {
          window.syncWorker.postMessage({ type: 'SAVE_ADMIN_CLAIMS', payload: claims });
        }
      } catch (e) {
        console.warn('[ValenixiaClaimsManager] Save error:', e);
      }
    },

    async fetchRemoteClaims() {
      if (this.isSyncing) return this.getAll();
      this.isSyncing = true;
      try {
        const serverBase = window.__valenixiaServerUrl || location.origin;
        if (serverBase) {
          const resp = await fetch(`${serverBase}/api/claims`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
          }).catch(() => null);

          if (resp && resp.ok) {
            const data = await resp.json().catch(() => null);
            const remoteClaims = data && Array.isArray(data.claims) ? data.claims : [];
            if (remoteClaims.length > 0) {
              const localList = this.getAll();
              const mergedMap = new Map();
              // Add local claims first
              localList.forEach(c => {
                if (c && c.id) mergedMap.set(String(c.id).trim(), c);
              });
              // Merge remote claims (cloud wins if status changed, but keep local fields)
              remoteClaims.forEach(rc => {
                if (rc && rc.id) {
                  const key = String(rc.id).trim();
                  const existing = mergedMap.get(key);
                  if (existing) {
                    mergedMap.set(key, { ...existing, ...rc });
                  } else {
                    mergedMap.set(key, rc);
                  }
                }
              });

              const mergedList = Array.from(mergedMap.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
              this.save(mergedList);
            }
          }
        }
      } catch (e) {
        console.warn('[ValenixiaClaimsManager] Remote fetch warning:', e.message);
      } finally {
        this.isSyncing = false;
        this.flushOfflineClaimsQueue();
      }
      return this.getAll();
    },

    async flushOfflineClaimsQueue() {
      try {
        const rawQueue = localStorage.getItem(this.OFFLINE_QUEUE_KEY);
        if (!rawQueue) return;
        const queue = JSON.parse(rawQueue);
        if (!Array.isArray(queue) || queue.length === 0) return;

        const serverBase = window.__valenixiaServerUrl || location.origin;
        if (!serverBase) return;

        const remaining = [];
        for (const claim of queue) {
          try {
            const resp = await fetch(`${serverBase}/api/claims`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(claim)
            }).catch(() => null);
            if (!resp || !resp.ok) {
              remaining.push(claim);
            }
          } catch (_) {
            remaining.push(claim);
          }
        }
        localStorage.setItem(this.OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
      } catch (_) {}
    },

    addClaim(claim) {
      const list = this.getAll();
      const existingIdx = list.findIndex(c => c.id === claim.id || (c.rrn && c.rrn === claim.rrn));
      if (existingIdx >= 0) {
        list[existingIdx] = { ...list[existingIdx], ...claim };
      } else {
        list.unshift(claim);
      }
      this.save(list);

      // Queue for cloud push
      try {
        const rawQueue = localStorage.getItem(this.OFFLINE_QUEUE_KEY);
        const queue = rawQueue ? JSON.parse(rawQueue) : [];
        if (Array.isArray(queue)) {
          queue.push(claim);
          localStorage.setItem(this.OFFLINE_QUEUE_KEY, JSON.stringify(queue));
        }
      } catch (_) {}

      // Trigger asynchronous push
      this.flushOfflineClaimsQueue();
      return list;
    },

    async approveClaim(claimId) {
      const list = this.getAll();
      const claim = list.find(c => String(c.id).trim() === String(claimId).trim());
      if (!claim) return false;

      claim.status = 'APPROVED';
      claim.resolvedAt = new Date().toISOString();

      let targetTier = 'STARTER';
      if (claim.targetTier) {
        targetTier = claim.targetTier.toUpperCase();
      } else if (claim.module && claim.module.toLowerCase().includes('enterprise')) {
        targetTier = 'ENTERPRISE';
      } else if (claim.module && (claim.module.toLowerCase().includes('pro') || claim.module.toLowerCase().includes('growth'))) {
        targetTier = 'PRO';
      } else {
        targetTier = 'STARTER';
      }

      this.save(list);

      // Push approval to cloud
      try {
        const serverBase = window.__valenixiaServerUrl || location.origin;
        if (serverBase) {
          fetch(`${serverBase}/api/claims/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              claimId: claim.id,
              hwid: claim.hwid,
              targetTier: targetTier,
              daysToAdd: 30
            })
          }).catch(() => {});
        }
      } catch (_) {}

      if (typeof window.applySubscriptionUpgrade === 'function') {
        window.applySubscriptionUpgrade(targetTier, 30);
      }
      if (typeof window.applyActiveTierToSystem === 'function') {
        window.applyActiveTierToSystem(targetTier);
      }
      return { claim, targetTier };
    },

    async rejectClaim(claimId) {
      const list = this.getAll();
      const claim = list.find(c => String(c.id).trim() === String(claimId).trim());
      if (!claim) return false;

      claim.status = 'REJECTED';
      claim.resolvedAt = new Date().toISOString();
      this.save(list);

      // Push rejection to cloud
      try {
        const serverBase = window.__valenixiaServerUrl || location.origin;
        if (serverBase) {
          fetch(`${serverBase}/api/claims/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ claimId: claim.id })
          }).catch(() => {});
        }
      } catch (_) {}

      return claim;
    },

    getActiveSubscribers() {
      const activeTier = (typeof window.getActiveTier === 'function' ? window.getActiveTier() : (window.__valenixiaTier || localStorage.getItem('valenixia_tier') || 'FREE')).toUpperCase();
      const currentExpMs = parseInt(localStorage.getItem('valenixia_subscription_expires_at') || '0', 10);
      const isLifetime = (localStorage.getItem('valenixia_billing_cycle') || '').toUpperCase() === 'LIFETIME';
      const hwid = window.__valenixiaHWID || localStorage.getItem('valenixia_hwid') || 'DEV-HWID-LOCAL-NODE';
      const storeName = localStorage.getItem('valenixia_store_name') || localStorage.getItem('store_name') || 'Valenixia Commercial Store';
      const ownerName = localStorage.getItem('valenixia_owner_name') || 'Valenixia Primary Merchant';
      const phone = localStorage.getItem('valenixia_store_phone') || '+92 331 5133226';

      let subscribers = [];
      try {
        const raw = localStorage.getItem(this.SUBSCRIBERS_KEY);
        if (raw) subscribers = JSON.parse(raw);
      } catch (_) {}
      if (!Array.isArray(subscribers)) subscribers = [];

      // Ensure current active store node is represented in the directory
      const primaryIndex = subscribers.findIndex(s => s.id === 'current_store' || s.hwid === hwid);
      const currentStoreEntry = {
        id: 'current_store',
        hwid,
        storeName,
        ownerName,
        phone,
        tier: activeTier,
        agreementType: isLifetime ? 'Perpetual AMC' : 'Monthly Cloud SaaS',
        isLifetime,
        expiresAt: currentExpMs,
        isLocalTerminal: true
      };

      if (primaryIndex >= 0) {
        subscribers[primaryIndex] = { ...subscribers[primaryIndex], ...currentStoreEntry };
      } else {
        subscribers.unshift(currentStoreEntry);
      }

      // Merge approved claims as active subscriber records
      const claims = this.getAll();
      claims.filter(c => c.status === 'APPROVED').forEach(c => {
        if (!subscribers.some(s => s.hwid === c.hwid || s.id === c.id)) {
          subscribers.push({
            id: c.id,
            hwid: c.hwid || 'HW-' + c.id,
            storeName: c.storeName || 'Valenixia Branch',
            ownerName: c.ownerName || 'Merchant',
            phone: c.phone || '—',
            tier: c.targetTier || 'PRO',
            agreementType: 'Monthly Cloud SaaS',
            isLifetime: false,
            expiresAt: Date.now() + (30 * 86400000),
            isLocalTerminal: false
          });
        }
      });

      return subscribers;
    },

    downgradeSubscriber(subscriberId, targetTier = 'STARTER') {
      const normTier = (targetTier || 'STARTER').toUpperCase();
      const subscribers = this.getActiveSubscribers();
      const sub = subscribers.find(s => String(s.id).trim() === String(subscriberId).trim() || String(s.hwid).trim() === String(subscriberId).trim());
      
      const newExpiry = (normTier === 'FREE') ? 0 : (Date.now() + (30 * 86400000));
      if (sub) {
        sub.tier = normTier;
        sub.expiresAt = newExpiry;
      }

      // Synchronize in claims list so getActiveTier or claims reload does not restore the higher tier
      const claims = this.getAll();
      let claimsModified = false;
      claims.forEach(c => {
        if (c && (c.id === subscriberId || (sub && c.hwid === sub.hwid) || subscriberId === 'current_store')) {
          c.targetTier = normTier;
          if (normTier === 'FREE') {
            c.status = 'REJECTED';
            c.resolvedAt = new Date().toISOString();
          }
          claimsModified = true;
        }
      });
      if (claimsModified) {
        this.save(claims);
      }

      // If downgrading current local terminal or primary store:
      const localHwid = window.__valenixiaHWID || localStorage.getItem('valenixia_hwid') || '';
      const isCurrentStore = !sub || sub.isLocalTerminal || sub.id === 'current_store' || (localHwid && sub.hwid === localHwid);
      
      if (isCurrentStore) {
        window.__valenixiaTier = normTier;
        if (typeof PLANS !== 'undefined') {
          window.__valenixiaPlan = PLANS[normTier] || PLANS.FREE;
        }
        try {
          localStorage.setItem('valenixia_tier', normTier);
          localStorage.setItem('valenixia_subscription_expires_at', String(newExpiry));
          const storeId = (window.__valenixiaState?.preferences?.store_id) || localStorage.getItem('valenixia_store_id');
          if (storeId) {
            localStorage.setItem(`valenixia_store_${storeId}_tier`, normTier);
          }
        } catch (_) {}

        if (typeof window.applyActiveTierToSystem === 'function') {
          window.applyActiveTierToSystem(normTier, {
            daysToAdd: (normTier === 'FREE' ? 0 : 30),
            expiryMs: newExpiry
          });
        }
      }

      // Push downgrade to cloud
      try {
        const serverBase = window.__valenixiaServerUrl || location.origin;
        if (serverBase) {
          fetch(`${serverBase}/api/claims/downgrade`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subscriberId,
              hwid: sub ? sub.hwid : localHwid,
              targetTier: normTier
            })
          }).catch(() => {});
        }
      } catch (_) {}

      try {
        localStorage.setItem(this.SUBSCRIBERS_KEY, JSON.stringify(subscribers));
      } catch (_) {}

      window.dispatchEvent(new CustomEvent('valenixia_claims_changed', { detail: { subscribers } }));
      window.dispatchEvent(new CustomEvent('valenixia_tier_changed', { detail: { tier: normTier, expiresAt: newExpiry } }));
      return { success: true, targetTier: normTier, subscriber: sub };
    }
  };
  window.ValenixiaClaimsManager = ValenixiaClaimsManager;

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

    setBillingCycle(cycle) {
      if (!cycle) return;
      activeCycle = cycle === 'lifetime' ? 'lifetime' : 'subscription';

      document.querySelectorAll('.billing-cycle-btn').forEach(btn => {
        const btnCycle = btn.getAttribute('data-cycle') || (btn.id.includes('lifetime') ? 'lifetime' : 'subscription');
        if (btnCycle === activeCycle) {
          btn.classList.add('active');
          btn.setAttribute('aria-selected', 'true');
        } else {
          btn.classList.remove('active');
          btn.setAttribute('aria-selected', 'false');
        }
      });

      const matrix = PRICING_MATRIX[activeCycle] || PRICING_MATRIX.subscription;
      ['STARTER', 'PRO', 'ENTERPRISE'].forEach(t => {
        const el = document.getElementById(`price-val-${t}`);
        if (el && matrix[t]) {
          el.innerHTML = `${matrix[t].label} <span style="font-size:12px; font-weight:600; color:var(--text-gray);">${matrix[t].period}</span>`;
        }
      });

      console.log(`[ValenixiaSubscription] Set billing cycle to: ${activeCycle}`);
    },

    renderClaimsHistory() {
      const tbody = document.getElementById('billing-history-tbody');
      if (!tbody) return;

      const claims = ValenixiaClaimsManager.getAll();

      if (!claims || claims.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align:center; color:var(--text-dim); padding:28px 16px;">
              <div style="font-size:24px; margin-bottom:6px;">📋</div>
              <div style="font-weight:700; color:var(--text-white); font-size:13px;">No Upgrade Claims Submitted Yet</div>
              <div style="font-size:11px; margin-top:3px; color:var(--text-gray);">Select any plan above and submit your payment proof to track claim approvals here.</div>
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = claims.map(c => {
        const statusBadge = c.status === 'APPROVED'
          ? `<span style="padding:3px 10px; border-radius:12px; font-size:10px; font-weight:800; background:rgba(0,214,143,0.15); color:var(--accent-emerald); border:1px solid rgba(0,214,143,0.35);">✓ APPROVED</span>`
          : (c.status === 'REJECTED'
            ? `<span style="padding:3px 10px; border-radius:12px; font-size:10px; font-weight:800; background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.35);">✕ REJECTED</span>`
            : `<span style="padding:3px 10px; border-radius:12px; font-size:10px; font-weight:800; background:rgba(245,158,11,0.15); color:#f59e0b; border:1px solid rgba(245,158,11,0.35); animation: pulse 2s infinite;">⏳ PENDING REVIEW</span>`);

        const tierBadge = c.targetTier === 'ENTERPRISE'
          ? 'background:rgba(168,85,247,0.15); color:#a855f7; border:1px solid rgba(168,85,247,0.35);'
          : (c.targetTier === 'PRO' || (c.module && c.module.includes('PRO'))
            ? 'background:rgba(0,214,143,0.15); color:var(--accent-emerald); border:1px solid rgba(0,214,143,0.35);'
            : 'background:rgba(245,158,11,0.15); color:#f59e0b; border:1px solid rgba(245,158,11,0.35);');

        return `
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04); transition: background 0.2s;">
            <td style="padding:12px 10px; color:var(--text-gray); font-size:11px;">${c.date || '—'}</td>
            <td style="padding:12px 10px; font-family:var(--font-mono); color:var(--text-white); font-size:11px;">${c.hwid || '—'}</td>
            <td style="padding:12px 10px;">
              <span style="padding:3px 8px; border-radius:10px; font-size:10px; font-weight:800; ${tierBadge}">${c.module || (c.targetTier + ' Plan')}</span>
            </td>
            <td style="padding:12px 10px; font-weight:800; color:var(--text-white); font-size:12px; font-family:var(--font-mono);">${c.amount || '—'}</td>
            <td style="padding:12px 10px; font-family:var(--font-mono); color:var(--text-dim); font-size:11px;">${c.rrn || '—'}</td>
            <td style="padding:12px 10px;">${statusBadge}</td>
          </tr>
        `;
      }).join('');
    },

    activateTab(tabName) {
      if (!tabName) return;
      const targetSubtab = tabName.toLowerCase();
      activeTab = targetSubtab;

      const subNavItems = document.querySelectorAll('.subscription-sidebar .sub-nav-item, #sub-vault-nav .sub-nav-item');
      const subPanels = document.querySelectorAll('.subscription-main .sub-tab-panel, #view-subscription .sub-tab-panel');

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
        if (panelId === targetSubtab || (targetSubtab === 'payment' && (panelId === 'payment' || panelId === 'nayapay'))) {
          panel.classList.add('active');
          panel.removeAttribute('hidden');
          panel.setAttribute('aria-hidden', 'false');
          panel.style.display = 'flex';
        } else {
          panel.classList.remove('active');
          panel.setAttribute('hidden', 'true');
          panel.setAttribute('aria-hidden', 'true');
          panel.style.display = 'none';
        }
      });

      if (targetSubtab === 'history') {
        this.renderClaimsHistory();
      }

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
            billingPeriod: params.billingPeriod || (activeCycle === 'lifetime' ? 'LIFETIME' : 'MONTHLY'),
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
        console.warn('[ValenixiaSubscription] Server quote fetch failed, using local calculation:', err.message);
        const matrix = PRICING_MATRIX[activeCycle] || PRICING_MATRIX.subscription;
        const tierRate = matrix[params.tier || 'PRO']?.pkr || 6999;
        activeQuote = {
          quoteId: 'QUOTE_LOCAL_' + Date.now().toString(36).toUpperCase(),
          tier: params.tier || 'PRO',
          billingPeriod: activeCycle === 'lifetime' ? 'LIFETIME' : 'MONTHLY',
          totalAmountPkr: tierRate,
          expiresAt: new Date(Date.now() + 86400000).toISOString()
        };
        return activeQuote;
      }
    },

    async selectPlan(tier) {
      if (!tier) return;
      const targetTier = tier.toUpperCase();
      const matrix = PRICING_MATRIX[activeCycle] || PRICING_MATRIX.subscription;
      const pkrVal = matrix[targetTier]?.pkr || (targetTier === 'STARTER' ? 3499 : targetTier === 'ENTERPRISE' ? 11999 : 6999);
      const formattedPkr = isNaN(pkrVal) ? '0' : pkrVal.toLocaleString();

      const selectedTierInput = document.getElementById('form-billing-selected-tier');
      const amountInput = document.getElementById('form-billing-amount');

      if (selectedTierInput) selectedTierInput.value = `${targetTier}_${activeCycle.toUpperCase()}`;
      if (amountInput) amountInput.value = pkrVal;

      if (typeof window.switchActiveScreen === 'function') {
        window.switchActiveScreen('subscription');
      } else {
        const subView = document.getElementById('view-subscription');
        if (subView) {
          document.querySelectorAll('.content-view').forEach(v => { v.style.display = 'none'; v.classList.remove('active'); });
          subView.style.display = 'block';
          subView.classList.add('active');
        }
      }

      this.activateTab('payment');

      const formContainer = document.getElementById('billing-upgrade-form-container');
      if (formContainer) formContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

      if (typeof showNotificationToast === 'function') {
        showNotificationToast(`Selected ${targetTier} plan: PKR ${formattedPkr} (${activeCycle === 'lifetime' ? 'Perpetual' : 'Monthly'}). Please transfer & submit proof below.`, 'success', 4000);
      }
    },

    async selectAddon(addonId) {
      if (!addonId) return;
      const targetAddon = addonId.toUpperCase();
      const addonMeta = ADDON_PRICING[targetAddon] || { pkr: 1999, name: targetAddon };

      const pkrVal = addonMeta.pkr;
      const selectedTierInput = document.getElementById('form-billing-selected-tier');
      const amountInput = document.getElementById('form-billing-amount');

      if (selectedTierInput) selectedTierInput.value = `ADDON_${targetAddon}`;
      if (amountInput) amountInput.value = pkrVal;

      if (typeof window.switchActiveScreen === 'function') {
        window.switchActiveScreen('subscription');
      } else {
        const subView = document.getElementById('view-subscription');
        if (subView) {
          document.querySelectorAll('.content-view').forEach(v => { v.style.display = 'none'; v.classList.remove('active'); });
          subView.style.display = 'block';
          subView.classList.add('active');
        }
      }

      this.activateTab('payment');

      const formContainer = document.getElementById('billing-upgrade-form-container');
      if (formContainer) formContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

      if (typeof showNotificationToast === 'function') {
        showNotificationToast(`Add-on selected: ${addonMeta.name} (PKR ${pkrVal.toLocaleString()}/mo). Submit proof below.`, 'success', 4000);
      }
    },

    async startFreeTrial() {
      try {
        const now = Date.now();
        const trialExpiry = now + 7 * 86400 * 1000; // 7 days in ms
        localStorage.setItem('valenixia_trial_active', 'true');
        localStorage.setItem('valenixia_tier', 'PRO');
        localStorage.setItem('valenixia_subscription_expires_at', String(trialExpiry));
        window.__valenixiaTier = 'PRO';

        if (typeof ValenixiaDB !== 'undefined' && ValenixiaDB.put) {
          await ValenixiaDB.put('local_preferences', {
            key: 'valenixia_trial_active',
            value_type: 'BOOL',
            value_payload: 'true',
            is_idempotent_flag: 0,
            updated_at: now
          }).catch(() => {});
        }

        const bannerCard = document.getElementById('free-trial-banner-card');
        if (bannerCard) {
          bannerCard.innerHTML = `
            <div style="display:flex; align-items:center; gap:16px;">
              <div style="font-size:28px;"></div>
              <div>
                <h4 style="margin:0; font-size:15px; font-weight:800; color:#10b981; font-family:var(--font-display); text-transform:uppercase;">7-Day Growth Free Trial Active</h4>
                <p style="margin:4px 0 0; font-size:12px; color:var(--text-gray);">All Growth analytics, multi-terminal sync, KOT printing, and Deals unlocked for the next 7 days.</p>
              </div>
            </div>
            <span style="padding:6px 14px; border-radius:20px; background:rgba(16,185,129,0.15); color:var(--accent-emerald); font-size:11px; font-weight:800; border:1px solid rgba(16,185,129,0.3);">ACTIVE TRIAL</span>
          `;
        }

        this.refresh();

        if (typeof showNotificationToast === 'function') {
          showNotificationToast(' 7-Day Free Growth Trial Activated! All Pro features unlocked.', 'success', 4500);
        }
      } catch (err) {
        console.error('[ValenixiaSubscription] Free trial error:', err);
      }
    },

    async addCapacity(type) {
      const activeTier = (typeof window.getActiveTier === 'function' ? window.getActiveTier() : localStorage.getItem('valenixia_tier') || 'FREE').toUpperCase();
      if (type === 'branch' && activeTier === 'STARTER') {
        if (typeof showNotificationToast === 'function') {
          showNotificationToast('Branch expansion is available on Growth (PRO) and Enterprise plans.', 'warning', 4500);
        }
        this.activateTab('plans');
        return;
      }

      const extraTerminalRate = activeTier === 'STARTER' ? 1200 : (activeTier === 'PRO' || activeTier === 'GROWTH' ? 1000 : 800);
      const extraBranchRate = (activeTier === 'PRO' || activeTier === 'GROWTH') ? 3500 : 3000;

      const pkrVal = type === 'terminal' ? extraTerminalRate : extraBranchRate;
      const selectedTierInput = document.getElementById('form-billing-selected-tier');
      const amountInput = document.getElementById('form-billing-amount');

      if (selectedTierInput) selectedTierInput.value = `EXTRA_${type.toUpperCase()}_${activeTier}`;
      if (amountInput) amountInput.value = pkrVal;

      this.activateTab('payment');

      const formContainer = document.getElementById('billing-upgrade-form-container');
      if (formContainer) formContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

      if (typeof showNotificationToast === 'function') {
        showNotificationToast(`Added extra ${type} capacity: PKR ${pkrVal.toLocaleString()}/mo. Transfer & submit proof below.`, 'success', 4000);
      }
    },

    async submitPaymentClaim(claimData = {}) {
      const rrn = claimData.rrn || document.getElementById('form-billing-rrn')?.value?.trim();
      const planId = claimData.planId || document.getElementById('form-billing-selected-tier')?.value || 'PRO_SUBSCRIPTION';
      const amount = claimData.amount || parseFloat(document.getElementById('form-billing-amount')?.value || 6999);
      const hwidVal = window.__valenixiaHWID || localStorage.getItem('valenixia_hwid') || 'DEV-HWID-LOCAL-NODE';
      const targetTier = (planId.split('_')[0] || 'PRO').toUpperCase();

      const storeNameVal = (window.state && window.state.preferences && window.state.preferences.store_name) || localStorage.getItem('valenixia_store_name') || localStorage.getItem('store_name') || 'Valenixia Commercial Store';
      const ownerNameVal = (window.state && window.state.preferences && (window.state.preferences.store_owner || window.state.preferences.merchant_name)) || localStorage.getItem('valenixia_owner_name') || localStorage.getItem('owner_name') || 'Store Merchant';
      const phoneVal = (window.state && window.state.preferences && window.state.preferences.store_phone) || localStorage.getItem('valenixia_store_phone') || '+92 331 5133226';
      const categoryVal = (window.state && window.state.preferences && window.state.preferences.store_mode) || 'General Retail';

      const submitBtn = document.getElementById('btn-billing-upgrade-submit');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting Claim…'; }

      // 1. Instantly log claim into Platform Admin Claims Queue
      const newClaim = {
        id: 'CLM-' + Math.floor(100000 + Math.random() * 900000),
        hwid: hwidVal,
        storeName: storeNameVal,
        ownerName: ownerNameVal,
        phone: phoneVal,
        category: categoryVal,
        module: `${targetTier} Plan (${activeCycle.toUpperCase()})`,
        targetTier: targetTier,
        rrn: rrn || 'WA_TX_' + Math.random().toString(36).substring(2, 8).toUpperCase(),
        amount: `PKR ${amount.toLocaleString()}`,
        amountVal: amount,
        date: new Date().toISOString().split('T')[0],
        timestamp: Date.now(),
        status: 'PENDING'
      };

      ValenixiaClaimsManager.addClaim(newClaim);

      // 2. Open WhatsApp prefilled message
      const waText = encodeURIComponent(
        `Assalam-o-Alaikum,\nI have transferred payment for Valenixia POS Upgrade.\n\nClaim ID: ${newClaim.id}\nPlan: ${targetTier} (${activeCycle.toUpperCase()})\nAmount: PKR ${amount.toLocaleString()}\nDevice ID (HWID): ${hwidVal}\nTransaction Ref / RRN: ${rrn || 'Attached in Screenshot'}\n\nPlease verify and activate my account. Thank you!`
      );
      const waUrl = `https://wa.me/923315133226?text=${waText}`;
      window.open(waUrl, '_blank', 'noopener,noreferrer');

      // 3. Post to backend server if online
      try {
        const serverBase = window.__valenixiaServerUrl || location.origin;
        if (location.protocol !== 'file:') {
          await fetch(serverBase + '/api/payments/submit-proof', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              claim_id: newClaim.id,
              plan_id: targetTier,
              rrn_reference: newClaim.rrn,
              amount: amount,
              mode: activeCycle,
              rail: activePaymentRail,
              quote_id: activeQuote ? activeQuote.quoteId : null,
              hwid: hwidVal
            })
          }).catch(() => {});
        }
      } catch (_) {}

      // 4. Notify user that claim is pending admin approval (NO AUTOMATIC TIER UNLOCK)
      if (typeof showNotificationToast === 'function') {
        showNotificationToast(`🎉 Payment claim ${newClaim.id} submitted! WhatsApp opened. Your claim is pending approval by the Platform Admin.`, 'success', 6000);
      }

      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Claim via WhatsApp '; }
      this.activateTab('history');
      this.renderClaimsHistory();
    },

    async refresh() {
      const rawTier = (typeof window.getActiveTier === 'function' ? window.getActiveTier() : (window.__valenixiaTier || localStorage.getItem('valenixia_tier') || 'FREE')).toUpperCase();
      const curTier = (rawTier === 'GROWTH' ? 'PRO' : rawTier);
      const isTrialActive = localStorage.getItem('valenixia_trial_active') === 'true';

      const badgeEl = document.getElementById('badge-active-tier-pill');
      if (badgeEl) {
        badgeEl.textContent = isTrialActive ? '7-DAY FREE TRIAL (GROWTH)' : `${curTier} TIER`;
        if (curTier === 'ENTERPRISE') {
          badgeEl.style.background = 'rgba(168,85,247,0.15)';
          badgeEl.style.color = '#a855f7';
          badgeEl.style.border = '1px solid rgba(168,85,247,0.35)';
        } else if (curTier === 'PRO' || curTier === 'GROWTH') {
          badgeEl.style.background = 'rgba(0,214,143,0.15)';
          badgeEl.style.color = 'var(--accent-emerald)';
          badgeEl.style.border = '1px solid rgba(0,214,143,0.35)';
        } else if (curTier === 'STARTER') {
          badgeEl.style.background = 'rgba(59,130,246,0.15)';
          badgeEl.style.color = '#3b82f6';
          badgeEl.style.border = '1px solid rgba(59,130,246,0.35)';
        } else {
          badgeEl.style.background = 'rgba(245,158,11,0.15)';
          badgeEl.style.color = '#f59e0b';
          badgeEl.style.border = '1px solid rgba(245,158,11,0.35)';
        }
      }

      const expiryTxtEl = document.getElementById('txt-license-expiry');
      if (expiryTxtEl) {
        expiryTxtEl.textContent = isTrialActive ? '7 Days Active Trial' : `Active ${curTier} (30 Days)`;
        expiryTxtEl.style.color = 'var(--accent-emerald)';
      }

      const trialBanner = document.getElementById('free-trial-banner-card');
      if (trialBanner) {
        trialBanner.style.display = (curTier === 'PRO' || curTier === 'GROWTH' || curTier === 'ENTERPRISE' || isTrialActive) ? 'none' : 'flex';
      }

      const hwidCodeEl = document.getElementById('billing-form-device-hwid');
      const hwidVal = window.__valenixiaHWID || localStorage.getItem('valenixia_hwid') || 'DEV-HWID-LOCAL-NODE';
      if (hwidCodeEl) hwidCodeEl.textContent = hwidVal;

      // Dynamic Capacity Calculator Sync
      const rates = {
        STARTER: { monthlyPricePKR: 3499, includedTerminals: 1, includedBranches: 1, extraTerminalPricePKR: 1200, extraBranchPricePKR: 0, allowExtraBranches: false },
        PRO: { monthlyPricePKR: 6999, includedTerminals: 2, includedBranches: 1, extraTerminalPricePKR: 1000, extraBranchPricePKR: 3500, allowExtraBranches: true },
        ENTERPRISE: { monthlyPricePKR: 11999, includedTerminals: 3, includedBranches: 2, extraTerminalPricePKR: 800, extraBranchPricePKR: 3000, allowExtraBranches: true }
      };

      const plan = rates[curTier] || rates.STARTER;
      const extraTerminals = Number(localStorage.getItem('valenixia_extra_terminals') || 0);
      const extraBranches = Number(localStorage.getItem('valenixia_extra_branches') || 0);

      const termSummaryEl = document.getElementById('cap-terminals-summary');
      const btnAddTermEl = document.getElementById('btn-add-terminal-capacity');
      const branchSummaryEl = document.getElementById('cap-branches-summary');
      const btnAddBranchEl = document.getElementById('btn-add-branch-capacity');
      const totalEstEl = document.getElementById('cap-total-monthly-estimate');

      if (termSummaryEl) {
        termSummaryEl.textContent = `${plan.includedTerminals} Included + ${extraTerminals} Extra = ${plan.includedTerminals + extraTerminals} Capacity`;
      }
      if (btnAddTermEl) {
        btnAddTermEl.textContent = `+ Add Terminal (PKR ${plan.extraTerminalPricePKR.toLocaleString()}/mo)`;
      }
      if (branchSummaryEl) {
        const totalB = plan.includedBranches + extraBranches;
        branchSummaryEl.textContent = `${plan.includedBranches} Included + ${extraBranches} Extra = ${totalB} ${totalB === 1 ? 'Branch' : 'Branches'}`;
      }
      if (btnAddBranchEl) {
        if (plan.allowExtraBranches) {
          btnAddBranchEl.textContent = `+ Add Branch (PKR ${(plan.extraBranchPricePKR || 3500).toLocaleString()}/mo)`;
          btnAddBranchEl.classList.remove('dm-btn-secondary');
          btnAddBranchEl.classList.add('dm-btn-emerald');
        } else {
          btnAddBranchEl.textContent = `+ Add Branch (Requires Pro)`;
          btnAddBranchEl.classList.remove('dm-btn-emerald');
          btnAddBranchEl.classList.add('dm-btn-secondary');
        }
      }

      const monthlyBase = plan.monthlyPricePKR;
      const monthlyExtraTerminals = extraTerminals * plan.extraTerminalPricePKR;
      const monthlyExtraBranches = extraBranches * (plan.extraBranchPricePKR || 0);
      const totalMonthlyCost = monthlyBase + monthlyExtraTerminals + monthlyExtraBranches;

      if (totalEstEl) {
        totalEstEl.textContent = `PKR ${totalMonthlyCost.toLocaleString()} / month`;
      }

      // Update Plan Selection Cards
      document.querySelectorAll('.btn-select-tier').forEach(btn => {
        const cardTier = (btn.getAttribute('data-tier') || '').toUpperCase();
        const normCardTier = cardTier === 'GROWTH' ? 'PRO' : cardTier;
        if (normCardTier === curTier && !isTrialActive) {
          btn.textContent = 'CURRENT PLAN (ACTIVE)';
          btn.disabled = true;
          btn.style.opacity = '0.75';
        } else {
          btn.textContent = `Select ${cardTier === 'PRO' ? 'Growth' : cardTier.charAt(0) + cardTier.slice(1).toLowerCase()} Plan`;
          btn.disabled = false;
          btn.style.opacity = '1';
        }
      });

      this.renderClaimsHistory();
    },

    init() {
      if (isInitialized) {
        this.refresh();
        this.renderClaimsHistory();
        return;
      }

      console.log('[ValenixiaSubscription] Initializing canonical subscription controller v3.0.0');

      // Global Delegated Click Handler for all Subscription Vault interactions
      document.addEventListener('click', (e) => {
        // 1. Sub-Tab Item
        const navItem = e.target.closest('.sub-nav-item');
        if (navItem) {
          const targetSubtab = navItem.getAttribute('data-subtab');
          if (targetSubtab) {
            e.preventDefault();
            this.activateTab(targetSubtab);
            return;
          }
        }

        // 2. Billing Cycle Toggle
        const cycleBtn = e.target.closest('.billing-cycle-btn');
        if (cycleBtn) {
          const cycle = cycleBtn.getAttribute('data-cycle') || (cycleBtn.id.includes('lifetime') ? 'lifetime' : 'subscription');
          e.preventDefault();
          this.setBillingCycle(cycle);
          return;
        }

        // 3. Plan Selection
        const planBtn = e.target.closest('.btn-select-tier');
        if (planBtn && !planBtn.disabled) {
          const tier = planBtn.getAttribute('data-tier');
          if (tier) {
            e.preventDefault();
            this.selectPlan(tier);
            return;
          }
        }

        // 4. Add-on Action
        const addonBtn = e.target.closest('.btn-addon-action');
        if (addonBtn && !addonBtn.disabled) {
          const addonId = addonBtn.getAttribute('data-addon-id');
          if (addonId) {
            e.preventDefault();
            this.selectAddon(addonId);
            return;
          }
        }

        // 5. Payment Rail
        const railBtn = e.target.closest('.payment-rail-btn');
        if (railBtn) {
          const railId = railBtn.getAttribute('data-rail');
          if (railId) {
            e.preventDefault();
            this.selectPaymentRail(railId);
            return;
          }
        }

        // 6. Free Trial Button
        const trialBtn = e.target.closest('#btn-start-free-trial-subscription');
        if (trialBtn) {
          e.preventDefault();
          this.startFreeTrial();
          return;
        }

        // 7. Add Capacity Buttons
        const addTermBtn = e.target.closest('#btn-add-terminal-capacity');
        if (addTermBtn) {
          e.preventDefault();
          this.addCapacity('terminal');
          return;
        }
        const addBranchBtn = e.target.closest('#btn-add-branch-capacity');
        if (addBranchBtn) {
          e.preventDefault();
          this.addCapacity('branch');
          return;
        }

        // 8. Copy HWID
        const copyHwidBtn = e.target.closest('#btn-copy-billing-hwid');
        if (copyHwidBtn) {
          e.preventDefault();
          const hwidVal = window.__valenixiaHWID || localStorage.getItem('valenixia_hwid') || 'DEV-HWID-LOCAL-NODE';
          navigator.clipboard.writeText(hwidVal).then(() => {
            if (typeof showNotificationToast === 'function') showNotificationToast('Device ID copied to clipboard!', 'success', 2500);
            else alert('Device ID copied!');
          }).catch(() => alert('Device ID: ' + hwidVal));
          return;
        }

        // 9. Cancel Upgrade Form
        const cancelBtn = e.target.closest('#btn-billing-upgrade-cancel');
        if (cancelBtn) {
          e.preventDefault();
          this.activateTab('plans');
          return;
        }
      });

      // Bind Payment Claim Form Submit
      const proofForm = document.getElementById('billing-upgrade-proof-form');
      if (proofForm) {
        proofForm.addEventListener('submit', (e) => {
          e.preventDefault();
          this.submitPaymentClaim({});
        });
      }

      // Auto sync claims history when claims change anywhere
      window.addEventListener('valenixia_claims_changed', () => {
        this.renderClaimsHistory();
      });

      window.addEventListener('storage', (e) => {
        if (e.key === 'valenixia_admin_claims' || e.key === 'valenixia_tier') {
          this.renderClaimsHistory();
          this.refresh();
        }
      });

      isInitialized = true;
      this.refresh();
      this.renderClaimsHistory();
    }
  };

  window.ValenixiaSubscription = ValenixiaSubscription;
  window.initSubscriptionPage = () => ValenixiaSubscription.init();

  // Auto-sync offline claims when network reconnects or on boot
  window.addEventListener('online', () => {
    try {
      ValenixiaClaimsManager.flushOfflineClaimsQueue();
      ValenixiaClaimsManager.fetchRemoteClaims();
    } catch (_) {}
  });

  setTimeout(() => {
    try {
      ValenixiaClaimsManager.fetchRemoteClaims();
    } catch (_) {}
  }, 1000);

  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    ValenixiaSubscription.init();
  } else {
    document.addEventListener('DOMContentLoaded', () => ValenixiaSubscription.init());
  }
})();
