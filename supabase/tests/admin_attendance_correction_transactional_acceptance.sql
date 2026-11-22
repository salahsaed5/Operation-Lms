-- Staging-only Admin AAL2 RPC acceptance after migration 0020.
-- Fake JWT claims are used inside DB SQL test, NOT an authenticated browser session.
-- Correction/audit/count updates are rolled back; no persistent records changed.
DO $$
DECLARE
  v_admin uuid;
  v_sheet uuid;
  v_student uuid;
  v_old text;
BEGIN
  SELECT p.id INTO v_admin
  FROM public.profiles p
  JOIN public.admin_accounts a ON a.profile_id=p.id
  WHERE p.role='admin' AND p.is_active AND NOT p.must_change_password
  ORDER BY a.assigned_slot DESC LIMIT 1;

  SELECT sh.id,ar.student_id,ar.mark::text
  INTO v_sheet,v_student,v_old
  FROM public.attendance_sheets sh
  JOIN public.camps c ON c.id=sh.camp_id
  JOIN public.attendance_records ar ON ar.attendance_sheet_id=sh.id
  WHERE c.code='STG-TEST-01' AND sh.status='draft'
  ORDER BY ar.student_id LIMIT 1;

  IF v_admin IS NULL OR v_sheet IS NULL THEN
    RAISE EXCEPTION 'Missing Staging Admin or draft attendance fixture';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub',v_admin,'aal','aal2','role','authenticated')::text,true);
  IF NOT public.is_cits_admin() THEN
    RAISE EXCEPTION 'TEST FAILED: AAL2 Staging Admin not authorized';
  END IF;
  BEGIN
    PERFORM public.admin_correct_attendance_tx(
      v_sheet,v_student,'excused','Rollback-only Admin correction test');
    IF NOT EXISTS (
      SELECT 1 FROM public.attendance_records
      WHERE attendance_sheet_id=v_sheet AND student_id=v_student AND mark='excused'
    ) THEN RAISE EXCEPTION 'TEST FAILED: Admin correction not saved'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.audit_logs
      WHERE entity_id=v_sheet::text||':'||v_student::text
        AND action='ATTENDANCE_ADMIN_CORRECTED'
    ) THEN RAISE EXCEPTION 'TEST FAILED: correction audit missing'; END IF;
    RAISE EXCEPTION 'ROLLBACK_ADMIN_CORRECTION_PASS';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_ADMIN_CORRECTION_PASS' THEN RAISE; END IF;
  END;

  IF (SELECT mark::text FROM public.attendance_records
      WHERE attendance_sheet_id=v_sheet AND student_id=v_student)<>v_old THEN
    RAISE EXCEPTION 'TEST FAILED: Admin correction not rolled back';
  END IF;
  RAISE NOTICE 'PASS AAL2 Admin correction RPC and audited rollback';
END $$;
