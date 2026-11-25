BEGIN;
-- Admin-only, all-or-nothing future schedule revision. No attendance records,
-- financial entitlements or historical lectures are deleted or rewritten.
CREATE OR REPLACE FUNCTION public.revise_fixed_group_schedule_tx(
 p_camp_id uuid,p_group_id uuid,p_instructor_id uuid,p_room_id uuid,p_period integer,
 p_remove boolean,p_reason text,p_expected_period integer,p_expected_room uuid,p_expected_instructor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $rev$
DECLARE c public.camps%ROWTYPE; g public.groups%ROWTYPE; gi public.group_instructors%ROWTYPE;
 s public.camp_settings%ROWTYPE; l public.lectures%ROWTYPE; sh public.attendance_sheets%ROWTYPE;
 d integer; first_day integer; dt date; slot jsonb; st time; et time; rate integer;
 changed integer:=0; lid uuid; n integer; actor_name text; initial_assignment boolean; reason_text text;
BEGIN
 IF auth.uid() IS NULL OR public.is_cits_admin() IS NOT TRUE OR coalesce(auth.jwt()->>'aal','')<>'aal2' THEN RAISE EXCEPTION 'Verified admin required' USING ERRCODE='42501'; END IF;
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
   IF gi.effective_from_day<first_day THEN UPDATE public.group_instructors SET effective_to_day=first_day-1 WHERE id=gi.id;
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
$rev$;
REVOKE ALL ON FUNCTION public.revise_fixed_group_schedule_tx(uuid,uuid,uuid,uuid,integer,boolean,text,integer,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revise_fixed_group_schedule_tx(uuid,uuid,uuid,uuid,integer,boolean,text,integer,uuid,uuid) TO authenticated;
COMMIT;
