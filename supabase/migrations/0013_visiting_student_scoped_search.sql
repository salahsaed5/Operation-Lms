-- 0013: Minimal, lecture-scoped visiting student search.
-- No broadened RLS SELECT policy on public.students. This function is the
-- only authorized exception for an instructor who needs to identify a visitor
-- from another group of the SAME Camp.
--
-- PROPOSED MIGRATION — review/explicit Staging approval required before apply.

CREATE OR REPLACE FUNCTION public.search_visiting_students_for_lecture(
  p_lecture_id uuid,
  p_query text
)
RETURNS TABLE (
  student_id uuid,
  student_code text,
  full_name text,
  home_group_id uuid,
  home_group_code text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_instructor_id uuid;
  v_term text := lower(btrim(COALESCE(p_query, '')));
BEGIN
  v_instructor_id := public.current_instructor_id();
  IF v_instructor_id IS NULL THEN
    RAISE EXCEPTION 'Visiting student lookup is restricted to authenticated active instructors.';
  END IF;
  IF length(v_term) < 2 OR length(v_term) > 64 THEN
    RAISE EXCEPTION 'Please provide 2 to 64 characters of student name or code.';
  END IF;

  RETURN QUERY
  SELECT st.id AS student_id, st.student_code, st.full_name,
         home_group.id AS home_group_id, home_group.code AS home_group_code
  FROM public.lectures lec
  JOIN public.camps camp ON camp.id = lec.camp_id
  JOIN public.students st ON st.camp_id = lec.camp_id AND st.is_active = TRUE
  JOIN LATERAL (
    SELECT public.resolve_student_group_for_day(
      lec.camp_id, st.id, lec.camp_day
    ) AS group_id
  ) resolved ON TRUE
  JOIN public.groups home_group ON home_group.id = resolved.group_id
    AND home_group.camp_id = lec.camp_id
  WHERE lec.id = p_lecture_id
    AND lec.status <> 'cancelled'
    AND camp.status <> 'archived'
    AND COALESCE(lec.substitute_instructor_id, lec.instructor_id) = v_instructor_id
    AND home_group.id <> lec.group_id
    AND (
      position(v_term IN lower(st.full_name)) > 0
      OR position(v_term IN lower(st.student_code)) > 0
      OR position(v_term IN lower(home_group.code)) > 0
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.attendance_records ar
      WHERE ar.lecture_id = lec.id AND ar.student_id = st.id
    )
  ORDER BY CASE WHEN lower(st.student_code) = v_term THEN 0 ELSE 1 END,
           st.student_code
  LIMIT 12;
END;
$$;

REVOKE ALL ON FUNCTION public.search_visiting_students_for_lecture(uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_visiting_students_for_lecture(uuid,text)
  TO authenticated;

COMMENT ON FUNCTION public.search_visiting_students_for_lecture(uuid,text) IS
  'Returns minimal student identity and home group for visiting attendees, only for the requesting instructor assigned to the lecture in the same Camp.';

-- Instructor student roster SELECT RLS remains restricted to assigned groups.
