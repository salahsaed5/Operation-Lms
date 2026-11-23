-- Staging acceptance: cross-Camp Primary/Backup and Backup/Backup double-booking.
-- Transaction rolls back all synthetic Camps, rooms, instructors and backup rows.
-- Synthetic additional Instructor profiles are linked to existing Staging Admin
-- profiles ONLY for rollback-only relational-fixture testing, not real sign-in.
BEGIN;
DO $qa$
DECLARE
  v_admin uuid; v_admin2 uuid; v_real_inst uuid;
  v_inst_b uuid; v_inst_c uuid; v_venue uuid; v_room1 uuid; v_room2 uuid;
  v_camp_a uuid; v_camp_b uuid; v_camp_c uuid;
  v_g_a uuid; v_g_b uuid; v_g_c uuid;
  v_host1 uuid; v_host2 uuid; v_other uuid; v_backup1 uuid; v_backup2 uuid;
BEGIN
  SELECT p.id INTO v_admin FROM public.profiles p
  JOIN public.admin_accounts a ON a.profile_id=p.id
  WHERE p.role='admin' AND p.is_active LIMIT 1;
  SELECT p.id INTO v_admin2 FROM public.profiles p WHERE p.role='admin'
    AND p.id <> v_admin AND p.is_active LIMIT 1;
  SELECT i.id INTO v_real_inst FROM public.instructors i
    JOIN public.profiles p ON p.id=i.profile_id WHERE p.role='instructor' AND p.is_active LIMIT 1;
  SELECT r.id,r.venue_id INTO v_room1,v_venue FROM public.rooms r WHERE r.is_active LIMIT 1;
  IF v_admin IS NULL OR v_admin2 IS NULL OR v_real_inst IS NULL OR v_room1 IS NULL THEN
    RAISE EXCEPTION 'Staging needs two admin profiles, one instructor and a room for Backup collision QA';
  END IF;

  INSERT INTO public.instructors(profile_id,instructor_code,specialization,default_lecture_rate_egp)
  VALUES(v_admin,'QA-B-'||substr(gen_random_uuid()::text,1,8),'QA role-only placeholder',300)
  RETURNING id INTO v_inst_b;
  INSERT INTO public.instructors(profile_id,instructor_code,specialization,default_lecture_rate_egp)
  VALUES(v_admin2,'QA-C-'||substr(gen_random_uuid()::text,1,8),'QA role-only placeholder',300)
  RETURNING id INTO v_inst_c;
  INSERT INTO public.rooms(venue_id,code,name,capacity)
  VALUES(v_venue,'QA-R-'||substr(gen_random_uuid()::text,1,8),'Rollback-only second room',30)
  RETURNING id INTO v_room2;

  INSERT INTO public.camps(code,name_en,name_ar,venue_id,start_date,end_date,duration_days,
    operating_weekdays,status,created_by)
  VALUES('QA-BA-'||substr(gen_random_uuid()::text,1,8),
   'Backup Host QA','Backup Host QA',v_venue,'2026-11-29','2026-11-29',10,ARRAY[0,2,4],'active',v_admin)
  RETURNING id INTO v_camp_a;
  INSERT INTO public.camps(code,name_en,name_ar,venue_id,start_date,end_date,duration_days,
    operating_weekdays,status,created_by)
  VALUES('QA-BB-'||substr(gen_random_uuid()::text,1,8),
   'Primary Conflict QA','Primary Conflict QA',v_venue,'2026-11-29','2026-11-29',10,ARRAY[0,2,4],'active',v_admin)
  RETURNING id INTO v_camp_b;
  INSERT INTO public.camps(code,name_en,name_ar,venue_id,start_date,end_date,duration_days,
    operating_weekdays,status,created_by)
  VALUES('QA-BC-'||substr(gen_random_uuid()::text,1,8),
   'Backup Conflict QA','Backup Conflict QA',v_venue,'2026-11-29','2026-11-29',10,ARRAY[0,2,4],'active',v_admin)
  RETURNING id INTO v_camp_c;

  INSERT INTO public.camp_instructors(camp_id,instructor_id)
  VALUES(v_camp_a,v_inst_b),(v_camp_a,v_real_inst),
        (v_camp_b,v_real_inst),(v_camp_c,v_inst_c),(v_camp_c,v_real_inst);
  INSERT INTO public.groups(camp_id,code,name_en,name_ar,track)
  VALUES(v_camp_a,'QA-A','QA A','QA A','QA') RETURNING id INTO v_g_a;
  INSERT INTO public.groups(camp_id,code,name_en,name_ar,track)
  VALUES(v_camp_b,'QA-B','QA B','QA B','QA') RETURNING id INTO v_g_b;
  INSERT INTO public.groups(camp_id,code,name_en,name_ar,track)
  VALUES(v_camp_c,'QA-C','QA C','QA C','QA') RETURNING id INTO v_g_c;
  INSERT INTO public.group_instructors(camp_id,group_id,instructor_id)
  VALUES(v_camp_a,v_g_a,v_inst_b),(v_camp_b,v_g_b,v_real_inst),(v_camp_c,v_g_c,v_inst_c);

  INSERT INTO public.lectures(camp_id,camp_day,lecture_date,period_number,
    start_time,end_time,group_id,instructor_id,room_id,topic,frozen_rate_egp)
  VALUES(v_camp_a,1,'2026-11-29',1,'09:00','12:00',
    v_g_a,v_inst_b,v_room2,'Host 9-12',300) RETURNING id INTO v_host1;
  INSERT INTO public.lectures(camp_id,camp_day,lecture_date,period_number,
    start_time,end_time,group_id,instructor_id,room_id,topic,frozen_rate_egp)
  VALUES(v_camp_b,1,'2026-11-29',1,'09:00','12:00',
    v_g_b,v_real_inst,v_room1,'Primary 9-12',300);

  INSERT INTO public.camp_backup_sessions(camp_id,lecture_id,instructor_id,
    camp_day,period_number,frozen_rate_egp,status,reason,created_by)
  VALUES(v_camp_a,v_host1,v_real_inst,1,1,150,'pending',
    'Rollback Backup primary clash',v_admin) RETURNING id INTO v_backup1;
  BEGIN
    UPDATE public.camp_backup_sessions SET status='approved' WHERE id=v_backup1;
    RAISE EXCEPTION 'QA_FAILED_BACKUP_OVERLAPPING_OTHER_CAMP_PRIMARY';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'Cross-Camp Backup conflict:%' THEN RAISE; END IF;
  END;

  INSERT INTO public.lectures(camp_id,camp_day,lecture_date,period_number,
    start_time,end_time,group_id,instructor_id,room_id,topic,frozen_rate_egp)
  VALUES(v_camp_a,1,'2026-11-29',2,'13:00','16:00',
    v_g_a,v_inst_b,v_room2,'Host 13-16',300) RETURNING id INTO v_host2;
  INSERT INTO public.camp_backup_sessions(camp_id,lecture_id,instructor_id,
    camp_day,period_number,frozen_rate_egp,status,reason,created_by)
  VALUES(v_camp_a,v_host2,v_real_inst,1,2,150,'approved',
    'Rollback confirmed Backup 13-16',v_admin);
  BEGIN
    INSERT INTO public.lectures(camp_id,camp_day,lecture_date,period_number,
      start_time,end_time,group_id,instructor_id,room_id,topic,frozen_rate_egp)
    VALUES(v_camp_c,1,'2026-11-29',2,'13:00','16:00',
      v_g_c,v_real_inst,v_room1,'Primary overlapping Backup 13-16',300);
    RAISE EXCEPTION 'QA_FAILED_PRIMARY_OVERLAPPING_OTHER_CAMP_BACKUP';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'Cross-Camp schedule conflict: Instructor is approved Backup%' THEN RAISE; END IF;
  END;

  INSERT INTO public.lectures(camp_id,camp_day,lecture_date,period_number,
    start_time,end_time,group_id,instructor_id,room_id,topic,frozen_rate_egp)
  VALUES(v_camp_c,1,'2026-11-29',2,'13:00','16:00',
    v_g_c,v_inst_c,v_room1,'Second backup host 13-16',300)
  RETURNING id INTO v_other;
  INSERT INTO public.camp_backup_sessions(camp_id,lecture_id,instructor_id,
    camp_day,period_number,frozen_rate_egp,status,reason,created_by)
  VALUES(v_camp_c,v_other,v_real_inst,1,2,150,'pending',
    'Rollback competing backup',v_admin) RETURNING id INTO v_backup2;
  BEGIN
    UPDATE public.camp_backup_sessions SET status='approved' WHERE id=v_backup2;
    RAISE EXCEPTION 'QA_FAILED_BACKUP_OVERLAPPING_OTHER_CAMP_BACKUP';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'Cross-Camp Backup conflict: Instructor has approved Backup%' THEN RAISE; END IF;
  END;

  IF (SELECT status FROM public.camp_backup_sessions WHERE id=v_backup1) <> 'pending'
    OR (SELECT status FROM public.camp_backup_sessions WHERE id=v_backup2) <> 'pending'
  THEN RAISE EXCEPTION 'Rejected backup changed status'; END IF;
  RAISE NOTICE 'PASS cross-Camp Backup/Primary, Primary/Backup and Backup/Backup conflicts, rollback only';
END $qa$;
ROLLBACK;
