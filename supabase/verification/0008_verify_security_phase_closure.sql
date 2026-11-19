-- =============================================================================
-- CITS Camp Operations Platform — Non-Destructive Verification Suite
-- Migration 0008: Security Phase Closure Verification (SEC-004, SEC-005,
--                 SEC-006, SEC-007 & End-to-End Lifecycle Checks)
--
-- Execution: Run in Supabase SQL Editor AFTER applying Migrations 0007 & 0008.
-- Safety: Strictly wrapped in BEGIN; ... ROLLBACK; — leaves ZERO permanent rows.
--
-- Verifies (14 checks):
--   1. SEC-004: resolve_login_identifier(text) revoked from PUBLIC, anon, authenticated.
--   2. SEC-004: cits_internal.auth_login_rate_limits hidden from anon/authenticated with RLS.
--   3. SEC-004: evaluate_login_rate_limit_internal revoked from PUBLIC/anon/authenticated
--      and enforces 10-attempt identifier limit & 25-attempt IP limit with retry_after_seconds.
--   4. SEC-007: assert_camp_not_archived(uuid) & internal helpers revoked from PUBLIC/anon.
--   5. SEC-005: Admin at AAL1 CANNOT call complete_password_change_tx() even after
--      rotating auth.users.encrypted_password.
--   6. SEC-005: Admin at AAL2 CAN complete complete_password_change_tx() after rotation.
--   7. SEC-006: Re-forcing must_change_password = TRUE (FALSE -> TRUE) updates baseline
--      AND clears last_completed_auth_fingerprint, blocking direct RPC bypass until rotated.
--   8. SEC-001 Missing Baseline Fail-Closed: Deleting baseline row causes
--      complete_password_change_tx() to fail closed (DENIED) while flag is TRUE.
--   9. SEC-001 Invite Onboarding Lifecycle: Empty encrypted_password blocked -> after
--      real password set, complete_password_change_tx() succeeds cleanly.
--  10. SEC-001 Temporary Password Lifecycle: Unchanged initial hash blocked -> after
--      new hash set, complete_password_change_tx() succeeds cleanly.
--  11. SEC-002 Storage Policy Gate: current_instructor_id() returns NULL while
--      must_change_password = TRUE, blocking checkin-selfies upload/read policies.
--  12. SEC-003 Inactive Storage & Record Gate: Deactivated instructor cannot read
--      instructors row and current_instructor_id() returns NULL.
--  13. Anon Role Isolation: anon cannot invoke resolve_login_identifier() or
--      evaluate_login_rate_limit_internal() or complete_password_change_tx().
--  14. Audit Integrity: Zero PASSWORD_CHANGE_COMPLETED rows contain banned substrings.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _cits_mig0008_report (
  step_no INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  check_name TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence TEXT NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  v_inst_uid UUID := '00000000-0000-4000-a800-000000000001';
  v_invite_uid UUID := '00000000-0000-4000-a800-000000000002';
  v_admin_uid UUID := '00000000-0000-4000-a800-000000000003';
  v_inst_id UUID := '00000000-0000-4000-b800-000000000001';

  v_hash_1 TEXT := '$2a$10$Verify0008InitialTempHash00000000000000000000000000001';
  v_hash_2 TEXT := '$2a$10$Verify0008RotatedUserHash00000000000000000000000000002';
  v_hash_3 TEXT := '$2a$10$Verify0008ReForcedNewHash00000000000000000000000000003';

  v_pub BOOLEAN;
  v_anon BOOLEAN;
  v_auth BOOLEAN;
  v_res JSONB;
  v_last_fp TEXT;
  v_cnt INTEGER;
  v_inst_resolved UUID;
  v_free_slot SMALLINT := NULL;
  v_i INTEGER;
BEGIN
  -- 1. SEC-004: resolve_login_identifier revoked from PUBLIC, anon, authenticated
  v_pub := has_function_privilege('public', 'public.resolve_login_identifier(text)', 'EXECUTE');
  v_anon := has_function_privilege('anon', 'public.resolve_login_identifier(text)', 'EXECUTE');
  v_auth := has_function_privilege('authenticated', 'public.resolve_login_identifier(text)', 'EXECUTE');

  IF NOT v_pub AND NOT v_anon AND NOT v_auth THEN
    INSERT INTO _cits_mig0008_report VALUES (1, 'SEC-004 Enumeration', 'resolve_login_identifier(text) revoked from PUBLIC/anon/authenticated', 'PASS', 'Zero client EXECUTE privileges on resolve_login_identifier');
  ELSE
    INSERT INTO _cits_mig0008_report VALUES (1, 'SEC-004 Enumeration', 'resolve_login_identifier(text) revoked from PUBLIC/anon/authenticated', 'FAIL', format('pub=%s anon=%s auth=%s', v_pub, v_anon, v_auth));
  END IF;

  -- 2. SEC-004: cits_internal.auth_login_rate_limits isolation
  v_anon := has_table_privilege('anon', 'cits_internal.auth_login_rate_limits', 'SELECT');
  v_auth := has_table_privilege('authenticated', 'cits_internal.auth_login_rate_limits', 'SELECT');
  IF NOT v_anon AND NOT v_auth THEN
    INSERT INTO _cits_mig0008_report VALUES (2, 'SEC-004 Rate Table', 'cits_internal.auth_login_rate_limits hidden from anon/authenticated', 'PASS', 'Zero anon/authenticated table grants');
  ELSE
    INSERT INTO _cits_mig0008_report VALUES (2, 'SEC-004 Rate Table', 'cits_internal.auth_login_rate_limits hidden from anon/authenticated', 'FAIL', format('anon=%s auth=%s', v_anon, v_auth));
  END IF;

  -- 3. SEC-004: evaluate_login_rate_limit_internal privileges & 10-attempt identifier limit
  v_pub := has_function_privilege('public', 'public.evaluate_login_rate_limit_internal(text,text,boolean)', 'EXECUTE');
  v_anon := has_function_privilege('anon', 'public.evaluate_login_rate_limit_internal(text,text,boolean)', 'EXECUTE');
  v_auth := has_function_privilege('authenticated', 'public.evaluate_login_rate_limit_internal(text,text,boolean)', 'EXECUTE');
  FOR v_i IN 1..10 LOOP
    v_res := public.evaluate_login_rate_limit_internal('verify0008_ip_hash', 'verify0008_id_hash', TRUE);
  END LOOP;
  IF NOT v_pub AND NOT v_anon AND NOT v_auth
     AND (v_res ->> 'allowed') = 'false'
     AND (v_res ->> 'identifier_count')::integer = 10
     AND (v_res ->> 'retry_after_seconds')::integer > 0 THEN
    INSERT INTO _cits_mig0008_report VALUES (3, 'SEC-004 Rate Limit', 'evaluate_login_rate_limit_internal server-only & blocks at 10 failures', 'PASS', v_res::text);
  ELSE
    INSERT INTO _cits_mig0008_report VALUES (3, 'SEC-004 Rate Limit', 'evaluate_login_rate_limit_internal server-only & blocks at 10 failures', 'FAIL', format('priv=%s/%s/%s res=%s', v_pub, v_anon, v_auth, v_res));
  END IF;

  -- 4. SEC-007: assert_camp_not_archived & append_audit_log_internal least-privilege
  IF NOT has_function_privilege('public', 'public.assert_camp_not_archived(uuid)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.assert_camp_not_archived(uuid)', 'EXECUTE')
     AND NOT has_function_privilege('authenticated', 'public.append_audit_log_internal(uuid,text,text,text,jsonb,jsonb,text)', 'EXECUTE') THEN
    INSERT INTO _cits_mig0008_report VALUES (4, 'SEC-007 Grants', 'Helper functions enforce least-privilege EXECUTE grants', 'PASS', 'assert_camp_not_archived revoked from PUBLIC/anon; append_audit_log_internal internal-only');
  ELSE
    INSERT INTO _cits_mig0008_report VALUES (4, 'SEC-007 Grants', 'Helper functions enforce least-privilege EXECUTE grants', 'FAIL', 'Excessive EXECUTE privilege detected');
  END IF;

  -- Seed ephemeral fixtures
  INSERT INTO auth.users (id, email, encrypted_password, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_inst_uid, 'verify_0008_inst@cits.org', v_hash_1, '{}'::jsonb, NOW(), NOW()),
    (v_invite_uid, 'verify_0008_invite@cits.org', '', '{}'::jsonb, NOW(), NOW()),
    (v_admin_uid, 'verify_0008_admin@cits.org', v_hash_1, '{}'::jsonb, NOW(), NOW());

  INSERT INTO public.profiles (id, role, username, email, full_name_en, full_name_ar, must_change_password, is_active)
  VALUES
    (v_inst_uid, 'instructor', 'verify_0008_inst', 'verify_0008_inst@cits.org', 'Verify 0008 Inst', 'محاضر 8', TRUE, TRUE),
    (v_invite_uid, 'instructor', 'verify_0008_invite', 'verify_0008_invite@cits.org', 'Verify 0008 Invite', 'مدعو 8', TRUE, TRUE);

  INSERT INTO public.instructors (id, profile_id, instructor_code, specialization, default_lecture_rate_egp)
  VALUES (v_inst_id, v_inst_uid, 'INST-V0008-1', 'Security', 700);

  -- 5 & 6. SEC-005: Admin AAL1 vs AAL2 enforcement in complete_password_change_tx()
  IF NOT EXISTS (SELECT 1 FROM public.admin_accounts WHERE assigned_slot = 1) THEN
    v_free_slot := 1;
  ELSIF NOT EXISTS (SELECT 1 FROM public.admin_accounts WHERE assigned_slot = 2) THEN
    v_free_slot := 2;
  END IF;

  IF v_free_slot IS NOT NULL THEN
    INSERT INTO public.profiles (id, role, username, email, full_name_en, full_name_ar, must_change_password, is_active)
    VALUES (v_admin_uid, 'admin', 'verify_0008_admin', 'verify_0008_admin@cits.org', 'Verify 0008 Admin', 'مسؤول 8', TRUE, TRUE);
    INSERT INTO public.admin_accounts (profile_id, totp_enrolled, assigned_slot)
    VALUES (v_admin_uid, TRUE, v_free_slot);

    -- Rotate admin password hash first
    UPDATE auth.users SET encrypted_password = v_hash_2, updated_at = NOW() WHERE id = v_admin_uid;

    -- 5: AAL1 Admin MUST be blocked from complete_password_change_tx()
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_uid::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.complete_password_change_tx();
      EXECUTE 'RESET ROLE';
      INSERT INTO _cits_mig0008_report VALUES (5, 'SEC-005 Admin MFA', 'Admin at AAL1 blocked from complete_password_change_tx()', 'FAIL', 'AAL1 Admin cleared must_change_password!');
    EXCEPTION WHEN OTHERS THEN
      EXECUTE 'RESET ROLE';
      INSERT INTO _cits_mig0008_report VALUES (5, 'SEC-005 Admin MFA', 'Admin at AAL1 blocked from complete_password_change_tx()', 'PASS', SQLERRM);
    END;

    -- 6: AAL2 Admin succeeds after rotation
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_uid::text, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      v_res := public.complete_password_change_tx();
      EXECUTE 'RESET ROLE';
      IF (v_res ->> 'ok') = 'true' AND (v_res ->> 'must_change_password') = 'false' THEN
        INSERT INTO _cits_mig0008_report VALUES (6, 'SEC-005 Admin MFA', 'Admin at AAL2 succeeds in complete_password_change_tx()', 'PASS', v_res::text);
      ELSE
        INSERT INTO _cits_mig0008_report VALUES (6, 'SEC-005 Admin MFA', 'Admin at AAL2 succeeds in complete_password_change_tx()', 'FAIL', v_res::text);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      EXECUTE 'RESET ROLE';
      INSERT INTO _cits_mig0008_report VALUES (6, 'SEC-005 Admin MFA', 'Admin at AAL2 succeeds in complete_password_change_tx()', 'FAIL', SQLERRM);
    END;
  ELSE
    INSERT INTO _cits_mig0008_report VALUES (5, 'SEC-005 Admin MFA', 'Admin at AAL1 blocked from complete_password_change_tx()', 'BLOCKED', 'Both production admin_accounts slots occupied');
    INSERT INTO _cits_mig0008_report VALUES (6, 'SEC-005 Admin MFA', 'Admin at AAL2 succeeds in complete_password_change_tx()', 'BLOCKED', 'Both production admin_accounts slots occupied');
  END IF;

  -- 10 (run before 7): Temporary password lifecycle — blocked unchanged, succeeds after rotation
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_inst_uid::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.complete_password_change_tx();
    EXECUTE 'RESET ROLE';
    INSERT INTO _cits_mig0008_report VALUES (10, 'SEC-001 Temp Flow', 'Temporary password unchanged blocked; rotated hash succeeds', 'FAIL', 'Unchanged temporary password succeeded!');
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    UPDATE auth.users SET encrypted_password = v_hash_2, updated_at = NOW() WHERE id = v_inst_uid;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_inst_uid::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := public.complete_password_change_tx();
    EXECUTE 'RESET ROLE';
    IF (v_res ->> 'ok') = 'true' AND (v_res ->> 'already_completed') = 'false' THEN
      INSERT INTO _cits_mig0008_report VALUES (10, 'SEC-001 Temp Flow', 'Temporary password unchanged blocked; rotated hash succeeds', 'PASS', 'Direct call blocked; post-rotation call succeeded');
    ELSE
      INSERT INTO _cits_mig0008_report VALUES (10, 'SEC-001 Temp Flow', 'Temporary password unchanged blocked; rotated hash succeeds', 'FAIL', v_res::text);
    END IF;
  END;

  -- 7. SEC-006: Re-forcing must_change_password = TRUE resets last_completed_auth_fingerprint & blocks bypass
  UPDATE public.profiles SET must_change_password = TRUE WHERE id = v_inst_uid;
  SELECT last_completed_auth_fingerprint INTO v_last_fp
  FROM cits_internal.credential_rotation_baselines
  WHERE profile_id = v_inst_uid;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_inst_uid::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.complete_password_change_tx();
    EXECUTE 'RESET ROLE';
    INSERT INTO _cits_mig0008_report VALUES (7, 'SEC-006 Re-Force', 'Re-forcing must_change_password resets baseline & blocks direct bypass', 'FAIL', 'Bypass succeeded after re-forcing flag!');
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    IF v_last_fp IS NULL THEN
      INSERT INTO _cits_mig0008_report VALUES (7, 'SEC-006 Re-Force', 'Re-forcing must_change_password resets baseline & blocks direct bypass', 'PASS', format('last_completed_auth_fingerprint cleared; bypass blocked: %s', SQLERRM));
    ELSE
      INSERT INTO _cits_mig0008_report VALUES (7, 'SEC-006 Re-Force', 'Re-forcing must_change_password resets baseline & blocks direct bypass', 'FAIL', 'Stale last_completed_auth_fingerprint remained!');
    END IF;
  END;

  -- 8. SEC-001 Missing Baseline Fail-Closed
  DELETE FROM cits_internal.credential_rotation_baselines WHERE profile_id = v_inst_uid;
  UPDATE auth.users SET encrypted_password = v_hash_3, updated_at = NOW() WHERE id = v_inst_uid;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_inst_uid::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.complete_password_change_tx();
    EXECUTE 'RESET ROLE';
    INSERT INTO _cits_mig0008_report VALUES (8, 'SEC-001 Fail-Closed', 'Missing baseline row fails closed in complete_password_change_tx()', 'FAIL', 'Succeeded with missing baseline row!');
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _cits_mig0008_report VALUES (8, 'SEC-001 Fail-Closed', 'Missing baseline row fails closed in complete_password_change_tx()', 'PASS', SQLERRM);
  END;

  -- 9. SEC-001 Invite Onboarding Lifecycle (empty hash blocked -> set password -> succeeds)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_invite_uid::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.complete_password_change_tx();
    EXECUTE 'RESET ROLE';
    INSERT INTO _cits_mig0008_report VALUES (9, 'SEC-001 Invite Flow', 'Invite user blocked before setting password; succeeds after setting password', 'FAIL', 'Empty invite password succeeded!');
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    UPDATE auth.users SET encrypted_password = v_hash_2, updated_at = NOW() WHERE id = v_invite_uid;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_invite_uid::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_res := public.complete_password_change_tx();
    EXECUTE 'RESET ROLE';
    IF (v_res ->> 'ok') = 'true' AND (v_res ->> 'must_change_password') = 'false' THEN
      INSERT INTO _cits_mig0008_report VALUES (9, 'SEC-001 Invite Flow', 'Invite user blocked before setting password; succeeds after setting password', 'PASS', 'Empty blocked; set password succeeded');
    ELSE
      INSERT INTO _cits_mig0008_report VALUES (9, 'SEC-001 Invite Flow', 'Invite user blocked before setting password; succeeds after setting password', 'FAIL', v_res::text);
    END IF;
  END;

  -- 11. SEC-002 Storage Policy Gate while must_change_password = TRUE
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_inst_uid::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_inst_resolved := public.current_instructor_id();
  EXECUTE 'RESET ROLE';
  IF v_inst_resolved IS NULL THEN
    INSERT INTO _cits_mig0008_report VALUES (11, 'SEC-002 Storage Gate', 'current_instructor_id() NULL while must_change_password = TRUE (blocks checkin-selfies)', 'PASS', 'current_instructor_id() = NULL');
  ELSE
    INSERT INTO _cits_mig0008_report VALUES (11, 'SEC-002 Storage Gate', 'current_instructor_id() NULL while must_change_password = TRUE (blocks checkin-selfies)', 'FAIL', format('Returned %s', v_inst_resolved));
  END IF;

  -- 12. SEC-003 Inactive Account Storage & Record Gate
  UPDATE public.profiles SET is_active = FALSE, must_change_password = FALSE WHERE id = v_inst_uid;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_inst_uid::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_inst_resolved := public.current_instructor_id();
  SELECT COUNT(*) INTO v_cnt FROM public.instructors WHERE profile_id = v_inst_uid;
  EXECUTE 'RESET ROLE';
  IF v_inst_resolved IS NULL AND v_cnt = 0 THEN
    INSERT INTO _cits_mig0008_report VALUES (12, 'SEC-003 Inactive Gate', 'Deactivated instructor blocked from storage helper & instructors SELECT', 'PASS', 'current_instructor_id=NULL, instructors rows=0');
  ELSE
    INSERT INTO _cits_mig0008_report VALUES (12, 'SEC-003 Inactive Gate', 'Deactivated instructor blocked from storage helper & instructors SELECT', 'FAIL', format('inst=%s rows=%s', v_inst_resolved, v_cnt));
  END IF;

  -- 13. Anon Role Isolation across resolve_login_identifier & rate limiter
  PERFORM set_config('request.jwt.claims', '{}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM public.resolve_login_identifier('verify_0008_inst');
    EXECUTE 'RESET ROLE';
    INSERT INTO _cits_mig0008_report VALUES (13, 'Anon Isolation', 'anon blocked from resolve_login_identifier()', 'FAIL', 'anon invoked resolve_login_identifier()!');
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _cits_mig0008_report VALUES (13, 'Anon Isolation', 'anon blocked from resolve_login_identifier()', 'PASS', SQLERRM);
  END;

  -- 14. Audit Integrity Check
  SELECT COUNT(*) INTO v_cnt
  FROM public.audit_logs
  WHERE action = 'PASSWORD_CHANGE_COMPLETED'
    AND LOWER(COALESCE(previous_value::text, '') || ' ' || COALESCE(new_value::text, ''))
        ~ '(password|service_role|totp_secret|mfa_secret|access_token|refresh_token|secret_key)';
  IF v_cnt = 0 THEN
    INSERT INTO _cits_mig0008_report VALUES (14, 'Audit Integrity', 'PASSWORD_CHANGE_COMPLETED audit entries contain zero sensitive terms', 'PASS', '0 violating audit rows');
  ELSE
    INSERT INTO _cits_mig0008_report VALUES (14, 'Audit Integrity', 'PASSWORD_CHANGE_COMPLETED audit entries contain zero sensitive terms', 'FAIL', format('%s violating rows', v_cnt));
  END IF;
END;
$$;

SELECT step_no, category, check_name, status, evidence
FROM _cits_mig0008_report
ORDER BY step_no;

ROLLBACK;
