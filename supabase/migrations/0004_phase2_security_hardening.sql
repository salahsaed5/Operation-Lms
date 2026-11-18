-- 0004_phase2_security_hardening.sql
-- Defense-in-depth write guards. Stage-test before production application.
BEGIN;
CREATE OR REPLACE FUNCTION public.guard_instructor_lecture_update()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF public.is_cits_admin() THEN RETURN NEW; END IF;
 IF public.current_instructor_id() IS NULL OR NOT (
 OLD.instructor_id=public.current_instructor_id() OR OLD.substitute_instructor_id=public.current_instructor_id()) THEN
 RAISE EXCEPTION 'Not authorized to update this lecture.';
 END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.camp_id IS DISTINCT FROM OLD.camp_id
 OR NEW.camp_day IS DISTINCT FROM OLD.camp_day OR NEW.lecture_date IS DISTINCT FROM OLD.lecture_date
 OR NEW.period_number IS DISTINCT FROM OLD.period_number OR NEW.start_time IS DISTINCT FROM OLD.start_time
 OR NEW.end_time IS DISTINCT FROM OLD.end_time OR NEW.duration_hours IS DISTINCT FROM OLD.duration_hours
 OR NEW.group_id IS DISTINCT FROM OLD.group_id OR NEW.instructor_id IS DISTINCT FROM OLD.instructor_id
 OR NEW.substitute_instructor_id IS DISTINCT FROM OLD.substitute_instructor_id
 OR NEW.room_id IS DISTINCT FROM OLD.room_id OR NEW.topic IS DISTINCT FROM OLD.topic
 OR NEW.status IS DISTINCT FROM OLD.status OR NEW.frozen_rate_egp IS DISTINCT FROM OLD.frozen_rate_egp
 OR NEW.revision_number IS DISTINCT FROM OLD.revision_number OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
 RAISE EXCEPTION 'Instructors may only acknowledge lectures; schedule fields are admin-only.';
 END IF;
 IF OLD.instructor_acknowledged_at IS NOT NULL AND NEW.instructor_acknowledged_at IS DISTINCT FROM OLD.instructor_acknowledged_at THEN
 RAISE EXCEPTION 'Acknowledgement cannot be changed after it is recorded.';
 END IF;
 IF OLD.instructor_acknowledged_at IS NULL AND NEW.instructor_acknowledged_at IS NULL THEN
 RAISE EXCEPTION 'Instructor update must record acknowledgement.';
 END IF;
 NEW.updated_at:=NOW(); RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_guard_instructor_lecture_update ON public.lectures;
CREATE TRIGGER trg_guard_instructor_lecture_update BEFORE UPDATE ON public.lectures
FOR EACH ROW EXECUTE FUNCTION public.guard_instructor_lecture_update();

CREATE OR REPLACE FUNCTION public.guard_instructor_attendance_sheet_write()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_lecture RECORD;
BEGIN
 -- SECURITY DEFINER RPCs execute as their owner; permit trusted server-side transaction updates.
 IF current_user NOT IN ('authenticated','anon') THEN RETURN NEW; END IF;
 IF public.is_cits_admin() THEN RETURN NEW; END IF;
 IF public.current_instructor_id() IS NULL OR NEW.instructor_id<>public.current_instructor_id() THEN
 RAISE EXCEPTION 'Not authorized to write attendance sheet.';
 END IF;
 SELECT camp_id,COALESCE(substitute_instructor_id,instructor_id) assigned_instructor INTO v_lecture
 FROM public.lectures WHERE id=NEW.lecture_id;
 IF NOT FOUND OR v_lecture.camp_id IS DISTINCT FROM NEW.camp_id
 OR v_lecture.assigned_instructor IS DISTINCT FROM NEW.instructor_id THEN
 RAISE EXCEPTION 'Sheet must match its lecture, camp and assigned instructor.';
 END IF;
 IF TG_OP='INSERT' THEN
 NEW.status:='draft'; NEW.present_count:=0; NEW.absent_count:=0; NEW.cross_group_count:=0;
 NEW.submitted_at:=NULL; NEW.synced_at:=NULL; NEW.sync_state:='Offline'; NEW.updated_at:=NOW();
 RETURN NEW;
 END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.camp_id IS DISTINCT FROM OLD.camp_id
 OR NEW.lecture_id IS DISTINCT FROM OLD.lecture_id OR NEW.instructor_id IS DISTINCT FROM OLD.instructor_id
 OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.present_count IS DISTINCT FROM OLD.present_count
 OR NEW.absent_count IS DISTINCT FROM OLD.absent_count OR NEW.cross_group_count IS DISTINCT FROM OLD.cross_group_count
 OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR NEW.synced_at IS DISTINCT FROM OLD.synced_at
 OR NEW.status IS DISTINCT FROM OLD.status OR NEW.sync_state IS DISTINCT FROM OLD.sync_state
 OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
 RAISE EXCEPTION 'Server-owned attendance sheet fields cannot be modified by instructors.';
 END IF;
 IF OLD.status<>'draft' THEN RAISE EXCEPTION 'Only draft sheets may be edited by instructors.'; END IF;
 NEW.updated_at:=NOW(); RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_guard_instructor_attendance_sheet_write ON public.attendance_sheets;
CREATE TRIGGER trg_guard_instructor_attendance_sheet_write BEFORE INSERT OR UPDATE ON public.attendance_sheets
FOR EACH ROW EXECUTE FUNCTION public.guard_instructor_attendance_sheet_write();

CREATE OR REPLACE FUNCTION public.guard_attendance_record_relationships()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_sheet RECORD; v_lecture RECORD; v_student RECORD; v_group_camp UUID;
BEGIN
 -- SECURITY DEFINER RPCs execute as their owner; trusted server transactions may finalize records.
 IF current_user NOT IN ('authenticated','anon') THEN RETURN NEW; END IF;
 SELECT camp_id,lecture_id,instructor_id,status INTO v_sheet FROM public.attendance_sheets
 WHERE id=NEW.attendance_sheet_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Attendance sheet not found.'; END IF;
 SELECT camp_id,camp_day,period_number,group_id,COALESCE(substitute_instructor_id,instructor_id) assigned_instructor
 INTO v_lecture FROM public.lectures WHERE id=NEW.lecture_id;
 IF NOT FOUND OR v_sheet.lecture_id IS DISTINCT FROM NEW.lecture_id
 OR v_sheet.camp_id IS DISTINCT FROM NEW.camp_id OR v_lecture.camp_id IS DISTINCT FROM NEW.camp_id THEN
 RAISE EXCEPTION 'Attendance sheet/lecture/camp linkage mismatch.';
 END IF;
 IF NOT public.is_cits_admin() AND v_sheet.status<>'draft' THEN RAISE EXCEPTION 'Records editable only while sheet is draft.'; END IF;
 IF NOT public.is_cits_admin() AND (v_sheet.instructor_id IS DISTINCT FROM public.current_instructor_id()
 OR v_lecture.assigned_instructor IS DISTINCT FROM public.current_instructor_id()) THEN
 RAISE EXCEPTION 'Instructor is not assigned to this sheet and lecture.';
 END IF;
 SELECT camp_id,group_id INTO v_student FROM public.students WHERE id=NEW.student_id;
 IF NOT FOUND OR v_student.camp_id IS DISTINCT FROM NEW.camp_id THEN RAISE EXCEPTION 'Student does not belong to camp.'; END IF;
 SELECT camp_id INTO v_group_camp FROM public.groups WHERE id=NEW.attended_group_id;
 IF NOT FOUND OR v_group_camp IS DISTINCT FROM NEW.camp_id OR NEW.attended_group_id IS DISTINCT FROM v_lecture.group_id THEN
 RAISE EXCEPTION 'Attended group must match lecture group and camp.';
 END IF;
 NEW.camp_day:=v_lecture.camp_day; NEW.period_number:=v_lecture.period_number;
 NEW.origin_group_id:=v_student.group_id; NEW.is_cross_group:=(NEW.origin_group_id IS DISTINCT FROM NEW.attended_group_id);
 NEW.updated_at:=NOW(); RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_guard_attendance_record_relationships ON public.attendance_records;
CREATE TRIGGER trg_guard_attendance_record_relationships BEFORE INSERT OR UPDATE ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public.guard_attendance_record_relationships();

DROP POLICY IF EXISTS "Instructors insert own audit_logs" ON public.audit_logs;
COMMIT;
