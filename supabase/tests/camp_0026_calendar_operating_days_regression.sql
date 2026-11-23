-- Camp Calendar 0026 rollback-only acceptance. No persistent Camp, lecture or payment.
BEGIN;
DO $calendar_acceptance$
DECLARE
  v_admin uuid;
  v_inst uuid;
  v_room uuid;
  v_venue uuid;
  v_camp uuid;
  v_group uuid;
  v_day2 date;
  v_day15 date;
  v_end date;
BEGIN
  IF public.camp_teaching_date('2026-11-28',1,ARRAY[1,3,6]) <> '2026-11-28' OR
     public.camp_teaching_date('2026-11-28',2,ARRAY[1,3,6]) <> '2026-11-30' OR
     public.camp_teaching_date('2026-11-28',3,ARRAY[1,3,6]) <> '2026-12-02' OR
     public.camp_teaching_date('2026-11-28',10,ARRAY[1,3,6]) <> '2026-12-19' OR
     public.camp_teaching_date('2026-11-29',15,ARRAY[0,2,4]) <> '2026-12-31' OR
     public.camp_teaching_date('2026-11-29',10,ARRAY[0,1,2,3,4,5,6]) <> '2026-12-08'
  THEN RAISE EXCEPTION 'Calendar mapping for 10/15-day sessions is incorrect'; END IF;

  BEGIN
    PERFORM public.camp_teaching_date('2026-11-30',10,ARRAY[0,2,4]);
    RAISE EXCEPTION 'QA_FAILED_NON_TEACHING_START_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'Camp start date must be a selected teaching weekday%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.camp_teaching_date('2026-11-29',10,ARRAY[0,0,2]);
    RAISE EXCEPTION 'QA_FAILED_DUPLICATE_DAYS_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Invalid camp calendar configuration' THEN RAISE; END IF;
  END;

  SELECT p.id INTO v_admin FROM public.profiles p
    JOIN public.admin_accounts a ON a.profile_id=p.id
    WHERE p.role='admin' AND p.is_active LIMIT 1;
  SELECT i.id INTO v_inst FROM public.instructors i JOIN public.profiles p ON p.id=i.profile_id
    WHERE p.is_active LIMIT 1;
  SELECT r.id,r.venue_id INTO v_room,v_venue FROM public.rooms r WHERE r.is_active LIMIT 1;
  IF v_admin IS NULL OR v_inst IS NULL OR v_room IS NULL THEN
    RAISE EXCEPTION 'Staging QA requires existing active admin, instructor and room';
  END IF;
  INSERT INTO public.camps
    (code,name_en,name_ar,venue_id,start_date,end_date,duration_days,
     operating_weekdays,created_by)
  VALUES ('QA-CAL-'||substr(gen_random_uuid()::text,1,8),
          'Calendar QA','Calendar QA',v_venue,'2026-11-29','2026-12-13',15,
          ARRAY[0,2,4],v_admin)
  RETURNING id,end_date INTO v_camp,v_end;
  IF v_end <> '2026-12-31' THEN RAISE EXCEPTION 'End date was not calculated from 15 teaching sessions'; END IF;
  INSERT INTO public.camp_instructors(camp_id,instructor_id) VALUES(v_camp,v_inst);
  INSERT INTO public.groups(camp_id,code,name_en,name_ar,track)
  VALUES(v_camp,'QA-G','Calendar QA Group','Calendar QA Group','QA')
  RETURNING id INTO v_group;
  INSERT INTO public.group_instructors(camp_id,group_id,instructor_id)
  VALUES(v_camp,v_group,v_inst);

  v_day2 := public.camp_teaching_date('2026-11-29',2,ARRAY[0,2,4]);
  v_day15 := public.camp_teaching_date('2026-11-29',15,ARRAY[0,2,4]);
  BEGIN
    INSERT INTO public.lectures
      (camp_id,camp_day,lecture_date,period_number,start_time,end_time,
       group_id,instructor_id,room_id,topic,frozen_rate_egp)
    VALUES (v_camp,2,'2026-11-30',1,'09:00','12:00',
            v_group,v_inst,v_room,'Wrong Monday date',300);
    RAISE EXCEPTION 'QA_FAILED_OFF_DAY_LECTURE_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'Lecture date % does not match teaching Day %' THEN RAISE; END IF;
  END;
  INSERT INTO public.lectures
    (camp_id,camp_day,lecture_date,period_number,start_time,end_time,
     group_id,instructor_id,room_id,topic,frozen_rate_egp)
  VALUES
    (v_camp,2,v_day2,1,'09:00','12:00',v_group,v_inst,v_room,'QA Day 2',300),
    (v_camp,15,v_day15,1,'09:00','12:00',v_group,v_inst,v_room,'QA Day 15',300);

  BEGIN
    UPDATE public.camps SET operating_weekdays=ARRAY[0,1,2,3,4,5,6] WHERE id=v_camp;
    RAISE EXCEPTION 'QA_FAILED_MOVING_EXISTING_LECTURES_ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'Rescheduling would invalidate existing lecture dates%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.camps SET duration_days=10 WHERE id=v_camp;
    RAISE EXCEPTION 'QA_FAILED_TRUNCATING_DAY_15_ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'Rescheduling would invalidate existing lecture dates%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS calendar 0026: 10/15 teaching dates, correct end, rejects wrong weekdays, preserves scheduled lectures';
END;
$calendar_acceptance$;
ROLLBACK;
