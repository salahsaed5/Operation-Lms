-- Atomic fixed group assignment. Apply to Staging before production release.
BEGIN;
ALTER TABLE public.groups ADD COLUMN fixed_period_number smallint CHECK (fixed_period_number BETWEEN 1 AND 8);
CREATE FUNCTION public.save_fixed_group_schedule_tx(
 p_camp_id uuid,p_group_id uuid,p_code text,p_name_en text,p_name_ar text,p_track text,
 p_room_id uuid,p_instructor_id uuid,p_capacity integer,p_period integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fixed$
DECLARE c public.camps%ROWTYPE; s public.camp_settings%ROWTYPE; g public.groups%ROWTYPE;
 slot jsonb; gid uuid; lid uuid; d integer; dt date; rate integer; first_day integer;
 start_t time; end_t time; made integer:=0; skipped integer:=0;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.is_cits_admin(),false) THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.camps WHERE id=p_camp_id FOR UPDATE;
 IF NOT FOUND OR c.status NOT IN ('draft','active') THEN RAISE EXCEPTION 'Select an editable camp'; END IF;
 SELECT * INTO s FROM public.camp_settings WHERE camp_id=c.id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Camp settings missing'; END IF;
 SELECT v INTO slot FROM jsonb_array_elements(s.period_slots) v WHERE (v->>'period')::integer=p_period;
 IF slot IS NULL OR p_period NOT BETWEEN 1 AND 8 THEN RAISE EXCEPTION 'Invalid fixed period'; END IF;
 start_t:=(slot->>'start')::time; end_t:=(slot->>'end')::time;
 IF start_t IS NULL OR end_t IS NULL OR end_t<=start_t THEN RAISE EXCEPTION 'Invalid period times'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.rooms r WHERE r.id=p_room_id AND r.venue_id=c.venue_id AND r.is_active) THEN RAISE EXCEPTION 'Choose an active room in this camp venue'; END IF;
 SELECT i.default_lecture_rate_egp INTO rate FROM public.instructors i JOIN public.profiles p ON p.id=i.profile_id JOIN public.camp_instructors ci ON ci.instructor_id=i.id AND ci.camp_id=c.id AND ci.is_active WHERE i.id=p_instructor_id AND i.archived_at IS NULL AND p.is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active instructor assigned to this camp'; END IF;
 first_day:=CASE WHEN c.status='draft' THEN 1 ELSE c.current_camp_day END;
 IF p_group_id IS NULL THEN
  IF coalesce(btrim(p_code),'')='' OR coalesce(btrim(p_name_en),'')='' OR coalesce(btrim(p_track),'')='' OR p_capacity IS NULL OR p_capacity NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Group code, name, track and valid capacity required'; END IF;
  INSERT INTO public.groups(camp_id,code,name_en,name_ar,track,default_room_id,capacity,fixed_period_number)
  VALUES(c.id,upper(btrim(p_code)),btrim(p_name_en),coalesce(nullif(btrim(p_name_ar),''),btrim(p_name_en)),btrim(p_track),p_room_id,p_capacity,p_period) RETURNING id INTO gid;
  INSERT INTO public.group_instructors(camp_id,group_id,instructor_id,effective_from_day,assigned_by)
  VALUES(c.id,gid,p_instructor_id,first_day,auth.uid());
 ELSE
  SELECT * INTO g FROM public.groups WHERE id=p_group_id AND camp_id=c.id FOR UPDATE;
  IF NOT FOUND OR g.default_room_id IS DISTINCT FROM p_room_id OR NOT EXISTS(SELECT 1 FROM public.group_instructors gi WHERE gi.camp_id=c.id AND gi.group_id=g.id AND gi.instructor_id=p_instructor_id AND gi.effective_to_day IS NULL) THEN RAISE EXCEPTION 'Existing group assignment does not match'; END IF;
  IF g.fixed_period_number IS NOT NULL AND g.fixed_period_number<>p_period THEN RAISE EXCEPTION 'Fixed period already configured; use an approved schedule revision'; END IF;
  gid:=g.id; p_track:=g.track;
  UPDATE public.groups SET fixed_period_number=p_period WHERE id=gid;
 END IF;
 FOR d IN first_day..c.duration_days LOOP
  dt:=public.camp_teaching_date(c.start_date,d,c.operating_weekdays);
  -- Do not create retroactive sessions for a running camp.
  IF c.status='active' AND (dt+start_t) AT TIME ZONE 'Africa/Cairo' <= clock_timestamp() THEN skipped:=skipped+1; CONTINUE; END IF;
  -- Preserve existing sessions (including cancelled sessions and one-day exceptions).
  IF EXISTS(SELECT 1 FROM public.lectures l WHERE l.camp_id=c.id AND l.group_id=gid AND l.camp_day=d) THEN skipped:=skipped+1; CONTINUE; END IF;
  -- Existing cross-camp trigger acquires the same resource locks. Check pending backups too.
  PERFORM pg_advisory_xact_lock(hashtext('cits:crosscamp:instructor'),hashtext(p_instructor_id::text||':'||dt::text));
  PERFORM pg_advisory_xact_lock(hashtext('cits:crosscamp:room'),hashtext(p_room_id::text||':'||dt::text));
  IF EXISTS(SELECT 1 FROM public.lectures l WHERE l.lecture_date=dt AND l.status<>'cancelled' AND l.start_time<end_t AND l.end_time>start_t AND (coalesce(l.substitute_instructor_id,l.instructor_id)=p_instructor_id OR l.room_id=p_room_id)) THEN RAISE EXCEPTION 'Day %: instructor or room is already booked',d; END IF;
  IF EXISTS(SELECT 1 FROM public.camp_backup_sessions b JOIN public.lectures l ON l.id=b.lecture_id WHERE b.instructor_id=p_instructor_id AND b.status<>'excluded' AND l.status<>'cancelled' AND l.lecture_date=dt AND l.start_time<end_t AND l.end_time>start_t) THEN RAISE EXCEPTION 'Day %: instructor has a backup assignment',d; END IF;
  INSERT INTO public.lectures(camp_id,camp_day,lecture_date,period_number,start_time,end_time,duration_hours,group_id,instructor_id,room_id,topic,status,frozen_rate_egp)
  VALUES(c.id,d,dt,p_period,start_t,end_t,s.default_lecture_duration_hours,gid,p_instructor_id,p_room_id,btrim(p_track),'scheduled',rate) RETURNING id INTO lid;
  INSERT INTO public.attendance_sheets(camp_id,lecture_id,instructor_id,status,sync_state,idempotency_key)
  VALUES(c.id,lid,p_instructor_id,'draft','Offline','idem-'||c.id||'-'||lid);
  made:=made+1;
 END LOOP;
 IF p_group_id IS NULL AND made=0 THEN RAISE EXCEPTION 'No future teaching sessions available'; END IF;
 RETURN jsonb_build_object('group_id',gid,'created',made,'skipped',skipped);
END;
$fixed$;
REVOKE ALL ON FUNCTION public.save_fixed_group_schedule_tx(uuid,uuid,text,text,text,text,uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_fixed_group_schedule_tx(uuid,uuid,text,text,text,text,uuid,uuid,integer,integer) TO authenticated;
COMMIT;
