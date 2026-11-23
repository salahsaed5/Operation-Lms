-- Phase 5C/Production release gate: ensure public Data API roles cannot
-- bypass RLS with TRUNCATE/TRIGGER/REFERENCES or raw attendance writes.
-- Read-only and safe to run repeatedly on Staging.
DO $$
DECLARE rec record; v_name text; v_right text; v_role text;
BEGIN
  FOR rec IN SELECT schemaname,tablename FROM pg_tables WHERE schemaname='public' LOOP
    v_name:=format('%I.%I',rec.schemaname,rec.tablename);
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH v_right IN ARRAY ARRAY['TRUNCATE','TRIGGER','REFERENCES'] LOOP
        IF has_table_privilege(v_role,v_name,v_right) THEN
          RAISE EXCEPTION 'SECURITY FAIL: % still has % on %',v_role,v_right,v_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  IF NOT has_table_privilege('authenticated','public.attendance_records','SELECT') THEN
    RAISE EXCEPTION 'SECURITY FAIL: Instructor attendance SELECT lost';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_right IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(v_role,'public.attendance_records',v_right) THEN
        RAISE EXCEPTION 'SECURITY FAIL: % can % attendance_records',v_role,v_right;
      END IF;
    END LOOP;
  END LOOP;
  IF has_function_privilege('anon','public.save_attendance_draft_cas_tx(uuid,jsonb,jsonb,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY FAIL: anonymous attendance CAS RPC';
  END IF;
  IF NOT has_function_privilege('authenticated','public.save_attendance_draft_cas_tx(uuid,jsonb,jsonb,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY FAIL: signed-in attendance CAS RPC disabled';
  END IF;
  RAISE NOTICE 'PASS: public table structural privileges removed and attendance restricted to CAS';
END $$;
