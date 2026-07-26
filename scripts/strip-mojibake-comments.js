const fs = require('fs');

const files = [
  'public/app.js',
  'public/client-db.js',
  'public/index.html',
  'android/app/src/main/assets/app.js',
  'android/app/src/main/assets/client-db.js',
  'android/app/src/main/assets/index.html'
];

files.forEach(filePath => {
  if (!fs.existsSync(filePath)) return;
  let code = fs.readFileSync(filePath, 'utf8');
  let lines = code.split('\n');
  
  let cleaned = lines.map(line => {
    if (!line.includes('Ã')) return line;
    
    // If it's a comment line containing mojibake
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      return '// ----------------------------------------------------------------------------';
    }
    
    // If code line, strip the mojibake chars
    return line.replace(/Ã[^\'\"\`\n;{}]*/g, '');
  }).join('\n');

  fs.writeFileSync(filePath, cleaned, 'utf8');
  console.log('Cleaned comments in:', filePath);
});
