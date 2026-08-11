-- Supabase Cloud Migration: Organization, Branch, Member Hierarchy & Event Auditing
-- Migration Version: 20260811000000

-- 1. Create Profiles / Accounts Table linked to auth.users
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    phone VARCHAR(30) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    display_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create Organizations Table
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    tax_id VARCHAR(50),
    tier VARCHAR(20) NOT NULL DEFAULT 'FREE',
    billing_mode VARCHAR(20) NOT NULL DEFAULT 'monthly',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create Organization Members Table
CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL DEFAULT 'owner', -- 'owner', 'admin', 'branch_manager', 'cashier', 'accountant', 'auditor'
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, account_id)
);

-- 4. Create Branches Table
CREATE TABLE IF NOT EXISTS branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    address TEXT,
    phone VARCHAR(30),
    fbr_pos_id VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Extend Existing Stores & Devices Tables with Backward Compatibility
ALTER TABLE stores ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS installation_id VARCHAR(64);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS terminal_secret_hash TEXT;

-- 6. Create Data-Driven Entitlement Configuration Tables
CREATE TABLE IF NOT EXISTS plan_entitlements (
    tier VARCHAR(20) PRIMARY KEY,
    max_branches INTEGER NOT NULL,
    max_terminals INTEGER NOT NULL,
    max_products INTEGER NOT NULL,
    features_json JSONB NOT NULL
);

INSERT INTO plan_entitlements (tier, max_branches, max_terminals, max_products, features_json)
VALUES 
    ('FREE', 1, 1, 25, '{"csv_import": true, "fbr": true, "analytics": "basic"}'::jsonb),
    ('STARTER', 1, 1, 2147483647, '{"csv_import": true, "fbr": true, "manual_backup": true, "logs": true, "analytics": "basic"}'::jsonb),
    ('PRO', 1, 2, 2147483647, '{"csv_import": true, "fbr": true, "manual_backup": true, "logs": true, "deals": true, "multi_device": true, "whatsapp_reminders": true, "analytics": "advanced"}'::jsonb),
    ('ENTERPRISE', 2, 3, 2147483647, '{"csv_import": true, "fbr": true, "manual_backup": true, "logs": true, "deals": true, "multi_device": true, "whatsapp_reminders": true, "api_access": true, "white_label": true, "analytics": "full"}'::jsonb)
ON CONFLICT (tier) DO UPDATE SET 
    max_branches = EXCLUDED.max_branches,
    max_terminals = EXCLUDED.max_terminals,
    max_products = EXCLUDED.max_products,
    features_json = EXCLUDED.features_json;

CREATE TABLE IF NOT EXISTS addon_pricing (
    addon_type VARCHAR(30) NOT NULL,
    min_qty INTEGER NOT NULL,
    max_qty INTEGER NOT NULL,
    price_pkr_monthly INTEGER NOT NULL,
    PRIMARY KEY (addon_type, min_qty)
);

INSERT INTO addon_pricing (addon_type, min_qty, max_qty, price_pkr_monthly)
VALUES
    ('extra_terminal', 1, 1, 1200),
    ('extra_terminal', 2, 5, 1000),
    ('extra_terminal', 6, 10, 900),
    ('extra_terminal', 11, 100, 800),
    ('extra_branch', 1, 100, 3500)
ON CONFLICT (addon_type, min_qty) DO UPDATE SET 
    max_qty = EXCLUDED.max_qty,
    price_pkr_monthly = EXCLUDED.price_pkr_monthly;

-- 7. Create Inventory Events Table (Transactional Stock Ledger)
CREATE TABLE IF NOT EXISTS inventory_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    terminal_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    product_id UUID NOT NULL,
    sku_snapshot VARCHAR(100) NOT NULL,
    operation VARCHAR(20) NOT NULL, -- 'SALE', 'RETURN', 'ADJUSTMENT', 'PO_RESTOCK'
    quantity_delta INTEGER NOT NULL,
    transaction_id VARCHAR(100),
    hlc_timestamp VARCHAR(50) NOT NULL,
    idempotency_key VARCHAR(128) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Create Deals & Bundle Tables
CREATE TABLE IF NOT EXISTS deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    bundle_price INTEGER NOT NULL,
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deal_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1
);

-- 9. Create Cryptographically Linked Business Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
    terminal_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    actor_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    network_ip VARCHAR(45),
    client_version VARCHAR(30),
    installation_id VARCHAR(64),
    request_id VARCHAR(64),
    before_state_json JSONB,
    after_state_json JSONB,
    previous_hash VARCHAR(64) NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
    event_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Create Indexes for High-Performance Queries
CREATE INDEX IF NOT EXISTS idx_accounts_phone ON accounts(phone);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_acc ON organization_members(account_id);
CREATE INDEX IF NOT EXISTS idx_branches_org ON branches(organization_id);
CREATE INDEX IF NOT EXISTS idx_inventory_events_sku ON inventory_events(organization_id, sku_snapshot);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_deals_org ON deals(organization_id);

-- 11. Enable Row Level Security (RLS)
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- 12. Helper Function for RLS Membership Verification
CREATE OR REPLACE FUNCTION is_org_member(org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
    AND account_id = auth.uid()
    AND status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 13. RLS Security Policies
DROP POLICY IF EXISTS "Account Self View Policy" ON accounts;
CREATE POLICY "Account Self View Policy" ON accounts
    FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Account Self Update Policy" ON accounts;
CREATE POLICY "Account Self Update Policy" ON accounts
    FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Org Member Read Policy" ON organizations;
CREATE POLICY "Org Member Read Policy" ON organizations
    FOR SELECT USING (is_org_member(id));

DROP POLICY IF EXISTS "Org Member Update Policy" ON organizations;
CREATE POLICY "Org Member Update Policy" ON organizations
    FOR UPDATE USING (is_org_member(id));

DROP POLICY IF EXISTS "Org Members View Policy" ON organization_members;
CREATE POLICY "Org Members View Policy" ON organization_members
    FOR SELECT USING (is_org_member(organization_id));

DROP POLICY IF EXISTS "Branch Org Member Access Policy" ON branches;
CREATE POLICY "Branch Org Member Access Policy" ON branches
    FOR ALL USING (is_org_member(organization_id));

DROP POLICY IF EXISTS "Inventory Event Access Policy" ON inventory_events;
CREATE POLICY "Inventory Event Access Policy" ON inventory_events
    FOR ALL USING (is_org_member(organization_id));

DROP POLICY IF EXISTS "Deals Access Policy" ON deals;
CREATE POLICY "Deals Access Policy" ON deals
    FOR ALL USING (is_org_member(organization_id));

DROP POLICY IF EXISTS "Audit Log Access Policy" ON audit_logs;
CREATE POLICY "Audit Log Access Policy" ON audit_logs
    FOR SELECT USING (is_org_member(organization_id));

-- 14. Idempotent Data Backfill: Migrate Existing Stores to Organizations & Branches
DO $$
DECLARE
    store_rec RECORD;
    new_org_id UUID;
    new_branch_id UUID;
    new_acc_id UUID;
BEGIN
    FOR store_rec IN SELECT * FROM stores WHERE organization_id IS NULL LOOP
        -- Generate UUID for organization
        new_org_id := gen_random_uuid();
        
        -- Create Organization
        INSERT INTO organizations (id, name, tier, mode, status, expires_at, created_at)
        VALUES (new_org_id, store_rec.name, store_rec.tier, store_rec.mode, store_rec.status, store_rec.expires_at, store_rec.created_at)
        ON CONFLICT DO NOTHING;

        -- Create Default Primary Branch
        new_branch_id := gen_random_uuid();
        INSERT INTO branches (id, organization_id, name, city, phone, created_at)
        VALUES (new_branch_id, new_org_id, store_rec.name || ' (Primary Branch)', 'Main', store_rec.phone, store_rec.created_at)
        ON CONFLICT DO NOTHING;

        -- Link store record to organization
        UPDATE stores SET organization_id = new_org_id WHERE id = store_rec.id;

        -- Link existing devices of this store to organization and primary branch
        UPDATE devices 
        SET organization_id = new_org_id, branch_id = new_branch_id 
        WHERE store_id = store_rec.id AND organization_id IS NULL;
    END LOOP;
END$$;
