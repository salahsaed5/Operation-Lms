import React from 'react';
import {
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  Clock,
  FileCode2,
  Tent,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  AttendanceMark,
  AttendanceSheetStatus,
  CheckinStatus,
  EntitlementStatus,
  RequestStatus,
} from '../../types/database';

export const AdminDashboardView: React.FC = () => {
  const {
    activeCamp,
    campInstructorIds,
    students,
    instructors,
    groups,
    rooms,
    lectures,
    checkins,
    checkinExceptions,
    attendanceSheets,
    entitlements,
    requests,
    setAdminRoute,
    setArchitectureDrawerOpen,
    t,
  } = useApp();

  if (!activeCamp) {
    return (
      <div className="p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto">
          <Tent className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          {t('No Active or Draft Camp Found', 'لا يوجد معسكر نشط أو مسودة حالياً')}
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
          {t(
            'Create and activate your first CITS training camp to unlock schedules, instructor check-ins, attendance rosters, and financial entitlements.',
            'قم بإنشاء وتفعيل أول معسكر تدريبي لبدء إدارة الجدول، حضور المحاضرين، كشوف الطلاب، والمستحقات المالية.'
          )}
        </p>
        <button
          type="button"
          onClick={() => setAdminRoute('camps')}
          className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
        >
          {t('Go to Camp Management', 'الانتقال لإدارة المعسكرات')}
        </button>
      </div>
    );
  }

  const campStudents = students.filter((s) => s.campId === activeCamp.id && s.isActive);
  const campGroups = groups.filter((g) => g.campId === activeCamp.id);
  const assignedIds = campInstructorIds[activeCamp.id];
  const campInstructors =
    assignedIds && assignedIds.length > 0
      ? instructors.filter((i) => assignedIds.includes(i.id))
      : instructors;

  const todayLectures = lectures
    .filter((l) => l.campId === activeCamp.id && l.campDay === activeCamp.currentCampDay)
    .sort((a, b) => a.periodNumber - b.periodNumber);

  const todayCheckins = checkins.filter(
    (c) => c.campId === activeCamp.id && c.campDay === activeCamp.currentCampDay
  );

  // Calculate attendance percentage strictly from submitted/locked sheets (0% when empty)
  const submittedSheets = attendanceSheets.filter(
    (s) =>
      s.campId === activeCamp.id &&
      (s.status === AttendanceSheetStatus.SUBMITTED ||
        s.status === AttendanceSheetStatus.LOCKED)
  );
  let totalMarked = 0;
  let totalPresent = 0;
  for (const sheet of submittedSheets) {
    for (const r of sheet.records) {
      totalMarked++;
      if (r.mark === AttendanceMark.PRESENT || r.mark === AttendanceMark.LATE) {
        totalPresent++;
      }
    }
  }
  const attendancePercentage =
    totalMarked > 0 ? Math.round((totalPresent / totalMarked) * 100) : 0;

  // Financial entitlement summary (Eligible + Approved)
  const eligibleEntitlements = entitlements.filter(
    (e) =>
      e.campId === activeCamp.id &&
      (e.status === EntitlementStatus.ELIGIBLE || e.status === EntitlementStatus.APPROVED)
  );
  const pendingReviewEntitlements = entitlements.filter(
    (e) => e.campId === activeCamp.id && e.status === EntitlementStatus.PENDING_REVIEW
  );
  const totalEligibleEgp = eligibleEntitlements.reduce(
    (sum, item) => sum + item.entitlementAmountEgp,
    0
  );

  const pendingRequests = requests.filter(
    (r) => r.campId === activeCamp.id && r.status === RequestStatus.PENDING
  );
  const pendingExceptions = checkinExceptions.filter(
    (ex) => ex.campId === activeCamp.id && ex.status === RequestStatus.PENDING
  );

  return (
    <div className="space-y-8">
      {/* Page Header & Active Camp Context */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span>{t('Active Camp Operations', 'عمليات المعسكر النشط')}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{activeCamp.code}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {t(
                `Day ${activeCamp.currentCampDay} of ${activeCamp.durationDays}`,
                `اليوم ${activeCamp.currentCampDay} من ${activeCamp.durationDays}`
              )}
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
            {t(activeCamp.nameEn, activeCamp.nameAr)}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setAdminRoute('schedule')}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
          >
            {t('Manage Daily Schedule', 'إدارة الجدول اليومي')}
          </button>
          <button
            type="button"
            onClick={() => setArchitectureDrawerOpen(true)}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <FileCode2 className="w-3.5 h-3.5" />
            <span>{t('Review Plan & SQL', 'مراجعة الخطة و SQL')}</span>
          </button>
        </div>
      </div>

      {/* 4-Column KPI Strip */}
      <section aria-label={t('Key operational indicators', 'مؤشرات الأداء الرئيسية')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('Enrolled Students & Groups', 'الطلاب المسجلون والمجموعات')}
            </p>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {campStudents.length}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                {campGroups.length} {t('Groups', 'مجموعات')} · {campInstructors.length}{' '}
                {t('Instructors', 'محاضرين')}
              </span>
            </div>
          </div>

          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('Attendance Rate (Submitted Sheets)', 'نسبة الحضور (الكشوف المعتمدة)')}
            </p>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {totalMarked > 0 ? `${attendancePercentage}%` : '—'}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                {submittedSheets.length}/{todayLectures.length} {t('Sheets Synced', 'كشوف متزامنة')}
              </span>
            </div>
          </div>

          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('Instructor Daily Check-ins', 'تسجيل وصول المحاضرين اليوم')}
            </p>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {todayCheckins.length}/{campInstructors.length}
              </span>
              <span className="text-xs text-amber-600 dark:text-amber-400 font-mono tabular-nums">
                {todayCheckins.filter((c) => c.arrivedLateFirstLecture).length}{' '}
                {t('Late (>=60m)', 'متأخر (+60د)')}
              </span>
            </div>
          </div>

          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('Verified Lecture Entitlements', 'إجمالي المستحقات المعتمدة')}
            </p>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {totalEligibleEgp.toLocaleString()} EGP
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                {pendingReviewEntitlements.length} {t('In Review', 'قيد المراجعة')}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Main 2-Column Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Daily Schedule Timeline */}
        <section
          aria-labelledby="daily-timeline-heading"
          className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h2
                id="daily-timeline-heading"
                className="text-base font-bold text-slate-900 dark:text-white"
              >
                {t(
                  `Day ${activeCamp.currentCampDay} Schedule Timeline`,
                  `الجدول الزمني لمحاضرات اليوم ${activeCamp.currentCampDay}`
                )}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t(
                  '4 periods · 3 hours default duration · Conflict-checked assignments',
                  '4 فترات دراسية · مدة المحاضرة 3 ساعات · محمية ضد التعارض'
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAdminRoute('schedule')}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>{t('Full Schedule', 'كل الجدول')}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {todayLectures.length === 0 ? (
              <p className="px-6 py-8 text-xs text-slate-500 text-center">
                {t('No lectures scheduled for this camp day yet.', 'لا توجد محاضرات مجدولة لهذا اليوم بعد.')}
              </p>
            ) : (
              todayLectures.map((lec) => {
                const grp = groups.find((g) => g.id === lec.groupId);
                const inst = instructors.find(
                  (i) => i.id === (lec.substituteInstructorId || lec.instructorId)
                );
                const room = rooms.find((r) => r.id === lec.roomId);
                const sheet = attendanceSheets.find((s) => s.lectureId === lec.id);

                return (
                  <div
                    key={lec.id}
                    className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                          {t(`Period ${lec.periodNumber}`, `الفترة ${lec.periodNumber}`)} ({lec.startTime}–{lec.endTime})
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{room?.code || lec.roomId}</span>
                        <span aria-hidden="true">·</span>
                        <span>{grp ? t(grp.nameEn, grp.nameAr) : lec.groupId}</span>
                      </div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {lec.topic}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {inst ? t(inst.fullNameEn, inst.fullNameAr) : lec.instructorId} ·{' '}
                        <span className="font-mono tabular-nums">
                          {t(`Frozen Rate: ${lec.frozenRateEgp} EGP`, `الفئة المثبتة: ${lec.frozenRateEgp} ج.م`)}
                        </span>
                      </p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 text-xs">
                      {sheet?.status === AttendanceSheetStatus.SUBMITTED ||
                      sheet?.status === AttendanceSheetStatus.LOCKED ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{t('Attendance Synced', 'تمت مزامنة الحضور')}</span>
                        </span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          <span>{t('Sheet Pending', 'بانتظار الكشف')}</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Right Column: Live Instructor Arrivals & Critical Alerts */}
        <div className="lg:col-span-5 space-y-6">
          <section
            aria-labelledby="arrivals-heading"
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 id="arrivals-heading" className="text-base font-bold text-slate-900 dark:text-white">
                {t('Instructor Arrivals & Geofence Status', 'وصول المحاضرين والنطاق الجغرافي')}
              </h2>
              <button
                type="button"
                onClick={() => setAdminRoute('attendance')}
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                {t('Inspect', 'فحص')}
              </button>
            </div>

            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {campInstructors.length === 0 ? (
                <p className="px-6 py-6 text-xs text-slate-500 text-center">
                  {t('No instructors assigned to this camp yet.', 'لم يتم تعيين محاضرين لهذا المعسكر بعد.')}
                </p>
              ) : (
                campInstructors.map((inst) => {
                  const chk = todayCheckins.find((c) => c.instructorId === inst.id);
                  return (
                    <div
                      key={inst.id}
                      className="px-6 py-3.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {t(inst.fullNameEn, inst.fullNameAr)}
                        </p>
                        <p className="text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                          {chk
                            ? `${new Date(chk.serverTimestamp).toISOString().slice(11, 16)} UTC · ${chk.distanceFromVenueMeters}m · ${chk.selfieSizeKb}KB`
                            : t('No GPS/Selfie check-in recorded yet today', 'لم يسجل حضور اليوم بعد')}
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        {!chk && (
                          <span className="text-slate-500 dark:text-slate-400 font-medium">
                            {t('Not Checked In', 'لم يصل بعد')}
                          </span>
                        )}
                        {chk &&
                          (chk.status === CheckinStatus.VERIFIED ||
                            chk.status === CheckinStatus.EXCEPTION_APPROVED) && (
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>
                                {chk.status === CheckinStatus.EXCEPTION_APPROVED
                                  ? t('Exception Approved', 'استثناء معتمد')
                                  : t('Verified', 'موثق')}
                              </span>
                            </span>
                          )}
                        {chk &&
                          (chk.status === CheckinStatus.LATE_FIRST_LECTURE ||
                            chk.status === CheckinStatus.EXCEPTION_PENDING ||
                            chk.status === CheckinStatus.OUTSIDE_GEOFENCE ||
                            chk.status === CheckinStatus.EXCEPTION_REJECTED) && (
                            <span className="text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5" />
                              <span>{chk.status}</span>
                            </span>
                          )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section
            aria-labelledby="alerts-heading"
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 id="alerts-heading" className="text-base font-bold text-slate-900 dark:text-white">
                {t('Action Required & Reviews', 'إجراءات ومراجعات مطلوبة')}
              </h2>
              <span className="text-xs font-mono tabular-nums text-amber-600 dark:text-amber-400 font-semibold">
                {pendingRequests.length +
                  pendingReviewEntitlements.length +
                  pendingExceptions.length}{' '}
                {t('Items', 'عناصر')}
              </span>
            </div>

            <div className="space-y-3 text-xs">
              {pendingExceptions.map((ex) => {
                const inst = instructors.find((i) => i.id === ex.instructorId);
                return (
                  <div
                    key={ex.id}
                    className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 flex items-start justify-between gap-3"
                  >
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">
                        {t('Check-in Exception', 'طلب استثناء حضور')} ·{' '}
                        {inst ? t(inst.fullNameEn, inst.fullNameAr) : ex.instructorId}
                      </p>
                      <p className="text-slate-600 dark:text-slate-400 mt-0.5">{ex.reason}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAdminRoute('attendance')}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold shrink-0 cursor-pointer"
                    >
                      {t('Review', 'مراجعة')}
                    </button>
                  </div>
                );
              })}

              {pendingReviewEntitlements.map((ent) => {
                const inst = instructors.find((i) => i.id === ent.instructorId);
                return (
                  <div
                    key={ent.id}
                    className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex items-start justify-between gap-3"
                  >
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">
                        {inst ? t(inst.fullNameEn, inst.fullNameAr) : ent.instructorId} ·{' '}
                        {t(`Period ${ent.periodNumber}`, `الفترة ${ent.periodNumber}`)}
                      </p>
                      <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                        {ent.eligibilityReason}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAdminRoute('finance')}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold shrink-0 cursor-pointer"
                    >
                      {t('Review', 'مراجعة')}
                    </button>
                  </div>
                );
              })}

              {pendingRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex items-start justify-between gap-3"
                >
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-white">{req.subject}</p>
                    <p className="text-slate-600 dark:text-slate-400 mt-0.5">{req.details}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAdminRoute('operations')}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-800 font-semibold shrink-0 cursor-pointer"
                  >
                    {t('Open', 'فتح')}
                  </button>
                </div>
              ))}

              {pendingExceptions.length +
                pendingReviewEntitlements.length +
                pendingRequests.length ===
                0 && (
                <p className="text-slate-500 py-3 text-center">
                  {t('All operational queues and reviews are up to date.', 'لا توجد مراجعات أو طلبات معلقة.')}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
