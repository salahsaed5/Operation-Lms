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
  Navigation,
  UserPlus,
  Search,
  CalendarClock,
  UserCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { resolveStudentOriginGroupForDay } from '../../domain/businessRules';
import { compressSelfieUnderLimit, getSignedSelfieUrl } from '../../services/citsRepository';
import {
  AttendanceMark,
  AttendanceRecordItem,
  AttendanceSheetStatus,
  CheckinStatus,
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
    acknowledgeLecture,
    t,
  } = useApp();

  const [ackFeedback, setAckFeedback] = useState<string | null>(null);
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

  const unacknowledgedLectures = myLecturesToday.filter((l) => !l.instructorAcknowledgedAt);

  const handleAck = async (lectureId: string) => {
    setAckFeedback(null);
    const res = await acknowledgeLecture(lectureId);
    if (!res.ok && res.error) setAckFeedback(res.error);
  };

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

      {ackFeedback && (
        <InlineBanner
          type="error"
          message={ackFeedback}
          onDismiss={() => setAckFeedback(null)}
        />
      )}

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
              onClick={() => setInstructorRoute('attendance')}
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
                          onClick={() => setInstructorRoute('attendance')}
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
              {myDraftSheets.length + unacknowledgedLectures.length}
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
                  onClick={() => setInstructorRoute('attendance')}
                  className={`${BTN_PRIMARY} min-h-[40px]`}
                >
                  {t('Review', 'مراجعة')}
                </button>
              </div>
            ))}

            {unacknowledgedLectures.map((lec) => (
              <div
                key={lec.id}
                className={`${SURFACE_SUBTLE} p-3.5 flex items-center justify-between gap-3`}
              >
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {t(
                      `Confirm Schedule Rev ${lec.revisionNumber} (P${lec.periodNumber})`,
                      `تأكيد استلام الجدول (${lec.revisionNumber} - ف${lec.periodNumber})`
                    )}
                  </p>
                  <p className="text-slate-500 mt-0.5">{lec.topic}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleAck(lec.id)}
                  className={`${BTN_SECONDARY} min-h-[40px]`}
                >
                  {t('Confirm', 'تأكيد')}
                </button>
              </div>
            ))}

            {myDraftSheets.length === 0 && unacknowledgedLectures.length === 0 && (
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
    acknowledgeLecture,
    t,
  } = useApp();

  const [dayFilter, setDayFilter] = useState<'all' | number>('all');
  const [ackError, setAckError] = useState<string | null>(null);
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

  const handleAck = async (lectureId: string) => {
    setAckError(null);
    const res = await acknowledgeLecture(lectureId);
    if (!res.ok && res.error) setAckError(res.error);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('My Teaching Schedule', 'جدول محاضراتي')}
        subtitle={t(
          'Review your assigned lectures, rooms, and confirm schedule revisions.',
          'استعرض محاضراتك والقاعات التدريبية وأكّد استلام أي تحديثات في الجدول.'
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

      {ackError && (
        <InlineBanner type="error" message={ackError} onDismiss={() => setAckError(null)} />
      )}

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

                <div className="shrink-0">
                  {lec.instructorAcknowledgedAt ? (
                    <StatusBadge tone="success">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{t('Acknowledged', 'تم التأكيد')}</span>
                    </StatusBadge>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAck(lec.id)}
                      className={`${BTN_PRIMARY} min-h-[44px]`}
                    >
                      {t('Acknowledge Schedule', 'تأكيد استلام الجدول')}
                    </button>
                  )}
                </div>
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

  const [lat, setLat] = useState<number>(venue?.latitude ?? 30.0713);
  const [lng, setLng] = useState<number>(venue?.longitude ?? 31.0168);
  const [gpsAccuracy, setGpsAccuracy] = useState<number>(11);
  const [checkinTime, setCheckinTime] = useState<string>('08:45');
  const [selfieSizeKb, setSelfieSizeKb] = useState<number>(172);
  const [selfieBlob, setSelfieBlob] = useState<Blob | undefined>(undefined);
  const [selfieExt, setSelfieExt] = useState<'webp' | 'jpg'>('webp');
  const [selfieMime, setSelfieMime] = useState<string>('image/webp');
  const [selfiePreviewUrl, setSelfiePreviewUrl] = useState<string | null>(null);
  const [signedReceiptUrl, setSignedReceiptUrl] = useState<string | null>(null);
  const [exceptionReason, setExceptionReason] = useState<string>('');
  const [isBusy, setIsBusy] = useState(false);
  const [resultMsg, setResultMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (venue && !isSupabaseMode) {
      setLat(venue.latitude);
      setLng(venue.longitude);
    }
  }, [venue?.id, isSupabaseMode]);

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

  const handleCaptureGps = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setResultMsg({
        ok: false,
        text: t(
          'Device geolocation is not available in this browser.',
          'خدمة تحديد الموقع غير متاحة في هذا المتصفح.'
        ),
      });
      return;
    }
    setIsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(Number(pos.coords.latitude.toFixed(6)));
        setLng(Number(pos.coords.longitude.toFixed(6)));
        setGpsAccuracy(Math.max(1, Math.round(pos.coords.accuracy)));
        setResultMsg({
          ok: true,
          text: t(
            `GPS snapshot captured (±${Math.round(pos.coords.accuracy)}m accuracy).`,
            `تم التقاط إحداثيات GPS بدقة ±${Math.round(pos.coords.accuracy)} متر.`
          ),
        });
        setIsBusy(false);
      },
      (err) => {
        setResultMsg({
          ok: false,
          text: t(`GPS error: ${err.message}`, `تعذر الحصول على الموقع: ${err.message}`),
        });
        setIsBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSelfieFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsBusy(true);
    setResultMsg(null);
    try {
      const compressed = await compressSelfieUnderLimit(file, activeCamp.settings.maxSelfieKb);
      setSelfieBlob(compressed.blob);
      setSelfieSizeKb(compressed.sizeKb);
      setSelfieExt(compressed.ext);
      setSelfieMime(compressed.mimeType);
      const preview = URL.createObjectURL(compressed.blob);
      setSelfiePreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return preview;
      });
      setResultMsg({
        ok: true,
        text: t(
          `Selfie ready (${compressed.sizeKb} KB · ${compressed.ext.toUpperCase()}).`,
          `تم تجهيز صورة التحقق (${compressed.sizeKb} كيلوبايت).`
        ),
      });
    } catch (err) {
      setResultMsg({
        ok: false,
        text: err instanceof Error ? err.message : t('Selfie processing failed.', 'تعذر معالجة الصورة.'),
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleCheckin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsBusy(true);
    setResultMsg(null);
    try {
      const res = await submitInstructorCheckin({
        instructorId: currentInstructor.id,
        latitude: lat,
        longitude: lng,
        gpsAccuracyMeters: gpsAccuracy,
        selfieSizeKb,
        selfieBlob,
        selfieExt,
        selfieMimeType: selfieMime,
        checkinTimeHHMM: checkinTime,
        exceptionReason: exceptionReason.trim() || undefined,
      });
      setResultMsg({ ok: res.ok, text: res.message });
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
            <p className="font-mono text-slate-600 dark:text-slate-300">
              {existingCheckin.distanceFromVenueMeters}m · {existingCheckin.selfieSizeKb}KB ·{' '}
              {new Date(existingCheckin.serverTimestamp).toISOString().slice(11, 16)} UTC
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
        <div className={`${SURFACE_SUBTLE} p-4 text-xs flex flex-wrap items-center justify-between gap-3`}>
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">
              {t(venue.nameEn, venue.nameAr)}
            </p>
            <p className="text-slate-500 font-mono tabular-nums mt-0.5">
              Pin: ({venue.latitude}, {venue.longitude}) · {t('Geofence:', 'النطاق:')}{' '}
              {activeCamp.settings.geofenceRadiusMeters}m
            </p>
          </div>
          <button
            type="button"
            disabled={isBusy}
            onClick={handleCaptureGps}
            className="min-h-[40px] px-3.5 py-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Navigation className="w-3.5 h-3.5" />
            <span>{t('Capture Device GPS', 'التقاط موقعي الحالي')}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div>
            <label htmlFor="chk-lat" className={LABEL_CLASS}>
              {t('GPS Latitude', 'خط العرض')}
            </label>
            <input
              id="chk-lat"
              type="number"
              step="0.000001"
              min={-90}
              max={90}
              value={lat}
              onChange={(e) => setLat(Number(e.target.value))}
              className={`${INPUT_CLASS} font-mono tabular-nums`}
            />
          </div>
          <div>
            <label htmlFor="chk-lng" className={LABEL_CLASS}>
              {t('GPS Longitude', 'خط الطول')}
            </label>
            <input
              id="chk-lng"
              type="number"
              step="0.000001"
              min={-180}
              max={180}
              value={lng}
              onChange={(e) => setLng(Number(e.target.value))}
              className={`${INPUT_CLASS} font-mono tabular-nums`}
            />
          </div>
          <div>
            <label htmlFor="chk-acc" className={LABEL_CLASS}>
              {t('GPS Accuracy (m)', 'دقة GPS (متر)')}
            </label>
            <input
              id="chk-acc"
              type="number"
              min={0}
              max={500}
              value={gpsAccuracy}
              onChange={(e) => setGpsAccuracy(Number(e.target.value))}
              className={`${INPUT_CLASS} font-mono tabular-nums`}
            />
          </div>
          <div>
            <label htmlFor="chk-time" className={LABEL_CLASS}>
              {isSupabaseMode
                ? t('Server Arrival Timestamp', 'توقيت الوصول الموثق')
                : t('Arrival Time (HH:MM)', 'وقت الوصول')}
            </label>
            <input
              id="chk-time"
              type="time"
              disabled={isSupabaseMode}
              value={checkinTime}
              onChange={(e) => setCheckinTime(e.target.value)}
              className={`${INPUT_CLASS} font-mono tabular-nums`}
            />
          </div>
        </div>

        {/* Camera / File Input */}
        <div className={`${SURFACE_SUBTLE} p-4 flex flex-wrap items-center justify-between gap-4 text-xs`}>
          <div className="flex items-center gap-3">
            {selfiePreviewUrl ? (
              <img
                src={selfiePreviewUrl}
                alt={t('Compressed check-in selfie', 'صورة التحقق')}
                className="w-12 h-12 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
              />
            ) : (
              <Camera className="w-5 h-5 text-blue-600 shrink-0" />
            )}
            <div>
              <p className="font-semibold text-slate-900 dark:text-white">
                {selfieBlob
                  ? t('Verification Selfie Ready', 'صورة التحقق جاهزة للرفع')
                  : t('Select or Capture Verification Selfie', 'اختر أو التقط صورة التحقق')}
              </p>
              <p className="text-slate-500 font-mono tabular-nums mt-0.5">
                {selfieBlob
                  ? `${selfieExt.toUpperCase()}: ${selfieSizeKb} KB / ${activeCamp.settings.maxSelfieKb} KB max`
                  : `${t('Required limit:', 'الحد الأقصى:')} <= ${activeCamp.settings.maxSelfieKb} KB`}
              </p>
            </div>
          </div>

          <label className="min-h-[40px] px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 font-semibold shrink-0 cursor-pointer flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5 text-blue-600" />
            <span>{t('Take / Choose Selfie', 'التقاط / اختيار صورة')}</span>
            <input
              type="file"
              accept="image/*"
              capture="user"
              onChange={handleSelfieFileChange}
              className="sr-only"
            />
          </label>
        </div>

        <div>
          <label htmlFor="chk-exception" className={LABEL_CLASS}>
            {t(
              'Exception Note (Optional — if outside geofence or >=60m late)',
              'سبب طلب الاستثناء (اختياري — في حال التواجد خارج النطاق أو التأخر)'
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
          disabled={isBusy}
          className={`${BTN_PRIMARY} w-full min-h-[48px] text-sm`}
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
    saveAttendanceDraft,
    submitAndSyncAttendanceSheet,
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

  const [selectedLectureId, setSelectedLectureId] = useState<string>('');
  const [studentSearch, setStudentSearch] = useState('');
  const [crossGroupStudentId, setCrossGroupStudentId] = useState<string>('');
  const [isBusy, setIsBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (myLectures.length > 0 && !myLectures.some((l) => l.id === selectedLectureId)) {
      const preferred =
        myLectures.find((l) => l.campDay === activeCamp?.currentCampDay) || myLectures[0];
      setSelectedLectureId(preferred.id);
    }
  }, [myLectures, selectedLectureId, activeCamp?.currentCampDay]);

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
    const groupRoster = students.filter(
      (s) =>
        s.campId === activeCamp.id &&
        s.isActive &&
        resolveStudentOriginGroupForDay({
          student: s,
          transfers: studentTransfers,
          campDay: selectedLecture.campDay,
        }) === selectedLecture.groupId
    );
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

  const filteredRecords = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return baseRecords;
    return baseRecords.filter(
      (r) =>
        r.studentName.toLowerCase().includes(q) ||
        r.studentCode.toLowerCase().includes(q)
    );
  }, [baseRecords, studentSearch]);

  const isLockedOrSubmitted =
    existingSheet?.status === AttendanceSheetStatus.SUBMITTED ||
    existingSheet?.status === AttendanceSheetStatus.LOCKED;

  const rosterStudentIds = new Set(baseRecords.map((r) => r.studentId));
  const eligibleCrossGroupStudents = selectedLecture
    ? students.filter(
        (s) =>
          s.campId === activeCamp.id &&
          s.isActive &&
          !rosterStudentIds.has(s.id) &&
          resolveStudentOriginGroupForDay({
            student: s,
            transfers: studentTransfers,
            campDay: selectedLecture.campDay,
          }) !== selectedLecture.groupId
      )
    : [];

  const handleMarkChange = async (
    studentId: string,
    mark: AttendanceMark | 'unmarked'
  ) => {
    if (isLockedOrSubmitted || !selectedLecture) return;
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

  const handleAddCrossGroupStudent = async () => {
    if (!crossGroupStudentId || !selectedLecture || isLockedOrSubmitted) return;
    const stu = students.find((s) => s.id === crossGroupStudentId);
    if (!stu) return;

    const originGroupId = resolveStudentOriginGroupForDay({
      student: stu,
      transfers: studentTransfers,
      campDay: selectedLecture.campDay,
    });

    const added: AttendanceRecordItem = {
      studentId: stu.id,
      studentCode: stu.studentCode,
      studentName: stu.fullName,
      originGroupId,
      attendedGroupId: selectedLecture.groupId,
      isCrossGroup: originGroupId !== selectedLecture.groupId,
      mark: AttendanceMark.PRESENT,
    };

    const res = await saveAttendanceDraft(
      selectedLectureId,
      [...baseRecords, added],
      true
    );
    if (res.ok) {
      setCrossGroupStudentId('');
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

  const handleSubmitAndSync = async () => {
    if (!selectedLecture || isLockedOrSubmitted) return;
    setIsBusy(true);
    setFeedback(null);
    try {
      const draftRes = await saveAttendanceDraft(selectedLectureId, baseRecords, false);
      if (!draftRes.ok) {
        setFeedback({
          ok: false,
          text: draftRes.error || t('Unable to prepare attendance sheet.', 'تعذر تجهيز كشف الحضور.'),
        });
        return;
      }
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

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Lecture Attendance', 'تسجيل حضور المحاضرة')}
        subtitle={t(
          'Mark student attendance offline or online. Unmarked students become absent upon final submission.',
          'سجل حضور الطلاب في أي وقت؛ يتحول الطلاب غير المحددين إلى غياب عند الاعتماد النهائي فقط.'
        )}
        actions={
          <select
            aria-label={t('Select lecture for attendance', 'اختر المحاضرة')}
            value={selectedLectureId}
            onChange={(e) => {
              setSelectedLectureId(e.target.value);
              setFeedback(null);
            }}
            className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold max-w-full"
          >
            {myLectures.map((l) => (
              <option key={l.id} value={l.id}>
                D{l.campDay} P{l.periodNumber} ({l.startTime}) · {l.topic}
              </option>
            ))}
          </select>
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
        <div className={`${SURFACE_CARD} p-5 space-y-4`}>
          {/* Sheet Status Header */}
          <div className={`${SURFACE_SUBTLE} p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs`}>
            <div className="flex items-center gap-2">
              {existingSheet?.syncState === OfflineSyncState.SYNCED ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <WifiOff className="w-4 h-4 text-amber-600" />
              )}
              <span className="font-semibold text-slate-900 dark:text-white">
                {isLockedOrSubmitted
                  ? t('Submitted & Synced', 'معتمد ومتزامن')
                  : t('Local Draft (Not Yet Submitted)', 'مسودة محلية (لم تُرسل بعد)')}
              </span>
            </div>
            <StatusBadge tone={isLockedOrSubmitted ? 'success' : 'warning'}>
              {isLockedOrSubmitted ? t('Locked', 'مغلق') : t('Editable Draft', 'قابل للتعديل')}
            </StatusBadge>
          </div>

          {/* Search Roster + Visiting Cross-Group Student */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                placeholder={t('Filter students by name or code...', 'ابحث عن طالب بالاسم أو الكود...')}
                aria-label={t('Filter roster students', 'بحث في كشف الطلاب')}
                className={`${INPUT_CLASS} ps-9`}
              />
            </div>

            {!isLockedOrSubmitted && eligibleCrossGroupStudents.length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  aria-label={t('Add cross-group visiting student', 'إضافة طالب زائر من مجموعة أخرى')}
                  value={crossGroupStudentId}
                  onChange={(e) => setCrossGroupStudentId(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">
                    {t('+ Add visiting student from another group...', '+ إضافة طالب زائر من مجموعة أخرى...')}
                  </option>
                  {eligibleCrossGroupStudents.map((stu) => {
                    const g = groups.find((grp) => grp.id === stu.groupId);
                    return (
                      <option key={stu.id} value={stu.id}>
                        {stu.studentCode} · {stu.fullName} ({g?.code || stu.groupId})
                      </option>
                    );
                  })}
                </select>
                <button
                  type="button"
                  disabled={!crossGroupStudentId}
                  onClick={handleAddCrossGroupStudent}
                  className={`${BTN_SECONDARY} shrink-0`}
                >
                  <UserPlus className="w-3.5 h-3.5 text-blue-600" />
                  <span>{t('Add', 'إضافة')}</span>
                </button>
              </div>
            )}
          </div>

          {/* Student Touch Rows */}
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredRecords.length === 0 ? (
              <p className="py-6 text-xs text-slate-500 text-center">
                {t('No matching students in roster.', 'لا يوجد طلاب مطابقون للبحث.')}
              </p>
            ) : (
              filteredRecords.map((rec) => (
                <div
                  key={rec.studentId}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {rec.studentName}
                      </p>
                      {rec.isCrossGroup && (
                        <StatusBadge tone="info">{t('Visitor', 'زائر')}</StatusBadge>
                      )}
                    </div>
                    <p className="text-xs font-mono tabular-nums text-slate-500 mt-0.5">
                      {rec.studentCode} ·{' '}
                      {rec.mark === 'unmarked'
                        ? t('Unmarked', 'غير محدد')
                        : rec.mark === AttendanceMark.PRESENT
                        ? t('Present', 'حاضر')
                        : rec.mark === AttendanceMark.LATE
                        ? t('Late', 'متأخر')
                        : t('Absent', 'غائب')}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isLockedOrSubmitted}
                      onClick={() => handleMarkChange(rec.studentId, AttendanceMark.PRESENT)}
                      className={`min-h-[44px] flex-1 sm:flex-initial px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
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
                      className={`min-h-[44px] flex-1 sm:flex-initial px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
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
                      className={`min-h-[44px] flex-1 sm:flex-initial px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                        rec.mark === AttendanceMark.ABSENT
                          ? 'bg-red-600 text-white'
                          : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {t('Absent', 'غائب')}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {!isLockedOrSubmitted && (
            <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3">
              <button
                type="button"
                disabled={isBusy}
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
