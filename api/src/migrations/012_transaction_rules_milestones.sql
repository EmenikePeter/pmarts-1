-- =====================================================
-- Migration 012: Transaction Rules & Milestones
-- =====================================================

-- Transaction rules for escrow completion behavior
CREATE TABLE IF NOT EXISTS transaction_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT UNIQUE NOT NULL,
  completion_method TEXT NOT NULL,
  confirmation_method TEXT,
  dispute_allowed BOOLEAN DEFAULT true,
  timeout_hours INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO transaction_rules (type, completion_method, confirmation_method, dispute_allowed, timeout_hours)
VALUES
  ('physical_product', 'delivery_code', 'delivery_code', true, 168),
  ('digital_product', 'sender_release', 'auto', true, 0),
  ('service', 'service_approval', 'manual', true, 72),
  ('currency_exchange', 'receipt_evidence', 'receipt_upload', true, 24),
  ('other', 'sender_release', 'manual', true, 72)
ON CONFLICT (type) DO NOTHING;

-- Milestones for split releases
CREATE TABLE IF NOT EXISTS escrow_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id UUID NOT NULL REFERENCES escrows(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'approved', 'released')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_escrow_milestones_escrow_id ON escrow_milestones(escrow_id);
CREATE INDEX IF NOT EXISTS idx_escrow_milestones_status ON escrow_milestones(status);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE transaction_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE escrow_milestones ENABLE ROW LEVEL SECURITY;

-- Transaction rules: readable by authenticated users, managed by admins
DROP POLICY IF EXISTS transaction_rules_read ON transaction_rules;
CREATE POLICY transaction_rules_read ON transaction_rules
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS transaction_rules_admin_manage ON transaction_rules;
CREATE POLICY transaction_rules_admin_manage ON transaction_rules
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

-- Milestones: escrow parties can view/manage, admins can manage all
DROP POLICY IF EXISTS escrow_milestones_select ON escrow_milestones;
CREATE POLICY escrow_milestones_select ON escrow_milestones
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM escrows e
      WHERE e.id = escrow_milestones.escrow_id
        AND (e.sender_id = auth.uid() OR e.recipient_id = auth.uid()
          OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true))
    )
  );

DROP POLICY IF EXISTS escrow_milestones_modify ON escrow_milestones;
CREATE POLICY escrow_milestones_modify ON escrow_milestones
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM escrows e
      WHERE e.id = escrow_milestones.escrow_id
        AND (e.sender_id = auth.uid() OR e.recipient_id = auth.uid()
          OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true))
    )
  );

DROP POLICY IF EXISTS escrow_milestones_update ON escrow_milestones;
CREATE POLICY escrow_milestones_update ON escrow_milestones
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM escrows e
      WHERE e.id = escrow_milestones.escrow_id
        AND (e.sender_id = auth.uid() OR e.recipient_id = auth.uid()
          OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM escrows e
      WHERE e.id = escrow_milestones.escrow_id
        AND (e.sender_id = auth.uid() OR e.recipient_id = auth.uid()
          OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true))
    )
  );

DROP POLICY IF EXISTS escrow_milestones_delete ON escrow_milestones;
CREATE POLICY escrow_milestones_delete ON escrow_milestones
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

