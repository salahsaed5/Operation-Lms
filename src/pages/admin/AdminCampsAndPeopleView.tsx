import React, { useEffect, useState } from 'react';
import {
  Plus,
  Upload,
  ShieldAlert,
  CheckCircle2,
  Archive,
  Pencil,
  ArrowRightLeft,
  UserPlus,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Camp, CampStatus, Instructor } from '../../types/database';
import { RawStudentImportRow } from '../../domain/businessRules';

export const AdminCampsView: React.FC = () => {
  const {
    camps,
    venues,
    createDraftCamp,
    updateCampAndSettings,
    activateCamp,
    archiveCamp,
    t,
  } = useApp();

  const [showNewCampForm, setShowNewCampForm] = useState(false);
  const [editingCamp, setEditingCamp] = useState<Camp | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const [code, setCode] = useState('CITS-27-Q1');
  const [nameEn, setNameEn] = useState('CITS Winter Algorithms Bootcamp 2027');
  const [nameAr, setNameAr] = useState('معسكر CITS الشتوي للخوارزميات ٢٠٢٧');
  const [venueId, setVenueId] = useState(venues[0]?.id || '');
  const [startDate, setStartDate] = useState('2027-01-15');
  const [durationDays, setDurationDays] = useState(10);
  const [geofenceRadiusMeters, setGeofenceRadiusMeters] = useState(100);
  const [defaultRateEgp, setDefaultRateEgp] = useState(750);

  // Edit camp fields
  const [editNameEn, setEditNameEn] = useState('');
  const [editNameAr, setEditNameAr] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editDurationDays, setEditDurationDays] = useState(10);
  const [editCurrentDay, setEditCurrentDay] = useState(1);
  const [editGeofence, setEditGeofence] = useState(100);
  const [editRateEgp, setEditRateEgp] = useState(700);
  const [editMaxGroups, setEditMaxGroups] = useState(4);

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!venueId && venues[0]?.id) setVenueId(venues[0].id);
  }, [venues, venueId]);

  const startEdit = (camp: Camp) => {
    setEditingCamp(camp);
    setEditNameEn(camp.nameEn);
    setEditNameAr(camp.nameAr);
    setEditStartDate(camp.startDate);
    setEditDurationDays(camp.durationDays);
    setEditCurrentDay(camp.currentCampDay);
    setEditGeofence(camp.settings.geofenceRadiusMeters);
    setEditRateEgp(camp.settings.defaultLectureRateEgp);
    setEditMaxGroups(camp.settings.maxInstructorGroupsPerDay);
    setFeedback(null);
  };

  const handleCreateCamp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await createDraftCamp({
        code,
        nameEn,
        nameAr,
        venueId: venueId || venues[0]?.id,
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
            'Draft camp created with configured settings and geofence.',
            'تم إنشاء مسودة المعسكر بنجاح بالإعدادات المحددة.'
          ),
        });
        setShowNewCampForm(false);
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCamp) return;
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await updateCampAndSettings({
        campId: editingCamp.id,
        nameEn: editNameEn,
        nameAr: editNameAr,
        startDate: editStartDate,
        durationDays: editDurationDays,
        currentCampDay: editCurrentDay,
        geofenceRadiusMeters: editGeofence,
        defaultRateEgp: editRateEgp,
        maxInstructorGroupsPerDay: editMaxGroups,
      });
      if (!res.ok) {
        setFeedback({ type: 'err', text: res.error || 'Failed saving camp settings.' });
      } else {
        setFeedback({
          type: 'ok',
          text: t('Camp settings updated.', 'تم تحديث إعدادات المعسكر.'),
        });
        setEditingCamp(null);
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleActivate = async (campId: string) => {
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await activateCamp(campId);
      if (!res.ok) {
        setFeedback({ type: 'err', text: res.error || 'Cannot activate camp' });
      } else {
        setFeedback({ type: 'ok', text: t('Camp activated.', 'تم تفعيل المعسكر.') });
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleArchive = async (campId: string) => {
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await archiveCamp(campId);
      if (res.ok) {
        setFeedback({
          type: 'ok',
          text: t(
            'Camp archived as read-only. Active camp selfies were purged while preserving verification metadata.',
            'تمت أرشفة المعسكر للقراءة فقط وحذف الصور الشخصية مع الاحتفاظ ببيانات التحقق.'
          ),
        });
      } else {
        setFeedback({ type: 'err', text: res.error || 'Archive failed' });
      }
    } finally {
      setIsBusy(false);
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
          onClick={() => {
            setShowNewCampForm(!showNewCampForm);
            setEditingCamp(null);
          }}
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
            {t('New Camp Configuration', 'إعداد معسكر جديد')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label htmlFor="camp-code" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('Camp Code', 'كود المعسكر')}
              </label>
              <input
                id="camp-code"
                type="text"
                required
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
                required
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
              <label htmlFor="camp-venue" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('Venue', 'المقر')}
              </label>
              <select
                id="camp-venue"
                value={venueId}
                onChange={(e) => setVenueId(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              >
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {t(v.nameEn, v.nameAr)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="camp-start" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('Start Date', 'تاريخ البداية')}
              </label>
              <input
                id="camp-start"
                type="date"
                required
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
                {t('Geofence Radius (m)', 'نطاق الموقع (متر)')}
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
            <div>
              <label htmlFor="camp-rate" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {t('Default Lecture Rate (EGP)', 'فئة المحاضرة (ج.م)')}
              </label>
              <input
                id="camp-rate"
                type="number"
                min={0}
                value={defaultRateEgp}
                onChange={(e) => setDefaultRateEgp(Number(e.target.value))}
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
              disabled={isBusy}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
            >
              {isBusy ? t('Saving...', 'جاري الحفظ...') : t('Save Camp Draft', 'حفظ مسودة المعسكر')}
            </button>
          </div>
        </form>
      )}

      {editingCamp && (
        <form
          onSubmit={handleSaveEdit}
          className="p-6 rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-white dark:bg-slate-900 space-y-4"
        >
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {t('Edit Camp & Operational Settings:', 'تعديل إعدادات المعسكر:')} {editingCamp.code}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div>
              <label className="block font-medium mb-1">{t('Name (EN)', 'الاسم (إنجليزي)')}</label>
              <input
                type="text"
                required
                value={editNameEn}
                onChange={(e) => setEditNameEn(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">{t('Name (AR)', 'الاسم (عربي)')}</label>
              <input
                type="text"
                value={editNameAr}
                onChange={(e) => setEditNameAr(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">{t('Start Date', 'تاريخ البداية')}</label>
              <input
                type="date"
                required
                value={editStartDate}
                onChange={(e) => setEditStartDate(e.target.value)}
                className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">{t('Duration (Days)', 'المدة بالأيام')}</label>
              <input
                type="number"
                min={1}
                max={60}
                value={editDurationDays}
                onChange={(e) => setEditDurationDays(Number(e.target.value))}
                className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">{t('Current Camp Day', 'اليوم التشغيلي الحالي')}</label>
              <input
                type="number"
                min={1}
                max={editDurationDays}
                value={editCurrentDay}
                onChange={(e) => setEditCurrentDay(Number(e.target.value))}
                className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">{t('Geofence (m)', 'النطاق الجغرافي (م)')}</label>
              <input
                type="number"
                min={25}
                max={1000}
                value={editGeofence}
                onChange={(e) => setEditGeofence(Number(e.target.value))}
                className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">{t('Default Rate (EGP)', 'الفئة الافتراضية (ج.م)')}</label>
              <input
                type="number"
                min={0}
                value={editRateEgp}
                onChange={(e) => setEditRateEgp(Number(e.target.value))}
                className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">{t('Max Instructor Groups/Day', 'أقصى مجموعات باليوم')}</label>
              <input
                type="number"
                min={1}
                max={8}
                value={editMaxGroups}
                onChange={(e) => setEditMaxGroups(Number(e.target.value))}
                className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingCamp(null)}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-medium cursor-pointer"
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button
              type="submit"
              disabled={isBusy}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
            >
              {isBusy ? t('Saving...', 'جاري الحفظ...') : t('Save Settings', 'حفظ الإعدادات')}
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
                      {venue ? t(venue.nameEn, venue.nameAr) : camp.venueId}
                    </p>
                    <p className="text-slate-500 font-mono tabular-nums mt-0.5">
                      {camp.settings.geofenceRadiusMeters}m radius ·{' '}
                      {venue ? `(${venue.latitude}, ${venue.longitude})` : ''}
                    </p>
                  </td>
                  <td className="py-4 px-4 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {camp.startDate} → {camp.endDate} (Day {camp.currentCampDay}/{camp.durationDays})
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
                    {camp.status !== CampStatus.ARCHIVED && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => startEdit(camp)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Pencil className="w-3 h-3" />
                        <span>{t('Edit', 'تعديل')}</span>
                      </button>
                    )}
                    {camp.status === CampStatus.DRAFT && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleActivate(camp.id)}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer"
                      >
                        {t('Activate', 'تفعيل')}
                      </button>
                    )}
                    {camp.status === CampStatus.ACTIVE && (
                      <button
                        type="button"
                        disabled={isBusy}
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
  const {
    activeCamp,
    campInstructorIds,
    instructors,
    adminAccounts,
    profiles,
    updateInstructorAccount,
    t,
  } = useApp();

  const [editingInst, setEditingInst] = useState<Instructor | null>(null);
  const [specialization, setSpecialization] = useState('');
  const [rateEgp, setRateEgp] = useState(700);
  const [isActive, setIsActive] = useState(true);
  const [assignedToCamp, setAssignedToCamp] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const assignedSet = new Set(
    activeCamp ? campInstructorIds[activeCamp.id] || [] : []
  );

  const openEdit = (inst: Instructor) => {
    setEditingInst(inst);
    setSpecialization(inst.specialization);
    setRateEgp(inst.defaultLectureRateEgp);
    setIsActive(inst.isActive);
    setAssignedToCamp(activeCamp ? assignedSet.has(inst.id) : true);
    setFeedback(null);
  };

  const handleSaveInst = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInst) return;
    setIsBusy(true);
    try {
      const res = await updateInstructorAccount({
        instructorId: editingInst.id,
        profileId: editingInst.profileId,
        specialization,
        defaultLectureRateEgp: rateEgp,
        isActive,
        assignedToActiveCamp: assignedToCamp,
      });
      if (!res.ok) {
        setFeedback({ ok: false, text: res.error || 'Update failed.' });
      } else {
        setFeedback({
          ok: true,
          text: t(
            'Instructor settings saved. Note: already scheduled lectures retain their frozen rate.',
            'تم حفظ بيانات المحاضر. ملاحظة: المحاضرات المجدولة مسبقاً تحتفظ بفئتها المثبتة.'
          ),
        });
        setEditingInst(null);
      }
    } finally {
      setIsBusy(false);
    }
  };

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

      {editingInst && (
        <form
          onSubmit={handleSaveInst}
          className="p-6 rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-white dark:bg-slate-900 space-y-4 text-xs"
        >
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('Edit Instructor:', 'تعديل بيانات المحاضر:')} {t(editingInst.fullNameEn, editingInst.fullNameAr)}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block font-medium mb-1">{t('Specialization', 'التخصص')}</label>
              <input
                type="text"
                required
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">{t('Default Lecture Rate (EGP)', 'فئة المحاضرة (ج.م)')}</label>
              <input
                type="number"
                min={0}
                value={rateEgp}
                onChange={(e) => setRateEgp(Number(e.target.value))}
                className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <label className="flex items-center gap-2 pt-5 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded text-blue-600"
              />
              <span>{t('Account Active (Can Sign In)', 'الحساب نشط')}</span>
            </label>
            {activeCamp && (
              <label className="flex items-center gap-2 pt-5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={assignedToCamp}
                  onChange={(e) => setAssignedToCamp(e.target.checked)}
                  className="rounded text-blue-600"
                />
                <span>{t(`Assigned to ${activeCamp.code}`, `معين في ${activeCamp.code}`)}</span>
              </label>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingInst(null)}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 font-medium cursor-pointer"
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button
              type="submit"
              disabled={isBusy}
              className="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer"
            >
              {isBusy ? t('Saving...', 'جاري الحفظ...') : t('Save Changes', 'حفظ التعديلات')}
            </button>
          </div>
        </form>
      )}

      {/* Persistent Instructors Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
        <table className="w-full text-start border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <th className="py-3.5 px-5 font-semibold">{t('Instructor', 'المحاضر')}</th>
              <th className="py-3.5 px-4 font-semibold">{t('Username & Verified Email', 'اسم المستخدم والبريد')}</th>
              <th className="py-3.5 px-4 font-semibold">{t('Specialization', 'التخصص')}</th>
              <th className="py-3.5 px-4 font-semibold">{t('Status', 'الحالة')}</th>
              <th className="py-3.5 px-4 text-right font-semibold">{t('Default Rate', 'الفئة الافتراضية')}</th>
              <th className="py-3.5 px-5 text-right font-semibold">{t('Actions', 'إجراءات')}</th>
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
                <td className="py-3.5 px-4">
                  <span
                    className={`font-semibold ${
                      inst.isActive
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {inst.isActive ? t('Active', 'نشط') : t('Disabled', 'معطل')}
                  </span>
                </td>
                <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                  {inst.defaultLectureRateEgp} EGP
                </td>
                <td className="py-3.5 px-5 text-right">
                  <button
                    type="button"
                    onClick={() => openEdit(inst)}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" />
                    <span>{t('Edit', 'تعديل')}</span>
                  </button>
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
  const {
    activeCamp,
    groups,
    rooms,
    instructors,
    students,
    studentTransfers,
    upsertGroup,
    createSingleStudent,
    transferStudent,
    importStudentsBatch,
    t,
  } = useApp();

  const campGroups = activeCamp ? groups.filter((g) => g.campId === activeCamp.id) : [];

  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [importGroupId, setImportGroupId] = useState<string>(campGroups[0]?.id || '');
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

  // Group Form state
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [grpCode, setGrpCode] = useState('GRP-C');
  const [grpNameEn, setGrpNameEn] = useState('Group Gamma — Graph Theory');
  const [grpNameAr, setGrpNameAr] = useState('المجموعة الثالثة — نظرية المخططات');
  const [grpTrack, setGrpTrack] = useState('Competitive Programming L2');
  const [grpRoomId, setGrpRoomId] = useState(rooms[0]?.id || '');
  const [grpInstId, setGrpInstId] = useState(instructors[0]?.id || '');
  const [grpCap, setGrpCap] = useState(30);

  // Single Student Form
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [stuCode, setStuCode] = useState('');
  const [stuName, setStuName] = useState('');
  const [stuUniv, setStuUniv] = useState('Cairo University');
  const [stuGroupId, setStuGroupId] = useState(campGroups[0]?.id || '');

  // Transfer Modal / Form
  const [transferTargetStuId, setTransferTargetStuId] = useState<string | null>(null);
  const [transferToGroupId, setTransferToGroupId] = useState('');
  const [transferDay, setTransferDay] = useState(activeCamp?.currentCampDay || 1);
  const [transferReason, setTransferReason] = useState('');

  const [actionNotice, setActionNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!importGroupId && campGroups[0]?.id) setImportGroupId(campGroups[0].id);
    if (!stuGroupId && campGroups[0]?.id) setStuGroupId(campGroups[0].id);
    if (!grpRoomId && rooms[0]?.id) setGrpRoomId(rooms[0].id);
    if (!grpInstId && instructors[0]?.id) setGrpInstId(instructors[0].id);
  }, [campGroups, rooms, instructors, importGroupId, stuGroupId, grpRoomId, grpInstId]);

  if (!activeCamp) {
    return (
      <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-500">
        {t('Select or create an active camp first to manage groups and students.', 'أنشئ معسكراً نشطاً أولاً لإدارة المجموعات والطلاب.')}
      </div>
    );
  }

  const campStudents = students.filter(
    (s) =>
      s.campId === activeCamp.id &&
      (selectedGroupId === 'all' || s.groupId === selectedGroupId)
  );
  const campTransfers = studentTransfers.filter((tr) => tr.campId === activeCamp.id);

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsBusy(true);
    setActionNotice(null);
    try {
      const res = await upsertGroup({
        code: grpCode,
        nameEn: grpNameEn,
        nameAr: grpNameAr,
        track: grpTrack,
        defaultRoomId: grpRoomId,
        primaryInstructorId: grpInstId,
        capacity: grpCap,
      });
      if (!res.ok) {
        setActionNotice({ ok: false, text: res.error || 'Failed saving group.' });
      } else {
        setActionNotice({ ok: true, text: t('Training group saved.', 'تم حفظ المجموعة التدريبية.') });
        setShowGroupForm(false);
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateSingleStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsBusy(true);
    setActionNotice(null);
    try {
      const res = await createSingleStudent({
        groupId: stuGroupId || campGroups[0]?.id,
        studentCode: stuCode,
        fullName: stuName,
        university: stuUniv,
      });
      if (!res.ok) {
        setActionNotice({ ok: false, text: res.error || 'Failed adding student.' });
      } else {
        setActionNotice({ ok: true, text: t('Student added.', 'تمت إضافة الطالب.') });
        setStuCode('');
        setStuName('');
        setShowStudentForm(false);
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleSubmitTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferTargetStuId) return;
    setIsBusy(true);
    setActionNotice(null);
    try {
      const res = await transferStudent({
        studentId: transferTargetStuId,
        toGroupId: transferToGroupId,
        effectiveCampDay: transferDay,
        reason: transferReason,
      });
      if (!res.ok) {
        setActionNotice({ ok: false, text: res.error || 'Transfer failed.' });
      } else {
        setActionNotice({
          ok: true,
          text: t(
            'Student transferred cleanly. Historical attendance sheets before effective day retain prior group attribution.',
            'تم نقل الطالب مع الحفاظ على انتماء كشوف الحضور السابقة ليوم التنفيذ.'
          ),
        });
        setTransferTargetStuId(null);
        setTransferReason('');
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleRunImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsBusy(true);
    try {
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

      const res = await importStudentsBatch(
        parsedRows,
        importGroupId || campGroups[0]?.id,
        importMode
      );
      setImportResult(res);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {t('Students & Groups Management', 'إدارة الطلاب والمجموعات')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t(
              'Students are camp-specific records without login accounts. Student Code is unique per camp. Batch import validates all rows atomically.',
              'سجلات الطلاب خاصة بالمعسكر ولا تملك حسابات دخول. كود الطالب فريد داخل المعسكر ويتم فحص ملف الاستيراد بالكامل.'
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowGroupForm(!showGroupForm)}
            className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-blue-500" />
            <span>{t('New Group', 'مجموعة جديدة')}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowStudentForm(!showStudentForm)}
            className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>{t('Add Student', 'إضافة طالب')}</span>
          </button>
        </div>
      </div>

      {actionNotice && (
        <div
          role="status"
          className={`p-3.5 rounded-xl border text-xs font-medium ${
            actionNotice.ok
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'
          }`}
        >
          {actionNotice.text}
        </div>
      )}

      {showGroupForm && (
        <form
          onSubmit={handleSaveGroup}
          className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4 text-xs"
        >
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('Create Training Group', 'إنشاء مجموعة تدريبية جديدة')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input
              type="text"
              required
              placeholder={t('Code (e.g. GRP-C)', 'الكود')}
              value={grpCode}
              onChange={(e) => setGrpCode(e.target.value)}
              className="px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            />
            <input
              type="text"
              required
              placeholder={t('Name (EN)', 'الاسم (إنجليزي)')}
              value={grpNameEn}
              onChange={(e) => setGrpNameEn(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            />
            <input
              type="text"
              placeholder={t('Name (AR)', 'الاسم (عربي)')}
              value={grpNameAr}
              onChange={(e) => setGrpNameAr(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            />
            <input
              type="text"
              required
              placeholder={t('Track', 'المسار')}
              value={grpTrack}
              onChange={(e) => setGrpTrack(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            />
            <select
              value={grpRoomId}
              onChange={(e) => setGrpRoomId(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            >
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} ({r.name})
                </option>
              ))}
            </select>
            <select
              value={grpInstId}
              onChange={(e) => setGrpInstId(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            >
              {instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {t(i.fullNameEn, i.fullNameAr)}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={100}
              value={grpCap}
              onChange={(e) => setGrpCap(Number(e.target.value))}
              className="px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowGroupForm(false)}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer"
              >
                {t('Cancel', 'إلغاء')}
              </button>
              <button
                type="submit"
                disabled={isBusy}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer"
              >
                {t('Create', 'إنشاء')}
              </button>
            </div>
          </div>
        </form>
      )}

      {showStudentForm && (
        <form
          onSubmit={handleCreateSingleStudent}
          className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4 text-xs"
        >
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('Enroll Individual Student', 'تسجيل طالب جديد')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              type="text"
              required
              placeholder={t('Student Code (e.g. CITS-2615)', 'كود الطالب')}
              value={stuCode}
              onChange={(e) => setStuCode(e.target.value)}
              className="px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            />
            <input
              type="text"
              required
              placeholder={t('Full Name', 'الاسم الكامل')}
              value={stuName}
              onChange={(e) => setStuName(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            />
            <input
              type="text"
              placeholder={t('University', 'الجامعة')}
              value={stuUniv}
              onChange={(e) => setStuUniv(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            />
            <select
              value={stuGroupId}
              onChange={(e) => setStuGroupId(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            >
              {campGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowStudentForm(false)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer"
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button
              type="submit"
              disabled={isBusy}
              className="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer"
            >
              {t('Save Student', 'حفظ الطالب')}
            </button>
          </div>
        </form>
      )}

      {transferTargetStuId && (
        <form
          onSubmit={handleSubmitTransfer}
          className="p-6 rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-white dark:bg-slate-900 space-y-4 text-xs"
        >
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-blue-500" />
            <span>
              {t('Transfer Student Between Groups (Preserves Prior Day History)', 'نقل طالب لمجموعة أخرى (مع حفظ سجل الأيام السابقة)')}
            </span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-medium mb-1">{t('Destination Group', 'المجموعة الجديدة')}</label>
              <select
                value={transferToGroupId}
                onChange={(e) => setTransferToGroupId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              >
                {campGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code} · {t(g.nameEn, g.nameAr)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium mb-1">{t('Effective Camp Day', 'يسري من اليوم')}</label>
              <input
                type="number"
                min={1}
                max={activeCamp.durationDays}
                value={transferDay}
                onChange={(e) => setTransferDay(Number(e.target.value))}
                className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">{t('Audit Reason', 'سبب النقل')}</label>
              <input
                type="text"
                required
                placeholder={t('e.g. Level assessment promotion', 'مثال: ترقية المستوى التدريبي')}
                value={transferReason}
                onChange={(e) => setTransferReason(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setTransferTargetStuId(null)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer"
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button
              type="submit"
              disabled={isBusy}
              className="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer"
            >
              {t('Confirm Transfer', 'تأكيد النقل')}
            </button>
          </div>
        </form>
      )}

      {/* Batch Import Form */}
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
                'Format per line: Student Name, Student Code, University. Any error aborts the entire batch; Smart Update preserves student transfer history (cross-group moves require Student Transfer).',
                'الصيغة لكل سطر: اسم الطالب، كود الطالب، الجامعة. أي خطأ يوقف الدفعة بالكامل؛ التحديث الذكي يحافظ على سجل النقل التاريخي (تغيير المجموعة يتطلب أداة نقل الطالب).'
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
              {campGroups.map((g) => (
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
            disabled={isBusy || campGroups.length === 0}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
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

      {/* Group Filter Tabs */}
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
        {campGroups.map((grp) => (
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
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
        <table className="w-full text-start border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <th className="py-3.5 px-5 font-semibold">{t('Student Code', 'كود الطالب')}</th>
              <th className="py-3.5 px-4 font-semibold">{t('Full Name', 'اسم الطالب')}</th>
              <th className="py-3.5 px-4 font-semibold">{t('Assigned Group', 'المجموعة')}</th>
              <th className="py-3.5 px-4 font-semibold">{t('University', 'الجامعة')}</th>
              <th className="py-3.5 px-5 text-right font-semibold">{t('Transfer', 'نقل')}</th>
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
                  <td className="py-3 px-5 text-right">
                    <button
                      type="button"
                      disabled={campGroups.length < 2}
                      onClick={() => {
                        const otherGroup = campGroups.find((g) => g.id !== stu.groupId);
                        setTransferTargetStuId(stu.id);
                        setTransferToGroupId(otherGroup?.id || '');
                        setTransferDay(activeCamp.currentCampDay);
                      }}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <ArrowRightLeft className="w-3 h-3" />
                      <span>{t('Transfer', 'نقل')}</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {campTransfers.length > 0 && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 text-xs">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('Recent Group Transfer History', 'سجل نقل الطلاب بين المجموعات')}
          </h2>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {campTransfers.map((tr) => {
              const stu = students.find((s) => s.id === tr.studentId);
              const fromG = groups.find((g) => g.id === tr.fromGroupId);
              const toG = groups.find((g) => g.id === tr.toGroupId);
              return (
                <div key={tr.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {stu?.fullName || tr.studentId}
                    </span>{' '}
                    <span className="font-mono text-slate-500">
                      ({fromG?.code || tr.fromGroupId} → {toG?.code || tr.toGroupId}, Day{' '}
                      {tr.effectiveCampDay})
                    </span>
                    <p className="text-slate-500 mt-0.5">{tr.reason}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
