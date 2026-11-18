import React, { useState } from 'react';
import {
  MapPinCheck,
  CalendarClock,
  ClipboardCheck,
  CheckCircle2,
  AlertCircle,
  Camera,
  WifiOff,
  RefreshCw,
  Send,
  ExternalLink,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
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

  const currentInstructor =
    instructors.find((i) => i.id === auth.activeInstructorId) || instructors[0];

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

  const myDraftSheets = attendanceSheets.filter(
    (s) =>
      s.campId === activeCamp.id &&
      s.instructorId === currentInstructor.id &&
      s.status === AttendanceSheetStatus.DRAFT
  );

  const unacknowledgedLectures = myLecturesToday.filter(
    (l) => !l.instructorAcknowledgedAt
  );

  return (
    <div className="space-y-6">
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
                ? myCheckinToday.status === CheckinStatus.VERIFIED
                  ? t('Checked In & Geofence Verified', 'تم تسجيل الوصول وتوثيق الموقع')
                  : t('Checked In (Flagged for Review)', 'تم التسجيل (قيد مراجعة الإدارة)')
                : t('Daily Check-in Required Before Lecture', 'مطلوب تسجيل الوصول اليومي قبل المحاضرة')}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {myCheckinToday
                ? `${myCheckinToday.distanceFromVenueMeters}m from venue pin · Selfie ${myCheckinToday.selfieSizeKb}KB · No continuous tracking`
                : t(
                    'Requires one GPS snapshot within 100m venue pin + compressed selfie (<=300KB).',
                    'يتطلب لقطة موقع GPS واحدة داخل نطاق 100م وصورة تحقق مضغوطة.'
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
        {/* 3. My Daily Schedule */}
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
            {myLecturesToday.map((lec) => {
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
                    {sheet?.status === AttendanceSheetStatus.SUBMITTED ? (
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
            })}
          </div>
        </section>

        {/* 4. Pending Actions */}
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
                  onClick={() => acknowledgeLecture(lec.id)}
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

  const currentInstructor =
    instructors.find((i) => i.id === auth.activeInstructorId) || instructors[0];

  const myLectures = lectures.filter(
    (l) =>
      l.campId === activeCamp.id &&
      (l.instructorId === currentInstructor.id ||
        l.substituteInstructorId === currentInstructor.id)
  );

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

      <div className="space-y-3">
        {myLectures.map((lec) => {
          const grp = groups.find((g) => g.id === lec.groupId);
          const room = rooms.find((r) => r.id === lec.roomId);
          return (
            <div
              key={lec.id}
              className="p-5 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1 text-xs">
                <p className="font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                  Day {lec.campDay} · Period {lec.periodNumber} ({lec.startTime}–{lec.endTime}) · {room?.code}
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
                    onClick={() => acknowledgeLecture(lec.id)}
                    className="min-h-[44px] px-4 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    {t('Acknowledge Schedule', 'تأكيد استلام الجدول')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const InstructorCheckinView: React.FC = () => {
  const {
    activeCamp,
    auth,
    instructors,
    venues,
    checkins,
    submitInstructorCheckin,
    t,
  } = useApp();

  const currentInstructor =
    instructors.find((i) => i.id === auth.activeInstructorId) || instructors[0];
  const venue = venues.find((v) => v.id === activeCamp.venueId) || venues[0];

  const existingCheckin = checkins.find(
    (c) =>
      c.campId === activeCamp.id &&
      c.instructorId === currentInstructor.id &&
      c.campDay === activeCamp.currentCampDay
  );

  const [lat, setLat] = useState<number>(30.0713);
  const [lng, setLng] = useState<number>(31.0168);
  const [checkinTime, setCheckinTime] = useState<string>('08:45');
  const [selfieSizeKb, setSelfieSizeKb] = useState<number>(172);
  const [exceptionReason, setExceptionReason] = useState<string>('');
  const [resultMsg, setResultMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleCheckin = (e: React.FormEvent) => {
    e.preventDefault();
    const res = submitInstructorCheckin({
      instructorId: currentInstructor.id,
      latitude: lat,
      longitude: lng,
      gpsAccuracyMeters: 11,
      selfieSizeKb,
      checkinTimeHHMM: checkinTime,
      exceptionReason: exceptionReason.trim() || undefined,
    });
    setResultMsg({ ok: res.ok, text: res.message });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          {t('Daily Venue Check-in (GPS + Selfie)', 'تسجيل الوصول اليومي للمقر (GPS + صورة تحقق)')}
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {t(
            'One check-in per day. Requires live server connection, 100m geofence verification, and compressed selfie <= 300KB. No continuous location tracking.',
            'تسجيل واحد يومياً. يتطلب اتصالاً مباشراً بالخادم، التحقق داخل نطاق 100 متر، وصورة مضغوطة <= 300KB. لا يوجد تتبع مستمر للموقع.'
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

      <form
        onSubmit={handleCheckin}
        className="p-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-5"
      >
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-1">
          <p className="font-semibold text-slate-900 dark:text-white">
            {t(venue.nameEn, venue.nameAr)}
          </p>
          <p className="text-slate-500 font-mono tabular-nums">
            Pin: ({venue.latitude}, {venue.longitude}) · Allowed Geofence: {activeCamp.settings.geofenceRadiusMeters}m
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <label htmlFor="chk-lat" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t('GPS Latitude', 'خط العرض')}
            </label>
            <input
              id="chk-lat"
              type="number"
              step="0.0001"
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
              step="0.0001"
              value={lng}
              onChange={(e) => setLng(Number(e.target.value))}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono tabular-nums"
            />
          </div>
          <div>
            <label htmlFor="chk-time" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t('Server Arrival Time (HH:MM)', 'وقت الوصول للخادم')}
            </label>
            <input
              id="chk-time"
              type="time"
              value={checkinTime}
              onChange={(e) => setCheckinTime(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono tabular-nums"
            />
          </div>
        </div>

        <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <Camera className="w-5 h-5 text-blue-500 shrink-0" />
            <div>
              <p className="font-semibold text-slate-900 dark:text-white">
                {t('Selfie Verification Frame Ready', 'صورة التحقق الشخصية جاهزة')}
              </p>
              <p className="text-slate-500 font-mono tabular-nums">
                Compressed WebP: {selfieSizeKb} KB / {activeCamp.settings.maxSelfieKb} KB max · Deleted automatically upon camp archive
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSelfieSizeKb(158)}
            className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-semibold shrink-0 cursor-pointer"
          >
            {t('Re-compress', 'إعادة ضغط')}
          </button>
        </div>

        <div>
          <label htmlFor="chk-exception" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
            {t('Exception Reason (Optional — if outside 100m geofence or >=60m late)', 'سبب طلب الاستثناء (اختياري — في حال التواجد خارج النطاق أو التأخر)')}
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
          className="w-full min-h-[48px] py-3 px-5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
        >
          <MapPinCheck className="w-4 h-4" />
          <span>
            {existingCheckin
              ? t('Update Daily Check-in Verification', 'تحديث بيانات تسجيل الوصول اليومي')
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
    attendanceSheets,
    saveAttendanceDraft,
    submitAndSyncAttendanceSheet,
    t,
  } = useApp();

  const currentInstructor =
    instructors.find((i) => i.id === auth.activeInstructorId) || instructors[0];

  const myLectures = lectures.filter(
    (l) =>
      l.campId === activeCamp.id &&
      (l.instructorId === currentInstructor.id ||
        l.substituteInstructorId === currentInstructor.id)
  );

  const [selectedLectureId, setSelectedLectureId] = useState<string>(
    myLectures[1]?.id || myLectures[0]?.id || 'lec-d4-p2-g1'
  );
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const activeSheet = attendanceSheets.find((s) => s.lectureId === selectedLectureId);

  const handleMarkChange = async (
    studentId: string,
    mark: AttendanceMark | 'unmarked'
  ) => {
    if (!activeSheet) return;
    const nextRecords: AttendanceRecordItem[] = activeSheet.records.map((r) =>
      r.studentId === studentId ? { ...r, mark } : r
    );
    await saveAttendanceDraft(selectedLectureId, nextRecords, true);
    setFeedback({
      ok: true,
      text: t(
        'Saved to IndexedDB Offline Draft (Unverified — not financially eligible until synced).',
        'تم الحفظ في مسودة IndexedDB المحلية (غير موثقة مالياً حتى تتم المزامنة).'
      ),
    });
  };

  const handleSubmitAndSync = async () => {
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
              P{l.periodNumber} ({l.startTime}) · {l.topic}
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

      {activeSheet ? (
        <div className="p-5 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-5">
          {/* Sync Status Banner */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              {activeSheet.syncState === OfflineSyncState.SYNCED ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <WifiOff className="w-4 h-4 text-amber-500" />
              )}
              <span className="font-semibold text-slate-900 dark:text-white">
                {t('Sheet State:', 'حالة الكشف:')} {activeSheet.status.toUpperCase()} ·{' '}
                {t('Sync Status:', 'حالة المزامنة:')} {activeSheet.syncState}
              </span>
            </div>
            <span className="font-mono text-[11px] text-slate-500">
              Key: {activeSheet.idempotencyKey}
            </span>
          </div>

          {/* Student Touch Rows (44x44px minimum touch targets) */}
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {activeSheet.records.map((rec) => (
              <div
                key={rec.studentId}
                className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {rec.studentName}
                  </p>
                  <p className="text-xs font-mono tabular-nums text-slate-500">
                    {rec.studentCode} · {rec.mark === 'unmarked' ? t('Unmarked (Draft)', 'غير محدد (مسودة)') : rec.mark.toUpperCase()}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleMarkChange(rec.studentId, AttendanceMark.PRESENT)}
                    className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                      rec.mark === AttendanceMark.PRESENT
                        ? 'bg-emerald-600 text-white'
                        : 'border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {t('Present', 'حاضر')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMarkChange(rec.studentId, AttendanceMark.LATE)}
                    className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                      rec.mark === AttendanceMark.LATE
                        ? 'bg-amber-600 text-white'
                        : 'border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {t('Late', 'متأخر')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMarkChange(rec.studentId, AttendanceMark.ABSENT)}
                    className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
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

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleSubmitAndSync}
              className="min-h-[48px] px-6 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>{t('Submit & Sync Attendance to Server', 'اعتماد ومزامنة الكشف مع الخادم')}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="p-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-500">
          {t('Select an active lecture to view its attendance sheet.', 'اختر محاضرة لفتح كشف الحضور الخاص بها.')}
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

  const currentInstructor =
    instructors.find((i) => i.id === auth.activeInstructorId) || instructors[0];

  const myGroups = groups.filter((g) => g.primaryInstructorId === currentInstructor.id);
  const mySurveys = surveys.filter((s) => s.instructorId === currentInstructor.id);
  const myEntitlements = entitlements.filter((e) => e.instructorId === currentInstructor.id);
  const myRequests = requests.filter((r) => r.instructorId === currentInstructor.id);

  const handleCreateRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqSubject.trim() || !reqDetails.trim()) return;
    submitInstructorRequest({
      requestType: 'schedule_change',
      subject: reqSubject,
      details: reqDetails,
    });
    setReqSubject('');
    setReqDetails('');
  };

  return (
    <div className="space-y-6">
      {/* Instructor Profile Header */}
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

      {/* Required Additional Sections: Groups | My Links | My History | My Requests */}
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
          {myGroups.map((g) => (
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
          ))}
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
            {myEntitlements.map((ent) => (
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
            ))}
          </div>
        </div>
      )}

      {subTab === 'requests' && (
        <div className="p-5 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4 text-xs">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t('Submit & Track My Requests', 'تقديم ومتابعة طلباتي')}
          </h2>
          <form onSubmit={handleCreateRequest} className="space-y-3">
            <input
              type="text"
              placeholder={t('Request subject...', 'عنوان الطلب...')}
              value={reqSubject}
              onChange={(e) => setReqSubject(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            />
            <textarea
              rows={2}
              placeholder={t('Details or reason...', 'التفاصيل أو السبب...')}
              value={reqDetails}
              onChange={(e) => setReqDetails(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            />
            <button
              type="submit"
              className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{t('Send Request to Operations', 'إرسال الطلب للإدارة')}</span>
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
