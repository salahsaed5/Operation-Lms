import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  CheckCircle2,
  Clock,
  Pencil,
  Eye,
  ShieldCheck,
  Search,
  CalendarClock,
  ClipboardCheck, ChevronLeft, ChevronRight, Users, UserRound, MoreHorizontal, Bell, Download, Printer,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { buildCampAttendanceExcelGrid, type DayAttendanceCode } from '../../domain/campAttendanceExcelGrid';
import { studentEligibleForCampDay } from '../../domain/studentJoinDay';
import { dailyAttendanceProgress, isFinalAttendance } from '../../domain/dailyAttendanceWorkspace';
import { cairoClock } from '../../domain/sessionLifecycle';
import { timeSeconds } from '../../domain/fixedAssignmentAvailability';
import { formatScheduleTime } from '../../domain/scheduleTime';
import { createXlsxWorkbook, excelCell } from '../../services/tinyXlsxWorkbook';
import { getSignedSelfieUrl, sendAttendanceReminderInDb } from '../../services/citsRepository';
import { calculateCampDayDate, resolveStudentOriginGroupForDay } from '../../domain/businessRules';
import {
  AttendanceMark,
  AttendanceSheetStatus,
  CampStatus,
  CheckinStatus,
  Lecture,
  LectureStatus,
  RequestStatus,
} from '../../types/database';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  EmptyState,
  INPUT_CLASS,
  InlineBanner,
  LABEL_CLASS,
  PageHeader,
  SELECT_CLASS,
  SURFACE_CARD,
  SURFACE_SUBTLE,
  StatusBadge,
} from '../../components/ui/UiPrimitives';

function lectureStatusLabel(
  status: LectureStatus,
  t: (en: string, ar: string) => string
): { label: string; tone: 'info' | 'warning' | 'success' | 'neutral' } {
  switch (status) {
    case LectureStatus.IN_PROGRESS:
      return { label: t('In Progress', 'قيد التنفيذ'), tone: 'warning' };
    case LectureStatus.COMPLETED:
      return { label: t('Completed', 'مكتملة'), tone: 'success' };
    case LectureStatus.CANCELLED:
      return { label: t('Cancelled', 'ملغاة'), tone: 'neutral' };
    default:
      return { label: t('Scheduled', 'مجدولة'), tone: 'info' };
  }
}

function checkinStatusDisplay(
  status: CheckinStatus,
  t: (en: string, ar: string) => string
): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  switch (status) {
    case CheckinStatus.VERIFIED:
      return { label: t('Verified', 'موثق'), tone: 'success' };
    case CheckinStatus.EXCEPTION_APPROVED:
      return { label: t('Exception Approved', 'استثناء معتمد'), tone: 'success' };
    case CheckinStatus.LATE_FIRST_LECTURE:
      return { label: t('Late', 'متأخر'), tone: 'warning' };
    case CheckinStatus.EXCEPTION_PENDING:
      return { label: t('Exception Pending', 'بانتظار المراجعة'), tone: 'warning' };
    case CheckinStatus.OUTSIDE_GEOFENCE:
      return { label: t('Outside Geofence', 'خارج النطاق'), tone: 'danger' };
    case CheckinStatus.EXCEPTION_REJECTED:
      return { label: t('Exception Rejected', 'استثناء مرفوض'), tone: 'danger' };
    default:
      return { label: t('Recorded', 'مسجل'), tone: 'neutral' };
  }
}

export { AdminScheduleView } from './AdminScheduleWorkspace';

export const AdminAttendanceView: React.FC = () => {
  const {
    activeCamp,
    attendanceSheets,
    lectures,
    instructors,
    groups,
    checkins,
    checkinExceptions, students, studentTransfers, auditLogs, financeSnapshot, downloadTenDayAttendanceWorkbook, isSupabaseMode, refreshOperationalData,
    submitAndSyncAttendanceSheet,
    adminCorrectAttendanceRecord,
    reviewCheckinException,
    t,
  } = useApp();

  const [expandedSheetId, setExpandedSheetId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'synced' | 'draft' | 'missing'>('all');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [correctionNotes, setCorrectionNotes] = useState<Record<string, string>>({});
  const [selfiePreviews, setSelfiePreviews] = useState<Record<string, string>>({});
  const [isBusy, setIsBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [day,setDay]=useState(activeCamp?.currentCampDay||1);
  const [tab,setTab]=useState<'students'|'instructors'|'exceptions'>('students');
  const [period,setPeriod]=useState('all');
  const [tool,setTool]=useState<'matrix'|'history'|'absences'|'reports'|'revisions'|null>(null);
  const [toolsOpen,setToolsOpen]=useState(false);
  const [groupFilter,setGroupFilter]=useState('all');
  const [studentQuery,setStudentQuery]=useState('');
  const [studentId,setStudentId]=useState('');
  const [rosterQuery,setRosterQuery]=useState('');
  const [absenceThreshold,setAbsenceThreshold]=useState(2);
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),30000);return ()=>window.clearInterval(timer)},[]);
  useEffect(()=>{setDay(activeCamp?.currentCampDay||1);setTab('students');setPeriod('all');setStatusFilter('all');setSearchQuery('');setExpandedSheetId(null);setTool(null);setToolsOpen(false);setGroupFilter('all');setStudentId('');setStudentQuery('');setSelfiePreviews({});},[activeCamp?.id,activeCamp?.currentCampDay]);
  useEffect(()=>{setExpandedSheetId(null);setRosterQuery('');},[day,tab]);
  const matrix=useMemo(()=>activeCamp?buildCampAttendanceExcelGrid({campId:activeCamp.id,durationDays:activeCamp.durationDays,students,studentTransfers,lectures,attendanceSheets}):null,[activeCamp,students,studentTransfers,lectures,attendanceSheets]);
  if (!activeCamp) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title={t('No active camp configured', 'لا يوجد معسكر نشط حالياً')}
      />
    );
  }

  const clock=cairoClock(now),cairoToday=clock.date;
  const campAllowsFinalAttendance=activeCamp.status===CampStatus.ACTIVE;
  const selectedDay=Math.min(activeCamp.durationDays,Math.max(1,day));
  const selectedDate=calculateCampDayDate(activeCamp.startDate,selectedDay,activeCamp.operatingWeekdays);
  const campLectures=lectures.filter(l=>l.campId===activeCamp.id&&l.status!==LectureStatus.CANCELLED);
  const dayLectures=campLectures.filter(l=>l.campDay===selectedDay).sort((a,b)=>a.periodNumber-b.periodNumber||a.startTime.localeCompare(b.startTime)||a.groupId.localeCompare(b.groupId));
  const allCampSheets=attendanceSheets.filter(s=>s.campId===activeCamp.id&&campLectures.some(l=>l.id===s.lectureId));
  const campSheets=allCampSheets.filter(s=>dayLectures.some(l=>l.id===s.lectureId));
  const campExceptions=checkinExceptions.filter(ex=>ex.campId===activeCamp.id&&ex.campDay===selectedDay);
  const campCheckins=checkins.filter(c=>c.campId===activeCamp.id&&c.campDay===selectedDay);
  const campGroups=groups.filter(g=>g.campId===activeCamp.id);
  const groupName=(id:string)=>{const g=groups.find(g=>g.id===id);return g?t(g.nameEn,g.nameAr):id};
  const instructorName=(id:string)=>{const i=instructors.find(i=>i.id===id);return i?t(i.fullNameEn,i.fullNameAr):id};
  const progress=dailyAttendanceProgress(dayLectures,campSheets,clock,campAllowsFinalAttendance);
  const finalizedSheetCount=campSheets.filter(isFinalAttendance).length;
  const draftSheetCount=campSheets.length-finalizedSheetCount;
  const dailyRows=(matrix?.rows||[]).filter(r=>r.joinedCampDay<=selectedDay);
  const countDay=(code:DayAttendanceCode)=>dailyRows.filter(r=>r.days[selectedDay-1]===code).length;
  const p=countDay('P'),a=countDay('A'),late=countDay('L'),excused=countDay('E'),pending=countDay('Pending'),notScheduled=countDay('—');
  const rate=p+late+a?Math.round((p+late)/(p+late+a)*100)+'%':'—';
  const q=searchQuery.trim().toLowerCase();
  const sheetFor=(id:string)=>campSheets.find(s=>s.lectureId===id);
  const filteredLectures=dayLectures.filter(l=>{
    const sh=sheetFor(l.id),g=groups.find(g=>g.id===l.groupId),i=instructors.find(i=>i.id===(l.substituteInstructorId||l.instructorId));
    if(period!=='all'&&l.periodNumber!==Number(period))return false;
    if(statusFilter==='synced'&&!isFinalAttendance(sh))return false;
    if(statusFilter==='draft'&&(!sh||isFinalAttendance(sh)))return false;
    if(statusFilter==='missing'&&!progress.overdueIds.has(l.id))return false;
    return !q||[l.topic,g?.code,g?.nameEn,g?.nameAr,i?.fullNameEn,i?.fullNameAr].some(v=>v?.toLowerCase().includes(q));
  });
  const pendingExceptions=campExceptions.filter(ex=>ex.status===RequestStatus.PENDING).length;
  const expectedIds=new Set(dayLectures.map(l=>l.substituteInstructorId||l.instructorId));
  const backupIds=new Set(financeSnapshot.backups.filter(b=>b.status!=='excluded'&&dayLectures.some(l=>l.id===b.lectureId)).map(b=>b.instructorId));
  const checkinIds=[...new Set([...expectedIds,...backupIds,...campCheckins.map(c=>c.instructorId)])];
  const missingCheckin=(id:string)=>campAllowsFinalAttendance&&dayLectures.some(l=>(l.substituteInstructorId||l.instructorId)===id&&(l.lectureDate<clock.date||(l.lectureDate===clock.date&&timeSeconds(l.startTime)<=clock.seconds)))&&!campCheckins.some(c=>c.instructorId===id);
  const toolRows=(matrix?.rows||[]).filter(r=>(groupFilter==='all'||r.homeGroupId===groupFilter)&&(!studentQuery.trim()||(r.fullName+' '+r.studentCode).toLowerCase().includes(studentQuery.trim().toLowerCase()))&&(tool!=='absences'||r.days.slice(0,selectedDay).filter(d=>d==='A').length>=absenceThreshold));
  const markLabel=(code:DayAttendanceCode)=>code==='P'?t('Present','حاضر'):code==='L'?t('Late','متأخر'):code==='A'?t('Absent','غائب'):code==='E'?t('Excused','بعذر'):code==='Pending'?t('Pending','غير معتمد'):t('Not applicable','غير منطبق');
  const markTone=(code:DayAttendanceCode)=>code==='P'?'success':code==='L'||code==='Pending'?'warning':code==='A'?'danger':'neutral';
  const exportRows=(name:string,rows:(string|number)[][])=>{const blob=createXlsxWorkbook([{name:'Attendance',rows:rows.map((r,i)=>r.map(v=>excelCell(v,i===0?3:4))),widths:[22,32,24,20,20,20,20,20],freeze:{columns:0,rows:1,topLeft:'A2'}}]);const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name+'.xlsx';link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1200)};
  const studentGroupOnDay=(id:string)=>{const st=students.find(st=>st.id===id);return st?resolveStudentOriginGroupForDay({student:st,transfers:studentTransfers,campDay:selectedDay}):''};
  const exportDay=()=>exportRows('Attendance-Day-'+selectedDay+'-snapshot',[['Student code','Student','Date','Official daily status'],...dailyRows.filter(r=>groupFilter==='all'||studentGroupOnDay(r.studentId)===groupFilter).map(r=>[r.studentCode,r.fullName,selectedDate,markLabel(r.days[selectedDay-1])])]);
  const exportCamp=async()=>{setIsBusy(true);try{const res=await downloadTenDayAttendanceWorkbook(groupFilter==='all'?undefined:groupFilter);setSyncMessage({ok:res.ok,text:res.ok?t('Workbook downloaded','تم تنزيل التقرير'):res.error||t('Export failed','فشل التصدير')})}finally{setIsBusy(false)}};
  const remind=async(l:Lecture)=>{if(isBusy||!isSupabaseMode||!progress.overdueIds.has(l.id))return;setIsBusy(true);try{await sendAttendanceReminderInDb(l.id);setSyncMessage({ok:true,text:t('Reminder sent to instructor','تم إرسال التذكير للمحاضر')});await refreshOperationalData()}catch(e){setSyncMessage({ok:false,text:e instanceof Error?e.message:String(e)})}finally{setIsBusy(false)}};
  const openTool=(v:typeof tool)=>{setTool(v);setToolsOpen(false);setStudentQuery('');setStudentId('');setGroupFilter('all')};
  const stat=(label:string,value:string|number,color='')=><div key={label} className="rounded-xl bg-slate-50 dark:bg-[#121416]/40 border border-slate-100 dark:border-[#353A3F] p-3"><p className="text-xs text-slate-500 dark:text-[#A0A5AA]">{label}</p><p className={'text-xl font-bold tabular-nums mt-1 '+color}>{value}</p></div>;
  const handleForceSync = async (lectureId: string) => {
    const lecture = lectures.find(l => l.id === lectureId);
    if (!campAllowsFinalAttendance || !lecture || lecture.status===LectureStatus.CANCELLED || lecture.lectureDate > cairoToday) {
      setSyncMessage({
        ok: false,
        text: t(
          'Final attendance is blocked until the camp is active and the scheduled lecture date has arrived. Local drafts are not authoritative.',
          'اعتماد كشف الحضور مقفول حتى تفعيل المعسكر وحلول موعد المحاضرة. المسودات المحلية ليست بيانات معتمدة على السيرفر.'
        ),
      });
      return;
    }
    if(!window.confirm(t('Finalize this sheet? Unmarked students will become absent. Confirm offline drafts are synchronized.','اعتماد الكشف؟ سيتحول غير المحدد إلى غائب. تأكد من مزامنة المسودات المحلية.')))return;
    setIsBusy(true);
    setSyncMessage(null);
    try {
      const res = await submitAndSyncAttendanceSheet(lectureId);
      if (res.ok) {
        setSyncMessage({
          ok: true,
          text: t(
            'Attendance sheet submitted & synchronized. Unmarked students were marked absent and entitlement eligibility was updated.',
            'تم اعتماد ومزامنة كشف الحضور، وتحويل الطلاب غير المحددين إلى غياب وتحديث المستحق المالي.'
          ),
        });
      } else {
        setSyncMessage({
          ok: false,
          text: res.error || t('Failed synchronizing attendance.', 'تعذر مزامنة الكشف.'),
        });
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleCorrectMark = async (
    sheetId: string,
    lectureId: string,
    studentId: string,
    mark: AttendanceMark
  ) => {
    const noteText =
      (correctionNotes[sheetId] ?? 'Verified by Admin during roster review').trim();
    if (!noteText) {
      setSyncMessage({
        ok: false,
        text: t(
          'Please provide an audit reason before correcting attendance marks.',
          'يرجى إدخال سبب التعديل في سجل التدقيق قبل تغيير حالة الحضور.'
        ),
      });
      return;
    }
    setIsBusy(true);
    try {
      const res = await adminCorrectAttendanceRecord({
        sheetId,
        lectureId,
        studentId,
        mark,
        note: noteText,
      });
      if (!res.ok) {
        setSyncMessage({ ok: false, text: res.error || t('Correction failed.', 'فشل تعديل السجل.') });
      } else {
        setSyncMessage({
          ok: true,
          text: t('Student attendance mark corrected and logged.', 'تم تعديل حالة حضور الطالب وتوثيقها.'),
        });
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleExceptionDecision = async (
    exceptionId: string,
    decision: 'approved' | 'rejected'
  ) => {
    setIsBusy(true);
    setSyncMessage(null);
    try {
      const res = await reviewCheckinException({
        exceptionId,
        decision,
        reviewNote: reviewNotes[exceptionId] || '',
      });
      if (!res.ok) {
        setSyncMessage({ ok: false, text: res.error || t('Review failed.', 'فشلت المراجعة.') });
      } else {
        setSyncMessage({
          ok: true,
          text: t(
            `Check-in exception ${decision} and entitlement triggers updated.`,
            `تم ${decision === 'approved' ? 'اعتماد' : 'رفض'} استثناء تسجيل الوصول.`
          ),
        });
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleLoadSelfie = async (checkinId: string, storagePath: string) => {
    const url = await getSignedSelfieUrl(storagePath);
    if (url) {
      setSelfiePreviews((prev) => ({ ...prev, [checkinId]: url }));
    } else {
      setSyncMessage({
        ok: false,
        text: t(
          'Signed selfie preview requires live connected file storage.',
          'معاينة الصورة الموقعة متاحة فقط عند الاتصال الفعلي بخدمة التخزين.'
        ),
      });
    }
  };

  return (
    <div className="attendance-workspace space-y-4">
      <PageHeader
        title={t('Attendance Management', 'إدارة الحضور')}
        subtitle={t(
          'Inspect lecture rosters, log audited attendance corrections, and review instructor GPS/lateness exceptions.',
          'فحص كشوف المحاضرات وتعديل الحالات مع التوثيق ومراجعة استثناءات الوصول اليومي للمحاضرين.'
        )}
      />

      {syncMessage && (
        <InlineBanner
          type={syncMessage.ok ? 'success' : 'error'}
          message={syncMessage.text}
          onDismiss={() => setSyncMessage(null)}
        />
      )}

      <section className="sched-day" aria-label={t('Attendance day navigation','أيام الحضور')}>
        <button type="button" aria-label={t('Previous day','اليوم السابق')} disabled={selectedDay<=1} onClick={()=>setDay(selectedDay-1)}><ChevronLeft size={20}/></button>
        <div><strong>{t('Day '+selectedDay+' of '+activeCamp.durationDays,'اليوم '+selectedDay+' من '+activeCamp.durationDays)}</strong><small>{selectedDate}</small></div>
        <select aria-label={t('Attendance day','يوم الحضور')} value={selectedDay} onChange={e=>setDay(Number(e.target.value))}>{Array.from({length:activeCamp.durationDays},(_,i)=><option key={i+1} value={i+1}>{t('Day '+(i+1),'اليوم '+(i+1))}</option>)}</select>
        <button type="button" aria-label={t('Next day','اليوم التالي')} disabled={selectedDay>=activeCamp.durationDays} onClick={()=>setDay(selectedDay+1)}><ChevronRight size={20}/></button>
      </section>
      <section className={SURFACE_CARD+' p-4 space-y-3'} aria-label={t('Attendance overview','ملخص الحضور')}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">{t('Daily student attendance','حضور الطلاب اليومي')}</h2><StatusBadge tone="neutral">{t('Finalized records only','الكشوف المعتمدة فقط')}</StatusBadge></div>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">{stat(t('Enrolled by this day','الطلاب المسجلون حتى اليوم'),dailyRows.length)}{stat(t('Present','حاضر'),p,'text-emerald-600')}{stat(t('Absent','غائب'),a,'text-rose-600')}{stat(t('Late','متأخر'),late,'text-amber-600')}{stat(t('Pending','غير معتمد'),pending)}{stat(t('Attendance rate','نسبة الحضور'),rate,'text-teal-600')}</div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('Unique students · Late counts as attended · Excused: '+excused+' · Not applicable: '+notScheduled+' · Rate = attended / (attended + absent).','طلاب فريدون · التأخير يحسب حضوراً · بعذر: '+excused+' · غير منطبق: '+notScheduled+' · النسبة من الحضور والغياب المعتمدين.')}</p>
        <div className="border-t border-slate-200 dark:border-[#353A3F] pt-3 space-y-2"><div className="flex justify-between gap-2"><h3 className="font-semibold text-sm">{t('Attendance progress','تقدم اعتماد الحضور')}</h3><strong className="text-teal-600">{progress.finalized}/{progress.total} · {progress.percent}%</strong></div><div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden flex"><span className="bg-emerald-600" style={{width:progress.percent+'%'}}/><span className="bg-amber-500" style={{width:(progress.total?progress.draft/progress.total*100:0)+'%'}}/><span className="bg-rose-500" style={{width:(progress.total?progress.missing/progress.total*100:0)+'%'}}/></div><div className="grid grid-cols-2 sm:grid-cols-5 gap-2">{stat(t('Total sessions','المحاضرات'),progress.total)}{stat(t('Finalized','معتمدة'),progress.finalized,'text-emerald-600')}{stat(t('Overdue draft','مسودة متأخرة'),progress.draft,'text-amber-600')}{stat(t('Missing marks','بلا تسجيل'),progress.missing,'text-rose-600')}{stat(t('Not due yet','لم يحن موعد الاعتماد'),progress.upcoming)}</div></div>
      </section>
      <section className={SURFACE_CARD+' p-2 flex flex-wrap gap-2 items-center'}>
        {([{id:'students',en:'Student Attendance',ar:'حضور الطلاب'},{id:'instructors',en:'Instructor Check-in',ar:'حضور المحاضرين'},{id:'exceptions',en:'Exceptions ('+pendingExceptions+')',ar:'الاستثناءات ('+pendingExceptions+')'}] as const).map(v=><button key={v.id} type="button" aria-pressed={tab===v.id} onClick={()=>{setTab(v.id);setTool(null)}} className={'flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold '+(tab===v.id?'bg-[#14677A] text-white':'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800')}>{t(v.en,v.ar)}</button>)}
        <div className="sched-tools"><button type="button" className={BTN_SECONDARY} aria-expanded={toolsOpen} onClick={()=>setToolsOpen(!toolsOpen)}><MoreHorizontal size={16}/>{t('Tools','الأدوات')}</button>{toolsOpen&&<div className="sched-menu">{([{id:'matrix',en:'Attendance Matrix',ar:'كشف حضور الكامب'},{id:'history',en:'Student History',ar:'سجل الطالب'},{id:'absences',en:'Repeated Absences',ar:'الغياب المتكرر'},{id:'reports',en:'Attendance Reports / Export Excel',ar:'تقارير الحضور وتصدير إكسل'},{id:'revisions',en:'Revision History',ar:'سجل التعديلات'}] as const).map(v=><button key={v.id} onClick={()=>openTool(v.id)}>{t(v.en,v.ar)}</button>)}<button onClick={()=>{setTab('students');setStatusFilter('missing');setPeriod('all');setSearchQuery('');setTool(null);setToolsOpen(false)}}>{t('Missing Attendance','الحضور المتأخر')}</button><button onClick={()=>{setTab('instructors');setTool(null);setToolsOpen(false)}}>{t('Instructor Attendance','حضور المحاضرين')}</button><button onClick={()=>{setToolsOpen(false);window.print()}}><Printer size={15}/>{t('Print','طباعة')}</button></div>}</div>
      </section>
      {tool&&<section className={SURFACE_CARD+' p-4 space-y-3'} aria-label={t('Attendance tools','أدوات الحضور')}><div className="flex justify-between gap-2 items-center"><h2 className="font-bold">{tool==='matrix'?t('Attendance Matrix','كشف حضور الكامب'):tool==='history'?t('Student History','سجل الطالب'):tool==='absences'?t('Repeated Absences','الغياب المتكرر'):tool==='revisions'?t('Revision History','سجل التعديلات'):t('Attendance Reports','تقارير الحضور')}</h2><button className={BTN_SECONDARY} onClick={()=>setTool(null)}>{t('Close','إغلاق')}</button></div>
        {tool!=='revisions'&&<div className="flex flex-wrap gap-2"><select className={SELECT_CLASS} aria-label={t('Report group','مجموعة التقرير')} value={groupFilter} onChange={e=>{setGroupFilter(e.target.value);setStudentId('')}}><option value="all">{t('All groups','كل المجموعات')}</option>{campGroups.map(g=><option key={g.id} value={g.id}>{groupName(g.id)}</option>)}</select>{tool!=='reports'&&<input className={INPUT_CLASS} aria-label={t('Search students','بحث الطلاب')} placeholder={t('Student name or code','اسم الطالب أو الكود')} value={studentQuery} onChange={e=>{setStudentQuery(e.target.value);setStudentId('')}}/>}{tool==='absences'&&<label>{t('Minimum absent days','الحد الأدنى للغياب')}<input type="number" min={1} max={activeCamp.durationDays} className={INPUT_CLASS} value={absenceThreshold} onChange={e=>setAbsenceThreshold(Math.max(1,Number(e.target.value)||1))}/></label>}</div>}
        {tool==='reports'&&<div className="space-y-2"><p className="text-sm text-slate-500">{t('Day export uses the loaded finalized daily snapshot. Camp export fetches a fresh server report.','تصدير اليوم من البيانات المعتمدة المحملة. تقرير الكامب يجلب أحدث بيانات السيرفر.')}</p><div className="flex flex-wrap gap-2"><button className={BTN_SECONDARY} onClick={exportDay}><Download size={15}/>{t('Export selected day','تصدير اليوم')}</button><button className={BTN_PRIMARY} disabled={isBusy||!isSupabaseMode} onClick={exportCamp}><Download size={15}/>{t('Export camp / group','تصدير الكامب أو المجموعة')}</button></div></div>}
        {(tool==='matrix'||tool==='absences'||tool==='history')&&<><p className="text-xs text-slate-500">{t('Finalized daily records · P present · L late · A absent · E excused · Pending unfinalized · — not applicable','الحضور اليومي المعتمد · P حاضر · L متأخر · A غائب · E بعذر · Pending غير معتمد · — غير منطبق')}</p>{tool==='history'&&<select className={SELECT_CLASS} aria-label={t('Select student','اختر الطالب')} value={studentId} onChange={e=>setStudentId(e.target.value)}><option value="">{t('Select a student','اختر طالباً')}</option>{toolRows.map(r=><option key={r.studentId} value={r.studentId}>{r.fullName} · {r.studentCode}</option>)}</select>}
        <div className="overflow-x-auto"><table className="w-full text-xs border-collapse"><thead><tr className="bg-slate-50 dark:bg-slate-800"><th className="p-2 text-start">{t('Student','الطالب')}</th>{Array.from({length:activeCamp.durationDays},(_,i)=><th key={i} className="p-2">D{i+1}</th>)}<th className="p-2">{t('Rate','النسبة')}</th></tr></thead><tbody>{toolRows.filter(r=>tool!=='history'||r.studentId===studentId).map(r=><tr key={r.studentId} className="border-t border-slate-200 dark:border-slate-700"><td className="p-2 min-w-[160px]"><button className="text-start font-semibold" onClick={()=>{setStudentId(r.studentId);setTool('history')}}>{r.fullName}</button><div className="text-slate-500">{r.studentCode} · {groupName(r.homeGroupId)}</div></td>{r.days.map((d,i)=><td key={i} className="p-1 text-center"><StatusBadge tone={markTone(d)}>{d}</StatusBadge></td>)}<td className="p-2 text-center font-semibold">{r.eligibleFinalDays?Math.round(r.presentDays/r.eligibleFinalDays*100)+'%':'—'}</td></tr>)}</tbody></table></div>{tool==='history'&&studentId&&<div className="space-y-2"><h3 className="font-semibold">{t('Recorded lecture history','سجل المحاضرات الفعلي')}</h3>{allCampSheets.filter(sh=>sh.records.some(r=>r.studentId===studentId)).sort((a,b)=>a.campDay-b.campDay||a.periodNumber-b.periodNumber).map(sh=>{const l=campLectures.find(l=>l.id===sh.lectureId),r=sh.records.find(r=>r.studentId===studentId)!;return <div key={sh.id} className={SURFACE_SUBTLE+' p-2 flex flex-wrap gap-2 justify-between text-xs'}><span>Day {sh.campDay} · P{sh.periodNumber} · {l?.topic} · {groupName(r.attendedGroupId)}</span><span>{r.isCrossGroup?t('Visitor','زائر'):''} · {r.mark} · {isFinalAttendance(sh)?t('Finalized','معتمد'):t('Draft','مسودة')}</span></div>})}</div>}<button className={BTN_SECONDARY} disabled={isBusy||!isSupabaseMode} onClick={exportCamp}><Download size={15}/>{t('Export full camp / group workbook','تصدير كشف الكامب أو المجموعة')}</button></>}
        {tool==='revisions'&&<div className="space-y-2"><p className="text-xs text-slate-500">{t('Recent attendance and check-in audit entries (loaded snapshot).','أحدث سجلات تدقيق الحضور والوصول من البيانات المحملة.')}</p>{auditLogs.filter(log=>log.campId===activeCamp.id&&/attendance|checkin/i.test(log.entityType+' '+log.action)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(log=><div key={log.id} className={SURFACE_SUBTLE+' p-3 text-xs space-y-1'}><strong>{log.action} · {log.actorName}</strong><p>{log.createdAt}</p><p>{log.reason}</p><details><summary>{t('Before / after','قبل / بعد')}</summary><p className="break-all">{log.previousValue}</p><p className="break-all">{log.newValue}</p></details></div>)}</div>}
      </section>}
      {!campAllowsFinalAttendance && (
        <div role="status" className="flex items-start gap-2.5 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/20 p-3.5 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
          <Clock className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{t('The camp is not Active. Final submission is disabled. Local Instructor drafts might not appear in this server view.',
            'المعسكر غير مفعل؛ الاعتماد النهائي غير متاح. مسودات المحاضر المحلية ممكن متظهرش في عرض السيرفر ده.')}</span>
        </div>
      )}

      {/* Check-in Exception Reviews */}
      {tab==='exceptions'&&campExceptions.length===0&&<EmptyState icon={ShieldCheck} title={t('No exceptions for this day','لا توجد استثناءات لهذا اليوم')}/>}
      {tab==='exceptions'&&campExceptions.length > 0 && (
        <section className={`${SURFACE_CARD} p-5 space-y-4`}>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#355F82]" />
            <span>{t('Check-in Exceptions Queue', 'مراجعة استثناءات تسجيل الوصول')}</span>
          </h2>
          <div className="space-y-3 text-xs">
            {campExceptions.map((ex) => {
              const inst = instructors.find((i) => i.id === ex.instructorId);
              const chk = campCheckins.find((c) => c.id === ex.checkinId);
              const badgeTone =
                ex.status === RequestStatus.APPROVED
                  ? 'success'
                  : ex.status === RequestStatus.REJECTED
                  ? 'danger'
                  : 'warning';
              const badgeText =
                ex.status === RequestStatus.APPROVED
                  ? t('Approved', 'معتمد')
                  : ex.status === RequestStatus.REJECTED
                  ? t('Rejected', 'مرفوض')
                  : t('Pending Review', 'قيد المراجعة');
              return (
                <div key={ex.id} className={`${SURFACE_SUBTLE} p-4 space-y-3`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">
                        {inst ? t(inst.fullNameEn, inst.fullNameAr) : ex.instructorId} ·{' '}
                        <span className="font-mono">{t(`Day ${ex.campDay}`, `اليوم ${ex.campDay}`)}</span>
                      </p>
                      <p className="text-slate-600 dark:text-[#A0A5AA] mt-0.5">{ex.reason}</p>
                      {chk && (
                        <p className="font-mono text-slate-500 mt-0.5">
                          {chk.distanceFromVenueMeters}m · +{chk.minutesAfterFirstLecture}m · {chk.selfieSizeKb}KB
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {chk?.selfieStoragePath && !chk.selfieDeletedAfterArchive && (
                        <button
                          type="button"
                          onClick={() => handleLoadSelfie(chk.id, chk.selfieStoragePath!)}
                          className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-[#42474D] bg-white dark:bg-[#1D2023] font-medium cursor-pointer"
                        >
                          {t('View Selfie', 'عرض الصورة')}
                        </button>
                      )}
                      <StatusBadge tone={badgeTone}>{badgeText}</StatusBadge>
                    </div>
                  </div>

                  {chk && selfiePreviews[chk.id] && (
                    <img
                      src={selfiePreviews[chk.id]}
                      alt={t('Check-in selfie preview', 'صورة التحقق')}
                      className="w-36 h-36 object-cover rounded-lg border border-slate-200 dark:border-[#353A3F]"
                    />
                  )}

                  {ex.status === RequestStatus.PENDING && (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        placeholder={t('Required review note...', 'ملاحظة المراجعة الإلزامية...')}
                        value={reviewNotes[ex.id] || ''}
                        onChange={(e) =>
                          setReviewNotes((prev) => ({ ...prev, [ex.id]: e.target.value }))
                        }
                        className={`${INPUT_CLASS} flex-1 min-w-[200px]`}
                      />
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleExceptionDecision(ex.id, 'approved')}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer"
                      >
                        {t('Approve Exception', 'اعتماد الاستثناء')}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleExceptionDecision(ex.id, 'rejected')}
                        className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 font-semibold cursor-pointer"
                      >
                        {t('Reject', 'رفض')}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {tab==='instructors'&&<section className={SURFACE_CARD+' p-4 space-y-3'}><h2 className="font-bold">{t('Instructor Check-in','حضور المحاضرين')}</h2><div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{stat(t('Expected instructors','المحاضرون المتوقعون'),expectedIds.size)}{stat(t('Check-ins recorded','تم تسجيل الوصول'),new Set(campCheckins.map(c=>c.instructorId)).size)}{stat(t('Missing check-ins','وصول غير مسجل بعد الموعد'),[...expectedIds].filter(missingCheckin).length,'text-rose-600')}{stat(t('Backup instructors','محاضرون مساعدون'),backupIds.size)}</div>{checkinIds.length===0&&<EmptyState icon={Users} title={t('No instructor assignments for this day','لا يوجد محاضرون في هذا اليوم')}/>}
      {checkinIds.map(id=>{const c=campCheckins.find(c=>c.instructorId===id),status=c?checkinStatusDisplay(c.status,t):null;return <article key={id} className={SURFACE_SUBTLE+' p-3 space-y-2'}><div className="flex flex-wrap justify-between gap-2 items-center"><div className="flex items-center gap-2"><UserRound size={20}/><div><strong>{instructorName(id)}</strong><p className="text-xs text-slate-500">{backupIds.has(id)?t('Backup assignment','تكليف مساعد'):t('Instructor','محاضر')}</p></div></div><StatusBadge tone={status?.tone||(missingCheckin(id)?'danger':'neutral')}>{status?.label||(missingCheckin(id)?t('Missing check-in','وصول غير مسجل'):t('Not recorded yet','لم يسجل بعد'))}</StatusBadge></div>{c&&<><p className="text-xs"><span dir="ltr">{new Date(c.serverTimestamp).toLocaleString('en-GB',{timeZone:'Africa/Cairo',hour:'numeric',minute:'2-digit',hour12:true})}</span> · {t('Late minutes','دقائق التأخير')}: {c.minutesAfterFirstLecture} · {t('Distance','المسافة')}: {c.distanceFromVenueMeters} m · {t('GPS accuracy','دقة الموقع')}: {c.gpsAccuracyMeters} m · {c.withinGeofence?t('Within geofence','داخل النطاق'):t('Outside geofence','خارج النطاق')}</p>{c.selfieStoragePath&&!c.selfieDeletedAfterArchive&&<button className={BTN_SECONDARY} onClick={()=>handleLoadSelfie(c.id,c.selfieStoragePath!)}>{t('View Selfie','عرض الصورة')}</button>}{selfiePreviews[c.id]&&<img src={selfiePreviews[c.id]} alt={t('Check-in selfie preview','صورة التحقق')} className="w-36 h-36 object-cover rounded-lg"/>}</>}</article>})}</section>}
      {tab==='students'&&<>
      {/* Search and filter are visually separate from the lecture cards. */}
      <section aria-label={t('Find lecture attendance sheets', 'البحث في كشوف الحضور')}
        className="rounded-2xl border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] p-4 sm:p-5 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div className="w-full lg:max-w-md space-y-2">
            <label htmlFor="admin-attendance-search" className="text-sm font-bold text-slate-900 dark:text-white">{t('Find a lecture', 'البحث عن محاضرة')}</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="admin-attendance-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('Topic, group or instructor', 'عنوان المحاضرة أو الجروب أو المحاضر')}
                aria-label={t('Search attendance sheets', 'بحث كشوف الحضور')}
                className={`${INPUT_CLASS} ps-9 min-h-[44px]`}
              />
            </div>
          </div>
          <label className="text-xs font-semibold">{t('Period','الفترة')}<select className={SELECT_CLASS} value={period} onChange={e=>setPeriod(e.target.value)}><option value="all">{t('All periods','كل الفترات')}</option>{activeCamp.settings.periodSlots.map(p=><option key={p.period} value={p.period}>P{p.period} · {formatScheduleTime(p.start)} – {formatScheduleTime(p.end)}</option>)}</select></label>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-600 dark:text-[#C0C5C9]">{t('Sheet status', 'حالة الكشف')}</p>
            <div role="group" aria-label={t('Filter attendance sheets by status', 'فلترة كشوف الحضور حسب الحالة')} className="flex flex-wrap gap-2">
              {([
                { id: 'all', en: 'All', ar: 'الكل', count: dayLectures.length },
                { id: 'synced', en: 'Finalized', ar: 'معتمد', count: finalizedSheetCount },
                { id: 'draft', en: 'Drafts', ar: 'مسودات', count: draftSheetCount },
                { id: 'missing', en: 'Overdue', ar: 'متأخر', count: progress.overdueIds.size },
              ] as const).map(tab => (
                <button key={tab.id} type="button" aria-pressed={statusFilter === tab.id}
                  onClick={() => setStatusFilter(tab.id)}
                  className={`min-h-[40px] px-3.5 py-2 rounded-xl border inline-flex items-center gap-2 text-xs font-semibold transition-colors ${statusFilter === tab.id
                    ? 'bg-[#355F82] border-[#355F82] text-white'
                    : 'bg-white dark:bg-[#25292D] border-slate-200 dark:border-[#42474D] text-slate-700 dark:text-[#DEE1E4]'}`}>
                  <span>{t(tab.en, tab.ar)}</span>
                  <span className={`rounded-full px-1.5 py-0.5 min-w-5 text-center tabular-nums ${statusFilter === tab.id
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-100 dark:bg-slate-700'}`}>{tab.count}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <p role="status" className="text-xs text-slate-500 dark:text-[#A0A5AA]">
          {t(`Showing ${filteredLectures.length} of ${dayLectures.length} sessions`,
            `عرض ${filteredLectures.length} من ${dayLectures.length} محاضرة`)}
        </p>
      </section>

      {/* Condensed lecture cards; server-only counts are not misrepresented as final. */}
      <section aria-label={t('Lecture attendance sheets', 'كشوف حضور المحاضرات')} className="space-y-3">
        {filteredLectures.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 dark:border-[#42474D] bg-white dark:bg-[#1D2023] p-7 text-center space-y-3">
            <p className="text-sm font-medium text-slate-600 dark:text-[#C0C5C9]">
              {t('No lecture sheets match your search.', 'مفيش كشوف محاضرات مطابقة للبحث.')}
            </p>
            <button type="button" onClick={() => { setSearchQuery(''); setStatusFilter('all'); setPeriod('all'); }}
              className="text-sm font-semibold text-[#355F82] dark:text-[#88A9CC] underline underline-offset-2">
              {t('Clear filters', 'مسح الفلاتر')}
            </button>
          </div>
        ) : filteredLectures.map((lecture,index) => {
          const lec=lecture, sheet=sheetFor(lec.id);
          const periodHeader=index===0||filteredLectures[index-1].periodNumber!==lec.periodNumber?<div className="flex flex-wrap items-center gap-3 pt-2"><h3 className="font-bold text-teal-700 dark:text-teal-300">{t('Period '+lec.periodNumber,'الفترة '+lec.periodNumber)}</h3><span dir="ltr" className="text-xs text-slate-500">{formatScheduleTime(lec.startTime)} – {formatScheduleTime(lec.endTime)}</span></div>:null;
          if(!sheet)return <React.Fragment key={lec.id}>{periodHeader}<article className={SURFACE_CARD+' p-4 flex flex-wrap justify-between gap-3'}><div><strong>{groupName(lec.groupId)} · {lec.topic}</strong><p className="text-xs text-slate-500">{instructorName(lec.substituteInstructorId||lec.instructorId)} · {t('No attendance sheet saved','لا يوجد كشف محفوظ')}</p></div><div className="flex items-center gap-2"><StatusBadge tone={progress.overdueIds.has(lec.id)?'warning':'neutral'}>{progress.overdueIds.has(lec.id)?t('Overdue','متأخر'):t('Pending','غير معتمد')}</StatusBadge>{isSupabaseMode&&progress.overdueIds.has(lec.id)&&<button className={BTN_SECONDARY} disabled={isBusy} onClick={()=>remind(lec)}><Bell size={15}/>{t('Send Reminder','إرسال تذكير')}</button>}</div></article></React.Fragment>;
          const inst = instructors.find(i => i.id === (lec.substituteInstructorId||lec.instructorId));
          const grp = groups.find(g => g.id === lec?.groupId);
          const chk = campCheckins.find(c =>
            c.instructorId === (lec.substituteInstructorId||lec.instructorId) && c.campDay === sheet.campDay
          );
          const chkDisplay = chk ? checkinStatusDisplay(chk.status, t) : null;
          const isExpanded = expandedSheetId === sheet.id;
          const isFinalized = sheet.status === AttendanceSheetStatus.SUBMITTED ||
            sheet.status === AttendanceSheetStatus.LOCKED;
          const canSubmitSheet = campAllowsFinalAttendance && Boolean(lec && lec.lectureDate <= cairoToday);
          const presentCount = sheet.records.filter(r => r.mark === AttendanceMark.PRESENT).length;
          const lateCount = sheet.records.filter(r => r.mark === AttendanceMark.LATE).length;
          const absentCount = sheet.records.filter(r => r.mark === AttendanceMark.ABSENT).length;
          const unmarkedCount = sheet.records.filter(r => r.mark === 'unmarked').length;
          const excusedCount = sheet.records.filter(r => r.mark === AttendanceMark.EXCUSED).length;
          const hasSavedRows = sheet.records.length > 0;
          const savedIds=new Set(sheet.records.map(r=>r.studentId));
          const expectedRoster=students.filter(st=>st.campId===activeCamp.id&&studentEligibleForCampDay(st,selectedDay)&&resolveStudentOriginGroupForDay({student:st,transfers:studentTransfers,campDay:selectedDay})===lec.groupId);
          const missingRoster=expectedRoster.filter(st=>!savedIds.has(st.id));
          const matchingMissing=missingRoster.filter(st=>!rosterQuery.trim()||(st.fullName+' '+st.studentCode).toLowerCase().includes(rosterQuery.trim().toLowerCase()));
          const rosterCount=new Set([...expectedRoster.map(st=>st.id),...savedIds]).size;
          const officialLabel=isFinalized?t('Finalized','معتمد'):progress.overdueIds.has(lec.id)?t('Overdue draft','مسودة متأخرة'):t('Server draft','مسودة السيرفر');
          return (
            <React.Fragment key={sheet.id}>{periodHeader}<article
              aria-label={t(`Attendance sheet: ${lec?.topic || sheet.lectureId}`,
                `كشف حضور: ${lec?.topic || sheet.lectureId}`)}
              className="overflow-hidden rounded-2xl border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] shadow-sm"
            >
              <div className="p-3 sm:p-4 space-y-3">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                      <span className="rounded-md bg-blue-50 dark:bg-[#293747]/40 px-2.5 py-1 text-blue-700 dark:text-blue-300">
                        {t(`Day ${sheet.campDay} · Period ${sheet.periodNumber}`,
                           `اليوم ${sheet.campDay} · الفترة ${sheet.periodNumber}`)}
                      </span>
                      <span className="rounded-md bg-slate-100 dark:bg-[#25292D] px-2.5 py-1 text-slate-600 dark:text-[#C0C5C9]">
                        {grp ? t(grp.nameEn,grp.nameAr) : t('Unknown group', 'جروب غير معروف')}
                      </span>
                    </div>
                    <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white break-words">
                      {lec?.topic || sheet.lectureId}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-[#A0A5AA]">
                      {inst ? t(inst.fullNameEn, inst.fullNameAr) : sheet.instructorId}
                      {lec && <span className="ms-3" dir="ltr">{formatScheduleTime(lec.startTime)} – {formatScheduleTime(lec.endTime)}</span>}
                      <span className="ms-3">{rosterCount} {t('students in roster','طالب في الكشف')}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <StatusBadge tone={isFinalized ? 'success' : 'warning'}>
                      {officialLabel}
                    </StatusBadge>
                    {isSupabaseMode&&progress.overdueIds.has(lec.id)&&<button className={BTN_SECONDARY} disabled={isBusy} onClick={()=>remind(lec)}><Bell size={15}/>{t('Send Reminder','إرسال تذكير')}</button>}
                    <button type="button"
                      aria-expanded={isExpanded}
                      aria-controls={`admin-roster-${sheet.id}`}
                      onClick={() => {setExpandedSheetId(isExpanded ? null : sheet.id);setRosterQuery('')}}
                      className="inline-flex items-center gap-2 min-h-[40px] rounded-xl border border-slate-200 dark:border-[#42474D] px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-[#DEE1E4] bg-white dark:bg-[#25292D] hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <Eye className="w-4 h-4" />
                      <span>{isExpanded ? t('Close details', 'إغلاق التفاصيل') : t('View Attendance', 'عرض الحضور')}</span>
                    </button>
                  </div>
                </div>

                {hasSavedRows ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
                    {[
                      { label: t('Present', 'حاضر'), count: presentCount, color: 'text-emerald-700 dark:text-emerald-300' },
                      { label: t('Late', 'متأخر'), count: lateCount, color: 'text-amber-700 dark:text-amber-300' },
                      { label: t('Absent', 'غائب'), count: absentCount, color: 'text-rose-700 dark:text-rose-300' },
                      { label: t('Unmarked', 'غير محدد'), count: unmarkedCount+missingRoster.length, color: 'text-slate-700 dark:text-[#C0C5C9]' },
                      { label: t('Excused', 'بعذر'), count: excusedCount, color: 'text-violet-700 dark:text-violet-300' },
                    ].map(stat => (
                      <div key={stat.label} className="rounded-xl bg-slate-50 dark:bg-[#121416]/40 border border-slate-100 dark:border-[#353A3F] px-3 py-1.5">
                        <p className="text-[11px] font-medium text-slate-500 dark:text-[#A0A5AA]">{stat.label}</p>
                        <p className={`text-xl font-bold tabular-nums mt-0.5 ${stat.color}`}>{stat.count}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 dark:border-[#42474D] bg-slate-50/70 dark:bg-[#121416]/30 px-3.5 py-3 flex flex-wrap items-center gap-2">
                    <ClipboardCheck className="w-4 h-4 shrink-0 text-slate-400" />
                    <span className="text-xs font-medium text-slate-600 dark:text-[#C0C5C9]">
                      {t('No server-saved marks yet — this does not mean all students are absent.',
                        'مفيش حضور محفوظ للطلاب على السيرفر لسه — ده مش معناه إنهم غايبين.')}
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 dark:border-[#353A3F] pt-3 text-xs">
                  <span className="text-slate-500 dark:text-[#A0A5AA]">
                    {t('Instructor check-in', 'وصول المحاضر')}:
                  </span>
                  {chk && chkDisplay
                    ? <StatusBadge tone={chkDisplay.tone}>{chkDisplay.label}</StatusBadge>
                    : <span className="font-semibold text-slate-500 dark:text-[#A0A5AA]">{t('Not recorded', 'لم يُسجل')}</span>}
                  {!isFinalized && (
                    <span className="ms-auto text-[11px] text-slate-500 dark:text-[#A0A5AA]">
                      {t('Draft · Not final', 'مسودة · ليست نهائية')}
                    </span>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div id={`admin-roster-${sheet.id}`}
                  className="border-t border-slate-200 dark:border-[#353A3F] bg-slate-50/50 dark:bg-[#121416]/20 p-4 sm:p-5 space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                        {t('Student attendance records', 'سجلات حضور الطلاب')}
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-[#A0A5AA] mt-1">
                        {t(`${sheet.records.length} rows saved on server`,
                          `${sheet.records.length} سجل محفوظ على السيرفر`)}
                      </p>
                    </div>
                    {!isFinalized && canSubmitSheet && (
                      <button type="button" disabled={isBusy}
                        onClick={() => handleForceSync(sheet.lectureId)}
                        className={`${BTN_PRIMARY} min-h-[42px]`}>
                        {t('Submit & Sync Now', 'اعتماد ومزامنة الآن')}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 attendance-no-print"><input className={INPUT_CLASS} aria-label={t('Search roster','بحث الكشف')} placeholder={t('Student name or code','اسم الطالب أو الكود')} value={rosterQuery} onChange={e=>setRosterQuery(e.target.value)}/><button className={BTN_SECONDARY} onClick={()=>exportRows('Attendance-Day-'+selectedDay+'-P'+sheet.periodNumber+'-'+(isFinalized?'finalized':'draft'),[['Student code','Student','Mark','Sheet status','Attended group','Visitor'],...sheet.records.map(r=>[r.studentCode,r.studentName,r.mark,isFinalized?'Finalized':'Draft',groupName(r.attendedGroupId),r.isCrossGroup?'Yes':'No']),...missingRoster.map(st=>[st.studentCode,st.fullName,'Not recorded',isFinalized?'Finalized':'Draft',groupName(lec.groupId),'No'])])}><Download size={15}/>{t('Export roster','تصدير الكشف')}</button></div>
                  {hasSavedRows ? (
                    <>
                      <div className="rounded-xl border border-slate-200 dark:border-[#42474D] bg-white dark:bg-[#1D2023] p-3.5 space-y-2">
                        <label htmlFor={`corr-note-${sheet.id}`}
                          className="block text-xs font-semibold text-slate-700 dark:text-[#DEE1E4]">
                          {t('Reason for audited corrections', 'سبب التعديل المسجل في التدقيق')}
                        </label>
                        <input id={`corr-note-${sheet.id}`} type="text"
                          value={correctionNotes[sheet.id] ?? 'Verified by Admin during roster review'}
                          onChange={e => setCorrectionNotes(prev => ({ ...prev, [sheet.id]: e.target.value }))}
                          placeholder={t('Reason for correcting attendance', 'سبب تعديل حضور الطالب')}
                          className={`${INPUT_CLASS} min-h-[42px]`}
                        />
                        <p className="text-[11px] text-slate-500 dark:text-[#A0A5AA]">
                          {t('This reason is logged whenever a student mark is changed.',
                            'السبب ده بيتسجل مع أي تعديل لحضور طالب.')}
                        </p>
                      </div>
                      <div className="space-y-2">
                        {sheet.records.filter(rec=>!rosterQuery.trim()||(rec.studentName+' '+rec.studentCode).toLowerCase().includes(rosterQuery.trim().toLowerCase())).map(rec => (
                          <div key={rec.studentId}
                            className="rounded-xl border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] p-3.5 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900 dark:text-white break-words">{rec.studentName}</p>
                              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500 dark:text-[#A0A5AA]">
                                <span className="font-mono">{rec.studentCode}</span>
                                {rec.isCrossGroup && <StatusBadge tone="info">{t('Visitor', 'زائر')}</StatusBadge>}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full md:w-[340px] shrink-0">
                              {([
                                { mk: AttendanceMark.PRESENT, en: 'Present', ar: 'حاضر', active: 'bg-emerald-600 text-white border-emerald-600' },
                                { mk: AttendanceMark.LATE, en: 'Late', ar: 'متأخر', active: 'bg-amber-600 text-white border-amber-600' },
                                { mk: AttendanceMark.ABSENT, en: 'Absent', ar: 'غائب', active: 'bg-rose-600 text-white border-rose-600' },
                                { mk: AttendanceMark.EXCUSED, en: 'Excused', ar: 'بعذر', active: 'bg-violet-600 text-white border-violet-600' },
                              ] as const).map(opt => (
                                <button key={opt.mk} type="button"
                                  aria-pressed={rec.mark === opt.mk}
                                  disabled={isBusy}
                                  onClick={() => handleCorrectMark(sheet.id, sheet.lectureId, rec.studentId, opt.mk)}
                                  className={`min-h-[40px] rounded-lg border px-2 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${rec.mark === opt.mk
                                    ? opt.active
                                    : 'border-slate-200 dark:border-[#42474D] text-slate-700 dark:text-[#DEE1E4] bg-white dark:bg-[#25292D] hover:bg-slate-50'}`}>
                                  {t(opt.en, opt.ar)}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="rounded-xl bg-white dark:bg-[#1D2023] border border-slate-200 dark:border-[#353A3F] p-4 text-xs leading-relaxed text-slate-600 dark:text-[#C0C5C9]">
                      {t('This draft has no student rows saved on the server. Instructor offline edits are not visible until synchronized. Do not interpret empty records as absences.',
                        'المسودة مفيهاش سجلات طلاب محفوظة على السيرفر. تعديلات المحاضر المحلية مش بتظهر قبل المزامنة. متعتبرش النتيجة دي غياب.')}
                    </p>
                  )}
                  {matchingMissing.length>0&&<div className="space-y-2"><h4 className="text-sm font-semibold">{t('Roster students without a server-saved row','طلاب الكشف دون سجل محفوظ')}</h4>{matchingMissing.map(st=><div key={st.id} className={SURFACE_SUBTLE+' p-3 flex justify-between gap-2 text-sm'}><div><strong>{st.fullName}</strong><p className="text-xs text-slate-500">{st.studentCode}</p></div><StatusBadge tone="neutral">{t('Not recorded','لم يسجل')}</StatusBadge></div>)}</div>}
                  {!isFinalized && canSubmitSheet && (
                    <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                      {t('Review any Instructor offline drafts before final submission. Unmarked students become absent only after finalization.',
                        'راجع مسودات المحاضر المحلية قبل الاعتماد. الطلاب غير المحددين بيتحسبوا غياب بعد الاعتماد النهائي فقط.')}
                    </p>
                  )}
                </div>
              )}
            </article></React.Fragment>
          );
        })}
      </section></>}

    </div>
  );
};
