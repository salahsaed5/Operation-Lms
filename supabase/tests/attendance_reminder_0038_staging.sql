-- Staging only; all test notifications and fixtures are rolled back.
BEGIN;
SELECT set_config('request.jwt.claims',(SELECT jsonb_build_object('sub',p.id,'role','authenticated','aal','aal2')::text FROM public.profiles p JOIN public.admin_accounts a ON a.profile_id=p.id WHERE p.is_active AND NOT p.must_change_password LIMIT 1),true);
SET LOCAL ROLE authenticated;
DO $qa$
DECLARE c uuid; v uuid; i uuid; ip uuid; r uuid; g uuid; p int; past uuid; future uuid; n int; today date:=(clock_timestamp() AT TIME ZONE 'Africa/Cairo')::date; suffix text:=left(gen_random_uuid()::text,8); admin_claims text:=current_setting('request.jwt.claims');
BEGIN
 SELECT ci.instructor_id,x.profile_id,ca.venue_id INTO i,ip,v FROM public.camp_instructors ci JOIN public.instructors x ON x.id=ci.instructor_id JOIN public.camps ca ON ca.id=ci.camp_id WHERE ci.is_active LIMIT 1;
 INSERT INTO public.rooms(venue_id,code,name,capacity) VALUES(v,'QA-REM-'||suffix,'QA reminder room',30) RETURNING id INTO r;
 INSERT INTO public.camps(code,name_en,name_ar,status,venue_id,start_date,end_date,duration_days,current_camp_day) VALUES('QA-REM-'||suffix,'QA reminder','QA reminder','draft',v,today-1,today+1,3,1) RETURNING id INTO c;
 INSERT INTO public.camp_settings(camp_id) VALUES(c);
 INSERT INTO public.camp_instructors(camp_id,instructor_id) VALUES(c,i);
 SELECT (x->>'period')::int INTO p FROM public.camp_settings s CROSS JOIN LATERAL jsonb_array_elements(s.period_slots) x WHERE s.camp_id=c AND NOT EXISTS(SELECT 1 FROM public.lectures l WHERE l.lecture_date BETWEEN today-1 AND today+1 AND l.status<>'cancelled' AND coalesce(l.substitute_instructor_id,l.instructor_id)=i AND l.start_time<(x->>'end')::time AND l.end_time>(x->>'start')::time) ORDER BY (x->>'period')::int LIMIT 1;
 IF p IS NULL THEN RAISE EXCEPTION 'Need a free QA period'; END IF;
 INSERT INTO public.groups(camp_id,code,name_en,name_ar,track,capacity) VALUES(c,'QA-R','QA R','QA R','QA attendance '||suffix,20) RETURNING id INTO g;
 PERFORM public.revise_fixed_group_schedule_tx(c,g,i,r,p,false,'',NULL,NULL,NULL);
 SELECT id INTO past FROM public.lectures WHERE group_id=g AND camp_day=1;
 SELECT id INTO future FROM public.lectures WHERE group_id=g AND camp_day=3;
 IF past IS NULL OR future IS NULL THEN RAISE EXCEPTION 'QA lectures unavailable'; END IF;
 UPDATE public.camps SET status='active' WHERE id=c;
 PERFORM public.send_attendance_reminder_tx(past);
 SELECT count(*) INTO n FROM public.notifications WHERE recipient_profile_id=ip AND title_en='Attendance reminder' AND body_en LIKE '%QA attendance '||suffix||'%';
 IF n<>1 THEN RAISE EXCEPTION 'Notification missing'; END IF;
 BEGIN
 PERFORM public.send_attendance_reminder_tx(past); RAISE EXCEPTION 'DUPLICATE_ACCEPTED';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'A reminder was already sent within the last 6 hours' THEN RAISE; END IF; END;
 BEGIN
 PERFORM public.send_attendance_reminder_tx(future); RAISE EXCEPTION 'FUTURE_ACCEPTED';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Lecture has not ended' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',ip,'role','authenticated','aal','aal1')::text,true);
 BEGIN
 PERFORM public.send_attendance_reminder_tx(past); RAISE EXCEPTION 'INSTRUCTOR_ACCEPTED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('request.jwt.claims',admin_claims,true);
 PERFORM set_config('cits.qa.reminder',jsonb_build_object('notification_created',true,'cooldown',true,'future_rejected',true,'instructor_denied',true)::text,true);
END $qa$;
SELECT current_setting('cits.qa.reminder',true) AS result;
ROLLBACK;