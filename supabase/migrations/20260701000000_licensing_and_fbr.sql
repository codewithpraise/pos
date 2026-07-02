-- Supabase Cloud Migration: Licensing, Billing & FBR logs
-- Migration Version: 20260701000000

-- 1. Create the Stores table
CREATE TABLE IF NOT EXISTS stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(30) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    name TEXT NOT NULL,
    tier VARCHAR(20) NOT NULL DEFAULT 'TRIAL', -- TRIAL, STARTER, PRO, ENTERPRISE
    mode VARCHAR(20) NOT NULL DEFAULT 'subscription', -- subscription, lifetime
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- active, suspended, grace_period
    expires_at TIMESTAMPTZ, -- NULL for lifetime licenses
    license_key TEXT,
    hardware_limit INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.5 Create the Activation Codes table (Device onboarding handshake)
CREATE TABLE IF NOT EXISTS activation_codes (
    code VARCHAR(6) PRIMARY KEY,
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
    phone VARCHAR(30) NOT NULL, -- Secondary validation factor
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL
);

-- 2. Create the Devices table (Hardware Whitelist)
CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
    hardware_id VARCHAR(64) UNIQUE NOT NULL, -- Widevine + Android ID hash
    device_name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create the Pending Payments table (NayaPay/Raast auditing)
CREATE TABLE IF NOT EXISTS pending_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
    tier VARCHAR(20) NOT NULL,
    mode VARCHAR(20) NOT NULL,
    amount_paid_minor_units INTEGER NOT NULL,
    gateway VARCHAR(30) NOT NULL, -- NAYAPAY, RAAST, EASYPAISA, SADAPAY
    transaction_reference VARCHAR(100) UNIQUE NOT NULL, -- RRN reference
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED
    verification_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    verified_at TIMESTAMPTZ
);

-- 4. Create the FBR Cloud Invoice Logs table (PRAL backups)
CREATE TABLE IF NOT EXISTS cloud_fbr_invoice_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
    usin VARCHAR(50) UNIQUE NOT NULL, -- Unique Sales Invoice Number
    fbr_invoice_number VARCHAR(50),
    amount_total DOUBLE PRECISION NOT NULL, -- PRAL strict double requirement
    amount_tax DOUBLE PRECISION NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- SYNCED, REJECTED
    fbr_response_code INTEGER,
    fbr_error_details TEXT,
    reported_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Optimize queries using Database Indexes
CREATE INDEX IF NOT EXISTS idx_stores_phone ON stores(phone);
CREATE INDEX IF NOT EXISTS idx_devices_store ON devices(store_id);
CREATE INDEX IF NOT EXISTS idx_payments_ref ON pending_payments(transaction_reference);
CREATE INDEX IF NOT EXISTS idx_fbr_logs_store ON cloud_fbr_invoice_logs(store_id);

-- 6. Enable Row Level Security (RLS) for Zero-Trust isolation
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE activation_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_fbr_invoice_logs ENABLE ROW LEVEL SECURITY;

-- 7. Define RLS Policies allowing nodes access ONLY to their own store data
-- Uses 'x-store-id' custom header passed anonymously by authorized sync clients

DROP POLICY IF EXISTS "Store Access Policy" ON stores;
CREATE POLICY "Store Access Policy" ON stores
    FOR ALL
    USING (COALESCE(current_setting('request.headers', true)::json->>'x-store-id', '') = id::text)
    WITH CHECK (COALESCE(current_setting('request.headers', true)::json->>'x-store-id', '') = id::text);

DROP POLICY IF EXISTS "Devices Access Policy" ON devices;
CREATE POLICY "Devices Access Policy" ON devices
    FOR ALL
    USING (COALESCE(current_setting('request.headers', true)::json->>'x-store-id', '') = store_id::text)
    WITH CHECK (COALESCE(current_setting('request.headers', true)::json->>'x-store-id', '') = store_id::text);

DROP POLICY IF EXISTS "Payments Access Policy" ON pending_payments;
CREATE POLICY "Payments Access Policy" ON pending_payments
    FOR ALL
    USING (COALESCE(current_setting('request.headers', true)::json->>'x-store-id', '') = store_id::text)
    WITH CHECK (COALESCE(current_setting('request.headers', true)::json->>'x-store-id', '') = store_id::text);

DROP POLICY IF EXISTS "FBR Logs Access Policy" ON cloud_fbr_invoice_logs;
CREATE POLICY "FBR Logs Access Policy" ON cloud_fbr_invoice_logs
    FOR ALL
    USING (COALESCE(current_setting('request.headers', true)::json->>'x-store-id', '') = store_id::text)
    WITH CHECK (COALESCE(current_setting('request.headers', true)::json->>'x-store-id', '') = store_id::text);
