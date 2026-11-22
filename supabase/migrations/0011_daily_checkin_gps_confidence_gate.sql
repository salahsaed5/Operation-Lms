-- 0011: GPS confidence gate for every Instructor daily Check-in write.
-- Defense in depth: browser coordinates are NOT an attested hardware proof.
-- This migration does NOT claim to prevent OS-mocked GPS or custom API calls.
-- It stops poor-accuracy submissions and prevents the server from marking
-- borderline/uncertain measurements as verified or late-inside-geofence.
--
-- Apply only after review against the Staging schema and behavioral tests.
-- No live database is changed simply by adding this file.

CREATE OR REPLACE FUNCTION public.enforce_daily_checkin_gps_confidence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_venue_lat DOUBLE PRECISION;
  v_venue_lon DOUBLE PRECISION;
  v_radius DOUBLE PRECISION;
  v_distance DOUBLE PRECISION;
  v_required_accuracy DOUBLE PRECISION;
BEGIN
  SELECT v.latitude, v.longitude,
         COALESCE(cs.geofence_radius_meters, v.geofence_radius_meters, 100)
  INTO v_venue_lat, v_venue_lon, v_radius
  FROM public.camps c
  JOIN public.venues v ON v.id = c.venue_id
  LEFT JOIN public.camp_settings cs ON cs.camp_id = c.id
  WHERE c.id = NEW.camp_id;
  IF NOT FOUND OR v_radius IS NULL OR v_radius <= 0 THEN
    RAISE EXCEPTION 'Check-in GPS policy: valid camp venue and radius are required.';
  END IF;

  v_required_accuracy := LEAST(50.0, v_radius / 2.0);
  IF NEW.gps_accuracy_meters IS NULL
     OR NOT (NEW.gps_accuracy_meters >= 1.0
             AND NEW.gps_accuracy_meters <= v_required_accuracy) THEN
    RAISE EXCEPTION 'Check-in GPS policy: location accuracy must be between 1 and % meters. Enable precise location and retake a new selfie.', v_required_accuracy;
  END IF;

  v_distance := public.haversine_distance_meters(
    NEW.latitude, NEW.longitude, v_venue_lat, v_venue_lon
  );

  -- IMPORTANT: a point inside the radius is insufficient when the uncertainty
  -- circle overlaps the boundary. This test runs inside the SAME transaction
  -- as the existing server-side check-in RPC.
  IF NEW.status IN ('verified', 'late_first_lecture')
     AND v_distance + NEW.gps_accuracy_meters > v_radius THEN
    RAISE EXCEPTION 'Check-in GPS policy: reading is too close to the geofence boundary to verify. Move nearer the venue and retake.';
  END IF;

  RETURN NULL; -- ignored by AFTER triggers
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_daily_checkin_gps_confidence() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_zz_daily_checkin_gps_confidence ON public.daily_checkins;
CREATE TRIGGER trg_zz_daily_checkin_gps_confidence
AFTER INSERT OR UPDATE OF latitude, longitude, gps_accuracy_meters, status
ON public.daily_checkins
FOR EACH ROW EXECUTE FUNCTION public.enforce_daily_checkin_gps_confidence();

COMMENT ON FUNCTION public.enforce_daily_checkin_gps_confidence() IS
  'Rejects weak GPS accuracy and conservative geofence uncertainty for check-in writes; does not attest hardware authenticity.';
