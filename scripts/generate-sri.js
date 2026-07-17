const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, '../public/app.js');
const swJsPath = path.join(__dirname, '../public/sw.js');
const androidSwJsPath = path.join(__dirname, '../android/app/src/main/assets/sw.js');

try {
  const appJsData = fs.readFileSync(appJsPath);
  const hash = crypto.createHash('sha384').update(appJsData).digest('base64');
  const sri = `sha384-${hash}`;

  let swContent = fs.readFileSync(swJsPath, 'utf8');
  // Replace the integrity field for /app.js
  swContent = swContent.replace(
    /\{\s*url:\s*'\/app\.js',\s*integrity:\s*'[^']*'\s*\}/,
    `{ url: '/app.js', integrity: '${sri}' }`
  );

  fs.writeFileSync(swJsPath, swContent);
  console.log(`[SRI] Calculated app.js SRI: ${sri}`);

  // If android sw.js exists, copy it over
  if (fs.existsSync(androidSwJsPath)) {
    fs.writeFileSync(androidSwJsPath, swContent);
    console.log('[SRI] Copied updated sw.js to Android assets.');
  }
} catch (err) {
  console.error('[SRI] Generation failed:', err.message);
  process.exit(1);
}
