-- =============================================================================
-- Migration 0009: P0 — Instructor group/student roster isolation
--
-- Context: Original student SELECT policy grants access by group OR camp.
-- A camp-level assignment is not sufficient authorization to read ALL groups'
-- student rosters. The group helper also accepts expired instructor assignments.
--
-- Safety: Forward-only; does not create, modify or delete user data.
-- Apply to reviewed Staging only, after 0008, before any Production consideration.
-- =============================================================================
BEGIN;

-- An instructor sees a group only if assigned for the CURRENT camp day, or
-- actively teaching a non-cancelled lecture in that group on the CURRENT day.
-- Historical group assignments and past lectures are not ongoing access grants.
CREATE OR REPLACE FUNCTION public.is_instructor_assigned_to_group(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.current_instructor_id() IS NOT NULL AND (
    EXISTS (
      SELECT 1
      FROM public.group_instructors gi
      JOIN public.groups g ON g.id = gi.group_id AND g.camp_id = gi.camp_id
      JOIN public.camps c ON c.id = gi.camp_id
      WHERE gi.group_id = p_group_id
        AND gi.instructor_id = public.current_instructor_id()
        AND gi.effective_from_day <= c.current_camp_day
        -- effective_to_day is exclusive: reassignment on day N removes old access on N.
        AND (gi.effective_to_day IS NULL OR c.current_camp_day < gi.effective_to_day)
    )
    OR EXISTS (
      SELECT 1
      FROM public.lectures l
      JOIN public.camps c ON c.id = l.camp_id
      WHERE l.group_id = p_group_id
        AND l.camp_day = c.current_camp_day
        AND l.status <> 'cancelled'
        AND COALESCE(l.substitute_instructor_id, l.instructor_id) =
            public.current_instructor_id()
    )
  );
$$;

REVOKE ALL ON FUNCTION public.is_instructor_assigned_to_group(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_instructor_assigned_to_group(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_instructor_assigned_to_group(UUID) TO authenticated;

-- Remove the camp-wide bypass. Instructor access is now group-scoped only.
DROP POLICY IF EXISTS "Instructors read permitted student rosters" ON public.students;
CREATE POLICY "Instructors read permitted student rosters" ON public.students
  FOR SELECT TO authenticated
  USING (public.is_instructor_assigned_to_group(group_id));

COMMIT;
