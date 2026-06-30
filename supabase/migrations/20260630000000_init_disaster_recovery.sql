-- 1. Create the Cloud CRDT Backup Table
CREATE TABLE IF NOT EXISTS cloud_crdt_backups (
    id BIGSERIAL PRIMARY KEY,
    store_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    pk TEXT NOT NULL,
    cid TEXT NOT NULL,
    val TEXT,
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
-- (Leaving it permissive for the Alpha testing phase, as requested)
DROP POLICY IF EXISTS "Store Isolation Policy" ON cloud_crdt_backups;
CREATE POLICY "Store Isolation Policy" ON cloud_crdt_backups
    FOR ALL
    USING (true)
    WITH CHECK (true);
