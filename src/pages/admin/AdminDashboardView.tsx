import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CalendarCheck, GraduationCap, Users, ClipboardCheck, MapPin, Search, ArrowUpRight, CalendarPlus, UserPlus, Download, Tent, CheckCircle2, Clock, Layers } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import { calculateCampDayDate } from '../../domain/businessRules';
import { cairoClock, sessionState, sessionLabel } from '../../domain/sessionLifecycle';
import { AttendanceMark, AttendanceSheetStatus, OfflineSyncState, CampStatus, LectureStatus, CheckinStatus, type DailyCheckin, type AdminRouteId } from '../../types/database';
import { EmptyState, BTN_PRIMARY } from '../../components/ui/UiPrimitives';

type ArrivalState = 'arrived' | 'late' | 'not_checked_in' | 'review';
const arrivalState = (c?:DailyCheckin):ArrivalState => {
  if (!c) return 'not_checked_in';
  if (c.status === CheckinStatus.EXCEPTION_APPROVED || c.status === CheckinStatus.VERIFIED || c.status === CheckinStatus.LATE_FIRST_LECTURE) return c.arrivedLateFirstLecture || c.status===CheckinStatus.LATE_FIRST_LECTURE ? 'late' : 'arrived';
  return 'review';
};
const formatTime=(stamp:string,lang:string)=>new Intl.DateTimeFormat(lang==='ar'?'ar-EG':'en-GB',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'}).format(new Date(stamp));

export const AdminDashboardView: React.FC = () => {
  const { activeCamp,campInstructorIds,students,instructors,groups,rooms,lectures,checkins,attendanceSheets,setAdminRoute,refreshOperationalData,isSupabaseMode,lang,t }=useApp();
  const [lastRefreshAt,setLastRefreshAt]=useState<Date|null>(null);
  const [now,setNow]=useState(()=>new Date());
  const [sessionFilter,setSessionFilter]=useState('all');
  const [arrivalFilter,setArrivalFilter]=useState('all');
  const [arrivalQuery,setArrivalQuery]=useState('');
  const [showAllSessions,setShowAllSessions]=useState(false);
  const [showAllInstructors,setShowAllInstructors]=useState(false);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),30000);return()=>window.clearInterval(timer);},[]);
  useEffect(()=>{setSessionFilter('all');setArrivalFilter('all');setArrivalQuery('');setShowAllSessions(false);setShowAllInstructors(false);setLastRefreshAt(null);},[activeCamp?.id,activeCamp?.currentCampDay]);
  // Live when Supabase Realtime replication is enabled; 45s refresh and tab-focus fallback.
  // Subscriptions run only while the Admin dashboard is mounted.
  useEffect(() => {
    if (!isSupabaseMode || !supabase || !activeCamp) return;
    const client = supabase;
    let disposed = false;
    let refreshTimer: number | undefined;
    let refreshInFlight = false;
    const sync = () => {
      if (disposed || document.hidden || refreshInFlight) return;
      refreshInFlight = true;
      void refreshOperationalData().then(() => {
        if (!disposed) setLastRefreshAt(new Date());
      }).finally(() => { refreshInFlight = false; });
    };
    const queueSync = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(sync, 1000);
    };
    const channel = client.channel('camp-dashboard-' + activeCamp.id)
      .on('postgres_changes', { event:'*', schema:'public', table:'daily_checkins', filter:'camp_id=eq.' + activeCamp.id }, queueSync)
      .on('postgres_changes', { event:'*', schema:'public', table:'attendance_sheets', filter:'camp_id=eq.' + activeCamp.id }, queueSync)
      .on('postgres_changes', { event:'*', schema:'public', table:'lectures', filter:'camp_id=eq.' + activeCamp.id }, queueSync)
      .subscribe();
    const interval = window.setInterval(sync, 45000);
    const onVisibility = () => { if (!document.hidden) sync(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      if (refreshTimer) window.clearTimeout(refreshTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      void client.removeChannel(channel);
    };
  }, [activeCamp?.id, isSupabaseMode, refreshOperationalData]);

  const day=activeCamp?.currentCampDay;
  const date=activeCamp?calculateCampDayDate(activeCamp.startDate,activeCamp.currentCampDay,activeCamp.operatingWeekdays):null;
  const campStudents=students.filter(s=>s.campId===activeCamp?.id&&s.isActive);
  const campGroups=groups.filter(g=>g.campId===activeCamp?.id);
  const campInstructors=instructors.filter(i=>(activeCamp?campInstructorIds[activeCamp.id]||[]:[]).includes(i.id)&&i.isActive);
  const rows=useMemo(()=>{
    if(!activeCamp)return [];
    const clock=cairoClock(now);
    return lectures.filter(l=>l.campId===activeCamp.id&&l.campDay===day&&l.status!==LectureStatus.CANCELLED)
      .sort((a,b)=>a.startTime.localeCompare(b.startTime)||a.periodNumber-b.periodNumber)
      .map(lec=>{
        const instructorId=lec.substituteInstructorId||lec.instructorId;
        const instructor=instructors.find(i=>i.id===instructorId);
        const group=groups.find(g=>g.id===lec.groupId);
        const room=rooms.find(r=>r.id===lec.roomId);
        const sheet=attendanceSheets.find(s=>s.campId===activeCamp.id&&s.lectureId===lec.id);
        const roster=students.filter(s=>s.campId===activeCamp.id&&s.isActive&&s.groupId===lec.groupId&&(s.joinedCampDay??1)<=lec.campDay);
        const finalized=sheet&&(sheet.status===AttendanceSheetStatus.SUBMITTED||sheet.status===AttendanceSheetStatus.LOCKED)&&sheet.syncState===OfflineSyncState.SYNCED;
        return {lec,instructorId,instructor,group,room,sheet,roster,finalized,state:sessionState(lec,sheet,clock,activeCamp.status===CampStatus.ACTIVE)};
      });
  },[activeCamp,day,now,lectures,instructors,groups,rooms,attendanceSheets,students]);
  const finished=rows.filter(r=>r.state==='finished').length;
  const running=rows.filter(r=>r.state==='running').length;
  const pending=rows.length-finished-running;
  const missed=rows.filter(r=>r.state==='missed').length;
  const attendance={present:0,absent:0,excused:0,unmarked:0};
  for(const row of rows){
    const expected=new Set(row.roster.map(s=>s.id));
    // Submitted visitor records are included once per session, not mistaken for unique students.
    const records=new Map(row.finalized?row.sheet!.records.map(r=>[r.studentId,r]):[]);
    for(const id of records.keys())expected.add(id);
    for(const id of expected){
      const mark=records.get(id)?.mark;
      if(mark===AttendanceMark.PRESENT||mark===AttendanceMark.LATE)attendance.present++;
      else if(mark===AttendanceMark.ABSENT)attendance.absent++;
      else if(mark===AttendanceMark.EXCUSED)attendance.excused++;
      else attendance.unmarked++;
    }
  }
  const marked=attendance.present+attendance.absent+attendance.excused;
  const total=marked+attendance.unmarked;
  const rate=marked?Math.round(attendance.present/marked*100):null;
  const dayCheckins=checkins.filter(c=>c.campId===activeCamp?.id&&c.campDay===day).sort((a,b)=>b.serverTimestamp.localeCompare(a.serverTimestamp));
  const expectedIds=new Set(rows.map(r=>r.instructorId));
  const arrivalRows=Array.from(new Set([...expectedIds,...dayCheckins.map(c=>c.instructorId)])).map(id=>{
    const instructor=instructors.find(i=>i.id===id);
    const own=rows.filter(r=>r.instructorId===id);
    const checkin=dayCheckins.find(c=>c.instructorId===id);
    return {id,name:instructor?t(instructor.fullNameEn,instructor.fullNameAr):id,search:instructor?[instructor.fullNameEn,instructor.fullNameAr,instructor.instructorCode].join(' '):id,checkin,state:arrivalState(checkin),expected:expectedIds.has(id),first:own[0]?.lec.startTime,sessions:own.length};
  }).sort((a,b)=>Number(b.expected)-Number(a.expected)||(a.first||'99').localeCompare(b.first||'99')||a.name.localeCompare(b.name));
  const expected=arrivalRows.filter(r=>r.expected);
  const arrived=expected.filter(r=>r.state==='arrived'||r.state==='late').length;
  const notChecked=expected.filter(r=>r.state==='not_checked_in').length;
  const review=expected.filter(r=>r.state==='review').length;
  const filteredSessions=rows.filter(r=>sessionFilter==='all'||(sessionFilter==='pending'?r.state!=='running'&&r.state!=='finished':r.state===sessionFilter));
  const filteredInstructors=arrivalRows.filter(r=>(arrivalFilter==='all'||(arrivalFilter==='arrived'?r.state==='arrived'||r.state==='late':r.state===arrivalFilter))&&r.search.toLowerCase().includes(arrivalQuery.trim().toLowerCase()));
  const arrivalLabels:Record<ArrivalState,string>={arrived:t('Arrived','وصل'),late:t('Arrived late','وصل متأخراً'),not_checked_in:t('Not checked in','لم يسجل الوصول'),review:t('Needs verification','وصول غير معتمد')};
  const quickActions:{route:AdminRouteId;label:string;icon:typeof CalendarPlus}[]=[
    {route:'schedule',label:t('Manage sessions','إدارة المحاضرات'),icon:CalendarPlus},
    {route:'instructors',label:t('Manage instructors','إدارة المحاضرين'),icon:UserPlus},
    {route:'students',label:t('Manage students','إدارة الطلاب'),icon:GraduationCap},
    {route:'reports',label:t('Export reports','تصدير التقارير'),icon:Download},
  ];
  if(!activeCamp)return <div className="ops-dashboard ops-empty-camp"><EmptyState icon={Tent} title={t('No camp selected','لم يتم اختيار كامب')} description={t('Create or select a camp to see its daily operations.','أنشئ أو اختر كامب لمتابعة التشغيل اليومي.')} action={<button type="button" onClick={()=>setAdminRoute('camps')} className={BTN_PRIMARY}>{t('Configure Camp','إعداد المعسكر')}</button>}/></div>;
  const titleDate=date||'—';
  const metrics=[
    {label:t('Total students','إجمالي الطلاب'),value:campStudents.length,sub:t(`${campGroups.length} training groups`,`${campGroups.length} مجموعات تدريبية`),icon:GraduationCap,tone:'blue'},
    {label:t('Instructors','المحاضرون'),value:campInstructors.length,sub:t(`${expected.length} scheduled this day`,`${expected.length} مجدولون في هذا اليوم`),icon:Users,tone:'teal'},
    {label:t('Day sessions','محاضرات اليوم'),value:rows.length,sub:t(`${finished} finished · ${running} running`,`${finished} انتهت · ${running} جارية`),icon:CalendarClock,tone:'blue'},
    {label:t('Attendance rate','نسبة الحضور'),value:rate===null?'—':rate+'%',sub:t(`${marked} finalized marks`,`${marked} تسجيلات معتمدة`),icon:ClipboardCheck,tone:'green'},
  ];
  let cursor=0;
  const segments=[{key:'present',n:attendance.present,label:t('Present / late','حاضر / متأخر'),color:'#158b79'},{key:'absent',n:attendance.absent,label:t('Absent','غائب'),color:'#d65d69'},{key:'excused',n:attendance.excused,label:t('Excused','بعذر'),color:'#d99b35'},{key:'unmarked',n:attendance.unmarked,label:t('Not recorded','لم يسجل'),color:'#c5d2de'}];
  const gradient=total?segments.map(s=>{const start=cursor;cursor+=s.n/total*100;return s.color+' '+start+'% '+cursor+'%';}).join(','):'#e1e9ef 0% 100%';
  return <div className="ops-dashboard">
    <header className="ops-page-intro"><div><p className="ops-eyebrow">{t('OPERATIONS WORKSPACE','مساحة إدارة العمليات')}</p><h1>{t('Daily Operations','العمليات اليومية')}</h1><p className="ops-muted">{t('A clear view of your selected teaching day.','متابعة واضحة ليوم الدراسة المختار.')}</p></div><div className="ops-sync"><span className={isSupabaseMode?'ops-sync-dot':'ops-sync-dot local'}/>{isSupabaseMode?t('Auto-refresh · 45 sec','تحديث تلقائي · 45 ثانية'):t('Local preview','معاينة محلية')}{lastRefreshAt&&<span dir="ltr">{formatTime(lastRefreshAt.toISOString(),lang)}</span>}</div></header>
    <section className="ops-overview" aria-label={t('Camp Overview','ملخص الكامب')}>
      <div className="ops-camp-banner"><div className="ops-camp-title"><span className="ops-camp-icon"><Tent size={23}/></span><div><p>{t('Camp Overview','ملخص الكامب')}</p><h2>{t(activeCamp.nameEn,activeCamp.nameAr)}</h2><span>{activeCamp.code} · {titleDate}</span></div></div><div className="ops-camp-progress"><div><span>{t(`Day ${day} of ${activeCamp.durationDays}`,`اليوم ${day} من ${activeCamp.durationDays}`)}</span><strong>{Math.min(100,Math.max(0,Math.round((day||0)/Math.max(1,activeCamp.durationDays)*100)))}%</strong></div><div className="ops-progress-track"><span style={{width:Math.min(100,Math.max(0,(day||0)/Math.max(1,activeCamp.durationDays)*100))+'%'}}/></div><small>{t('Teaching-day progress','تقدم أيام الدراسة')}</small></div></div>
      <div className="ops-metrics">{metrics.map(m=><article className="ops-metric" key={m.label} data-tone={m.tone}><div><p>{m.label}</p><strong>{m.value}</strong><small>{m.sub}</small></div><span className="ops-metric-icon"><m.icon size={21}/></span></article>)}</div>
    </section>
    <div className="ops-mid-grid">
      <section className="ops-panel" aria-label={t("Today's Sessions",'محاضرات اليوم')}>
        <div className="ops-panel-heading"><div className="ops-heading-group"><span className="ops-section-icon"><CalendarClock size={20}/></span><div><h2>{t("Today's Sessions",'محاضرات اليوم')}</h2><p>{titleDate}</p></div></div><button className="ops-link" onClick={()=>setAdminRoute('schedule')}>{t('View schedule','عرض الجدول')}<ArrowUpRight size={15}/></button></div>
        <div className="ops-session-filters" aria-label={t('Filter sessions','تصفية المحاضرات')}>{[{id:'all',label:t('Scheduled','مجدولة'),count:rows.length},{id:'running',label:t('Running','جارية'),count:running},{id:'finished',label:t('Finished','منتهية'),count:finished},{id:'pending',label:t('Pending','معلقة'),count:pending}].map(s=><button key={s.id} type="button" data-state={s.id} aria-pressed={sessionFilter===s.id} onClick={()=>{setSessionFilter(s.id);setShowAllSessions(false);}}><strong>{s.count}</strong><span>{s.label}</span></button>)}</div>
        {missed>0&&<p className="ops-missed-note">{t(`${missed} session(s) missed their start window.`,`${missed} محاضرات لم تبدأ في الموعد.`)}</p>}
        <div className="ops-session-list">{(showAllSessions?filteredSessions:filteredSessions.slice(0,5)).map(r=><article className="ops-session-row" key={r.lec.id} data-state={r.state}><div className="ops-session-time" dir="ltr"><strong>{r.lec.startTime.slice(0,5)}</strong><small>{r.lec.endTime.slice(0,5)}</small></div><div className="ops-session-info"><strong>{r.lec.topic}</strong><span>{r.instructor?t(r.instructor.fullNameEn,r.instructor.fullNameAr):r.instructorId}</span><small>{r.group?t(r.group.nameEn,r.group.nameAr):r.lec.groupId} · {r.room?.code||r.lec.roomId}</small></div><span className="ops-status" data-state={r.state}>{t(sessionLabel(r.state).en,sessionLabel(r.state).ar)}</span></article>)}
        {!filteredSessions.length&&<div className="ops-empty"><CalendarCheck size={28}/><strong>{rows.length?t('No sessions match this filter','لا توجد محاضرات مطابقة'):t('No sessions scheduled','لا توجد محاضرات مجدولة')}</strong><button className="ops-link" onClick={()=>rows.length?setSessionFilter('all'):setAdminRoute('schedule')}>{rows.length?t('Show all sessions','عرض الكل'):t('Manage schedule','إدارة الجدول')}<ArrowUpRight size={14}/></button></div>}</div>
        {filteredSessions.length>5&&<button className="ops-expand" onClick={()=>setShowAllSessions(v=>!v)}>{showAllSessions?t('Show less','عرض أقل'):t(`Show all ${filteredSessions.length} sessions`,`عرض كل المحاضرات (${filteredSessions.length})`)}</button>}
      </section>
      <section className="ops-panel ops-attendance" aria-label={t('Student Attendance','حضور الطلاب')}>
        <div className="ops-panel-heading"><div className="ops-heading-group"><span className="ops-section-icon"><ClipboardCheck size={20}/></span><div><h2>{t('Student Attendance','حضور الطلاب')}</h2><p>{t('Selected teaching day','يوم الدراسة المختار')}</p></div></div><button className="ops-link" onClick={()=>setAdminRoute('attendance')} aria-label={t('View attendance sheets','عرض كشوف الحضور')}><ArrowUpRight size={17}/></button></div>
        <div className="ops-donut" style={{background:'conic-gradient('+gradient+')'}} role="img" aria-label={t(`Attendance rate ${rate===null?'not available':rate+'%'}`,`نسبة الحضور ${rate===null?'غير متاحة':rate+'%'}`)}><div><strong>{rate===null?'—':rate+'%'}</strong><small>{t('Recorded rate','نسبة الحضور المعتمد')}</small></div></div>
        <div className="ops-attendance-legend">{segments.map(s=><div key={s.key}><span className="ops-legend-dot" style={{background:s.color}}/><span>{s.label}</span><strong>{s.n}</strong></div>)}</div>
        <p className="ops-attendance-note">{t('Counts are attendance records per session, not unique students. Rate uses finalized marks only.','الأعداد تسجيلات حضور لكل محاضرة وليست طلاباً فريدين. النسبة من التسجيلات المعتمدة فقط.')}</p>
      </section>
    </div>
    <section className="ops-panel" aria-label={t('Instructor Check-in','وصول المحاضرين')}>
      <div className="ops-panel-heading"><div className="ops-heading-group"><span className="ops-section-icon"><MapPin size={20}/></span><div><h2>{t('Instructor Check-in','وصول المحاضرين')}</h2><p>{t('Arrival records for the selected day','سجلات الوصول لليوم المختار')}</p></div></div><button className="ops-link" onClick={()=>setAdminRoute('attendance')}>{t('View attendance','عرض الحضور')}<ArrowUpRight size={15}/></button></div>
      <div className="ops-arrival-summary">{[{label:t('Expected','متوقع'),n:expected.length,state:'all'},{label:t('Arrived','وصل'),n:arrived,state:'arrived'},{label:t('Not checked in','لم يسجل الوصول'),n:notChecked,state:'not_checked_in'},{label:t('Unverified','غير معتمد'),n:review,state:'review'}].map(m=><button key={m.state} data-state={m.state} aria-pressed={arrivalFilter===m.state} onClick={()=>{setArrivalFilter(m.state);setShowAllInstructors(false);}}><strong>{m.n}</strong><span>{m.label}</span></button>)}</div>
      <div className="ops-arrival-tools"><label className="ops-search"><Search size={17}/><input type="search" aria-label={t('Search instructors','البحث عن محاضر')} placeholder={t('Search instructors...','ابحث عن محاضر...')} value={arrivalQuery} onChange={e=>{setArrivalQuery(e.target.value);setShowAllInstructors(false);}}/></label><select aria-label={t('Filter check-in status','تصفية حالة الوصول')} value={arrivalFilter} onChange={e=>{setArrivalFilter(e.target.value);setShowAllInstructors(false);}}><option value="all">{t('All instructors','كل المحاضرين')}</option><option value="arrived">{t('Arrived','وصل')}</option><option value="not_checked_in">{arrivalLabels.not_checked_in}</option><option value="late">{arrivalLabels.late}</option><option value="review">{arrivalLabels.review}</option></select></div>
      <div className="ops-arrival-list">{(showAllInstructors?filteredInstructors:filteredInstructors.slice(0,6)).map(r=><article className="ops-arrival-row" key={r.id}><span className="ops-avatar">{r.name.split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()}</span><div className="ops-arrival-name"><strong>{r.name}</strong><small>{r.expected?t(`${r.sessions} sessions · First ${r.first?.slice(0,5)}`,`${r.sessions} محاضرات · الأولى ${r.first?.slice(0,5)}`):t('No scheduled session','بدون محاضرة مجدولة')}</small></div><div className="ops-arrival-time"><Clock size={14}/><span dir="ltr">{r.checkin?formatTime(r.checkin.serverTimestamp,lang):'—'}</span></div><span className="ops-status" data-state={r.state}>{arrivalLabels[r.state]}</span></article>)}
      {!filteredInstructors.length&&<div className="ops-empty"><Users size={28}/><strong>{arrivalRows.length?t('No matching instructors','لا يوجد محاضر مطابق'):t('No instructors scheduled or checked in','لا يوجد محاضرون مجدولون أو سجلات وصول')}</strong></div>}</div>
      {filteredInstructors.length>6&&<button className="ops-expand" onClick={()=>setShowAllInstructors(v=>!v)}>{showAllInstructors?t('Show less','عرض أقل'):t(`Show all ${filteredInstructors.length} instructors`,`عرض كل المحاضرين (${filteredInstructors.length})`)}</button>}
      <p className="ops-attendance-note">{t('Summary counts scheduled instructors only. Check-in is optional and separate from session completion.','الملخص للمحاضرين المجدولين فقط. تسجيل الوصول اختياري ومنفصل عن إكمال المحاضرة.')}</p>
    </section>
    <section className="ops-panel" aria-label={t('Quick Actions','اختصارات سريعة')}><div className="ops-panel-heading"><div className="ops-heading-group"><span className="ops-section-icon"><Layers size={20}/></span><div><h2>{t('Quick Actions','اختصارات سريعة')}</h2><p>{t('Jump to your workspace','انتقل مباشرة إلى أدوات الإدارة')}</p></div></div></div><div className="ops-quick-grid">{quickActions.map(a=><button type="button" key={a.route} onClick={()=>setAdminRoute(a.route)}><span><a.icon size={21}/></span><strong>{a.label}</strong><ArrowUpRight size={15}/></button>)}</div></section>
  </div>;
};
