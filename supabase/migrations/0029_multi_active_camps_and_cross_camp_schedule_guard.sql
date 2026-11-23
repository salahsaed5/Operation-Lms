-- Multi-Camp operations: permit parallel active camps with resource-schedule safety.
-- All existing auth/RLS checks, archived immutability, and selfie purge remain intact.
-- Staging rollout first; do not apply to Production without a separate release authorization.
BEGIN;

-- Stop enforcing the former platform-wide single active Camp limit.
DROP INDEX IF EXISTS public.idx_single_active_camp;

CREATE OR REPLACE FUNCTION public.enforce_camp_lifecycle_rules()
RETURNS trigger LANGUAGE plpgsql
SET search_path = 'public', 'pg_temp'
AS $lifecycle$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CITS Integrity Violation: Operational camps cannot be deleted. Use archive instead.';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'archived' THEN
    RAISE EXCEPTION 'CITS Integrity Violation: Archived camp % is read-only and cannot be modified.', OLD.code;
  END IF;

  -- Each Camp can be activated independently. No global status lock is needed.
  IF TG_OP = 'UPDATE' AND OLD.status <> 'archived' AND NEW.status = 'archived' THEN
    NEW.archived_at := COALESCE(NEW.archived_at, NOW());
    UPDATE public.daily_checkins
    SET selfie_storage_path = NULL, selfie_deleted_after_archive = TRUE
    WHERE camp_id = NEW.id;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$lifecycle$;

-- Avoid silently double-booking the same instructor or physical room in
-- different Camps on the SAME calendar date/time. Period numbers are Camp-local.
CREATE FUNCTION public.enforce_cross_camp_schedule_conflicts()
RETURNS trigger LANGUAGE plpgsql
SECURITY INVOKER SET search_path = ''
AS $crosscamp$
DECLARE
  v_effective_instructor uuid;
  v_conflict uuid;
BEGIN
  IF NEW.status = 'cancelled' THEN RETURN NEW; END IF;

  v_effective_instructor := COALESCE(NEW.substitute_instructor_id, NEW.instructor_id);

  -- Serialize competing schedule writes on the same date/resource, so two
  -- simultaneous requests cannot both pass a read-before-write check.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    hashtext('cits:crosscamp:instructor'),
    hashtext(v_effective_instructor::text || ':' || NEW.lecture_date::text)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    hashtext('cits:crosscamp:room'),
    hashtext(NEW.room_id::text || ':' || NEW.lecture_date::text)
  );

  SELECT l.id INTO v_conflict
  FROM public.lectures l
  WHERE l.id IS DISTINCT FROM NEW.id
    AND l.camp_id <> NEW.camp_id
    AND l.lecture_date = NEW.lecture_date
    AND l.status <> 'cancelled'
    AND l.start_time < NEW.end_time AND l.end_time > NEW.start_time
    AND COALESCE(l.substitute_instructor_id,l.instructor_id) = v_effective_instructor
  LIMIT 1;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'Cross-Camp schedule conflict: Instructor already has lecture % on date %',
      v_conflict, NEW.lecture_date USING ERRCODE='23514';
  END IF;

  SELECT l.id INTO v_conflict
  FROM public.lectures l
  WHERE l.id IS DISTINCT FROM NEW.id
    AND l.camp_id <> NEW.camp_id
    AND l.lecture_date = NEW.lecture_date
    AND l.status <> 'cancelled'
    AND l.start_time < NEW.end_time AND l.end_time > NEW.start_time
    AND l.room_id = NEW.room_id
  LIMIT 1;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'Cross-Camp schedule conflict: Room already occupied by lecture % on date %',
      v_conflict, NEW.lecture_date USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$crosscamp$;

CREATE TRIGGER trg_enforce_cross_camp_schedule_conflicts
BEFORE INSERT OR UPDATE OF camp_id,lecture_date,start_time,end_time,instructor_id,
  substitute_instructor_id,room_id,status ON public.lectures
FOR EACH ROW EXECUTE FUNCTION public.enforce_cross_camp_schedule_conflicts();

-- Backup-only Instructors can be assigned without having their own lectures
-- or groups. Their Camp list must still be scoped to their own backup work.
CREATE OR REPLACE FUNCTION public.is_instructor_assigned_to_camp(p_camp_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $assigned$
  SELECT public.current_instructor_id() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.camp_instructors ci
      WHERE ci.camp_id=p_camp_id
        AND ci.instructor_id=public.current_instructor_id()
        AND ci.is_active=true
    ) OR EXISTS (
      SELECT 1 FROM public.lectures l
      WHERE l.camp_id=p_camp_id
        AND (l.instructor_id=public.current_instructor_id()
          OR l.substitute_instructor_id=public.current_instructor_id())
    ) OR EXISTS (
      SELECT 1 FROM public.camp_backup_sessions b
      WHERE b.camp_id=p_camp_id
        AND b.instructor_id=public.current_instructor_id()
    )
  );
$assigned$;
REVOKE ALL ON FUNCTION public.is_instructor_assigned_to_camp(uuid)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_instructor_assigned_to_camp(uuid)
 TO authenticated;

-- Internal trigger helper, not a callable public RPC.
REVOKE ALL ON FUNCTION public.enforce_cross_camp_schedule_conflicts()
  FROM PUBLIC,anon,authenticated;

COMMIT;
