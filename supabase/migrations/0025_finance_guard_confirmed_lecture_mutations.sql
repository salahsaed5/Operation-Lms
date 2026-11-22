-- Finance 0025: finalized financial work cannot be invalidated by lecture cancellation
-- or reassignment without first auditing entitlement/backup exclusion and any refund.
-- STAGING FIRST. Do not apply to Production without a separate release authorization.
BEGIN;
CREATE FUNCTION public.finance_guard_confirmed_lecture_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $finance_lecture$
BEGIN
  IF (
       (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
       OR NEW.camp_id IS DISTINCT FROM OLD.camp_id
       OR NEW.camp_day IS DISTINCT FROM OLD.camp_day
       OR NEW.lecture_date IS DISTINCT FROM OLD.lecture_date
       OR NEW.period_number IS DISTINCT FROM OLD.period_number
       OR NEW.instructor_id IS DISTINCT FROM OLD.instructor_id
       OR NEW.substitute_instructor_id IS DISTINCT FROM OLD.substitute_instructor_id
     )
     AND (
       EXISTS (
         SELECT 1 FROM public.lecture_entitlements e
         WHERE e.lecture_id = OLD.id AND e.status IN ('eligible','approved')
       )
       OR EXISTS (
         SELECT 1 FROM public.camp_backup_sessions b
         WHERE b.lecture_id = OLD.id AND b.status = 'approved'
       )
     )
  THEN
    RAISE EXCEPTION 'Finance lecture safety: exclude/reconcile confirmed entitlements and approved backups before cancelling or reassigning a lecture'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$finance_lecture$;
CREATE TRIGGER trg_finance_guard_confirmed_lecture_mutation
BEFORE UPDATE ON public.lectures
FOR EACH ROW EXECUTE FUNCTION public.finance_guard_confirmed_lecture_mutation();
REVOKE ALL ON FUNCTION public.finance_guard_confirmed_lecture_mutation()
  FROM PUBLIC, anon, authenticated;
COMMIT;
