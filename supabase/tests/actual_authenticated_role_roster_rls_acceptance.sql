-- Production-acceptance Staging RLS test using the ACTUAL authenticated
-- PostgreSQL role (not postgres with impersonated JWT claims only).
-- All visitor fixtures and temporary JWT settings are rolled back.
DO $$
DECLARE
  v_camp uuid; v_home_group uuid; v_lecture uuid;
  v_instructor_uid uuid; v_admin_uid uuid;
  v_visitor_group uuid; v_visitor_student uuid;
  v_count integer;
BEGIN
  SELECT c.id,g.id,l.id,i.profile_id
  INTO v_camp,v_home_group,v_lecture,v_instructor_uid
  FROM public.camps c
  JOIN public.groups g ON g.camp_id=c.id
  JOIN public.lectures l ON l.camp_id=c.id AND l.group_id=g.id AND l.camp_day=c.current_camp_day
  JOIN public.instructors i ON i.id=COALESCE(l.substitute_instructor_id,l.instructor_id)
  WHERE c.code='STG-TEST-01' AND c.status='draft'
  LIMIT 1;

  SELECT p.id INTO v_admin_uid FROM public.profiles p
  JOIN public.admin_accounts a ON a.profile_id=p.id
  WHERE p.role='admin' AND p.is_active AND NOT p.must_change_password
  ORDER BY a.assigned_slot DESC LIMIT 1;

  IF v_camp IS NULL OR v_admin_uid IS NULL THEN
    RAISE EXCEPTION 'Missing staging acceptance camp, instructor, or Admin';
  END IF;

  BEGIN
    INSERT INTO public.groups(camp_id,code,name_en,name_ar,track,capacity)
    VALUES(v_camp,'STG-RLS-ROLLBACK','Visitor group RLS temporary',
      'مجموعة مؤقتة لاختبار الصلاحيات','Acceptance',30)
    RETURNING id INTO v_visitor_group;

    INSERT INTO public.students(camp_id,group_id,student_code,full_name,is_active)
    VALUES(v_camp,v_visitor_group,'STG-RLS-OTHER','RLS Hidden Student',true)
    RETURNING id INTO v_visitor_student;

    -- Switch to the real Data API role; database RLS now applies to SELECT.
    PERFORM set_config('request.jwt.claim.sub',v_instructor_uid::text,true);
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub',v_instructor_uid,'role','authenticated','aal','aal1')::text,true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    SELECT count(*) INTO v_count FROM public.students
    WHERE group_id=v_home_group;
    IF v_count<>3 THEN RAISE EXCEPTION 'TEST FAILED: own-group roster visibility %, expected 3',v_count; END IF;

    SELECT count(*) INTO v_count FROM public.students
    WHERE student_code='STG-RLS-OTHER';
    IF v_count<>0 THEN RAISE EXCEPTION 'TEST FAILED: instructor can read unassigned group'; END IF;

    -- The deliberately narrow server search RPC may return visiting identity.
    SELECT count(*) INTO v_count
    FROM public.search_visiting_students_for_lecture(v_lecture,'STG-RLS-OTHER')
    WHERE student_id=v_visitor_student;
    IF v_count<>1 THEN RAISE EXCEPTION 'TEST FAILED: authorized visiting search not available'; END IF;

    -- The Admin role with MFA AAL2 can see both rosters.
    PERFORM set_config('request.jwt.claim.sub',v_admin_uid::text,true);
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub',v_admin_uid,'role','authenticated','aal','aal2')::text,true);
    SELECT count(*) INTO v_count FROM public.students
    WHERE student_code='STG-RLS-OTHER';
    IF v_count<>1 THEN RAISE EXCEPTION 'TEST FAILED: authorized Admin cannot see student'; END IF;

    RAISE EXCEPTION 'ROLLBACK_RLS_ACCEPTANCE_PASSED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_RLS_ACCEPTANCE_PASSED' THEN RAISE; END IF;
  END;

  IF EXISTS(SELECT 1 FROM public.students WHERE id=v_visitor_student)
    OR EXISTS(SELECT 1 FROM public.groups WHERE id=v_visitor_group) THEN
    RAISE EXCEPTION 'TEST FAILED: RLS fixtures persisted after rollback';
  END IF;
  RAISE NOTICE 'PASS actual authenticated RLS: own roster, hidden visitor, scoped search, Admin AAL2';
END $$;
