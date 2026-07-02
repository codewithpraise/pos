const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../public');
const destDir = path.join(__dirname, '../android/app/src/main/assets');

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      // Skip the 'apk' directory under public if it exists
      if (childItemName === 'apk') return;
      
      copyRecursiveSync(
        path.join(src, childItemName),
        path.join(dest, childItemName)
      );
    });
  } else {
    fs.copyFileSync(src, dest);
    console.log(`Synced: ${path.relative(path.join(__dirname, '..'), dest)}`);
  }
}

console.log('Starting sync of public assets to Android assets folder...');
copyRecursiveSync(srcDir, destDir);
console.log('Synchronization complete!');
