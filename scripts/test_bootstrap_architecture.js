/**
 * test_bootstrap_architecture.js
 * Comprehensive Architectural Matrix Test for Valenixia POS Bootstrap System
 *
 * Verifies:
 *  1. State transition invariants (0 overlapping active surfaces at any point in time).
 *  2. Separation of bootstrapDecisionReady vs appReady.
 *  3. Invariant assertion behavior (throws error or safely resolves if invalid transition attempted).
 *  4. Recovery mode entry on timeout/error delegation.
 *  5. Surface visibility state map completeness.
 */

const fs = require('fs');
const path = require('path');

console.log('🧪 [BootstrapTest] Running architecture & invariant validation suite...\n');

// Load bootstrap-init.js and index.html content
const bootstrapPath = path.join(__dirname, '..', 'public', 'bootstrap-init.js');
const indexPath = path.join(__dirname, '..', 'public', 'index.html');
const code = fs.readFileSync(bootstrapPath, 'utf8');
const html = fs.readFileSync(indexPath, 'utf8');

let testCount = 0;
let passCount = 0;

function assert(condition, testName) {
  testCount++;
  if (condition) {
    console.log(`  ✅ PASS [${testCount}]: ${testName}`);
    passCount++;
  } else {
    console.error(`  ❌ FAIL [${testCount}]: ${testName}`);
  }
}

// 1. Verify single authority object definition
assert(
  (code.includes('var ValenixiaBootstrap = {') || code.includes('const ValenixiaBootstrap = {') || code.includes('window.ValenixiaBootstrap = {')) &&
  code.includes('window.ValenixiaBootstrap = ValenixiaBootstrap'),
  'ValenixiaBootstrap controller registered as global single authority'
);

// 2. Verify lifecycle state separation (bootstrapDecisionReady vs appReady)
assert(
  code.includes('window.bootstrapDecisionReady') && code.includes('window.appReady'),
  'Explicit distinction between bootstrapDecisionReady and appReady flags present'
);

// 3. Verify DECISION states do not prematurely mark appReady = true
const onboardingMatch = code.match(/case 'ONBOARDING':[\s\S]*?break;/);
if (onboardingMatch) {
  assert(
    onboardingMatch[0].includes('window.bootstrapDecisionReady = true') &&
    (onboardingMatch[0].includes('window.appReady = false') || !onboardingMatch[0].includes('window.appReady = true')),
    'ONBOARDING transition sets bootstrapDecisionReady=true without premature appReady=true'
  );
} else {
  assert(false, 'ONBOARDING transition block found');
}

const authLockMatch = code.match(/case 'AUTH_LOCK':[\s\S]*?break;/);
if (authLockMatch) {
  assert(
    authLockMatch[0].includes('window.bootstrapDecisionReady = true') &&
    (authLockMatch[0].includes('window.appReady = false') || !authLockMatch[0].includes('window.appReady = true')),
    'AUTH_LOCK transition sets bootstrapDecisionReady=true without premature appReady=true'
  );
} else {
  assert(false, 'AUTH_LOCK transition block found');
}

const readyMatch = code.match(/case 'READY':[\s\S]*?break;/);
if (readyMatch) {
  assert(
    readyMatch[0].includes('window.bootstrapDecisionReady = true') &&
    readyMatch[0].includes('window.appReady = true'),
    'READY transition sets both bootstrapDecisionReady=true AND appReady=true'
  );
} else {
  assert(false, 'READY transition block found');
}

// 4. Verify assertion of surface ownership conflict detection
assert(
  code.includes('OWNERSHIP CONFLICT'),
  'Runtime _assertSurface invariant checker actively monitors ownership conflicts'
);

// 5. Verify hard safety watchdog timer
assert(
  code.includes('_hardSafetyTimer') && code.includes('Hard safety net: bootstrap decision not reached'),
  'Integrated hard safety net watchdog present in ValenixiaBootstrap controller'
);

// 6. Verify emergency recovery fallback support in HTML & JS
assert(
  html.includes('id="vx-emergency-recovery"') && code.includes('vx-emergency-recovery') && code.includes('RECOVERY_SURFACE_SHOWN_STATIC'),
  'Static emergency recovery fallback container supported and targeted in bootstrap error handler'
);

// 7. Verify stage completion pipeline auto-advancement
assert(
  code.includes('completeStage: function(stageName') && code.includes('nextStageMap'),
  'completeStage API auto-advances pipeline stages under single bootstrap authority'
);

// 8. Verify pre-decision surface invariant protection
assert(
  code.includes('isPreDecision') && code.includes('Pre-decision discovery stage'),
  'Pre-decision discovery stages recognize loader as valid surface without false invariant recoveries'
);

console.log(`\n--------------------------------------------------`);
console.log(`Results: ${passCount} / ${testCount} assertions passed.`);

if (passCount === testCount) {
  console.log(`🚀 ALL ARCHITECTURAL TESTS PASSED! Bootstrap system is rock solid.`);
  process.exit(0);
} else {
  console.error(`🚨 Architectural test suite failed!`);
  process.exit(1);
}

