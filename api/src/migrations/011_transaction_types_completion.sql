-- =====================================================
-- Migration 011: Transaction Types & Completion Methods
-- =====================================================
-- This migration adds:
-- 1. Transaction type and completion method columns
-- 2. Delivery code columns for physical products
-- 3. Service completion tracking
-- 4. Receipt evidence table
-- 5. Cancellation tracking
-- =====================================================

-- =====================================================
-- 1. TRANSACTION TYPE & COMPLETION METHOD
-- =====================================================

-- Add transaction type
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS transaction_type VARCHAR(50);
COMMENT ON COLUMN escrows.transaction_type IS 'physical_product, digital_product, service, currency_exchange, other';

-- Add completion method
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS completion_method VARCHAR(50);
COMMENT ON COLUMN escrows.completion_method IS 'delivery_code, sender_release, service_approval, receipt_evidence, dispute_resolution, mutual_cancellation';

-- =====================================================
-- 2. DELIVERY CODE (Physical Products)
-- =====================================================

-- Delivery code (6-digit, shown only to sender)
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS delivery_code VARCHAR(6);
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS delivery_code_hash VARCHAR(64);
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS code_attempts INTEGER DEFAULT 0;
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS code_used BOOLEAN DEFAULT false;
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS code_expires_at TIMESTAMPTZ;
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS code_verified_at TIMESTAMPTZ;

-- Index for code lookup (hash only for security)
CREATE INDEX IF NOT EXISTS idx_escrows_delivery_code_hash ON escrows(delivery_code_hash) WHERE delivery_code_hash IS NOT NULL;

-- =====================================================
-- 3. SERVICE TRACKING (Services)
-- =====================================================

ALTER TABLE escrows ADD COLUMN IF NOT EXISTS service_completed_at TIMESTAMPTZ;
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS service_proof_url TEXT;
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS service_completion_notes TEXT;

-- =====================================================
-- 4. SENDER CONFIRMATION
-- =====================================================

ALTER TABLE escrows ADD COLUMN IF NOT EXISTS sender_confirmed_at TIMESTAMPTZ;

-- =====================================================
-- 5. RECEIPT EVIDENCE (Trade Agreement / External Payment Arrangement)
-- =====================================================

ALTER TABLE escrows ADD COLUMN IF NOT EXISTS receipt_uploaded_at TIMESTAMPTZ;
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS receipt_confirmed_at TIMESTAMPTZ;

-- Completion evidence table for receipts and proofs
CREATE TABLE IF NOT EXISTS completion_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Links
    escrow_id UUID NOT NULL REFERENCES escrows(id) ON DELETE CASCADE,
    submitted_by UUID NOT NULL REFERENCES users(id),
    
    -- Evidence details
    evidence_type VARCHAR(50) NOT NULL,
    -- Types: receipt, bank_transfer, cash_receipt, proof_of_work, screenshot, other
    
    title VARCHAR(255),
    description TEXT,
    
    -- File info
    file_url TEXT,
    file_type VARCHAR(100),
    file_size INTEGER,
    
    -- Metadata
    metadata JSONB,
    
    -- Verification
    verified BOOLEAN DEFAULT false,
    verified_by UUID REFERENCES users(id),
    verified_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for evidence
CREATE INDEX IF NOT EXISTS idx_completion_evidence_escrow_id ON completion_evidence(escrow_id);
CREATE INDEX IF NOT EXISTS idx_completion_evidence_submitted_by ON completion_evidence(submitted_by);

-- =====================================================
-- 6. CANCELLATION TRACKING
-- =====================================================

ALTER TABLE escrows ADD COLUMN IF NOT EXISTS cancellation_requested_by UUID REFERENCES users(id);
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ;
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS cancellation_approved_by UUID REFERENCES users(id);
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- =====================================================
-- 7. STATUS VALUES UPDATE
-- =====================================================

-- Update status check to include new statuses
-- Status values now include:
-- pending, held, code_verified, service_completed, sender_confirmed, 
-- receipt_uploaded, receipt_confirmed, releasing, released,
-- disputed, refunded, cancelled, expired

COMMENT ON COLUMN escrows.status IS 
'Escrow status: pending|held|code_verified|service_completed|sender_confirmed|receipt_uploaded|receipt_confirmed|releasing|released|disputed|refunded|cancelled|expired';

-- =====================================================
-- 8. INDEXES FOR QUERIES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_escrows_transaction_type ON escrows(transaction_type);
CREATE INDEX IF NOT EXISTS idx_escrows_completion_method ON escrows(completion_method);
CREATE INDEX IF NOT EXISTS idx_escrows_code_used ON escrows(code_used) WHERE code_used = false;

-- =====================================================
-- 9. RLS POLICIES
-- =====================================================

ALTER TABLE completion_evidence ENABLE ROW LEVEL SECURITY;

-- Evidence viewable by escrow parties
DROP POLICY IF EXISTS "Escrow parties can view evidence" ON completion_evidence;
CREATE POLICY "Escrow parties can view evidence" ON completion_evidence
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM escrows e
            WHERE e.id = completion_evidence.escrow_id
            AND (e.sender_id = auth.uid() OR e.recipient_id = auth.uid())
        )
    );

-- Users can add evidence to their escrows
DROP POLICY IF EXISTS "Users can add evidence" ON completion_evidence;
CREATE POLICY "Users can add evidence" ON completion_evidence
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM escrows e
            WHERE e.id = completion_evidence.escrow_id
            AND (e.sender_id = auth.uid() OR e.recipient_id = auth.uid())
        )
    );

-- =====================================================
-- 10. SECURITY: Hide delivery code from recipient
-- =====================================================

-- Create view that hides delivery code from non-owners
-- Use SECURITY INVOKER so RLS policies apply to querying user
DROP VIEW IF EXISTS escrows_safe;
CREATE VIEW escrows_safe 
WITH (security_invoker = on) AS
SELECT
    e.id,
    e.sender_id,
    e.recipient_id,
    e.amount,
    e.status,
    e.reference_id,
    e.pmarts_reference,
    e.note,
    e.transaction_type,
    e.completion_method,
    CASE 
        WHEN e.sender_id = auth.uid() THEN e.delivery_code
        ELSE NULL
    END as delivery_code,
    e.code_used,
    e.code_expires_at,
    e.service_completed_at,
    e.sender_confirmed_at,
    e.receipt_uploaded_at,
    e.receipt_confirmed_at,
    e.created_at,
    e.expires_at,
    e.released_at,
    e.refunded_at
FROM escrows e;

-- Grant access to view
GRANT SELECT ON escrows_safe TO authenticated;

-- =====================================================
-- 11. HELPER FUNCTION FOR CODE VERIFICATION
-- =====================================================

CREATE OR REPLACE FUNCTION increment_code_attempts(p_escrow_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_attempts INTEGER;
BEGIN
    UPDATE escrows
    SET code_attempts = code_attempts + 1
    WHERE id = p_escrow_id
    RETURNING code_attempts INTO v_attempts;
    
    RETURN v_attempts;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- =====================================================
-- END MIGRATION 011
-- =====================================================

