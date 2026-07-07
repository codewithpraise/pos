-- 1. Create the Cloud CRDT Backup Table
CREATE TABLE IF NOT EXISTS cloud_crdt_backups (
    id BIGSERIAL PRIMARY KEY,
    store_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    pk TEXT NOT NULL,
    cid TEXT NOT NULL,
    val TEXT,
    val_type TEXT DEFAULT 'string',
    col_version BIGINT NOT NULL,
    db_version BIGINT NOT NULL,
    site_id TEXT NOT NULL,
    cl INTEGER NOT NULL,
    sync_hlc TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure no duplicate CRDT rows are ever inserted per store
    UNIQUE(store_id, table_name, pk, cid, sync_hlc)
);

-- 2. Optimize for high-speed local node querying
CREATE INDEX IF NOT EXISTS idx_crdt_store_db_version ON cloud_crdt_backups(store_id, db_version);

-- 3. Enable Row Level Security (Zero-Trust Cloud)
ALTER TABLE cloud_crdt_backups ENABLE ROW LEVEL SECURITY;

-- 4. Create an RLS Policy allowing nodes to insert/read ONLY their own store's data
-- Authenticates anonymously using the 'x-store-id' header passed by client nodes.
DROP POLICY IF EXISTS "Store Isolation Policy" ON cloud_crdt_backups;
CREATE POLICY "Store Isolation Policy" ON cloud_crdt_backups
    FOR ALL
    USING (COALESCE(current_setting('request.headers', true)::json->>'x-store-id', '') = store_id)
    WITH CHECK (COALESCE(current_setting('request.headers', true)::json->>'x-store-id', '') = store_id);

-- Backward compatibility: Alter table if it already exists in the target DB
ALTER TABLE cloud_crdt_backups ADD COLUMN IF NOT EXISTS val_type TEXT DEFAULT 'string';

-- 5. Create Cloud Schema Info Table
CREATE TABLE IF NOT EXISTS cloud_schema_info (
    key TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO cloud_schema_info (key, version) VALUES ('schema_version', 3) ON CONFLICT (key) DO UPDATE SET version = 3, updated_at = NOW();

-- 6. Backfill existing cloud_crdt_backups records with inferred types
UPDATE cloud_crdt_backups 
SET val_type = 'number' 
WHERE val_type IS NULL 
  AND val IS NOT NULL 
  AND val != '' 
  AND val ~ '^-?[0-9]+(\.[0-9]+)?$';

UPDATE cloud_crdt_backups 
SET val_type = 'boolean' 
WHERE val_type IS NULL 
  AND val IN ('true', 'false', '1', '0');

UPDATE cloud_crdt_backups 
SET val_type = 'string' 
WHERE val_type IS NULL;


