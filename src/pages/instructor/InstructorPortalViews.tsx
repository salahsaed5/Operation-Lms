import { generateEntityCode } from '../../domain/generateEntityCode';
import React, { useEffect, useMemo, useState } from 'react';
import {
  MapPinCheck,
  ClipboardCheck,
  CheckCircle2,
  Camera,
  WifiOff,
  RefreshCw,
  Send,
  ExternalLink,
  UserPlus,
  Search,
  CalendarClock,
  UserCircle,
  ArrowUpRight,
  ArrowLeft,
  Clock3,
  Users,
  MapPin,
  Play,
  CalendarDays,
  CalendarCheck,
  ArrowRight,
  AlertCircle,
  IdCard, Mail, ShieldCheck, Layers, GraduationCap, Star, MessageSquare, Hourglass, ChartNoAxesCombined, AtSign, Phone, Laptop,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { sessionState, sessionCounts, sessionLabel, cairoClock } from '../../domain/sessionLifecycle';
import { calculateCampDayDate, calculateHaversineDistanceMeters, resolveStudentOriginGroupForDay } from '../../domain/businessRules';
import { classifyGpsVerification, requiredGpsAccuracyMeters } from '../../domain/checkinGpsQuality';
import { studentEligibleForCampDay } from '../../domain/studentJoinDay';
import { studentsForSelectedLecture } from '../../domain/instructorLectureRoster';
import { compressSelfieUnderLimit, getSignedSelfieUrl, searchVisitingStudentsInDb, type VisitingStudentLookupResult } from '../../services/citsRepository';
import {
  AttendanceMark,
  type Lecture,
  AttendanceRecordItem,
  AttendanceSheetStatus,
  CheckinStatus,
  CampStatus,
  OfflineSyncState,
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

function instructorCheckinBadge(
  status: CheckinStatus,
  t: (en: string, ar: string) => string
): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  switch (status) {
    case CheckinStatus.VERIFIED:
      return { label: t('Checked In & Verified', 'تم الوصول والتوثيق'), tone: 'success' };
    case CheckinStatus.EXCEPTION_APPROVED:
      return { label: t('Exception Approved', 'استثناء معتمد'), tone: 'success' };
    case CheckinStatus.LATE_FIRST_LECTURE:
      return { label: t('Late Arrival (>=60m)', 'وصول متأخر (+60د)'), tone: 'warning' };
    case CheckinStatus.EXCEPTION_PENDING:
      return { label: t('Exception Pending', 'بانتظار مراجعة الإدارة'), tone: 'warning' };
    case CheckinStatus.OUTSIDE_GEOFENCE:
      return { label: t('Outside Geofence', 'خارج النطاق الجغرافي'), tone: 'danger' };
    case CheckinStatus.EXCEPTION_REJECTED:
      return { label: t('Exception Rejected', 'تم رفض الاستثناء'), tone: 'danger' };
    default:
      return { label: t('Recorded', 'مسجل'), tone: 'neutral' };
  }
}

/** Compare all teaching dates in the Camp's Cairo timezone, never browser local time. */
const cairoTodayIso = (): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',
  }).formatToParts(new Date());
  const part = (type:string) => parts.find(p=>p.type===type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

function useSessionClock(){
  const [clock,setClock]=useState(()=>cairoClock(new Date()));
  useEffect(()=>{const tick=window.setInterval(()=>setClock(cairoClock(new Date())),1000);return ()=>window.clearInterval(tick);},[]);
  return clock;
}

const SessionSummary:React.FC<{todayOnly:boolean}> = ({todayOnly})=>{
  const {activeCamp,auth,instructors,lectures,groups,rooms,students,studentTransfers,attendanceSheets,entitlements,isSandboxMode,openInstructorAttendance,setInstructorRoute,lang,t}=useApp();
  const clock=useSessionClock();
  const [filter,setFilter]=useState('all');
  const [query,setQuery]=useState('');
  const inst=instructors.find(i=>i.id===auth.activeInstructorId);
  if(!activeCamp||!inst)return <EmptyState icon={CalendarClock} title={t('No active camp assignment','لا يوجد كامب مسند لك')} />;
  const all=lectures.filter(l=>l.campId===activeCamp.id&&(l.substituteInstructorId||l.instructorId)===inst.id&&l.status!=='cancelled');
  const today=isSandboxMode?calculateCampDayDate(activeCamp.startDate,activeCamp.currentCampDay,activeCamp.operatingWeekdays):clock.date;
  const counts=sessionCounts(all,attendanceSheets,entitlements,inst.id);
  const stateOf=(l:Lecture)=>sessionState(l,attendanceSheets.find(s=>s.lectureId===l.id),clock,activeCamp.status===CampStatus.ACTIVE);
  const running=all.filter(l=>stateOf(l)==='running').length;
  const pending=all.filter(l=>['upcoming','ready','missed'].includes(stateOf(l))).length;
  const missed=all.filter(l=>stateOf(l)==='missed').length;
  const todayCount=all.filter(l=>l.lectureDate===today).length;
  const percent=counts.assigned?Math.round(counts.counted/counts.assigned*100):0;
  const term=query.trim().toLowerCase();
  const shown=all.filter(l=>(!todayOnly||l.lectureDate===today)&&(todayOnly||filter==='all'||(filter==='pending'?['upcoming','ready','missed'].includes(stateOf(l)):stateOf(l)===filter))&&
    (!term||[l.topic,groups.find(g=>g.id===l.groupId)?.code,groups.find(g=>g.id===l.groupId)?.nameAr,groups.find(g=>g.id===l.groupId)?.nameEn].some(x=>x?.toLowerCase().includes(term)))).sort((a,b)=>a.lectureDate.localeCompare(b.lectureDate)||a.startTime.localeCompare(b.startTime));
  const dates=Array.from(new Set(shown.map(l=>l.lectureDate)));
  const formatDate=(d:string)=>new Intl.DateTimeFormat(lang==='ar'?'ar-EG':'en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'));
  const agendaTime=(time:string)=>{const [h,m]=time.split(':').map(Number);return new Intl.DateTimeFormat(lang==='ar'?'ar-EG':'en-US',{hour:'numeric',minute:'2-digit',hour12:true,timeZone:'UTC'}).format(new Date(Date.UTC(2000,0,1,h,m)));};
  const filters=[{id:'all',en:'All sessions',ar:'كل المحاضرات',n:counts.assigned},{id:'running',en:'Running',ar:'جارية',n:running},{id:'pending',en:'Pending',ar:'معلقة',n:pending},{id:'finished',en:'Finished',ar:'منتهية',n:counts.finished},{id:'missed',en:'Missed',ar:'لم تبدأ',n:missed}];
  return <div className="space-y-4 sm:space-y-6 min-w-0">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-[11px] font-bold tracking-widest text-[#355F82] dark:text-[#88A9CC] uppercase">{t('Instructor workspace','مساحة عمل المحاضر')} · {activeCamp.code}</p>
      <h1 className="text-xl sm:text-3xl font-bold tracking-tight mt-1">{todayOnly?t("Today's Sessions","محاضرات اليوم"):t('My Sessions','محاضراتي')}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t(activeCamp.nameEn,activeCamp.nameAr)} · {formatDate(today)}</p></div>
    </header>
    {!todayOnly&&<section aria-label={t('Session progress','تقدم المحاضرات')} className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-3">
      <div className="rounded-2xl bg-[#203b53] dark:bg-[#203548] text-white p-4 sm:p-6 relative overflow-hidden">
        <div aria-hidden="true" className="absolute end-[-35px] top-[-65px] w-52 h-52 rounded-full border-[24px] border-white/5 pointer-events-none"/>
        <div className="relative space-y-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium text-slate-200">{t('Camp completion','إنجاز الكامب')}</p><p className="mt-2 text-4xl font-bold tabular-nums tracking-tight">{counts.counted}<span className="text-xl font-medium text-slate-300"> / {counts.assigned}</span></p><p className="mt-1 text-xs text-slate-200">{t('Counted sessions','محاضرات محتسبة')}</p></div><span className="rounded-xl bg-white/10 px-3 py-2 text-lg font-bold tabular-nums">{percent}%</span></div>
        <div role="progressbar" aria-label={t('Counted sessions progress','نسبة المحاضرات المحتسبة')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 rounded-full bg-white/15 overflow-hidden"><div className="h-full rounded-full bg-[#8dd3c5]" style={{width:percent+'%'}}/></div>
        <div className="flex justify-between gap-3 text-xs text-slate-200"><span>{t('Assigned','المسندة')}: {counts.assigned}</span><span>{t('Remaining','المتبقية')}: {counts.remaining}</span></div></div>
      </div>
      <div className={SURFACE_CARD+' rounded-2xl p-3 sm:p-5 grid grid-cols-2 gap-2 sm:gap-3'}>
        {[{label:t('Running','جارية'),n:running,Icon:Play,style:'text-blue-700 dark:text-blue-300'},{label:t('Pending','معلقة'),n:pending,Icon:Clock3,style:'text-amber-700 dark:text-amber-300'},{label:t('Finished','منتهية'),n:counts.finished,Icon:CheckCircle2,style:'text-emerald-700 dark:text-emerald-300'},{label:t('Today','اليوم'),n:todayCount,Icon:CalendarDays,style:'text-[#355F82] dark:text-[#88A9CC]'}].map(({label,n,Icon,style})=><div key={label} className="flex items-center gap-3 min-w-0 rounded-xl bg-slate-50 dark:bg-[#25292D] p-3"><Icon aria-hidden="true" className={'w-5 h-5 shrink-0 '+style}/><div className="min-w-0"><p className="text-xs text-slate-500 dark:text-slate-400">{label}</p><p className="text-xl font-bold tabular-nums">{n}</p></div></div>)}
      </div>
    </section>}
    <section aria-label={t('Session agenda','قائمة المحاضرات')} className={SURFACE_CARD+' instructor-agenda rounded-2xl overflow-hidden'}>
      <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-[#353A3F] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3 min-w-0"><CalendarCheck className="w-8 h-8 shrink-0 instructor-agenda-heading-icon" aria-hidden="true"/><div className="min-w-0"><h2 className="font-bold text-lg">{todayOnly?t('Your agenda','جدولك اليوم'):t('Session agenda','جدول المحاضرات')}</h2><p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{todayOnly?t(shown.length===1?'1 session scheduled for today':shown.length+' sessions scheduled for today',shown.length+' محاضرات مجدولة اليوم'):shown.length+' '+t('sessions shown','محاضرات معروضة')}</p></div></div>
          {todayOnly&&<button type="button" className="instructor-agenda-all" onClick={()=>setInstructorRoute('schedule')}>{t('All sessions','كل المحاضرات')} <ArrowRight className="w-4 h-4 rtl:rotate-180"/></button>}
          {!todayOnly&&<div className="relative w-full sm:w-72"><Search aria-hidden="true" className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"/><input type="search" aria-label={t('Search sessions','بحث المحاضرات')} placeholder={t('Search topic or group','ابحث بالموضوع أو الجروب')} value={query} onChange={e=>setQuery(e.target.value)} className={INPUT_CLASS+' ps-9 min-h-[44px]'}/></div>}</div>
        {!todayOnly&&<div role="group" aria-label={t('Filter sessions','تصفية المحاضرات')} className="flex flex-wrap gap-2">{filters.map(x=><button key={x.id} type="button" aria-pressed={filter===x.id} onClick={()=>setFilter(x.id)} className={'min-h-[40px] rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 '+(filter===x.id?'bg-[#355F82] text-white':'bg-slate-100 dark:bg-[#25292D] text-slate-600 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700')}>{t(x.en,x.ar)} <span className="ms-1 tabular-nums opacity-80">{x.n}</span></button>)}</div>}
      </div>
      {shown.length===0?<div className="instructor-agenda-empty-wrap">
        <div className="instructor-agenda-empty" data-agenda-empty>
          <div className="instructor-agenda-illustration" aria-hidden="true"><span/><CalendarDays className="relative w-11 h-11" strokeWidth={1.5}/></div>
          <h3 className="font-bold text-base">{todayOnly?t('No sessions scheduled for today','لا توجد محاضرات اليوم'):t('No matching sessions','لا توجد محاضرات مطابقة')}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">{todayOnly?t('When sessions are assigned, they will appear here. You can view your full camp schedule anytime.','ستظهر المحاضرات هنا عند إسنادها إليك. يمكنك عرض جدول الكامب بالكامل في أي وقت.'):t('Try a different search or clear the filters.','جرّب البحث بكلمة أخرى أو امسح التصفية.')}</p>
          <button type="button" className="instructor-agenda-empty-action" onClick={()=>{if(todayOnly)setInstructorRoute('schedule');else{setQuery('');setFilter('all');}}}>{todayOnly?t('View all sessions','عرض كل المحاضرات'):t('Clear filters','مسح التصفية')} <ArrowRight className="w-4 h-4 rtl:rotate-180"/></button>
        </div>
      </div>:dates.map(d=><div key={d}>
        {!todayOnly&&<div className="flex items-center gap-2 px-4 sm:px-6 py-3 bg-slate-50 dark:bg-[#25292D] border-b border-slate-100 dark:border-[#353A3F] text-xs font-semibold text-slate-600 dark:text-slate-300"><CalendarDays className="w-4 h-4"/><span>{formatDate(d)}</span>{d===today&&<StatusBadge tone="info">{t('Today','اليوم')}</StatusBadge>}</div>}
        <div className="instructor-agenda-list">{shown.filter(l=>l.lectureDate===d).map(l=>{
          const s=stateOf(l),label=sessionLabel(s),sheet=attendanceSheets.find(x=>x.lectureId===l.id),group=groups.find(g=>g.id===l.groupId),room=rooms.find(r=>r.id===l.roomId);
          const counted=entitlements.some(e=>e.lectureId===l.id&&e.instructorId===inst.id&&['eligible','approved'].includes(e.status));
          const present=sheet?.records.filter(r=>r.mark==='present'||r.mark==='late').length||0;
          const absent=sheet?.records.filter(r=>r.mark==='absent').length||0;
          const rosterCount=studentsForSelectedLecture({lecture:l,students,transfers:studentTransfers}).length;
          const StatusIcon=s==='finished'?CheckCircle2:s==='running'?Clock3:s==='ready'?Play:s==='missed'?AlertCircle:Hourglass;
          const statusText=s==='finished'?t('Completed','منتهية'):s==='running'?t('In progress','جارية'):t(label.en,label.ar);
          const actionText=s==='finished'?t('Review session','مراجعة المحاضرة'):s==='running'?t('Continue session','استكمال المحاضرة'):t('Open session','فتح المحاضرة');
          return <article key={l.id} data-session-id={l.id} data-session-state={s} className="instructor-agenda-row">
            <div className="instructor-agenda-time"><p dir="ltr" className="font-bold tabular-nums text-sm">{agendaTime(l.startTime)}</p><p dir="ltr" className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{agendaTime(l.endTime)}</p></div>
            <div className="instructor-agenda-group"><span className="instructor-agenda-group-icon"><Users className="w-5 h-5" aria-hidden="true"/></span><div className="min-w-0"><h3 className="font-bold text-sm break-words">{group?t(group.nameEn,group.nameAr):t('Unknown group','مجموعة غير معروفة')}</h3><p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 break-words">{l.topic}</p><p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 break-words">{room?.name||t('Room unavailable','القاعة غير متاحة')} · {rosterCount} {t('students','طلاب')}</p>
            {s==='finished'&&<p className="text-[11px] mt-1 text-slate-500 dark:text-slate-400">{t('Present','حاضر')} {present} · {t('Absent','غائب')} {absent} · <span className={counted?'text-emerald-700 dark:text-emerald-300':'text-amber-700 dark:text-amber-300'}>{counted?t('Counted','محتسبة'):t('Not counted','غير محتسبة')}</span></p>}</div></div>
            <span className="instructor-agenda-kind"><Laptop className="w-4 h-4" aria-hidden="true"/>{t('Lecture','محاضرة')}</span>
            <button type="button" aria-label={actionText} title={actionText} onClick={()=>openInstructorAttendance(l.id)} className="instructor-agenda-status"><StatusIcon className="w-4 h-4 shrink-0" aria-hidden="true"/><span>{statusText}</span><ArrowRight className="w-3.5 h-3.5 shrink-0 rtl:rotate-180" aria-hidden="true"/></button>
          </article>})}</div>
      </div>)}
    </section>
    {todayOnly&&<button type="button" className={BTN_SECONDARY+' text-xs'} onClick={()=>setInstructorRoute('checkin')}><MapPinCheck className="w-4 h-4"/>{t('Optional venue check-in','تسجيل الوصول للمقر (اختياري)')}</button>}
  </div>;
};
export const InstructorDashboardView:React.FC=()=> <SessionSummary todayOnly/>;
export const InstructorScheduleView:React.FC=()=> <SessionSummary todayOnly={false}/>;

export const InstructorCheckinView: React.FC = () => {
  const {
    activeCamp,
    isSupabaseMode,
    auth,
    instructors,
    venues,
    checkins,
    submitInstructorCheckin,
    t,
  } = useApp();

  const currentInstructor =
    instructors.find((i) => i.id === auth.activeInstructorId) || instructors[0];
  const venue = activeCamp
    ? venues.find((v) => v.id === activeCamp.venueId) || venues[0]
    : venues[0];

  const scheduledTeachingDate = activeCamp
    ? calculateCampDayDate(activeCamp.startDate,activeCamp.currentCampDay,activeCamp.operatingWeekdays)
    : '';
  const isOffDay = Boolean(activeCamp && (activeCamp.operatingWeekdays?.length ?? 7) < 7 &&
    scheduledTeachingDate !== cairoTodayIso());
  const existingCheckin =
    activeCamp && currentInstructor
      ? checkins.find(
          (c) =>
            c.campId === activeCamp.id &&
            c.instructorId === currentInstructor.id &&
            c.campDay === activeCamp.currentCampDay
        )
      : undefined;

  const [gpsSnapshot, setGpsSnapshot] = useState<{
    latitude: number; longitude: number; accuracy: number; distance: number; at: number;
  } | null>(null);
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);
  const [gpsExpired, setGpsExpired] = useState(false);
  const [checkinTime, setCheckinTime] = useState<string>('08:45');
  const [selfieSizeKb, setSelfieSizeKb] = useState<number>(0);
  const [selfieBlob, setSelfieBlob] = useState<Blob | undefined>(undefined);
  const [selfieExt, setSelfieExt] = useState<'webp' | 'jpg'>('webp');
  const [selfieMime, setSelfieMime] = useState<string>('image/webp');
  const [selfiePreviewUrl, setSelfiePreviewUrl] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraCapturing, setCameraCapturing] = useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = React.useRef<MediaStream | null>(null);
  const cameraRequestIdRef = React.useRef(0);
  const selfiePreviewUrlRef = React.useRef<string | null>(null);
  const [signedReceiptUrl, setSignedReceiptUrl] = useState<string | null>(null);
  const [exceptionReason, setExceptionReason] = useState<string>('');
  const [isBusy, setIsBusy] = useState(false);
  const [resultMsg, setResultMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Always release the webcam and temporary image URLs when leaving Check-in.
  // A late permission response must never reopen the camera after unmount.
  useEffect(() => {
    return () => {
      cameraRequestIdRef.current += 1;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
      if (selfiePreviewUrlRef.current) URL.revokeObjectURL(selfiePreviewUrlRef.current);
      selfiePreviewUrlRef.current = null;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (existingCheckin?.selfieStoragePath && isSupabaseMode) {
      getSignedSelfieUrl(existingCheckin.selfieStoragePath).then((url) => {
        if (active && url) setSignedReceiptUrl(url);
      });
    }
    return () => {
      active = false;
    };
  }, [existingCheckin?.selfieStoragePath, isSupabaseMode]);

  // GPS verification expires visibly as well as at submission, so an old GOOD
  // badge cannot remain on-screen when the underlying device fix is stale.
  useEffect(() => {
    if (!gpsSnapshot) {
      setGpsExpired(false);
      return;
    }
    setGpsExpired(false);
    const remaining = Math.max(0, 30_000 - (Date.now() - gpsSnapshot.at));
    const timer = window.setTimeout(() => setGpsExpired(true), remaining);
    return () => window.clearTimeout(timer);
  }, [gpsSnapshot]);

  if (!activeCamp || !currentInstructor || !venue) {
    return (
      <EmptyState
        icon={MapPinCheck}
        title={t('Check-in unavailable', 'تسجيل الوصول غير متاح')}
        description={t(
          'No active camp venue is currently configured.',
          'لا يوجد مقر معسكر نشط مفعّل حالياً.'
        )}
      />
    );
  }

  const gpsLimit = requiredGpsAccuracyMeters(activeCamp.settings.geofenceRadiusMeters);
  const getFreshPosition = () => new Promise<GeolocationPosition>((resolve, reject) => {
    if (!window.isSecureContext || !navigator.geolocation) {
      reject(new Error(t('Location requires HTTPS and device GPS.', 'الموقع يحتاج HTTPS وتفعيل GPS على الجهاز.')));
      return;
    }
    navigator.geolocation.getCurrentPosition(pos => {
      if (!Number.isFinite(pos.coords.latitude) || !Number.isFinite(pos.coords.longitude) ||
          !Number.isFinite(pos.coords.accuracy) || pos.coords.accuracy <= 0 ||
          pos.coords.latitude < -90 || pos.coords.latitude > 90 ||
          pos.coords.longitude < -180 || pos.coords.longitude > 180 ||
          Date.now() - pos.timestamp > 15_000 || pos.timestamp > Date.now() + 2_000) {
        reject(new Error(t('GPS reading is invalid or stale.', 'قراءة GPS غير صحيحة أو قديمة.')));
      } else resolve(pos);
    }, err => reject(new Error(
      err.code === 1
        ? t('Allow precise location for this site.', 'اسمح للموقع باستخدام الموقع الدقيق.')
        : t('Unable to read GPS. Try outside or from your phone.', 'تعذر قراءة GPS. جرب في مكان مفتوح أو بالموبايل.')
    )), { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
  });
  const quality = classifyGpsVerification(gpsSnapshot, activeCamp.settings.geofenceRadiusMeters);
  const displayQuality = gpsSnapshot && gpsExpired ? 'expired' : quality;
  // Explicitly require a positive location verification; exceptions do not
  // silently turn an outside or inaccurate device reading into attendance.
  const maySubmitGps = quality === 'good' && !gpsExpired;

  const releaseCamera = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const closeCamera = () => {
    cameraRequestIdRef.current += 1;
    releaseCamera();
    setCameraOpen(false);
    setCameraLoading(false);
  };

  const openCamera = async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setResultMsg({
        ok: false,
        text: t(
          'Live camera is unavailable. Open the Staging HTTPS link in Chrome or another camera-enabled browser.',
          'الكاميرا غير متاحة. افتح رابط Staging الآمن HTTPS في Chrome أو متصفح يدعم الكاميرا.'
        ),
      });
      return;
    }

    const requestId = ++cameraRequestIdRef.current;
    releaseCamera();
    if (selfiePreviewUrlRef.current) URL.revokeObjectURL(selfiePreviewUrlRef.current);
    selfiePreviewUrlRef.current = null;
    setSelfiePreviewUrl(null);
    setSelfieBlob(undefined);
    setSelfieSizeKb(0);
    setGpsSnapshot(null);
    setGpsMessage(null);
    setGpsExpired(false);
    setCameraOpen(true);
    setCameraLoading(true);
    setResultMsg(null);

    try {
      // "ideal" allows laptop webcams while preferring the front camera on phones.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (requestId !== cameraRequestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      cameraStreamRef.current = stream;
      if (!videoRef.current) throw new Error('Camera preview not available.');
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      // Ask location permission when the camera opens. Capture requests another
      // precise reading, binding it to this particular photo.
      const pos = await getFreshPosition();
      if (requestId !== cameraRequestIdRef.current) return;
      setGpsMessage(pos.coords.accuracy > gpsLimit
        ? t('Location access granted, but accuracy is poor. Try outdoors or use a phone.',
            'تم السماح بالموقع لكن الدقة ضعيفة. جرّب في مكان مفتوح أو استخدم الموبايل.')
        : t('Location enabled. Capture your selfie to verify your position.',
            'الموقع متاح. التقط صورة للتحقق من موقعك وقت التصوير.'));
    } catch (err) {
      if (requestId !== cameraRequestIdRef.current) return;
      releaseCamera();
      setCameraOpen(false);
      const name = err instanceof DOMException ? err.name : '';
      const message = err instanceof Error && /GPS|location|موقع/i.test(err.message)
        ? err.message
        : name === 'NotAllowedError' || name === 'PermissionDeniedError'
        ? t('Allow camera access in browser permissions and try again.', 'اسمح للموقع باستخدام الكاميرا من إعدادات المتصفح ثم حاول مجددًا.')
        : name === 'NotFoundError' || name === 'DevicesNotFoundError'
          ? t('No working camera was found on this device.', 'لم يتم العثور على كاميرا تعمل على الجهاز.')
          : name === 'NotReadableError'
            ? t('Camera is in use by another application. Close it there and retry.', 'الكاميرا مشغولة بتطبيق آخر. اقفله وحاول مجددًا.')
            : t('Unable to start live camera. Check browser camera permissions.', 'تعذر فتح الكاميرا. راجع أذونات الكاميرا في المتصفح.');
      setResultMsg({ ok: false, text: message });
    } finally {
      if (requestId === cameraRequestIdRef.current) setCameraLoading(false);
    }
  };

  const captureLiveSelfie = async () => {
    const captureRequestId = cameraRequestIdRef.current;
    const video = videoRef.current;
    if (!video || !cameraStreamRef.current || video.videoWidth <= 0 || video.videoHeight <= 0) {
      setResultMsg({
        ok: false,
        text: t('Camera is not ready yet. Wait for the live preview.', 'الكاميرا لسه مش جاهزة. استنى ظهور المعاينة المباشرة.'),
      });
      return;
    }
    setCameraCapturing(true);
    setResultMsg(null);
    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Camera image processing is unavailable.');
      // Mirror the captured frame exactly as the user sees it in the selfie preview.
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const photo = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error('Unable to capture camera frame.')),
          'image/jpeg',
          0.9
        );
      });
      const file = new File([photo], 'live-selfie.jpg', { type: 'image/jpeg' });
      const compressed = await compressSelfieUnderLimit(file, activeCamp.settings.maxSelfieKb);
      const pos = await getFreshPosition();
      if (captureRequestId !== cameraRequestIdRef.current) return;
      setGpsSnapshot({
        latitude: Number(pos.coords.latitude.toFixed(6)),
        longitude: Number(pos.coords.longitude.toFixed(6)),
        accuracy: Math.max(1, Math.ceil(pos.coords.accuracy)),
        distance: calculateHaversineDistanceMeters(
          pos.coords.latitude, pos.coords.longitude, venue.latitude, venue.longitude),
        at: Date.now(),
      });
      // Ignore delayed compression if the user navigated away or cancelled camera.
      if (captureRequestId !== cameraRequestIdRef.current) return;
      const url = URL.createObjectURL(compressed.blob);
      if (selfiePreviewUrlRef.current) URL.revokeObjectURL(selfiePreviewUrlRef.current);
      selfiePreviewUrlRef.current = url;
      setSelfiePreviewUrl(url);
      setSelfieBlob(compressed.blob);
      setSelfieSizeKb(compressed.sizeKb);
      setSelfieExt(compressed.ext);
      setSelfieMime(compressed.mimeType);
      setCameraCapturing(false);
      closeCamera();
      // The photo thumbnail already confirms capture. Do not show a green
      // success banner here: venue location may still be UNVERIFIED/OUTSIDE.
      // Only final server-side check-in can show an attendance success banner.
    } catch (err) {
      if (captureRequestId === cameraRequestIdRef.current) {
        setResultMsg({
          ok: false,
          text: err instanceof Error ? err.message : t('Camera capture failed.', 'تعذر التقاط الصورة.'),
        });
      }
    } finally {
      if (captureRequestId === cameraRequestIdRef.current) setCameraCapturing(false);
    }
  };

  const handleCheckin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOffDay) {
      setResultMsg({ok:false,text:t(
        `Check-in is only allowed on your scheduled teaching date: ${scheduledTeachingDate}`,
        `تسجيل الوصول متاح يوم الدراسة المحدد فقط: ${scheduledTeachingDate}`)});
      return;
    }
    if (!gpsSnapshot || !selfieBlob || !maySubmitGps || Date.now() - gpsSnapshot.at > 30_000) {
      setResultMsg({ ok: false, text: t(
        'Capture a new selfie with a fresh, accurate GPS reading first.',
        'التقط صورة جديدة ومعاها GPS حديث ودقيق قبل الحفظ.') });
      return;
    }
    if (activeCamp.status !== CampStatus.ACTIVE) {
      setResultMsg({ ok: false, text: t(
        'Camp must be active before a check-in can be submitted.',
        'المعسكر لازم يبقى Active قبل تسجيل الوصول.') });
      return;
    }
    setIsBusy(true);
    setResultMsg(null);
    try {
      const res = await submitInstructorCheckin({
        instructorId: currentInstructor.id,
        latitude: gpsSnapshot.latitude,
        longitude: gpsSnapshot.longitude,
        gpsAccuracyMeters: gpsSnapshot.accuracy,
        selfieSizeKb,
        selfieBlob,
        selfieExt,
        selfieMimeType: selfieMime,
        checkinTimeHHMM: checkinTime,
        exceptionReason: exceptionReason.trim() || undefined,
      });
      // Do not leak raw location metrics in the instructor success receipt.
      setResultMsg({
        ok: res.ok,
        text: res.ok
          ? t('Check-in recorded. Your verification status is shown in your receipt.',
              'تم تسجيل الوصول. حالة التحقق ظاهرة في إيصال الحضور.')
          : res.message,
      });
    } finally {
      setIsBusy(false);
    }
  };

  const existingDisplay = existingCheckin
    ? instructorCheckinBadge(existingCheckin.status, t)
    : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Daily Venue Check-in', 'تسجيل الوصول اليومي للمقر')}
        subtitle={t(
          'One daily GPS snapshot within the venue geofence paired with a compressed verification selfie (<= 300KB).',
          'تسجيل واحد يومياً داخل النطاق الجغرافي للمقر مع صورة تحقق مضغوطة (بحد أقصى 300 كيلوبايت).'
        )}
      />

      {resultMsg && (
        <InlineBanner
          type={resultMsg.ok ? 'success' : 'error'}
          message={resultMsg.text}
          onDismiss={() => setResultMsg(null)}
        />
      )}

      {existingCheckin && existingDisplay && (
        <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/20 text-xs flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 dark:text-white">
                {t('Today’s Check-in Receipt', 'إيصال تسجيل الوصول اليوم')}
              </span>
              <StatusBadge tone={existingDisplay.tone}>{existingDisplay.label}</StatusBadge>
            </div>
            <p className="text-slate-600 dark:text-[#C0C5C9]">
              {t('Recorded at', 'تم التسجيل الساعة')}{' '}
              {new Date(existingCheckin.serverTimestamp).toLocaleTimeString()}
            </p>
          </div>
          {signedReceiptUrl && (
            <img
              src={signedReceiptUrl}
              alt={t('Uploaded check-in selfie', 'صورة التحقق المرفوعة')}
              className="w-16 h-16 rounded-lg object-cover border border-slate-200 dark:border-[#42474D]"
            />
          )}
        </div>
      )}

      <form onSubmit={handleCheckin} className={`${SURFACE_CARD} p-3 sm:p-6 space-y-4 sm:space-y-5`}>

        {isOffDay && (
          <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
            {t(`Check-in is closed until teaching date ${scheduledTeachingDate}.`,
               `تسجيل الوصول مقفول لحد يوم الدراسة ${scheduledTeachingDate}.`)}
          </div>
        )}
        <section className={`${SURFACE_SUBTLE} p-4 space-y-2`}>
          <p className="text-sm font-bold text-slate-900 dark:text-white">{t(venue.nameEn, venue.nameAr)}</p>
          <p className="text-sm text-slate-600 dark:text-[#C0C5C9]">
            {t('Open the camera, allow precise location access, and take a fresh selfie. Location verification happens automatically.',
                'افتح الكاميرا، واسمح للموقع الدقيق، واتصور صورة جديدة. التحقق من الموقع بيتم تلقائيًا.')}
          </p>
          {gpsMessage && <p className="text-xs text-slate-500 dark:text-[#A0A5AA]">{gpsMessage}</p>}
        </section>

        <section aria-live="polite" aria-label={t('Location verification result','نتيجة التحقق من الموقع')}
          className={`rounded-xl border p-4 sm:p-5 space-y-3 ${
            displayQuality === 'good'
              ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30'
              : displayQuality === 'outside'
                ? 'border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/20'
                : displayQuality === 'missing'
                  ? 'border-slate-200 bg-slate-50 dark:border-[#353A3F] dark:bg-[#1D2023]/40'
                  : 'border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20'
          }`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              {displayQuality === 'good' ? <CheckCircle2 className="w-5 h-5 text-emerald-700" /> :
                displayQuality === 'missing' ? <MapPinCheck className="w-5 h-5 text-slate-500" /> :
                <MapPinCheck className="w-5 h-5 text-amber-700" />}
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {t('Location Verification','التحقق من الموقع')}
              </h3>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${
              displayQuality === 'good' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200' :
              displayQuality === 'outside' ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200' :
              displayQuality === 'missing' ? 'bg-slate-100 text-slate-600 dark:bg-[#25292D] dark:text-[#DEE1E4]' :
              'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200'
            }`}>
              {displayQuality === 'good' ? t('VERIFIED','تم التحقق') :
               displayQuality === 'outside' ? t('OUTSIDE VENUE','خارج المقر') :
               displayQuality === 'missing' ? t('AWAITING CAPTURE','بانتظار التصوير') :
               t('NEEDS RETAKE','يحتاج إعادة التصوير')}
            </span>
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-slate-900 dark:text-white">
              {displayQuality === 'good'
                ? t('Your location has been verified within the training venue.',
                    'تم التحقق من وجودك داخل نطاق موقع التدريب.')
                : displayQuality === 'poor'
                  ? t('We could not verify your location accurately enough.',
                      'تعذر التحقق من موقعك بدقة كافية.')
                  : displayQuality === 'uncertain'
                    ? t('Your location could not be confirmed within the venue.',
                        'تعذر التأكد من وجودك داخل نطاق موقع التدريب.')
                    : displayQuality === 'outside'
                      ? t('Your location is outside the training venue.',
                          'موقعك الحالي خارج نطاق مقر التدريب.')
                      : displayQuality === 'expired'
                        ? t('Your location verification has expired.',
                            'انتهت صلاحية التحقق من موقعك.')
                        : t('Take a live selfie to begin location verification.',
                            'التقط صورة مباشرة عشان يبدأ التحقق من موقعك.')}
            </p>
            <p className="text-slate-600 dark:text-[#C0C5C9]">
              {displayQuality === 'good'
                ? t('You can continue once the camp is active.',
                    'تقدر تكمل تسجيل الوصول بعد تفعيل المعسكر.')
                : displayQuality === 'poor'
                  ? t('Move to an open area near the training venue, enable Precise Location, and retake your selfie. A GPS-enabled phone may help.',
                      'من فضلك روح لمكان مفتوح قريب من مقر التدريب، وفعّل Precise Location، ثم أعد التقاط الصورة. الموبايل المزود بـ GPS ممكن يساعد.')
                  : displayQuality === 'uncertain'
                    ? t('Move closer to the training venue, enable Precise Location, and retake your selfie.',
                        'من فضلك اقترب من موقع التدريب، وفعّل Precise Location، ثم أعد التقاط الصورة.')
                    : displayQuality === 'outside'
                      ? t('Please go to the training venue and retake your selfie. An inaccurate reading never counts as verified attendance.',
                          'من فضلك اتجه لمقر التدريب وأعد التصوير. القراءة غير المؤكدة مش بتتحسب حضور موثق.')
                      : displayQuality === 'expired'
                        ? t('Retake your selfie to capture a fresh location verification.',
                            'أعد التقاط الصورة للحصول على تحقق جديد من الموقع.')
                        : t('Camera access and precise device location are required. No location coordinates will be displayed.',
                            'مطلوب السماح للكاميرا والموقع الدقيق. مش هنعرض إحداثيات الموقع.')}
            </p>
          </div>
          {displayQuality !== 'good' && displayQuality !== 'missing' && !cameraOpen && (
            <button type="button" onClick={() => { void openCamera(); }}
              disabled={isBusy || cameraCapturing} className={BTN_SECONDARY}>
              <RefreshCw className="w-4 h-4" />
              <span>{t('Retake Selfie & Verify Location', 'إعادة التصوير والتحقق من الموقع')}</span>
            </button>
          )}
        </section>

        {/* Live camera capture ONLY: no file/gallery upload control. */}
        <div className={`${SURFACE_SUBTLE} p-4 space-y-4 text-xs`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {selfiePreviewUrl ? (
                <img
                  src={selfiePreviewUrl}
                  alt={t('Captured verification selfie', 'صورة التحقق الملتقطة')}
                  className="w-16 h-16 rounded-lg object-cover border border-slate-200 dark:border-[#42474D] shrink-0"
                />
              ) : (
                <Camera className="w-5 h-5 text-[#355F82] shrink-0" />
              )}
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">
                  {selfieBlob
                    ? t('Live Selfie Captured', 'تم التقاط الصورة المباشرة')
                    : t('Live Selfie Required', 'مطلوب صورة مباشرة بالكاميرا')}
                </p>
                <p className="text-slate-500 mt-0.5">
                  {selfieBlob
                    ? t('Camera photo captured successfully', 'تم التقاط الصورة بالكاميرا بنجاح')
                    : t(
                      'Take a fresh selfie using the camera. Choosing an existing photo is disabled.',
                      'التقط صورة جديدة باستخدام الكاميرا. اختيار صورة قديمة من الجهاز غير متاح.'
                    )}
                </p>
              </div>
            </div>
            {!cameraOpen && (
              <button
                type="button"
                disabled={isBusy || cameraCapturing}
                onClick={() => { void openCamera(); }}
                className={BTN_SECONDARY}
              >
                <Camera className="w-4 h-4" />
                <span>{selfieBlob ? t('Retake Selfie', 'إعادة التصوير') : t('Open Camera', 'فتح الكاميرا')}</span>
              </button>
            )}
          </div>

          {/* Keep the video mounted so it can receive the stream after permission. */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            aria-label={t('Live front camera preview', 'معاينة مباشرة للكاميرا الأمامية')}
            className={`${cameraOpen ? 'block' : 'hidden'} w-full max-w-md rounded-xl bg-black aspect-[4/3] object-cover -scale-x-100`}
          />
          {cameraOpen && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={cameraLoading || cameraCapturing || isBusy}
                onClick={() => { void captureLiveSelfie(); }} className={BTN_PRIMARY}>
                <Camera className="w-4 h-4" />
                <span>{cameraCapturing
                  ? t('Processing…', 'جاري تجهيز الصورة…')
                  : cameraLoading
                    ? t('Opening camera…', 'جاري فتح الكاميرا…')
                    : t('Capture Selfie Now', 'التقط الصورة الآن')}</span>
              </button>
              <button type="button" disabled={cameraCapturing} onClick={closeCamera} className={BTN_SECONDARY}>
                {t('Cancel Camera', 'إغلاق الكاميرا')}
              </button>
            </div>
          )}
          {selfieBlob && !cameraOpen && (
            <p className="text-emerald-700 dark:text-emerald-300 font-medium">
              {t('Review complete? The captured photo will be stored privately only when you submit check-in.', 'راجع الصورة. لن تُحفظ في التخزين الخاص إلا بعد إرسال تسجيل الوصول.')}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="chk-exception" className={LABEL_CLASS}>
            {t(
              'Late Arrival Note (Optional)',
              'ملاحظة التأخر (اختياري)'
            )}
          </label>
          <input
            id="chk-exception"
            type="text"
            placeholder={t('Explain any GPS drift or delay...', 'وضح سبب التأخر أو انحراف الموقع إن وجد...')}
            value={exceptionReason}
            onChange={(e) => setExceptionReason(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>

        <button
          type="submit"
          disabled={isBusy || cameraOpen || cameraCapturing || !selfieBlob || !maySubmitGps || Boolean(existingCheckin) || isOffDay || activeCamp.status !== CampStatus.ACTIVE}
          className={`${BTN_PRIMARY} w-full min-h-[48px] text-sm disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <MapPinCheck className="w-4 h-4" />
          <span>
            {isBusy
              ? t('Submitting Check-in...', 'جاري التحقق والإرسال...')
              : existingCheckin
              ? t('Daily Check-in Recorded', 'تم تسجيل الوصول اليومي')
              : t('Verify Location & Submit Check-in', 'توثيق الموقع وإرسال الوصول')}
          </span>
        </button>
      </form>
    </div>
  );
};

/** Highlight the actual match in a search result without interpreting user input as HTML or regex. */
function highlightAttendanceSearchMatch(value: string, query: string): React.ReactNode {
  const term = query.trim();
  if (!term) return value;
  const index = value.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
  if (index < 0) return value;
  return (
    <>
      {value.slice(0, index)}
      <mark className="rounded-sm bg-amber-200 dark:bg-amber-500/40 text-inherit px-0.5">
        {value.slice(index, index + term.length)}
      </mark>
      {value.slice(index + term.length)}
    </>
  );
}

type AttendanceRosterFilter = 'all' | 'unmarked' | AttendanceMark;

export const InstructorAttendanceView: React.FC = () => {
  const {
    activeCamp,
    auth,
    instructors,
    lectures,
    students,
    studentTransfers,
    groups,
    attendanceSheets,
    isSupabaseMode,
    runLectureSession,
    rooms,
    instructorAttendanceLectureId: selectedLectureId,
    setInstructorRoute,
    saveAttendanceDraft,
    enrollMidcampStudent,
    submitAndSyncAttendanceSheet,
    instructorCorrectSubmittedAttendance,
    reviewAttendanceDraft,
    lang,
    t,
  } = useApp();

  const currentInstructor =
    instructors.find((i) => i.id === auth.activeInstructorId) || instructors[0];

  const myLectures =
    activeCamp && currentInstructor
      ? lectures.filter(
          (l) =>
            l.campId === activeCamp.id &&
            (l.substituteInstructorId || l.instructorId) === currentInstructor.id && l.status !== 'cancelled'
        )
      : [];

  // One query drives both the visible roster and the scoped server-side
  // visitor lookup. No second input or separate student-selection step.
  const sessionClock=useSessionClock();
  const [studentSearch, setStudentSearch] = useState('');
  const [attendanceStatusFilter, setAttendanceStatusFilter] = useState<AttendanceRosterFilter>('all');
  const [secureVisitingMatches, setSecureVisitingMatches] = useState<VisitingStudentLookupResult[]>([]);
  const [lastCompletedVisitQuery, setLastCompletedVisitQuery] = useState('');
  const [visitingLookupError, setVisitingLookupError] = useState<string | null>(null);
  const [visitingSearchBusy, setVisitingSearchBusy] = useState(false);
  const [visitingSourceGroupCodes, setVisitingSourceGroupCodes] = useState<Record<string,string>>({});
  const [showMidcampEnrollForm, setShowMidcampEnrollForm] = useState(false);
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentCode, setNewStudentCode] = useState(()=>generateEntityCode('STU'));
  const [newStudentUniversity, setNewStudentUniversity] = useState('');
  const [newStudentReason, setNewStudentReason] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [comparisonRows, setComparisonRows] = useState<Array<{
    studentId: string; studentCode: string; studentName: string;
    localMark: string; serverMark: string; localNote?: string; serverNote?: string;
  }> | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);

  // RLS intentionally restricts direct students reads to assigned groups.
  // Use a narrowly authorized, lecture-scoped RPC for visitors; never widen RLS.
  useEffect(() => {
    let cancelled = false;
    const term = studentSearch.trim();
    if (!isSupabaseMode || !selectedLectureId || !lectures.find(l=>l.id===selectedLectureId)?.sessionStartedAt || term.length < 2) {
      setSecureVisitingMatches([]);
      setVisitingLookupError(null);
      setVisitingSearchBusy(false);
      setLastCompletedVisitQuery('');
      return;
    }
    setVisitingSearchBusy(true);
    const timer = window.setTimeout(async () => {
      setVisitingLookupError(null);
      try {
        const rows = await searchVisitingStudentsInDb({ lectureId: selectedLectureId, query: term });
        if (!cancelled) {
          setSecureVisitingMatches(rows);
          setLastCompletedVisitQuery(term);
        }
      } catch (err) {
        if (!cancelled) {
          setSecureVisitingMatches([]);
          setLastCompletedVisitQuery('');
          setVisitingLookupError(err instanceof Error ? err.message : 'Secure lookup is not available.');
        }
      } finally {
        if (!cancelled) setVisitingSearchBusy(false);
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [isSupabaseMode, selectedLectureId, studentSearch, lectures]);

  if (!activeCamp || !currentInstructor) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title={t('No lectures available', 'لا توجد محاضرات متاحة لتسجيل الحضور')}
      />
    );
  }

  const selectedLecture = myLectures.find((l) => l.id === selectedLectureId);
  const existingSheet = attendanceSheets.find((s) => s.lectureId === selectedLectureId);

  const baseRecords: AttendanceRecordItem[] = (() => {
    if (!selectedLecture) return [];
    const sheetRecords = existingSheet?.records || [];
    // Never reuse another lecture's home roster: P2 / GRP-02 must only
    // show GRP-02 students, even if the same Instructor also teaches P1.
    const groupRoster = studentsForSelectedLecture({
      lecture: selectedLecture,
      students,
      transfers: studentTransfers,
    });
    const existingIds = new Set(sheetRecords.map((r) => r.studentId));
    const missingFromRoster: AttendanceRecordItem[] = groupRoster
      .filter((stu) => !existingIds.has(stu.id))
      .map((stu) => {
        const originGroupId = resolveStudentOriginGroupForDay({
          student: stu,
          transfers: studentTransfers,
          campDay: selectedLecture.campDay,
        });
        return {
          studentId: stu.id,
          studentCode: stu.studentCode,
          studentName: stu.fullName,
          originGroupId,
          attendedGroupId: selectedLecture.groupId,
          isCrossGroup: originGroupId !== selectedLecture.groupId,
          mark: 'unmarked',
        };
      });
    return [...sheetRecords, ...missingFromRoster];
  })();

  // Status filters never mutate the underlying records or widen visitor RLS.
  // In particular, 'unmarked' is not 'absent' until authorized final submit.
  const nameMatchedRecords = useMemo(() => {
    const q = studentSearch.trim().toLocaleLowerCase();
    if (!q) return baseRecords;
    return baseRecords.filter((r) =>
      r.studentName.toLocaleLowerCase().includes(q) ||
      r.studentCode.toLocaleLowerCase().includes(q)
    );
  }, [baseRecords, studentSearch]);
  const filteredRecords = useMemo(
    () => nameMatchedRecords.filter(r =>
      attendanceStatusFilter === 'all' || r.mark === attendanceStatusFilter
    ),
    [nameMatchedRecords, attendanceStatusFilter]
  );
  const attendanceFilterOptions: Array<{
    value: AttendanceRosterFilter; en: string; ar: string; activeClass: string;
  }> = [
    { value: 'all', en: 'All', ar: 'الكل', activeClass: 'bg-slate-800 text-white border-slate-800' },
    { value: AttendanceMark.PRESENT, en: 'Present', ar: 'حاضر', activeClass: 'bg-emerald-600 text-white border-emerald-600' },
    { value: AttendanceMark.LATE, en: 'Late', ar: 'متأخر', activeClass: 'bg-amber-600 text-white border-amber-600' },
    { value: AttendanceMark.ABSENT, en: 'Absent', ar: 'غائب', activeClass: 'bg-red-600 text-white border-red-600' },
    { value: AttendanceMark.EXCUSED, en: 'Excused', ar: 'بعذر', activeClass: 'bg-violet-600 text-white border-violet-600' },
    { value: 'unmarked', en: 'Unmarked', ar: 'لم يُحدد', activeClass: 'bg-slate-600 text-white border-slate-600' },
  ];
  const attendanceFilterCount = (status: AttendanceRosterFilter) =>
    status === 'all'
      ? nameMatchedRecords.length
      : nameMatchedRecords.filter(r => r.mark === status).length;

  const isLockedOrSubmitted =
    existingSheet?.status === AttendanceSheetStatus.SUBMITTED ||
    existingSheet?.status === AttendanceSheetStatus.LOCKED;

  // Allow preparing attendance drafts ahead of opening day, but never permit
  // irreversible final submission for Draft camps or future lecture dates.
  const cairoDateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const cairoDatePart = (name: string) => cairoDateParts.find(part => part.type === name)?.value || '';
  const cairoToday = `${cairoDatePart('year')}-${cairoDatePart('month')}-${cairoDatePart('day')}`;
  const campOpenForAttendance = activeCamp.status === CampStatus.ACTIVE;
  const lectureIsFuture = Boolean(selectedLecture && selectedLecture.lectureDate > cairoToday);
  const lifecycle=selectedLecture?sessionState(selectedLecture,existingSheet,sessionClock,campOpenForAttendance):'upcoming';
  const canOpenRoster=!isSupabaseMode || Boolean(selectedLecture?.sessionStartedAt) || isLockedOrSubmitted;
  const canFinalizeAttendance = campOpenForAttendance && !lectureIsFuture && canOpenRoster;
  const handleRun=async()=>{
    if(!selectedLecture||isBusy)return;
    setIsBusy(true);setFeedback(null);
    try{const result=await runLectureSession(selectedLecture.id);setFeedback({ok:result.ok,text:result.ok?t('Session started. Take attendance below.','تم تشغيل المحاضرة، سجل الحضور بالأسفل.'):(result.error||t('Could not start session','تعذر تشغيل المحاضرة'))});}finally{setIsBusy(false);}
  };
  const canCorrectSubmitted = isSupabaseMode && canFinalizeAttendance &&
    existingSheet?.status === AttendanceSheetStatus.SUBMITTED &&
    existingSheet.instructorId === currentInstructor.id &&
    (selectedLecture?.substituteInstructorId || selectedLecture?.instructorId) === currentInstructor.id;

  const rosterStudentIds = new Set(baseRecords.map((r) => r.studentId));
  const eligibleCrossGroupStudents = selectedLecture
    ? students.filter(
        (s) =>
          s.campId === activeCamp.id &&
          s.isActive &&
          studentEligibleForCampDay(s, selectedLecture.campDay) &&
          !rosterStudentIds.has(s.id) &&
          resolveStudentOriginGroupForDay({
            student: s,
            transfers: studentTransfers,
            campDay: selectedLecture.campDay,
          }) !== selectedLecture.groupId
      )
    : [];

  const visitingMatches: VisitingStudentLookupResult[] = isSupabaseMode
    ? secureVisitingMatches.filter(stu =>
        !rosterStudentIds.has(stu.studentId) &&
        stu.homeGroupId !== selectedLecture?.groupId)
    : studentSearch.trim().length >= 2
      ? eligibleCrossGroupStudents.filter(stu => {
          const q = studentSearch.trim().toLocaleLowerCase();
          const home = groups.find(g => g.id === stu.groupId);
          return stu.fullName.toLocaleLowerCase().includes(q) ||
            stu.studentCode.toLocaleLowerCase().includes(q) ||
            (home?.code.toLocaleLowerCase().includes(q) ?? false);
        }).slice(0, 12).map(stu => {
          const homeGroupId = selectedLecture ? resolveStudentOriginGroupForDay({
            student: stu, transfers: studentTransfers, campDay: selectedLecture.campDay
          }) : stu.groupId;
          return {
            studentId: stu.id, studentCode: stu.studentCode, fullName: stu.fullName,
            homeGroupId,
            homeGroupCode: groups.find(g => g.id === homeGroupId)?.code || 'Unknown',
          };
        })
      : [];

   const visitingGroupName = (studentId: string) => {
    const match = visitingMatches.find(s => s.studentId === studentId);
    if (match) return match.homeGroupCode;
    if (visitingSourceGroupCodes[studentId]) return visitingSourceGroupCodes[studentId];
    const rec = baseRecords.find(r => r.studentId === studentId);
    return rec?.originGroupCode || groups.find(g => g.id === rec?.originGroupId)?.code ||
      t('another group', 'مجموعة أخرى');
  };

  const handleMarkChange = async (
    studentId: string,
    mark: AttendanceMark | 'unmarked'
  ) => {
    if (!selectedLecture || isBusy) return;
    if (isLockedOrSubmitted) {
      const previous = existingSheet?.records.find(r => r.studentId === studentId)?.mark;
      if (!canCorrectSubmitted || !existingSheet || !previous || previous === 'unmarked' ||
          mark === 'unmarked' || previous === mark) return;
      const note = window.prompt(t('Reason for changing submitted attendance', 'سبب تعديل الحضور المعتمد'));
      if (!note?.trim()) return;
      setIsBusy(true);
      try {
        const result = await instructorCorrectSubmittedAttendance({sheetId: existingSheet.id, studentId,
          mark, expectedMark: previous, note: note.trim()});
        setFeedback({ok: result.ok, text: result.ok ? t('Attendance corrected and audited.', 'تم تعديل الحضور وتسجيل السبب.') :
          (result.error || t('Correction failed.', 'فشل تعديل الحضور.'))});
      } finally { setIsBusy(false); }
      return;
    }
    setComparisonRows(null);
    const nextRecords: AttendanceRecordItem[] = baseRecords.map((r) =>
      r.studentId === studentId ? { ...r, mark } : r
    );
    const res = await saveAttendanceDraft(selectedLectureId, nextRecords, true);
    if (!res.ok) {
      setFeedback({ ok: false, text: res.error || t('Unable to save draft.', 'تعذر حفظ المسودة.') });
    } else {
      setFeedback({
        ok: true,
        text: t(
          'Saved locally as draft. Submit the sheet when finished.',
          'تم الحفظ كمسودة محلية. يرجى اعتماد الكشف عند الانتهاء.'
        ),
      });
    }
  };

  const handleAddCrossGroupStudent = async (selectedStudent: VisitingStudentLookupResult) => {
    if (!selectedLecture || isLockedOrSubmitted || isBusy) return;
    // Verify eligibility again at click time; no duplicate roster row or
    // unrecognized/off-camp student can be added via the UI.
    const stu = visitingMatches.find((s) => s.studentId === selectedStudent.studentId);
    if (!stu) {
      setFeedback({ ok: false, text: t('The student is no longer eligible as a visitor.', 'الطالب غير متاح كزائر في هذه المحاضرة.') });
      return;
    }
    const overlapping = attendanceSheets.some(sheet => {
      if (sheet.lectureId === selectedLecture.id || sheet.campId !== activeCamp.id) return false;
      const otherLecture = myLectures.find(l => l.id === sheet.lectureId);
      // Cross-instructor same-period conflicts are verified again on server
      // during finalization; this local check can only see permitted sheets.
      const record = sheet.records.find(r => r.studentId === stu.studentId);
      return Boolean(otherLecture && otherLecture.campDay === selectedLecture.campDay &&
        otherLecture.periodNumber === selectedLecture.periodNumber &&
        record && record.mark !== 'unmarked' && record.mark !== AttendanceMark.ABSENT);
    });
    if (overlapping) {
      setFeedback({
        ok: false,
        text: t('This student already has attendance in another lecture in the same period.', 'الطالب متسجل له حضور في محاضرة تانية في نفس الفترة.'),
      });
      return;
    }

    const originGroupId = stu.homeGroupId;
    if (originGroupId === selectedLecture.groupId || baseRecords.some(r => r.studentId === stu.studentId)) {
      setFeedback({ ok: false, text: t('Student already belongs to this lecture.', 'الطالب موجود بالفعل في كشف المحاضرة.') });
      return;
    }

    const added: AttendanceRecordItem = {
      studentId: stu.studentId,
      studentCode: stu.studentCode,
      studentName: stu.fullName,
      originGroupCode: stu.homeGroupCode,
      originGroupId,
      attendedGroupId: selectedLecture.groupId,
      isCrossGroup: true,
      mark: AttendanceMark.PRESENT,
    };

    setComparisonRows(null);
    setIsBusy(true);
    const res = await saveAttendanceDraft(
      selectedLectureId,
      [...baseRecords, added],
      true
    );
    setIsBusy(false);
    if (res.ok) {
      setVisitingSourceGroupCodes(prev => ({ ...prev, [stu.studentId]: stu.homeGroupCode }));
      setStudentSearch('');
      setSecureVisitingMatches([]);
      setLastCompletedVisitQuery('');
      setFeedback({
        ok: true,
        text: t(
          `${stu.fullName} added as visiting cross-group student.`,
          `تمت إضافة ${stu.fullName} كحضور زائر من مجموعة أخرى.`
        ),
      });
    } else if (res.error) {
      setFeedback({ ok: false, text: res.error });
    }
  };

  const handleEnrollMidcampStudent = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedLecture || !activeCamp || isBusy || isLockedOrSubmitted) return;
    if (activeCamp.status !== CampStatus.ACTIVE) {
      setFeedback({ ok: false, text: t(
        'New student enrollment opens once the camp is active.',
        'إضافة الطلاب الجدد متاحة بعد تفعيل المعسكر فقط.'
      )});
      return;
    }
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await enrollMidcampStudent({
        groupId: selectedLecture.groupId,
        studentCode: newStudentCode.trim(),
        fullName: newStudentName.trim(),
        university: newStudentUniversity.trim(),
        reason: newStudentReason.trim(),
      });
      if (!res.ok) {
        setFeedback({ ok: false, text: res.error || t('Unable to enroll student.', 'تعذر إضافة الطالب.') });
      } else {
        setFeedback({ ok: true, text: t(
          'Student enrolled in this group. Camp join day, server time and your identity were saved in the audit log.',
          'تم تسجيل الطالب في المجموعة. السيرفر سجل يوم الانضمام ووقت الإضافة وهوية المحاضر في سجل المراجعة.'
        )});
        setNewStudentName('');
        setNewStudentCode(generateEntityCode('STU'));
        setNewStudentUniversity('');
        setNewStudentReason('');
        setShowMidcampEnrollForm(false);
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleReviewDraftConflict = async () => {
    if (!selectedLecture || isBusy || reviewBusy) return;
    setReviewBusy(true);
    setFeedback(null);
    try {
      const result = await reviewAttendanceDraft(selectedLecture.id);
      if (!result.ok) {
        setComparisonRows(null);
        setFeedback({ ok: false, text: result.error || t(
          'Could not compare draft versions.', 'تعذر مقارنة المسودتين.'
        ) });
      } else {
        setComparisonRows(result.rows || []);
      }
    } finally {
      setReviewBusy(false);
    }
  };

  const handleSubmitAndSync = async () => {
    if (!selectedLecture || isLockedOrSubmitted) return;
    if (!canFinalizeAttendance) {
      setFeedback({ ok: false, text: t(
        'You may prepare a draft, but final attendance submission requires an active camp and a lecture date that has arrived.',
        'تقدر تجهز مسودة الحضور، لكن الاعتماد النهائي متاح بعد تفعيل المعسكر وحلول موعد المحاضرة فقط.'
      ) });
      return;
    }
    setIsBusy(true);
    setFeedback(null);
    try {
      // Mark changes have already been saved as an offline draft.
      // NEVER upload them first: doing so can overwrite the server draft
      // before submitAndSyncAttendanceSheet compares against the server.
      const res = await submitAndSyncAttendanceSheet(selectedLectureId);
      if (!res.ok) {
        setFeedback({ ok: false, text: res.error || t('Sync failed.', 'تعذر إرسال الكشف.') });
      } else {
        setFeedback({
          ok: true,
          text: t(
            'Attendance sheet submitted & synchronized. Unmarked students were marked absent.',
            'تم اعتماد ومزامنة كشف الحضور وتحويل غير المحددين إلى غياب.'
          ),
        });
      }
    } finally {
      setIsBusy(false);
    }
  };

  // Reuse exactly the same attendance controls for search results and the
  // full roster; both write through the existing safe Draft/CAS workflow.
  const renderAttendanceRows = (records: AttendanceRecordItem[], searchTerm: string) => (
    <div className="space-y-2">
      {records.map((rec) => (
                <div
                  key={rec.studentId}
                  role="group"
                  aria-label={t(`Attendance for ${rec.studentName}`, `حضور ${rec.studentName}`)}
                  className="p-3 sm:p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 rounded-xl border border-slate-200 dark:border-[#42474D] bg-slate-50/60 dark:bg-[#121416]/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 w-full min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white break-words">
                        {highlightAttendanceSearchMatch(rec.studentName, searchTerm)}
                      </p>
                      {rec.isCrossGroup ? (
                        <StatusBadge tone="info">
                          {t('Visitor from', 'زائر من')} {visitingGroupName(rec.studentId)}
                        </StatusBadge>
                      ) : (
                        <span className="rounded-md border border-slate-200 dark:border-[#42474D] px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-[#C0C5C9]">
                          {t('In this group', 'في الجروب ده')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-mono tabular-nums text-slate-500 mt-0.5">
                      {highlightAttendanceSearchMatch(rec.studentCode, searchTerm)} ·{' '}
                      {rec.mark === 'unmarked'
                        ? t('Unmarked', 'غير محدد')
                        : rec.mark === AttendanceMark.PRESENT
                        ? t('Present', 'حاضر')
                        : rec.mark === AttendanceMark.LATE
                        ? t('Late', 'متأخر')
                        : rec.mark === AttendanceMark.EXCUSED
                        ? t('Excused', 'بعذر')
                        : t('Absent', 'غائب')}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 min-[400px]:grid-cols-4 md:flex md:items-center gap-2 min-w-0">
                    <button
                      type="button"
                      disabled={isBusy || (isLockedOrSubmitted && (!canCorrectSubmitted || rec.mark === 'unmarked'))}
                      onClick={() => handleMarkChange(rec.studentId, AttendanceMark.PRESENT)}
                      aria-pressed={rec.mark === AttendanceMark.PRESENT}
                      className={`min-h-[44px] w-full px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                        rec.mark === AttendanceMark.PRESENT
                          ? 'bg-emerald-600 text-white'
                          : 'border border-slate-200 dark:border-[#42474D] bg-white dark:bg-[#1D2023] text-slate-700 dark:text-[#C0C5C9]'
                      }`}
                    >
                      {t('Present', 'حاضر')}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy || (isLockedOrSubmitted && (!canCorrectSubmitted || rec.mark === 'unmarked'))}
                      onClick={() => handleMarkChange(rec.studentId, AttendanceMark.LATE)}
                      aria-pressed={rec.mark === AttendanceMark.LATE}
                      className={`min-h-[44px] w-full px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                        rec.mark === AttendanceMark.LATE
                          ? 'bg-amber-600 text-white'
                          : 'border border-slate-200 dark:border-[#42474D] bg-white dark:bg-[#1D2023] text-slate-700 dark:text-[#C0C5C9]'
                      }`}
                    >
                      {t('Late', 'متأخر')}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy || (isLockedOrSubmitted && (!canCorrectSubmitted || rec.mark === 'unmarked'))}
                      onClick={() => handleMarkChange(rec.studentId, AttendanceMark.ABSENT)}
                      aria-pressed={rec.mark === AttendanceMark.ABSENT}
                      className={`min-h-[44px] w-full px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                        rec.mark === AttendanceMark.ABSENT
                          ? 'bg-red-600 text-white'
                          : 'border border-slate-200 dark:border-[#42474D] bg-white dark:bg-[#1D2023] text-slate-700 dark:text-[#C0C5C9]'
                      }`}
                    >
                      {t('Absent', 'غائب')}
                    </button>
                  </div>
                </div>

      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      <button type="button" onClick={()=>setInstructorRoute('schedule')} className={BTN_SECONDARY+' min-h-[44px]'}><ArrowLeft className="w-4 h-4 rtl:rotate-180"/>{t('Back to Sessions','العودة للمحاضرات')}</button>
      <PageHeader title={t('Session Details','تفاصيل المحاضرة')} subtitle={t('Start your session, record attendance, then finish.','شغّل المحاضرة وسجل الحضور ثم اعتمدها.')}/>

      {feedback && (
        <InlineBanner
          type={feedback.ok ? 'success' : 'error'}
          message={feedback.text}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {selectedLecture ? (
        <div className="space-y-5">
          {/* Compact lecture summary — never duplicate the draft status panel. */}
          <section aria-label={t('Selected lecture summary', 'ملخص المحاضرة المختارة')}
            className="rounded-2xl border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] p-4 sm:p-5 shadow-sm"
          >
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#355F82] dark:text-[#88A9CC]">
                  {t('Selected lecture', 'المحاضرة المختارة')}
                </p>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white break-words">
                  {selectedLecture.topic}
                </h2>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-500 dark:text-[#A0A5AA]">
                  <span>{t('Day','اليوم')} {selectedLecture.campDay} · {selectedLecture.lectureDate} · {t('Period','الفترة')} {selectedLecture.periodNumber}</span>
                  <span>{t('Group','المجموعة')}: {groups.find(g=>g.id===selectedLecture.groupId)?.[lang==='ar'?'nameAr':'nameEn']||t('Unknown group','مجموعة غير معروفة')}</span>
                  <span>{selectedLecture.startTime}–{selectedLecture.endTime}</span>
                  <span>{t('Room','القاعة')}: {rooms.find(r=>r.id===selectedLecture.roomId)?.name}</span>
                  <span>{t('Home-group students', 'طلاب الجروب')}: {studentsForSelectedLecture({
                    lecture: selectedLecture, students, transfers: studentTransfers,
                  }).length}</span>
                </div>
              </div>
              <div className="flex flex-wrap md:flex-col md:items-end gap-2 shrink-0">
                <StatusBadge tone={isLockedOrSubmitted ? 'success' : 'warning'}>
                  {isLockedOrSubmitted
                    ? (canCorrectSubmitted ? t('Submitted · Audited corrections', 'معتمد · تعديل موثق') : t('Submitted · Locked', 'معتمد · مغلق'))
                    : !canOpenRoster ? t(sessionLabel(lifecycle).en,sessionLabel(lifecycle).ar) : t('Draft · Editable', 'مسودة · قابلة للتعديل')}
                </StatusBadge>
                {canOpenRoster && <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-[#A0A5AA]">
                  {existingSheet?.syncState === OfflineSyncState.SYNCED
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    : <WifiOff className="w-3.5 h-3.5 text-amber-600" />}
                  {existingSheet?.syncState === OfflineSyncState.SYNCED
                    ? t('Synced', 'متزامن')
                    : t('Local draft / pending sync', 'مسودة محلية / انتظار المزامنة')}
                </span>}
              </div>
            </div>
          </section>

          {!isLockedOrSubmitted && !selectedLecture.sessionStartedAt && <section className={SURFACE_CARD+' p-5 space-y-3'}>
            <h2 className="font-bold text-base">{t('Run Session','تشغيل المحاضرة')}</h2>
            <p className="text-sm text-slate-500">{lifecycle==='missed'?t('The start window ended. Contact operations.','انتهى وقت التشغيل. تواصل مع الإدارة.'):t('Opens 15 minutes before the scheduled start. Internet connection required.','يفتح قبل الموعد بـ 15 دقيقة. يحتاج اتصال بالإنترنت.')}</p>
            <button type="button" disabled={isBusy||(isSupabaseMode&&lifecycle!=='ready')} onClick={handleRun} className={BTN_PRIMARY+' min-h-[44px] disabled:opacity-50'}>{t('Run Session','تشغيل المحاضرة')}</button>
          </section>}
          {canOpenRoster && <>
          {/* Single live search: home roster appears immediately below; the
              scoped RPC returns visitors without exposing unassigned rosters. */}
          <section aria-label={t('Find and mark student attendance', 'ابحث وسجل حضور طالب')}
            className="space-y-4 rounded-2xl border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] p-4 sm:p-5 shadow-sm"
          >
            <label htmlFor="attendance-student-search" className="block text-sm font-bold text-slate-900 dark:text-white">
              {t('Find student', 'البحث عن طالب')}
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="attendance-student-search"
                type="search"
                value={studentSearch}
                onChange={(e) => {
                  setStudentSearch(e.target.value);
                  // Prevent results from an older search being added under a
                  // newer query, especially while an RPC is in flight.
                  setSecureVisitingMatches([]);
                  setLastCompletedVisitQuery('');
                  setVisitingLookupError(null);
                }}
                placeholder={t('Enter student name or ID code...', 'اكتب اسم الطالب أو الكود...')}
                aria-label={t('Search students by name or code', 'البحث عن الطلاب بالاسم أو الكود')}
                autoComplete="off"
                className={`${INPUT_CLASS} ps-9 text-sm min-h-[48px] rounded-xl`}
              />
            </div>
            {!studentSearch.trim() && (
              <p className="text-xs text-slate-500 dark:text-[#A0A5AA]">
                {t('Search by student name or code in the roster and other groups.',
                  'ابحث بالاسم أو كود الطالب في الكشف والجروبات التانية.')}
              </p>
            )}
            <div className="border-t border-slate-100 dark:border-[#353A3F] pt-4 space-y-2">
              <p className="text-xs font-bold text-slate-600 dark:text-[#C0C5C9]">
                {t('Filter attendance status', 'فلترة حسب حالة الحضور')}
              </p>
              <div role="group" aria-label={t('Filter attendance by status', 'فلترة الحضور حسب الحالة')}
                className="flex flex-wrap gap-2"
              >
                {attendanceFilterOptions.map(option => {
                  const active = attendanceStatusFilter === option.value;
                  return (
                    <button key={option.value} type="button"
                      aria-pressed={active}
                      onClick={() => setAttendanceStatusFilter(option.value)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold min-h-[38px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${active
                        ? option.activeClass
                        : 'border-slate-200 dark:border-[#42474D] bg-slate-50 dark:bg-[#25292D] text-slate-700 dark:text-[#DEE1E4] hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                    >
                      <span>{t(option.en, option.ar)}</span>
                      <span className={`min-w-[20px] rounded-full px-1.5 py-0.5 text-[11px] tabular-nums text-center ${active ? 'bg-white/20 text-white' : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-[#DEE1E4]'}`}>
                        {attendanceFilterCount(option.value)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Show the actual matching students AND controls right below
                the search, not a count that forces the Instructor to scroll. */}
            {studentSearch.trim() && filteredRecords.length > 0 && (
              <div role="group" aria-label={t('Matching students in this attendance sheet', 'الطلاب المطابقون في كشف الحضور')}
                className="space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    {t('Already in this attendance sheet', 'موجودين بالفعل في الكشف')}
                  </h3>
                  <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    {filteredRecords.length}
                  </span>
                </div>
                {renderAttendanceRows(filteredRecords, studentSearch)}
              </div>
            )}
            {studentSearch.trim() && nameMatchedRecords.length === 0 && studentSearch.trim().length < 2 && (
              <p role="status" className="text-xs text-slate-500">
                {t('No match in this sheet. Enter two characters to also search other groups.',
                  'مفيش نتيجة في الكشف ده. اكتب حرفين عشان تبحث في الجروبات التانية كمان.')}
              </p>
            )}

            {studentSearch.trim() && nameMatchedRecords.length > 0 &&
              filteredRecords.length === 0 && attendanceStatusFilter !== 'all' && (
              <div role="status" className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20 p-3 flex flex-wrap gap-3 items-center justify-between">
                <p className="text-xs text-amber-900 dark:text-amber-200">
                  {t('Student found, but hidden by the selected status filter.',
                    'الطالب موجود، لكن فلتر حالة الحضور مخفيه.')}
                </p>
                <button type="button" onClick={() => setAttendanceStatusFilter('all')}
                  className="text-xs font-bold text-[#355F82] dark:text-[#88A9CC] underline underline-offset-2">
                  {t('Show matching students', 'إظهار الطلاب المطابقين')}
                </button>
              </div>
            )}
            {!isLockedOrSubmitted && studentSearch.trim().length >= 2 && (
              <div className="space-y-2">
                {visitingSearchBusy && (
                  <p className="text-xs text-slate-500" role="status">
                    {t('Searching other groups securely...', 'جاري البحث في المجموعات التانية...')}
                  </p>
                )}
                {visitingLookupError && (
                  <p className="text-xs text-rose-700 dark:text-rose-300" role="alert">
                    {t('Visiting student search is currently unavailable. Try again later.',
                      'البحث عن الطلاب الزائرين غير متاح حاليًا. حاول مرة تانية.')}
                  </p>
                )}
                {visitingMatches.length > 0 && !visitingSearchBusy && (
                  <div role="group" aria-label={t('Students from other groups', 'طلاب مجموعات أخرى')}
                    className="space-y-2"
                  >
                    <p className="text-xs font-bold text-slate-700 dark:text-[#DEE1E4]">
                      {t('Students in other groups', 'طلاب موجودين في جروبات تانية')}
                    </p>
                    <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-[#42474D] bg-white dark:bg-[#1D2023]">
                      {visitingMatches.map(stu => (
                        <div key={stu.studentId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-b last:border-b-0 border-slate-100 dark:border-[#353A3F]">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">{highlightAttendanceSearchMatch(stu.fullName, studentSearch)}</p>
                            <p className="text-xs text-slate-500">
                              <span className="font-mono">{highlightAttendanceSearchMatch(stu.studentCode, studentSearch)}</span>
                              {' · '}{t('Home group:', 'المجموعة الأصلية:')} {stu.homeGroupCode}
                            </p>
                          </div>
                          <button type="button" disabled={isBusy}
                            onClick={() => { void handleAddCrossGroupStudent(stu); }}
                            aria-label={t(`Add ${stu.fullName} as visitor`, `إضافة ${stu.fullName} كزائر`)}
                            className={`${BTN_SECONDARY} min-h-[40px] shrink-0`}
                          >
                            <UserPlus className="w-4 h-4" />
                            <span>{t('Add as visitor', 'إضافة كزائر')}</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!visitingSearchBusy && !visitingLookupError &&
                  lastCompletedVisitQuery === studentSearch.trim() &&
                  visitingMatches.length === 0 && nameMatchedRecords.length === 0 && (
                    <p className="rounded-lg border border-slate-200 dark:border-[#42474D] px-3 py-3 text-xs text-slate-600 dark:text-[#C0C5C9]" role="status">
                      {t('No student matched this name or code in the current sheet or other groups.',
                        'ملقيناش طالب بالاسم أو الكود ده في الكشف أو الجروبات التانية.')}
                    </p>
                  )}
              </div>
            )}
          </section>

{/* Complete roster appears when the search is clear. Search matches are
              displayed directly under the input rather than far below. */}
          {!studentSearch.trim() && (
            <section aria-label={t('Full attendance roster', 'كشف الحضور الكامل')}
              className="rounded-2xl border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] p-4 sm:p-5 shadow-sm space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {t('Attendance roster', 'كشف حضور الطلاب')}
                </h3>
                <span className="rounded-full bg-slate-100 dark:bg-[#25292D] px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-[#DEE1E4] tabular-nums">
                  {filteredRecords.length} / {baseRecords.length}
                </span>
              </div>
              {filteredRecords.length > 0
                ? renderAttendanceRows(filteredRecords, '')
                : <div role="status" className="rounded-xl border border-dashed border-slate-200 dark:border-[#42474D] p-5 text-center space-y-3">
                    <p className="text-sm font-medium text-slate-500 dark:text-[#A0A5AA]">
                      {t('No students with this attendance status.', 'مفيش طلاب بالحالة دي حاليًا.')}
                    </p>
                    {attendanceStatusFilter !== 'all' && (
                      <button type="button" onClick={() => setAttendanceStatusFilter('all')}
                        className="text-sm font-semibold text-[#355F82] dark:text-[#88A9CC] underline underline-offset-2">
                        {t('Show all students', 'عرض كل الطلاب')}
                      </button>
                    )}
                  </div>}
            </section>
          )}

                    {/* Controlled mid-camp Student Enrollment: not a group transfer. */}
          {!isLockedOrSubmitted && (
            <section className="rounded-2xl border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] p-4 sm:p-5 space-y-3 shadow-sm text-xs">
              <div className="flex flex-wrap justify-between items-center gap-3">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">
                    {t('Enroll new student', 'إضافة طالب جديد')}
                  </h3>
                  <p className="text-slate-500 mt-1">
                    {t('For students not already registered in any Camp group.',
                        'للطالب اللي مش متسجل أصلًا في أي جروب بالمعسكر.')}
                  </p>
                </div>
                <button type="button" onClick={() => setShowMidcampEnrollForm(v => !v)}
                  aria-expanded={showMidcampEnrollForm}
                  aria-controls="midcamp-enrollment-form"
                  className={BTN_SECONDARY}>
                  <UserPlus className="w-4 h-4" />
                  <span>{showMidcampEnrollForm ? t('Cancel', 'إلغاء') : t('Enroll New Student', 'إضافة طالب جديد')}</span>
                </button>
              </div>
              {showMidcampEnrollForm && (
                <form id="midcamp-enrollment-form" onSubmit={e => { void handleEnrollMidcampStudent(e); }} className="space-y-3 border-t border-slate-100 dark:border-[#353A3F] pt-4">
                  <p className="text-blue-700 dark:text-blue-300">
                    {t('Assigned group:', 'المجموعة:')} <strong>{groups.find(g => g.id === selectedLecture?.groupId)?.code || '—'}</strong>
                    {' · '}{t('Official join day and enrollment timestamp are set by the server.', 'يوم الانضمام والتوقيت الرسمي بيحددهم السيرفر.')}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="midcamp-name" className={LABEL_CLASS}>{t('Full Name', 'الاسم بالكامل')} *</label>
                      <input id="midcamp-name" required minLength={3} maxLength={150}
                        value={newStudentName} onChange={e => setNewStudentName(e.target.value)}
                        className={INPUT_CLASS} autoComplete="off" />
                    </div>
                    <div>
                      <label htmlFor="midcamp-code" className={LABEL_CLASS}>{t('Unique Student Code', 'كود الطالب الفريد')} *</label>
                      <input id="midcamp-code" required minLength={3} maxLength={32}
                        value={newStudentCode} onChange={e => setNewStudentCode(e.target.value)}
                        className={INPUT_CLASS} autoComplete="off" />
                      <button type="button" className={BTN_SECONDARY+" mt-1"} onClick={()=>setNewStudentCode(generateEntityCode("STU"))}>{t("Generate code","توليد كود")}</button>
                    </div>
                    <div>
                      <label htmlFor="midcamp-university" className={LABEL_CLASS}>{t('University (Optional)', 'الجامعة (اختياري)')}</label>
                      <input id="midcamp-university" maxLength={150}
                        value={newStudentUniversity} onChange={e => setNewStudentUniversity(e.target.value)}
                        className={INPUT_CLASS} />
                    </div>
                    <div>
                      <label htmlFor="midcamp-reason" className={LABEL_CLASS}>{t('Enrollment Reason', 'سبب الإضافة')} *</label>
                      <input id="midcamp-reason" required minLength={5} maxLength={400}
                        placeholder={t('e.g. Joined on Day 4', 'مثال: انضم للمعسكر يوم 4')}
                        value={newStudentReason} onChange={e => setNewStudentReason(e.target.value)}
                        className={INPUT_CLASS} />
                    </div>
                  </div>
                  {activeCamp.status !== CampStatus.ACTIVE && (
                    <p role="status" className="text-amber-800 dark:text-amber-300">
                      {t('This camp is still Draft. Enrollment is disabled until activation.',
                          'المعسكر لسه Draft. إضافة طالب جديد مش متاحة قبل التفعيل.')}
                    </p>
                  )}
                  <div className="flex justify-end">
                    <button type="submit" disabled={isBusy || activeCamp.status !== CampStatus.ACTIVE}
                      className={BTN_PRIMARY}>
                      <UserPlus className="w-4 h-4" />
                      <span>{t('Save Student to This Group', 'حفظ الطالب في المجموعة')}</span>
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}

          {!isLockedOrSubmitted && !canFinalizeAttendance && (
            <div role="status" className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/20 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
              {t(
                'Draft only. Submission opens when the camp is active and the lecture date arrives. Unmarked students become absent only on final submission.',
                'مسودة فقط. الاعتماد متاح بعد تفعيل المعسكر وحلول موعد المحاضرة. غير المحددين يتحولوا لغياب عند الاعتماد النهائي.'
              )}
            </div>
          )}

          {!isLockedOrSubmitted && isSupabaseMode && (
            <section className="space-y-3 rounded-2xl border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] p-4 sm:p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {t('Compare Local vs Server Draft', 'مقارنة مسودة الجهاز بمسودة السيرفر')}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    {t('Read-only review: does not upload, approve or replace any marks.',
                      'مراجعة للقراءة فقط: مش هتبعت أو تعتمد أو تستبدل أي علامات حضور.')}
                  </p>
                </div>
                <button type="button" className={BTN_SECONDARY}
                  disabled={reviewBusy || isBusy}
                  onClick={() => { void handleReviewDraftConflict(); }}>
                  <RefreshCw className={`w-4 h-4 ${reviewBusy ? 'animate-spin' : ''}`} />
                  <span>{reviewBusy ? t('Comparing...', 'جاري المقارنة...') :
                    t('Review Differences', 'مراجعة الاختلافات')}</span>
                </button>
              </div>
              {comparisonRows !== null && (
                <div role="status" className="rounded-lg border border-slate-200 dark:border-[#42474D] overflow-hidden">
                  {comparisonRows.length === 0 ? (
                    <p className="p-3 text-xs text-emerald-700 dark:text-emerald-300">
                      {t('No differences found at the time of review. This does not finalize attendance.',
                          'مفيش اختلافات وقت المقارنة. ده مش اعتماد نهائي للحضور.')}
                    </p>
                  ) : (
                    <div className="space-y-2 p-3">
                      <p className="text-xs font-bold text-amber-800 dark:text-amber-200">
                        {t(`${comparisonRows.length} student differences; final submission remains protected.`,
                           `فيه اختلافات تخص ${comparisonRows.length} طالب. الاعتماد النهائي محمي من استبدال البيانات بصمت.`)}
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs text-start">
                          <thead className="bg-slate-100 dark:bg-[#25292D]">
                            <tr>
                              <th className="p-2 text-start">{t('Student / Code', 'الطالب / الكود')}</th>
                              <th className="p-2 text-start">{t('On this device', 'على الجهاز')}</th>
                              <th className="p-2 text-start">{t('On server', 'على السيرفر')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {comparisonRows.map(row => (
                              <tr key={row.studentId} className="border-t border-slate-200 dark:border-[#42474D]">
                                <td className="p-2"><strong>{row.studentName}</strong>
                                  <span className="block font-mono text-slate-500">{row.studentCode}</span>
                                </td>
                                <td className="p-2 font-mono">{row.localMark}
                                  {row.localNote && <span className="block font-sans text-slate-500">{row.localNote}</span>}
                                </td>
                                <td className="p-2 font-mono">{row.serverMark}
                                  {row.serverNote && <span className="block font-sans text-slate-500">{row.serverNote}</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-xs text-slate-500">
                        {t('Keep both versions unchanged. Review the marks with Admin before attempting final submission.',
                           'هنسيب النسختين زي ما هما. راجع الاختلافات مع الإدارة قبل أي اعتماد نهائي.')}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {!isLockedOrSubmitted && (
            <div className="rounded-2xl border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 shadow-sm">
              <button
                type="button"
                disabled={isBusy || !canFinalizeAttendance}
                onClick={handleSubmitAndSync}
                className={`${BTN_PRIMARY} min-h-[48px] px-3 sm:px-6 whitespace-normal text-center`}
              >
                <RefreshCw className={`w-4 h-4 ${isBusy ? 'animate-spin' : ''}`} />
                <span>
                  {isBusy
                    ? t('Submitting...', 'جاري الاعتماد...')
                    : t('Finish Session & Submit Attendance', 'إنهاء المحاضرة واعتماد الحضور')}
                </span>
              </button>
            </div>
          )}
          </>}
        </div>
      ) : (
        <EmptyState
          icon={ClipboardCheck}
          title={t('Session unavailable. Choose a session from the list.','المحاضرة غير متاحة. اختر محاضرة من القائمة.')}
        />
      )}
    </div>
  );
};

export const InstructorProfileAndSectionsView: React.FC = () => {
  const {
    auth,
    activeCamp,
    attendanceSheets,
    isSandboxMode,
    instructors,
    lectures,
    groups,
    students,
    rooms,
    surveys,
    entitlements,
    requests,
    submitInstructorRequest,
    setInstructorRoute,
    t,
  } = useApp();

  const [subTab, setSubTab] = useState<'groups' | 'personal' | 'links' | 'requests'>('groups');
  const [reqSubject, setReqSubject] = useState('');
  const [reqDetails, setReqDetails] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [reqFeedback, setReqFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const currentInstructor =
    instructors.find((i) => i.id === auth.activeInstructorId) || (isSandboxMode ? instructors[0] : undefined);

  if (!currentInstructor) {
    return (
      <EmptyState
        icon={UserCircle}
        title={t('Instructor profile unavailable', 'بيانات ملف المحاضر غير متاحة')}
      />
    );
  }


  const mySurveys = surveys.filter((s) => s.instructorId === currentInstructor.id);
  const myLectures=lectures.filter(l=>l.campId===activeCamp?.id&&(l.substituteInstructorId||l.instructorId)===currentInstructor.id&&l.status!=='cancelled');
  const progress=sessionCounts(myLectures,attendanceSheets,entitlements,currentInstructor.id);
  const myGroups=groups.filter(g=>g.campId===activeCamp?.id && (g.primaryInstructorId===currentInstructor.id || myLectures.some(l=>l.groupId===g.id)));
  const percent=progress.assigned ? Math.round(progress.counted/progress.assigned*100) : 0;
  const displayName=t(currentInstructor.fullNameEn,currentInstructor.fullNameAr);
  const initials=displayName.trim().split(/\s+/).slice(0,2).map(w=>Array.from(w)[0]).join('').toUpperCase() || 'IN';
  const campName=activeCamp?t(activeCamp.nameEn,activeCamp.nameAr)+' · '+activeCamp.code:t('No camp selected','لم يتم اختيار كامب');
  const myRequests = requests.filter((r) => r.instructorId === currentInstructor.id);

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqSubject.trim() || !reqDetails.trim()) return;
    setIsBusy(true);
    setReqFeedback(null);
    try {
      const res = await submitInstructorRequest({
        requestType: 'schedule_change',
        subject: reqSubject.trim(),
        details: reqDetails.trim(),
      });
      if (!res.ok) {
        setReqFeedback({ ok: false, text: res.error || t('Failed submitting request.', 'تعذر إرسال الطلب.') });
      } else {
        setReqSubject('');
        setReqDetails('');
        setReqFeedback({ ok: true, text: t('Request sent to Operations.', 'تم إرسال الطلب للإدارة.') });
      }
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="instructor-profile space-y-3 sm:space-y-6 min-w-0">
      <PageHeader title={t('Profile','الملف الشخصي')} subtitle={t('Instructor profile & account information','بيانات المحاضر ومتابعة الإنجاز')}/>
      <section aria-label={t('Instructor profile','ملف المحاضر')} className="instructor-profile-banner relative isolate overflow-hidden rounded-2xl bg-gradient-to-br from-[#102b46] via-[#16435a] to-[#08747b] text-white p-3.5 sm:p-7">
        <div aria-hidden="true" className="absolute -z-10 w-[420px] h-[420px] rounded-full border-[45px] border-white/5 -end-24 -bottom-72 pointer-events-none"/>
        <div aria-hidden="true" className="absolute -z-10 w-[360px] h-[360px] rounded-full border-[35px] border-teal-200/10 -end-40 -top-52 pointer-events-none"/>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-3 sm:gap-6 xl:gap-8 items-center">
          <div className="flex flex-row items-center gap-3 sm:gap-5 min-w-0">
            <div aria-hidden="true" className="w-14 h-14 sm:w-28 sm:h-28 shrink-0 rounded-full border-2 sm:border-4 border-white/90 bg-gradient-to-br from-[#4bada5] to-[#235b78] flex items-center justify-center text-xl sm:text-4xl font-bold shadow-lg">{initials}</div>
            <div className="min-w-0 space-y-1 sm:space-y-2"><p className="hidden sm:block text-xs font-semibold uppercase tracking-widest text-blue-100/80">{t('Instructor profile','ملف المحاضر')}</p>
              <h2 className="text-lg sm:text-3xl font-bold break-words tracking-tight">{displayName}</h2><p className="text-xs sm:text-base text-blue-100 break-words">{currentInstructor.specialization}</p>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-semibold"><ShieldCheck className="w-4 h-4 text-[#9ce5d3]"/>{currentInstructor.isActive?t('Active instructor','محاضر نشط'):t('Inactive instructor','محاضر غير نشط')}</span></div>
          </div>
          <div className="hidden sm:grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-4 border-t xl:border-t-0 xl:border-s border-white/20 pt-5 xl:pt-0 xl:ps-7">
            {[{Icon:IdCard,label:t('Instructor ID','كود المحاضر'),value:currentInstructor.instructorCode},{Icon:Layers,label:t('Current camp','الكامب الحالي'),value:campName},{Icon:Mail,label:t('Email','البريد الإلكتروني'),value:currentInstructor.email}].map(({Icon,label,value})=><div className="flex items-start gap-3 min-w-0" key={label}><Icon className="w-5 h-5 mt-1 shrink-0 text-blue-100"/><div className="min-w-0"><p className="text-xs text-blue-100/85">{label}</p><p className="text-sm font-semibold break-words mt-0.5">{value||'—'}</p></div></div>)}
          </div>
        </div>
        <div className="sm:hidden flex items-center gap-2 border-t border-white/20 pt-2.5 mt-3 text-xs"><Layers className="w-4 h-4 shrink-0 text-blue-100"/><span className="min-w-0 break-words">{campName}</span></div>
      </section>
      <section aria-label={t('Teaching progress','تقدم المحاضرات')} className={SURFACE_CARD+' instructor-profile-progress rounded-2xl p-3.5 sm:p-6'}>
        <div className="flex items-center gap-2 mb-3 sm:mb-5"><ChartNoAxesCombined className="w-5 h-5 text-[#355F82] dark:text-[#88A9CC]"/><h2 className="text-base sm:text-lg font-bold">{t('Teaching progress','تقدم المحاضرات')}</h2></div>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-3 sm:gap-5 items-center">
          <div className="flex items-center gap-4 sm:gap-6 lg:border-e border-slate-200 dark:border-slate-700 lg:pe-5">
            <div role="progressbar" aria-label={t('Camp completion','إنجاز الكامب')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="relative w-16 h-16 sm:w-28 sm:h-28 shrink-0">
              <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90" aria-hidden="true"><circle cx="60" cy="60" r="49" fill="none" stroke="currentColor" strokeWidth="10" className="text-slate-200 dark:text-slate-700"/>{percent>0&&<circle cx="60" cy="60" r="49" fill="none" stroke="#159c91" strokeWidth="10" pathLength="100" strokeDasharray={percent+' 100'} strokeLinecap="round"/>}</svg><span className="absolute inset-0 flex items-center justify-center text-lg sm:text-2xl font-bold tabular-nums">{percent}%</span>
            </div>
            <div className="min-w-0"><p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">{t('Camp completion','إنجاز الكامب')}</p><p className="text-xl sm:text-2xl font-bold tabular-nums mt-1">{progress.counted} / {progress.assigned}</p><p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('Counted sessions','المحاضرات المحتسبة')}</p></div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[{Icon:CalendarDays,label:t('Assigned','المسندة'),n:progress.assigned,style:'bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200'},{Icon:CheckCircle2,label:t('Counted','المحتسبة'),n:progress.counted,style:'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'},{Icon:Hourglass,label:t('Remaining','المتبقية'),n:progress.remaining,style:'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}].map(({Icon,label,n,style})=><div key={label} className={'rounded-xl p-2 sm:p-4 flex flex-col xl:flex-row xl:items-center gap-1 sm:gap-2 min-w-0 '+style}><Icon className="hidden sm:block w-5 h-5 shrink-0"/><div className="min-w-0"><p className="text-[11px] sm:text-xs font-medium break-words">{label}</p><p className="text-xl sm:text-2xl font-bold tabular-nums">{n}</p></div></div>)}
            <div className="hidden sm:block col-span-3 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mt-2" aria-hidden="true"><div className="bg-[#159c91] h-full rounded-full" style={{width:percent+'%'}}/></div>
          </div>
        </div>
      </section>
      <div role="group" aria-label={t('Profile sections','أقسام الملف الشخصي')} className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-3">
        {([{id:'groups',en:'My Groups',ar:'مجموعاتي',Icon:Users},{id:'personal',en:'Personal Info',ar:'البيانات الشخصية',Icon:UserCircle},{id:'links',en:'Evaluations',ar:'التقييمات',Icon:Star},{id:'requests',en:'Requests',ar:'طلباتي',Icon:MessageSquare}] as const).map(({id,en,ar,Icon})=><button type="button" key={id} onClick={()=>setSubTab(id)} aria-pressed={subTab===id} className={'flex justify-center items-center gap-2 rounded-lg sm:rounded-xl px-2 sm:px-3 py-2 sm:py-3 min-h-[44px] sm:min-h-[48px] text-xs sm:text-sm font-semibold border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 '+(subTab===id?'bg-[#175e70] border-[#175e70] text-white':'bg-white dark:bg-[#1D2023] border-slate-200 dark:border-[#353A3F] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800')}><Icon className="w-4 h-4 shrink-0"/>{t(en,ar)}</button>)}
      </div>
      {subTab==='groups'&&<section aria-label={t('Assigned training groups','المجموعات التدريبية المسندة')} className={SURFACE_CARD+' rounded-2xl p-3 sm:p-6 space-y-3 sm:space-y-4'}>
        <div className="flex justify-between items-start gap-3"><div className="flex items-start gap-3"><Users className="w-6 h-6 text-[#355F82] dark:text-[#88A9CC] shrink-0 mt-1"/><div><h2 className="font-bold text-base sm:text-lg">{t('Assigned Training Groups','المجموعات التدريبية المسندة')}</h2><p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('Your groups in the selected camp','مجموعاتك في الكامب المحدد')}</p></div></div><StatusBadge tone="info">{myGroups.length} {t('Groups','مجموعات')}</StatusBadge></div>
        {!myGroups.length?<EmptyState icon={Users} title={t('No groups assigned in this camp','لا توجد مجموعات مسندة في هذا الكامب')}/>:myGroups.map(g=>{
          const ls=myLectures.filter(l=>l.groupId===g.id), gs=sessionCounts(ls,attendanceSheets,entitlements,currentInstructor.id);
          const n=students.filter(st=>st.campId===g.campId&&st.groupId===g.id&&st.isActive).length, room=rooms.find(r=>r.id===g.defaultRoomId);
          const pct=gs.assigned?Math.round(gs.finished/gs.assigned*100):0;
          return <article key={g.id} className="rounded-xl border border-slate-200 dark:border-[#353A3F] p-3 sm:p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,.8fr)] items-center gap-3 sm:gap-4">
            <div className="flex gap-3 items-center min-w-0"><div className="rounded-xl bg-[#235e79] text-white p-2 sm:p-3 shrink-0"><Laptop className="w-6 h-6"/></div><div className="min-w-0"><h3 className="font-bold break-words">{t(g.nameEn,g.nameAr)}</h3><p className="text-xs text-slate-500 dark:text-slate-400 mt-1 break-all">{g.code}{room?' · '+room.name:''}</p><p className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 mt-1"><Users className="w-3.5 h-3.5"/>{n} {t('students','طلاب')} · {t('Capacity','السعة')} {g.capacity}</p></div></div>
            <div className="grid grid-cols-3 gap-2 text-center border-t lg:border-t-0 lg:border-s border-slate-200 dark:border-slate-700 pt-3 lg:pt-0 lg:ps-3">{[[t('Sessions','المحاضرات'),gs.assigned],[t('Finished','المنتهية'),gs.finished],[t('Remaining','المتبقية'),gs.assigned-gs.finished]].map(([label,value])=><div key={label}><p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p><p className="text-lg font-bold tabular-nums">{value}</p></div>)}</div>
            <div className="min-w-0 space-y-2"><div className="flex justify-between text-xs"><span>{t('Completion','الإنجاز')}</span><strong className="text-emerald-700 dark:text-emerald-300">{pct}%</strong></div><div role="progressbar" aria-label={t('Group completion','إنجاز المجموعة')+' '+t(g.nameEn,g.nameAr)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"><div className="bg-[#159c91] h-full rounded-full" style={{width:pct+'%'}}/></div></div>
          </article>})}
        <button type="button" className={BTN_SECONDARY+' min-h-[44px]'} onClick={()=>setInstructorRoute('schedule')}>{t('View all sessions','عرض كل المحاضرات')} <ArrowUpRight className="w-4 h-4"/></button>
      </section>}
      {subTab==='personal'&&<section aria-label={t('Personal information','البيانات الشخصية')} className={SURFACE_CARD+' rounded-2xl p-3.5 sm:p-6 space-y-3 sm:space-y-4'}>
        <div><h2 className="text-lg font-bold">{t('Personal information','البيانات الشخصية')}</h2><p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('Contact Operations to update account information.','تواصل مع الإدارة لتعديل بيانات الحساب.')}</p></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{[{Icon:UserCircle,label:t('Full name','الاسم الكامل'),value:displayName},{Icon:IdCard,label:t('Instructor ID','كود المحاضر'),value:currentInstructor.instructorCode},{Icon:AtSign,label:t('Username','اسم المستخدم'),value:currentInstructor.username},{Icon:Mail,label:t('Email address','البريد الإلكتروني'),value:currentInstructor.email},{Icon:Phone,label:t('Phone','الهاتف'),value:currentInstructor.phone},{Icon:GraduationCap,label:t('Specialization','التخصص'),value:currentInstructor.specialization}].map(({Icon,label,value})=><div key={label} className={SURFACE_SUBTLE+' p-4 flex items-start gap-3 min-w-0'}><Icon className="w-5 h-5 text-[#355F82] dark:text-[#88A9CC] shrink-0"/><div className="min-w-0"><p className="text-xs text-slate-500 dark:text-slate-400">{label}</p><p className="font-semibold text-sm break-all mt-1">{value||'—'}</p></div></div>)}</div>
        {currentInstructor.bio&&<p className="text-sm whitespace-pre-wrap break-words">{currentInstructor.bio}</p>}
      </section>}

      {subTab === 'links' && (
        <div className={`${SURFACE_CARD} rounded-2xl p-3.5 sm:p-6 space-y-3 sm:space-y-4 text-sm`}>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('My Survey & Evaluation Links', 'روابط التقييم والاستبيانات')}
          </h2>
          {mySurveys.length > 0 ? (
            mySurveys.map((srv) => (
              <div
                key={srv.id}
                className={`${SURFACE_SUBTLE} p-4 flex items-center justify-between gap-3`}
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 dark:text-white">{srv.title}</p>
                  <p className="font-mono text-slate-500 mt-0.5 truncate">{srv.url}</p>
                </div>
                <StatusBadge tone="info">
                  <span className="font-mono tabular-nums">{srv.averageScore.toFixed(1)} / 5.0</span>
                  <ExternalLink className="w-3 h-3" />
                </StatusBadge>
              </div>
            ))
          ) : (
            <p className="text-slate-500 py-4">{t('No survey links assigned yet.', 'لا توجد روابط حالياً.')}</p>
          )}
        </div>
      )}

      {subTab === 'requests' && (
        <div className={`${SURFACE_CARD} rounded-2xl p-3.5 sm:p-6 space-y-3 sm:space-y-4 text-sm`}>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('Submit & Track Requests', 'تقديم ومتابعة الطلبات')}
          </h2>

          {reqFeedback && (
            <InlineBanner
              type={reqFeedback.ok ? 'success' : 'error'}
              message={reqFeedback.text}
              onDismiss={() => setReqFeedback(null)}
            />
          )}

          <form onSubmit={handleCreateRequest} className="space-y-3">
            <div>
              <label htmlFor="req-subject" className={LABEL_CLASS}>
                {t('Subject *', 'عنوان الطلب *')}
              </label>
              <input
                id="req-subject"
                type="text"
                required
                placeholder={t('e.g. Room projector check or schedule swap', 'عنوان الطلب...')}
                value={reqSubject}
                onChange={(e) => setReqSubject(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="req-details" className={LABEL_CLASS}>
                {t('Details *', 'التفاصيل *')}
              </label>
              <textarea
                id="req-details"
                rows={2}
                required
                placeholder={t('Describe details or operational reason...', 'التفاصيل أو السبب...')}
                value={reqDetails}
                onChange={(e) => setReqDetails(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <button
              type="submit"
              disabled={isBusy}
              className={`${BTN_PRIMARY} min-h-[44px]`}
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {isBusy
                  ? t('Sending...', 'جاري الإرسال...')
                  : t('Send Request to Operations', 'إرسال الطلب للإدارة')}
              </span>
            </button>
          </form>

          {myRequests.length > 0 && (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 pt-2">
              {myRequests.map((r) => (
                <div key={r.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-white">{r.subject}</p>
                    <p className="text-slate-500 mt-0.5">{r.details}</p>
                  </div>
                  <StatusBadge
                    tone={
                      r.status === RequestStatus.APPROVED
                        ? 'success'
                        : r.status === RequestStatus.REJECTED
                        ? 'danger'
                        : 'warning'
                    }
                  >
                    {r.status === RequestStatus.APPROVED
                      ? t('Approved', 'مقبول')
                      : r.status === RequestStatus.REJECTED
                      ? t('Rejected', 'مرفوض')
                      : t('Pending', 'معلق')}
                  </StatusBadge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
