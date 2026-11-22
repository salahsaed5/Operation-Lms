-- Calendar schedule 0026: teaching days follow selected weekdays, not consecutive dates.
-- Safe for legacy daily Camps: default 0..6 keeps every historical date unchanged.
-- STAGING ONLY until separately approved for Production.
BEGIN;

ALTER TABLE public.camps
  ADD COLUMN operating_weekdays integer[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6];
ALTER TABLE public.camps
  ADD CONSTRAINT chk_camp_weekdays_range
    CHECK (cardinality(operating_weekdays) BETWEEN 1 AND 7
      AND operating_weekdays <@ ARRAY[0,1,2,3,4,5,6]);

-- Postgres extract(dow): Sunday=0, Saturday=6 (same convention as JS UTC).
CREATE FUNCTION public.camp_teaching_date(
  p_start date, p_day integer, p_weekdays integer[]
) RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $calendar$
DECLARE
  v_date date := p_start;
  v_seen integer := 1;
BEGIN
  IF p_start IS NULL OR p_day NOT BETWEEN 1 AND 365
     OR p_weekdays IS NULL OR cardinality(p_weekdays) NOT BETWEEN 1 AND 7
     OR p_weekdays <@ ARRAY[0,1,2,3,4,5,6] IS NOT TRUE
     OR (SELECT count(DISTINCT d) FROM unnest(p_weekdays) d) <> cardinality(p_weekdays)
  THEN RAISE EXCEPTION 'Invalid camp calendar configuration'; END IF;
  IF EXTRACT(DOW FROM p_start)::integer <> ALL (p_weekdays)
  THEN
    RAISE EXCEPTION 'Camp start date must be a selected teaching weekday';
  END IF;
  WHILE v_seen < p_day LOOP
    v_date := v_date + 1;
    IF EXTRACT(DOW FROM v_date)::integer = ANY(p_weekdays)
    THEN v_seen := v_seen + 1; END IF;
  END LOOP;
  RETURN v_date;
END;
$calendar$;

CREATE FUNCTION public.enforce_camp_teaching_calendar()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $validate$
DECLARE
  v_expected date;
BEGIN
  IF NEW.duration_days NOT BETWEEN 1 AND 60 OR
     NEW.current_camp_day NOT BETWEEN 1 AND NEW.duration_days THEN
    RAISE EXCEPTION 'Camp teaching day must be within duration';
  END IF;
  v_expected := public.camp_teaching_date(
    NEW.start_date, NEW.duration_days, NEW.operating_weekdays);
  IF TG_OP = 'UPDATE' AND
    (NEW.start_date IS DISTINCT FROM OLD.start_date OR
     NEW.duration_days IS DISTINCT FROM OLD.duration_days OR
     NEW.operating_weekdays IS DISTINCT FROM OLD.operating_weekdays) AND
    EXISTS (
      SELECT 1 FROM public.lectures l
      WHERE l.camp_id=NEW.id
        AND (l.camp_day > NEW.duration_days
          OR l.lecture_date IS DISTINCT FROM
            public.camp_teaching_date(NEW.start_date,l.camp_day,NEW.operating_weekdays))
    )
  THEN
    RAISE EXCEPTION 'Rescheduling would invalidate existing lecture dates. Reconcile the timetable first';
  END IF;
  -- End date is the date of the LAST actual teaching session, not start + N-1.
  NEW.end_date := v_expected;
  RETURN NEW;
END;
$validate$;

CREATE TRIGGER trg_enforce_camp_teaching_calendar
BEFORE INSERT OR UPDATE OF start_date,duration_days,current_camp_day,operating_weekdays,end_date
ON public.camps
FOR EACH ROW EXECUTE FUNCTION public.enforce_camp_teaching_calendar();

CREATE FUNCTION public.enforce_lecture_teaching_date()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $lecture$
DECLARE
  v_camp public.camps%ROWTYPE;
  v_expected date;
BEGIN
  SELECT * INTO v_camp FROM public.camps WHERE id = NEW.camp_id;
  IF v_camp.id IS NULL THEN RAISE EXCEPTION 'Lecture camp not found'; END IF;
  IF NEW.camp_day NOT BETWEEN 1 AND v_camp.duration_days THEN
    RAISE EXCEPTION 'Lecture day outside the camp teaching duration';
  END IF;
  v_expected := public.camp_teaching_date(
    v_camp.start_date,NEW.camp_day,v_camp.operating_weekdays);
  IF NEW.lecture_date IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Lecture date % does not match teaching Day % (expected %)',
      NEW.lecture_date,NEW.camp_day,v_expected;
  END IF;
  RETURN NEW;
END;
$lecture$;

CREATE TRIGGER trg_enforce_lecture_teaching_date
BEFORE INSERT OR UPDATE OF camp_id,camp_day,lecture_date
ON public.lectures
FOR EACH ROW EXECUTE FUNCTION public.enforce_lecture_teaching_date();

-- Revoke direct execution of internal trigger-only functions.
REVOKE ALL ON FUNCTION public.enforce_camp_teaching_calendar() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.enforce_lecture_teaching_date() FROM PUBLIC,anon,authenticated;

-- The date calculator exposes no private data; needed by invoker triggers.
GRANT EXECUTE ON FUNCTION public.camp_teaching_date(date,integer,integer[]) TO authenticated;

COMMIT;
