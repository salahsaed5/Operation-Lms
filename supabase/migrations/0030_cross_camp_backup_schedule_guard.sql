-- Multi-active 0030: backup-only work counts as an Instructor time reservation.
-- Finance remains historical/immutable; only cross-Camp collisions are added.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_cross_camp_schedule_conflicts()
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

  -- An unscheduled backup Instructor is still physically attending the
  -- host lecture. Confirmed backup work cannot overlap a primary session
  -- in another active/draft Camp on the same calendar date.
  SELECT b.id INTO v_conflict
  FROM public.camp_backup_sessions b
  JOIN public.lectures bl ON bl.id=b.lecture_id
  WHERE b.camp_id <> NEW.camp_id
    AND b.instructor_id = v_effective_instructor
    AND b.status = 'approved'
    AND bl.status <> 'cancelled'
    AND bl.lecture_date = NEW.lecture_date
    AND bl.start_time < NEW.end_time AND bl.end_time > NEW.start_time
  LIMIT 1;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'Cross-Camp schedule conflict: Instructor is approved Backup in session % on date %',
      v_conflict, NEW.lecture_date USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$crosscamp$;

CREATE FUNCTION public.enforce_cross_camp_backup_conflicts()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $backup_guard$
DECLARE
  v_host public.lectures%ROWTYPE;
  v_conflict uuid;
BEGIN
  IF NEW.status <> 'approved' THEN RETURN NEW; END IF;
  SELECT * INTO v_host FROM public.lectures WHERE id=NEW.lecture_id;
  IF v_host.id IS NULL THEN RAISE EXCEPTION 'Backup host lecture not found'; END IF;
  IF v_host.status='cancelled' THEN
    RAISE EXCEPTION 'Cannot approve Backup for cancelled lecture' USING ERRCODE='23514';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    hashtext('cits:crosscamp:instructor'),
    hashtext(NEW.instructor_id::text || ':' || v_host.lecture_date::text)
  );

  SELECT l.id INTO v_conflict
  FROM public.lectures l
  WHERE l.camp_id <> NEW.camp_id
    AND l.lecture_date=v_host.lecture_date
    AND l.status <> 'cancelled'
    AND l.start_time < v_host.end_time AND l.end_time > v_host.start_time
    AND COALESCE(l.substitute_instructor_id,l.instructor_id)=NEW.instructor_id
  LIMIT 1;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'Cross-Camp Backup conflict: Instructor has primary lecture % on date %',
      v_conflict,v_host.lecture_date USING ERRCODE='23514';
  END IF;

  SELECT b.id INTO v_conflict
  FROM public.camp_backup_sessions b
  JOIN public.lectures l ON l.id=b.lecture_id
  WHERE b.id IS DISTINCT FROM NEW.id
    AND b.camp_id <> NEW.camp_id
    AND b.instructor_id=NEW.instructor_id
    AND b.status='approved'
    AND l.status <> 'cancelled'
    AND l.lecture_date=v_host.lecture_date
    AND l.start_time < v_host.end_time AND l.end_time > v_host.start_time
  LIMIT 1;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'Cross-Camp Backup conflict: Instructor has approved Backup session % on date %',
      v_conflict,v_host.lecture_date USING ERRCODE='23514';
  END IF;

  RETURN NEW;
END;
$backup_guard$;

CREATE TRIGGER trg_enforce_cross_camp_backup_conflicts
BEFORE INSERT OR UPDATE OF status,lecture_id,instructor_id,camp_id
ON public.camp_backup_sessions
FOR EACH ROW EXECUTE FUNCTION public.enforce_cross_camp_backup_conflicts();

REVOKE ALL ON FUNCTION public.enforce_cross_camp_backup_conflicts()
  FROM PUBLIC,anon,authenticated;

CREATE INDEX IF NOT EXISTS idx_cross_camp_approved_backup_instructor
  ON public.camp_backup_sessions(instructor_id) WHERE status='approved';

COMMIT;
