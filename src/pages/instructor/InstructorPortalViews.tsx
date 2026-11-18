import React, { useEffect, useState } from 'react';
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
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { resolveStudentOriginGroupForDay } from '../../domain/businessRules';
import { compressSelfieUnderLimit, getSignedSelfieUrl } from '../../services/citsRepository';
import {
  AttendanceMark,
  AttendanceRecordItem,
  AttendanceSheetStatus,
  CheckinStatus,
  OfflineSyncState,
} from '../../types/database';

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
      <div className="p-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-500">
        {t(
          'No active camp or instructor assignment found yet.',
          'لا يوجد معسكر نشط أو تعيين محاضر حالياً.'
        )}
      </div>
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

  const unacknowledgedLectures = myLecturesToday.filter(
    (l) => !l.instructorAcknowledgedAt
  );

  const handleAck = async (lectureId: string) => {
    setAckFeedback(null);
    const res = await acknowledgeLecture(lectureId);
    if (!res.ok && res.error) setAckFeedback(res.error);
  };

  return (
    <div className="space-y-6">
      {ackFeedback && (
        <div className="p-3.5 rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
          {ackFeedback}
        </div>
      )}

      {/* Priority 1: Daily Check-in Status Card */}
      <section
        aria-labelledby="inst-priority-checkin"
        className="p-5 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">
              {t('1. Daily Check-in Status', '1. حالة تسجيل الوصول اليومي')} ·{' '}
              <span className="font-mono tabular-nums">
                {t(`Day ${activeCamp.currentCampDay}`, `اليوم ${activeCamp.currentCampDay}`)}
              </span>
            </p>
            <h1
              id="inst-priority-checkin"
              className="text-xl font-bold text-slate-900 dark:text-white"
            >
              {myCheckinToday
                ? myCheckinToday.status === CheckinStatus.VERIFIED ||
                  myCheckinToday.status === CheckinStatus.EXCEPTION_APPROVED
                  ? t('Checked In & Geofence Verified', 'تم تسجيل الوصول وتوثيق الموقع')
                  : t(`Checked In (${myCheckinToday.status})`, `تم التسجيل (${myCheckinToday.status})`)
                : t('Daily Check-in Required Before Lecture', 'مطلوب تسجيل الوصول اليومي قبل المحاضرة')}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {myCheckinToday
                ? `${myCheckinToday.distanceFromVenueMeters}m from venue pin · Selfie ${myCheckinToday.selfieSizeKb}KB · No continuous tracking`
                : t(
                    `Requires one GPS snapshot within ${activeCamp.settings.geofenceRadiusMeters}m venue pin + compressed selfie (<=${activeCamp.settings.maxSelfieKb}KB).`,
                    `يتطلب لقطة موقع GPS داخل نطاق ${activeCamp.settings.geofenceRadiusMeters}م وصورة تحقق مضغوطة.`
                  )}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setInstructorRoute('checkin')}
            className="min-h-[48px] px-5 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-2 shrink-0 cursor-pointer"
          >
            <MapPinCheck className="w-4 h-4" />
            <span>
              {myCheckinToday
                ? t('View Check-in Receipt', 'عرض إيصال التسجيل')
                : t('Complete Daily Check-in', 'تسجيل الوصول الآن')}
            </span>
          </button>
        </div>
      </section>

      {/* Priority 2: Next Lecture Card */}
      {nextLecture && (
        <section
          aria-labelledby="inst-priority-next-lecture"
          className="p-5 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                {t('2. Next Assigned Lecture', '2. المحاضرة التالية')} ·{' '}
                <span className="font-mono tabular-nums">
                  P{nextLecture.periodNumber} ({nextLecture.startTime}–{nextLecture.endTime})
                </span>
              </p>
              <h2
                id="inst-priority-next-lecture"
                className="text-lg font-bold text-slate-900 dark:text-white"
              >
                {nextLecture.topic}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {groups.find((g) => g.id === nextLecture.groupId)?.code} ·{' '}
                {rooms.find((r) => r.id === nextLecture.roomId)?.code} ·{' '}
                <span className="font-mono tabular-nums">
                  {nextLecture.frozenRateEgp} EGP
                </span>
              </p>
            </div>

            <button
              type="button"
              onClick={() => setInstructorRoute('attendance')}
              className="min-h-[48px] px-5 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-900 dark:text-white flex items-center justify-center gap-2 shrink-0 cursor-pointer"
            >
              <ClipboardCheck className="w-4 h-4 text-blue-500" />
              <span>{t('Open Attendance Sheet', 'فتح كشف الحضور')}</span>
            </button>
          </div>
        </section>
      )}

      {/* Priority 3 & 4: Daily Schedule + Pending Actions Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section
          aria-labelledby="inst-daily-schedule"
          className="lg:col-span-7 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2
              id="inst-daily-schedule"
              className="text-base font-bold text-slate-900 dark:text-white"
            >
              {t('3. Today’s Schedule (My Groups Only)', '3. جدولي اليومي (مجموعاتي فقط)')}
            </h2>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {myLecturesToday.length} {t('Lectures', 'محاضرات')}
            </span>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {myLecturesToday.length === 0 ? (
              <p className="py-6 text-xs text-slate-500 text-center">
                {t('No lectures assigned to you today.', 'لا توجد محاضرات مسندة لك اليوم.')}
              </p>
            ) : (
              myLecturesToday.map((lec) => {
                const grp = groups.find((g) => g.id === lec.groupId);
                const room = rooms.find((r) => r.id === lec.roomId);
                const sheet = attendanceSheets.find((s) => s.lectureId === lec.id);
                return (
                  <div
                    key={lec.id}
                    className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <p className="font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                        Period {lec.periodNumber} · {lec.startTime}–{lec.endTime} · {room?.code}
                      </p>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">
                        {lec.topic}
                      </p>
                      <p className="text-slate-500">
                        {grp ? t(grp.nameEn, grp.nameAr) : lec.groupId}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {sheet?.status === AttendanceSheetStatus.SUBMITTED ||
                      sheet?.status === AttendanceSheetStatus.LOCKED ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>{t('Synced', 'متزامن')}</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setInstructorRoute('attendance')}
                          className="min-h-[44px] px-3.5 py-2 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer"
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
          className="lg:col-span-5 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4"
        >
          <h2
            id="inst-pending-actions"
            className="text-base font-bold text-slate-900 dark:text-white"
          >
            {t('4. Pending Actions', '4. إجراءات معلقة')}
          </h2>

          <div className="space-y-3 text-xs">
            {myDraftSheets.map((draft) => (
              <div
                key={draft.id}
                className="p-3.5 rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/30 flex items-center justify-between gap-3"
              >
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {t(
                      `Offline Draft — Period ${draft.periodNumber}`,
                      `مسودة غير متزامنة — الفترة ${draft.periodNumber}`
                    )}
                  </p>
                  <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                    {t(
                      'Drafts are not financially eligible until submitted and synced.',
                      'المسودات لا تحتسب ضمن المستحقات حتى يتم اعتمادها ومزامنتها.'
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setInstructorRoute('attendance')}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl bg-blue-600 text-white font-semibold shrink-0 cursor-pointer"
                >
                  {t('Sync', 'مزامنة')}
                </button>
              </div>
            ))}

            {unacknowledgedLectures.map((lec) => (
              <div
                key={lec.id}
                className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between gap-3"
              >
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {t(
                      `Acknowledge Revision ${lec.revisionNumber} (P${lec.periodNumber})`,
                      `تأكيد استلام التعديل ${lec.revisionNumber} (ف${lec.periodNumber})`
                    )}
                  </p>
                  <p className="text-slate-500 mt-0.5">{lec.topic}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleAck(lec.id)}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-semibold shrink-0 cursor-pointer"
                >
                  {t('Confirm', 'تأكيد')}
                </button>
              </div>
            ))}

            {myDraftSheets.length === 0 && unacknowledgedLectures.length === 0 && (
              <p className="text-slate-500 py-4 text-center">
                {t('All daily tasks and attendance sheets are up to date.', 'جميع المهام وكشوف الحضور محدثة بالكامل.')}
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

  const [ackError, setAckError] = useState<string | null>(null);
  const currentInstructor =
    instructors.find((i) => i.id === auth.activeInstructorId) || instructors[0];

  if (!activeCamp || !currentInstructor) {
    return (
      <div className="p-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-500">
        {t('No schedule records available.', 'لا توجد محاضرات مجدولة حالياً.')}
      </div>
    );
  }

  const myLectures = lectures.filter(
    (l) =>
      l.campId === activeCamp.id &&
      (l.instructorId === currentInstructor.id ||
        l.substituteInstructorId === currentInstructor.id)
  );

  const handleAck = async (lectureId: string) => {
    setAckError(null);
    const res = await acknowledgeLecture(lectureId);
    if (!res.ok && res.error) setAckError(res.error);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          {t('My Assigned Schedule', 'جدول محاضراتي المخصص')}
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {t(
            'Isolated view: only lectures assigned to your account are shown.',
            'عرض معزول: تظهر فقط المحاضرات المسندة لحسابك الشخصي.'
          )}
        </p>
      </div>

      {ackError && (
        <div className="p-3.5 rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
          {ackError}
        </div>
      )}

      <div className="space-y-3">
        {myLectures.length === 0 ? (
          <p className="p-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-500">
            {t('No lectures assigned in this camp yet.', 'لم تسند لك محاضرات في هذا المعسكر بعد.')}
          </p>
        ) : (
          myLectures.map((lec) => {
            const grp = groups.find((g) => g.id === lec.groupId);
            const room = rooms.find((r) => r.id === lec.roomId);
            const isSubstitute = lec.substituteInstructorId === currentInstructor.id;
            return (
              <div
                key={lec.id}
                className="p-5 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1 text-xs">
                  <p className="font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                    Day {lec.campDay} · Period {lec.periodNumber} ({lec.startTime}–{lec.endTime}) · {room?.code}
                    {isSubstitute ? ` · ${t('Substitute Role', 'محاضر بديل')}` : ''}
                  </p>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    {lec.topic}
                  </h2>
                  <p className="text-slate-500">
                    {grp ? t(grp.nameEn, grp.nameAr) : lec.groupId} ·{' '}
                    <span className="font-mono tabular-nums">
                      Frozen Rate: {lec.frozenRateEgp} EGP
                    </span>
                  </p>
                </div>

                <div className="shrink-0">
                  {lec.instructorAcknowledgedAt ? (
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{t('Schedule Acknowledged', 'تم تأكيد الجدول')}</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAck(lec.id)}
                      className="min-h-[44px] px-4 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                    >
                      {t('Acknowledge Schedule', 'تأكيد استلام الجدول')}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
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
      <div className="p-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-500">
        {t('Check-in unavailable: no active camp venue configured.', 'تسجيل الوصول غير متاح لعدم وجود معسكر نشط.')}
      </div>
    );
  }

  const handleCaptureGps = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setResultMsg({
        ok: false,
        text: t('Device geolocation is not available in this browser.', 'خدمة تحديد الموقع غير متاحة في هذا المتصفح.'),
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
          `Selfie compressed to ${compressed.sizeKb} KB (${compressed.ext.toUpperCase()}).`,
          `تم ضغط صورة التحقق إلى ${compressed.sizeKb} كيلوبايت.`
        ),
      });
    } catch (err) {
      setResultMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'Selfie compression failed.',
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          {t('Daily Venue Check-in (GPS + Selfie)', 'تسجيل الوصول اليومي للمقر (GPS + صورة تحقق)')}
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {t(
            'One check-in per day. Requires live server connection, geofence verification, and compressed selfie <= 300KB. No continuous location tracking.',
            'تسجيل واحد يومياً. يتطلب اتصالاً مباشراً بالخادم، التحقق داخل النطاق الجغرافي، وصورة مضغوطة <= 300KB.'
          )}
        </p>
      </div>

      {resultMsg && (
        <div
          role="status"
          className={`p-4 rounded-2xl border text-xs font-medium ${
            resultMsg.ok
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'
          }`}
        >
          {resultMsg.text}
        </div>
      )}

      {existingCheckin && (
        <div className="p-4 rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 text-xs flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="font-bold text-slate-900 dark:text-white">
              {t('Today’s Recorded Check-in Receipt:', 'إيصال تسجيل الوصول اليوم:')} {existingCheckin.status}
            </p>
            <p className="font-mono text-slate-600 dark:text-slate-300">
              {existingCheckin.distanceFromVenueMeters}m · {existingCheckin.selfieSizeKb}KB ·{' '}
              {new Date(existingCheckin.serverTimestamp).toISOString().slice(11, 16)} UTC
            </p>
          </div>
          {signedReceiptUrl && (
            <img
              src={signedReceiptUrl}
              alt="Uploaded check-in selfie"
              className="w-16 h-16 rounded-xl object-cover border border-slate-200 dark:border-slate-700"
            />
          )}
        </div>
      )}

      <form
        onSubmit={handleCheckin}
        className="p-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-5"
      >
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">
              {t(venue.nameEn, venue.nameAr)}
            </p>
            <p className="text-slate-500 font-mono tabular-nums">
              Pin: ({venue.latitude}, {venue.longitude}) · Allowed Geofence:{' '}
              {activeCamp.settings.geofenceRadiusMeters}m
            </p>
          </div>
          <button
            type="button"
            disabled={isBusy}
            onClick={handleCaptureGps}
            className="min-h-[40px] px-3.5 py-2 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Navigation className="w-3.5 h-3.5" />
            <span>{t('Capture Device GPS', 'التقاط موقعي الحالي')}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div>
            <label htmlFor="chk-lat" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
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
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono tabular-nums"
            />
          </div>
          <div>
            <label htmlFor="chk-lng" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
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
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono tabular-nums"
            />
          </div>
          <div>
            <label htmlFor="chk-acc" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t('GPS Accuracy (m, max 500)', 'دقة GPS (متر، حد أقصى 500)')}
            </label>
            <input
              id="chk-acc"
              type="number"
              min={0}
              max={500}
              value={gpsAccuracy}
              onChange={(e) => setGpsAccuracy(Number(e.target.value))}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono tabular-nums"
            />
          </div>
          <div>
            <label htmlFor="chk-time" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              {isSupabaseMode
                ? t('Server Timestamp Mode (Authoritative)', 'توقيت الخادم الموثق تلقائياً')
                : t('Arrival Time (HH:MM)', 'وقت الوصول (للمحاكاة)')}
            </label>
            <input
              id="chk-time"
              type="time"
              disabled={isSupabaseMode}
              value={checkinTime}
              onChange={(e) => setCheckinTime(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 disabled:opacity-60 font-mono tabular-nums"
            />
          </div>
        </div>

        {/* Real Camera / File Input + <= 300KB Canvas Compressor */}
        <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            {selfiePreviewUrl ? (
              <img
                src={selfiePreviewUrl}
                alt="Compressed check-in selfie"
                className="w-12 h-12 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
              />
            ) : (
              <Camera className="w-5 h-5 text-blue-500 shrink-0" />
            )}
            <div>
              <p className="font-semibold text-slate-900 dark:text-white">
                {selfieBlob
                  ? t('Compressed Selfie Ready for Upload', 'صورة التحقق جاهزة ومضغوطة')
                  : t('Select or Capture Verification Selfie', 'اختر أو التقط صورة التحقق')}
              </p>
              <p className="text-slate-500 font-mono tabular-nums">
                {selfieBlob
                  ? `${selfieExt.toUpperCase()}: ${selfieSizeKb} KB / ${activeCamp.settings.maxSelfieKb} KB max`
                  : isSupabaseMode
                  ? t('Required <= 300KB · Deleted automatically on camp archive', 'إلزامية <= 300KB · تحذف بعد أرشفة المعسكر')
                  : `Sandbox Size: ${selfieSizeKb} KB / ${activeCamp.settings.maxSelfieKb} KB max`}
              </p>
            </div>
          </div>

          <label className="min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold shrink-0 cursor-pointer flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5 text-blue-500" />
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
          <label htmlFor="chk-exception" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            {t('Exception Reason (Optional — if outside geofence or >=60m late)', 'سبب طلب الاستثناء (اختياري — في حال التواجد خارج النطاق أو التأخر)')}
          </label>
          <input
            id="chk-exception"
            type="text"
            placeholder={t('Explain any GPS drift or traffic delay...', 'وضح سبب التأخر أو انحراف GPS إن وجد...')}
            value={exceptionReason}
            onChange={(e) => setExceptionReason(e.target.value)}
            className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
          />
        </div>

        <button
          type="submit"
          disabled={isBusy}
          className="w-full min-h-[48px] py-3 px-5 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
        >
          <MapPinCheck className="w-4 h-4" />
          <span>
            {isBusy
              ? t('Uploading & Verifying on Server...', 'جاري الرفع والتحقق...')
              : existingCheckin
              ? t('Daily Check-in Recorded', 'تم تسجيل الوصول اليومي')
              : t('Verify GPS & Submit Daily Check-in', 'توثيق الموقع وإرسال تسجيل الوصول')}
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
      <div className="p-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-500">
        {t('No lectures available for attendance.', 'لا توجد محاضرات متاحة لتسجيل الحضور.')}
      </div>
    );
  }

  const selectedLecture = myLectures.find((l) => l.id === selectedLectureId);
  const existingSheet = attendanceSheets.find((s) => s.lectureId === selectedLectureId);

  // Build hydrated roster using historical origin group resolution for selectedLecture.campDay
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
      setFeedback({ ok: false, text: res.error || 'Unable to save draft.' });
    } else {
      setFeedback({
        ok: true,
        text: t(
          'Saved to IndexedDB Offline Draft (Unverified — not financially eligible until synced).',
          'تم الحفظ في مسودة IndexedDB المحلية (غير موثقة مالياً حتى تتم المزامنة).'
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
          `${stu.fullName} added as temporary cross-group attendee in local draft.`,
          `تمت إضافة ${stu.fullName} كحضور مؤقت من مجموعة أخرى في المسودة المحلية.`
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
      // Ensure full roster is persisted in draft state before submitting
      const draftRes = await saveAttendanceDraft(selectedLectureId, baseRecords, false);
      if (!draftRes.ok) {
        setFeedback({
          ok: false,
          text: draftRes.error || 'Unable to sync attendance draft prior to submission.',
        });
        return;
      }
      const res = await submitAndSyncAttendanceSheet(selectedLectureId);
      if (!res.ok) {
        setFeedback({ ok: false, text: res.error || 'Sync failed' });
      } else {
        setFeedback({
          ok: true,
          text: t(
            'Attendance sheet submitted & synchronized! Unmarked students were marked Absent and your lecture entitlement was updated.',
            'تم اعتماد ومزامنة كشف الحضور! تم تحويل غير المحددين إلى غياب وتحديث مستحق المحاضرة.'
          ),
        });
      }
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {t('Lecture Attendance & Offline Drafts', 'تسجيل حضور المحاضرة والمسودات المحلية')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t(
              'Unmarked students become absent only when submitted. Offline drafts use IndexedDB with idempotency keys.',
              'يتحول الطلاب غير المحددين إلى غياب عند الاعتماد النهائي فقط.'
            )}
          </p>
        </div>

        <select
          aria-label={t('Select lecture for attendance', 'اختر المحاضرة')}
          value={selectedLectureId}
          onChange={(e) => {
            setSelectedLectureId(e.target.value);
            setFeedback(null);
          }}
          className="px-3.5 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold"
        >
          {myLectures.map((l) => (
            <option key={l.id} value={l.id}>
              D{l.campDay} P{l.periodNumber} ({l.startTime}) · {l.topic}
            </option>
          ))}
        </select>
      </div>

      {feedback && (
        <div
          role="status"
          className={`p-4 rounded-2xl border text-xs font-medium ${
            feedback.ok
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {selectedLecture ? (
        <div className="p-5 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-5">
          {/* Sync Status Banner */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              {existingSheet?.syncState === OfflineSyncState.SYNCED ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <WifiOff className="w-4 h-4 text-amber-500" />
              )}
              <span className="font-semibold text-slate-900 dark:text-white">
                {t('Sheet State:', 'حالة الكشف:')}{' '}
                {(existingSheet?.status || AttendanceSheetStatus.DRAFT).toUpperCase()} ·{' '}
                {t('Sync Status:', 'حالة المزامنة:')}{' '}
                {existingSheet?.syncState || OfflineSyncState.OFFLINE}
              </span>
            </div>
            <span className="font-mono text-[11px] text-slate-500">
              Key: {existingSheet?.idempotencyKey || `idem-${activeCamp.id}-${selectedLectureId}`}
            </span>
          </div>

          {/* Temporary Cross-Group Attendee Adder */}
          {!isLockedOrSubmitted && eligibleCrossGroupStudents.length > 0 && (
            <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-wrap items-center gap-2 text-xs">
              <select
                aria-label={t('Add cross-group visiting student', 'إضافة طالب حضور مؤقت من مجموعة أخرى')}
                value={crossGroupStudentId}
                onChange={(e) => setCrossGroupStudentId(e.target.value)}
                className="flex-1 min-w-[200px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
              >
                <option value="">
                  {t('+ Add temporary cross-group student...', '+ إضافة طالب من مجموعة أخرى للحضور المؤقت...')}
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
                className="min-h-[38px] px-3.5 py-2 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>{t('Add Visiting Student', 'إضافة للكشف')}</span>
              </button>
            </div>
          )}

          {/* Student Touch Rows */}
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {baseRecords.map((rec) => (
              <div
                key={rec.studentId}
                className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {rec.studentName}
                    </p>
                    {rec.isCrossGroup && (
                      <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-mono text-[11px]">
                        Cross-Group
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-mono tabular-nums text-slate-500">
                    {rec.studentCode} ·{' '}
                    {rec.mark === 'unmarked'
                      ? t('Unmarked (Draft)', 'غير محدد (مسودة)')
                      : rec.mark.toUpperCase()}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isLockedOrSubmitted}
                    onClick={() => handleMarkChange(rec.studentId, AttendanceMark.PRESENT)}
                    className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                      rec.mark === AttendanceMark.PRESENT
                        ? 'bg-emerald-600 text-white'
                        : 'border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {t('Present', 'حاضر')}
                  </button>
                  <button
                    type="button"
                    disabled={isLockedOrSubmitted}
                    onClick={() => handleMarkChange(rec.studentId, AttendanceMark.LATE)}
                    className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                      rec.mark === AttendanceMark.LATE
                        ? 'bg-amber-600 text-white'
                        : 'border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {t('Late', 'متأخر')}
                  </button>
                  <button
                    type="button"
                    disabled={isLockedOrSubmitted}
                    onClick={() => handleMarkChange(rec.studentId, AttendanceMark.ABSENT)}
                    className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                      rec.mark === AttendanceMark.ABSENT
                        ? 'bg-red-600 text-white'
                        : 'border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {t('Absent', 'غائب')}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {!isLockedOrSubmitted && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3">
              <button
                type="button"
                disabled={isBusy}
                onClick={handleSubmitAndSync}
                className="min-h-[48px] px-6 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 ${isBusy ? 'animate-spin' : ''}`} />
                <span>
                  {isBusy
                    ? t('Synchronizing...', 'جاري المزامنة...')
                    : t('Submit & Sync Attendance to Server', 'اعتماد ومزامنة الكشف مع الخادم')}
                </span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="p-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-500">
          {t('No lectures assigned yet for attendance tracking.', 'لا توجد محاضرات مسندة لتسجيل الحضور.')}
        </div>
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
      <div className="p-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-500">
        {t('Instructor profile data unavailable.', 'بيانات ملف المحاضر غير متاحة.')}
      </div>
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
        subject: reqSubject,
        details: reqDetails,
      });
      if (!res.ok) {
        setReqFeedback({ ok: false, text: res.error || 'Failed submitting request.' });
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
    <div className="space-y-6">
      <div className="p-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-mono text-blue-600 dark:text-blue-400">
            {currentInstructor.instructorCode} · Isolated Instructor Account
          </p>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
            {t(currentInstructor.fullNameEn, currentInstructor.fullNameAr)}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {currentInstructor.specialization} · {currentInstructor.email}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-xs text-slate-500">{t('Default Lecture Rate', 'فئة المحاضرة الافتراضية')}</p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
            {currentInstructor.defaultLectureRateEgp} EGP
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-200/70 dark:bg-slate-900 rounded-2xl w-fit">
        {(
          [
            { id: 'groups', en: 'Groups', ar: 'مجموعاتي' },
            { id: 'links', en: 'My Links', ar: 'روابطي' },
            { id: 'history', en: 'My History', ar: 'سجل مستحقاتي' },
            { id: 'requests', en: 'My Requests', ar: 'طلباتي' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
              subTab === tab.id
                ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {t(tab.en, tab.ar)}
          </button>
        ))}
      </div>

      {subTab === 'groups' && (
        <div className="p-5 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 text-xs">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t('Assigned Training Groups', 'المجموعات التدريبية المسندة')}
          </h2>
          {myGroups.length === 0 ? (
            <p className="text-slate-500">{t('No primary groups assigned yet.', 'لا توجد مجموعات مسندة.')}</p>
          ) : (
            myGroups.map((g) => (
              <div
                key={g.id}
                className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between"
              >
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {t(g.nameEn, g.nameAr)}
                  </p>
                  <p className="text-slate-500 mt-0.5">{g.track}</p>
                </div>
                <span className="font-mono tabular-nums font-semibold">
                  Capacity: {g.capacity}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {subTab === 'links' && (
        <div className="p-5 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 text-xs">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t('My Survey & Evaluation Links', 'روابط التقييم والاستبيانات الخاصة بي')}
          </h2>
          {mySurveys.length > 0 ? (
            mySurveys.map((srv) => (
              <div
                key={srv.id}
                className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between"
              >
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">{srv.title}</p>
                  <p className="font-mono text-slate-500 mt-0.5">{srv.url}</p>
                </div>
                <span className="font-mono tabular-nums font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1">
                  <span>{srv.averageScore} / 5.0</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </span>
              </div>
            ))
          ) : (
            <p className="text-slate-500">{t('No survey links assigned yet.', 'لا توجد روابط حالياً.')}</p>
          )}
        </div>
      )}

      {subTab === 'history' && (
        <div className="p-5 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 text-xs">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t('My Lecture Entitlement History (EGP)', 'سجل مستحقات محاضراتي بالجنيه المصري')}
          </h2>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {myEntitlements.length === 0 ? (
              <p className="py-3 text-slate-500">{t('No entitlement records yet.', 'لا توجد مستحقات مسجلة بعد.')}</p>
            ) : (
              myEntitlements.map((ent) => (
                <div key={ent.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-white">
                      Day {ent.campDay} · Period {ent.periodNumber} ({ent.status})
                    </p>
                    <p className="text-slate-500 mt-0.5">{ent.eligibilityReason}</p>
                  </div>
                  <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                    {ent.entitlementAmountEgp} EGP
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {subTab === 'requests' && (
        <div className="p-5 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4 text-xs">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t('Submit & Track My Requests', 'تقديم ومتابعة طلباتي')}
          </h2>

          {reqFeedback && (
            <div
              role="status"
              className={`p-3 rounded-xl border font-medium ${
                reqFeedback.ok
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
                  : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'
              }`}
            >
              {reqFeedback.text}
            </div>
          )}

          <form onSubmit={handleCreateRequest} className="space-y-3">
            <input
              type="text"
              required
              placeholder={t('Request subject...', 'عنوان الطلب...')}
              value={reqSubject}
              onChange={(e) => setReqSubject(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            />
            <textarea
              rows={2}
              required
              placeholder={t('Details or reason...', 'التفاصيل أو السبب...')}
              value={reqDetails}
              onChange={(e) => setReqDetails(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            />
            <button
              type="submit"
              disabled={isBusy}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 disabled:opacity-60 text-white font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isBusy ? t('Sending...', 'جاري الإرسال...') : t('Send Request to Operations', 'إرسال الطلب للإدارة')}</span>
            </button>
          </form>

          <div className="divide-y divide-slate-200 dark:divide-slate-800 pt-2">
            {myRequests.map((r) => (
              <div key={r.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">{r.subject}</p>
                  <p className="text-slate-500 mt-0.5">{r.details}</p>
                </div>
                <span className="font-mono uppercase text-[11px] font-semibold">
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
