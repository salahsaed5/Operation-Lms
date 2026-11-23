-- Phase 5B + recurring Camp teaching days: an actual Day-4 enrollment.
-- Dedicated synthetic Camp: all rows are removed by a PL/pgSQL subtransaction rollback.
DO $$
DECLARE
  v_camp uuid;
  v_group uuid;
  v_sheet uuid;
  v_lecture uuid;
  v_inst uuid;
  v_uid uuid;
  v_admin uuid;
  v_venue uuid;
  v_room uuid;
  v_day integer;
  v_student uuid;
  v_today date := (now() AT TIME ZONE 'Africa/Cairo')::date;
  v_start date := (now() AT TIME ZONE 'Africa/Cairo')::date-7;
  v_dow integer := extract(dow from (now() AT TIME ZONE 'Africa/Cairo')::date);
  v_weekdays integer[];
BEGIN
  -- Every seventh day has the same weekday; with three selected weekdays,
  -- Day 4 is precisely the following week's same weekday (today).
  v_weekdays := ARRAY[v_dow,(v_dow+2)%7,(v_dow+4)%7];
  IF public.camp_teaching_date(v_start,4,v_weekdays) <> v_today THEN
    RAISE EXCEPTION 'Day-four calendar fixture is invalid';
  END IF;
  SELECT p.id INTO v_admin FROM public.profiles p
    JOIN public.admin_accounts a ON a.profile_id=p.id
    WHERE p.role='admin' AND p.is_active LIMIT 1;
  SELECT i.id,i.profile_id INTO v_inst,v_uid FROM public.instructors i
    JOIN public.profiles p ON p.id=i.profile_id WHERE p.is_active LIMIT 1;
  SELECT r.id,r.venue_id INTO v_room,v_venue FROM public.rooms r WHERE r.is_active LIMIT 1;
  IF v_admin IS NULL OR v_uid IS NULL OR v_room IS NULL THEN
    RAISE EXCEPTION 'Staging requires approved active Admin, Instructor and Room fixtures';
  END IF;
  BEGIN
    INSERT INTO public.camps
      (code,name_en,name_ar,status,venue_id,start_date,end_date,duration_days,current_camp_day,
       operating_weekdays,created_by)
    VALUES ('QA-DAY4-'||substr(gen_random_uuid()::text,1,8),
      'Rollback Day4 Camp','Rollback Day4 Camp','active',v_venue,
      v_start,v_today+30,10,4,v_weekdays,v_admin)
    RETURNING id INTO v_camp;
    INSERT INTO public.camp_instructors(camp_id,instructor_id) VALUES(v_camp,v_inst);
    INSERT INTO public.groups(camp_id,code,name_en,name_ar,track)
    VALUES(v_camp,'DAY4-G','Day 4 group','Day 4 group','QA')
    RETURNING id INTO v_group;
    INSERT INTO public.group_instructors(camp_id,group_id,instructor_id,assigned_by)
    VALUES(v_camp,v_group,v_inst,v_admin);
    INSERT INTO public.lectures
      (camp_id,camp_day,lecture_date,period_number,start_time,end_time,group_id,instructor_id,
       room_id,topic,frozen_rate_egp)
    VALUES(v_camp,1,v_start,1,'09:00','12:00',v_group,v_inst,v_room,'Day 1 prejoin QA',300)
    RETURNING id INTO v_lecture;
    PERFORM set_config('request.jwt.claim.sub',v_uid::text,true);
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    INSERT INTO public.attendance_sheets
      (camp_id,lecture_id,instructor_id,idempotency_key)
    VALUES (v_camp,v_lecture,v_inst,'rollback-day4-'||v_lecture::text)
    RETURNING id INTO v_sheet;
    v_student:=public.instructor_enroll_midcamp_student_tx(
      v_group,'STG-ROLLBACK-D4','Synthetic Midcamp Acceptance Student',
      'Staging University','Teaching-day four enrollment acceptance'
    );
    SELECT joined_camp_day INTO v_day FROM public.students WHERE id=v_student;
    IF v_day<>4 THEN RAISE EXCEPTION 'TEST FAILED: join day was %, not Day 4',v_day; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.students WHERE id=v_student
      AND enrolled_by_profile_id=v_uid AND enrollment_origin='instructor_late_join') THEN
      RAISE EXCEPTION 'TEST FAILED: enrollment provenance missing';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id=v_student::text
      AND action='STUDENT_ENROLLED_MIDCAMP') THEN
      RAISE EXCEPTION 'TEST FAILED: enrollment audit missing';
    END IF;

    BEGIN
      INSERT INTO public.attendance_records(
        camp_id,attendance_sheet_id,lecture_id,camp_day,period_number,
        student_id,origin_group_id,attended_group_id,is_cross_group,mark,updated_by)
      VALUES(v_camp,v_sheet,v_lecture,1,1,v_student,v_group,v_group,false,'absent',v_uid);
      RAISE EXCEPTION 'TEST FAILED: prejoin Day-1 absence accepted';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE 'Attendance cannot be recorded before a student joined%' THEN
        RAISE EXCEPTION 'TEST FAILED: unexpected prejoin error: %',SQLERRM;
      END IF;
    END;

    -- Camp is active, but its recorded Day 3 is a previous calendar date.
    -- Day-4 student enrollment must fail closed until currentCampDay matches today.
    UPDATE public.camps SET current_camp_day=3 WHERE id=v_camp;
    BEGIN
      PERFORM public.instructor_enroll_midcamp_student_tx(
        v_group,'STG-ROLLBACK-OFF','Rejected wrong-day student',
        'Staging University','Reject wrong day enrollment'
      );
      RAISE EXCEPTION 'TEST FAILED: enrollment on a mismatched teaching date succeeded';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE 'Mid-camp enrollment requires the current scheduled teaching date%' THEN
        RAISE EXCEPTION 'TEST FAILED: wrong-day guard returned: %',SQLERRM;
      END IF;
    END;

    RAISE EXCEPTION 'ROLLBACK_VERIFIED_DAY4_FIXTURE';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_VERIFIED_DAY4_FIXTURE' THEN RAISE; END IF;
  END;
  IF EXISTS(SELECT 1 FROM public.camps WHERE id=v_camp) THEN
    RAISE EXCEPTION 'TEST FAILED: synthetic Camp was not rolled back';
  END IF;
  IF EXISTS(SELECT 1 FROM public.students WHERE student_code='STG-ROLLBACK-D4') THEN
    RAISE EXCEPTION 'TEST FAILED: synthetic student persisted';
  END IF;
  RAISE NOTICE 'PASS Day-4 enrolled by actual teaching day, provenance, prejoin denial and off-day guard';
END $$;
