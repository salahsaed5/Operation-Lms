-- =============================================================================
-- CITS Camp Operations — Remote Supabase Verification & RLS Test Suite
-- Target Project: cits-camp-operations (https://wdmlxsgbjkboadkeekdq.supabase.co)
-- File: supabase/verification/0003_remote_verification_and_rls_test_suite.sql
--
-- INDEPENDENT SECURITY AUDIT GUARANTEES & EXPLICIT SCOPE LIMITS:
-- 1. Transaction Safety (Database State Only): Entire script executes inside
--    BEGIN ... ROLLBACK with zero COMMIT statements. All transactional database
--    changes are rolled back 100%. Note: PostgreSQL ROLLBACK never cancels
--    external network calls (HTTP/Webhooks/dblink) or sequence nextval()
--    increments; therefore, Pre-Flight Guards block fixture setup if any
--    external trigger, untraceable callee, dynamic SQL, or sequence dependency
--    exists.
-- 2. True pg_constraint Primary Key, Foreign Key & Multi-Layer Sequence/Default Audit:
--    - Proves from pg_constraint (contype = 'p') and pg_attribute that every one
--      of the 29 required tables has a single-column PRIMARY KEY on column "id"
--      of type UUID (atttypid = 'uuid'::regtype, attnotnull = TRUE), and proves
--      from pg_constraint (contype = 'f') that public.profiles(id) has a direct
--      FOREIGN KEY to auth.users(id).
--    - Distinguishes between:
--      (a) Sequences OWNED by a table/column across ALL schemas
--          (pg_depend.classid = 'pg_class' AND objid = seq.oid -> refobjid = table.oid), and
--      (b) Sequences REFERENCED by column DEFAULT expressions across ALL schemas
--          (pg_attrdef.oid = pg_depend.objid AND pg_depend.classid = 'pg_attrdef' -> refobjid = seq.oid).
--    - Verifies functions referenced by pg_attrdef (refclassid = 'pg_proc') by
--      exact schema, signature OID, internal catalog identity, or verified
--      pg_extension membership (pgcrypto / uuid-ossp), rejecting any unknown or
--      user-defined default function.
-- 3. Bounded Pre-Approved Allowlist Call-Graph Check (With Explicit Static Limits):
--    - Traversal depends strictly on the pre-approved allowlist of 18 CITS trigger,
--      helper, and RPC signatures (v_expected_trigger_regprocs and
--      v_expected_helper_regprocs), verified by exact OID (to_regprocedure(sig)::oid)
--      and a zero-overload check in public schema.
--    - Lexical Stripping (PL/pgSQL State-Machine Scanner in Pre-Flight Guard 1C):
--      Uses a character-by-character PL/pgSQL loop (not regex replacement) over each
--      of the 18 pre-approved functions prosrc to strip single-line comments,
--      PostgreSQL nested block comments (tracked by nesting depth),
--      and standard single-quoted string literals (with doubled single-quote escapes).
--    - Unproven Lexical Constructs (Immediate FAIL / Fixture Abort, Never PASS):
--      Explicitly flags any dollar-quoted string or dollar-sign token (tagged or
--      untagged dollar quotes and positional parameters),
--      double-quoted identifier, non-standard string literal prefix
--      (escape, unicode, bit, hex, or national string prefixes), backslash inside
--      a single-quoted literal, unclosed single quote, or unclosed/unbalanced block comment.
--    - Explicit Unprovable Boundaries:
--      After comment/literal stripping, call extraction uses regex pattern matching
--      for identifier(...) tokens combined with pg_depend (pg_proc -> pg_proc) links.
--      This is NOT a full SQL/PLpgSQL AST parser and does NOT discover all possible
--      PostgreSQL calls (such as operator invocations, implicit casts, type I/O
--      functions, or arbitrary function chains outside the 18 pre-approved functions).
-- 4. Separated RLS Existence vs Static Condition Audit (Test 3) & Targeted Behavioral
--    RLS Verification (Test 10):
--    - Test 3 separates (a) proving policy existence on all 29 tables from
--      (b) static inspection of USING / WITH CHECK predicates.
--    - Does NOT rely on regex OR-splitting as a logical parser and does NOT grant a
--      comprehensive PASS merely because an identity anchor substring appears in a
--      policy expression (anchor presence is only a baseline filter where absence
--      causes FAIL). Any policy containing OR, compound AND predicates, EXISTS/SELECT
--      subqueries, negations, IS NOT NULL role-only checks, or non-atomic expressions
--      that cannot be statically proven with confidence is classified as
--      REVIEW_REQUIRED ([REVIEW 3/10]).
--    - Test 10 executes live behavioral RLS checks on seeded rows across 6 core
--      tables (profiles, camps, lectures, instructor_rates, lecture_entitlements,
--      audit_logs) under 4 roles — not all 29 tables.
-- 5. Strict auth.users & Public Trigger Pre-Flight Guard:
--    - Reports each trigger name, its associated function (schema.function(args)),
--      and the exact reason(s) it is considered unapproved or unsafe.
--    - Blocks Fixture Setup whenever any unknown, unverifiable, or auth.users trigger
--      exists. Note: Rejecting a trigger does NOT necessarily mean it is malicious or
--      harmful; it means the trigger is outside the approved CITS verification scope.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE _cits_verification_report (
  step_order INTEGER PRIMARY KEY,
  test_code TEXT NOT NULL,
  status TEXT NOT NULL,
  requirement TEXT NOT NULL,
  evidence TEXT NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE _cits_lexed_procs (
  proc_oid OID PRIMARY KEY,
  func_schema TEXT NOT NULL,
  func_name TEXT NOT NULL,
  canonical_sig TEXT NOT NULL,
  raw_src TEXT NOT NULL,
  clean_src TEXT NOT NULL,
  lex_issues TEXT
) ON COMMIT DROP;

-- Pre-seed all 10 verification steps as FAIL (NOT RUN). When the script reaches
-- the final SELECT prior to ROLLBACK, any test that did not complete execution
-- remains visible as FAIL (NOT RUN). (Dropped after ROLLBACK or top-level abort.)
INSERT INTO _cits_verification_report (step_order, test_code, status, requirement, evidence)
VALUES
  (1,  '[FAIL 1/10 (NOT RUN)]',  'FAIL', 'Exact 29 Named Tables, PK/FK Constraints, Sequence/Default Audit & pg_proc', 'Test 1 did not complete execution'),
  (2,  '[FAIL 2/10 (NOT RUN)]',  'FAIL', 'Row Level Security Enabled (All 29 Named Tables)',                           'Test 2 did not complete execution'),
  (3,  '[FAIL 3/10 (NOT RUN)]',  'FAIL', 'RLS Policy Existence (29 Tables) & Static Predicate Safety Audit',           'Test 3 did not complete execution'),
  (4,  '[FAIL 4/10 (NOT RUN)]',  'FAIL', 'Storage Bucket checkin-selfies & Policies',                                  'Test 4 did not complete execution'),
  (5,  '[FAIL 5/10 (NOT RUN)]',  'FAIL', 'Admin 2-Account Cap (All 3 Triggers/RPC)',                                   'Test 5 did not complete execution'),
  (6,  '[FAIL 6/10 (NOT RUN)]',  'FAIL', 'Single Active Camp & Archived Read-Only Guard',                              'Test 6 did not complete execution'),
  (7,  '[FAIL 7/10 (NOT RUN)]',  'FAIL', 'Schedule Conflicts & Daily Group Limit',                                     'Test 7 did not complete execution'),
  (8,  '[FAIL 8/10 (NOT RUN)]',  'FAIL', 'Duplicate Same-Day Attendance Guard',                                        'Test 8 did not complete execution'),
  (9,  '[FAIL 9/10 (NOT RUN)]',  'FAIL', 'Attendance Submission & Entitlement RPCs',                                   'Test 9 did not complete execution'),
  (10, '[FAIL 10/10 (NOT RUN)]', 'FAIL', 'Audit Immutability & Targeted 6-Table 4-Role RLS Checks',                    'Test 10 did not complete execution');

DO $cits_verify_1$
DECLARE
  v_required_tables CONSTANT TEXT[] := ARRAY[
    'profiles',
    'admin_accounts',
    'instructors',
    'venues',
    'camps',
    'camp_settings',
    'rooms',
    'camp_instructors',
    'instructor_rates',
    'groups',
    'group_instructors',
    'students',
    'student_transfers',
    'lectures',
    'daily_checkins',
    'checkin_exceptions',
    'attendance_sheets',
    'attendance_records',
    'lecture_entitlements',
    'instructor_requests',
    'notifications',
    'issues',
    'daily_checklists',
    'survey_links',
    'survey_results',
    'instructor_evaluations',
    'attachments',
    'audit_logs',
    'backup_records'
  ];

  -- Expected trigger function names and exact schema-qualified signatures on the 29 public CITS tables.
  -- IMPORTANT: Presence in these arrays is NEVER sufficient proof of safety; every function
  -- is verified by exact OID/signature, zero-overload check, body inspection, language,
  -- pinned search_path, and stepwise recursive callee resolution in Pre-Flight Guard 1.
  v_allowed_cits_trigger_funcs CONSTANT TEXT[] := ARRAY[
    'enforce_max_two_admins',
    'enforce_audit_log_integrity',
    'enforce_profile_security',
    'enforce_camp_lifecycle_rules',
    'prevent_mutation_on_archived_camp',
    'validate_lecture_schedule_rules',
    'validate_attendance_record_integrity',
    'validate_lecture_entitlement_integrity',
    'enforce_lecture_update_security',
    'enforce_attendance_sheet_security',
    'enforce_daily_checkin_security',
    'enforce_checkin_exception_security',
    'enforce_notification_update_security'
  ];

  v_expected_trigger_regprocs CONSTANT TEXT[] := ARRAY[
    'public.enforce_max_two_admins()',
    'public.enforce_audit_log_integrity()',
    'public.enforce_profile_security()',
    'public.enforce_camp_lifecycle_rules()',
    'public.prevent_mutation_on_archived_camp()',
    'public.validate_lecture_schedule_rules()',
    'public.validate_attendance_record_integrity()',
    'public.validate_lecture_entitlement_integrity()',
    'public.enforce_lecture_update_security()',
    'public.enforce_attendance_sheet_security()',
    'public.enforce_daily_checkin_security()',
    'public.enforce_checkin_exception_security()',
    'public.enforce_notification_update_security()'
  ];

  -- Expected helper/RPC function names and exact schema-qualified signatures in public schema.
  v_allowed_cits_helper_funcs CONSTANT TEXT[] := ARRAY[
    'is_cits_admin',
    'current_instructor_id',
    'resolve_login_identifier',
    'append_audit_log_internal',
    'assert_camp_not_archived',
    'is_instructor_assigned_to_camp',
    'is_instructor_assigned_to_group',
    'is_lecture_active_instructor',
    'submit_attendance_sheet_tx',
    'admin_override_entitlement_tx',
    'bootstrap_cits_admin_account',
    'haversine_distance_meters',
    'resolve_student_group_for_day',
    'submit_daily_checkin_tx',
    'acknowledge_lecture_tx',
    'transfer_student_tx',
    'batch_import_students_tx',
    'review_checkin_exception_tx',
    'archive_camp_tx',
    'complete_password_change_tx',
    'record_admin_totp_verified_tx'
  ];

  v_expected_helper_regprocs CONSTANT TEXT[] := ARRAY[
    'public.is_cits_admin()',
    'public.current_instructor_id()',
    'public.resolve_login_identifier(text)',
    'public.append_audit_log_internal(uuid,text,text,text,jsonb,jsonb,text)',
    'public.assert_camp_not_archived(uuid)',
    'public.is_instructor_assigned_to_camp(uuid)',
    'public.is_instructor_assigned_to_group(uuid)',
    'public.is_lecture_active_instructor(uuid)',
    'public.submit_attendance_sheet_tx(uuid)',
    'public.admin_override_entitlement_tx(uuid,public.entitlement_status,text)',
    'public.bootstrap_cits_admin_account(uuid,text,text,text,smallint)',
    'public.haversine_distance_meters(double precision,double precision,double precision,double precision)',
    'public.resolve_student_group_for_day(uuid,uuid,integer)',
    'public.submit_daily_checkin_tx(uuid,double precision,double precision,double precision,text,integer,text)',
    'public.acknowledge_lecture_tx(uuid)',
    'public.transfer_student_tx(uuid,uuid,uuid,integer,text)',
    'public.batch_import_students_tx(uuid,uuid,text,jsonb)',
    'public.review_checkin_exception_tx(uuid,public.request_status,text)',
    'public.archive_camp_tx(uuid)',
    'public.complete_password_change_tx()',
    'public.record_admin_totp_verified_tx()'
  ];

  -- Safe built-in / SQL syntactic tokens that may appear followed by '(' inside PL/pgSQL bodies
  v_safe_builtin_call_tokens CONSTANT TEXT[] := ARRAY[
    'if', 'elsif', 'while', 'for', 'loop', 'return', 'raise', 'perform',
    'select', 'insert', 'update', 'delete', 'from', 'where', 'join', 'into',
    'values', 'set', 'and', 'or', 'not', 'in', 'like', 'ilike', 'exists', 'case', 'when',
    'then', 'else', 'end', 'filter', 'over', 'partition', 'unnest',
    'conflict', 'distinct', 'any', 'all', 'some', 'row',
    'coalesce', 'nullif', 'greatest', 'least', 'cast', 'substring', 'position',
    'trim', 'btrim', 'ltrim', 'rtrim', 'lower', 'upper', 'initcap',
    'char_length', 'character_length', 'length', 'regexp_replace', 'regexp_matches',
    'replace', 'split_part', 'left', 'right', 'concat', 'concat_ws', 'format',
    'count', 'min', 'max', 'sum', 'avg', 'array_agg', 'string_agg', 'bool_and', 'bool_or',
    'array_append', 'array_length', 'extract', 'epoch', 'floor', 'round',
    'radians', 'sin', 'cos', 'sqrt', 'atan2', 'power',
    'jsonb_build_object', 'jsonb_build_array', 'to_jsonb', 'jsonb_typeof',
    'jsonb_array_elements', 'jsonb_array_length',
    'now', 'clock_timestamp', 'transaction_timestamp', 'statement_timestamp', 'timeofday',
    'gen_random_uuid', 'uuid_generate_v4', 'hashtext', 'pg_advisory_xact_lock',
    'row_security_active', 'to_regprocedure', 'has_function_privilege',
    'set_config', 'current_setting', 'uid', 'jwt', 'role',
    'numeric', 'varchar', 'char', 'bit', 'varbit', 'time', 'timetz', 'timestamp', 'timestamptz', 'interval'
  ];

  v_missing_tables TEXT;
  v_verified_table_count INTEGER;
  v_missing_phase2_cols TEXT := '';
  v_non_uuid_pk_tables TEXT;
  v_profiles_fk_verified BOOLEAN := FALSE;
  v_unsafe_column_defaults TEXT;
  v_owned_sequences TEXT;
  v_default_ref_sequences TEXT;
  v_default_func_deps TEXT;
  v_attached_sequences TEXT;
  v_public_seq_count INTEGER;
  v_rls_disabled_tables TEXT;
  v_rls_enabled_count INTEGER;
  v_unprotected_tables TEXT;
  v_permissive_true_count INTEGER;
  v_invalid_policy_defs TEXT;
  v_review_required_policies TEXT;
  v_policies_table_count INTEGER;
  v_total_policies_count INTEGER;
  v_missing_funcs TEXT := '';
  v_anon_can_bootstrap BOOLEAN;
  v_auth_can_bootstrap BOOLEAN;
  v_bucket RECORD;
  v_storage_policy_count INTEGER;

  -- Deterministic Ephemeral Test UUIDs for ALL Inserted Rows (Rolled back 100%)
  v_admin1_uid UUID := '00000000-0000-4000-a000-000000000001';
  v_admin2_uid UUID := '00000000-0000-4000-a000-000000000002';
  v_admin3_uid UUID := '00000000-0000-4000-a000-000000000003';
  v_admin_extra_row_id UUID := '00000000-0000-4000-a000-000000000099';
  v_inst_a_uid UUID := '00000000-0000-4000-a000-000000000011';
  v_inst_b_uid UUID := '00000000-0000-4000-a000-000000000012';

  v_active_admin_uid UUID;
  v_existing_admin_count INTEGER;
  v_slot1_taken BOOLEAN;
  v_slot2_taken BOOLEAN;
  v_unsafe_triggers TEXT;
  v_missing_or_overloaded_sigs TEXT;
  v_unsafe_helper_funcs TEXT;
  v_untracked_or_unsafe_callees TEXT;
  v_reached_helper_summary TEXT;
  v_preexisting_collision_count INTEGER;
  v_collision_details TEXT;

  -- Character-by-character PL/pgSQL lexical scanner state variables for Pre-Flight Guard 1C
  v_proc_rec RECORD;
  v_src TEXT;
  v_len INTEGER;
  v_pos INTEGER;
  v_ch TEXT;
  v_next TEXT;
  v_in_line_comment BOOLEAN;
  v_block_comment_depth INTEGER;
  v_in_single_quote BOOLEAN;
  v_clean_buf TEXT;
  v_has_dollar_token BOOLEAN;
  v_has_double_quote BOOLEAN;
  v_has_non_std_quote_prefix BOOLEAN;
  v_has_backslash_in_quote BOOLEAN;
  v_has_stray_block_close BOOLEAN;
  v_lex_issue_list TEXT;

  v_inst_a_id UUID := '00000000-0000-4000-b000-000000000011';
  v_inst_b_id UUID := '00000000-0000-4000-b000-000000000012';

  v_venue_id UUID := '00000000-0000-4000-c000-000000000001';
  v_room1_id UUID := '00000000-0000-4000-c000-000000000011';
  v_room2_id UUID := '00000000-0000-4000-c000-000000000012';
  v_room3_id UUID := '00000000-0000-4000-c000-000000000013';

  v_existing_active_camp UUID;
  v_camp1_id UUID := '00000000-0000-4000-d000-000000000001';
  v_camp2_id UUID := '00000000-0000-4000-d000-000000000002';
  v_camp_arch_id UUID := '00000000-0000-4000-d000-000000000003';
  v_camp_settings_id UUID := '00000000-0000-4000-d000-000000000011';
  v_camp_inst_a_id UUID := '00000000-0000-4000-d000-000000000021';
  v_camp_inst_b_id UUID := '00000000-0000-4000-d000-000000000022';
  v_rate_a_id UUID := '00000000-0000-4000-d000-000000000031';
  v_rate_b_id UUID := '00000000-0000-4000-d000-000000000032';

  v_grp_a_id UUID := '00000000-0000-4000-e000-000000000001';
  v_grp_b_id UUID := '00000000-0000-4000-e000-000000000002';
  v_grp_c_id UUID := '00000000-0000-4000-e000-000000000003';
  v_grp_arch_test_id UUID := '00000000-0000-4000-e000-000000000099';
  v_grp_inst_a_id UUID := '00000000-0000-4000-e000-000000000011';
  v_grp_inst_b_id UUID := '00000000-0000-4000-e000-000000000012';

  v_stu_1_id UUID := '00000000-0000-4000-f000-000000000001';
  v_stu_2_id UUID := '00000000-0000-4000-f000-000000000002';

  v_lec_a_id UUID := '00000000-0000-4000-9000-000000000001';
  v_lec_b_id UUID := '00000000-0000-4000-9000-000000000002';
  v_lec_7a_base_id UUID := '00000000-0000-4000-9000-000000000081';
  v_lec_7b_base_id UUID := '00000000-0000-4000-9000-000000000082';
  v_lec_7c_base_id UUID := '00000000-0000-4000-9000-000000000083';
  v_lec_7d_p1_id UUID := '00000000-0000-4000-9000-000000000084';
  v_lec_7d_p2_id UUID := '00000000-0000-4000-9000-000000000085';
  v_lec_conflict_inst_id UUID := '00000000-0000-4000-9000-000000000091';
  v_lec_conflict_grp_id UUID := '00000000-0000-4000-9000-000000000092';
  v_lec_conflict_room_id UUID := '00000000-0000-4000-9000-000000000093';
  v_lec_conflict_limit_id UUID := '00000000-0000-4000-9000-000000000094';

  v_checkin_a_id UUID := '00000000-0000-4000-9000-000000000041';
  v_sheet_a_id UUID := '00000000-0000-4000-9000-000000000011';
  v_sheet_b_id UUID := '00000000-0000-4000-9000-000000000012';
  v_rec_stu1_id UUID := '00000000-0000-4000-9000-000000000021';
  v_rec_dup_test_id UUID := '00000000-0000-4000-9000-000000000095';
  v_ent_a_id UUID := '00000000-0000-4000-9000-000000000031';
  v_test_audit_id UUID := '00000000-0000-4000-8000-000000000001';

  v_fixtures_ready BOOLEAN := FALSE;
  v_fixture_error TEXT := NULL;

  v_arch_initial_status public.camp_status;
  v_arch_after_status public.camp_status;
  v_arch_after_at TIMESTAMPTZ;

  v_tx_result JSONB;
  v_override_result JSONB;
  v_rejected BOOLEAN;
  v_err_msg TEXT;
  v_substage TEXT;
  v_subtest_failures TEXT;
  v_subtest_summary TEXT;
  v_6b_archived_ok BOOLEAN;
  v_test_step INTEGER;
BEGIN
  -- ===========================================================================
  -- TEST 1/10: Exact 29 Named Tables, True pg_constraint PK/FK Verification,
  --            Multi-Layer Sequence/Default Identity Audit & pg_proc Signatures
  -- ===========================================================================
  BEGIN
    SELECT
      string_agg(req.tbl_name, ', ' ORDER BY req.tbl_name),
      COUNT(t.table_name)
    INTO v_missing_tables, v_verified_table_count
    FROM unnest(v_required_tables) AS req(tbl_name)
    LEFT JOIN information_schema.tables t
      ON t.table_schema = 'public'
     AND t.table_type = 'BASE TABLE'
     AND t.table_name = req.tbl_name
    WHERE t.table_name IS NULL;

    IF v_missing_tables IS NOT NULL THEN
      RAISE EXCEPTION 'Missing required CITS tables in public schema: %', v_missing_tables;
    END IF;

    SELECT COUNT(*) INTO v_verified_table_count
    FROM unnest(v_required_tables) AS req(tbl_name)
    JOIN information_schema.tables t
      ON t.table_schema = 'public'
     AND t.table_type = 'BASE TABLE'
     AND t.table_name = req.tbl_name;

    IF v_verified_table_count != 29 THEN
      RAISE EXCEPTION 'Expected exactly 29 named CITS tables, verified %', v_verified_table_count;
    END IF;

    -- Verify Phase 2 schema alignment columns by name
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'camp_id'
    ) THEN
      v_missing_phase2_cols := v_missing_phase2_cols || 'audit_logs.camp_id ';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'attendance_sheets' AND column_name = 'sync_state'
    ) THEN
      v_missing_phase2_cols := v_missing_phase2_cols || 'attendance_sheets.sync_state ';
    END IF;

    IF v_missing_phase2_cols != '' THEN
      RAISE EXCEPTION 'Missing required Phase 2 columns: %', v_missing_phase2_cols;
    END IF;

    -- True pg_constraint Primary Key Verification:
    -- Proves that every one of the 29 required tables has an actual PRIMARY KEY
    -- constraint (contype = 'p') in pg_constraint on single column "id" of type UUID
    -- (atttypid = 'uuid'::regtype, attnotnull = TRUE), and that the 28 non-FK PK tables
    -- have a default expression calling gen_random_uuid().
    SELECT string_agg(req.tbl_name, ', ' ORDER BY req.tbl_name)
    INTO v_non_uuid_pk_tables
    FROM unnest(v_required_tables) AS req(tbl_name)
    LEFT JOIN (
      SELECT
        tc.relname AS tbl_name,
        a.attname AS pk_col_name,
        a.atttypid AS pk_type_oid,
        a.attnotnull AS pk_not_null,
        pg_get_expr(ad.adbin, ad.adrelid) AS pk_default_expr
      FROM pg_class tc
      JOIN pg_namespace tn ON tn.oid = tc.relnamespace AND tn.nspname = 'public'
      JOIN pg_constraint pk ON pk.conrelid = tc.oid AND pk.contype = 'p' AND cardinality(pk.conkey) = 1
      JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = pk.conkey[1] AND NOT a.attisdropped
      LEFT JOIN pg_attrdef ad ON ad.adrelid = tc.oid AND ad.adnum = a.attnum
    ) pk_info
      ON pk_info.tbl_name = req.tbl_name
     AND pk_info.pk_col_name = 'id'
     AND pk_info.pk_type_oid = 'uuid'::regtype
     AND pk_info.pk_not_null = TRUE
     AND (
       req.tbl_name = 'profiles'
       OR COALESCE(pk_info.pk_default_expr, '') ILIKE '%gen_random_uuid()%'
     )
    WHERE pk_info.tbl_name IS NULL;

    IF v_non_uuid_pk_tables IS NOT NULL THEN
      RAISE EXCEPTION 'Tables failing pg_constraint PRIMARY KEY (id UUID) verification: %', v_non_uuid_pk_tables;
    END IF;

    -- True pg_constraint Foreign Key Verification for public.profiles(id) -> auth.users(id)
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint fk
      JOIN pg_attribute src_a
        ON src_a.attrelid = fk.conrelid
       AND src_a.attnum = fk.conkey[1]
       AND NOT src_a.attisdropped
      JOIN pg_attribute ref_a
        ON ref_a.attrelid = fk.confrelid
       AND ref_a.attnum = fk.confkey[1]
       AND NOT ref_a.attisdropped
      WHERE fk.contype = 'f'
        AND fk.conrelid = 'public.profiles'::regclass
        AND fk.confrelid = 'auth.users'::regclass
        AND cardinality(fk.conkey) = 1
        AND cardinality(fk.confkey) = 1
        AND src_a.attname = 'id'
        AND src_a.atttypid = 'uuid'::regtype
        AND ref_a.attname = 'id'
        AND ref_a.atttypid = 'uuid'::regtype
    ) INTO v_profiles_fk_verified;

    IF NOT v_profiles_fk_verified THEN
      RAISE EXCEPTION 'Missing or invalid Foreign Key constraint from public.profiles(id) to auth.users(id) in pg_constraint';
    END IF;

    -- 1. Sequence & Default Audit Layer A: Inspect information_schema.columns
    --    across all columns of all 29 public tables + auth.users for identity columns,
    --    nextval/setval/currval text literals, or external calls
    SELECT string_agg(format('%s.%s.%s (default=%s, identity=%s)',
      c.table_schema, c.table_name, c.column_name, COALESCE(c.column_default, 'NULL'), c.is_identity), ', ')
    INTO v_unsafe_column_defaults
    FROM information_schema.columns c
    WHERE (
      (c.table_schema = 'public' AND c.table_name = ANY(v_required_tables))
      OR (c.table_schema = 'auth' AND c.table_name = 'users')
    )
    AND (
      c.is_identity = 'YES'
      OR COALESCE(c.column_default, '') ILIKE '%nextval%'
      OR COALESCE(c.column_default, '') ILIKE '%setval%'
      OR COALESCE(c.column_default, '') ILIKE '%currval%'
      OR COALESCE(c.column_default, '') ILIKE '%http%'
      OR COALESCE(c.column_default, '') ILIKE '%net.%'
      OR COALESCE(c.column_default, '') ILIKE '%supabase_functions%'
      OR COALESCE(c.column_default, '') ILIKE '%dblink%'
      OR COALESCE(c.column_default, '') ILIKE '%pg_notify%'
      OR COALESCE(c.column_default, '') ILIKE '%pg_background%'
    );

    IF v_unsafe_column_defaults IS NOT NULL THEN
      RAISE EXCEPTION 'Unsafe or sequence-backed column default(s) detected: %', v_unsafe_column_defaults;
    END IF;

    -- 2. Sequence & Default Audit Layer B (OWNED SEQUENCES across ALL schemas):
    --    In pg_depend, an OWNED or IDENTITY sequence has:
    --      d.classid = 'pg_class'::regclass AND d.objid = sequence.oid
    --      d.refclassid = 'pg_class'::regclass AND d.refobjid = table.oid
    SELECT string_agg(
      format('OWNED[%s]: %s.%s.%s <- %s.%s',
        d.deptype, tn.nspname, tc.relname, COALESCE(a.attname, '<table-level>'), sn.nspname, sc.relname),
      ', '
    )
    INTO v_owned_sequences
    FROM pg_depend d
    JOIN pg_class sc ON sc.oid = d.objid AND sc.relkind = 'S'
    JOIN pg_namespace sn ON sn.oid = sc.relnamespace
    JOIN pg_class tc ON tc.oid = d.refobjid
    JOIN pg_namespace tn ON tn.oid = tc.relnamespace
    LEFT JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = d.refobjsubid
    WHERE d.classid = 'pg_class'::regclass
      AND d.refclassid = 'pg_class'::regclass
      AND (
        (tn.nspname = 'public' AND tc.relname = ANY(v_required_tables))
        OR (tn.nspname = 'auth' AND tc.relname = 'users')
      );

    -- 3. Sequence & Default Audit Layer C (DEFAULT-REFERENCED SEQUENCES via pg_attrdef + pg_depend across ALL schemas):
    --    When a column DEFAULT expression references a sequence (even WITHOUT OWNED BY),
    --    PostgreSQL records the dependency on the pg_attrdef row:
    --      d.classid = 'pg_attrdef'::regclass AND d.objid = ad.oid
    --      d.refclassid = 'pg_class'::regclass AND d.refobjid = sequence.oid (relkind = 'S')
    SELECT string_agg(
      format('DEFAULT_REF[%s]: %s.%s.%s (expr=%s) -> %s.%s',
        d.deptype, tn.nspname, tc.relname, a.attname,
        pg_get_expr(ad.adbin, ad.adrelid), sn.nspname, sc.relname),
      ', '
    )
    INTO v_default_ref_sequences
    FROM pg_attrdef ad
    JOIN pg_class tc ON tc.oid = ad.adrelid
    JOIN pg_namespace tn ON tn.oid = tc.relnamespace
    JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = ad.adnum AND NOT a.attisdropped
    JOIN pg_depend d ON d.classid = 'pg_attrdef'::regclass
                   AND d.objid = ad.oid
                   AND d.refclassid = 'pg_class'::regclass
    JOIN pg_class sc ON sc.oid = d.refobjid AND sc.relkind = 'S'
    JOIN pg_namespace sn ON sn.oid = sc.relnamespace
    WHERE (tn.nspname = 'public' AND tc.relname = ANY(v_required_tables))
       OR (tn.nspname = 'auth' AND tc.relname = 'users');

    -- 4. Sequence & Default Audit Layer D (FUNCTIONS referenced by pg_attrdef verified by Schema, OID & Extension Identity):
    --    Does NOT rely on proname alone. Allows ONLY:
    --      (a) Built-in pg_catalog internal functions verified by exact regprocedure OID:
    --          pg_catalog.gen_random_uuid(), pg_catalog.now(), pg_catalog.transaction_timestamp(),
    --          pg_catalog.statement_timestamp(), pg_catalog.clock_timestamp()
    --      (b) Approved extension functions (gen_random_uuid() / uuid_generate_v4() with 0 args returning uuid)
    --          that have a proven deptype = 'e' dependency on pg_extension ('pgcrypto' or 'uuid-ossp').
    --    Any user-defined or unrecognized function in ANY schema triggers FAIL.
    SELECT string_agg(
      format('DEFAULT_FUNC: %s.%s.%s -> %s.%s(%s) [oid=%s, lang=%s]',
        tn.nspname, tc.relname, a.attname, fn.nspname, p.proname,
        pg_get_function_identity_arguments(p.oid), p.oid, l.lanname),
      ', '
    )
    INTO v_default_func_deps
    FROM pg_attrdef ad
    JOIN pg_class tc ON tc.oid = ad.adrelid
    JOIN pg_namespace tn ON tn.oid = tc.relnamespace
    JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = ad.adnum AND NOT a.attisdropped
    JOIN pg_depend d ON d.classid = 'pg_attrdef'::regclass
                   AND d.objid = ad.oid
                   AND d.refclassid = 'pg_proc'::regclass
    JOIN pg_proc p ON p.oid = d.refobjid
    JOIN pg_namespace fn ON fn.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE (
      (tn.nspname = 'public' AND tc.relname = ANY(v_required_tables))
      OR (tn.nspname = 'auth' AND tc.relname = 'users')
    )
    AND NOT (
      -- (a) Exact built-in pg_catalog internal functions verified by OID, schema, 0 args, and internal language
      (
        fn.nspname = 'pg_catalog'
        AND l.lanname = 'internal'
        AND p.pronargs = 0
        AND p.oid = ANY(ARRAY[
          to_regprocedure('pg_catalog.gen_random_uuid()')::oid,
          to_regprocedure('pg_catalog.now()')::oid,
          to_regprocedure('pg_catalog.transaction_timestamp()')::oid,
          to_regprocedure('pg_catalog.statement_timestamp()')::oid,
          to_regprocedure('pg_catalog.clock_timestamp()')::oid
        ])
      )
      -- (b) Approved pgcrypto / uuid-ossp extension UUID generator verified via pg_depend (deptype = 'e')
      OR (
        fn.nspname IN ('public', 'extensions')
        AND p.proname IN ('gen_random_uuid', 'uuid_generate_v4')
        AND p.pronargs = 0
        AND p.prorettype = 'uuid'::regtype
        AND EXISTS (
          SELECT 1
          FROM pg_depend ed
          JOIN pg_extension ext ON ext.oid = ed.refobjid
          WHERE ed.classid = 'pg_proc'::regclass
            AND ed.objid = p.oid
            AND ed.refclassid = 'pg_extension'::regclass
            AND ed.deptype = 'e'
            AND ext.extname IN ('pgcrypto', 'uuid-ossp')
        )
      )
    );

    v_attached_sequences := NULLIF(
      concat_ws('; ', v_owned_sequences, v_default_ref_sequences, v_default_func_deps),
      ''
    );

    IF v_attached_sequences IS NOT NULL THEN
      RAISE EXCEPTION 'Sequence or unverified default function dependency detected on target tables (across all schemas): %',
        v_attached_sequences;
    END IF;

    SELECT COUNT(*) INTO v_public_seq_count
    FROM information_schema.sequences
    WHERE sequence_schema = 'public';

    IF v_public_seq_count != 0 THEN
      RAISE EXCEPTION 'Expected 0 sequences in public schema, found %', v_public_seq_count;
    END IF;

    IF to_regprocedure('public.is_cits_admin()') IS NULL THEN
      v_missing_funcs := v_missing_funcs || 'is_cits_admin() ';
    END IF;
    IF to_regprocedure('public.current_instructor_id()') IS NULL THEN
      v_missing_funcs := v_missing_funcs || 'current_instructor_id() ';
    END IF;
    IF to_regprocedure('public.resolve_login_identifier(text)') IS NULL THEN
      v_missing_funcs := v_missing_funcs || 'resolve_login_identifier(text) ';
    END IF;
    IF to_regprocedure('public.submit_attendance_sheet_tx(uuid)') IS NULL THEN
      v_missing_funcs := v_missing_funcs || 'submit_attendance_sheet_tx(uuid) ';
    END IF;
    IF to_regprocedure('public.admin_override_entitlement_tx(uuid,public.entitlement_status,text)') IS NULL THEN
      v_missing_funcs := v_missing_funcs || 'admin_override_entitlement_tx(uuid,entitlement_status,text) ';
    END IF;
    IF to_regprocedure('public.bootstrap_cits_admin_account(uuid,text,text,text,smallint)') IS NULL THEN
      v_missing_funcs := v_missing_funcs || 'bootstrap_cits_admin_account(uuid,text,text,text,smallint) ';
    END IF;

    IF v_missing_funcs != '' THEN
      RAISE EXCEPTION 'Missing or mismatched functions in pg_proc: %', v_missing_funcs;
    END IF;

    SELECT
      has_function_privilege('anon', 'public.bootstrap_cits_admin_account(uuid,text,text,text,smallint)', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.bootstrap_cits_admin_account(uuid,text,text,text,smallint)', 'EXECUTE')
    INTO v_anon_can_bootstrap, v_auth_can_bootstrap;

    IF v_anon_can_bootstrap OR v_auth_can_bootstrap THEN
      RAISE EXCEPTION 'bootstrap_cits_admin_account must be revoked from anon (%) and authenticated (%)',
        v_anon_can_bootstrap, v_auth_can_bootstrap;
    END IF;

    UPDATE _cits_verification_report
    SET test_code = '[PASS 1/10]',
        status = 'PASS',
        evidence = format('All %s/29 named tables, pg_constraint UUID PKs & profiles->auth.users FK proven; 0 owned/default sequences & 0 unverified default funcs across all schemas; 6 pg_proc signatures verified', v_verified_table_count)
    WHERE step_order = 1;
    RAISE NOTICE '[PASS 1/10] All %/29 named tables, pg_constraint PK/FK, sequence/default identity audits & pg_proc signatures verified', v_verified_table_count;
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE _cits_verification_report
      SET test_code = '[FAIL 1/10]',
          status = 'FAIL',
          evidence = SQLERRM
      WHERE step_order = 1;
      RAISE NOTICE '[FAIL 1/10] %', SQLERRM;
  END;

  -- ===========================================================================
  -- TEST 2/10: Row Level Security Enabled on All 29 Named Tables
  -- ===========================================================================
  BEGIN
    SELECT string_agg(req.tbl_name, ', ' ORDER BY req.tbl_name)
    INTO v_rls_disabled_tables
    FROM unnest(v_required_tables) AS req(tbl_name)
    LEFT JOIN pg_tables pt
      ON pt.schemaname = 'public'
     AND pt.tablename = req.tbl_name
     AND pt.rowsecurity = TRUE
    WHERE pt.tablename IS NULL;

    IF v_rls_disabled_tables IS NOT NULL THEN
      RAISE EXCEPTION 'RLS is NOT enabled on required CITS tables: %', v_rls_disabled_tables;
    END IF;

    SELECT COUNT(*) INTO v_rls_enabled_count
    FROM unnest(v_required_tables) AS req(tbl_name)
    JOIN pg_tables pt
      ON pt.schemaname = 'public'
     AND pt.tablename = req.tbl_name
     AND pt.rowsecurity = TRUE;

    IF v_rls_enabled_count != 29 THEN
      RAISE EXCEPTION 'Expected RLS enabled on all 29 named tables, found %', v_rls_enabled_count;
    END IF;

    UPDATE _cits_verification_report
    SET test_code = '[PASS 2/10]',
        status = 'PASS',
        evidence = format('pg_tables confirms rowsecurity = TRUE on all %s/29 named CITS tables', v_rls_enabled_count)
    WHERE step_order = 2;
    RAISE NOTICE '[PASS 2/10] Row Level Security enabled on all %/29 named tables', v_rls_enabled_count;
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE _cits_verification_report
      SET test_code = '[FAIL 2/10]',
          status = 'FAIL',
          evidence = SQLERRM
      WHERE step_order = 2;
      RAISE NOTICE '[FAIL 2/10] %', SQLERRM;
  END;

  -- ===========================================================================
  -- TEST 3/10: Separated RLS Policy Existence (All 29 Named Tables) vs
  --            Static Predicate Safety Audit (With REVIEW_REQUIRED Classification)
  -- ===========================================================================
  BEGIN
    -- Part 3A: Prove Policy Existence on All 29 Named Tables
    SELECT string_agg(req.tbl_name, ', ' ORDER BY req.tbl_name)
    INTO v_unprotected_tables
    FROM unnest(v_required_tables) AS req(tbl_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_policies pol
      WHERE pol.schemaname = 'public'
        AND pol.tablename = req.tbl_name
    );

    IF v_unprotected_tables IS NOT NULL THEN
      RAISE EXCEPTION 'Missing explicit RLS policies on required CITS tables: %', v_unprotected_tables;
    END IF;

    SELECT
      COUNT(DISTINCT req.tbl_name),
      COUNT(pol.policyname)
    INTO v_policies_table_count, v_total_policies_count
    FROM unnest(v_required_tables) AS req(tbl_name)
    JOIN pg_policies pol
      ON pol.schemaname = 'public'
     AND pol.tablename = req.tbl_name;

    IF v_policies_table_count != 29 THEN
      RAISE EXCEPTION 'Expected explicit RLS policies on all 29 named tables, found %', v_policies_table_count;
    END IF;

    -- Part 3B: Hard Policy Violations (Immediate FAIL)
    -- 1. Literal USING(true) or WITH CHECK(true) or tautologies (1=1)
    SELECT COUNT(*) INTO v_permissive_true_count
    FROM pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = ANY(v_required_tables)
      AND (
        LOWER(TRIM(COALESCE(pol.qual, ''))) IN ('true', '(true)', '1=1', '(1 = 1)')
        OR LOWER(TRIM(COALESCE(pol.with_check, ''))) IN ('true', '(true)', '1=1', '(1 = 1)')
        OR COALESCE(pol.qual, '') ~* '\mor\s*\(?\s*true\M'
        OR COALESCE(pol.with_check, '') ~* '\mor\s*\(?\s*true\M'
        OR COALESCE(pol.qual, '') ~* '1\s*=\s*1'
        OR COALESCE(pol.with_check, '') ~* '1\s*=\s*1'
      );

    IF v_permissive_true_count > 0 THEN
      RAISE EXCEPTION 'Found % overly permissive/tautological RLS policy expression(s) in public schema', v_permissive_true_count;
    END IF;

    -- 2. Role target must be strictly {authenticated} (never public/anon),
    --    required USING/WITH CHECK clauses must be present for cmd, and every policy
    --    must reference at least one CITS identity/authorization anchor function.
    SELECT string_agg(
      format('%s.%s [cmd=%s, roles=%s]', pol.tablename, pol.policyname, pol.cmd, pol.roles::text),
      ', ' ORDER BY pol.tablename, pol.policyname
    )
    INTO v_invalid_policy_defs
    FROM pg_policies pol
    WHERE pol.schemaname = 'public'
      AND pol.tablename = ANY(v_required_tables)
      AND (
        -- Must target only authenticated role
        pol.roles IS DISTINCT FROM ARRAY['authenticated']::name[]
        -- SELECT, UPDATE, DELETE, ALL must have a non-empty USING (qual) expression
        OR (pol.cmd IN ('SELECT', 'UPDATE', 'DELETE', 'ALL') AND TRIM(COALESCE(pol.qual, '')) = '')
        -- INSERT, UPDATE, ALL must have a non-empty WITH CHECK (with_check) expression
        OR (pol.cmd IN ('INSERT', 'UPDATE', 'ALL') AND TRIM(COALESCE(pol.with_check, '')) = '')
        -- Active USING expression (when present) must reference a verified CITS identity/auth anchor
        OR (
          TRIM(COALESCE(pol.qual, '')) != ''
          AND COALESCE(pol.qual, '') NOT ILIKE '%is_cits_admin()%'
          AND COALESCE(pol.qual, '') NOT ILIKE '%current_instructor_id()%'
          AND COALESCE(pol.qual, '') NOT ILIKE '%auth.uid()%'
          AND COALESCE(pol.qual, '') NOT ILIKE '%is_instructor_assigned_to_camp(%'
          AND COALESCE(pol.qual, '') NOT ILIKE '%is_instructor_assigned_to_group(%'
          AND COALESCE(pol.qual, '') NOT ILIKE '%is_lecture_active_instructor(%'
        )
        -- Active WITH CHECK expression (when present) must reference a verified CITS identity/auth anchor
        OR (
          TRIM(COALESCE(pol.with_check, '')) != ''
          AND COALESCE(pol.with_check, '') NOT ILIKE '%is_cits_admin()%'
          AND COALESCE(pol.with_check, '') NOT ILIKE '%current_instructor_id()%'
          AND COALESCE(pol.with_check, '') NOT ILIKE '%auth.uid()%'
          AND COALESCE(pol.with_check, '') NOT ILIKE '%is_instructor_assigned_to_camp(%'
          AND COALESCE(pol.with_check, '') NOT ILIKE '%is_instructor_assigned_to_group(%'
          AND COALESCE(pol.with_check, '') NOT ILIKE '%is_lecture_active_instructor(%'
        )
      );

    IF v_invalid_policy_defs IS NOT NULL THEN
      RAISE EXCEPTION 'RLS policies failed role target, missing USING/WITH CHECK, or missing identity anchor check: %',
        v_invalid_policy_defs;
    END IF;

    -- Part 3C: Static Predicate Classification vs REVIEW_REQUIRED.
    -- IMPORTANT:
    --   1. Finding an identity anchor substring in Part 3B is only a minimum baseline
    --      filter (absence => FAIL); it is NEVER a sufficient proof of logical safety.
    --   2. We do NOT use regex OR-splitting as a logical parser because regular
    --      expressions cannot parse SQL boolean precedence, parenthetical grouping,
    --      negations, or subquery semantics.
    --   3. Any policy clause (USING or WITH CHECK) that contains OR, AND, EXISTS,
    --      SELECT, NOT, !=, <>, IS NULL, IS NOT NULL (such as role-only checks like
    --      current_instructor_id() IS NOT NULL), IN (...), or any expression outside
    --      a trivial single-predicate atomic identity match is classified as
    --      REVIEW_REQUIRED ([REVIEW 3/10]) with its specific reason.
    WITH policy_clauses AS (
      SELECT
        pol.tablename,
        pol.policyname,
        pol.cmd,
        'USING' AS clause_type,
        TRIM(pol.qual) AS expr,
        LOWER(regexp_replace(TRIM(pol.qual), '^\(+|\)+$', '', 'g')) AS norm_expr
      FROM pg_policies pol
      WHERE pol.schemaname = 'public'
        AND pol.tablename = ANY(v_required_tables)
        AND pol.qual IS NOT NULL
      UNION ALL
      SELECT
        pol.tablename,
        pol.policyname,
        pol.cmd,
        'WITH CHECK' AS clause_type,
        TRIM(pol.with_check) AS expr,
        LOWER(regexp_replace(TRIM(pol.with_check), '^\(+|\)+$', '', 'g')) AS norm_expr
      FROM pg_policies pol
      WHERE pol.schemaname = 'public'
        AND pol.tablename = ANY(v_required_tables)
        AND pol.with_check IS NOT NULL
    ),
    unproven_clauses AS (
      SELECT
        format(
          '%s.%s [%s: %s]',
          pc.tablename,
          pc.policyname,
          pc.clause_type,
          concat_ws(
            '+',
            CASE WHEN pc.expr ~* '\mOR\M' THEN 'CONTAINS_OR_DISJUNCTION' END,
            CASE WHEN pc.expr ~* '\m(EXISTS|SELECT)\M' THEN 'CONTAINS_SUBQUERY_OR_EXISTS' END,
            CASE WHEN pc.expr ~* '\mIS\s+NOT\s+NULL\M' THEN 'NON_OWNERSHIP_ROLE_CHECK_IS_NOT_NULL' END,
            CASE WHEN pc.expr ~* '(\mAND\M|\mNOT\M|!=|<>|\mIN\s*\()' THEN 'CONTAINS_COMPOUND_AND_OR_NEGATION' END,
            CASE
              WHEN pc.norm_expr NOT IN (
                'is_cits_admin()',
                'public.is_cits_admin()',
                'id = auth.uid()',
                'profile_id = auth.uid()',
                'instructor_id = current_instructor_id()',
                'instructor_id = public.current_instructor_id()',
                'recipient_profile_id = auth.uid()',
                'reported_by = auth.uid()',
                'uploaded_by = auth.uid()',
                'is_instructor_assigned_to_camp(id)',
                'public.is_instructor_assigned_to_camp(id)',
                'is_instructor_assigned_to_camp(camp_id)',
                'public.is_instructor_assigned_to_camp(camp_id)',
                'is_instructor_assigned_to_group(id)',
                'public.is_instructor_assigned_to_group(id)',
                'is_instructor_assigned_to_group(group_id)',
                'public.is_instructor_assigned_to_group(group_id)'
              ) THEN 'NON_ATOMIC_PREDICATE'
            END
          )
        ) AS policy_ref
      FROM policy_clauses pc
      WHERE pc.expr ~* '\mOR\M'
         OR pc.expr ~* '\m(EXISTS|SELECT)\M'
         OR pc.expr ~* '\mIS\s+NOT\s+NULL\M'
         OR pc.expr ~* '(\mAND\M|\mNOT\M|!=|<>|\mIN\s*\()'
         OR pc.norm_expr NOT IN (
           'is_cits_admin()',
           'public.is_cits_admin()',
           'id = auth.uid()',
           'profile_id = auth.uid()',
           'instructor_id = current_instructor_id()',
           'instructor_id = public.current_instructor_id()',
           'recipient_profile_id = auth.uid()',
           'reported_by = auth.uid()',
           'uploaded_by = auth.uid()',
           'is_instructor_assigned_to_camp(id)',
           'public.is_instructor_assigned_to_camp(id)',
           'is_instructor_assigned_to_camp(camp_id)',
           'public.is_instructor_assigned_to_camp(camp_id)',
           'is_instructor_assigned_to_group(id)',
           'public.is_instructor_assigned_to_group(id)',
           'is_instructor_assigned_to_group(group_id)',
           'public.is_instructor_assigned_to_group(group_id)'
         )
    )
    SELECT string_agg(policy_ref, ', ' ORDER BY policy_ref)
    INTO v_review_required_policies
    FROM unproven_clauses;

    IF v_review_required_policies IS NOT NULL THEN
      UPDATE _cits_verification_report
      SET test_code = '[REVIEW 3/10]',
          status = 'REVIEW_REQUIRED',
          evidence = format('Existence verified on 29/29 tables (%s policies, all TO authenticated), but static text inspection cannot prove logical safety of compound/OR/subquery/role-only predicate(s) — REVIEW_REQUIRED: %s',
            v_total_policies_count, v_review_required_policies)
      WHERE step_order = 3;
      RAISE NOTICE '[REVIEW 3/10] Policy existence verified, but manual semantic review required for non-atomic predicate(s): %', v_review_required_policies;
    ELSE
      UPDATE _cits_verification_report
      SET test_code = '[PASS 3/10]',
          status = 'PASS',
          evidence = format('Existence proven on %s/29 named tables (%s policies, all TO authenticated); all predicates matched single atomic identity templates (Note: static catalog check does not prove runtime behavioral semantics)',
            v_policies_table_count, v_total_policies_count)
      WHERE step_order = 3;
      RAISE NOTICE '[PASS 3/10] Policy existence (%/29 tables, % policies) & atomic identity template check completed',
        v_policies_table_count, v_total_policies_count;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE _cits_verification_report
      SET test_code = '[FAIL 3/10]',
          status = 'FAIL',
          evidence = SQLERRM
      WHERE step_order = 3;
      RAISE NOTICE '[FAIL 3/10] %', SQLERRM;
  END;

  -- ===========================================================================
  -- TEST 4/10: Private Storage Bucket checkin-selfies (300KB, JPEG/WebP)
  -- ===========================================================================
  BEGIN
    SELECT id, public, file_size_limit, allowed_mime_types
    INTO v_bucket
    FROM storage.buckets
    WHERE id = 'checkin-selfies';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Storage bucket checkin-selfies does not exist in storage.buckets';
    END IF;

    IF v_bucket.public IS TRUE OR v_bucket.file_size_limit != 307200 THEN
      RAISE EXCEPTION 'Invalid checkin-selfies config: public=%, file_size_limit=% (expected false, 307200)',
        v_bucket.public, v_bucket.file_size_limit;
    END IF;

    IF NOT (v_bucket.allowed_mime_types @> ARRAY['image/jpeg', 'image/webp']) THEN
      RAISE EXCEPTION 'Invalid checkin-selfies allowed_mime_types: %', v_bucket.allowed_mime_types;
    END IF;

    SELECT COUNT(*) INTO v_storage_policy_count
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname IN (
        'Admins manage checkin-selfies objects',
        'Instructors upload own checkin-selfies',
        'Instructors read own checkin-selfies'
      );

    IF v_storage_policy_count < 3 THEN
      RAISE EXCEPTION 'Expected 3 checkin-selfies RLS policies on storage.objects, found %', v_storage_policy_count;
    END IF;

    UPDATE _cits_verification_report
    SET test_code = '[PASS 4/10]',
        status = 'PASS',
        evidence = format('Bucket checkin-selfies verified (public=false, limit=307200 bytes [300KB], mime=%s, %s storage.objects policies)',
          v_bucket.allowed_mime_types::text, v_storage_policy_count)
    WHERE step_order = 4;
    RAISE NOTICE '[PASS 4/10] Storage bucket checkin-selfies verified';
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE _cits_verification_report
      SET test_code = '[FAIL 4/10]',
          status = 'FAIL',
          evidence = SQLERRM
      WHERE step_order = 4;
      RAISE NOTICE '[FAIL 4/10] %', SQLERRM;
  END;

  -- ===========================================================================
  -- ISOLATED BASE TEST FIXTURE SETUP (Guarded — Never aborts report generation)
  -- ===========================================================================
  BEGIN
    -- Pre-Flight Guard 1A: Exact Signature, Overload & Trigger Attachment Audit
    -- across auth.users AND all 29 public CITS tables BEFORE any INSERT/UPDATE/DELETE.
    -- 1. Verify all 18 expected trigger & helper/RPC signatures exist by exact
    --    schema + argument types (to_regprocedure(sig)::oid) and have ZERO overloaded
    --    duplicates in public schema (so static call resolution is 1-to-1 with OID).
    WITH expected_sigs AS (
      SELECT
        sig,
        to_regprocedure(sig)::oid AS expected_oid
      FROM unnest(v_expected_trigger_regprocs || v_expected_helper_regprocs) AS sig
    ),
    missing_sigs AS (
      SELECT format('MISSING_SIG: %s', sig) AS issue
      FROM expected_sigs
      WHERE expected_oid IS NULL
    ),
    unexpected_overloads AS (
      SELECT format('OVERLOAD_OR_MISMATCH: %s.%s(%s) [oid=%s]',
        fn.nspname, p.proname, pg_get_function_identity_arguments(p.oid), p.oid) AS issue
      FROM pg_proc p
      JOIN pg_namespace fn ON fn.oid = p.pronamespace
      WHERE fn.nspname = 'public'
        AND p.proname = ANY(v_allowed_cits_trigger_funcs || v_allowed_cits_helper_funcs)
        AND p.oid NOT IN (SELECT expected_oid FROM expected_sigs WHERE expected_oid IS NOT NULL)
    )
    SELECT string_agg(issue, ', ' ORDER BY issue)
    INTO v_missing_or_overloaded_sigs
    FROM (
      SELECT issue FROM missing_sigs
      UNION ALL
      SELECT issue FROM unexpected_overloads
    ) s;

    IF v_missing_or_overloaded_sigs IS NOT NULL THEN
      RAISE EXCEPTION 'Aborted fixture setup: trigger/helper signature or overload check failed (%). Fixture setup halted',
        v_missing_or_overloaded_sigs;
    END IF;

    -- 2. Inspect all enabled non-internal triggers on auth.users and all 29 public tables.
    --    Reports each trigger name, its associated function (schema.function(args)),
    --    and the exact reason(s) it is considered unapproved or unsafe.
    --    IMPORTANT: Rejecting a trigger (especially on auth.users) does NOT necessarily
    --    mean the trigger is malicious or harmful; it means the trigger lies outside the
    --    pre-approved CITS static verification scope and cannot be proven side-effect-free
    --    before inserting ephemeral test rows into auth.users.
    SELECT string_agg(
      format(
        '%s.%s: trigger=%s -> function=%s.%s(%s) [oid=%s, lang=%s, reasons=%s]',
        tn.nspname,
        tc.relname,
        t.tgname,
        fn.nspname,
        p.proname,
        pg_get_function_identity_arguments(p.oid),
        p.oid,
        l.lanname,
        concat_ws(
          '; ',
          CASE
            WHEN tn.nspname = 'auth' AND tc.relname = 'users'
              THEN 'OUTSIDE_APPROVED_SCOPE(trigger on auth.users is not in CITS approved trigger allowlist; rejection means outside verified audit scope, not necessarily malicious)'
          END,
          CASE
            WHEN tn.nspname = 'public' AND p.oid NOT IN (
              SELECT to_regprocedure(sig)::oid
              FROM unnest(v_expected_trigger_regprocs) AS sig
              WHERE to_regprocedure(sig) IS NOT NULL
            )
              THEN 'UNAPPROVED_PUBLIC_TRIGGER_FUNCTION(function OID/signature is not in v_expected_trigger_regprocs allowlist)'
          END,
          CASE
            WHEN l.lanname NOT IN ('plpgsql', 'sql')
              THEN format('UNVERIFIABLE_LANGUAGE(language %s cannot be statically inspected)', l.lanname)
          END,
          CASE
            WHEN COALESCE(array_to_string(p.proconfig, ','), '') NOT ILIKE '%search_path=public, pg_temp%'
              THEN format('UNPINNED_SEARCH_PATH(proconfig=%s missing search_path=public, pg_temp)', COALESCE(array_to_string(p.proconfig, ';'), 'NONE'))
          END,
          CASE
            WHEN COALESCE(p.prosrc, '') ~* '\mexecute\M'
              THEN 'DYNAMIC_SQL_DETECTED(prosrc contains EXECUTE statement)'
          END,
          CASE
            WHEN fn.nspname IN ('net', 'supabase_functions')
              OR p.proname ILIKE '%http%'
              OR p.proname ILIKE '%webhook%'
              OR p.proname ILIKE '%notify%'
              OR COALESCE(p.prosrc, '') ILIKE '%net.%'
              OR COALESCE(p.prosrc, '') ILIKE '%supabase_functions%'
              OR COALESCE(p.prosrc, '') ILIKE '%http_%'
              OR COALESCE(p.prosrc, '') ILIKE '%webhook%'
              OR COALESCE(p.prosrc, '') ILIKE '%dblink%'
              OR COALESCE(p.prosrc, '') ILIKE '%pg_notify%'
              OR COALESCE(p.prosrc, '') ILIKE '%pg_background%'
              OR CASE
                   WHEN l.lanname IN ('plpgsql', 'sql') THEN
                     COALESCE(pg_get_functiondef(p.oid), '') ILIKE '%net.%'
                     OR COALESCE(pg_get_functiondef(p.oid), '') ILIKE '%supabase_functions%'
                     OR COALESCE(pg_get_functiondef(p.oid), '') ILIKE '%http_%'
                     OR COALESCE(pg_get_functiondef(p.oid), '') ILIKE '%webhook%'
                     OR COALESCE(pg_get_functiondef(p.oid), '') ILIKE '%dblink%'
                     OR COALESCE(pg_get_functiondef(p.oid), '') ILIKE '%pg_notify%'
                     OR COALESCE(pg_get_functiondef(p.oid), '') ILIKE '%pg_background%'
                   ELSE TRUE
                 END
              THEN 'EXTERNAL_OR_IPC_SIDE_EFFECT(references network/webhook/dblink/notify/background primitive)'
          END
        )
      ),
      ', ' ORDER BY tn.nspname, tc.relname, t.tgname
    )
    INTO v_unsafe_triggers
    FROM pg_trigger t
    JOIN pg_class tc ON tc.oid = t.tgrelid
    JOIN pg_namespace tn ON tn.oid = tc.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace fn ON fn.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE NOT t.tgisinternal
      AND t.tgenabled != 'D'
      AND (
        (tn.nspname = 'auth' AND tc.relname = 'users')
        OR (tn.nspname = 'public' AND tc.relname = ANY(v_required_tables))
      )
      AND (
        -- 1. Any non-internal enabled trigger on auth.users is outside the approved CITS audit scope
        (tn.nspname = 'auth' AND tc.relname = 'users')
        -- 2. Trigger function language cannot be statically inspected (e.g. C/internal)
        OR l.lanname NOT IN ('plpgsql', 'sql')
        -- 3. Trigger function must have a pinned search_path (public, pg_temp)
        OR COALESCE(array_to_string(p.proconfig, ','), '') NOT ILIKE '%search_path=public, pg_temp%'
        -- 4. Trigger function OID must match one of the 8 exact schema+signature regprocedures
        OR p.oid NOT IN (
          SELECT to_regprocedure(sig)::oid
          FROM unnest(v_expected_trigger_regprocs) AS sig
          WHERE to_regprocedure(sig) IS NOT NULL
        )
        -- 5. Direct inspection of BOTH prosrc AND pg_get_functiondef(p.oid) for external/dynamic calls
        OR fn.nspname IN ('net', 'supabase_functions')
        OR p.proname ILIKE '%http%'
        OR p.proname ILIKE '%webhook%'
        OR p.proname ILIKE '%notify%'
        OR COALESCE(p.prosrc, '') ILIKE '%net.%'
        OR COALESCE(p.prosrc, '') ILIKE '%supabase_functions%'
        OR COALESCE(p.prosrc, '') ILIKE '%http_%'
        OR COALESCE(p.prosrc, '') ILIKE '%webhook%'
        OR COALESCE(p.prosrc, '') ILIKE '%dblink%'
        OR COALESCE(p.prosrc, '') ILIKE '%pg_notify%'
        OR COALESCE(p.prosrc, '') ILIKE '%pg_background%'
        OR COALESCE(p.prosrc, '') ~* '\mexecute\M'
        OR CASE
             WHEN l.lanname IN ('plpgsql', 'sql') THEN
               COALESCE(pg_get_functiondef(p.oid), '') ILIKE '%net.%'
               OR COALESCE(pg_get_functiondef(p.oid), '') ILIKE '%supabase_functions%'
               OR COALESCE(pg_get_functiondef(p.oid), '') ILIKE '%http_%'
               OR COALESCE(pg_get_functiondef(p.oid), '') ILIKE '%webhook%'
               OR COALESCE(pg_get_functiondef(p.oid), '') ILIKE '%dblink%'
               OR COALESCE(pg_get_functiondef(p.oid), '') ILIKE '%pg_notify%'
               OR COALESCE(pg_get_functiondef(p.oid), '') ILIKE '%pg_background%'
             ELSE TRUE
           END
      );

    IF v_unsafe_triggers IS NOT NULL THEN
      RAISE EXCEPTION 'Aborted fixture setup: unverified or out-of-scope trigger(s) detected [%]. Note: rejecting a trigger does NOT necessarily mean it is malicious, only that it is outside the approved CITS verification scope. Fixture setup halted before any data modification',
        v_unsafe_triggers;
    END IF;

    -- Pre-Flight Guard 1B: Direct Body, Language, Pinned search_path & Dynamic SQL Audit
    -- on ALL 18 Pre-Approved Trigger, Helper & RPC Functions verified by exact signature OID.
    SELECT string_agg(
      format('%s.%s(%s) [oid=%s, lang=%s, config=%s]',
        fn.nspname, p.proname, pg_get_function_identity_arguments(p.oid),
        p.oid, l.lanname, COALESCE(array_to_string(p.proconfig, ';'), 'NONE')),
      ', '
    )
    INTO v_unsafe_helper_funcs
    FROM pg_proc p
    JOIN pg_namespace fn ON fn.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid IN (
      SELECT to_regprocedure(sig)::oid
      FROM unnest(v_expected_trigger_regprocs || v_expected_helper_regprocs) AS sig
      WHERE to_regprocedure(sig) IS NOT NULL
    )
    AND (
      l.lanname NOT IN ('plpgsql', 'sql')
      OR COALESCE(array_to_string(p.proconfig, ','), '') NOT ILIKE '%search_path=public, pg_temp%'
      OR COALESCE(p.prosrc, '') ILIKE '%net.%'
      OR COALESCE(p.prosrc, '') ILIKE '%supabase_functions%'
      OR COALESCE(p.prosrc, '') ILIKE '%http_%'
      OR COALESCE(p.prosrc, '') ILIKE '%webhook%'
      OR COALESCE(p.prosrc, '') ILIKE '%dblink%'
      OR COALESCE(p.prosrc, '') ILIKE '%pg_notify%'
      OR COALESCE(p.prosrc, '') ILIKE '%pg_background%'
      OR COALESCE(p.prosrc, '') ~* '\mexecute\M'
    );

    IF v_unsafe_helper_funcs IS NOT NULL THEN
      RAISE EXCEPTION 'Aborted fixture setup: helper/trigger function failed body, language, search_path, or Dynamic SQL audit (%). Fixture setup halted',
        v_unsafe_helper_funcs;
    END IF;

    -- Pre-Flight Guard 1C: Bounded Pre-Approved Allowlist Call-Graph Check (WITH RECURSIVE)
    -- EXACT IMPLEMENTATION & UNPROVABLE BOUNDARIES:
    --   1. Scope: Operates strictly on the 18 pre-approved CITS trigger, helper, and RPC
    --      functions (v_expected_trigger_regprocs || v_expected_helper_regprocs).
    --   2. Step 1 (PL/pgSQL Character-by-Character Comment & String Scanner):
    --      Iterates character-by-character over each pre-approved function prosrc to
    --      handle in exact lexical order:
    --      - Single-line comments (double-dash up to CR/LF),
    --      - PostgreSQL nested block comments (slash-star to star-slash tracked via
    --        v_block_comment_depth), and
    --      - Standard single-quoted literals (with doubled single-quote escapes).
    --   3. Step 2 (Unproven Lexical Construct Detection):
    --      Flags as unproven (lex_issues IS NOT NULL) any function containing:
    --      - Unclosed single-quoted literals (UNCLOSED_SINGLE_QUOTE),
    --      - Unclosed or unbalanced block comments (UNCLOSED_NESTED_BLOCK_COMMENT /
    --        STRAY_BLOCK_COMMENT_CLOSE),
    --      - Non-standard string literal prefixes (escape, unicode, bit, hex, or national),
    --      - Backslash characters inside single-quoted literals (which could alter escaping if
    --        standard_conforming_strings were disabled),
    --      - Dollar-quoted strings or dollar-sign tokens (tagged or untagged dollar quotes
    --        and positional parameters) outside comments/strings,
    --      - Double-quoted identifiers outside comments/strings.
    --   4. Step 3 (Regex Call-Token Extraction + pg_depend Traversal):
    --      Extracts identifier(...) tokens via regexp_matches on clean_src and unions them
    --      with pg_depend (pg_proc -> pg_proc) catalog edges across depths 1..4.
    --      NOTE ON LIMITS: This is NOT a full SQL/PLpgSQL grammar or AST parser and cannot
    --      discover all possible PostgreSQL invocations (e.g. operator functions, implicit
    --      casts, type input/output functions, or triggers/functions outside the inspected scope).
    --   5. Fail-Closed Enforcement: If any lexical issue or unresolved/unapproved call token
    --      is detected, the result is NEVER PASS: Test 1 is marked FAIL ([FAIL 1/10]) and
    --      Fixture Setup aborts immediately before any data write (marking Tests 5..10 FAIL).
    DELETE FROM _cits_lexed_procs;

    FOR v_proc_rec IN
      SELECT
        p.oid AS proc_oid,
        fn.nspname AS func_schema,
        p.proname AS func_name,
        format('%s.%s(%s)', fn.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS canonical_sig,
        COALESCE(p.prosrc, '') AS raw_src
      FROM pg_proc p
      JOIN pg_namespace fn ON fn.oid = p.pronamespace
      WHERE p.oid IN (
        SELECT to_regprocedure(sig)::oid
        FROM unnest(v_expected_trigger_regprocs || v_expected_helper_regprocs) AS sig
        WHERE to_regprocedure(sig) IS NOT NULL
      )
    LOOP
      v_src := v_proc_rec.raw_src;
      v_len := char_length(v_src);
      v_pos := 1;
      v_in_line_comment := FALSE;
      v_block_comment_depth := 0;
      v_in_single_quote := FALSE;
      v_clean_buf := '';
      v_has_dollar_token := FALSE;
      v_has_double_quote := FALSE;
      v_has_non_std_quote_prefix := FALSE;
      v_has_backslash_in_quote := FALSE;
      v_has_stray_block_close := FALSE;

      WHILE v_pos <= v_len LOOP
        v_ch := substr(v_src, v_pos, 1);
        v_next := CASE WHEN v_pos < v_len THEN substr(v_src, v_pos + 1, 1) ELSE '' END;

        IF v_in_line_comment THEN
          -- Inside single-line comment: consume characters until newline
          IF v_ch IN (chr(10), chr(13)) THEN
            v_in_line_comment := FALSE;
            v_clean_buf := v_clean_buf || v_ch;
          END IF;
          v_pos := v_pos + 1;

        ELSIF v_block_comment_depth > 0 THEN
          -- Inside block comment: support PostgreSQL nested block comments
          IF v_ch = '/' AND v_next = '*' THEN
            v_block_comment_depth := v_block_comment_depth + 1;
            v_pos := v_pos + 2;
          ELSIF v_ch = '*' AND v_next = '/' THEN
            v_block_comment_depth := v_block_comment_depth - 1;
            IF v_block_comment_depth = 0 THEN
              v_clean_buf := v_clean_buf || ' ';
            END IF;
            v_pos := v_pos + 2;
          ELSE
            v_pos := v_pos + 1;
          END IF;

        ELSIF v_in_single_quote THEN
          -- Inside standard single-quoted string literal: handle doubled single-quote escapes
          IF v_ch = '\' THEN
            v_has_backslash_in_quote := TRUE;
            v_pos := v_pos + 1;
          ELSIF v_ch = '''' THEN
            IF v_next = '''' THEN
              -- Escaped single quote inside literal: consume both characters
              v_pos := v_pos + 2;
            ELSE
              -- End of single-quoted literal: emit empty string placeholder
              v_in_single_quote := FALSE;
              v_clean_buf := v_clean_buf || '''''';
              v_pos := v_pos + 1;
            END IF;
          ELSE
            v_pos := v_pos + 1;
          END IF;

        ELSE
          -- Normal code state (outside comments and single-quoted literals)
          IF v_ch = '-' AND v_next = '-' THEN
            v_in_line_comment := TRUE;
            v_clean_buf := v_clean_buf || ' ';
            v_pos := v_pos + 2;
          ELSIF v_ch = '/' AND v_next = '*' THEN
            v_block_comment_depth := 1;
            v_pos := v_pos + 2;
          ELSIF v_ch = '*' AND v_next = '/' THEN
            v_has_stray_block_close := TRUE;
            v_pos := v_pos + 2;
          ELSIF v_ch = '''' THEN
            IF v_pos > 1 AND substr(v_src, v_pos - 1, 1) ~ '^[eEbBxXnN&]$' THEN
              v_has_non_std_quote_prefix := TRUE;
            END IF;
            v_in_single_quote := TRUE;
            v_pos := v_pos + 1;
          ELSIF v_ch = '$' THEN
            -- Dollar-quoted string or positional parameter token detected
            v_has_dollar_token := TRUE;
            v_clean_buf := v_clean_buf || v_ch;
            v_pos := v_pos + 1;
          ELSIF v_ch = '"' THEN
            -- Double-quoted identifier token detected
            v_has_double_quote := TRUE;
            v_clean_buf := v_clean_buf || v_ch;
            v_pos := v_pos + 1;
          ELSE
            v_clean_buf := v_clean_buf || v_ch;
            v_pos := v_pos + 1;
          END IF;
        END IF;
      END LOOP;

      v_lex_issue_list := NULLIF(
        concat_ws(
          '+',
          CASE WHEN v_in_single_quote THEN 'UNCLOSED_SINGLE_QUOTE' END,
          CASE WHEN v_block_comment_depth > 0 THEN 'UNCLOSED_NESTED_BLOCK_COMMENT' END,
          CASE WHEN v_has_stray_block_close THEN 'STRAY_BLOCK_COMMENT_CLOSE' END,
          CASE WHEN v_has_non_std_quote_prefix THEN 'NON_STANDARD_STRING_PREFIX' END,
          CASE WHEN v_has_backslash_in_quote THEN 'BACKSLASH_IN_SINGLE_QUOTE_LITERAL' END,
          CASE WHEN v_has_dollar_token THEN 'DOLLAR_QUOTE_OR_PARAM_IN_BODY' END,
          CASE WHEN v_has_double_quote THEN 'DOUBLE_QUOTED_IDENTIFIER_IN_BODY' END
        ),
        ''
      );

      INSERT INTO _cits_lexed_procs (
        proc_oid, func_schema, func_name, canonical_sig, raw_src, clean_src, lex_issues
      ) VALUES (
        v_proc_rec.proc_oid,
        v_proc_rec.func_schema,
        v_proc_rec.func_name,
        v_proc_rec.canonical_sig,
        v_proc_rec.raw_src,
        v_clean_buf,
        v_lex_issue_list
      );
    END LOOP;

    WITH RECURSIVE audited_procs AS (
      SELECT
        lp.proc_oid,
        lp.func_schema,
        lp.func_name,
        lp.canonical_sig,
        lp.raw_src,
        lp.clean_src,
        lp.lex_issues
      FROM _cits_lexed_procs lp
    ),
    entrypoint_roots AS (
      -- Active trigger functions on the 29 public tables + tested RPC/RLS entrypoints from the pre-approved list
      SELECT DISTINCT ap.proc_oid, ap.func_name, ap.canonical_sig, ap.clean_src
      FROM audited_procs ap
      WHERE ap.proc_oid IN (
        SELECT DISTINCT t.tgfoid
        FROM pg_trigger t
        JOIN pg_class tc ON tc.oid = t.tgrelid
        JOIN pg_namespace tn ON tn.oid = tc.relnamespace
        WHERE NOT t.tgisinternal
          AND t.tgenabled != 'D'
          AND tn.nspname = 'public'
          AND tc.relname = ANY(v_required_tables)
        UNION
        SELECT to_regprocedure(sig)::oid
        FROM unnest(ARRAY[
          'public.submit_attendance_sheet_tx(uuid)',
          'public.admin_override_entitlement_tx(uuid,public.entitlement_status,text)',
          'public.bootstrap_cits_admin_account(uuid,text,text,text,smallint)',
          'public.is_instructor_assigned_to_camp(uuid)',
          'public.is_instructor_assigned_to_group(uuid)'
        ]) AS sig
        WHERE to_regprocedure(sig) IS NOT NULL
      )
    ),
    direct_extracted_edges AS (
      -- 1. Flag any pre-approved function where the PL/pgSQL state-machine scanner
      --    recorded an unproven lexical construct (dollar-quoting, double-quoted
      --    identifier, non-standard string prefix, backslash in literal, or unclosed
      --    quote/nested block comment)
      SELECT DISTINCT
        ap.proc_oid AS caller_oid,
        ap.canonical_sig AS caller_sig,
        'lexical_unproven'::text AS callee_qual,
        COALESCE(ap.lex_issues, 'UNPROVEN_LEXICAL_CONSTRUCT') AS callee_name,
        NULL::oid AS resolved_oid,
        NULL::text AS resolved_sig
      FROM audited_procs ap
      WHERE ap.lex_issues IS NOT NULL
         OR ap.clean_src ~ '\$'
         OR ap.clean_src ~ '"'
         OR ap.clean_src ~ '(/\*|\*/)'
      UNION
      -- 2. Static call tokens (including any quoted identifier call attempts) extracted from clean_src
      SELECT DISTINCT
        ap.proc_oid AS caller_oid,
        ap.canonical_sig AS caller_sig,
        LOWER(COALESCE(RTRIM(m[1], '.'), '')) AS callee_qual,
        LOWER(m[2]) AS callee_name,
        CASE
          WHEN m[1] ~ '"' OR m[2] ~ '"' THEN NULL::oid
          ELSE target_ap.proc_oid
        END AS resolved_oid,
        CASE
          WHEN m[1] ~ '"' OR m[2] ~ '"' THEN NULL::text
          ELSE target_ap.canonical_sig
        END AS resolved_sig
      FROM audited_procs ap
      CROSS JOIN LATERAL regexp_matches(
        ap.clean_src,
        '((?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\.)?("[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)\s*\(',
        'g'
      ) AS m
      LEFT JOIN audited_procs target_ap
        ON target_ap.func_schema = COALESCE(NULLIF(LOWER(RTRIM(m[1], '.')), ''), 'public')
       AND target_ap.func_name = LOWER(m[2])
      WHERE NOT (LOWER(m[2]) = ANY(v_safe_builtin_call_tokens))
        AND NOT (LOWER(m[2]) = ANY(v_required_tables))
        AND NOT (LOWER(COALESCE(RTRIM(m[1], '.'), '')) = 'auth' AND LOWER(m[2]) IN ('uid', 'jwt', 'role'))
      UNION
      -- 3. Catalog pg_depend proc-to-proc edges from pre-approved functions
      SELECT DISTINCT
        ap.proc_oid AS caller_oid,
        ap.canonical_sig AS caller_sig,
        cfn.nspname AS callee_qual,
        cp.proname AS callee_name,
        target_ap.proc_oid AS resolved_oid,
        target_ap.canonical_sig AS resolved_sig
      FROM audited_procs ap
      JOIN pg_depend d ON d.classid = 'pg_proc'::regclass
                      AND d.objid = ap.proc_oid
                      AND d.refclassid = 'pg_proc'::regclass
      JOIN pg_proc cp ON cp.oid = d.refobjid
      JOIN pg_namespace cfn ON cfn.oid = cp.pronamespace
      LEFT JOIN audited_procs target_ap ON target_ap.proc_oid = cp.oid
      WHERE cfn.nspname != 'pg_catalog'
        AND NOT (cfn.nspname = 'auth' AND cp.proname IN ('uid', 'jwt', 'role'))
    ),
    call_graph AS (
      -- Depth 1: Direct calls from pre-approved entrypoint triggers & RPCs
      SELECT
        1 AS depth,
        er.canonical_sig AS root_sig,
        e.caller_oid,
        e.caller_sig,
        e.callee_qual,
        e.callee_name,
        e.resolved_oid,
        e.resolved_sig,
        ARRAY[er.proc_oid, e.resolved_oid] AS visited_oids
      FROM entrypoint_roots er
      JOIN direct_extracted_edges e ON e.caller_oid = er.proc_oid
      UNION ALL
      -- Depth 2..4: Bounded transitive calls within the pre-approved helper list
      SELECT
        cg.depth + 1 AS depth,
        cg.root_sig,
        e.caller_oid,
        e.caller_sig,
        e.callee_qual,
        e.callee_name,
        e.resolved_oid,
        e.resolved_sig,
        cg.visited_oids || e.resolved_oid
      FROM call_graph cg
      JOIN direct_extracted_edges e ON e.caller_oid = cg.resolved_oid
      WHERE cg.depth < 4
        AND cg.resolved_oid IS NOT NULL
        AND NOT (e.resolved_oid = ANY(cg.visited_oids))
    )
    SELECT
      -- Any call edge or lexical construct in audited_procs that could not be proven against v_allowed_cits_helper_funcs
      (
        SELECT string_agg(
          format('%s -> unproven/unverified call or lexical token %s%s()',
            e.caller_sig,
            CASE WHEN e.callee_qual != '' THEN e.callee_qual || '.' ELSE '' END,
            e.callee_name),
          ', ' ORDER BY e.caller_sig, e.callee_name
        )
        FROM direct_extracted_edges e
        WHERE e.resolved_oid IS NULL
           OR NOT (e.callee_name = ANY(v_allowed_cits_helper_funcs))
      ),
      -- Stepwise summary of pre-approved helper signatures reached from entrypoint triggers & RPCs
      (
        SELECT string_agg(
          format('[depth %s] %s -> %s', cg.depth, cg.caller_sig, cg.resolved_sig),
          '; ' ORDER BY cg.depth, cg.caller_sig, cg.resolved_sig
        )
        FROM (
          SELECT DISTINCT depth, caller_sig, resolved_sig
          FROM call_graph
          WHERE resolved_sig IS NOT NULL
        ) cg
      )
    INTO v_untracked_or_unsafe_callees, v_reached_helper_summary;

    IF v_untracked_or_unsafe_callees IS NOT NULL THEN
      UPDATE _cits_verification_report
      SET test_code = '[FAIL 1/10]',
          status = 'FAIL',
          evidence = format('Bounded call-graph check found unproven/unverified function call or lexical construct: %s', v_untracked_or_unsafe_callees)
      WHERE step_order = 1;
      RAISE EXCEPTION 'Aborted fixture setup: bounded allowlist call-graph check found unproven or unverified function call(s): %',
        v_untracked_or_unsafe_callees;
    END IF;

    IF v_reached_helper_summary IS NULL OR v_reached_helper_summary = '' THEN
      UPDATE _cits_verification_report
      SET test_code = '[FAIL 1/10]',
          status = 'FAIL',
          evidence = 'Bounded call-graph check returned 0 reached helper edges from pre-approved triggers/RPCs'
      WHERE step_order = 1;
      RAISE EXCEPTION 'Aborted fixture setup: bounded call-graph traversal returned 0 reached helper edges from triggers/RPCs';
    END IF;

    RAISE NOTICE '[PRE-FLIGHT BOUNDED ALLOWLIST CALL-GRAPH CHECK] Verified pre-approved helper edges (bounded to 18 approved functions; does not claim full SQL call discovery): %', v_reached_helper_summary;

    -- Pre-Flight Guard 2: Block fixture setup if Test 1 detected any unsafe column defaults, attached sequences, or PK/FK failures
    IF v_unsafe_column_defaults IS NOT NULL
       OR v_attached_sequences IS NOT NULL
       OR v_non_uuid_pk_tables IS NOT NULL
       OR NOT v_profiles_fk_verified THEN
      RAISE EXCEPTION 'Aborted fixture setup: unsafe column defaults (%), sequence/default dependencies (%), non-UUID PKs (%), or profiles FK (%s) failed',
        COALESCE(v_unsafe_column_defaults, 'none'),
        COALESCE(v_attached_sequences, 'none'),
        COALESCE(v_non_uuid_pk_tables, 'none'),
        v_profiles_fk_verified;
    END IF;

    -- Pre-Flight Guard 3: Ensure zero pre-existing collisions across ALL ephemeral
    -- fixture UUIDs and unique identifiers (emails, usernames, codes, idempotency keys)
    WITH collision_checks AS (
      SELECT 'auth.users' AS tbl, COUNT(*) AS cnt
      FROM auth.users
      WHERE id IN (v_admin1_uid, v_admin2_uid, v_admin3_uid, v_inst_a_uid, v_inst_b_uid)
         OR LOWER(COALESCE(email, '')) IN (
           'verify_admin1_ephemeral@cits.org',
           'verify_admin2_ephemeral@cits.org',
           'verify_admin3_ephemeral@cits.org',
           'verify_inst_a_ephemeral@cits.org',
           'verify_inst_b_ephemeral@cits.org'
         )
      UNION ALL
      SELECT 'public.profiles', COUNT(*)
      FROM public.profiles
      WHERE id IN (v_admin1_uid, v_admin2_uid, v_admin3_uid, v_inst_a_uid, v_inst_b_uid)
         OR LOWER(username) IN (
           'verify_admin1_ephemeral',
           'verify_admin2_ephemeral',
           'verify_admin3_ephemeral',
           'verify_admin3_direct',
           'verify_inst_a_ephemeral',
           'verify_inst_b_ephemeral'
         )
         OR LOWER(email) IN (
           'verify_admin1_ephemeral@cits.org',
           'verify_admin2_ephemeral@cits.org',
           'verify_admin3_ephemeral@cits.org',
           'verify_inst_a_ephemeral@cits.org',
           'verify_inst_b_ephemeral@cits.org'
         )
      UNION ALL
      SELECT 'public.admin_accounts', COUNT(*)
      FROM public.admin_accounts
      WHERE id = v_admin_extra_row_id
         OR profile_id IN (v_admin1_uid, v_admin2_uid, v_admin3_uid, v_inst_a_uid, v_inst_b_uid)
      UNION ALL
      SELECT 'public.instructors', COUNT(*)
      FROM public.instructors
      WHERE id IN (v_inst_a_id, v_inst_b_id)
         OR profile_id IN (v_inst_a_uid, v_inst_b_uid)
         OR instructor_code IN ('INST-VERIFY-EPHEM-A', 'INST-VERIFY-EPHEM-B')
      UNION ALL
      SELECT 'public.venues', COUNT(*)
      FROM public.venues
      WHERE id = v_venue_id
      UNION ALL
      SELECT 'public.rooms', COUNT(*)
      FROM public.rooms
      WHERE id IN (v_room1_id, v_room2_id, v_room3_id)
      UNION ALL
      SELECT 'public.camps', COUNT(*)
      FROM public.camps
      WHERE id IN (v_camp1_id, v_camp2_id, v_camp_arch_id)
         OR code IN ('VERIFY-EPHEM-CAMP-1', 'VERIFY-EPHEM-CAMP-2', 'VERIFY-EPHEM-CAMP-ARCH')
      UNION ALL
      SELECT 'public.camp_settings', COUNT(*)
      FROM public.camp_settings
      WHERE id = v_camp_settings_id
         OR camp_id IN (v_camp1_id, v_camp2_id, v_camp_arch_id)
      UNION ALL
      SELECT 'public.camp_instructors', COUNT(*)
      FROM public.camp_instructors
      WHERE id IN (v_camp_inst_a_id, v_camp_inst_b_id)
         OR camp_id IN (v_camp1_id, v_camp2_id, v_camp_arch_id)
      UNION ALL
      SELECT 'public.instructor_rates', COUNT(*)
      FROM public.instructor_rates
      WHERE id IN (v_rate_a_id, v_rate_b_id)
         OR camp_id IN (v_camp1_id, v_camp2_id, v_camp_arch_id)
      UNION ALL
      SELECT 'public.groups', COUNT(*)
      FROM public.groups
      WHERE id IN (v_grp_a_id, v_grp_b_id, v_grp_c_id, v_grp_arch_test_id)
         OR camp_id IN (v_camp1_id, v_camp2_id, v_camp_arch_id)
      UNION ALL
      SELECT 'public.group_instructors', COUNT(*)
      FROM public.group_instructors
      WHERE id IN (v_grp_inst_a_id, v_grp_inst_b_id)
         OR camp_id IN (v_camp1_id, v_camp2_id, v_camp_arch_id)
      UNION ALL
      SELECT 'public.students', COUNT(*)
      FROM public.students
      WHERE id IN (v_stu_1_id, v_stu_2_id)
         OR camp_id IN (v_camp1_id, v_camp2_id, v_camp_arch_id)
      UNION ALL
      SELECT 'public.lectures', COUNT(*)
      FROM public.lectures
      WHERE id IN (
        v_lec_a_id, v_lec_b_id,
        v_lec_7a_base_id, v_lec_7b_base_id, v_lec_7c_base_id, v_lec_7d_p1_id, v_lec_7d_p2_id,
        v_lec_conflict_inst_id, v_lec_conflict_grp_id, v_lec_conflict_room_id, v_lec_conflict_limit_id
      )
         OR camp_id IN (v_camp1_id, v_camp2_id, v_camp_arch_id)
      UNION ALL
      SELECT 'public.daily_checkins', COUNT(*)
      FROM public.daily_checkins
      WHERE id = v_checkin_a_id
         OR camp_id IN (v_camp1_id, v_camp2_id, v_camp_arch_id)
      UNION ALL
      SELECT 'public.attendance_sheets', COUNT(*)
      FROM public.attendance_sheets
      WHERE id IN (v_sheet_a_id, v_sheet_b_id)
         OR idempotency_key IN ('idem-verify-ephem-sheet-a', 'idem-verify-ephem-sheet-b')
         OR camp_id IN (v_camp1_id, v_camp2_id, v_camp_arch_id)
      UNION ALL
      SELECT 'public.attendance_records', COUNT(*)
      FROM public.attendance_records
      WHERE id IN (v_rec_stu1_id, v_rec_dup_test_id)
         OR camp_id IN (v_camp1_id, v_camp2_id, v_camp_arch_id)
      UNION ALL
      SELECT 'public.lecture_entitlements', COUNT(*)
      FROM public.lecture_entitlements
      WHERE id = v_ent_a_id
         OR camp_id IN (v_camp1_id, v_camp2_id, v_camp_arch_id)
      UNION ALL
      SELECT 'public.audit_logs', COUNT(*)
      FROM public.audit_logs
      WHERE id IN (v_test_audit_id, '00000000-0000-4000-8000-000000000002'::uuid)
    )
    SELECT
      COALESCE(SUM(cnt), 0),
      string_agg(format('%s (%s)', tbl, cnt), ', ' ORDER BY tbl) FILTER (WHERE cnt > 0)
    INTO v_preexisting_collision_count, v_collision_details
    FROM collision_checks;

    IF v_preexisting_collision_count > 0 THEN
      RAISE EXCEPTION 'Aborted fixture setup: % pre-existing fixture collision(s) detected across [%]. Fixtures cannot be isolated',
        v_preexisting_collision_count, v_collision_details;
    END IF;

    INSERT INTO auth.users (id, email, raw_user_meta_data, created_at, updated_at)
    VALUES
      (v_admin1_uid, 'verify_admin1_ephemeral@cits.org', '{}'::jsonb, NOW(), NOW()),
      (v_admin2_uid, 'verify_admin2_ephemeral@cits.org', '{}'::jsonb, NOW(), NOW()),
      (v_admin3_uid, 'verify_admin3_ephemeral@cits.org', '{}'::jsonb, NOW(), NOW()),
      (v_inst_a_uid, 'verify_inst_a_ephemeral@cits.org', '{}'::jsonb, NOW(), NOW()),
      (v_inst_b_uid, 'verify_inst_b_ephemeral@cits.org', '{}'::jsonb, NOW(), NOW());

    -- Explicitly verify all 5 ephemeral auth.users rows exist before proceeding
    IF (
      SELECT COUNT(*) FROM auth.users
      WHERE id IN (v_admin1_uid, v_admin2_uid, v_admin3_uid, v_inst_a_uid, v_inst_b_uid)
    ) != 5 THEN
      RAISE EXCEPTION 'Failed to verify all 5 ephemeral auth.users test rows';
    END IF;

    -- Populate unoccupied Admin slots without modifying any existing real Admin
    SELECT EXISTS (SELECT 1 FROM public.admin_accounts WHERE assigned_slot = 1) INTO v_slot1_taken;
    SELECT EXISTS (SELECT 1 FROM public.admin_accounts WHERE assigned_slot = 2) INTO v_slot2_taken;

    IF NOT v_slot1_taken THEN
      PERFORM public.bootstrap_cits_admin_account(
        v_admin1_uid::uuid,
        'verify_admin1_ephemeral'::text,
        'Verify Admin One'::text,
        'مسؤول تحقق 1'::text,
        1::smallint
      );
    END IF;

    IF NOT v_slot2_taken THEN
      PERFORM public.bootstrap_cits_admin_account(
        v_admin2_uid::uuid,
        'verify_admin2_ephemeral'::text,
        'Verify Admin Two'::text,
        'مسؤول تحقق 2'::text,
        2::smallint
      );
    END IF;

    -- Select a guaranteed active & eligible Admin account for permission tests
    SELECT a.profile_id INTO v_active_admin_uid
    FROM public.admin_accounts a
    JOIN public.profiles p ON p.id = a.profile_id
    WHERE p.role = 'admin' AND p.is_active = TRUE
    ORDER BY
      CASE WHEN a.profile_id IN (v_admin1_uid, v_admin2_uid) THEN 0 ELSE 1 END,
      a.assigned_slot ASC
    LIMIT 1;

    IF v_active_admin_uid IS NULL THEN
      RAISE EXCEPTION 'No active Admin profile (is_active = TRUE) available in admin_accounts for permission tests';
    END IF;

    -- Create Instructor A and Instructor B profiles & records (all with explicit test UUIDs)
    INSERT INTO public.profiles (id, role, username, email, full_name_en, full_name_ar, must_change_password, is_active)
    VALUES
      (v_inst_a_uid, 'instructor'::public.user_role, 'verify_inst_a_ephemeral', 'verify_inst_a_ephemeral@cits.org', 'Instructor A', 'محاضر أ', FALSE, TRUE),
      (v_inst_b_uid, 'instructor'::public.user_role, 'verify_inst_b_ephemeral', 'verify_inst_b_ephemeral@cits.org', 'Instructor B', 'محاضر ب', FALSE, TRUE);

    INSERT INTO public.instructors (id, profile_id, instructor_code, specialization, default_lecture_rate_egp)
    VALUES
      (v_inst_a_id, v_inst_a_uid, 'INST-VERIFY-EPHEM-A', 'Algorithms', 750),
      (v_inst_b_id, v_inst_b_uid, 'INST-VERIFY-EPHEM-B', 'Systems', 700);

    -- Create Venue & Rooms (with explicit test UUIDs)
    INSERT INTO public.venues (id, name_en, name_ar, address, latitude, longitude, geofence_radius_meters)
    VALUES (v_venue_id, 'CITS Verification Hall', 'قاعة التحقق', 'Cairo', 30.0444, 31.2357, 100);

    INSERT INTO public.rooms (id, venue_id, code, name, capacity)
    VALUES
      (v_room1_id, v_venue_id, 'V-LAB-1', 'Lab 1', 30),
      (v_room2_id, v_venue_id, 'V-LAB-2', 'Lab 2', 30),
      (v_room3_id, v_venue_id, 'V-LAB-3', 'Lab 3', 30);

    -- Create Base Camps (Adapt safely if a real active camp already exists in production)
    SELECT id INTO v_existing_active_camp FROM public.camps WHERE status = 'active' LIMIT 1;

    INSERT INTO public.camps (id, code, name_en, name_ar, status, venue_id, start_date, end_date, duration_days, current_camp_day)
    VALUES
      (
        v_camp1_id,
        'VERIFY-EPHEM-CAMP-1',
        'Verification Camp 1',
        'معسكر تحقق 1',
        CASE WHEN v_existing_active_camp IS NULL THEN 'active'::public.camp_status ELSE 'draft'::public.camp_status END,
        v_venue_id,
        '2026-11-10',
        '2026-11-19',
        10,
        1
      ),
      (
        v_camp2_id,
        'VERIFY-EPHEM-CAMP-2',
        'Verification Camp 2',
        'معسكر تحقق 2',
        'draft'::public.camp_status,
        v_venue_id,
        '2026-12-01',
        '2026-12-10',
        10,
        1
      ),
      (
        v_camp_arch_id,
        'VERIFY-EPHEM-CAMP-ARCH',
        'Verification Archived Camp',
        'معسكر مؤرشف',
        'draft'::public.camp_status,
        v_venue_id,
        '2026-10-01',
        '2026-10-10',
        10,
        1
      );

    INSERT INTO public.camp_settings (id, camp_id, max_instructor_groups_per_day, default_lecture_rate_egp)
    VALUES (v_camp_settings_id, v_camp1_id, 2, 700);

    INSERT INTO public.camp_instructors (id, camp_id, instructor_id, is_active)
    VALUES
      (v_camp_inst_a_id, v_camp1_id, v_inst_a_id, TRUE),
      (v_camp_inst_b_id, v_camp1_id, v_inst_b_id, TRUE);

    INSERT INTO public.instructor_rates (id, camp_id, instructor_id, lecture_rate_egp, effective_from_day)
    VALUES
      (v_rate_a_id, v_camp1_id, v_inst_a_id, 750, 1),
      (v_rate_b_id, v_camp1_id, v_inst_b_id, 700, 1);

    INSERT INTO public.groups (id, camp_id, code, name_en, name_ar, track, default_room_id)
    VALUES
      (v_grp_a_id, v_camp1_id, 'GRP-A', 'Group A', 'مجموعة أ', 'Graphs', v_room1_id),
      (v_grp_b_id, v_camp1_id, 'GRP-B', 'Group B', 'مجموعة ب', 'DP', v_room2_id),
      (v_grp_c_id, v_camp1_id, 'GRP-C', 'Group C', 'مجموعة ج', 'Math', v_room3_id);

    INSERT INTO public.group_instructors (id, camp_id, group_id, instructor_id, effective_from_day)
    VALUES
      (v_grp_inst_a_id, v_camp1_id, v_grp_a_id, v_inst_a_id, 1),
      (v_grp_inst_b_id, v_camp1_id, v_grp_b_id, v_inst_b_id, 1);

    INSERT INTO public.students (id, camp_id, group_id, student_code, full_name, university)
    VALUES
      (v_stu_1_id, v_camp1_id, v_grp_a_id, 'CITS-STU-EPHEM-001', 'Student One', 'Cairo University'),
      (v_stu_2_id, v_camp1_id, v_grp_a_id, 'CITS-STU-EPHEM-002', 'Student Two', 'Ain Shams University');

    -- Create Base Lectures (Lecture A for Instructor A, Lecture B for Instructor B)
    INSERT INTO public.lectures (id, camp_id, camp_day, lecture_date, period_number, start_time, end_time, duration_hours, group_id, instructor_id, room_id, topic, frozen_rate_egp)
    VALUES
      (v_lec_a_id, v_camp1_id, 1, '2026-11-10', 1::smallint, '09:00'::time, '12:00'::time, 3, v_grp_a_id, v_inst_a_id, v_room1_id, 'Shortest Paths', 750),
      (v_lec_b_id, v_camp1_id, 1, '2026-11-10', 1::smallint, '09:00'::time, '12:00'::time, 3, v_grp_b_id, v_inst_b_id, v_room2_id, 'Dynamic Programming', 700);

    -- Create Base Verified Daily Check-in for Instructor A (with explicit test UUID)
    INSERT INTO public.daily_checkins (id, camp_id, instructor_id, camp_day, checkin_date, latitude, longitude, gps_accuracy_meters, distance_from_venue_meters, within_geofence, selfie_size_kb, status)
    VALUES (v_checkin_a_id, v_camp1_id, v_inst_a_id, 1, '2026-11-10', 30.0444, 31.2357, 10, 12, TRUE, 180, 'verified'::public.checkin_status);

    -- Create Base Attendance Sheets for Lecture A and Lecture B
    INSERT INTO public.attendance_sheets (id, camp_id, lecture_id, instructor_id, status, sync_state, idempotency_key)
    VALUES
      (v_sheet_a_id, v_camp1_id, v_lec_a_id, v_inst_a_id, 'draft'::public.attendance_sheet_status, 'Offline'::public.offline_sync_state, 'idem-verify-ephem-sheet-a'),
      (v_sheet_b_id, v_camp1_id, v_lec_b_id, v_inst_b_id, 'draft'::public.attendance_sheet_status, 'Offline'::public.offline_sync_state, 'idem-verify-ephem-sheet-b');

    -- Create Base Attendance Record for Student 1 in Lecture A (Student 2 left unmarked to test auto-absent)
    INSERT INTO public.attendance_records (id, camp_id, attendance_sheet_id, lecture_id, camp_day, period_number, student_id, origin_group_id, attended_group_id, mark)
    VALUES (v_rec_stu1_id, v_camp1_id, v_sheet_a_id, v_lec_a_id, 1, 1::smallint, v_stu_1_id, v_grp_a_id, v_grp_a_id, 'present'::public.attendance_mark);

    -- Create Dedicated Ephemeral Audit Log Record (v_test_audit_id) for Immutability Testing
    INSERT INTO public.audit_logs (id, actor_profile_id, actor_name, actor_role, camp_id, action, entity_type, entity_id, previous_value, new_value, reason)
    VALUES (
      v_test_audit_id,
      v_active_admin_uid,
      'Ephemeral Verification Actor',
      'admin'::public.user_role,
      v_camp1_id,
      'VERIFICATION_BASELINE_LOG',
      'verification_suite',
      v_test_audit_id::text,
      '{"state":"init"}'::jsonb,
      '{"state":"seeded"}'::jsonb,
      'Dedicated ephemeral audit log row for immutability trigger verification'
    );

    v_fixtures_ready := TRUE;
  EXCEPTION
    WHEN OTHERS THEN
      v_fixtures_ready := FALSE;
      v_fixture_error := SQLERRM;
      RAISE NOTICE '[FIXTURE SETUP ERROR] %', v_fixture_error;
  END;

  -- If Base Fixture Setup failed, update pre-seeded rows for Tests 5..10 with the exact error reason
  IF NOT v_fixtures_ready THEN
    FOR v_test_step IN 5..10 LOOP
      UPDATE _cits_verification_report
      SET test_code = format('[FAIL %s/10]', v_test_step),
          status = 'FAIL',
          evidence = format('Blocked by Base Fixture Setup error: %s', COALESCE(v_fixture_error, 'Unknown error'))
      WHERE step_order = v_test_step;
    END LOOP;
    RETURN;
  END IF;

  -- ===========================================================================
  -- TEST 5/10: Multi-Layer Admin 2-Account Cap & Direct Trigger Verification
  -- ===========================================================================
  BEGIN
    SELECT COUNT(*) INTO v_existing_admin_count FROM public.admin_accounts;
    IF v_existing_admin_count != 2 THEN
      RAISE EXCEPTION 'Expected 2 Admin accounts in admin_accounts before negative tests, found %', v_existing_admin_count;
    END IF;

    -- 5A: Layer 1 — bootstrap_cits_admin_account rejects a 3rd Admin
    v_rejected := FALSE;
    BEGIN
      PERFORM public.bootstrap_cits_admin_account(
        v_admin3_uid::uuid,
        'verify_admin3_ephemeral'::text,
        'Verify Admin Three'::text,
        'مسؤول تحقق 3'::text,
        1::smallint
      );
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM LIKE '%Maximum of two Admin%' OR SQLERRM LIKE '%Cannot create more than two Admin%' THEN
          v_rejected := TRUE;
          v_err_msg := SQLERRM;
        ELSE
          RAISE;
        END IF;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'Layer 1 (bootstrap_cits_admin_account) did NOT reject 3rd Admin!';
    END IF;

    -- 5B: Layer 2 — trg_enforce_profile_security on public.profiles rejects a 3rd Admin profile
    v_rejected := FALSE;
    BEGIN
      INSERT INTO public.profiles (id, role, username, email, full_name_en, full_name_ar, must_change_password, is_active)
      VALUES (v_admin3_uid, 'admin'::public.user_role, 'verify_admin3_direct', 'verify_admin3_ephemeral@cits.org', 'Admin 3', 'مسؤول 3', FALSE, TRUE);
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM LIKE '%Cannot create more than two Admin%' THEN
          v_rejected := TRUE;
        ELSE
          RAISE;
        END IF;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'Layer 2 (trg_enforce_profile_security on profiles) did NOT reject 3rd Admin profile!';
    END IF;

    -- 5C: Layer 3a — trg_enforce_max_two_admins directly on public.admin_accounts blocks non-admin profile link
    v_rejected := FALSE;
    BEGIN
      INSERT INTO public.admin_accounts (id, profile_id, totp_enrolled, assigned_slot)
      VALUES (v_admin_extra_row_id, v_inst_a_uid, FALSE, 1::smallint);
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM LIKE '%Profile linked to admin_accounts must have role = admin%' THEN
          v_rejected := TRUE;
        ELSE
          RAISE;
        END IF;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'Layer 3a (trg_enforce_max_two_admins role check) did NOT reject instructor profile in admin_accounts!';
    END IF;

    -- 5D: Layer 3b — trg_enforce_max_two_admins directly on public.admin_accounts blocks 3rd row when count >= 2
    v_rejected := FALSE;
    BEGIN
      INSERT INTO public.admin_accounts (id, profile_id, totp_enrolled, assigned_slot)
      VALUES (v_admin_extra_row_id, v_active_admin_uid, FALSE, 1::smallint);
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM LIKE '%Maximum of two Admin accounts allowed%' THEN
          v_rejected := TRUE;
          v_err_msg := SQLERRM;
        ELSE
          RAISE;
        END IF;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'Layer 3b (trg_enforce_max_two_admins count check on admin_accounts) did NOT reject 3rd row!';
    END IF;

    UPDATE _cits_verification_report
    SET test_code = '[PASS 5/10]',
        status = 'PASS',
        evidence = format('Verified bootstrap_cits_admin_account, trg_enforce_profile_security, and direct trg_enforce_max_two_admins (%s)', v_err_msg)
    WHERE step_order = 5;
    RAISE NOTICE '[PASS 5/10] All 3 Admin cap layers verified: %', v_err_msg;
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE _cits_verification_report
      SET test_code = '[FAIL 5/10]',
          status = 'FAIL',
          evidence = SQLERRM
      WHERE step_order = 5;
      RAISE NOTICE '[FAIL 5/10] %', SQLERRM;
  END;

  -- ===========================================================================
  -- TEST 6/10: Single Active Camp & Archived Camp Read-Only Protection
  --            Sub-tests 6A..6D report individual stage outcomes & SQLERRM.
  -- ===========================================================================
  BEGIN
    v_subtest_failures := NULL;
    v_subtest_summary := NULL;
    v_6b_archived_ok := FALSE;

    -- 6A: Activating v_camp2_id while an active camp exists must fail
    v_substage := '6A (activate second camp)';
    BEGIN
      v_rejected := FALSE;
      v_err_msg := NULL;
      BEGIN
        UPDATE public.camps SET status = 'active'::public.camp_status WHERE id = v_camp2_id;
      EXCEPTION
        WHEN OTHERS THEN
          IF SQLERRM ILIKE '%Only one camp may be active%' OR SQLERRM ILIKE '%idx_single_active_camp%' THEN
            v_rejected := TRUE;
            v_err_msg := SQLERRM;
          ELSE
            RAISE EXCEPTION 'Unexpected error at % [%]: %', v_substage, SQLSTATE, SQLERRM;
          END IF;
      END;

      IF NOT v_rejected THEN
        RAISE EXCEPTION 'Second active camp (v_camp2_id) was NOT rejected at %', v_substage;
      END IF;

      v_subtest_summary := concat_ws(' | ', v_subtest_summary, format('6A PASS (%s)', v_err_msg));
    EXCEPTION
      WHEN OTHERS THEN
        v_subtest_failures := concat_ws('; ', v_subtest_failures, format('[%s] %s', v_substage, SQLERRM));
        v_subtest_summary := concat_ws(' | ', v_subtest_summary, format('6A FAIL (%s)', SQLERRM));
    END;

    -- 6B: Ensure v_camp_arch_id starts in 'draft', then transition to 'archived'
    v_substage := '6B.1 (verify initial draft status)';
    BEGIN
      SELECT status INTO v_arch_initial_status
      FROM public.camps
      WHERE id = v_camp_arch_id;

      IF v_arch_initial_status IS DISTINCT FROM 'draft'::public.camp_status THEN
        RAISE EXCEPTION 'Expected initial status draft for v_camp_arch_id, found %', v_arch_initial_status;
      END IF;

      v_substage := '6B.2 (transition draft to archived)';
      UPDATE public.camps
      SET status = 'archived'::public.camp_status
      WHERE id = v_camp_arch_id;

      v_substage := '6B.3 (verify archived status and archived_at)';
      SELECT status, archived_at
      INTO v_arch_after_status, v_arch_after_at
      FROM public.camps
      WHERE id = v_camp_arch_id;

      IF v_arch_after_status IS DISTINCT FROM 'archived'::public.camp_status OR v_arch_after_at IS NULL THEN
        RAISE EXCEPTION 'Failed to transition v_camp_arch_id to archived (status=%, archived_at=%)',
          v_arch_after_status, v_arch_after_at;
      END IF;

      v_6b_archived_ok := TRUE;
      v_subtest_summary := concat_ws(' | ', v_subtest_summary, '6B PASS (draft->archived)');
    EXCEPTION
      WHEN OTHERS THEN
        v_subtest_failures := concat_ws('; ', v_subtest_failures, format('[%s [%s]] %s', v_substage, SQLSTATE, SQLERRM));
        v_subtest_summary := concat_ws(' | ', v_subtest_summary, format('6B FAIL @ %s (%s)', v_substage, SQLERRM));
    END;

    -- 6C: Updating an archived camp must be blocked by enforce_camp_lifecycle_rules
    v_substage := '6C (reject UPDATE on archived camp)';
    IF NOT v_6b_archived_ok THEN
      v_subtest_failures := concat_ws('; ', v_subtest_failures, format('[%s] Skipped because 6B draft->archived failed', v_substage));
      v_subtest_summary := concat_ws(' | ', v_subtest_summary, '6C BLOCKED (6B failed)');
    ELSE
      BEGIN
        v_rejected := FALSE;
        v_err_msg := NULL;
        BEGIN
          UPDATE public.camps SET name_en = 'Illegal Edit After Archive' WHERE id = v_camp_arch_id;
        EXCEPTION
          WHEN OTHERS THEN
            IF SQLERRM ILIKE '%archived%' AND SQLERRM ILIKE '%read-only%' THEN
              v_rejected := TRUE;
              v_err_msg := SQLERRM;
            ELSE
              RAISE EXCEPTION 'Unexpected error at % [%]: %', v_substage, SQLSTATE, SQLERRM;
            END IF;
        END;

        IF NOT v_rejected THEN
          RAISE EXCEPTION 'UPDATE on archived camp (v_camp_arch_id) was NOT blocked at %', v_substage;
        END IF;

        v_subtest_summary := concat_ws(' | ', v_subtest_summary, format('6C PASS (%s)', v_err_msg));
      EXCEPTION
        WHEN OTHERS THEN
          v_subtest_failures := concat_ws('; ', v_subtest_failures, format('[%s] %s', v_substage, SQLERRM));
          v_subtest_summary := concat_ws(' | ', v_subtest_summary, format('6C FAIL (%s)', SQLERRM));
      END;
    END IF;

    -- 6D: Inserting a child group into an archived camp must be blocked by prevent_mutation_on_archived_camp
    v_substage := '6D (reject child groups INSERT on archived camp)';
    IF NOT v_6b_archived_ok THEN
      v_subtest_failures := concat_ws('; ', v_subtest_failures, format('[%s] Skipped because 6B draft->archived failed', v_substage));
      v_subtest_summary := concat_ws(' | ', v_subtest_summary, '6D BLOCKED (6B failed)');
    ELSE
      BEGIN
        v_rejected := FALSE;
        v_err_msg := NULL;
        BEGIN
          INSERT INTO public.groups (id, camp_id, code, name_en, name_ar, track)
          VALUES (v_grp_arch_test_id, v_camp_arch_id, 'ARCH-GRP', 'Archived Group', 'مجموعة مؤرشفة', 'Graphs');
        EXCEPTION
          WHEN OTHERS THEN
            IF SQLERRM ILIKE '%archived (read-only)%' THEN
              v_rejected := TRUE;
              v_err_msg := SQLERRM;
            ELSE
              RAISE EXCEPTION 'Unexpected error at % [%]: %', v_substage, SQLSTATE, SQLERRM;
            END IF;
        END;

        IF NOT v_rejected THEN
          RAISE EXCEPTION 'Child table INSERT on archived camp (v_camp_arch_id) was NOT blocked at %', v_substage;
        END IF;

        v_subtest_summary := concat_ws(' | ', v_subtest_summary, format('6D PASS (%s)', v_err_msg));
      EXCEPTION
        WHEN OTHERS THEN
          v_subtest_failures := concat_ws('; ', v_subtest_failures, format('[%s] %s', v_substage, SQLERRM));
          v_subtest_summary := concat_ws(' | ', v_subtest_summary, format('6D FAIL (%s)', SQLERRM));
      END;
    END IF;

    IF v_subtest_failures IS NOT NULL THEN
      RAISE EXCEPTION 'Test 6 failures: % | All stages: %', v_subtest_failures, v_subtest_summary;
    END IF;

    UPDATE _cits_verification_report
    SET test_code = '[PASS 6/10]',
        status = 'PASS',
        evidence = v_subtest_summary
    WHERE step_order = 6;
    RAISE NOTICE '[PASS 6/10] %', v_subtest_summary;
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE _cits_verification_report
      SET test_code = '[FAIL 6/10]',
          status = 'FAIL',
          evidence = SQLERRM
      WHERE step_order = 6;
      RAISE NOTICE '[FAIL 6/10] %', SQLERRM;
  END;

  -- ===========================================================================
  -- TEST 7/10: Schedule Conflicts (Instructor, Group, Room) & Max Daily Groups
  --            Each sub-test 7A..7D runs in its own isolated subtransaction on
  --            dedicated camp_day (days 2..5) and reports exact stage & SQLERRM.
  -- ===========================================================================
  BEGIN
    v_subtest_failures := NULL;
    v_subtest_summary := NULL;

    -- 7A (Isolated on camp_day = 2): Overlapping time window for Instructor A
    BEGIN
      v_substage := '7A.1 (insert day 2 baseline lecture)';
      INSERT INTO public.lectures (id, camp_id, camp_day, lecture_date, period_number, start_time, end_time, duration_hours, group_id, instructor_id, room_id, topic, frozen_rate_egp)
      VALUES (v_lec_7a_base_id, v_camp1_id, 2, '2026-11-11', 1::smallint, '09:00'::time, '12:00'::time, 3, v_grp_a_id, v_inst_a_id, v_room1_id, 'Day 2 Base Instructor Slot', 750);

      v_substage := '7A.2 (reject overlapping instructor lecture)';
      v_rejected := FALSE;
      v_err_msg := NULL;
      BEGIN
        INSERT INTO public.lectures (id, camp_id, camp_day, lecture_date, period_number, start_time, end_time, duration_hours, group_id, instructor_id, room_id, topic, frozen_rate_egp)
        VALUES (v_lec_conflict_inst_id, v_camp1_id, 2, '2026-11-11', 2::smallint, '10:30'::time, '13:30'::time, 3, v_grp_c_id, v_inst_a_id, v_room3_id, 'Overlap Instructor', 750);
      EXCEPTION
        WHEN OTHERS THEN
          IF SQLERRM LIKE '%CITS Schedule Conflict: Instructor%' THEN
            v_rejected := TRUE;
            v_err_msg := SQLERRM;
          ELSE
            RAISE EXCEPTION 'Unexpected error at % [%]: %', v_substage, SQLSTATE, SQLERRM;
          END IF;
      END;

      IF NOT v_rejected THEN
        RAISE EXCEPTION 'Overlapping Instructor schedule was NOT blocked at %', v_substage;
      END IF;

      v_subtest_summary := concat_ws(' | ', v_subtest_summary, format('7A PASS (%s)', v_err_msg));
    EXCEPTION
      WHEN OTHERS THEN
        v_subtest_failures := concat_ws('; ', v_subtest_failures, format('[%s [%s]] %s', v_substage, SQLSTATE, SQLERRM));
        v_subtest_summary := concat_ws(' | ', v_subtest_summary, format('7A FAIL @ %s (%s)', v_substage, SQLERRM));
    END;

    -- 7B (Isolated on camp_day = 3): Overlapping Group A using conflict-free Instructor B & Room 3
    BEGIN
      v_substage := '7B.1 (insert day 3 baseline lecture)';
      INSERT INTO public.lectures (id, camp_id, camp_day, lecture_date, period_number, start_time, end_time, duration_hours, group_id, instructor_id, room_id, topic, frozen_rate_egp)
      VALUES (v_lec_7b_base_id, v_camp1_id, 3, '2026-11-12', 1::smallint, '09:00'::time, '12:00'::time, 3, v_grp_a_id, v_inst_a_id, v_room1_id, 'Day 3 Base Group Slot', 750);

      v_substage := '7B.2 (reject overlapping group lecture)';
      v_rejected := FALSE;
      v_err_msg := NULL;
      BEGIN
        INSERT INTO public.lectures (id, camp_id, camp_day, lecture_date, period_number, start_time, end_time, duration_hours, group_id, instructor_id, room_id, topic, frozen_rate_egp)
        VALUES (v_lec_conflict_grp_id, v_camp1_id, 3, '2026-11-12', 2::smallint, '11:00'::time, '14:00'::time, 3, v_grp_a_id, v_inst_b_id, v_room3_id, 'Overlap Group', 700);
      EXCEPTION
        WHEN OTHERS THEN
          IF SQLERRM LIKE '%CITS Schedule Conflict: Group%' THEN
            v_rejected := TRUE;
            v_err_msg := SQLERRM;
          ELSE
            RAISE EXCEPTION 'Unexpected error at % [%]: %', v_substage, SQLSTATE, SQLERRM;
          END IF;
      END;

      IF NOT v_rejected THEN
        RAISE EXCEPTION 'Overlapping Group schedule was NOT blocked at %', v_substage;
      END IF;

      v_subtest_summary := concat_ws(' | ', v_subtest_summary, format('7B PASS (%s)', v_err_msg));
    EXCEPTION
      WHEN OTHERS THEN
        v_subtest_failures := concat_ws('; ', v_subtest_failures, format('[%s [%s]] %s', v_substage, SQLSTATE, SQLERRM));
        v_subtest_summary := concat_ws(' | ', v_subtest_summary, format('7B FAIL @ %s (%s)', v_substage, SQLERRM));
    END;

    -- 7C (Isolated on camp_day = 4): Overlapping Room 1 using conflict-free Instructor B & Group C
    BEGIN
      v_substage := '7C.1 (insert day 4 baseline lecture)';
      INSERT INTO public.lectures (id, camp_id, camp_day, lecture_date, period_number, start_time, end_time, duration_hours, group_id, instructor_id, room_id, topic, frozen_rate_egp)
      VALUES (v_lec_7c_base_id, v_camp1_id, 4, '2026-11-13', 1::smallint, '09:00'::time, '12:00'::time, 3, v_grp_a_id, v_inst_a_id, v_room1_id, 'Day 4 Base Room Slot', 750);

      v_substage := '7C.2 (reject overlapping room lecture)';
      v_rejected := FALSE;
      v_err_msg := NULL;
      BEGIN
        INSERT INTO public.lectures (id, camp_id, camp_day, lecture_date, period_number, start_time, end_time, duration_hours, group_id, instructor_id, room_id, topic, frozen_rate_egp)
        VALUES (v_lec_conflict_room_id, v_camp1_id, 4, '2026-11-13', 2::smallint, '11:00'::time, '14:00'::time, 3, v_grp_c_id, v_inst_b_id, v_room1_id, 'Overlap Room', 700);
      EXCEPTION
        WHEN OTHERS THEN
          IF SQLERRM LIKE '%CITS Schedule Conflict: Room%' THEN
            v_rejected := TRUE;
            v_err_msg := SQLERRM;
          ELSE
            RAISE EXCEPTION 'Unexpected error at % [%]: %', v_substage, SQLSTATE, SQLERRM;
          END IF;
      END;

      IF NOT v_rejected THEN
        RAISE EXCEPTION 'Overlapping Room schedule was NOT blocked at %', v_substage;
      END IF;

      v_subtest_summary := concat_ws(' | ', v_subtest_summary, format('7C PASS (%s)', v_err_msg));
    EXCEPTION
      WHEN OTHERS THEN
        v_subtest_failures := concat_ws('; ', v_subtest_failures, format('[%s [%s]] %s', v_substage, SQLSTATE, SQLERRM));
        v_subtest_summary := concat_ws(' | ', v_subtest_summary, format('7C FAIL @ %s (%s)', v_substage, SQLERRM));
    END;

    -- 7D (Isolated on camp_day = 5): Daily group limit enforcement (camp_settings.max_instructor_groups_per_day = 2)
    BEGIN
      v_substage := '7D.1 (insert day 5 two valid distinct group slots)';
      INSERT INTO public.lectures (id, camp_id, camp_day, lecture_date, period_number, start_time, end_time, duration_hours, group_id, instructor_id, room_id, topic, frozen_rate_egp)
      VALUES
        (v_lec_7d_p1_id, v_camp1_id, 5, '2026-11-14', 1::smallint, '09:00'::time, '12:00'::time, 3, v_grp_a_id, v_inst_a_id, v_room1_id, 'First Group Valid Slot', 750),
        (v_lec_7d_p2_id, v_camp1_id, 5, '2026-11-14', 2::smallint, '12:00'::time, '15:00'::time, 3, v_grp_b_id, v_inst_a_id, v_room2_id, 'Second Group Valid Slot', 750);

      v_substage := '7D.2 (reject 3rd group exceeding max_instructor_groups_per_day=2)';
      v_rejected := FALSE;
      v_err_msg := NULL;
      BEGIN
        INSERT INTO public.lectures (id, camp_id, camp_day, lecture_date, period_number, start_time, end_time, duration_hours, group_id, instructor_id, room_id, topic, frozen_rate_egp)
        VALUES (v_lec_conflict_limit_id, v_camp1_id, 5, '2026-11-14', 3::smallint, '15:00'::time, '18:00'::time, 3, v_grp_c_id, v_inst_a_id, v_room3_id, 'Third Group Exceeds Limit 2', 750);
      EXCEPTION
        WHEN OTHERS THEN
          IF SQLERRM LIKE '%CITS Schedule Limit Exceeded%' THEN
            v_rejected := TRUE;
            v_err_msg := SQLERRM;
          ELSE
            RAISE EXCEPTION 'Unexpected error at % [%]: %', v_substage, SQLSTATE, SQLERRM;
          END IF;
      END;

      IF NOT v_rejected THEN
        RAISE EXCEPTION 'Max daily instructor groups limit was NOT enforced at %', v_substage;
      END IF;

      v_subtest_summary := concat_ws(' | ', v_subtest_summary, format('7D PASS (%s)', v_err_msg));
    EXCEPTION
      WHEN OTHERS THEN
        v_subtest_failures := concat_ws('; ', v_subtest_failures, format('[%s [%s]] %s', v_substage, SQLSTATE, SQLERRM));
        v_subtest_summary := concat_ws(' | ', v_subtest_summary, format('7D FAIL @ %s (%s)', v_substage, SQLERRM));
    END;

    IF v_subtest_failures IS NOT NULL THEN
      RAISE EXCEPTION 'Test 7 failures: % | All stages: %', v_subtest_failures, v_subtest_summary;
    END IF;

    UPDATE _cits_verification_report
    SET test_code = '[PASS 7/10]',
        status = 'PASS',
        evidence = v_subtest_summary
    WHERE step_order = 7;
    RAISE NOTICE '[PASS 7/10] %', v_subtest_summary;
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE _cits_verification_report
      SET test_code = '[FAIL 7/10]',
          status = 'FAIL',
          evidence = SQLERRM
      WHERE step_order = 7;
      RAISE NOTICE '[FAIL 7/10] %', SQLERRM;
  END;

  -- ===========================================================================
  -- TEST 8/10: Duplicate Same-Day Cross-Group Attendance Prevention
  -- ===========================================================================
  BEGIN
    -- Student 1 is already marked PRESENT in v_sheet_a_id (Group A, Day 1) by Base Fixture Setup.
    -- Attempt to mark Student 1 PRESENT in v_sheet_b_id (Group B, Day 1) with explicit id must be blocked.
    v_rejected := FALSE;
    BEGIN
      INSERT INTO public.attendance_records (id, camp_id, attendance_sheet_id, lecture_id, camp_day, period_number, student_id, origin_group_id, attended_group_id, mark)
      VALUES (v_rec_dup_test_id, v_camp1_id, v_sheet_b_id, v_lec_b_id, 1, 1::smallint, v_stu_1_id, v_grp_a_id, v_grp_b_id, 'present'::public.attendance_mark);
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM LIKE '%CITS Duplicate Attendance Blocked%' OR SQLERRM LIKE '%idx_unique_student_daily_present%' THEN
          v_rejected := TRUE;
          v_err_msg := SQLERRM;
        ELSE
          RAISE;
        END IF;
    END;

    IF NOT v_rejected THEN
      RAISE EXCEPTION 'Duplicate same-day attendance across groups was NOT blocked!';
    END IF;

    UPDATE _cits_verification_report
    SET test_code = '[PASS 8/10]',
        status = 'PASS',
        evidence = format('Cross-group same-day duplicate attendance blocked by trigger & partial unique index (%s)', v_err_msg)
    WHERE step_order = 8;
    RAISE NOTICE '[PASS 8/10] Duplicate same-day cross-group attendance blocked';
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE _cits_verification_report
      SET test_code = '[FAIL 8/10]',
          status = 'FAIL',
          evidence = SQLERRM
      WHERE step_order = 8;
      RAISE NOTICE '[FAIL 8/10] %', SQLERRM;
  END;

  -- ===========================================================================
  -- TEST 9/10: Transactional Attendance Submission & Financial Entitlement RPCs
  -- ===========================================================================
  BEGIN
    -- 9A: Submit attendance sheet as Instructor A via submit_attendance_sheet_tx(uuid)
    PERFORM set_config('request.jwt.claim.sub', v_inst_a_uid::text, TRUE);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_inst_a_uid::text, 'role', 'authenticated')::text, TRUE);

    v_tx_result := public.submit_attendance_sheet_tx(v_sheet_a_id::uuid);

    IF (v_tx_result->>'present_count')::int != 1
       OR (v_tx_result->>'absent_count')::int != 1
       OR (v_tx_result->>'entitlement_status') != 'eligible'
       OR (v_tx_result->>'entitlement_amount_egp')::int != 750 THEN
      RAISE EXCEPTION 'Unexpected submit_attendance_sheet_tx output: %', v_tx_result;
    END IF;

    SELECT id INTO v_ent_a_id FROM public.lecture_entitlements WHERE lecture_id = v_lec_a_id;
    IF v_ent_a_id IS NULL THEN
      RAISE EXCEPTION 'lecture_entitlements row was not created for lecture %', v_lec_a_id;
    END IF;

    -- 9B: Verify Instructor A cannot call admin_override_entitlement_tx
    v_rejected := FALSE;
    BEGIN
      PERFORM public.admin_override_entitlement_tx(
        v_ent_a_id::uuid,
        'approved'::public.entitlement_status,
        'Instructor attempting self-approval'::text
      );
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM LIKE '%Only a verified Admin%' THEN
          v_rejected := TRUE;
        ELSE
          RAISE;
        END IF;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'Instructor call to admin_override_entitlement_tx was NOT blocked!';
    END IF;

    -- 9C: Switch to verified AAL2 Admin session and verify override WITHOUT reason is rejected
    PERFORM set_config('request.jwt.claim.sub', v_active_admin_uid::text, TRUE);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_active_admin_uid::text, 'role', 'authenticated', 'aal', 'aal2')::text, TRUE);

    v_rejected := FALSE;
    BEGIN
      PERFORM public.admin_override_entitlement_tx(
        v_ent_a_id::uuid,
        'excluded'::public.entitlement_status,
        '   '::text
      );
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM LIKE '%audit reason is required%' OR SQLERRM LIKE '%requires a non-empty reason%' THEN
          v_rejected := TRUE;
        ELSE
          RAISE;
        END IF;
    END;
    IF NOT v_rejected THEN
      RAISE EXCEPTION 'Admin entitlement override with empty reason was NOT blocked!';
    END IF;

    -- 9D: Valid Admin override with audit reason succeeds
    v_override_result := public.admin_override_entitlement_tx(
      v_ent_a_id::uuid,
      'approved'::public.entitlement_status,
      'Verified by CITS Admin during Phase 2 check'::text
    );

    IF (v_override_result->>'status') != 'approved' OR (v_override_result->>'entitlement_amount_egp')::int != 750 THEN
      RAISE EXCEPTION 'Unexpected admin_override_entitlement_tx result: %', v_override_result;
    END IF;

    -- Restore clean JWT state after Test 9
    PERFORM set_config('request.jwt.claim.sub', '', TRUE);
    PERFORM set_config('request.jwt.claims', '', TRUE);

    UPDATE _cits_verification_report
    SET test_code = '[PASS 9/10]',
        status = 'PASS',
        evidence = format('Unmarked student auto-marked absent (present=1, absent=1); frozen rate 750 EGP calculated; Admin override reason enforced (%s)', v_tx_result::text)
    WHERE step_order = 9;
    RAISE NOTICE '[PASS 9/10] Attendance submission & financial entitlement RPCs verified';
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM set_config('request.jwt.claim.sub', '', TRUE);
      PERFORM set_config('request.jwt.claims', '', TRUE);
      UPDATE _cits_verification_report
      SET test_code = '[FAIL 9/10]',
          status = 'FAIL',
          evidence = SQLERRM
      WHERE step_order = 9;
      RAISE NOTICE '[FAIL 9/10] %', SQLERRM;
  END;
END
$cits_verify_1$;

-- =============================================================================
-- TEST 10/10: Audit Log Immutability (Dedicated UUID) & Targeted 4-Role
--             Behavioral RLS Verification on 6 Core Seeded Tables
--             (profiles, camps, lectures, instructor_rates, lecture_entitlements,
--             audit_logs) — Note: Catalog-level RLS coverage for all 29 tables
--             is checked in Tests 2 & 3; Test 10 tests live row visibility and
--             mutation isolation on these 6 seeded tables, not all 29 tables.
-- =============================================================================
DO $cits_verify_2$
DECLARE
  v_initial_role TEXT := current_user;
  v_admin1_uid UUID := '00000000-0000-4000-a000-000000000001';
  v_admin2_uid UUID := '00000000-0000-4000-a000-000000000002';
  v_active_admin_uid UUID;
  v_inst_a_uid UUID := '00000000-0000-4000-a000-000000000011';
  v_inst_b_uid UUID := '00000000-0000-4000-a000-000000000012';
  v_inst_a_id UUID := '00000000-0000-4000-b000-000000000011';
  v_inst_b_id UUID := '00000000-0000-4000-b000-000000000012';
  v_camp1_id UUID := '00000000-0000-4000-d000-000000000001';
  v_lec_a_id UUID := '00000000-0000-4000-9000-000000000001';
  v_lec_b_id UUID := '00000000-0000-4000-9000-000000000002';
  v_sheet_a_id UUID := '00000000-0000-4000-9000-000000000011';
  v_fallback_ent_a_id UUID := '00000000-0000-4000-9000-000000000031';
  v_test_audit_id UUID := '00000000-0000-4000-8000-000000000001';
  v_test_audit_leak_id UUID := '00000000-0000-4000-8000-000000000002';
  v_ent_a_id UUID;

  v_ent_exact_count INTEGER;
  v_ent_linked_count INTEGER;
  v_pre_rates_a INTEGER;
  v_pre_rates_b INTEGER;
  v_pre_lec_a INTEGER;
  v_pre_lec_b INTEGER;
  v_pre_camp1 INTEGER;
  v_audit_exists INTEGER;
  v_audit_reason_after TEXT;
  v_rejected BOOLEAN;

  v_own_rates INTEGER;
  v_other_rates INTEGER;
  v_own_lectures INTEGER;
  v_other_lectures INTEGER;
  v_own_entitlements INTEGER;
  v_audit_visible INTEGER;
  v_inst_a_updated_ent INTEGER;
  v_inst_a_entitlements INTEGER;
  v_inst_b_lectures INTEGER;
  v_inst_b_rates INTEGER;
  v_admin_ent_a INTEGER;
  v_all_rates INTEGER;
  v_all_audits INTEGER;
  v_anon_profiles INTEGER;
  v_anon_camps INTEGER;
  v_anon_entitlements INTEGER;
  v_anon_audits INTEGER;
BEGIN
  -- Skip if Test 10 was already marked blocked by Base Fixture Setup guard
  IF EXISTS (
    SELECT 1 FROM _cits_verification_report
    WHERE step_order = 10
      AND evidence LIKE 'Blocked by Base Fixture Setup error:%'
  ) THEN
    RETURN;
  END IF;

  SELECT a.profile_id INTO v_active_admin_uid
  FROM public.admin_accounts a
  JOIN public.profiles p ON p.id = a.profile_id
  WHERE p.role = 'admin' AND p.is_active = TRUE
  ORDER BY
    CASE WHEN a.profile_id IN (v_admin1_uid, v_admin2_uid) THEN 0 ELSE 1 END,
    a.assigned_slot ASC
  LIMIT 1;

  IF v_active_admin_uid IS NULL THEN
    RAISE EXCEPTION 'Test 10 Pre-Check Failed: No active Admin profile found for RLS verification';
  END IF;

  -- If Test 9 failed partway and rolled back its subtransaction, create the fallback
  -- lecture_entitlements row WITHOUT swallowing errors (any failure raises & marks Test 10 FAIL)
  IF NOT EXISTS (SELECT 1 FROM public.lecture_entitlements WHERE lecture_id = v_lec_a_id) THEN
    UPDATE public.attendance_sheets
    SET status = 'submitted'::public.attendance_sheet_status,
        sync_state = 'Synced'::public.offline_sync_state
    WHERE id = v_sheet_a_id;

    INSERT INTO public.lecture_entitlements (
      id, camp_id, lecture_id, instructor_id, camp_day, period_number,
      frozen_rate_egp, entitlement_amount_egp, status, eligibility_reason
    )
    VALUES (
      v_fallback_ent_a_id, v_camp1_id, v_lec_a_id, v_inst_a_id, 1, 1::smallint,
      750, 750, 'eligible'::public.entitlement_status, 'Fallback fixture for Test 10 RLS'
    );
  END IF;

  -- Explicit Pre-RLS Verification of v_ent_a_id and its linkage to v_lec_a_id
  SELECT id INTO v_ent_a_id
  FROM public.lecture_entitlements
  WHERE lecture_id = v_lec_a_id;

  IF v_ent_a_id IS NULL THEN
    RAISE EXCEPTION 'Test 10 Pre-Check Failed: v_ent_a_id is NULL (lecture_entitlements row missing for lecture %)', v_lec_a_id;
  END IF;

  SELECT COUNT(*) INTO v_ent_exact_count
  FROM public.lecture_entitlements
  WHERE id = v_ent_a_id;

  IF v_ent_exact_count != 1 THEN
    RAISE EXCEPTION 'Test 10 Pre-Check Failed: expected exactly 1 row in lecture_entitlements for id=%, found %',
      v_ent_a_id, v_ent_exact_count;
  END IF;

  SELECT COUNT(*) INTO v_ent_linked_count
  FROM public.lecture_entitlements
  WHERE id = v_ent_a_id
    AND lecture_id = v_lec_a_id
    AND camp_id = v_camp1_id
    AND instructor_id = v_inst_a_id;

  IF v_ent_linked_count != 1 THEN
    RAISE EXCEPTION 'Test 10 Pre-Check Failed: lecture_entitlements row (%) is not linked to expected lecture (%), camp (%), and instructor (%)',
      v_ent_a_id, v_lec_a_id, v_camp1_id, v_inst_a_id;
  END IF;

  -- Explicit Pre-RLS Verification of all other baseline test records relied upon by RLS checks
  SELECT COUNT(*) INTO v_pre_rates_a FROM public.instructor_rates WHERE camp_id = v_camp1_id AND instructor_id = v_inst_a_id;
  SELECT COUNT(*) INTO v_pre_rates_b FROM public.instructor_rates WHERE camp_id = v_camp1_id AND instructor_id = v_inst_b_id;
  SELECT COUNT(*) INTO v_pre_lec_a FROM public.lectures WHERE id = v_lec_a_id AND instructor_id = v_inst_a_id;
  SELECT COUNT(*) INTO v_pre_lec_b FROM public.lectures WHERE id = v_lec_b_id AND instructor_id = v_inst_b_id;
  SELECT COUNT(*) INTO v_pre_camp1 FROM public.camps WHERE id = v_camp1_id;
  SELECT COUNT(*) INTO v_audit_exists FROM public.audit_logs WHERE id = v_test_audit_id;

  IF v_pre_rates_a != 1 OR v_pre_rates_b != 1 OR v_pre_lec_a != 1 OR v_pre_lec_b != 1 OR v_pre_camp1 != 1 OR v_audit_exists != 1 THEN
    RAISE EXCEPTION 'Test 10 Pre-Check Failed: missing baseline RLS fixture rows (rates_a=%, rates_b=%, lec_a=%, lec_b=%, camp1=%, audit=%)',
      v_pre_rates_a, v_pre_rates_b, v_pre_lec_a, v_pre_lec_b, v_pre_camp1, v_audit_exists;
  END IF;

  -- 10A: Verify Dedicated Ephemeral Audit Row Immutability (UPDATE/DELETE by Exact UUID Only)
  v_rejected := FALSE;
  BEGIN
    UPDATE public.audit_logs
    SET reason = 'Tampered'
    WHERE id = v_test_audit_id;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%audit_logs are immutable%' THEN
        v_rejected := TRUE;
      ELSE
        RAISE;
      END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'UPDATE on public.audit_logs (id=%) was NOT blocked by trigger!', v_test_audit_id;
  END IF;

  v_rejected := FALSE;
  BEGIN
    DELETE FROM public.audit_logs
    WHERE id = v_test_audit_id;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%audit_logs are immutable%' THEN
        v_rejected := TRUE;
      ELSE
        RAISE;
      END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'DELETE on public.audit_logs (id=%) was NOT blocked by trigger!', v_test_audit_id;
  END IF;

  -- Confirm the dedicated audit row still exists and its reason is untouched
  SELECT reason INTO v_audit_reason_after FROM public.audit_logs WHERE id = v_test_audit_id;
  IF v_audit_reason_after IS DISTINCT FROM 'Dedicated ephemeral audit log row for immutability trigger verification' THEN
    RAISE EXCEPTION 'Dedicated audit row reason was unexpectedly modified: %', v_audit_reason_after;
  END IF;

  -- Verify Credential Leak Guard on audit_logs INSERT (with explicit id v_test_audit_leak_id)
  v_rejected := FALSE;
  BEGIN
    INSERT INTO public.audit_logs (id, actor_profile_id, actor_name, actor_role, camp_id, action, entity_type, entity_id, new_value, reason)
    VALUES (v_test_audit_leak_id, v_active_admin_uid, 'Admin', 'admin'::public.user_role, v_camp1_id, 'LEAK_TEST', 'profiles', v_inst_a_uid::text, '{"service_role":"secret"}'::jsonb, 'Test');
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%Sensitive credentials or tokens must never be written%' THEN
        v_rejected := TRUE;
      ELSE
        RAISE;
      END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Credential leak in public.audit_logs was NOT blocked by trigger!';
  END IF;

  -- Dedicated Role-Switching Subblock: Guarantees restoration to v_initial_role
  -- and JWT cleanup before returning to the outer block (on both success and error)
  BEGIN
    -- 10B: RLS Scenario 1 — Authenticated as Instructor A (with row_security_active proof)
    EXECUTE 'SET LOCAL ROLE authenticated';
    IF current_user != 'authenticated'
       OR NOT row_security_active('public.profiles'::regclass)
       OR NOT row_security_active('public.lecture_entitlements'::regclass)
       OR NOT row_security_active('public.audit_logs'::regclass) THEN
      RAISE EXCEPTION 'RLS is NOT active for role authenticated (current_user=%, row_security_active=%)',
        current_user, row_security_active('public.profiles'::regclass);
    END IF;

    PERFORM set_config('request.jwt.claim.sub', v_inst_a_uid::text, TRUE);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_inst_a_uid::text, 'role', 'authenticated')::text, TRUE);

    SELECT COUNT(*) INTO v_own_rates FROM public.instructor_rates WHERE instructor_id = v_inst_a_id;
    SELECT COUNT(*) INTO v_other_rates FROM public.instructor_rates WHERE instructor_id = v_inst_b_id;
    SELECT COUNT(*) INTO v_own_lectures FROM public.lectures WHERE id = v_lec_a_id;
    SELECT COUNT(*) INTO v_other_lectures FROM public.lectures WHERE id = v_lec_b_id;
    SELECT COUNT(*) INTO v_own_entitlements FROM public.lecture_entitlements WHERE id = v_ent_a_id;
    SELECT COUNT(*) INTO v_audit_visible FROM public.audit_logs WHERE id = v_test_audit_id;

    -- Verify Instructor A CAN read own entitlement (v_own_entitlements = 1) but CANNOT modify it via UPDATE (ROW_COUNT = 0)
    UPDATE public.lecture_entitlements
    SET entitlement_amount_egp = 99999
    WHERE id = v_ent_a_id;
    GET DIAGNOSTICS v_inst_a_updated_ent = ROW_COUNT;

    IF v_own_rates != 1
       OR v_other_rates != 0
       OR v_own_lectures != 1
       OR v_other_lectures != 0
       OR v_own_entitlements != 1
       OR v_audit_visible != 0
       OR v_inst_a_updated_ent != 0 THEN
      RAISE EXCEPTION 'RLS Instructor A failed: own_rates=%, other_rates=%, own_lec=%, other_lec=%, own_ent=%, audit=%, updated_ent=%',
        v_own_rates, v_other_rates, v_own_lectures, v_other_lectures, v_own_entitlements, v_audit_visible, v_inst_a_updated_ent;
    END IF;

    -- 10C: RLS Scenario 2 — Authenticated as Instructor B
    PERFORM set_config('request.jwt.claim.sub', v_inst_b_uid::text, TRUE);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_inst_b_uid::text, 'role', 'authenticated')::text, TRUE);

    SELECT COUNT(*) INTO v_inst_a_entitlements FROM public.lecture_entitlements WHERE id = v_ent_a_id;
    SELECT COUNT(*) INTO v_inst_b_lectures FROM public.lectures WHERE id = v_lec_b_id;
    SELECT COUNT(*) INTO v_inst_b_rates FROM public.instructor_rates WHERE instructor_id = v_inst_b_id;

    IF v_inst_a_entitlements != 0 OR v_inst_b_lectures != 1 OR v_inst_b_rates != 1 THEN
      RAISE EXCEPTION 'RLS Instructor B failed: inst_a_entitlements=%, inst_b_lectures=%, inst_b_rates=%',
        v_inst_a_entitlements, v_inst_b_lectures, v_inst_b_rates;
    END IF;

    -- 10D: RLS Scenario 3 — Authenticated as Verified AAL2 Admin
    PERFORM set_config('request.jwt.claim.sub', v_active_admin_uid::text, TRUE);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_active_admin_uid::text, 'role', 'authenticated', 'aal', 'aal2')::text, TRUE);

    SELECT COUNT(*) INTO v_admin_ent_a FROM public.lecture_entitlements WHERE id = v_ent_a_id;
    SELECT COUNT(*) INTO v_all_rates FROM public.instructor_rates WHERE camp_id = v_camp1_id;
    SELECT COUNT(*) INTO v_all_audits FROM public.audit_logs WHERE id = v_test_audit_id;

    IF v_admin_ent_a != 1 OR v_all_rates < 2 OR v_all_audits != 1 THEN
      RAISE EXCEPTION 'RLS Admin failed: expected ent_a=1 (%), >=2 rates (%), and dedicated audit row=1 (%)',
        v_admin_ent_a, v_all_rates, v_all_audits;
    END IF;

    -- 10E: RLS Scenario 4 — Anonymous Role (anon)
    EXECUTE 'SET LOCAL ROLE anon';
    IF current_user != 'anon'
       OR NOT row_security_active('public.profiles'::regclass)
       OR NOT row_security_active('public.camps'::regclass)
       OR NOT row_security_active('public.lecture_entitlements'::regclass) THEN
      RAISE EXCEPTION 'RLS is NOT active for role anon (current_user=%, row_security_active=%)',
        current_user, row_security_active('public.profiles'::regclass);
    END IF;

    PERFORM set_config('request.jwt.claim.sub', '', TRUE);
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', TRUE);

    -- Direct table privilege denial is an acceptable security boundary.
    -- If SELECT is granted, verify RLS returns zero rows instead.
    v_anon_profiles := 0;
    v_anon_camps := 0;
    v_anon_entitlements := 0;
    v_anon_audits := 0;

    IF has_table_privilege('anon', 'public.profiles', 'SELECT') THEN
      SELECT COUNT(*) INTO v_anon_profiles
      FROM public.profiles;
    END IF;

    IF has_table_privilege('anon', 'public.camps', 'SELECT') THEN
      SELECT COUNT(*) INTO v_anon_camps
      FROM public.camps
      WHERE id = v_camp1_id;
    END IF;

    IF has_table_privilege('anon', 'public.lecture_entitlements', 'SELECT') THEN
      SELECT COUNT(*) INTO v_anon_entitlements
      FROM public.lecture_entitlements
      WHERE id = v_ent_a_id;
    END IF;

    IF has_table_privilege('anon', 'public.audit_logs', 'SELECT') THEN
      SELECT COUNT(*) INTO v_anon_audits
      FROM public.audit_logs
      WHERE id = v_test_audit_id;
    END IF;

    IF v_anon_profiles != 0
       OR v_anon_camps != 0
       OR v_anon_entitlements != 0
       OR v_anon_audits != 0 THEN
      RAISE EXCEPTION
        'Anonymous security failed: expected 0 rows, got profiles=%, camps=%, entitlements=%, audits=%',
        v_anon_profiles, v_anon_camps, v_anon_entitlements, v_anon_audits;
    END IF;

    -- Restore exact v_initial_role (handling both v_initial_role = session_user
    -- and v_initial_role != session_user) and clear JWT claims
    EXECUTE 'RESET ROLE';
    IF current_user != v_initial_role THEN
      EXECUTE format('SET LOCAL ROLE %I', v_initial_role);
    END IF;
    PERFORM set_config('request.jwt.claim.sub', '', TRUE);
    PERFORM set_config('request.jwt.claims', '', TRUE);
  EXCEPTION
    WHEN OTHERS THEN
      EXECUTE 'RESET ROLE';
      IF current_user != v_initial_role THEN
        EXECUTE format('SET LOCAL ROLE %I', v_initial_role);
      END IF;
      PERFORM set_config('request.jwt.claim.sub', '', TRUE);
      PERFORM set_config('request.jwt.claims', '', TRUE);
      RAISE;
  END;

  -- Explicitly verify original role restoration before recording PASS
  IF current_user != v_initial_role THEN
    RAISE EXCEPTION 'Role restoration check failed: expected current_user=%, found % (session_user=%)',
      v_initial_role, current_user, session_user;
  END IF;

  UPDATE _cits_verification_report
  SET test_code = '[PASS 10/10]',
      status = 'PASS',
      evidence = format('Targeted 6-table behavioral RLS verified on seeded rows (profiles, camps, lectures, instructor_rates, lecture_entitlements, audit_logs — not all 29 tables); pre-RLS ent_a_id=%s (count=1, lec=%s); row_security_active=true; role restored to %s; audit UUID (%s) UPDATE/DELETE/secret blocked; Inst A (own_ent=1, upd_ent=0, B=0); Inst B (own=1, A_ent=0); Admin (ent=1, rates=%s, audit=1); Anon (0 rows)',
        v_ent_a_id, v_lec_a_id, current_user, v_test_audit_id, v_all_rates)
  WHERE step_order = 10;
  RAISE NOTICE '[PASS 10/10] Audit log immutability & targeted 6-table 4-role RLS verified with role restored to %', current_user;
EXCEPTION
  WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    IF current_user != v_initial_role THEN
      EXECUTE format('SET LOCAL ROLE %I', v_initial_role);
    END IF;
    PERFORM set_config('request.jwt.claim.sub', '', TRUE);
    PERFORM set_config('request.jwt.claims', '', TRUE);
    UPDATE _cits_verification_report
    SET test_code = '[FAIL 10/10]',
        status = 'FAIL',
        evidence = SQLERRM
    WHERE step_order = 10;
    RAISE NOTICE '[FAIL 10/10] %', SQLERRM;
END
$cits_verify_2$;

-- =============================================================================
-- APPEND FINAL SUMMARY ROWS TO REPORT TABLE
-- =============================================================================
DO $cits_verify_3$
DECLARE
  v_total INTEGER;
  v_passed INTEGER;
  v_failed INTEGER;
  v_review_req INTEGER;
  v_not_run INTEGER;
  v_final_status TEXT;
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'PASS'),
    COUNT(*) FILTER (WHERE status = 'FAIL'),
    COUNT(*) FILTER (WHERE status = 'REVIEW_REQUIRED'),
    COUNT(*) FILTER (WHERE test_code LIKE '%(NOT RUN)%')
  INTO v_total, v_passed, v_failed, v_review_req, v_not_run
  FROM _cits_verification_report
  WHERE step_order BETWEEN 1 AND 10;

  v_final_status := CASE
    WHEN v_total = 10 AND v_failed = 0 AND v_review_req = 0 AND v_not_run = 0 AND v_passed = 10
      THEN 'ALL 10/10 PHASE 2 VERIFICATION CHECKS PASSED (TRANSACTION ROLLED BACK CLEANLY)'
    WHEN v_failed = 0 AND v_not_run = 0 AND v_review_req > 0
      THEN format('VERIFICATION REQUIRES MANUAL REVIEW (%s/10 PASSED, %s REVIEW_REQUIRED — INSPECT REVIEW ROWS ABOVE)',
        v_passed, v_review_req)
    ELSE format('VERIFICATION FAILED (%s/10 PASSED, %s FAILED, %s REVIEW_REQUIRED, %s NOT RUN — INSPECT ROWS ABOVE)',
      v_passed, v_failed, v_review_req, v_not_run)
  END;

  INSERT INTO _cits_verification_report VALUES (
    99,
    'SUMMARY',
    CASE
      WHEN v_total = 10 AND v_failed = 0 AND v_review_req = 0 AND v_not_run = 0 AND v_passed = 10 THEN 'PASS'
      WHEN v_failed = 0 AND v_not_run = 0 AND v_review_req > 0 THEN 'REVIEW_REQUIRED'
      ELSE 'FAIL'
    END,
    format('Total: %s | Passed: %s | Failed: %s | Review Required: %s | Not Run: %s',
      v_total, v_passed, v_failed, v_review_req, v_not_run),
    v_final_status
  );

  RAISE NOTICE '====================================================================';
  RAISE NOTICE 'Total: % | Passed: % | Failed: % | Review Required: % | Not Run: %',
    v_total, v_passed, v_failed, v_review_req, v_not_run;
  RAISE NOTICE 'Final verification status: %', v_final_status;
  RAISE NOTICE '====================================================================';
END
$cits_verify_3$;

-- =============================================================================
-- OUTPUT COMPLETE VERIFICATION TABLE IN SUPABASE SQL EDITOR RESULTS GRID
-- =============================================================================
SELECT
  test_code AS "Test Result",
  status AS "Status",
  requirement AS "Verification Check",
  evidence AS "Detailed Evidence / Summary"
FROM _cits_verification_report
ORDER BY step_order;

-- Roll back all temporary verification data so the production database remains 100% untouched
ROLLBACK;
