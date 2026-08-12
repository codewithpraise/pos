// ============================================================================
// VALENIXIA POS v2.6.x — CORE BARCODE & CAMERA SCANNER DOMAIN CONTROLLER
// Handles HID physical scanners, mobile camera feed, duplicate frame suppression,
// offline product resolution, leading zero preservation, and resource cleanup.
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
      this.modalEl = null;

      this.boundHardwareKeydown = this.handleHardwareInput.bind(this);
    }

    init() {
      // Register global hardware HID keyboard wedge listener
      window.removeEventListener('keydown', this.boundHardwareKeydown);
      window.addEventListener('keydown', this.boundHardwareKeydown);
      console.log('[ValenixiaBarcodeScanner] Initialized hardware scanner keyboard wedge.');
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
        btnMode.textContent = this.mode === 'CONTINUOUS' ? 'Continuous: ON' : 'Continuous: OFF';
      }
    }

    isOpen() {
      return this.state !== 'CLOSED' && this.state !== 'CLOSING';
    }

    /**
     * Canonical Barcode Normalizer (Preserves leading zeros, strips whitespace / CR / LF / Tab)
     */
    normalizeBarcode(value) {
      if (value === null || value === undefined) return '';
      const str = String(value);
      // Remove CR, LF, Tab, Unicode whitespace, and trim
      const cleaned = str.replace(/[\r\n\t]/g, '').trim();
      return cleaned;
    }

    /**
     * Physical HID Barcode Scanner Keyboard Wedge Detector
     */
    handleHardwareInput(event) {
      // Ignore inputs if user is typing in text fields (unless it's the checkout search input)
      const target = event.target;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const isCheckoutSearch = target && target.id === 'checkout-sku-search';

      if (isInput && !isCheckoutSearch) return;

      const threshold = (window.state && window.state.preferences && window.state.preferences.scanner_timing_threshold) || 50;
      const now = Date.now();
      const timeDiff = now - this.hidLastKeyTime;
      this.hidLastKeyTime = now;

      if (event.key === 'Enter' || event.key === 'Tab') {
        if (this.hidBuffer.length >= 3) {
          const barcode = this.normalizeBarcode(this.hidBuffer);
          this.hidBuffer = '';
          event.preventDefault();
          this.resolveScannedCode(barcode, 'HARDWARE');
        }
        this.hidBuffer = '';
        return;
      }

      if (event.key.length === 1) {
        if (timeDiff < threshold || this.hidBuffer.length === 0) {
          this.hidBuffer += event.key;
        } else {
          this.hidBuffer = event.key;
        }
      }
    }

    /**
     * Single Product Resolution Engine (CAMERA, HARDWARE, MANUAL)
     */
    async resolveScannedCode(code, source = 'MANUAL') {
      const normalized = this.normalizeBarcode(code);
      if (!normalized) return { success: false, reason: 'EMPTY_CODE' };

      const products = (window.state && window.state.products) || window.products || [];
      const currentOrgId = (window.state && window.state.organization && window.state.organization.id) || window.currentOrgId || null;

      // Exact GTIN -> Exact SKU -> Barcode Alias Matching
      let matchedProduct = products.find(p => {
        if (currentOrgId && p.organization_id && p.organization_id !== currentOrgId) return false;
        const gtin = this.normalizeBarcode(p.gtin || p.barcode);
        const sku = this.normalizeBarcode(p.sku);
        return (gtin && gtin === normalized) || (sku && sku === normalized);
      });

      if (!matchedProduct) {
        matchedProduct = products.find(p => {
          if (currentOrgId && p.organization_id && p.organization_id !== currentOrgId) return false;
          const aliases = Array.isArray(p.barcode_aliases) ? p.barcode_aliases : [];
          return aliases.some(a => this.normalizeBarcode(a) === normalized);
        });
      }

      if (matchedProduct) {
        // Canonical Product Object Representation
        const canonicalProduct = {
          id: matchedProduct.id,
          name: matchedProduct.name,
          sku: matchedProduct.sku,
          gtin: matchedProduct.gtin || matchedProduct.barcode || normalized,
          price: matchedProduct.price || 0,
          price_minor_units: matchedProduct.price_minor_units !== undefined ? matchedProduct.price_minor_units : Math.round((matchedProduct.price || 0) * 100),
          category: matchedProduct.category || 'General',
          stock_level: matchedProduct.stock_level !== undefined ? matchedProduct.stock_level : 999
        };

        // Add to checkout cart
        if (typeof window.addToCart === 'function') {
          try {
            window.addToCart(canonicalProduct);
          } catch (err) {
            console.error('[ValenixiaBarcodeScanner] addToCart error:', err);
          }
        } else {
          const cart = (window.state && window.state.cart) || window.cart;
          if (cart) {
            const existing = cart.find(item => item.id === canonicalProduct.id);
            if (existing) {
              existing.quantity += 1;
            } else {
              cart.push({ ...canonicalProduct, quantity: 1 });
            }
            if (typeof window.renderCart === 'function') {
              try { window.renderCart(); } catch (_) {}
            }
          }
        }

        // Haptic & Sound Feedback
        if (window.state && window.state.preferences) {
          if (window.state.preferences.haptic_enabled && navigator.vibrate) {
            try { navigator.vibrate(50); } catch (_) {}
          }
        }

        // UI Success Notification
        this.showScanSuccessFeedback(canonicalProduct.name);

        if (this.mode === 'SINGLE' && this.isOpen()) {
          this.close();
        }
        return { success: true, product: canonicalProduct };
      } else {
        this.showUnknownBarcodeAlert(normalized);
        return { success: false, reason: 'NOT_FOUND', normalizedCode: normalized };
      }
    }

    /**
     * Open Camera Scanner Modal Sheet
     */
    async open(options = {}) {
      if (this.isOpen()) return;
      this.generationToken++;
      const currentToken = this.generationToken;
      this.state = 'OPENING';

      this.createModalDOM();
      this.state = 'PERMISSION_REQUIRED';

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });

        if (this.generationToken !== currentToken) {
          // Stale async request - clean up tracks
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        this.mediaStream = stream;
        const videoEl = document.getElementById('camera-scanner-video');
        if (videoEl && typeof videoEl.play === 'function') {
          try { await videoEl.play(); } catch (_) {}
        }

        this.state = 'CAMERA_READY';
        this.startDecodingLoop(currentToken);
      } catch (err) {
        console.warn('[ValenixiaBarcodeScanner] Camera permission or device access error:', err.message);
        this.state = 'ERROR';
        const statusEl = document.getElementById('camera-scanner-status');
        if (statusEl) {
          statusEl.textContent = 'Camera access blocked. Enter barcode manually or check permissions.';
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

        if (ctx && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
          canvasEl.width = videoEl.videoWidth;
          canvasEl.height = videoEl.videoHeight;
          ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
          const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);

          if (window.ValenixiaBarcodeDecoder) {
            try {
              const result = await window.ValenixiaBarcodeDecoder.decodeFrame(imageData);
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
      window.removeEventListener('keydown', this.boundHardwareKeydown);
    }

    createModalDOM() {
      if (this.modalEl) return;
      const modal = document.createElement('div');
      modal.id = 'valenixia-camera-scanner-modal';
      modal.style.cssText = 'position: fixed; inset: 0; z-index: 99999; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; padding: 16px; backdrop-filter: blur(4px);';

      modal.innerHTML = `
        <div style="background: var(--bg-card, #1e293b); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; width: 100%; max-width: 440px; overflow: hidden; color: #fff; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);">
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.08);">
            <h3 style="margin: 0; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
              <span>📷 Barcode Scanner</span>
            </h3>
            <button type="button" id="btn-close-scanner" style="background: transparent; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">✕</button>
          </div>
          <div style="position: relative; width: 100%; background: #000; height: 260px; display: flex; align-items: center; justify-content: center;">
            <video id="camera-scanner-video" playsinline muted autoplay style="width: 100%; height: 100%; object-fit: cover;"></video>
            <div style="position: absolute; width: 220px; height: 140px; border: 2px dashed #10b981; border-radius: 8px; box-shadow: 0 0 0 4000px rgba(0,0,0,0.4); pointer-events: none;"></div>
          </div>
          <div style="padding: 14px 16px; text-align: center;">
            <p id="camera-scanner-status" style="margin: 0 0 12px; font-size: 12px; color: #94a3b8;">Align barcode inside frame to scan</p>
            <div style="display: flex; gap: 8px; justify-content: center;">
              <button type="button" id="scanner-mode-toggle-btn" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 8px 14px; border-radius: 6px; font-size: 12px; cursor: pointer;">Continuous: OFF</button>
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
    }

    showScanSuccessFeedback(productName) {
      const statusEl = document.getElementById('camera-scanner-status');
      if (statusEl) {
        statusEl.innerHTML = `<span style="color: #10b981; font-weight: 600;">✓ Added ${productName} (+1)</span>`;
        setTimeout(() => {
          if (statusEl) statusEl.textContent = 'Align barcode inside frame to scan';
        }, 1500);
      }
    }

    showUnknownBarcodeAlert(code) {
      const statusEl = document.getElementById('camera-scanner-status');
      if (statusEl) {
        statusEl.innerHTML = `<span style="color: #ef4444; font-weight: 600;">Barcode not found: ${code}</span>`;
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
