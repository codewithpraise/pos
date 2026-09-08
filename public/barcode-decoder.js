// ============================================================================
// VALENIXIA POS v2.6.x — BUNDLED OFFLINE BARCODE DECODER ENGINE
// 100% offline browser barcode decoding engine for 1D/2D symbologies.
// Supports: EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, ITF, QR Code.
// ============================================================================
"use strict";

(function() {
  class ValenixiaOfflineBarcodeDecoder {
    constructor() {
      this.supportedSymbologies = [
        'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'
      ];
      this.nativeDetector = null;
      this.zxingReader = null;
      this.initDetector();
    }

    async initDetector() {
      if (typeof window !== 'undefined' && typeof window.BarcodeDetector !== 'undefined') {
        try {
          this.nativeDetector = new window.BarcodeDetector({
            formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code']
          });
        } catch (_) {}
      }
    }

    /**
     * Decode video element or canvas imageData using fastest available hardware path
     */
    async decodeFrame(source) {
      if (!source) return null;

      // 1. Fast Path: Native Hardware BarcodeDetector API (Android Chrome, iOS Safari 17+)
      if (this.nativeDetector) {
        try {
          const results = await this.nativeDetector.detect(source);
          if (results && results.length > 0 && results[0].rawValue) {
            return {
              rawValue: String(results[0].rawValue).trim(),
              format: results[0].format || 'EAN-13',
              source: 'NATIVE_BARCODE_DETECTOR'
            };
          }
        } catch (_) {}
      }

      // 2. High-Performance ZXing Reader Fallback
      if (typeof window !== 'undefined' && window.ZXing) {
        try {
          if (!this.zxingReader && window.ZXing.MultiFormatReader) {
            this.zxingReader = new window.ZXing.MultiFormatReader();
            const hints = new Map();
            if (window.ZXing.DecodeHintType && window.ZXing.BarcodeFormat) {
              const formats = [
                window.ZXing.BarcodeFormat.EAN_13,
                window.ZXing.BarcodeFormat.EAN_8,
                window.ZXing.BarcodeFormat.CODE_128,
                window.ZXing.BarcodeFormat.CODE_39,
                window.ZXing.BarcodeFormat.UPC_A,
                window.ZXing.BarcodeFormat.UPC_E,
                window.ZXing.BarcodeFormat.QR_CODE
              ];
              hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
              hints.set(window.ZXing.DecodeHintType.TRY_HARDER, true);
            }
            this.zxingReader.setHints(hints);
          }

          if (this.zxingReader && source.data && source.width && source.height) {
            const len = source.width * source.height;
            const luminances = new Uint8ClampedArray(len);
            for (let i = 0; i < len; i++) {
              const idx = i * 4;
              luminances[i] = (source.data[idx] * 299 + source.data[idx + 1] * 587 + source.data[idx + 2] * 114) >> 10;
            }
            const lumSource = new window.ZXing.RGBLuminanceSource(luminances, source.width, source.height);
            const binaryBitmap = new window.ZXing.BinaryBitmap(new window.ZXing.HybridBinarizer(lumSource));
            const result = this.zxingReader.decodeWithState(binaryBitmap);
            if (result && result.getText()) {
              return {
                rawValue: result.getText().trim(),
                format: result.getBarcodeFormat() ? String(result.getBarcodeFormat()) : 'BARCODE',
                source: 'ZXING_DECODER'
              };
            }
          }
        } catch (_) {}
      }

      return null;
    }

    /**
     * Parse and normalize 1D/2D scanned raw payloads (QR codes, GS1 Digital Link, JSON, plain GTINs)
     */
    parsePayload(rawValue) {
      if (!rawValue) return { code: '', metadata: null };
      const raw = String(rawValue).replace(/[\r\n\t]/g, '').trim();

      // 1. JSON payload (e.g. {"gtin":"001234567890", "sku":"COFFEE-01", "name":"Latte", "price":350})
      if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            const extractedCode = parsed.gtin || parsed.barcode || parsed.sku || parsed.id || parsed.code || '';
            return {
              code: String(extractedCode).trim(),
              metadata: parsed,
              isJson: true
            };
          }
        } catch (_) {}
      }

      // 2. GS1 Digital Link or URI: https://id.gs1.org/01/00012345678905... or /gtin/123456 or /sku/123456
      if (raw.includes('http://') || raw.includes('https://') || raw.includes('/01/') || raw.includes('gtin=')) {
        try {
          // Check query parameters first (?gtin=... or ?sku=... or ?barcode=...)
          const urlObj = new URL(raw, 'https://valenixia.local');
          const qGtin = urlObj.searchParams.get('gtin') || urlObj.searchParams.get('barcode') || urlObj.searchParams.get('sku') || urlObj.searchParams.get('code');
          if (qGtin) {
            return { code: qGtin.trim(), metadata: { sourceUrl: raw }, isGs1: true };
          }

          // Check standard GS1 Digital Link path structure /01/{gtin}
          const gs1Match = raw.match(/\/01\/(\d{8,14})/);
          if (gs1Match && gs1Match[1]) {
            return { code: gs1Match[1], metadata: { gs1AIType: '01', sourceUrl: raw }, isGs1: true };
          }

          // Check path ending with numeric barcode or SKU: /products/001234567890
          const pathMatch = raw.match(/\/([a-zA-Z0-9_\-]{3,32})\/?$/);
          if (pathMatch && pathMatch[1] && !['index.html', 'index', 'view', 'item'].includes(pathMatch[1].toLowerCase())) {
            return { code: pathMatch[1].trim(), metadata: { sourceUrl: raw } };
          }
        } catch (_) {}
      }

      // 3. Standard 1D/2D string representation (preserve leading zeros)
      return { code: raw, metadata: null };
    }
  }

  const decoderInstance = new ValenixiaOfflineBarcodeDecoder();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = decoderInstance;
  }
  if (typeof window !== 'undefined') {
    window.ValenixiaBarcodeDecoder = decoderInstance;
  }
})();

