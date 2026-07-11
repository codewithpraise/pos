// ============================================================================
// VALENIXIA DIGITAL RECEIPT ENGINE — PDF generation, WhatsApp & Email sharing
// Requires jsPDF (jspdf.umd.min.js loaded before this file)
// ============================================================================
"use strict";
(function() {

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
      const lineTotal = ((item.unitPrice || 0) * (item.qty || 1));
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
      const change = (data.amountPaid - data.total);
      if (change >= 0) lines.push({ text: pad("Change:", fmt(change), storeWidth), size: 9 });
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
  function downloadReceiptPDF(data) {
    const doc = generateReceiptPDF(data);
    if (!doc) { alert("PDF engine not available."); return; }
    const filename = "receipt_" + (data.transactionId || Date.now()).toString().slice(-8) + ".pdf";
    doc.save(filename);
  }

  // ── Share via WhatsApp ───────────────────────────────────────────────────────
  function shareReceiptWhatsApp(data, phone) {
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
    const url = cleanPhone
      ? "https://wa.me/" + (cleanPhone.startsWith("92") ? cleanPhone : "92" + cleanPhone.replace(/^0/, "")) + "?text=" + encoded
      : "https://wa.me/?text=" + encoded;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // ── Share via email ──────────────────────────────────────────────────────────
  function shareReceiptEmail(data, email) {
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
    window.location.href = mailto;
  }

  // ── Show share dialog ────────────────────────────────────────────────────────
  async function showDigitalReceiptDialog(receiptData) {
    if (!receiptData || !receiptData.total) return;
    const prefs = window.__valenixiaState?.preferences || {};
    const storePhone = prefs.store_phone || "";
    const customerPhone = receiptData.customerPhone || "";
    const modal = document.createElement("div");
    modal.id = "__vx-receipt-share-modal";
    modal.style.cssText = "position:fixed;inset:0;z-index:2147483645;background:rgba(5,5,8,0.92);display:flex;align-items:flex-end;justify-content:center;padding:16px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);";
    modal.innerHTML = '<div style="width:100%;max-width:480px;background:#111118;border:1px solid rgba(255,255,255,0.08);border-radius:16px 16px 12px 12px;padding:24px;box-shadow:0 -16px 64px rgba(0,0,0,0.8);">'
      + '<div style="text-align:center;margin-bottom:20px;">'
      + '<div style="font-size:32px;margin-bottom:8px;">🧾</div>'
      + '<h2 style="font-size:16px;font-weight:800;color:#fff;margin:0 0 4px;">Send Digital Receipt</h2>'
      + '<p style="font-size:12px;color:#64748b;margin:0;">Rs. ' + ((receiptData.total || 0) / 100).toLocaleString("en-PK", { minimumFractionDigits: 2 }) + ' · ' + (receiptData.items || []).length + ' item(s)</p>'
      + '</div>'
      + '<div style="display:grid;gap:10px;margin-bottom:16px;">'
      + '<button id="__vx-rcpt-whatsapp" style="height:52px;background:rgba(37,211,102,0.15);border:1px solid rgba(37,211,102,0.4);color:#25d366;font-size:14px;font-weight:700;border-radius:10px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:10px;">&#x1F4F1; Send on WhatsApp</button>'
      + '<button id="__vx-rcpt-email" style="height:52px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;font-size:14px;font-weight:700;border-radius:10px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:10px;">&#x2709;&#xFE0F; Send via Email</button>'
      + '<button id="__vx-rcpt-pdf" style="height:52px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:#f87171;font-size:14px;font-weight:700;border-radius:10px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:10px;">&#x1F4BE; Download PDF</button>'
      + '</div>'
      + '<button id="__vx-rcpt-close" style="width:100%;height:40px;background:transparent;border:1px solid rgba(255,255,255,0.06);color:#64748b;font-size:12px;font-weight:600;border-radius:8px;cursor:pointer;font-family:inherit;">No Thanks</button>'
      + '</div>';
    document.body.appendChild(modal);

    document.getElementById("__vx-rcpt-whatsapp").addEventListener("click", async function() {
      let phone = customerPhone || storePhone;
      if (!phone) {
        phone = await (window.showModal ? showModal({ title: "WhatsApp Number", message: "Enter customer WhatsApp number (e.g. 03001234567):", type: "info", actions: [{ id: "ok", label: "Send", style: "primary" }, { id: "cancel", label: "Skip", style: "secondary" }], input: { placeholder: "03001234567", defaultValue: "" } }) : Promise.resolve(""));
      }
      if (phone && phone !== "cancel") shareReceiptWhatsApp(receiptData, phone);
      modal.remove();
    });
    document.getElementById("__vx-rcpt-email").addEventListener("click", async function() {
      const email = await (window.showModal ? showModal({ title: "Email Address", message: "Enter customer email address:", type: "info", actions: [{ id: "ok", label: "Send", style: "primary" }, { id: "cancel", label: "Skip", style: "secondary" }], input: { placeholder: "customer@email.com", defaultValue: "" } }) : Promise.resolve(""));
      if (email && email !== "cancel") shareReceiptEmail(receiptData, email);
      modal.remove();
    });
    document.getElementById("__vx-rcpt-pdf").addEventListener("click", function() {
      downloadReceiptPDF(receiptData);
      modal.remove();
    });
    document.getElementById("__vx-rcpt-close").addEventListener("click", function() { modal.remove(); });
    modal.addEventListener("click", function(e) { if (e.target === modal) modal.remove(); });
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
