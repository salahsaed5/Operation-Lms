-- =============================================================================
-- CITS Camp Operations Platform — Security Hardening Remediation
-- Migration 0007: Server-Side Enforcement of Forced Password Change &
--                 Credential Rotation Verification
--
-- Vulnerabilities Closed:
--   SEC-001 (CRITICAL): complete_password_change_tx() previously cleared
--     profiles.must_change_password = FALSE without verifying that
--     auth.users.encrypted_password actually changed in Supabase Auth, allowing
--     any authenticated user to bypass forced password change via a direct RPC
--     call and forge a PASSWORD_CHANGE_COMPLETED audit row.
--   SEC-002 (CRITICAL): must_change_password = TRUE was previously enforced
--     only in React client routing; current_instructor_id(), is_cits_admin(),
--     operational RLS policies, and operational RPCs still permitted full DB
--     read/write access via direct Supabase API calls with a valid JWT.
--   SEC-003 (MEDIUM): Deactivated instructors could still SELECT their own row
--     in public.instructors because the SELECT policy omitted
--     is_active_cits_user().
--
-- Remediation Guarantees:
--   - Forward-only, idempotent, non-destructive (migrations 0001..0006 untouched).
--   - Private internal schema cits_internal (zero grants to PUBLIC/anon/authenticated,
--     outside PostgREST exposed schemas, preserves exact 29 public tables).
--   - Stores ONLY one-way SHA-256 hex fingerprints of auth.users.encrypted_password
--     (never plaintext passwords, never raw bcrypt hashes, never exposed to clients).
--   - Enforces must_change_password = FALSE server-side in current_instructor_id(),
--     is_cits_admin(), is_cits_operational_user(), operational RLS policies,
--     storage.objects (via current_instructor_id / is_cits_admin), and all
--     operational RPCs, while preserving minimal self-profile / self-instructor /
--     self-admin_account SELECT + Admin TOTP MFA verification + password rotation
--     onboarding flows without deadlock.
--   - Compatible with 0003 Pre-Flight Guard 1A/1B/1C lexical & call-graph checks.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. PRIVATE SERVER-ONLY CREDENTIAL ROTATION BASELINE STORE
-- -----------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS cits_internal;
REVOKE ALL ON SCHEMA cits_internal FROM PUBLIC;
REVOKE ALL ON SCHEMA cits_internal FROM anon;
REVOKE ALL ON SCHEMA cits_internal FROM authenticated;

CREATE TABLE IF NOT EXISTS cits_internal.credential_rotation_baselines (
  profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  baseline_auth_fingerprint TEXT NOT NULL,
  last_completed_auth_fingerprint TEXT,
  baseline_captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_completed_at TIMESTAMPTZ
);

REVOKE ALL ON TABLE cits_internal.credential_rotation_baselines FROM PUBLIC;
REVOKE ALL ON TABLE cits_internal.credential_rotation_baselines FROM anon;
REVOKE ALL ON TABLE cits_internal.credential_rotation_baselines FROM authenticated;

ALTER TABLE cits_internal.credential_rotation_baselines ENABLE ROW LEVEL SECURITY;

-- Backfill baselines for all existing profiles without altering any profile data
INSERT INTO cits_internal.credential_rotation_baselines (
  profile_id,
  baseline_auth_fingerprint,
  last_completed_auth_fingerprint,
  baseline_captured_at,
  last_completed_at
)
SELECT
  p.id,
  encode(sha256(convert_to(COALESCE(u.encrypted_password, ''), 'UTF8')), 'hex'),
  CASE
    WHEN p.must_change_password = FALSE AND char_length(COALESCE(u.encrypted_password, '')) >= 20
      THEN encode(sha256(convert_to(COALESCE(u.encrypted_password, ''), 'UTF8')), 'hex')
    ELSE NULL
  END,
  NOW(),
  CASE
    WHEN p.must_change_password = FALSE AND char_length(COALESCE(u.encrypted_password, '')) >= 20
      THEN p.updated_at
    ELSE NULL
  END
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
ON CONFLICT (profile_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. TRIGGER: CAPTURE AUTH CREDENTIAL FINGERPRINT ON PROVISIONING / RESET
-- -----------------------------------------------------------------------------
-- Snapshots the SHA-256 fingerprint of auth.users.encrypted_password whenever a
-- profile is created or marked must_change_password = TRUE. Runs SECURITY DEFINER
-- so authenticated callers never require access to auth.users or cits_internal.

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
          baseline_captured_at = NOW();
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

DROP TRIGGER IF EXISTS trg_capture_credential_rotation_baseline ON public.profiles;
CREATE TRIGGER trg_capture_credential_rotation_baseline
AFTER INSERT OR UPDATE OF must_change_password ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.capture_credential_rotation_baseline();

-- -----------------------------------------------------------------------------
-- 3. SERVER-SIDE OPERATIONAL AUTHORIZATION HELPERS (ENFORCE must_change_password)
-- -----------------------------------------------------------------------------

-- Operational account check: active AND mandatory initial password change completed.
-- Note: is_active_cits_user() remains intentionally focused on is_active = TRUE so
-- minimal login bootstrap SELECT on own profiles / instructors / admin_accounts
-- and onboarding RPCs (complete_password_change_tx / record_admin_totp_verified_tx)
-- can identify the caller without deadlock.
CREATE OR REPLACE FUNCTION public.is_cits_operational_user()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = TRUE
      AND p.must_change_password = FALSE
  );
$$;

REVOKE ALL ON FUNCTION public.is_cits_operational_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_cits_operational_user() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_cits_operational_user() TO authenticated;

-- Upgrade current_instructor_id() to enforce must_change_password = FALSE server-side.
-- This blocks all instructor operational RLS policies, checkin-selfies storage
-- policies, and instructor operational RPCs until initial password rotation succeeds.
CREATE OR REPLACE FUNCTION public.current_instructor_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT i.id
  FROM public.instructors i
  JOIN public.profiles p ON p.id = i.profile_id
  WHERE i.profile_id = auth.uid()
    AND p.role = 'instructor'
    AND p.is_active = TRUE
    AND p.must_change_password = FALSE
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_instructor_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_instructor_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_instructor_id() TO authenticated;

-- Upgrade is_cits_admin() to enforce must_change_password = FALSE server-side
-- in addition to active Admin profile, admin_accounts slot, and AAL2 MFA assurance.
CREATE OR REPLACE FUNCTION public.is_cits_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.admin_accounts a ON a.profile_id = p.id
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
      AND p.is_active = TRUE
      AND p.must_change_password = FALSE
      AND COALESCE(auth.jwt() ->> 'aal', '') = 'aal2'
  );
$$;

REVOKE ALL ON FUNCTION public.is_cits_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_cits_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_cits_admin() TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. NON-DEADLOCKING ADMIN TOTP MFA RECORDING RPC
-- -----------------------------------------------------------------------------
-- Admins must complete MFA (AAL2) before forced password change if both apply.
-- Verify active Admin profile, valid admin_accounts slot, AAL2 JWT assurance,
-- and verified TOTP factor in auth.mfa_factors directly so onboarding cannot deadlock.

CREATE OR REPLACE FUNCTION public.record_admin_totp_verified_tx()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID;
  v_now TIMESTAMPTZ := NOW();
  v_is_valid_mfa_admin BOOLEAN := FALSE;
  v_has_verified_totp BOOLEAN := FALSE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR COALESCE(auth.jwt() ->> 'aal', '') != 'aal2' THEN
    RAISE EXCEPTION 'CITS Security Violation: Only verified AAL2 Admins can record TOTP MFA status.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.admin_accounts a ON a.profile_id = p.id
    WHERE p.id = v_uid
      AND p.role = 'admin'
      AND p.is_active = TRUE
      AND a.assigned_slot IN (1, 2)
  ) INTO v_is_valid_mfa_admin;

  IF NOT v_is_valid_mfa_admin THEN
    RAISE EXCEPTION 'CITS Security Violation: Only verified AAL2 Admins can record TOTP MFA status.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM auth.mfa_factors f
    WHERE f.user_id = v_uid
      AND f.factor_type = 'totp'
      AND f.status = 'verified'
  ) INTO v_has_verified_totp;

  IF NOT v_has_verified_totp THEN
    RAISE EXCEPTION 'CITS MFA Violation: No verified TOTP factor exists in auth.mfa_factors for this Admin.';
  END IF;

  UPDATE public.admin_accounts
  SET totp_enrolled = TRUE,
      totp_verified_at = v_now
  WHERE profile_id = v_uid;

  PERFORM append_audit_log_internal(
    NULL,
    'ADMIN_MFA_VERIFIED',
    'admin_accounts',
    v_uid::text,
    NULL,
    jsonb_build_object('totp_enrolled', TRUE, 'aal', 'aal2'),
    'Admin TOTP MFA verified with AAL2 session assurance'
  );

  RETURN jsonb_build_object('ok', TRUE, 'profile_id', v_uid, 'totp_verified_at', v_now);
END;
$$;

REVOKE ALL ON FUNCTION public.record_admin_totp_verified_tx() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_admin_totp_verified_tx() FROM anon;
GRANT EXECUTE ON FUNCTION public.record_admin_totp_verified_tx() TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. HARDENED complete_password_change_tx() — VERIFIES AUTH CREDENTIAL ROTATION
-- -----------------------------------------------------------------------------
-- Prevents direct RPC bypass without first rotating credentials via Supabase Auth:
--   1. Requires active authenticated account (auth.uid() + is_active_cits_user()).
--   2. Locks caller profile row (FOR UPDATE) and reads auth.users.encrypted_password.
--   3. Rejects accounts with empty/unset Auth credentials (e.g., unaccepted invite).
--   4. When must_change_password = TRUE, compares SHA-256 fingerprint of current
--      auth.users.encrypted_password against cits_internal.credential_rotation_baselines.
--      Raises CITS Security Violation if unchanged (blocks direct RPC bypass!).
--   5. Clears must_change_password = FALSE atomically, updates baseline state, and
--      records a single credential-free PASSWORD_CHANGE_COMPLETED audit log.
--   6. When must_change_password = FALSE:
--      - If a genuine recovery rotation changed encrypted_password since the last
--        completed fingerprint, updates state and logs recovery rotation.
--      - Otherwise returns idempotently (already_completed = TRUE) without writing
--        misleading duplicate audit logs.

CREATE OR REPLACE FUNCTION public.complete_password_change_tx()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID;
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

  SELECT must_change_password
  INTO v_prev_required
  FROM public.profiles
  WHERE id = v_uid
    AND is_active = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CITS Authorization Denied: Active profile not found.';
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
-- 6. TIGHTEN REMAINING RLS POLICIES & TRIGGERS FOR must_change_password & ACTIVE
-- -----------------------------------------------------------------------------

-- 6.1 instructors SELECT: block deactivated instructors from reading own row (SEC-003),
--     while keeping onboarding identity resolution working during must_change_password = TRUE.
DROP POLICY IF EXISTS "Instructors read own instructor record only" ON public.instructors;
CREATE POLICY "Instructors read own instructor record only" ON public.instructors
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() AND is_active_cits_user());

-- 6.2 profiles UPDATE + enforce_profile_security(): block self-profile mutations
--     until mandatory initial password rotation is completed.
DROP POLICY IF EXISTS "Instructors update own profile non-privileged fields" ON public.profiles;
CREATE POLICY "Instructors update own profile non-privileged fields" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() AND is_cits_operational_user())
  WITH CHECK (id = auth.uid() AND role = 'instructor' AND is_cits_operational_user());

CREATE OR REPLACE FUNCTION public.enforce_profile_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_profiles INTEGER;
  v_trusted_internal BOOLEAN := FALSE;
BEGIN
  v_trusted_internal := (current_user NOT IN ('anon', 'authenticated'));

  IF TG_OP = 'INSERT' AND NEW.role = 'admin' THEN
    PERFORM pg_advisory_xact_lock(hashtext('cits_admin_accounts_creation_lock'));
    SELECT COUNT(*) INTO v_admin_profiles FROM public.profiles WHERE role = 'admin';
    IF v_admin_profiles >= 2 THEN
      RAISE EXCEPTION 'CITS Policy Violation: Cannot create more than two Admin profiles.';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.role IS DISTINCT FROM NEW.role THEN
      RAISE EXCEPTION 'CITS Security Violation: User role is immutable after account creation.';
    END IF;

    IF NOT is_cits_admin() AND NOT v_trusted_internal THEN
      IF NOT is_active_cits_user() THEN
        RAISE EXCEPTION 'CITS Security Violation: Deactivated accounts cannot modify profile data.';
      END IF;
      IF NOT is_cits_operational_user() OR COALESCE(OLD.must_change_password, FALSE) = TRUE THEN
        RAISE EXCEPTION 'CITS Security Violation: Complete mandatory initial credential rotation before modifying profile data.';
      END IF;
      IF OLD.is_active IS DISTINCT FROM NEW.is_active
         OR OLD.username IS DISTINCT FROM NEW.username
         OR OLD.email IS DISTINCT FROM NEW.email
         OR OLD.must_change_password IS DISTINCT FROM NEW.must_change_password THEN
        RAISE EXCEPTION 'CITS Security Violation: Only an Admin can modify account activation, onboarding state, or identity identifiers.';
      END IF;
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- 6.3 notifications SELECT & UPDATE + enforce_notification_update_security()
DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (recipient_profile_id = auth.uid() AND is_cits_operational_user());

DROP POLICY IF EXISTS "Users mark own notifications read" ON public.notifications;
CREATE POLICY "Users mark own notifications read" ON public.notifications
  FOR UPDATE TO authenticated
  USING (recipient_profile_id = auth.uid() AND is_cits_operational_user())
  WITH CHECK (recipient_profile_id = auth.uid() AND is_cits_operational_user());

CREATE OR REPLACE FUNCTION public.enforce_notification_update_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF is_cits_admin() THEN
    RETURN NEW;
  END IF;

  IF NOT is_cits_operational_user() THEN
    RAISE EXCEPTION 'CITS Security Violation: Operational account with completed onboarding required to modify notifications.';
  END IF;

  IF OLD.recipient_profile_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'CITS Security Violation: Cannot modify notifications belonging to another user.';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.recipient_profile_id IS DISTINCT FROM OLD.recipient_profile_id
     OR NEW.title_en IS DISTINCT FROM OLD.title_en
     OR NEW.title_ar IS DISTINCT FROM OLD.title_ar
     OR NEW.body_en IS DISTINCT FROM OLD.body_en
     OR NEW.body_ar IS DISTINCT FROM OLD.body_ar
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'CITS Security Violation: Users may only mark their own notifications as read.';
  END IF;

  RETURN NEW;
END;
$$;

-- 6.4 attachments SELECT & INSERT
DROP POLICY IF EXISTS "Instructors read own attachments" ON public.attachments;
CREATE POLICY "Instructors read own attachments" ON public.attachments
  FOR SELECT TO authenticated
  USING (uploaded_by = auth.uid() AND is_cits_operational_user());

DROP POLICY IF EXISTS "Instructors insert own attachments" ON public.attachments;
CREATE POLICY "Instructors insert own attachments" ON public.attachments
  FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND is_cits_operational_user());

-- 6.5 audit_logs INSERT policy & enforce_audit_log_integrity()
DROP POLICY IF EXISTS "Instructors insert own audit_logs" ON public.audit_logs;
CREATE POLICY "Instructors insert own audit_logs" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_profile_id = auth.uid()
    AND actor_role = 'instructor'
    AND is_cits_operational_user()
  );

CREATE OR REPLACE FUNCTION public.enforce_audit_log_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_combined TEXT;
  v_trusted_internal BOOLEAN := FALSE;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'CITS Security Violation: audit_logs are immutable and cannot be updated or deleted.';
  END IF;

  v_trusted_internal := (current_user NOT IN ('anon', 'authenticated'));

  IF NOT is_cits_admin() AND NOT v_trusted_internal THEN
    IF NOT is_cits_operational_user() THEN
      RAISE EXCEPTION 'CITS Security Violation: Active account with completed onboarding required to write audit logs.';
    END IF;
    IF NEW.actor_profile_id IS DISTINCT FROM auth.uid() OR NEW.actor_role != 'instructor' THEN
      RAISE EXCEPTION 'CITS Security Violation: Instructors cannot forge audit actor metadata.';
    END IF;
    IF NEW.action IN (
      'CAMP_ACTIVATED', 'CAMP_ARCHIVED', 'ADMIN_ACCOUNT_BOOTSTRAPPED',
      'ADMIN_MFA_VERIFIED', 'BACKUP_JSON_EXPORTED',
      'ENTITLEMENT_APPROVED', 'ENTITLEMENT_EXCLUDED', 'STUDENT_TRANSFERRED',
      'STUDENTS_BATCH_IMPORTED', 'EXCEPTION_APPROVED', 'EXCEPTION_REJECTED',
      'ATTENDANCE_ADMIN_CORRECTED', 'ATTENDANCE_SUBMITTED_TX', 'DAILY_CHECKIN_SUBMITTED',
      'LECTURE_ACKNOWLEDGED', 'PASSWORD_CHANGE_COMPLETED', 'INSTRUCTOR_ACCOUNT_PROVISIONED'
    ) THEN
      RAISE EXCEPTION 'CITS Security Violation: Action % is reserved for verified Admin/server transactions.', NEW.action;
    END IF;
  END IF;

  v_combined := LOWER(COALESCE(NEW.previous_value::text, '') || ' ' || COALESCE(NEW.new_value::text, ''));
  IF v_combined ~ '(password|service_role|totp_secret|mfa_secret|access_token|refresh_token|secret_key)' THEN
    RAISE EXCEPTION 'CITS Security Violation: Sensitive credentials or tokens must never be written to audit_logs.';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;

-- =============================================================================
-- ROLLBACK CONSIDERATIONS (Manual Reversion Only — Non-Destructive)
-- =============================================================================
-- Reverting this migration re-opens SEC-001 (direct complete_password_change_tx
-- bypass), SEC-002 (missing server-side must_change_password RLS/RPC enforcement),
-- and SEC-003 (deactivated instructor read access to own instructors row).
-- To revert only if required: drop trigger trg_capture_credential_rotation_baseline,
-- restore helper/trigger/RPC definitions from migrations 0004..0006, and drop
-- schema cits_internal only after confirming no compliance audit depends on it.
