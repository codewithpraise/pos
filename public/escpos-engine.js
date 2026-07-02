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
  function compileReceipt(data) {
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
      const name  = (item.name || '').slice(0, 20);
      const price = `Rs.${(item.unitPrice / 100).toFixed(2)}`;
      text(formatLine(name, price));
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
    if (_device && _endpoint) {
      await _device.transferOut(_endpoint, bytes);
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
      const bytes = compileReceipt(data);
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
    _sendBytes(new Uint8Array(CMD.KICK_DRAWER)).catch(e => console.error('[Drawer] Kick error:', e));

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

  return { connect, printReceipt, kickDrawer, acknowledgeDrawerClosed, setNetworkFallback, isConnected, getStatus };
})();
