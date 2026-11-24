-- Additive lifecycle: existing finalized sheets and entitlements remain untouched.
CREATE TABLE public.lecture_session_runs (
 lecture_id uuid NOT NULL REFERENCES public.lectures(id) ON DELETE RESTRICT,
 revision_number integer NOT NULL,
 instructor_id uuid NOT NULL REFERENCES public.instructors(id) ON DELETE RESTRICT,
 camp_id uuid NOT NULL REFERENCES public.camps(id) ON DELETE RESTRICT,
 group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE RESTRICT,
 room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE RESTRICT,
 lecture_date date NOT NULL,start_time time NOT NULL,end_time time NOT NULL,
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(lecture_id,revision_number,instructor_id)
);
ALTER TABLE public.lecture_session_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lecture_session_runs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.lecture_session_runs TO authenticated;
CREATE POLICY lecture_session_runs_read ON public.lecture_session_runs FOR SELECT TO authenticated
 USING(public.is_cits_admin() OR instructor_id=public.current_instructor_id());

CREATE FUNCTION public.run_lecture_session_tx(p_lecture_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l public.lectures%ROWTYPE; s public.attendance_sheets%ROWTYPE; inst uuid; r public.lecture_session_runs%ROWTYPE; stamp timestamptz;
BEGIN
 inst:=public.current_instructor_id();
 IF auth.uid() IS NULL OR inst IS NULL THEN RAISE EXCEPTION 'Active instructor required'; END IF;
 SELECT * INTO s FROM public.attendance_sheets WHERE lecture_id=p_lecture_id FOR UPDATE;
 IF NOT FOUND OR s.status<>'draft' THEN RAISE EXCEPTION 'Session attendance is not open'; END IF;
 SELECT * INTO l FROM public.lectures WHERE id=p_lecture_id FOR UPDATE;
 IF NOT FOUND OR COALESCE(l.substitute_instructor_id,l.instructor_id) IS DISTINCT FROM inst OR s.camp_id<>l.camp_id THEN RAISE EXCEPTION 'Not assigned to this session'; END IF;
 IF l.status='cancelled' OR NOT EXISTS(SELECT 1 FROM public.camps c WHERE c.id=l.camp_id AND c.status='active') THEN RAISE EXCEPTION 'Session or camp is not active'; END IF;
 SELECT * INTO r FROM public.lecture_session_runs WHERE lecture_id=l.id AND revision_number=l.revision_number AND instructor_id=inst;
 IF FOUND THEN
   IF (r.camp_id,r.group_id,r.room_id,r.lecture_date,r.start_time,r.end_time) IS DISTINCT FROM (l.camp_id,l.group_id,l.room_id,l.lecture_date,l.start_time,l.end_time) THEN RAISE EXCEPTION 'Session schedule changed; ask Admin to issue a new revision'; END IF;
   RETURN jsonb_build_object('started_at',r.started_at);
 END IF;
 stamp:=clock_timestamp();
 IF stamp<((l.lecture_date+l.start_time) AT TIME ZONE 'Africa/Cairo')-interval '15 minutes' OR stamp>=((l.lecture_date+l.end_time) AT TIME ZONE 'Africa/Cairo') THEN
   RAISE EXCEPTION 'Run Session opens 15 minutes before the scheduled start and closes at scheduled end';
 END IF;
 INSERT INTO public.lecture_session_runs(lecture_id,revision_number,instructor_id,camp_id,group_id,room_id,lecture_date,start_time,end_time,started_at)
 VALUES(l.id,l.revision_number,inst,l.camp_id,l.group_id,l.room_id,l.lecture_date,l.start_time,l.end_time,stamp);
 PERFORM public.append_audit_log_internal(l.camp_id,'SESSION_STARTED','lectures',l.id::text,NULL,jsonb_build_object('revision',l.revision_number,'started_at',stamp),'Assigned instructor started session');
 RETURN jsonb_build_object('started_at',stamp);
END $$;
REVOKE ALL ON FUNCTION public.run_lecture_session_tx(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.run_lecture_session_tx(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_attendance_sheet_tx(p_sheet_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sheet RECORD;
  v_lecture RECORD;
  v_run_valid boolean := false;
  v_active_instructor UUID;

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

  IF v_sheet.status IN ('submitted', 'locked') THEN
    RAISE EXCEPTION 'CITS Integrity Violation: Attendance sheet % is already % and cannot be resubmitted by instructor.', v_sheet.id, v_sheet.status;
  END IF;

  SELECT * INTO v_lecture FROM public.lectures WHERE id = v_sheet.lecture_id FOR UPDATE;
  IF NOT FOUND OR v_lecture.camp_id<>v_sheet.camp_id THEN RAISE EXCEPTION 'Lecture mismatch'; END IF;
  IF v_lecture.status = 'cancelled' THEN
    RAISE EXCEPTION 'CITS Policy Violation: Attendance cannot be submitted for cancelled lecture %.', v_lecture.id;
  END IF;

  v_active_instructor := COALESCE(v_lecture.substitute_instructor_id, v_lecture.instructor_id);

  IF (is_cits_admin() OR current_instructor_id() = v_active_instructor) IS NOT TRUE THEN
    RAISE EXCEPTION 'CITS Authorization Denied: Only the active assigned instructor or Admin can submit attendance for lecture %.', v_sheet.lecture_id;
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.lecture_session_runs r
    WHERE r.lecture_id=v_lecture.id AND r.revision_number=v_lecture.revision_number AND r.instructor_id=v_active_instructor
    AND r.camp_id=v_lecture.camp_id AND r.group_id=v_lecture.group_id AND r.room_id=v_lecture.room_id
    AND r.lecture_date=v_lecture.lecture_date AND r.start_time=v_lecture.start_time AND r.end_time=v_lecture.end_time) INTO v_run_valid;
  IF NOT v_run_valid AND public.is_cits_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Run Session is required before submitting attendance'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.attendance_records WHERE attendance_sheet_id=v_sheet.id) THEN RAISE EXCEPTION 'Record student attendance before finishing the session'; END IF;

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

  IF v_run_valid THEN
    v_ent_status := 'eligible';
    v_ent_amount := v_lecture.frozen_rate_egp;
    v_ent_reason := 'Session started by assigned instructor and attendance synced.';
  ELSE
    v_ent_status := 'pending_review';
    v_ent_amount := 0;
    v_ent_reason := 'Admin submitted attendance without a recorded session start; explicit review required.';
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

