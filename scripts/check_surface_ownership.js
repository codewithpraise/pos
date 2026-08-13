/**
 * check_surface_ownership.js
 * Static Linter for Valenixia POS Bootstrap Architecture
 *
 * Ensures NO JavaScript file in public/ (except bootstrap-init.js) directly
 * mutates display, opacity, visibility, or active classes on boot surface containers.
 *
 * Prohibited surface target IDs:
 *   - #first-boot-wizard
 *   - #auth-lock-screen
 *   - #pos-app-layout
 *   - #license-lockout-overlay
 *   - #device-pairing-overlay
 *   - #app-boot-loader
 *   - #splash-screen
 *
 * ONLY ValenixiaBootstrap (in bootstrap-init.js) is allowed to mutate these surfaces.
 */

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const EXEMPT_FILES = ['bootstrap-init.js'];

const PROHIBITED_SURFACE_IDS = [
  'first-boot-wizard',
  'auth-lock-screen',
  'pos-app-layout',
  'license-lockout-overlay',
  'device-pairing-overlay',
  'app-boot-loader',
  'splash-screen'
];

console.log('🔍 [SurfaceCheck] Scanning JavaScript files for surface ownership violations...\n');

let violationsFound = 0;
let filesScanned = 0;

function scanDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(PUBLIC_DIR, fullPath);

    if (entry.isDirectory()) {
      scanDirectory(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      if (EXEMPT_FILES.includes(entry.name)) {
        console.log(`  [EXEMPT] ${relPath} (Sole surface authority)`);
        continue;
      }

      filesScanned++;
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        // Skip comment lines
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;

        PROHIBITED_SURFACE_IDS.forEach(surfaceId => {
          if (line.includes(surfaceId)) {
            // Check for direct mutation patterns
            const hasMutationPattern = 
              line.includes('.style.display') ||
              line.includes('.style.opacity') ||
              line.includes('.style.visibility') ||
              line.includes('.classList.add') ||
              line.includes('.classList.remove') ||
              line.includes('.remove()');

            if (hasMutationPattern) {
              console.error(`❌ [VIOLATION] ${relPath}:${index + 1}`);
              console.error(`   Line: ${line.trim()}`);
              console.error(`   Target Surface: #${surfaceId}`);
              console.error(`   Reason: Direct DOM mutation on surface container by non-owner file.\n`);
              violationsFound++;
            }
          }
        });
      });
    }
  }
}

scanDirectory(PUBLIC_DIR);

console.log(`--------------------------------------------------`);
console.log(`Scan Complete: ${filesScanned} files evaluated.`);

if (violationsFound > 0) {
  console.error(`🚨 FAIL: ${violationsFound} surface ownership violation(s) detected!`);
  console.error(`All surface visibility changes MUST delegate to ValenixiaBootstrap.transition().`);
  process.exit(1);
} else {
  console.log(`✅ SUCCESS: 0 surface ownership violations found! Architecture rule verified.`);
  process.exit(0);
}
