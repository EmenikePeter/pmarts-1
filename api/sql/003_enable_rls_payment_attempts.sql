-- Enable Row Level Security (RLS) on payment_attempts and add policies
-- This ensures only the owning authenticated user can read/modify their attempts.
-- Service role key (server) still bypasses RLS as intended.

BEGIN;

-- Enable RLS
ALTER TABLE IF EXISTS public.payment_attempts ENABLE ROW LEVEL SECURITY;

-- Revoke generic public privileges (optional but explicit)
REVOKE ALL ON TABLE public.payment_attempts FROM PUBLIC;

-- Allow authenticated users to INSERT only when they set user_id = auth.uid()
DROP POLICY IF EXISTS payment_attempts_insert_own ON public.payment_attempts;
CREATE POLICY payment_attempts_insert_own
  ON public.payment_attempts
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' AND user_id = auth.uid());

-- Allow authenticated users to SELECT only their own rows
DROP POLICY IF EXISTS payment_attempts_select_own ON public.payment_attempts;
CREATE POLICY payment_attempts_select_own
  ON public.payment_attempts
  FOR SELECT
  USING (user_id = auth.uid());

-- Allow authenticated users to UPDATE only their own rows
DROP POLICY IF EXISTS payment_attempts_update_own ON public.payment_attempts;
CREATE POLICY payment_attempts_update_own
  ON public.payment_attempts
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Allow authenticated users to DELETE only their own rows
DROP POLICY IF EXISTS payment_attempts_delete_own ON public.payment_attempts;
CREATE POLICY payment_attempts_delete_own
  ON public.payment_attempts
  FOR DELETE
  USING (user_id = auth.uid());

COMMIT;
