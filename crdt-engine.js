// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - CRDT & HLC ENGINE
// Optimized for Conflict-Free Replicated Data Types & Lamport Ordering
// ============================================================================

const crypto = require('crypto');

class HLC {
  constructor(nodeId) {
    this.nodeId = nodeId || crypto.randomUUID();
    this.l = 0; // Physical time component
    this.c = 0; // Logical counter component
  }

  // Generate HLC string representation: l:c:nodeId
  toString() {
    return `${this.l.toString().padStart(15, '0')}:${this.c.toString().padStart(6, '0')}:${this.nodeId}`;
  }

  // Parse HLC string back to object
  static parse(hlcStr) {
    const parts = hlcStr.split(':');
    if (parts.length < 3) throw new Error('Invalid HLC string format');
    return {
      l: parseInt(parts[0], 10),
      c: parseInt(parts[1], 10),
      nodeId: parts.slice(2).join(':')
    };
  }

  // Update clock based on a local event
  tick() {
    const physical = Date.now();
    if (physical > this.l) {
      this.l = physical;
      this.c = 0;
    } else {
      this.c += 1;
    }
    return this.toString();
  }

  // Update clock based on a remote HLC timestamp
  merge(remoteHlcStr) {
    const physical = Date.now();
    const remote = HLC.parse(remoteHlcStr);
    const DRIFT_LIMIT_MS = 300000;
    const adjustedRemoteL = (remote.l - physical > DRIFT_LIMIT_MS) ? physical : remote.l;
    const maxL = Math.max(this.l, adjustedRemoteL, physical);

    if (maxL === this.l && maxL === adjustedRemoteL) {
      this.c = Math.max(this.c, remote.c) + 1;
    } else if (maxL === adjustedRemoteL) {
      this.c = remote.c + 1;
    } else if (maxL === this.l) {
      this.c += 1;
    } else {
      this.c = 0;
    }
    this.l = maxL;
    return this.toString();
  }

  // Compare two HLC strings (string comparison works due to zero-padding)
  static compare(hlc1, hlc2) {
    if (hlc1 > hlc2) return 1;
    if (hlc1 < hlc2) return -1;
    return 0;
  }
}

/**
 * Merges an incoming CRDT delta change into the local changes store.
 * Returns true if the incoming change is newer (Last-Write-Wins) and should be applied.
 */
function shouldApplyDelta(localChange, incomingChange) {
  if (!localChange) return true; // No record exists, apply it
  
  // Last-Write-Wins comparison based on col_version first, then sync_hlc
  if (incomingChange.col_version > localChange.col_version) return true;
  if (incomingChange.col_version < localChange.col_version) return false;
  
  return HLC.compare(incomingChange.sync_hlc, localChange.sync_hlc) > 0;
}

module.exports = {
  HLC,
  shouldApplyDelta
};
