-- Finance 0024 rollback-only acceptance: no persistent fixtures, no payouts.
-- Run on approved Staging project after applying migration 0024.
DO $acceptance$
DECLARE
  v_camp uuid;
  v_lecture public.lectures%ROWTYPE;
  v_admin uuid;
  v_ent uuid;
  v_backup uuid;
  v_count integer;
BEGIN
  SELECT * INTO v_lecture FROM public.lectures WHERE status <> 'cancelled' LIMIT 1;
  IF v_lecture.id IS NULL THEN RAISE EXCEPTION 'Staging test lecture missing'; END IF;
  v_camp := v_lecture.camp_id;
  SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'Staging test admin missing'; END IF;

  -- Roll back every fixture, including the successful correction, at the end.
  BEGIN
    INSERT INTO public.camp_finance_rate_policies
      (camp_id,effective_from_day,backup_rate_egp,transport_per_day_egp,created_by)
    VALUES (v_camp,1,150,100,v_admin);

    INSERT INTO public.lecture_entitlements
      (camp_id,lecture_id,instructor_id,camp_day,period_number,
       frozen_rate_egp,entitlement_amount_egp,status,eligibility_reason,
       admin_override_by,admin_override_reason)
    VALUES (v_camp,v_lecture.id,v_lecture.instructor_id,
      v_lecture.camp_day,v_lecture.period_number,300,300,'approved',
      'Finance rollback-only acceptance',v_admin,'Test approved lecture')
    RETURNING id INTO v_ent;

    INSERT INTO public.camp_finance_payments
      (camp_id,instructor_id,amount_egp,method,reference,note,created_by)
    VALUES (v_camp,v_lecture.instructor_id,350,'cash','QA-ROLLBACK',
      'Temporary primary entitlement payment',v_admin);

    -- 300 primary + 100 day transportation = 400 due. Excluding the
    -- primary would make due 0 while 350 is already paid: must reject.
    BEGIN
      UPDATE public.lecture_entitlements
        SET status='excluded',admin_override_reason='QA exclusion'
      WHERE id=v_ent;
      RAISE EXCEPTION 'FINANCE_TEST_FAILED_MAIN_EXCLUSION_WAS_ALLOWED';
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM NOT LIKE 'Finance settlement safety:%' THEN RAISE; END IF;
    END;

    SELECT count(*) INTO v_count FROM public.lecture_entitlements
    WHERE id=v_ent AND status='approved';
    IF v_count <> 1 THEN RAISE EXCEPTION 'Failed update changed primary record'; END IF;

    -- After an explicit signed refund, exclusion is possible.
    INSERT INTO public.camp_finance_payments
      (camp_id,instructor_id,amount_egp,method,reference,note,created_by)
    VALUES (v_camp,v_lecture.instructor_id,-350,'cash','QA-ROLLBACK',
      'Temporary primary entitlement refund',v_admin);
    UPDATE public.lecture_entitlements
      SET status='excluded',admin_override_reason='QA corrected exclusion'
    WHERE id=v_ent;

    -- Backup-only case: an approved 150 session cannot be excluded when
    -- its 150 has been paid. No transportation is granted for backup only.
    INSERT INTO public.camp_backup_sessions
      (camp_id,lecture_id,instructor_id,camp_day,period_number,
       frozen_rate_egp,status,reason,created_by)
    VALUES (v_camp,v_lecture.id,v_lecture.instructor_id,
       v_lecture.camp_day,v_lecture.period_number,150,'approved',
       'Temporary rollback-only backup test',v_admin)
    RETURNING id INTO v_backup;
    INSERT INTO public.camp_finance_payments
      (camp_id,instructor_id,amount_egp,method,reference,note,created_by)
    VALUES (v_camp,v_lecture.instructor_id,150,'cash','QA-ROLLBACK',
      'Temporary backup payment',v_admin);
    BEGIN
      UPDATE public.camp_backup_sessions SET status='excluded' WHERE id=v_backup;
      RAISE EXCEPTION 'FINANCE_TEST_FAILED_BACKUP_EXCLUSION_WAS_ALLOWED';
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM NOT LIKE 'Finance settlement safety:%' THEN RAISE; END IF;
    END;

    INSERT INTO public.camp_finance_payments
      (camp_id,instructor_id,amount_egp,method,reference,note,created_by)
    VALUES (v_camp,v_lecture.instructor_id,-150,'cash','QA-ROLLBACK',
      'Temporary backup refund',v_admin);
    UPDATE public.camp_backup_sessions SET status='excluded' WHERE id=v_backup;

    RAISE EXCEPTION 'FINANCE_0024_ROLLBACK_FIXTURES';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'FINANCE_0024_ROLLBACK_FIXTURES' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS Finance 0024: settled main and backup cannot be excluded until refunded; fixtures rolled back';
END $acceptance$;
