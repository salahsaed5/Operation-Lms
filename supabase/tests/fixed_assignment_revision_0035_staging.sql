BEGIN;
SELECT set_config('request.jwt.claims',(SELECT jsonb_build_object('sub',p.id,'role','authenticated','aal','aal2')::text FROM public.profiles p JOIN public.admin_accounts a ON a.profile_id=p.id WHERE p.is_active AND NOT p.must_change_password LIMIT 1),true);
SET LOCAL ROLE authenticated;
DO $qa$
DECLARE c public.camps%ROWTYPE; i uuid; r uuid; p1 integer; p2 integer; g uuid; n integer; res jsonb; old_ids uuid[];
BEGIN
 SELECT * INTO c FROM public.camps WHERE status='draft' LIMIT 1;
 SELECT instructor_id INTO i FROM public.camp_instructors WHERE camp_id=c.id AND is_active LIMIT 1;
 SELECT id INTO r FROM public.rooms WHERE venue_id=c.venue_id AND is_active LIMIT 1;
 SELECT min(p),max(p) INTO p1,p2 FROM (SELECT (v->>'period')::integer p FROM public.camp_settings s CROSS JOIN LATERAL jsonb_array_elements(s.period_slots) v WHERE s.camp_id=c.id AND NOT EXISTS(SELECT 1 FROM public.lectures l WHERE l.camp_id=c.id AND l.status<>'cancelled' AND l.start_time<(v->>'end')::time AND l.end_time>(v->>'start')::time)) q;
 IF p1 IS NULL OR p1=p2 THEN RAISE EXCEPTION 'Need two free periods'; END IF;
 res:=public.save_fixed_group_schedule_tx(c.id,NULL,'QA-REV-'||left(gen_random_uuid()::text,8),'QA Revision','QA Revision','QA',r,i,20,p1);
 g:=(res->>'group_id')::uuid;
 SELECT array_agg(id ORDER BY id) INTO old_ids FROM public.lectures WHERE group_id=g;
 res:=public.revise_fixed_group_schedule_tx(c.id,g,i,r,p2,false,'QA move',p1,r,i);
 IF (res->>'changed')::int<>c.duration_days THEN RAISE EXCEPTION 'Wrong revised count'; END IF;
 SELECT count(*) INTO n FROM public.lectures l JOIN public.attendance_sheets a ON a.lecture_id=l.id WHERE l.group_id=g AND l.id=ANY(old_ids) AND l.period_number=p2 AND a.instructor_id=i AND a.status='draft';
 IF n<>c.duration_days THEN RAISE EXCEPTION 'Move did not preserve session and sheet identities'; END IF;
 BEGIN
 PERFORM public.revise_fixed_group_schedule_tx(c.id,g,i,r,p1,false,'Stale request',p1,r,i);
 RAISE EXCEPTION 'STALE_ACCEPTED';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='STALE_ACCEPTED' THEN RAISE; END IF; END;
 res:=public.revise_fixed_group_schedule_tx(c.id,g,NULL,NULL,NULL,true,'QA remove',p2,r,i);
 SELECT count(*) INTO n FROM public.lectures WHERE group_id=g AND status='cancelled' AND id=ANY(old_ids);
 IF n<>c.duration_days OR EXISTS(SELECT 1 FROM public.groups WHERE id=g AND fixed_period_number IS NOT NULL) THEN RAISE EXCEPTION 'Remove did not preserve cancelled rows'; END IF;
 res:=public.revise_fixed_group_schedule_tx(c.id,g,i,r,p1,false,'QA reassign',NULL,NULL,NULL);
 SELECT count(*) INTO n FROM public.lectures WHERE group_id=g AND status='scheduled' AND period_number=p1;
 IF n<>c.duration_days THEN RAISE EXCEPTION 'Reassignment failed'; END IF;
 PERFORM set_config('cits.qa.revision',jsonb_build_object('move',true,'stale_rejected',true,'remove',true,'reassign',true,'days',n)::text,true);
END $qa$;
SELECT current_setting('cits.qa.revision',true) AS result;
ROLLBACK;