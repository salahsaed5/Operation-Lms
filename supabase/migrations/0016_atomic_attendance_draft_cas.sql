-- Phase 5C: atomic draft compare-and-swap.
-- Review and test on Staging before applying. Does not finalize attendance.
-- Serialize ALL attendance-record mutations on the parent sheet row.
CREATE OR REPLACE FUNCTION public.lock_attendance_parent_for_record_write()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_id uuid; v_status text;
BEGIN
  IF TG_OP='UPDATE' AND OLD.attendance_sheet_id IS DISTINCT FROM NEW.attendance_sheet_id THEN
    RAISE EXCEPTION 'Moving attendance records between sheets is forbidden';
  END IF;
  v_id := CASE WHEN TG_OP='DELETE' THEN OLD.attendance_sheet_id ELSE NEW.attendance_sheet_id END;
  SELECT status::text INTO v_status FROM public.attendance_sheets WHERE id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attendance sheet missing'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS trg_lock_attendance_parent ON public.attendance_records;
CREATE TRIGGER trg_lock_attendance_parent BEFORE INSERT OR UPDATE OR DELETE
ON public.attendance_records FOR EACH ROW EXECUTE FUNCTION public.lock_attendance_parent_for_record_write();

-- Expected and desired rows are arrays of objects with keys studentId, mark,
-- originGroupId, attendedGroupId, isCrossGroup, note. Unmarked rows are omitted.
-- Compare canonical server state while holding the sheet lock; reject conflicts.
CREATE OR REPLACE FUNCTION public.save_attendance_draft_cas_tx(
  p_sheet_id uuid, p_expected jsonb, p_desired jsonb
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
  IF NOT (public.is_cits_admin() OR public.current_instructor_id()=v_active_instructor) THEN
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
  UPDATE public.attendance_sheets SET synced_at=now(),updated_at=now(),sync_state='Synced'
  WHERE id=p_sheet_id;
  RETURN jsonb_build_object('ok',true,'sheet_id',p_sheet_id);
END $$;
REVOKE ALL ON FUNCTION public.save_attendance_draft_cas_tx(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_attendance_draft_cas_tx(uuid,jsonb,jsonb) TO authenticated;
