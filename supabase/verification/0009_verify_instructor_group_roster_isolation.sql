-- =============================================================================
-- Verification 0009: Read-only catalog assertions for instructor group isolation.
-- Note: This checks deployed definitions, NOT full role-token E2E behavior.
-- Live authenticated cross-group tests are still required before launch.
-- =============================================================================
BEGIN;
SET TRANSACTION READ ONLY;
DO $$
DECLARE
  v_using TEXT;
  v_definition TEXT;
BEGIN
  SELECT qual INTO v_using
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'students'
    AND policyname = 'Instructors read permitted student rosters'
    AND cmd = 'SELECT';

  IF v_using IS NULL
     OR POSITION('is_instructor_assigned_to_group' IN v_using) = 0
     OR POSITION('is_instructor_assigned_to_camp' IN v_using) > 0 THEN
    RAISE EXCEPTION 'FAIL: Instructor student SELECT policy is missing or grants camp-wide access.';
  END IF;

  IF to_regprocedure('public.is_instructor_assigned_to_group(uuid)') IS NULL THEN
    RAISE EXCEPTION 'FAIL: Instructor group-scoping function is missing.';
  END IF;
  SELECT pg_get_functiondef(to_regprocedure('public.is_instructor_assigned_to_group(uuid)'))
    INTO v_definition;
  IF POSITION('effective_to_day' IN v_definition) = 0
     OR POSITION('current_camp_day' IN v_definition) = 0
     OR POSITION('COALESCE(l.substitute_instructor_id, l.instructor_id)' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'FAIL: Group-scoping function lacks current-day, expiry, or substitute handling.';
  END IF;

  IF has_function_privilege('anon', 'public.is_instructor_assigned_to_group(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can execute instructor group-scoping helper.';
  END IF;

  RAISE NOTICE '[PASS 0009]: Instructor rosters are group-scoped in catalog and helper checks current day.';
END;
$$;
ROLLBACK;
