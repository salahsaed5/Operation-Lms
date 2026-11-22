-- Staging-only Finance 0023 security checks; no persistent fixtures or payments.
-- Runs as postgres from the protected Staging-only SQL acceptance workflow.
DO $finance$
DECLARE
  v_table text;
  v_rel oid;
  v_own_uid uuid;
  v_cnt integer;
BEGIN
  FOR v_table IN SELECT unnest(ARRAY[
    'camp_finance_rate_policies','camp_backup_sessions','camp_finance_payments'
  ]) LOOP
    SELECT c.oid INTO v_rel FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=v_table AND c.relkind='r'
      AND c.relrowsecurity;
    IF v_rel IS NULL THEN RAISE EXCEPTION 'Finance table % missing or RLS disabled',v_table; END IF;
    SELECT count(*) INTO v_cnt FROM pg_policies
    WHERE schemaname='public' AND tablename=v_table AND cmd='SELECT';
    IF v_cnt<2 THEN RAISE EXCEPTION 'Finance % must have own-only and Admin SELECT policies',v_table; END IF;
    IF has_table_privilege('anon',v_rel,'SELECT') OR
       has_table_privilege('authenticated',v_rel,'INSERT') OR
       has_table_privilege('authenticated',v_rel,'UPDATE') OR
       has_table_privilege('authenticated',v_rel,'DELETE') OR
       has_table_privilege('authenticated',v_rel,'TRUNCATE') THEN
       RAISE EXCEPTION 'Finance % has unsafe direct public or authenticated access',v_table;
    END IF;
  END LOOP;
  IF has_function_privilege('anon','public.finance_set_day_rates(uuid,integer,integer,integer,text)','EXECUTE')
    OR has_function_privilege('anon','public.finance_add_backup_session(uuid,uuid,text)','EXECUTE')
    OR has_function_privilege('anon','public.finance_review_backup_session(uuid,text,text)','EXECUTE')
    OR has_function_privilege('anon','public.finance_record_payment(uuid,uuid,integer,text,text,text)','EXECUTE')
    THEN RAISE EXCEPTION 'Anon EXECUTE permission found on privileged finance RPC'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='camp_backup_sessions'
      AND indexname='uq_backup_instructor_period') THEN
    RAISE EXCEPTION 'Backup cross-lecture same-period uniqueness index missing';
  END IF;
  SELECT profile_id INTO v_own_uid FROM public.instructors LIMIT 1;
  IF v_own_uid IS NULL THEN RAISE EXCEPTION 'Staging instructor required'; END IF;
  BEGIN
    PERFORM set_config('request.jwt.claim.sub',v_own_uid::text,true);
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub',v_own_uid,'role','authenticated','aal','aal1')::text,true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.finance_set_day_rates(NULL,1,150,100,'Unauthorized role test');
      RAISE EXCEPTION 'SECURITY_TEST_FAILED_UNAUTHORIZED_WRITE_SUCCEEDED';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM<>'Admin AAL2 required' THEN RAISE; END IF;
    END;
    BEGIN
      PERFORM public.finance_record_payment(NULL,NULL,200,'cash','','Unauthorized payment test');
      RAISE EXCEPTION 'SECURITY_TEST_FAILED_UNAUTHORIZED_PAYMENT_SUCCEEDED';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM<>'Admin AAL2 required' THEN RAISE; END IF;
    END;
    RAISE EXCEPTION 'ROLLBACK_FINANCE_ROLE_TEST_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'ROLLBACK_FINANCE_ROLE_TEST_OK' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS Finance 0023: RLS, no direct writes, anon RPC denial, Instructor cannot mutate, backup uniqueness';
END $finance$;
