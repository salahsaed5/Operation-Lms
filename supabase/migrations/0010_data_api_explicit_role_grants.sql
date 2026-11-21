-- 0010_data_api_explicit_role_grants.sql
-- P0: Fix PostgREST 42501 "permission denied for table profiles" after
-- bootstrapping in a Supabase project with opt-in API grants.
-- Prerequisites: 0001-0009, 29 public tables, RLS enabled on ALL of them.
-- The Data API must first authorize a role via GRANT; RLS THEN limits rows.
-- Least privilege: no grants to anon, only grant authenticated DML when
-- there is a matching explicit RLS policy (FOR ALL counts for all commands).
-- Secret-bearing service_role receives only the permissions currently used
-- by the server-only provision-instructor Edge Function.
-- No data updates/deletions, no policy changes, no future default grants.
BEGIN;

DO $$
DECLARE
  v_table record;
  v_public_count integer;
  v_bad_rls integer;
  v_unprotected integer;
  v_anon_readable integer;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE NOT c.relrowsecurity),
         count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname
         )),
         count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'SELECT'))
    INTO v_public_count, v_bad_rls, v_unprotected, v_anon_readable
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p');

  IF v_public_count <> 29 OR v_bad_rls <> 0
     OR v_unprotected <> 0 OR v_anon_readable <> 0 THEN
    RAISE EXCEPTION
      'STOP: unexpected public schema: tables %, RLS missing %, no policies %, anon-readable %',
      v_public_count, v_bad_rls, v_unprotected, v_anon_readable;
  END IF;

  -- Prevent accidentally broadening visibility on the previous 0009 roster fix.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='students'
      AND policyname='Instructors read permitted student rosters'
      AND cmd='SELECT'
      AND qual LIKE '%is_instructor_assigned_to_group%'
      AND qual NOT LIKE '%is_instructor_assigned_to_camp%'
  ) THEN
    RAISE EXCEPTION 'STOP: 0009 instructor group isolation policy missing.';
  END IF;

  FOR v_table IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
    ORDER BY c.relname
  LOOP
    -- All 29 tables have RLS; their SELECT policy decides row visibility.
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_table.relname);

    IF EXISTS (SELECT 1 FROM pg_policies p
               WHERE p.schemaname='public' AND p.tablename=v_table.relname
                 AND 'authenticated'=ANY(p.roles)
                 AND p.cmd IN ('ALL','INSERT')) THEN
      EXECUTE format('GRANT INSERT ON TABLE public.%I TO authenticated',v_table.relname);
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies p
               WHERE p.schemaname='public' AND p.tablename=v_table.relname
                 AND 'authenticated'=ANY(p.roles)
                 AND p.cmd IN ('ALL','UPDATE')) THEN
      EXECUTE format('GRANT UPDATE ON TABLE public.%I TO authenticated',v_table.relname);
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies p
               WHERE p.schemaname='public' AND p.tablename=v_table.relname
                 AND 'authenticated'=ANY(p.roles)
                 AND p.cmd IN ('ALL','DELETE')) THEN
      EXECUTE format('GRANT DELETE ON TABLE public.%I TO authenticated',v_table.relname);
    END IF;
  END LOOP;
END
$$;

-- Server-side only service_role is used by provision-instructor. Keep service
-- credentials in Edge Function secrets, NEVER in VITE_ frontend variables.
GRANT SELECT ON TABLE
  public.profiles,public.admin_accounts,public.audit_logs,
  public.instructors,public.camps,public.camp_instructors
TO service_role;

GRANT INSERT ON TABLE
  public.profiles,public.instructors,public.camp_instructors,public.audit_logs
TO service_role;

-- Only compensation rollback paths in provision-instructor need DELETE.
GRANT DELETE ON TABLE
  public.profiles,public.instructors,public.camp_instructors
TO service_role;

-- Confirm critical authorization invariants before committing privileges.
DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
    AND (NOT has_table_privilege('authenticated',c.oid,'SELECT')
         OR has_table_privilege('anon',c.oid,'SELECT')
         OR NOT c.relrowsecurity);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'STOP: Data API privilege verification failed for % tables.',v_bad;
  END IF;
  IF has_table_privilege('authenticated','public.admin_accounts','INSERT')
     OR has_table_privilege('authenticated','public.admin_accounts','UPDATE')
     OR has_table_privilege('authenticated','public.admin_accounts','DELETE')
     OR has_table_privilege('authenticated','public.audit_logs','DELETE')
     OR has_table_privilege('authenticated','public.audit_logs','UPDATE') THEN
    RAISE EXCEPTION 'STOP: sensitive table privileges wider than intended.';
  END IF;
END
$$;

COMMIT;
