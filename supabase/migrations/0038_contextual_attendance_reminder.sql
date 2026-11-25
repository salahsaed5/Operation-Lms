-- Only a verified admin may send a contextual reminder for an overdue lecture.
BEGIN;
CREATE OR REPLACE FUNCTION public.send_attendance_reminder_tx(p_lecture_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE l public.lectures%ROWTYPE; recipient uuid; actor_name text; now_cairo timestamp:=clock_timestamp() AT TIME ZONE 'Africa/Cairo';
BEGIN
 IF auth.uid() IS NULL OR public.is_cits_admin() IS NOT TRUE THEN RAISE EXCEPTION 'Verified admin required' USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM public.lectures WHERE id=p_lecture_id FOR UPDATE;
 IF NOT FOUND OR l.status='cancelled' OR NOT EXISTS(SELECT 1 FROM public.camps c WHERE c.id=l.camp_id AND c.status='active') THEN RAISE EXCEPTION 'Lecture is not eligible for a reminder'; END IF;
 IF (l.lecture_date+l.end_time)>now_cairo THEN RAISE EXCEPTION 'Lecture has not ended'; END IF;
 IF EXISTS(SELECT 1 FROM public.attendance_sheets s WHERE s.lecture_id=l.id AND s.status IN ('submitted','locked')) THEN RAISE EXCEPTION 'Attendance already finalized'; END IF;
 SELECT i.profile_id INTO recipient FROM public.instructors i JOIN public.profiles p ON p.id=i.profile_id WHERE i.id=coalesce(l.substitute_instructor_id,l.instructor_id) AND i.archived_at IS NULL AND p.is_active;
 IF recipient IS NULL THEN RAISE EXCEPTION 'Instructor account unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.entity_type='lectures' AND a.entity_id=l.id::text AND a.action='ATTENDANCE_REMINDER_SENT' AND a.created_at>clock_timestamp()-interval '6 hours') THEN RAISE EXCEPTION 'A reminder was already sent within the last 6 hours'; END IF;
 INSERT INTO public.notifications(recipient_profile_id,title_en,title_ar,body_en,body_ar) VALUES(recipient,'Attendance reminder','تذكير بالحضور','Please review and finalize attendance for '||l.topic||' · Day '||l.camp_day||' · Period '||l.period_number||'.','يرجى مراجعة واعتماد حضور '||l.topic||' · اليوم '||l.camp_day||' · الفترة '||l.period_number||'.');
 SELECT full_name_en INTO actor_name FROM public.profiles WHERE id=auth.uid();
 INSERT INTO public.audit_logs(actor_profile_id,actor_name,actor_role,camp_id,action,entity_type,entity_id,new_value,reason) VALUES(auth.uid(),coalesce(actor_name,'Admin'),'admin',l.camp_id,'ATTENDANCE_REMINDER_SENT','lectures',l.id::text,jsonb_build_object('recipient_profile_id',recipient),'Overdue attendance reminder');
END;
$fn$;
REVOKE ALL ON FUNCTION public.send_attendance_reminder_tx(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.send_attendance_reminder_tx(uuid) TO authenticated;
COMMIT;
