-- Isolated Finance 0025 lecture-mutation integration acceptance. Every fixture and payment is rolled back.
-- Uses a fresh synthetic Camp and the existing Staging venue and active instructor.
-- The privileged synthetic backup below checks DB settlement guards, not backup RPC eligibility.
BEGIN;
DO $qa$
DECLARE
  v_admin uuid;
  v_inst uuid;
  v_venue uuid;
  v_room uuid;
  v_camp uuid;
  v_group uuid;
  v_l1 uuid;
  v_l2 uuid;
  v_backup uuid;
  v_paid integer;
BEGIN
  SELECT p.id INTO v_admin
  FROM public.profiles p JOIN public.admin_accounts a ON a.profile_id=p.id
  WHERE p.role='admin' AND p.is_active AND NOT p.must_change_password LIMIT 1;
  SELECT i.id INTO v_inst
  FROM public.instructors i JOIN public.profiles p ON p.id=i.profile_id
  WHERE p.is_active LIMIT 1;
  SELECT r.id,r.venue_id INTO v_room,v_venue
  FROM public.rooms r WHERE r.is_active LIMIT 1;
  IF v_admin IS NULL OR v_inst IS NULL OR v_room IS NULL THEN
    RAISE EXCEPTION 'Finance QA requires an active Staging admin, instructor and room';
  END IF;

  INSERT INTO public.camps
    (code,name_en,name_ar,venue_id,start_date,end_date,duration_days,created_by)
  VALUES ('QA-FIN-'||substr(gen_random_uuid()::text,1,8),
    'Rollback Only Finance QA','Rollback Only Finance QA',
    v_venue,current_date,current_date+9,10,v_admin)
  RETURNING id INTO v_camp;
  INSERT INTO public.camp_instructors(camp_id,instructor_id)
  VALUES (v_camp,v_inst);
  INSERT INTO public.groups(camp_id,code,name_en,name_ar,track)
  VALUES(v_camp,'QA-G','Finance QA Group','Finance QA Group','General')
  RETURNING id INTO v_group;
  INSERT INTO public.group_instructors(camp_id,group_id,instructor_id,assigned_by)
  VALUES(v_camp,v_group,v_inst,v_admin);
  INSERT INTO public.lectures
    (camp_id,camp_day,lecture_date,period_number,start_time,end_time,group_id,instructor_id,room_id,topic,frozen_rate_egp)
  VALUES (v_camp,1,current_date,1,'09:00','12:00',v_group,v_inst,v_room,'Finance QA Primary A',300)
  RETURNING id INTO v_l1;
  INSERT INTO public.lectures
    (camp_id,camp_day,lecture_date,period_number,start_time,end_time,group_id,instructor_id,room_id,topic,frozen_rate_egp)
  VALUES(v_camp,1,current_date,2,'13:00','16:00',v_group,v_inst,v_room,'Finance QA Primary B',300)
  RETURNING id INTO v_l2;
  INSERT INTO public.camp_finance_rate_policies
    (camp_id,effective_from_day,backup_rate_egp,transport_per_day_egp,created_by)
  VALUES(v_camp,1,150,100,v_admin);
  INSERT INTO public.lecture_entitlements
    (camp_id,lecture_id,instructor_id,camp_day,period_number,
     frozen_rate_egp,entitlement_amount_egp,status,eligibility_reason,
     admin_override_by,admin_override_reason)
  VALUES
    (v_camp,v_l1,v_inst,1,1,300,300,'approved','Rollback-only finance fixture',v_admin,'Approved for QA'),
    (v_camp,v_l2,v_inst,1,2,300,300,'approved','Rollback-only finance fixture',v_admin,'Approved for QA');

  -- The actual Finance RPC checks the admin's AAL2 claim and recomputes due.
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
  IF NOT public.is_cits_admin() THEN RAISE EXCEPTION 'Admin AAL2 finance fixture failed'; END IF;

  -- Precisely 600 primary + 100 transportation, not 200 transportation.
  PERFORM public.finance_record_payment(v_camp,v_inst,700,'cash','QA-ROLLBACK','Full two-primary daily settlement');
  BEGIN
    UPDATE public.lectures SET status='cancelled' WHERE id=v_l2;
    RAISE EXCEPTION 'QA_FAILED_CANCELLED_PAID_LECTURE';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'Finance lecture safety:%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.lectures
       SET camp_day=2,lecture_date=current_date+1
     WHERE id=v_l2;
    RAISE EXCEPTION 'QA_FAILED_MOVED_PAID_LECTURE';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'Finance lecture safety:%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.finance_record_payment(v_camp,v_inst,1,'cash','QA-ROLLBACK','Overpayment must be blocked');
    RAISE EXCEPTION 'QA_FAILED_OVERPAYMENT_ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'Payment exceeds current confirmed unpaid balance%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.lecture_entitlements SET status='excluded',admin_override_reason='QA unsafe exclusion'
    WHERE lecture_id=v_l2;
    RAISE EXCEPTION 'QA_FAILED_PAID_PRIMARY_EXCLUSION_ALLOWED';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'Finance settlement safety:%' THEN RAISE; END IF;
  END;
  PERFORM public.finance_record_payment(v_camp,v_inst,-300,'cash','QA-ROLLBACK','Refund before exclusion');
  UPDATE public.lecture_entitlements SET status='excluded',admin_override_reason='QA exclusion after refund'
  WHERE lecture_id=v_l2;

  -- Backup trigger safety: superuser synthetic fixture exercises settlement
  -- guard independently of business-rule RPC, which has its own tests.
  INSERT INTO public.camp_backup_sessions
    (camp_id,lecture_id,instructor_id,camp_day,period_number,
     frozen_rate_egp,status,reason,created_by)
  VALUES(v_camp,v_l2,v_inst,1,2,150,'approved','QA rollback-only backup guard',v_admin)
  RETURNING id INTO v_backup;
  PERFORM public.finance_record_payment(v_camp,v_inst,150,'cash','QA-ROLLBACK','Backup settlement safety test');
  BEGIN
    UPDATE public.lectures SET status='cancelled' WHERE id=v_l2;
    RAISE EXCEPTION 'QA_FAILED_CANCELLED_APPROVED_BACKUP';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'Finance lecture safety:%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.camp_backup_sessions SET status='excluded' WHERE id=v_backup;
  -- Once both ledger-backed categories are excluded/refunded, cancellation is safe.
  UPDATE public.lectures SET status='cancelled' WHERE id=v_l2;
  IF NOT EXISTS (SELECT 1 FROM public.lectures WHERE id=v_l2 AND status='cancelled')
    THEN RAISE EXCEPTION 'Finance lecture cancellation remained blocked after reconciliation';
  END IF;
    RAISE EXCEPTION 'QA_FAILED_PAID_BACKUP_EXCLUSION_ALLOWED';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'Finance settlement safety:%' THEN RAISE; END IF;
  END;
  PERFORM public.finance_record_payment(v_camp,v_inst,-150,'cash','QA-ROLLBACK','Refund before backup exclusion');
  UPDATE public.camp_backup_sessions SET status='excluded' WHERE id=v_backup;

  SELECT coalesce(sum(amount_egp),0) INTO v_paid
  FROM public.camp_finance_payments WHERE camp_id=v_camp;
  IF v_paid<>400 THEN RAISE EXCEPTION 'Expected 400 EGP net payments; got %',v_paid; END IF;

  RAISE NOTICE 'PASS finance 0025: paid primary/backup lecture cancellation and reassignment rejected; reconciled cancellation succeeds';
END $qa$;
ROLLBACK;
