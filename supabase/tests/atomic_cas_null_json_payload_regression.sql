-- Safety regression for migration 0022.
-- NULL / JSON null / object payloads must be rejected with zero writes.
DO $$
DECLARE
  v_sheet uuid; v_uid uuid; v_original jsonb; v_after jsonb;
  v_case text; v_input jsonb;
BEGIN
  SELECT sh.id,i.profile_id INTO v_sheet,v_uid
  FROM public.attendance_sheets sh
  JOIN public.camps c ON c.id=sh.camp_id
  JOIN public.lectures l ON l.id=sh.lecture_id
  JOIN public.instructors i ON i.id=COALESCE(l.substitute_instructor_id,l.instructor_id)
  WHERE c.code='STG-TEST-01' AND sh.status='draft' LIMIT 1;

  IF v_sheet IS NULL THEN RAISE EXCEPTION 'Missing Staging Draft sheet'; END IF;
  PERFORM set_config('request.jwt.claim.sub',v_uid::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'studentId',student_id::text,'mark',mark::text,'originGroupId',origin_group_id::text,
    'attendedGroupId',attended_group_id::text,'isCrossGroup',is_cross_group,
    'note',coalesce(note,'')
  ) ORDER BY student_id::text),'[]'::jsonb) INTO v_original
  FROM public.attendance_records WHERE attendance_sheet_id=v_sheet;

  FOR v_case,v_input IN
    SELECT 'sql null desired',NULL::jsonb
    UNION ALL SELECT 'json null desired','null'::jsonb
    UNION ALL SELECT 'object desired','{"studentId":"bad"}'::jsonb
  LOOP
    BEGIN
      PERFORM public.save_attendance_draft_cas_tx(v_sheet,v_original,v_input,false);
      RAISE EXCEPTION 'TEST FAILED: invalid desired accepted (%)',v_case;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
      IF SQLERRM<>'Invalid attendance draft payload' THEN
        RAISE EXCEPTION 'Unexpected invalid desired error (%) => %',v_case,SQLERRM;
      END IF;
    END;
  END LOOP;
  FOR v_case,v_input IN
    SELECT 'sql null expected',NULL::jsonb
    UNION ALL SELECT 'json null expected','null'::jsonb
    UNION ALL SELECT 'object expected','{"studentId":"bad"}'::jsonb
  LOOP
    BEGIN
      PERFORM public.save_attendance_draft_cas_tx(v_sheet,v_input,v_original,false);
      RAISE EXCEPTION 'TEST FAILED: invalid expected accepted (%)',v_case;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
      IF SQLERRM<>'Invalid attendance draft payload' THEN
        RAISE EXCEPTION 'Unexpected invalid expected error (%) => %',v_case,SQLERRM;
      END IF;
    END;
  END LOOP;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'studentId',student_id::text,'mark',mark::text,'originGroupId',origin_group_id::text,
    'attendedGroupId',attended_group_id::text,'isCrossGroup',is_cross_group,
    'note',coalesce(note,'')
  ) ORDER BY student_id::text),'[]'::jsonb) INTO v_after
  FROM public.attendance_records WHERE attendance_sheet_id=v_sheet;
  IF v_after IS DISTINCT FROM v_original THEN
    RAISE EXCEPTION 'TEST FAILED: malformed payload mutated saved attendance';
  END IF;
  RAISE NOTICE 'PASS six malformed payload cases with unchanged attendance records';
END $$;
