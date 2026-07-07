const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../public');
const destDir = path.join(__dirname, '../android/app/src/main/assets');

// Helper to recursively collect all files in a directory
function getAllFiles(dir, relativeTo = dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      if (file !== 'apk' && file !== 'downloads') {
        results = results.concat(getAllFiles(filePath, relativeTo));
      }
    } else {
      results.push({
        absolutePath: filePath,
        relativePath: path.relative(relativeTo, filePath),
        mtime: stat.mtimeMs,
        size: stat.size
      });
    }
  });
  return results;
}

console.log('Starting sync of public assets to Android assets folder...');

const srcFiles = getAllFiles(srcDir);
const destFiles = getAllFiles(destDir);

const srcFilesMap = new Map(srcFiles.map(f => [f.relativePath, f]));
const destFilesMap = new Map(destFiles.map(f => [f.relativePath, f]));

// 1. Copy new or modified files
srcFiles.forEach((srcFile) => {
  const destFile = destFilesMap.get(srcFile.relativePath);
  const destPath = path.join(destDir, srcFile.relativePath);

  // Copy if file does not exist, or size or mtime differs
  if (!destFile || srcFile.size !== destFile.size || srcFile.mtime > destFile.mtime) {
    const parentDir = path.dirname(destPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.copyFileSync(srcFile.absolutePath, destPath);
    console.log(`Synced (Copied/Updated): ${srcFile.relativePath}`);
  }
});

// 2. Cleanup orphaned files in destination
destFiles.forEach((destFile) => {
  if (!srcFilesMap.has(destFile.relativePath)) {
    const destPath = path.join(destDir, destFile.relativePath);
    fs.unlinkSync(destPath);
    console.log(`Synced (Removed Stale): ${destFile.relativePath}`);
  }
});

// 3. Remove empty folders in destination
function removeEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  if (files.length > 0) {
    files.forEach((file) => {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        removeEmptyDirs(fullPath);
      }
    });
  }
  
  // Re-evaluate if empty now
  const remaining = fs.readdirSync(dir);
  if (remaining.length === 0 && dir !== destDir) {
    fs.rmdirSync(dir);
    console.log(`Removed empty folder: ${path.relative(destDir, dir)}`);
  }
}

removeEmptyDirs(destDir);

console.log('Synchronization complete!');
