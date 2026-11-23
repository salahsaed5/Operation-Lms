-- Phase 4 Staging GPS acceptance. All simulated activation, check-in,
-- fabricated selfie path and audit rows are rolled back by a subtransaction.
-- This does NOT test camera attestation or actual Storage uploads.
DO $$
DECLARE
  v_camp uuid; v_uid uuid; v_lat double precision; v_lon double precision;
  v_path text;
BEGIN
  SELECT c.id,i.profile_id,v.latitude,v.longitude
    INTO v_camp,v_uid,v_lat,v_lon
  FROM public.camps c
  JOIN public.venues v ON v.id=c.venue_id
  JOIN public.lectures l ON l.camp_id=c.id
  JOIN public.instructors i ON i.id=l.instructor_id
  WHERE c.code='STG-TEST-01' AND c.status='draft' LIMIT 1;
  IF v_camp IS NULL THEN RAISE EXCEPTION 'Missing Staging camp fixture'; END IF;

  v_path:=v_uid::text||'/'||v_camp::text||'/qa-rollback.webp';
  BEGIN
    UPDATE public.camps SET status='active' WHERE id=v_camp;
    PERFORM set_config('request.jwt.claim.sub',v_uid::text,true);
    PERFORM set_config('request.jwt.claim.role','authenticated',true);

    BEGIN
      PERFORM public.submit_daily_checkin_tx(
        v_camp,v_lat,v_lon,150,v_path,75,NULL);
      RAISE EXCEPTION 'TEST FAILED: poor GPS accepted';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE 'Check-in GPS policy: location accuracy%' THEN
        RAISE EXCEPTION 'Unexpected weak-GPS result: %',SQLERRM;
      END IF;
    END;

    PERFORM public.submit_daily_checkin_tx(
      v_camp,v_lat,v_lon,10,v_path,75,NULL);
    IF NOT EXISTS(
      SELECT 1 FROM public.daily_checkins
      WHERE camp_id=v_camp AND instructor_id=public.current_instructor_id()
        AND status='verified' AND within_geofence=true
        AND gps_accuracy_meters=10
    ) THEN RAISE EXCEPTION 'TEST FAILED: accurate GPS not verified'; END IF;

    BEGIN
      PERFORM public.submit_daily_checkin_tx(
        v_camp,v_lat+0.0008,v_lon,20,v_path,75,NULL);
      RAISE EXCEPTION 'TEST FAILED: uncertain geofence boundary accepted';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST FAILED:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE 'Check-in GPS policy: reading is too close%' THEN
        RAISE EXCEPTION 'Unexpected geofence-boundary error: %',SQLERRM;
      END IF;
    END;

    RAISE EXCEPTION 'ROLLBACK_GPS_TEST_PASSED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_GPS_TEST_PASSED' THEN RAISE; END IF;
  END;

  IF (SELECT status::text FROM public.camps WHERE id=v_camp)<>'draft' OR
    EXISTS(SELECT 1 FROM public.daily_checkins WHERE camp_id=v_camp) THEN
    RAISE EXCEPTION 'TEST FAILED: Staging camp or check-in was not restored';
  END IF;
  RAISE NOTICE 'PASS GPS accuracy, verified check-in, uncertain edge, rollback';
END $$;
