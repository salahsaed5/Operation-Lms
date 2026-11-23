-- Parallel Active Camp acceptance against Staging. All fixtures roll back.
BEGIN;
DO $qa$
DECLARE
  v_admin uuid;
  v_inst uuid;
  v_room uuid;
  v_venue uuid;
  v_sat uuid;
  v_sun uuid;
  v_overlap uuid;
  v_g_sat uuid;
  v_g_sun uuid;
  v_g_overlap uuid;
  v_before integer;
BEGIN
  SELECT p.id INTO v_admin FROM public.profiles p
    JOIN public.admin_accounts a ON a.profile_id=p.id
    WHERE p.role='admin' AND p.is_active AND NOT p.must_change_password LIMIT 1;
  SELECT i.id INTO v_inst FROM public.instructors i JOIN public.profiles p ON p.id=i.profile_id
    WHERE p.is_active LIMIT 1;
  SELECT r.id,r.venue_id INTO v_room,v_venue FROM public.rooms r WHERE r.is_active LIMIT 1;
  IF v_admin IS NULL OR v_inst IS NULL OR v_room IS NULL THEN
    RAISE EXCEPTION 'Parallel Camp QA requires active Staging admin, instructor, and room';
  END IF;

  SELECT count(*) INTO v_before FROM public.camps WHERE status='active';
  INSERT INTO public.camps
    (code,name_en,name_ar,venue_id,start_date,end_date,duration_days,
     operating_weekdays,created_by)
  VALUES('QA-SAT-'||substr(gen_random_uuid()::text,1,8),
     '10-day Sat Mon Wed QA','10-day Sat Mon Wed QA',
     v_venue,'2026-11-28','2026-11-28',10,ARRAY[1,3,6],v_admin)
  RETURNING id INTO v_sat;
  INSERT INTO public.camps
    (code,name_en,name_ar,venue_id,start_date,end_date,duration_days,
     operating_weekdays,created_by)
  VALUES('QA-SUN-'||substr(gen_random_uuid()::text,1,8),
     '15-day Sun Tue Thu QA','15-day Sun Tue Thu QA',
     v_venue,'2026-11-29','2026-11-29',15,ARRAY[0,2,4],v_admin)
  RETURNING id INTO v_sun;

  UPDATE public.camps SET status='active' WHERE id IN (v_sat,v_sun);
  IF (SELECT count(*) FROM public.camps WHERE status='active') <> v_before+2 THEN
    RAISE EXCEPTION 'QA_FAILED two simultaneously active Camps were not accepted';
  END IF;
  IF (SELECT end_date FROM public.camps WHERE id=v_sat) <> '2026-12-19'
     OR (SELECT end_date FROM public.camps WHERE id=v_sun) <> '2026-12-31' THEN
    RAISE EXCEPTION 'QA_FAILED independent Camp calendars';
  END IF;
  UPDATE public.camps SET current_camp_day=3 WHERE id=v_sat;
  IF (SELECT current_camp_day FROM public.camps WHERE id=v_sun) <> 1 THEN
    RAISE EXCEPTION 'QA_FAILED a Camp day change leaked to another Active Camp';
  END IF;

  -- An additional active Camp tests cross-Camp collision on a shared date.
  INSERT INTO public.camps
    (code,name_en,name_ar,venue_id,start_date,end_date,duration_days,
     operating_weekdays,created_by)
  VALUES('QA-SUN2-'||substr(gen_random_uuid()::text,1,8),
     'Conflicting Sun QA','Conflicting Sun QA',
     v_venue,'2026-11-29','2026-11-29',10,ARRAY[0,2,4],v_admin)
  RETURNING id INTO v_overlap;
  UPDATE public.camps SET status='active' WHERE id=v_overlap;

  INSERT INTO public.camp_instructors(camp_id,instructor_id)
  VALUES(v_sat,v_inst),(v_sun,v_inst),(v_overlap,v_inst);
  INSERT INTO public.groups(camp_id,code,name_en,name_ar,track)
  VALUES(v_sat,'QA-SAT','Saturday group','Saturday group','QA') RETURNING id INTO v_g_sat;
  INSERT INTO public.groups(camp_id,code,name_en,name_ar,track)
  VALUES(v_sun,'QA-SUN','Sunday group','Sunday group','QA') RETURNING id INTO v_g_sun;
  INSERT INTO public.groups(camp_id,code,name_en,name_ar,track)
  VALUES(v_overlap,'QA-SUN2','Sunday overlap group','Sunday overlap group','QA')
  RETURNING id INTO v_g_overlap;
  INSERT INTO public.group_instructors(camp_id,group_id,instructor_id,assigned_by)
  VALUES(v_sat,v_g_sat,v_inst,v_admin),(v_sun,v_g_sun,v_inst,v_admin),
        (v_overlap,v_g_overlap,v_inst,v_admin);

  INSERT INTO public.lectures
    (camp_id,camp_day,lecture_date,period_number,start_time,end_time,
     group_id,instructor_id,room_id,topic,frozen_rate_egp)
  VALUES
    (v_sat,1,'2026-11-28',1,'09:00','12:00',v_g_sat,v_inst,v_room,'Saturday lecture',300),
    (v_sun,1,'2026-11-29',1,'09:00','12:00',v_g_sun,v_inst,v_room,'Sunday lecture',300);

  BEGIN
    INSERT INTO public.lectures
      (camp_id,camp_day,lecture_date,period_number,start_time,end_time,
       group_id,instructor_id,room_id,topic,frozen_rate_egp)
    VALUES(v_overlap,1,'2026-11-29',1,'11:00','13:00',
           v_g_overlap,v_inst,v_room,'Conflicting cross-Camp lecture',300);
    RAISE EXCEPTION 'QA_FAILED cross-Camp double booking accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'Cross-Camp schedule conflict:%' THEN RAISE; END IF;
  END;

  -- The same instructor/room can work for another Camp after the slot ends.
  INSERT INTO public.lectures
    (camp_id,camp_day,lecture_date,period_number,start_time,end_time,
     group_id,instructor_id,room_id,topic,frozen_rate_egp)
  VALUES(v_overlap,1,'2026-11-29',2,'13:00','16:00',
     v_g_overlap,v_inst,v_room,'No overlapping slot',300);

  RAISE NOTICE 'PASS multi-active Camps: 10/15 calendars, independent day progression and cross-Camp collision guard';
END $qa$;
ROLLBACK;
