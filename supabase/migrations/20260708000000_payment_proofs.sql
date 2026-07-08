-- Supabase Cloud Migration: Manual Payment Proofs & Storage Bucket
-- Migration Version: 20260708000000

-- Create type enum for strict state boundaries
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
        CREATE TYPE payment_status AS ENUM ('pending', 'approved', 'rejected');
    END IF;
END$$;

-- Create payment_proofs table
CREATE TABLE IF NOT EXISTS payment_proofs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    plan_id TEXT NOT NULL,
    rrn_reference TEXT UNIQUE NOT NULL, -- Core NayaPay unique reference number to prevent duplicate claims
    amount DECIMAL(10, 2) NOT NULL,
    proof_image_url TEXT,
    status payment_status DEFAULT 'pending',
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE payment_proofs ENABLE ROW LEVEL SECURITY;

-- Indexing for instantaneous lookup in the Admin view and security checks
CREATE INDEX IF NOT EXISTS idx_payment_proofs_user_status ON payment_proofs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_proofs_rrn ON payment_proofs(rrn_reference);

-- RLS policies for payment_proofs
DROP POLICY IF EXISTS "Users can insert their own payment proofs" ON payment_proofs;
CREATE POLICY "Users can insert their own payment proofs" ON payment_proofs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own payment proofs" ON payment_proofs;
CREATE POLICY "Users can view their own payment proofs" ON payment_proofs
    FOR SELECT USING (auth.uid() = user_id);

-- Storage bucket configuration for manual payment proofs
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'billing-proofs',
    'billing-proofs',
    false,
    5242880, -- 5MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for storage bucket 'billing-proofs'
-- Users may only upload to a path matching their own auth.uid()
DROP POLICY IF EXISTS "Users can upload their own proofs" ON storage.objects;
CREATE POLICY "Users can upload their own proofs" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'billing-proofs' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

-- Users may read only their own folder path
DROP POLICY IF EXISTS "Users can view their own proofs" ON storage.objects;
CREATE POLICY "Users can view their own proofs" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'billing-proofs' AND
        (storage.foldername(name))[1] = auth.uid()::text
    );

-- Admins / service-role can read/write all paths
DROP POLICY IF EXISTS "Admins can view all proofs" ON storage.objects;
CREATE POLICY "Admins can view all proofs" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'billing-proofs' AND
        (
            current_setting('role', true) = 'service_role' OR
            COALESCE(current_setting('request.headers', true)::json->>'x-user-role', '') = 'admin'
        )
    );
