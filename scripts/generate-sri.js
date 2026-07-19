const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '../public');
const swJsPath = path.join(publicDir, 'sw.js');
const androidSwJsPath = path.join(__dirname, '../android/app/src/main/assets/sw.js');

// Files that have SRI in sw.js — must match the url: '/filename' entries
const SRI_FILES = [
  'app.js',
  'client-db.js',
  'sync-worker.js',
  'client-audio.js',
  'client-speech.js',
  'client-sync.js',
  'polyfill.min.js',
  'dompurify.min.js',
  'jspdf.umd.min.js',
  'zxing.min.js',
];

try {
  let swContent = fs.readFileSync(swJsPath, 'utf8');

  for (const filename of SRI_FILES) {
    const filePath = path.join(publicDir, filename);
    if (!fs.existsSync(filePath)) {
      console.warn(`[SRI] Skipping ${filename} — file not found`);
      continue;
    }
    const data = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha384').update(data).digest('base64');
    const sri = `sha384-${hash}`;

    // Replace the integrity value for this url entry in sw.js
    const escapedFilename = filename.replace('.', '\\.');
    const pattern = new RegExp(
      `(\\{\\s*url:\\s*'\\/${escapedFilename}',\\s*integrity:\\s*')[^']*('\\s*\\})`,
      'g'
    );
    const updated = swContent.replace(pattern, `$1${sri}$2`);
    if (updated !== swContent) {
      swContent = updated;
      console.log(`[SRI] Updated ${filename}: ${sri}`);
    } else {
      console.log(`[SRI] No change for ${filename} (pattern not found or already up to date)`);
    }
  }

  fs.writeFileSync(swJsPath, swContent);
  console.log('[SRI] sw.js updated successfully.');

  // Sync to Android assets
  if (fs.existsSync(androidSwJsPath)) {
    fs.writeFileSync(androidSwJsPath, swContent);
    console.log('[SRI] Copied updated sw.js to Android assets.');
  }
} catch (err) {
  console.error('[SRI] Generation failed:', err.message);
  process.exit(1);
}
