// ============================================================================
// VALENIXIA COMMAND PALETTE — Ctrl+K global quick navigation
// Keyboard-first power user interface: navigate screens, search products,
// trigger actions, all without touching the mouse.
// ============================================================================
"use strict";
(function() {

  let _paletteOpen = false;
  let _selectedIdx = 0;
  let _filteredCommands = [];

  // ── Command Registry ─────────────────────────────────────────────────────────
  // Commands are built at open time so they reflect current state (catalog, etc.)
  function buildCommands() {
    const cmds = [
      // Navigation
      { id: "nav-checkout",    icon: "🛒", label: "Go to Checkout",       action: () => switchActiveScreen("checkout"),        tags: ["pos", "sale", "cart"] },
      { id: "nav-inventory",   icon: "📦", label: "Go to Inventory",       action: () => switchActiveScreen("inventory"),       tags: ["stock", "products", "catalog"] },
      { id: "nav-analytics",   icon: "📊", label: "Go to Analytics",       action: () => switchActiveScreen("analytics"),      tags: ["reports", "sales", "stats"] },
      { id: "nav-customers",   icon: "👥", label: "Go to Customers",       action: () => switchActiveScreen("customers"),       tags: ["udhaar", "credit", "khata"] },
      { id: "nav-staff",       icon: "🏷️", label: "Go to Staff",           action: () => switchActiveScreen("staff"),          tags: ["employees", "cashiers", "managers"] },
      { id: "nav-settings",    icon: "⚙️", label: "Go to Settings",        action: () => switchActiveScreen("settings"),       tags: ["preferences", "config"] },
      { id: "nav-logs",        icon: "📋", label: "Go to Logs",            action: () => switchActiveScreen("logs"),           tags: ["audit", "errors", "history"] },
      { id: "nav-distributors",icon: "🚚", label: "Go to Distributors",    action: () => switchActiveScreen("distributors"),   tags: ["suppliers", "purchase"] },
      { id: "nav-credit",      icon: "💳", label: "Go to Credit Book",     action: () => switchActiveScreen("credit-book"),    tags: ["udhaar", "ledger", "khata"] },
      // Actions
      { id: "act-clear-cart",  icon: "🗑️", label: "Clear Cart",            action: () => { if(window.clearCart) clearCart(); else switchActiveScreen("checkout"); },  tags: ["void", "reset"] },
      { id: "act-toggle-theme",icon: "🌙", label: "Toggle Dark/Light",     action: () => { const b = document.body; b.classList.toggle("light-mode"); },              tags: ["theme", "mode"] },
      { id: "act-export-errors",icon:"📤", label: "Export Error Logs CSV", action: () => { if(window.exportErrorLogsToCSV) exportErrorLogsToCSV(); },                  tags: ["debug", "errors", "csv"] },
      { id: "act-upgrade",     icon: "⚡", label: "View Pricing Plans",    action: () => { if(window.showUpgradeModal) showUpgradeModal(); },                          tags: ["plans", "upgrade", "pricing", "pkr"] },
      { id: "act-fullscreen",  icon: "⛶",  label: "Toggle Fullscreen",     action: () => { if(!document.fullscreenElement) document.documentElement.requestFullscreen(); else document.exitFullscreen(); }, tags: ["display", "kiosk"] },
    ];

    // Inject product quick-add if catalog is loaded
    if (window.__valenixiaState?.catalog?.length) {
      const catalog = window.__valenixiaState.catalog.slice(0, 200); // cap at 200 for perf
      catalog.forEach(p => {
        cmds.push({
          id: "prod-" + p.sku,
          icon: p.emoji || "📦",
          label: (p.displayName || p.name || p.sku) + " — Rs. " + ((p.price || 0)/100).toLocaleString("en-PK"),
          sub: "SKU: " + p.sku + (p.stock !== undefined ? " · Stock: " + p.stock : ""),
          action: () => {
            if (window.addItemToCart) addItemToCart(p);
            else if (window.switchActiveScreen) switchActiveScreen("checkout");
          },
          tags: [p.sku, p.name, p.category || "", p.gtin || ""]
        });
      });
    }
    return cmds;
  }

  // ── Fuzzy match ───────────────────────────────────────────────────────────────
  function score(cmd, query) {
    if (!query) return 1;
    const q = query.toLowerCase();
    const label = (cmd.label || "").toLowerCase();
    const tags = (cmd.tags || []).join(" ").toLowerCase();
    if (label.startsWith(q)) return 3;
    if (label.includes(q)) return 2;
    if (tags.includes(q)) return 1;
    return 0;
  }

  function filter(commands, query) {
    return commands
      .map(c => ({ cmd: c, s: score(c, query) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map(x => x.cmd);
  }

  // ── Render palette ────────────────────────────────────────────────────────────
  function render(query) {
    const allCmds = buildCommands();
    _filteredCommands = filter(allCmds, query);
    _selectedIdx = 0;
    const list = document.getElementById("__vx-palette-list");
    if (!list) return;
    if (_filteredCommands.length === 0) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:#4b5563;font-size:13px;">No results for "' + query + '"</div>';
      return;
    }
    list.innerHTML = _filteredCommands.map((cmd, i) => {
      const sel = i === _selectedIdx;
      return '<div class="__vx-palette-item' + (sel ? " __vx-palette-selected" : "") + '" data-idx="' + i + '" style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:8px;cursor:pointer;background:' + (sel ? "rgba(16,185,129,0.12)" : "transparent") + ';border:1px solid ' + (sel ? "rgba(16,185,129,0.25)" : "transparent") + ';">'
        + '<span style="font-size:20px;width:28px;text-align:center;">' + (cmd.icon || "▶") + '</span>'
        + '<div style="flex:1;min-width:0;">'
        + '<div style="font-size:13px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + cmd.label + '</div>'
        + (cmd.sub ? '<div style="font-size:11px;color:#64748b;margin-top:1px;">' + cmd.sub + '</div>' : '')
        + '</div>'
        + '<span style="font-size:10px;color:#374151;font-weight:600;">↵</span>'
        + '</div>';
    }).join("");

    list.querySelectorAll(".__vx-palette-item").forEach(el => {
      el.addEventListener("click", function() { execute(parseInt(this.dataset.idx)); });
      el.addEventListener("mouseover", function() {
        _selectedIdx = parseInt(this.dataset.idx);
        updateSelection();
      });
    });
  }

  function updateSelection() {
    document.querySelectorAll(".__vx-palette-item").forEach((el, i) => {
      const sel = i === _selectedIdx;
      el.style.background = sel ? "rgba(16,185,129,0.12)" : "transparent";
      el.style.border = "1px solid " + (sel ? "rgba(16,185,129,0.25)" : "transparent");
    });
  }

  function execute(idx) {
    const cmd = _filteredCommands[idx !== undefined ? idx : _selectedIdx];
    if (!cmd) return;
    close();
    try { cmd.action(); } catch(e) { console.warn("[Palette] Action error:", e); }
  }

  // ── Open/close ────────────────────────────────────────────────────────────────
  function open() {
    if (_paletteOpen) return;
    _paletteOpen = true;
    const overlay = document.createElement("div");
    overlay.id = "__vx-palette-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:rgba(3,4,8,0.85);display:flex;align-items:flex-start;justify-content:center;padding-top:80px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);";
    overlay.innerHTML = '<div style="width:100%;max-width:560px;background:#0d0d12;border:1px solid rgba(255,255,255,0.1);border-radius:14px;overflow:hidden;box-shadow:0 32px 80px rgba(0,0,0,0.9);">'
      + '<div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.06);">'
      + '<span style="font-size:16px;color:#4b5563;">⌕</span>'
      + '<input id="__vx-palette-input" type="text" placeholder="Search screens, products, actions..." autocomplete="off" spellcheck="false" style="flex:1;background:transparent;border:none;outline:none;font-size:15px;color:#e2e8f0;font-family:inherit;caret-color:#10b981;">'
      + '<kbd style="font-size:10px;color:#4b5563;border:1px solid #1f2937;border-radius:4px;padding:2px 6px;background:#111;">ESC</kbd>'
      + '</div>'
      + '<div id="__vx-palette-list" style="max-height:380px;overflow-y:auto;padding:6px;"></div>'
      + '<div style="padding:8px 16px;border-top:1px solid rgba(255,255,255,0.04);display:flex;gap:16px;">'
      + '<span style="font-size:10px;color:#374151;"><kbd style="border:1px solid #1f2937;border-radius:3px;padding:1px 5px;background:#0d0d12;color:#6b7280;">↑↓</kbd> navigate</span>'
      + '<span style="font-size:10px;color:#374151;"><kbd style="border:1px solid #1f2937;border-radius:3px;padding:1px 5px;background:#0d0d12;color:#6b7280;">↵</kbd> select</span>'
      + '<span style="font-size:10px;color:#374151;"><kbd style="border:1px solid #1f2937;border-radius:3px;padding:1px 5px;background:#0d0d12;color:#6b7280;">Ctrl+K</kbd> close</span>'
      + '</div>'
      + '</div>';

    document.body.appendChild(overlay);
    render("");
    const input = document.getElementById("__vx-palette-input");
    if (input) {
      input.focus();
      input.addEventListener("input", function() { render(this.value.trim()); });
      input.addEventListener("keydown", function(e) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          _selectedIdx = Math.min(_selectedIdx + 1, _filteredCommands.length - 1);
          updateSelection();
          const items = document.querySelectorAll(".__vx-palette-item");
          if (items[_selectedIdx]) items[_selectedIdx].scrollIntoView({ block: "nearest" });
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          _selectedIdx = Math.max(_selectedIdx - 1, 0);
          updateSelection();
          const items = document.querySelectorAll(".__vx-palette-item");
          if (items[_selectedIdx]) items[_selectedIdx].scrollIntoView({ block: "nearest" });
        } else if (e.key === "Enter") {
          e.preventDefault();
          execute();
        } else if (e.key === "Escape") {
          close();
        }
      });
    }
    overlay.addEventListener("click", function(e) { if (e.target === overlay) close(); });
  }

  function close() {
    _paletteOpen = false;
    document.getElementById("__vx-palette-overlay")?.remove();
  }

  // ── Global Ctrl+K binding ─────────────────────────────────────────────────────
  document.addEventListener("keydown", function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      if (_paletteOpen) close(); else open();
    }
  });

  window.CommandPalette = { open, close, toggle: () => _paletteOpen ? close() : open() };

})();
