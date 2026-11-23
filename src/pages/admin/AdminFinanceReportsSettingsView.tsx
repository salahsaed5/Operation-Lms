import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Download,
  HardDrive,
  AlertTriangle,
  Search,
  Wallet,
  BarChart3,
  ShieldCheck,
  Tent,
  Database,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { CampFinanceManager } from '../../components/finance/CampFinanceManager';
import { buildCampToDateReport, type CampToDateCategory } from '../../domain/campCumulativeAttendance';
import {
  EntitlementStatus,
  LectureStatus,
  type Instructor,
  IssueSeverity,
  IssueStatus,
  RequestStatus,
} from '../../types/database';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  ConfirmDialog,
  EmptyState,
  INPUT_CLASS,
  InlineBanner,
  LABEL_CLASS,
  PageHeader,
  PaginationBar,
  SELECT_CLASS,
  SURFACE_CARD,
  SURFACE_SUBTLE,
  StatusBadge,
} from '../../components/ui/UiPrimitives';

function entitlementStatusDisplay(
  status: EntitlementStatus,
  t: (en: string, ar: string) => string
): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  switch (status) {
    case EntitlementStatus.APPROVED:
      return { label: t('Approved', 'معتمد'), tone: 'success' };
    case EntitlementStatus.ELIGIBLE:
      return { label: t('Eligible', 'مستحق'), tone: 'success' };
    case EntitlementStatus.PENDING_REVIEW:
      return { label: t('Pending Review', 'قيد المراجعة'), tone: 'warning' };
    case EntitlementStatus.EXCLUDED:
      return { label: t('Excluded', 'مستبعد'), tone: 'danger' };
    default:
      return { label: t('Draft', 'مسودة'), tone: 'neutral' };
  }
}

export const AdminFinanceView: React.FC = () => {
  const {
    activeCamp,
    financeSnapshot,
    campInstructorIds,
    entitlements,
    instructors,
    lectures,
    setAdminRoute,
    updateInstructorAccount,
    reviewLectureEntitlement,
    t,
  } = useApp();

  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'eligible' | 'pending' | 'excluded'>('all');
  const [excludeConfirmId, setExcludeConfirmId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [instructorSearch, setInstructorSearch] = useState('');
  const [editingRateInstructorId, setEditingRateInstructorId] = useState<string | null>(null);
  const [newDefaultRate, setNewDefaultRate] = useState('');
  const [showLectureLedger, setShowLectureLedger] = useState(false);
  const [ledgerInstructorId, setLedgerInstructorId] = useState<string | null>(null);

  if (!activeCamp) {
    return (
      <EmptyState
        icon={Wallet}
        title={t('No active camp configured', 'لا يوجد معسكر نشط حالياً')}
        description={t(
          'Activate a camp first to review instructor lecture entitlements.',
          'فعّل معسكراً أولاً لمراجعة مستحقات المحاضرات.'
        )}
      />
    );
  }

  const campEntitlements = entitlements.filter((e) => e.campId === activeCamp.id);
  const verifiedItems = campEntitlements.filter(
    (e) => e.status === EntitlementStatus.ELIGIBLE || e.status === EntitlementStatus.APPROVED
  );
  const pendingItems = campEntitlements.filter(
    (e) => e.status === EntitlementStatus.PENDING_REVIEW
  );
  const excludedItems = campEntitlements.filter(
    (e) => e.status === EntitlementStatus.EXCLUDED
  );
  const totalEligibleEgp = verifiedItems.reduce((sum, e) => sum + e.entitlementAmountEgp, 0);

  // Financial statement is grouped by the instructor who is actually assigned
  // (including a substitute), with frozen per-lecture amounts as the source
  // of truth. A count of eligible lectures is NOT a count of payments made.
  const campLectures = lectures.filter(l => l.campId === activeCamp.id);
  const includedInstructorIds = new Set([
    ...(campInstructorIds[activeCamp.id] || []),
    ...campLectures.map(l => l.substituteInstructorId || l.instructorId),
    ...campEntitlements.map(e => e.instructorId),
  ]);
  const instructorStatements = instructors
    .filter(inst => includedInstructorIds.has(inst.id))
    .map(inst => {
      const assignedLectures = campLectures.filter(l =>
        (l.substituteInstructorId || l.instructorId) === inst.id &&
        l.status !== LectureStatus.CANCELLED
      );
      const items = campEntitlements.filter(e => e.instructorId === inst.id);
      const payable = items.filter(e =>
        e.status === EntitlementStatus.ELIGIBLE || e.status === EntitlementStatus.APPROVED
      );
      const pending = items.filter(e => e.status === EntitlementStatus.PENDING_REVIEW);
      const excluded = items.filter(e => e.status === EntitlementStatus.EXCLUDED);
      return {
        inst,
        scheduledCount: assignedLectures.length,
        verifiedCount: payable.length,
        pendingCount: pending.length,
        excludedCount: excluded.length,
        verifiedAmount: payable.reduce((sum, e) => sum + e.entitlementAmountEgp, 0),
        pendingEstimate: pending.reduce((sum, e) => sum + e.frozenRateEgp, 0),
        frozenRates: Array.from(new Set(items.map(e => e.frozenRateEgp))),
      };
    })
    .sort((a,b) => a.inst.fullNameEn.localeCompare(b.inst.fullNameEn));
  const visibleInstructorStatements = instructorStatements.filter(({ inst }) => {
    const q = instructorSearch.trim().toLocaleLowerCase();
    return !q || inst.fullNameEn.toLocaleLowerCase().includes(q) ||
      inst.fullNameAr.toLocaleLowerCase().includes(q) ||
      inst.instructorCode.toLocaleLowerCase().includes(q);
  });
  const totalPendingEstimate = instructorStatements.reduce((sum,r) => sum + r.pendingEstimate, 0);


  const filteredEntitlements = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return campEntitlements.filter((ent) => {
      if (ledgerInstructorId && ent.instructorId !== ledgerInstructorId) return false;
      if (
        statusFilter === 'eligible' &&
        ent.status !== EntitlementStatus.ELIGIBLE &&
        ent.status !== EntitlementStatus.APPROVED
      ) {
        return false;
      }
      if (statusFilter === 'pending' && ent.status !== EntitlementStatus.PENDING_REVIEW) {
        return false;
      }
      if (statusFilter === 'excluded' && ent.status !== EntitlementStatus.EXCLUDED) {
        return false;
      }
      if (!q) return true;
      const inst = instructors.find((i) => i.id === ent.instructorId);
      const lec = lectures.find((l) => l.id === ent.lectureId);
      return (
        (inst?.fullNameEn.toLowerCase().includes(q) ?? false) ||
        (inst?.fullNameAr.toLowerCase().includes(q) ?? false) ||
        (lec?.topic.toLowerCase().includes(q) ?? false) ||
        ent.eligibilityReason.toLowerCase().includes(q)
      );
    });
  }, [campEntitlements, instructors, lectures, searchQuery, statusFilter, ledgerInstructorId]);

  const handleDecision = async (entId: string, decision: 'approved' | 'excluded') => {
    setIsBusy(true);
    setFeedback(null);
    try {
      const reason = overrideReasons[entId] || '';
      const res = await reviewLectureEntitlement(entId, decision, reason);
      if (!res.ok) {
        setFeedback({
          ok: false,
          text: res.error || t('Audit reason is required.', 'يرجى إدخال سبب المراجعة.'),
        });
      } else {
        setFeedback({
          ok: true,
          text: t(
            `Entitlement ${decision} and recorded in the audit log.`,
            'تم تحديث حالة المستحق المالي وتوثيق القرار في سجل المراجعة.'
          ),
        });
      }
    } finally {
      setIsBusy(false);
      setExcludeConfirmId(null);
    }
  };

  const handleSaveRate = async (inst: Instructor) => {
    const rate = Number(newDefaultRate.trim());
    if (!newDefaultRate.trim() || !Number.isSafeInteger(rate) || rate < 0 || rate > 1000000) {
      setFeedback({ ok: false, text: t(
        'Enter a valid whole-number EGP rate between 0 and 1,000,000.',
        'اكتب سعر صحيح بالجنيه بين 0 ومليون من غير كسور.'
      ) });
      return;
    }
    if (rate === inst.defaultLectureRateEgp) {
      setEditingRateInstructorId(null);
      return;
    }
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await updateInstructorAccount({
        instructorId: inst.id,
        profileId: inst.profileId,
        specialization: inst.specialization,
        defaultLectureRateEgp: rate,
        isActive: inst.isActive,
        // No Camp-assignment input: changing a default rate must not touch membership.
      });
      if (!res.ok) {
        setFeedback({ ok: false, text: res.error || t('Rate update failed.', 'فشل تعديل السعر.') });
      } else {
        setEditingRateInstructorId(null);
        setFeedback({ ok: true, text: t(
          'Future default lecture rate updated. Previously scheduled lectures and verified financial amounts remain unchanged.',
          'تم تعديل السعر الأساسي للمحاضرات الجديدة فقط. أسعار المحاضرات المجدولة والمستحقات القديمة لم تتغير.'
        ) });
      }
    } finally {
      setIsBusy(false);
    }
  };

  const requestExclude = (entId: string) => {
    const reason = (overrideReasons[entId] || '').trim();
    if (!reason) {
      handleDecision(entId, 'excluded');
      return;
    }
    setExcludeConfirmId(entId);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Financial Entitlements', 'المستحقات المالية')}
        subtitle={t(
          'Calculated from verified attendance and frozen lecture rates (whole-number EGP). Rate edits never alter historical lectures.',
          'تُحتسب من كشوف الحضور المعتمدة والفئات المثبتة بالجنيه المصري الصحيح دون المساس بالمحاضرات السابقة.'
        )}
      />

      {financeSnapshot.enabled ? <CampFinanceManager /> : (
        <>
          <div role="status" className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/20 p-3.5 text-xs text-amber-900 dark:text-amber-200">
            {t('The complete Finance ledger (backup + transport + payments) awaits reviewed migration 0023. Existing lecture entitlements are still shown below without pretending any payment was made.',
              'نظام حسابات الباك أب والانتقالات والدفعات مستني مراجعة وتطبيق Migration 0023. المستحقات القديمة ظاهرة تحت من غير ما نفترض إن فيه فلوس اتدفعت.')}
          </div>
      {/* 4 Summary Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
        <div className={`${SURFACE_CARD} px-4 py-3.5`}>
          <p className="text-xs font-medium text-slate-500 dark:text-[#A0A5AA]">
            {t('Verified Entitlements', 'إجمالي المستحقات المعتمدة')}
          </p>
          <p className="text-xl font-bold font-mono tabular-nums text-[#355F82] dark:text-[#88A9CC] mt-1">
            {totalEligibleEgp.toLocaleString()} EGP
          </p>
        </div>
        <div className={`${SURFACE_CARD} px-4 py-3.5`}>
          <p className="text-xs font-medium text-slate-500 dark:text-[#A0A5AA]">
            {t('Eligible / Approved Lectures', 'المحاضرات المستحقة')}
          </p>
          <p className="text-xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
            {verifiedItems.length}
          </p>
        </div>
        <div className={`${SURFACE_CARD} px-4 py-3.5`}>
          <p className="text-xs font-medium text-slate-500 dark:text-[#A0A5AA]">
            {t('Pending Admin Review', 'بانتظار المراجعة')}
          </p>
          <p className="text-xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-1">
            {pendingItems.length}
          </p>
        </div>
        <div className={`${SURFACE_CARD} px-4 py-3.5`}>
          <p className="text-xs font-medium text-slate-500 dark:text-[#A0A5AA]">
            {t('Excluded Records', 'سجلات مستبعدة')}
          </p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-700 dark:text-[#C0C5C9] mt-1">
            {excludedItems.length}
          </p>
        </div>
      </div>

      {/* Instructor-first financial statement: historic frozen lecture rates are
          the sole source of verified totals. "Scheduled" is not "attended" and
          these entitlements do not assert payment/disbursement. */}
      <section aria-label={t('Instructor financial statements', 'كشف حساب المحاضرين')}
        className={`${SURFACE_CARD} overflow-hidden`}
      >
        <div className="p-4 sm:p-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                {t('Instructor financial statements', 'كشف حساب المحاضرين')}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-[#A0A5AA]">
                {t('Confirmed lectures are eligible/approved entitlements. Pending amounts are estimates, not payable yet. Scheduled count is separate from verified attendance.',
                  'المحاضرات المؤكدة هي المستحقة أو المعتمدة. المبالغ المعلّقة تقديرية وليست مستحقة حاليًا. عدد المحاضرات المجدولة مختلف عن المؤكدة.')}
              </p>
            </div>
            <div className="relative w-full sm:w-80 shrink-0">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input type="search" value={instructorSearch}
                onChange={e => setInstructorSearch(e.target.value)}
                aria-label={t('Find instructor statement', 'البحث في كشف المحاضرين')}
                placeholder={t('Find instructor by name or code', 'ابحث بالاسم أو كود المحاضر')}
                className={`${INPUT_CLASS} ps-9 min-h-[44px]`} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="rounded-xl bg-slate-50 dark:bg-[#121416]/40 border border-slate-100 dark:border-[#353A3F] px-4 py-3">
              <p className="text-xs text-slate-500">{t('Instructors in camp', 'المحاضرون في المعسكر')}</p>
              <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white mt-0.5">{instructorStatements.length}</p>
            </div>
            <div className="rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900 px-4 py-3">
              <p className="text-xs text-emerald-700 dark:text-emerald-300">{t('Verified entitlement total', 'إجمالي المستحق المؤكد')}</p>
              <p className="text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300 mt-0.5">{totalEligibleEgp.toLocaleString()} EGP</p>
            </div>
            <div className="rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900 px-4 py-3">
              <p className="text-xs text-amber-700 dark:text-amber-300">{t('Potential if pending approved', 'مبالغ محتملة قيد المراجعة')}</p>
              <p className="text-xl font-bold tabular-nums text-amber-700 dark:text-amber-300 mt-0.5">{totalPendingEstimate.toLocaleString()} EGP</p>
            </div>
          </div>
        </div>

        {visibleInstructorStatements.length === 0 ? (
          <p role="status" className="border-t border-slate-100 dark:border-[#353A3F] p-6 text-center text-sm text-slate-500">
            {t('No instructors match this search.', 'مفيش محاضرين مطابقين للبحث.')}
          </p>
        ) : (
          <>
            <div className="hidden lg:block overflow-x-auto border-t border-slate-100 dark:border-[#353A3F]">
              <table className="w-full min-w-[1080px] text-xs">
                <thead className="bg-slate-50 dark:bg-[#25292D]/70 text-slate-600 dark:text-[#C0C5C9]">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-start font-semibold">{t('Instructor', 'المحاضر')}</th>
                    <th scope="col" className="px-2 py-3 text-center font-semibold">{t('Scheduled', 'مجدولة')}</th>
                    <th scope="col" className="px-2 py-3 text-center font-semibold">{t('Verified', 'مؤكدة')}</th>
                    <th scope="col" className="px-2 py-3 text-center font-semibold">{t('Pending', 'معلّقة')}</th>
                    <th scope="col" className="px-2 py-3 text-center font-semibold">{t('Excluded', 'مستبعدة')}</th>
                    <th scope="col" className="px-3 py-3 text-end font-semibold">{t('Default rate', 'السعر الأساسي')}</th>
                    <th scope="col" className="px-3 py-3 text-end font-semibold">{t('Verified total', 'المستحق المؤكد')}</th>
                    <th scope="col" className="px-3 py-3 text-end font-semibold">{t('Pending estimate', 'المحتمل المعلّق')}</th>
                    <th scope="col" className="px-4 py-3 text-end font-semibold">{t('Actions', 'إجراءات')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleInstructorStatements.map(row => (
                    <tr key={row.inst.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3">
                        <p className="font-bold text-sm text-slate-900 dark:text-white">{t(row.inst.fullNameEn, row.inst.fullNameAr)}</p>
                        <p className="font-mono text-slate-500 mt-0.5">{row.inst.instructorCode}</p>
                      </td>
                      <td className="px-2 py-3 text-center font-semibold tabular-nums">{row.scheduledCount}</td>
                      <td className="px-2 py-3 text-center font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">{row.verifiedCount}</td>
                      <td className="px-2 py-3 text-center font-bold text-amber-700 dark:text-amber-300 tabular-nums">{row.pendingCount}</td>
                      <td className="px-2 py-3 text-center font-semibold tabular-nums">{row.excludedCount}</td>
                      <td className="px-3 py-3 text-end whitespace-nowrap tabular-nums">
                        {row.inst.defaultLectureRateEgp.toLocaleString()} EGP
                      </td>
                      <td className="px-3 py-3 text-end font-bold whitespace-nowrap text-emerald-700 dark:text-emerald-300 tabular-nums">
                        {row.verifiedAmount.toLocaleString()} EGP
                      </td>
                      <td className="px-3 py-3 text-end whitespace-nowrap font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                        {row.pendingEstimate.toLocaleString()} EGP
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button type="button" className={`${BTN_SECONDARY} text-xs`}
                            onClick={() => { setLedgerInstructorId(row.inst.id); setSearchQuery(''); setStatusFilter('all'); setShowLectureLedger(true); }}>
                            {t('Lectures', 'المحاضرات')}
                          </button>
                          <button type="button" className={`${BTN_SECONDARY} text-xs`}
                            onClick={() => { setEditingRateInstructorId(row.inst.id); setNewDefaultRate(String(row.inst.defaultLectureRateEgp)); }}>
                            {t('Edit rate', 'تعديل السعر')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="lg:hidden border-t border-slate-100 dark:border-[#353A3F] divide-y divide-slate-100 dark:divide-slate-800">
              {visibleInstructorStatements.map(row => (
                <div key={row.inst.id} className="p-4 space-y-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{t(row.inst.fullNameEn, row.inst.fullNameAr)}</p>
                    <p className="text-xs font-mono text-slate-500">{row.inst.instructorCode}</p>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[
                      { en:'Scheduled',ar:'مجدولة',n:row.scheduledCount },
                      { en:'Verified',ar:'مؤكدة',n:row.verifiedCount },
                      { en:'Pending',ar:'معلقة',n:row.pendingCount },
                      { en:'Excluded',ar:'مستبعدة',n:row.excludedCount },
                    ].map(item=>(
                      <div key={item.en} className="rounded-lg bg-slate-50 dark:bg-[#25292D] p-2">
                        <p className="text-xs text-slate-500">{t(item.en,item.ar)}</p>
                        <p className="text-base font-bold tabular-nums">{item.n}</p>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <p>{t('Default rate', 'السعر الأساسي')}: <strong>{row.inst.defaultLectureRateEgp.toLocaleString()} EGP</strong></p>
                    <p>{t('Verified', 'المؤكد')}: <strong className="text-emerald-700 dark:text-emerald-300">{row.verifiedAmount.toLocaleString()} EGP</strong></p>
                    <p className="col-span-2">{t('Pending estimate', 'المبلغ المحتمل')}: <strong>{row.pendingEstimate.toLocaleString()} EGP</strong></p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={BTN_SECONDARY}
                      onClick={() => { setLedgerInstructorId(row.inst.id); setSearchQuery(''); setStatusFilter('all'); setShowLectureLedger(true); }}>
                      {t('Lecture details', 'تفاصيل المحاضرات')}
                    </button>
                    <button type="button" className={BTN_SECONDARY}
                      onClick={() => { setEditingRateInstructorId(row.inst.id); setNewDefaultRate(String(row.inst.defaultLectureRateEgp)); }}>
                      {t('Edit future rate', 'تعديل السعر المستقبلي')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {editingRateInstructorId && instructors.some(i=>i.id===editingRateInstructorId) && (
          <form onSubmit={e => {
            e.preventDefault();
            const inst = instructors.find(i=>i.id===editingRateInstructorId);
            if(inst) void handleSaveRate(inst);
          }}
            className="border-t border-slate-200 dark:border-[#42474D] bg-blue-50/40 dark:bg-[#293747]/20 p-4 sm:p-5 space-y-3"
          >
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                {t('Edit default rate for future lectures', 'تعديل السعر الأساسي للمحاضرات القادمة')}
              </h3>
              <p className="text-xs text-slate-600 dark:text-[#A0A5AA] mt-1">
                {t('Already scheduled lectures keep their frozen rate. This change does NOT change verified totals.',
                  'المحاضرات اللي اتجدولت بالفعل تحتفظ بالسعر المثبت، والتعديل مش هيغيّر المستحقات المؤكدة القديمة.')}
              </p>
            </div>
            <label htmlFor="finance-new-default-rate" className={LABEL_CLASS}>
              {t('New default EGP / lecture', 'السعر الأساسي الجديد لكل محاضرة بالجنيه')}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input id="finance-new-default-rate" type="number" min={0} max={1000000} step={1}
                required value={newDefaultRate} onChange={e=>setNewDefaultRate(e.target.value)}
                className={`${INPUT_CLASS} max-w-[230px] min-h-[42px]`} />
              <button type="submit" disabled={isBusy} className={BTN_PRIMARY}>
                {t('Save future rate', 'حفظ السعر الجديد')}
              </button>
              <button type="button" className={BTN_SECONDARY} onClick={() => setEditingRateInstructorId(null)}>
                {t('Cancel', 'إلغاء')}
              </button>
            </div>
          </form>
        )}
        <div className="border-t border-slate-100 dark:border-[#353A3F] p-4 sm:p-5 text-xs leading-relaxed text-slate-500 dark:text-[#A0A5AA] space-y-2">
          <p>{t('The default rate is for new lectures only. If a lecturer taught at different frozen rates, the total is calculated as the sum of those actual rates, not by multiplying the current rate.',
            'السعر الأساسي يخص المحاضرات الجديدة فقط. لو المحاضر عنده محاضرات بأسعار مختلفة، الإجمالي بيتحسب بجمع أسعار كل محاضرة الفعلية، مش ضرب العدد في السعر الحالي.')}</p>
          <div className="flex items-center flex-wrap gap-2">
            <span>{t('To change lecture count, add/cancel/correct the actual lecture in Schedule; do not type a fake attendance count.',
              'لتعديل عدد المحاضرات، أضف أو ألغِ أو صحّح المحاضرات نفسها من الجدول بدل تغيير عدد غير حقيقي.')}</span>
            <button type="button" onClick={() => setAdminRoute('schedule')}
              className="font-bold text-[#355F82] dark:text-[#88A9CC] underline underline-offset-2">
              {t('Open Schedule', 'فتح الجدول')}
            </button>
          </div>
          <p>{t('Paid / unpaid is not recorded on this screen. Verified entitlement is not proof of cash payment.',
            'الصفحة دي لا تسجل المدفوع أو المتبقي؛ المستحق المؤكد مش معناه إن المبلغ اتصرف بالفعل.')}</p>
        </div>
      </section>

        </>
      )}

      {feedback && (
        <InlineBanner
          type={feedback.ok ? 'success' : 'error'}
          message={feedback.text}
          onDismiss={() => setFeedback(null)}
        />
      )}

      <section aria-label={t('Individual lecture entitlement ledger', 'تفاصيل مستحقات المحاضرات')} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">{t('Individual lecture decisions', 'قرارات مستحقات كل محاضرة')}</h2>
            <p className="text-xs text-slate-500 dark:text-[#A0A5AA] mt-1">
              {t('Approve or exclude individual entitlements with a recorded reason; this is not a payment ledger.',
                'اعتماد أو استبعاد مستحق المحاضرة بسبب مسجل للمراجعة؛ ده مش سجل صرف مبالغ.')}
            </p>
          </div>
          <button type="button" onClick={() => {
            setShowLectureLedger(value=>!value);
            setLedgerInstructorId(null);
            setStatusFilter('all'); setSearchQuery('');
          }} className={BTN_SECONDARY} aria-expanded={showLectureLedger}>
            {showLectureLedger ? t('Hide lecture details', 'إخفاء التفاصيل') : t('Show lecture details', 'عرض التفاصيل')}
          </button>
        </div>
        {showLectureLedger && (
          <div className="space-y-4">
            {ledgerInstructorId && (
              <div className="flex items-center flex-wrap gap-3 rounded-xl border border-blue-200 dark:border-[#425A70] bg-blue-50/60 dark:bg-[#293747]/30 p-3">
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                  {t('Viewing lectures for', 'تفاصيل محاضرات')}:
                  {' '}{t(
                    instructors.find(i=>i.id===ledgerInstructorId)?.fullNameEn || '',
                    instructors.find(i=>i.id===ledgerInstructorId)?.fullNameAr || ''
                  )}
                </p>
                <button type="button" onClick={()=>setLedgerInstructorId(null)}
                  className="text-xs font-bold text-[#355F82] dark:text-[#88A9CC] underline underline-offset-2">
                  {t('Show all instructors', 'عرض كل المحاضرين')}
                </button>
              </div>
            )}
      {/* Search & Status Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('Search instructor or topic...', 'ابحث بالمحاضر أو الموضوع...')}
            aria-label={t('Search entitlements', 'بحث المستحقات')}
            className={`${INPUT_CLASS} ps-9`}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {(
            [
              { id: 'all', en: 'All', ar: 'الكل' },
              { id: 'pending', en: 'Pending Review', ar: 'قيد المراجعة' },
              { id: 'eligible', en: 'Eligible / Approved', ar: 'المستحقة' },
              { id: 'excluded', en: 'Excluded', ar: 'المستبعدة' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                statusFilter === tab.id
                  ? 'bg-[#355F82] text-white'
                  : 'border border-slate-200 dark:border-[#353A3F] bg-white dark:bg-[#1D2023] text-slate-600 dark:text-[#C0C5C9]'
              }`}
            >
              {t(tab.en, tab.ar)}
            </button>
          ))}
        </div>
      </div>

      {filteredEntitlements.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={t('No entitlement records match your filter', 'لا توجد مستحقات مطابقة للبحث')}
        />
      ) : (
        <div className={`${SURFACE_CARD} overflow-hidden`}>
          {/* Mobile Entitlement Cards */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
            {filteredEntitlements.map((ent) => {
              const inst = instructors.find((i) => i.id === ent.instructorId);
              const lec = lectures.find((l) => l.id === ent.lectureId);
              const st = entitlementStatusDisplay(ent.status, t);
              return (
                <div key={ent.id} className="p-4 space-y-3 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm text-slate-900 dark:text-white">
                        {inst ? t(inst.fullNameEn, inst.fullNameAr) : ent.instructorId}
                      </p>
                      <p className="text-slate-500 mt-0.5">
                        {t(`Day ${ent.campDay} · P${ent.periodNumber}`, `اليوم ${ent.campDay} · ف${ent.periodNumber}`)}{' '}
                        · {lec?.topic}
                      </p>
                    </div>
                    <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  </div>

                  <p className="text-slate-700 dark:text-[#C0C5C9]">{ent.eligibilityReason}</p>

                  <div className="flex items-center justify-between font-mono tabular-nums">
                    <span className="text-slate-500">
                      {t('Rate:', 'الفئة:')} {ent.frozenRateEgp} EGP
                    </span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {ent.entitlementAmountEgp.toLocaleString()} EGP
                    </span>
                  </div>

                  <div className="space-y-2 pt-1">
                    <input
                      type="text"
                      aria-label={t('Audit reason for decision', 'سبب القرار المالي')}
                      placeholder={t('Audit reason required...', 'أدخل سبب المراجعة...')}
                      value={overrideReasons[ent.id] || ''}
                      onChange={(e) =>
                        setOverrideReasons((prev) => ({ ...prev, [ent.id]: e.target.value }))
                      }
                      className={INPUT_CLASS}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleDecision(ent.id, 'approved')}
                        className="flex-1 py-2 rounded-lg bg-emerald-600 text-white font-semibold inline-flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{t('Approve', 'اعتماد')}</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => requestExclude(ent.id)}
                        className="flex-1 py-2 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 font-semibold inline-flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>{t('Exclude', 'استبعاد')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Finance Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-start border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-[#353A3F] text-slate-500 dark:text-[#A0A5AA]">
                  <th className="py-3 px-5 font-semibold text-start">{t('Instructor & Lecture', 'المحاضر والمحاضرة')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('Status', 'الحالة')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('Eligibility & Notes', 'تفاصيل الاستحقاق')}</th>
                  <th className="py-3 px-4 font-semibold text-end">{t('Frozen Rate', 'الفئة المثبتة')}</th>
                  <th className="py-3 px-4 font-semibold text-end">{t('Amount (EGP)', 'المستحق (ج.م)')}</th>
                  <th className="py-3 px-5 font-semibold text-end">{t('Admin Decision', 'قرار المراجعة')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredEntitlements.map((ent) => {
                  const inst = instructors.find((i) => i.id === ent.instructorId);
                  const lec = lectures.find((l) => l.id === ent.lectureId);
                  const st = entitlementStatusDisplay(ent.status, t);
                  return (
                    <tr
                      key={ent.id}
                      className="odd:bg-white even:bg-slate-50/60 dark:odd:bg-slate-900 dark:even:bg-slate-900/60 hover:bg-blue-50/40 dark:hover:bg-slate-800/40"
                    >
                      <td className="py-3.5 px-5">
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {inst ? t(inst.fullNameEn, inst.fullNameAr) : ent.instructorId}
                        </p>
                        <p className="text-slate-500 mt-0.5">
                          <span className="font-mono">Day {ent.campDay} · P{ent.periodNumber}</span> · {lec?.topic}
                        </p>
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                      </td>
                      <td className="py-3.5 px-4 max-w-sm">
                        <p className="text-slate-800 dark:text-[#DEE1E4]">{ent.eligibilityReason}</p>
                        {ent.adminOverrideReason && (
                          <p className="text-[#355F82] dark:text-[#88A9CC] mt-0.5">
                            {t('Note:', 'ملاحظة:')} {ent.adminOverrideReason}
                          </p>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-end font-mono tabular-nums text-slate-600 dark:text-[#A0A5AA] whitespace-nowrap">
                        {ent.frozenRateEgp} EGP
                      </td>
                      <td className="py-3.5 px-4 text-end font-mono tabular-nums font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        {ent.entitlementAmountEgp.toLocaleString()} EGP
                      </td>
                      <td className="py-3.5 px-5 text-end">
                        <div className="flex flex-col items-end gap-2">
                          <input
                            type="text"
                            aria-label={t('Audit reason for entitlement decision', 'سبب المراجعة للمستحق المالي')}
                            placeholder={t('Audit reason required...', 'أدخل سبب المراجعة...')}
                            value={overrideReasons[ent.id] || ''}
                            onChange={(e) =>
                              setOverrideReasons((prev) => ({ ...prev, [ent.id]: e.target.value }))
                            }
                            className="w-56 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-[#42474D] bg-white dark:bg-[#121416] focus:outline-none focus:border-[#7196B9]"
                          />
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleDecision(ent.id, 'approved')}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              <span>{t('Approve', 'اعتماد')}</span>
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => requestExclude(ent.id)}
                              className="px-2.5 py-1 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-60 font-semibold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <XCircle className="w-3 h-3" />
                              <span>{t('Exclude', 'استبعاد')}</span>
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

          </div>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(excludeConfirmId)}
        title={t('Exclude Lecture Entitlement?', 'استبعاد المستحق المالي للمحاضرة؟')}
        description={t(
          'Excluding this entitlement sets its payable amount to 0 EGP and records your audit note permanently. Continue?',
          'سيتم استبعاد هذه المحاضرة من المستحقات المالية وتوثيق سبب الاستبعاد في سجل المراجعة. هل تريد المتابعة؟'
        )}
        confirmLabel={t('Confirm Exclude', 'تأكيد الاستبعاد')}
        cancelLabel={t('Cancel', 'إلغاء')}
        tone="danger"
        isBusy={isBusy}
        onConfirm={() => {
          if (excludeConfirmId) handleDecision(excludeConfirmId, 'excluded');
        }}
        onCancel={() => setExcludeConfirmId(null)}
      />
    </div>
  );
};

export const AdminReportsView: React.FC = () => {
  const { activeCamp, groups, students, studentTransfers, lectures, attendanceSheets,
    surveys, instructors, downloadTenDayAttendanceWorkbook, t } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [asOfDay, setAsOfDay] = useState(1);
  const [groupFilter, setGroupFilter] = useState('all');
  const [attendanceCategory, setAttendanceCategory] = useState<'all' | CampToDateCategory>('all');
  const [attendanceSearch, setAttendanceSearch] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const reportDay = Math.min(Math.max(asOfDay, 1), activeCamp?.durationDays || 10);
  const attendanceReport = useMemo(() => buildCampToDateReport({
    campId: activeCamp?.id || '',
    asOfDay: reportDay,
    students,
    lectures,
    attendanceSheets,
    studentTransfers,
  }), [activeCamp?.id, reportDay, students, lectures, attendanceSheets, studentTransfers]);
  const selectedGroupStudents = attendanceReport.students.filter(row =>
    groupFilter === 'all' || row.homeGroupId === groupFilter
  );
  const totalRegistered = selectedGroupStudents.length;
  const totalAttended = selectedGroupStudents.filter(row => row.category === 'attended').length;
  const totalNeverAttended = selectedGroupStudents.filter(row => row.category === 'never_attended').length;
  const totalPending = selectedGroupStudents.filter(row => row.category === 'pending').length;
  const attendanceQuery = attendanceSearch.trim().toLocaleLowerCase();
  const drilldownStudents = selectedGroupStudents.filter(row =>
    (attendanceCategory === 'all' || row.category === attendanceCategory) &&
    (!attendanceQuery || row.fullName.toLocaleLowerCase().includes(attendanceQuery) ||
      row.studentCode.toLocaleLowerCase().includes(attendanceQuery))
  );

  const campGroups = activeCamp ? groups.filter((g) => g.campId === activeCamp.id) : groups;
  const campSurveys = activeCamp ? surveys.filter((s) => s.campId === activeCamp.id) : surveys;

  const q = searchQuery.trim().toLowerCase();
  const filteredGroups = campGroups.filter(
    (g) =>
      !q ||
      g.nameEn.toLowerCase().includes(q) ||
      g.nameAr.toLowerCase().includes(q) ||
      g.track.toLowerCase().includes(q)
  );
  const handleDownloadAttendanceWorkbook = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    setExportFeedback(null);
    try {
      const result = await downloadTenDayAttendanceWorkbook();
      setExportFeedback({
        ok: result.ok,
        text: result.ok
          ? t('Attendance workbook download started. Draft or incomplete Camps are labeled PROVISIONAL.',
               'بدأ تحميل ملف الحضور. المعسكرات غير المكتملة هيتكتب عليها غير نهائي بوضوح.')
          : (result.error || t('Unable to export attendance workbook.', 'تعذر تصدير شيت الحضور.')),
      });
    } finally {
      setExportBusy(false);
    }
  };

  const filteredSurveys = campSurveys.filter((srv) => {
    const inst = instructors.find((i) => i.id === srv.instructorId);
    return (
      !q ||
      srv.title.toLowerCase().includes(q) ||
      (inst?.fullNameEn.toLowerCase().includes(q) ?? false) ||
      (inst?.fullNameAr.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Reports & Evaluations', 'التقارير وتقييمات المحاضرين')}
        subtitle={t(
          'Cumulative attendance, camp student details, group capacity and evaluations.',
          'الحضور التراكمي وكشوف الطلاب وإشغال المجموعات وتقييمات المحاضرين.'
        )}
        actions={
          <div className="flex items-center flex-wrap gap-2">
            <button type="button" className={BTN_PRIMARY}
              disabled={exportBusy || !activeCamp}
              onClick={() => { void handleDownloadAttendanceWorkbook(); }}>
              <Download className="w-4 h-4" />
              <span>{exportBusy ? t('Preparing Excel...', 'جاري تجهيز الإكسيل...') :
                t(`Download ${activeCamp?.durationDays || 10}-Day Attendance Excel`, `تحميل شيت حضور ${activeCamp?.durationDays || 10} يوم`)}</span>
            </button>
            <div className="relative sm:w-56">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('Filter groups or surveys...', 'تصفية المجموعات أو الاستبيانات...')}
                aria-label={t('Filter reports', 'تصفية التقارير')}
                className={`${INPUT_CLASS} ps-9`}
              />
            </div>
          </div>
        }
      />

      {exportFeedback && (
        <InlineBanner
          type={exportFeedback.ok ? 'success' : 'error'}
          message={exportFeedback.text}
          onDismiss={() => setExportFeedback(null)}
        />
      )}

      {activeCamp && (
        <section className={`${SURFACE_CARD} p-5 space-y-4`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                {t('Camp-to-Date Student Attendance', 'ملخص حضور الطلاب حتى اليوم المختار')}
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                {t('Finalized server sheets only — local drafts are not official attendance.',
                   'الإحصائيات من كشوف السيرفر المعتمدة فقط، مش مسودات الأجهزة.')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <label className="text-xs font-semibold" htmlFor="report-as-of-day">
                {t('Through Camp Day', 'حتى اليوم')}
              </label>
              <select id="report-as-of-day" value={reportDay}
                onChange={e => { setAsOfDay(Number(e.target.value)); setAttendanceCategory('all'); }}
                className={SELECT_CLASS}>
                {Array.from({ length: activeCamp.durationDays }, (_, i) => i + 1).map(day => (
                  <option key={day} value={day}>{t('Day', 'اليوم')} {day}</option>
                ))}
              </select>
              <select aria-label={t('Filter cumulative attendance by group','تصفية الحضور حسب المجموعة')}
                className={SELECT_CLASS} value={groupFilter}
                onChange={e => { setGroupFilter(e.target.value); setAttendanceCategory('all'); }}>
                <option value="all">{t('All Groups', 'كل المجموعات')}</option>
                {campGroups.map(grp => <option key={grp.id} value={grp.id}>{grp.code}</option>)}
              </select>
            </div>
          </div>

          {attendanceReport.pendingLectureCount > 0 && (
            <p role="status" className="rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-900 p-3 text-xs text-amber-900 dark:text-amber-200">
              {t(
                `${attendanceReport.pendingLectureCount} scheduled lecture(s) through Day ${reportDay} are not finalized; attendance counts are incomplete, not proof of absence.`,
                `فيه ${attendanceReport.pendingLectureCount} محاضرة حتى اليوم ${reportDay} لسه ما اتعتمدتش. الأرقام الحالية غير مكتملة، وده مش معناه إن الطلاب غابوا.`
              )}
            </p>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {([
              { id: 'all', en: 'Registered', ar: 'إجمالي المسجلين', count: totalRegistered },
              { id: 'attended', en: 'Attended at Least Once', ar: 'حضروا مرة على الأقل', count: totalAttended },
              { id: 'never_attended', en: 'Never Attended (Finalized)', ar: 'لم يحضروا أي محاضرة معتمدة', count: totalNeverAttended },
              { id: 'pending', en: 'Awaiting Finalized Lecture', ar: 'لسه مفيش محاضرة معتمدة لهم', count: totalPending },
            ] as const).map(metric => (
              <button type="button" key={metric.id}
                aria-pressed={attendanceCategory === metric.id}
                onClick={() => setAttendanceCategory(metric.id)}
                className={`text-start rounded-lg border p-3 cursor-pointer transition-colors ${
                  attendanceCategory === metric.id
                    ? 'border-blue-500 bg-blue-50 dark:bg-[#293747]/30'
                    : 'border-slate-200 dark:border-[#353A3F] hover:border-blue-300'
                }`}>
                <span className="block text-xl font-bold tabular-nums text-slate-900 dark:text-white">{metric.count}</span>
                <span className="block text-xs text-slate-600 dark:text-[#C0C5C9] mt-1">{t(metric.en,metric.ar)}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-xs font-bold text-slate-900 dark:text-white">
              {t('Student List', 'سجل الطلاب')} · {drilldownStudents.length}
            </h3>
            <div className="relative min-w-40 sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input type="search" className={`${INPUT_CLASS} ps-9`}
                value={attendanceSearch} onChange={e => setAttendanceSearch(e.target.value)}
                placeholder={t('Search name or code...', 'ابحث بالاسم أو الكود...')}
                aria-label={t('Search camp attendance student list', 'البحث في قائمة حضور الطلاب')} />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-100 dark:bg-[#25292D] text-slate-700 dark:text-[#DEE1E4]">
                <tr>
                  <th className="p-2.5 text-start">{t('Student / Code', 'الطالب / الكود')}</th>
                  <th className="p-2.5 text-start">{t('Home Group', 'المجموعة الأصلية')}</th>
                  <th className="p-2.5 text-start">{t('Join Day', 'يوم الانضمام')}</th>
                  <th className="p-2.5 text-start">{t('Days Present', 'أيام الحضور')}</th>
                  <th className="p-2.5 text-start">{t('Days Absent', 'أيام الغياب')}</th>
                  <th className="p-2.5 text-start">{t('Last Attended', 'آخر حضور')}</th>
                </tr>
              </thead>
              <tbody>
                {drilldownStudents.map(row => (
                  <tr key={row.studentId} className="border-b border-slate-100 dark:border-[#353A3F]">
                    <td className="p-2.5">
                      <span className="block font-semibold text-slate-900 dark:text-white">{row.fullName}</span>
                      <span className="block text-slate-500 font-mono">{row.studentCode}</span>
                    </td>
                    <td className="p-2.5 font-mono">{campGroups.find(g => g.id === row.homeGroupId)?.code || '—'}</td>
                    <td className="p-2.5 tabular-nums">{row.joinedCampDay}</td>
                    <td className="p-2.5 tabular-nums">{row.daysAttended}{row.daysLate > 0 && (
                      <span className="block text-amber-700 dark:text-amber-300">
                        {t('Late days:', 'أيام التأخير:')} {row.daysLate}
                      </span>
                    )}</td>
                    <td className="p-2.5 tabular-nums">{row.daysAbsent}</td>
                    <td className="p-2.5">{row.lastAttendedDay ?? t('—', '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {drilldownStudents.length === 0 && (
              <p className="p-4 text-center text-xs text-slate-500">
                {t('No students in this category or filter.', 'مفيش طلاب في التصنيف أو الفلتر ده.')}
              </p>
            )}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className={`${SURFACE_CARD} p-5 space-y-4`}>
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#353A3F] pb-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#355F82]" />
              <span>{t('Group Enrollment & Capacity', 'إشغال وسعة المجموعات')}</span>
            </h2>
            <span className="text-xs font-mono text-slate-500">{filteredGroups.length}</span>
          </div>

          {filteredGroups.length === 0 ? (
            <p className="py-6 text-xs text-slate-500 text-center">
              {t('No groups found.', 'لا توجد مجموعات مطابقة.')}
            </p>
          ) : (
            <div className="space-y-4 text-xs">
              {filteredGroups.map((grp) => {
                const count = students.filter((s) => s.groupId === grp.id && s.isActive).length;
                const pct = grp.capacity > 0 ? Math.min(100, Math.round((count / grp.capacity) * 100)) : 0;
                return (
                  <div key={grp.id} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 dark:text-white truncate">
                          {t(grp.nameEn, grp.nameAr)}
                        </p>
                        <p className="text-slate-500 truncate">{grp.track}</p>
                      </div>
                      <span className="font-mono tabular-nums font-semibold text-slate-700 dark:text-[#DEE1E4] shrink-0">
                        {count} / {grp.capacity} ({pct}%)
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-[#25292D] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#355F82] transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className={`${SURFACE_CARD} p-5 space-y-4`}>
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#353A3F] pb-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              {t('Student Evaluation Surveys', 'نتائج تقييم المحاضرين')}
            </h2>
            <span className="text-xs font-mono text-slate-500">{filteredSurveys.length}</span>
          </div>

          {filteredSurveys.length === 0 ? (
            <p className="py-6 text-xs text-slate-500 text-center">
              {t('No survey records found.', 'لا توجد استبيانات مطابقة.')}
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {filteredSurveys.map((srv) => {
                const inst = instructors.find((i) => i.id === srv.instructorId);
                return (
                  <div key={srv.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white truncate">
                        {srv.title}
                      </p>
                      <p className="text-slate-500 truncate mt-0.5">
                        {inst ? t(inst.fullNameEn, inst.fullNameAr) : ''} · {srv.responsesCount}{' '}
                        {t('responses', 'ردود')}
                      </p>
                    </div>
                    <StatusBadge tone="info">
                      <span className="font-mono tabular-nums">{srv.averageScore.toFixed(2)} / 5.00</span>
                    </StatusBadge>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const AdminOperationsView: React.FC = () => {
  const {
    activeCamp,
    checklists,
    toggleChecklistItem,
    issues,
    rooms,
    requests,
    reviewInstructorRequest,
    createOperationalIssue,
    resolveOperationalIssue,
    t,
  } = useApp();

  const [newIssueTitle, setNewIssueTitle] = useState('');
  const [newIssueRoom, setNewIssueRoom] = useState(rooms[0]?.id || '');
  const [isBusy, setIsBusy] = useState(false);
  const [opFeedback, setOpFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!newIssueRoom && rooms[0]?.id) setNewIssueRoom(rooms[0].id);
  }, [rooms, newIssueRoom]);

  const campChecklists = activeCamp
    ? checklists.filter((ch) => ch.campId === activeCamp.id)
    : checklists;
  const campRequests = activeCamp
    ? requests.filter((r) => r.campId === activeCamp.id)
    : requests;
  const campIssues = activeCamp
    ? issues.filter((iss) => iss.campId === activeCamp.id)
    : issues;

  const completedChecklistCount = campChecklists.filter((c) => c.isCompleted).length;

  const handleToggleChecklist = async (id: string) => {
    const res = await toggleChecklistItem(id);
    if (!res.ok && res.error) setOpFeedback({ ok: false, text: res.error });
  };

  const handleReviewRequest = async (
    reqId: string,
    decision: RequestStatus.APPROVED | RequestStatus.REJECTED,
    note: string
  ) => {
    setIsBusy(true);
    setOpFeedback(null);
    try {
      const res = await reviewInstructorRequest(reqId, decision, note);
      if (!res.ok) {
        setOpFeedback({
          ok: false,
          text: res.error || t('Failed reviewing request.', 'تعذر مراجعة الطلب.'),
        });
      } else {
        setOpFeedback({
          ok: true,
          text: t('Request updated and instructor notified.', 'تم تحديث الطلب وإرسال إشعار للمحاضر.'),
        });
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleAddIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIssueTitle.trim()) return;
    setIsBusy(true);
    setOpFeedback(null);
    try {
      const res = await createOperationalIssue({
        roomId: newIssueRoom,
        category: 'Lab Infrastructure',
        title: newIssueTitle.trim(),
        description: 'Logged from Daily Operations console',
        severity: IssueSeverity.MEDIUM,
      });
      if (!res.ok) {
        setOpFeedback({ ok: false, text: res.error || t('Failed logging issue.', 'تعذر تسجيل البلاغ.') });
      } else {
        setNewIssueTitle('');
        setOpFeedback({ ok: true, text: t('Issue logged.', 'تم تسجيل البلاغ.') });
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleResolveIssue = async (issueId: string) => {
    setIsBusy(true);
    try {
      const res = await resolveOperationalIssue(issueId);
      if (!res.ok && res.error) setOpFeedback({ ok: false, text: res.error });
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Operations, Checklists & Incidents', 'التشغيل وقوائم التفقد والأعطال')}
        subtitle={t(
          'Track daily venue readiness tasks, instructor requests, and room infrastructure reports.',
          'متابعة مهام الجاهزية اليومية وطلبات المحاضرين وبلاغات القاعات التدريبية.'
        )}
      />

      {opFeedback && (
        <InlineBanner
          type={opFeedback.ok ? 'success' : 'error'}
          message={opFeedback.text}
          onDismiss={() => setOpFeedback(null)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Daily Checklist */}
        <div className={`${SURFACE_CARD} p-5 space-y-4`}>
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#353A3F] pb-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              {activeCamp
                ? t(
                    `Day ${activeCamp.currentCampDay} Readiness Checklist`,
                    `قائمة تفقد التشغيل — اليوم ${activeCamp.currentCampDay}`
                  )
                : t('Operational Checklist', 'قائمة تفقد التشغيل')}
            </h2>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {completedChecklistCount}/{campChecklists.length}
            </span>
          </div>

          <div className="space-y-2">
            {campChecklists.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                {t('No checklist tasks configured.', 'لا توجد بنود في قائمة التفقد.')}
              </p>
            ) : (
              campChecklists.map((item) => (
                <label
                  key={item.id}
                  className="flex items-start gap-3 p-3 rounded-lg border border-slate-200/80 dark:border-[#353A3F] hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer text-xs"
                >
                  <input
                    type="checkbox"
                    checked={item.isCompleted}
                    onChange={() => handleToggleChecklist(item.id)}
                    className="mt-0.5 rounded text-[#355F82] focus:ring-blue-500"
                  />
                  <span
                    className={
                      item.isCompleted
                        ? 'line-through text-slate-400 dark:text-[#848B91]'
                        : 'text-slate-800 dark:text-[#DEE1E4] font-medium'
                    }
                  >
                    {t(item.titleEn, item.titleAr)}
                  </span>
                </label>
              ))
            )}
          </div>
        </div>

        {/* Instructor Requests & Lab Issues */}
        <div className="space-y-5">
          <div className={`${SURFACE_CARD} p-5 space-y-4`}>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              {t('Instructor Requests', 'طلبات المحاضرين')}
            </h2>
            <div className="space-y-3 text-xs">
              {campRequests.length === 0 ? (
                <p className="text-slate-500 py-3 text-center">
                  {t('No instructor requests submitted yet.', 'لا توجد طلبات من المحاضرين بعد.')}
                </p>
              ) : (
                campRequests.map((req) => (
                  <div key={req.id} className={`${SURFACE_SUBTLE} p-3.5 space-y-2`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {req.subject}
                      </span>
                      <StatusBadge
                        tone={
                          req.status === RequestStatus.APPROVED
                            ? 'success'
                            : req.status === RequestStatus.REJECTED
                            ? 'danger'
                            : 'warning'
                        }
                      >
                        {req.status === RequestStatus.APPROVED
                          ? t('Approved', 'مقبول')
                          : req.status === RequestStatus.REJECTED
                          ? t('Rejected', 'مرفوض')
                          : t('Pending', 'معلق')}
                      </StatusBadge>
                    </div>
                    <p className="text-slate-600 dark:text-[#A0A5AA]">{req.details}</p>
                    {req.status === RequestStatus.PENDING && (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            handleReviewRequest(
                              req.id,
                              RequestStatus.APPROVED,
                              'Approved by Admin Operations'
                            )
                          }
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer"
                        >
                          {t('Approve', 'موافقة')}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            handleReviewRequest(
                              req.id,
                              RequestStatus.REJECTED,
                              'Rejected by Admin Operations'
                            )
                          }
                          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#42474D] bg-white dark:bg-[#1D2023] font-semibold cursor-pointer"
                        >
                          {t('Reject', 'رفض')}
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className={`${SURFACE_CARD} p-5 space-y-4`}>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>{t('Room & Infrastructure Issues', 'بلاغات القاعات والدعم الفني')}</span>
            </h2>

            <form onSubmit={handleAddIssue} className="flex flex-wrap sm:flex-nowrap gap-2 text-xs">
              <select
                aria-label={t('Room for issue', 'القاعة')}
                value={newIssueRoom}
                onChange={(e) => setNewIssueRoom(e.target.value)}
                className={`${SELECT_CLASS} w-28 shrink-0`}
              >
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder={t('Describe room issue...', 'وصف العطل أو الملاحظة...')}
                value={newIssueTitle}
                onChange={(e) => setNewIssueTitle(e.target.value)}
                className={INPUT_CLASS}
              />
              <button type="submit" disabled={isBusy} className={BTN_PRIMARY}>
                {t('Log Issue', 'تسجيل')}
              </button>
            </form>

            {campIssues.length === 0 ? (
              <p className="text-xs text-slate-500 py-3 text-center">
                {t('No room issues logged.', 'لا توجد بلاغات مسجلة.')}
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {campIssues.map((iss) => (
                  <div key={iss.id} className="py-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white">{iss.title}</p>
                      <p className="text-slate-500 mt-0.5">
                        {iss.category} · {iss.reportedBy}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge tone={iss.status === IssueStatus.RESOLVED ? 'success' : 'warning'}>
                        {iss.status === IssueStatus.RESOLVED
                          ? t('Resolved', 'تم الحل')
                          : t('Open', 'مفتوح')}
                      </StatusBadge>
                      {iss.status !== IssueStatus.RESOLVED && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleResolveIssue(iss.id)}
                          className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-[#42474D] hover:bg-slate-50 dark:hover:bg-slate-800 font-medium cursor-pointer"
                        >
                          {t('Resolve', 'إنهاء')}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const AUDIT_PAGE_SIZE = 12;

export const AdminSettingsAndAuditView: React.FC = () => {
  const {
    auditLogs,
    activeCamp,
    students,
    lectures,
    checkins,
    attendanceSheets,
    exportBackupSnapshot,
    t,
  } = useApp();

  const [isExporting, setIsExporting] = useState(false);
  const [backupNotice, setBackupNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditPage, setAuditPage] = useState(1);

  const activeCheckinsWithSelfies = checkins.filter(
    (c) => !c.selfieDeletedAfterArchive && c.selfieSizeKb > 0
  );
  const totalSelfieKb = activeCheckinsWithSelfies.reduce(
    (sum, c) => sum + c.selfieSizeKb,
    0
  );
  const totalOperationalRecords =
    students.length + lectures.length + attendanceSheets.length + auditLogs.length;

  useEffect(() => {
    setAuditPage(1);
  }, [auditSearch]);

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (log) =>
        log.actorName.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        log.entityType.toLowerCase().includes(q) ||
        log.reason.toLowerCase().includes(q)
    );
  }, [auditLogs, auditSearch]);

  const totalAuditPages = Math.max(1, Math.ceil(filteredAuditLogs.length / AUDIT_PAGE_SIZE));
  const pagedAuditLogs = filteredAuditLogs.slice(
    (auditPage - 1) * AUDIT_PAGE_SIZE,
    auditPage * AUDIT_PAGE_SIZE
  );

  const handleExportBackup = async () => {
    setIsExporting(true);
    setBackupNotice(null);
    try {
      const res = await exportBackupSnapshot();
      if (!res.ok) {
        setBackupNotice({ ok: false, text: res.error || t('Backup export failed.', 'تعذر تصدير النسخة الاحتياطية.') });
      } else {
        setBackupNotice({
          ok: true,
          text: t(
            `Operational JSON backup exported (${res.filename}).`,
            `تم تنزيل النسخة الاحتياطية (${res.filename}).`
          ),
        });
      }
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Settings & Audit Trail', 'الإعدادات وسجل المراجعة')}
        subtitle={t(
          'Export verified camp snapshots and review the immutable administrative and financial audit log.',
          'تصدير نسخ احتياطية لبيانات المعسكر ومراجعة سجل التدقيق الإداري والمالي.'
        )}
        actions={
          <button
            type="button"
            disabled={isExporting}
            onClick={handleExportBackup}
            className={BTN_PRIMARY}
          >
            <Download className="w-4 h-4" />
            <span>
              {isExporting ? t('Exporting...', 'جاري التصدير...') : t('Export JSON Backup', 'تصدير نسخة احتياطية')}
            </span>
          </button>
        }
      />

      {backupNotice && (
        <InlineBanner
          type={backupNotice.ok ? 'success' : 'error'}
          message={backupNotice.text}
          onDismiss={() => setBackupNotice(null)}
        />
      )}

      {/* 3 Clean Operational Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={`${SURFACE_CARD} p-5`}>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{t('Active Camp Scope', 'نطاق المعسكر النشط')}</span>
            <Tent className="w-4 h-4 text-[#355F82]" />
          </div>
          <p className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-2">
            {activeCamp ? activeCamp.code : t('No Active Camp', 'لا يوجد معسكر نشط')}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {activeCamp
              ? t(
                  `Day ${activeCamp.currentCampDay}/${activeCamp.durationDays} · ${activeCamp.settings.geofenceRadiusMeters}m geofence`,
                  `اليوم ${activeCamp.currentCampDay}/${activeCamp.durationDays} · نطاق ${activeCamp.settings.geofenceRadiusMeters}م`
                )
              : t('Configure an active camp under Camps.', 'فعّل معسكراً من قسم المعسكرات.')}
          </p>
        </div>

        <div className={`${SURFACE_CARD} p-5`}>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{t('Verification Media Storage', 'حجم صور التحقق النشطة')}</span>
            <HardDrive className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-2">
            {totalSelfieKb.toLocaleString()} KB
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {activeCheckinsWithSelfies.length} {t('files · Purged on camp archive', 'ملفات · تُحذف عند أرشفة المعسكر')}
          </p>
        </div>

        <div className={`${SURFACE_CARD} p-5`}>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{t('Operational Records Tracked', 'السجلات التشغيلية الموثقة')}</span>
            <Database className="w-4 h-4 text-[#355F82]" />
          </div>
          <p className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-2">
            {totalOperationalRecords.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {auditLogs.length} {t('immutable audit entries', 'سجلات تدقيق محمية')}
          </p>
        </div>
      </div>

      {/* Audit Log Search & Table */}
      <div className={`${SURFACE_CARD} overflow-hidden`}>
        <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-[#353A3F] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#355F82] shrink-0" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              {t('Operational & Financial Audit Log', 'سجل التدقيق الإداري والمالي')}
            </h2>
          </div>

          <div className="relative sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              placeholder={t('Filter actor, action, reason...', 'بحث بالمنفذ أو الإجراء...')}
              aria-label={t('Search audit log', 'بحث سجل التدقيق')}
              className={`${INPUT_CLASS} ps-9`}
            />
          </div>
        </div>

        {pagedAuditLogs.length === 0 ? (
          <p className="py-10 text-xs text-slate-500 text-center">
            {t('No audit log entries match your filter.', 'لا توجد سجلات تدقيق مطابقة.')}
          </p>
        ) : (
          <>
            {/* Mobile Audit Cards */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {pagedAuditLogs.map((log) => (
                <div key={log.id} className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {log.actorName}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">
                      {new Date(log.createdAt).toISOString().replace('T', ' ').slice(0, 16)}
                    </span>
                  </div>
                  <p className="font-mono text-[#355F82] dark:text-[#88A9CC]">
                    {log.action} ({log.entityType})
                  </p>
                  <p className="text-slate-600 dark:text-[#C0C5C9]">{log.reason}</p>
                </div>
              ))}
            </div>

            {/* Desktop Audit Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-start border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200/80 dark:border-[#353A3F] text-slate-500 dark:text-[#A0A5AA]">
                    <th className="py-3 px-5 font-semibold text-start">{t('Timestamp (UTC)', 'التوقيت')}</th>
                    <th className="py-3 px-4 font-semibold text-start">{t('Actor', 'المنفذ')}</th>
                    <th className="py-3 px-4 font-semibold text-start">{t('Action & Entity', 'الإجراء والكيان')}</th>
                    <th className="py-3 px-4 font-semibold text-start">{t('Reason & Change', 'السبب والتغيير')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {pagedAuditLogs.map((log) => (
                    <tr
                      key={log.id}
                      className="odd:bg-white even:bg-slate-50/60 dark:odd:bg-slate-900 dark:even:bg-slate-900/60"
                    >
                      <td className="py-3 px-5 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {new Date(log.createdAt).toISOString().replace('T', ' ').slice(0, 19)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {log.actorName}
                        </span>
                        <span className="text-slate-500"> · {log.actorRole}</span>
                      </td>
                      <td className="py-3 px-4 font-mono text-[#355F82] dark:text-[#88A9CC] whitespace-nowrap">
                        {log.action} ({log.entityType})
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-slate-800 dark:text-[#DEE1E4]">{log.reason}</p>
                        <p className="font-mono text-[11px] text-slate-500 truncate max-w-md">
                          {log.previousValue} → {log.newValue}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <PaginationBar
          page={auditPage}
          totalPages={totalAuditPages}
          totalItems={filteredAuditLogs.length}
          pageSize={AUDIT_PAGE_SIZE}
          onPageChange={setAuditPage}
          labelShowing={t('Showing', 'عرض')}
        />
      </div>
    </div>
  );
};
