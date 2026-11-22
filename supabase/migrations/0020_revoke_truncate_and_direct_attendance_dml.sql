-- P0 Staging security: PostgreSQL TRUNCATE bypasses row level security.
-- The web client has no reason to hold DDL/structural privileges on any public table.
-- Revoke DML that bypasses the atomic attendance CAS RPC.
DO $$
DECLARE v_table record;
BEGIN
  FOR v_table IN
    SELECT schemaname, tablename FROM pg_tables WHERE schemaname='public'
  LOOP
    EXECUTE format(
      'REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE %I.%I FROM anon, authenticated',
      v_table.schemaname, v_table.tablename
    );
  END LOOP;
END $$;

-- Reading attendance remains RLS-scoped; ALL writes go through secured
-- SECURITY DEFINER RPCs which check auth.uid() and lecture ownership.
-- In particular, a raw REST upsert cannot bypass expected-snapshot CAS.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.attendance_records FROM anon, authenticated;
