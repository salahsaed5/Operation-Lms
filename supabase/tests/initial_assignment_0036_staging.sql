-- Staging only; all fixture writes roll back.
BEGIN;
SELECT set_config('request.jwt.claims',(SELECT jsonb_build_object('sub',p.id,'role','authenticated','aal','aal2')::text FROM public.profiles p JOIN public.admin_accounts a ON a.profile_id=p.id WHERE p.is_active AND NOT p.must_change_password LIMIT 1),true);
SET LOCAL ROLE authenticated;
DO $qa$
DECLARE c uuid; v uuid; i uuid; ip uuid; r uuid; r2 uuid; g uuid; p integer; n integer; res jsonb; today date:=(clock_timestamp() AT TIME ZONE 'Africa/Cairo')::date; suffix text:=left(gen_random_uuid()::text,8);
BEGIN
 SELECT ci.instructor_id,x.profile_id,ca.venue_id INTO i,ip,v FROM public.camp_instructors ci JOIN public.instructors x ON x.id=ci.instructor_id JOIN public.camps ca ON ca.id=ci.camp_id WHERE ci.is_active LIMIT 1;
 INSERT INTO public.rooms(venue_id,code,name,capacity) VALUES(v,'QA-A-'||suffix,'QA A',30) RETURNING id INTO r;
 INSERT INTO public.rooms(venue_id,code,name,capacity) VALUES(v,'QA-B-'||suffix,'QA B',30) RETURNING id INTO r2;
 INSERT INTO public.camps(code,name_en,name_ar,status,venue_id,start_date,end_date,duration_days,current_camp_day) VALUES('QA-'||suffix,'QA initial','QA initial','draft',v,today,today+1,2,1) RETURNING id INTO c;
 INSERT INTO public.camp_settings(camp_id) VALUES(c);
 INSERT INTO public.camp_instructors(camp_id,instructor_id) VALUES(c,i);
 SELECT (x->>'period')::int INTO p FROM public.camp_settings s CROSS JOIN LATERAL jsonb_array_elements(s.period_slots) x WHERE s.camp_id=c AND (x->>'start')::time>(clock_timestamp() AT TIME ZONE 'Africa/Cairo')::time AND NOT EXISTS(SELECT 1 FROM public.lectures l WHERE l.lecture_date BETWEEN today AND today+1 AND l.status<>'cancelled' AND coalesce(l.substitute_instructor_id,l.instructor_id)=i AND l.start_time<(x->>'end')::time AND l.end_time>(x->>'start')::time) ORDER BY (x->>'period')::int LIMIT 1;
 IF p IS NULL THEN RAISE EXCEPTION 'Need a free upcoming period for same-day QA'; END IF;
 INSERT INTO public.groups(camp_id,code,name_en,name_ar,track,capacity) VALUES(c,'QA-G','QA existing group','QA existing group','Python',20) RETURNING id INTO g;
 INSERT INTO public.students(camp_id,group_id,student_code,full_name) VALUES(c,g,'QA-S','QA Student');
 UPDATE public.camps SET status='active' WHERE id=c;
 res:=public.revise_fixed_group_schedule_tx(c,g,i,r,p,false,'',NULL,NULL,NULL);
 IF (res->>'changed')::int<>2 OR (res->>'effective_from_day')::int<>1 THEN RAISE EXCEPTION 'Initial assignment failed to include today: %',res; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id=g::text AND action='FIXED_ASSIGNMENT_CREATED') THEN RAISE EXCEPTION 'Initial audit missing'; END IF;
 BEGIN
 PERFORM public.revise_fixed_group_schedule_tx(c,g,NULL,NULL,NULL,true,'',p,r,i);
 RAISE EXCEPTION 'EMPTY_REMOVAL_ACCEPTED';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='EMPTY_REMOVAL_ACCEPTED' THEN RAISE; END IF; END;
 res:=public.revise_fixed_group_schedule_tx(c,g,i,r2,p,false,'',p,r,i);
 IF (res->>'effective_from_day')::int<>2 THEN RAISE EXCEPTION 'Revision altered current day'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.lectures WHERE group_id=g AND camp_day=1 AND room_id=r) THEN RAISE EXCEPTION 'Today overwritten'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',ip,'role','authenticated','aal','aal1')::text,true);
 IF public.current_instructor_id() IS DISTINCT FROM i THEN RAISE EXCEPTION 'Instructor fixture unavailable'; END IF;
 SELECT count(*) INTO n FROM public.lectures WHERE group_id=g AND instructor_id=i;
 IF n<>2 OR NOT EXISTS(SELECT 1 FROM public.groups WHERE id=g) OR NOT EXISTS(SELECT 1 FROM public.students WHERE group_id=g) OR (SELECT count(*) FROM public.attendance_sheets WHERE camp_id=c AND instructor_id=i)<>2 THEN RAISE EXCEPTION 'Instructor schedule or roster access missing'; END IF;
 PERFORM set_config('cits.qa.initial',jsonb_build_object('initial_without_reason',true,'same_day',true,'optional_revision',true,'removal_reason_required',true,'instructor_lectures',n,'instructor_group_roster_sheets',true)::text,true);
END $qa$;
SELECT current_setting('cits.qa.initial',true) AS result;
ROLLBACK;
