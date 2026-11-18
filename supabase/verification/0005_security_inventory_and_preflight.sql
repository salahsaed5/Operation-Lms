-- =============================================================================
-- CITS Camp Operations — Read-Only Security Inventory & Preflight Inspection
-- Script: 0005_security_inventory_and_preflight.sql
-- Purpose: Inspect live staging/production DB state cleanly before/after running
--          migration 0005 and verification suites. Makes ZERO mutations.
-- =============================================================================

-- 1. Core Migration & Schema Readiness Inventory
SELECT
  'schema_readiness' AS section,
  jsonb_build_object(
    'audit_logs_camp_id_exists', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'camp_id'
    ),
    'attendance_sheets_sync_state_exists', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'attendance_sheets' AND column_name = 'sync_state'
    ),
    'is_active_cits_user_sig', to_regprocedure('public.is_active_cits_user()')::text,
    'admin_correct_attendance_tx_sig', to_regprocedure('public.admin_correct_attendance_tx(uuid,uuid,public.attendance_mark,text)')::text,
    'idx_unique_pending_checkin_exception_exists', EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'idx_unique_pending_checkin_exception'
    ),
    'public_tables_with_rls_count', (
      SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = TRUE
    ),
    'public_tables_without_rls_names', (
      SELECT COALESCE(string_agg(tablename, ', ' ORDER BY tablename), 'NONE')
      FROM pg_tables
      WHERE schemaname = 'public' AND rowsecurity = FALSE
    )
  ) AS details;

-- 2. All public SECURITY DEFINER Functions, search_path Config & Execution Grants
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS is_security_definer,
  COALESCE(array_to_string(p.proconfig, '; '), 'MISSING_PROCONFIG') AS proconfig,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  CASE
    WHEN p.prosecdef AND COALESCE(array_to_string(p.proconfig, ','), '') NOT ILIKE '%search_path=public, pg_temp%'
      THEN 'FAIL_UNPINNED_SEARCH_PATH'
    ELSE 'OK'
  END AS audit_status
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname, p.oid;

-- 3. Trigger Inventory across auth.users, storage.objects, and public Tables
SELECT
  tn.nspname AS table_schema,
  tc.relname AS table_name,
  t.tgname AS trigger_name,
  p.proname AS trigger_function,
  t.tgenabled AS enabled_state,
  COALESCE(array_to_string(p.proconfig, '; '), 'NONE') AS func_proconfig
FROM pg_trigger t
JOIN pg_class tc ON tc.oid = t.tgrelid
JOIN pg_namespace tn ON tn.oid = tc.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND (
    (tn.nspname = 'auth' AND tc.relname = 'users')
    OR (tn.nspname = 'storage' AND tc.relname = 'objects')
    OR tn.nspname = 'public'
  )
ORDER BY tn.nspname, tc.relname, t.tgname;

-- 4. RLS Policy Audit (public tables + storage.objects)
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  roles::text AS roles,
  qual AS using_expr,
  with_check AS with_check_expr
FROM pg_policies
WHERE schemaname = 'public'
   OR (schemaname = 'storage' AND tablename = 'objects')
ORDER BY schemaname, tablename, policyname;

-- 5. Active Camp, Admin Cap & Pending Exception Conflict Preflight Summary
SELECT
  (SELECT COUNT(*) FROM public.admin_accounts) AS admin_accounts_count,
  (SELECT COUNT(*) FROM public.profiles WHERE role = 'admin' AND is_active = TRUE) AS active_admin_profiles,
  (SELECT COUNT(*) FROM public.camps WHERE status = 'active') AS active_camps_count,
  (SELECT COUNT(*) FROM public.camps WHERE status = 'archived') AS archived_camps_count,
  (
    SELECT COUNT(*)
    FROM (
      SELECT camp_id, instructor_id, camp_day
      FROM public.checkin_exceptions
      WHERE status = 'pending'
      GROUP BY camp_id, instructor_id, camp_day
      HAVING COUNT(*) > 1
    ) dup_pending
  ) AS duplicate_pending_checkin_exceptions_count,
  (SELECT id::text FROM storage.buckets WHERE id = 'checkin-selfies') AS checkin_selfies_bucket_id,
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'checkin-selfies') AS checkin_selfies_limit_bytes;
