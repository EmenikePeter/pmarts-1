-- Create a push_retry_queue table for enqueuing failed/async push notifications
CREATE TABLE IF NOT EXISTS push_retry_queue (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  to_token TEXT,
  title TEXT,
  body TEXT,
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_push_retry_next ON push_retry_queue(processed, next_attempt_at);
