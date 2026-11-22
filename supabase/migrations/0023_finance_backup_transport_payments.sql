-- Phase Finance 0023 — BACKUP roles, frozen day rates and immutable settlements
-- STAGING REVIEW REQUIRED. Do not auto-apply to any existing environment.
-- No legacy lecture_entitlements, instructor_rates, or payment records modified.
BEGIN;

CREATE TABLE public.camp_finance_rate_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id uuid NOT NULL REFERENCES public.camps(id) ON DELETE RESTRICT,
  effective_from_day integer NOT NULL CHECK (effective_from_day BETWEEN 1 AND 365),
  backup_rate_egp integer NOT NULL CHECK (backup_rate_egp BETWEEN 0 AND 1000000),
  transport_per_day_egp integer NOT NULL CHECK (transport_per_day_egp BETWEEN 0 AND 1000000),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(camp_id,effective_from_day)
);
CREATE INDEX idx_finance_policy_camp_day ON public.camp_finance_rate_policies(camp_id,effective_from_day DESC);

CREATE TABLE public.camp_backup_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id uuid NOT NULL REFERENCES public.camps(id) ON DELETE RESTRICT,
  lecture_id uuid NOT NULL REFERENCES public.lectures(id) ON DELETE RESTRICT,
  instructor_id uuid NOT NULL REFERENCES public.instructors(id) ON DELETE RESTRICT,
  camp_day integer NOT NULL CHECK (camp_day BETWEEN 1 AND 365),
  frozen_rate_egp integer NOT NULL CHECK (frozen_rate_egp BETWEEN 0 AND 1000000),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','excluded')),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  reviewed_at timestamptz,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lecture_id,instructor_id)
);
CREATE INDEX idx_backup_session_instructor_camp ON public.camp_backup_sessions(instructor_id,camp_id, camp_day);

CREATE TABLE public.camp_finance_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  camp_id uuid NOT NULL REFERENCES public.camps(id) ON DELETE RESTRICT,
  instructor_id uuid NOT NULL REFERENCES public.instructors(id) ON DELETE RESTRICT,
  amount_egp integer NOT NULL CHECK (amount_egp <> 0 AND abs(amount_egp) <= 10000000),
  method text NOT NULL CHECK (method IN ('cash','bank_transfer','instapay','wallet','other')),
  reference text NOT NULL DEFAULT '' CHECK (length(reference) <= 120),
  note text NOT NULL CHECK (length(trim(note)) BETWEEN 3 AND 1000),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_finance_payments_instructor_camp ON public.camp_finance_payments(instructor_id,camp_id,created_at DESC);

ALTER TABLE public.camp_finance_rate_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.camp_backup_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.camp_finance_payments ENABLE ROW LEVEL SECURITY;

-- All writes must go through the reviewed, audited RPCs below.
REVOKE ALL ON public.camp_finance_rate_policies, public.camp_backup_sessions,
  public.camp_finance_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.camp_finance_rate_policies,
  public.camp_backup_sessions, public.camp_finance_payments TO authenticated;

CREATE POLICY finance_policies_admin_read ON public.camp_finance_rate_policies
  FOR SELECT TO authenticated
  USING (public.is_cits_admin() AND (auth.jwt()->>'aal') = 'aal2');
CREATE POLICY finance_policies_instructor_read ON public.camp_finance_rate_policies
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.camp_instructors ci
    WHERE ci.camp_id = camp_id AND ci.instructor_id = public.current_instructor_id()
      AND ci.is_active
  ) OR EXISTS (
    SELECT 1 FROM public.lecture_entitlements le
    WHERE le.camp_id = camp_id AND le.instructor_id = public.current_instructor_id()
  ) OR EXISTS (
    SELECT 1 FROM public.camp_backup_sessions bs
    WHERE bs.camp_id = camp_id AND bs.instructor_id = public.current_instructor_id()
  ));
CREATE POLICY backup_sessions_admin_read ON public.camp_backup_sessions
  FOR SELECT TO authenticated
  USING (public.is_cits_admin() AND (auth.jwt()->>'aal') = 'aal2');
CREATE POLICY backup_sessions_instructor_read ON public.camp_backup_sessions
  FOR SELECT TO authenticated USING (instructor_id = public.current_instructor_id());
CREATE POLICY finance_payments_admin_read ON public.camp_finance_payments
  FOR SELECT TO authenticated
  USING (public.is_cits_admin() AND (auth.jwt()->>'aal') = 'aal2');
CREATE POLICY finance_payments_instructor_read ON public.camp_finance_payments
  FOR SELECT TO authenticated USING (instructor_id = public.current_instructor_id());

-- Deny updates/deletes even to internal users so financial audit remains append-only.
CREATE FUNCTION public.finance_protect_immutable_records()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Finance rate policies and posted payments are immutable; post a correction or a future-day policy';
END; $$;
CREATE TRIGGER trg_finance_policies_immutable
  BEFORE UPDATE OR DELETE ON public.camp_finance_rate_policies
  FOR EACH ROW EXECUTE FUNCTION public.finance_protect_immutable_records();
CREATE TRIGGER trg_finance_payments_immutable
  BEFORE UPDATE OR DELETE ON public.camp_finance_payments
  FOR EACH ROW EXECUTE FUNCTION public.finance_protect_immutable_records();

-- Rates change from an effective day only; existing snapshots remain fixed.
CREATE FUNCTION public.finance_set_day_rates(
  p_camp_id uuid, p_effective_from_day integer,
  p_backup_rate integer, p_transport_per_day integer, p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_current_day integer; v_has_policy boolean;
BEGIN
  IF NOT public.is_cits_admin() OR (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2'
    THEN RAISE EXCEPTION 'Admin AAL2 required'; END IF;
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
END; $$;

-- A backup instructor has NO group, timetable assignment or student roster.
-- The admin links a witnessed supporting session to an actual lecture.
CREATE FUNCTION public.finance_add_backup_session(
  p_lecture_id uuid, p_instructor_id uuid, p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_lec public.lectures%ROWTYPE; v_rate integer; v_id uuid;
BEGIN
  IF NOT public.is_cits_admin() OR (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2'
    THEN RAISE EXCEPTION 'Admin AAL2 required'; END IF;
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
    (camp_id,lecture_id,instructor_id,camp_day,frozen_rate_egp,reason,created_by)
  VALUES (v_lec.camp_id,v_lec.id,p_instructor_id,v_lec.camp_day,v_rate,trim(p_reason),auth.uid())
  RETURNING id INTO v_id;
  PERFORM public.append_audit_log_internal(v_lec.camp_id,'FINANCE_BACKUP_RECORDED',
    'camp_backup_sessions',v_id::text,NULL,
    jsonb_build_object('lecture_id',v_lec.id,'backup_instructor_id',p_instructor_id,'frozen_rate_egp',v_rate),
    trim(p_reason));
  RETURN v_id;
END; $$;

CREATE FUNCTION public.finance_review_backup_session(
  p_backup_id uuid, p_decision text, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.camp_backup_sessions%ROWTYPE; v_lecture_status text; v_sheet_status text;
BEGIN
  IF NOT public.is_cits_admin() OR (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2'
    THEN RAISE EXCEPTION 'Admin AAL2 required'; END IF;
  IF p_decision NOT IN ('approved','excluded') OR length(trim(coalesce(p_reason,''))) < 3
    THEN RAISE EXCEPTION 'Valid decision and reason required'; END IF;
  SELECT * INTO v_row FROM public.camp_backup_sessions WHERE id=p_backup_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Backup record not found'; END IF;
  SELECT status::text INTO v_lecture_status FROM public.lectures WHERE id=v_row.lecture_id;
  IF v_lecture_status = 'cancelled' AND p_decision='approved' THEN
    RAISE EXCEPTION 'Cannot pay backup for a cancelled lecture'; END IF;
  IF p_decision='approved' THEN
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
END; $$;

-- Read-only authoritative balance is evaluated by the server within a lock
-- before each payment: primary entitlement + approved backup + one transport
-- allowance per verified PRIMARY day, less already recorded payments.
CREATE FUNCTION public.finance_record_payment(
  p_camp_id uuid,p_instructor_id uuid,p_amount_egp integer,
  p_method text,p_reference text,p_note text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_primary bigint;v_backup bigint;v_transport bigint;v_paid bigint;v_due bigint;v_id uuid;
BEGIN
  IF NOT public.is_cits_admin() OR (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2'
    THEN RAISE EXCEPTION 'Admin AAL2 required'; END IF;
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
END; $$;

-- Stop direct execution via PUBLIC inheritance; only authenticated users
-- reach the RPCs and they must independently pass active Admin + AAL2.
REVOKE ALL ON FUNCTION public.finance_protect_immutable_records() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finance_set_day_rates(uuid,integer,integer,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finance_add_backup_session(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finance_review_backup_session(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finance_record_payment(uuid,uuid,integer,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finance_set_day_rates(uuid,integer,integer,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_add_backup_session(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_review_backup_session(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_record_payment(uuid,uuid,integer,text,text,text) TO authenticated;
COMMIT;
