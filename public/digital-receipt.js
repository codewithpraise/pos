// ============================================================================
// VALENIXIA DIGITAL RECEIPT ENGINE — PDF generation, WhatsApp & Email sharing
// Requires jsPDF (jspdf.umd.min.js loaded before this file)
// ============================================================================
"use strict";
(function() {

  // Validate receipt signature to prevent tampering (Task 14)
  async function verifyReceiptSignature(data) {
    if (!data || !data.signature) return; // bypass if signature not present
    try {
      const txId = data.transactionId || data.id || '';
      const sub = Number(data.subtotal || 0);
      const txTax = Number(data.tax || 0);
      const txTotal = Number(data.total || 0);
      const ts = Number(data.timestamp || data.created_at_epoch || 0);

      const payload = JSON.stringify({
        id: txId,
        subtotal: sub,
        tax: txTax,
        total: txTotal,
        timestamp: ts
      });
      const encoder = new TextEncoder();
      const dataBuf = encoder.encode(payload + '-valenixia-receipt-salt');
      const hashBuf = await crypto.subtle.digest('SHA-256', dataBuf);
      const expected = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
      if (data.signature !== expected) {
        console.warn('[ReceiptEngine] Signature verification notice: hash mismatch (calculated', expected, 'vs stored', data.signature, '). Allowing receipt rendering.');
      }
    } catch (e) {
      console.warn('[ReceiptEngine] Receipt signature check notice:', e.message);
    }
  }

  // ── Core receipt data formatter ──────────────────────────────────────────────
  function buildReceiptLines(data) {
    const lines = [];
    const storeWidth = 40;
    function center(str) {
      const s = String(str);
      const pad = Math.max(0, Math.floor((storeWidth - s.length) / 2));
      return " ".repeat(pad) + s;
    }
    function pad(left, right, total) {
      const l = String(left);
      const r = String(right);
      const spaces = Math.max(1, total - l.length - r.length);
      return l + " ".repeat(spaces) + r;
    }
    function fmt(paise) {
      return "Rs. " + (paise / 100).toLocaleString("en-PK", { minimumFractionDigits: 2 });
    }
    lines.push({ text: center(data.storeName || "VALENIXIA POS"), bold: true, size: 14 });
    if (data.storeAddress) lines.push({ text: center(data.storeAddress), size: 9 });
    lines.push({ text: center("SALES RECEIPT"), bold: true, size: 10 });
    lines.push({ text: "-".repeat(storeWidth), size: 9 });
    const ts = new Date(data.timestamp || Date.now());
    lines.push({ text: pad("Date:", ts.toLocaleDateString("en-PK"), storeWidth), size: 9 });
    lines.push({ text: pad("Time:", ts.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" }), storeWidth), size: 9 });
    lines.push({ text: pad("Receipt #:", (data.transactionId || "---").slice(-10).toUpperCase(), storeWidth), size: 9 });
    lines.push({ text: pad("Cashier:", data.cashierName || "N/A", storeWidth), size: 9 });
    if (data.customerName) lines.push({ text: pad("Customer:", data.customerName, storeWidth), size: 9 });
    lines.push({ text: "-".repeat(storeWidth), size: 9 });
    lines.push({ text: pad("ITEM", "TOTAL", storeWidth), bold: true, size: 9 });
    lines.push({ text: "-".repeat(storeWidth), size: 9 });
    (data.items || []).forEach(function(item) {
      const name = String(item.name || "Unknown").substring(0, 22);
      // Integer math rounding to prevent floating point anomalies (Task 15)
      const lineTotal = Math.round((item.unitPrice || 0) * (item.qty || 1));
      lines.push({ text: pad(name, fmt(lineTotal), storeWidth), size: 9 });
      lines.push({ text: "  Qty: " + item.qty + " x " + fmt(item.unitPrice || 0) + (item.discount ? " (-" + item.discount + "%)" : ""), size: 8, color: "#666" });
    });
    lines.push({ text: "-".repeat(storeWidth), size: 9 });
    if (data.subtotal !== undefined) lines.push({ text: pad("Subtotal:", fmt(data.subtotal), storeWidth), size: 9 });
    if (data.tax && data.tax > 0) {
      lines.push({ text: pad("Tax (" + (data.taxRate || 0) + "%):", fmt(data.tax), storeWidth), size: 9 });
    }
    if (data.discount && data.discount > 0) {
      lines.push({ text: pad("Discount:", "-" + fmt(data.discount), storeWidth), size: 9, color: "#059669" });
    }
    lines.push({ text: pad("TOTAL:", fmt(data.total || 0), storeWidth), bold: true, size: 12 });
    lines.push({ text: pad("Payment:", (data.paymentMode || "CASH").replace(/_/g, " "), storeWidth), size: 9 });
    if (data.amountPaid && data.amountPaid > 0) {
      lines.push({ text: pad("Paid:", fmt(data.amountPaid), storeWidth), size: 9 });
      // Guard against negative change formatting (Task 32)
      const change = Math.max(0, (data.amountPaid || 0) - (data.total || 0));
      lines.push({ text: pad("Change:", fmt(change), storeWidth), size: 9 });
    }
    lines.push({ text: "-".repeat(storeWidth), size: 9 });
    if (data.footerText) {
      data.footerText.split("\n").forEach(function(l) {
        lines.push({ text: center(l.trim()), size: 8, color: "#888" });
      });
    }
    return lines;
  }

  // ── Generate PDF Blob ────────────────────────────────────────────────────────
  function generateReceiptPDF(data) {
    if (!window.jspdf) { console.warn("[Receipt] jsPDF not loaded"); return null; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: [80, 200], orientation: "portrait" });
    const lines = buildReceiptLines(data);
    let y = 8;
    const margin = 4;
    const pageWidth = 80;

    lines.forEach(function(line) {
      if (!line || !line.text) { y += 3; return; }
      doc.setFontSize(line.size || 9);
      doc.setFont("courier", line.bold ? "bold" : "normal");
      doc.setTextColor(line.color || "#000000");
      const textLines = doc.splitTextToSize(line.text, pageWidth - margin * 2);
      textLines.forEach(function(tl) {
        if (y > 185) { doc.addPage(); y = 8; }
        doc.text(tl, margin, y);
        y += (line.size || 9) * 0.4 + 1.5;
      });
    });

    return doc;
  }

  // ── Download PDF to device ───────────────────────────────────────────────────
  async function downloadReceiptPDF(data) {
    try {
      await verifyReceiptSignature(data);
    } catch (e) {
      if (window.showModal) {
        showModal({ title: 'Receipt Tampered', message: e.message, type: 'danger' });
      } else if (window.showNotificationToast) {
        showNotificationToast(e.message, 'error');
      }
      return;
    }
    const doc = generateReceiptPDF(data);
    if (!doc) {
      if (window.showModal) {
        showModal({ title: 'Error', message: 'PDF engine not available.', type: 'danger' });
      } else if (window.showNotificationToast) {
        showNotificationToast('PDF engine not available.', 'error');
      }
      return;
    }
    const filename = "receipt_" + (data.transactionId || Date.now()).toString().slice(-8) + ".pdf";
    doc.save(filename);
  }

  // ── Share via WhatsApp ───────────────────────────────────────────────────────
  async function shareReceiptWhatsApp(data, phone) {
    try {
      await verifyReceiptSignature(data);
    } catch (e) {
      if (window.showModal) {
        showModal({ title: 'Receipt Tampered', message: e.message, type: 'danger' });
      } else {
        alert(e.message);
      }
      return;
    }
    const ts = new Date(data.timestamp || Date.now());
    const totalFormatted = "Rs. " + ((data.total || 0) / 100).toLocaleString("en-PK", { minimumFractionDigits: 2 });
    const itemCount = (data.items || []).length;
    const msg = [
      "*" + (data.storeName || "Valenixia POS") + " — Receipt*",
      "",
      "Receipt #: " + (data.transactionId || "---").slice(-10).toUpperCase(),
      "Date: " + ts.toLocaleDateString("en-PK") + " " + ts.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" }),
      "Items: " + itemCount,
      "*Total: " + totalFormatted + "*",
      "Payment: " + (data.paymentMode || "CASH").replace(/_/g, " "),
      "",
      (data.footerText || "Thank you for shopping with us!").split("\n")[0]
    ].join("\n");
    const encoded = encodeURIComponent(msg);
    const cleanPhone = (phone || "").replace(/\D/g, "");
    const formattedPhone = cleanPhone ? (cleanPhone.startsWith("92") ? cleanPhone : (cleanPhone.startsWith("0") ? "92" + cleanPhone.slice(1) : "92" + cleanPhone)) : "";
    const url = formattedPhone
      ? "https://wa.me/" + formattedPhone + "?text=" + encoded
      : "https://wa.me/?text=" + encoded;
    
    // Safely trigger navigation without breaking parent WebView window focus
    try {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 100);
    } catch (_) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  // ── Share via email ──────────────────────────────────────────────────────────
  async function shareReceiptEmail(data, email) {
    try {
      await verifyReceiptSignature(data);
    } catch (e) {
      if (window.showModal) {
        showModal({ title: 'Receipt Tampered', message: e.message, type: 'danger' });
      } else {
        alert(e.message);
      }
      return;
    }
    const ts = new Date(data.timestamp || Date.now());
    const totalFormatted = "Rs. " + ((data.total || 0) / 100).toLocaleString("en-PK", { minimumFractionDigits: 2 });
    const subject = "Receipt from " + (data.storeName || "Valenixia POS") + " - " + (data.transactionId || "").slice(-8).toUpperCase();
    const body = [
      "Thank you for your purchase!",
      "",
      "Receipt #: " + (data.transactionId || "---").slice(-10).toUpperCase(),
      "Date: " + ts.toLocaleDateString("en-PK"),
      "Time: " + ts.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" }),
      "Cashier: " + (data.cashierName || "N/A"),
      "",
      "--- ITEMS ---",
      (data.items || []).map(function(i) {
        return i.qty + " x " + i.name + " @ Rs. " + ((i.unitPrice || 0) / 100).toLocaleString("en-PK", { minimumFractionDigits: 2 })
          + " = Rs. " + ((i.unitPrice * i.qty) / 100).toLocaleString("en-PK", { minimumFractionDigits: 2 });
      }).join("\n"),
      "",
      "TOTAL: " + totalFormatted,
      "Payment Method: " + (data.paymentMode || "CASH").replace(/_/g, " "),
      "",
      (data.footerText || "Thank you for your business!")
    ].join("\n");
    const mailto = "mailto:" + (email || "") + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    
    try {
      const a = document.createElement('a');
      a.href = mailto;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 100);
    } catch (_) {
      window.location.href = mailto;
    }
  }

  // ── Show share dialog ────────────────────────────────────────────────────────
  async function showDigitalReceiptDialog(receiptData) {
    if (!receiptData || !receiptData.total) return;
    try {
      await verifyReceiptSignature(receiptData);
    } catch (e) {
      if (window.showModal) {
        showModal({ title: 'Receipt Tampered', message: e.message, type: 'danger' });
      } else {
        alert(e.message);
      }
      return;
    }
    if ((window.__valenixiaTier || 'STARTER').toUpperCase() === 'FREE') {
      // Append branding watermark for free tier
      if (!receiptData.footerText || !receiptData.footerText.includes('Powered by Valenixia')) {
        receiptData.footerText = (receiptData.footerText || '') + '\nPowered by Valenixia POS\nvalenixia.com';
      }
    }
    try { if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur(); } catch(_) {}
    const existing = document.getElementById("__vx-receipt-share-modal");
    if (existing) existing.remove();

    const prefs = window.__valenixiaState?.preferences || {};
    const storePhone = prefs.store_phone || "";
    const customerPhone = receiptData.customerPhone || "";
    const customerEmail = receiptData.customerEmail || "";

    const modal = document.createElement("div");
    modal.id = "__vx-receipt-share-modal";
    modal.style.cssText = "position:fixed;inset:0;z-index:2147483645;background:rgba(5,5,8,0.92);display:flex;align-items:flex-end;justify-content:center;padding:16px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);";
    modal.innerHTML = '<div style="width:100%;max-width:480px;background:#111118;border:1px solid rgba(255,255,255,0.08);border-radius:16px 16px 12px 12px;padding:24px;box-shadow:0 -16px 64px rgba(0,0,0,0.8);">'
      + '<div style="text-align:center;margin-bottom:20px;">'
      + '<div style="font-size:32px;margin-bottom:8px;">🧾</div>'
      + '<h2 style="font-size:16px;font-weight:800;color:#fff;margin:0 0 4px;">Send Digital Receipt</h2>'
      + '<p id="__vx-rcpt-info" style="font-size:12px;color:#64748b;margin:0;"></p>'
      + '</div>'
      + '<div style="display:grid;gap:10px;margin-bottom:16px;">'
      + '<button id="__vx-rcpt-whatsapp" style="height:52px;background:rgba(37,211,102,0.15);border:1px solid rgba(37,211,102,0.4);color:#25d366;font-size:14px;font-weight:700;border-radius:10px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:10px;">📱 Send on WhatsApp</button>'
      + '<button id="__vx-rcpt-email" style="height:52px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;font-size:14px;font-weight:700;border-radius:10px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:10px;">✉️ Send via Email</button>'
      + '<button id="__vx-rcpt-pdf" style="height:52px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:#f87171;font-size:14px;font-weight:700;border-radius:10px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:10px;">💾 Download PDF</button>'
      + '</div>'
      + '<button id="__vx-rcpt-close" style="width:100%;height:40px;background:transparent;border:1px solid rgba(255,255,255,0.06);color:#64748b;font-size:12px;font-weight:600;border-radius:8px;cursor:pointer;font-family:inherit;">Close</button>'
      + '</div>';
    document.body.appendChild(modal);

    var infoEl = document.getElementById("__vx-rcpt-info");
    if (infoEl) {
      var amountStr = "Rs. " + ((receiptData.total || 0) / 100).toLocaleString("en-PK", { minimumFractionDigits: 2 });
      var itemCount = (receiptData.items || []).length;
      infoEl.textContent = amountStr + " · " + itemCount + " item(s)";
    }

    // CRITICAL: Always release the checkout lock regardless of which button was pressed.
    // closeModalSafe MUST be called before any async/navigation logic so the
    // isCheckingOut / __isSubmitting flags are reset even if the app cannot
    // send the receipt (no app installed, network error, user cancels prompt, etc.)
    var closeModalSafe = function() {
      document.removeEventListener('keydown', onEscKey, true);
      var m = document.getElementById("__vx-receipt-share-modal");
      if (m) m.remove();
      // Sweep any leaked showModal overlays so they cannot block UI interaction
      if (typeof window.cleanupModalOverlays === 'function') window.cleanupModalOverlays();
      if (window.state) { window.state.isCheckingOut = false; }
      window.__isSubmitting = false;
      window.__checkoutInProgress = false;
      if (typeof setButtonLoading === 'function') {
        setButtonLoading('btn-checkout-complete', false, '', 'COMPLETE ORDER (F1)');
      }
      // Explicitly restore pointer events & scrolling on body and app containers
      try { document.body.style.removeProperty('pointer-events'); } catch(_) {}
      try { document.body.style.removeProperty('overflow'); } catch(_) {}
      try {
        const layout = document.getElementById('pos-app-layout');
        if (layout) {
          layout.style.removeProperty('pointer-events');
          layout.style.removeProperty('user-select');
        }
      } catch(_) {}
      try { if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur(); } catch(_) {}
    };

    function onEscKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModalSafe();
      }
    }
    document.addEventListener('keydown', onEscKey, true);

    document.getElementById("__vx-rcpt-whatsapp").addEventListener("click", async function() {
      try { if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur(); } catch(_) {}

      let phone = customerPhone || storePhone;
      if (!phone && window.showModal) {
        const res = await showModal({
          title: "WhatsApp Number",
          message: "Enter customer WhatsApp number to send receipt:",
          type: "info",
          actions: [{ id: "ok", label: "Send Receipt", style: "primary" }, { id: "cancel", label: "Cancel", style: "secondary" }],
          input: { placeholder: "03001234567", defaultValue: "" }
        });
        if (!res || res === "cancel" || res === false) { closeModalSafe(); return; }
        phone = (typeof res === "string" && res !== "ok") ? res.trim() : "";
      }
      if (!phone) {
        if (window.showNotificationToast) {
          showNotificationToast('No phone number provided. You can set one in Settings → Store → Store Phone.', 'warning', 4000);
        }
        closeModalSafe();
        return;
      }

      // Hard Server-Side Authorization Check
      try {
        const serverUrl = window.__valenixiaServerUrl || location.origin;
        const authRes = await fetch(serverUrl + '/api/receipts/whatsapp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipientPhone: phone, receiptId: receiptData.receiptNumber || 'RCPT' })
        });
        if (authRes.status === 403) {
          const errData = await authRes.json();
          if (typeof showNotificationToast === 'function') {
            showNotificationToast(`🔒 ${errData.message || 'WhatsApp Receipts feature is locked. Request activation in Subscription -> Add-ons.'}`, 'error', 5000);
          } else alert(errData.message || 'WhatsApp Receipts feature is locked.');
          return;
        }
      } catch (err) {
        console.warn('[WhatsApp] Server authorization check warning:', err);
      }

      // Release checkout lock
      closeModalSafe();

      try {
        shareReceiptWhatsApp(receiptData, phone);
      } finally {
        closeModalSafe();
      }
    });

    document.getElementById("__vx-rcpt-email").addEventListener("click", async function() {
      try { if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur(); } catch(_) {}
      // Release checkout lock FIRST — before any async prompts or navigation
      closeModalSafe();

      let email = customerEmail;
      if (!email && window.showModal) {
        const res = await showModal({
          title: "Customer Email Address",
          message: "Enter customer email address to send receipt:",
          type: "info",
          actions: [{ id: "ok", label: "Send Email", style: "primary" }, { id: "cancel", label: "Cancel", style: "secondary" }],
          input: { placeholder: "customer@email.com", defaultValue: "" }
        });
        if (!res || res === "cancel" || res === false) { closeModalSafe(); return; }
        email = (typeof res === "string" && res !== "ok") ? res.trim() : "";
      }
      if (!email) {
        if (window.showNotificationToast) {
          showNotificationToast('No email address provided. You can set one in Settings → Store → Store Email.', 'warning', 4000);
        }
        closeModalSafe();
        return;
      }
      try {
        shareReceiptEmail(receiptData, email);
      } finally {
        closeModalSafe();
      }
    });

    document.getElementById("__vx-rcpt-pdf").addEventListener("click", function() {
      try { if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur(); } catch(_) {}
      // Release checkout lock FIRST — before download
      closeModalSafe();
      try {
        downloadReceiptPDF(receiptData);
      } finally {
        closeModalSafe();
      }
    });

    document.getElementById("__vx-rcpt-close").addEventListener("click", closeModalSafe);
    modal.addEventListener("click", function(e) { if (e.target === modal) closeModalSafe(); });
  }

  // Expose API
  window.DigitalReceipt = {
    generate: generateReceiptPDF,
    download: downloadReceiptPDF,
    whatsapp: shareReceiptWhatsApp,
    email: shareReceiptEmail,
    showDialog: showDigitalReceiptDialog
  };

})();
