-- Finance 0024: payment-safe entitlement changes.
-- STAGING FIRST. Do not apply to Production without a separate release authorization.
-- A settled account must not become overpaid because approved main/backup work was
-- subsequently excluded, reassigned, or deleted. This covers RPCs and internal writers.
BEGIN;

CREATE FUNCTION public.finance_guard_settled_entitlement_decrease()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $finance_guard$
DECLARE
  v_camp_id uuid;
  v_instructor_id uuid;
  v_primary bigint;
  v_backup bigint;
  v_transport bigint;
  v_paid bigint;
  v_due bigint;
BEGIN
  -- AFTER UPDATE/DELETE: OLD identifies the account that could lose entitlement.
  v_camp_id := OLD.camp_id;
  v_instructor_id := OLD.instructor_id;

  -- Same lock ordering/key pair as finance_record_payment(). The check runs AFTER
  -- the modified row is visible to this transaction, but before it can commit.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_camp_id::text),
    pg_catalog.hashtext(v_instructor_id::text)
  );

  SELECT coalesce(sum(amount_egp), 0) INTO v_paid
  FROM public.camp_finance_payments
  WHERE camp_id = v_camp_id AND instructor_id = v_instructor_id;

  -- No recorded money: normal entitlement changes remain unrestricted.
  IF v_paid <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(sum(entitlement_amount_egp), 0) INTO v_primary
  FROM public.lecture_entitlements
  WHERE camp_id = v_camp_id AND instructor_id = v_instructor_id
    AND status IN ('eligible', 'approved');

  SELECT coalesce(sum(frozen_rate_egp), 0) INTO v_backup
  FROM public.camp_backup_sessions
  WHERE camp_id = v_camp_id AND instructor_id = v_instructor_id
    AND status = 'approved';

  SELECT coalesce(sum(policy.transport_per_day_egp), 0) INTO v_transport
  FROM (
    SELECT DISTINCT camp_day FROM public.lecture_entitlements
    WHERE camp_id = v_camp_id AND instructor_id = v_instructor_id
      AND status IN ('eligible', 'approved')
  ) main_days
  JOIN LATERAL (
    SELECT p.transport_per_day_egp
    FROM public.camp_finance_rate_policies p
    WHERE p.camp_id = v_camp_id
      AND p.effective_from_day <= main_days.camp_day
    ORDER BY p.effective_from_day DESC LIMIT 1
  ) policy ON true;

  v_due := v_primary + v_backup + v_transport;
  IF v_paid > v_due THEN
    RAISE EXCEPTION 'Finance settlement safety: refund excess recorded payments before reducing approved entitlements'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$finance_guard$;

CREATE TRIGGER trg_finance_guard_main_settlement
AFTER UPDATE OR DELETE ON public.lecture_entitlements
FOR EACH ROW EXECUTE FUNCTION public.finance_guard_settled_entitlement_decrease();

CREATE TRIGGER trg_finance_guard_backup_settlement
AFTER UPDATE OR DELETE ON public.camp_backup_sessions
FOR EACH ROW EXECUTE FUNCTION public.finance_guard_settled_entitlement_decrease();

REVOKE ALL ON FUNCTION public.finance_guard_settled_entitlement_decrease()
FROM PUBLIC, anon, authenticated;

COMMIT;
