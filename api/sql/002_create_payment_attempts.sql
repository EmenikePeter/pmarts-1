-- Create payment_attempts table for tracking external payment attempts
CREATE TABLE IF NOT EXISTS payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id uuid,
  user_id uuid,
  provider text NOT NULL,
  provider_tx_id text,
  amount numeric,
  currency text DEFAULT 'PI',
  status text NOT NULL DEFAULT 'pending', -- pending|approved|failed
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_provider_tx ON payment_attempts(provider, provider_tx_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_escrow ON payment_attempts(escrow_id);
