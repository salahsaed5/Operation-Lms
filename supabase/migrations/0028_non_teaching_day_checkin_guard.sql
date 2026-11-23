-- 0028: non-daily Camp check-ins cannot be submitted on calendar off-days.
-- Legacy daily Camps are unaffected. No permanent test data or Production changes.
BEGIN;

CREATE FUNCTION public.reject_non_teaching_day_checkin()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $guard$
DECLARE
  v_camp public.camps%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  v_expected date;
BEGIN
  SELECT * INTO v_camp FROM public.camps WHERE id=NEW.camp_id;
  IF v_camp.id IS NULL THEN RAISE EXCEPTION 'Check-in Camp is not accessible'; END IF;
  IF cardinality(v_camp.operating_weekdays) < 7 THEN
    v_expected := public.camp_teaching_date(
      v_camp.start_date,v_camp.current_camp_day,v_camp.operating_weekdays);
    IF v_expected IS DISTINCT FROM v_today
       OR NEW.checkin_date IS DISTINCT FROM v_today
       OR NEW.camp_day IS DISTINCT FROM v_camp.current_camp_day THEN
      RAISE EXCEPTION 'Check-in is allowed only on the current scheduled teaching date'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;

-- The existing security trigger sets official date/day for direct Instructor
-- writes; RPC inserts are already server stamped. Run this AFTER it by name.
CREATE TRIGGER trg_z_reject_non_teaching_day_checkin
BEFORE INSERT ON public.daily_checkins
FOR EACH ROW EXECUTE FUNCTION public.reject_non_teaching_day_checkin();

REVOKE ALL ON FUNCTION public.reject_non_teaching_day_checkin()
  FROM PUBLIC,anon,authenticated;
COMMIT;
