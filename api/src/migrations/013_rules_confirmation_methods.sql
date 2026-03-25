-- =====================================================
-- Migration 013: Confirmation Methods + Rule Extensions
-- =====================================================

-- Dedicated confirmation methods catalog
CREATE TABLE IF NOT EXISTS confirmation_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO confirmation_methods (key, label, description)
VALUES
  ('delivery_code', 'Delivery Code', 'Sender shares a delivery code with the recipient'),
  ('manual', 'Manual Confirmation', 'Sender must manually confirm release'),
  ('auto', 'Auto Confirmation', 'Release happens automatically after the timer'),
  ('receipt_upload', 'Receipt Upload', 'Sender uploads proof of payment')
ON CONFLICT (key) DO NOTHING;

-- Enable RLS for confirmation methods
ALTER TABLE confirmation_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS confirmation_methods_read ON confirmation_methods;
CREATE POLICY confirmation_methods_read ON confirmation_methods
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS confirmation_methods_admin_manage ON confirmation_methods;
CREATE POLICY confirmation_methods_admin_manage ON confirmation_methods
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

-- Escrow columns to store rule-derived timing
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS confirmation_method TEXT;
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS completion_timeout_hours INTEGER DEFAULT 0;
ALTER TABLE escrows ADD COLUMN IF NOT EXISTS completion_auto_release_at TIMESTAMPTZ;

-- Extend transaction rules and refresh defaults
INSERT INTO transaction_rules (type, completion_method, confirmation_method, dispute_allowed, timeout_hours)
VALUES
  ('physical_product', 'delivery_code', 'delivery_code', true, 168),
  ('digital_product', 'sender_release', 'manual', true, 0),
  ('service', 'service_approval', 'manual', true, 72),
  ('currency_exchange', 'receipt_evidence', 'receipt_upload', true, 24),
  ('instant', 'sender_release', 'auto', true, 0),
  ('donation', 'sender_release', 'auto', false, 0),
  ('custom', 'sender_release', 'manual', true, 72),
  ('other', 'sender_release', 'manual', true, 72)
ON CONFLICT (type) DO UPDATE SET
  completion_method = EXCLUDED.completion_method,
  confirmation_method = EXCLUDED.confirmation_method,
  dispute_allowed = EXCLUDED.dispute_allowed,
  timeout_hours = EXCLUDED.timeout_hours;

