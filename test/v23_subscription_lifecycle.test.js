// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - SUBSCRIPTION ADDON & GRACE LOCK LIFECYCLE TEST
// Verifies terminal monetization lifecycle (Add, Grace Lock, Upgrade, Restore)
// ============================================================================

const assert = require('assert');

console.log('\n══════════════════════════════════════════════════');
console.log('  VALENIXIA POS — Subscription Addon & Grace Lock Suite (v2.3)');
console.log('══════════════════════════════════════════════════\n');

let totalPassed = 0;
let totalFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    totalPassed++;
  } catch (err) {
    console.error(`  ❌ ${name}:`, err.message);
    totalFailed++;
  }
}

class TerminalLifecycleSimulator {
  constructor() {
    this.tier = 'STARTER';
    this.baseTerminalLimit = 1;
    this.purchasedAddons = 0;
    this.terminals = [
      { id: 'TERM_1', name: 'Main Counter', status: 'APPROVED' }
    ];
  }

  addTerminal(name) {
    const activeCount = this.terminals.filter(t => t.status === 'APPROVED').length;
    const allowedLimit = this.baseTerminalLimit + this.purchasedAddons;

    if (activeCount >= allowedLimit) {
      return { success: false, reason: 'Terminal limit reached. Purchase Extra Terminal add-on to register more devices.' };
    }

    const newTerm = { id: `TERM_${this.terminals.length + 1}`, name, status: 'APPROVED' };
    this.terminals.push(newTerm);
    return { success: true, terminal: newTerm };
  }

  purchaseAddon() {
    this.purchasedAddons++;
    // Restore grace locked terminals if limit permits
    this.reevaluateTerminals();
  }

  cancelAddon() {
    if (this.purchasedAddons > 0) this.purchasedAddons--;
    this.reevaluateTerminals();
  }

  reevaluateTerminals() {
    const allowedLimit = this.baseTerminalLimit + this.purchasedAddons;
    let approvedCount = 0;

    for (const term of this.terminals) {
      if (term.status === 'APPROVED' || term.status === 'GRACE_LOCKED') {
        if (approvedCount < allowedLimit) {
          term.status = 'APPROVED';
          approvedCount++;
        } else {
          term.status = 'GRACE_LOCKED';
        }
      }
    }
  }
}

runTest('Starter Plan (1 terminal): Registering 2nd terminal BLOCKED', () => {
  const sim = new TerminalLifecycleSimulator();
  const res = sim.addTerminal('Second Counter');
  assert.strictEqual(res.success, false);
  assert.ok(res.reason.includes('Terminal limit reached'));
});

runTest('Purchase Addon -> Register 2nd terminal: Terminal ACTIVATED', () => {
  const sim = new TerminalLifecycleSimulator();
  sim.purchaseAddon();
  const res = sim.addTerminal('Second Counter');
  assert.strictEqual(res.success, true);
  assert.strictEqual(sim.terminals[1].status, 'APPROVED');
});

runTest('Remove Addon: 2nd terminal enters GRACE_LOCKED state without data deletion', () => {
  const sim = new TerminalLifecycleSimulator();
  sim.purchaseAddon();
  sim.addTerminal('Second Counter');

  sim.cancelAddon();
  assert.strictEqual(sim.terminals[0].status, 'APPROVED');
  assert.strictEqual(sim.terminals[1].status, 'GRACE_LOCKED', 'Excess terminal must be GRACE_LOCKED');
});

runTest('Re-purchase Addon / Upgrade: GRACE_LOCKED terminal restored to APPROVED', () => {
  const sim = new TerminalLifecycleSimulator();
  sim.purchaseAddon();
  sim.addTerminal('Second Counter');
  sim.cancelAddon();
  assert.strictEqual(sim.terminals[1].status, 'GRACE_LOCKED');

  sim.purchaseAddon();
  assert.strictEqual(sim.terminals[1].status, 'APPROVED', 'Terminal restored automatically');
});

console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);
process.exit(totalFailed === 0 ? 0 : 1);
