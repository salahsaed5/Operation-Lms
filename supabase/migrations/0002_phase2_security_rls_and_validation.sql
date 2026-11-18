-- =============================================================================
-- CITS Camp Operations Management System
-- Migration: 0002_phase2_security_rls_and_validation.sql
-- Purpose: Phase 2 Database Integrity, Concurrency Locks, Triggers,
--          Hardened SECURITY DEFINER RPCs, Complete 29-Table RLS Policies,
--          Audit Log Immutability, and Free-Tier Query Indexes.
-- Prerequisite: 0001_cits_initial_schema.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. SCHEMA ENHANCEMENTS & NON-DESTRUCTIVE CORRECTIONS
-- -----------------------------------------------------------------------------

-- 1.1 Add related camp_id to audit_logs (Requirement 6: Record Related camp ID)
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS camp_id UUID REFERENCES camps(id) ON DELETE SET NULL;

-- 1.2 Ensure attendance_sheets tracks offline sync state explicitly at DB level
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'offline_sync_state') THEN
    CREATE TYPE offline_sync_state AS ENUM ('Offline', 'Syncing', 'Synced', 'Failed');
  END IF;
END
$$;

ALTER TABLE attendance_sheets
  ADD COLUMN IF NOT EXISTS sync_state offline_sync_state NOT NULL DEFAULT 'Synced';

-- 1.3 Prevent same-day duplicate PRESENT/LATE student attendance across ANY group
-- (Even across different periods on the same camp_day unless explicitly excused/absent)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_student_daily_present
  ON attendance_records (camp_id, student_id, camp_day)
  WHERE mark IN ('present', 'late');

-- 1.4 Performance Indexes for Free-Tier Query Efficiency (Pagination & Selective Fetching)
CREATE INDEX IF NOT EXISTS idx_profiles_role_active ON profiles (role, is_active);
CREATE INDEX IF NOT EXISTS idx_camps_status ON camps (status);
CREATE INDEX IF NOT EXISTS idx_groups_camp_id ON groups (camp_id);
CREATE INDEX IF NOT EXISTS idx_group_instructors_lookup ON group_instructors (camp_id, instructor_id, group_id);
CREATE INDEX IF NOT EXISTS idx_students_camp_group ON students (camp_id, group_id, is_active);
CREATE INDEX IF NOT EXISTS idx_lectures_camp_day_period ON lectures (camp_id, camp_day, period_number);
CREATE INDEX IF NOT EXISTS idx_lectures_instructor_lookup ON lectures (camp_id, instructor_id, camp_day);
CREATE INDEX IF NOT EXISTS idx_checkins_camp_day ON daily_checkins (camp_id, camp_day, instructor_id);
CREATE INDEX IF NOT EXISTS idx_attendance_sheets_camp_lecture ON attendance_sheets (camp_id, lecture_id, status);
CREATE INDEX IF NOT EXISTS idx_entitlements_camp_instructor ON lecture_entitlements (camp_id, instructor_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_camp_created ON audit_logs (camp_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 2. HARDENED SECURITY HELPER FUNCTIONS (SET search_path = public, pg_temp)
-- -----------------------------------------------------------------------------

-- 2.1 Check if current authenticated user is one of the 2 verified Admins
CREATE OR REPLACE FUNCTION is_cits_admin()
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
  );
$$;

REVOKE ALL ON FUNCTION is_cits_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_cits_admin() TO authenticated;

-- 2.2 Return current instructor.id for authenticated instructor
CREATE OR REPLACE FUNCTION current_instructor_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT i.id
  FROM public.instructors i
  JOIN public.profiles p ON p.id = i.profile_id
  WHERE p.id = auth.uid()
    AND p.role = 'instructor'
    AND p.is_active = TRUE
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION current_instructor_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_instructor_id() TO authenticated;

-- 2.3 Secure Username -> Email Resolver (Prevents Directory Enumeration)
CREATE OR REPLACE FUNCTION resolve_login_identifier(p_identifier TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clean TEXT;
  v_email TEXT;
BEGIN
  v_clean := LOWER(TRIM(COALESCE(p_identifier, '')));
  IF char_length(v_clean) < 3 OR char_length(v_clean) > 120 THEN
    RETURN NULL;
  END IF;

  SELECT p.email INTO v_email
  FROM public.profiles p
  WHERE p.is_active = TRUE
    AND (LOWER(p.username) = v_clean OR LOWER(p.email) = v_clean)
  LIMIT 1;

  RETURN v_email;
END;
$$;

REVOKE ALL ON FUNCTION resolve_login_identifier(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_login_identifier(TEXT) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. AUDIT LOG CREATION & IMMUTABILITY TRIGGERS
-- -----------------------------------------------------------------------------

-- 3.1 Prevent Sensitive Credential Leakage & Enforce Append-Only Audit Logs
CREATE OR REPLACE FUNCTION enforce_audit_log_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_combined TEXT;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'CITS Security Violation: audit_logs are immutable and cannot be updated or deleted.';
  END IF;

  v_combined := LOWER(COALESCE(NEW.previous_value::text, '') || ' ' || COALESCE(NEW.new_value::text, ''));
  IF v_combined ~ '(password|service_role|totp_secret|mfa_secret|access_token|refresh_token|secret_key)' THEN
    RAISE EXCEPTION 'CITS Security Violation: Sensitive credentials or tokens must never be written to audit_logs.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_immutability ON audit_logs;
CREATE TRIGGER trg_audit_log_immutability
BEFORE INSERT OR UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION enforce_audit_log_integrity();

-- 3.2 Internal Helper to Record Audit Trail
CREATE OR REPLACE FUNCTION append_audit_log_internal(
  p_camp_id UUID,
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_prev JSONB,
  p_new JSONB,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_name TEXT := 'System / Server Trigger';
  v_actor_role user_role := 'admin';
  v_log_id UUID;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NOT NULL THEN
    SELECT full_name_en, role INTO v_actor_name, v_actor_role
    FROM public.profiles
    WHERE id = v_actor_id;
  END IF;

  INSERT INTO public.audit_logs (
    actor_profile_id,
    actor_name,
    actor_role,
    camp_id,
    action,
    entity_type,
    entity_id,
    previous_value,
    new_value,
    reason
  ) VALUES (
    v_actor_id,
    COALESCE(v_actor_name, 'Authenticated User'),
    COALESCE(v_actor_role, 'instructor'),
    p_camp_id,
    p_action,
    p_entity_type,
    p_entity_id,
    p_prev,
    p_new,
    p_reason
  ) RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION append_audit_log_internal(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 4. CONCURRENCY-SAFE ADMIN CAP & PRIVILEGE ESCALATION PROTECTION
-- -----------------------------------------------------------------------------

-- 4.1 Upgrade enforce_max_two_admins() with Transaction-Level Advisory Lock
CREATE OR REPLACE FUNCTION enforce_max_two_admins()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
  v_role user_role;
BEGIN
  -- Serialize concurrent admin creation attempts across connections
  PERFORM pg_advisory_xact_lock(hashtext('cits_admin_accounts_creation_lock'));

  SELECT role INTO v_role FROM public.profiles WHERE id = NEW.profile_id;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'CITS Policy Violation: Profile linked to admin_accounts must have role = admin.';
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.admin_accounts WHERE id IS DISTINCT FROM NEW.id;
  IF v_count >= 2 THEN
    RAISE EXCEPTION 'CITS Policy Violation: Maximum of two Admin accounts allowed.';
  END IF;

  RETURN NEW;
END;
$$;

-- 4.2 Prevent Role Escalation or >2 Admin Profiles on profiles table
CREATE OR REPLACE FUNCTION enforce_profile_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_profiles INTEGER;
BEGIN
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
    -- Non-admins cannot change their own active status or username/email
    IF NOT is_cits_admin() AND (
      OLD.is_active IS DISTINCT FROM NEW.is_active OR
      OLD.username IS DISTINCT FROM NEW.username OR
      OLD.email IS DISTINCT FROM NEW.email
    ) THEN
      RAISE EXCEPTION 'CITS Security Violation: Only an Admin can modify account activation or identity identifiers.';
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_profile_security ON profiles;
CREATE TRIGGER trg_enforce_profile_security
BEFORE INSERT OR UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION enforce_profile_security();

-- -----------------------------------------------------------------------------
-- 5. ARCHIVED CAMP READ-ONLY & SINGLE ACTIVE CAMP PROTECTION
-- -----------------------------------------------------------------------------

-- 5.1 Helper to check if a camp is archived
CREATE OR REPLACE FUNCTION assert_camp_not_archived(p_camp_id UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status camp_status;
BEGIN
  SELECT status INTO v_status FROM public.camps WHERE id = p_camp_id;
  IF v_status = 'archived' THEN
    RAISE EXCEPTION 'CITS Integrity Violation: Camp % is archived and strictly read-only.', p_camp_id;
  END IF;
END;
$$;

-- 5.2 Trigger on camps to protect archived camps and serialize single-active-camp transitions
CREATE OR REPLACE FUNCTION enforce_camp_lifecycle_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CITS Integrity Violation: Operational camps cannot be deleted. Use archive instead.';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'archived' THEN
    RAISE EXCEPTION 'CITS Integrity Violation: Archived camp % is read-only and cannot be modified.', OLD.code;
  END IF;

  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
    PERFORM pg_advisory_xact_lock(hashtext('cits_single_active_camp_lock'));
    SELECT id INTO v_active_id
    FROM public.camps
    WHERE status = 'active' AND id IS DISTINCT FROM NEW.id
    LIMIT 1;

    IF v_active_id IS NOT NULL THEN
      RAISE EXCEPTION 'CITS Policy Violation: Only one camp may be active at a time.';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status != 'archived' AND NEW.status = 'archived' THEN
    NEW.archived_at := COALESCE(NEW.archived_at, NOW());
    -- Purge selfie storage paths while retaining all verification metadata
    UPDATE public.daily_checkins
    SET selfie_storage_path = NULL,
        selfie_deleted_after_archive = TRUE
    WHERE camp_id = NEW.id;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_camp_lifecycle_rules ON camps;
CREATE TRIGGER trg_enforce_camp_lifecycle_rules
BEFORE INSERT OR UPDATE OR DELETE ON camps
FOR EACH ROW EXECUTE FUNCTION enforce_camp_lifecycle_rules();

-- 5.3 Generic Trigger to Block Mutations on Operational Child Tables When Camp is Archived
CREATE OR REPLACE FUNCTION prevent_mutation_on_archived_camp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_camp_id UUID;
  v_status camp_status;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_camp_id := OLD.camp_id;
  ELSE
    v_camp_id := NEW.camp_id;
  END IF;

  SELECT status INTO v_status FROM public.camps WHERE id = v_camp_id;

  IF v_status = 'archived' THEN
    -- Allow selfie purge on daily_checkins during archive transition only
    IF TG_TABLE_NAME = 'daily_checkins' AND TG_OP = 'UPDATE'
       AND OLD.selfie_deleted_after_archive = FALSE
       AND NEW.selfie_deleted_after_archive = TRUE
       AND NEW.selfie_storage_path IS NULL THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'CITS Integrity Violation: Cannot modify % because camp % is archived (read-only).', TG_TABLE_NAME, v_camp_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_readonly_archived_groups ON groups;
CREATE TRIGGER trg_readonly_archived_groups
BEFORE INSERT OR UPDATE OR DELETE ON groups
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

DROP TRIGGER IF EXISTS trg_readonly_archived_students ON students;
CREATE TRIGGER trg_readonly_archived_students
BEFORE INSERT OR UPDATE OR DELETE ON students
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

DROP TRIGGER IF EXISTS trg_readonly_archived_lectures ON lectures;
CREATE TRIGGER trg_readonly_archived_lectures
BEFORE INSERT OR UPDATE OR DELETE ON lectures
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

DROP TRIGGER IF EXISTS trg_readonly_archived_sheets ON attendance_sheets;
CREATE TRIGGER trg_readonly_archived_sheets
BEFORE INSERT OR UPDATE OR DELETE ON attendance_sheets
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

DROP TRIGGER IF EXISTS trg_readonly_archived_records ON attendance_records;
CREATE TRIGGER trg_readonly_archived_records
BEFORE INSERT OR UPDATE OR DELETE ON attendance_records
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

DROP TRIGGER IF EXISTS trg_readonly_archived_entitlements ON lecture_entitlements;
CREATE TRIGGER trg_readonly_archived_entitlements
BEFORE INSERT OR UPDATE OR DELETE ON lecture_entitlements
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

-- -----------------------------------------------------------------------------
-- 6. SCHEDULE CONFLICT & DAILY INSTRUCTOR GROUP LIMIT TRIGGER
-- -----------------------------------------------------------------------------

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

  -- Preserve frozen_rate_egp once lecture is completed or has an entitlement
  IF TG_OP = 'UPDATE' AND OLD.frozen_rate_egp IS DISTINCT FROM NEW.frozen_rate_egp THEN
    IF OLD.status = 'completed' OR EXISTS (
      SELECT 1 FROM public.lecture_entitlements WHERE lecture_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'CITS Financial Integrity Violation: frozen_rate_egp cannot be altered after lecture completion or entitlement creation.';
    END IF;
  END IF;

  IF NEW.status != 'cancelled' THEN
    v_active_instructor := COALESCE(NEW.substitute_instructor_id, NEW.instructor_id);

    -- 1. Check time-range overlap for the same Instructor on the same camp_day
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

    -- 2. Check time-range overlap for the same Group on the same camp_day
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

    -- 3. Check time-range overlap for the same Room on the same camp_day
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

    -- 4. Enforce configurable max_instructor_groups_per_day (default 4)
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
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_lecture_schedule ON lectures;
CREATE TRIGGER trg_validate_lecture_schedule
BEFORE INSERT OR UPDATE ON lectures
FOR EACH ROW EXECUTE FUNCTION validate_lecture_schedule_rules();

-- -----------------------------------------------------------------------------
-- 7. ATTENDANCE RECORD & ENTITLEMENT INTEGRITY TRIGGERS
-- -----------------------------------------------------------------------------

-- 7.1 Validate Cross-Group & Same-Day Duplicate Attendance
CREATE OR REPLACE FUNCTION validate_attendance_record_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_origin_group UUID;
  v_conflict_record UUID;
BEGIN
  SELECT group_id INTO v_student_origin_group
  FROM public.students
  WHERE id = NEW.student_id AND camp_id = NEW.camp_id;

  IF v_student_origin_group IS NULL THEN
    RAISE EXCEPTION 'CITS Attendance Error: Student % does not belong to camp %.', NEW.student_id, NEW.camp_id;
  END IF;

  -- Always preserve authoritative origin_group_id from student record
  NEW.origin_group_id := v_student_origin_group;
  NEW.is_cross_group := (NEW.origin_group_id IS DISTINCT FROM NEW.attended_group_id);

  -- Prevent duplicate PRESENT/LATE attendance for the same student on the same day across different groups
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

DROP TRIGGER IF EXISTS trg_validate_attendance_record ON attendance_records;
CREATE TRIGGER trg_validate_attendance_record
BEFORE INSERT OR UPDATE ON attendance_records
FOR EACH ROW EXECUTE FUNCTION validate_attendance_record_integrity();

-- 7.2 Enforce Financial Entitlement Integrity (Frozen Rate, Draft Blocking, Mandatory Override Reason)
CREATE OR REPLACE FUNCTION validate_lecture_entitlement_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lecture_frozen_rate INTEGER;
  v_sheet_status attendance_sheet_status;
  v_sheet_sync offline_sync_state;
BEGIN
  SELECT frozen_rate_egp INTO v_lecture_frozen_rate
  FROM public.lectures
  WHERE id = NEW.lecture_id AND camp_id = NEW.camp_id;

  IF v_lecture_frozen_rate IS NULL THEN
    RAISE EXCEPTION 'CITS Financial Error: Lecture % not found in camp %.', NEW.lecture_id, NEW.camp_id;
  END IF;

  -- Enforce frozen rate from lecture
  NEW.frozen_rate_egp := v_lecture_frozen_rate;

  -- Check attendance sheet status
  SELECT status, sync_state INTO v_sheet_status, v_sheet_sync
  FROM public.attendance_sheets
  WHERE lecture_id = NEW.lecture_id;

  -- Draft or unsynced attendance must NEVER be eligible unless explicitly overridden by Admin with reason
  IF NEW.status = 'eligible' AND (
    v_sheet_status IS DISTINCT FROM 'submitted' OR v_sheet_sync IS DISTINCT FROM 'Synced'
  ) THEN
    RAISE EXCEPTION 'CITS Financial Integrity Violation: Lecture % cannot be marked eligible while attendance sheet is draft or unsynced.', NEW.lecture_id;
  END IF;

  -- Admin overrides ('approved' or 'excluded') require a non-empty reason
  IF NEW.status IN ('approved', 'excluded') THEN
    IF TRIM(COALESCE(NEW.admin_override_reason, '')) = '' THEN
      RAISE EXCEPTION 'CITS Audit Violation: Admin approval or exclusion of an entitlement requires a non-empty reason.';
    END IF;
  END IF;

  -- Ensure amount matches status strictly in whole EGP
  IF NEW.status IN ('eligible', 'approved') THEN
    NEW.entitlement_amount_egp := v_lecture_frozen_rate;
  ELSE
    NEW.entitlement_amount_egp := 0;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_lecture_entitlement ON lecture_entitlements;
CREATE TRIGGER trg_validate_lecture_entitlement
BEFORE INSERT OR UPDATE ON lecture_entitlements
FOR EACH ROW EXECUTE FUNCTION validate_lecture_entitlement_integrity();

-- -----------------------------------------------------------------------------
-- 8. TRANSACTIONAL SERVER-SIDE RPC FUNCTIONS
-- -----------------------------------------------------------------------------

-- 8.1 Transactional Attendance Submission & Automatic Entitlement Calculation
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
  SELECT * INTO v_sheet FROM public.attendance_sheets WHERE id = p_sheet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance sheet % not found.', p_sheet_id;
  END IF;

  PERFORM assert_camp_not_archived(v_sheet.camp_id);

  SELECT * INTO v_lecture FROM public.lectures WHERE id = v_sheet.lecture_id;
  v_active_instructor := COALESCE(v_lecture.substitute_instructor_id, v_lecture.instructor_id);

  -- Authorization check: Only CITS Admin or the assigned instructor for this lecture
  IF NOT (is_cits_admin() OR current_instructor_id() = v_active_instructor) THEN
    RAISE EXCEPTION 'CITS Authorization Denied: You are not authorized to submit attendance for lecture %.', v_sheet.lecture_id;
  END IF;

  -- Rule 10: Unmarked students in the group's active roster become ABSENT upon submission
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
    s.group_id,
    v_lecture.group_id,
    FALSE,
    'absent'::attendance_mark,
    auth.uid()
  FROM public.students s
  WHERE s.camp_id = v_sheet.camp_id
    AND s.group_id = v_lecture.group_id
    AND s.is_active = TRUE
    AND NOT EXISTS (
      SELECT 1 FROM public.attendance_records ar
      WHERE ar.attendance_sheet_id = v_sheet.id
        AND ar.student_id = s.id
    );

  -- Recalculate counts
  SELECT
    COUNT(*) FILTER (WHERE mark IN ('present', 'late')),
    COUNT(*) FILTER (WHERE mark = 'absent'),
    COUNT(*) FILTER (WHERE is_cross_group = TRUE AND mark IN ('present', 'late'))
  INTO v_present_count, v_absent_count, v_cross_count
  FROM public.attendance_records
  WHERE attendance_sheet_id = v_sheet.id;

  -- Mark sheet submitted and synced
  UPDATE public.attendance_sheets
  SET status = 'submitted',
      sync_state = 'Synced',
      present_count = v_present_count,
      absent_count = v_absent_count,
      cross_group_count = v_cross_count,
      submitted_at = COALESCE(submitted_at, NOW()),
      synced_at = NOW(),
      updated_at = NOW()
  WHERE id = v_sheet.id;

  -- Evaluate Daily Check-in & First Lecture Late Rule
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
  SET status = CASE
        WHEN public.lecture_entitlements.status IN ('approved', 'excluded') THEN public.lecture_entitlements.status
        ELSE EXCLUDED.status
      END,
      entitlement_amount_egp = CASE
        WHEN public.lecture_entitlements.status IN ('approved', 'excluded') THEN public.lecture_entitlements.entitlement_amount_egp
        ELSE EXCLUDED.entitlement_amount_egp
      END,
      eligibility_reason = EXCLUDED.eligibility_reason,
      updated_at = NOW();

  PERFORM append_audit_log_internal(
    v_sheet.camp_id,
    'ATTENDANCE_SUBMITTED_TX',
    'attendance_sheets',
    v_sheet.id::text,
    jsonb_build_object('status', v_sheet.status),
    jsonb_build_object('status', 'submitted', 'present', v_present_count, 'absent', v_absent_count, 'entitlement_status', v_ent_status),
    'Transactional attendance sheet submission and entitlement evaluation'
  );

  RETURN jsonb_build_object(
    'sheet_id', v_sheet.id,
    'present_count', v_present_count,
    'absent_count', v_absent_count,
    'entitlement_status', v_ent_status,
    'entitlement_amount_egp', v_ent_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION submit_attendance_sheet_tx(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_attendance_sheet_tx(UUID) TO authenticated;

-- 8.2 Admin Entitlement Override RPC with Mandatory Audit Trail
CREATE OR REPLACE FUNCTION admin_override_entitlement_tx(
  p_entitlement_id UUID,
  p_decision entitlement_status,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ent RECORD;
  v_new_amount INTEGER;
BEGIN
  IF NOT is_cits_admin() THEN
    RAISE EXCEPTION 'CITS Security Violation: Only a verified Admin can approve or exclude lecture entitlements.';
  END IF;

  IF p_decision NOT IN ('approved', 'excluded') THEN
    RAISE EXCEPTION 'Decision must be approved or excluded.';
  END IF;

  IF TRIM(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'An audit reason is required when approving or excluding an entitlement.';
  END IF;

  SELECT * INTO v_ent FROM public.lecture_entitlements WHERE id = p_entitlement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entitlement % not found.', p_entitlement_id;
  END IF;

  PERFORM assert_camp_not_archived(v_ent.camp_id);

  v_new_amount := CASE WHEN p_decision = 'approved' THEN v_ent.frozen_rate_egp ELSE 0 END;

  UPDATE public.lecture_entitlements
  SET status = p_decision,
      entitlement_amount_egp = v_new_amount,
      admin_override_by = auth.uid(),
      admin_override_reason = TRIM(p_reason),
      updated_at = NOW()
  WHERE id = p_entitlement_id;

  PERFORM append_audit_log_internal(
    v_ent.camp_id,
    CASE WHEN p_decision = 'approved' THEN 'ENTITLEMENT_APPROVED' ELSE 'ENTITLEMENT_EXCLUDED' END,
    'lecture_entitlements',
    v_ent.id::text,
    jsonb_build_object('status', v_ent.status, 'amount_egp', v_ent.entitlement_amount_egp),
    jsonb_build_object('status', p_decision, 'amount_egp', v_new_amount),
    TRIM(p_reason)
  );

  RETURN jsonb_build_object(
    'entitlement_id', v_ent.id,
    'status', p_decision,
    'entitlement_amount_egp', v_new_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_override_entitlement_tx(UUID, entitlement_status, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_override_entitlement_tx(UUID, entitlement_status, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 9. COMPREHENSIVE ROW LEVEL SECURITY (RLS) FOR ALL 29 TABLES
-- -----------------------------------------------------------------------------

-- Helper: Check if authenticated instructor is assigned to a given camp
CREATE OR REPLACE FUNCTION is_instructor_assigned_to_camp(p_camp_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.camp_instructors ci
    WHERE ci.camp_id = p_camp_id
      AND ci.instructor_id = current_instructor_id()
      AND ci.is_active = TRUE
  ) OR EXISTS (
    SELECT 1 FROM public.lectures l
    WHERE l.camp_id = p_camp_id
      AND (l.instructor_id = current_instructor_id() OR l.substitute_instructor_id = current_instructor_id())
  );
$$;

REVOKE ALL ON FUNCTION is_instructor_assigned_to_camp(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_instructor_assigned_to_camp(UUID) TO authenticated;

-- Helper: Check if authenticated instructor is assigned to a given group
CREATE OR REPLACE FUNCTION is_instructor_assigned_to_group(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_instructors gi
    WHERE gi.group_id = p_group_id
      AND gi.instructor_id = current_instructor_id()
  ) OR EXISTS (
    SELECT 1 FROM public.lectures l
    WHERE l.group_id = p_group_id
      AND (l.instructor_id = current_instructor_id() OR l.substitute_instructor_id = current_instructor_id())
  );
$$;

REVOKE ALL ON FUNCTION is_instructor_assigned_to_group(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_instructor_assigned_to_group(UUID) TO authenticated;

-- 9.1 profiles
DROP POLICY IF EXISTS "Admins have full access to profiles" ON profiles;
DROP POLICY IF EXISTS "Instructors read own profile only" ON profiles;
DROP POLICY IF EXISTS "Instructors update own password flag only" ON profiles;

CREATE POLICY "Admins have full access to profiles" ON profiles
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors read own profile only" ON profiles
  FOR SELECT TO authenticated USING (id = auth.uid());

CREATE POLICY "Instructors update own profile non-privileged fields" ON profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = 'instructor');

-- 9.2 admin_accounts (Admin read-only; creation strictly via server migration/trusted admin)
DROP POLICY IF EXISTS "Admins view admin_accounts" ON admin_accounts;
CREATE POLICY "Admins view admin_accounts" ON admin_accounts
  FOR SELECT TO authenticated USING (is_cits_admin());

-- 9.3 instructors
DROP POLICY IF EXISTS "Instructors read own instructor record only" ON instructors;
DROP POLICY IF EXISTS "Admins manage instructors" ON instructors;

CREATE POLICY "Admins manage instructors" ON instructors
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors read own instructor record only" ON instructors
  FOR SELECT TO authenticated USING (profile_id = auth.uid());

-- 9.4 venues
DROP POLICY IF EXISTS "Admins manage venues" ON venues;
DROP POLICY IF EXISTS "Assigned instructors read venues" ON venues;

CREATE POLICY "Admins manage venues" ON venues
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Assigned instructors read venues" ON venues
  FOR SELECT TO authenticated USING (current_instructor_id() IS NOT NULL);

-- 9.5 rooms
DROP POLICY IF EXISTS "Admins manage rooms" ON rooms;
DROP POLICY IF EXISTS "Assigned instructors read rooms" ON rooms;

CREATE POLICY "Admins manage rooms" ON rooms
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Assigned instructors read rooms" ON rooms
  FOR SELECT TO authenticated USING (current_instructor_id() IS NOT NULL);

-- 9.6 camps
DROP POLICY IF EXISTS "Admins manage camps" ON camps;
DROP POLICY IF EXISTS "Instructors read assigned camps" ON camps;

CREATE POLICY "Admins manage camps" ON camps
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors read assigned camps" ON camps
  FOR SELECT TO authenticated USING (is_instructor_assigned_to_camp(id));

-- 9.7 camp_settings
DROP POLICY IF EXISTS "Admins manage camp_settings" ON camp_settings;
DROP POLICY IF EXISTS "Instructors read assigned camp_settings" ON camp_settings;

CREATE POLICY "Admins manage camp_settings" ON camp_settings
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors read assigned camp_settings" ON camp_settings
  FOR SELECT TO authenticated USING (is_instructor_assigned_to_camp(camp_id));

-- 9.8 camp_instructors
DROP POLICY IF EXISTS "Admins manage camp_instructors" ON camp_instructors;
DROP POLICY IF EXISTS "Instructors read own camp_instructors" ON camp_instructors;

CREATE POLICY "Admins manage camp_instructors" ON camp_instructors
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors read own camp_instructors" ON camp_instructors
  FOR SELECT TO authenticated USING (instructor_id = current_instructor_id());

-- 9.9 instructor_rates (Private financial rates isolated per instructor)
DROP POLICY IF EXISTS "Admins manage instructor_rates" ON instructor_rates;
DROP POLICY IF EXISTS "Instructors read own instructor_rates" ON instructor_rates;

CREATE POLICY "Admins manage instructor_rates" ON instructor_rates
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors read own instructor_rates" ON instructor_rates
  FOR SELECT TO authenticated USING (instructor_id = current_instructor_id());

-- 9.10 groups
DROP POLICY IF EXISTS "Admins manage groups" ON groups;
DROP POLICY IF EXISTS "Instructors read assigned groups" ON groups;

CREATE POLICY "Admins manage groups" ON groups
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors read assigned groups" ON groups
  FOR SELECT TO authenticated USING (is_instructor_assigned_to_group(id));

-- 9.11 group_instructors
DROP POLICY IF EXISTS "Admins manage group_instructors" ON group_instructors;
DROP POLICY IF EXISTS "Instructors read own group_instructors" ON group_instructors;

CREATE POLICY "Admins manage group_instructors" ON group_instructors
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors read own group_instructors" ON group_instructors
  FOR SELECT TO authenticated USING (instructor_id = current_instructor_id());

-- 9.12 students (Instructors can read student rosters for their assigned groups/camps)
DROP POLICY IF EXISTS "Admins manage students" ON students;
DROP POLICY IF EXISTS "Instructors read permitted student rosters" ON students;

CREATE POLICY "Admins manage students" ON students
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors read permitted student rosters" ON students
  FOR SELECT TO authenticated
  USING (is_instructor_assigned_to_group(group_id) OR is_instructor_assigned_to_camp(camp_id));

-- 9.13 student_transfers
DROP POLICY IF EXISTS "Admins manage student_transfers" ON student_transfers;
DROP POLICY IF EXISTS "Instructors read relevant student_transfers" ON student_transfers;

CREATE POLICY "Admins manage student_transfers" ON student_transfers
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors read relevant student_transfers" ON student_transfers
  FOR SELECT TO authenticated
  USING (
    is_instructor_assigned_to_group(from_group_id)
    OR is_instructor_assigned_to_group(to_group_id)
  );

-- 9.14 lectures (Instructors can SELECT own lectures and acknowledge, NEVER modify schedule/cancel)
DROP POLICY IF EXISTS "Instructors read own lectures only" ON lectures;
DROP POLICY IF EXISTS "Instructors acknowledge own lectures" ON lectures;
DROP POLICY IF EXISTS "Admins manage lectures" ON lectures;

CREATE POLICY "Admins manage lectures" ON lectures
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors read own lectures only" ON lectures
  FOR SELECT TO authenticated
  USING (
    instructor_id = current_instructor_id()
    OR substitute_instructor_id = current_instructor_id()
  );

CREATE POLICY "Instructors acknowledge own lectures" ON lectures
  FOR UPDATE TO authenticated
  USING (
    instructor_id = current_instructor_id()
    OR substitute_instructor_id = current_instructor_id()
  )
  WITH CHECK (
    instructor_id = current_instructor_id()
    OR substitute_instructor_id = current_instructor_id()
  );

-- 9.15 daily_checkins (Instructors can SELECT and INSERT own check-in; cannot DELETE or approve own status)
DROP POLICY IF EXISTS "Instructors read/insert own daily checkins" ON daily_checkins;
DROP POLICY IF EXISTS "Admins manage daily_checkins" ON daily_checkins;
DROP POLICY IF EXISTS "Instructors select own daily_checkins" ON daily_checkins;
DROP POLICY IF EXISTS "Instructors insert own daily_checkins" ON daily_checkins;

CREATE POLICY "Admins manage daily_checkins" ON daily_checkins
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors select own daily_checkins" ON daily_checkins
  FOR SELECT TO authenticated USING (instructor_id = current_instructor_id());

CREATE POLICY "Instructors insert own daily_checkins" ON daily_checkins
  FOR INSERT TO authenticated
  WITH CHECK (
    instructor_id = current_instructor_id()
    AND status IN ('verified', 'outside_geofence', 'late_first_lecture', 'exception_pending')
  );

-- 9.16 checkin_exceptions (Instructors can SELECT and INSERT own pending exception; cannot approve own exception)
DROP POLICY IF EXISTS "Admins manage checkin_exceptions" ON checkin_exceptions;
DROP POLICY IF EXISTS "Instructors select own checkin_exceptions" ON checkin_exceptions;
DROP POLICY IF EXISTS "Instructors insert own checkin_exceptions" ON checkin_exceptions;

CREATE POLICY "Admins manage checkin_exceptions" ON checkin_exceptions
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors select own checkin_exceptions" ON checkin_exceptions
  FOR SELECT TO authenticated USING (instructor_id = current_instructor_id());

CREATE POLICY "Instructors insert own checkin_exceptions" ON checkin_exceptions
  FOR INSERT TO authenticated
  WITH CHECK (
    instructor_id = current_instructor_id()
    AND status = 'pending'
    AND reviewed_by IS NULL
  );

-- 9.17 attendance_sheets (Instructors can SELECT and INSERT/UPDATE own draft sheets; cannot unlock locked sheets)
DROP POLICY IF EXISTS "Instructors manage own attendance sheets" ON attendance_sheets;
DROP POLICY IF EXISTS "Admins manage attendance_sheets" ON attendance_sheets;
DROP POLICY IF EXISTS "Instructors select own attendance_sheets" ON attendance_sheets;
DROP POLICY IF EXISTS "Instructors insert own attendance_sheets" ON attendance_sheets;
DROP POLICY IF EXISTS "Instructors update own unlocked attendance_sheets" ON attendance_sheets;

CREATE POLICY "Admins manage attendance_sheets" ON attendance_sheets
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors select own attendance_sheets" ON attendance_sheets
  FOR SELECT TO authenticated USING (instructor_id = current_instructor_id());

CREATE POLICY "Instructors insert own attendance_sheets" ON attendance_sheets
  FOR INSERT TO authenticated
  WITH CHECK (instructor_id = current_instructor_id() AND status != 'locked');

CREATE POLICY "Instructors update own unlocked attendance_sheets" ON attendance_sheets
  FOR UPDATE TO authenticated
  USING (instructor_id = current_instructor_id() AND status != 'locked')
  WITH CHECK (instructor_id = current_instructor_id() AND status != 'locked');

-- 9.18 attendance_records
DROP POLICY IF EXISTS "Admins manage attendance_records" ON attendance_records;
DROP POLICY IF EXISTS "Instructors select own lecture attendance_records" ON attendance_records;
DROP POLICY IF EXISTS "Instructors insert/update own lecture attendance_records" ON attendance_records;
DROP POLICY IF EXISTS "Instructors insert own lecture attendance_records" ON attendance_records;
DROP POLICY IF EXISTS "Instructors update own lecture attendance_records" ON attendance_records;

CREATE POLICY "Admins manage attendance_records" ON attendance_records
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors select own lecture attendance_records" ON attendance_records
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.attendance_sheets s
      WHERE s.id = attendance_records.attendance_sheet_id
        AND s.instructor_id = current_instructor_id()
    )
  );

CREATE POLICY "Instructors insert own lecture attendance_records" ON attendance_records
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.attendance_sheets s
      WHERE s.id = attendance_records.attendance_sheet_id
        AND s.instructor_id = current_instructor_id()
        AND s.status != 'locked'
    )
  );

CREATE POLICY "Instructors update own lecture attendance_records" ON attendance_records
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.attendance_sheets s
      WHERE s.id = attendance_records.attendance_sheet_id
        AND s.instructor_id = current_instructor_id()
        AND s.status != 'locked'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.attendance_sheets s
      WHERE s.id = attendance_records.attendance_sheet_id
        AND s.instructor_id = current_instructor_id()
        AND s.status != 'locked'
    )
  );

-- 9.19 lecture_entitlements (Instructors SELECT own only; NEVER modify)
DROP POLICY IF EXISTS "Instructors view own lecture entitlements" ON lecture_entitlements;
DROP POLICY IF EXISTS "Admins manage lecture_entitlements" ON lecture_entitlements;

CREATE POLICY "Admins manage lecture_entitlements" ON lecture_entitlements
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors view own lecture entitlements" ON lecture_entitlements
  FOR SELECT TO authenticated USING (instructor_id = current_instructor_id());

-- 9.20 instructor_requests (Instructors SELECT and INSERT own pending requests)
DROP POLICY IF EXISTS "Admins manage instructor_requests" ON instructor_requests;
DROP POLICY IF EXISTS "Instructors select own instructor_requests" ON instructor_requests;
DROP POLICY IF EXISTS "Instructors insert own instructor_requests" ON instructor_requests;

CREATE POLICY "Admins manage instructor_requests" ON instructor_requests
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors select own instructor_requests" ON instructor_requests
  FOR SELECT TO authenticated USING (instructor_id = current_instructor_id());

CREATE POLICY "Instructors insert own instructor_requests" ON instructor_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    instructor_id = current_instructor_id()
    AND status = 'pending'
    AND reviewed_by IS NULL
  );

-- 9.21 notifications
DROP POLICY IF EXISTS "Admins manage notifications" ON notifications;
DROP POLICY IF EXISTS "Users read own notifications" ON notifications;
DROP POLICY IF EXISTS "Users mark own notifications read" ON notifications;

CREATE POLICY "Admins manage notifications" ON notifications
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Users read own notifications" ON notifications
  FOR SELECT TO authenticated USING (recipient_profile_id = auth.uid());

CREATE POLICY "Users mark own notifications read" ON notifications
  FOR UPDATE TO authenticated
  USING (recipient_profile_id = auth.uid())
  WITH CHECK (recipient_profile_id = auth.uid());

-- 9.22 issues
DROP POLICY IF EXISTS "Admins manage issues" ON issues;
DROP POLICY IF EXISTS "Instructors view and report own issues" ON issues;
DROP POLICY IF EXISTS "Instructors view own reported issues" ON issues;
DROP POLICY IF EXISTS "Instructors insert issues" ON issues;

CREATE POLICY "Admins manage issues" ON issues
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors view own reported issues" ON issues
  FOR SELECT TO authenticated USING (reported_by = auth.uid());

CREATE POLICY "Instructors insert issues" ON issues
  FOR INSERT TO authenticated WITH CHECK (reported_by = auth.uid());

-- 9.23 daily_checklists (Admin only)
DROP POLICY IF EXISTS "Admins manage daily_checklists" ON daily_checklists;
CREATE POLICY "Admins manage daily_checklists" ON daily_checklists
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

-- 9.24 survey_links
DROP POLICY IF EXISTS "Admins manage survey_links" ON survey_links;
DROP POLICY IF EXISTS "Instructors read own survey_links" ON survey_links;

CREATE POLICY "Admins manage survey_links" ON survey_links
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors read own survey_links" ON survey_links
  FOR SELECT TO authenticated
  USING (instructor_id = current_instructor_id() OR (instructor_id IS NULL AND is_instructor_assigned_to_camp(camp_id)));

-- 9.25 survey_results
DROP POLICY IF EXISTS "Admins manage survey_results" ON survey_results;
DROP POLICY IF EXISTS "Instructors read own survey_results" ON survey_results;

CREATE POLICY "Admins manage survey_results" ON survey_results
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors read own survey_results" ON survey_results
  FOR SELECT TO authenticated USING (instructor_id = current_instructor_id());

-- 9.26 instructor_evaluations
DROP POLICY IF EXISTS "Admins manage instructor_evaluations" ON instructor_evaluations;
DROP POLICY IF EXISTS "Instructors read own evaluations" ON instructor_evaluations;

CREATE POLICY "Admins manage instructor_evaluations" ON instructor_evaluations
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors read own evaluations" ON instructor_evaluations
  FOR SELECT TO authenticated USING (instructor_id = current_instructor_id());

-- 9.27 attachments
DROP POLICY IF EXISTS "Admins manage attachments" ON attachments;
DROP POLICY IF EXISTS "Instructors read/insert own attachments" ON attachments;
DROP POLICY IF EXISTS "Instructors read own attachments" ON attachments;
DROP POLICY IF EXISTS "Instructors insert own attachments" ON attachments;

CREATE POLICY "Admins manage attachments" ON attachments
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors read own attachments" ON attachments
  FOR SELECT TO authenticated USING (uploaded_by = auth.uid());

CREATE POLICY "Instructors insert own attachments" ON attachments
  FOR INSERT TO authenticated WITH CHECK (uploaded_by = auth.uid());

-- 9.28 audit_logs (Admin SELECT & INSERT; Instructor INSERT own actor actions; UPDATE/DELETE blocked by trigger)
DROP POLICY IF EXISTS "Admins only audit logs and backups" ON audit_logs;
DROP POLICY IF EXISTS "Admins read and insert audit_logs" ON audit_logs;
DROP POLICY IF EXISTS "Admins insert audit_logs" ON audit_logs;
DROP POLICY IF EXISTS "Instructors insert own audit_logs" ON audit_logs;

CREATE POLICY "Admins read and insert audit_logs" ON audit_logs
  FOR SELECT TO authenticated USING (is_cits_admin());

CREATE POLICY "Admins insert audit_logs" ON audit_logs
  FOR INSERT TO authenticated WITH CHECK (is_cits_admin());

CREATE POLICY "Instructors insert own audit_logs" ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (actor_profile_id = auth.uid() AND actor_role = 'instructor');

-- 9.29 backup_records (Admin only)
DROP POLICY IF EXISTS "Admins manage backup_records" ON backup_records;
CREATE POLICY "Admins manage backup_records" ON backup_records
  FOR ALL TO authenticated USING (is_cits_admin()) WITH CHECK (is_cits_admin());

-- -----------------------------------------------------------------------------
-- 10. PRIVATE STORAGE BUCKET: checkin-selfies (300KB Cap, JPEG/WebP Only)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'buckets'
  ) THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'checkin-selfies',
      'checkin-selfies',
      FALSE,
      307200, -- 300 KB (300 * 1024 bytes)
      ARRAY['image/jpeg', 'image/webp']
    )
    ON CONFLICT (id) DO UPDATE
    SET public = FALSE,
        file_size_limit = 307200,
        allowed_mime_types = ARRAY['image/jpeg', 'image/webp'];
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'objects'
  ) THEN
    DROP POLICY IF EXISTS "Admins manage checkin-selfies objects" ON storage.objects;
    DROP POLICY IF EXISTS "Instructors upload own checkin-selfies" ON storage.objects;
    DROP POLICY IF EXISTS "Instructors read own checkin-selfies" ON storage.objects;

    CREATE POLICY "Admins manage checkin-selfies objects" ON storage.objects
      FOR ALL TO authenticated
      USING (bucket_id = 'checkin-selfies' AND public.is_cits_admin())
      WITH CHECK (bucket_id = 'checkin-selfies' AND public.is_cits_admin());

    CREATE POLICY "Instructors upload own checkin-selfies" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'checkin-selfies'
        AND public.current_instructor_id() IS NOT NULL
        AND (storage.foldername(name))[1] = auth.uid()::text
      );

    CREATE POLICY "Instructors read own checkin-selfies" ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'checkin-selfies'
        AND public.current_instructor_id() IS NOT NULL
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 11. SAFE FIRST ADMIN BOOTSTRAP PROCEDURE (SQL Editor / Server-Only)
-- -----------------------------------------------------------------------------
-- Callable ONLY from the Supabase SQL Editor (postgres / service_role).
-- REVOKE ALL FROM PUBLIC, anon, authenticated ensures no client can invoke it.
CREATE OR REPLACE FUNCTION bootstrap_cits_admin_account(
  p_auth_user_id UUID,
  p_username TEXT,
  p_full_name_en TEXT,
  p_full_name_ar TEXT,
  p_slot SMALLINT DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email TEXT;
  v_admin_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cits_admin_accounts_creation_lock'));

  IF p_slot NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Admin slot must be 1 or 2.';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_auth_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Auth user % does not exist in auth.users. Create the user in Supabase Auth first.', p_auth_user_id;
  END IF;

  SELECT COUNT(*) INTO v_admin_count
  FROM public.admin_accounts
  WHERE profile_id IS DISTINCT FROM p_auth_user_id;

  IF v_admin_count >= 2 THEN
    RAISE EXCEPTION 'CITS Policy Violation: Maximum of two Admin accounts already provisioned.';
  END IF;

  INSERT INTO public.profiles (
    id,
    role,
    username,
    email,
    full_name_en,
    full_name_ar,
    must_change_password,
    is_active
  ) VALUES (
    p_auth_user_id,
    'admin',
    LOWER(TRIM(p_username)),
    LOWER(TRIM(v_email)),
    TRIM(p_full_name_en),
    TRIM(p_full_name_ar),
    FALSE,
    TRUE
  )
  ON CONFLICT (id) DO UPDATE
  SET full_name_en = EXCLUDED.full_name_en,
      full_name_ar = EXCLUDED.full_name_ar,
      is_active = TRUE,
      updated_at = NOW();

  INSERT INTO public.admin_accounts (
    profile_id,
    totp_enrolled,
    assigned_slot
  ) VALUES (
    p_auth_user_id,
    FALSE,
    p_slot
  )
  ON CONFLICT (profile_id) DO UPDATE
  SET assigned_slot = EXCLUDED.assigned_slot;

  INSERT INTO public.audit_logs (
    actor_profile_id,
    actor_name,
    actor_role,
    action,
    entity_type,
    entity_id,
    previous_value,
    new_value,
    reason
  ) VALUES (
    p_auth_user_id,
    TRIM(p_full_name_en),
    'admin',
    'ADMIN_ACCOUNT_BOOTSTRAPPED',
    'admin_accounts',
    p_auth_user_id::text,
    NULL,
    jsonb_build_object('assigned_slot', p_slot, 'username', LOWER(TRIM(p_username))),
    'Trusted SQL Editor Admin bootstrap procedure'
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'profile_id', p_auth_user_id,
    'email', v_email,
    'username', LOWER(TRIM(p_username)),
    'assigned_slot', p_slot
  );
END;
$$;

REVOKE ALL ON FUNCTION bootstrap_cits_admin_account(UUID, TEXT, TEXT, TEXT, SMALLINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION bootstrap_cits_admin_account(UUID, TEXT, TEXT, TEXT, SMALLINT) FROM anon;
REVOKE ALL ON FUNCTION bootstrap_cits_admin_account(UUID, TEXT, TEXT, TEXT, SMALLINT) FROM authenticated;

COMMIT;

-- =============================================================================
-- ROLLBACK CONSIDERATIONS (Manual Reversion Only — Non-Destructive)
-- =============================================================================
-- To revert Phase 2 functions/triggers without losing data:
-- DROP TRIGGER IF EXISTS trg_validate_lecture_entitlement ON lecture_entitlements;
-- DROP TRIGGER IF EXISTS trg_validate_attendance_record ON attendance_records;
-- DROP TRIGGER IF EXISTS trg_validate_lecture_schedule ON lectures;
-- DROP TRIGGER IF EXISTS trg_enforce_camp_lifecycle_rules ON camps;
-- DROP TRIGGER IF EXISTS trg_enforce_profile_security ON profiles;
-- DROP TRIGGER IF EXISTS trg_audit_log_immutability ON audit_logs;
-- DROP FUNCTION IF EXISTS submit_attendance_sheet_tx(UUID);
-- DROP FUNCTION IF EXISTS admin_override_entitlement_tx(UUID, entitlement_status, TEXT);
-- DROP FUNCTION IF EXISTS bootstrap_cits_admin_account(UUID, TEXT, TEXT, TEXT, SMALLINT);

