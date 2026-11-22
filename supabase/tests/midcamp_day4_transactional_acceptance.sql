-- Phase 5B: full day-four enrollment acceptance test against STAGING only.
-- All simulated activation, student creation, audit and attendance attempts
-- run in a PL/pgSQL subtransaction and are rolled back unconditionally.
DO $$
DECLARE
  v_camp uuid;
  v_group uuid;
  v_sheet uuid;
  v_lecture uuid;
  v_inst uuid;
  v_uid uuid;
  v_day integer;
  v_student uuid;
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
BEGIN
  SELECT c.id,g.id,sh.id,l.id,l.instructor_id,i.profile_id
    INTO v_camp,v_group,v_sheet,v_lecture,v_inst,v_uid
  FROM public.camps c
  JOIN public.groups g ON g.camp_id=c.id
  JOIN public.lectures l ON l.group_id=g.id AND l.camp_id=c.id AND l.camp_day=1
  JOIN public.instructors i ON i.id=l.instructor_id
  JOIN public.attendance_sheets sh ON sh.lecture_id=l.id AND sh.status='draft'
  WHERE c.code='STG-TEST-01' AND c.status='draft'
  LIMIT 1;

  IF v_camp IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'Missing approved STG-TEST-01 Draft Camp fixture';
  END IF;

  BEGIN
    -- Simulate Day 4 only in this rolled-back subtransaction.
    UPDATE public.camps SET status='active',
      start_date=v_today-3, end_date=v_today+6, current_camp_day=4
    WHERE id=v_camp;

    PERFORM set_config('request.jwt.claim.sub',v_uid::text,true);
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    v_student:=public.instructor_enroll_midcamp_student_tx(
      v_group,'STG-ROLLBACK-D4','Synthetic Midcamp Acceptance Student',
      'Staging University','Transactional day-four acceptance test'
    );

    SELECT joined_camp_day INTO v_day FROM public.students WHERE id=v_student;
    IF v_day<>4 THEN RAISE EXCEPTION 'TEST FAILED: joining day != 4'; END IF;
    IF NOT EXISTS(
      SELECT 1 FROM public.students s
      WHERE s.id=v_student AND s.enrolled_by_profile_id=v_uid
        AND s.enrollment_origin='instructor_late_join'
    ) THEN RAISE EXCEPTION 'TEST FAILED: enrollment provenance missing'; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.audit_logs a
      WHERE a.entity_id=v_student::text AND a.action='STUDENT_ENROLLED_MIDCAMP'
    ) THEN RAISE EXCEPTION 'TEST FAILED: enrollment audit missing'; END IF;

    BEGIN
      INSERT INTO public.attendance_records(
        camp_id,attendance_sheet_id,lecture_id,camp_day,period_number,
        student_id,origin_group_id,attended_group_id,is_cross_group,mark,updated_by
      ) SELECT v_camp,v_sheet,v_lecture,l.camp_day,l.period_number,
          v_student,v_group,v_group,false,'absent',v_uid
        FROM public.lectures l WHERE l.id=v_lecture;
      RAISE EXCEPTION 'TEST FAILED: Day-1 absence accepted before Day-4 enrollment';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE 'Attendance cannot be recorded before a student joined%' THEN
        RAISE EXCEPTION 'TEST FAILED: unexpected prejoin error: %', SQLERRM;
      END IF;
    END;

    RAISE EXCEPTION 'ROLLBACK_VERIFIED_DAY4_FIXTURE';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_VERIFIED_DAY4_FIXTURE' THEN RAISE; END IF;
  END;

  IF (SELECT status::text FROM public.camps WHERE id=v_camp) <> 'draft' THEN
    RAISE EXCEPTION 'TEST FAILED: Staging Camp was not rolled back to Draft';
  END IF;
  IF EXISTS(SELECT 1 FROM public.students WHERE student_code='STG-ROLLBACK-D4' AND camp_id=v_camp) THEN
    RAISE EXCEPTION 'TEST FAILED: transient student was not rolled back';
  END IF;
  RAISE NOTICE 'PASS Day-4 enrollment provenance, audit, prejoin absence guard, and rollback';
END $$;
