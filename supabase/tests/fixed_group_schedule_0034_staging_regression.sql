-- Run only on a staging database with an editable draft camp, active admin,
-- assigned active instructor, and a free period across teaching days.
-- All fixture writes are rolled back.
BEGIN;
SELECT set_config('request.jwt.claims',(SELECT jsonb_build_object('sub',p.id,'role','authenticated','aal','aal2')::text FROM public.profiles p JOIN public.admin_accounts a ON a.profile_id=p.id WHERE p.is_active AND NOT p.must_change_password LIMIT 1),true);
SET LOCAL ROLE authenticated;
DO $test$
DECLARE c public.camps%ROWTYPE; r uuid; i uuid; ip uuid; p integer; result jsonb; gid uuid; n integer; created integer; conflict_code text:='QA-CONFLICT-'||left(gen_random_uuid()::text,8);
BEGIN
 SELECT * INTO c FROM public.camps WHERE status='draft' LIMIT 1;
 SELECT id INTO r FROM public.rooms WHERE venue_id=c.venue_id AND is_active LIMIT 1;
 SELECT ci.instructor_id,ins.profile_id INTO i,ip FROM public.camp_instructors ci JOIN public.instructors ins ON ins.id=ci.instructor_id WHERE ci.camp_id=c.id AND ci.is_active LIMIT 1;
 SELECT (v->>'period')::integer INTO p FROM public.camp_settings s CROSS JOIN LATERAL jsonb_array_elements(s.period_slots) v WHERE s.camp_id=c.id AND NOT EXISTS(SELECT 1 FROM public.lectures l WHERE l.camp_id=c.id AND l.status<>'cancelled' AND l.start_time<(v->>'end')::time AND l.end_time>(v->>'start')::time) LIMIT 1;
 IF NOT public.is_cits_admin() OR p IS NULL THEN RAISE EXCEPTION 'No suitable staging fixture'; END IF;
 result:=public.save_fixed_group_schedule_tx(c.id,NULL,'QA-FIXED-'||left(gen_random_uuid()::text,8),'QA Fixed Group','QA Fixed Group','QA Track',r,i,20,p);
 gid:=(result->>'group_id')::uuid;created:=(result->>'created')::integer;
 IF created<>c.duration_days THEN RAISE EXCEPTION 'Incorrect lecture count'; END IF;
 SELECT count(*) INTO n FROM public.lectures l JOIN public.attendance_sheets s ON s.lecture_id=l.id WHERE l.group_id=gid AND l.instructor_id=i AND l.room_id=r AND l.period_number=p AND s.instructor_id=i;
 IF n<>created THEN RAISE EXCEPTION 'Missing sheet or assignment'; END IF;
 result:=public.save_fixed_group_schedule_tx(c.id,gid,'','','','',r,i,20,p);
 IF (result->>'created')::integer<>0 THEN RAISE EXCEPTION 'Duplicate schedule'; END IF;
 BEGIN
  PERFORM public.save_fixed_group_schedule_tx(c.id,NULL,conflict_code,'QA Conflict','QA Conflict','QA Track',r,i,20,p);
  RAISE EXCEPTION 'Expected conflict but write succeeded';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='Expected conflict but write succeeded' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.groups WHERE camp_id=c.id AND code=conflict_code) THEN RAISE EXCEPTION 'Partial group creation'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',ip,'role','authenticated','aal','aal1')::text,true);
 SELECT count(*) INTO n FROM public.lectures l JOIN public.attendance_sheets sh ON sh.lecture_id=l.id WHERE l.group_id=gid AND l.instructor_id=i;
 IF n<>c.duration_days THEN RAISE EXCEPTION 'Instructor portal RLS returned % of % sessions',n,c.duration_days; END IF;
 BEGIN
  PERFORM public.save_fixed_group_schedule_tx(c.id,NULL,'QA-NONADMIN','QA','QA','QA',r,i,20,p);
  RAISE EXCEPTION 'Unauthorized creation allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('cits.qa.fixed',jsonb_build_object('created',created,'instructor_visible_sessions',n,'retry_created',0,'conflict_rolled_back',true,'instructor_write_denied',true)::text,true);
END $test$;
SELECT current_setting('cits.qa.fixed',true) AS test_result;
ROLLBACK;
