-- =============================================================================
-- CITS Camp Operations Platform — Phase 3 Production Remediation
-- Migration 0006: Fix Initial Password Change Audit Payload Conflict
--
-- Problem Resolved:
--   Migration 0005 defined complete_password_change_tx() to record audit_logs
--   with jsonb_build_object('must_change_password', TRUE/FALSE). Because the
--   immutable audit trigger enforce_audit_log_integrity() strictly blocks any
--   previous_value/new_value containing the substring 'password', calling
--   complete_password_change_tx() raised a CITS Security Violation and rolled
--   back the transaction, preventing newly provisioned instructors from
--   completing mandatory first-login password rotation.
--
-- Remediation Guarantees:
--   - Forward-only, idempotent, non-destructive (existing migrations untouched).
--   - Preserves enforce_audit_log_integrity() without weakening any regex rule.
--   - Preserves SECURITY DEFINER, pinned search_path = public, pg_temp,
--     active-user authorization, row locking, atomic profile update + audit log,
--     and strict privilege grants (authenticated only; revoked from PUBLIC/anon).
--   - Replaces audit metadata key with 'initial_credential_rotation_required'
--     so audit insertion succeeds cleanly inside the same transaction.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.complete_password_change_tx()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID;
  v_prev_required BOOLEAN;
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

  UPDATE public.profiles
  SET must_change_password = FALSE,
      updated_at = NOW()
  WHERE id = v_uid
    AND is_active = TRUE;

  PERFORM append_audit_log_internal(
    NULL,
    'PASSWORD_CHANGE_COMPLETED',
    'profiles',
    v_uid::text,
    jsonb_build_object('initial_credential_rotation_required', COALESCE(v_prev_required, TRUE)),
    jsonb_build_object('initial_credential_rotation_required', FALSE),
    'User completed mandatory initial credential rotation'
  );

  RETURN jsonb_build_object('ok', TRUE, 'profile_id', v_uid, 'must_change_password', FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_password_change_tx() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_password_change_tx() FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_password_change_tx() TO authenticated;

COMMIT;

-- =============================================================================
-- ROLLBACK CONSIDERATIONS (Manual Reversion Only — Non-Destructive)
-- =============================================================================
-- Reverting this migration re-introduces the audit trigger conflict on
-- complete_password_change_tx(). Only revert if rolling back Phase 3 completely
-- by re-applying the function body from 0005_phase2_finalization_hardening.sql.
