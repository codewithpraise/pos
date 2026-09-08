const fs = require('fs');
const path = require('path');

const srcApk = path.join(__dirname, '..', 'android/app/build/outputs/apk/debug/app-debug.apk');
if (!fs.existsSync(srcApk)) {
  console.error('Source APK does not exist:', srcApk);
  process.exit(1);
}

const stats = fs.statSync(srcApk);
console.log(`Source APK size: ${(stats.size / 1024 / 1024).toFixed(2)} MB (${stats.size} bytes)`);

const targets = [
  'public/downloads/valenixia-pos.apk'
];

targets.forEach(relPath => {
  const dest = path.join(__dirname, '..', relPath);
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(srcApk, dest);
  console.log(`Copied to: ${relPath} (${fs.statSync(dest).size} bytes)`);
});

console.log('All APK targets populated successfully!');
