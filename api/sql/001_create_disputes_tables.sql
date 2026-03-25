-- Migration: create disputes tables
-- Run this against the Supabase/Postgres database used by the API

CREATE TABLE IF NOT EXISTS disputes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  escrow_id uuid NOT NULL,
  reported_by uuid NOT NULL,
  against_user_id uuid,
  reason text NOT NULL,
  summary text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open',
  suggested_resolution jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution jsonb,
  resolution_notes text
);

CREATE TABLE IF NOT EXISTS dispute_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  dispute_id uuid NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  message text NOT NULL,
  attachments jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dispute_evidence (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  dispute_id uuid NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL,
  storage_path text NOT NULL,
  thumbnail_path text,
  mime text,
  size bigint,
  created_at timestamptz DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_disputes_escrow_id ON disputes(escrow_id);
CREATE INDEX IF NOT EXISTS idx_disputes_reported_by ON disputes(reported_by);
CREATE INDEX IF NOT EXISTS idx_dispute_messages_dispute_id ON dispute_messages(dispute_id);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_dispute_id ON dispute_evidence(dispute_id);

