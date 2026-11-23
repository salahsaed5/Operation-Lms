import React, { useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  Users,
  Search,
  SlidersHorizontal,
  Tent,
  AlertCircle,
  Plus,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { calculateCampDayDate } from '../../domain/businessRules';
import {
  AttendanceMark,
  AttendanceSheetStatus,
  CheckinStatus,
  EntitlementStatus,
  RequestStatus,
} from '../../types/database';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  EmptyState,
  PageHeader,
  SURFACE_CARD,
  StatusBadge,
} from '../../components/ui/UiPrimitives';

type SheetFilter = 'all' | 'synced' | 'pending';

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
    t,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [sheetFilter, setSheetFilter] = useState<SheetFilter>('all');
  const [showFilters, setShowFilters] = useState(false);
  const selectedTeachingDate = activeCamp
    ? calculateCampDayDate(activeCamp.startDate,activeCamp.currentCampDay,activeCamp.operatingWeekdays)
    : null;

  const campStudents = activeCamp
    ? students.filter((s) => s.campId === activeCamp.id && s.isActive)
    : [];
  const campGroups = activeCamp ? groups.filter((g) => g.campId === activeCamp.id) : [];
  const assignedIds = activeCamp ? campInstructorIds[activeCamp.id] : undefined;
  // A Camp with no assigned instructors must show zero, not instructors
  // from other simultaneously active Camps.
  const campInstructors = instructors.filter(i =>
    (assignedIds || []).includes(i.id)
  );

  const todayLectures = useMemo(() => {
    if (!activeCamp) return [];
    return lectures
      .filter((l) => l.campId === activeCamp.id && l.campDay === activeCamp.currentCampDay)
      .sort((a, b) => a.periodNumber - b.periodNumber);
  }, [activeCamp, lectures]);

  const todayCheckins = activeCamp
    ? checkins.filter((c) => c.campId === activeCamp.id && c.campDay === activeCamp.currentCampDay)
    : [];

  // Attendance calculation strictly from submitted/locked sheets
  const submittedSheets = activeCamp
    ? attendanceSheets.filter(
        (s) =>
          s.campId === activeCamp.id &&
          (s.status === AttendanceSheetStatus.SUBMITTED ||
            s.status === AttendanceSheetStatus.LOCKED)
      )
    : [];

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
  const eligibleEntitlements = activeCamp
    ? entitlements.filter(
        (e) =>
          e.campId === activeCamp.id &&
          (e.status === EntitlementStatus.ELIGIBLE || e.status === EntitlementStatus.APPROVED)
      )
    : [];
  const pendingReviewEntitlements = activeCamp
    ? entitlements.filter(
        (e) => e.campId === activeCamp.id && e.status === EntitlementStatus.PENDING_REVIEW
      )
    : [];
  const totalEligibleEgp = eligibleEntitlements.reduce(
    (sum, item) => sum + item.entitlementAmountEgp,
    0
  );

  const pendingRequests = activeCamp
    ? requests.filter((r) => r.campId === activeCamp.id && r.status === RequestStatus.PENDING)
    : [];
  const pendingExceptions = activeCamp
    ? checkinExceptions.filter(
        (ex) => ex.campId === activeCamp.id && ex.status === RequestStatus.PENDING
      )
    : [];

  // Precompute enriched session rows for the main operational table
  const sessionRows = useMemo(() => {
    return todayLectures.map((lec) => {
      const grp = groups.find((g) => g.id === lec.groupId);
      const effectiveInstId = lec.substituteInstructorId || lec.instructorId;
      const inst = instructors.find((i) => i.id === effectiveInstId);
      const room = rooms.find((r) => r.id === lec.roomId);
      const sheet = attendanceSheets.find((s) => s.lectureId === lec.id);
      const chk = todayCheckins.find((c) => c.instructorId === effectiveInstId);

      const isSynced =
        sheet?.status === AttendanceSheetStatus.SUBMITTED ||
        sheet?.status === AttendanceSheetStatus.LOCKED;

      const groupStudentsCount = students.filter(
        (s) => s.campId === activeCamp?.id && s.groupId === lec.groupId && s.isActive
      ).length;

      let presentCount = 0;
      let absentCount = 0;
      if (sheet && sheet.records.length > 0) {
        for (const rec of sheet.records) {
          if (rec.mark === AttendanceMark.PRESENT || rec.mark === AttendanceMark.LATE) {
            presentCount++;
          } else if (rec.mark === AttendanceMark.ABSENT) {
            absentCount++;
          }
        }
      }

      return {
        lec,
        grp,
        inst,
        room,
        sheet,
        chk,
        isSynced,
        groupStudentsCount,
        presentCount,
        absentCount,
      };
    });
  }, [todayLectures, groups, instructors, rooms, attendanceSheets, todayCheckins, students, activeCamp]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sessionRows.filter((row) => {
      if (sheetFilter === 'synced' && !row.isSynced) return false;
      if (sheetFilter === 'pending' && row.isSynced) return false;

      if (!q) return true;
      const topic = row.lec.topic.toLowerCase();
      const groupEn = row.grp?.nameEn.toLowerCase() ?? '';
      const groupAr = row.grp?.nameAr.toLowerCase() ?? '';
      const instEn = row.inst?.fullNameEn.toLowerCase() ?? '';
      const instAr = row.inst?.fullNameAr.toLowerCase() ?? '';
      const roomCode = row.room?.code.toLowerCase() ?? '';
      return (
        topic.includes(q) ||
        groupEn.includes(q) ||
        groupAr.includes(q) ||
        instEn.includes(q) ||
        instAr.includes(q) ||
        roomCode.includes(q)
      );
    });
  }, [sessionRows, searchQuery, sheetFilter]);

  const syncedCount = sessionRows.filter((r) => r.isSynced).length;
  const pendingCount = sessionRows.length - syncedCount;
  const lateCheckinsCount = todayCheckins.filter((c) => c.arrivedLateFirstLecture).length;
  const totalActionItems =
    pendingExceptions.length + pendingReviewEntitlements.length + pendingRequests.length;

  // Clean Empty State when no active camp exists
  if (!activeCamp) {
    return (
      <div className="max-w-3xl mx-auto py-8 space-y-5">
        <PageHeader
          title={t("Today's Camp Operations", 'عمليات المعسكر اليوم')}
          subtitle={t('No active or draft camp configured', 'لا يوجد معسكر نشط أو مسودة حالياً')}
        />
        <EmptyState
          icon={Tent}
          title={t('No sessions scheduled without an active camp', 'لا توجد جلسات مجدولة بدون معسكر نشط')}
          description={t(
            'Create or activate a training camp to manage instructors, groups, and daily lectures.',
            'أنشئ معسكراً أو فعّل معسكراً قائماً لإدارة المحاضرين والمجموعات والجدول اليومي.'
          )}
          action={
            <button
              type="button"
              onClick={() => setAdminRoute('camps')}
              className={BTN_PRIMARY}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('Configure Camp', 'إعداد المعسكر')}</span>
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header Row: Title + Subtitle on Left, Search + Filter + Schedule Action on Right */}
      <PageHeader
        title={t('Daily Operations', 'العمليات اليومية')}
        subtitle={
          <>
            {t(activeCamp.nameEn, activeCamp.nameAr)} ·{' '}
            <span className="font-mono tabular-nums">{activeCamp.code}</span> ·{' '}
            <span className="font-mono tabular-nums">
              {t(
                `Day ${activeCamp.currentCampDay} of ${activeCamp.durationDays}`,
                `اليوم ${activeCamp.currentCampDay} من ${activeCamp.durationDays}`
              )} · {selectedTeachingDate}
            </span>
          </>
        }
        actions={
          <>
            <div className="relative flex-1 sm:flex-initial min-w-[200px] sm:w-60">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('Search topic or group...', 'ابحث بالعنوان أو المجموعة...')}
                aria-label={t('Search selected Camp day sessions', 'البحث في جلسات يوم الدراسة المحدد')}
                className="w-full ps-9 pe-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-colors"
              />
            </div>

            <button
              type="button"
              onClick={() => setShowFilters((prev) => !prev)}
              aria-expanded={showFilters}
              className={`px-3.5 py-2 rounded-lg border text-xs sm:text-sm font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                showFilters || sheetFilter !== 'all'
                  ? 'border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-400'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{t('Filter', 'تصفية')}</span>
            </button>

            <button
              type="button"
              onClick={() => setAdminRoute('schedule')}
              className={BTN_PRIMARY}
            >
              {t('Manage Schedule', 'إدارة الجدول')}
            </button>
          </>
        }
      />

      {/* Expandable Lightweight Filter Bar */}
      {showFilters && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 dark:text-slate-400 font-medium me-1">
              {t('Sheet Status:', 'حالة الكشف:')}
            </span>
            {(
              [
                { id: 'all', label: t(`All (${sessionRows.length})`, `الكل (${sessionRows.length})`) },
                { id: 'synced', label: t(`Synced (${syncedCount})`, `معتمد (${syncedCount})`) },
                { id: 'pending', label: t(`Pending (${pendingCount})`, `معلق (${pendingCount})`) },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSheetFilter(opt.id)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  sheetFilter === opt.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {(sheetFilter !== 'all' || searchQuery.trim() !== '') && (
            <button
              type="button"
              onClick={() => {
                setSheetFilter('all');
                setSearchQuery('');
              }}
              className="text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer"
            >
              {t('Clear filters', 'إعادة ضبط')}
            </button>
          )}
        </div>
      )}

      {/* 4 Compact Stat Cards (Right-Aligned Tinted Circular Icons matching reference) */}
      <section aria-label={t('Operational metrics summary', 'ملخص مؤشرات التشغيل')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
          {/* Card 1: Sessions */}
          <div className="px-4 py-3.5 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
                {t('Selected Day Sessions', 'جلسات يوم الدراسة المحدد')}
              </p>
              <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white mt-0.5">
                {todayLectures.length}
              </p>
              <p className="text-[11px] font-medium tabular-nums mt-0.5 text-slate-500 dark:text-slate-400 truncate">
                <span className="text-emerald-600 dark:text-emerald-400">
                  {t(`Synced ${syncedCount}`, `معتمد ${syncedCount}`)}
                </span>
                <span aria-hidden="true" className="mx-1.5 text-slate-300">
                  ·
                </span>
                <span className="text-amber-600 dark:text-amber-400">
                  {t(`Pending ${pendingCount}`, `معلق ${pendingCount}`)}
                </span>
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Calendar className="w-4 h-4" />
            </div>
          </div>

          {/* Card 2: Students & Groups */}
          <div className="px-4 py-3.5 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
                {t('Enrolled Students', 'الطلاب المسجلون')}
              </p>
              <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white mt-0.5">
                {campStudents.length}
              </p>
              <p className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                {campGroups.length} {t('Groups', 'مجموعات')} · {campInstructors.length}{' '}
                {t('Instructors', 'محاضرين')}
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </div>
          </div>

          {/* Card 3: Instructor Check-ins */}
          <div className="px-4 py-3.5 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
                {t('Instructor Check-ins', 'وصول المحاضرين')}
              </p>
              <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white mt-0.5">
                {todayCheckins.length}/{campInstructors.length}
              </p>
              <p className="text-[11px] tabular-nums mt-0.5 truncate">
                {lateCheckinsCount > 0 ? (
                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                    {lateCheckinsCount} {t('Late (>=60m)', 'متأخر (+60د)')}
                  </span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    {t('Attendance rate', 'نسبة الحضور')}:{' '}
                    {totalMarked > 0 ? `${attendancePercentage}%` : '—'}
                  </span>
                )}
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-100 dark:border-emerald-900/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>

          {/* Card 4: Verified Entitlements */}
          <div className="px-4 py-3.5 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
                {t('Verified Entitlements', 'المستحقات المعتمدة')}
              </p>
              <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white mt-0.5">
                {totalEligibleEgp.toLocaleString()} EGP
              </p>
              <p className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                {pendingReviewEntitlements.length} {t('In review', 'قيد المراجعة')} ·{' '}
                {totalActionItems} {t('alerts', 'تنبيهات')}
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-amber-50 dark:bg-amber-950/60 border border-amber-100 dark:border-amber-900/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </div>
          </div>
        </div>
      </section>

      {/* Compact Attention Banner when actionable queues need admin review */}
      {totalActionItems > 0 && (
        <div className="px-4 py-2.5 rounded-xl border border-amber-200/90 dark:border-amber-900/70 bg-amber-50/70 dark:bg-amber-950/30 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              {t(
                `${totalActionItems} operational review item(s) awaiting decision`,
                `${totalActionItems} عناصر مراجعة بانتظار قرار الإدارة`
              )}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pendingExceptions.length > 0 && (
              <button
                type="button"
                onClick={() => setAdminRoute('attendance')}
                className="px-2.5 py-1 rounded-md bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 font-semibold hover:bg-amber-50 cursor-pointer"
              >
                {t(`Exceptions (${pendingExceptions.length})`, `الاستثناءات (${pendingExceptions.length})`)}
              </button>
            )}
            {pendingReviewEntitlements.length > 0 && (
              <button
                type="button"
                onClick={() => setAdminRoute('finance')}
                className="px-2.5 py-1 rounded-md bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 font-semibold hover:bg-amber-50 cursor-pointer"
              >
                {t(`Finance (${pendingReviewEntitlements.length})`, `المستحقات (${pendingReviewEntitlements.length})`)}
              </button>
            )}
            {pendingRequests.length > 0 && (
              <button
                type="button"
                onClick={() => setAdminRoute('operations')}
                className="px-2.5 py-1 rounded-md bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 font-semibold hover:bg-amber-50 cursor-pointer"
              >
                {t(`Requests (${pendingRequests.length})`, `الطلبات (${pendingRequests.length})`)}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Primary Operational Table (Desktop Table + Responsive Mobile Cards) */}
      <section aria-labelledby="daily-sessions-table-heading">
        <div className={`${SURFACE_CARD} overflow-hidden`}>
          <div className="px-5 py-3 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3">
            <div>
              <h2
                id="daily-sessions-table-heading"
                className="text-sm font-semibold text-slate-900 dark:text-white"
              >
                {t(
                  `Day ${activeCamp.currentCampDay} Scheduled Sessions`,
                  `الجلسات المجدولة لليوم ${activeCamp.currentCampDay}`
                )}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t(
                  '4 periods · Conflict-protected assignments · Click any session to inspect roster & check-in',
                  '4 فترات دراسية · محمية ضد التعارض · اضغط على أي جلسة لفحص الكشف والوصول'
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAdminRoute('attendance')}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap cursor-pointer"
            >
              {t('All Attendance Sheets', 'كل كشوف الحضور')}
            </button>
          </div>

          {filteredRows.length === 0 ? (
            <div className="py-12 px-6 text-center space-y-2.5">
              <div className="w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
                <Calendar className="w-5 h-5" />
              </div>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                {todayLectures.length === 0
                  ? t('No lectures scheduled for selected teaching day', 'لا توجد محاضرات مجدولة ليوم الدراسة المحدد')
                  : t('No sessions match your current search or filter', 'لا توجد جلسات مطابقة لبحثك')}
              </p>
              {(searchQuery.trim() !== '' || sheetFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSheetFilter('all');
                  }}
                  className={BTN_SECONDARY}
                >
                  {t('Reset Filters', 'إعادة ضبط الفلاتر')}
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Mobile Session Cards */}
              <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredRows.map(({ lec, grp, inst, room, isSynced, groupStudentsCount, presentCount, absentCount }) => {
                  const instName = inst ? t(inst.fullNameEn, inst.fullNameAr) : lec.instructorId;
                  const groupLabel = grp ? t(grp.nameEn, grp.nameAr) : lec.groupId;
                  return (
                    <div key={lec.id} className="p-4 space-y-2.5 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono tabular-nums text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                            {t(`P${lec.periodNumber}`, `ف${lec.periodNumber}`)} · {lec.startTime}–{lec.endTime} · {room?.code || lec.roomId}
                          </p>
                          <p className="font-semibold text-sm text-slate-900 dark:text-white mt-0.5">
                            {lec.topic}
                          </p>
                          <p className="text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                            {instName} · {groupLabel}
                          </p>
                        </div>
                        <StatusBadge tone={isSynced ? 'success' : 'warning'}>
                          {isSynced ? t('Synced', 'معتمد') : t('Pending', 'معلق')}
                        </StatusBadge>
                      </div>
                      <div className="flex items-center justify-between pt-1 text-[11px] font-mono tabular-nums text-slate-500">
                        <span>
                          {t('Roster', 'الطلاب')}: {groupStudentsCount} ·{' '}
                          <span className="text-emerald-600 dark:text-emerald-400">
                            {isSynced ? `${presentCount}P` : '—'}
                          </span>{' '}
                          /{' '}
                          <span className="text-red-600 dark:text-red-400">
                            {isSynced ? `${absentCount}A` : '—'}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setAdminRoute('attendance')}
                          className="font-sans text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          {t('Inspect', 'فحص')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Operational Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-start border-collapse">
                <thead>
                  <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900">
                    <th className="py-2.5 px-3 text-xs font-medium text-slate-400 dark:text-slate-500 text-start">
                      {t('Session Topic', 'عنوان الجلسة')}
                    </th>
                    <th className="py-2.5 px-3 text-xs font-medium text-slate-400 dark:text-slate-500 text-start">
                      {t('Instructor', 'المحاضر')}
                    </th>
                    <th className="py-2.5 px-3 text-xs font-medium text-slate-400 dark:text-slate-500 text-start">
                      {t('Time', 'الوقت')}
                    </th>
                    <th className="py-2.5 px-3 text-xs font-medium text-slate-400 dark:text-slate-500 text-start">
                      {t('Group', 'المجموعة')}
                    </th>
                    <th className="py-2.5 px-3 text-xs font-medium text-slate-400 dark:text-slate-500 text-start">
                      {t('Room', 'القاعة')}
                    </th>
                    <th className="py-2.5 px-2.5 text-xs font-medium text-slate-400 dark:text-slate-500 text-end">
                      {t('Students', 'الطلاب')}
                    </th>
                    <th className="py-2.5 px-2.5 text-xs font-medium text-slate-400 dark:text-slate-500 text-end">
                      {t('Attended', 'حضر')}
                    </th>
                    <th className="py-2.5 px-2.5 text-xs font-medium text-slate-400 dark:text-slate-500 text-end">
                      {t('Absent', 'غاب')}
                    </th>
                    <th className="py-2.5 px-2.5 text-xs font-medium text-slate-400 dark:text-slate-500 text-end">
                      {t('Rate', 'الفئة')}
                    </th>
                    <th className="py-2.5 px-3 text-xs font-medium text-slate-400 dark:text-slate-500 text-start">
                      {t('Status', 'الحالة')}
                    </th>
                    <th className="py-2.5 px-3 text-xs font-medium text-slate-400 dark:text-slate-500 text-end">
                      {t('Action', 'إجراء')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                  {filteredRows.map(({ lec, grp, inst, room, isSynced, groupStudentsCount, presentCount, absentCount }) => {
                    const instName = inst ? t(inst.fullNameEn, inst.fullNameAr) : lec.instructorId;
                    const instInitial = instName.trim().charAt(0).toUpperCase() || 'I';
                    const groupLabel = grp ? t(grp.nameEn, grp.nameAr) : lec.groupId;
                    return (
                      <tr
                        key={lec.id}
                        className="odd:bg-white even:bg-slate-50/70 dark:odd:bg-slate-900 dark:even:bg-slate-900/60 hover:bg-blue-50/40 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <td className="py-3 px-3 font-medium max-w-[230px]">
                          <button
                            type="button"
                            onClick={() => setAdminRoute('attendance')}
                            title={lec.topic}
                            className="text-blue-600 dark:text-blue-400 hover:underline text-start font-medium leading-snug line-clamp-2 cursor-pointer"
                          >
                            {lec.topic}
                          </button>
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-6 h-6 rounded-full bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-semibold flex items-center justify-center shrink-0">
                              {instInitial}
                            </span>
                            <span className="text-slate-800 dark:text-slate-200 font-medium truncate max-w-[140px]">
                              {instName}
                            </span>
                          </div>
                        </td>

                        <td className="py-3 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap tabular-nums">
                          <div className="font-medium text-slate-800 dark:text-slate-200">
                            {t(`P${lec.periodNumber}`, `ف${lec.periodNumber}`)} · {lec.startTime}–{lec.endTime}
                          </div>
                        </td>

                        <td
                          className="py-3 px-3 font-mono text-[11px] text-slate-700 dark:text-slate-300 max-w-[145px]"
                          title={groupLabel}
                        >
                          <span className="block truncate">{groupLabel}</span>
                        </td>

                        <td className="py-3 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {room?.code || lec.roomId}
                        </td>

                        <td className="py-3 px-2.5 text-end font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {groupStudentsCount}
                        </td>

                        <td className="py-3 px-2.5 text-end font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                          {isSynced ? presentCount : '—'}
                        </td>

                        <td className="py-3 px-2.5 text-end font-mono tabular-nums font-semibold text-red-600 dark:text-red-400">
                          {isSynced ? absentCount : '—'}
                        </td>

                        <td className="py-3 px-2.5 text-end font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {lec.frozenRateEgp}
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          {isSynced ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[11px] font-semibold">
                              {t('Synced', 'معتمد')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-700 dark:bg-amber-950/50 dark:border-amber-800 dark:text-amber-300 text-[11px] font-semibold">
                              {t('Pending', 'معلق')}
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-3 text-end whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setAdminRoute('attendance')}
                            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                          >
                            {t('View', 'عرض')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Secondary Operational Strip: Instructor Arrivals & Pending Reviews */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Instructor Arrivals & Geofence Status */}
        <section
          aria-labelledby="arrivals-heading"
          className="xl:col-span-6 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
        >
          <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
            <h2 id="arrivals-heading" className="text-sm font-semibold text-slate-900 dark:text-white">
              {t('Instructor Arrivals & Geofence', 'وصول المحاضرين والنطاق الجغرافي')}
            </h2>
            <button
              type="button"
              onClick={() => setAdminRoute('attendance')}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              {t('Inspect', 'فحص')}
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {campInstructors.length === 0 ? (
              <p className="px-5 py-6 text-xs text-slate-500 text-center">
                {t('No instructors assigned to this camp yet.', 'لم يتم تعيين محاضرين لهذا المعسكر بعد.')}
              </p>
            ) : (
              campInstructors.map((inst) => {
                const chk = todayCheckins.find((c) => c.instructorId === inst.id);
                const statusLabel =
                  chk?.status === CheckinStatus.LATE_FIRST_LECTURE
                    ? t('Late (>=60m)', 'تأخير (+60د)')
                    : chk?.status === CheckinStatus.EXCEPTION_PENDING
                    ? t('Exception Pending', 'بانتظار الاستثناء')
                    : chk?.status === CheckinStatus.OUTSIDE_GEOFENCE
                    ? t('Outside Geofence', 'خارج النطاق')
                    : chk?.status === CheckinStatus.EXCEPTION_REJECTED
                    ? t('Exception Rejected', 'استثناء مرفوض')
                    : chk?.status;
                return (
                  <div
                    key={inst.id}
                    className="px-5 py-3 flex items-center justify-between gap-3 text-xs hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white truncate">
                        {t(inst.fullNameEn, inst.fullNameAr)}
                      </p>
                      <p className="text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5 truncate">
                        {chk
                          ? `${new Date(chk.serverTimestamp).toISOString().slice(11, 16)} UTC · ${chk.distanceFromVenueMeters}m · ${chk.selfieSizeKb}KB`
                          : t('No GPS/Selfie check-in for selected teaching day', 'لا يوجد تسجيل وصول ليوم الدراسة المحدد')}
                      </p>
                    </div>

                    <div className="shrink-0">
                      {!chk && (
                        <span className="text-slate-400 dark:text-slate-500 font-medium">
                          {t('Not Checked In', 'لم يصل')}
                        </span>
                      )}
                      {chk &&
                        (chk.status === CheckinStatus.VERIFIED ||
                          chk.status === CheckinStatus.EXCEPTION_APPROVED) && (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
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
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>{statusLabel}</span>
                          </span>
                        )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Action Required & Pending Reviews */}
        <section
          aria-labelledby="alerts-heading"
          className="xl:col-span-6 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
        >
          <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
            <h2 id="alerts-heading" className="text-sm font-semibold text-slate-900 dark:text-white">
              {t('Action Required & Reviews', 'إجراءات ومراجعات مطلوبة')}
            </h2>
            <span className="text-xs font-mono tabular-nums font-semibold text-slate-500 dark:text-slate-400">
              {totalActionItems} {t('Items', 'عناصر')}
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
            {pendingExceptions.map((ex) => {
              const inst = instructors.find((i) => i.id === ex.instructorId);
              return (
                <div
                  key={ex.id}
                  className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-white truncate">
                      {t('Check-in Exception', 'طلب استثناء حضور')} ·{' '}
                      {inst ? t(inst.fullNameEn, inst.fullNameAr) : ex.instructorId}
                    </p>
                    <p className="text-slate-500 dark:text-slate-400 mt-0.5 truncate">{ex.reason}</p>
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
                  className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-white truncate">
                      {inst ? t(inst.fullNameEn, inst.fullNameAr) : ent.instructorId} ·{' '}
                      {t(`Period ${ent.periodNumber}`, `الفترة ${ent.periodNumber}`)}
                    </p>
                    <p className="text-slate-500 dark:text-slate-400 mt-0.5 truncate">
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
                className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 dark:text-white truncate">{req.subject}</p>
                  <p className="text-slate-500 dark:text-slate-400 mt-0.5 truncate">{req.details}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setAdminRoute('operations')}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold shrink-0 cursor-pointer"
                >
                  {t('Open', 'فتح')}
                </button>
              </div>
            ))}

            {totalActionItems === 0 && (
              <p className="px-5 py-6 text-slate-500 text-center">
                {t('All operational queues and reviews are up to date.', 'لا توجد مراجعات أو طلبات معلقة.')}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
