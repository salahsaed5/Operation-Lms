-- Additive archive marker and transactional, guarded permanent removal.
ALTER TABLE public.instructors ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE OR REPLACE FUNCTION public.guard_archived_instructor_activation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.is_active AND NOT OLD.is_active AND EXISTS(SELECT 1 FROM public.instructors i WHERE i.profile_id=NEW.id AND i.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Restore instructor from archive before activation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_archived_instructor_activation ON public.profiles;
CREATE TRIGGER trg_guard_archived_instructor_activation BEFORE UPDATE OF is_active ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_archived_instructor_activation();

CREATE OR REPLACE FUNCTION public.manage_instructor_removal_tx(p_instructor_id uuid,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_profile uuid; v_active boolean; v_archived timestamptz; v_ref record; v_id uuid; v_exists boolean;
BEGIN
  IF auth.uid() IS NULL OR public.is_cits_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Verified MFA Admin required'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('archive','restore','delete') THEN RAISE EXCEPTION 'Invalid action'; END IF;
  SELECT i.profile_id,i.archived_at,p.is_active INTO v_profile,v_archived,v_active FROM public.instructors i JOIN public.profiles p ON p.id=i.profile_id
  WHERE i.id=p_instructor_id AND p.role='instructor' FOR UPDATE OF i,p;
  IF NOT FOUND OR v_profile=auth.uid() THEN RAISE EXCEPTION 'Instructor not found'; END IF;
  IF v_active THEN RAISE EXCEPTION 'Disable the instructor first'; END IF;
  IF p_action='archive' THEN
    UPDATE public.instructors SET archived_at=COALESCE(archived_at,now()) WHERE id=p_instructor_id;
  ELSIF p_action='restore' THEN
    UPDATE public.instructors SET archived_at=NULL WHERE id=p_instructor_id;
  ELSE
    -- Protect ALL public FK references (even CASCADE / SET NULL), including future tables.
    -- Locks above serialize concurrent FK inserts; only the instructor's own profile link is exempt.
    FOR v_ref IN SELECT c.conrelid::regclass AS rel,c.confrelid AS target,c.conkey,
      (SELECT a.attname FROM pg_attribute a WHERE a.attrelid=c.conrelid AND a.attnum=c.conkey[1]) AS col
      FROM pg_constraint c WHERE c.contype='f' AND c.connamespace='public'::regnamespace
      AND c.confrelid IN ('public.instructors'::regclass,'public.profiles'::regclass)
    LOOP
      IF v_ref.rel='public.instructors'::regclass AND v_ref.target='public.profiles'::regclass AND v_ref.col='profile_id' THEN CONTINUE; END IF;
      IF cardinality(v_ref.conkey)<>1 THEN RAISE EXCEPTION 'Account dependencies require manual review; archive instead'; END IF;
      v_id:=CASE WHEN v_ref.target='public.instructors'::regclass THEN p_instructor_id ELSE v_profile END;
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE %I=$1)',v_ref.rel,v_ref.col) INTO v_exists USING v_id;
      IF v_exists THEN RAISE EXCEPTION 'Instructor has linked records (%). Archive instead to preserve history.',v_ref.rel; END IF;
    END LOOP;
    IF EXISTS(SELECT 1 FROM storage.objects WHERE owner_id=v_profile::text OR owner=v_profile) THEN RAISE EXCEPTION 'Instructor owns stored files. Archive instead.'; END IF;
    -- Same PostgreSQL transaction: no orphaned app/Auth account if any delete fails.
    DELETE FROM public.instructors WHERE id=p_instructor_id;
    DELETE FROM public.profiles WHERE id=v_profile AND role='instructor';
    DELETE FROM auth.users WHERE id=v_profile;
    IF NOT FOUND THEN RAISE EXCEPTION 'Auth account missing; no records removed'; END IF;
  END IF;
  PERFORM public.append_audit_log_internal(NULL,'INSTRUCTOR_'||upper(p_action),'instructors',p_instructor_id::text,NULL,jsonb_build_object('operation',p_action),'Verified admin instructor lifecycle action');
  RETURN jsonb_build_object('ok',true,'action',p_action);
END $$;
REVOKE ALL ON FUNCTION public.manage_instructor_removal_tx(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_instructor_removal_tx(uuid,text) TO authenticated;
