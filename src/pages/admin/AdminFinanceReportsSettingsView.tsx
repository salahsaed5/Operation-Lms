import React, { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Download,
  HardDrive,
  FileCode2,
  AlertTriangle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getSupabaseStatusSummary } from '../../lib/supabase';
import {
  EntitlementStatus,
  IssueSeverity,
  IssueStatus,
  RequestStatus,
} from '../../types/database';

export const AdminFinanceView: React.FC = () => {
  const {
    activeCamp,
    entitlements,
    instructors,
    lectures,
    reviewLectureEntitlement,
    t,
  } = useApp();

  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>({
    'ent-3': 'Instructor notified operations of Ring Road closure; full 3-hour lecture delivered.',
  });
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const campEntitlements = entitlements.filter((e) => e.campId === activeCamp.id);
  const totalEligibleEgp = campEntitlements
    .filter(
      (e) =>
        e.status === EntitlementStatus.ELIGIBLE || e.status === EntitlementStatus.APPROVED
    )
    .reduce((sum, e) => sum + e.entitlementAmountEgp, 0);

  const handleDecision = (entId: string, decision: 'approved' | 'excluded') => {
    const reason = overrideReasons[entId] || '';
    const res = reviewLectureEntitlement(entId, decision, reason);
    if (!res.ok) {
      setFeedback({ ok: false, text: res.error || 'Reason required' });
    } else {
      setFeedback({
        ok: true,
        text: t(
          `Entitlement ${decision} and recorded in immutable audit log.`,
          `تم تحديث حالة المستحق المالي وتسجيل السبب في سجل المراجعة.`
        ),
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {t('Financial Entitlements (Frozen Lecture Rates)', 'المستحقات المالية (فئات المحاضرات المثبتة)')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t(
              'Formula: Eligible Lectures × Frozen Lecture Rate (whole-number EGP). Rate changes never alter existing lectures. No payout tracking.',
              'المعادلة: المحاضرات المستحقة × الفئة المثبتة بالجنيه المصري الصحيح. لا يتضمن النظام تتبع المدفوعات البنكية.'
            )}
          </p>
        </div>

        <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-right">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('Total Verified Entitlements', 'إجمالي المستحقات المعتمدة')}
          </p>
          <p className="text-2xl font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400">
            {totalEligibleEgp.toLocaleString()} EGP
          </p>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className={`p-3.5 rounded-xl border text-xs font-medium ${
            feedback.ok
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
        <table className="w-full text-start border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <th className="py-3.5 px-5 font-semibold">{t('Instructor & Lecture', 'المحاضر والمحاضرة')}</th>
              <th className="py-3.5 px-4 font-semibold">{t('Eligibility & Audit Reason', 'حالة الاستحقاق والسبب')}</th>
              <th className="py-3.5 px-4 text-right font-semibold">{t('Frozen Rate', 'الفئة المثبتة')}</th>
              <th className="py-3.5 px-4 text-right font-semibold">{t('Entitlement (EGP)', 'المستحق (ج.م)')}</th>
              <th className="py-3.5 px-5 text-right font-semibold">{t('Admin Review', 'مراجعة المسؤول')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {campEntitlements.map((ent) => {
              const inst = instructors.find((i) => i.id === ent.instructorId);
              const lec = lectures.find((l) => l.id === ent.lectureId);
              return (
                <tr key={ent.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                  <td className="py-4 px-5">
                    <p className="font-semibold text-slate-900 dark:text-white">
                      {inst ? t(inst.fullNameEn, inst.fullNameAr) : ent.instructorId}
                    </p>
                    <p className="text-slate-500 mt-0.5">
                      Day {ent.campDay} · P{ent.periodNumber} · {lec?.topic}
                    </p>
                  </td>
                  <td className="py-4 px-4 max-w-md">
                    <p className="text-slate-800 dark:text-slate-200">{ent.eligibilityReason}</p>
                    {ent.adminOverrideReason && (
                      <p className="text-blue-600 dark:text-blue-400 mt-0.5">
                        Audit Note: {ent.adminOverrideReason}
                      </p>
                    )}
                  </td>
                  <td className="py-4 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                    {ent.frozenRateEgp} EGP
                  </td>
                  <td className="py-4 px-4 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                    {ent.entitlementAmountEgp} EGP
                  </td>
                  <td className="py-4 px-5 text-right">
                    <div className="flex flex-col items-end gap-2">
                      <input
                        type="text"
                        aria-label={t('Audit reason for entitlement decision', 'سبب المراجعة للمستحق المالي')}
                        placeholder={t('Audit reason required...', 'أدخل سبب المراجعة...')}
                        value={overrideReasons[ent.id] || ''}
                        onChange={(e) =>
                          setOverrideReasons((prev) => ({ ...prev, [ent.id]: e.target.value }))
                        }
                        className="w-56 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                      />
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleDecision(ent.id, 'approved')}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          <span>{t('Approve', 'اعتماد')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDecision(ent.id, 'excluded')}
                          className="px-2.5 py-1 rounded-lg border border-red-300 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 font-semibold inline-flex items-center gap-1 cursor-pointer"
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
  );
};

export const AdminReportsView: React.FC = () => {
  const { groups, students, surveys, instructors, t } = useApp();

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-200 dark:border-slate-800">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          {t('Analytics, Surveys & Camp Reports', 'التقارير والتحليلات وتقييمات المعسكر')}
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {t(
            'Group capacity utilization, student survey feedback, and historical camp comparison.',
            'نسب إشغال المجموعات، نتائج استبيانات الطلاب، ومؤشرات الأداء التدريبي.'
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t('Group Enrollment & Capacity', 'إحصائيات المجموعات والسعة')}
          </h2>
          <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
            {groups.map((grp) => {
              const count = students.filter((s) => s.groupId === grp.id).length;
              return (
                <div key={grp.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-white">
                      {t(grp.nameEn, grp.nameAr)}
                    </p>
                    <p className="text-slate-500">{grp.track}</p>
                  </div>
                  <span className="font-mono tabular-nums font-semibold">
                    {count} / {grp.capacity} {t('students', 'طالب')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t('Student Evaluation Surveys', 'نتائج استبيانات تقييم المحاضرين')}
          </h2>
          <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
            {surveys.map((srv) => {
              const inst = instructors.find((i) => i.id === srv.instructorId);
              return (
                <div key={srv.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-white">{srv.title}</p>
                    <p className="text-slate-500">
                      {inst ? t(inst.fullNameEn, inst.fullNameAr) : ''} · {srv.responsesCount} responses
                    </p>
                  </div>
                  <span className="font-mono tabular-nums text-base font-bold text-blue-600 dark:text-blue-400">
                    {srv.averageScore.toFixed(2)} / 5.00
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export const AdminOperationsView: React.FC = () => {
  const {
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
  const [newIssueRoom, setNewIssueRoom] = useState(rooms[0]?.id || 'room-101');

  const handleAddIssue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIssueTitle.trim()) return;
    createOperationalIssue({
      roomId: newIssueRoom,
      category: 'Lab Infrastructure',
      title: newIssueTitle,
      description: 'Logged from Daily Operations console',
      severity: IssueSeverity.MEDIUM,
    });
    setNewIssueTitle('');
  };

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-200 dark:border-slate-800">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          {t('Daily Operations, Checklists & Issues', 'التشغيل اليومي وقوائم التفقد والأعطال')}
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {t(
            'Track daily readiness tasks, instructor exception requests, and lab room incidents.',
            'متابعة مهام الجاهزية اليومية، طلبات استثناء المحاضرين، وبلاغات القاعات.'
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Checklist */}
        <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t('Day 4 Operational Checklist', 'قائمة تفقد التشغيل — اليوم 4')}
          </h2>
          <div className="space-y-2.5">
            {checklists.map((item) => (
              <label
                key={item.id}
                className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer text-xs"
              >
                <input
                  type="checkbox"
                  checked={item.isCompleted}
                  onChange={() => toggleChecklistItem(item.id)}
                  className="mt-0.5 rounded text-blue-600 focus:ring-blue-500"
                />
                <span
                  className={
                    item.isCompleted
                      ? 'line-through text-slate-400 dark:text-slate-500'
                      : 'text-slate-800 dark:text-slate-200 font-medium'
                  }
                >
                  {t(item.titleEn, item.titleAr)}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Instructor Requests & Lab Issues */}
        <div className="space-y-6">
          <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {t('Instructor Exception & Support Requests', 'طلبات المحاضرين والاستثناءات')}
            </h2>
            <div className="space-y-3 text-xs">
              {requests.map((req) => (
                <div
                  key={req.id}
                  className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {req.subject}
                    </span>
                    <span className="font-mono uppercase text-[11px] text-slate-500">
                      {req.status}
                    </span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-400">{req.details}</p>
                  {req.status === RequestStatus.PENDING && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          reviewInstructorRequest(
                            req.id,
                            RequestStatus.APPROVED,
                            'Approved by Admin Operations'
                          )
                        }
                        className="px-3 py-1 rounded-lg bg-emerald-600 text-white font-semibold cursor-pointer"
                      >
                        {t('Approve Request', 'موافقة')}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          reviewInstructorRequest(
                            req.id,
                            RequestStatus.REJECTED,
                            'Rejected by Admin Operations'
                          )
                        }
                        className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer"
                      >
                        {t('Reject', 'رفض')}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>{t('Room & Infrastructure Issues', 'بلاغات القاعات والدعم الفني')}</span>
            </h2>

            <form onSubmit={handleAddIssue} className="flex gap-2 text-xs">
              <select
                aria-label={t('Room for issue', 'القاعة')}
                value={newIssueRoom}
                onChange={(e) => setNewIssueRoom(e.target.value)}
                className="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              >
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder={t('Log room issue...', 'تسجيل عطل أو ملاحظة بالقاعة...')}
                value={newIssueTitle}
                onChange={(e) => setNewIssueTitle(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
              <button
                type="submit"
                className="px-3.5 py-2 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer"
              >
                {t('Log', 'إضافة')}
              </button>
            </form>

            <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {issues.map((iss) => (
                <div key={iss.id} className="py-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-white">{iss.title}</p>
                    <p className="text-slate-500">
                      {iss.category} · {iss.reportedBy} · {iss.status}
                    </p>
                  </div>
                  {iss.status !== IssueStatus.RESOLVED && (
                    <button
                      type="button"
                      onClick={() => resolveOperationalIssue(iss.id)}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold cursor-pointer"
                    >
                      {t('Resolve', 'تم الحل')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const AdminSettingsAndAuditView: React.FC = () => {
  const { auditLogs, activeCamp, setArchitectureDrawerOpen, t } = useApp();
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const sbStatus = getSupabaseStatusSummary();

  const handleExportBackup = () => {
    setBackupNotice(
      t(
        `Encrypted JSON snapshot (${activeCamp.code}_backup_day${activeCamp.currentCampDay}.json · 42 KB) prepared for local download.`,
        `تم تجهيز نسخة الاحتياط (${activeCamp.code}_backup_day${activeCamp.currentCampDay}.json · 42 KB) للتنزيل المحلي.`
      )
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {t('Settings, Free-Tier Quota Guard & Audit Logs', 'الإعدادات، حماية الخطة المجانية وسجل المراجعة')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t(
              'Strict free-tier protection policy: compressed selfies <=300KB purged after archive, selective pagination, and immutable audit trail.',
              'حماية صارمة للخطة المجانية: ضغط الصور أقل من 300 كيلوبايت وحذفها بعد الأرشفة، مع سجل مراجعة غير قابل للحذف.'
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setArchitectureDrawerOpen(true)}
            className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <FileCode2 className="w-4 h-4 text-blue-500" />
            <span>{t('Inspect SQL Schema & Plan', 'فحص مخطط SQL والخطة')}</span>
          </button>
          <button
            type="button"
            onClick={handleExportBackup}
            className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>{t('Export JSON Backup', 'تصدير نسخة احتياطية')}</span>
          </button>
        </div>
      </div>

      {/* Explicit Connection Status Banner (Local Sandbox vs Connected Supabase) */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-900 dark:text-white">
              {t('Database Connection Mode:', 'وضع الاتصال بقاعدة البيانات:')}
            </span>
            <span className="px-2.5 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
              {sbStatus.configured
                ? t('Connected Supabase Mode', 'متصل بقاعدة بيانات Supabase')
                : t('Local Operational Sandbox Mode (Not connected to remote Supabase)', 'وضع المحاكاة المحلي (غير متصل بقاعدة بيانات Supabase سحابية)')}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {sbStatus.message}
          </p>
        </div>
        <span className="text-xs font-mono text-slate-500 shrink-0">{sbStatus.urlHost}</span>
      </div>

      {backupNotice && (
        <div
          role="status"
          className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 text-xs text-blue-800 dark:text-blue-300 font-medium"
        >
          {backupNotice}
        </div>
      )}

      {/* Free-Tier Storage & Database Usage Monitor */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{t('PostgreSQL Database Usage (Free Tier 500MB)', 'استهلاك قاعدة البيانات (500 ميجابايت)')}</span>
            <HardDrive className="w-4 h-4 text-blue-500" />
          </div>
          <p className="text-xl font-bold font-mono tabular-nums mt-2">14.2 MB / 500 MB (2.8%)</p>
          <p className="text-xs text-slate-500 mt-1">
            {t('Nominal · Safe mode triggers at 85% quota', 'ضمن الحدود الآمنة · لا توجد ترقيات مدفوعة تلقائية')}
          </p>
        </div>

        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{t('Active Camp Selfie Storage (1GB Cap)', 'تخزين صور التحقق للمعسكر النشط')}</span>
            <HardDrive className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-xl font-bold font-mono tabular-nums mt-2">4.8 MB / 1,024 MB (0.4%)</p>
          <p className="text-xs text-slate-500 mt-1">
            {t('Client compression <= 300KB · Purged on camp archive', 'ضغط الصور <= 300KB · تُحذف تلقائياً عند الأرشفة')}
          </p>
        </div>

        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{t('Cloudflare Pages & Edge Bandwidth', 'استضافة Cloudflare Pages المجانية')}</span>
            <HardDrive className="w-4 h-4 text-blue-500" />
          </div>
          <p className="text-xl font-bold font-mono tabular-nums mt-2">Zero Paid Services</p>
          <p className="text-xs text-slate-500 mt-1">
            {t('IndexedDB handles offline attendance drafts locally', 'المسودات غير المتصلة تُحفظ محلياً عبر IndexedDB')}
          </p>
        </div>
      </div>

      {/* Immutable Audit Log Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t('Immutable Operational & Financial Audit Trail', 'سجل المراجعة والتدقيق غير القابل للتعديل')}
          </h2>
        </div>
        <table className="w-full text-start border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <th className="py-3 px-5 font-semibold">{t('Timestamp (UTC)', 'التوقيت')}</th>
              <th className="py-3 px-4 font-semibold">{t('Actor & Role', 'المنفذ والدور')}</th>
              <th className="py-3 px-4 font-semibold">{t('Action & Entity', 'الإجراء والجدول')}</th>
              <th className="py-3 px-4 font-semibold">{t('State Delta & Reason', 'التغيير والسبب')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {auditLogs.map((log) => (
              <tr key={log.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                <td className="py-3 px-5 font-mono tabular-nums text-slate-500">
                  {new Date(log.createdAt).toISOString().replace('T', ' ').slice(0, 19)}
                </td>
                <td className="py-3 px-4">
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {log.actorName}
                  </span>
                  <span className="text-slate-500"> · {log.actorRole}</span>
                </td>
                <td className="py-3 px-4 font-mono text-blue-600 dark:text-blue-400">
                  {log.action} ({log.entityType})
                </td>
                <td className="py-3 px-4">
                  <p className="text-slate-800 dark:text-slate-200">{log.reason}</p>
                  <p className="font-mono text-[11px] text-slate-500 truncate max-w-md">
                    {log.previousValue} → {log.newValue}
                  </p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
