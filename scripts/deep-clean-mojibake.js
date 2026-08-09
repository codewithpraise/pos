const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(filePath));
    } else if (/\.(html|js|css|json)$/i.test(file)) {
      results.push(filePath);
    }
  });
  return results;
}

const publicDir = path.join(__dirname, '../public');
const files = walk(publicDir);

const replacements = [
  [/ðŸ›’/g, '🛒'],
  [/ðŸ§º/g, '🧺'],
  [/ðŸ‘—/g, '👗'],
  [/ðŸ ”/g, '🍔'],
  [/â˜•/g, '☕'],
  [/ðŸ’Š/g, '💊'],
  [/ðŸ“±/g, '📱'],
  [/ðŸš—/g, '🚗'],
  [/ðŸ”§/g, '🔧'],
  [/ðŸ’…/g, '💅'],
  [/ðŸ’ /g, '💎'],
  [/ðŸ“š/g, '📚'],
  [/âš½/g, '⚽'],
  [/ðŸ›‹ï¸ /g, '🛋️'],
  [/ðŸ”¨/g, '🔨'],
  [/ðŸ“…/g, '📅'],
  [/âš™ï¸ /g, '⚙️'],
  [/ðŸ“„/g, '📄'],
  [/ðŸ›¡ï¸ /g, '🛡️'],
  [/ðŸ’¸/g, '💸'],
  [/ðŸ“‚/g, '📁'],
  [/ðŸ”¥/g, '🔥'],
  [/ðŸ’³/g, '💳'],
  [/ðŸ“²/g, '📲'],
  [/â—€/g, '◀'],
  [/â—/g, '●'],
  [/âœ“/g, '✓'],
  [/âœ/g, '✓'],
  [/Ã—/g, '×'],
  [/â€”/g, '—'],
  [/â€“/g, '—'],
  [/Ø§Ø±Ø¯Ùˆ Ø±Ø³Ù… Ø§Ù„Ø®Ø·/g, 'اردو رسم الخط'],
  [/Ø§Ø±Ø¯Ùˆ/g, 'اردو'],
  [/Â/g, ''],
  [/ï¿½/g, '']
];

let cleanedCount = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  replacements.forEach(([pattern, replacement]) => {
    content = content.replace(pattern, replacement);
  });

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    cleanedCount++;
    console.log(`Cleaned Mojibake in: ${path.relative(publicDir, file)}`);
  }
});

console.log(`\nDone! Deep cleaned ${cleanedCount} files in public/.`);
