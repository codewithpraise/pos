const fs = require('fs');
const path = require('path');

// 1. Search index.html for catalog views
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const htmlLines = html.split('\n');
console.log('=== INDEX.HTML VIEWS ===');
htmlLines.forEach((line, idx) => {
  if (line.includes('id="view-catalog') || line.includes('id="catalog-') || line.includes('checkout-quick-grid') || line.includes('mobile-quick-grid')) {
    console.log(`${idx + 1}: ${line.trim().substring(0, 120)}`);
  }
});

// 2. Search router.js for catalog routes
const router = fs.readFileSync(path.join(__dirname, '../public/router.js'), 'utf8');
const routerLines = router.split('\n');
console.log('\n=== ROUTER.JS ROUTES ===');
routerLines.forEach((line, idx) => {
  if (line.includes("'catalog'") || line.includes("'catalog-manager'") || line.includes("view-catalog")) {
    console.log(`${idx + 1}: ${line.trim().substring(0, 120)}`);
  }
});

// 3. Search freemium-engine.js for limits
const freemium = fs.readFileSync(path.join(__dirname, '../public/freemium-engine.js'), 'utf8');
console.log('\n=== FREEMIUM-ENGINE.JS LIMITS ===');
console.log(freemium.substring(0, 1500));
