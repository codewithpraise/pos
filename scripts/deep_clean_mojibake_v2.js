const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, '../public');

const replacements = [
  { search: /ðŸ“ \s*\[PINPOINT:.*?\]/g, replace: '' },
  { search: /ðŸ‘†\s*\[USER:.*?\]/g, replace: '' },
  { search: /ðŸ“ /g, replace: '📍' },
  { search: /ðŸ‘†/g, replace: '👆' },
  { search: /âœCheck/g, replace: '✓ Check' },
  { search: /âœ/g, replace: '✓' },
  { search: /â—/g, replace: '●' },
  { search: /â€/g, replace: '' },
  { search: /âš/g, replace: '⚙️' },
  { search: /â˜/g, replace: '⚠️' },
  { search: /Ã—/g, replace: '×' },
  { search: /Ã©/g, replace: 'e' },
  { search: /â€“/g, replace: '-' },
  { search: /â€”/g, replace: '-' },
  { search: /Â/g, replace: '' },
  { search: /ï¿½/g, replace: '' },
  { search: /ðŸ›‹ï¸ /g, replace: '🛋️' },
  { search: /ðŸ ¬/g, replace: '🏬' },
  { search: /âš™ï¸ /g, replace: '⚙️' }
];

function cleanFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;

  replacements.forEach(r => {
    content = content.replace(r.search, r.replace);
  });

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Cleaned Mojibake in: ${path.relative(targetDir, filePath)}`);
  }
}

function processDir(dir) {
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      processDir(fullPath);
    } else if (/\.(html|js|css|json)$/i.test(file)) {
      cleanFile(fullPath);
    }
  });
}

console.log('Running deep Mojibake cleaner...');
processDir(targetDir);
console.log('Cleaning complete!');
