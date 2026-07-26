-- ============================================================================
-- VALENIXIA POS - Migration 20260722000000_ack_versions_and_hardening
-- Adds ack_versions table for safe peer CRDT pruning and enhances audit logging
-- ============================================================================

-- Track minimum ACK versions across peer terminals for safe CRDT tombstone GC
CREATE TABLE IF NOT EXISTS ack_versions (
  node_id TEXT PRIMARY KEY,
  last_ack_version BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT
);

-- Ensure admin_audit_log has proper indexes for security monitoring
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ack_versions_ver ON ack_versions(last_ack_version);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action, created_at);
