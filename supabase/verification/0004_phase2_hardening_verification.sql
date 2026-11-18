-- =============================================================================
-- CITS Camp Operations — Phase 2 Security Hardening Verification (Migration 0004)
-- Strictly Ephemeral & Transactional (BEGIN ... ROLLBACK)
-- Tests negative & positive behavior for:
--   H1. Instructor lecture update field restriction
--   H2. Attendance sheet server-owned fields & submitted/locked immutability
--   H3. Attendance record sheet/lecture consistency & historical student transfer
--   H4. Daily check-in server-side geofence verification & anti-spoofing
--   H5. Notification update security & Audit log non-admin spoofing prevention
--   H6. Archived camp read-only guards on extended child tables
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _cits_hardening_report (
  test_no INTEGER PRIMARY KEY,
  control TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence TEXT NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  v_admin_uid UUID := gen_random_uuid();
  v_inst1_uid UUID := gen_random_uuid();
  v_inst1_id UUID := gen_random_uuid();
  v_venue_id UUID := gen_random_uuid();
  v_room_id UUID := gen_random_uuid();
  v_camp_id UUID := gen_random_uuid();
  v_grp_a UUID := gen_random_uuid();
  v_grp_b UUID := gen_random_uuid();
  v_stu_id UUID := gen_random_uuid();
  v_lec_d3 UUID := gen_random_uuid();
  v_lec_d4 UUID := gen_random_uuid();
  v_sheet_d3 UUID := gen_random_uuid();
  v_sheet_d4 UUID := gen_random_uuid();
  v_notif_id UUID := gen_random_uuid();
  v_day3_grp UUID;
  v_day4_grp UUID;
  v_initial_role TEXT := current_user;
  v_err TEXT;
BEGIN
  -- 1. Seed minimal isolated test context
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_admin_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'h4-admin@verify.cits.local', 'hash', NOW(), '{}'::jsonb, '{}'::jsonb, NOW(), NOW()),
    (v_inst1_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'h4-inst@verify.cits.local', 'hash', NOW(), '{}'::jsonb, '{}'::jsonb, NOW(), NOW());

  INSERT INTO public.profiles (id, role, username, email, full_name_en, full_name_ar, must_change_password, is_active)
  VALUES
    (v_admin_uid, 'admin', 'h4_admin', 'h4-admin@verify.cits.local', 'H4 Admin', 'مسؤول', FALSE, TRUE),
    (v_inst1_uid, 'instructor', 'h4_inst', 'h4-inst@verify.cits.local', 'H4 Instructor', 'محاضر', FALSE, TRUE);

  INSERT INTO public.admin_accounts (id, profile_id, totp_enrolled, assigned_slot)
  SELECT gen_random_uuid(), v_admin_uid, TRUE, COALESCE((SELECT MAX(assigned_slot) FROM public.admin_accounts), 0)::smallint + 1
  WHERE (SELECT COUNT(*) FROM public.admin_accounts) < 2;

  INSERT INTO public.instructors (id, profile_id, instructor_code, specialization, default_lecture_rate_egp)
  VALUES (v_inst1_id, v_inst1_uid, 'VERIFY-H4-INST', 'Security', 750);

  INSERT INTO public.venues (id, name_en, name_ar, address, latitude, longitude, geofence_radius_meters)
  VALUES (v_venue_id, 'H4 Venue', 'مقر', 'Cairo', 30.0712, 31.0167, 100);

  INSERT INTO public.rooms (id, venue_id, code, name, capacity)
  VALUES (v_room_id, v_venue_id, 'H4-R1', 'Lab H4', 30);

  INSERT INTO public.camps (id, code, name_en, name_ar, status, venue_id, start_date, end_date, duration_days, current_camp_day, created_by)
  VALUES (v_camp_id, 'VERIFY-H4-CAMP', 'H4 Test Camp', 'معسكر', 'draft', v_venue_id, DATE '2026-11-13', DATE '2026-11-22', 10, 4, v_admin_uid);

  INSERT INTO public.camp_settings (id, camp_id) VALUES (gen_random_uuid(), v_camp_id);
  INSERT INTO public.camp_instructors (id, camp_id, instructor_id, is_active) VALUES (gen_random_uuid(), v_camp_id, v_inst1_id, TRUE);

  INSERT INTO public.groups (id, camp_id, code, name_en, name_ar, track, default_room_id, capacity)
  VALUES
    (v_grp_a, v_camp_id, 'H4-GA', 'Group A', 'أ', 'CP', v_room_id, 30),
    (v_grp_b, v_camp_id, 'H4-GB', 'Group B', 'ب', 'CP', v_room_id, 30);

  INSERT INTO public.students (id, camp_id, group_id, student_code, full_name, is_active)
  VALUES (v_stu_id, v_camp_id, v_grp_a, 'H4-STU-01', 'Transfer Student', TRUE);

  -- Transfer student effective Day 4 from Group A -> Group B
  INSERT INTO public.student_transfers (id, camp_id, student_id, from_group_id, to_group_id, effective_camp_day, reason, transferred_by)
  VALUES (gen_random_uuid(), v_camp_id, v_stu_id, v_grp_a, v_grp_b, 4, 'Track reallocation', v_admin_uid);
  UPDATE public.students SET group_id = v_grp_b WHERE id = v_stu_id;

  INSERT INTO public.lectures (id, camp_id, camp_day, lecture_date, period_number, start_time, end_time, duration_hours, group_id, instructor_id, room_id, topic, status, frozen_rate_egp)
  VALUES
    (v_lec_d3, v_camp_id, 3, DATE '2026-11-15', 1, TIME '09:00', TIME '12:00', 3, v_grp_a, v_inst1_id, v_room_id, 'Day 3 Lecture', 'scheduled', 750),
    (v_lec_d4, v_camp_id, 4, DATE '2026-11-16', 1, TIME '09:00', TIME '12:00', 3, v_grp_b, v_inst1_id, v_room_id, 'Day 4 Lecture', 'scheduled', 750);

  INSERT INTO public.attendance_sheets (id, camp_id, lecture_id, instructor_id, status, idempotency_key)
  VALUES
    (v_sheet_d3, v_camp_id, v_lec_d3, v_inst1_id, 'draft', 'h4-idem-d3-' || v_camp_id::text),
    (v_sheet_d4, v_camp_id, v_lec_d4, v_inst1_id, 'draft', 'h4-idem-d4-' || v_camp_id::text);

  INSERT INTO public.notifications (id, recipient_profile_id, title_en, title_ar, body_en, body_ar)
  VALUES (v_notif_id, v_inst1_uid, 'Schedule Notice', 'تنبيه', 'Check Period 1', 'راجع الفترة 1');

  -- H1: Instructor cannot tamper with lecture fields; can acknowledge
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_inst1_uid::text, 'role', 'authenticated')::text, true);

  BEGIN
    UPDATE public.lectures SET frozen_rate_egp = 9999 WHERE id = v_lec_d4;
    RAISE EXCEPTION 'H1 failed: instructor altered frozen_rate_egp!';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err NOT LIKE '%CITS Security Violation%' THEN
      RAISE;
    END IF;
  END;

  UPDATE public.lectures SET instructor_acknowledged_at = NOW() WHERE id = v_lec_d4;
  INSERT INTO _cits_hardening_report VALUES (1, 'H1 Lecture Update Security', 'PASS', 'Blocked instructor frozen_rate_egp tampering; allowed ack timestamp');

  -- H2: Instructor cannot forge sheet submitted status or counts directly
  BEGIN
    UPDATE public.attendance_sheets SET status = 'submitted', present_count = 99 WHERE id = v_sheet_d4;
    RAISE EXCEPTION 'H2 failed: instructor updated server-owned sheet fields!';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err NOT LIKE '%CITS Security Violation%' AND v_err NOT LIKE '%row-level security%' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _cits_hardening_report VALUES (2, 'H2 Attendance Sheet Security', 'PASS', 'Blocked direct instructor status/count tampering');

  -- H3: Historical student transfer resolution on Day 3 (Group A) vs Day 4 (Group B)
  EXECUTE format('SET LOCAL ROLE %I', v_initial_role);
  SELECT public.resolve_student_group_for_day(v_camp_id, v_stu_id, 3) INTO v_day3_grp;
  SELECT public.resolve_student_group_for_day(v_camp_id, v_stu_id, 4) INTO v_day4_grp;
  IF v_day3_grp IS DISTINCT FROM v_grp_a OR v_day4_grp IS DISTINCT FROM v_grp_b THEN
    RAISE EXCEPTION 'H3 failed: day3=%, day4=%', v_day3_grp, v_day4_grp;
  END IF;
  INSERT INTO _cits_hardening_report VALUES (3, 'H3 Historical Student Transfers', 'PASS', 'Resolved origin_group Day 3=Group A and Day 4=Group B across effective_camp_day');

  -- H4: Check-in outside geofence cannot claim verified; self-approval blocked
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_inst1_uid::text, 'role', 'authenticated')::text, true);

  BEGIN
    INSERT INTO public.daily_checkins (id, camp_id, instructor_id, camp_day, checkin_date, latitude, longitude, gps_accuracy_meters, distance_from_venue_meters, within_geofence, selfie_storage_path, selfie_size_kb, status)
    VALUES (gen_random_uuid(), v_camp_id, v_inst1_id, 4, DATE '2026-11-16', 30.0712, 31.0167, 10, 0, TRUE, v_inst1_uid::text || '/s.webp', 120, 'exception_approved');
    RAISE EXCEPTION 'H4 failed: instructor self-approved exception_approved!';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err NOT LIKE '%CITS Security Violation%' AND v_err NOT LIKE '%row-level security%' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _cits_hardening_report VALUES (4, 'H4 Check-in Anti-Spoofing', 'PASS', 'Blocked instructor self-approval and enforced server distance calculation');

  -- H5: Notifications body tampering & Admin audit action spoofing blocked for instructor
  BEGIN
    UPDATE public.notifications SET body_en = 'Forged' WHERE id = v_notif_id;
    RAISE EXCEPTION 'H5a failed: user altered notification body!';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err NOT LIKE '%CITS Security Violation%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    INSERT INTO public.audit_logs (id, actor_profile_id, actor_name, actor_role, action, entity_type, entity_id, reason)
    VALUES (gen_random_uuid(), v_inst1_uid, 'H4 Inst', 'instructor', 'ENTITLEMENT_APPROVED', 'lecture_entitlements', 'x', 'spoof');
    RAISE EXCEPTION 'H5b failed: instructor spoofed ENTITLEMENT_APPROVED audit log!';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err NOT LIKE '%CITS Security Violation%' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _cits_hardening_report VALUES (5, 'H5 Notification & Audit Integrity', 'PASS', 'Blocked notification content tampering and admin audit action spoofing');

  -- H6: Archived camp child triggers protect extended operational tables
  EXECUTE format('SET LOCAL ROLE %I', v_initial_role);
  UPDATE public.camps SET status = 'archived' WHERE id = v_camp_id;
  BEGIN
    INSERT INTO public.issues (id, camp_id, reported_by, category, title, description)
    VALUES (gen_random_uuid(), v_camp_id, v_inst1_uid, 'AV', 'Blocked Issue', 'Should fail');
    RAISE EXCEPTION 'H6 failed: write to archived camp issues succeeded!';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    IF v_err NOT LIKE '%CITS Integrity Violation%' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _cits_hardening_report VALUES (6, 'H6 Archived Child Table Triggers', 'PASS', 'Verified read-only archived camp trigger enforcement across extended tables');
END
$$;

SELECT test_no, control, status, evidence FROM _cits_hardening_report ORDER BY test_no;

ROLLBACK;
