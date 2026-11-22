-- 0014: Mid-camp Instructor student enrollment (server-authorized + audited).
-- PROPOSED only. Never apply without security review and explicit Staging consent.
-- Depends on 0013 for cross-group lookup; no table-level instructor INSERT grant.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS joined_camp_day integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS enrolled_at timestamptz,
  ADD COLUMN IF NOT EXISTS enrolled_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS enrollment_origin text NOT NULL DEFAULT 'admin_import',
  ADD COLUMN IF NOT EXISTS enrollment_reason text;

-- Preserve historical created-at as the enrollment time for existing students,
-- rather than inaccurately labeling all older entries with migration time.
UPDATE public.students
SET enrolled_at = created_at
WHERE enrolled_at IS NULL;

ALTER TABLE public.students
  ALTER COLUMN enrolled_at SET DEFAULT now(),
  ALTER COLUMN enrolled_at SET NOT NULL;

DO $c$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'students_joined_day_check'
      AND conrelid = 'public.students'::regclass
  ) THEN
    ALTER TABLE public.students
      ADD CONSTRAINT students_joined_day_check CHECK (joined_camp_day BETWEEN 1 AND 365);
  END IF;
END;
$c$;

CREATE OR REPLACE FUNCTION public.instructor_enroll_midcamp_student_tx(
  p_group_id uuid,
  p_student_code text,
  p_full_name text,
  p_university text,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
  v_instructor_id uuid;
  v_camp_id uuid;
  v_capacity integer;
  v_status text;
  v_start_date date;
  v_end_date date;
  v_duration integer;
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  v_join_day integer;
  v_code text := upper(btrim(COALESCE(p_student_code,'')));
  v_name text := btrim(COALESCE(p_full_name,''));
  v_university text := nullif(btrim(COALESCE(p_university,'')), '');
  v_reason text := btrim(COALESCE(p_reason,''));
  v_student_id uuid;
BEGIN
  v_instructor_id := public.current_instructor_id();
  IF v_instructor_id IS NULL THEN
    RAISE EXCEPTION 'Only a verified active Instructor can enroll a student.';
  END IF;

  SELECT g.camp_id, g.capacity, c.status::text, c.start_date, c.end_date, c.duration_days
    INTO v_camp_id, v_capacity, v_status, v_start_date, v_end_date, v_duration
  FROM public.groups g
  JOIN public.camps c ON c.id = g.camp_id
  WHERE g.id = p_group_id
  FOR UPDATE OF g;

  IF NOT FOUND OR NOT public.is_instructor_assigned_to_group(p_group_id) THEN
    RAISE EXCEPTION 'Enrollment denied: group is not assigned to this Instructor.';
  END IF;
  IF v_status <> 'active' OR v_today < v_start_date OR v_today > v_end_date THEN
    RAISE EXCEPTION 'Mid-camp student enrollment is only available during an active Camp.';
  END IF;

  v_join_day := (v_today - v_start_date) + 1;
  IF v_join_day < 1 OR v_join_day > v_duration THEN
    RAISE EXCEPTION 'Enrollment day is outside scheduled Camp duration.';
  END IF;
  IF v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' THEN
    RAISE EXCEPTION 'Student code must have 3-32 letters/numbers/dashes/underscores.';
  END IF;
  IF length(v_name) < 3 OR length(v_name) > 150 THEN
    RAISE EXCEPTION 'Student full name must have 3-150 characters.';
  END IF;
  IF length(COALESCE(v_university,'')) > 150 THEN
    RAISE EXCEPTION 'University name is too long.';
  END IF;
  IF length(v_reason) < 5 OR length(v_reason) > 400 THEN
    RAISE EXCEPTION 'A short, meaningful reason (5-400 characters) is required.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.camp_id = v_camp_id AND upper(s.student_code) = v_code
  ) THEN
    RAISE EXCEPTION 'Student code already exists in this Camp. Search for the student as a visitor instead.';
  END IF;
  IF (SELECT count(*) FROM public.students
      WHERE camp_id = v_camp_id AND group_id = p_group_id AND is_active) >= v_capacity THEN
    RAISE EXCEPTION 'Group capacity is full; ask an Admin before enrolling.';
  END IF;

  INSERT INTO public.students (
    camp_id, group_id, student_code, full_name, university, is_active,
    joined_camp_day, enrolled_at, enrolled_by_profile_id,
    enrollment_origin, enrollment_reason
  ) VALUES (
    v_camp_id, p_group_id, v_code, v_name, v_university, TRUE,
    v_join_day, now(), auth.uid(), 'instructor_late_join', v_reason
  ) RETURNING id INTO v_student_id;

  PERFORM public.append_audit_log_internal(
    v_camp_id, 'STUDENT_ENROLLED_MIDCAMP', 'students', v_student_id::text,
    NULL,
    jsonb_build_object(
      'student_code', v_code, 'group_id', p_group_id,
      'instructor_id', v_instructor_id,
      'joined_camp_day', v_join_day, 'enrolled_at', now(),
      'enrollment_origin', 'instructor_late_join'
    ),
    v_reason
  );
  RETURN v_student_id;
END;
$body$;

REVOKE ALL ON FUNCTION public.instructor_enroll_midcamp_student_tx(uuid,text,text,text,text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.instructor_enroll_midcamp_student_tx(uuid,text,text,text,text)
TO authenticated;

-- Existing Student RLS remains admin-only INSERT. Instructor writes are
-- possible ONLY through validated and audited RPC above.

CREATE OR REPLACE FUNCTION public.reject_attendance_before_student_join_day()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $body$
DECLARE v_join_day integer;
BEGIN
  SELECT joined_camp_day INTO v_join_day
  FROM public.students
  WHERE id = NEW.student_id AND camp_id = NEW.camp_id;

  IF v_join_day IS NULL OR NEW.camp_day < v_join_day THEN
    RAISE EXCEPTION 'Attendance cannot be recorded before a student joined the Camp.';
  END IF;
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS trg_attendance_after_enrollment_day ON public.attendance_records;
CREATE TRIGGER trg_attendance_after_enrollment_day
BEFORE INSERT OR UPDATE OF student_id, camp_day, camp_id
ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public.reject_attendance_before_student_join_day();

-- The Camp attendance RPC previously created Absent rows for every student
-- in the group, including students who had not enrolled until a later day.
-- Preserve its entire current Staging definition, adding ONLY a join-day
-- bound to the roster auto-backfill and a historical explicit-record guard.

CREATE OR REPLACE FUNCTION public.submit_attendance_sheet_tx(p_sheet_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  IF EXISTS (
    SELECT 1 FROM public.attendance_records ar
    JOIN public.students stu ON stu.id = ar.student_id
    WHERE ar.attendance_sheet_id = v_sheet.id
      AND ar.camp_day < stu.joined_camp_day
  ) THEN
    RAISE EXCEPTION 'Attendance record predates a student enrollment day.';
  END IF;

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
    -- Mid-camp entrants are not eligible for absences before joining.
    AND s.joined_camp_day <= v_lecture.camp_day
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
$function$

