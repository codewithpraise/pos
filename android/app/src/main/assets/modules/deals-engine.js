// ============================================================================
// VALENIXIA DEALS ENGINE — v1.0.0  (Production-Grade)
// Handles deal/bundle creation, management, and checkout integration.
//
// Strategy (mirrors Square POS):
//  - Deals persisted to IndexedDB via syncWorker SAVE_DEALS (durable)
//  - CRDT broadcast on every change → other terminals receive update instantly
//  - Customizable vs non-customizable per deal (owner's choice)
//  - Multi-item stock bundled: ALL items deducted simultaneously via INVENTORY_DELTA
//  - Business-mode specific terminology (Combo/Special/Bundle/Kit/Package)
// ============================================================================
'use strict';

(function() {
  const STORE_KEY = 'valenixia_deals';
  const DEAL_PFX  = 'deal_';

  // Terminology per business mode
  const MODE_LABELS = {
    'food-restaurant': { s:'Combo',   p:'Combos',   i:'' },
    'bakery-cafe':     { s:'Special', p:'Specials',  i:'' },
    'simple-retail':   { s:'Bundle',  p:'Bundles',   i:'' },
    'grocery-mart':    { s:'Bundle',  p:'Bundles',   i:'' },
    'pharmacy-medical':{ s:'Kit',     p:'Kits',      i:'' },
    'services-appointments':{ s:'Package',p:'Packages',i:''},
    DEFAULT:           { s:'Deal',    p:'Deals',     i:'' }
  };

  // ── Internal state ─────────────────────────────────────────────────────────
  let _deals = [];
  let _mode  = 'simple-retail';
  let _renderCb = null;

  function lbl() { return MODE_LABELS[_mode] || MODE_LABELS.DEFAULT; }

  function genId() {
    return DEAL_PFX + Date.now() + '_' + Math.random().toString(36).slice(2,7);
  }

  function fmt(cents) {
    if (typeof window.formatCurrency === 'function') return window.formatCurrency(cents);
    return 'Rs. ' + (cents/100).toFixed(2);
  }

  // ── Persistence ────────────────────────────────────────────────────────────
  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) _deals = JSON.parse(raw);
    } catch(_) { _deals = []; }
  }

  function saveLocal() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(_deals)); } catch(_) {}
    // Persist durably via sync worker (CRDT-broadcast to other terminals)
    if (window.syncWorker) {
      window.syncWorker.postMessage({ type: 'SAVE_DEALS', payload: { deals: _deals } });
    }
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────
  function getAll()    { return _deals.filter(d => !d.is_deleted); }
  function getById(id) { return _deals.find(d => d.id === id); }

  function upsert(d) {
    const ts = new Date().toISOString();
    const i = _deals.findIndex(x => x.id === d.id);
    if (i !== -1) _deals[i] = { ..._deals[i], ...d, updated_at: ts };
    else          _deals.push({ ...d, created_at: ts, updated_at: ts });
    saveLocal();
    if (_renderCb) _renderCb();
  }

  function softDelete(id) {
    const i = _deals.findIndex(d => d.id === id);
    if (i !== -1) {
      _deals[i].is_deleted = 1;
      _deals[i].updated_at = new Date().toISOString();
      saveLocal();
      if (_renderCb) _renderCb();
    }
  }

  // ── Stock check & deduct ───────────────────────────────────────────────────
  function catalog() { return (window.state && window.state.catalog) ? window.state.catalog : []; }

  function stockShortages(deal, qty) {
    const out = [];
    (deal.items||[]).forEach(item => {
      const p = catalog().find(p => p.id === item.product_id || p.sku === item.product_id);
      if (!p) return;
      const avail = (p.stock_quantity != null) ? p.stock_quantity : Infinity;
      const need  = item.qty * qty;
      if (avail !== Infinity && avail < need)
        out.push({ name: p.name, available: avail, required: need });
    });
    return out;
  }

  function deductStock(deal, qty) {
    (deal.items||[]).forEach(item => {
      const p = catalog().find(p => p.id === item.product_id || p.sku === item.product_id);
      if (p && p.stock_quantity != null) {
        const delta = -(item.qty * qty);
        p.stock_quantity = Math.max(0, p.stock_quantity + delta);
        // Atomic PN-Counter delta via sync worker (Square-style)
        if (window.syncWorker) {
          window.syncWorker.postMessage({
            type: 'INVENTORY_DELTA',
            payload: { sku: p.sku || p.id, delta, reason: 'DEAL_SALE' }
          });
        }
      }
    });
  }

  // ── Add deal to cart ───────────────────────────────────────────────────────
  function addToCart(dealId, customizations) {
    const deal = getById(dealId);
    if (!deal) return { ok:false, error:'Deal not found.' };

    const shortages = stockShortages(deal, 1);
    if (shortages.length) {
      const msg = shortages.map(s=>`${s.name}: need ${s.required}, have ${s.available}`).join('; ');
      return { ok:false, error:'Insufficient stock — ' + msg };
    }

    const itemNote = (customizations && customizations.note) ? customizations.note.trim() : '';
    const displayName = itemNote ? `${deal.name} (${itemNote})` : deal.name;

    const item = {
      id:          'cart_deal_' + Date.now(),
      sku:         deal.id,
      deal_id:     dealId,
      is_deal:     true,
      name:        deal.name,
      displayName: displayName,
      price:       deal.price_cents,
      qty:         1,
      quantity:    1,
      unit_price_cents: deal.price_cents,
      total_cents: deal.price_cents,
      cost:        0,
      items:       deal.items,
      customizable:deal.customizable,
      customizations: customizations || {},
      icon:        deal.icon || lbl().i
    };

    if (!window.state) return { ok:false, error:'App not ready.' };
    window.state.activeCart = window.state.activeCart || [];
    window.state.activeCart.push(item);
    deductStock(deal, 1);

    if (typeof window.renderCart === 'function') window.renderCart();
    if (window.showNotificationToast) window.showNotificationToast(displayName + ' added to cart!', 'success', 2000);
    return { ok:true, cartItem:item };
  }

  // ── Render deals list view ─────────────────────────────────────────────────
  // ── Render deals list view ─────────────────────────────────────────────────
  function renderView() {
    const el = document.getElementById('deals-list-container');
    if (!el) return;
    const deals = getAll();
    const L = lbl();
    const isLight = document.body.classList.contains('theme-monochrome-ivory');

    if (!deals.length) {
      el.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--text-gray);">
        <div style="width:64px;height:64px;margin:0 auto 16px auto;border-radius:50%;background:${isLight?'#ecfdf5':'rgba(0,214,143,0.1)'};border:1.5px solid ${isLight?'#a7f3d0':'rgba(0,214,143,0.3)'};display:flex;align-items:center;justify-content:center;">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="${isLight?'#059669':'#00d68f'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
        </div>
        <p style="font-size:16px;font-weight:800;color:var(--text-white);margin-bottom:8px;">No ${L.p} Configured Yet</p>
        <p style="font-size:13px;margin-bottom:24px;color:var(--text-gray);max-width:380px;margin-left:auto;margin-right:auto;">Create your first ${L.s.toLowerCase()} to bundle multiple inventory items together with custom discount pricing.</p>
        <button class="action-btn action-success" id="btn-deals-create-empty" style="min-height:44px;padding:0 24px;font-weight:800;font-size:13.5px;">+ Create ${L.s}</button>
      </div>`;
      document.getElementById('btn-deals-create-empty')?.addEventListener('click', () => openEdit(null));
      return;
    }

    el.innerHTML = '';
    deals.forEach(deal => {
      const cnt = (deal.items||[]).length;
      const customBadge = deal.customizable
        ? `<span style="background:${isLight?'#ecfdf5':'rgba(16,185,129,.15)'};color:${isLight?'#047857':'#10b981'};border:1px solid ${isLight?'#a7f3d0':'rgba(16,185,129,.3)'};font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;">CUSTOMIZABLE</span>`
        : `<span style="background:${isLight?'#f1f5f9':'rgba(100,116,139,.15)'};color:${isLight?'#475569':'#94a3b8'};border:1px solid ${isLight?'#cbd5e1':'rgba(100,116,139,.2)'};font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;">FIXED</span>`;
      const disabledBadge = !deal.is_active
        ? `<span style="background:${isLight?'#fef2f2':'rgba(239,68,68,.15)'};color:${isLight?'#b91c1c':'#ef4444'};border:1px solid ${isLight?'#fecaca':'rgba(239,68,68,.3)'};font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;">DISABLED</span>` : '';
      
      const card = document.createElement('div');
      card.className = 'deal-card';
      card.style.cssText = `display:flex;flex-direction:column;gap:12px;padding:16px 18px;border:1.5px solid ${isLight?'#cbd5e1':'rgba(255,255,255,0.08)'};border-radius:14px;margin-bottom:12px;background:${isLight?'#ffffff':'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(20,20,30,0.6) 100%)'};box-shadow:${isLight?'0 4px 14px rgba(15,23,42,0.05)':'0 4px 16px rgba(0,0,0,0.25)'};transition:all .15s ease;`;
      
      card.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div style="display:flex;align-items:center;gap:12px;min-width:0;flex:1;">
            <div style="width:40px;height:40px;border-radius:10px;background:${isLight?'#ecfdf5':'rgba(0,214,143,0.1)'};border:1.5px solid ${isLight?'#a7f3d0':'rgba(0,214,143,0.3)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="${isLight?'#059669':'#00d68f'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            </div>
            <div style="min-width:0;flex:1;">
              <div style="font-weight:800;color:var(--text-white);font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${deal.name}</div>
              <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
                ${customBadge}${disabledBadge}
              </div>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:16px;font-weight:900;color:var(--accent-emerald);font-family:var(--font-display);">${fmt(deal.price_cents)}</div>
            ${deal.original_price_cents&&deal.original_price_cents>deal.price_cents?`<div style="font-size:11px;color:var(--text-gray);text-decoration:line-through;font-weight:600;">${fmt(deal.original_price_cents)}</div>`:''}
          </div>
        </div>
        <div style="font-size:12px;color:var(--text-gray);line-height:1.4;border-top:1px solid ${isLight?'#e2e8f0':'rgba(255,255,255,0.06)'};padding-top:10px;">
          <strong style="color:var(--text-white);">${cnt} item${cnt!==1?'s':''} bundled:</strong> ${deal.description||'Fixed-price promotional combination bundle.'}
        </div>
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-top:4px;">
          <button class="action-btn _deal-edit" data-id="${deal.id}" style="min-height:32px;padding:4px 14px;font-size:11.5px;font-weight:800;border-radius:8px;background:${isLight?'#f1f5f9':'rgba(255,255,255,0.08)'};border:1.5px solid ${isLight?'#cbd5e1':'rgba(255,255,255,0.2)'};color:${isLight?'#1e293b':'#ffffff'};">Edit Deal</button>
          <button class="action-btn action-danger _deal-del" data-id="${deal.id}" style="min-height:32px;padding:4px 12px;font-size:11.5px;font-weight:800;border-radius:8px;background:${isLight?'#fef2f2':'rgba(239,68,68,0.18)'};border:1.5px solid ${isLight?'#fca5a5':'rgba(239,68,68,0.5)'};color:#ef4444;display:inline-flex;align-items:center;justify-content:center;gap:4px;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#ef4444" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            <span>Delete</span>
          </button>
        </div>`;
      card.querySelector('._deal-edit').addEventListener('click', e => { e.stopPropagation(); openEdit(deal.id); });
      card.querySelector('._deal-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (typeof window.showModal === 'function') {
          const choice = await window.showModal({
            title: `Delete ${deal.name}?`,
            message: `Are you sure you want to permanently delete the "${deal.name}" package from your deals catalog?`,
            type: 'danger',
            actions: [
              { id: 'confirm', label: 'Yes, Delete Deal', style: 'danger' },
              { id: 'cancel', label: 'Cancel', style: 'secondary' }
            ]
          });
          if (choice !== 'confirm') return;
        } else {
          if (!confirm(`Delete "${deal.name}"?`)) return;
        }
        if (typeof window.playAudioSignal === 'function') window.playAudioSignal('trash');
        softDelete(deal.id);
        if (window.showNotificationToast) window.showNotificationToast(`Deal "${deal.name}" deleted.`, 'success', 2500);
      });
      el.appendChild(card);
    });
  }

  // ── Edit modal ─────────────────────────────────────────────────────────────
  function openEdit(dealId) {
    document.getElementById('__vxdm')?.remove();
    const deal = dealId ? getById(dealId) : null;
    const cat  = catalog();
    const L    = lbl();
    const isNew = !deal;
    const selItems = deal ? JSON.parse(JSON.stringify(deal.items||[])) : [];
    const isLight = document.body.classList.contains('theme-monochrome-ivory');

    const ov = document.createElement('div');
    ov.id = '__vxdm';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483640;background:' + (isLight ? 'rgba(15,23,42,0.65)' : 'rgba(5,5,8,0.92)') + ';display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto;backdrop-filter:blur(8px);';

    const cardBg = isLight ? '#ffffff' : '#0d0d12';
    const cardBorder = isLight ? '#cbd5e1' : 'rgba(255,255,255,.1)';
    const inputBg = isLight ? '#ffffff' : 'rgba(255,255,255,.04)';
    const inputBorder = isLight ? '#cbd5e1' : 'rgba(255,255,255,.14)';
    const inputColor = isLight ? '#0f172a' : '#ffffff';
    const subPanelBg = isLight ? '#f8fafc' : 'rgba(255,255,255,.03)';
    const subPanelBorder = isLight ? '#e2e8f0' : 'rgba(255,255,255,.07)';
    const labelColor = isLight ? '#1e293b' : '#94a3b8';
    const selectOptBg = isLight ? '#ffffff' : '#14141d';
    const selectOptColor = isLight ? '#0f172a' : '#ffffff';

    ov.innerHTML = `<div style="max-width:560px;width:100%;background:${cardBg};border:1.5px solid ${cardBorder};border-radius:16px;padding:24px;box-shadow:${isLight?'0 32px 64px rgba(15,23,42,0.18)':'0 32px 64px rgba(0,0,0,.8)'};margin:auto;max-height:90vh;overflow-y:auto;box-sizing:border-box;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:12px;border-bottom:1.5px solid ${subPanelBorder};">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:36px;height:36px;border-radius:10px;background:${isLight?'#ecfdf5':'rgba(0,214,143,0.1)'};border:1.5px solid ${isLight?'#a7f3d0':'rgba(0,214,143,0.3)'};display:flex;align-items:center;justify-content:center;">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${isLight?'#059669':'#00d68f'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
          </div>
          <h2 style="font-size:18px;font-weight:800;color:${isLight?'#0f172a':'#ffffff'};margin:0;">${isNew?'Create':'Edit'} ${L.s}</h2>
        </div>
        <button id="__vxdm-close" style="background:${isLight?'#f1f5f9':'rgba(255,255,255,0.06)'};border:1.5px solid ${cardBorder};color:${isLight?'#475569':'#94a3b8'};width:34px;height:34px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:11px;font-weight:700;color:${labelColor};text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">${L.s} Package Name *</label>
        <input id="__vxdm-name" type="text" maxlength="80" placeholder="e.g. Breakfast Special Combo..." value="${deal?deal.name:''}" style="width:100%;padding:11px 14px;background:${inputBg};border:1.5px solid ${inputBorder};color:${inputColor};border-radius:8px;font-size:14px;font-weight:600;box-sizing:border-box;outline:none;">
      </div>

      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:11px;font-weight:700;color:${labelColor};text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Description (Optional)</label>
        <input id="__vxdm-desc" type="text" maxlength="120" placeholder="Short description or tagline..." value="${deal?deal.description||'':''}" style="width:100%;padding:11px 14px;background:${inputBg};border:1.5px solid ${inputBorder};color:${inputColor};border-radius:8px;font-size:14px;font-weight:600;box-sizing:border-box;outline:none;">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div>
          <label style="display:block;font-size:11px;font-weight:700;color:${labelColor};text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">${L.s} Price (Rs.) *</label>
          <input id="__vxdm-price" type="number" min="1" step="1" required placeholder="Required" value="${deal?(deal.price_cents/100).toFixed(0):''}" style="width:100%;padding:11px 14px;background:${inputBg};border:1.5px solid ${inputBorder};color:${isLight?'#047857':'#00d68f'};border-radius:8px;font-size:15px;font-weight:800;box-sizing:border-box;outline:none;">
        </div>
        <div>
          <label style="display:block;font-size:11px;font-weight:700;color:${labelColor};text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Original Value (Rs.) — Optional</label>
          <input id="__vxdm-orig" type="number" min="0" step="1" placeholder="Optional strikethrough" value="${deal&&deal.original_price_cents?(deal.original_price_cents/100).toFixed(0):''}" style="width:100%;padding:11px 14px;background:${inputBg};border:1.5px solid ${inputBorder};color:${inputColor};border-radius:8px;font-size:14px;font-weight:600;box-sizing:border-box;outline:none;">
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px;">
        <label style="display:flex;align-items:center;gap:10px;background:${subPanelBg};border:1.5px solid ${subPanelBorder};padding:12px 14px;border-radius:10px;cursor:pointer;">
          <input type="checkbox" id="__vxdm-cust" ${!deal||deal.customizable?'checked':''} style="width:18px;height:18px;accent-color:#059669;">
          <div><div style="font-size:13px;font-weight:700;color:${isLight?'#0f172a':'#ffffff'};">Customizable</div><div style="font-size:11px;color:${labelColor};font-weight:500;">Cashier can modify items</div></div>
        </label>
        <label style="display:flex;align-items:center;gap:10px;background:${subPanelBg};border:1.5px solid ${subPanelBorder};padding:12px 14px;border-radius:10px;cursor:pointer;">
          <input type="checkbox" id="__vxdm-active" ${!deal||deal.is_active!==false?'checked':''} style="width:18px;height:18px;accent-color:#059669;">
          <div><div style="font-size:13px;font-weight:700;color:${isLight?'#0f172a':'#ffffff'};">Active Status</div><div style="font-size:11px;color:${labelColor};font-weight:500;">Show in POS checkout</div></div>
        </label>
      </div>

      <div style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <label style="font-size:11px;font-weight:700;color:${labelColor};text-transform:uppercase;letter-spacing:.05em;">Bundled Products *</label>
          <span style="font-size:11px;color:${labelColor};font-weight:500;">Deducted simultaneously upon sale</span>
        </div>
        <div id="__vxdm-items" style="max-height:160px;overflow-y:auto;margin-bottom:10px;"></div>
        <div style="display:flex;gap:8px;">
          <select id="__vxdm-sel" style="flex:1;padding:10px 12px;background:${inputBg};border:1.5px solid ${inputBorder};color:${inputColor};border-radius:8px;font-size:13.5px;font-weight:600;outline:none;">
            <option value="" style="background:${selectOptBg};color:${isLight?'#64748b':'#94a3b8'};">— Select inventory product to add —</option>
            ${cat.map(p=>`<option value="${p.id||p.sku}" data-price="${p.price_cents||p.base_price_minor_units||0}" style="background:${selectOptBg};color:${selectOptColor};padding:8px;">${p.name} (${fmt(p.price_cents||p.base_price_minor_units||0)})</option>`).join('')}
          </select>
          <button id="__vxdm-add-item" style="padding:8px 18px;background:${isLight?'#ecfdf5':'rgba(16,185,129,.15)'};border:1.5px solid ${isLight?'#a7f3d0':'rgba(16,185,129,.4)'};color:${isLight?'#047857':'#10b981'};border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;">+ Add</button>
        </div>
      </div>

      <div style="display:flex;gap:10px;padding-top:12px;border-top:1.5px solid ${subPanelBorder};">
        <button id="__vxdm-save" style="flex:1;height:46px;background:linear-gradient(135deg,#059669,#047857);border:none;color:#ffffff;font-size:14px;font-weight:800;border-radius:10px;cursor:pointer;font-family:inherit;box-shadow:0 4px 12px rgba(5,150,105,0.25);">${isNew?'Create '+L.s:'Save Changes'}</button>
        ${!isNew ? `<button id="__vxdm-delete" style="height:46px;padding:0 16px;background:${isLight?'#fef2f2':'rgba(239,68,68,0.15)'};border:1.5px solid ${isLight?'#fca5a5':'rgba(239,68,68,0.5)'};color:#ef4444;border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:800;font-family:inherit;display:inline-flex;align-items:center;gap:6px;">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#ef4444" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>Delete</span>
        </button>` : ''}
        <button id="__vxdm-cancel" style="height:46px;padding:0 20px;background:${isLight?'#f1f5f9':'transparent'};border:1.5px solid ${cardBorder};color:${isLight?'#334155':'#94a3b8'};border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:inherit;">Cancel</button>
      </div>
    </div>`;
    document.body.appendChild(ov);

    // Render selected items list
    const redrawItems = () => {
      const el = ov.querySelector('#__vxdm-items');
      if (!el) return;
      if (!selItems.length) {
        el.innerHTML = `<p style="color:${isLight?'#64748b':'var(--text-gray)'};font-size:12px;text-align:center;padding:12px 0;background:${subPanelBg};border:1.5px dashed ${subPanelBorder};border-radius:8px;margin:0;">No products added yet. Select a product below and click "+ Add".</p>`;
        return;
      }
      el.innerHTML = selItems.map((item,i) => `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:1.5px solid ${subPanelBorder};border-radius:8px;margin-bottom:6px;background:${isLight?'#ffffff':'rgba(255,255,255,.02)'};">
        <span style="flex:1;font-size:13px;font-weight:700;color:${isLight?'#0f172a':'var(--text-white)'};">${item.name}</span>
        <span style="font-size:11px;color:${labelColor};font-weight:700;">Qty:</span>
        <input type="number" min="1" value="${item.qty}" data-i="${i}" class="__vxdm-qty" style="width:52px;padding:4px 6px;background:${inputBg};border:1.5px solid ${inputBorder};color:${inputColor};border-radius:6px;font-size:13px;text-align:center;font-weight:800;outline:none;">
        <button data-i="${i}" class="__vxdm-rm action-danger" title="Remove item" style="background:${isLight?'#fef2f2':'rgba(239,68,68,0.2)'};border:1.5px solid ${isLight?'#fca5a5':'rgba(239,68,68,0.6)'};color:#ef4444;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:3px;min-height:26px;">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#ef4444" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>Del</span>
        </button>
      </div>`).join('');
      el.querySelectorAll('.__vxdm-qty').forEach(inp => inp.addEventListener('change', () => { selItems[+inp.dataset.i].qty = Math.max(1, parseInt(inp.value)||1); }));
      el.querySelectorAll('.__vxdm-rm').forEach(btn => btn.addEventListener('click', () => { selItems.splice(+btn.dataset.i, 1); redrawItems(); }));
    };
    redrawItems();

    ov.querySelector('#__vxdm-add-item').addEventListener('click', () => {
      const sel = ov.querySelector('#__vxdm-sel');
      const id = sel.value; if (!id) return;
      const prod = cat.find(p => (p.id||p.sku) === id);
      if (!prod) return;
      const ex = selItems.find(i => i.product_id === id);
      if (ex) ex.qty++;
      else selItems.push({ product_id: id, name: prod.name, qty:1, unit_price_cents: prod.price_cents||prod.base_price_minor_units||0 });
      redrawItems(); sel.value = '';
    });

    ov.querySelector('#__vxdm-close').addEventListener('click',  () => ov.remove());
    ov.querySelector('#__vxdm-cancel').addEventListener('click', () => ov.remove());
    ov.querySelector('#__vxdm-delete')?.addEventListener('click', async () => {
      if (!deal) return;
      if (typeof window.showModal === 'function') {
        const choice = await window.showModal({
          title: `Delete ${deal.name}?`,
          message: `Are you sure you want to permanently delete the "${deal.name}" package?`,
          type: 'danger',
          actions: [
            { id: 'confirm', label: 'Yes, Delete Deal', style: 'danger' },
            { id: 'cancel', label: 'Cancel', style: 'secondary' }
          ]
        });
        if (choice !== 'confirm') return;
      } else {
        if (!confirm(`Delete "${deal.name}"?`)) return;
      }
      if (typeof window.playAudioSignal === 'function') window.playAudioSignal('trash');
      softDelete(deal.id);
      ov.remove();
      if (window.showNotificationToast) window.showNotificationToast(`Deal "${deal.name}" deleted.`, 'success', 2500);
    });
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });

    ov.querySelector('#__vxdm-save').addEventListener('click', () => {
      const name  = (ov.querySelector('#__vxdm-name').value||'').trim();
      const price = parseFloat(ov.querySelector('#__vxdm-price').value||'0');
      const orig  = parseFloat(ov.querySelector('#__vxdm-orig').value||'0');
      const customizable = ov.querySelector('#__vxdm-cust').checked;
      const is_active    = ov.querySelector('#__vxdm-active').checked;
      const desc         = (ov.querySelector('#__vxdm-desc').value||'').trim();

      if (!name)                  { alert('Deal name is required.'); return; }
      if (isNaN(price)||price<=0)  { alert('Deal price is required and must be greater than Rs. 0.'); return; }
      if (!selItems.length)       { alert('Add at least one product to this deal.'); return; }

      upsert({ id: deal?deal.id:genId(), name, description:desc, icon:'', price_cents:Math.round(price*100), original_price_cents:orig>0?Math.round(orig*100):null, customizable, is_active, items:selItems, business_mode:_mode });
      ov.remove();
      if (window.showNotificationToast) window.showNotificationToast(name + (isNew ? ' created!' : ' updated!'), 'success', 2500);
    });
  }

  function openQuickAdd() {
    try { if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur(); } catch(_) {}
    document.getElementById('__vxdq')?.remove();
    const deals = getAll().filter(d => d.is_active !== false);
    const L = lbl();
    if (!deals || !deals.length) {
      try { if (typeof window.playAudioSignal === 'function') window.playAudioSignal('info'); } catch(_) {}
      if (typeof window.showNotificationToast === 'function') {
        window.showNotificationToast(`No active product bundles or promotional deals available. Create one in the ${L.p} screen.`, 'info', 4000);
      } else if (typeof window.showToast === 'function') {
        window.showToast(`No active ${L.p.toLowerCase()} available.`, 'info');
      }
      return;
    }

    const isLight = document.body.classList.contains('theme-monochrome-ivory');
    const ov = document.createElement('div');
    ov.id = '__vxdq';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483635;background:rgba(5,5,8,.82);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);padding:16px;box-sizing:border-box;';
    ov.innerHTML = `
      <div class="pos-modal-card" style="max-width:580px;width:100%;background:${isLight?'#ffffff':'#0d0d12'};border-radius:16px;border:1.5px solid ${isLight?'#cbd5e1':'rgba(255,255,255,.1)'};box-shadow:0 24px 60px rgba(0,0,0,${isLight?'0.18':'0.5'});max-height:85vh;display:flex;flex-direction:column;overflow:hidden;animation:modalEnter 0.2s cubic-bezier(0.16, 1, 0.3, 1);">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1.5px solid ${isLight?'#e2e8f0':'rgba(255,255,255,.08)'};background:${isLight?'#f8fafc':'rgba(255,255,255,0.02)'};flex-shrink:0;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:32px;height:32px;border-radius:8px;background:${isLight?'#ecfdf5':'rgba(0,214,143,0.12)'};border:1px solid ${isLight?'#a7f3d0':'rgba(0,214,143,0.25)'};display:flex;align-items:center;justify-content:center;">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="${isLight?'#059669':'#00d68f'}" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            </div>
            <div>
              <span style="font-size:16px;font-weight:800;color:${isLight?'#0f172a':'#ffffff'};font-family:var(--font-display);letter-spacing:-0.2px;">Select ${L.s} Bundle</span>
              <div style="font-size:11px;color:${isLight?'#64748b':'#94a3b8'};font-weight:600;">Choose promotional bundle or combo to add to cart</div>
            </div>
          </div>
          <button id="__vxdq-close" aria-label="Close Bundles Modal" style="background:${isLight?'#f1f5f9':'rgba(255,255,255,0.06)'};border:1px solid ${isLight?'#cbd5e1':'rgba(255,255,255,.1)'};color:${isLight?'#475569':'#94a3b8'};width:32px;height:32px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s ease;font-size:18px;font-weight:700;line-height:1;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div style="overflow-y:auto;overflow-x:hidden;padding:16px;flex:1;max-height:calc(85vh - 120px);display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain;" id="__vxdq-list"></div>
      </div>
    `;
    const list = ov.querySelector('#__vxdq-list');
    deals.forEach(deal => {
      const short = stockShortages(deal, 1);
      const oos = short.length > 0;
      const card = document.createElement('div');
      card.style.cssText = `display:flex;align-items:center;gap:14px;padding:14px;border:1.5px solid ${oos?(isLight?'#fecaca':'rgba(239,68,68,.25)'):(isLight?'#e2e8f0':'rgba(255,255,255,.08)')};border-radius:12px;background:${isLight?(oos?'#fff1f2':'#ffffff'):(oos?'rgba(239,68,68,0.03)':'rgba(255,255,255,.02)')};box-shadow:0 2px 6px rgba(0,0,0,${isLight?'0.04':'0.2'});transition:all 0.15s ease;`;
      
      const itemsCount = (deal.items || []).length;
      const itemsSummary = (deal.items || []).map(i => `${i.qty || 1}x ${i.name || 'Item'}`).join(', ');

      card.innerHTML = `
        <div style="width:44px;height:44px;border-radius:10px;background:${isLight?'#f1f5f9':'rgba(255,255,255,0.06)'};border:1px solid ${isLight?'#cbd5e1':'rgba(255,255,255,0.1)'};display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="${isLight?'#059669':'#00d68f'}" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:800;color:${oos?(isLight?'#94a3b8':'#64748b'):(isLight?'#0f172a':'#ffffff')};font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${deal.name}</div>
          <div style="font-size:11px;color:${isLight?'#64748b':'#94a3b8'};margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${itemsCount} items · ${itemsSummary || (deal.customizable ? 'Customizable' : 'Fixed')}</div>
          ${oos ? `<div style="font-size:11px;color:#ef4444;font-weight:700;margin-top:3px;display:flex;align-items:center;gap:4px;"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> Out of Stock (Insufficient Items)</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:15px;font-weight:900;color:${oos?(isLight?'#94a3b8':'#64748b'):(isLight?'#059669':'#10b981')};font-family:var(--font-display);">${fmt(deal.price_cents)}</div>
          ${deal.original_price_cents ? `<div style="font-size:11px;color:${isLight?'#94a3b8':'#64748b'};text-decoration:line-through;">${fmt(deal.original_price_cents)}</div>` : ''}
        </div>
        <button class="__vxdq-add" data-id="${deal.id}" ${oos?'disabled':''} style="min-height:38px;padding:0 16px;font-size:12px;font-weight:800;border-radius:8px;cursor:${oos?'not-allowed':'pointer'};border:${isLight?'1.5px solid #059669':'none'};background:${oos?(isLight?'#f1f5f9':'rgba(100,116,139,.15)'):(isLight?'#ecfdf5':'rgba(16,185,129,.18)')};color:${oos?(isLight?'#94a3b8':'#64748b'):(isLight?'#065f46':'#10b981')};flex-shrink:0;transition:all 0.15s ease;">
          ${oos ? 'Out of Stock' : '+ Add'}
        </button>
      `;
      list.appendChild(card);
    });

    list.querySelectorAll('.__vxdq-add:not([disabled])').forEach(btn => {
      btn.addEventListener('click', async () => {
        try { if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur(); } catch(_) {}
        const d = getById(btn.dataset.id);
        if (!d) return;
        
        // Remove quick-add overlay immediately so customization modal is front and center
        ov.remove();

        let note = '';
        if (d.customizable) {
          if (typeof window.showModal === 'function') {
            const result = await window.showModal({
              title: `Customize ${d.name}`,
              message: `Specify any special requests or options for "${d.name}":`,
              type: 'info',
              actions: [
                { id: 'ok', label: 'Add to Cart', style: 'primary' },
                { id: 'skip', label: 'Add Standard Bundle', style: 'secondary' }
              ],
              input: { placeholder: 'e.g. Extra spicy, No onions, Size L...', defaultValue: '' }
            });
            if (result === 'cancel' || result === false) return;
            note = (typeof result === 'string' && result !== 'ok' && result !== 'skip') ? result.trim() : '';
          } else {
            note = prompt(`Any customizations for "${d.name}"?`) || '';
          }
        }
        const res = addToCart(d.id, { note });
        if (!res.ok && window.showNotificationToast) window.showNotificationToast(res.error, 'error', 3000);
      });
    });

    ov.querySelector('#__vxdq-close').addEventListener('click', () => {
      try { if (typeof window.playAudioSignal === 'function') window.playAudioSignal('click'); } catch(_) {}
      ov.remove();
    });
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
  }

  // ── Inject view into DOM ────────────────────────────────────────────────────
  function injectView() {
    if (document.getElementById('view-deals')) return;
    const L = lbl();
    const sec = document.createElement('section');
    sec.className = 'content-view';
    sec.id = 'view-deals';
    sec.innerHTML = `<div class="view-header">
        <h2>${L.i} ${L.p}</h2>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="text" id="deals-search" placeholder="Search ${L.p.toLowerCase()}..." style="padding:8px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:var(--text-white);border-radius:8px;font-size:13px;width:200px;">
          <button class="action-btn action-success" id="btn-deals-create">+ Create ${L.s}</button>
        </div>
      </div>
      <p style="font-size:12px;color:var(--text-gray);margin-bottom:16px;max-width:720px;">
        Create ${L.p.toLowerCase()} to bundle products with a single price. When a ${L.s.toLowerCase()} is sold, all constituent items are deducted from inventory simultaneously.
        Customizable ${L.p.toLowerCase()} allow customer modifications; fixed ones do not.
      </p>
      <div id="deals-list-container"></div>`;
    const pane = document.querySelector('.pos-content-pane');
    if (pane) pane.appendChild(sec);

    sec.querySelector('#deals-search')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      sec.querySelectorAll('.deal-card').forEach(c => {
        const name = c.querySelector('[style*="font-weight:700"]')?.textContent?.toLowerCase()||'';
        c.style.display = (!q || name.includes(q)) ? '' : 'none';
      });
    });
  }

  // ── Inject nav item ────────────────────────────────────────────────────────
  function injectNav() {
    if (document.getElementById('nav-deals')) return;
    const L = lbl();
    const nav = document.getElementById('main-navbar');
    if (!nav) return;
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.id = 'nav-deals';
    btn.setAttribute('data-screen', 'deals');
    btn.innerHTML = `<span class="nav-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="nav-svg"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></span><span class="nav-label">${L.p}</span>`;
    btn.addEventListener('click', () => { if (window.switchActiveScreen) window.switchActiveScreen('deals'); });
    const after = document.getElementById('nav-catalog-manager');
    if (after && after.nextSibling) nav.insertBefore(btn, after.nextSibling);
    else nav.appendChild(btn);
  }

  // ── Inject quick-add button in checkout cart ───────────────────────────────
  function injectCheckoutBtn() {
    if (document.getElementById('btn-deals-quick-add')) return;
    const voidBtn = document.getElementById('btn-void-order');
    if (!voidBtn) { setTimeout(injectCheckoutBtn, 800); return; }
    const btn = document.createElement('button');
    btn.id = 'btn-deals-quick-add';
    btn.className = 'action-btn';
    btn.style.cssText = 'min-height:36px;padding:0 12px;font-size:12px;font-weight:700;';
    btn.textContent = lbl().i + ' ' + lbl().p;
    btn.addEventListener('click', openQuickAdd);
    voidBtn.parentElement?.insertBefore(btn, voidBtn.nextSibling);
  }

  // ── Handle DEALS_DATA from sync worker (cross-terminal updates) ───────────
  function handleWorkerMsg(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'DEALS_DATA') {
      if (Array.isArray(msg.deals)) {
        _deals = msg.deals;
        saveLocal(); // keep localStorage in sync
        if (_renderCb) _renderCb();
      }
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  const VXDeals = {
    init(mode, onRender) {
      _mode = mode || 'simple-retail';
      _renderCb = onRender || null;
      loadLocal();
      // Request latest from IndexedDB (catches deals created on other terminals)
      if (window.syncWorker) {
        window.syncWorker.postMessage({ type: 'GET_DEALS', payload: {} });
      }
      injectView();
      injectNav();
      setTimeout(injectCheckoutBtn, 1000);
      console.log('[VXDeals] Initialized. Mode:', _mode, '| Deals:', _deals.length);
    },
    renderView,
    openEdit,
    openEditModal: openEdit,
    openQuickAdd,
    addToCart,
    getAll,
    getById,
    upsert,
    softDelete,
    delete: softDelete,
    handleWorkerMsg,
    setMode(m) { _mode = m||'simple-retail'; }
  };

  window.VXDeals = VXDeals;
  window.ValenixiaDeals = VXDeals;
  window.renderDealsScreen = renderView;

  // Wire: intercept syncWorker messages for DEALS_DATA
  const _origSW = window.syncWorker;
  if (_origSW) {
    const orig = _origSW.onmessage;
    _origSW.onmessage = (e) => {
      if (e.data && e.data.type === 'DEALS_DATA') handleWorkerMsg(e.data);
      if (orig) orig.call(_origSW, e);
    };
  }

  // Auto-boot after app initialises
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      const modeMap = {
        'food-restaurant':'food-restaurant','bakery-cafe':'bakery-cafe',
        'simple-retail':'simple-retail','grocery-mart':'grocery-mart',
        'pharmacy-medical':'pharmacy-medical','services-appointments':'services-appointments'
      };
      const raw = (window.state&&window.state.preferences&&window.state.preferences.shop_mode)||'simple-retail';
      VXDeals.init(modeMap[raw]||'simple-retail', () => {
        if (window.state&&window.state.activeScreen==='deals') renderView();
      });
    }, 1400);
  });

})();
