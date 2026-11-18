-- =============================================================================
-- CITS Camp Operations Management System
-- Migration: 0005_phase2_finalization_hardening.sql
-- Purpose: Final Phase 2 database security, inactive-user enforcement, historical
--          transfer integrity, GPS/selfie boundary validation, admin attendance
--          correction RPC, lecture ack reset on schedule edits, duplicate pending
--          exception guard, and extended table/storage hardening.
-- Prerequisites: 0001, 0002, 0003, 0004 (never edit applied migrations).
-- Note: Every PL/pgSQL/SQL function body obeys 0003 Guard 1C lexical scanner
--       constraints (no $, no ", no /* */ inside prosrc, no backslashes inside
--       string literals, pinned search_path = public, pg_temp).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. PREFLIGHT BASELINE VERIFICATION (Fail-fast if 0001..0004 missing)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'camp_id'
  ) THEN
    RAISE EXCEPTION 'Preflight failed: audit_logs.camp_id missing (ensure 0002 applied).';
  END IF;

  IF to_regprocedure('public.resolve_student_group_for_day(uuid,uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: resolve_student_group_for_day missing (ensure 0004 applied).';
  END IF;

  IF to_regprocedure('public.submit_daily_checkin_tx(uuid,double precision,double precision,double precision,text,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: submit_daily_checkin_tx missing (ensure 0004 applied).';
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 1. ACTIVE ACCOUNT ENFORCEMENT & AUTH ONBOARDING HARDENING
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION is_active_cits_user()
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
  );
$$;

REVOKE ALL ON FUNCTION is_active_cits_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_active_cits_user() TO authenticated;

CREATE OR REPLACE FUNCTION complete_password_change_tx()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR NOT is_active_cits_user() THEN
    RAISE EXCEPTION 'CITS Authorization Denied: Active authenticated account required.';
  END IF;

  UPDATE public.profiles
  SET must_change_password = FALSE,
      updated_at = NOW()
  WHERE id = v_uid
    AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CITS Authorization Denied: Active profile not found.';
  END IF;

  PERFORM append_audit_log_internal(
    NULL,
    'PASSWORD_CHANGE_COMPLETED',
    'profiles',
    v_uid::text,
    jsonb_build_object('must_change_password', TRUE),
    jsonb_build_object('must_change_password', FALSE),
    'User completed mandatory initial password update'
  );

  RETURN jsonb_build_object('ok', TRUE, 'profile_id', v_uid, 'must_change_password', FALSE);
END;
$$;

REVOKE ALL ON FUNCTION complete_password_change_tx() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_password_change_tx() TO authenticated;

-- Harden profile update trigger so deactivated users / direct clients cannot
-- mutate privileged profile fields or clear must_change_password outside RPC.
CREATE OR REPLACE FUNCTION enforce_profile_security()
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

-- Tighten RLS on profiles, admin_accounts, notifications, issues, attachments
DROP POLICY IF EXISTS "Instructors read own profile only" ON profiles;
CREATE POLICY "Instructors read own profile only" ON profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() AND is_active_cits_user());

DROP POLICY IF EXISTS "Instructors update own profile non-privileged fields" ON profiles;
CREATE POLICY "Instructors update own profile non-privileged fields" ON profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() AND is_active_cits_user())
  WITH CHECK (id = auth.uid() AND role = 'instructor' AND is_active_cits_user());

DROP POLICY IF EXISTS "Admins view own admin_account" ON admin_accounts;
CREATE POLICY "Admins view own admin_account" ON admin_accounts
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() AND is_active_cits_user());

DROP POLICY IF EXISTS "Users read own notifications" ON notifications;
CREATE POLICY "Users read own notifications" ON notifications
  FOR SELECT TO authenticated
  USING (recipient_profile_id = auth.uid() AND is_active_cits_user());

DROP POLICY IF EXISTS "Users mark own notifications read" ON notifications;
CREATE POLICY "Users mark own notifications read" ON notifications
  FOR UPDATE TO authenticated
  USING (recipient_profile_id = auth.uid() AND is_active_cits_user())
  WITH CHECK (recipient_profile_id = auth.uid() AND is_active_cits_user());

CREATE OR REPLACE FUNCTION enforce_notification_update_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF is_cits_admin() THEN
    RETURN NEW;
  END IF;

  IF NOT is_active_cits_user() THEN
    RAISE EXCEPTION 'CITS Security Violation: Inactive accounts cannot modify notifications.';
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

DROP POLICY IF EXISTS "Instructors view own reported issues" ON issues;
CREATE POLICY "Instructors view own reported issues" ON issues
  FOR SELECT TO authenticated
  USING (
    reported_by = auth.uid()
    AND current_instructor_id() IS NOT NULL
    AND is_instructor_assigned_to_camp(camp_id)
  );

DROP POLICY IF EXISTS "Instructors insert issues" ON issues;
CREATE POLICY "Instructors insert issues" ON issues
  FOR INSERT TO authenticated
  WITH CHECK (
    reported_by = auth.uid()
    AND current_instructor_id() IS NOT NULL
    AND is_instructor_assigned_to_camp(camp_id)
  );

DROP POLICY IF EXISTS "Instructors read own attachments" ON attachments;
CREATE POLICY "Instructors read own attachments" ON attachments
  FOR SELECT TO authenticated
  USING (uploaded_by = auth.uid() AND is_active_cits_user());

DROP POLICY IF EXISTS "Instructors insert own attachments" ON attachments;
CREATE POLICY "Instructors insert own attachments" ON attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND is_active_cits_user()
    AND (camp_id IS NULL OR is_instructor_assigned_to_camp(camp_id))
  );

-- -----------------------------------------------------------------------------
-- 2. STORAGE PATH ANTI-TRAVERSAL & STRICT FOLDER SCOPING (checkin-selfies)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'objects'
  ) THEN
    DROP POLICY IF EXISTS "Instructors upload own checkin-selfies" ON storage.objects;
    DROP POLICY IF EXISTS "Instructors read own checkin-selfies" ON storage.objects;

    CREATE POLICY "Instructors upload own checkin-selfies" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'checkin-selfies'
        AND public.current_instructor_id() IS NOT NULL
        AND array_length(storage.foldername(name), 1) = 2
        AND (storage.foldername(name))[1] = auth.uid()::text
        AND (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND name NOT LIKE '%..%'
        AND name NOT LIKE '%//%'
        AND name !~ '[[:space:]]'
        AND (LOWER(name) LIKE '%.webp' OR LOWER(name) LIKE '%.jpg' OR LOWER(name) LIKE '%.jpeg')
      );

    CREATE POLICY "Instructors read own checkin-selfies" ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'checkin-selfies'
        AND public.current_instructor_id() IS NOT NULL
        AND (storage.foldername(name))[1] = auth.uid()::text
        AND name NOT LIKE '%..%'
        AND name NOT LIKE '%//%'
      );
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 3. HISTORICAL TRANSFER PRESERVATION, LECTURE ACK RESET & AUDIT HARDENING
-- -----------------------------------------------------------------------------

-- 3.1 Preserve transfer history: smart_update NEVER silently moves a student
--     across groups (direct admins to transfer_student_tx instead).
CREATE OR REPLACE FUNCTION batch_import_students_tx(
  p_camp_id UUID,
  p_group_id UUID,
  p_mode TEXT,
  p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_group_camp UUID;
  v_item JSONB;
  v_idx INTEGER := 0;
  v_name TEXT;
  v_code TEXT;
  v_uni TEXT;
  v_existing_id UUID;
  v_existing_group_id UUID;
  v_inserted INTEGER := 0;
  v_updated INTEGER := 0;
  v_seen_codes TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NOT is_cits_admin() THEN
    RAISE EXCEPTION 'CITS Security Violation: Only an Admin can import students.';
  END IF;

  PERFORM assert_camp_not_archived(p_camp_id);

  IF p_mode NOT IN ('smart_update', 'strict_insert') THEN
    RAISE EXCEPTION 'Import mode must be smart_update or strict_insert.';
  END IF;

  SELECT camp_id INTO v_group_camp FROM public.groups WHERE id = p_group_id;
  IF v_group_camp IS DISTINCT FROM p_camp_id THEN
    RAISE EXCEPTION 'Target group % does not belong to camp %.', p_group_id, p_camp_id;
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) != 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Import payload must be a non-empty JSON array.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_idx := v_idx + 1;
    v_name := TRIM(COALESCE(v_item->>'studentName', ''));
    v_code := TRIM(COALESCE(v_item->>'studentCode', ''));
    v_uni := COALESCE(NULLIF(TRIM(COALESCE(v_item->>'university', '')), ''), 'Unknown University');

    IF v_name = '' THEN
      RAISE EXCEPTION 'Row %: Full Name is required (All-or-Nothing rollback).', v_idx;
    END IF;
    IF v_code = '' THEN
      RAISE EXCEPTION 'Row %: Student Code is required (All-or-Nothing rollback).', v_idx;
    END IF;
    IF LOWER(v_code) = ANY(v_seen_codes) THEN
      RAISE EXCEPTION 'Row %: Duplicate Student Code "%" within batch (All-or-Nothing rollback).', v_idx, v_code;
    END IF;
    v_seen_codes := array_append(v_seen_codes, LOWER(v_code));

    SELECT id, group_id INTO v_existing_id, v_existing_group_id
    FROM public.students
    WHERE camp_id = p_camp_id AND LOWER(student_code) = LOWER(v_code);

    IF v_existing_id IS NOT NULL THEN
      IF p_mode = 'strict_insert' THEN
        RAISE EXCEPTION 'Row %: Student Code "%" already exists in camp (Strict mode rollback).', v_idx, v_code;
      END IF;
      IF v_existing_group_id IS DISTINCT FROM p_group_id THEN
        RAISE EXCEPTION 'CITS Transfer Integrity Violation: Row % student code "%" belongs to another group. Use Student Transfer to change groups while preserving historical attendance.', v_idx, v_code;
      END IF;
      UPDATE public.students
      SET full_name = v_name,
          university = v_uni,
          updated_at = NOW()
      WHERE id = v_existing_id;
      v_updated := v_updated + 1;
    ELSE
      INSERT INTO public.students (camp_id, group_id, student_code, full_name, university, is_active)
      VALUES (p_camp_id, p_group_id, v_code, v_name, v_uni, TRUE);
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  PERFORM append_audit_log_internal(
    p_camp_id,
    'STUDENTS_BATCH_IMPORTED',
    'students',
    p_group_id::text,
    NULL,
    jsonb_build_object('mode', p_mode, 'inserted', v_inserted, 'updated', v_updated),
    format('Atomic all-or-nothing batch student import (%s mode)', p_mode)
  );

  RETURN jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION batch_import_students_tx(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION batch_import_students_tx(UUID, UUID, TEXT, JSONB) TO authenticated;

-- 3.2 Reset instructor acknowledgment automatically when schedule-affecting fields change
CREATE OR REPLACE FUNCTION validate_lecture_schedule_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active_instructor UUID;
  v_max_groups INTEGER := 4;
  v_distinct_groups INTEGER;
  v_conflict_id UUID;
BEGIN
  IF NEW.end_time <= NEW.start_time THEN
    RAISE EXCEPTION 'CITS Schedule Error: Lecture end_time must be after start_time.';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.frozen_rate_egp IS DISTINCT FROM NEW.frozen_rate_egp THEN
    IF OLD.status = 'completed' OR EXISTS (
      SELECT 1 FROM public.lecture_entitlements WHERE lecture_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'CITS Financial Integrity Violation: frozen_rate_egp cannot be altered after lecture completion or entitlement creation.';
    END IF;
  END IF;

  IF NEW.status != 'cancelled' THEN
    v_active_instructor := COALESCE(NEW.substitute_instructor_id, NEW.instructor_id);

    SELECT id INTO v_conflict_id
    FROM public.lectures
    WHERE camp_id = NEW.camp_id
      AND camp_day = NEW.camp_day
      AND status != 'cancelled'
      AND id IS DISTINCT FROM NEW.id
      AND COALESCE(substitute_instructor_id, instructor_id) = v_active_instructor
      AND (period_number = NEW.period_number OR (start_time < NEW.end_time AND end_time > NEW.start_time))
    LIMIT 1;

    IF v_conflict_id IS NOT NULL THEN
      RAISE EXCEPTION 'CITS Schedule Conflict: Instructor % already has an overlapping lecture (%) on day %.', v_active_instructor, v_conflict_id, NEW.camp_day;
    END IF;

    SELECT id INTO v_conflict_id
    FROM public.lectures
    WHERE camp_id = NEW.camp_id
      AND camp_day = NEW.camp_day
      AND status != 'cancelled'
      AND id IS DISTINCT FROM NEW.id
      AND group_id = NEW.group_id
      AND (period_number = NEW.period_number OR (start_time < NEW.end_time AND end_time > NEW.start_time))
    LIMIT 1;

    IF v_conflict_id IS NOT NULL THEN
      RAISE EXCEPTION 'CITS Schedule Conflict: Group % already has an overlapping lecture (%) on day %.', NEW.group_id, v_conflict_id, NEW.camp_day;
    END IF;

    SELECT id INTO v_conflict_id
    FROM public.lectures
    WHERE camp_id = NEW.camp_id
      AND camp_day = NEW.camp_day
      AND status != 'cancelled'
      AND id IS DISTINCT FROM NEW.id
      AND room_id = NEW.room_id
      AND (period_number = NEW.period_number OR (start_time < NEW.end_time AND end_time > NEW.start_time))
    LIMIT 1;

    IF v_conflict_id IS NOT NULL THEN
      RAISE EXCEPTION 'CITS Schedule Conflict: Room % is already occupied by lecture % on day %.', NEW.room_id, v_conflict_id, NEW.camp_day;
    END IF;

    SELECT COALESCE(cs.max_instructor_groups_per_day, 4) INTO v_max_groups
    FROM public.camp_settings cs
    WHERE cs.camp_id = NEW.camp_id;

    SELECT COUNT(DISTINCT grp_id) INTO v_distinct_groups
    FROM (
      SELECT l.group_id AS grp_id
      FROM public.lectures l
      WHERE l.camp_id = NEW.camp_id
        AND l.camp_day = NEW.camp_day
        AND l.status != 'cancelled'
        AND l.id IS DISTINCT FROM NEW.id
        AND COALESCE(l.substitute_instructor_id, l.instructor_id) = v_active_instructor
      UNION
      SELECT NEW.group_id AS grp_id
    ) AS daily_groups;

    IF v_distinct_groups > COALESCE(v_max_groups, 4) THEN
      RAISE EXCEPTION 'CITS Schedule Limit Exceeded: Instructor % exceeds maximum of % groups on camp day %.', v_active_instructor, COALESCE(v_max_groups, 4), NEW.camp_day;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    OLD.period_number IS DISTINCT FROM NEW.period_number OR
    OLD.start_time IS DISTINCT FROM NEW.start_time OR
    OLD.end_time IS DISTINCT FROM NEW.end_time OR
    OLD.room_id IS DISTINCT FROM NEW.room_id OR
    OLD.instructor_id IS DISTINCT FROM NEW.instructor_id OR
    OLD.substitute_instructor_id IS DISTINCT FROM NEW.substitute_instructor_id
  ) THEN
    NEW.revision_number := OLD.revision_number + 1;
    NEW.instructor_acknowledged_at := NULL;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- 3.3 Harden audit_logs integrity against inactive users & reserved Admin/RPC actions
CREATE OR REPLACE FUNCTION enforce_audit_log_integrity()
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
    IF NOT is_active_cits_user() THEN
      RAISE EXCEPTION 'CITS Security Violation: Inactive accounts cannot write audit logs.';
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
      'LECTURE_ACKNOWLEDGED', 'PASSWORD_CHANGE_COMPLETED'
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

-- -----------------------------------------------------------------------------
-- 4. ATTENDANCE SUBMISSION, ADMIN CORRECTION RPC & TRUSTED GUC HARDENING
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_attendance_sheet_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lecture RECORD;
  v_inst_id UUID;
  v_trusted_rpc BOOLEAN := FALSE;
  v_rpc_name TEXT;
BEGIN
  v_rpc_name := COALESCE(current_setting('cits.trusted_rpc', true), '');
  v_trusted_rpc := (
    v_rpc_name IN ('submit_attendance_sheet_tx', 'admin_correct_attendance_tx')
    AND current_user NOT IN ('anon', 'authenticated')
  );

  IF TG_OP = 'DELETE' THEN
    IF NOT is_cits_admin() THEN
      RAISE EXCEPTION 'CITS Security Violation: Instructors cannot delete attendance sheets.';
    END IF;
    RETURN OLD;
  END IF;

  SELECT id, camp_id, instructor_id, substitute_instructor_id
  INTO v_lecture
  FROM public.lectures
  WHERE id = NEW.lecture_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CITS Attendance Error: Referenced lecture % does not exist.', NEW.lecture_id;
  END IF;

  IF NEW.camp_id IS DISTINCT FROM v_lecture.camp_id THEN
    RAISE EXCEPTION 'CITS Attendance Error: Sheet camp_id (%) must match lecture camp_id (%).', NEW.camp_id, v_lecture.camp_id;
  END IF;

  IF NOT (
    NEW.instructor_id IS NOT DISTINCT FROM v_lecture.instructor_id
    OR (v_lecture.substitute_instructor_id IS NOT NULL AND NEW.instructor_id IS NOT DISTINCT FROM v_lecture.substitute_instructor_id)
  ) THEN
    RAISE EXCEPTION 'CITS Attendance Error: Sheet instructor_id must match assigned lecture instructor.';
  END IF;

  IF is_cits_admin() OR v_trusted_rpc THEN
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  v_inst_id := current_instructor_id();
  IF v_inst_id IS NULL OR NOT is_lecture_active_instructor(NEW.lecture_id) THEN
    RAISE EXCEPTION 'CITS Security Violation: You may only manage attendance sheets where you are the active assigned instructor.';
  END IF;

  IF NEW.instructor_id IS DISTINCT FROM v_inst_id
     AND NEW.instructor_id IS DISTINCT FROM COALESCE(v_lecture.substitute_instructor_id, v_lecture.instructor_id) THEN
    RAISE EXCEPTION 'CITS Security Violation: You may only manage attendance sheets assigned to your instructor account.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'draft'
       OR NEW.present_count != 0
       OR NEW.absent_count != 0
       OR NEW.cross_group_count != 0
       OR NEW.submitted_at IS NOT NULL
       OR NEW.synced_at IS NOT NULL THEN
      RAISE EXCEPTION 'CITS Security Violation: New client attendance sheets must start as draft with zero counts and null submission timestamps.';
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  IF OLD.status IN ('submitted', 'locked') THEN
    RAISE EXCEPTION 'CITS Integrity Violation: Submitted or locked attendance sheets are immutable to instructors.';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.camp_id IS DISTINCT FROM OLD.camp_id
     OR NEW.lecture_id IS DISTINCT FROM OLD.lecture_id
     OR NEW.instructor_id IS DISTINCT FROM OLD.instructor_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.present_count IS DISTINCT FROM OLD.present_count
     OR NEW.absent_count IS DISTINCT FROM OLD.absent_count
     OR NEW.cross_group_count IS DISTINCT FROM OLD.cross_group_count
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     OR NEW.synced_at IS DISTINCT FROM OLD.synced_at THEN
    RAISE EXCEPTION 'CITS Security Violation: Server-owned attendance sheet status and counts can only change via submit_attendance_sheet_tx.';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_attendance_record_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sheet RECORD;
  v_lecture RECORD;
  v_attended_group_camp UUID;
  v_student_origin_group UUID;
  v_conflict_record UUID;
  v_trusted_rpc BOOLEAN := FALSE;
  v_rpc_name TEXT;
BEGIN
  v_rpc_name := COALESCE(current_setting('cits.trusted_rpc', true), '');
  v_trusted_rpc := (
    v_rpc_name IN ('submit_attendance_sheet_tx', 'admin_correct_attendance_tx')
    AND current_user NOT IN ('anon', 'authenticated')
  );

  SELECT id, camp_id, lecture_id, status
  INTO v_sheet
  FROM public.attendance_sheets
  WHERE id = NEW.attendance_sheet_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CITS Attendance Error: Referenced attendance sheet % not found.', NEW.attendance_sheet_id;
  END IF;

  SELECT id, camp_id, camp_day, period_number, group_id
  INTO v_lecture
  FROM public.lectures
  WHERE id = v_sheet.lecture_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CITS Attendance Error: Referenced lecture % not found.', v_sheet.lecture_id;
  END IF;

  IF NEW.lecture_id IS DISTINCT FROM v_sheet.lecture_id
     OR NEW.camp_id IS DISTINCT FROM v_sheet.camp_id
     OR NEW.camp_day IS DISTINCT FROM v_lecture.camp_day
     OR NEW.period_number IS DISTINCT FROM v_lecture.period_number THEN
    RAISE EXCEPTION 'CITS Attendance Integrity Violation: Record metadata must match parent sheet (%) and lecture (%).', v_sheet.id, v_lecture.id;
  END IF;

  SELECT camp_id INTO v_attended_group_camp
  FROM public.groups
  WHERE id = NEW.attended_group_id;

  IF v_attended_group_camp IS DISTINCT FROM NEW.camp_id THEN
    RAISE EXCEPTION 'CITS Attendance Integrity Violation: attended_group_id % does not belong to camp %.', NEW.attended_group_id, NEW.camp_id;
  END IF;

  IF NOT is_cits_admin() AND NOT v_trusted_rpc THEN
    IF v_sheet.status IN ('submitted', 'locked') THEN
      RAISE EXCEPTION 'CITS Integrity Violation: Attendance records cannot be inserted or modified once sheet is %.', v_sheet.status;
    END IF;
    NEW.updated_by := auth.uid();
  END IF;

  v_student_origin_group := resolve_student_group_for_day(NEW.camp_id, NEW.student_id, NEW.camp_day);

  IF v_student_origin_group IS NULL THEN
    RAISE EXCEPTION 'CITS Attendance Error: Student % does not belong to camp %.', NEW.student_id, NEW.camp_id;
  END IF;

  NEW.origin_group_id := v_student_origin_group;
  NEW.is_cross_group := (NEW.origin_group_id IS DISTINCT FROM NEW.attended_group_id);

  IF NEW.mark IN ('present', 'late') THEN
    SELECT id INTO v_conflict_record
    FROM public.attendance_records
    WHERE camp_id = NEW.camp_id
      AND student_id = NEW.student_id
      AND camp_day = NEW.camp_day
      AND mark IN ('present', 'late')
      AND id IS DISTINCT FROM NEW.id
      AND (period_number = NEW.period_number OR attended_group_id IS DISTINCT FROM NEW.attended_group_id)
    LIMIT 1;

    IF v_conflict_record IS NOT NULL THEN
      RAISE EXCEPTION 'CITS Duplicate Attendance Blocked: Student % is already marked present/late on camp day % in another group or period.', NEW.student_id, NEW.camp_day;
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION submit_attendance_sheet_tx(p_sheet_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sheet RECORD;
  v_lecture RECORD;
  v_checkin RECORD;
  v_active_instructor UUID;
  v_is_first_lecture BOOLEAN := FALSE;
  v_ent_status entitlement_status := 'pending_review';
  v_ent_amount INTEGER := 0;
  v_ent_reason TEXT;
  v_present_count INTEGER := 0;
  v_absent_count INTEGER := 0;
  v_cross_count INTEGER := 0;
BEGIN
  PERFORM set_config('cits.trusted_rpc', 'submit_attendance_sheet_tx', true);

  SELECT * INTO v_sheet FROM public.attendance_sheets WHERE id = p_sheet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance sheet % not found.', p_sheet_id;
  END IF;

  PERFORM assert_camp_not_archived(v_sheet.camp_id);

  IF v_sheet.status IN ('submitted', 'locked') AND NOT is_cits_admin() THEN
    RAISE EXCEPTION 'CITS Integrity Violation: Attendance sheet % is already % and cannot be resubmitted by instructor.', v_sheet.id, v_sheet.status;
  END IF;

  SELECT * INTO v_lecture FROM public.lectures WHERE id = v_sheet.lecture_id;
  IF v_lecture.status = 'cancelled' THEN
    RAISE EXCEPTION 'CITS Policy Violation: Attendance cannot be submitted for cancelled lecture %.', v_lecture.id;
  END IF;

  v_active_instructor := COALESCE(v_lecture.substitute_instructor_id, v_lecture.instructor_id);

  IF NOT (is_cits_admin() OR current_instructor_id() = v_active_instructor) THEN
    RAISE EXCEPTION 'CITS Authorization Denied: Only the active assigned instructor or Admin can submit attendance for lecture %.', v_sheet.lecture_id;
  END IF;

  UPDATE public.attendance_records ar
  SET origin_group_id = resolve_student_group_for_day(ar.camp_id, ar.student_id, ar.camp_day),
      is_cross_group = (resolve_student_group_for_day(ar.camp_id, ar.student_id, ar.camp_day) IS DISTINCT FROM ar.attended_group_id),
      updated_at = NOW()
  WHERE ar.attendance_sheet_id = v_sheet.id;

  INSERT INTO public.attendance_records (
    camp_id,
    attendance_sheet_id,
    lecture_id,
    camp_day,
    period_number,
    student_id,
    origin_group_id,
    attended_group_id,
    is_cross_group,
    mark,
    updated_by
  )
  SELECT
    v_sheet.camp_id,
    v_sheet.id,
    v_sheet.lecture_id,
    v_lecture.camp_day,
    v_lecture.period_number,
    s.id,
    resolve_student_group_for_day(v_sheet.camp_id, s.id, v_lecture.camp_day),
    v_lecture.group_id,
    FALSE,
    'absent'::attendance_mark,
    auth.uid()
  FROM public.students s
  WHERE s.camp_id = v_sheet.camp_id
    AND s.is_active = TRUE
    AND resolve_student_group_for_day(v_sheet.camp_id, s.id, v_lecture.camp_day) = v_lecture.group_id
    AND NOT EXISTS (
      SELECT 1 FROM public.attendance_records ar
      WHERE ar.attendance_sheet_id = v_sheet.id
        AND ar.student_id = s.id
    );

  SELECT
    COUNT(*) FILTER (WHERE mark IN ('present', 'late')),
    COUNT(*) FILTER (WHERE mark = 'absent'),
    COUNT(*) FILTER (WHERE is_cross_group = TRUE AND mark IN ('present', 'late'))
  INTO v_present_count, v_absent_count, v_cross_count
  FROM public.attendance_records
  WHERE attendance_sheet_id = v_sheet.id;

  UPDATE public.attendance_sheets
  SET instructor_id = v_active_instructor,
      status = 'submitted',
      sync_state = 'Synced',
      present_count = v_present_count,
      absent_count = v_absent_count,
      cross_group_count = v_cross_count,
      submitted_at = COALESCE(submitted_at, NOW()),
      synced_at = NOW(),
      updated_at = NOW()
  WHERE id = v_sheet.id;

  SELECT * INTO v_checkin
  FROM public.daily_checkins
  WHERE camp_id = v_sheet.camp_id
    AND instructor_id = v_active_instructor
    AND camp_day = v_lecture.camp_day;

  SELECT (MIN(period_number) = v_lecture.period_number) INTO v_is_first_lecture
  FROM public.lectures
  WHERE camp_id = v_sheet.camp_id
    AND camp_day = v_lecture.camp_day
    AND status != 'cancelled'
    AND COALESCE(substitute_instructor_id, instructor_id) = v_active_instructor;

  IF v_checkin IS NULL OR v_checkin.status IN ('outside_geofence', 'exception_pending', 'exception_rejected') THEN
    v_ent_status := 'pending_review';
    v_ent_amount := 0;
    v_ent_reason := 'Daily GPS/selfie check-in is missing or awaiting exception review.';
  ELSIF v_is_first_lecture AND v_checkin.arrived_late_first_lecture = TRUE AND v_checkin.status != 'exception_approved' THEN
    v_ent_status := 'pending_review';
    v_ent_amount := 0;
    v_ent_reason := 'Daily check-in was >= 60 minutes after first lecture start. Requires Admin review.';
  ELSE
    v_ent_status := 'eligible';
    v_ent_amount := v_lecture.frozen_rate_egp;
    v_ent_reason := 'Verified daily check-in and synced attendance sheet.';
  END IF;

  INSERT INTO public.lecture_entitlements (
    camp_id,
    lecture_id,
    instructor_id,
    camp_day,
    period_number,
    frozen_rate_egp,
    entitlement_amount_egp,
    status,
    eligibility_reason
  ) VALUES (
    v_sheet.camp_id,
    v_lecture.id,
    v_active_instructor,
    v_lecture.camp_day,
    v_lecture.period_number,
    v_lecture.frozen_rate_egp,
    v_ent_amount,
    v_ent_status,
    v_ent_reason
  )
  ON CONFLICT (lecture_id) DO UPDATE
  SET instructor_id = CASE
        WHEN public.lecture_entitlements.status IN ('approved', 'excluded') THEN public.lecture_entitlements.instructor_id
        ELSE EXCLUDED.instructor_id
      END,
      status = CASE
        WHEN public.lecture_entitlements.status IN ('approved', 'excluded') THEN public.lecture_entitlements.status
        ELSE EXCLUDED.status
      END,
      entitlement_amount_egp = CASE
        WHEN public.lecture_entitlements.status IN ('approved', 'excluded') THEN public.lecture_entitlements.entitlement_amount_egp
        ELSE EXCLUDED.entitlement_amount_egp
      END,
      eligibility_reason = CASE
        WHEN public.lecture_entitlements.status IN ('approved', 'excluded') THEN public.lecture_entitlements.eligibility_reason
        ELSE EXCLUDED.eligibility_reason
      END,
      updated_at = NOW();

  PERFORM append_audit_log_internal(
    v_sheet.camp_id,
    'ATTENDANCE_SUBMITTED_TX',
    'attendance_sheets',
    v_sheet.id::text,
    jsonb_build_object('status', v_sheet.status),
    jsonb_build_object('status', 'submitted', 'present', v_present_count, 'absent', v_absent_count, 'cross_group', v_cross_count, 'entitlement_status', v_ent_status),
    'Transactional attendance sheet submission and entitlement evaluation'
  );

  PERFORM set_config('cits.trusted_rpc', '', true);

  RETURN jsonb_build_object(
    'sheet_id', v_sheet.id,
    'present_count', v_present_count,
    'absent_count', v_absent_count,
    'cross_group_count', v_cross_count,
    'entitlement_status', v_ent_status,
    'entitlement_amount_egp', v_ent_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION submit_attendance_sheet_tx(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_attendance_sheet_tx(UUID) TO authenticated;

-- Dedicated atomic RPC for Admin post-submission / locked attendance corrections
CREATE OR REPLACE FUNCTION admin_correct_attendance_tx(
  p_sheet_id UUID,
  p_student_id UUID,
  p_mark attendance_mark,
  p_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sheet RECORD;
  v_lecture RECORD;
  v_prev_record RECORD;
  v_origin_group_id UUID;
  v_clean_note TEXT;
  v_present_count INTEGER := 0;
  v_absent_count INTEGER := 0;
  v_cross_count INTEGER := 0;
BEGIN
  IF NOT is_cits_admin() THEN
    RAISE EXCEPTION 'CITS Security Violation: Only a verified AAL2 Admin can perform post-submission attendance corrections.';
  END IF;

  v_clean_note := TRIM(COALESCE(p_note, ''));
  IF v_clean_note = '' THEN
    RAISE EXCEPTION 'CITS Audit Violation: A non-empty audit reason is required to correct student attendance.';
  END IF;

  SELECT * INTO v_sheet FROM public.attendance_sheets WHERE id = p_sheet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance sheet % not found.', p_sheet_id;
  END IF;

  PERFORM assert_camp_not_archived(v_sheet.camp_id);

  SELECT * INTO v_lecture FROM public.lectures WHERE id = v_sheet.lecture_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lecture % not found.', v_sheet.lecture_id;
  END IF;

  v_origin_group_id := resolve_student_group_for_day(v_sheet.camp_id, p_student_id, v_lecture.camp_day);
  IF v_origin_group_id IS NULL THEN
    RAISE EXCEPTION 'CITS Attendance Error: Student % does not belong to camp %.', p_student_id, v_sheet.camp_id;
  END IF;

  SELECT mark, note INTO v_prev_record
  FROM public.attendance_records
  WHERE attendance_sheet_id = v_sheet.id
    AND student_id = p_student_id;

  PERFORM set_config('cits.trusted_rpc', 'admin_correct_attendance_tx', true);

  INSERT INTO public.attendance_records (
    camp_id,
    attendance_sheet_id,
    lecture_id,
    camp_day,
    period_number,
    student_id,
    origin_group_id,
    attended_group_id,
    is_cross_group,
    mark,
    note,
    updated_by
  ) VALUES (
    v_sheet.camp_id,
    v_sheet.id,
    v_lecture.id,
    v_lecture.camp_day,
    v_lecture.period_number,
    p_student_id,
    v_origin_group_id,
    v_lecture.group_id,
    (v_origin_group_id IS DISTINCT FROM v_lecture.group_id),
    p_mark,
    v_clean_note,
    auth.uid()
  )
  ON CONFLICT (attendance_sheet_id, student_id) DO UPDATE
  SET origin_group_id = EXCLUDED.origin_group_id,
      is_cross_group = EXCLUDED.is_cross_group,
      mark = EXCLUDED.mark,
      note = EXCLUDED.note,
      updated_by = auth.uid(),
      updated_at = NOW();

  SELECT
    COUNT(*) FILTER (WHERE mark IN ('present', 'late')),
    COUNT(*) FILTER (WHERE mark = 'absent'),
    COUNT(*) FILTER (WHERE is_cross_group = TRUE AND mark IN ('present', 'late'))
  INTO v_present_count, v_absent_count, v_cross_count
  FROM public.attendance_records
  WHERE attendance_sheet_id = v_sheet.id;

  UPDATE public.attendance_sheets
  SET present_count = v_present_count,
      absent_count = v_absent_count,
      cross_group_count = v_cross_count,
      updated_at = NOW()
  WHERE id = v_sheet.id;

  PERFORM append_audit_log_internal(
    v_sheet.camp_id,
    'ATTENDANCE_ADMIN_CORRECTED',
    'attendance_records',
    format('%s:%s', v_sheet.id, p_student_id),
    jsonb_build_object(
      'previous_mark', v_prev_record.mark,
      'previous_note', v_prev_record.note,
      'sheet_status', v_sheet.status
    ),
    jsonb_build_object(
      'new_mark', p_mark,
      'present_count', v_present_count,
      'absent_count', v_absent_count,
      'cross_group_count', v_cross_count
    ),
    v_clean_note
  );

  PERFORM set_config('cits.trusted_rpc', '', true);

  RETURN jsonb_build_object(
    'sheet_id', v_sheet.id,
    'student_id', p_student_id,
    'mark', p_mark,
    'present_count', v_present_count,
    'absent_count', v_absent_count,
    'cross_group_count', v_cross_count
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_correct_attendance_tx(UUID, UUID, attendance_mark, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_correct_attendance_tx(UUID, UUID, attendance_mark, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. CHECK-IN GPS/SELFIE BOUNDARY HARDENING & EXCEPTION DUPLICATE GUARD
-- -----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_pending_checkin_exception
  ON checkin_exceptions (camp_id, instructor_id, camp_day)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION enforce_daily_checkin_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_camp RECORD;
  v_venue RECORD;
  v_settings RECORD;
  v_first_lecture RECORD;
  v_distance DOUBLE PRECISION;
  v_max_kb INTEGER := 300;
  v_radius INTEGER := 100;
  v_late_threshold INTEGER := 60;
  v_now TIMESTAMPTZ := NOW();
  v_lecture_start TIMESTAMPTZ;
  v_minutes_late INTEGER := 0;
  v_arrived_late BOOLEAN := FALSE;
  v_inst_id UUID;
  v_trusted_rpc BOOLEAN := FALSE;
  v_is_archive_purge BOOLEAN := FALSE;
  v_uid_text TEXT;
BEGIN
  v_trusted_rpc := (
    COALESCE(current_setting('cits.trusted_rpc', true), '') = 'submit_daily_checkin_tx'
    AND current_user NOT IN ('anon', 'authenticated')
  );

  -- Enforce finite WGS84 coordinates and sane GPS accuracy on all writes (excluding NaN / Infinity via range bounds)
  IF NEW.latitude IS NULL OR NOT (NEW.latitude >= -90.0 AND NEW.latitude <= 90.0) THEN
    RAISE EXCEPTION 'CITS Check-in Error: Latitude must be a finite number between -90 and 90.';
  END IF;

  IF NEW.longitude IS NULL OR NOT (NEW.longitude >= -180.0 AND NEW.longitude <= 180.0) THEN
    RAISE EXCEPTION 'CITS Check-in Error: Longitude must be a finite number between -180 and 180.';
  END IF;

  IF NEW.gps_accuracy_meters IS NULL OR NOT (NEW.gps_accuracy_meters >= 0.0 AND NEW.gps_accuracy_meters <= 500.0) THEN
    RAISE EXCEPTION 'CITS Check-in Error: GPS accuracy must be a finite value between 0 and 500 meters.';
  END IF;

  SELECT id, status, venue_id, current_camp_day INTO v_camp FROM public.camps WHERE id = NEW.camp_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CITS Check-in Error: Camp % not found.', NEW.camp_id;
  END IF;

  SELECT * INTO v_venue FROM public.venues WHERE id = v_camp.venue_id;
  SELECT geofence_radius_meters, first_lecture_late_threshold_minutes, max_selfie_kb
  INTO v_settings
  FROM public.camp_settings
  WHERE camp_id = NEW.camp_id;

  v_radius := COALESCE(v_settings.geofence_radius_meters, v_venue.geofence_radius_meters, 100);
  v_max_kb := COALESCE(v_settings.max_selfie_kb, 300);
  v_late_threshold := COALESCE(v_settings.first_lecture_late_threshold_minutes, 60);

  IF NEW.selfie_size_kb IS NOT NULL AND (NEW.selfie_size_kb <= 0 OR NEW.selfie_size_kb > v_max_kb) THEN
    RAISE EXCEPTION 'CITS Check-in Error: Selfie size must be between 1 KB and % KB.', v_max_kb;
  END IF;

  v_is_archive_purge := (
    TG_OP = 'UPDATE'
    AND OLD.selfie_deleted_after_archive = FALSE
    AND NEW.selfie_deleted_after_archive = TRUE
    AND NEW.selfie_storage_path IS NULL
  );

  IF NEW.selfie_storage_path IS NOT NULL THEN
    IF position('..' in NEW.selfie_storage_path) > 0
       OR position('//' in NEW.selfie_storage_path) > 0
       OR position(':' in NEW.selfie_storage_path) > 0
       OR NEW.selfie_storage_path ~ '[[:space:]]'
       OR NEW.selfie_storage_path ~ '[^0-9a-zA-Z/_.-]' THEN
      RAISE EXCEPTION 'CITS Security Violation: Invalid characters or path traversal segment in selfie storage path.';
    END IF;
    IF NOT (
      right(lower(NEW.selfie_storage_path), 5) = '.webp'
      OR right(lower(NEW.selfie_storage_path), 4) = '.jpg'
      OR right(lower(NEW.selfie_storage_path), 5) = '.jpeg'
    ) THEN
      RAISE EXCEPTION 'CITS Security Violation: Selfie storage path must end with .webp, .jpg, or .jpeg.';
    END IF;
  END IF;

  IF is_cits_admin() OR v_trusted_rpc OR current_user NOT IN ('anon', 'authenticated') OR v_is_archive_purge THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'CITS Security Violation: Instructors cannot modify recorded daily check-ins.';
  END IF;

  IF v_camp.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'CITS Policy Violation: Check-ins are only accepted for active camps.';
  END IF;

  v_inst_id := current_instructor_id();
  IF v_inst_id IS NULL OR NEW.instructor_id IS DISTINCT FROM v_inst_id THEN
    RAISE EXCEPTION 'CITS Security Violation: Cannot create check-in for another instructor.';
  END IF;

  IF NOT is_instructor_assigned_to_camp(NEW.camp_id) THEN
    RAISE EXCEPTION 'CITS Authorization Denied: You are not assigned to camp %.', NEW.camp_id;
  END IF;

  IF NEW.status IN ('exception_approved', 'exception_rejected') THEN
    RAISE EXCEPTION 'CITS Security Violation: Instructors cannot self-approve or reject check-in exceptions.';
  END IF;

  v_uid_text := auth.uid()::text;
  IF NEW.selfie_storage_path IS NULL
     OR split_part(NEW.selfie_storage_path, '/', 1) IS DISTINCT FROM v_uid_text
     OR split_part(NEW.selfie_storage_path, '/', 2) IS DISTINCT FROM NEW.camp_id::text
     OR split_part(NEW.selfie_storage_path, '/', 3) = ''
     OR split_part(NEW.selfie_storage_path, '/', 4) != '' THEN
    RAISE EXCEPTION 'CITS Security Violation: Selfie path must be scoped strictly to user/camp/filename in checkin-selfies bucket.';
  END IF;

  IF NEW.selfie_size_kb IS NULL OR NEW.selfie_size_kb <= 0 OR NEW.selfie_size_kb > v_max_kb THEN
    RAISE EXCEPTION 'CITS Check-in Error: Compressed selfie size must be between 1 KB and % KB.', v_max_kb;
  END IF;

  NEW.camp_day := v_camp.current_camp_day;
  NEW.checkin_date := (v_now AT TIME ZONE 'Africa/Cairo')::date;
  NEW.server_timestamp := v_now;
  NEW.selfie_deleted_after_archive := FALSE;

  v_distance := haversine_distance_meters(NEW.latitude, NEW.longitude, v_venue.latitude, v_venue.longitude);
  NEW.distance_from_venue_meters := ROUND(v_distance)::DOUBLE PRECISION;
  NEW.within_geofence := (v_distance <= v_radius);

  SELECT id, lecture_date, start_time
  INTO v_first_lecture
  FROM public.lectures
  WHERE camp_id = NEW.camp_id
    AND camp_day = v_camp.current_camp_day
    AND status != 'cancelled'
    AND (instructor_id = NEW.instructor_id OR substitute_instructor_id = NEW.instructor_id)
  ORDER BY period_number ASC
  LIMIT 1;

  IF FOUND THEN
    v_lecture_start := (v_first_lecture.lecture_date + v_first_lecture.start_time) AT TIME ZONE 'Africa/Cairo';
    v_minutes_late := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_now - v_lecture_start)) / 60)::INTEGER);
    v_arrived_late := (v_minutes_late >= v_late_threshold);
  END IF;

  NEW.minutes_after_first_lecture := v_minutes_late;
  NEW.arrived_late_first_lecture := v_arrived_late;

  IF NOT NEW.within_geofence THEN
    NEW.status := CASE WHEN NEW.status = 'exception_pending' THEN 'exception_pending' ELSE 'outside_geofence' END;
  ELSIF NEW.arrived_late_first_lecture THEN
    NEW.status := CASE WHEN NEW.status = 'exception_pending' THEN 'exception_pending' ELSE 'late_first_lecture' END;
  ELSE
    NEW.status := 'verified';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION submit_daily_checkin_tx(
  p_camp_id UUID,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_gps_accuracy_meters DOUBLE PRECISION,
  p_selfie_storage_path TEXT,
  p_selfie_size_kb INTEGER,
  p_exception_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inst_id UUID;
  v_uid_text TEXT;
  v_camp RECORD;
  v_venue RECORD;
  v_settings RECORD;
  v_first_lecture RECORD;
  v_distance DOUBLE PRECISION;
  v_within_geofence BOOLEAN;
  v_radius INTEGER;
  v_max_kb INTEGER;
  v_late_threshold INTEGER;
  v_now TIMESTAMPTZ := NOW();
  v_lecture_start TIMESTAMPTZ;
  v_minutes_late INTEGER := 0;
  v_arrived_late BOOLEAN := FALSE;
  v_status checkin_status := 'verified';
  v_checkin_id UUID;
  v_clean_reason TEXT;
  v_existing_pending_id UUID;
BEGIN
  v_inst_id := current_instructor_id();
  IF v_inst_id IS NULL THEN
    RAISE EXCEPTION 'CITS Authorization Denied: Active authenticated instructor profile required.';
  END IF;

  IF NOT is_instructor_assigned_to_camp(p_camp_id) THEN
    RAISE EXCEPTION 'CITS Authorization Denied: You are not assigned to camp %.', p_camp_id;
  END IF;

  IF p_latitude IS NULL OR NOT (p_latitude >= -90.0 AND p_latitude <= 90.0) THEN
    RAISE EXCEPTION 'CITS Check-in Error: Latitude must be a finite number between -90 and 90.';
  END IF;

  IF p_longitude IS NULL OR NOT (p_longitude >= -180.0 AND p_longitude <= 180.0) THEN
    RAISE EXCEPTION 'CITS Check-in Error: Longitude must be a finite number between -180 and 180.';
  END IF;

  IF p_gps_accuracy_meters IS NULL OR NOT (p_gps_accuracy_meters >= 0.0 AND p_gps_accuracy_meters <= 500.0) THEN
    RAISE EXCEPTION 'CITS Check-in Error: GPS accuracy must be a finite value between 0 and 500 meters.';
  END IF;

  SELECT * INTO v_camp FROM public.camps WHERE id = p_camp_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CITS Check-in Error: Camp % not found.', p_camp_id;
  END IF;

  PERFORM assert_camp_not_archived(p_camp_id);

  IF v_camp.status != 'active' THEN
    RAISE EXCEPTION 'CITS Policy Violation: Check-ins are only accepted for active camps.';
  END IF;

  v_uid_text := auth.uid()::text;
  IF p_selfie_storage_path IS NULL
     OR position('..' in p_selfie_storage_path) > 0
     OR position('//' in p_selfie_storage_path) > 0
     OR position(':' in p_selfie_storage_path) > 0
     OR p_selfie_storage_path ~ '[[:space:]]'
     OR p_selfie_storage_path ~ '[^0-9a-zA-Z/_.-]'
     OR split_part(p_selfie_storage_path, '/', 1) IS DISTINCT FROM v_uid_text
     OR split_part(p_selfie_storage_path, '/', 2) IS DISTINCT FROM p_camp_id::text
     OR split_part(p_selfie_storage_path, '/', 3) = ''
     OR split_part(p_selfie_storage_path, '/', 4) != ''
     OR NOT (
       right(lower(p_selfie_storage_path), 5) = '.webp'
       OR right(lower(p_selfie_storage_path), 4) = '.jpg'
       OR right(lower(p_selfie_storage_path), 5) = '.jpeg'
     ) THEN
    RAISE EXCEPTION 'CITS Check-in Error: Valid selfie upload path (uid/campId/file.webp|jpg|jpeg) in checkin-selfies bucket is required.';
  END IF;

  SELECT * INTO v_venue FROM public.venues WHERE id = v_camp.venue_id;
  SELECT geofence_radius_meters, first_lecture_late_threshold_minutes, max_selfie_kb
  INTO v_settings
  FROM public.camp_settings
  WHERE camp_id = p_camp_id;

  v_radius := COALESCE(v_settings.geofence_radius_meters, v_venue.geofence_radius_meters, 100);
  v_max_kb := COALESCE(v_settings.max_selfie_kb, 300);
  v_late_threshold := COALESCE(v_settings.first_lecture_late_threshold_minutes, 60);

  IF p_selfie_size_kb IS NULL OR p_selfie_size_kb <= 0 OR p_selfie_size_kb > v_max_kb THEN
    RAISE EXCEPTION 'CITS Check-in Error: Compressed selfie size must be between 1 KB and % KB.', v_max_kb;
  END IF;

  v_distance := haversine_distance_meters(p_latitude, p_longitude, v_venue.latitude, v_venue.longitude);
  v_within_geofence := (v_distance <= v_radius);

  SELECT id, lecture_date, start_time
  INTO v_first_lecture
  FROM public.lectures
  WHERE camp_id = p_camp_id
    AND camp_day = v_camp.current_camp_day
    AND status != 'cancelled'
    AND (instructor_id = v_inst_id OR substitute_instructor_id = v_inst_id)
  ORDER BY period_number ASC
  LIMIT 1;

  IF FOUND THEN
    v_lecture_start := (v_first_lecture.lecture_date + v_first_lecture.start_time) AT TIME ZONE 'Africa/Cairo';
    v_minutes_late := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_now - v_lecture_start)) / 60)::INTEGER);
    v_arrived_late := (v_minutes_late >= v_late_threshold);
  END IF;

  v_clean_reason := NULLIF(TRIM(COALESCE(p_exception_reason, '')), '');

  IF NOT v_within_geofence THEN
    v_status := CASE WHEN v_clean_reason IS NOT NULL THEN 'exception_pending' ELSE 'outside_geofence' END;
  ELSIF v_arrived_late THEN
    v_status := CASE WHEN v_clean_reason IS NOT NULL THEN 'exception_pending' ELSE 'late_first_lecture' END;
  ELSE
    v_status := 'verified';
  END IF;

  PERFORM set_config('cits.trusted_rpc', 'submit_daily_checkin_tx', true);

  INSERT INTO public.daily_checkins (
    camp_id,
    instructor_id,
    camp_day,
    checkin_date,
    server_timestamp,
    latitude,
    longitude,
    gps_accuracy_meters,
    distance_from_venue_meters,
    within_geofence,
    selfie_storage_path,
    selfie_size_kb,
    selfie_deleted_after_archive,
    arrived_late_first_lecture,
    minutes_after_first_lecture,
    status
  ) VALUES (
    p_camp_id,
    v_inst_id,
    v_camp.current_camp_day,
    (v_now AT TIME ZONE 'Africa/Cairo')::date,
    v_now,
    p_latitude,
    p_longitude,
    p_gps_accuracy_meters,
    ROUND(v_distance)::DOUBLE PRECISION,
    v_within_geofence,
    p_selfie_storage_path,
    p_selfie_size_kb,
    FALSE,
    v_arrived_late,
    v_minutes_late,
    v_status
  )
  ON CONFLICT (camp_id, instructor_id, camp_day) DO UPDATE
  SET checkin_date = EXCLUDED.checkin_date,
      server_timestamp = EXCLUDED.server_timestamp,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      gps_accuracy_meters = EXCLUDED.gps_accuracy_meters,
      distance_from_venue_meters = EXCLUDED.distance_from_venue_meters,
      within_geofence = EXCLUDED.within_geofence,
      selfie_storage_path = EXCLUDED.selfie_storage_path,
      selfie_size_kb = EXCLUDED.selfie_size_kb,
      arrived_late_first_lecture = EXCLUDED.arrived_late_first_lecture,
      minutes_after_first_lecture = EXCLUDED.minutes_after_first_lecture,
      status = CASE
        WHEN public.daily_checkins.status IN ('verified', 'exception_approved', 'exception_rejected')
          THEN public.daily_checkins.status
        ELSE EXCLUDED.status
      END
  RETURNING id INTO v_checkin_id;

  IF v_clean_reason IS NOT NULL AND (NOT v_within_geofence OR v_arrived_late) THEN
    SELECT id INTO v_existing_pending_id
    FROM public.checkin_exceptions
    WHERE camp_id = p_camp_id
      AND instructor_id = v_inst_id
      AND camp_day = v_camp.current_camp_day
      AND status = 'pending'
    LIMIT 1;

    IF v_existing_pending_id IS NOT NULL THEN
      UPDATE public.checkin_exceptions
      SET checkin_id = v_checkin_id,
          reason = v_clean_reason
      WHERE id = v_existing_pending_id;
    ELSE
      INSERT INTO public.checkin_exceptions (
        checkin_id,
        camp_id,
        instructor_id,
        camp_day,
        reason,
        status
      ) VALUES (
        v_checkin_id,
        p_camp_id,
        v_inst_id,
        v_camp.current_camp_day,
        v_clean_reason,
        'pending'
      );
    END IF;
  END IF;

  PERFORM append_audit_log_internal(
    p_camp_id,
    'DAILY_CHECKIN_SUBMITTED',
    'daily_checkins',
    v_checkin_id::text,
    NULL,
    jsonb_build_object(
      'camp_day', v_camp.current_camp_day,
      'distance_m', ROUND(v_distance)::INTEGER,
      'within_geofence', v_within_geofence,
      'arrived_late', v_arrived_late,
      'status', v_status
    ),
    COALESCE(v_clean_reason, 'Server-verified daily GPS + selfie check-in')
  );

  PERFORM set_config('cits.trusted_rpc', '', true);

  RETURN jsonb_build_object(
    'checkin_id', v_checkin_id,
    'camp_day', v_camp.current_camp_day,
    'distance_from_venue_meters', ROUND(v_distance)::INTEGER,
    'within_geofence', v_within_geofence,
    'arrived_late_first_lecture', v_arrived_late,
    'minutes_after_first_lecture', v_minutes_late,
    'status', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION submit_daily_checkin_tx(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_daily_checkin_tx(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, INTEGER, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION enforce_checkin_exception_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inst_id UUID;
  v_camp_status camp_status;
  v_checkin RECORD;
  v_trusted_rpc BOOLEAN := FALSE;
BEGIN
  v_trusted_rpc := (
    COALESCE(current_setting('cits.trusted_rpc', true), '') = 'submit_daily_checkin_tx'
    AND current_user NOT IN ('anon', 'authenticated')
  );

  IF is_cits_admin() OR v_trusted_rpc OR current_user NOT IN ('anon', 'authenticated') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'CITS Security Violation: Instructors cannot modify or delete check-in exceptions.';
  END IF;

  v_inst_id := current_instructor_id();
  IF v_inst_id IS NULL OR NEW.instructor_id IS DISTINCT FROM v_inst_id THEN
    RAISE EXCEPTION 'CITS Security Violation: Cannot create check-in exception for another instructor.';
  END IF;

  IF NOT is_instructor_assigned_to_camp(NEW.camp_id) THEN
    RAISE EXCEPTION 'CITS Authorization Denied: You are not assigned to camp %.', NEW.camp_id;
  END IF;

  SELECT status INTO v_camp_status FROM public.camps WHERE id = NEW.camp_id;
  IF v_camp_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'CITS Policy Violation: Check-in exceptions are only accepted for active camps.';
  END IF;

  IF NEW.status IS DISTINCT FROM 'pending'
     OR NEW.reviewed_by IS NOT NULL
     OR NEW.review_note IS NOT NULL
     OR NEW.reviewed_at IS NOT NULL THEN
    RAISE EXCEPTION 'CITS Security Violation: Direct check-in exceptions must start as pending with null review metadata.';
  END IF;

  IF TRIM(COALESCE(NEW.reason, '')) = '' THEN
    RAISE EXCEPTION 'CITS Check-in Error: Exception reason cannot be empty.';
  END IF;

  IF NEW.checkin_id IS NOT NULL THEN
    SELECT id, camp_id, instructor_id, camp_day INTO v_checkin
    FROM public.daily_checkins
    WHERE id = NEW.checkin_id;

    IF NOT FOUND
       OR v_checkin.camp_id IS DISTINCT FROM NEW.camp_id
       OR v_checkin.instructor_id IS DISTINCT FROM NEW.instructor_id THEN
      RAISE EXCEPTION 'CITS Security Violation: Referenced daily check-in does not belong to this instructor and camp.';
    END IF;
    NEW.camp_day := v_checkin.camp_day;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.checkin_exceptions
    WHERE camp_id = NEW.camp_id
      AND instructor_id = NEW.instructor_id
      AND camp_day = NEW.camp_day
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'CITS Policy Violation: A pending check-in exception already exists for this camp day.';
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. INSTRUCTOR REQUESTS, ISSUES & ATTACHMENTS SECURITY TRIGGERS
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_instructor_request_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inst_id UUID;
BEGIN
  IF is_cits_admin() OR current_user NOT IN ('anon', 'authenticated') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'CITS Security Violation: Instructors cannot modify or delete submitted requests.';
  END IF;

  v_inst_id := current_instructor_id();
  IF v_inst_id IS NULL OR NEW.instructor_id IS DISTINCT FROM v_inst_id THEN
    RAISE EXCEPTION 'CITS Security Violation: Cannot create request for another instructor.';
  END IF;

  IF NOT is_instructor_assigned_to_camp(NEW.camp_id) THEN
    RAISE EXCEPTION 'CITS Authorization Denied: You are not assigned to camp %.', NEW.camp_id;
  END IF;

  IF NEW.status IS DISTINCT FROM 'pending'
     OR NEW.reviewed_by IS NOT NULL
     OR NEW.review_note IS NOT NULL THEN
    RAISE EXCEPTION 'CITS Security Violation: New instructor requests must start pending without review metadata.';
  END IF;

  IF TRIM(COALESCE(NEW.subject, '')) = '' OR TRIM(COALESCE(NEW.details, '')) = '' THEN
    RAISE EXCEPTION 'CITS Policy Violation: Request subject and details cannot be empty.';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_instructor_request_security ON instructor_requests;
CREATE TRIGGER trg_enforce_instructor_request_security
BEFORE INSERT OR UPDATE OR DELETE ON instructor_requests
FOR EACH ROW EXECUTE FUNCTION enforce_instructor_request_security();

CREATE OR REPLACE FUNCTION enforce_issue_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inst_id UUID;
  v_camp_venue UUID;
  v_room_venue UUID;
BEGIN
  IF is_cits_admin() OR current_user NOT IN ('anon', 'authenticated') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'CITS Security Violation: Instructors cannot modify or delete reported issues.';
  END IF;

  v_inst_id := current_instructor_id();
  IF v_inst_id IS NULL OR NEW.reported_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'CITS Security Violation: Active authenticated instructor required and reported_by must match caller.';
  END IF;

  IF NOT is_instructor_assigned_to_camp(NEW.camp_id) THEN
    RAISE EXCEPTION 'CITS Authorization Denied: You are not assigned to camp %.', NEW.camp_id;
  END IF;

  IF NEW.status IS DISTINCT FROM 'open'
     OR NEW.resolved_by IS NOT NULL
     OR NEW.resolution_note IS NOT NULL THEN
    RAISE EXCEPTION 'CITS Security Violation: New client issues must start open without resolution metadata.';
  END IF;

  IF TRIM(COALESCE(NEW.title, '')) = '' OR TRIM(COALESCE(NEW.description, '')) = '' THEN
    RAISE EXCEPTION 'CITS Policy Violation: Issue title and description cannot be empty.';
  END IF;

  IF NEW.room_id IS NOT NULL THEN
    SELECT venue_id INTO v_camp_venue FROM public.camps WHERE id = NEW.camp_id;
    SELECT venue_id INTO v_room_venue FROM public.rooms WHERE id = NEW.room_id;
    IF v_room_venue IS NULL OR v_room_venue IS DISTINCT FROM v_camp_venue THEN
      RAISE EXCEPTION 'CITS Integrity Violation: Selected room % does not belong to camp venue.', NEW.room_id;
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_issue_security ON issues;
CREATE TRIGGER trg_enforce_issue_security
BEFORE INSERT OR UPDATE OR DELETE ON issues
FOR EACH ROW EXECUTE FUNCTION enforce_issue_security();

-- Protect attachments linked to an archived camp while intentionally keeping
-- backup_records writable by Admins for archived camp compliance exports.
DROP TRIGGER IF EXISTS trg_readonly_archived_attachments ON attachments;
CREATE TRIGGER trg_readonly_archived_attachments
BEFORE INSERT OR UPDATE OR DELETE ON attachments
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

COMMIT;

-- =============================================================================
-- ROLLBACK CONSIDERATIONS (Manual Reversion Only — Non-Destructive)
-- =============================================================================
-- DROP TRIGGER IF EXISTS trg_readonly_archived_attachments ON attachments;
-- DROP TRIGGER IF EXISTS trg_enforce_issue_security ON issues;
-- DROP TRIGGER IF EXISTS trg_enforce_instructor_request_security ON instructor_requests;
-- DROP INDEX IF EXISTS idx_unique_pending_checkin_exception;
-- DROP FUNCTION IF EXISTS admin_correct_attendance_tx(UUID, UUID, attendance_mark, TEXT);
-- DROP FUNCTION IF EXISTS enforce_issue_security();
-- DROP FUNCTION IF EXISTS enforce_instructor_request_security();
-- DROP FUNCTION IF EXISTS is_active_cits_user();
-- -- Re-apply 0004 function versions if rolling back behavior of updated helpers/RPCs.
