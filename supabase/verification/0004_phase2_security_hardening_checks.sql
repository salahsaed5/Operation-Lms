-- Staging structural verification for 0004 (read-only)
SELECT to_regprocedure('public.guard_instructor_lecture_update()') IS NOT NULL AS lecture_guard,
 to_regprocedure('public.guard_instructor_attendance_sheet_write()') IS NOT NULL AS sheet_guard,
 to_regprocedure('public.guard_attendance_record_relationships()') IS NOT NULL AS record_guard;
SELECT tgname,tgrelid::regclass,tgenabled FROM pg_trigger WHERE NOT tgisinternal
 AND tgname IN ('trg_guard_instructor_lecture_update','trg_guard_instructor_attendance_sheet_write','trg_guard_attendance_record_relationships');
SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='audit_logs'
 AND policyname='Instructors insert own audit_logs'; -- expected 0 rows
