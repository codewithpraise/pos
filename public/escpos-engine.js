// ============================================================================
// NEXOVA ESC/POS ENGINE — DIRECT THERMAL PRINTER CONTROL VIA WebUSB
// Bypasses OS print spooler entirely. Compiles receipts to raw byte codes.
// Drawer firing is decoupled from printing behind a strict state lock.
// Fallback: local network socket relay for iOS / unsupported browsers.
// ============================================================================

'use strict';

const EscPosEngine = (() => {
  // ── ESC/POS byte constants ─────────────────────────────────────────────────
  const ESC = 0x1B;
  const GS  = 0x1D;
  const CMD = {
    INIT:           [ESC, 0x40],
    ALIGN_LEFT:     [ESC, 0x61, 0x00],
    ALIGN_CENTER:   [ESC, 0x61, 0x01],
    ALIGN_RIGHT:    [ESC, 0x61, 0x02],
    BOLD_ON:        [ESC, 0x45, 0x01],
    BOLD_OFF:       [ESC, 0x45, 0x00],
    DOUBLE_HEIGHT:  [GS,  0x21, 0x01],
    NORMAL_SIZE:    [GS,  0x21, 0x00],
    FEED_LINE:      [0x0A],
    FEED_3:         [ESC, 0x64, 0x03],
    CUT_PARTIAL:    [GS,  0x56, 0x01],
    KICK_DRAWER:    [ESC, 0x70, 0x00, 0x19, 0xFA], // Pin 2
  };

  const PAPER_WIDTH_CHARS = 32; // 58mm paper

  // ── State ──────────────────────────────────────────────────────────────────
  let _device         = null;
  let _endpoint       = null;
  let _drawerState    = 'CLOSED'; // 'OPEN' | 'CLOSED'
  let _drawerTimer    = null;
  let _networkFallbackUrl = null; // for WebUSB-unsupported browsers

  // ── Text encoding ──────────────────────────────────────────────────────────
  function encodeText(str) {
    return new TextEncoder().encode(str);
  }

  function center(text, width = PAPER_WIDTH_CHARS) {
    const pad = Math.max(0, Math.floor((width - text.length) / 2));
    return ' '.repeat(pad) + text;
  }

  function divider(char = '-', width = PAPER_WIDTH_CHARS) {
    return char.repeat(width);
  }

  function formatLine(left, right, width = PAPER_WIDTH_CHARS) {
    const gap = width - left.length - right.length;
    return left + ' '.repeat(Math.max(1, gap)) + right;
  }

  // ── Build receipt byte array ───────────────────────────────────────────────
  async function compileReceipt(data) {
    const isUrdu = (data.systemLanguage === 'ur') || (window.state && window.state.preferences && window.state.preferences['system_language'] === 'ur');
    if (isUrdu) {
      return await compileReceiptUrdu(data);
    }

    const chunks = [];

    const push = (bytes) => chunks.push(new Uint8Array(bytes instanceof Uint8Array ? bytes : bytes));
    const text = (str)  => chunks.push(encodeText(str + '\n'));

    push(CMD.INIT);
    push(CMD.ALIGN_CENTER);
    push(CMD.BOLD_ON);
    push(CMD.DOUBLE_HEIGHT);
    text(data.storeName || 'NEXOVA POS');
    push(CMD.NORMAL_SIZE);
    push(CMD.BOLD_OFF);
    text(data.storeAddress || '');
    text(divider());
    push(CMD.ALIGN_LEFT);
    text(`Date : ${new Date(data.timestamp || Date.now()).toLocaleString()}`);
    text(`Ref  : ${data.transactionId || ''}`);
    text(`Cashier: ${data.cashierName || 'N/A'}`);
    text(divider());

    for (const item of (data.items || [])) {
      const name  = item.name || '';
      const price = `Rs.${(item.unitPrice / 100).toFixed(2)}`;
      if (name.length > 20) {
        text(formatLine(name.slice(0, 20), price));
        text(`  ${name.slice(20)}`);
      } else {
        text(formatLine(name, price));
      }
      if (item.qty > 1) {
        const sub = `  x${item.qty}`;
        const total = `Rs.${(item.unitPrice * item.qty / 100).toFixed(2)}`;
        text(formatLine(sub, total));
      }
    }

    text(divider());
    text(formatLine('Subtotal', `Rs.${(data.subtotal / 100).toFixed(2)}`));
    if (data.tax) text(formatLine(`Tax (${data.taxRate || 0}%)`, `Rs.${(data.tax / 100).toFixed(2)}`));
    
    // FBR POS fee printing (Compliance)
    const isFbrEnabled = (data.total - data.subtotal - data.tax >= 100);
    if (isFbrEnabled) {
      text(formatLine('FBR POS Fee', 'Rs.1.00'));
    }

    push(CMD.BOLD_ON);
    text(formatLine('TOTAL', `Rs.${(data.total / 100).toFixed(2)}`));
    push(CMD.BOLD_OFF);
    text(formatLine('Payment', data.paymentMode || 'CASH'));
    if (data.change > 0) text(formatLine('Change', `Rs.${(data.change / 100).toFixed(2)}`));
    text(divider());
    push(CMD.ALIGN_CENTER);
    text('Thank you for your purchase!');
    text(data.footerText || 'Powered by Nexova POS');
    push(CMD.FEED_3);
    push(CMD.CUT_PARTIAL);

    // Merge all chunks into single Uint8Array
    const totalLength = chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }

  // ── WebUSB connection ──────────────────────────────────────────────────────
  async function connect() {
    if (!navigator.usb) {
      console.warn('[Printer] WebUSB not supported. Will use network fallback if configured.');
      return { success: false, reason: 'WebUSB is not supported in this browser.' };
    }
    try {
      _device = await navigator.usb.requestDevice({
        filters: [
          { classCode: 0x07 },  // Printer class
          { vendorId: 0x04B8 }, // Epson
          { vendorId: 0x0519 }, // Star Micronics
          { vendorId: 0x1FC9 }, // Xprinter
          { vendorId: 0x0FE6 }, // ICS Advent (generic)
        ]
      });
      await _device.open();
      if (_device.configuration === null) await _device.selectConfiguration(1);
      await _device.claimInterface(0);

      // Find the bulk-out endpoint
      const iface = _device.configuration.interfaces[0].alternate;
      const ep = iface.endpoints.find(e => e.direction === 'out' && e.type === 'bulk');
      if (!ep) throw new Error('No bulk-out endpoint found on printer interface.');
      _endpoint = ep.endpointNumber;

      console.log(`[Printer] Connected to: ${_device.productName || 'Thermal Printer'} (endpoint ${_endpoint})`);
      return { success: true, name: _device.productName };
    } catch (err) {
      if (err.name === 'SecurityError') {
        return { success: false, reason: 'Connection must be triggered by a user gesture (button click).' };
      }
      if (err.name === 'NotFoundError') {
        return { success: false, reason: 'No printer selected.' };
      }
      console.error('[Printer] WebUSB connect error:', err);
      return { success: false, reason: err.message };
    }
  }

  // ── Send raw bytes to printer ──────────────────────────────────────────────
  async function _sendBytes(bytes) {
    if (window.AndroidHardware && typeof window.AndroidHardware.printReceipt === 'function') {
      const base64EncodedBytes = btoa(String.fromCharCode(...bytes));
      window.AndroidHardware.printReceipt(base64EncodedBytes);
      return;
    }
    if (_device && _endpoint) {
      const CHUNK_SIZE = 256; // Safe buffer limit for generic Chinese printers
      for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        await _device.transferOut(_endpoint, bytes.slice(i, i + CHUNK_SIZE));
        await new Promise(resolve => setTimeout(resolve, 10)); // 10ms micro-pause
      }
      return;
    }
    // Network socket relay fallback (for iOS or unsupported browsers)
    if (_networkFallbackUrl) {
      const base64 = btoa(String.fromCharCode(...bytes));
      await fetch(_networkFallbackUrl + '/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: base64 })
      });
      return;
    }
    // Final fallback: browser print dialog
    console.warn('[Printer] No USB or network printer. Using window.print() fallback.');
    window.print();
  }

  // ── Print a receipt ────────────────────────────────────────────────────────
  async function printReceipt(data) {
    try {
      const bytes = await compileReceipt(data);
      await _sendBytes(bytes);
      console.log(`[Printer] Receipt sent — ${bytes.length} bytes.`);
      return true;
    } catch (err) {
      console.error('[Printer] Print failed:', err);
      return false;
    }
  }

  // ── Cash drawer — strictly decoupled from printing ─────────────────────────
  function kickDrawer(reason = 'SALE') {
    if (_drawerState === 'OPEN') {
      console.warn(`[Drawer] Kick suppressed — drawer already OPEN. Reason attempted: ${reason}`);
      return false;
    }
    _drawerState = 'OPEN';
    console.log(`[Drawer] Opening — Reason: ${reason}`);

    // Dynamically check Cash Drawer wiring pin setting (Pin 2 vs Pin 5)
    // Default to Pin 2 (0x00) if not configured
    let pinByte = 0x00;
    if (window.state && window.state.preferences && window.state.preferences['cash_drawer_pin'] === 'pin_5') {
      pinByte = 0x01; // Pin 5
    }
    const kickCmd = [ESC, 0x70, pinByte, 0x19, 0xFA];

    _sendBytes(new Uint8Array(kickCmd)).catch(e => console.error('[Drawer] Kick error:', e));

    // Auto-mark closed after 15s (for next-sale readiness even if no sensor)
    clearTimeout(_drawerTimer);
    _drawerTimer = setTimeout(() => {
      _drawerState = 'CLOSED';
      console.log('[Drawer] State reset to CLOSED (timeout).');
    }, 15000);
    return true;
  }

  function acknowledgeDrawerClosed() {
    clearTimeout(_drawerTimer);
    _drawerState = 'CLOSED';
    console.log('[Drawer] Manually acknowledged CLOSED.');
  }

  function setNetworkFallback(url) {
    _networkFallbackUrl = url;
    console.log(`[Printer] Network relay fallback set: ${url}`);
  }

  function isConnected() {
    return !!(_device && _endpoint) || !!_networkFallbackUrl;
  }

  function getStatus() {
    return {
      connected: isConnected(),
      drawerState: _drawerState,
      deviceName: _device?.productName || (_networkFallbackUrl ? 'Network Relay' : 'None')
    };
  }

  // ── Urdu Nastaliq Canvas-to-Raster Fallback ────────────────────────────────
  async function compileReceiptUrdu(data) {
    if (document.fonts) {
      try {
        await document.fonts.ready;
      } catch (e) {
        console.warn('[Printer] Font readiness check failed:', e);
      }
    }

    const lines = [];
    const width = PAPER_WIDTH_CHARS;
    const dividerStr = '-'.repeat(width);

    lines.push({ text: data.storeName || 'NEXOVA POS', bold: true, size: 'double', align: 'center' });
    if (data.storeAddress) lines.push({ text: data.storeAddress, align: 'center' });
    lines.push({ text: dividerStr, align: 'center' });
    lines.push({ text: `تاریخ : ${new Date(data.timestamp || Date.now()).toLocaleString('ur-PK')}`, align: 'left' });
    lines.push({ text: `حوالہ : ${data.transactionId || ''}`, align: 'left' });
    lines.push({ text: `کیشیر: ${data.cashierName || 'N/A'}`, align: 'left' });
    lines.push({ text: dividerStr, align: 'center' });

    for (const item of (data.items || [])) {
      const name = item.name || '';
      const price = `Rs.${(item.unitPrice / 100).toFixed(2)}`;
      if (name.length > 20) {
        lines.push({ left: name.slice(0, 20), right: price, align: 'split' });
        lines.push({ text: `  ${name.slice(20)}`, align: 'left' });
      } else {
        lines.push({ left: name, right: price, align: 'split' });
      }
      if (item.qty > 1) {
        const sub = `  x${item.qty}`;
        const total = `Rs.${(item.unitPrice * item.qty / 100).toFixed(2)}`;
        lines.push({ left: sub, right: total, align: 'split' });
      }
    }

    lines.push({ text: dividerStr, align: 'center' });
    lines.push({ left: 'ذیلی کل', right: `Rs.${(data.subtotal / 100).toFixed(2)}`, align: 'split' });
    if (data.tax) lines.push({ left: `ٹیکس (${data.taxRate || 0}%)`, right: `Rs.${(data.tax / 100).toFixed(2)}`, align: 'split' });
    
    const isFbrEnabled = (data.total - data.subtotal - data.tax >= 100);
    if (isFbrEnabled) {
      lines.push({ left: 'FBR POS فیس', right: 'Rs.1.00', align: 'split' });
    }

    lines.push({ left: 'کل رقم', right: `Rs.${(data.total / 100).toFixed(2)}`, bold: true, align: 'split' });
    lines.push({ left: 'ادائیگی', right: data.paymentMode || 'CASH', align: 'split' });
    if (data.change > 0) lines.push({ left: 'واپسی', right: `Rs.${(data.change / 100).toFixed(2)}`, align: 'split' });
    lines.push({ text: dividerStr, align: 'center' });
    lines.push({ text: 'خریداری کا شکریہ!', align: 'center' });
    lines.push({ text: data.footerText || 'Powered by Nexova POS', align: 'center' });

    const canvas = document.createElement('canvas');
    canvas.width = 384;

    let currentY = 10;
    const lineHeights = lines.map(line => {
      if (line.size === 'double') return 48;
      return 32;
    });
    const totalHeight = lineHeights.reduce((a, b) => a + b, 0) + 40;
    canvas.height = totalHeight;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000';
    
    lines.forEach((line, index) => {
      const isDouble = line.size === 'double';
      const fontSize = isDouble ? 30 : 18;
      const fontWeight = (line.bold || isDouble) ? 'bold' : 'normal';
      ctx.font = `${fontWeight} ${fontSize}px "Noto Nastaliq Urdu", "Tahoma", "sans-serif"`;
      ctx.textBaseline = 'top';

      if (line.align === 'split') {
        ctx.textAlign = 'left';
        ctx.fillText(line.left, 10, currentY);
        ctx.textAlign = 'right';
        ctx.fillText(line.right, canvas.width - 10, currentY);
      } else {
        let x = 10;
        if (line.align === 'center') {
          x = canvas.width / 2;
          ctx.textAlign = 'center';
        } else if (line.align === 'right') {
          x = canvas.width - 10;
          ctx.textAlign = 'right';
        } else {
          x = 10;
          ctx.textAlign = 'left';
        }
        ctx.fillText(line.text, x, currentY);
      }
      currentY += lineHeights[index];
    });
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imgData.data;
    const widthBytes = canvas.width / 8;
    const dataBytes = new Uint8Array(widthBytes * canvas.height);

    const w = canvas.width;
    const h = canvas.height;
    const grayBuf = new Float32Array(w * h);

    // Binarization: Fill grayscale values based on alpha
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];
        const a = pixels[idx + 3];
        grayBuf[y * w + x] = (a < 128) ? 255 : (0.299 * r + 0.587 * g + 0.114 * b);
      }
    }

    // Floyd-Steinberg error diffusion to preserve curves of Noto Nastaliq Urdu font
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const oldVal = grayBuf[y * w + x];
        const newVal = oldVal < 128 ? 0 : 255;
        const err = oldVal - newVal;
        grayBuf[y * w + x] = newVal;

        if (x + 1 < w)       grayBuf[y * w + (x + 1)]     += err * 7 / 16;
        if (y + 1 < h) {
          if (x - 1 >= 0)    grayBuf[(y + 1) * w + (x - 1)] += err * 3 / 16;
          grayBuf[(y + 1) * w + x]       += err * 5 / 16;
          if (x + 1 < w)     grayBuf[(y + 1) * w + (x + 1)] += err * 1 / 16;
        }

        if (newVal === 0) {
          const byteIdx = y * widthBytes + Math.floor(x / 8);
          const bitIdx = 7 - (x % 8);
          dataBytes[byteIdx] |= (1 << bitIdx);
        }
      }
    }
    const header = [
      ...CMD.INIT,
      GS, 0x76, 0x30, 0,
      48, 0,
      canvas.height & 0xFF, (canvas.height >> 8) & 0xFF
    ];
    const footer = [
      ...CMD.FEED_3,
      ...CMD.CUT_PARTIAL
    ];

    const bytes = new Uint8Array(header.length + dataBytes.length + footer.length);
    bytes.set(header, 0);
    bytes.set(dataBytes, header.length);
    bytes.set(footer, header.length + dataBytes.length);
    return bytes;
  }

  return { connect, printReceipt, kickDrawer, acknowledgeDrawerClosed, setNetworkFallback, isConnected, getStatus };
})();
