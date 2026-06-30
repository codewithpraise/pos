// ============================================================================
// NEXOVA COMMERCE ECOSYSTEM - OFF-THREAD BARCODE & QR DECODING WORKER
// Powered by ZXing multi-format decoding engine running off the main thread
// ============================================================================

importScripts('https://unpkg.com/@zxing/library@0.21.0/umd/index.min.js');

let reader = null;

self.onmessage = function(event) {
  const { type, imageData } = event.data;
  if (type === 'decode' && imageData) {
    try {
      if (!reader) {
        reader = new ZXing.MultiFormatReader();
      }

      const { data, width, height } = imageData;
      
      // Convert RGBA Uint8ClampedArray to a grayscale luminance array (width * height)
      // This matches the format expected by RGBLuminanceSource
      const luminanceArray = new Uint8ClampedArray(width * height);
      for (let i = 0; i < luminanceArray.length; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        luminanceArray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      }

      const luminanceSource = new ZXing.RGBLuminanceSource(luminanceArray, width, height);
      const hybridBinarizer = new ZXing.HybridBinarizer(luminanceSource);
      const binaryBitmap = new ZXing.BinaryBitmap(hybridBinarizer);

      const result = reader.decode(binaryBitmap);
      if (result) {
        self.postMessage({ type: 'success', text: result.text });
      } else {
        self.postMessage({ type: 'not_found' });
      }
    } catch (err) {
      // ZXing reader throws NotFoundException if no barcode is found in the current frame
      if (err.name === 'NotFoundException' || err.message?.includes('NotFoundException') || err.message?.includes('No MultiFormat Reader')) {
        self.postMessage({ type: 'not_found' });
      } else {
        self.postMessage({ type: 'error', error: err.message });
      }
    }
  }
};
