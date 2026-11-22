-- Phase 5A: visiting student from a second Group, through the SAME
-- transactional CAS used by the Instructor UI, and identity after refresh.
-- All rows added here (including modified draft) are ALWAYS rolled back.
DO $$
DECLARE
  v_camp uuid; v_home_group uuid; v_sheet uuid; v_lecture uuid;
  v_uid uuid; v_other_group uuid; v_student uuid;
  v_original jsonb; v_desired jsonb;
  v_count integer;
BEGIN
  SELECT c.id,g.id,sh.id,l.id,i.profile_id
  INTO v_camp,v_home_group,v_sheet,v_lecture,v_uid
  FROM public.camps c
  JOIN public.groups g ON g.camp_id=c.id
  JOIN public.lectures l ON l.group_id=g.id AND l.camp_id=c.id
  JOIN public.instructors i ON i.id=COALESCE(l.substitute_instructor_id,l.instructor_id)
  JOIN public.attendance_sheets sh ON sh.lecture_id=l.id AND sh.status='draft'
  WHERE c.code='STG-TEST-01' AND c.status='draft'
  LIMIT 1;
  IF v_camp IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'Missing STG-TEST-01 Draft fixture';
  END IF;

  BEGIN
    INSERT INTO public.groups(camp_id,code,name_en,name_ar,track,capacity)
    VALUES(v_camp,'STG-VISIT-ROLLBACK','Temporary Visiting Group',
      'مجموعة اختبار مؤقتة','Acceptance',30)
    RETURNING id INTO v_other_group;

    INSERT INTO public.students(camp_id,group_id,student_code,full_name,is_active)
    VALUES(v_camp,v_other_group,'STG-VISITOR-ROLLBACK',
      'Synthetic Cross Group Visitor',true)
    RETURNING id INTO v_student;

    PERFORM set_config('request.jwt.claim.sub',v_uid::text,true);
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    SELECT count(*) INTO v_count FROM public.search_visiting_students_for_lecture(
      v_lecture,'STG-VISITOR-ROLLBACK'
    ) WHERE student_id=v_student AND home_group_id=v_other_group
      AND student_code='STG-VISITOR-ROLLBACK';
    IF v_count<>1 THEN RAISE EXCEPTION 'TEST FAILED: visitor search missing'; END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'studentId',student_id::text,'mark',mark::text,
      'originGroupId',origin_group_id::text,'attendedGroupId',attended_group_id::text,
      'isCrossGroup',is_cross_group,'note',coalesce(note,'')
    ) ORDER BY student_id::text),'[]'::jsonb)
    INTO v_original FROM public.attendance_records WHERE attendance_sheet_id=v_sheet;
    v_desired:=v_original || jsonb_build_array(jsonb_build_object(
      'studentId',v_student::text,'mark','present',
      'originGroupId',v_other_group::text,'attendedGroupId',v_home_group::text,
      'isCrossGroup',true,'note','Visitor acceptance test'
    ));
    PERFORM public.save_attendance_draft_cas_tx(v_sheet,v_original,v_desired,false);

    IF NOT EXISTS (
      SELECT 1 FROM public.attendance_records
      WHERE attendance_sheet_id=v_sheet AND student_id=v_student
        AND is_cross_group=true AND origin_group_id=v_other_group
        AND attended_group_id=v_home_group AND mark='present'
    ) THEN RAISE EXCEPTION 'TEST FAILED: visitor CAS did not persist cross-group mark'; END IF;

    SELECT count(*) INTO v_count FROM public.search_visiting_students_for_lecture(
      v_lecture,'STG-VISITOR-ROLLBACK'
    ) WHERE student_id=v_student;
    IF v_count<>0 THEN RAISE EXCEPTION 'TEST FAILED: recorded visitor still offered in search'; END IF;

    SELECT count(*) INTO v_count FROM public.my_recorded_visiting_student_identities()
    WHERE student_id=v_student AND student_code='STG-VISITOR-ROLLBACK'
      AND full_name='Synthetic Cross Group Visitor'
      AND home_group_code='STG-VISIT-ROLLBACK';
    IF v_count<>1 THEN RAISE EXCEPTION 'TEST FAILED: visitor identity not retrievable after reload'; END IF;

    RAISE EXCEPTION 'ROLLBACK_VISITOR_ACCEPTANCE_PASSED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_VISITOR_ACCEPTANCE_PASSED' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.groups WHERE id=v_other_group) OR
     EXISTS (SELECT 1 FROM public.students WHERE id=v_student) THEN
    RAISE EXCEPTION 'TEST FAILED: visiting fixture was not rolled back';
  END IF;
  RAISE NOTICE 'PASS visitor search, CAS, no duplicate search, reload identity and rollback';
END $$;
