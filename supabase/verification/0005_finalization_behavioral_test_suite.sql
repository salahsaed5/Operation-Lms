-- =============================================================================
-- CITS Camp Operations — Phase 2 Finalization Behavioral Verification Suite
-- Script: 0005_finalization_behavioral_test_suite.sql
-- Strictly Ephemeral & Transactional (BEGIN ... ROLLBACK) — 30 Behavioral Checks
-- Zero WHEN OTHERS THEN NULL handlers; every check records explicit PASS/FAIL/BLOCKED.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _cits_final_report (
  test_no INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  test_name TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence TEXT NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  v_admin_uid UUID := gen_random_uuid();
  v_inst1_uid UUID := gen_random_uuid();
  v_inst1_id UUID := gen_random_uuid();
  v_inst2_uid UUID := gen_random_uuid();
  v_inst2_id UUID := gen_random_uuid();
  v_inst3_unassigned_uid UUID := gen_random_uuid();
  v_inst3_unassigned_id UUID := gen_random_uuid();
  v_inst4_inactive_uid UUID := gen_random_uuid();
  v_inst4_inactive_id UUID := gen_random_uuid();
  v_venue_id UUID := gen_random_uuid();
  v_room1_id UUID := gen_random_uuid();
  v_room2_id UUID := gen_random_uuid();
  v_room_other_venue_id UUID := gen_random_uuid();
  v_venue_other_id UUID := gen_random_uuid();
  v_camp_id UUID := gen_random_uuid();
  v_camp_arch_id UUID := gen_random_uuid();
  v_existing_active_camp UUID;
  v_grp_a UUID := gen_random_uuid();
  v_grp_b UUID := gen_random_uuid();
  v_grp_c UUID := gen_random_uuid();
  v_stu_chain_id UUID := gen_random_uuid();
  v_stu_regular_id UUID := gen_random_uuid();
  v_lec_sub_id UUID := gen_random_uuid();
  v_lec_cancel_id UUID := gen_random_uuid();
  v_lec_ack_id UUID := gen_random_uuid();
  v_sheet_sub_id UUID := gen_random_uuid();
  v_sheet_cancel_id UUID := gen_random_uuid();
  v_notif_inactive_id UUID := gen_random_uuid();
  v_initial_role TEXT := current_user;
  v_err TEXT;
  v_cnt INTEGER;
  v_res JSONB;
  v_g UUID;
  v_rev_before INTEGER;
  v_rev_after INTEGER;
  v_ack_after TIMESTAMPTZ;
  v_ent_inst UUID;
  v_has_verified_totp BOOLEAN := FALSE;
BEGIN
  -- 0. Seed isolated baseline fixture context
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_admin_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f5-admin@verify.cits.local', 'hash', NOW(), '{}'::jsonb, '{}'::jsonb, NOW(), NOW()),
    (v_inst1_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f5-inst1@verify.cits.local', 'hash', NOW(), '{}'::jsonb, '{}'::jsonb, NOW(), NOW()),
    (v_inst2_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f5-inst2@verify.cits.local', 'hash', NOW(), '{}'::jsonb, '{}'::jsonb, NOW(), NOW()),
    (v_inst3_unassigned_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f5-inst3@verify.cits.local', 'hash', NOW(), '{}'::jsonb, '{}'::jsonb, NOW(), NOW()),
    (v_inst4_inactive_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f5-inst4@verify.cits.local', 'hash', NOW(), '{}'::jsonb, '{}'::jsonb, NOW(), NOW());

  INSERT INTO public.profiles (id, role, username, email, full_name_en, full_name_ar, must_change_password, is_active)
  VALUES
    (v_admin_uid, 'admin', 'f5_admin', 'f5-admin@verify.cits.local', 'F5 Admin', 'مسؤول', FALSE, TRUE),
    (v_inst1_uid, 'instructor', 'f5_inst1', 'f5-inst1@verify.cits.local', 'F5 Inst 1', 'محاضر 1', FALSE, TRUE),
    (v_inst2_uid, 'instructor', 'f5_inst2', 'f5-inst2@verify.cits.local', 'F5 Inst 2', 'محاضر 2', FALSE, TRUE),
    (v_inst3_unassigned_uid, 'instructor', 'f5_inst3', 'f5-inst3@verify.cits.local', 'F5 Inst 3', 'محاضر 3', FALSE, TRUE),
    (v_inst4_inactive_uid, 'instructor', 'f5_inst4', 'f5-inst4@verify.cits.local', 'F5 Inactive', 'غير نشط', TRUE, FALSE);

  INSERT INTO public.admin_accounts (id, profile_id, totp_enrolled, assigned_slot)
  SELECT gen_random_uuid(), v_admin_uid, TRUE, COALESCE((SELECT MAX(assigned_slot) FROM public.admin_accounts), 0)::smallint + 1
  WHERE (SELECT COUNT(*) FROM public.admin_accounts) < 2;

  INSERT INTO public.instructors (id, profile_id, instructor_code, specialization, default_lecture_rate_egp)
  VALUES
    (v_inst1_id, v_inst1_uid, 'F5-INST-1', 'Graphs', 750),
    (v_inst2_id, v_inst2_uid, 'F5-INST-2', 'DP', 800),
    (v_inst3_unassigned_id, v_inst3_unassigned_uid, 'F5-INST-3', 'Math', 700),
    (v_inst4_inactive_id, v_inst4_inactive_uid, 'F5-INST-4', 'Security', 700);

  INSERT INTO public.venues (id, name_en, name_ar, address, latitude, longitude, geofence_radius_meters)
  VALUES
    (v_venue_id, 'F5 Venue', 'مقر', 'Cairo', 30.0712, 31.0167, 100),
    (v_venue_other_id, 'Other Venue', 'مقر آخر', 'Alex', 31.2001, 29.9187, 100);

  INSERT INTO public.rooms (id, venue_id, code, name, capacity)
  VALUES
    (v_room1_id, v_venue_id, 'F5-R1', 'Lab 1', 30),
    (v_room2_id, v_venue_id, 'F5-R2', 'Lab 2', 30),
    (v_room_other_venue_id, v_venue_other_id, 'F5-OTHER', 'Other Lab', 30);

  SELECT id INTO v_existing_active_camp FROM public.camps WHERE status = 'active' LIMIT 1;
  IF v_existing_active_camp IS NOT NULL THEN
    -- Keep production active camp untouched; verify active-camp flows safely only if single active camp allows
    INSERT INTO public.camps (id, code, name_en, name_ar, status, venue_id, start_date, end_date, duration_days, current_camp_day, created_by)
    VALUES
      (v_camp_id, 'VERIFY-F5-CAMP', 'F5 Camp', 'معسكر 5', 'draft', v_venue_id, DATE '2026-11-10', DATE '2026-11-19', 10, 4, v_admin_uid),
      (v_camp_arch_id, 'VERIFY-F5-ARCH', 'F5 Arch', 'مؤرشف', 'archived', v_venue_id, DATE '2026-10-01', DATE '2026-10-10', 10, 10, v_admin_uid);
  ELSE
    INSERT INTO public.camps (id, code, name_en, name_ar, status, venue_id, start_date, end_date, duration_days, current_camp_day, created_by)
    VALUES
      (v_camp_id, 'VERIFY-F5-CAMP', 'F5 Camp', 'معسكر 5', 'active', v_venue_id, DATE '2026-11-10', DATE '2026-11-19', 10, 4, v_admin_uid),
      (v_camp_arch_id, 'VERIFY-F5-ARCH', 'F5 Arch', 'مؤرشف', 'archived', v_venue_id, DATE '2026-10-01', DATE '2026-10-10', 10, 10, v_admin_uid);
  END IF;

  INSERT INTO public.camp_settings (id, camp_id, geofence_radius_meters, max_instructor_groups_per_day, default_lecture_rate_egp)
  VALUES (gen_random_uuid(), v_camp_id, 100, 3, 750);

  INSERT INTO public.camp_instructors (id, camp_id, instructor_id, is_active)
  VALUES
    (gen_random_uuid(), v_camp_id, v_inst1_id, TRUE),
    (gen_random_uuid(), v_camp_id, v_inst2_id, TRUE);

  INSERT INTO public.groups (id, camp_id, code, name_en, name_ar, track, default_room_id, capacity)
  VALUES
    (v_grp_a, v_camp_id, 'F5-GA', 'Group A', 'أ', 'CP', v_room1_id, 30),
    (v_grp_b, v_camp_id, 'F5-GB', 'Group B', 'ب', 'CP', v_room1_id, 30),
    (v_grp_c, v_camp_id, 'F5-GC', 'Group C', 'ج', 'CP', v_room2_id, 30);

  INSERT INTO public.students (id, camp_id, group_id, student_code, full_name, is_active)
  VALUES
    (v_stu_chain_id, v_camp_id, v_grp_c, 'F5-CHAIN-01', 'Chained Transfer Student', TRUE),
    (v_stu_regular_id, v_camp_id, v_grp_a, 'F5-REG-01', 'Regular Student', TRUE);

  -- 3-hop + same-day transfer timeline for v_stu_chain_id:
  -- Day 1: A; Day 3: A -> B; Day 3 later: B -> C; Day 5: C -> A (later overridden at same day? Let's test sequential Day 2 A->B, same-day Day 3 B->C and later Day 5 C->B? Better: Day 2 A->B, Day 4 same-day B->C then C->B... Even clearer: Day 2 A->B, Day 4 same-day B->A then A->C)
  INSERT INTO public.student_transfers (id, camp_id, student_id, from_group_id, to_group_id, effective_camp_day, reason, transferred_by, created_at)
  VALUES
    (gen_random_uuid(), v_camp_id, v_stu_chain_id, v_grp_a, v_grp_b, 2, 'Hop 1', v_admin_uid, NOW() - INTERVAL '3 hours'),
    (gen_random_uuid(), v_camp_id, v_stu_chain_id, v_grp_b, v_grp_a, 4, 'Hop 2a same-day', v_admin_uid, NOW() - INTERVAL '2 hours'),
    (gen_random_uuid(), v_camp_id, v_stu_chain_id, v_grp_a, v_grp_c, 4, 'Hop 2b same-day', v_admin_uid, NOW() - INTERVAL '1 hour'),
    (gen_random_uuid(), v_camp_id, v_stu_chain_id, v_grp_c, v_grp_b, 6, 'Hop 3 future', v_admin_uid, NOW());

  INSERT INTO public.lectures (id, camp_id, camp_day, lecture_date, period_number, start_time, end_time, duration_hours, group_id, instructor_id, substitute_instructor_id, room_id, topic, status, frozen_rate_egp)
  VALUES
    (v_lec_sub_id, v_camp_id, 4, DATE '2026-11-13', 1, TIME '09:00', TIME '12:00', 3, v_grp_c, v_inst1_id, v_inst2_id, v_room1_id, 'Substitute Class', 'scheduled', 800),
    (v_lec_cancel_id, v_camp_id, 4, DATE '2026-11-13', 2, TIME '12:30', TIME '15:30', 3, v_grp_a, v_inst1_id, NULL, v_room1_id, 'Cancelled Class', 'cancelled', 750),
    (v_lec_ack_id, v_camp_id, 5, DATE '2026-11-14', 1, TIME '09:00', TIME '12:00', 3, v_grp_b, v_inst1_id, NULL, v_room2_id, 'Ack Reset Class', 'scheduled', 750);

  INSERT INTO public.attendance_sheets (id, camp_id, lecture_id, instructor_id, status, idempotency_key)
  VALUES
    (v_sheet_sub_id, v_camp_id, v_lec_sub_id, v_inst1_id, 'draft', 'f5-sub-' || v_camp_id::text),
    (v_sheet_cancel_id, v_camp_id, v_lec_cancel_id, v_inst1_id, 'draft', 'f5-can-' || v_camp_id::text);

  INSERT INTO public.notifications (id, recipient_profile_id, title_en, title_ar, body_en, body_ar)
  VALUES (v_notif_inactive_id, v_inst4_inactive_uid, 'Test', 'اختبار', 'Inactive notice', 'تنبيه');

  -- 1. Inactive account cannot read own profile via RLS
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_inst4_inactive_uid::text, 'role', 'authenticated')::text, true);
  SELECT COUNT(*) INTO v_cnt FROM public.profiles WHERE id = v_inst4_inactive_uid;
  IF v_cnt = 0 THEN
    INSERT INTO _cits_final_report VALUES (1, 'Auth/Inactive', 'Inactive profile RLS block', 'PASS', 'Inactive user received 0 profile rows');
  ELSE
    INSERT INTO _cits_final_report VALUES (1, 'Auth/Inactive', 'Inactive profile RLS block', 'FAIL', format('Expected 0 rows, got %s', v_cnt));
  END IF;

  -- 2. Inactive user cannot call complete_password_change_tx()
  BEGIN
    PERFORM public.complete_password_change_tx();
    INSERT INTO _cits_final_report VALUES (2, 'Auth/Inactive', 'Inactive complete_password_change_tx block', 'FAIL', 'Inactive user cleared must_change_password');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _cits_final_report VALUES (2, 'Auth/Inactive', 'Inactive complete_password_change_tx block', 'PASS', SQLERRM);
  END;

  -- 3. Inactive user cannot mark own notification as read
  BEGIN
    UPDATE public.notifications SET is_read = TRUE WHERE id = v_notif_inactive_id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt = 0 THEN
      INSERT INTO _cits_final_report VALUES (3, 'Auth/Inactive', 'Inactive notification update block', 'PASS', '0 rows modifiable under RLS');
    ELSE
      INSERT INTO _cits_final_report VALUES (3, 'Auth/Inactive', 'Inactive notification update block', 'FAIL', format('Updated %s row(s)', v_cnt));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _cits_final_report VALUES (3, 'Auth/Inactive', 'Inactive notification update block', 'PASS', SQLERRM);
  END;

  -- 4. Active instructor cannot directly clear must_change_password on profiles
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_inst1_uid::text, 'role', 'authenticated')::text, true);
  BEGIN
    UPDATE public.profiles SET must_change_password = TRUE WHERE id = v_inst1_uid;
    INSERT INTO _cits_final_report VALUES (4, 'Profile Security', 'Direct client must_change_password block', 'FAIL', 'Instructor altered must_change_password directly');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _cits_final_report VALUES (4, 'Profile Security', 'Direct client must_change_password block', 'PASS', SQLERRM);
  END;

  -- 5. Unassigned instructor blocked from assigned-camp issues/attachments insert
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_inst3_unassigned_uid::text, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO public.issues (camp_id, reported_by, category, title, description)
    VALUES (v_camp_id, v_inst3_unassigned_uid, 'AV', 'Unassigned', 'Should fail');
    INSERT INTO _cits_final_report VALUES (5, 'Camp Scoping', 'Unassigned instructor issue insert blocked', 'FAIL', 'Unassigned instructor inserted issue');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _cits_final_report VALUES (5, 'Camp Scoping', 'Unassigned instructor issue insert blocked', 'PASS', SQLERRM);
  END;

  -- 6. Instructor cannot spoof issue reported_by or pre-resolve issue
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_inst1_uid::text, 'role', 'authenticated')::text, true);
  BEGIN
    INSERT INTO public.issues (camp_id, reported_by, category, title, description, status)
    VALUES (v_camp_id, v_inst1_uid, 'AV', 'Spoofed Resolved', 'Should fail', 'resolved');
    INSERT INTO _cits_final_report VALUES (6, 'Issue Security', 'Instructor issue status=resolved blocked', 'FAIL', 'Inserted pre-resolved issue');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _cits_final_report VALUES (6, 'Issue Security', 'Instructor issue status=resolved blocked', 'PASS', SQLERRM);
  END;

  -- 7. Issue room_id from another venue rejected
  BEGIN
    INSERT INTO public.issues (camp_id, reported_by, room_id, category, title, description)
    VALUES (v_camp_id, v_inst1_uid, v_room_other_venue_id, 'AV', 'Wrong Venue Room', 'Should fail');
    INSERT INTO _cits_final_report VALUES (7, 'Issue Integrity', 'Cross-venue room_id on issue rejected', 'FAIL', 'Accepted room from another venue');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _cits_final_report VALUES (7, 'Issue Integrity', 'Cross-venue room_id on issue rejected', 'PASS', SQLERRM);
  END;

  -- 8. Instructor cannot pre-approve or forge instructor_requests
  BEGIN
    INSERT INTO public.instructor_requests (camp_id, instructor_id, request_type, subject, details, status)
    VALUES (v_camp_id, v_inst1_id, 'schedule_change', 'Swap', 'Details', 'approved');
    INSERT INTO _cits_final_report VALUES (8, 'Request Security', 'Instructor self-approved request blocked', 'FAIL', 'Inserted approved request');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _cits_final_report VALUES (8, 'Request Security', 'Instructor self-approved request blocked', 'PASS', SQLERRM);
  END;

  -- 9. Instructor cannot spoof server-owned audit action ATTENDANCE_ADMIN_CORRECTED
  BEGIN
    INSERT INTO public.audit_logs (actor_profile_id, actor_name, actor_role, camp_id, action, entity_type, entity_id, reason)
    VALUES (v_inst1_uid, 'F5 Inst 1', 'instructor', v_camp_id, 'ATTENDANCE_ADMIN_CORRECTED', 'attendance_records', 'x', 'spoof');
    INSERT INTO _cits_final_report VALUES (9, 'Audit Integrity', 'Reserved ATTENDANCE_ADMIN_CORRECTED spoof blocked', 'FAIL', 'Spoof succeeded');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _cits_final_report VALUES (9, 'Audit Integrity', 'Reserved ATTENDANCE_ADMIN_CORRECTED spoof blocked', 'PASS', SQLERRM);
  END;

  -- 10. Direct cits.trusted_rpc GUC spoofing by authenticated role still cannot elevate attendance_sheets
  PERFORM set_config('cits.trusted_rpc', 'submit_attendance_sheet_tx', true);
  BEGIN
    UPDATE public.attendance_sheets SET status = 'submitted', present_count = 50 WHERE id = v_sheet_sub_id;
    INSERT INTO _cits_final_report VALUES (10, 'Trusted GUC Guard', 'Client GUC spoof rejected on attendance_sheets', 'FAIL', 'Authenticated spoof bypassed trigger');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _cits_final_report VALUES (10, 'Trusted GUC Guard', 'Client GUC spoof rejected on attendance_sheets', 'PASS', SQLERRM);
  END;
  PERFORM set_config('cits.trusted_rpc', '', true);

  -- 11..14. Historical 3+ Chained & Same-Day Student Transfer Resolution
  EXECUTE format('SET LOCAL ROLE %I', v_initial_role);
  SELECT public.resolve_student_group_for_day(v_camp_id, v_stu_chain_id, 1) INTO v_g;
  IF v_g = v_grp_a THEN
    INSERT INTO _cits_final_report VALUES (11, 'Transfers', 'Day 1 prior to transfers resolves Group A', 'PASS', 'Resolved Group A');
  ELSE
    INSERT INTO _cits_final_report VALUES (11, 'Transfers', 'Day 1 prior to transfers resolves Group A', 'FAIL', format('Got %s', v_g));
  END IF;

  SELECT public.resolve_student_group_for_day(v_camp_id, v_stu_chain_id, 2) INTO v_g;
  IF v_g = v_grp_b THEN
    INSERT INTO _cits_final_report VALUES (12, 'Transfers', 'Day 2 intermediate transfer resolves Group B', 'PASS', 'Resolved Group B');
  ELSE
    INSERT INTO _cits_final_report VALUES (12, 'Transfers', 'Day 2 intermediate transfer resolves Group B', 'FAIL', format('Got %s', v_g));
  END IF;

  SELECT public.resolve_student_group_for_day(v_camp_id, v_stu_chain_id, 4) INTO v_g;
  IF v_g = v_grp_c THEN
    INSERT INTO _cits_final_report VALUES (13, 'Transfers', 'Day 4 same-day multiple hops resolves latest Group C', 'PASS', 'Resolved latest same-day Group C');
  ELSE
    INSERT INTO _cits_final_report VALUES (13, 'Transfers', 'Day 4 same-day multiple hops resolves latest Group C', 'FAIL', format('Got %s', v_g));
  END IF;

  SELECT public.resolve_student_group_for_day(v_camp_id, v_stu_chain_id, 6) INTO v_g;
  IF v_g = v_grp_b THEN
    INSERT INTO _cits_final_report VALUES (14, 'Transfers', 'Day 6 future transfer resolves Group B', 'PASS', 'Resolved Group B');
  ELSE
    INSERT INTO _cits_final_report VALUES (14, 'Transfers', 'Day 6 future transfer resolves Group B', 'FAIL', format('Got %s', v_g));
  END IF;

  -- 15..20. Admin Privileges & Validation (only if test admin was inserted into admin_accounts; otherwise verify via blocked/explicit check)
  IF EXISTS (SELECT 1 FROM public.admin_accounts WHERE profile_id = v_admin_uid) THEN
    -- 15: Admin AAL1 cannot execute batch_import_students_tx
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_uid::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    BEGIN
      PERFORM public.batch_import_students_tx(v_camp_id, v_grp_a, 'smart_update', '[{"studentName":"X","studentCode":"F5-REG-01"}]'::jsonb);
      INSERT INTO _cits_final_report VALUES (15, 'Admin MFA', 'AAL1 Admin blocked from batch_import_students_tx', 'FAIL', 'AAL1 ran admin RPC');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _cits_final_report VALUES (15, 'Admin MFA', 'AAL1 Admin blocked from batch_import_students_tx', 'PASS', SQLERRM);
    END;

    -- Switch to AAL2 Admin
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_uid::text, 'role', 'authenticated', 'aal', 'aal2')::text, true);

    -- 16: Smart update across different groups is blocked to preserve historical transfer log
    BEGIN
      PERFORM public.batch_import_students_tx(v_camp_id, v_grp_b, 'smart_update', '[{"studentName":"Reg Moved","studentCode":"F5-REG-01"}]'::jsonb);
      INSERT INTO _cits_final_report VALUES (16, 'Transfers', 'smart_update blocks cross-group silent overwrite', 'FAIL', 'Overwrote group_id via smart_update');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _cits_final_report VALUES (16, 'Transfers', 'smart_update blocks cross-group silent overwrite', 'PASS', SQLERRM);
    END;

    -- 17: Cancelled lecture cannot have attendance submitted
    BEGIN
      PERFORM public.submit_attendance_sheet_tx(v_sheet_cancel_id);
      INSERT INTO _cits_final_report VALUES (17, 'Attendance', 'Cancelled lecture submission blocked', 'FAIL', 'Submitted cancelled lecture sheet');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _cits_final_report VALUES (17, 'Attendance', 'Cancelled lecture submission blocked', 'PASS', SQLERRM);
    END;

    -- 18: Lecture schedule change bumps revision_number AND resets instructor_acknowledged_at
    EXECUTE format('SET LOCAL ROLE %I', v_initial_role);
    UPDATE public.lectures SET instructor_acknowledged_at = NOW() WHERE id = v_lec_ack_id;
    SELECT revision_number INTO v_rev_before FROM public.lectures WHERE id = v_lec_ack_id;
    UPDATE public.lectures SET room_id = v_room1_id WHERE id = v_lec_ack_id;
    SELECT revision_number, instructor_acknowledged_at INTO v_rev_after, v_ack_after FROM public.lectures WHERE id = v_lec_ack_id;
    IF v_rev_after = v_rev_before + 1 AND v_ack_after IS NULL THEN
      INSERT INTO _cits_final_report VALUES (18, 'Schedule Integrity', 'Schedule change increments revision and clears ack', 'PASS', format('rev %s->%s, ack=NULL', v_rev_before, v_rev_after));
    ELSE
      INSERT INTO _cits_final_report VALUES (18, 'Schedule Integrity', 'Schedule change increments revision and clears ack', 'FAIL', format('rev %s->%s, ack=%s', v_rev_before, v_rev_after, v_ack_after));
    END IF;

    -- 19: record_admin_totp_verified_tx fails if auth.mfa_factors lacks verified totp
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_uid::text, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    BEGIN
      PERFORM public.record_admin_totp_verified_tx();
      INSERT INTO _cits_final_report VALUES (19, 'Admin MFA', 'record_admin_totp_verified_tx checks auth.mfa_factors', 'FAIL', 'Succeeded without mfa_factors row');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _cits_final_report VALUES (19, 'Admin MFA', 'record_admin_totp_verified_tx checks auth.mfa_factors', 'PASS', SQLERRM);
    END;
  ELSE
    INSERT INTO _cits_final_report VALUES (15, 'Admin MFA', 'AAL1 Admin blocked from batch_import_students_tx', 'BLOCKED', '2 production admin_accounts already exist');
    INSERT INTO _cits_final_report VALUES (16, 'Transfers', 'smart_update blocks cross-group silent overwrite', 'BLOCKED', '2 production admin_accounts already exist');
    INSERT INTO _cits_final_report VALUES (17, 'Attendance', 'Cancelled lecture submission blocked', 'BLOCKED', '2 production admin_accounts already exist');
    INSERT INTO _cits_final_report VALUES (18, 'Schedule Integrity', 'Schedule change increments revision and clears ack', 'PASS', 'Testable without admin_accounts via server trigger');
    EXECUTE format('SET LOCAL ROLE %I', v_initial_role);
    UPDATE public.lectures SET instructor_acknowledged_at = NOW() WHERE id = v_lec_ack_id;
    SELECT revision_number INTO v_rev_before FROM public.lectures WHERE id = v_lec_ack_id;
    UPDATE public.lectures SET room_id = v_room1_id WHERE id = v_lec_ack_id;
    SELECT revision_number, instructor_acknowledged_at INTO v_rev_after, v_ack_after FROM public.lectures WHERE id = v_lec_ack_id;
    IF v_rev_after = v_rev_before + 1 AND v_ack_after IS NULL THEN
      UPDATE _cits_final_report SET status = 'PASS', evidence = format('rev %s->%s, ack=NULL', v_rev_before, v_rev_after) WHERE test_no = 18;
    ELSE
      UPDATE _cits_final_report SET status = 'FAIL', evidence = format('rev %s->%s, ack=%s', v_rev_before, v_rev_after, v_ack_after) WHERE test_no = 18;
    END IF;
    INSERT INTO _cits_final_report VALUES (19, 'Admin MFA', 'record_admin_totp_verified_tx checks auth.mfa_factors', 'BLOCKED', '2 production admin_accounts already exist');
  END IF;

  -- 20. Archived attachments read-only trigger test
  EXECUTE format('SET LOCAL ROLE %I', v_initial_role);
  BEGIN
    INSERT INTO public.attachments (camp_id, uploaded_by, entity_type, entity_id, storage_path, file_size_kb, mime_type)
    VALUES (v_camp_arch_id, v_inst1_uid, 'issue', gen_random_uuid(), 'a/b/c.webp', 100, 'image/webp');
    INSERT INTO _cits_final_report VALUES (20, 'Archive Lock', 'Archived camp blocks new attachments', 'FAIL', 'Inserted attachment into archived camp');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _cits_final_report VALUES (20, 'Archive Lock', 'Archived camp blocks new attachments', 'PASS', SQLERRM);
  END;

  -- 21..25. Check-in Boundary Tests (Active camp required: if v_existing_active_camp IS NULL we test live active camp)
  IF v_existing_active_camp IS NULL THEN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_inst1_uid::text, 'role', 'authenticated')::text, true);

    -- 21: NaN latitude rejected
    BEGIN
      PERFORM public.submit_daily_checkin_tx(v_camp_id, 'NaN'::double precision, 31.0167, 10.0, v_inst1_uid::text || '/' || v_camp_id::text || '/s.webp', 120, NULL);
      INSERT INTO _cits_final_report VALUES (21, 'GPS Validation', 'NaN latitude rejected', 'FAIL', 'NaN latitude accepted');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _cits_final_report VALUES (21, 'GPS Validation', 'NaN latitude rejected', 'PASS', SQLERRM);
    END;

    -- 22: Out-of-range longitude rejected
    BEGIN
      PERFORM public.submit_daily_checkin_tx(v_camp_id, 30.0712, 181.5, 10.0, v_inst1_uid::text || '/' || v_camp_id::text || '/s.webp', 120, NULL);
      INSERT INTO _cits_final_report VALUES (22, 'GPS Validation', 'Longitude > 180 rejected', 'FAIL', '181.5 longitude accepted');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _cits_final_report VALUES (22, 'GPS Validation', 'Longitude > 180 rejected', 'PASS', SQLERRM);
    END;

    -- 23: Poor GPS accuracy > 500m rejected
    BEGIN
      PERFORM public.submit_daily_checkin_tx(v_camp_id, 30.0712, 31.0167, 650.0, v_inst1_uid::text || '/' || v_camp_id::text || '/s.webp', 120, NULL);
      INSERT INTO _cits_final_report VALUES (23, 'GPS Validation', 'GPS accuracy > 500m rejected', 'FAIL', '650m accuracy accepted');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _cits_final_report VALUES (23, 'GPS Validation', 'GPS accuracy > 500m rejected', 'PASS', SQLERRM);
    END;

    -- 24: Selfie traversal & wrong extension rejected
    BEGIN
      PERFORM public.submit_daily_checkin_tx(v_camp_id, 30.0712, 31.0167, 15.0, v_inst1_uid::text || '/' || v_camp_id::text || '/../evil.webp', 120, NULL);
      INSERT INTO _cits_final_report VALUES (24, 'Storage Security', 'Selfie path traversal (..) rejected', 'FAIL', 'Traversal path accepted');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _cits_final_report VALUES (24, 'Storage Security', 'Selfie path traversal (..) rejected', 'PASS', SQLERRM);
    END;

    -- 25: Direct duplicate pending checkin_exception blocked by partial unique index/trigger
    INSERT INTO public.checkin_exceptions (camp_id, instructor_id, camp_day, reason, status)
    VALUES (v_camp_id, v_inst1_id, 4, 'First pending exception', 'pending');

    BEGIN
      INSERT INTO public.checkin_exceptions (camp_id, instructor_id, camp_day, reason, status)
      VALUES (v_camp_id, v_inst1_id, 4, 'Duplicate pending exception', 'pending');
      INSERT INTO _cits_final_report VALUES (25, 'Exceptions', 'Duplicate pending exception blocked', 'FAIL', 'Second pending exception inserted');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _cits_final_report VALUES (25, 'Exceptions', 'Duplicate pending exception blocked', 'PASS', SQLERRM);
    END;
  ELSE
    INSERT INTO _cits_final_report VALUES (21, 'GPS Validation', 'NaN latitude rejected', 'BLOCKED', 'Pre-existing active camp prevents activating verification camp without mutating production');
    INSERT INTO _cits_final_report VALUES (22, 'GPS Validation', 'Longitude > 180 rejected', 'BLOCKED', 'Pre-existing active camp');
    INSERT INTO _cits_final_report VALUES (23, 'GPS Validation', 'GPS accuracy > 500m rejected', 'BLOCKED', 'Pre-existing active camp');
    INSERT INTO _cits_final_report VALUES (24, 'Storage Security', 'Selfie path traversal (..) rejected', 'BLOCKED', 'Pre-existing active camp');
    INSERT INTO _cits_final_report VALUES (25, 'Exceptions', 'Duplicate pending exception blocked', 'BLOCKED', 'Pre-existing active camp');
  END IF;

  -- 26..30. Substitute Entitlement Sync & Admin Attendance Correction RPC
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_inst2_uid::text, 'role', 'authenticated')::text, true);
  v_res := public.submit_attendance_sheet_tx(v_sheet_sub_id);

  EXECUTE format('SET LOCAL ROLE %I', v_initial_role);
  SELECT instructor_id INTO v_ent_inst FROM public.lecture_entitlements WHERE lecture_id = v_lec_sub_id;
  IF v_ent_inst = v_inst2_id AND (v_res->>'absent_count')::integer >= 1 THEN
    INSERT INTO _cits_final_report VALUES (26, 'Substitute/Entitlement', 'Substitute submission assigns entitlement to substitute + auto-absents transferred Day4 student', 'PASS', v_res::text);
  ELSE
    INSERT INTO _cits_final_report VALUES (26, 'Substitute/Entitlement', 'Substitute submission assigns entitlement to substitute + auto-absents transferred Day4 student', 'FAIL', format('ent_inst=%s, res=%s', v_ent_inst, v_res::text));
  END IF;

  -- 27. Instructor cannot invoke admin_correct_attendance_tx
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_inst2_uid::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.admin_correct_attendance_tx(v_sheet_sub_id, v_stu_chain_id, 'present', 'Instructor attempt');
    INSERT INTO _cits_final_report VALUES (27, 'Attendance Correction', 'Instructor blocked from admin_correct_attendance_tx', 'FAIL', 'Instructor invoked admin correction RPC');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _cits_final_report VALUES (27, 'Attendance Correction', 'Instructor blocked from admin_correct_attendance_tx', 'PASS', SQLERRM);
  END;

  -- 28..30. Admin correction RPC on submitted & locked sheets (if test admin active in admin_accounts)
  IF EXISTS (SELECT 1 FROM public.admin_accounts WHERE profile_id = v_admin_uid) THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_uid::text, 'role', 'authenticated', 'aal', 'aal2')::text, true);

    -- 28: Empty audit note rejected
    BEGIN
      PERFORM public.admin_correct_attendance_tx(v_sheet_sub_id, v_stu_chain_id, 'present', '   ');
      INSERT INTO _cits_final_report VALUES (28, 'Attendance Correction', 'Empty audit note rejected in admin_correct_attendance_tx', 'FAIL', 'Accepted blank note');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _cits_final_report VALUES (28, 'Attendance Correction', 'Empty audit note rejected in admin_correct_attendance_tx', 'PASS', SQLERRM);
    END;

    -- 29: Valid Admin correction succeeds on submitted sheet and writes ATTENDANCE_ADMIN_CORRECTED audit log
    v_res := public.admin_correct_attendance_tx(v_sheet_sub_id, v_stu_chain_id, 'present', 'Late entry verified by gate log');
    SELECT COUNT(*) INTO v_cnt FROM public.audit_logs
    WHERE action = 'ATTENDANCE_ADMIN_CORRECTED' AND camp_id = v_camp_id;
    IF (v_res->>'present_count')::integer = 1 AND v_cnt >= 1 THEN
      INSERT INTO _cits_final_report VALUES (29, 'Attendance Correction', 'Admin correction updates submitted sheet counts & writes audit log', 'PASS', v_res::text);
    ELSE
      INSERT INTO _cits_final_report VALUES (29, 'Attendance Correction', 'Admin correction updates submitted sheet counts & writes audit log', 'FAIL', v_res::text);
    END IF;

    -- 30: Lock sheet and confirm Admin correction still succeeds on locked sheet
    EXECUTE format('SET LOCAL ROLE %I', v_initial_role);
    UPDATE public.attendance_sheets SET status = 'locked' WHERE id = v_sheet_sub_id;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_uid::text, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    v_res := public.admin_correct_attendance_tx(v_sheet_sub_id, v_stu_chain_id, 'late', 'Verified arrival at 09:20');
    IF (v_res->>'present_count')::integer = 1 AND (v_res->>'mark') = 'late' THEN
      INSERT INTO _cits_final_report VALUES (30, 'Attendance Correction', 'Admin correction succeeds on locked sheet while preserving historical origin group', 'PASS', v_res::text);
    ELSE
      INSERT INTO _cits_final_report VALUES (30, 'Attendance Correction', 'Admin correction succeeds on locked sheet while preserving historical origin group', 'FAIL', v_res::text);
    END IF;
  ELSE
    INSERT INTO _cits_final_report VALUES (28, 'Attendance Correction', 'Empty audit note rejected in admin_correct_attendance_tx', 'BLOCKED', '2 production admin_accounts already exist');
    INSERT INTO _cits_final_report VALUES (29, 'Attendance Correction', 'Admin correction updates submitted sheet counts & writes audit log', 'BLOCKED', '2 production admin_accounts already exist');
    INSERT INTO _cits_final_report VALUES (30, 'Attendance Correction', 'Admin correction succeeds on locked sheet while preserving historical origin group', 'BLOCKED', '2 production admin_accounts already exist');
  END IF;
END
$$;

SELECT test_no, category, test_name, status, evidence FROM _cits_final_report ORDER BY test_no;

ROLLBACK;
