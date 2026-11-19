-- =============================================================================
-- CITS Camp Operations Platform — Security Phase Closure Hardening
-- Migration 0008: Close SEC-004 (Anon Login Enumeration), SEC-005 (Admin AAL1
--                 Password-Change RPC Bypass), SEC-006 (Re-Forced Baseline
--                 State Reset), and SEC-007 (Helper Function Least-Privilege)
--
-- Vulnerabilities Closed:
--   SEC-004 (MEDIUM): public.resolve_login_identifier(TEXT) was executable by
--     anon/authenticated, allowing unauthenticated callers to enumerate active
--     usernames and resolve them to user email addresses. Revoked from PUBLIC,
--     anon, and authenticated (service_role only for the rate-limited
--     auth-login Edge Function), paired with a private DB-backed rate-limit
--     bucket store in cits_internal.auth_login_rate_limits.
--   SEC-005 (HIGH): complete_password_change_tx() checked is_active_cits_user()
--     but did not require AAL2 MFA assurance when called by an Admin account,
--     allowing an AAL1 Admin session to clear must_change_password or record
--     PASSWORD_CHANGE_COMPLETED prior to TOTP verification.
--   SEC-006 (MEDIUM): capture_credential_rotation_baseline() left stale
--     last_completed_auth_fingerprint / last_completed_at values when an Admin
--     re-forced must_change_password from FALSE to TRUE.
--   SEC-007 (LOW/MEDIUM): assert_camp_not_archived(UUID) lacked explicit
--     REVOKE ALL FROM PUBLIC, anon, and several helper functions lacked explicit
--     REVOKE ALL FROM anon.
--
-- Remediation Guarantees:
--   - Forward-only, idempotent, non-destructive (migrations 0001..0007 untouched).
--   - Keeps public schema at the exact 29 tables verified by 0003 test suite.
--   - Uses private cits_internal schema with zero grants to PUBLIC/anon/authenticated.
--   - Compatible with 0003 Pre-Flight Guard 1A/1B/1C lexical & call-graph checks.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. SEC-004: LOCK DOWN resolve_login_identifier & ADD SERVER-ONLY RATE LIMITING
-- -----------------------------------------------------------------------------

-- Revoke direct client (anon & authenticated) execution of resolve_login_identifier.
-- Username/email authentication now routes exclusively through the rate-limited,
-- non-enumerable auth-login Edge Function using service_role.
REVOKE ALL ON FUNCTION public.resolve_login_identifier(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_login_identifier(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_login_identifier(TEXT) FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.resolve_login_identifier(TEXT) TO service_role;
  END IF;
END
$$;

-- Private rate-limit bucket table storing ONLY SHA-256 hashes (never plaintext
-- usernames, emails, passwords, or raw IP addresses). Bounded storage via upsert.
CREATE TABLE IF NOT EXISTS cits_internal.auth_login_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count INTEGER NOT NULL DEFAULT 0
);

REVOKE ALL ON TABLE cits_internal.auth_login_rate_limits FROM PUBLIC;
REVOKE ALL ON TABLE cits_internal.auth_login_rate_limits FROM anon;
REVOKE ALL ON TABLE cits_internal.auth_login_rate_limits FROM authenticated;

ALTER TABLE cits_internal.auth_login_rate_limits ENABLE ROW LEVEL SECURITY;

-- Server-only distributed rate-limit evaluator for auth-login Edge Function.
-- Limits: max 10 failed attempts per identifier hash per 15 min,
--         max 25 failed attempts per client IP hash per 15 min.
CREATE OR REPLACE FUNCTION public.evaluate_login_rate_limit_internal(
  p_ip_hash TEXT,
  p_identifier_hash TEXT,
  p_increment BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_window_seconds CONSTANT INTEGER := 900;
  v_max_ip_attempts CONSTANT INTEGER := 25;
  v_max_id_attempts CONSTANT INTEGER := 10;
  v_ip_key TEXT;
  v_id_key TEXT;
  v_ip_count INTEGER := 0;
  v_id_count INTEGER := 0;
  v_ip_window TIMESTAMPTZ;
  v_id_window TIMESTAMPTZ;
  v_ip_retry INTEGER := 0;
  v_id_retry INTEGER := 0;
  v_retry_after INTEGER := 0;
  v_allowed BOOLEAN := TRUE;
BEGIN
  v_ip_key := 'ip:' || LEFT(LOWER(TRIM(COALESCE(p_ip_hash, 'unknown'))), 64);
  v_id_key := 'id:' || LEFT(LOWER(TRIM(COALESCE(p_identifier_hash, 'unknown'))), 64);

  IF COALESCE(p_increment, FALSE) = TRUE THEN
    INSERT INTO cits_internal.auth_login_rate_limits
    VALUES (v_ip_key, v_now, 1)
    ON CONFLICT (bucket_key) DO UPDATE
    SET attempt_count = CASE
          WHEN EXTRACT(EPOCH FROM (v_now - cits_internal.auth_login_rate_limits.window_started_at)) >= v_window_seconds
            THEN 1
          ELSE cits_internal.auth_login_rate_limits.attempt_count + 1
        END,
        window_started_at = CASE
          WHEN EXTRACT(EPOCH FROM (v_now - cits_internal.auth_login_rate_limits.window_started_at)) >= v_window_seconds
            THEN v_now
          ELSE cits_internal.auth_login_rate_limits.window_started_at
        END
    RETURNING attempt_count, window_started_at INTO v_ip_count, v_ip_window;

    INSERT INTO cits_internal.auth_login_rate_limits
    VALUES (v_id_key, v_now, 1)
    ON CONFLICT (bucket_key) DO UPDATE
    SET attempt_count = CASE
          WHEN EXTRACT(EPOCH FROM (v_now - cits_internal.auth_login_rate_limits.window_started_at)) >= v_window_seconds
            THEN 1
          ELSE cits_internal.auth_login_rate_limits.attempt_count + 1
        END,
        window_started_at = CASE
          WHEN EXTRACT(EPOCH FROM (v_now - cits_internal.auth_login_rate_limits.window_started_at)) >= v_window_seconds
            THEN v_now
          ELSE cits_internal.auth_login_rate_limits.window_started_at
        END
    RETURNING attempt_count, window_started_at INTO v_id_count, v_id_window;
  ELSE
    SELECT
      CASE
        WHEN EXTRACT(EPOCH FROM (v_now - r.window_started_at)) >= v_window_seconds THEN 0
        ELSE r.attempt_count
      END,
      r.window_started_at
    INTO v_ip_count, v_ip_window
    FROM cits_internal.auth_login_rate_limits r
    WHERE r.bucket_key = v_ip_key;

    SELECT
      CASE
        WHEN EXTRACT(EPOCH FROM (v_now - r.window_started_at)) >= v_window_seconds THEN 0
        ELSE r.attempt_count
      END,
      r.window_started_at
    INTO v_id_count, v_id_window
    FROM cits_internal.auth_login_rate_limits r
    WHERE r.bucket_key = v_id_key;
  END IF;

  v_ip_count := COALESCE(v_ip_count, 0);
  v_id_count := COALESCE(v_id_count, 0);

  IF v_ip_count >= v_max_ip_attempts AND v_ip_window IS NOT NULL THEN
    v_ip_retry := GREATEST(1, v_window_seconds - FLOOR(EXTRACT(EPOCH FROM (v_now - v_ip_window)))::integer);
  END IF;

  IF v_id_count >= v_max_id_attempts AND v_id_window IS NOT NULL THEN
    v_id_retry := GREATEST(1, v_window_seconds - FLOOR(EXTRACT(EPOCH FROM (v_now - v_id_window)))::integer);
  END IF;

  v_retry_after := GREATEST(v_ip_retry, v_id_retry);
  v_allowed := (v_ip_count < v_max_ip_attempts AND v_id_count < v_max_id_attempts);

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'retry_after_seconds', v_retry_after,
    'ip_count', v_ip_count,
    'identifier_count', v_id_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_login_rate_limit_internal(TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.evaluate_login_rate_limit_internal(TEXT, TEXT, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.evaluate_login_rate_limit_internal(TEXT, TEXT, BOOLEAN) FROM authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.evaluate_login_rate_limit_internal(TEXT, TEXT, BOOLEAN) TO service_role;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. SEC-006: CLEAN BASELINE RESET WHEN must_change_password RE-FORCED TO TRUE
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.capture_credential_rotation_baseline()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enc TEXT;
  v_fingerprint TEXT;
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.must_change_password = TRUE AND COALESCE(OLD.must_change_password, FALSE) = FALSE) THEN
    SELECT COALESCE(u.encrypted_password, '')
    INTO v_enc
    FROM auth.users u
    WHERE u.id = NEW.id;

    v_fingerprint := encode(sha256(convert_to(COALESCE(v_enc, ''), 'UTF8')), 'hex');

    IF NEW.must_change_password = TRUE THEN
      INSERT INTO cits_internal.credential_rotation_baselines
      VALUES (NEW.id, v_fingerprint, NULL, NOW(), NULL)
      ON CONFLICT (profile_id) DO UPDATE
      SET baseline_auth_fingerprint = EXCLUDED.baseline_auth_fingerprint,
          last_completed_auth_fingerprint = NULL,
          baseline_captured_at = NOW(),
          last_completed_at = NULL;
    ELSE
      INSERT INTO cits_internal.credential_rotation_baselines
      VALUES (
        NEW.id,
        v_fingerprint,
        CASE WHEN char_length(COALESCE(v_enc, '')) >= 20 THEN v_fingerprint ELSE NULL END,
        NOW(),
        CASE WHEN char_length(COALESCE(v_enc, '')) >= 20 THEN NOW() ELSE NULL END
      )
      ON CONFLICT (profile_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_credential_rotation_baseline() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.capture_credential_rotation_baseline() FROM anon;
REVOKE ALL ON FUNCTION public.capture_credential_rotation_baseline() FROM authenticated;

-- -----------------------------------------------------------------------------
-- 3. SEC-005: ENFORCE ADMIN AAL2 MFA ASSURANCE INSIDE complete_password_change_tx
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_password_change_tx()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID;
  v_role user_role;
  v_prev_required BOOLEAN;
  v_current_enc TEXT;
  v_current_fingerprint TEXT;
  v_baseline_fingerprint TEXT;
  v_last_completed_fingerprint TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR NOT is_active_cits_user() THEN
    RAISE EXCEPTION 'CITS Authorization Denied: Active authenticated account required.';
  END IF;

  SELECT role, must_change_password
  INTO v_role, v_prev_required
  FROM public.profiles
  WHERE id = v_uid
    AND is_active = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CITS Authorization Denied: Active profile not found.';
  END IF;

  IF v_role = 'admin' AND COALESCE(auth.jwt() ->> 'aal', '') != 'aal2' THEN
    RAISE EXCEPTION 'CITS Security Violation: Admin MFA (AAL2) verification is required before completing credential rotation.';
  END IF;

  SELECT COALESCE(u.encrypted_password, '')
  INTO v_current_enc
  FROM auth.users u
  WHERE u.id = v_uid;

  IF char_length(COALESCE(v_current_enc, '')) < 20 THEN
    RAISE EXCEPTION 'CITS Security Violation: Auth credential is not set. Update your password in Auth before completing onboarding.';
  END IF;

  v_current_fingerprint := encode(sha256(convert_to(v_current_enc, 'UTF8')), 'hex');

  SELECT b.baseline_auth_fingerprint, b.last_completed_auth_fingerprint
  INTO v_baseline_fingerprint, v_last_completed_fingerprint
  FROM cits_internal.credential_rotation_baselines b
  WHERE b.profile_id = v_uid
  FOR UPDATE;

  IF COALESCE(v_prev_required, TRUE) = TRUE THEN
    IF v_baseline_fingerprint IS NULL OR v_current_fingerprint = v_baseline_fingerprint THEN
      RAISE EXCEPTION 'CITS Security Violation: Credential rotation not verified in Auth. Update your password before completing mandatory onboarding.';
    END IF;

    UPDATE public.profiles
    SET must_change_password = FALSE,
        updated_at = NOW()
    WHERE id = v_uid
      AND is_active = TRUE;

    UPDATE cits_internal.credential_rotation_baselines
    SET last_completed_auth_fingerprint = v_current_fingerprint,
        last_completed_at = NOW()
    WHERE profile_id = v_uid;

    PERFORM append_audit_log_internal(
      NULL,
      'PASSWORD_CHANGE_COMPLETED',
      'profiles',
      v_uid::text,
      jsonb_build_object('initial_credential_rotation_required', TRUE),
      jsonb_build_object('initial_credential_rotation_required', FALSE),
      'User completed mandatory initial credential rotation verified against Auth state'
    );

    RETURN jsonb_build_object(
      'ok', TRUE,
      'profile_id', v_uid,
      'must_change_password', FALSE,
      'already_completed', FALSE
    );
  END IF;

  -- Already must_change_password = FALSE: check whether a real recovery rotation occurred
  IF v_last_completed_fingerprint IS DISTINCT FROM v_current_fingerprint THEN
    INSERT INTO cits_internal.credential_rotation_baselines
    VALUES (v_uid, v_current_fingerprint, v_current_fingerprint, NOW(), NOW())
    ON CONFLICT (profile_id) DO UPDATE
    SET last_completed_auth_fingerprint = EXCLUDED.last_completed_auth_fingerprint,
        last_completed_at = NOW();

    PERFORM append_audit_log_internal(
      NULL,
      'PASSWORD_CHANGE_COMPLETED',
      'profiles',
      v_uid::text,
      jsonb_build_object('initial_credential_rotation_required', FALSE),
      jsonb_build_object('initial_credential_rotation_required', FALSE),
      'User completed account credential recovery rotation verified against Auth state'
    );

    RETURN jsonb_build_object(
      'ok', TRUE,
      'profile_id', v_uid,
      'must_change_password', FALSE,
      'already_completed', FALSE
    );
  END IF;

  -- Idempotent no-op for repeated completion calls without a new Auth change
  RETURN jsonb_build_object(
    'ok', TRUE,
    'profile_id', v_uid,
    'must_change_password', FALSE,
    'already_completed', TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_password_change_tx() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_password_change_tx() FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_password_change_tx() TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. SEC-007: LEAST-PRIVILEGE EXECUTE HARDENING ON HELPER FUNCTIONS
-- -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.assert_camp_not_archived(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_camp_not_archived(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.assert_camp_not_archived(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_student_group_for_day(UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_student_group_for_day(UUID, UUID, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_student_group_for_day(UUID, UUID, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.haversine_distance_meters(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.haversine_distance_meters(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM anon;
GRANT EXECUTE ON FUNCTION public.haversine_distance_meters(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

REVOKE ALL ON FUNCTION public.is_active_cits_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_cits_user() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_active_cits_user() TO authenticated;

REVOKE ALL ON FUNCTION public.is_instructor_assigned_to_camp(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_instructor_assigned_to_camp(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_instructor_assigned_to_camp(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.is_instructor_assigned_to_group(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_instructor_assigned_to_group(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_instructor_assigned_to_group(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.is_lecture_active_instructor(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_lecture_active_instructor(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_lecture_active_instructor(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.append_audit_log_internal(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_audit_log_internal(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.append_audit_log_internal(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT) FROM authenticated;

COMMIT;

-- =============================================================================
-- ROLLBACK CONSIDERATIONS (Manual Reversion Only — Non-Destructive)
-- =============================================================================
-- Reverting this migration re-opens SEC-004 (anon resolve_login_identifier
-- enumeration), SEC-005 (Admin AAL1 complete_password_change_tx bypass),
-- SEC-006 (stale last_completed_auth_fingerprint after re-forced reset), and
-- SEC-007 (PUBLIC/anon EXECUTE on assert_camp_not_archived). Only revert if
-- rolling back auth-login Edge Function deployment simultaneously.
