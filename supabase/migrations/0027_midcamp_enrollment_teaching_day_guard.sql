-- 0027: mid-camp join-day is the operational teaching day, not elapsed calendar days.
-- Existing instructor authorization/audit logic preserved; never alter Production without approval.
BEGIN;
CREATE OR REPLACE FUNCTION public.instructor_enroll_midcamp_student_tx(p_group_id uuid, p_student_code text, p_full_name text, p_university text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_instructor_id uuid;
  v_camp_id uuid;
  v_capacity integer;
  v_status text;
  v_start_date date;
  v_end_date date;
  v_duration integer;
  v_current_day integer;
  v_operating_weekdays integer[];
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

  SELECT g.camp_id, g.capacity, c.status::text, c.start_date, c.end_date, c.duration_days,
         c.current_camp_day, c.operating_weekdays
    INTO v_camp_id, v_capacity, v_status, v_start_date, v_end_date, v_duration,
         v_current_day, v_operating_weekdays
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

  -- Teaching-day ordinal is not elapsed calendar days for 3-day/week Camps.
  -- Enroll only when the Admin-selected current day matches today's
  -- real scheduled teaching date (Cairo); rejects off-days and stale day state.
  v_join_day := v_current_day;
  IF v_join_day NOT BETWEEN 1 AND v_duration OR
     v_today IS DISTINCT FROM public.camp_teaching_date(
       v_start_date,v_join_day,v_operating_weekdays) THEN
    RAISE EXCEPTION 'Mid-camp enrollment requires the current scheduled teaching date';
  END IF;
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
$function$

COMMIT;
