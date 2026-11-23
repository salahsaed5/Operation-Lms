-- Integration test for Excused marks in atomic RPC; all data rolled back.
DO $$
DECLARE v_sheet uuid;v_uid uuid;v_original jsonb;v_excused jsonb;v_student uuid;
BEGIN
 SELECT sh.id,i.profile_id INTO v_sheet,v_uid FROM public.attendance_sheets sh
 JOIN public.lectures l ON l.id=sh.lecture_id
 JOIN public.camps c ON c.id=sh.camp_id
 JOIN public.instructors i ON i.id=COALESCE(l.substitute_instructor_id,l.instructor_id)
 WHERE c.code='STG-TEST-01' AND sh.status='draft' LIMIT 1;
 IF v_sheet IS NULL THEN RAISE EXCEPTION 'Missing Staging draft sheet'; END IF;
 PERFORM set_config('request.jwt.claim.sub',v_uid::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'studentId',student_id::text,'mark',mark::text,
  'originGroupId',origin_group_id::text,'attendedGroupId',attended_group_id::text,
  'isCrossGroup',is_cross_group,'note',coalesce(note,'')
 ) ORDER BY student_id::text),'[]'::jsonb)
 INTO v_original FROM public.attendance_records WHERE attendance_sheet_id=v_sheet;
 IF jsonb_array_length(v_original)=0 THEN RAISE EXCEPTION 'Empty Staging sheet'; END IF;
 v_student:=(v_original->0->>'studentId')::uuid;
 SELECT jsonb_agg(
   CASE WHEN x.value->>'studentId'=v_student::text
     THEN jsonb_set(jsonb_set(x.value,'{mark}','"excused"'::jsonb),'{note}','"QA excused"'::jsonb)
     ELSE x.value END ORDER BY x.value->>'studentId'
 ) INTO v_excused FROM jsonb_array_elements(v_original) AS x;
 BEGIN
  PERFORM public.save_attendance_draft_cas_tx(v_sheet,v_original,v_excused,false);
  IF NOT EXISTS(
    SELECT 1 FROM public.attendance_records
    WHERE attendance_sheet_id=v_sheet AND student_id=v_student
      AND mark='excused' AND note='QA excused'
  ) THEN RAISE EXCEPTION 'TEST FAIL: Excused mark not saved'; END IF;
  RAISE EXCEPTION 'ROLLBACK_EXCUSED_TEST_PASSED';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'ROLLBACK_EXCUSED_TEST_PASSED' THEN RAISE; END IF;
 END;
 IF EXISTS(
  SELECT 1 FROM public.attendance_records
  WHERE attendance_sheet_id=v_sheet AND student_id=v_student AND note='QA excused'
 ) THEN RAISE EXCEPTION 'TEST FAIL: Excused test changed Staging data'; END IF;
 RAISE NOTICE 'PASS Excused save via CAS and no persistent test mutations';
END $$;
