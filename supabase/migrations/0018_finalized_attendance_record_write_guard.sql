-- Prevent bypassing post-submission audit through direct DML (especially DELETE).
-- Only existing privileged, audited correction/submit RPCs may mutate finalized rows.
CREATE OR REPLACE FUNCTION public.lock_attendance_parent_for_record_write()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE
  v_id uuid;
  v_status text;
  v_rpc text;
BEGIN
  IF TG_OP='UPDATE' AND OLD.attendance_sheet_id IS DISTINCT FROM NEW.attendance_sheet_id THEN
    RAISE EXCEPTION 'Moving attendance records between sheets is forbidden';
  END IF;

  v_id := CASE WHEN TG_OP='DELETE' THEN OLD.attendance_sheet_id ELSE NEW.attendance_sheet_id END;
  SELECT status::text INTO v_status FROM public.attendance_sheets WHERE id=v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attendance sheet missing'; END IF;

  v_rpc := COALESCE(current_setting('cits.trusted_rpc',true),'');
  IF v_status <> 'draft' AND NOT (
    current_user NOT IN ('anon','authenticated')
    AND v_rpc IN ('submit_attendance_sheet_tx','admin_correct_attendance_tx')
  ) THEN
    RAISE EXCEPTION 'CITS Integrity Violation: Finalized attendance records require an audited trusted RPC.';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
