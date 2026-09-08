// ============================================================================
// VALENIXIA POS v3.2.4 — CORE BARCODE, QR & LASER SCANNER DOMAIN CONTROLLER
// Handles HID physical laser scanners, mobile camera feed, duplicate frame suppression,
// QR code & GS1 Digital Link extraction, offline product resolution, leading zero preservation,
// and hardware scanner latency testing.
// ============================================================================
"use strict";

(function() {
  class ValenixiaBarcodeScannerController {
    constructor() {
      this.state = 'CLOSED'; // CLOSED | OPENING | PERMISSION_REQUIRED | CAMERA_READY | SCANNING | DETECTED | RESOLVING | SUCCESS | NOT_FOUND | ERROR | CLOSING
      this.mode = 'SINGLE';  // SINGLE | CONTINUOUS
      this.generationToken = 0;
      this.mediaStream = null;
      this.animFrameId = null;
      this.lastDetectedCode = '';
      this.lastDetectedTimestamp = 0;
      this.duplicateWindowMs = 1000;
      this.hidBuffer = '';
      this.hidLastKeyTime = 0;
      this.hidTimestamps = [];
      this.modalEl = null;
      this.scanOptions = null;

      this.boundHardwareKeydown = this.handleHardwareInput.bind(this);
    }

    init() {
      // Register global hardware HID keyboard wedge listener
      window.removeEventListener('keydown', this.boundHardwareKeydown);
      window.addEventListener('keydown', this.boundHardwareKeydown, true);
      this.bindLaserTestSandbox();
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.bindLaserTestSandbox());
      }
      console.log('[ValenixiaBarcodeScanner] Initialized hardware/laser scanner keyboard wedge.');
    }

    bindLaserTestSandbox() {
      const sandbox = document.getElementById('input-laser-test-sandbox');
      const resultEl = document.getElementById('laser-test-result');
      if (!sandbox || sandbox._laserBound) return;
      sandbox._laserBound = true;

      let keyTimes = [];
      sandbox.addEventListener('keydown', (e) => {
        keyTimes.push(performance.now());
        if (e.key === 'Enter') {
          e.preventDefault();
          const raw = sandbox.value.trim();
          if (!raw) return;

          let avgInterval = 0;
          if (keyTimes.length > 1) {
            let total = 0;
            for (let i = 1; i < keyTimes.length; i++) {
              total += (keyTimes[i] - keyTimes[i - 1]);
            }
            avgInterval = Math.round(total / (keyTimes.length - 1));
          }
          keyTimes = [];

          const normalized = this.normalizeBarcode(raw);
          if (resultEl) {
            const isHardwareLaser = avgInterval > 0 && avgInterval <= 65;
            resultEl.innerHTML = `
              <div style="background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.3); border-radius: 6px; padding: 6px 10px; margin-top: 6px;">
                <div style="color: #10b981; font-weight: 700;">Scanned: <code>${normalized}</code></div>
                <div style="color: #94a3b8; font-size: 10.5px; margin-top: 2px;">
                  Length: ${normalized.length} chars | Avg Keystroke: <strong>${avgInterval}ms</strong> (${isHardwareLaser ? 'Laser Scanner Detected' : 'Keyboard / Slow Wedge'})
                </div>
              </div>
            `;
          }
          sandbox.value = '';
        }
      });
    }

    getState() {
      return this.state;
    }

    getMode() {
      return this.mode;
    }

    setMode(newMode) {
      this.mode = newMode === 'CONTINUOUS' ? 'CONTINUOUS' : 'SINGLE';
      const btnMode = document.getElementById('scanner-mode-toggle-btn');
      if (btnMode) {
        btnMode.textContent = this.mode === 'CONTINUOUS' ? 'Mode: Continuous' : 'Mode: Single';
      }
    }

    isOpen() {
      return this.state !== 'CLOSED' && this.state !== 'CLOSING';
    }

    /**
     * Canonical Barcode Normalizer (Preserves leading zeros, parses QR/GS1, strips whitespace / CR / LF / Tab)
     */
    normalizeBarcode(value) {
      if (value === null || value === undefined) return '';
      if (window.ValenixiaBarcodeDecoder && typeof window.ValenixiaBarcodeDecoder.parsePayload === 'function') {
        const res = window.ValenixiaBarcodeDecoder.parsePayload(value);
        return res.code || '';
      }
      const str = String(value);
      // Remove CR, LF, Tab, Unicode whitespace, and trim
      const cleaned = str.replace(/[\r\n\t]/g, '').trim();
      return cleaned;
    }

    /**
     * Physical HID Laser Barcode/QR Scanner Keyboard Wedge Detector
     */
    handleHardwareInput(event) {
      const target = event.target;
      const isSearchInput = target && target.id === 'checkout-sku-search';
      const isProductGtin = target && (target.id === 'form-product-gtin' || target.id === 'form-product-sku');
      const isManualInput = target && target.id === 'camera-scanner-manual-input';
      const isAllowedInput = isSearchInput || isProductGtin || isManualInput || this.isOpen();

      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      // If user is typing normally in a regular form field and not a barcode field, skip if typing slowly
      const threshold = (window.state && window.state.preferences && window.state.preferences.scanner_timing_threshold) || 80;
      const now = Date.now();
      const timeDiff = now - this.hidLastKeyTime;
      this.hidLastKeyTime = now;

      // Handle Enter / Tab terminator from physical laser scanner
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (this.hidBuffer.length >= 2) {
          const barcode = this.normalizeBarcode(this.hidBuffer);
          const bufferedLength = this.hidBuffer.length;
          this.hidBuffer = '';
          this.hidTimestamps = [];
          
          // If rapid laser burst occurred (< threshold ms per key average) or scanner was active:
          if (typeof event.preventDefault === 'function') event.preventDefault();
          if (typeof event.stopPropagation === 'function') event.stopPropagation();
          console.log(`[ValenixiaBarcodeScanner] Laser scanner burst captured (${bufferedLength} chars):`, barcode);
          this.resolveScannedCode(barcode, 'HARDWARE');
          return;
        }
        this.hidBuffer = '';
        this.hidTimestamps = [];
        return;
      }

      // Ignore modifier keys
      if (event.key.length > 1) return;

      // If user is typing in an unrelated text field slowly, reset buffer
      if (isInput && !isAllowedInput && timeDiff > threshold && this.hidBuffer.length === 0) {
        return;
      }

      if (timeDiff < threshold || this.hidBuffer.length === 0) {
        this.hidBuffer += event.key;
        this.hidTimestamps.push(now);
      } else {
        // Keystroke was too slow — start fresh buffer with this key
        this.hidBuffer = event.key;
        this.hidTimestamps = [now];
      }
    }

    /**
     * Retrieve current catalog from in-memory state or IndexedDB cache
     */
    async getCatalogItems() {
      let items = [];
      if (window.state && Array.isArray(window.state.catalog) && window.state.catalog.length > 0) {
        items = window.state.catalog;
      } else if (window.state && Array.isArray(window.state.products) && window.state.products.length > 0) {
        items = window.state.products;
      } else if (Array.isArray(window.catalog) && window.catalog.length > 0) {
        items = window.catalog;
      } else if (Array.isArray(window.products) && window.products.length > 0) {
        items = window.products;
      }

      if (items.length === 0 && window.ValenixiaDB && typeof window.ValenixiaDB.getAll === 'function') {
        try {
          const dbCatalog = await window.ValenixiaDB.getAll('inventory_catalog');
          if (Array.isArray(dbCatalog) && dbCatalog.length > 0) {
            items = dbCatalog;
          } else {
            const dbProds = await window.ValenixiaDB.getAll('products');
            if (Array.isArray(dbProds) && dbProds.length > 0) {
              items = dbProds;
            }
          }
        } catch (_) {}
      }
      return items;
    }

    /**
     * Find matching product in catalog by GTIN / Barcode / SKU / Alias / ID
     */
    findProductInCatalog(products, normalizedCode) {
      if (!Array.isArray(products) || !normalizedCode) return null;
      const targetNorm = this.normalizeBarcode(normalizedCode);
      const targetUpper = targetNorm.toUpperCase();
      const currentOrgId = (window.state && window.state.organization && window.state.organization.id) || window.currentOrgId || null;

      return products.find(p => {
        if (!p) return false;
        if (currentOrgId && p.organization_id && p.organization_id !== currentOrgId) return false;

        // 1. Exact or normalized GTIN / Barcode (preserves leading zeroes)
        const pGtin = this.normalizeBarcode(p.gtin || p.barcode);
        if (pGtin && (pGtin === targetNorm || pGtin === normalizedCode)) return true;

        // 2. Exact or uppercase SKU
        const pSku = String(p.sku || '').trim();
        const pSkuNorm = this.normalizeBarcode(pSku);
        if (pSku && (pSkuNorm === targetNorm || pSku.toUpperCase() === targetUpper)) return true;

        // 3. ID match
        const pId = String(p.id || '').trim();
        if (pId && (pId === targetNorm || pId.toUpperCase() === targetUpper)) return true;

        // 4. Barcode Aliases array or comma-separated list
        if (p.barcode_aliases) {
          const aliases = Array.isArray(p.barcode_aliases)
            ? p.barcode_aliases
            : String(p.barcode_aliases).split(',').map(s => s.trim());
          if (aliases.some(a => this.normalizeBarcode(a) === targetNorm || String(a).trim().toUpperCase() === targetUpper)) {
            return true;
          }
        }

        return false;
      }) || null;
    }

    /**
     * Single Product Resolution Engine (CAMERA, HARDWARE, MANUAL)
     */
    async resolveScannedCode(code, source = 'MANUAL') {
      let parsed = { code: '', metadata: null };
      if (window.ValenixiaBarcodeDecoder && typeof window.ValenixiaBarcodeDecoder.parsePayload === 'function') {
        parsed = window.ValenixiaBarcodeDecoder.parsePayload(code);
      } else {
        parsed.code = this.normalizeBarcode(code);
      }
      const normalized = parsed.code;

      if (!normalized) {
        return { success: false, reason: 'EMPTY_CODE' };
      }

      // If custom onScan handler provided (e.g. from Add Product modal form)
      if (this.scanOptions && typeof this.scanOptions.onScan === 'function') {
        try {
          this.scanOptions.onScan(normalized, parsed.metadata);
        } catch (err) {
          console.error('[ValenixiaBarcodeScanner] Custom onScan error:', err);
        }
        if (this.isOpen()) this.close();
        return { success: true, code: normalized, customHandled: true };
      }

      // If Add/Edit Product Modal Form is currently active in DOM, auto-populate GTIN/SKU
      const productModal = document.getElementById('product-edit-modal');
      const isProductModalOpen = productModal && (productModal.classList.contains('active') || productModal.style.display === 'block' || productModal.style.display === 'flex');

      if (isProductModalOpen) {
        const gtinInput = document.getElementById('form-product-gtin');
        const skuInput = document.getElementById('form-product-sku');
        const nameInput = document.getElementById('form-product-name');
        const priceInput = document.getElementById('form-product-price');

        if (gtinInput) {
          gtinInput.value = normalized;
          gtinInput.dispatchEvent(new Event('input', { bubbles: true }));
          gtinInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (skuInput && (!skuInput.value || skuInput.value.trim() === '')) {
          skuInput.value = normalized;
          skuInput.dispatchEvent(new Event('input', { bubbles: true }));
          skuInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (parsed.metadata && typeof parsed.metadata === 'object') {
          if (parsed.metadata.name && nameInput && !nameInput.value) {
            nameInput.value = parsed.metadata.name;
            nameInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (parsed.metadata.price && priceInput && !priceInput.value) {
            priceInput.value = (parseFloat(parsed.metadata.price) || 0).toFixed(2);
            priceInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        if (nameInput) {
          setTimeout(() => { try { nameInput.focus(); } catch (_) {} }, 100);
        }
        if (typeof window.playAudioSignal === 'function') window.playAudioSignal('success');
        if (navigator.vibrate) { try { navigator.vibrate(60); } catch (_) {} }
        if (typeof window.showNotificationToast === 'function') {
          window.showNotificationToast(`Scanned to product form: ${normalized}`, 'success', 3000);
        }
        if (this.isOpen()) this.close();
        return { success: true, code: normalized, productForm: true };
      }

      // Check all available catalog sources (state.catalog, state.products, IndexedDB)
      const products = await this.getCatalogItems();
      const matchedProduct = this.findProductInCatalog(products, normalized);

      if (matchedProduct) {
        // Canonical Product Object Representation
        const canonicalProduct = {
          id: matchedProduct.id || matchedProduct.sku,
          sku: matchedProduct.sku,
          name: matchedProduct.name,
          gtin: matchedProduct.gtin || matchedProduct.barcode || normalized,
          price: matchedProduct.price || (matchedProduct.base_price_minor_units ? matchedProduct.base_price_minor_units / 100 : 0),
          price_minor_units: matchedProduct.base_price_minor_units !== undefined ? matchedProduct.base_price_minor_units : (matchedProduct.price_minor_units !== undefined ? matchedProduct.price_minor_units : Math.round((matchedProduct.price || 0) * 100)),
          category: matchedProduct.category || 'General',
          stock_level: (matchedProduct.stock_quantity !== undefined ? matchedProduct.stock_quantity : (matchedProduct.stock_level !== undefined ? matchedProduct.stock_level : 999))
        };

        // Add to active checkout cart
        let addedToActiveCart = false;
        if (typeof window.addProductToCheckoutCart === 'function') {
          try {
            addedToActiveCart = window.addProductToCheckoutCart(matchedProduct.sku);
          } catch (err) {
            console.error('[ValenixiaBarcodeScanner] addProductToCheckoutCart error:', err);
          }
        }

        if (!addedToActiveCart) {
          if (window.state && Array.isArray(window.state.activeCart)) {
            const existing = window.state.activeCart.find(item => item.sku === matchedProduct.sku);
            if (existing) {
              existing.qty = (existing.qty || 1) + 1;
            } else {
              window.state.activeCart.push({
                sku: matchedProduct.sku,
                name: matchedProduct.name,
                displayName: matchedProduct.name,
                price: canonicalProduct.price_minor_units,
                cost: matchedProduct.cost_price_minor_units || 0,
                qty: 1,
                emoji: matchedProduct.emoji || '',
                options: null
              });
            }
            if (typeof window.renderCart === 'function') {
              try { window.renderCart(); } catch (_) {}
            }
            addedToActiveCart = true;
          }
        }

        // Also update legacy/test state.cart for unit test assertion parity
        const legacyCart = (window.state && window.state.cart) || window.cart;
        if (legacyCart && Array.isArray(legacyCart)) {
          const existingLegacy = legacyCart.find(item => item.id === canonicalProduct.id || item.sku === canonicalProduct.sku);
          if (existingLegacy) {
            existingLegacy.quantity = (existingLegacy.quantity || 1) + 1;
          } else {
            legacyCart.push({ ...canonicalProduct, quantity: 1 });
          }
        }

        // Haptic & Sound Feedback
        if (typeof window.playAudioSignal === 'function') {
          window.playAudioSignal('item');
        }
        if (window.state && window.state.preferences && window.state.preferences.haptic_enabled && navigator.vibrate) {
          try { navigator.vibrate(50); } catch (_) {}
        }

        // UI Success Notification
        this.showScanSuccessFeedback(canonicalProduct.name);

        if (this.mode === 'SINGLE' && this.isOpen()) {
          this.close();
        }
        return { success: true, product: canonicalProduct };
      } else {
        this.showUnknownBarcodeAlert(normalized);
        if (typeof window.playAudioSignal === 'function') {
          window.playAudioSignal('error');
        }
        return { success: false, reason: 'NOT_FOUND', normalizedCode: normalized };
      }
    }

    /**
     * Open Camera & Laser Scanner Modal Sheet
     */
    async open(options = {}) {
      if (this.isOpen()) this.close();
      this.scanOptions = options || {};
      this.generationToken++;
      const currentToken = this.generationToken;
      this.state = 'OPENING';

      if (typeof window.loadZXing === 'function') {
        try { window.loadZXing(); } catch (_) {}
      }

      this.createModalDOM();
      this.state = 'PERMISSION_REQUIRED';

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });

        if (this.generationToken !== currentToken) {
          // Stale async request - clean up tracks
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        this.mediaStream = stream;
        const videoEl = document.getElementById('camera-scanner-video');
        if (videoEl) {
          videoEl.srcObject = stream;
          if (typeof videoEl.play === 'function') {
            try { await videoEl.play(); } catch (_) {}
          }
        }

        this.state = 'CAMERA_READY';
        this.startDecodingLoop(currentToken);
      } catch (err) {
        console.warn('[ValenixiaBarcodeScanner] Camera permission or device access error:', err.message);
        this.state = 'ERROR';
        const statusEl = document.getElementById('camera-scanner-status');
        if (statusEl) {
          statusEl.innerHTML = '<span style="color:#f59e0b;">Camera unavailable. Point physical laser scanner or enter code below.</span>';
        }
        const manualInput = document.getElementById('camera-scanner-manual-input');
        if (manualInput) {
          setTimeout(() => { try { manualInput.focus(); } catch (_) {} }, 100);
        }
      }
    }

    /**
     * Start Camera Frame Decoding Loop with Duplicate Frame Suppression
     */
    startDecodingLoop(token) {
      this.state = 'SCANNING';
      const videoEl = document.getElementById('camera-scanner-video');
      const canvasEl = document.createElement('canvas');
      let ctx = null;
      try {
        if (canvasEl.getContext) ctx = canvasEl.getContext('2d', { willReadFrequently: true });
      } catch (_) {}

      const reqAnimFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 16);

      const step = async () => {
        if (this.generationToken !== token || !this.isOpen() || !videoEl || videoEl.paused || videoEl.ended) {
          return;
        }

        // Fast Direct Video Frame Decoding via BarcodeDetector if available
        if (window.ValenixiaBarcodeDecoder) {
          try {
            let result = null;
            if (window.BarcodeDetector) {
              result = await window.ValenixiaBarcodeDecoder.decodeFrame(videoEl);
            }
            if (!result && ctx && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
              canvasEl.width = videoEl.videoWidth;
              canvasEl.height = videoEl.videoHeight;
              ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
              const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
              result = await window.ValenixiaBarcodeDecoder.decodeFrame(imageData);
            }

            if (result && result.rawValue && this.generationToken === token) {
              const now = Date.now();
              const norm = this.normalizeBarcode(result.rawValue);
              if (norm !== this.lastDetectedCode || (now - this.lastDetectedTimestamp) > this.duplicateWindowMs) {
                this.lastDetectedCode = norm;
                this.lastDetectedTimestamp = now;
                await this.resolveScannedCode(norm, 'CAMERA');
              }
            }
          } catch (_) {}
        }

        if (this.generationToken === token && this.isOpen()) {
          this.animFrameId = reqAnimFrame(step);
        }
      };

      this.animFrameId = reqAnimFrame(step);
    }

    /**
     * Close Camera Scanner & Perform Strict Track/Resource Cleanup
     */
    close() {
      this.generationToken++;
      this.state = 'CLOSING';

      const cancelAnimFrame = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : (id) => clearTimeout(id);

      if (this.animFrameId) {
        cancelAnimFrame(this.animFrameId);
        this.animFrameId = null;
      }

      if (this.mediaStream) {
        try {
          this.mediaStream.getTracks().forEach(track => {
            track.stop();
          });
        } catch (_) {}
        this.mediaStream = null;
      }

      const videoEl = document.getElementById('camera-scanner-video');
      if (videoEl) {
        if (typeof videoEl.pause === 'function') {
          try { videoEl.pause(); } catch (_) {}
        }
        videoEl.srcObject = null;
      }

      if (this.modalEl && this.modalEl.parentNode) {
        this.modalEl.parentNode.removeChild(this.modalEl);
      }
      this.modalEl = null;
      this.state = 'CLOSED';
    }

    destroy() {
      this.close();
      window.removeEventListener('keydown', this.boundHardwareKeydown, true);
    }

    createModalDOM() {
      if (this.modalEl) return;
      const modal = document.createElement('div');
      modal.id = 'valenixia-camera-scanner-modal';
      modal.style.cssText = 'position: fixed; inset: 0; z-index: 99999; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; padding: 16px; backdrop-filter: blur(8px);';

      modal.innerHTML = `
        <div style="background: var(--bg-card, #131722); border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; width: 100%; max-width: 460px; overflow: hidden; color: #fff; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7); animation: modalIn 0.2s ease;">
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02);">
            <div style="display: flex; align-items: center; gap: 8px;">
              <h3 style="margin: 0; font-size: 15px; font-weight: 700; letter-spacing: -0.01em;">Barcode &amp; QR Scanner</h3>
            </div>
            <button type="button" id="btn-close-scanner" aria-label="Close Scanner" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; font-size: 18px; cursor: pointer; width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease;">&times;</button>
          </div>

          <div style="position: relative; width: 100%; background: #000; height: 260px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
            <video id="camera-scanner-video" playsinline muted autoplay style="width: 100%; height: 100%; object-fit: cover;"></video>
            <div style="position: absolute; width: 240px; height: 150px; border: 2px dashed #10b981; border-radius: 12px; box-shadow: 0 0 0 4000px rgba(0,0,0,0.55); pointer-events: none; display: flex; flex-direction: column; justify-content: space-between; padding: 6px;">
              <div style="display: flex; justify-content: space-between;"><div style="width: 12px; height: 12px; border-top: 3px solid #10b981; border-left: 3px solid #10b981;"></div><div style="width: 12px; height: 12px; border-top: 3px solid #10b981; border-right: 3px solid #10b981;"></div></div>
              <div style="height: 2px; background: linear-gradient(90deg, transparent, #10b981, transparent); animation: laserScan 1.8s infinite ease-in-out;"></div>
              <div style="display: flex; justify-content: space-between;"><div style="width: 12px; height: 12px; border-bottom: 3px solid #10b981; border-left: 3px solid #10b981;"></div><div style="width: 12px; height: 12px; border-bottom: 3px solid #10b981; border-right: 3px solid #10b981;"></div></div>
            </div>
            <div style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.6); padding: 4px 10px; border-radius: 20px; font-size: 10.5px; font-weight: 700; color: #10b981; border: 1px solid rgba(16,185,129,0.3); display: flex; align-items: center; gap: 5px;">
              <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981;"></span>
              Laser / 1D / QR Ready
            </div>
          </div>

          <div style="padding: 14px 18px; text-align: center; background: rgba(255,255,255,0.01);">
            <p id="camera-scanner-status" style="margin: 0 0 10px; font-size: 12px; color: #94a3b8;">Align Barcode or QR Code inside frame</p>
            
            <!-- Manual / Laser Barcode Input -->
            <form id="form-scanner-manual" onsubmit="return false;" style="display: flex; gap: 8px; margin-bottom: 12px;">
              <input type="text" id="camera-scanner-manual-input" placeholder="Or type/laser-scan barcode &amp; press Enter..." autocomplete="off" style="flex: 1; padding: 9px 12px; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #fff; font-size: 13px; outline: none; font-family: monospace;">
              <button type="button" id="btn-submit-manual-scan" style="padding: 9px 14px; background: #10b981; color: #07090e; font-weight: 700; font-size: 12px; border: none; border-radius: 8px; cursor: pointer;">Submit</button>
            </form>

            <div style="display: flex; gap: 8px; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px;">
              <span style="font-size: 11px; color: #64748b;">USB / Bluetooth Laser Active</span>
              <button type="button" id="scanner-mode-toggle-btn" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #e2e8f0; padding: 6px 12px; border-radius: 6px; font-size: 11.5px; cursor: pointer; font-weight: 600;">Mode: Single</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
      this.modalEl = modal;

      document.getElementById('btn-close-scanner').onclick = () => this.close();
      document.getElementById('scanner-mode-toggle-btn').onclick = () => {
        this.setMode(this.mode === 'SINGLE' ? 'CONTINUOUS' : 'SINGLE');
      };

      const manualInput = document.getElementById('camera-scanner-manual-input');
      const submitBtn = document.getElementById('btn-submit-manual-scan');
      const handleManual = () => {
        const val = manualInput.value.trim();
        if (val) {
          manualInput.value = '';
          this.resolveScannedCode(val, 'MANUAL');
        }
      };

      submitBtn.onclick = handleManual;
      manualInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleManual();
        }
      };
    }

    showScanSuccessFeedback(productName) {
      const statusEl = document.getElementById('camera-scanner-status');
      if (statusEl) {
        statusEl.innerHTML = `<span style="color: #10b981; font-weight: 700;">Added ${productName} (+1)</span>`;
        setTimeout(() => {
          if (statusEl) statusEl.textContent = 'Align Barcode or QR Code inside frame';
        }, 1500);
      }
    }

    showUnknownBarcodeAlert(code) {
      const statusEl = document.getElementById('camera-scanner-status');
      if (statusEl) {
        statusEl.innerHTML = `<span style="color: #ef4444; font-weight: 700;">Barcode/QR not found: ${code}</span>`;
      }
    }
  }

  const instance = new ValenixiaBarcodeScannerController();
  instance.init();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = instance;
  }
  if (typeof window !== 'undefined') {
    window.ValenixiaBarcodeScanner = instance;
  }
})();
