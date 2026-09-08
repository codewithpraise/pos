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
      STARTER: { pkr: 79000, label: 'PKR 79,000', period: 'one-time + PKR 15,000/yr AMC', note: '1 Terminal License (Perpetual)' },
      PRO: { pkr: 149000, label: 'PKR 149,000', period: 'one-time + PKR 28,000/yr AMC', note: '2 Terminal License (Perpetual)' },
      ENTERPRISE: { pkr: 249000, label: 'PKR 249,000', period: 'one-time + PKR 45,000/yr AMC', note: '3 Terminals + 2 Branches (Perpetual)' }
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

    getServerBase() {
      let base = window.__valenixiaServerUrl;
      if (!base || base.startsWith('file:') || base === 'null' || base === 'undefined') {
        if (typeof location !== 'undefined' && location.origin && location.origin !== 'null' && !location.origin.startsWith('file:')) {
          base = location.origin;
        } else {
          base = 'https://valenixia-pos.vercel.app';
        }
      }
      return String(base).replace(/\/+$/, '');
    },

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
        const serverBase = this.getServerBase();
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

        const serverBase = this.getServerBase();
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
        const serverBase = this.getServerBase();
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
        const serverBase = this.getServerBase();
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
        const serverBase = this.getServerBase();
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
    },

    /**
     * Restore store subscription using Claim ID, Transaction RRN, Phone number, or Store Name
     * Supports single-store and multi-store disambiguation.
     */
    async restoreSubscriptionByLookup(lookupQuery) {
      if (!lookupQuery || typeof lookupQuery !== 'string' || lookupQuery.trim().length === 0) {
        return { success: false, error: 'Please enter a valid Claim ID, Transaction RRN, Phone number, or Store Name.' };
      }
      const q = lookupQuery.trim().toUpperCase();
      const rawQ = lookupQuery.trim();
      const cleanPhone = rawQ.replace(/[\s\-\+\(\)]/g, '').replace(/^92/, '0');

      // 1. Refresh remote cloud claims
      try {
        await this.fetchRemoteClaims();
      } catch (_) {}

      const allClaims = this.getAll();

      // 2. Search local and cloud claims cache for all matches
      const isClaimMatch = (c) => {
        if (!c) return false;
        const idMatch = c.id && String(c.id).toUpperCase().includes(q);
        const rrnMatch = c.rrn && String(c.rrn).toUpperCase().includes(q);
        const cPhone = c.phone ? String(c.phone).replace(/[\s\-\+\(\)]/g, '').replace(/^92/, '0') : '';
        const phoneMatch = cPhone && (cPhone.includes(cleanPhone) || (cleanPhone.length >= 7 && cleanPhone.includes(cPhone)));
        const hwidMatch = c.hwid && String(c.hwid).toUpperCase() === q;
        const storeMatch = c.storeName && String(c.storeName).toLowerCase().includes(rawQ.toLowerCase());
        return idMatch || rrnMatch || phoneMatch || hwidMatch || storeMatch;
      };

      let approvedMatches = allClaims.filter(c => isClaimMatch(c) && c.status === 'APPROVED');
      let otherMatches = allClaims.filter(c => isClaimMatch(c) && c.status !== 'APPROVED');

      // 3. Query authoritative /api/subscription/restore cloud endpoint
      if (approvedMatches.length === 0 && otherMatches.length === 0) {
        try {
          const serverBase = this.getServerBase();
          if (serverBase) {
            const resp = await fetch(`${serverBase}/api/subscription/restore?query=${encodeURIComponent(rawQ)}`, {
              headers: { 'Accept': 'application/json' }
            }).catch(() => null);
            if (resp && resp.ok) {
              const data = await resp.json().catch(() => null);
              if (data && data.success && Array.isArray(data.stores) && data.stores.length > 0) {
                data.stores.forEach(s => {
                  approvedMatches.push({
                    id: s.id,
                    hwid: s.hwid,
                    targetTier: s.tier,
                    storeName: s.storeName,
                    ownerName: s.ownerName,
                    phone: s.phone,
                    status: s.status || 'APPROVED',
                    expiresAt: s.expiresAt,
                    daysRemaining: s.daysRemaining,
                    platform: s.platform
                  });
                });
              }
            }
          }
        } catch (_) {}
      }

      // 4. Direct Supabase Cloud REST fallback if local server was unreachable or on Android
      if (approvedMatches.length === 0 && otherMatches.length === 0) {
        try {
          const supaUrl = 'https://wzvwyfyefbdrqscxhwsf.supabase.co';
          const supaKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6dnd5ZnllZmJkcnFzY3hod3NmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MzU3ODUsImV4cCI6MjA5ODQxMTc4NX0.W9O6U4tqETM6BcEjX7evt3LunpIZOC5c7wcZht2ajuk';
          const headers = { 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}` };

          // Query `stores` table
          const sResp = await fetch(`${supaUrl}/rest/v1/stores?or=(id.ilike.%25${encodeURIComponent(q)}%25,name.ilike.%25${encodeURIComponent(rawQ)}%25,region.ilike.%25${encodeURIComponent(cleanPhone)}%25)`, { headers }).catch(() => null);
          if (sResp && sResp.ok) {
            const sRows = await sResp.json().catch(() => []);
            if (Array.isArray(sRows)) {
              sRows.forEach(row => {
                const sTier = String(row.plan || row.tier || 'PRO').toUpperCase();
                const expMs = row.expires_at ? Date.parse(row.expires_at) : (Date.now() + 30 * 86400000);
                approvedMatches.push({
                  id: 'STORE_' + row.id.slice(0, 8),
                  hwid: row.id,
                  targetTier: sTier,
                  storeName: row.name || `Store (${row.id.slice(0, 8)})`,
                  ownerName: 'Store Merchant',
                  phone: row.region || cleanPhone,
                  status: row.is_active !== false ? 'APPROVED' : 'INACTIVE',
                  expiresAt: expMs
                });
              });
            }
          }

          // Query `payment_proofs` table
          const pResp = await fetch(`${supaUrl}/rest/v1/payment_proofs?or=(invoice_id.ilike.%25${encodeURIComponent(q)}%25,proof_url.ilike.%25${encodeURIComponent(cleanPhone)}%25,proof_url.ilike.%25${encodeURIComponent(rawQ)}%25)`, { headers }).catch(() => null);
          if (pResp && pResp.ok) {
            const pRows = await pResp.json().catch(() => []);
            if (Array.isArray(pRows)) {
              pRows.forEach(p => {
                let meta = {};
                if (p.proof_url && p.proof_url.startsWith('{')) {
                  try { meta = JSON.parse(p.proof_url); } catch (_) {}
                }
                const pTier = String(p.plan_id || meta.targetTier || 'PRO').toUpperCase();
                const pClaimId = meta.claimId || p.invoice_id || ('CLM-' + String(p.id).replace(/-/g, '').slice(0, 6).toUpperCase());
                approvedMatches.push({
                  id: pClaimId,
                  hwid: meta.hwid || p.store_id,
                  targetTier: pTier,
                  storeName: meta.storeName || `Store (${String(meta.hwid || p.store_id || '').slice(0, 8)})`,
                  ownerName: meta.ownerName || 'Store Merchant',
                  phone: meta.phone || cleanPhone,
                  status: String(p.status || 'APPROVED').toUpperCase(),
                  expiresAt: meta.expiresAt || (Date.now() + 30 * 86400000)
                });
              });
            }
          }
        } catch (_) {}
      }

      const candidateList = approvedMatches.length > 0 ? approvedMatches : otherMatches;

      if (candidateList.length === 0) {
        return {
          success: false,
          error: `No subscription claim found for '${lookupQuery}'. Please check the Transaction RRN, Claim ID, or Phone number.`
        };
      }

      // If multiple stores are found under this phone / query, return them for user disambiguation
      if (candidateList.length > 1) {
        return {
          success: true,
          multiple: true,
          stores: candidateList.map(c => {
            const expMs = c.expiresAt || (Date.now() + 30 * 86400000);
            const remDays = Math.max(0, Math.ceil((expMs - Date.now()) / 86400000));
            const isNative = (c.hwid && c.hwid.includes('AND-')) || (c.platform === 'NATIVE') || (c.storeName && c.storeName.includes('Mobile'));
            return {
              id: c.id,
              claim: c,
              storeName: c.storeName || 'Valenixia Store',
              ownerName: c.ownerName || c.name || 'Store Owner',
              phone: c.phone || '',
              tier: (c.targetTier || c.tier || 'STARTER').toUpperCase(),
              daysRemaining: remDays,
              platform: isNative ? 'Android Native App' : 'Web Application',
              hwid: c.hwid || '',
              status: c.status || 'APPROVED',
              expiresAt: expMs
            };
          })
        };
      }

      // Single match -> apply immediately
      return this.applyStoreRestoration(candidateList[0]);
    },

    /**
     * Apply specific restored store claim to runtime environment
     */
    applyStoreRestoration(claimObj) {
      if (!claimObj) return { success: false, error: 'Invalid store claim object' };

      const targetTier = (claimObj.targetTier || claimObj.tier || 'STARTER').toUpperCase();
      const expiresAtMs = claimObj.expiresAt || (Date.now() + 30 * 86400000);
      const remainingDays = Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 86400000));
      const storeName = claimObj.storeName || 'Restored Store';

      // 1. Update localStorage & Runtime globals
      window.__valenixiaTier = targetTier;
      localStorage.setItem('valenixia_tier', targetTier);
      localStorage.setItem('valenixia_subscription_expires_at', String(expiresAtMs));
      localStorage.setItem('valenixia_store_name', storeName);
      if (claimObj.ownerName) localStorage.setItem('valenixia_owner_name', claimObj.ownerName);
      if (claimObj.phone) localStorage.setItem('valenixia_owner_phone', claimObj.phone);
      if (claimObj.hwid) localStorage.setItem('valenixia_restored_hwid', claimObj.hwid);

      // 2. Mark onboarding complete & initialize authenticated owner cashier session
      localStorage.setItem('onboarding_complete', 'true');
      const ownerCashier = {
        id: 'emp_admin',
        name: (claimObj.ownerName || 'Store Owner').replace('emp_', ''),
        role: 'ADMIN'
      };

      if (window.state) {
        window.state.storeName = storeName;
        window.state.tier = targetTier;
        window.state.activeCashier = ownerCashier;
        window.state.currentPin = '';
        window.state.activeScreen = 'checkout';
        if (window.state.storeProfile) {
          window.state.storeProfile.name = storeName;
          if (claimObj.ownerName) window.state.storeProfile.ownerName = claimObj.ownerName;
          if (claimObj.phone) window.state.storeProfile.phone = claimObj.phone;
        }
      }

      try {
        sessionStorage.setItem('valenixia_session_authenticated', '1');
        sessionStorage.setItem('valenixia_auth_session', 'true');
        sessionStorage.setItem('valenixia_active_cashier', JSON.stringify(ownerCashier));
        document.documentElement.classList.add('session-authenticated');
      } catch (_) {}

      // 3. Apply subscription tier upgrade to system
      if (typeof window.applySubscriptionUpgrade === 'function') {
        window.applySubscriptionUpgrade(targetTier, remainingDays);
      }
      if (typeof window.applyActiveTierToSystem === 'function') {
        window.applyActiveTierToSystem(targetTier);
      }

      // 4. Update claim status in local store
      claimObj.status = 'APPROVED';
      this.addClaim(claimObj);

      // 5. Dismiss restore modal, setup wizard, auth lock, and pairing overlays immediately
      const restoreModal = document.getElementById('valenixia-restore-subscription-modal');
      if (restoreModal && restoreModal.parentNode) {
        try { restoreModal.parentNode.removeChild(restoreModal); } catch (_) {}
      }

      const wiz = document.getElementById('first-boot-wizard');
      if (wiz) {
        wiz.style.setProperty('display', 'none', 'important');
        wiz.style.setProperty('visibility', 'hidden', 'important');
        wiz.style.setProperty('opacity', '0', 'important');
        wiz.classList.remove('active');
      }
      try { document.body.classList.remove('wizard-active'); } catch (_) {}

      const lockScreen = document.getElementById('auth-lock-screen');
      if (lockScreen) {
        lockScreen.style.setProperty('display', 'none', 'important');
        lockScreen.style.setProperty('visibility', 'hidden', 'important');
        lockScreen.style.setProperty('opacity', '0', 'important');
        lockScreen.classList.remove('active');
      }

      const pairingOverlay = document.getElementById('device-pairing-overlay');
      if (pairingOverlay) {
        pairingOverlay.style.setProperty('display', 'none', 'important');
        pairingOverlay.classList.remove('active');
      }

      const licenseOverlay = document.getElementById('license-lockout-overlay');
      if (licenseOverlay) {
        licenseOverlay.style.setProperty('display', 'none', 'important');
        licenseOverlay.classList.remove('active');
      }

      // 6. Set runtime flags and transition ValenixiaBootstrap to READY
      window.__valenixiaAuthenticated = true;
      window.appReady = true;
      window.appInitialized = true;
      window.bootstrapDecisionReady = true;
      window.bootstrapReady = true;

      if (window.ValenixiaBootstrap && typeof window.ValenixiaBootstrap.transition === 'function') {
        window.ValenixiaBootstrap.transition('READY');
      }

      // 7. Explicitly display main POS grid layout and route directly to checkout screen
      const appLayout = document.getElementById('pos-app-layout');
      if (appLayout) {
        appLayout.style.setProperty('display', 'grid', 'important');
        appLayout.style.setProperty('visibility', 'visible', 'important');
        appLayout.style.setProperty('opacity', '1', 'important');
        appLayout.classList.add('active');
      }

      const nameEl = document.getElementById('cashier-display-name');
      const roleDispEl = document.getElementById('cashier-display-role');
      if (nameEl) nameEl.textContent = (ownerCashier.name || 'OWNER').toUpperCase();
      if (roleDispEl) roleDispEl.textContent = 'ADMIN';

      const storeNameDisplay = document.getElementById('store-name-display');
      if (storeNameDisplay) storeNameDisplay.textContent = storeName;

      if (typeof window.applyRoleNavigationLimits === 'function') {
        try { window.applyRoleNavigationLimits('ADMIN'); } catch (_) {}
      }

      if (typeof window.switchActiveScreen === 'function') {
        window.switchActiveScreen('checkout');
      }
      if (typeof window.renderCheckoutScreen === 'function') {
        window.renderCheckoutScreen();
      }

      // 8. Audio celebration & toast
      if (typeof window.playAudioSignal === 'function') window.playAudioSignal('success');
      if (typeof window.triggerConfetti === 'function') window.triggerConfetti();
      if (typeof window.showNotificationToast === 'function') {
        window.showNotificationToast(`Restored ${storeName} (${targetTier} Plan · ${remainingDays} days remaining)`, 'success', 4500);
      }

      return {
        success: true,
        tier: targetTier,
        storeName: storeName,
        daysRemaining: remainingDays,
        claim: claimObj
      };
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
              <div style="font-weight:700; color:var(--text-white); font-size:13px; margin-bottom:4px;">No Upgrade Claims Submitted Yet</div>
              <div style="font-size:11px; color:var(--text-gray);">Select any plan above and submit your payment proof to track claim approvals here.</div>
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = claims.map(c => {
        const statusBadge = c.status === 'APPROVED'
          ? `<span style="padding:3px 10px; border-radius:12px; font-size:10px; font-weight:800; background:rgba(0,214,143,0.15); color:var(--accent-emerald); border:1px solid rgba(0,214,143,0.35);">APPROVED</span>`
          : (c.status === 'REJECTED'
            ? `<span style="padding:3px 10px; border-radius:12px; font-size:10px; font-weight:800; background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.35);">REJECTED</span>`
            : `<span style="padding:3px 10px; border-radius:12px; font-size:10px; font-weight:800; background:rgba(245,158,11,0.15); color:#f59e0b; border:1px solid rgba(245,158,11,0.35); animation: pulse 2s infinite;">PENDING REVIEW</span>`);

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
          showNotificationToast('7-Day Free Growth Trial Activated! All Pro features unlocked.', 'success', 4500);
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

      // 3. Post to backend server (always on native and web)
      try {
        const serverBase = ValenixiaClaimsManager.getServerBase();
        if (serverBase) {
          fetch(`${serverBase}/api/claims`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newClaim)
          }).catch(() => {});
        }
      } catch (_) {}

      // 4. Notify user that claim is pending admin approval (NO AUTOMATIC TIER UNLOCK)
      if (typeof showNotificationToast === 'function') {
        showNotificationToast(`Payment claim ${newClaim.id} submitted! WhatsApp opened. Your claim is pending approval by the Platform Admin.`, 'success', 6000);
      }

      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Claim via WhatsApp'; }
      this.activateTab('history');
      this.renderClaimsHistory();
    },

    async refresh() {
      const rawTier = (typeof window.getActiveTier === 'function' ? window.getActiveTier() : (window.__valenixiaTier || localStorage.getItem('valenixia_tier') || 'FREE')).toUpperCase();
      const curTier = (rawTier === 'GROWTH' ? 'PRO' : rawTier);
      const isTrialActive = localStorage.getItem('valenixia_trial_active') === 'true';

      const allClaims = ValenixiaClaimsManager.getAll();
      const hasApprovedPaidClaim = allClaims.some(c => c && c.status === 'APPROVED' && (c.targetTier === curTier || (curTier === 'PRO' && c.targetTier === 'GROWTH')));

      const expMs = parseInt(localStorage.getItem('valenixia_subscription_expires_at') || '0', 10);
      const remainingMs = expMs > 0 ? Math.max(0, expMs - Date.now()) : 0;
      const remDays = Math.floor(remainingMs / 86400000);
      const remHours = Math.floor((remainingMs % 86400000) / 3600000);

      const isPaidActive = (hasApprovedPaidClaim || curTier === 'ENTERPRISE' || curTier === 'PRO' || curTier === 'STARTER') && curTier !== 'FREE' && remainingMs > 0;

      const badgeEl = document.getElementById('badge-active-tier-pill');
      if (badgeEl) {
        if (isTrialActive && remainingMs > 0) {
          badgeEl.textContent = '7-DAY FREE TRIAL (PRO)';
          badgeEl.style.background = 'rgba(0,214,143,0.15)';
          badgeEl.style.color = 'var(--accent-emerald)';
          badgeEl.style.border = '1px solid rgba(0,214,143,0.35)';
        } else if (curTier === 'ENTERPRISE' && isPaidActive) {
          badgeEl.textContent = 'ENTERPRISE TIER (PAID)';
          badgeEl.style.background = 'rgba(168,85,247,0.15)';
          badgeEl.style.color = '#a855f7';
          badgeEl.style.border = '1px solid rgba(168,85,247,0.35)';
        } else if ((curTier === 'PRO' || curTier === 'GROWTH') && isPaidActive) {
          badgeEl.textContent = 'PRO TIER (PAID)';
          badgeEl.style.background = 'rgba(0,214,143,0.15)';
          badgeEl.style.color = 'var(--accent-emerald)';
          badgeEl.style.border = '1px solid rgba(0,214,143,0.35)';
        } else if (curTier === 'STARTER' && isPaidActive) {
          badgeEl.textContent = 'STARTER TIER (PAID)';
          badgeEl.style.background = 'rgba(59,130,246,0.15)';
          badgeEl.style.color = '#3b82f6';
          badgeEl.style.border = '1px solid rgba(59,130,246,0.35)';
        } else {
          badgeEl.textContent = 'FREE TIER';
          badgeEl.style.background = 'rgba(245,158,11,0.15)';
          badgeEl.style.color = '#f59e0b';
          badgeEl.style.border = '1px solid rgba(245,158,11,0.35)';
        }
      }

      const expiryTxtEl = document.getElementById('txt-license-expiry');
      if (expiryTxtEl) {
        if (isTrialActive && remainingMs > 0) {
          expiryTxtEl.textContent = `${remDays} days, ${remHours} hrs left (Free Trial)`;
          expiryTxtEl.style.color = 'var(--accent-emerald)';
        } else if (isPaidActive) {
          expiryTxtEl.textContent = `${remDays} days left (Active Subscription)`;
          expiryTxtEl.style.color = 'var(--accent-emerald)';
        } else {
          expiryTxtEl.textContent = 'Free Lifetime Baseline';
          expiryTxtEl.style.color = 'var(--text-gray)';
        }
      }

      const trialBanner = document.getElementById('free-trial-banner-card');
      if (trialBanner) {
        trialBanner.style.display = (isPaidActive || isTrialActive) ? 'none' : 'flex';
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

        // 8b. Restore Subscription Modal Trigger
        const restoreBtn = e.target.closest('#btn-restore-subscription-claim, #btn-restore-sub-modal-trigger, .btn-trigger-restore-sub');
        if (restoreBtn) {
          e.preventDefault();
          this.openRestoreSubscriptionModal();
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
    },

    async openRestoreSubscriptionModal() {
      // Remove any existing instance
      const existing = document.getElementById('valenixia-restore-subscription-modal');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

      const modal = document.createElement('div');
      modal.id = 'valenixia-restore-subscription-modal';
      modal.style.cssText = 'position: fixed; inset: 0; z-index: 999999; background: rgba(0,0,0,0.88); display: flex; align-items: center; justify-content: center; padding: 16px; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); overflow-y: auto; box-sizing: border-box;';

      modal.innerHTML = `
        <div style="background: var(--bg-card, #131722); border: 1px solid rgba(255,255,255,0.12); border-radius: 18px; width: 100%; max-width: 520px; overflow: hidden; color: #fff; box-shadow: 0 30px 60px -15px rgba(0,0,0,0.85); animation: modalIn 0.2s cubic-bezier(0.16,1,0.3,1); max-height: calc(100vh - 32px); display: flex; flex-direction: column;">
          
          <!-- Header -->
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); flex-shrink: 0;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 34px; height: 34px; border-radius: 8px; background: rgba(245,158,11,0.15); display: flex; align-items: center; justify-content: center; color: #fbbf24;">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
              </div>
              <div>
                <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: #fff;">Account &amp; Store Restoration</h3>
                <span style="font-size: 11px; color: var(--text-gray, #94a3b8);">Recover your active subscription or restore a data backup</span>
              </div>
            </div>
            <button type="button" id="btn-close-restore-modal" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; font-size: 18px; cursor: pointer; width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">&times;</button>
          </div>

          <!-- Nav Tabs -->
          <div style="display: flex; border-bottom: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.2); flex-shrink: 0;">
            <button type="button" id="tab-restore-cloud" style="flex: 1; padding: 12px 14px; font-size: 12px; font-weight: 700; border: none; background: transparent; color: var(--accent-emerald, #00d68f); border-bottom: 2px solid var(--accent-emerald, #00d68f); cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
              <span>Cloud &amp; Subscription</span>
            </button>
            <button type="button" id="tab-restore-file" style="flex: 1; padding: 12px 14px; font-size: 12px; font-weight: 700; border: none; background: transparent; color: #94a3b8; border-bottom: 2px solid transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
              <span>Backup File (.json)</span>
            </button>
          </div>

          <!-- Body Container -->
          <div style="padding: 20px; overflow-y: auto; flex: 1;">
            
            <!-- PANEL 1: Cloud & Subscription Lookup -->
            <div id="panel-restore-cloud">
              <p style="font-size: 12.5px; color: #94a3b8; line-height: 1.5; margin: 0 0 16px;">
                Re-installed app or switching devices? Enter your <strong>Merchant Mobile Phone</strong>, <strong>Claim ID</strong> (e.g. <code>CLM-123456</code>), or <strong>Transaction RRN</strong> to recover your store and remaining days.
              </p>

              <div style="margin-bottom: 16px;">
                <label style="display: block; font-size: 11px; font-weight: 700; color: #cbd5e1; text-transform: uppercase; margin-bottom: 6px;">Phone / Claim ID / RRN / Store Name</label>
                <input type="text" id="input-restore-lookup-query" placeholder="e.g. 03001234567 or CLM-123456 or WA_TX_894123" style="width: 100%; padding: 12px 14px; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #fff; font-size: 14px; outline: none; font-family: var(--font-mono, monospace); box-sizing: border-box;">
              </div>

              <!-- Multi-Store Disambiguation Card Container -->
              <div id="restore-multistore-container" style="display: none; margin-bottom: 16px;">
                <div style="font-size: 11px; font-weight: 700; color: #fbbf24; text-transform: uppercase; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                  <span>Multiple Stores Found — Select Which Store to Restore:</span>
                </div>
                <div id="restore-multistore-list" style="display: flex; flex-direction: column; gap: 10px; max-height: 220px; overflow-y: auto; padding-right: 4px;"></div>
              </div>

              <div id="restore-modal-feedback" style="display: none; padding: 12px; border-radius: 8px; font-size: 12.5px; margin-bottom: 16px; line-height: 1.4;"></div>

              <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button type="button" id="btn-cancel-restore" style="padding: 10px 18px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #e2e8f0; font-weight: 600; font-size: 13px; border-radius: 8px; cursor: pointer;">Cancel</button>
                <button type="button" id="btn-submit-restore" style="padding: 10px 22px; background: #10b981; border: none; color: #07090e; font-weight: 700; font-size: 13px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                  <span>Verify &amp; Restore</span>
                </button>
              </div>
            </div>

            <!-- PANEL 2: Backup File Restore -->
            <div id="panel-restore-file" style="display: none;">
              <p style="font-size: 12.5px; color: #94a3b8; line-height: 1.5; margin: 0 0 16px;">
                Restore an entire database archive (products, customers, history, settings) exported from another register or device.
              </p>

              <div id="restore-drop-zone" style="border: 2px dashed rgba(0,214,143,0.35); border-radius: 12px; padding: 24px 16px; text-align: center; background: rgba(0,214,143,0.03); cursor: pointer; transition: all 0.2s ease; margin-bottom: 16px;">
                <div style="font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 4px;">Click to Select or Drop Backup File</div>
                <div style="font-size: 11px; color: #94a3b8;">Supports .valenixia, .json, and .db backup archives</div>
                <input type="file" id="input-restore-backup-file" accept=".json,.valenixia,.db" style="display: none;">
              </div>

              <div id="restore-file-feedback" style="display: none; padding: 12px; border-radius: 8px; font-size: 12.5px; margin-bottom: 16px;"></div>

              <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button type="button" id="btn-cancel-restore-file" style="padding: 10px 18px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #e2e8f0; font-weight: 600; font-size: 13px; border-radius: 8px; cursor: pointer;">Cancel</button>
              </div>
            </div>

          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const closeBtn = document.getElementById('btn-close-restore-modal');
      const cancelBtn = document.getElementById('btn-cancel-restore');
      const cancelFileBtn = document.getElementById('btn-cancel-restore-file');
      const submitBtn = document.getElementById('btn-submit-restore');
      const queryInput = document.getElementById('input-restore-lookup-query');
      const feedbackEl = document.getElementById('restore-modal-feedback');
      const multiStoreBox = document.getElementById('restore-multistore-container');
      const multiStoreList = document.getElementById('restore-multistore-list');

      const tabCloud = document.getElementById('tab-restore-cloud');
      const tabFile = document.getElementById('tab-restore-file');
      const panelCloud = document.getElementById('panel-restore-cloud');
      const panelFile = document.getElementById('panel-restore-file');

      const closeModal = () => {
        if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
      };

      closeBtn.onclick = closeModal;
      if (cancelBtn) cancelBtn.onclick = closeModal;
      if (cancelFileBtn) cancelFileBtn.onclick = closeModal;

      // Tab switching
      tabCloud.onclick = () => {
        tabCloud.style.color = 'var(--accent-emerald, #00d68f)';
        tabCloud.style.borderBottomColor = 'var(--accent-emerald, #00d68f)';
        tabFile.style.color = '#94a3b8';
        tabFile.style.borderBottomColor = 'transparent';
        panelCloud.style.display = 'block';
        panelFile.style.display = 'none';
      };

      tabFile.onclick = () => {
        tabFile.style.color = 'var(--accent-emerald, #00d68f)';
        tabFile.style.borderBottomColor = 'var(--accent-emerald, #00d68f)';
        tabCloud.style.color = '#94a3b8';
        tabCloud.style.borderBottomColor = 'transparent';
        panelFile.style.display = 'block';
        panelCloud.style.display = 'none';
      };

      // Lookup execution
      submitBtn.onclick = async () => {
        const q = queryInput.value.trim();
        if (!q) {
          feedbackEl.style.display = 'block';
          feedbackEl.style.background = 'rgba(239,68,68,0.15)';
          feedbackEl.style.color = '#ef4444';
          feedbackEl.style.border = '1px solid rgba(239,68,68,0.3)';
          feedbackEl.textContent = 'Please enter a Claim ID, Transaction RRN, or Phone number.';
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Verifying...';
        feedbackEl.style.display = 'none';
        if (multiStoreBox) multiStoreBox.style.display = 'none';

        const result = await ValenixiaClaimsManager.restoreSubscriptionByLookup(q);

        submitBtn.disabled = false;
        submitBtn.textContent = 'Verify & Restore';

        if (result.success) {
          // Check if multiple stores matched under this phone / query
          if (result.multiple && Array.isArray(result.stores)) {
            multiStoreBox.style.display = 'block';
            multiStoreList.replaceChildren();

            result.stores.forEach(store => {
              const card = document.createElement('div');
              card.style.cssText = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 12px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; transition: all 0.2s ease;';
              
              card.innerHTML = `
                <div style="flex: 1;">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 3px;">
                    <span style="font-weight: 700; font-size: 13px; color: #fff;">${store.storeName}</span>
                    <span style="padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 800; background: rgba(0,214,143,0.15); color: #00d68f;">${store.tier}</span>
                  </div>
                  <div style="font-size: 11px; color: #94a3b8; display: flex; align-items: center; gap: 8px;">
                    <span>${store.platform}</span>
                    <span>•</span>
                    <span style="color: #fbbf24; font-weight: 600;">${store.daysRemaining} days left</span>
                  </div>
                </div>
                <button type="button" class="btn-restore-single-store" style="padding: 7px 14px; background: #00d68f; border: none; color: #060d0d; font-weight: 700; font-size: 11.5px; border-radius: 6px; cursor: pointer; flex-shrink: 0;">
                  Restore
                </button>
              `;

              card.querySelector('.btn-restore-single-store')?.addEventListener('click', () => {
                const applied = ValenixiaClaimsManager.applyStoreRestoration(store.claim);
                if (applied.success) {
                  feedbackEl.style.display = 'block';
                  feedbackEl.style.background = 'rgba(16,185,129,0.15)';
                  feedbackEl.style.color = '#10b981';
                  feedbackEl.style.border = '1px solid rgba(16,185,129,0.3)';
                  feedbackEl.innerHTML = `<strong>${store.storeName} Restored!</strong><br>Plan: <strong>${store.tier}</strong> (${store.daysRemaining} days remaining)`;
                  multiStoreBox.style.display = 'none';

                  ValenixiaSubscription.refresh();
                  ValenixiaSubscription.renderClaimsHistory();

                  setTimeout(() => {
                    closeModal();
                  }, 600);
                }
              });

              multiStoreList.appendChild(card);
            });
            return;
          }

          // Single store restored
          feedbackEl.style.display = 'block';
          feedbackEl.style.background = 'rgba(16,185,129,0.15)';
          feedbackEl.style.color = '#10b981';
          feedbackEl.style.border = '1px solid rgba(16,185,129,0.3)';
          feedbackEl.innerHTML = `<strong>Subscription Restored!</strong><br>Plan: <strong>${result.tier}</strong> (${result.daysRemaining} days remaining)<br>Store: ${result.storeName}`;

          ValenixiaSubscription.refresh();
          ValenixiaSubscription.renderClaimsHistory();

          setTimeout(() => {
            closeModal();
          }, 600);
        } else {
          feedbackEl.style.display = 'block';
          feedbackEl.style.background = 'rgba(239,68,68,0.15)';
          feedbackEl.style.color = '#ef4444';
          feedbackEl.style.border = '1px solid rgba(239,68,68,0.3)';
          feedbackEl.textContent = result.error || 'No matching active subscription found.';
        }
      };

      queryInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitBtn.click();
        }
      };

      // File Backup Drop Zone
      const dropZone = document.getElementById('restore-drop-zone');
      const fileInput = document.getElementById('input-restore-backup-file');
      const fileFeedback = document.getElementById('restore-file-feedback');

      if (dropZone && fileInput) {
        dropZone.onclick = () => fileInput.click();
        dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent-emerald)'; };
        dropZone.ondragleave = () => { dropZone.style.borderColor = 'rgba(0,214,143,0.35)'; };
        dropZone.ondrop = (e) => {
          e.preventDefault();
          dropZone.style.borderColor = 'rgba(0,214,143,0.35)';
          if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleBackupFileIngestion(e.dataTransfer.files[0]);
          }
        };

        fileInput.onchange = (e) => {
          if (e.target.files && e.target.files[0]) {
            handleBackupFileIngestion(e.target.files[0]);
          }
        };
      }

      async function handleBackupFileIngestion(file) {
        if (!file) return;
        if (fileFeedback) {
          fileFeedback.style.display = 'block';
          fileFeedback.style.background = 'rgba(59,130,246,0.15)';
          fileFeedback.style.color = '#3b82f6';
          fileFeedback.style.border = '1px solid rgba(59,130,246,0.3)';
          fileFeedback.textContent = `Reading & unpacking ${file.name}...`;
        }

        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          let restoredProds = 0;

          // 1. Restore Catalog
          const catalogList = parsed.catalog || parsed.products || parsed.inventory || [];
          if (Array.isArray(catalogList) && catalogList.length > 0) {
            state.catalog = catalogList;
            restoredProds = catalogList.length;
            if (window.ValenixiaDB && typeof window.ValenixiaDB.put === 'function') {
              for (const p of catalogList) {
                try {
                  await window.ValenixiaDB.put('inventory_catalog', p);
                  await window.ValenixiaDB.put('products', p);
                } catch (_) {}
              }
            }
          }

          // 2. Restore Store Identity & Tier
          const storeName = parsed.storeName || parsed.store_name || (parsed.storeProfile && parsed.storeProfile.name) || 'Restored Store';
          const tier = (parsed.tier || parsed.valenixia_tier || 'STARTER').toUpperCase();
          const expiresAt = parsed.subscription_expires_at || (Date.now() + 30 * 86400000);

          window.__valenixiaTier = tier;
          localStorage.setItem('valenixia_tier', tier);
          localStorage.setItem('valenixia_store_name', storeName);
          localStorage.setItem('valenixia_subscription_expires_at', String(expiresAt));
          localStorage.setItem('onboarding_complete', 'true');

          const ownerCashier = {
            id: 'emp_admin',
            name: 'Store Owner',
            role: 'ADMIN'
          };

          if (window.state) {
            window.state.storeName = storeName;
            window.state.tier = tier;
            window.state.activeCashier = ownerCashier;
            window.state.currentPin = '';
            window.state.activeScreen = 'checkout';
          }

          try {
            sessionStorage.setItem('valenixia_session_authenticated', '1');
            sessionStorage.setItem('valenixia_auth_session', 'true');
            sessionStorage.setItem('valenixia_active_cashier', JSON.stringify(ownerCashier));
            document.documentElement.classList.add('session-authenticated');
          } catch (_) {}

          // 3. Close wizard, lock overlays & launch app
          const wiz = document.getElementById('first-boot-wizard');
          if (wiz) {
            wiz.style.setProperty('display', 'none', 'important');
            wiz.style.setProperty('visibility', 'hidden', 'important');
            wiz.style.setProperty('opacity', '0', 'important');
            wiz.classList.remove('active');
          }
          try { document.body.classList.remove('wizard-active'); } catch (_) {}

          const lockScreen = document.getElementById('auth-lock-screen');
          if (lockScreen) {
            lockScreen.style.setProperty('display', 'none', 'important');
            lockScreen.style.setProperty('visibility', 'hidden', 'important');
            lockScreen.style.setProperty('opacity', '0', 'important');
            lockScreen.classList.remove('active');
          }

          window.__valenixiaAuthenticated = true;
          window.appReady = true;
          window.appInitialized = true;
          window.bootstrapDecisionReady = true;
          window.bootstrapReady = true;

          if (window.ValenixiaBootstrap && typeof window.ValenixiaBootstrap.transition === 'function') {
            window.ValenixiaBootstrap.transition('READY');
          }

          const appLayout = document.getElementById('pos-app-layout');
          if (appLayout) {
            appLayout.style.setProperty('display', 'grid', 'important');
            appLayout.style.setProperty('visibility', 'visible', 'important');
            appLayout.style.setProperty('opacity', '1', 'important');
            appLayout.classList.add('active');
          }

          if (typeof window.applyActiveTierToSystem === 'function') window.applyActiveTierToSystem(tier);
          if (typeof window.applyRoleNavigationLimits === 'function') {
            try { window.applyRoleNavigationLimits('ADMIN'); } catch (_) {}
          }
          if (typeof window.switchActiveScreen === 'function') window.switchActiveScreen('checkout');
          if (typeof window.renderCheckoutScreen === 'function') window.renderCheckoutScreen();

          if (fileFeedback) {
            fileFeedback.style.background = 'rgba(16,185,129,0.15)';
            fileFeedback.style.color = '#10b981';
            fileFeedback.style.border = '1px solid rgba(16,185,129,0.3)';
            fileFeedback.innerHTML = `<strong>Backup Ingested Successfully!</strong><br>Restored ${restoredProds} products &amp; store profile: <strong>${storeName}</strong>.`;
          }

          if (typeof window.playAudioSignal === 'function') window.playAudioSignal('success');
          if (typeof window.triggerConfetti === 'function') window.triggerConfetti();
          if (typeof window.showNotificationToast === 'function') {
            window.showNotificationToast(`Restored ${storeName} with ${restoredProds} products!`, 'success', 4000);
          }

          setTimeout(() => {
            closeModal();
          }, 800);

        } catch (err) {
          console.error('[Backup Restore] Failed:', err);
          if (fileFeedback) {
            fileFeedback.style.background = 'rgba(239,68,68,0.15)';
            fileFeedback.style.color = '#ef4444';
            fileFeedback.style.border = '1px solid rgba(239,68,68,0.3)';
            fileFeedback.textContent = `Invalid backup file: ${err.message}`;
          }
        }
      }

      setTimeout(() => { try { queryInput.focus(); } catch (_) {} }, 100);
    }
  };

  window.openSubscriptionRestoreModal = () => ValenixiaSubscription.openRestoreSubscriptionModal();

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
