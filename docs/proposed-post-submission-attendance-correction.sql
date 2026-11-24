-- REVIEW ONLY: not an applied migration. Supabase CLI not available in this environment.
-- Promote to a new migration after review and rollback-only Staging SQL tests.
-- Never run against Production without explicit approval.
CREATE OR REPLACE FUNCTION admin_correct_attendance_tx(
  p_sheet_id UUID,
  p_student_id UUID,
  p_mark attendance_mark,
  p_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sheet RECORD;
  v_lecture RECORD;
  v_prev_record RECORD;
  v_origin_group_id UUID;
  v_clean_note TEXT;
  v_present_count INTEGER := 0;
  v_absent_count INTEGER := 0;
  v_cross_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR is_cits_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'CITS Security Violation: Only a verified AAL2 Admin can perform post-submission attendance corrections.';
  END IF;

  IF p_mark IS NULL THEN RAISE EXCEPTION 'Attendance mark is required'; END IF;
  v_clean_note := TRIM(COALESCE(p_note, ''));
  IF v_clean_note = '' THEN
    RAISE EXCEPTION 'CITS Audit Violation: A non-empty audit reason is required to correct student attendance.';
  END IF;

  SELECT * INTO v_sheet FROM public.attendance_sheets WHERE id = p_sheet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance sheet % not found.', p_sheet_id;
  END IF;

  PERFORM assert_camp_not_archived(v_sheet.camp_id);

  SELECT * INTO v_lecture FROM public.lectures WHERE id = v_sheet.lecture_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lecture % not found.', v_sheet.lecture_id;
  END IF;

  v_origin_group_id := resolve_student_group_for_day(v_sheet.camp_id, p_student_id, v_lecture.camp_day);
  IF v_origin_group_id IS NULL THEN
    RAISE EXCEPTION 'CITS Attendance Error: Student % does not belong to camp %.', p_student_id, v_sheet.camp_id;
  END IF;

  SELECT mark, note INTO v_prev_record
  FROM public.attendance_records
  WHERE attendance_sheet_id = v_sheet.id
    AND student_id = p_student_id;

  PERFORM set_config('cits.trusted_rpc', 'admin_correct_attendance_tx', true);

  -- UPDATE existing rows, preserving their primary key. An INSERT ... ON CONFLICT
  -- would run BEFORE INSERT triggers with a fresh id and falsely detect itself
  -- as duplicate present/late attendance.
  IF v_prev_record.mark IS NOT NULL THEN
    UPDATE public.attendance_records
    SET mark = p_mark, note = v_clean_note, updated_by = auth.uid(), updated_at = NOW()
    WHERE attendance_sheet_id = v_sheet.id AND student_id = p_student_id;
  ELSE
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
      note,
      updated_by
    ) VALUES (
      v_sheet.camp_id,
      v_sheet.id,
      v_lecture.id,
      v_lecture.camp_day,
      v_lecture.period_number,
      p_student_id,
      v_origin_group_id,
      v_lecture.group_id,
      (v_origin_group_id IS DISTINCT FROM v_lecture.group_id),
      p_mark,
      v_clean_note,
      auth.uid()
    );
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE mark IN ('present', 'late')),
    COUNT(*) FILTER (WHERE mark = 'absent'),
    COUNT(*) FILTER (WHERE is_cross_group = TRUE AND mark IN ('present', 'late'))
  INTO v_present_count, v_absent_count, v_cross_count
  FROM public.attendance_records
  WHERE attendance_sheet_id = v_sheet.id;

  UPDATE public.attendance_sheets
  SET present_count = v_present_count,
      absent_count = v_absent_count,
      cross_group_count = v_cross_count,
      updated_at = NOW()
  WHERE id = v_sheet.id;

  PERFORM append_audit_log_internal(
    v_sheet.camp_id,
    'ATTENDANCE_ADMIN_CORRECTED',
    'attendance_records',
    format('%s:%s', v_sheet.id, p_student_id),
    jsonb_build_object(
      'previous_mark', v_prev_record.mark,
      'previous_note', v_prev_record.note,
      'sheet_status', v_sheet.status
    ),
    jsonb_build_object(
      'new_mark', p_mark,
      'present_count', v_present_count,
      'absent_count', v_absent_count,
      'cross_group_count', v_cross_count
    ),
    v_clean_note
  );

  PERFORM set_config('cits.trusted_rpc', '', true);

  RETURN jsonb_build_object(
    'sheet_id', v_sheet.id,
    'student_id', p_student_id,
    'mark', p_mark,
    'present_count', v_present_count,
    'absent_count', v_absent_count,
    'cross_group_count', v_cross_count
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_correct_attendance_tx(UUID, UUID, attendance_mark, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_correct_attendance_tx(UUID, UUID, attendance_mark, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_correct_attendance_tx(UUID, UUID, attendance_mark, TEXT) FROM anon;

CREATE OR REPLACE FUNCTION public.instructor_correct_submitted_attendance_tx(
  p_sheet_id UUID,
  p_student_id UUID,
  p_mark attendance_mark,
  p_note TEXT,
  p_expected_mark attendance_mark
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sheet RECORD;
  v_lecture RECORD;
  v_prev_record RECORD;
  v_origin_group_id UUID;
  v_clean_note TEXT;
  v_present_count INTEGER := 0;
  v_absent_count INTEGER := 0;
  v_cross_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR current_instructor_id() IS NULL THEN
    RAISE EXCEPTION 'Only an active instructor may correct their submitted attendance';
  END IF;

  IF p_mark IS NULL THEN RAISE EXCEPTION 'Attendance mark is required'; END IF;
  v_clean_note := TRIM(COALESCE(p_note, ''));
  IF v_clean_note = '' THEN
    RAISE EXCEPTION 'CITS Audit Violation: A non-empty audit reason is required to correct student attendance.';
  END IF;

  SELECT * INTO v_sheet FROM public.attendance_sheets WHERE id = p_sheet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance sheet % not found.', p_sheet_id;
  END IF;

  PERFORM assert_camp_not_archived(v_sheet.camp_id);

  SELECT * INTO v_lecture FROM public.lectures WHERE id = v_sheet.lecture_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lecture % not found.', v_sheet.lecture_id;
  END IF;

  IF v_sheet.status <> 'submitted'
     OR v_sheet.instructor_id IS DISTINCT FROM current_instructor_id()
     OR COALESCE(v_lecture.substitute_instructor_id, v_lecture.instructor_id) IS DISTINCT FROM current_instructor_id()
     OR v_lecture.status = 'cancelled'
     OR NOT EXISTS (SELECT 1 FROM public.camps c WHERE c.id = v_sheet.camp_id AND c.status = 'active')
     OR v_lecture.lecture_date > (NOW() AT TIME ZONE 'Africa/Cairo')::date THEN
    RAISE EXCEPTION 'Only your own submitted, unlocked lecture in an active camp can be corrected';
  END IF;

  v_origin_group_id := resolve_student_group_for_day(v_sheet.camp_id, p_student_id, v_lecture.camp_day);
  IF v_origin_group_id IS NULL THEN
    RAISE EXCEPTION 'CITS Attendance Error: Student % does not belong to camp %.', p_student_id, v_sheet.camp_id;
  END IF;

  SELECT mark, note INTO v_prev_record
  FROM public.attendance_records
  WHERE attendance_sheet_id = v_sheet.id
    AND student_id = p_student_id;

  IF NOT FOUND OR p_expected_mark IS NULL OR v_prev_record.mark IS DISTINCT FROM p_expected_mark THEN
    RAISE EXCEPTION 'Attendance changed or record missing. Refresh and review before retrying.';
  END IF;

  -- Use the same audited correction guard token; raw authenticated DML stays blocked.
  PERFORM set_config('cits.trusted_rpc', 'admin_correct_attendance_tx', true);

  UPDATE public.attendance_records
  SET mark = p_mark, note = v_clean_note, updated_by = auth.uid(), updated_at = NOW()
  WHERE attendance_sheet_id = v_sheet.id AND student_id = p_student_id;

  SELECT
    COUNT(*) FILTER (WHERE mark IN ('present', 'late')),
    COUNT(*) FILTER (WHERE mark = 'absent'),
    COUNT(*) FILTER (WHERE is_cross_group = TRUE AND mark IN ('present', 'late'))
  INTO v_present_count, v_absent_count, v_cross_count
  FROM public.attendance_records
  WHERE attendance_sheet_id = v_sheet.id;

  UPDATE public.attendance_sheets
  SET present_count = v_present_count,
      absent_count = v_absent_count,
      cross_group_count = v_cross_count,
      updated_at = NOW()
  WHERE id = v_sheet.id;

  PERFORM append_audit_log_internal(
    v_sheet.camp_id,
    'ATTENDANCE_INSTRUCTOR_CORRECTED',
    'attendance_records',
    format('%s:%s', v_sheet.id, p_student_id),
    jsonb_build_object(
      'previous_mark', v_prev_record.mark,
      'previous_note', v_prev_record.note,
      'sheet_status', v_sheet.status
    ),
    jsonb_build_object(
      'new_mark', p_mark,
      'present_count', v_present_count,
      'absent_count', v_absent_count,
      'cross_group_count', v_cross_count
    ),
    v_clean_note
  );

  PERFORM set_config('cits.trusted_rpc', '', true);

  RETURN jsonb_build_object(
    'sheet_id', v_sheet.id,
    'student_id', p_student_id,
    'mark', p_mark,
    'present_count', v_present_count,
    'absent_count', v_absent_count,
    'cross_group_count', v_cross_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.instructor_correct_submitted_attendance_tx(UUID, UUID, attendance_mark, TEXT, attendance_mark) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.instructor_correct_submitted_attendance_tx(UUID, UUID, attendance_mark, TEXT, attendance_mark) TO authenticated;
