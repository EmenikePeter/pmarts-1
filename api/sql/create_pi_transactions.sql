-- Create pi_transactions table to track Pi payment lifecycle
CREATE TABLE IF NOT EXISTS pi_transactions (
  id bigserial PRIMARY KEY,
  pi_payment_id text UNIQUE NOT NULL,
  status text NOT NULL,
  network text DEFAULT 'mainnet',
  pi_txid text,
  escrow_id uuid,
  amount numeric,
  sender_uid text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pi_transactions_pi_payment_id ON pi_transactions(pi_payment_id);
CREATE INDEX IF NOT EXISTS idx_pi_transactions_escrow_id ON pi_transactions(escrow_id);
