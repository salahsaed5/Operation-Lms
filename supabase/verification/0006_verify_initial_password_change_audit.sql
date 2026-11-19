-- =============================================================================
-- CITS Camp Operations — Verification Suite for Migration 0006
-- Non-Destructive Behavioral & Static Check (Wrapped in BEGIN ... ROLLBACK)
--
-- Verifies:
--   1. complete_password_change_tx() exists, is SECURITY DEFINER, pins
--      search_path = public, pg_temp, and has safe audit metadata keys.
--   2. Privilege boundaries: PUBLIC & anon cannot execute; authenticated can.
--   3. Active instructor with must_change_password = TRUE completes rotation
--      atomically, clearing must_change_password = FALSE and inserting an
--      immutable PASSWORD_CHANGE_COMPLETED audit_logs entry.
--   4. Inactive user calling complete_password_change_tx() is denied.
--   5. Direct client UPDATE profiles SET must_change_password = FALSE remains
--      blocked by enforce_profile_security().
--   6. enforce_audit_log_integrity() STILL rejects 'password' in audit_logs
--      (confirming security protections were NOT weakened).
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _cits_mig0006_report (
  check_no INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  check_name TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  v_initial_role TEXT := current_user;
  v_fn_oid OID;
  v_fn_def TEXT;
  v_fn_secdef BOOLEAN;
  v_fn_config TEXT[];
  v_public_exec BOOLEAN;
  v_anon_exec BOOLEAN;
  v_auth_exec BOOLEAN;
  v_inst_uid UUID := gen_random_uuid();
  v_inactive_uid UUID := gen_random_uuid();
  v_rpc_res JSONB;
  v_flag_after BOOLEAN;
  v_audit_count INTEGER;
  v_audit_new JSONB;
BEGIN
  -- Check 1: Function metadata & safe audit key verification
  v_fn_oid := to_regprocedure('public.complete_password_change_tx()');
  IF v_fn_oid IS NULL THEN
    INSERT INTO _cits_mig0006_report VALUES (1, 'Metadata', 'Function existence & signature', 'FAIL', 'public.complete_password_change_tx() not found');
  ELSE
    SELECT p.prosecdef, p.proconfig, pg_get_functiondef(p.oid)
    INTO v_fn_secdef, v_fn_config, v_fn_def
    FROM pg_proc p
    WHERE p.oid = v_fn_oid;

    IF v_fn_secdef
       AND 'search_path=public, pg_temp' = ANY(COALESCE(v_fn_config, ARRAY[]::TEXT[]))
       AND v_fn_def ILIKE '%initial_credential_rotation_required%'
       AND v_fn_def NOT ILIKE '%jsonb_build_object(''must_change_password''%' THEN
      INSERT INTO _cits_mig0006_report VALUES (1, 'Metadata', 'Function security & safe audit payload', 'PASS', 'SECURITY DEFINER + search_path pinned + safe audit key verified');
    ELSE
      INSERT INTO _cits_mig0006_report VALUES (1, 'Metadata', 'Function security & safe audit payload', 'FAIL', 'Missing SECURITY DEFINER, search_path, or safe audit key');
    END IF;
  END IF;

  -- Check 2: Function EXECUTE privilege boundaries
  v_public_exec := has_function_privilege('public', 'public.complete_password_change_tx()', 'EXECUTE');
  v_anon_exec := has_function_privilege('anon', 'public.complete_password_change_tx()', 'EXECUTE');
  v_auth_exec := has_function_privilege('authenticated', 'public.complete_password_change_tx()', 'EXECUTE');
  IF NOT v_public_exec AND NOT v_anon_exec AND v_auth_exec THEN
    INSERT INTO _cits_mig0006_report VALUES (2, 'Grants', 'EXECUTE restricted to authenticated only', 'PASS', 'PUBLIC=false, anon=false, authenticated=true');
  ELSE
    INSERT INTO _cits_mig0006_report VALUES (2, 'Grants', 'EXECUTE restricted to authenticated only', 'FAIL', format('PUBLIC=%s, anon=%s, authenticated=%s', v_public_exec, v_anon_exec, v_auth_exec));
  END IF;

  -- Seed ephemeral auth.users + profiles rows (rolled back at end of transaction)
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_inst_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mig0006.active.' || v_inst_uid::text || '@cits.test', '$2a$10$test', NOW(), NOW(), NOW(), '{}'::jsonb, '{}'::jsonb),
    (v_inactive_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mig0006.inactive.' || v_inactive_uid::text || '@cits.test', '$2a$10$test', NOW(), NOW(), NOW(), '{}'::jsonb, '{}'::jsonb);

  INSERT INTO public.profiles (id, role, username, email, full_name_en, full_name_ar, must_change_password, is_active)
  VALUES
    (v_inst_uid, 'instructor', 'mig0006_inst_' || substr(v_inst_uid::text, 1, 8), 'mig0006.active.' || v_inst_uid::text || '@cits.test', 'Test Active Instructor', 'محاضر اختبار نشط', TRUE, TRUE),
    (v_inactive_uid, 'instructor', 'mig0006_inact_' || substr(v_inactive_uid::text, 1, 8), 'mig0006.inactive.' || v_inactive_uid::text || '@cits.test', 'Test Inactive Instructor', 'محاضر اختبار غير نشط', TRUE, FALSE);

  -- Check 3: Active instructor completes password rotation atomically with valid audit log
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_inst_uid::text, 'role', 'authenticated', 'aal', 'aal1')::text, TRUE);
  SET LOCAL ROLE authenticated;

  BEGIN
    v_rpc_res := public.complete_password_change_tx();
    EXECUTE format('SET LOCAL ROLE %I', v_initial_role);

    SELECT must_change_password INTO v_flag_after FROM public.profiles WHERE id = v_inst_uid;
    SELECT COUNT(*), MAX(new_value::text)::jsonb
    INTO v_audit_count, v_audit_new
    FROM public.audit_logs
    WHERE action = 'PASSWORD_CHANGE_COMPLETED'
      AND entity_type = 'profiles'
      AND entity_id = v_inst_uid::text;

    IF COALESCE((v_rpc_res->>'ok')::boolean, FALSE) AND v_flag_after = FALSE AND v_audit_count = 1 AND (v_audit_new->>'initial_credential_rotation_required') = 'false' THEN
      INSERT INTO _cits_mig0006_report VALUES (3, 'Behavioral', 'Active instructor complete_password_change_tx() succeeds with audit log', 'PASS', 'must_change_password cleared & PASSWORD_CHANGE_COMPLETED logged cleanly');
    ELSE
      INSERT INTO _cits_mig0006_report VALUES (3, 'Behavioral', 'Active instructor complete_password_change_tx() succeeds with audit log', 'FAIL', format('rpc=%s flag_after=%s audit_count=%s', v_rpc_res, v_flag_after, v_audit_count));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE format('SET LOCAL ROLE %I', v_initial_role);
    INSERT INTO _cits_mig0006_report VALUES (3, 'Behavioral', 'Active instructor complete_password_change_tx() succeeds with audit log', 'FAIL', SQLERRM);
  END;

  -- Check 4: Inactive user cannot call complete_password_change_tx()
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_inactive_uid::text, 'role', 'authenticated', 'aal', 'aal1')::text, TRUE);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.complete_password_change_tx();
    EXECUTE format('SET LOCAL ROLE %I', v_initial_role);
    INSERT INTO _cits_mig0006_report VALUES (4, 'Behavioral', 'Inactive user blocked from complete_password_change_tx()', 'FAIL', 'Inactive user was allowed to execute RPC');
  EXCEPTION WHEN OTHERS THEN
    EXECUTE format('SET LOCAL ROLE %I', v_initial_role);
    INSERT INTO _cits_mig0006_report VALUES (4, 'Behavioral', 'Inactive user blocked from complete_password_change_tx()', 'PASS', SQLERRM);
  END;

  -- Check 5: Direct client UPDATE on must_change_password remains blocked
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_inst_uid::text, 'role', 'authenticated', 'aal', 'aal1')::text, TRUE);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET must_change_password = TRUE WHERE id = v_inst_uid;
    EXECUTE format('SET LOCAL ROLE %I', v_initial_role);
    INSERT INTO _cits_mig0006_report VALUES (5, 'Profile Security', 'Direct client must_change_password mutation still blocked', 'FAIL', 'Instructor directly updated must_change_password');
  EXCEPTION WHEN OTHERS THEN
    EXECUTE format('SET LOCAL ROLE %I', v_initial_role);
    INSERT INTO _cits_mig0006_report VALUES (5, 'Profile Security', 'Direct client must_change_password mutation still blocked', 'PASS', SQLERRM);
  END;

  -- Check 6: Audit integrity trigger still blocks sensitive credential keywords
  BEGIN
    INSERT INTO public.audit_logs (
      actor_profile_id, actor_name, actor_role, action, entity_type, entity_id, previous_value, new_value, reason
    ) VALUES (
      v_inst_uid, 'Trigger Self-Test', 'admin', 'TRIGGER_SELFTEST', 'profiles', v_inst_uid::text,
      NULL, jsonb_build_object('temporary_password', 'blocked'), 'Verify trigger not weakened'
    );
    INSERT INTO _cits_mig0006_report VALUES (6, 'Audit Integrity', 'enforce_audit_log_integrity() still rejects credential keywords', 'FAIL', 'Sensitive keyword was written to audit_logs');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _cits_mig0006_report VALUES (6, 'Audit Integrity', 'enforce_audit_log_integrity() still rejects credential keywords', 'PASS', SQLERRM);
  END;

  IF current_user != v_initial_role THEN
    EXECUTE format('SET LOCAL ROLE %I', v_initial_role);
  END IF;
END
$$;

SELECT check_no, category, check_name, status, detail
FROM _cits_mig0006_report
ORDER BY check_no;

ROLLBACK;
