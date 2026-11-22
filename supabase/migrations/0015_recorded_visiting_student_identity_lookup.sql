-- 0015: Resolve display labels for already-recorded visiting students.
-- Proposed follow-up migration: NOT applied until separately reviewed/approved.
-- Instructors must NOT gain unrestricted SELECT on students. RLS remains intact.
--
-- Why: Instructor sees attendance_records for their lecture via existing RLS,
-- but does not SELECT students belonging to other groups. A visiting record
-- otherwise hydrates with "Student" and an 8-character UUID fallback.
-- Only resolve identities that already have a cross-group attendance record
-- in an Instructor-owned lecture; no arbitrary code/name enumeration.

CREATE OR REPLACE FUNCTION public.my_recorded_visiting_student_identities()
RETURNS TABLE (
  student_id uuid,
  student_code text,
  full_name text,
  home_group_code text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_instructor_id uuid;
BEGIN
  v_instructor_id := public.current_instructor_id();
  IF auth.uid() IS NULL OR v_instructor_id IS NULL THEN
    RAISE EXCEPTION 'Visiting student identity lookup requires an active Instructor account.';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (st.id)
    st.id,
    st.student_code,
    st.full_name,
    home_group.code
  FROM public.attendance_records ar
  JOIN public.lectures lec ON lec.id = ar.lecture_id
    AND lec.camp_id = ar.camp_id
  JOIN public.attendance_sheets sh ON sh.id = ar.attendance_sheet_id
    AND sh.camp_id = ar.camp_id
    AND sh.lecture_id = ar.lecture_id
  JOIN public.students st ON st.id = ar.student_id
    AND st.camp_id = ar.camp_id
  JOIN public.groups home_group ON home_group.id = ar.origin_group_id
    AND home_group.camp_id = ar.camp_id
  WHERE COALESCE(lec.substitute_instructor_id, lec.instructor_id) = v_instructor_id
    AND ar.is_cross_group = TRUE
    AND ar.origin_group_id IS DISTINCT FROM ar.attended_group_id
  ORDER BY st.id, lec.camp_day DESC, lec.id
  LIMIT 1000;
END;
$$;

REVOKE ALL ON FUNCTION public.my_recorded_visiting_student_identities()
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_recorded_visiting_student_identities()
TO authenticated;

COMMENT ON FUNCTION public.my_recorded_visiting_student_identities() IS
  'Minimal name/code/home-group lookup for students already recorded as cross-group visitors on lectures assigned to the requesting Instructor.';
