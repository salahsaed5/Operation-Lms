-- Security hotfix: SQL NOT(NULL) is NULL, not TRUE.
-- An authenticated user with no instructor row must fail CLOSED.
-- Rebuild the two SECURITY DEFINER RPCs with NULL-safe authorization gates.
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

  IF (is_cits_admin() OR current_instructor_id() = v_active_instructor) IS NOT TRUE THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.save_attendance_draft_cas_tx(
  p_sheet_id uuid, p_expected jsonb, p_desired jsonb, p_submit boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE
  v_sheet record; v_lecture record; v_active_instructor uuid;
  v_current jsonb; v_expected jsonb; v_desired jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_sheet FROM public.attendance_sheets WHERE id=p_sheet_id FOR UPDATE;
  IF NOT FOUND OR v_sheet.status::text <> 'draft' THEN
    RAISE EXCEPTION 'Attendance sheet missing or no longer draft';
  END IF;
  SELECT * INTO v_lecture FROM public.lectures WHERE id=v_sheet.lecture_id;
  IF NOT FOUND OR v_lecture.camp_id <> v_sheet.camp_id THEN RAISE EXCEPTION 'Lecture mismatch'; END IF;
  v_active_instructor := COALESCE(v_lecture.substitute_instructor_id,v_lecture.instructor_id);
  IF (public.is_cits_admin() OR public.current_instructor_id()=v_active_instructor) IS NOT TRUE THEN
    RAISE EXCEPTION 'Not authorized for this lecture';
  END IF;
  PERFORM public.assert_camp_not_archived(v_sheet.camp_id);
  IF jsonb_typeof(p_expected) <> 'array' OR jsonb_typeof(p_desired) <> 'array'
    OR jsonb_array_length(p_expected)>10000 OR jsonb_array_length(p_desired)>10000 THEN
    RAISE EXCEPTION 'Invalid attendance draft payload';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'studentId',student_id::text,'mark',mark::text,
    'originGroupId',origin_group_id::text,'attendedGroupId',attended_group_id::text,
    'isCrossGroup',is_cross_group,'note',COALESCE(note,'')
  ) ORDER BY student_id::text),'[]'::jsonb)
  INTO v_current FROM public.attendance_records WHERE attendance_sheet_id=p_sheet_id;
  SELECT COALESCE(jsonb_agg(x.value ORDER BY x.value->>'studentId'),'[]'::jsonb)
  INTO v_expected FROM jsonb_array_elements(p_expected) x;
  IF v_current IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'ATTENDANCE_CONFLICT: server draft changed; refresh and review';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_desired) x
    GROUP BY x.value->>'studentId' HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'Duplicate student IDs'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_desired) x
    WHERE (x.value->>'mark') NOT IN ('present','late','absent')
      OR (x.value->>'studentId') IS NULL
      OR (x.value->>'attendedGroupId') IS NULL
  ) THEN RAISE EXCEPTION 'Invalid mark or student identity'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_desired) x
    LEFT JOIN public.students s ON s.id=(x.value->>'studentId')::uuid
    WHERE s.id IS NULL OR s.camp_id<>v_sheet.camp_id
      OR s.joined_camp_day>v_lecture.camp_day
      OR (x.value->>'attendedGroupId')::uuid<>v_lecture.group_id
      OR (x.value->>'originGroupId')::uuid IS DISTINCT FROM
         public.resolve_student_group_for_day(v_sheet.camp_id,s.id,v_lecture.camp_day)
  ) THEN RAISE EXCEPTION 'Invalid student, group or enrollment day'; END IF;
  -- Any trigger failure rolls back the entire RPC.
  DELETE FROM public.attendance_records WHERE attendance_sheet_id=p_sheet_id;
  INSERT INTO public.attendance_records(
    camp_id,attendance_sheet_id,lecture_id,camp_day,period_number,
    student_id,origin_group_id,attended_group_id,is_cross_group,mark,note,updated_by
  )
  SELECT v_sheet.camp_id,p_sheet_id,v_lecture.id,v_lecture.camp_day,v_lecture.period_number,
    (x.value->>'studentId')::uuid,
    (x.value->>'originGroupId')::uuid,(x.value->>'attendedGroupId')::uuid,
    ((x.value->>'originGroupId') IS DISTINCT FROM (x.value->>'attendedGroupId')),
    (x.value->>'mark')::public.attendance_mark,
    NULLIF(x.value->>'note',''),auth.uid()
  FROM jsonb_array_elements(p_desired) x;
  -- Draft CAS must not mutate server-owned sheet status/count/sync fields.
  -- Final submission updates these through the existing trusted RPC.
  IF p_submit THEN
    PERFORM public.submit_attendance_sheet_tx(p_sheet_id);
  END IF;
  RETURN jsonb_build_object('ok',true,'sheet_id',p_sheet_id,'submitted',p_submit);
END $$;

REVOKE ALL ON FUNCTION public.save_attendance_draft_cas_tx(uuid,jsonb,jsonb,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_attendance_draft_cas_tx(uuid,jsonb,jsonb,boolean) TO authenticated;
