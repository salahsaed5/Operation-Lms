-- Read-only catalog checks for 0010 Data API privilege remediation.
-- This validates role-level table grants only; real Admin TOTP and
-- instructor cross-group E2E tests are still required.
BEGIN;
SET TRANSACTION READ ONLY;

DO $$
DECLARE
 v_all integer;
 v_rls integer;
 v_auth_select integer;
 v_anon_select integer;
 v_unprotected integer;
BEGIN
 SELECT count(*), count(*) FILTER (WHERE c.relrowsecurity),
        count(*) FILTER (WHERE has_table_privilege('authenticated',c.oid,'SELECT')),
        count(*) FILTER (WHERE has_table_privilege('anon',c.oid,'SELECT')),
        count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM pg_policies p
          WHERE p.schemaname='public' AND p.tablename=c.relname))
 INTO v_all,v_rls,v_auth_select,v_anon_select,v_unprotected
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p');
 IF v_all<>29 OR v_rls<>29 OR v_auth_select<>29
    OR v_anon_select<>0 OR v_unprotected<>0 THEN
   RAISE EXCEPTION 'FAIL 0010: table grants, RLS or anon isolation mismatch';
 END IF;
 IF NOT has_table_privilege('authenticated','public.profiles','SELECT') OR
    NOT has_table_privilege('authenticated','public.admin_accounts','SELECT') OR
    has_table_privilege('authenticated','public.admin_accounts','INSERT') OR
    has_table_privilege('authenticated','public.admin_accounts','UPDATE') OR
    has_table_privilege('authenticated','public.admin_accounts','DELETE') OR
    has_table_privilege('authenticated','public.audit_logs','UPDATE') OR
    has_table_privilege('authenticated','public.audit_logs','DELETE') THEN
   RAISE EXCEPTION 'FAIL 0010: privileged Admin/auth table grants invalid';
 END IF;
 IF NOT has_table_privilege('service_role','public.profiles','SELECT') OR
    NOT has_table_privilege('service_role','public.profiles','INSERT') OR
    NOT has_table_privilege('service_role','public.instructors','INSERT') OR
    NOT has_table_privilege('service_role','public.camp_instructors','INSERT') THEN
   RAISE EXCEPTION 'FAIL 0010: server-only instructor provision grants missing';
 END IF;
 IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='students'
      AND policyname='Instructors read permitted student rosters'
      AND cmd='SELECT'
      AND qual LIKE '%is_instructor_assigned_to_group%'
      AND qual NOT LIKE '%is_instructor_assigned_to_camp%'
 ) THEN RAISE EXCEPTION 'FAIL 0010: 0009 group isolation bypass reappeared'; END IF;
 RAISE NOTICE 'PASS 0010: 29 RLS tables accessible to authenticated only; 0009 policy intact';
END
$$;
ROLLBACK;
