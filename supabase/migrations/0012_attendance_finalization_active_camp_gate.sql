-- 0012: Protect final lecture attendance submission from early/draft camp writes.
--
-- Current submit_attendance_sheet_tx checks authorization, counts, and audit,
-- but does not require an ACTIVE camp or a scheduled lecture date that has
-- arrived. Without this guard, a future draft camp can be finalized via RPC.
--
-- This is a proposed migration. Review and test on Staging before applying.

CREATE OR REPLACE FUNCTION public.enforce_attendance_finalization_window()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_camp_status TEXT;
  v_lecture_date DATE;
  v_today_cairo DATE;
BEGIN
  -- Only the transition INTO "submitted" needs the operational gate.
  -- Allow draft creation/edits and submitted -> locked as part of archiving.
  IF NEW.status::text <> 'submitted' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT c.status::text, l.lecture_date
    INTO v_camp_status, v_lecture_date
  FROM public.lectures l
  JOIN public.camps c ON c.id = l.camp_id
  WHERE l.id = NEW.lecture_id
    AND c.id = NEW.camp_id;

  IF NOT FOUND OR v_lecture_date IS NULL THEN
    RAISE EXCEPTION
      'Attendance submission blocked: a valid dated lecture and matching camp are required.';
  END IF;

  IF v_camp_status <> 'active' THEN
    RAISE EXCEPTION
      'Attendance submission blocked: final attendance can only be submitted for an active camp.';
  END IF;

  v_today_cairo := (now() AT TIME ZONE 'Africa/Cairo')::date;
  IF v_lecture_date > v_today_cairo THEN
    RAISE EXCEPTION
      'Attendance submission blocked: lecture date has not arrived (Cairo local date).';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_attendance_finalization_window() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_zz_attendance_finalization_window ON public.attendance_sheets;
CREATE TRIGGER trg_zz_attendance_finalization_window
BEFORE INSERT OR UPDATE OF status ON public.attendance_sheets
FOR EACH ROW EXECUTE FUNCTION public.enforce_attendance_finalization_window();

COMMENT ON FUNCTION public.enforce_attendance_finalization_window() IS
  'Requires active Camp and scheduled lecture date <= current Cairo day when a sheet transitions to submitted; drafts and archive locks remain unaffected.';
