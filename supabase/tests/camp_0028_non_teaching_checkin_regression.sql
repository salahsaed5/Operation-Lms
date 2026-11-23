-- Staging-only check-in calendar guard acceptance. Synthetic QA Camp never persists.
BEGIN;
DO $qa$
DECLARE
  v_admin uuid;
  v_inst uuid;
  v_venue uuid;
  v_lat float8;
  v_lon float8;
  v_camp uuid;
  v_today date:=(now() AT TIME ZONE 'Africa/Cairo')::date;
  v_tomorrow date:=(now() AT TIME ZONE 'Africa/Cairo')::date+1;
  v_dow integer;
BEGIN
  SELECT id,latitude,longitude INTO v_venue,v_lat,v_lon FROM public.venues LIMIT 1;
  SELECT p.id INTO v_admin FROM public.profiles p
  JOIN public.admin_accounts a ON a.profile_id=p.id
  WHERE p.role='admin' AND p.is_active AND NOT p.must_change_password LIMIT 1;
  SELECT i.id INTO v_inst FROM public.instructors i
  JOIN public.profiles p ON p.id=i.profile_id WHERE p.is_active LIMIT 1;
  IF v_venue IS NULL OR v_admin IS NULL OR v_inst IS NULL THEN
    RAISE EXCEPTION 'Staging check-in QA requires Admin, Instructor and Venue';
  END IF;
  v_dow:=extract(dow from v_tomorrow);
  INSERT INTO public.camps
    (code,name_en,name_ar,status,venue_id,start_date,end_date,duration_days,
     current_camp_day,operating_weekdays,created_by)
  VALUES('QA-OFF-'||substr(gen_random_uuid()::text,1,8),
    'Offday QA','Offday QA','draft',v_venue,
    v_tomorrow,v_tomorrow+63,10,1,ARRAY[v_dow],v_admin)
  RETURNING id INTO v_camp;
  INSERT INTO public.camp_instructors(camp_id,instructor_id) VALUES(v_camp,v_inst);
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);

  -- Admin AAL2 can ordinarily bypass Instructor check-in ACL.
  -- Calendar guard still refuses today when Day 1 begins tomorrow.
  BEGIN
    INSERT INTO public.daily_checkins
      (camp_id,instructor_id,camp_day,checkin_date,latitude,longitude,
       gps_accuracy_meters,distance_from_venue_meters,within_geofence,selfie_size_kb,status)
    VALUES(v_camp,v_inst,1,v_today,v_lat,v_lon,15,0,true,10,'verified');
    RAISE EXCEPTION 'QA_FAIL_OFF_DAY_CHECKIN_ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'Check-in is allowed only on the current scheduled teaching date%'
    THEN RAISE; END IF;
  END;

  IF EXISTS(SELECT 1 FROM public.daily_checkins WHERE camp_id=v_camp) THEN
    RAISE EXCEPTION 'Blocked off-day check-in left a persisted row';
  END IF;
  RAISE NOTICE 'PASS recurring Camp check-in denied outside the selected teaching date';
END $qa$;
ROLLBACK;
