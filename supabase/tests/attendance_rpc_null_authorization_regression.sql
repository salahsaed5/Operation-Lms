-- Staging-only security regression: run in a transaction, with no Production credentials.
-- Both privileged RPCs must deny a signed-in identity with NO Instructor/Admin row.
-- Deliberately use the well-formed fake UUID below. No persistent writes are expected.
DO $$
DECLARE
  v_sheet uuid;
  v_rows jsonb;
BEGIN
  SELECT id INTO v_sheet FROM public.attendance_sheets WHERE status='draft' ORDER BY id LIMIT 1;
  IF v_sheet IS NULL THEN
    RAISE EXCEPTION 'Need a Staging draft sheet for this regression test';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'studentId',student_id::text, 'mark',mark::text,
    'originGroupId',origin_group_id::text, 'attendedGroupId',attended_group_id::text,
    'isCrossGroup',is_cross_group, 'note',coalesce(note,'')
  ) ORDER BY student_id::text),'[]'::jsonb) INTO v_rows
  FROM public.attendance_records WHERE attendance_sheet_id=v_sheet;

  PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  BEGIN
    PERFORM public.save_attendance_draft_cas_tx(v_sheet,v_rows,v_rows,false);
    RAISE EXCEPTION 'TEST FAILED: unauthorized CAS accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
    IF SQLERRM <> 'Not authorized for this lecture' THEN
      RAISE EXCEPTION 'TEST FAILED: wrong CAS denial: %',SQLERRM;
    END IF;
  END;

  BEGIN
    PERFORM public.submit_attendance_sheet_tx(v_sheet);
    RAISE EXCEPTION 'TEST FAILED: unauthorized submission accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'CITS Authorization Denied:%' THEN
      RAISE EXCEPTION 'TEST FAILED: wrong submit denial: %',SQLERRM;
    END IF;
  END;
END $$;
