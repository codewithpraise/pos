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
  function renderView() {
    const el = document.getElementById('deals-list-container');
    if (!el) return;
    const deals = getAll();
    const L = lbl();

    if (!deals.length) {
      el.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--text-gray);">
        <div style="font-size:48px;margin-bottom:16px;">${L.i}</div>
        <p style="font-size:15px;font-weight:600;color:var(--text-white);margin-bottom:8px;">No ${L.p} Yet</p>
        <p style="font-size:13px;margin-bottom:24px;">Create your first ${L.s.toLowerCase()} to bundle products with special pricing.</p>
        <button class="action-btn action-success" id="btn-deals-create-empty" style="min-height:44px;padding:0 24px;">+ Create ${L.s}</button>
      </div>`;
      document.getElementById('btn-deals-create-empty')?.addEventListener('click', () => openEdit(null));
      return;
    }

    el.innerHTML = '';
    deals.forEach(deal => {
      const cnt = (deal.items||[]).length;
      const customBadge = deal.customizable
        ? `<span style="background:rgba(16,185,129,.15);color:#10b981;border:1px solid rgba(16,185,129,.3);font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;">CUSTOMIZABLE</span>`
        : `<span style="background:rgba(100,116,139,.15);color:#94a3b8;border:1px solid rgba(100,116,139,.2);font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;">FIXED</span>`;
      const disabledBadge = !deal.is_active
        ? `<span style="background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3);font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;">DISABLED</span>` : '';
      const card = document.createElement('div');
      card.className = 'deal-card';
      card.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:1px solid rgba(255,255,255,0.08);border-radius:12px;margin-bottom:12px;background:linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(20,20,30,0.6) 100%);box-shadow:0 4px 16px rgba(0,0,0,0.25);transition:all .15s ease;';
      card.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
            <div style="font-size:24px;flex-shrink:0;width:38px;height:38px;border-radius:8px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;">${deal.icon||L.i}</div>
            <div style="min-width:0;flex:1;">
              <div style="font-weight:800;color:var(--text-white);font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${deal.name}</div>
              <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
                ${customBadge}${disabledBadge}
              </div>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:15px;font-weight:900;color:var(--accent-emerald);font-family:var(--font-display);">${fmt(deal.price_cents)}</div>
            ${deal.original_price_cents&&deal.original_price_cents>deal.price_cents?`<div style="font-size:11px;color:var(--text-gray);text-decoration:line-through;">${fmt(deal.original_price_cents)}</div>`:''}
          </div>
        </div>
        <div style="font-size:12px;color:var(--text-gray);line-height:1.4;border-top:1px solid rgba(255,255,255,0.05);padding-top:8px;">
          <strong style="color:var(--text-white);">${cnt} item${cnt!==1?'s':''} bundled:</strong> ${deal.description||'Fixed price combination bundle'}
        </div>
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-top:4px;">
          <button class="action-btn _deal-edit" data-id="${deal.id}" style="min-height:30px;padding:4px 14px;font-size:11px;font-weight:800;border-radius:6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:#fff;">Edit Deal</button>
          <button class="action-btn action-danger _deal-del" data-id="${deal.id}" style="min-height:30px;padding:4px 10px;font-size:11px;font-weight:800;border-radius:6px;background:rgba(239,68,68,0.18);border:1px solid rgba(239,68,68,0.5);color:#ef4444;display:inline-flex;align-items:center;justify-content:center;gap:4px;">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#ef4444" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
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
    let dealIcon  = deal ? (deal.icon||L.i) : L.i;

    const ov = document.createElement('div');
    ov.id = '__vxdm';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483640;background:rgba(5,5,8,.94);display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto;backdrop-filter:blur(6px);';

    ov.innerHTML = `<div style="max-width:540px;width:100%;background:#0d0d12;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:28px;box-shadow:0 32px 64px rgba(0,0,0,.8);margin:auto;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
        <h2 style="font-size:18px;font-weight:800;color:#fff;margin:0;">${isNew?'Create':'Edit'} ${L.s}</h2>
        <button id="__vxdm-close" style="background:transparent;border:1px solid rgba(255,255,255,.1);color:#94a3b8;width:32px;height:32px;border-radius:6px;cursor:pointer;font-size:16px;"></button>
      </div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:12px;margin-bottom:16px;align-items:center;">
        <button id="__vxdm-icon" style="width:52px;height:52px;font-size:26px;background:rgba(255,255,255,.04);border:1px solid var(--border-titanium);border-radius:8px;cursor:pointer;">${dealIcon}</button>
        <div>
          <label style="display:block;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">${L.s} Name *</label>
          <input id="__vxdm-name" type="text" maxlength="80" placeholder="e.g. Breakfast Special..." value="${deal?deal.name:''}" style="width:100%;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:8px;font-size:14px;box-sizing:border-box;">
        </div>
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Description (optional)</label>
        <input id="__vxdm-desc" type="text" maxlength="120" placeholder="Short description..." value="${deal?deal.description||'':''}" style="width:100%;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:8px;font-size:14px;box-sizing:border-box;">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div>
          <label style="display:block;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">${L.s} Price (Rs.) *</label>
          <input id="__vxdm-price" type="number" min="1" step="1" required placeholder="Required" value="${deal?(deal.price_cents/100).toFixed(0):''}" style="width:100%;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:8px;font-size:14px;box-sizing:border-box;">
        </div>
        <div>
          <label style="display:block;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Original Price (Rs.) — Strikethrough</label>
          <input id="__vxdm-orig" type="number" min="0" step="1" placeholder="Optional" value="${deal&&deal.original_price_cents?(deal.original_price_cents/100).toFixed(0):''}" style="width:100%;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:#fff;border-radius:8px;font-size:14px;box-sizing:border-box;">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
        <label style="display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);padding:12px;border-radius:8px;cursor:pointer;">
          <input type="checkbox" id="__vxdm-cust" ${!deal||deal.customizable?'checked':''} style="width:18px;height:18px;accent-color:#10b981;">
          <div><div style="font-size:13px;font-weight:600;color:#fff;">Customizable</div><div style="font-size:11px;color:#64748b;">Customers can modify</div></div>
        </label>
        <label style="display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);padding:12px;border-radius:8px;cursor:pointer;">
          <input type="checkbox" id="__vxdm-active" ${!deal||deal.is_active!==false?'checked':''} style="width:18px;height:18px;accent-color:#10b981;">
          <div><div style="font-size:13px;font-weight:600;color:#fff;">Active</div><div style="font-size:11px;color:#64748b;">Show in checkout</div></div>
        </label>
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Bundled Items * <span style="text-transform:none;color:#475569;">(all deducted from stock simultaneously when sold)</span></label>
        <div id="__vxdm-items"></div>
        <div style="display:flex;gap:8px;margin-top:6px;">
          <select id="__vxdm-sel" style="flex:1;padding:10px 12px;background:#14141d;border:1px solid rgba(255,255,255,.18);color:#ffffff;border-radius:8px;font-size:13.5px;font-weight:600;outline:none;">
            <option value="" style="background:#14141d;color:#94a3b8;">— Select product to add —</option>
            ${cat.map(p=>`<option value="${p.id||p.sku}" data-price="${p.price_cents||p.base_price_minor_units||0}" style="background:#14141d;color:#ffffff;padding:8px;">${p.name} (${fmt(p.price_cents||p.base_price_minor_units||0)})</option>`).join('')}
          </select>
          <button id="__vxdm-add-item" style="padding:8px 16px;background:rgba(16,185,129,.15);border:1px solid rgba(16,185,129,.4);color:#10b981;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">+ Add</button>
        </div>
      </div>
      <div style="display:flex;gap:10px;">
        <button id="__vxdm-save" style="flex:1;height:48px;background:linear-gradient(135deg,#00d68f,#10b981);border:none;color:#060d0d;font-size:14px;font-weight:800;border-radius:10px;cursor:pointer;font-family:inherit;">${isNew?'Create '+L.s:'Save Changes'}</button>
        ${!isNew ? `<button id="__vxdm-delete" style="height:48px;padding:0 16px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.5);color:#ef4444;border-radius:10px;cursor:pointer;font-size:13.5px;font-weight:800;font-family:inherit;display:inline-flex;align-items:center;gap:4px;">🗑 Delete</button>` : ''}
        <button id="__vxdm-cancel" style="height:48px;padding:0 20px;background:transparent;border:1px solid rgba(255,255,255,.1);color:#64748b;border-radius:10px;cursor:pointer;font-size:14px;font-family:inherit;">Cancel</button>
      </div>
    </div>`;
    document.body.appendChild(ov);

    // Render selected items list
    const redrawItems = () => {
      const el = ov.querySelector('#__vxdm-items');
      if (!el) return;
      if (!selItems.length) { el.innerHTML = '<p style="color:var(--text-gray);font-size:12px;text-align:center;padding:10px 0;">No items yet.</p>'; return; }
      el.innerHTML = selItems.map((item,i) => `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--border-titanium);border-radius:8px;margin-bottom:6px;background:rgba(255,255,255,.02);">
        <span style="flex:1;font-size:13px;font-weight:700;color:var(--text-white);">${item.name}</span>
        <span style="font-size:11px;color:var(--text-gray);font-weight:600;">Qty:</span>
        <input type="number" min="1" value="${item.qty}" data-i="${i}" class="__vxdm-qty" style="width:52px;padding:4px 6px;background:var(--panel-graphite);border:1px solid var(--border-titanium);color:var(--text-white);border-radius:4px;font-size:13px;text-align:center;font-weight:700;">
        <button data-i="${i}" class="__vxdm-rm action-danger" title="Remove item" style="background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.6);color:#ef4444;padding:4px 9px;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:3px;min-height:26px;">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#ef4444" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>Del</span>
        </button>
      </div>`).join('');
      el.querySelectorAll('.__vxdm-qty').forEach(inp => inp.addEventListener('change', () => { selItems[+inp.dataset.i].qty = Math.max(1, parseInt(inp.value)||1); }));
      el.querySelectorAll('.__vxdm-rm').forEach(btn => btn.addEventListener('click', () => { selItems.splice(+btn.dataset.i, 1); redrawItems(); }));
    };
    redrawItems();

    // Icon picker
    const ICONS = ['','','','','','','','','','','','','','','','','','','','','','',''];
    ov.querySelector('#__vxdm-icon').addEventListener('click', () => {
      const p = document.createElement('div');
      p.style.cssText = 'position:absolute;background:#0d0d12;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:8px;display:flex;flex-wrap:wrap;gap:4px;z-index:2147483641;max-width:220px;box-shadow:0 8px 32px rgba(0,0,0,.8);';
      ICONS.forEach(ic => { const b=document.createElement('button'); b.textContent=ic; b.style.cssText='width:32px;height:32px;font-size:18px;background:transparent;border:none;cursor:pointer;border-radius:4px;'; b.addEventListener('click',()=>{ dealIcon=ic; ov.querySelector('#__vxdm-icon').textContent=ic; p.remove(); }); p.appendChild(b); });
      ov.querySelector('#__vxdm-icon').insertAdjacentElement('afterend', p);
      setTimeout(() => document.addEventListener('click', () => p.remove(), { once:true }), 100);
    });

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

      upsert({ id: deal?deal.id:genId(), name, description:desc, icon:dealIcon, price_cents:Math.round(price*100), original_price_cents:orig>0?Math.round(orig*100):null, customizable, is_active, items:selItems, business_mode:_mode });
      ov.remove();
      if (window.showNotificationToast) window.showNotificationToast(name + (isNew ? ' created!' : ' updated!'), 'success', 2500);
    });
  }

  function openQuickAdd() {
    try { if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur(); } catch(_) {}
    document.getElementById('__vxdq')?.remove();
    const deals = getAll().filter(d => d.is_active !== false);
    const L = lbl();
    if (!deals.length) {
      if (window.showNotificationToast) window.showNotificationToast(`No active ${L.p.toLowerCase()}. Create one in the ${L.p} screen.`, 'info', 3000);
      return;
    }
    const ov = document.createElement('div');
    ov.id = '__vxdq';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483635;background:rgba(5,5,8,.88);display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(4px);';
    ov.innerHTML = `<div style="max-width:600px;width:100%;background:#0d0d12;border-radius:16px 16px 0 0;border:1px solid rgba(255,255,255,.08);max-height:70vh;display:flex;flex-direction:column;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,.07);">
        <span style="font-size:15px;font-weight:800;color:#fff;">${L.i} Select ${L.s}</span>
        <button id="__vxdq-close" style="background:transparent;border:1px solid rgba(255,255,255,.1);color:#94a3b8;width:30px;height:30px;border-radius:6px;cursor:pointer;"></button>
      </div>
      <div style="overflow-y:auto;padding:12px 16px;flex:1;" id="__vxdq-list"></div>
    </div>`;
    const list = ov.querySelector('#__vxdq-list');
    deals.forEach(deal => {
      const short = stockShortages(deal, 1);
      const oos = short.length > 0;
      const card = document.createElement('div');
      card.style.cssText = `display:flex;align-items:center;gap:12px;padding:12px;border:1px solid ${oos?'rgba(239,68,68,.2)':'rgba(255,255,255,.07)'};border-radius:10px;margin-bottom:8px;background:rgba(255,255,255,.02);`;
      card.innerHTML = `<span style="font-size:28px;">${deal.icon||L.i}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;color:${oos?'#94a3b8':'#fff'};font-size:14px;">${deal.name}</div>
          <div style="font-size:11px;color:#64748b;">${(deal.items||[]).length} items · ${deal.customizable?'Customizable':'Fixed'}</div>
          ${oos?'<div style="font-size:11px;color:#ef4444;margin-top:2px;">Out of stock</div>':''}
        </div>
        <div style="text-align:right;">
          <div style="font-size:16px;font-weight:800;color:${oos?'#64748b':'#10b981'};">${fmt(deal.price_cents)}</div>
          ${deal.original_price_cents?`<div style="font-size:11px;color:#64748b;text-decoration:line-through;">${fmt(deal.original_price_cents)}</div>`:''}
        </div>
        <button class="__vxdq-add" data-id="${deal.id}" ${oos?'disabled':''} style="min-height:40px;padding:0 16px;font-size:13px;font-weight:700;border-radius:8px;cursor:${oos?'not-allowed':'pointer'};border:none;background:${oos?'rgba(100,116,139,.15)':'rgba(16,185,129,.15)'};color:${oos?'#64748b':'#10b981'};">
          ${oos?'N/A':'+ Add'}
        </button>`;
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
    ov.querySelector('#__vxdq-close').addEventListener('click', () => ov.remove());
    ov.addEventListener('click', e => { if (e.target===ov) ov.remove(); });
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
