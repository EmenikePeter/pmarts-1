-- Add client_id column to support_ticket_messages so clients can reconcile optimistic messages
BEGIN;

ALTER TABLE IF EXISTS public.support_ticket_messages
  ADD COLUMN IF NOT EXISTS client_id text;

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_client_id ON public.support_ticket_messages (client_id);

-- Enable Row Level Security and add policies so PostgREST and clients behave safely.
-- We allow:
--  - authenticated users to INSERT messages for tickets they own
--  - admins/staff to INSERT or SELECT any messages
--  - service role (server) to bypass RLS (handled by Supabase service key)

ALTER TABLE IF EXISTS public.support_ticket_messages ENABLE ROW LEVEL SECURITY;

-- Policy: allow the ticket owner to select messages for their tickets
DO $$
DECLARE
  role_cond text := 'false';
BEGIN
  -- drop existing policy if present
  IF EXISTS (SELECT 1 FROM pg_policies p WHERE p.policyname = 'select_messages_for_ticket_owner' AND p.schemaname = 'public' AND p.tablename = 'support_ticket_messages') THEN
    EXECUTE 'DROP POLICY select_messages_for_ticket_owner ON public.support_ticket_messages';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role') THEN
    role_cond := 'u.role IN (''staff'',''admin'')';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'roles') THEN
    role_cond := '''staff'' = ANY(u.roles) OR ''admin'' = ANY(u.roles)';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_staff') THEN
    role_cond := 'u.is_staff = true OR u.is_admin = true';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_admin') THEN
    role_cond := 'u.is_admin = true';
  END IF;

  EXECUTE 'CREATE POLICY select_messages_for_ticket_owner ON public.support_ticket_messages FOR SELECT USING (EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = support_ticket_messages.ticket_id AND t.user_id = auth.uid()) OR (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND (' || role_cond || '))))';
END$$;

-- Policy: allow owner to insert messages for their ticket
DO $$
DECLARE
  role_cond text := 'false';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies p WHERE p.policyname = 'insert_message_for_ticket_owner' AND p.schemaname = 'public' AND p.tablename = 'support_ticket_messages') THEN
    EXECUTE 'DROP POLICY insert_message_for_ticket_owner ON public.support_ticket_messages';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role') THEN
    role_cond := 'u.role IN (''staff'',''admin'')';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'roles') THEN
    role_cond := '''staff'' = ANY(u.roles) OR ''admin'' = ANY(u.roles)';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_staff') THEN
    role_cond := 'u.is_staff = true OR u.is_admin = true';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_admin') THEN
    role_cond := 'u.is_admin = true';
  END IF;

  -- In policy expressions for INSERT, reference incoming row columns directly (e.g. ticket_id), do not use NEW.
  EXECUTE 'CREATE POLICY insert_message_for_ticket_owner ON public.support_ticket_messages FOR INSERT WITH CHECK ((EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id AND t.user_id = auth.uid())) OR (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND (' || role_cond || '))))';
END$$;

-- Policy: allow admins to select/insert/update/delete as needed
DO $$
DECLARE
  role_cond text := 'false';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies p WHERE p.policyname = 'admin_manage_support_messages' AND p.schemaname = 'public' AND p.tablename = 'support_ticket_messages') THEN
    EXECUTE 'DROP POLICY admin_manage_support_messages ON public.support_ticket_messages';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role') THEN
    role_cond := 'u.role IN (''staff'',''admin'')';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'roles') THEN
    role_cond := '''staff'' = ANY(u.roles) OR ''admin'' = ANY(u.roles)';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_staff') THEN
    role_cond := 'u.is_staff = true OR u.is_admin = true';
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_admin') THEN
    role_cond := 'u.is_admin = true';
  END IF;

  EXECUTE 'CREATE POLICY admin_manage_support_messages ON public.support_ticket_messages FOR ALL USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND (' || role_cond || '))) WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND (' || role_cond || ')))';
END$$;

-- Note: server-side code (using Supabase service_role key) bypasses RLS.

COMMIT;
