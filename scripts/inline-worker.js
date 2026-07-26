const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const outFile = path.join(publicDir, 'worker-inline.js');

// Read worker dependencies in order
const clientDb = fs.readFileSync(path.join(publicDir, 'client-db.js'), 'utf8');
const clientSync = fs.readFileSync(path.join(publicDir, 'client-sync.js'), 'utf8');
let syncWorker = fs.readFileSync(path.join(publicDir, 'sync-worker.js'), 'utf8');

// Strip importScripts calls from syncWorker since dependencies are prepended
syncWorker = syncWorker.replace(/importScripts\s*\([^)]+\)\s*;?/g, '/* importScripts inlined below */');

// Helper to escape backslashes, backticks, and template literals
const escapeCode = (s) => s
  .replace(/\\/g, '\\\\')
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${');

const output = `// AUTO-GENERATED: Inlined worker for mobile APK (file:// protocol)
window.__VALENIXIA_WORKER_CODE = \`${escapeCode(clientDb)}\n${escapeCode(clientSync)}\n${escapeCode(syncWorker)}\`;

window.createInlineWorker = function() {
  try {
    const blob = new Blob([window.__VALENIXIA_WORKER_CODE], {type: 'application/javascript'});
    const url = URL.createObjectURL(blob);
    console.log('[WorkerInline] Created blob worker from inlined code (' + window.__VALENIXIA_WORKER_CODE.length + ' chars)');
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    return w;
  } catch(e) {
    console.error('[WorkerInline] Blob worker creation failed:', e);
    return null;
  }
};
`;

fs.writeFileSync(outFile, output);
console.log('Generated worker-inline.js (' + output.length + ' bytes)');
