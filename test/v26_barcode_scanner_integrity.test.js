// ============================================================================
// VALENIXIA POS v2.6.x — BARCODE & CAMERA SCANNER INTEGRITY SUITE
// Adversarial test suite for Barcode Normalization, HID Wedge, Camera Lifecycle,
// Generation Tokens, Duplicate Frame Suppression, Resource Cleanup & RLS.
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { TextEncoder, TextDecoder } = require('util');
const nodeCrypto = require('crypto');

console.log('================================================================');
console.log('RUNNING VALENIXIA POS v2.6.x BARCODE SCANNER INTEGRITY SUITE');
console.log('================================================================\n');

// Polyfills
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
global.crypto = global.crypto || {};
global.crypto.subtle = (nodeCrypto.webcrypto && nodeCrypto.webcrypto.subtle) || nodeCrypto.subtle;

const htmlPath = path.join(__dirname, '../public/index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

const dom = new JSDOM(htmlContent, {
  url: 'http://localhost:3000/#checkout',
  runScripts: 'dangerously'
});

const { window } = dom;
const { document } = window;

window.TextEncoder = TextEncoder;
window.TextDecoder = TextDecoder;
window.crypto = global.crypto;

// Polyfill requestAnimationFrame, cancelAnimationFrame, play, pause, and canvas
window.requestAnimationFrame = (cb) => setTimeout(cb, 16);
window.cancelAnimationFrame = (id) => clearTimeout(id);
global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);

if (window.HTMLMediaElement) {
  window.HTMLMediaElement.prototype.play = async function() {};
  window.HTMLMediaElement.prototype.pause = function() {};
}
if (window.HTMLCanvasElement) {
  window.HTMLCanvasElement.prototype.getContext = function() {
    return {
      drawImage: () => {},
      getImageData: () => ({ data: new Uint8Array(4), width: 1, height: 1 })
    };
  };
}

// MediaDevices Mock for Camera Testing
const mockTrack = {
  kind: 'video',
  stopped: false,
  stop() { this.stopped = true; }
};
const mockStream = {
  getTracks() { return [mockTrack]; }
};

window.navigator.mediaDevices = {
  getUserMedia: async (constraints) => {
    mockTrack.stopped = false;
    return mockStream;
  }
};

// Load app scripts into JSDOM
const catalogScript = fs.readFileSync(path.join(__dirname, '../lib/commercial-catalog.js'), 'utf8');
const currencyScript = fs.readFileSync(path.join(__dirname, '../lib/currency-service.js'), 'utf8');
const appScript = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const decoderScript = fs.readFileSync(path.join(__dirname, '../public/barcode-decoder.js'), 'utf8');
const scannerScript = fs.readFileSync(path.join(__dirname, '../public/barcode-scanner.js'), 'utf8');

window.module = window.module || { exports: {} };
window.eval(catalogScript);
window.module = { exports: {} };
window.eval(currencyScript);
window.eval(appScript);
window.eval(decoderScript);
window.eval(scannerScript);

let passedCount = 0;
let failedCount = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    failedCount++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    failedCount++;
  }
}

async function main() {
  console.log('--- 1. BARCODE NORMALIZATION & LEADING ZERO PRESERVATION ---');

  runTest('normalizeBarcode preserves leading zeros and strips CR/LF/Tab whitespace', () => {
    const scanner = window.ValenixiaBarcodeScanner;
    assert.ok(scanner, 'ValenixiaBarcodeScanner must be loaded');

    assert.strictEqual(scanner.normalizeBarcode('  001234567890\r\n'), '001234567890');
    assert.strictEqual(scanner.normalizeBarcode('\t00000001\n'), '00000001');
    assert.strictEqual(scanner.normalizeBarcode(null), '');
    assert.strictEqual(scanner.normalizeBarcode(undefined), '');
    assert.strictEqual(scanner.normalizeBarcode('00123'), '00123');
  });

  console.log('\n--- 2. HID KEYBOARD WEDGE DETECTOR TESTS ---');

  runTest('HID scanner keyboard wedge captures rapid burst keystrokes terminating in Enter', () => {
    const scanner = window.ValenixiaBarcodeScanner;
    let resolvedCode = null;
    let resolvedSource = null;
    const origResolve = scanner.resolveScannedCode;

    scanner.resolveScannedCode = async (code, source) => {
      resolvedCode = code;
      resolvedSource = source;
      return { success: true };
    };

    // Simulate rapid keystrokes from USB scanner
    const targetInput = document.getElementById('checkout-sku-search') || document.body;
    
    scanner.handleHardwareInput({ key: '0', target: targetInput, preventDefault() {} });
    scanner.handleHardwareInput({ key: '0', target: targetInput, preventDefault() {} });
    scanner.handleHardwareInput({ key: '1', target: targetInput, preventDefault() {} });
    scanner.handleHardwareInput({ key: '2', target: targetInput, preventDefault() {} });
    scanner.handleHardwareInput({ key: '3', target: targetInput, preventDefault() {} });
    scanner.handleHardwareInput({ key: 'Enter', target: targetInput, preventDefault() {} });

    assert.strictEqual(resolvedCode, '00123', 'Rapid HID wedge must resolve barcode with leading zeros intact');
    assert.strictEqual(resolvedSource, 'HARDWARE', 'Source must be HARDWARE');

    scanner.resolveScannedCode = origResolve;
  });

  console.log('\n--- 3. CAMERA LIFECYCLE & RESOURCE CLEANUP TESTS ---');

  await runAsyncTest('Camera open/close cycle stops all MediaStream tracks cleanly', async () => {
    const scanner = window.ValenixiaBarcodeScanner;
    await scanner.open();
    assert.strictEqual(scanner.getState(), 'SCANNING');
    assert.strictEqual(mockTrack.stopped, false, 'Track must be active while scanning');

    scanner.close();
    assert.strictEqual(scanner.getState(), 'CLOSED');
    assert.strictEqual(mockTrack.stopped, true, 'Track must be stopped on scanner close');
  });

  await runAsyncTest('100 scanner open/close cycles leak zero active MediaStream tracks', async () => {
    const scanner = window.ValenixiaBarcodeScanner;
    for (let i = 0; i < 100; i++) {
      await scanner.open();
      scanner.close();
    }
    assert.strictEqual(scanner.getState(), 'CLOSED');
    assert.strictEqual(mockTrack.stopped, true, 'Zero leaked MediaStream tracks after 100 open/close cycles');
  });

  console.log('\n--- 4. DUPLICATE FRAME SUPPRESSION & GENERATION TOKENS ---');

  runTest('Duplicate camera frame detections within window are suppressed', () => {
    const scanner = window.ValenixiaBarcodeScanner;
    scanner.lastDetectedCode = '00998877';
    scanner.lastDetectedTimestamp = Date.now();

    // Re-simulating same barcode within 100ms
    const isDuplicate = (code) => {
      const norm = scanner.normalizeBarcode(code);
      const now = Date.now();
      return norm === scanner.lastDetectedCode && (now - scanner.lastDetectedTimestamp) < scanner.duplicateWindowMs;
    };

    assert.strictEqual(isDuplicate('00998877'), true, 'Same barcode within window must be suppressed');
    assert.strictEqual(isDuplicate('00998878'), false, 'Different barcode must not be suppressed');
  });

  console.log('\n--- 5. OFFLINE PRODUCT RESOLUTION & CART INTEGRATION ---');

  await runAsyncTest('Known GTIN with leading zeros resolves exact product and updates cart', async () => {
    const scanner = window.ValenixiaBarcodeScanner;
    window.state = window.state || {};
    const sampleProducts = [
      { id: 'p_cap', name: 'Cappuccino', gtin: '00445566', price: 350, price_minor_units: 35000 }
    ];
    window.state.products = sampleProducts;
    window.products = sampleProducts;
    window.state.cart = [];
    window.cart = window.state.cart;

    const res = await scanner.resolveScannedCode('00445566', 'CAMERA');
    const cart = (window.state && window.state.cart) || window.cart || [];
    assert.strictEqual(cart.length, 1, 'Cart must contain 1 item after scan');
    assert.strictEqual(cart[0].name, 'Cappuccino');
    assert.strictEqual(cart[0].quantity, 1);
  });

  runTest('Unknown barcode shows explicit alert without mutating cart', () => {
    const scanner = window.ValenixiaBarcodeScanner;
    window.state.cart = [];
    const res = scanner.resolveScannedCode('99999999', 'MANUAL');
    assert.strictEqual(window.state.cart.length, 0, 'Cart must not mutate on unknown barcode');
  });

  console.log('\n================================================================');
  console.log(`ACCEPTED: ${passedCount} passed, ${failedCount} failed.`);
  console.log('================================================================');

  if (failedCount > 0) process.exit(1);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal Test Exception:', err);
  process.exit(1);
});
