import React, { useState } from 'react';
import { Plus, Upload, ShieldAlert, CheckCircle2, Archive } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { CampStatus } from '../../types/database';
import { RawStudentImportRow } from '../../domain/businessRules';

export const AdminCampsView: React.FC = () => {
  const { camps, venues, createDraftCamp, activateCamp, archiveCamp, t } = useApp();
  const [showNewCampForm, setShowNewCampForm] = useState(false);
  const [code, setCode] = useState('CITS-27-Q1');
  const [nameEn, setNameEn] = useState('CITS Winter Algorithms Bootcamp 2027');
  const [nameAr, setNameAr] = useState('معسكر CITS الشتوي للخوارزميات ٢٠٢٧');
  const [startDate, setStartDate] = useState('2027-01-15');
  const [durationDays, setDurationDays] = useState(10);
  const [geofenceRadiusMeters, setGeofenceRadiusMeters] = useState(100);
  const [defaultRateEgp, setDefaultRateEgp] = useState(750);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const handleCreateCamp = (e: React.FormEvent) => {
    e.preventDefault();
    const res = createDraftCamp({
      code,
      nameEn,
      nameAr,
      startDate,
      durationDays,
      geofenceRadiusMeters,
      defaultRateEgp,
    });
    if (!res.ok) {
      setFeedback({ type: 'err', text: res.error || 'Error creating camp' });
    } else {
      setFeedback({
        type: 'ok',
        text: t(
          'Draft camp created with 10-day default settings and 100m geofence.',
          'تم إنشاء مسودة المعسكر بنجاح بالإعدادات الافتراضية (10 أيام ونطاق 100 متر).'
        ),
      });
      setShowNewCampForm(false);
    }
  };

  const handleActivate = (campId: string) => {
    const res = activateCamp(campId);
    if (!res.ok) {
      setFeedback({ type: 'err', text: res.error || 'Cannot activate camp' });
    } else {
      setFeedback({ type: 'ok', text: t('Camp activated.', 'تم تفعيل المعسكر.') });
    }
  };

  const handleArchive = (campId: string) => {
    const res = archiveCamp(campId);
    if (res.ok) {
      setFeedback({
        type: 'ok',
        text: t(
          'Camp archived as read-only. Active camp selfies were purged while preserving verification metadata.',
          'تمت أرشفة المعسكر للقراءة فقط وحذف الصور الشخصية مع الاحتفاظ ببيانات التحقق.'
        ),
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {t('Camp Management & Archives', 'إدارة المعسكرات والأرشيف')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t(
              'Only one camp can be active at a time. Default duration is 10 days. Archived camps are strictly read-only.',
              'يُسمح بمعسكر نشط واحد فقط في نفس الوقت. المدة الافتراضية 10 أيام والمعسكرات المؤرشفة للقراءة فقط.'
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewCampForm(!showNewCampForm)}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer self-start"
        >
          <Plus className="w-4 h-4" />
          <span>{t('Guided Camp Setup', 'إنشاء معسكر جديد')}</span>
        </button>
      </div>

      {feedback && (
        <div
          role="status"
          className={`p-4 rounded-xl border text-xs font-medium ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {showNewCampForm && (
        <form
          onSubmit={handleCreateCamp}
          className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4"
        >
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t('New Camp Configuration (Sensible Defaults Applied)', 'إعداد معسكر جديد (تم تطبيق القيم الافتراضية)')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label htmlFor="camp-code" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('Camp Code', 'كود المعسكر')}
              </label>
              <input
                id="camp-code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="camp-name-en" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('Camp Name (English)', 'اسم المعسكر (إنجليزي)')}
              </label>
              <input
                id="camp-name-en"
                type="text"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="camp-name-ar" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('Camp Name (Arabic)', 'اسم المعسكر (عربي)')}
              </label>
              <input
                id="camp-name-ar"
                type="text"
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="camp-start" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('Start Date', 'تاريخ البداية')}
              </label>
              <input
                id="camp-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="camp-duration" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('Duration (Days — Default 10)', 'المدة بالأيام (الافتراضي 10)')}
              </label>
              <input
                id="camp-duration"
                type="number"
                min={1}
                max={60}
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="camp-geofence" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('Geofence Radius (Meters — Default 100m)', 'نطاق الموقع الجغرافي (الافتراضي 100م)')}
              </label>
              <input
                id="camp-geofence"
                type="number"
                min={25}
                max={1000}
                value={geofenceRadiusMeters}
                onChange={(e) => setGeofenceRadiusMeters(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowNewCampForm(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-medium cursor-pointer"
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
            >
              {t('Save Camp Draft', 'حفظ مسودة المعسكر')}
            </button>
          </div>
        </form>
      )}

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
        <table className="w-full text-start border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <th className="py-3.5 px-5 font-semibold">{t('Camp', 'المعسكر')}</th>
              <th className="py-3.5 px-4 font-semibold">{t('Venue & Geofence', 'المقر والنطاق')}</th>
              <th className="py-3.5 px-4 font-semibold">{t('Dates & Duration', 'التواريخ والمدة')}</th>
              <th className="py-3.5 px-4 font-semibold">{t('Status', 'الحالة')}</th>
              <th className="py-3.5 px-5 text-right font-semibold">{t('Actions', 'إجراءات')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {camps.map((camp) => {
              const venue = venues.find((v) => v.id === camp.venueId) || venues[0];
              return (
                <tr key={camp.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                  <td className="py-4 px-5">
                    <p className="font-semibold text-slate-900 dark:text-white">
                      {t(camp.nameEn, camp.nameAr)}
                    </p>
                    <p className="text-slate-500 font-mono tabular-nums mt-0.5">{camp.code}</p>
                  </td>
                  <td className="py-4 px-4">
                    <p className="text-slate-800 dark:text-slate-200">
                      {t(venue.nameEn, venue.nameAr)}
                    </p>
                    <p className="text-slate-500 font-mono tabular-nums mt-0.5">
                      {camp.settings.geofenceRadiusMeters}m radius · ({venue.latitude}, {venue.longitude})
                    </p>
                  </td>
                  <td className="py-4 px-4 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {camp.startDate} → {camp.endDate} ({camp.durationDays}d)
                  </td>
                  <td className="py-4 px-4">
                    {camp.status === CampStatus.ACTIVE && (
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                        {t('Active Camp', 'معسكر نشط')}
                      </span>
                    )}
                    {camp.status === CampStatus.DRAFT && (
                      <span className="text-blue-600 dark:text-blue-400 font-semibold">
                        {t('Draft Setup', 'مسودة')}
                      </span>
                    )}
                    {camp.status === CampStatus.ARCHIVED && (
                      <span className="text-slate-500 dark:text-slate-400 font-medium">
                        {t('Archived (Read-Only)', 'مؤرشف (للقراءة فقط)')}
                      </span>
                    )}
                  </td>
                  <td className="py-4 px-5 text-right space-x-2">
                    {camp.status === CampStatus.DRAFT && (
                      <button
                        type="button"
                        onClick={() => handleActivate(camp.id)}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer"
                      >
                        {t('Activate', 'تفعيل')}
                      </button>
                    )}
                    {camp.status === CampStatus.ACTIVE && (
                      <button
                        type="button"
                        onClick={() => handleArchive(camp.id)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        <span>{t('Archive Camp', 'أرشفة المعسكر')}</span>
                      </button>
                    )}
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

export const AdminInstructorsView: React.FC = () => {
  const { instructors, adminAccounts, profiles, t } = useApp();

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-200 dark:border-slate-800">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          {t('Instructors & Admin Security Boundary', 'المحاضرون وحدود صلاحيات المسؤولين')}
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {t(
            'Instructors have isolated persistent accounts. Maximum two Admin accounts with mandatory TOTP MFA and identical permissions.',
            'يمتلك كل محاضر حساباً مستقلاً ومعزولاً. الحد الأقصى للمسؤولين حسابان فقط بصلاحيات متطابقة ومصادقة ثنائية إلزامية.'
          )}
        </p>
      </div>

      {/* Two Admin Accounts Policy Card */}
      <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('Provisioned Admin Accounts (Hard Cap: 2 / 2)', 'حسابات المسؤولين المعتمدة (الحد الأقصى: 2 / 2)')}
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t('No Super Admin · Public Registration Disabled', 'لا يوجد مدير أعلى · التسجيل العام مغلق')}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {adminAccounts.map((adm) => {
            const prof = profiles.find((p) => p.id === adm.profileId);
            return (
              <div
                key={adm.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between text-xs"
              >
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {prof ? t(prof.fullNameEn, prof.fullNameAr) : adm.profileId}
                  </p>
                  <p className="text-slate-500 font-mono mt-0.5">
                    {prof?.username} · {prof?.email}
                  </p>
                </div>
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Slot {adm.assignedSlot} · TOTP MFA</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Persistent Instructors Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
        <table className="w-full text-start border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <th className="py-3.5 px-5 font-semibold">{t('Instructor', 'المحاضر')}</th>
              <th className="py-3.5 px-4 font-semibold">{t('Username & Verified Email', 'اسم المستخدم والبريد')}</th>
              <th className="py-3.5 px-4 font-semibold">{t('Specialization', 'التخصص')}</th>
              <th className="py-3.5 px-4 text-right font-semibold">{t('Default Lecture Rate', 'فئة المحاضرة الافتراضية')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {instructors.map((inst) => (
              <tr key={inst.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                <td className="py-3.5 px-5">
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {t(inst.fullNameEn, inst.fullNameAr)}
                  </p>
                  <p className="text-slate-500 font-mono tabular-nums mt-0.5">{inst.instructorCode}</p>
                </td>
                <td className="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300">
                  {inst.username} · {inst.email}
                </td>
                <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300">
                  {inst.specialization}
                </td>
                <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                  {inst.defaultLectureRateEgp} EGP
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const AdminStudentsAndGroupsView: React.FC = () => {
  const { activeCamp, groups, students, importStudentsBatch, t } = useApp();
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [importGroupId, setImportGroupId] = useState<string>(groups[0]?.id || 'grp-1');
  const [importMode, setImportMode] = useState<'smart_update' | 'strict_insert'>('smart_update');
  const [rawBatchText, setRawBatchText] = useState<string>(
    'Hana Tarek El-Masry, CITS-2613, Cairo University\nOmar Khaled El-Sayed, CITS-2601, Cairo University (Honors)'
  );
  const [importResult, setImportResult] = useState<{
    ok: boolean;
    errors: { rowNumber: number; message: string }[];
    inserted: number;
    updated: number;
  } | null>(null);

  const campStudents = students.filter(
    (s) =>
      s.campId === activeCamp.id &&
      (selectedGroupId === 'all' || s.groupId === selectedGroupId)
  );

  const handleRunImport = (e: React.FormEvent) => {
    e.preventDefault();
    const lines = rawBatchText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const parsedRows: RawStudentImportRow[] = lines.map((line, index) => {
      const parts = line.split(',').map((p) => p.trim());
      return {
        rowNumber: index + 1,
        studentName: parts[0] || '',
        studentCode: parts[1] || '',
        university: parts[2] || 'Cairo University',
      };
    });

    const res = importStudentsBatch(parsedRows, importGroupId, importMode);
    setImportResult(res);
  };

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-200 dark:border-slate-800">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          {t('Students & Groups Management', 'إدارة الطلاب والمجموعات')}
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {t(
            'Students are camp-specific records without login accounts. Student Code is unique per camp. Batch import validates the entire file before importing.',
            'سجلات الطلاب خاصة بالمعسكر ولا تملك حسابات دخول. كود الطالب فريد داخل المعسكر ويتم فحص ملف الاستيراد بالكامل قبل الحفظ.'
          )}
        </p>
      </div>

      {/* All-or-Nothing Excel/CSV Validator & Smart Update Tool */}
      <form
        onSubmit={handleRunImport}
        className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Upload className="w-4 h-4 text-blue-500" />
              <span>
                {t(
                  'Validated Student Import & Smart Update (All-or-Nothing)',
                  'استيراد الطلاب الموثق والتحديث الذكي (قبول الكل أو رفض الكل)'
                )}
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t(
                'Format per line: Student Name, Student Code, University. If any row has an error, zero records are imported.',
                'الصيغة لكل سطر: اسم الطالب، كود الطالب، الجامعة. في حال وجود خطأ واحد يتم إيقاف الاستيراد بالكامل.'
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              aria-label={t('Target Group for Import', 'المجموعة المستهدفة للاستيراد')}
              value={importGroupId}
              onChange={(e) => setImportGroupId(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-medium"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code}
                </option>
              ))}
            </select>

            <select
              aria-label={t('Import Validation Mode', 'وضع التحقق من الاستيراد')}
              value={importMode}
              onChange={(e) => setImportMode(e.target.value as 'smart_update' | 'strict_insert')}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-medium"
            >
              <option value="smart_update">{t('Smart Update Mode', 'وضع التحديث الذكي')}</option>
              <option value="strict_insert">{t('Strict New Only', 'إضافة جديدة فقط')}</option>
            </select>
          </div>
        </div>

        <textarea
          rows={3}
          aria-label={t('Student batch rows', 'بيانات دفعة الطلاب')}
          value={rawBatchText}
          onChange={(e) => setRawBatchText(e.target.value)}
          className="w-full p-3 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
        />

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() =>
              setRawBatchText('Invalid Row Missing Code, \nDuplicate Student, CITS-2601\nDuplicate Student 2, CITS-2601')
            }
            className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline cursor-pointer"
          >
            {t('Load Error Test Sample (Tests All-or-Nothing Rollback)', 'تحميل عينة خطأ لاختبار الإيقاف الآمن')}
          </button>

          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
          >
            {t('Validate & Import Batch', 'فحص واستيراد الدفعة')}
          </button>
        </div>

        {importResult && (
          <div
            role="status"
            className={`p-4 rounded-xl border text-xs ${
              importResult.ok
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
                : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'
            }`}
          >
            {importResult.ok ? (
              <p className="font-semibold">
                {t(
                  `Batch validated and applied: ${importResult.inserted} added, ${importResult.updated} updated via Smart Update.`,
                  `تم التحقق وتطبيق الدفعة: تمت إضافة ${importResult.inserted} وتحديث ${importResult.updated}.`
                )}
              </p>
            ) : (
              <div className="space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4" />
                  <span>
                    {t(
                      'Validation failed — Zero records imported (All-or-Nothing protection):',
                      'فشل التحقق — لم يتم استيراد أي سجل حمايةً لسلامة البيانات:'
                    )}
                  </span>
                </p>
                <ul className="list-disc list-inside space-y-0.5 font-mono">
                  {importResult.errors.map((err, i) => (
                    <li key={i}>{err.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </form>

      {/* Group Filter Tabs (Interactive Functional Buttons) */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-200/70 dark:bg-slate-900 rounded-xl w-fit">
        <button
          type="button"
          onClick={() => setSelectedGroupId('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
            selectedGroupId === 'all'
              ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          {t('All Groups', 'كل المجموعات')} ({students.filter((s) => s.campId === activeCamp.id).length})
        </button>
        {groups.map((grp) => (
          <button
            key={grp.id}
            type="button"
            onClick={() => setSelectedGroupId(grp.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              selectedGroupId === grp.id
                ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {grp.code}
          </button>
        ))}
      </div>

      {/* Students Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <th className="py-3.5 px-5 font-semibold">{t('Student Code', 'كود الطالب')}</th>
              <th className="py-3.5 px-4 font-semibold">{t('Full Name', 'اسم الطالب')}</th>
              <th className="py-3.5 px-4 font-semibold">{t('Assigned Group', 'المجموعة')}</th>
              <th className="py-3.5 px-4 font-semibold">{t('University', 'الجامعة')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {campStudents.map((stu) => {
              const grp = groups.find((g) => g.id === stu.groupId);
              return (
                <tr key={stu.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-5 font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                    {stu.studentCode}
                  </td>
                  <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                    {stu.fullName}
                  </td>
                  <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                    {grp ? `${grp.code} · ${t(grp.nameEn, grp.nameAr)}` : stu.groupId}
                  </td>
                  <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{stu.university}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
