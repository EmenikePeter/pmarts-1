-- =====================================================
-- Migration 010: Sessions & Authentication
-- =====================================================
-- This migration adds:
-- 1. Sessions table for auth tokens
-- 2. RPC function for device tracking
-- =====================================================

-- =====================================================
-- 1. SESSIONS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Session owner
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Token (hashed)
    token_hash VARCHAR(64) UNIQUE NOT NULL,
    
    -- Pi Network token (for re-verification)
    pi_access_token TEXT,
    
    -- Device info
    device_info JSONB,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Status
    is_active BOOLEAN DEFAULT true
);

-- Indexes for session lookups
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Auto-cleanup expired sessions
CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expires_at) WHERE is_active = true;

-- =====================================================
-- 2. RPC: INCREMENT DEVICE TRANSACTION
-- =====================================================

CREATE OR REPLACE FUNCTION increment_device_transaction(
    p_user_id UUID,
    p_device_hash VARCHAR(255)
)
RETURNS VOID AS $$
BEGIN
    UPDATE device_fingerprints
    SET 
        transaction_count = transaction_count + 1,
        last_seen_at = NOW()
    WHERE user_id = p_user_id AND device_hash = p_device_hash;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- =====================================================
-- 3. AUTO-CLEANUP TRIGGER FOR EXPIRED SESSIONS
-- =====================================================

CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS TRIGGER AS $$
BEGIN
    -- On each session check, clean up old sessions (max once per hour via advisory lock)
    IF pg_try_advisory_lock(1001) THEN
        DELETE FROM sessions 
        WHERE expires_at < NOW() - INTERVAL '1 day';
        
        PERFORM pg_advisory_unlock(1001);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- Note: This trigger runs during upsert, opportunistically cleaning old sessions
DROP TRIGGER IF EXISTS trigger_cleanup_sessions ON sessions;
CREATE TRIGGER trigger_cleanup_sessions
    AFTER INSERT ON sessions
    FOR EACH STATEMENT
    EXECUTE FUNCTION cleanup_expired_sessions();

-- =====================================================
-- 4. RLS POLICIES FOR SESSIONS
-- =====================================================

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Users can only see their own sessions
DROP POLICY IF EXISTS "Users can view own sessions" ON sessions;
CREATE POLICY "Users can view own sessions" ON sessions
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

-- Users can delete their own sessions (logout)
DROP POLICY IF EXISTS "Users can delete own sessions" ON sessions;
CREATE POLICY "Users can delete own sessions" ON sessions
    FOR DELETE TO authenticated
    USING (user_id = auth.uid());

-- Service role can manage all sessions
DROP POLICY IF EXISTS "Service role manages sessions" ON sessions;
CREATE POLICY "Service role manages sessions" ON sessions
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- =====================================================
-- END MIGRATION 010
-- =====================================================

