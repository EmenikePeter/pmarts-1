-- Create webhook_logs table to persist incoming webhook processing attempts
CREATE TABLE IF NOT EXISTS webhook_logs (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  provider TEXT,
  provider_tx_id TEXT,
  payload JSONB,
  status TEXT,
  attempt_result TEXT,
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP WITH TIME ZONE,
  escrow_id TEXT,
  user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_provider_tx ON webhook_logs(provider_tx_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at);
