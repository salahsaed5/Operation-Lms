BEGIN;
-- Password-only sign-in permitted for active provisioned admins; retain all other checks.
CREATE OR REPLACE FUNCTION public.admin_correct_attendance_tx(p_sheet_id uuid, p_student_id uuid, p_mark attendance_mark, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sheet RECORD;
  v_lecture RECORD;
  v_prev_record RECORD;
  v_origin_group_id UUID;
  v_clean_note TEXT;
  v_present_count INTEGER := 0;
  v_absent_count INTEGER := 0;
  v_cross_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR is_cits_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'CITS Security Violation: Only a authorized Admin can perform post-submission attendance corrections.';
  END IF;

  IF p_mark IS NULL THEN RAISE EXCEPTION 'Attendance mark is required'; END IF;
  v_clean_note := TRIM(COALESCE(p_note, ''));
  IF v_clean_note = '' THEN
    RAISE EXCEPTION 'CITS Audit Violation: A non-empty audit reason is required to correct student attendance.';
  END IF;

  SELECT * INTO v_sheet FROM public.attendance_sheets WHERE id = p_sheet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance sheet % not found.', p_sheet_id;
  END IF;

  PERFORM assert_camp_not_archived(v_sheet.camp_id);

  SELECT * INTO v_lecture FROM public.lectures WHERE id = v_sheet.lecture_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lecture % not found.', v_sheet.lecture_id;
  END IF;

  v_origin_group_id := resolve_student_group_for_day(v_sheet.camp_id, p_student_id, v_lecture.camp_day);
  IF v_origin_group_id IS NULL THEN
    RAISE EXCEPTION 'CITS Attendance Error: Student % does not belong to camp %.', p_student_id, v_sheet.camp_id;
  END IF;

  SELECT mark, note INTO v_prev_record
  FROM public.attendance_records
  WHERE attendance_sheet_id = v_sheet.id
    AND student_id = p_student_id;

  PERFORM set_config('cits.trusted_rpc', 'admin_correct_attendance_tx', true);

  -- UPDATE existing rows, preserving their primary key. An INSERT ... ON CONFLICT
  -- would run BEFORE INSERT triggers with a fresh id and falsely detect itself
  -- as duplicate present/late attendance.
  IF v_prev_record.mark IS NOT NULL THEN
    UPDATE public.attendance_records
    SET mark = p_mark, note = v_clean_note, updated_by = auth.uid(), updated_at = NOW()
    WHERE attendance_sheet_id = v_sheet.id AND student_id = p_student_id;
  ELSE
    INSERT INTO public.attendance_records (
      camp_id,
      attendance_sheet_id,
      lecture_id,
      camp_day,
      period_number,
      student_id,
      origin_group_id,
      attended_group_id,
      is_cross_group,
      mark,
      note,
      updated_by
    ) VALUES (
      v_sheet.camp_id,
      v_sheet.id,
      v_lecture.id,
      v_lecture.camp_day,
      v_lecture.period_number,
      p_student_id,
      v_origin_group_id,
      v_lecture.group_id,
      (v_origin_group_id IS DISTINCT FROM v_lecture.group_id),
      p_mark,
      v_clean_note,
      auth.uid()
    );
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE mark IN ('present', 'late')),
    COUNT(*) FILTER (WHERE mark = 'absent'),
    COUNT(*) FILTER (WHERE is_cross_group = TRUE AND mark IN ('present', 'late'))
  INTO v_present_count, v_absent_count, v_cross_count
  FROM public.attendance_records
  WHERE attendance_sheet_id = v_sheet.id;

  UPDATE public.attendance_sheets
  SET present_count = v_present_count,
      absent_count = v_absent_count,
      cross_group_count = v_cross_count,
      updated_at = NOW()
  WHERE id = v_sheet.id;

  PERFORM append_audit_log_internal(
    v_sheet.camp_id,
    'ATTENDANCE_ADMIN_CORRECTED',
    'attendance_records',
    format('%s:%s', v_sheet.id, p_student_id),
    jsonb_build_object(
      'previous_mark', v_prev_record.mark,
      'previous_note', v_prev_record.note,
      'sheet_status', v_sheet.status
    ),
    jsonb_build_object(
      'new_mark', p_mark,
      'present_count', v_present_count,
      'absent_count', v_absent_count,
      'cross_group_count', v_cross_count
    ),
    v_clean_note
  );

  PERFORM set_config('cits.trusted_rpc', '', true);

  RETURN jsonb_build_object(
    'sheet_id', v_sheet.id,
    'student_id', p_student_id,
    'mark', p_mark,
    'present_count', v_present_count,
    'absent_count', v_absent_count,
    'cross_group_count', v_cross_count
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.complete_password_change_tx()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid UUID;
  v_role user_role;
  v_prev_required BOOLEAN;
  v_current_enc TEXT;
  v_current_fingerprint TEXT;
  v_baseline_fingerprint TEXT;
  v_last_completed_fingerprint TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR NOT is_active_cits_user() THEN
    RAISE EXCEPTION 'CITS Authorization Denied: Active authenticated account required.';
  END IF;

  SELECT role, must_change_password
  INTO v_role, v_prev_required
  FROM public.profiles
  WHERE id = v_uid
    AND is_active = TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CITS Authorization Denied: Active profile not found.';
  END IF;

  IF v_role = 'admin' AND (COALESCE(auth.jwt() ->> 'aal', '') NOT IN ('aal1','aal2') OR NOT EXISTS (SELECT 1 FROM public.admin_accounts a WHERE a.profile_id=v_uid AND a.assigned_slot IN (1,2))) THEN
    RAISE EXCEPTION 'Active authenticated admin account required.';
  END IF;

  SELECT COALESCE(u.encrypted_password, '')
  INTO v_current_enc
  FROM auth.users u
  WHERE u.id = v_uid;

  IF char_length(COALESCE(v_current_enc, '')) < 20 THEN
    RAISE EXCEPTION 'CITS Security Violation: Auth credential is not set. Update your password in Auth before completing onboarding.';
  END IF;

  v_current_fingerprint := encode(sha256(convert_to(v_current_enc, 'UTF8')), 'hex');

  SELECT b.baseline_auth_fingerprint, b.last_completed_auth_fingerprint
  INTO v_baseline_fingerprint, v_last_completed_fingerprint
  FROM cits_internal.credential_rotation_baselines b
  WHERE b.profile_id = v_uid
  FOR UPDATE;

  IF COALESCE(v_prev_required, TRUE) = TRUE THEN
    IF v_baseline_fingerprint IS NULL OR v_current_fingerprint = v_baseline_fingerprint THEN
      RAISE EXCEPTION 'CITS Security Violation: Credential rotation not verified in Auth. Update your password before completing mandatory onboarding.';
    END IF;

    UPDATE public.profiles
    SET must_change_password = FALSE,
        updated_at = NOW()
    WHERE id = v_uid
      AND is_active = TRUE;

    UPDATE cits_internal.credential_rotation_baselines
    SET last_completed_auth_fingerprint = v_current_fingerprint,
        last_completed_at = NOW()
    WHERE profile_id = v_uid;

    PERFORM append_audit_log_internal(
      NULL,
      'PASSWORD_CHANGE_COMPLETED',
      'profiles',
      v_uid::text,
      jsonb_build_object('initial_credential_rotation_required', TRUE),
      jsonb_build_object('initial_credential_rotation_required', FALSE),
      'User completed mandatory initial credential rotation verified against Auth state'
    );

    RETURN jsonb_build_object(
      'ok', TRUE,
      'profile_id', v_uid,
      'must_change_password', FALSE,
      'already_completed', FALSE
    );
  END IF;

  -- Already must_change_password = FALSE: check whether a real recovery rotation occurred
  IF v_last_completed_fingerprint IS DISTINCT FROM v_current_fingerprint THEN
    INSERT INTO cits_internal.credential_rotation_baselines
    VALUES (v_uid, v_current_fingerprint, v_current_fingerprint, NOW(), NOW())
    ON CONFLICT (profile_id) DO UPDATE
    SET last_completed_auth_fingerprint = EXCLUDED.last_completed_auth_fingerprint,
        last_completed_at = NOW();

    PERFORM append_audit_log_internal(
      NULL,
      'PASSWORD_CHANGE_COMPLETED',
      'profiles',
      v_uid::text,
      jsonb_build_object('initial_credential_rotation_required', FALSE),
      jsonb_build_object('initial_credential_rotation_required', FALSE),
      'User completed account credential recovery rotation verified against Auth state'
    );

    RETURN jsonb_build_object(
      'ok', TRUE,
      'profile_id', v_uid,
      'must_change_password', FALSE,
      'already_completed', FALSE
    );
  END IF;

  -- Idempotent no-op for repeated completion calls without a new Auth change
  RETURN jsonb_build_object(
    'ok', TRUE,
    'profile_id', v_uid,
    'must_change_password', FALSE,
    'already_completed', TRUE
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.finance_add_backup_session(p_lecture_id uuid, p_instructor_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_lec public.lectures%ROWTYPE; v_rate integer; v_id uuid;
BEGIN
  IF NOT public.is_cits_admin()
    THEN RAISE EXCEPTION 'Active admin required'; END IF;
  IF length(trim(coalesce(p_reason,''))) < 3
    THEN RAISE EXCEPTION 'Reason for backup attendance required'; END IF;
  SELECT * INTO v_lec FROM public.lectures WHERE id = p_lecture_id AND status <> 'cancelled';
  IF v_lec.id IS NULL THEN RAISE EXCEPTION 'Lecture is missing or cancelled'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.camps WHERE id=v_lec.camp_id AND status <> 'archived')
    THEN RAISE EXCEPTION 'New backup records are locked after Camp archive'; END IF;
  IF p_instructor_id IS NULL OR p_instructor_id IN (v_lec.instructor_id,v_lec.substitute_instructor_id)
    THEN RAISE EXCEPTION 'Backup must be a different instructor from primary/substitute'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.camp_instructors ci
    JOIN public.instructors i ON i.id = ci.instructor_id
    JOIN public.profiles p ON p.id=i.profile_id
    WHERE ci.camp_id=v_lec.camp_id AND ci.instructor_id=p_instructor_id
      AND ci.is_active AND p.is_active
  ) THEN RAISE EXCEPTION 'Backup instructor must be an active Camp instructor'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.lectures l WHERE l.camp_id=v_lec.camp_id
      AND l.camp_day=v_lec.camp_day AND l.period_number=v_lec.period_number
      AND l.status <> 'cancelled' AND l.id<>v_lec.id
      AND coalesce(l.substitute_instructor_id,l.instructor_id)=p_instructor_id
  ) THEN RAISE EXCEPTION 'Backup instructor has another primary lecture in this period'; END IF;
  SELECT backup_rate_egp INTO v_rate FROM public.camp_finance_rate_policies
    WHERE camp_id=v_lec.camp_id AND effective_from_day<=v_lec.camp_day
    ORDER BY effective_from_day DESC LIMIT 1;
  IF v_rate IS NULL THEN RAISE EXCEPTION 'Set finance rates before registering a backup'; END IF;
  INSERT INTO public.camp_backup_sessions
    (camp_id,lecture_id,instructor_id,camp_day,period_number,frozen_rate_egp,reason,created_by)
  VALUES (v_lec.camp_id,v_lec.id,p_instructor_id,v_lec.camp_day,v_lec.period_number,v_rate,trim(p_reason),auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.append_audit_log_internal(v_lec.camp_id,'FINANCE_BACKUP_RECORDED',
    'camp_backup_sessions',v_id::text,NULL,
    jsonb_build_object('lecture_id',v_lec.id,'backup_instructor_id',p_instructor_id,'frozen_rate_egp',v_rate),
    trim(p_reason));
  RETURN v_id;
END; $function$
;

CREATE OR REPLACE FUNCTION public.finance_record_payment(p_camp_id uuid, p_instructor_id uuid, p_amount_egp integer, p_method text, p_reference text, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_primary bigint;v_backup bigint;v_transport bigint;v_paid bigint;v_due bigint;v_id uuid;
BEGIN
  IF NOT public.is_cits_admin()
    THEN RAISE EXCEPTION 'Active admin required'; END IF;
  IF p_amount_egp IS NULL OR p_amount_egp=0 OR abs(p_amount_egp)>10000000
     OR p_method NOT IN ('cash','bank_transfer','instapay','wallet','other')
     OR length(trim(coalesce(p_note,'')))<3
    THEN RAISE EXCEPTION 'Invalid payment, method or reason'; END IF;
  -- Historical settlements are payable even after a Camp is Archived.
  -- This function NEVER changes an archived attendance/entitlement record.
  IF NOT EXISTS (SELECT 1 FROM public.camps WHERE id=p_camp_id)
     OR NOT EXISTS (SELECT 1 FROM public.instructors WHERE id=p_instructor_id)
    THEN RAISE EXCEPTION 'Camp or instructor not found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_camp_id::text),hashtext(p_instructor_id::text));
  SELECT coalesce(sum(entitlement_amount_egp),0) INTO v_primary
    FROM public.lecture_entitlements
    WHERE camp_id=p_camp_id AND instructor_id=p_instructor_id
      AND status IN ('eligible','approved');
  SELECT coalesce(sum(frozen_rate_egp),0) INTO v_backup
    FROM public.camp_backup_sessions
    WHERE camp_id=p_camp_id AND instructor_id=p_instructor_id AND status='approved';
  SELECT coalesce(sum(pol.transport_per_day_egp),0) INTO v_transport FROM (
    SELECT DISTINCT camp_day FROM public.lecture_entitlements
     WHERE camp_id=p_camp_id AND instructor_id=p_instructor_id
       AND status IN ('eligible','approved')
  ) primary_days
  JOIN LATERAL (
    SELECT p.transport_per_day_egp FROM public.camp_finance_rate_policies p
    WHERE p.camp_id=p_camp_id AND p.effective_from_day<=primary_days.camp_day
    ORDER BY p.effective_from_day DESC LIMIT 1
  ) pol ON true;
  SELECT coalesce(sum(amount_egp),0) INTO v_paid
    FROM public.camp_finance_payments WHERE camp_id=p_camp_id AND instructor_id=p_instructor_id;
  -- Never post a financial settlement without an explicit Camp rate policy.
  IF NOT EXISTS (SELECT 1 FROM public.camp_finance_rate_policies WHERE camp_id=p_camp_id)
    THEN RAISE EXCEPTION 'Configure and review Camp finance rates before posting payments'; END IF;
  v_due:=v_primary+v_backup+v_transport;
  IF p_amount_egp>0 AND p_amount_egp>v_due-v_paid
    THEN RAISE EXCEPTION 'Payment exceeds current confirmed unpaid balance'; END IF;
  IF p_amount_egp<0 AND abs(p_amount_egp)>v_paid
    THEN RAISE EXCEPTION 'Refund exceeds recorded payments'; END IF;
  INSERT INTO public.camp_finance_payments
    (camp_id,instructor_id,amount_egp,method,reference,note,created_by)
  VALUES (p_camp_id,p_instructor_id,p_amount_egp,p_method,coalesce(trim(p_reference),''),trim(p_note),auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.append_audit_log_internal(p_camp_id,
    CASE WHEN p_amount_egp>0 THEN 'FINANCE_PAYMENT_POSTED' ELSE 'FINANCE_REFUND_POSTED' END,
    'camp_finance_payments',v_id::text,NULL,
    jsonb_build_object('instructor_id',p_instructor_id,'amount_egp',p_amount_egp,
      'method',p_method,'reference',coalesce(trim(p_reference),'')),trim(p_note));
  RETURN v_id;
END; $function$
;

CREATE OR REPLACE FUNCTION public.finance_review_backup_session(p_backup_id uuid, p_decision text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_row public.camp_backup_sessions%ROWTYPE; v_lecture_status text; v_sheet_status text;
BEGIN
  IF NOT public.is_cits_admin()
    THEN RAISE EXCEPTION 'Active admin required'; END IF;
  IF p_decision NOT IN ('approved','excluded') OR length(trim(coalesce(p_reason,''))) < 3
    THEN RAISE EXCEPTION 'Valid decision and reason required'; END IF;
  SELECT * INTO v_row FROM public.camp_backup_sessions WHERE id=p_backup_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Backup record not found'; END IF;
  SELECT status::text INTO v_lecture_status FROM public.lectures WHERE id=v_row.lecture_id;
  IF v_lecture_status = 'cancelled' AND p_decision='approved' THEN
    RAISE EXCEPTION 'Cannot pay backup for a cancelled lecture'; END IF;
  IF p_decision='approved' THEN
    -- Re-check concurrent primary and already registered backup assignments.
    IF EXISTS (
      SELECT 1 FROM public.lectures l
      WHERE l.camp_id=v_row.camp_id AND l.camp_day=v_row.camp_day
        AND l.period_number=v_row.period_number AND l.status <> 'cancelled'
        AND coalesce(l.substitute_instructor_id,l.instructor_id)=v_row.instructor_id
    ) THEN
      RAISE EXCEPTION 'Cannot approve backup: instructor has a primary lecture in this period';
    END IF;
    SELECT status::text INTO v_sheet_status FROM public.attendance_sheets WHERE lecture_id=v_row.lecture_id;
    IF v_sheet_status IS NULL OR v_sheet_status NOT IN ('submitted','locked') THEN
      RAISE EXCEPTION 'Finalize the lecture attendance before approving backup'; END IF;
  END IF;
  UPDATE public.camp_backup_sessions
    SET status=p_decision,reviewed_at=now()
    WHERE id=p_backup_id;
  PERFORM public.append_audit_log_internal(v_row.camp_id,'FINANCE_BACKUP_REVIEWED',
    'camp_backup_sessions',p_backup_id::text,
    jsonb_build_object('status',v_row.status),
    jsonb_build_object('status',p_decision,'instructor_id',v_row.instructor_id,
      'frozen_rate_egp',v_row.frozen_rate_egp),trim(p_reason));
END; $function$
;

CREATE OR REPLACE FUNCTION public.finance_set_day_rates(p_camp_id uuid, p_effective_from_day integer, p_backup_rate integer, p_transport_per_day integer, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_id uuid; v_current_day integer; v_has_policy boolean;
BEGIN
  IF NOT public.is_cits_admin()
    THEN RAISE EXCEPTION 'Active admin required'; END IF;
  IF length(trim(coalesce(p_reason,''))) < 3
    THEN RAISE EXCEPTION 'A reason is required'; END IF;
  IF p_backup_rate NOT BETWEEN 0 AND 1000000 OR p_transport_per_day NOT BETWEEN 0 AND 1000000
    THEN RAISE EXCEPTION 'Invalid EGP rate'; END IF;
  SELECT current_camp_day INTO v_current_day FROM public.camps WHERE id = p_camp_id AND status <> 'archived';
  IF v_current_day IS NULL THEN RAISE EXCEPTION 'Camp not found or archived'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.camp_finance_rate_policies WHERE camp_id = p_camp_id) INTO v_has_policy;
  IF p_effective_from_day NOT BETWEEN 1 AND 365 OR
      (v_has_policy AND p_effective_from_day <= v_current_day) OR
      (NOT v_has_policy AND p_effective_from_day <> 1)
    THEN RAISE EXCEPTION 'Initial finance policy must start Day 1; subsequent changes must be future-dated'; END IF;
  INSERT INTO public.camp_finance_rate_policies
    (camp_id,effective_from_day,backup_rate_egp,transport_per_day_egp,created_by)
  VALUES (p_camp_id,p_effective_from_day,p_backup_rate,p_transport_per_day,auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.append_audit_log_internal(p_camp_id,'FINANCE_RATE_POLICY_CREATED',
     'camp_finance_rate_policies',v_id::text,NULL,
     jsonb_build_object('effective_from_day',p_effective_from_day,
       'backup_rate_egp',p_backup_rate,'transport_per_day_egp',p_transport_per_day),
     trim(p_reason));
  RETURN v_id;
END; $function$
;

CREATE OR REPLACE FUNCTION public.is_cits_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.admin_accounts a ON a.profile_id = p.id
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
      AND p.is_active = TRUE
      AND p.must_change_password = FALSE
      AND COALESCE(auth.jwt() ->> 'aal', '') IN ('aal1','aal2')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.revise_fixed_group_schedule_tx(p_camp_id uuid, p_group_id uuid, p_instructor_id uuid, p_room_id uuid, p_period integer, p_remove boolean, p_reason text, p_expected_period integer, p_expected_room uuid, p_expected_instructor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE c public.camps%ROWTYPE; g public.groups%ROWTYPE; gi public.group_instructors%ROWTYPE;
 s public.camp_settings%ROWTYPE; l public.lectures%ROWTYPE; sh public.attendance_sheets%ROWTYPE;
 d integer; first_day integer; dt date; slot jsonb; st time; et time; rate integer;
 changed integer:=0; lid uuid; n integer; actor_name text; initial_assignment boolean; reason_text text;
BEGIN
 IF auth.uid() IS NULL OR public.is_cits_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Verified admin required' USING ERRCODE='42501'; END IF;
 IF p_remove IS NULL OR (p_remove AND length(btrim(coalesce(p_reason,'')))<3) THEN RAISE EXCEPTION 'Removal reason required'; END IF;
 SELECT * INTO c FROM public.camps WHERE id=p_camp_id FOR UPDATE;
 IF NOT FOUND OR c.status NOT IN ('draft','active') THEN RAISE EXCEPTION 'Camp is not editable'; END IF;
 SELECT * INTO g FROM public.groups WHERE id=p_group_id AND camp_id=c.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Group not found'; END IF;
 SELECT count(*) INTO n FROM public.group_instructors WHERE group_id=g.id AND camp_id=c.id AND effective_to_day IS NULL;
 IF n>1 THEN RAISE EXCEPTION 'Multiple current instructors; reconcile before revising'; END IF;
 SELECT * INTO gi FROM public.group_instructors WHERE group_id=g.id AND camp_id=c.id AND effective_to_day IS NULL FOR UPDATE;
 IF (g.fixed_period_number,g.default_room_id,gi.instructor_id) IS DISTINCT FROM (p_expected_period,p_expected_room,p_expected_instructor) THEN RAISE EXCEPTION 'Assignment changed; refresh before retrying'; END IF;
 SELECT * INTO s FROM public.camp_settings WHERE camp_id=c.id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Camp settings missing'; END IF;
 initial_assignment:=g.fixed_period_number IS NULL AND NOT p_remove;
 reason_text:=coalesce(nullif(btrim(p_reason),''),CASE WHEN initial_assignment THEN 'Initial fixed assignment' ELSE 'Fixed assignment updated' END);
 IF NOT p_remove THEN
  SELECT v INTO slot FROM jsonb_array_elements(s.period_slots) v WHERE (v->>'period')::integer=p_period;
  IF slot IS NULL OR p_period NOT BETWEEN 1 AND 8 THEN RAISE EXCEPTION 'Invalid period'; END IF;
  st:=(slot->>'start')::time; et:=(slot->>'end')::time;
  IF st IS NULL OR et IS NULL OR et<=st THEN RAISE EXCEPTION 'Invalid times'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.rooms r WHERE r.id=p_room_id AND r.venue_id=c.venue_id AND r.is_active) THEN RAISE EXCEPTION 'Invalid room'; END IF;
  SELECT i.default_lecture_rate_egp INTO rate FROM public.instructors i JOIN public.profiles p ON p.id=i.profile_id JOIN public.camp_instructors ci ON ci.instructor_id=i.id AND ci.camp_id=c.id AND ci.is_active WHERE i.id=p_instructor_id AND i.archived_at IS NULL AND p.is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid instructor'; END IF;
 END IF;
 first_day:=CASE WHEN c.status='draft' THEN 1 WHEN initial_assignment THEN c.current_camp_day ELSE c.current_camp_day+1 END;
 -- Initial assignments can include today, but never overwrite a started or elapsed session.
 WHILE first_day<=c.duration_days AND c.status='active' AND (
  public.camp_teaching_date(c.start_date,first_day,c.operating_weekdays)<(clock_timestamp() AT TIME ZONE 'Africa/Cairo')::date
  OR (public.camp_teaching_date(c.start_date,first_day,c.operating_weekdays)=(clock_timestamp() AT TIME ZONE 'Africa/Cairo')::date AND
   (NOT initial_assignment OR (public.camp_teaching_date(c.start_date,first_day,c.operating_weekdays)+st) AT TIME ZONE 'Africa/Cairo'<=clock_timestamp()
    OR EXISTS(SELECT 1 FROM public.lectures x WHERE x.camp_id=c.id AND x.group_id=g.id AND x.camp_day=first_day AND x.status<>'cancelled' AND ((x.lecture_date+x.start_time) AT TIME ZONE 'Africa/Cairo'<=clock_timestamp() OR x.status<>'scheduled' OR EXISTS(SELECT 1 FROM public.lecture_session_runs z WHERE z.lecture_id=x.id) OR EXISTS(SELECT 1 FROM public.attendance_records z WHERE z.lecture_id=x.id)))))
 ) LOOP first_day:=first_day+1; END LOOP;
 IF first_day>c.duration_days THEN RAISE EXCEPTION 'No remaining teaching days'; END IF;
 FOR d IN first_day..c.duration_days LOOP
  dt:=public.camp_teaching_date(c.start_date,d,c.operating_weekdays);
  -- Lock sheet before lecture, consistent with attendance finalization.
  PERFORM 1 FROM public.attendance_sheets a JOIN public.lectures x ON x.id=a.lecture_id WHERE x.camp_id=c.id AND x.group_id=g.id AND x.camp_day=d AND x.status<>'cancelled' ORDER BY a.id FOR UPDATE OF a;
  SELECT count(*) INTO n FROM public.lectures x WHERE x.camp_id=c.id AND x.group_id=g.id AND x.camp_day=d AND x.status<>'cancelled';
  IF n>1 THEN RAISE EXCEPTION 'Day % has multiple sessions; reconcile manually first',d; END IF;
  SELECT * INTO l FROM public.lectures x WHERE x.camp_id=c.id AND x.group_id=g.id AND x.camp_day=d AND x.status<>'cancelled' FOR UPDATE;
  IF FOUND THEN
   SELECT * INTO sh FROM public.attendance_sheets WHERE lecture_id=l.id FOR UPDATE;
   IF initial_assignment AND FOUND AND l.status='scheduled' AND l.substitute_instructor_id IS NULL AND l.period_number=p_period AND l.room_id=p_room_id AND l.instructor_id=p_instructor_id AND l.start_time=st AND l.end_time=et AND sh.instructor_id=p_instructor_id THEN
    changed:=changed+1; CONTINUE;
   END IF;
   IF NOT FOUND OR sh.status<>'draft' OR sh.submitted_at IS NOT NULL OR l.status<>'scheduled' OR l.substitute_instructor_id IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.attendance_records a WHERE a.lecture_id=l.id)
    OR EXISTS(SELECT 1 FROM public.lecture_session_runs a WHERE a.lecture_id=l.id)
    OR EXISTS(SELECT 1 FROM public.lecture_entitlements a WHERE a.lecture_id=l.id)
    OR EXISTS(SELECT 1 FROM public.camp_backup_sessions a WHERE a.lecture_id=l.id AND a.status<>'excluded')
   THEN RAISE EXCEPTION 'Day % has attendance, finance, backup or a daily exception; reconcile before revising',d; END IF;
   IF g.fixed_period_number IS NOT NULL AND (l.period_number,l.room_id,l.instructor_id) IS DISTINCT FROM (g.fixed_period_number,g.default_room_id,gi.instructor_id) THEN RAISE EXCEPTION 'Day % differs from the fixed assignment; reconcile exception first',d; END IF;
   IF p_remove THEN
    UPDATE public.lectures SET status='cancelled',revision_number=revision_number+1,instructor_acknowledged_at=NULL WHERE id=l.id;
    changed:=changed+1; CONTINUE;
   END IF;
  ELSE
   IF p_remove THEN CONTINUE; END IF;
   -- Existing cancelled days are preserved unless explicitly reassigning a removed group.
   IF g.fixed_period_number IS NOT NULL AND EXISTS(SELECT 1 FROM public.lectures x WHERE x.camp_id=c.id AND x.group_id=g.id AND x.camp_day=d AND x.status='cancelled') THEN CONTINUE; END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('cits:crosscamp:instructor'),hashtext(p_instructor_id::text||':'||dt::text));
  PERFORM pg_advisory_xact_lock(hashtext('cits:crosscamp:room'),hashtext(p_room_id::text||':'||dt::text));
  IF EXISTS(SELECT 1 FROM public.lectures x WHERE x.id IS DISTINCT FROM l.id AND x.lecture_date=dt AND x.status<>'cancelled' AND x.start_time<et AND x.end_time>st AND (coalesce(x.substitute_instructor_id,x.instructor_id)=p_instructor_id OR x.room_id=p_room_id)) THEN RAISE EXCEPTION 'Day %: instructor or room booked',d; END IF;
  IF EXISTS(SELECT 1 FROM public.camp_backup_sessions b JOIN public.lectures x ON x.id=b.lecture_id WHERE b.instructor_id=p_instructor_id AND b.status<>'excluded' AND x.status<>'cancelled' AND x.lecture_date=dt AND x.start_time<et AND x.end_time>st) THEN RAISE EXCEPTION 'Day %: instructor has backup assignment',d; END IF;
  IF l.id IS NOT NULL THEN
   UPDATE public.lectures SET instructor_id=p_instructor_id,room_id=p_room_id,period_number=p_period,start_time=st,end_time=et,duration_hours=s.default_lecture_duration_hours,frozen_rate_egp=CASE WHEN instructor_id=p_instructor_id THEN frozen_rate_egp ELSE rate END WHERE id=l.id;
   UPDATE public.attendance_sheets SET instructor_id=p_instructor_id WHERE id=sh.id;
  ELSE
   INSERT INTO public.lectures(camp_id,camp_day,lecture_date,period_number,start_time,end_time,duration_hours,group_id,instructor_id,room_id,topic,status,frozen_rate_egp)
   VALUES(c.id,d,dt,p_period,st,et,s.default_lecture_duration_hours,g.id,p_instructor_id,p_room_id,g.track,'scheduled',rate) RETURNING id INTO lid;
   INSERT INTO public.attendance_sheets(camp_id,lecture_id,instructor_id,status,sync_state,idempotency_key) VALUES(c.id,lid,p_instructor_id,'draft','Offline','idem-'||c.id||'-'||lid);
  END IF;
  changed:=changed+1;
 END LOOP;
 IF changed=0 THEN RAISE EXCEPTION 'No eligible sessions to revise'; END IF;
 IF p_remove OR gi.instructor_id IS DISTINCT FROM p_instructor_id THEN
  IF gi.id IS NOT NULL THEN
   IF gi.effective_from_day<first_day THEN UPDATE public.group_instructors SET effective_to_day=first_day WHERE id=gi.id;
   ELSE DELETE FROM public.group_instructors WHERE id=gi.id; END IF;
  END IF;
  IF NOT p_remove THEN INSERT INTO public.group_instructors(camp_id,group_id,instructor_id,effective_from_day,assigned_by) VALUES(c.id,g.id,p_instructor_id,first_day,auth.uid()); END IF;
 END IF;
 UPDATE public.groups SET fixed_period_number=CASE WHEN p_remove THEN NULL ELSE p_period END,default_room_id=CASE WHEN p_remove THEN NULL ELSE p_room_id END WHERE id=g.id;
 SELECT full_name_en INTO actor_name FROM public.profiles WHERE id=auth.uid();
 INSERT INTO public.audit_logs(actor_profile_id,actor_name,actor_role,camp_id,action,entity_type,entity_id,previous_value,new_value,reason)
 VALUES(auth.uid(),coalesce(actor_name,'Admin'),'admin',c.id,CASE WHEN p_remove THEN 'FIXED_ASSIGNMENT_REMOVED' WHEN initial_assignment THEN 'FIXED_ASSIGNMENT_CREATED' ELSE 'FIXED_ASSIGNMENT_REVISED' END,'groups',g.id::text,jsonb_build_object('period',g.fixed_period_number,'room',g.default_room_id,'instructor',gi.instructor_id),jsonb_build_object('period',CASE WHEN p_remove THEN NULL ELSE p_period END,'room',CASE WHEN p_remove THEN NULL ELSE p_room_id END,'instructor',CASE WHEN p_remove THEN NULL ELSE p_instructor_id END,'effective_from_day',first_day,'changed',changed),reason_text);
 RETURN jsonb_build_object('changed',changed,'effective_from_day',first_day);
END;
$function$
;
ALTER POLICY finance_policies_admin_read ON public.camp_finance_rate_policies USING (public.is_cits_admin());
ALTER POLICY backup_sessions_admin_read ON public.camp_backup_sessions USING (public.is_cits_admin());
ALTER POLICY finance_payments_admin_read ON public.camp_finance_payments USING (public.is_cits_admin());
COMMIT;
