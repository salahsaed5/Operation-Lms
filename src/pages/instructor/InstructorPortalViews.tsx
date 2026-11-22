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
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { calculateHaversineDistanceMeters, resolveStudentOriginGroupForDay } from '../../domain/businessRules';
import { classifyGpsVerification, requiredGpsAccuracyMeters } from '../../domain/checkinGpsQuality';
import { studentEligibleForCampDay } from '../../domain/studentJoinDay';
import { studentsForSelectedLecture } from '../../domain/instructorLectureRoster';
import { compressSelfieUnderLimit, getSignedSelfieUrl, searchVisitingStudentsInDb, type VisitingStudentLookupResult } from '../../services/citsRepository';
import {
  AttendanceMark,
  AttendanceRecordItem,
  AttendanceSheetStatus,
  CheckinStatus,
  CampStatus,
  EntitlementStatus,
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

export const InstructorDashboardView: React.FC = () => {
  const {
    activeCamp,
    auth,
    instructors,
    lectures,
    groups,
    rooms,
    checkins,
    attendanceSheets,
    setInstructorRoute,
    openInstructorAttendance,
    t,
  } = useApp();

  const currentInstructor =
    instructors.find((i) => i.id === auth.activeInstructorId) || instructors[0];

  if (!activeCamp || !currentInstructor) {
    return (
      <EmptyState
        icon={CalendarClock}
        title={t('No active camp assignment', 'لا يوجد تعيين معسكر نشط')}
        description={t(
          'Your account does not have an active camp assignment at the moment.',
          'حسابك غير مرتبط بمعسكر نشط حالياً.'
        )}
      />
    );
  }

  const myLecturesToday = lectures
    .filter(
      (l) =>
        l.campId === activeCamp.id &&
        l.campDay === activeCamp.currentCampDay &&
        (l.instructorId === currentInstructor.id ||
          l.substituteInstructorId === currentInstructor.id)
    )
    .sort((a, b) => a.periodNumber - b.periodNumber);

  const myCheckinToday = checkins.find(
    (c) =>
      c.campId === activeCamp.id &&
      c.instructorId === currentInstructor.id &&
      c.campDay === activeCamp.currentCampDay
  );

  const nextLecture =
    myLecturesToday.find((l) => l.status !== 'completed') || myLecturesToday[0];

  const assignedLectureIds = new Set(
    lectures
      .filter(
        (l) =>
          l.campId === activeCamp.id &&
          (l.instructorId === currentInstructor.id ||
            l.substituteInstructorId === currentInstructor.id)
      )
      .map((l) => l.id)
  );

  const myDraftSheets = attendanceSheets.filter(
    (s) =>
      s.campId === activeCamp.id &&
      s.status === AttendanceSheetStatus.DRAFT &&
      assignedLectureIds.has(s.lectureId)
  );

  const checkinDisplay = myCheckinToday
    ? instructorCheckinBadge(myCheckinToday.status, t)
    : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t(
          `Welcome, ${currentInstructor.fullNameEn}`,
          `مرحباً، ${currentInstructor.fullNameAr}`
        )}
        subtitle={
          <>
            {t(activeCamp.nameEn, activeCamp.nameAr)} ·{' '}
            <span className="font-mono tabular-nums">
              {t(
                `Day ${activeCamp.currentCampDay} of ${activeCamp.durationDays}`,
                `اليوم ${activeCamp.currentCampDay} من ${activeCamp.durationDays}`
              )}
            </span>
          </>
        }
      />

      {/* 1. Daily Check-in Priority Card */}
      <section aria-labelledby="inst-priority-checkin" className={`${SURFACE_CARD} p-5`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                {t('1. Daily Venue Check-in', '1. تسجيل الوصول اليومي')}
              </span>
              {checkinDisplay ? (
                <StatusBadge tone={checkinDisplay.tone}>{checkinDisplay.label}</StatusBadge>
              ) : (
                <StatusBadge tone="warning">
                  {t('Action Required', 'مطلوب قبل المحاضرة')}
                </StatusBadge>
              )}
            </div>

            <h2
              id="inst-priority-checkin"
              className="text-base sm:text-lg font-bold text-slate-900 dark:text-white"
            >
              {myCheckinToday
                ? checkinDisplay?.label
                : t(
                    'Complete your GPS & selfie venue check-in before starting',
                    'أكمل تسجيل الوصول بالموقع وصورة التحقق قبل بدء المحاضرة'
                  )}
            </h2>

            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {myCheckinToday
                ? `${myCheckinToday.distanceFromVenueMeters}m ${t('from venue', 'عن المقر')} · ${myCheckinToday.selfieSizeKb}KB`
                : t(
                    `Geofence: ${activeCamp.settings.geofenceRadiusMeters}m · Compressed photo <= ${activeCamp.settings.maxSelfieKb}KB`,
                    `النطاق: ${activeCamp.settings.geofenceRadiusMeters}م · صورة التحقق <= ${activeCamp.settings.maxSelfieKb}KB`
                  )}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setInstructorRoute('checkin')}
            className={`${BTN_PRIMARY} min-h-[44px] px-4`}
          >
            <MapPinCheck className="w-4 h-4" />
            <span>
              {myCheckinToday
                ? t('View Check-in Receipt', 'عرض إيصال التسجيل')
                : t('Check In Now', 'تسجيل الوصول الآن')}
            </span>
          </button>
        </div>
      </section>

      {/* 2. Next Assigned Lecture */}
      {nextLecture && (
        <section aria-labelledby="inst-priority-next-lecture" className={`${SURFACE_CARD} p-5`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 font-mono tabular-nums">
                {t('2. Next Assigned Lecture', '2. المحاضرة التالية')} · P
                {nextLecture.periodNumber} ({nextLecture.startTime}–{nextLecture.endTime})
              </p>
              <h2
                id="inst-priority-next-lecture"
                className="text-base sm:text-lg font-bold text-slate-900 dark:text-white"
              >
                {nextLecture.topic}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {groups.find((g) => g.id === nextLecture.groupId)?.code} ·{' '}
                {rooms.find((r) => r.id === nextLecture.roomId)?.code} ·{' '}
                <span className="font-mono tabular-nums font-semibold text-slate-700 dark:text-slate-300">
                  {nextLecture.frozenRateEgp} EGP
                </span>
              </p>
            </div>

            <button
              type="button"
              onClick={() => openInstructorAttendance(nextLecture.id)}
              className={`${BTN_SECONDARY} min-h-[44px] px-4`}
            >
              <ClipboardCheck className="w-4 h-4 text-blue-600" />
              <span>{t('Open Attendance Sheet', 'فتح كشف الحضور')}</span>
            </button>
          </div>
        </section>
      )}

      {/* 3. Today's Schedule & 4. Pending Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <section
          aria-labelledby="inst-daily-schedule"
          className={`lg:col-span-7 ${SURFACE_CARD} p-5 space-y-4`}
        >
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h2
              id="inst-daily-schedule"
              className="text-sm font-bold text-slate-900 dark:text-white"
            >
              {t('3. Today’s Schedule', '3. جدولي اليومي')}
            </h2>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {myLecturesToday.length} {t('Lectures', 'محاضرات')}
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {myLecturesToday.length === 0 ? (
              <p className="py-6 text-xs text-slate-500 text-center">
                {t('No lectures assigned to you today.', 'لا توجد محاضرات مسندة لك اليوم.')}
              </p>
            ) : (
              myLecturesToday.map((lec) => {
                const grp = groups.find((g) => g.id === lec.groupId);
                const room = rooms.find((r) => r.id === lec.roomId);
                const sheet = attendanceSheets.find((s) => s.lectureId === lec.id);
                const isSynced =
                  sheet?.status === AttendanceSheetStatus.SUBMITTED ||
                  sheet?.status === AttendanceSheetStatus.LOCKED;
                return (
                  <div
                    key={lec.id}
                    className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                        P{lec.periodNumber} · {lec.startTime}–{lec.endTime} · {room?.code}
                      </p>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5 truncate">
                        {lec.topic}
                      </p>
                      <p className="text-slate-500 truncate">
                        {grp ? t(grp.nameEn, grp.nameAr) : lec.groupId}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isSynced ? (
                        <StatusBadge tone="success">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{t('Submitted', 'معتمد')}</span>
                        </StatusBadge>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openInstructorAttendance(lec.id)}
                          className={`${BTN_PRIMARY} min-h-[40px]`}
                        >
                          {t('Take Attendance', 'تسجيل الحضور')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section
          aria-labelledby="inst-pending-actions"
          className={`lg:col-span-5 ${SURFACE_CARD} p-5 space-y-4`}
        >
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h2
              id="inst-pending-actions"
              className="text-sm font-bold text-slate-900 dark:text-white"
            >
              {t('4. Pending Actions', '4. إجراءات معلقة')}
            </h2>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {myDraftSheets.length}
            </span>
          </div>

          <div className="space-y-3 text-xs">
            {myDraftSheets.map((draft) => (
              <div
                key={draft.id}
                className="p-3.5 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/30 flex items-center justify-between gap-3"
              >
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {t(
                      `Pending Sheet — Period ${draft.periodNumber}`,
                      `مسودة كشف حضور — الفترة ${draft.periodNumber}`
                    )}
                  </p>
                  <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                    {t(
                      'Submit your attendance sheet once marking is complete.',
                      'يرجى اعتماد وإرسال كشف الحضور فور الانتهاء.'
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openInstructorAttendance(draft.lectureId)}
                  className={`${BTN_PRIMARY} min-h-[40px]`}
                >
                  {t('Review', 'مراجعة')}
                </button>
              </div>
            ))}

            {myDraftSheets.length === 0 && (
              <p className="text-slate-500 py-5 text-center">
                {t(
                  'All daily tasks and attendance sheets are up to date.',
                  'جميع المهام وكشوف الحضور محدثة بالكامل.'
                )}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export const InstructorScheduleView: React.FC = () => {
  const {
    activeCamp,
    auth,
    instructors,
    lectures,
    groups,
    rooms,
    t,
  } = useApp();

  const [dayFilter, setDayFilter] = useState<'all' | number>('all');
  const currentInstructor =
    instructors.find((i) => i.id === auth.activeInstructorId) || instructors[0];

  if (!activeCamp || !currentInstructor) {
    return (
      <EmptyState
        icon={CalendarClock}
        title={t('No schedule records available', 'لا توجد محاضرات مجدولة حالياً')}
      />
    );
  }

  const myLectures = lectures
    .filter(
      (l) =>
        l.campId === activeCamp.id &&
        (l.instructorId === currentInstructor.id ||
          l.substituteInstructorId === currentInstructor.id) &&
        (dayFilter === 'all' || l.campDay === dayFilter)
    )
    .sort((a, b) => a.campDay - b.campDay || a.periodNumber - b.periodNumber);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('My Teaching Schedule', 'جدول محاضراتي')}
        subtitle={t(
          'Assigned lectures appear automatically. Review dates, rooms, and revisions without an approval step.',
          'المحاضرات بتظهر تلقائيًا بمجرد ما الإدارة تضيفها أو تعدلها، من غير ما تحتاج توافق على الجدول.'
        )}
        actions={
          <select
            aria-label={t('Filter schedule by day', 'تصفية الجدول باليوم')}
            value={dayFilter}
            onChange={(e) =>
              setDayFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
            }
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
          >
            <option value="all">{t('All Camp Days', 'كل أيام المعسكر')}</option>
            {Array.from({ length: activeCamp.durationDays }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {t(`Day ${d}`, `اليوم ${d}`)}
              </option>
            ))}
          </select>
        }
      />

      {myLectures.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={t('No lectures assigned', 'لا توجد محاضرات مسندة في هذا النطاق')}
        />
      ) : (
        <div className="space-y-3">
          {myLectures.map((lec) => {
            const grp = groups.find((g) => g.id === lec.groupId);
            const room = rooms.find((r) => r.id === lec.roomId);
            const isSubstitute = lec.substituteInstructorId === currentInstructor.id;
            return (
              <div
                key={lec.id}
                className={`${SURFACE_CARD} p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4`}
              >
                <div className="space-y-1 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                      {t(`Day ${lec.campDay}`, `اليوم ${lec.campDay}`)} · P{lec.periodNumber} (
                      {lec.startTime}–{lec.endTime}) · {room?.code}
                    </span>
                    {isSubstitute && (
                      <StatusBadge tone="info">{t('Substitute', 'محاضر بديل')}</StatusBadge>
                    )}
                  </div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    {lec.topic}
                  </h2>
                  <p className="text-slate-500">
                    {grp ? t(grp.nameEn, grp.nameAr) : lec.groupId} ·{' '}
                    <span className="font-mono tabular-nums font-semibold text-slate-700 dark:text-slate-300">
                      {lec.frozenRateEgp} EGP
                    </span>
                  </p>
                </div>

                <StatusBadge tone="info">{t('Assigned — No Approval Needed', 'تم الإسناد — بدون موافقة')}</StatusBadge>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

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
            <p className="text-slate-600 dark:text-slate-300">
              {t('Recorded at', 'تم التسجيل الساعة')}{' '}
              {new Date(existingCheckin.serverTimestamp).toLocaleTimeString()}
            </p>
          </div>
          {signedReceiptUrl && (
            <img
              src={signedReceiptUrl}
              alt={t('Uploaded check-in selfie', 'صورة التحقق المرفوعة')}
              className="w-16 h-16 rounded-lg object-cover border border-slate-200 dark:border-slate-700"
            />
          )}
        </div>
      )}

      <form onSubmit={handleCheckin} className={`${SURFACE_CARD} p-5 sm:p-6 space-y-5`}>

        <section className={`${SURFACE_SUBTLE} p-4 space-y-2`}>
          <p className="text-sm font-bold text-slate-900 dark:text-white">{t(venue.nameEn, venue.nameAr)}</p>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t('Open the camera, allow precise location access, and take a fresh selfie. Location verification happens automatically.',
                'افتح الكاميرا، واسمح للموقع الدقيق، واتصور صورة جديدة. التحقق من الموقع بيتم تلقائيًا.')}
          </p>
          {gpsMessage && <p className="text-xs text-slate-500 dark:text-slate-400">{gpsMessage}</p>}
        </section>

        <section aria-live="polite" aria-label={t('Location verification result','نتيجة التحقق من الموقع')}
          className={`rounded-xl border p-4 sm:p-5 space-y-3 ${
            displayQuality === 'good'
              ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30'
              : displayQuality === 'outside'
                ? 'border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/20'
                : displayQuality === 'missing'
                  ? 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40'
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
              displayQuality === 'missing' ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200' :
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
            <p className="text-slate-600 dark:text-slate-300">
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
                  className="w-16 h-16 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                />
              ) : (
                <Camera className="w-5 h-5 text-blue-600 shrink-0" />
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
          disabled={isBusy || cameraOpen || cameraCapturing || !selfieBlob || !maySubmitGps || Boolean(existingCheckin) || activeCamp.status !== CampStatus.ACTIVE}
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
    instructorAttendanceLectureId: selectedLectureId,
    setInstructorAttendanceLectureId: setSelectedLectureId,
    saveAttendanceDraft,
    enrollMidcampStudent,
    submitAndSyncAttendanceSheet,
    reviewAttendanceDraft,
    t,
  } = useApp();

  const currentInstructor =
    instructors.find((i) => i.id === auth.activeInstructorId) || instructors[0];

  const myLectures =
    activeCamp && currentInstructor
      ? lectures.filter(
          (l) =>
            l.campId === activeCamp.id &&
            (l.instructorId === currentInstructor.id ||
              l.substituteInstructorId === currentInstructor.id)
        )
      : [];

  // One query drives both the visible roster and the scoped server-side
  // visitor lookup. No second input or separate student-selection step.
  const [studentSearch, setStudentSearch] = useState('');
  const [attendanceStatusFilter, setAttendanceStatusFilter] = useState<AttendanceRosterFilter>('all');
  const [secureVisitingMatches, setSecureVisitingMatches] = useState<VisitingStudentLookupResult[]>([]);
  const [lastCompletedVisitQuery, setLastCompletedVisitQuery] = useState('');
  const [visitingLookupError, setVisitingLookupError] = useState<string | null>(null);
  const [visitingSearchBusy, setVisitingSearchBusy] = useState(false);
  const [visitingSourceGroupCodes, setVisitingSourceGroupCodes] = useState<Record<string,string>>({});
  const [showMidcampEnrollForm, setShowMidcampEnrollForm] = useState(false);
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentCode, setNewStudentCode] = useState('');
  const [newStudentUniversity, setNewStudentUniversity] = useState('');
  const [newStudentReason, setNewStudentReason] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [comparisonRows, setComparisonRows] = useState<Array<{
    studentId: string; studentCode: string; studentName: string;
    localMark: string; serverMark: string; localNote?: string; serverNote?: string;
  }> | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);

  useEffect(() => {
    if (myLectures.length > 0 && !myLectures.some((l) => l.id === selectedLectureId)) {
      const preferred =
        myLectures.find((l) => l.campDay === activeCamp?.currentCampDay) || myLectures[0];
      setSelectedLectureId(preferred.id);
    }
  }, [myLectures, selectedLectureId, activeCamp?.currentCampDay]);

  // RLS intentionally restricts direct students reads to assigned groups.
  // Use a narrowly authorized, lecture-scoped RPC for visitors; never widen RLS.
  useEffect(() => {
    let cancelled = false;
    const term = studentSearch.trim();
    if (!isSupabaseMode || !selectedLectureId || term.length < 2) {
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
  }, [isSupabaseMode, selectedLectureId, studentSearch]);

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
  const canFinalizeAttendance = campOpenForAttendance && !lectureIsFuture;

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
    if (isLockedOrSubmitted || !selectedLecture) return;
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
        setNewStudentCode('');
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
                  className="p-3.5 sm:p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-950/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="grid grid-cols-3 gap-2 w-full md:w-[280px] shrink-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white break-words">
                        {highlightAttendanceSearchMatch(rec.studentName, searchTerm)}
                      </p>
                      {rec.isCrossGroup ? (
                        <StatusBadge tone="info">
                          {t('Visitor from', 'زائر من')} {visitingGroupName(rec.studentId)}
                        </StatusBadge>
                      ) : (
                        <span className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
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

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isLockedOrSubmitted}
                      onClick={() => handleMarkChange(rec.studentId, AttendanceMark.PRESENT)}
                      aria-pressed={rec.mark === AttendanceMark.PRESENT}
                      className={`min-h-[44px] w-full px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                        rec.mark === AttendanceMark.PRESENT
                          ? 'bg-emerald-600 text-white'
                          : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {t('Present', 'حاضر')}
                    </button>
                    <button
                      type="button"
                      disabled={isLockedOrSubmitted}
                      onClick={() => handleMarkChange(rec.studentId, AttendanceMark.LATE)}
                      aria-pressed={rec.mark === AttendanceMark.LATE}
                      className={`min-h-[44px] w-full px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                        rec.mark === AttendanceMark.LATE
                          ? 'bg-amber-600 text-white'
                          : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {t('Late', 'متأخر')}
                    </button>
                    <button
                      type="button"
                      disabled={isLockedOrSubmitted}
                      onClick={() => handleMarkChange(rec.studentId, AttendanceMark.ABSENT)}
                      aria-pressed={rec.mark === AttendanceMark.ABSENT}
                      className={`min-h-[44px] w-full px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                        rec.mark === AttendanceMark.ABSENT
                          ? 'bg-red-600 text-white'
                          : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
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
      <PageHeader
        title={t('Lecture Attendance', 'تسجيل حضور المحاضرة')}
        subtitle={t(
          'Search, filter and mark attendance for the selected lecture.',
          'بحث وفلترة وتسجيل حضور طلاب المحاضرة المختارة.'
        )}
        actions={
          <div className="flex flex-col gap-1.5 w-full sm:w-[380px]">
            <label
              htmlFor="instructor-attendance-lecture"
              className="text-xs font-bold text-slate-700 dark:text-slate-200"
            >
              {t('Lecture & group', 'المحاضرة والجروب')}
            </label>
            <select
              id="instructor-attendance-lecture"
              aria-label={t('Select lecture and group for attendance', 'اختر المحاضرة والجروب للحضور')}
              value={selectedLectureId}
              onChange={(e) => {
                setSelectedLectureId(e.target.value);
                // Search and visiting-student selections belong to the old
                // lecture/group. Clear them before displaying the next roster.
                setStudentSearch('');
                setAttendanceStatusFilter('all');
                setSecureVisitingMatches([]);
                setLastCompletedVisitQuery('');
                setVisitingLookupError(null);
                setShowMidcampEnrollForm(false);
                setFeedback(null);
                setComparisonRows(null);
              }}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-semibold max-w-full focus:ring-2 focus:ring-blue-500"
            >
              {myLectures.map((l) => (
                <option key={l.id} value={l.id}>
                  {groups.find(g => g.id === l.groupId)?.code || t('Unknown group', 'جروب غير معروف')} · D{l.campDay} P{l.periodNumber} ({l.startTime}) · {l.topic}
                </option>
              ))}
            </select>
          </div>
        }
      />

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
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm"
          >
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  {t('Selected lecture', 'المحاضرة المختارة')}
                </p>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white break-words">
                  {groups.find(g => g.id === selectedLecture.groupId)?.code || t('Unknown group', 'جروب غير معروف')}
                  {' · '}{selectedLecture.topic}
                </h2>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span>D{selectedLecture.campDay} · P{selectedLecture.periodNumber}</span>
                  <span>{selectedLecture.startTime}–{selectedLecture.endTime}</span>
                  <span>{t('Home-group students', 'طلاب الجروب')}: {studentsForSelectedLecture({
                    lecture: selectedLecture, students, transfers: studentTransfers,
                  }).length}</span>
                </div>
              </div>
              <div className="flex flex-wrap md:flex-col md:items-end gap-2 shrink-0">
                <StatusBadge tone={isLockedOrSubmitted ? 'success' : 'warning'}>
                  {isLockedOrSubmitted
                    ? t('Submitted · Locked', 'معتمد · مغلق')
                    : t('Draft · Editable', 'مسودة · قابلة للتعديل')}
                </StatusBadge>
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  {existingSheet?.syncState === OfflineSyncState.SYNCED
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    : <WifiOff className="w-3.5 h-3.5 text-amber-600" />}
                  {existingSheet?.syncState === OfflineSyncState.SYNCED
                    ? t('Synced', 'متزامن')
                    : t('Local draft / pending sync', 'مسودة محلية / انتظار المزامنة')}
                </span>
              </div>
            </div>
          </section>

          {/* Single live search: home roster appears immediately below; the
              scoped RPC returns visitors without exposing unassigned rosters. */}
          <section aria-label={t('Find and mark student attendance', 'ابحث وسجل حضور طالب')}
            className="space-y-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm"
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
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('Search by student name or code in the roster and other groups.',
                  'ابحث بالاسم أو كود الطالب في الكشف والجروبات التانية.')}
              </p>
            )}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-2">
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
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
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                    >
                      <span>{t(option.en, option.ar)}</span>
                      <span className={`min-w-[20px] rounded-full px-1.5 py-0.5 text-[11px] tabular-nums text-center ${active ? 'bg-white/20 text-white' : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200'}`}>
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
            {studentSearch.trim() && filteredRecords.length === 0 && studentSearch.trim().length < 2 && (
              <p role="status" className="text-xs text-slate-500">
                {t('No match in this sheet. Enter two characters to also search other groups.',
                  'مفيش نتيجة في الكشف ده. اكتب حرفين عشان تبحث في الجروبات التانية كمان.')}
              </p>
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
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      {t('Students in other groups', 'طلاب موجودين في جروبات تانية')}
                    </p>
                    <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                      {visitingMatches.map(stu => (
                        <div key={stu.studentId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-b last:border-b-0 border-slate-100 dark:border-slate-800">
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
                  visitingMatches.length === 0 && filteredRecords.length === 0 && (
                    <p className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-3 text-xs text-slate-600 dark:text-slate-300" role="status">
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
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {t('Attendance roster', 'كشف حضور الطلاب')}
                </h3>
                <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-200 tabular-nums">
                  {filteredRecords.length} / {baseRecords.length}
                </span>
              </div>
              {filteredRecords.length > 0
                ? renderAttendanceRows(filteredRecords, '')
                : <div role="status" className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-5 text-center space-y-3">
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                      {t('No students with this attendance status.', 'مفيش طلاب بالحالة دي حاليًا.')}
                    </p>
                    {attendanceStatusFilter !== 'all' && (
                      <button type="button" onClick={() => setAttendanceStatusFilter('all')}
                        className="text-sm font-semibold text-blue-600 dark:text-blue-400 underline underline-offset-2">
                        {t('Show all students', 'عرض كل الطلاب')}
                      </button>
                    )}
                  </div>
            </section>
          )}

                    {/* Controlled mid-camp Student Enrollment: not a group transfer. */}
          {!isLockedOrSubmitted && (
            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-3 shadow-sm text-xs">
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
                <form id="midcamp-enrollment-form" onSubmit={e => { void handleEnrollMidcampStudent(e); }} className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4">
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
            <section className="space-y-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm">
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
                <div role="status" className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
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
                          <thead className="bg-slate-100 dark:bg-slate-800">
                            <tr>
                              <th className="p-2 text-start">{t('Student / Code', 'الطالب / الكود')}</th>
                              <th className="p-2 text-start">{t('On this device', 'على الجهاز')}</th>
                              <th className="p-2 text-start">{t('On server', 'على السيرفر')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {comparisonRows.map(row => (
                              <tr key={row.studentId} className="border-t border-slate-200 dark:border-slate-700">
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
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 shadow-sm">
              <button
                type="button"
                disabled={isBusy || !canFinalizeAttendance}
                onClick={handleSubmitAndSync}
                className={`${BTN_PRIMARY} min-h-[48px] px-6`}
              >
                <RefreshCw className={`w-4 h-4 ${isBusy ? 'animate-spin' : ''}`} />
                <span>
                  {isBusy
                    ? t('Submitting...', 'جاري الاعتماد...')
                    : t('Submit & Sync Attendance', 'اعتماد ومزامنة الكشف')}
                </span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon={ClipboardCheck}
          title={t('No lectures assigned yet', 'لا توجد محاضرات مسندة لتسجيل الحضور')}
        />
      )}
    </div>
  );
};

export const InstructorProfileAndSectionsView: React.FC = () => {
  const {
    auth,
    instructors,
    groups,
    surveys,
    entitlements,
    requests,
    submitInstructorRequest,
    t,
  } = useApp();

  const [subTab, setSubTab] = useState<'groups' | 'links' | 'history' | 'requests'>('groups');
  const [reqSubject, setReqSubject] = useState('');
  const [reqDetails, setReqDetails] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [reqFeedback, setReqFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const currentInstructor =
    instructors.find((i) => i.id === auth.activeInstructorId) || instructors[0];

  if (!currentInstructor) {
    return (
      <EmptyState
        icon={UserCircle}
        title={t('Instructor profile unavailable', 'بيانات ملف المحاضر غير متاحة')}
      />
    );
  }

  const myGroups = groups.filter((g) => g.primaryInstructorId === currentInstructor.id);
  const mySurveys = surveys.filter((s) => s.instructorId === currentInstructor.id);
  const myEntitlements = entitlements.filter((e) => e.instructorId === currentInstructor.id);
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
    <div className="space-y-5">
      <div className={`${SURFACE_CARD} p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
        <div>
          <p className="text-xs font-mono text-blue-600 dark:text-blue-400">
            {currentInstructor.instructorCode} · {currentInstructor.username}
          </p>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
            {t(currentInstructor.fullNameEn, currentInstructor.fullNameAr)}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {currentInstructor.specialization} · {currentInstructor.email}
          </p>
        </div>
        <div className="text-start sm:text-end">
          <p className="text-xs text-slate-500">{t('Default Lecture Rate', 'فئة المحاضرة الافتراضية')}</p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {currentInstructor.defaultLectureRateEgp} EGP
          </p>
        </div>
      </div>

      {/* Sub-section Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {(
          [
            { id: 'groups', en: 'Groups', ar: 'مجموعاتي' },
            { id: 'links', en: 'Evaluations', ar: 'التقييمات' },
            { id: 'history', en: 'Entitlement History', ar: 'سجل مستحقاتي' },
            { id: 'requests', en: 'My Requests', ar: 'طلباتي' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`min-h-[40px] px-4 py-2 rounded-lg font-semibold transition-colors cursor-pointer ${
              subTab === tab.id
                ? 'bg-blue-600 text-white'
                : 'border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
            }`}
          >
            {t(tab.en, tab.ar)}
          </button>
        ))}
      </div>

      {subTab === 'groups' && (
        <div className={`${SURFACE_CARD} p-5 space-y-3 text-xs`}>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('Assigned Training Groups', 'المجموعات التدريبية المسندة')}
          </h2>
          {myGroups.length === 0 ? (
            <p className="text-slate-500 py-4">{t('No primary groups assigned yet.', 'لا توجد مجموعات مسندة.')}</p>
          ) : (
            myGroups.map((g) => (
              <div
                key={g.id}
                className={`${SURFACE_SUBTLE} p-4 flex items-center justify-between gap-3`}
              >
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {t(g.nameEn, g.nameAr)}
                  </p>
                  <p className="text-slate-500 mt-0.5">{g.track}</p>
                </div>
                <StatusBadge tone="neutral">
                  <span className="font-mono tabular-nums">
                    {t(`Capacity: ${g.capacity}`, `السعة: ${g.capacity}`)}
                  </span>
                </StatusBadge>
              </div>
            ))
          )}
        </div>
      )}

      {subTab === 'links' && (
        <div className={`${SURFACE_CARD} p-5 space-y-3 text-xs`}>
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

      {subTab === 'history' && (
        <div className={`${SURFACE_CARD} p-5 space-y-3 text-xs`}>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('My Lecture Entitlement History (EGP)', 'سجل مستحقات محاضراتي (جنيه مصري)')}
          </h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {myEntitlements.length === 0 ? (
              <p className="py-4 text-slate-500">{t('No entitlement records yet.', 'لا توجد مستحقات مسجلة بعد.')}</p>
            ) : (
              myEntitlements.map((ent) => (
                <div key={ent.id} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-white font-mono">
                        Day {ent.campDay} · P{ent.periodNumber}
                      </span>
                      <StatusBadge
                        tone={
                          ent.status === EntitlementStatus.ELIGIBLE ||
                          ent.status === EntitlementStatus.APPROVED
                            ? 'success'
                            : ent.status === EntitlementStatus.EXCLUDED
                            ? 'danger'
                            : 'warning'
                        }
                      >
                        {ent.status === EntitlementStatus.APPROVED
                          ? t('Approved', 'معتمد')
                          : ent.status === EntitlementStatus.ELIGIBLE
                          ? t('Eligible', 'مستحق')
                          : ent.status === EntitlementStatus.EXCLUDED
                          ? t('Excluded', 'مستبعد')
                          : t('Pending Review', 'قيد المراجعة')}
                      </StatusBadge>
                    </div>
                    <p className="text-slate-500 mt-1">{ent.eligibilityReason}</p>
                  </div>
                  <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white shrink-0">
                    {ent.entitlementAmountEgp.toLocaleString()} EGP
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {subTab === 'requests' && (
        <div className={`${SURFACE_CARD} p-5 space-y-4 text-xs`}>
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
