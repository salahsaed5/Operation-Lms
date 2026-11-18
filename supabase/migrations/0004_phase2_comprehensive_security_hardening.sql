-- =============================================================================
-- CITS Camp Operations Management System
-- Migration: 0004_phase2_comprehensive_security_hardening.sql
-- Purpose: Close remaining Phase 2 DB security, immutability, historical student
--          transfer, check-in integrity, and transactional RPC gaps without
--          modifying prior applied migrations (0001, 0002, 0003).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. ADMIN MFA (AAL2) ENFORCEMENT & AUTH HELPER
-- -----------------------------------------------------------------------------
-- Upgrade is_cits_admin() so Admin privileges require verified MFA session
-- assurance (aal2) in addition to active Admin profile and admin_accounts row.
-- Allow authenticated Admins at aal1 to SELECT only their own admin_accounts
-- row during the pre-challenge TOTP bootstrap check.
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
      AND COALESCE(auth.jwt() ->> 'aal', '') = 'aal2'
  );
$$;

REVOKE ALL ON FUNCTION is_cits_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_cits_admin() TO authenticated;

DROP POLICY IF EXISTS "Admins view own admin_account" ON admin_accounts;
CREATE POLICY "Admins view own admin_account" ON admin_accounts
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

-- Helper: Verify whether current authenticated instructor is the active
-- instructor (substitute if assigned, otherwise primary) for a lecture.
CREATE OR REPLACE FUNCTION is_lecture_active_instructor(p_lecture_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.lectures l
    WHERE l.id = p_lecture_id
      AND COALESCE(l.substitute_instructor_id, l.instructor_id) = current_instructor_id()
  );
$$;

REVOKE ALL ON FUNCTION is_lecture_active_instructor(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_lecture_active_instructor(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 1. GEOSPATIAL HAVERSINE & HISTORICAL STUDENT TRANSFER HELPERS
-- -----------------------------------------------------------------------------

-- 1.1 Pure SQL Haversine distance (meters) pinned to public, pg_temp
CREATE OR REPLACE FUNCTION haversine_distance_meters(
  p_lat1 DOUBLE PRECISION,
  p_lon1 DOUBLE PRECISION,
  p_lat2 DOUBLE PRECISION,
  p_lon2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT 6371000.0 * 2.0 * atan2(
    sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2.0), 2) +
      cos(radians(p_lat1)) * cos(radians(p_lat2)) *
      power(sin(radians(p_lon2 - p_lon1) / 2.0), 2)
    ),
    sqrt(
      GREATEST(0.0, 1.0 - (
        power(sin(radians(p_lat2 - p_lat1) / 2.0), 2) +
        cos(radians(p_lat1)) * cos(radians(p_lat2)) *
        power(sin(radians(p_lon2 - p_lon1) / 2.0), 2)
      ))
    )
  );
$$;

REVOKE ALL ON FUNCTION haversine_distance_meters(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION haversine_distance_meters(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

-- 1.2 Resolve historical origin group for a student on a specific camp day
--     using student_transfers (effective_camp_day timeline), falling back to
--     students.group_id when no subsequent transfer supersedes prior history.
CREATE OR REPLACE FUNCTION resolve_student_group_for_day(
  p_camp_id UUID,
  p_student_id UUID,
  p_camp_day INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_group_id UUID;
BEGIN
  -- 1. Latest transfer taking effect on or before p_camp_day
  SELECT st.to_group_id INTO v_group_id
  FROM public.student_transfers st
  WHERE st.camp_id = p_camp_id
    AND st.student_id = p_student_id
    AND st.effective_camp_day <= p_camp_day
  ORDER BY st.effective_camp_day DESC, st.created_at DESC, st.id DESC
  LIMIT 1;

  IF v_group_id IS NOT NULL THEN
    RETURN v_group_id;
  END IF;

  -- 2. Earliest transfer strictly after p_camp_day preserves prior origin group
  SELECT st.from_group_id INTO v_group_id
  FROM public.student_transfers st
  WHERE st.camp_id = p_camp_id
    AND st.student_id = p_student_id
    AND st.effective_camp_day > p_camp_day
  ORDER BY st.effective_camp_day ASC, st.created_at ASC, st.id ASC
  LIMIT 1;

  IF v_group_id IS NOT NULL THEN
    RETURN v_group_id;
  END IF;

  -- 3. Default to student's current group assignment in the camp
  SELECT s.group_id INTO v_group_id
  FROM public.students s
  WHERE s.id = p_student_id
    AND s.camp_id = p_camp_id;

  RETURN v_group_id;
END;
$$;

REVOKE ALL ON FUNCTION resolve_student_group_for_day(UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_student_group_for_day(UUID, UUID, INTEGER) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. HARDEN LECTURE UPDATES (INSTRUCTOR ACK-ONLY RESTRICTION)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_lecture_update_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inst_id UUID;
BEGIN
  IF is_cits_admin() THEN
    RETURN NEW;
  END IF;

  v_inst_id := current_instructor_id();
  IF v_inst_id IS NULL OR (
    OLD.instructor_id IS DISTINCT FROM v_inst_id AND
    OLD.substitute_instructor_id IS DISTINCT FROM v_inst_id
  ) THEN
    RAISE EXCEPTION 'CITS Security Violation: Only an assigned instructor or Admin can update this lecture.';
  END IF;

  -- Block non-admin mutations to any schedule, rate, room, group, status, or identity field
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.camp_id IS DISTINCT FROM OLD.camp_id
     OR NEW.camp_day IS DISTINCT FROM OLD.camp_day
     OR NEW.lecture_date IS DISTINCT FROM OLD.lecture_date
     OR NEW.period_number IS DISTINCT FROM OLD.period_number
     OR NEW.start_time IS DISTINCT FROM OLD.start_time
     OR NEW.end_time IS DISTINCT FROM OLD.end_time
     OR NEW.duration_hours IS DISTINCT FROM OLD.duration_hours
     OR NEW.group_id IS DISTINCT FROM OLD.group_id
     OR NEW.instructor_id IS DISTINCT FROM OLD.instructor_id
     OR NEW.substitute_instructor_id IS DISTINCT FROM OLD.substitute_instructor_id
     OR NEW.room_id IS DISTINCT FROM OLD.room_id
     OR NEW.topic IS DISTINCT FROM OLD.topic
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.frozen_rate_egp IS DISTINCT FROM OLD.frozen_rate_egp
     OR NEW.revision_number IS DISTINCT FROM OLD.revision_number
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'CITS Security Violation: Instructors may only acknowledge assigned lectures and cannot modify schedule, room, rate, or status.';
  END IF;

  IF NEW.instructor_acknowledged_at IS NULL THEN
    RAISE EXCEPTION 'CITS Security Violation: Instructors cannot clear schedule acknowledgment.';
  END IF;

  NEW.instructor_acknowledged_at := COALESCE(OLD.instructor_acknowledged_at, NOW());
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_lecture_update_security ON lectures;
CREATE TRIGGER trg_enforce_lecture_update_security
BEFORE UPDATE ON lectures
FOR EACH ROW EXECUTE FUNCTION enforce_lecture_update_security();

-- -----------------------------------------------------------------------------
-- 3. HARDEN ATTENDANCE SHEETS & RECORDS (SERVER FIELDS, IMMUTABILITY, TRANSFERS)
-- -----------------------------------------------------------------------------

-- 3.1 Trigger protecting attendance_sheets server-owned fields and submitted/locked immutability
CREATE OR REPLACE FUNCTION enforce_attendance_sheet_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lecture RECORD;
  v_inst_id UUID;
  v_trusted_rpc BOOLEAN := FALSE;
BEGIN
  v_trusted_rpc := (
    current_setting('cits.trusted_rpc', true) = 'submit_attendance_sheet_tx'
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

  -- Non-admin UPDATE
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

DROP TRIGGER IF EXISTS trg_enforce_attendance_sheet_security ON attendance_sheets;
CREATE TRIGGER trg_enforce_attendance_sheet_security
BEFORE INSERT OR UPDATE OR DELETE ON attendance_sheets
FOR EACH ROW EXECUTE FUNCTION enforce_attendance_sheet_security();

-- 3.2 Tighten attendance_sheets and attendance_records RLS for active instructors (draft only)
DROP POLICY IF EXISTS "Instructors select own attendance_sheets" ON attendance_sheets;
CREATE POLICY "Instructors select own attendance_sheets" ON attendance_sheets
  FOR SELECT TO authenticated
  USING (
    current_instructor_id() IS NOT NULL
    AND is_lecture_active_instructor(lecture_id)
  );

DROP POLICY IF EXISTS "Instructors insert own attendance_sheets" ON attendance_sheets;
CREATE POLICY "Instructors insert own attendance_sheets" ON attendance_sheets
  FOR INSERT TO authenticated
  WITH CHECK (
    current_instructor_id() IS NOT NULL
    AND is_lecture_active_instructor(lecture_id)
    AND status = 'draft'
    AND present_count = 0
    AND absent_count = 0
    AND cross_group_count = 0
    AND submitted_at IS NULL
    AND synced_at IS NULL
  );

DROP POLICY IF EXISTS "Instructors update own unlocked attendance_sheets" ON attendance_sheets;
CREATE POLICY "Instructors update own unlocked attendance_sheets" ON attendance_sheets
  FOR UPDATE TO authenticated
  USING (
    current_instructor_id() IS NOT NULL
    AND is_lecture_active_instructor(lecture_id)
    AND status = 'draft'
  )
  WITH CHECK (
    current_instructor_id() IS NOT NULL
    AND is_lecture_active_instructor(lecture_id)
    AND status = 'draft'
  );

DROP POLICY IF EXISTS "Instructors select own lecture attendance_records" ON attendance_records;
CREATE POLICY "Instructors select own lecture attendance_records" ON attendance_records
  FOR SELECT TO authenticated
  USING (
    current_instructor_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.attendance_sheets s
      WHERE s.id = attendance_records.attendance_sheet_id
        AND is_lecture_active_instructor(s.lecture_id)
    )
  );

DROP POLICY IF EXISTS "Instructors insert own lecture attendance_records" ON attendance_records;
CREATE POLICY "Instructors insert own lecture attendance_records" ON attendance_records
  FOR INSERT TO authenticated
  WITH CHECK (
    current_instructor_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.attendance_sheets s
      WHERE s.id = attendance_records.attendance_sheet_id
        AND is_lecture_active_instructor(s.lecture_id)
        AND s.status = 'draft'
    )
  );

DROP POLICY IF EXISTS "Instructors update own lecture attendance_records" ON attendance_records;
CREATE POLICY "Instructors update own lecture attendance_records" ON attendance_records
  FOR UPDATE TO authenticated
  USING (
    current_instructor_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.attendance_sheets s
      WHERE s.id = attendance_records.attendance_sheet_id
        AND is_lecture_active_instructor(s.lecture_id)
        AND s.status = 'draft'
    )
  )
  WITH CHECK (
    current_instructor_id() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.attendance_sheets s
      WHERE s.id = attendance_records.attendance_sheet_id
        AND is_lecture_active_instructor(s.lecture_id)
        AND s.status = 'draft'
    )
  );

-- 3.3 Upgrade validate_attendance_record_integrity() with sheet/lecture consistency,
--     submitted/locked protection, and historical transfer origin group resolution
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
BEGIN
  v_trusted_rpc := (
    current_setting('cits.trusted_rpc', true) = 'submit_attendance_sheet_tx'
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

-- 3.4 Upgrade submit_attendance_sheet_tx() to set trusted session context and
--     resolve historical origin_group_id consistently for transferred students
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
  v_active_instructor := COALESCE(v_lecture.substitute_instructor_id, v_lecture.instructor_id);

  IF NOT (is_cits_admin() OR current_instructor_id() = v_active_instructor) THEN
    RAISE EXCEPTION 'CITS Authorization Denied: Only the active assigned instructor or Admin can submit attendance for lecture %.', v_sheet.lecture_id;
  END IF;

  -- Refresh existing record origin groups accurately for historical transfers
  UPDATE public.attendance_records ar
  SET origin_group_id = resolve_student_group_for_day(ar.camp_id, ar.student_id, ar.camp_day),
      is_cross_group = (resolve_student_group_for_day(ar.camp_id, ar.student_id, ar.camp_day) IS DISTINCT FROM ar.attended_group_id),
      updated_at = NOW()
  WHERE ar.attendance_sheet_id = v_sheet.id;

  -- Rule 10: Unmarked students scheduled in this group on v_lecture.camp_day become ABSENT
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
  SET status = CASE
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

-- -----------------------------------------------------------------------------
-- 4. DAILY CHECK-IN SERVER-SIDE VERIFICATION & ANTI-SPOOFING
-- -----------------------------------------------------------------------------

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
BEGIN
  v_trusted_rpc := (
    current_setting('cits.trusted_rpc', true) = 'submit_daily_checkin_tx'
    AND current_user NOT IN ('anon', 'authenticated')
  );

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

  IF NEW.selfie_size_kb IS NOT NULL AND NEW.selfie_size_kb > v_max_kb THEN
    RAISE EXCEPTION 'CITS Check-in Error: Selfie exceeds % KB limit.', v_max_kb;
  END IF;

  -- Skip strict server overwrite during archived selfie purge or admin review updates
  IF is_cits_admin() OR v_trusted_rpc THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'CITS Security Violation: Instructors cannot modify recorded daily check-ins.';
  END IF;

  -- Direct client check-in writes must enforce active camp, camp assignment, ownership, path prefix, distance, and lateness
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

  IF NEW.selfie_storage_path IS NULL
     OR NEW.selfie_storage_path NOT LIKE auth.uid()::text || '/' || NEW.camp_id::text || '/%' THEN
    RAISE EXCEPTION 'CITS Security Violation: Selfie path must be scoped to your own user and camp storage folder.';
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

DROP TRIGGER IF EXISTS trg_enforce_daily_checkin_security ON daily_checkins;
CREATE TRIGGER trg_enforce_daily_checkin_security
BEFORE INSERT OR UPDATE ON daily_checkins
FOR EACH ROW EXECUTE FUNCTION enforce_daily_checkin_security();

CREATE OR REPLACE FUNCTION enforce_checkin_exception_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inst_id UUID;
  v_checkin RECORD;
  v_trusted_rpc BOOLEAN := FALSE;
BEGIN
  v_trusted_rpc := (
    current_setting('cits.trusted_rpc', true) = 'submit_daily_checkin_tx'
    AND current_user NOT IN ('anon', 'authenticated')
  );

  IF is_cits_admin() OR v_trusted_rpc THEN
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_checkin_exception_security ON checkin_exceptions;
CREATE TRIGGER trg_enforce_checkin_exception_security
BEFORE INSERT OR UPDATE OR DELETE ON checkin_exceptions
FOR EACH ROW EXECUTE FUNCTION enforce_checkin_exception_security();

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
BEGIN
  v_inst_id := current_instructor_id();
  IF v_inst_id IS NULL THEN
    RAISE EXCEPTION 'CITS Authorization Denied: Authenticated instructor profile required.';
  END IF;

  IF NOT is_instructor_assigned_to_camp(p_camp_id) THEN
    RAISE EXCEPTION 'CITS Authorization Denied: You are not assigned to camp %.', p_camp_id;
  END IF;

  SELECT * INTO v_camp FROM public.camps WHERE id = p_camp_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CITS Check-in Error: Camp % not found.', p_camp_id;
  END IF;

  PERFORM assert_camp_not_archived(p_camp_id);

  IF v_camp.status != 'active' THEN
    RAISE EXCEPTION 'CITS Policy Violation: Check-ins are only accepted for active camps.';
  END IF;

  IF p_selfie_storage_path IS NULL
     OR p_selfie_storage_path NOT LIKE auth.uid()::text || '/' || p_camp_id::text || '/%' THEN
    RAISE EXCEPTION 'CITS Check-in Error: Valid selfie upload path in checkin-selfies bucket is required.';
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

  -- Evaluate instructor first non-cancelled lecture of current_camp_day
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
    GREATEST(0, COALESCE(p_gps_accuracy_meters, 0)),
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

-- -----------------------------------------------------------------------------
-- 5. NOTIFICATIONS, AUDIT LOGS & ARCHIVED CHILD TABLE TRIGGERS
-- -----------------------------------------------------------------------------

-- 5.1 Non-admins can only toggle notifications.is_read on their own notifications
CREATE OR REPLACE FUNCTION enforce_notification_update_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF is_cits_admin() THEN
    RETURN NEW;
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

DROP TRIGGER IF EXISTS trg_enforce_notification_update_security ON notifications;
CREATE TRIGGER trg_enforce_notification_update_security
BEFORE UPDATE ON notifications
FOR EACH ROW EXECUTE FUNCTION enforce_notification_update_security();

-- 5.2 Harden audit_logs integrity against non-admin spoofing of admin-reserved audit actions
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
    IF NEW.actor_profile_id IS DISTINCT FROM auth.uid() OR NEW.actor_role != 'instructor' THEN
      RAISE EXCEPTION 'CITS Security Violation: Instructors cannot forge audit actor metadata.';
    END IF;
    IF NEW.action IN (
      'CAMP_ACTIVATED', 'CAMP_ARCHIVED', 'ADMIN_ACCOUNT_BOOTSTRAPPED',
      'ADMIN_MFA_VERIFIED', 'BACKUP_JSON_EXPORTED',
      'ENTITLEMENT_APPROVED', 'ENTITLEMENT_EXCLUDED', 'STUDENT_TRANSFERRED',
      'STUDENTS_BATCH_IMPORTED', 'EXCEPTION_APPROVED', 'EXCEPTION_REJECTED'
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

-- 5.3 Attach read-only archived-camp trigger to all remaining camp-scoped operational tables
DROP TRIGGER IF EXISTS trg_readonly_archived_camp_settings ON camp_settings;
CREATE TRIGGER trg_readonly_archived_camp_settings
BEFORE INSERT OR UPDATE OR DELETE ON camp_settings
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

DROP TRIGGER IF EXISTS trg_readonly_archived_camp_instructors ON camp_instructors;
CREATE TRIGGER trg_readonly_archived_camp_instructors
BEFORE INSERT OR UPDATE OR DELETE ON camp_instructors
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

DROP TRIGGER IF EXISTS trg_readonly_archived_instructor_rates ON instructor_rates;
CREATE TRIGGER trg_readonly_archived_instructor_rates
BEFORE INSERT OR UPDATE OR DELETE ON instructor_rates
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

DROP TRIGGER IF EXISTS trg_readonly_archived_group_instructors ON group_instructors;
CREATE TRIGGER trg_readonly_archived_group_instructors
BEFORE INSERT OR UPDATE OR DELETE ON group_instructors
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

DROP TRIGGER IF EXISTS trg_readonly_archived_student_transfers ON student_transfers;
CREATE TRIGGER trg_readonly_archived_student_transfers
BEFORE INSERT OR UPDATE OR DELETE ON student_transfers
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

DROP TRIGGER IF EXISTS trg_readonly_archived_daily_checkins ON daily_checkins;
CREATE TRIGGER trg_readonly_archived_daily_checkins
BEFORE INSERT OR UPDATE OR DELETE ON daily_checkins
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

DROP TRIGGER IF EXISTS trg_readonly_archived_checkin_exceptions ON checkin_exceptions;
CREATE TRIGGER trg_readonly_archived_checkin_exceptions
BEFORE INSERT OR UPDATE OR DELETE ON checkin_exceptions
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

DROP TRIGGER IF EXISTS trg_readonly_archived_instructor_requests ON instructor_requests;
CREATE TRIGGER trg_readonly_archived_instructor_requests
BEFORE INSERT OR UPDATE OR DELETE ON instructor_requests
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

DROP TRIGGER IF EXISTS trg_readonly_archived_issues ON issues;
CREATE TRIGGER trg_readonly_archived_issues
BEFORE INSERT OR UPDATE OR DELETE ON issues
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

DROP TRIGGER IF EXISTS trg_readonly_archived_daily_checklists ON daily_checklists;
CREATE TRIGGER trg_readonly_archived_daily_checklists
BEFORE INSERT OR UPDATE OR DELETE ON daily_checklists
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

DROP TRIGGER IF EXISTS trg_readonly_archived_survey_links ON survey_links;
CREATE TRIGGER trg_readonly_archived_survey_links
BEFORE INSERT OR UPDATE OR DELETE ON survey_links
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

DROP TRIGGER IF EXISTS trg_readonly_archived_survey_results ON survey_results;
CREATE TRIGGER trg_readonly_archived_survey_results
BEFORE INSERT OR UPDATE OR DELETE ON survey_results
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

DROP TRIGGER IF EXISTS trg_readonly_archived_instructor_evaluations ON instructor_evaluations;
CREATE TRIGGER trg_readonly_archived_instructor_evaluations
BEFORE INSERT OR UPDATE OR DELETE ON instructor_evaluations
FOR EACH ROW EXECUTE FUNCTION prevent_mutation_on_archived_camp();

-- -----------------------------------------------------------------------------
-- 6. TRANSACTIONAL PHASE 2 OPERATIONAL & AUTH RPCS
-- -----------------------------------------------------------------------------

-- 6.1 Acknowledge lecture schedule cleanly
CREATE OR REPLACE FUNCTION acknowledge_lecture_tx(p_lecture_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lecture RECORD;
  v_inst_id UUID;
  v_ack_at TIMESTAMPTZ;
BEGIN
  v_inst_id := current_instructor_id();
  SELECT * INTO v_lecture FROM public.lectures WHERE id = p_lecture_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lecture % not found.', p_lecture_id;
  END IF;

  PERFORM assert_camp_not_archived(v_lecture.camp_id);

  IF NOT is_cits_admin() AND (
    v_inst_id IS NULL OR (
      v_lecture.instructor_id IS DISTINCT FROM v_inst_id AND
      v_lecture.substitute_instructor_id IS DISTINCT FROM v_inst_id
    )
  ) THEN
    RAISE EXCEPTION 'CITS Authorization Denied: Lecture % is not assigned to your account.', p_lecture_id;
  END IF;

  v_ack_at := COALESCE(v_lecture.instructor_acknowledged_at, NOW());

  UPDATE public.lectures
  SET instructor_acknowledged_at = v_ack_at,
      updated_at = NOW()
  WHERE id = p_lecture_id;

  PERFORM append_audit_log_internal(
    v_lecture.camp_id,
    'LECTURE_ACKNOWLEDGED',
    'lectures',
    v_lecture.id::text,
    jsonb_build_object('instructor_acknowledged_at', v_lecture.instructor_acknowledged_at, 'revision_number', v_lecture.revision_number),
    jsonb_build_object('instructor_acknowledged_at', v_ack_at, 'revision_number', v_lecture.revision_number),
    'Instructor acknowledged assigned lecture revision'
  );

  RETURN jsonb_build_object('lecture_id', v_lecture.id, 'instructor_acknowledged_at', v_ack_at);
END;
$$;

REVOKE ALL ON FUNCTION acknowledge_lecture_tx(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acknowledge_lecture_tx(UUID) TO authenticated;

-- 6.2 Atomic Student Group Transfer RPC (Preserves historical camp_day origin groups)
CREATE OR REPLACE FUNCTION transfer_student_tx(
  p_camp_id UUID,
  p_student_id UUID,
  p_to_group_id UUID,
  p_effective_camp_day INTEGER,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student RECORD;
  v_to_group_camp UUID;
  v_clean_reason TEXT;
  v_transfer_id UUID;
BEGIN
  IF NOT is_cits_admin() THEN
    RAISE EXCEPTION 'CITS Security Violation: Only an Admin can transfer students between groups.';
  END IF;

  PERFORM assert_camp_not_archived(p_camp_id);

  v_clean_reason := TRIM(COALESCE(p_reason, ''));
  IF v_clean_reason = '' THEN
    RAISE EXCEPTION 'CITS Policy Violation: A transfer reason is required.';
  END IF;

  IF p_effective_camp_day < 1 THEN
    RAISE EXCEPTION 'Effective camp day must be >= 1.';
  END IF;

  SELECT * INTO v_student
  FROM public.students
  WHERE id = p_student_id AND camp_id = p_camp_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student % not found in camp %.', p_student_id, p_camp_id;
  END IF;

  SELECT camp_id INTO v_to_group_camp FROM public.groups WHERE id = p_to_group_id;
  IF v_to_group_camp IS DISTINCT FROM p_camp_id THEN
    RAISE EXCEPTION 'Target group % does not belong to camp %.', p_to_group_id, p_camp_id;
  END IF;

  IF v_student.group_id = p_to_group_id THEN
    RAISE EXCEPTION 'Student is already assigned to the target group.';
  END IF;

  INSERT INTO public.student_transfers (
    camp_id,
    student_id,
    from_group_id,
    to_group_id,
    effective_camp_day,
    reason,
    transferred_by
  ) VALUES (
    p_camp_id,
    p_student_id,
    v_student.group_id,
    p_to_group_id,
    p_effective_camp_day,
    v_clean_reason,
    auth.uid()
  )
  RETURNING id INTO v_transfer_id;

  UPDATE public.students
  SET group_id = p_to_group_id,
      updated_at = NOW()
  WHERE id = p_student_id;

  PERFORM append_audit_log_internal(
    p_camp_id,
    'STUDENT_TRANSFERRED',
    'student_transfers',
    v_transfer_id::text,
    jsonb_build_object('group_id', v_student.group_id),
    jsonb_build_object('group_id', p_to_group_id, 'effective_camp_day', p_effective_camp_day),
    v_clean_reason
  );

  RETURN jsonb_build_object(
    'transfer_id', v_transfer_id,
    'student_id', p_student_id,
    'from_group_id', v_student.group_id,
    'to_group_id', p_to_group_id,
    'effective_camp_day', p_effective_camp_day
  );
END;
$$;

REVOKE ALL ON FUNCTION transfer_student_tx(UUID, UUID, UUID, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transfer_student_tx(UUID, UUID, UUID, INTEGER, TEXT) TO authenticated;

-- 6.3 Atomic All-or-Nothing Batch Student Import RPC
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

  -- Whole-batch transaction: any RAISE EXCEPTION rolls back ALL inserts/updates atomically
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

    SELECT id INTO v_existing_id
    FROM public.students
    WHERE camp_id = p_camp_id AND LOWER(student_code) = LOWER(v_code);

    IF v_existing_id IS NOT NULL THEN
      IF p_mode = 'strict_insert' THEN
        RAISE EXCEPTION 'Row %: Student Code "%" already exists in camp (Strict mode rollback).', v_idx, v_code;
      END IF;
      UPDATE public.students
      SET full_name = v_name,
          university = v_uni,
          group_id = p_group_id,
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

-- 6.4 Admin Check-in Exception Approval/Rejection RPC
CREATE OR REPLACE FUNCTION review_checkin_exception_tx(
  p_exception_id UUID,
  p_decision request_status,
  p_review_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_exc RECORD;
  v_clean_note TEXT;
  v_new_checkin_status checkin_status;
BEGIN
  IF NOT is_cits_admin() THEN
    RAISE EXCEPTION 'CITS Security Violation: Only an Admin can review check-in exceptions.';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Exception decision must be approved or rejected.';
  END IF;

  v_clean_note := TRIM(COALESCE(p_review_note, ''));
  IF v_clean_note = '' THEN
    RAISE EXCEPTION 'CITS Audit Violation: A review note is required.';
  END IF;

  SELECT * INTO v_exc FROM public.checkin_exceptions WHERE id = p_exception_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Check-in exception % not found.', p_exception_id;
  END IF;

  PERFORM assert_camp_not_archived(v_exc.camp_id);

  UPDATE public.checkin_exceptions
  SET status = p_decision,
      reviewed_by = auth.uid(),
      review_note = v_clean_note,
      reviewed_at = NOW()
  WHERE id = p_exception_id;

  v_new_checkin_status := CASE
    WHEN p_decision = 'approved' THEN 'exception_approved'::checkin_status
    ELSE 'exception_rejected'::checkin_status
  END;

  IF v_exc.checkin_id IS NOT NULL THEN
    UPDATE public.daily_checkins
    SET status = v_new_checkin_status
    WHERE id = v_exc.checkin_id;
  END IF;

  PERFORM append_audit_log_internal(
    v_exc.camp_id,
    CASE WHEN p_decision = 'approved' THEN 'EXCEPTION_APPROVED' ELSE 'EXCEPTION_REJECTED' END,
    'checkin_exceptions',
    v_exc.id::text,
    jsonb_build_object('status', v_exc.status),
    jsonb_build_object('status', p_decision, 'checkin_status', v_new_checkin_status),
    v_clean_note
  );

  RETURN jsonb_build_object(
    'exception_id', v_exc.id,
    'status', p_decision,
    'checkin_status', v_new_checkin_status
  );
END;
$$;

REVOKE ALL ON FUNCTION review_checkin_exception_tx(UUID, request_status, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION review_checkin_exception_tx(UUID, request_status, TEXT) TO authenticated;

-- 6.5 Camp Archive RPC (returns purged storage paths for post-commit bucket cleanup)
CREATE OR REPLACE FUNCTION archive_camp_tx(p_camp_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_camp RECORD;
  v_purged_paths TEXT[];
BEGIN
  IF NOT is_cits_admin() THEN
    RAISE EXCEPTION 'CITS Security Violation: Only an Admin can archive a camp.';
  END IF;

  SELECT * INTO v_camp FROM public.camps WHERE id = p_camp_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Camp % not found.', p_camp_id;
  END IF;

  IF v_camp.status = 'archived' THEN
    RAISE EXCEPTION 'Camp % is already archived.', v_camp.code;
  END IF;

  SELECT COALESCE(array_agg(selfie_storage_path) FILTER (WHERE selfie_storage_path IS NOT NULL), ARRAY[]::TEXT[])
  INTO v_purged_paths
  FROM public.daily_checkins
  WHERE camp_id = p_camp_id;

  -- Clear selfie references in DB before marking camp archived (read-only)
  UPDATE public.daily_checkins
  SET selfie_storage_path = NULL,
      selfie_deleted_after_archive = TRUE
  WHERE camp_id = p_camp_id
    AND (selfie_storage_path IS NOT NULL OR selfie_deleted_after_archive = FALSE);

  UPDATE public.camps
  SET status = 'archived',
      archived_at = NOW(),
      updated_at = NOW()
  WHERE id = p_camp_id;

  PERFORM append_audit_log_internal(
    p_camp_id,
    'CAMP_ARCHIVED',
    'camps',
    p_camp_id::text,
    jsonb_build_object('status', v_camp.status),
    jsonb_build_object('status', 'archived', 'purged_selfies_count', COALESCE(array_length(v_purged_paths, 1), 0)),
    'Camp archived as strictly read-only with active selfie paths purged'
  );

  RETURN jsonb_build_object(
    'camp_id', p_camp_id,
    'status', 'archived',
    'purged_paths', to_jsonb(v_purged_paths)
  );
END;
$$;

REVOKE ALL ON FUNCTION archive_camp_tx(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION archive_camp_tx(UUID) TO authenticated;

-- 6.6 Auth Onboarding Helpers: Complete Password Change & Record Admin TOTP MFA
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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  UPDATE public.profiles
  SET must_change_password = FALSE,
      updated_at = NOW()
  WHERE id = v_uid;

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

CREATE OR REPLACE FUNCTION record_admin_totp_verified_tx()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID;
  v_now TIMESTAMPTZ := NOW();
  v_has_verified_totp BOOLEAN := FALSE;
BEGIN
  IF NOT is_cits_admin() THEN
    RAISE EXCEPTION 'CITS Security Violation: Only verified AAL2 Admins can record TOTP MFA status.';
  END IF;

  v_uid := auth.uid();

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

REVOKE ALL ON FUNCTION record_admin_totp_verified_tx() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_admin_totp_verified_tx() TO authenticated;

COMMIT;

-- =============================================================================
-- ROLLBACK CONSIDERATIONS (Manual Reversion Only — Non-Destructive)
-- =============================================================================
-- DROP TRIGGER IF EXISTS trg_enforce_lecture_update_security ON lectures;
-- DROP TRIGGER IF EXISTS trg_enforce_attendance_sheet_security ON attendance_sheets;
-- DROP TRIGGER IF EXISTS trg_enforce_daily_checkin_security ON daily_checkins;
-- DROP TRIGGER IF EXISTS trg_enforce_checkin_exception_security ON checkin_exceptions;
-- DROP TRIGGER IF EXISTS trg_enforce_notification_update_security ON notifications;
-- DROP TRIGGER IF EXISTS trg_readonly_archived_camp_settings ON camp_settings;
-- DROP TRIGGER IF EXISTS trg_readonly_archived_camp_instructors ON camp_instructors;
-- DROP TRIGGER IF EXISTS trg_readonly_archived_instructor_rates ON instructor_rates;
-- DROP TRIGGER IF EXISTS trg_readonly_archived_group_instructors ON group_instructors;
-- DROP TRIGGER IF EXISTS trg_readonly_archived_student_transfers ON student_transfers;
-- DROP TRIGGER IF EXISTS trg_readonly_archived_daily_checkins ON daily_checkins;
-- DROP TRIGGER IF EXISTS trg_readonly_archived_checkin_exceptions ON checkin_exceptions;
-- DROP TRIGGER IF EXISTS trg_readonly_archived_instructor_requests ON instructor_requests;
-- DROP TRIGGER IF EXISTS trg_readonly_archived_issues ON issues;
-- DROP TRIGGER IF EXISTS trg_readonly_archived_daily_checklists ON daily_checklists;
-- DROP TRIGGER IF EXISTS trg_readonly_archived_survey_links ON survey_links;
-- DROP TRIGGER IF EXISTS trg_readonly_archived_survey_results ON survey_results;
-- DROP TRIGGER IF EXISTS trg_readonly_archived_instructor_evaluations ON instructor_evaluations;
-- DROP POLICY IF EXISTS "Admins view own admin_account" ON admin_accounts;
-- DROP FUNCTION IF EXISTS is_lecture_active_instructor(UUID);
-- DROP FUNCTION IF EXISTS haversine_distance_meters(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION);
-- DROP FUNCTION IF EXISTS resolve_student_group_for_day(UUID, UUID, INTEGER);
-- DROP FUNCTION IF EXISTS enforce_lecture_update_security();
-- DROP FUNCTION IF EXISTS enforce_attendance_sheet_security();
-- DROP FUNCTION IF EXISTS enforce_daily_checkin_security();
-- DROP FUNCTION IF EXISTS enforce_checkin_exception_security();
-- DROP FUNCTION IF EXISTS enforce_notification_update_security();
-- DROP FUNCTION IF EXISTS submit_daily_checkin_tx(UUID, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, INTEGER, TEXT);
-- DROP FUNCTION IF EXISTS acknowledge_lecture_tx(UUID);
-- DROP FUNCTION IF EXISTS transfer_student_tx(UUID, UUID, UUID, INTEGER, TEXT);
-- DROP FUNCTION IF EXISTS batch_import_students_tx(UUID, UUID, TEXT, JSONB);
-- DROP FUNCTION IF EXISTS review_checkin_exception_tx(UUID, request_status, TEXT);
-- DROP FUNCTION IF EXISTS archive_camp_tx(UUID);
-- DROP FUNCTION IF EXISTS complete_password_change_tx();
-- DROP FUNCTION IF EXISTS record_admin_totp_verified_tx();
