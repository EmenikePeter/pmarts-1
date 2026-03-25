-- =====================================================
-- Migration 009: Escrow Wallet Architecture
-- =====================================================
-- This migration adds:
-- 1. Enhanced escrows table columns
-- 2. Master wallet ledger system
-- 3. Fraud assessment tracking
-- 4. Enhanced disputes system
-- 5. System accounts for double-entry bookkeeping
-- =====================================================

-- =====================================================
-- 1. ENHANCE ESCROWS TABLE
-- =====================================================

-- Add new columns to escrows table
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS pmarts_reference VARCHAR(50) UNIQUE;
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS pi_payment_id VARCHAR(100);
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS pi_txid VARCHAR(100);
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS risk_score INTEGER DEFAULT 0;
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS fraud_flags JSONB;
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS fee_amount DECIMAL(20, 7) DEFAULT 0;
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS net_amount DECIMAL(20, 7);
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS refund_reason TEXT;
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

-- Create index for payment lookups
CREATE INDEX IF NOT EXISTS idx_escrows_pi_payment_id ON escrows(pi_payment_id);
CREATE INDEX IF NOT EXISTS idx_escrows_pi_txid ON escrows(pi_txid);
CREATE INDEX IF NOT EXISTS idx_escrows_pmarts_reference ON escrows(pmarts_reference);
CREATE INDEX IF NOT EXISTS idx_escrows_risk_score ON escrows(risk_score);

-- =====================================================
-- 2. ESCROW LEDGER (DOUBLE-ENTRY BOOKKEEPING)
-- =====================================================

CREATE TABLE IF NOT EXISTS escrow_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Transaction identification
    escrow_id UUID REFERENCES escrows(id),
    payment_id VARCHAR(100),
    
    -- Action type
    action VARCHAR(50) NOT NULL,
    -- Actions: DEPOSIT, RELEASE, REFUND, FEE_COLLECTION, ADJUSTMENT
    
    -- Accounts (double-entry)
    from_account VARCHAR(100) NOT NULL,
    to_account VARCHAR(100) NOT NULL,
    -- Accounts: user:{user_id}, escrow_holdings, fee_revenue, pending_payouts
    
    -- Amount
    amount DECIMAL(20, 7) NOT NULL,
    
    -- Reference data
    reference_type VARCHAR(50),
    reference_id VARCHAR(100),
    
    -- Metadata
    performed_by UUID REFERENCES users(id),
    notes TEXT,
    metadata JSONB,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Immutable after creation (append-only ledger)
    CONSTRAINT ledger_immutable CHECK (true)
);

-- Ensure escrow_ledger has required columns (in case table already existed from migration 005)
ALTER TABLE escrow_ledger ADD COLUMN IF NOT EXISTS from_account VARCHAR(100);
ALTER TABLE escrow_ledger ADD COLUMN IF NOT EXISTS to_account VARCHAR(100);
ALTER TABLE escrow_ledger ADD COLUMN IF NOT EXISTS payment_id VARCHAR(100);
ALTER TABLE escrow_ledger ADD COLUMN IF NOT EXISTS reference_type VARCHAR(50);
ALTER TABLE escrow_ledger ADD COLUMN IF NOT EXISTS reference_id VARCHAR(100);
ALTER TABLE escrow_ledger ADD COLUMN IF NOT EXISTS performed_by UUID;
ALTER TABLE escrow_ledger ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Indexes for ledger queries
CREATE INDEX IF NOT EXISTS idx_ledger_escrow_id ON escrow_ledger(escrow_id);
CREATE INDEX IF NOT EXISTS idx_ledger_action ON escrow_ledger(action);
CREATE INDEX IF NOT EXISTS idx_ledger_created_at ON escrow_ledger(created_at);

-- Add column indexes only if columns exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'escrow_ledger' AND column_name = 'from_account') THEN
        CREATE INDEX IF NOT EXISTS idx_ledger_from_account ON escrow_ledger(from_account);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'escrow_ledger' AND column_name = 'to_account') THEN
        CREATE INDEX IF NOT EXISTS idx_ledger_to_account ON escrow_ledger(to_account);
    END IF;
END $$;

-- Prevent updates and deletes on ledger (append-only)
DROP FUNCTION IF EXISTS prevent_ledger_modification() CASCADE;
CREATE OR REPLACE FUNCTION prevent_ledger_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Ledger entries are immutable and cannot be modified';
END;
$$ LANGUAGE plpgsql SET search_path = '';

DROP TRIGGER IF EXISTS prevent_ledger_update ON escrow_ledger;
CREATE TRIGGER prevent_ledger_update
    BEFORE UPDATE OR DELETE ON escrow_ledger
    FOR EACH ROW
    EXECUTE FUNCTION prevent_ledger_modification();

-- =====================================================
-- 3. SYSTEM ACCOUNTS (FOR WALLET TRACKING)
-- =====================================================

CREATE TABLE IF NOT EXISTS system_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Account identification
    account_name VARCHAR(100) UNIQUE NOT NULL,
    account_type VARCHAR(50) NOT NULL,
    -- Types: HOLDING, REVENUE, PAYOUT, RESERVE
    
    -- Balance tracking
    balance DECIMAL(20, 7) DEFAULT 0,
    pending_balance DECIMAL(20, 7) DEFAULT 0,
    
    -- Metadata
    description TEXT,
    metadata JSONB,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns to system_accounts (may have been created by earlier migration)
ALTER TABLE system_accounts ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE system_accounts ADD COLUMN IF NOT EXISTS pending_balance DECIMAL(20, 7) DEFAULT 0;
ALTER TABLE system_accounts ADD COLUMN IF NOT EXISTS metadata JSONB;

-- No insert - system_accounts already populated by migration 008

-- =====================================================
-- 4. FRAUD ASSESSMENTS
-- =====================================================

CREATE TABLE IF NOT EXISTS fraud_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Assessment target
    escrow_id UUID REFERENCES escrows(id),
    user_id UUID REFERENCES users(id),
    
    -- Assessment results
    risk_score INTEGER NOT NULL,
    risk_level VARCHAR(20) NOT NULL,
    -- Levels: LOW, MEDIUM, HIGH, CRITICAL
    
    -- Decision
    approved BOOLEAN NOT NULL,
    requires_review BOOLEAN DEFAULT false,
    delay_minutes INTEGER DEFAULT 0,
    
    -- Flags raised
    flags JSONB,
    -- Flag types: VELOCITY_EXCEEDED, SUSPICIOUS_PATTERN, LINKED_FRAUD_ACCOUNT, etc.
    
    -- Check details
    velocity_check JSONB,
    device_check JSONB,
    behavioral_check JSONB,
    network_check JSONB,
    
    -- Metadata
    device_info JSONB,
    ip_address INET,
    
    -- Review (if required)
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fraud assessments
CREATE INDEX IF NOT EXISTS idx_fraud_escrow_id ON fraud_assessments(escrow_id);
CREATE INDEX IF NOT EXISTS idx_fraud_user_id ON fraud_assessments(user_id);
CREATE INDEX IF NOT EXISTS idx_fraud_risk_level ON fraud_assessments(risk_level);
CREATE INDEX IF NOT EXISTS idx_fraud_requires_review ON fraud_assessments(requires_review) WHERE requires_review = true;

-- =====================================================
-- 5. ENHANCED DISPUTES
-- =====================================================

-- Add columns to disputes table if they don't exist
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS response_text TEXT;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS response_deadline TIMESTAMPTZ;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS claimed_by UUID REFERENCES users(id);
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS resolution_type VARCHAR(50);
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS sender_amount DECIMAL(20, 7);
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS recipient_amount DECIMAL(20, 7);
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS auto_escalated BOOLEAN DEFAULT false;

-- =====================================================
-- 6. DISPUTE EVIDENCE
-- =====================================================

CREATE TABLE IF NOT EXISTS dispute_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Links
    dispute_id UUID REFERENCES disputes(id) ON DELETE CASCADE,
    submitted_by UUID REFERENCES users(id),
    
    -- Evidence details
    evidence_type VARCHAR(50),
    -- Types: SCREENSHOT, CHAT_LOG, RECEIPT, VIDEO, DOCUMENT, OTHER
    
    title VARCHAR(255),
    description TEXT,
    
    -- File info
    file_url TEXT,
    file_type VARCHAR(100),
    file_size INTEGER,
    
    -- Verification
    verified BOOLEAN DEFAULT false,
    verified_by UUID REFERENCES users(id),
    verified_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns to dispute_evidence (may exist from migration 002)
ALTER TABLE dispute_evidence ADD COLUMN IF NOT EXISTS dispute_id UUID REFERENCES disputes(id);
ALTER TABLE dispute_evidence ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id);
ALTER TABLE dispute_evidence ADD COLUMN IF NOT EXISTS evidence_type VARCHAR(50);
ALTER TABLE dispute_evidence ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE dispute_evidence ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE dispute_evidence ADD COLUMN IF NOT EXISTS file_type VARCHAR(100);
ALTER TABLE dispute_evidence ADD COLUMN IF NOT EXISTS file_size INTEGER;
ALTER TABLE dispute_evidence ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false;
ALTER TABLE dispute_evidence ADD COLUMN IF NOT EXISTS verified_by UUID;
ALTER TABLE dispute_evidence ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- Indexes for evidence (conditionally create based on column existence)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dispute_evidence' AND column_name = 'dispute_id') THEN
        CREATE INDEX IF NOT EXISTS idx_evidence_dispute_id ON dispute_evidence(dispute_id);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dispute_evidence' AND column_name = 'submitted_by') THEN
        CREATE INDEX IF NOT EXISTS idx_evidence_submitted_by ON dispute_evidence(submitted_by);
    END IF;
END $$;

-- =====================================================
-- 7. RECONCILIATION LOGS
-- =====================================================

CREATE TABLE IF NOT EXISTS reconciliation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Reconciliation data
    reconciliation_date DATE NOT NULL,
    
    -- Calculated totals
    ledger_total DECIMAL(20, 7) NOT NULL,
    escrow_total DECIMAL(20, 7) NOT NULL,
    discrepancy DECIMAL(20, 7) NOT NULL,
    
    -- Status
    status VARCHAR(20) NOT NULL,
    -- Status: BALANCED, DISCREPANCY_FOUND, RESOLVED
    
    -- Details
    escrow_count INTEGER,
    ledger_count INTEGER,
    details JSONB,
    
    -- Resolution (if discrepancy)
    resolved_by UUID REFERENCES users(id),
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for reconciliation lookups
CREATE INDEX IF NOT EXISTS idx_reconciliation_date ON reconciliation_logs(reconciliation_date);
CREATE INDEX IF NOT EXISTS idx_reconciliation_status ON reconciliation_logs(status);

-- =====================================================
-- 8. USER TRUST SCORE TRACKING
-- =====================================================

-- Add trust score columns to users if not exists
ALTER TABLE users ADD COLUMN IF NOT EXISTS trust_score INTEGER DEFAULT 50;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trust_factors JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fraud_flags_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS successful_transactions INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_transactions INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disputes_filed INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disputes_lost INTEGER DEFAULT 0;

-- =====================================================
-- 9. DEVICE FINGERPRINTS (FOR FRAUD DETECTION)
-- =====================================================

CREATE TABLE IF NOT EXISTS device_fingerprints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- User link
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Device identification
    device_hash VARCHAR(255) NOT NULL,
    device_info JSONB,
    
    -- First and last seen
    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Usage count
    transaction_count INTEGER DEFAULT 0,
    
    -- Trust
    is_trusted BOOLEAN DEFAULT false,
    is_blocked BOOLEAN DEFAULT false,
    
    UNIQUE(user_id, device_hash)
);

-- Index for device lookups
CREATE INDEX IF NOT EXISTS idx_device_user_id ON device_fingerprints(user_id);
CREATE INDEX IF NOT EXISTS idx_device_hash ON device_fingerprints(device_hash);

-- =====================================================
-- 10. LINKED ACCOUNTS (FOR NETWORK ANALYSIS)
-- =====================================================

CREATE TABLE IF NOT EXISTS linked_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Account links
    user_id_1 UUID NOT NULL REFERENCES users(id),
    user_id_2 UUID NOT NULL REFERENCES users(id),
    
    -- Link type
    link_type VARCHAR(50) NOT NULL,
    -- Types: SAME_DEVICE, SAME_IP, SAME_WALLET, CIRCULAR_TRANSACTION, MANUAL_FLAG
    
    -- Confidence
    confidence_score DECIMAL(5, 2),
    
    -- Evidence
    evidence JSONB,
    
    -- Flag status
    is_suspicious BOOLEAN DEFAULT false,
    reviewed BOOLEAN DEFAULT false,
    
    -- Timestamps
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id_1, user_id_2, link_type)
);

-- Index for linked account lookups
CREATE INDEX IF NOT EXISTS idx_linked_user_1 ON linked_accounts(user_id_1);
CREATE INDEX IF NOT EXISTS idx_linked_user_2 ON linked_accounts(user_id_2);
CREATE INDEX IF NOT EXISTS idx_linked_suspicious ON linked_accounts(is_suspicious) WHERE is_suspicious = true;

-- =====================================================
-- 11. VIEWS FOR REPORTING (use SECURITY INVOKER)
-- =====================================================

-- Wallet summary view
DROP VIEW IF EXISTS wallet_summary;
CREATE VIEW wallet_summary 
WITH (security_invoker = on) AS
SELECT
    (SELECT COALESCE(SUM(balance), 0) FROM system_accounts WHERE account_name = 'escrow_holdings') as total_holdings,
    (SELECT COALESCE(SUM(balance), 0) FROM system_accounts WHERE account_name = 'fee_revenue') as total_fees,
    (SELECT COALESCE(SUM(balance), 0) FROM system_accounts WHERE account_name = 'pending_payouts') as pending_payouts,
    (SELECT COUNT(*) FROM escrows WHERE status = 'held') as active_escrows,
    (SELECT COALESCE(SUM(amount), 0) FROM escrows WHERE status = 'held') as active_escrow_value,
    (SELECT COUNT(*) FROM escrows WHERE status = 'released') as completed_escrows,
    (SELECT COUNT(*) FROM escrows WHERE status = 'refunded') as refunded_escrows,
    (SELECT COUNT(*) FROM disputes WHERE status IN ('open', 'pending_response', 'under_review')) as open_disputes;

-- Daily transaction summary
DROP VIEW IF EXISTS daily_transaction_summary;
CREATE VIEW daily_transaction_summary 
WITH (security_invoker = on) AS
SELECT
    DATE(created_at) as date,
    action,
    COUNT(*) as transaction_count,
    SUM(amount) as total_amount
FROM escrow_ledger
GROUP BY DATE(created_at), action
ORDER BY date DESC, action;

-- User risk summary
DROP VIEW IF EXISTS user_risk_summary;
CREATE VIEW user_risk_summary 
WITH (security_invoker = on) AS
SELECT
    u.id,
    u.username,
    u.trust_score,
    u.successful_transactions,
    u.disputes_filed,
    u.disputes_lost,
    COUNT(DISTINCT fa.id) as fraud_assessments,
    AVG(fa.risk_score) as avg_risk_score,
    COUNT(DISTINCT la.id) as linked_accounts
FROM users u
LEFT JOIN fraud_assessments fa ON u.id = fa.user_id
LEFT JOIN linked_accounts la ON u.id = la.user_id_1 OR u.id = la.user_id_2
GROUP BY u.id, u.username, u.trust_score, u.successful_transactions, u.disputes_filed, u.disputes_lost;

-- =====================================================
-- 12. RLS POLICIES
-- =====================================================

-- Enable RLS on new tables
ALTER TABLE escrow_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispute_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_fingerprints ENABLE ROW LEVEL SECURITY;

-- Ledger is read-only for users, write by service role only
DROP POLICY IF EXISTS "Service role can insert ledger" ON escrow_ledger;
CREATE POLICY "Service role can insert ledger" ON escrow_ledger
    FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view their ledger entries" ON escrow_ledger;
CREATE POLICY "Users can view their ledger entries" ON escrow_ledger
    FOR SELECT TO authenticated
    USING (
        from_account = 'user:' || auth.uid()::text
        OR to_account = 'user:' || auth.uid()::text
    );

-- Fraud assessments viewable by admins and related user
DROP POLICY IF EXISTS "Users can view own fraud assessments" ON fraud_assessments;
CREATE POLICY "Users can view own fraud assessments" ON fraud_assessments
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

-- Evidence viewable by dispute participants (handles both escrow_id and dispute_id schemas)
DROP POLICY IF EXISTS "Dispute participants can view evidence" ON dispute_evidence;
CREATE POLICY "Dispute participants can view evidence" ON dispute_evidence
    FOR SELECT TO authenticated
    USING (
        -- Original schema: via escrow_id
        EXISTS (
            SELECT 1 FROM escrows e
            WHERE e.id = dispute_evidence.escrow_id
            AND (e.sender_id = auth.uid() OR e.recipient_id = auth.uid())
        )
        OR
        -- New schema: via dispute_id
        EXISTS (
            SELECT 1 FROM disputes d
            JOIN escrows e ON d.escrow_id = e.id
            WHERE d.id = dispute_evidence.dispute_id
            AND (e.sender_id = auth.uid() OR e.recipient_id = auth.uid())
        )
    );

DROP POLICY IF EXISTS "Dispute participants can add evidence" ON dispute_evidence;
CREATE POLICY "Dispute participants can add evidence" ON dispute_evidence
    FOR INSERT TO authenticated
    WITH CHECK (
        -- Original schema: via escrow_id
        EXISTS (
            SELECT 1 FROM escrows e
            WHERE e.id = dispute_evidence.escrow_id
            AND (e.sender_id = auth.uid() OR e.recipient_id = auth.uid())
        )
        OR
        -- New schema: via dispute_id
        EXISTS (
            SELECT 1 FROM disputes d
            JOIN escrows e ON d.escrow_id = e.id
            WHERE d.id = dispute_evidence.dispute_id
            AND (e.sender_id = auth.uid() OR e.recipient_id = auth.uid())
        )
    );

-- Device fingerprints only visible to user and admins
DROP POLICY IF EXISTS "Users can view own devices" ON device_fingerprints;
CREATE POLICY "Users can view own devices" ON device_fingerprints
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

-- Reconciliation logs - admin only
ALTER TABLE reconciliation_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can view reconciliation logs" ON reconciliation_logs;
CREATE POLICY "Admin can view reconciliation logs" ON reconciliation_logs
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

-- Linked accounts - users can see their own linked accounts
ALTER TABLE linked_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own linked accounts" ON linked_accounts;
CREATE POLICY "Users can view own linked accounts" ON linked_accounts
    FOR SELECT TO authenticated
    USING (
        user_id_1 = auth.uid() OR user_id_2 = auth.uid()
        OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
    );

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================

GRANT SELECT ON wallet_summary TO authenticated;
GRANT SELECT ON daily_transaction_summary TO service_role;
GRANT SELECT ON user_risk_summary TO service_role;

-- =====================================================
-- END MIGRATION 009
-- =====================================================

