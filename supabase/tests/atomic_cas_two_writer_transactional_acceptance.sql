-- Transactional acceptance test for attendance draft CAS.
-- Uses real assigned Staging Instructor and Draft sheet, but ALWAYS rolls
-- back every saved edit and protects existing records.
DO $$
DECLARE
  v_sheet uuid; v_instructor_uid uuid;
  v_original jsonb; v_a jsonb; v_b jsonb; v_target text;
  v_after jsonb;
BEGIN
  SELECT sh.id,i.profile_id INTO v_sheet,v_instructor_uid
  FROM public.attendance_sheets sh
  JOIN public.lectures l ON l.id=sh.lecture_id
  JOIN public.camps c ON c.id=sh.camp_id
  JOIN public.instructors i ON i.id=COALESCE(l.substitute_instructor_id,l.instructor_id)
  WHERE c.code='STG-TEST-01' AND sh.status='draft'
  ORDER BY sh.id LIMIT 1;
  IF v_sheet IS NULL THEN RAISE EXCEPTION 'No Staging draft attendance fixture'; END IF;

  PERFORM set_config('request.jwt.claim.sub',v_instructor_uid::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'sub',v_instructor_uid,'role','authenticated','aal','aal1')::text,true);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'studentId',student_id::text,'mark',mark::text,
    'originGroupId',origin_group_id::text,'attendedGroupId',attended_group_id::text,
    'isCrossGroup',is_cross_group,'note',coalesce(note,'')
  ) ORDER BY student_id::text),'[]'::jsonb)
  INTO v_original FROM public.attendance_records
  WHERE attendance_sheet_id=v_sheet;
  IF jsonb_array_length(v_original)=0 THEN
    RAISE EXCEPTION 'Staging fixture has no records';
  END IF;
  v_target:=v_original->0->>'studentId';

  SELECT jsonb_agg(
    CASE WHEN value->>'studentId'=v_target
      THEN jsonb_set(value,'{note}',to_jsonb('CAS QA A'::text))
      ELSE value END ORDER BY value->>'studentId')
    INTO v_a FROM jsonb_array_elements(v_original);

  SELECT jsonb_agg(
    CASE WHEN value->>'studentId'=v_target
      THEN jsonb_set(value,'{note}',to_jsonb('CAS QA B'::text))
      ELSE value END ORDER BY value->>'studentId')
    INTO v_b FROM jsonb_array_elements(v_original);

  -- A matching edit must be accepted by the DB function.
  BEGIN
    PERFORM public.save_attendance_draft_cas_tx(v_sheet,v_original,v_original,false);
    RAISE EXCEPTION 'ROLLBACK_EXACT_MATCH_PASS';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_EXACT_MATCH_PASS' THEN RAISE; END IF;
  END;

  -- A stale snapshot must never overwrite the current server draft.
  BEGIN
    PERFORM public.save_attendance_draft_cas_tx(v_sheet,'[]'::jsonb,v_original,false);
    RAISE EXCEPTION 'TEST FAILED: empty expected snapshot accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'ATTENDANCE_CONFLICT:%' THEN
      RAISE EXCEPTION 'TEST FAILED: incorrect stale-snapshot error: %',SQLERRM;
    END IF;
  END;

  -- First editor updates, second stale editor must receive conflict.
  -- The whole subtransaction rolls back the first update afterwards.
  BEGIN
    PERFORM public.save_attendance_draft_cas_tx(v_sheet,v_original,v_a,false);
    BEGIN
      PERFORM public.save_attendance_draft_cas_tx(v_sheet,v_original,v_b,false);
      RAISE EXCEPTION 'TEST FAILED: second stale writer accepted';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE 'ATTENDANCE_CONFLICT:%' THEN
        RAISE EXCEPTION 'TEST FAILED: unexpected second writer result: %',SQLERRM;
      END IF;
    END;
    RAISE EXCEPTION 'ROLLBACK_TWO_WRITER_PASS';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_TWO_WRITER_PASS' THEN RAISE; END IF;
  END;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'studentId',student_id::text,'mark',mark::text,
    'originGroupId',origin_group_id::text,'attendedGroupId',attended_group_id::text,
    'isCrossGroup',is_cross_group,'note',coalesce(note,'')
  ) ORDER BY student_id::text),'[]'::jsonb)
  INTO v_after FROM public.attendance_records
  WHERE attendance_sheet_id=v_sheet;
  IF v_after IS DISTINCT FROM v_original THEN
    RAISE EXCEPTION 'TEST FAILED: CAS fixture was not rolled back';
  END IF;
  RAISE NOTICE 'PASS atomic CAS save, conflict, second editor and rollback';
END $$;
