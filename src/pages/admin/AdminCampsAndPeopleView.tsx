import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Upload,
  ShieldAlert,
  CheckCircle2,
  Archive,
  Pencil,
  ArrowRightLeft,
  UserPlus,
  Search,
  Tent,
  Users,
  GraduationCap,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Camp, CampStatus, Instructor } from '../../types/database';
import { RawStudentImportRow } from '../../domain/businessRules';
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

type CampFilter = 'all' | CampStatus;
type InstructorFilter = 'all' | 'active' | 'disabled';

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
  const [archiveTarget, setArchiveTarget] = useState<Camp | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<CampFilter>('all');
  const [isBusy, setIsBusy] = useState(false);

  const [code, setCode] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [venueId, setVenueId] = useState(venues[0]?.id || '');
  const [startDate, setStartDate] = useState('');
  const [durationDays, setDurationDays] = useState(10);
  const [geofenceRadiusMeters, setGeofenceRadiusMeters] = useState(100);
  const [defaultRateEgp, setDefaultRateEgp] = useState(700);

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

  const filteredCamps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return camps.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        c.code.toLowerCase().includes(q) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.nameAr.toLowerCase().includes(q)
      );
    });
  }, [camps, searchQuery, statusFilter]);

  const startEdit = (camp: Camp) => {
    setEditingCamp(camp);
    setShowNewCampForm(false);
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
        code: code.trim(),
        nameEn: nameEn.trim(),
        nameAr: nameAr.trim(),
        venueId: venueId || venues[0]?.id,
        startDate,
        durationDays,
        geofenceRadiusMeters,
        defaultRateEgp,
      });
      if (!res.ok) {
        setFeedback({ type: 'err', text: res.error || t('Unable to create camp.', 'تعذر إنشاء المعسكر.') });
      } else {
        setFeedback({
          type: 'ok',
          text: t(
            'Draft camp created with configured settings and geofence.',
            'تم إنشاء مسودة المعسكر بنجاح بالإعدادات المحددة.'
          ),
        });
        setCode('');
        setNameEn('');
        setNameAr('');
        setStartDate('');
        setDurationDays(10);
        setGeofenceRadiusMeters(100);
        setDefaultRateEgp(700);
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
        nameEn: editNameEn.trim(),
        nameAr: editNameAr.trim(),
        startDate: editStartDate,
        durationDays: editDurationDays,
        currentCampDay: editCurrentDay,
        geofenceRadiusMeters: editGeofence,
        defaultRateEgp: editRateEgp,
        maxInstructorGroupsPerDay: editMaxGroups,
      });
      if (!res.ok) {
        setFeedback({ type: 'err', text: res.error || t('Failed saving camp settings.', 'فشل حفظ إعدادات المعسكر.') });
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
        setFeedback({ type: 'err', text: res.error || t('Cannot activate camp.', 'تعذر تفعيل المعسكر.') });
      } else {
        setFeedback({ type: 'ok', text: t('Camp activated.', 'تم تفعيل المعسكر.') });
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleConfirmArchive = async () => {
    if (!archiveTarget) return;
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await archiveCamp(archiveTarget.id);
      if (res.ok) {
        setFeedback({
          type: 'ok',
          text: t(
            'Camp archived as read-only. Active camp selfies were purged while preserving verification metadata.',
            'تمت أرشفة المعسكر للقراءة فقط وحذف الصور الشخصية مع الاحتفاظ ببيانات التحقق.'
          ),
        });
      } else {
        setFeedback({ type: 'err', text: res.error || t('Archive failed.', 'فشلت عملية الأرشفة.') });
      }
      setArchiveTarget(null);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Camp Management & Archives', 'إدارة المعسكرات والأرشيف')}
        subtitle={t(
          'Only one camp can be active at a time. Default duration is 10 days and archived camps become read-only.',
          'يُسمح بمعسكر نشط واحد فقط في نفس الوقت. المدة الافتراضية 10 أيام والمعسكرات المؤرشفة للقراءة فقط.'
        )}
        actions={
          <button
            type="button"
            onClick={() => {
              setShowNewCampForm((prev) => !prev);
              setEditingCamp(null);
              setFeedback(null);
            }}
            className={BTN_PRIMARY}
          >
            <Plus className="w-4 h-4" />
            <span>{t('New Camp', 'إنشاء معسكر جديد')}</span>
          </button>
        }
      />

      {feedback && (
        <InlineBanner
          type={feedback.type === 'ok' ? 'success' : 'error'}
          message={feedback.text}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {/* Search & Status Filter Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('Search camps by name or code...', 'ابحث بالاسم أو الكود...')}
            aria-label={t('Search camps', 'بحث المعسكرات')}
            className={`${INPUT_CLASS} ps-9`}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {(
            [
              { id: 'all', en: 'All', ar: 'الكل' },
              { id: CampStatus.ACTIVE, en: 'Active', ar: 'نشط' },
              { id: CampStatus.DRAFT, en: 'Draft', ar: 'مسودة' },
              { id: CampStatus.ARCHIVED, en: 'Archived', ar: 'مؤرشف' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                statusFilter === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {t(tab.en, tab.ar)}
            </button>
          ))}
        </div>
      </div>

      {showNewCampForm && (
        <form onSubmit={handleCreateCamp} className={`${SURFACE_CARD} p-5 sm:p-6 space-y-4`}>
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              {t('Create New Draft Camp', 'إعداد معسكر جديد (مسودة)')}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label htmlFor="camp-code" className={LABEL_CLASS}>
                {t('Camp Code *', 'كود المعسكر *')}
              </label>
              <input
                id="camp-code"
                type="text"
                required
                placeholder={t('e.g. CITS-27-Q1', 'مثال: CITS-27-Q1')}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={`${INPUT_CLASS} font-mono`}
              />
            </div>
            <div>
              <label htmlFor="camp-name-en" className={LABEL_CLASS}>
                {t('Camp Name (English) *', 'اسم المعسكر (إنجليزي) *')}
              </label>
              <input
                id="camp-name-en"
                type="text"
                required
                placeholder={t('e.g. CITS Winter Bootcamp', 'اسم المعسكر بالإنجليزية')}
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="camp-name-ar" className={LABEL_CLASS}>
                {t('Camp Name (Arabic)', 'اسم المعسكر (عربي)')}
              </label>
              <input
                id="camp-name-ar"
                type="text"
                placeholder={t('Optional Arabic title', 'اسم المعسكر بالعربية')}
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="camp-venue" className={LABEL_CLASS}>
                {t('Training Venue', 'المقر التدريبي')}
              </label>
              <select
                id="camp-venue"
                value={venueId}
                onChange={(e) => setVenueId(e.target.value)}
                className={SELECT_CLASS}
              >
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {t(v.nameEn, v.nameAr)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="camp-start" className={LABEL_CLASS}>
                {t('Start Date *', 'تاريخ البداية *')}
              </label>
              <input
                id="camp-start"
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={`${INPUT_CLASS} font-mono`}
              />
            </div>
            <div>
              <label htmlFor="camp-duration" className={LABEL_CLASS}>
                {t('Duration (Days)', 'المدة بالأيام')}
              </label>
              <input
                id="camp-duration"
                type="number"
                min={1}
                max={60}
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
            <div>
              <label htmlFor="camp-geofence" className={LABEL_CLASS}>
                {t('Geofence Radius (m)', 'نطاق الموقع (متر)')}
              </label>
              <input
                id="camp-geofence"
                type="number"
                min={25}
                max={1000}
                value={geofenceRadiusMeters}
                onChange={(e) => setGeofenceRadiusMeters(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
            <div>
              <label htmlFor="camp-rate" className={LABEL_CLASS}>
                {t('Default Lecture Rate (EGP)', 'فئة المحاضرة الافتراضية (ج.م)')}
              </label>
              <input
                id="camp-rate"
                type="number"
                min={0}
                value={defaultRateEgp}
                onChange={(e) => setDefaultRateEgp(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setShowNewCampForm(false)}
              className={BTN_SECONDARY}
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button type="submit" disabled={isBusy} className={BTN_PRIMARY}>
              {isBusy ? t('Saving...', 'جاري الحفظ...') : t('Save Camp Draft', 'حفظ مسودة المعسكر')}
            </button>
          </div>
        </form>
      )}

      {editingCamp && (
        <form
          onSubmit={handleSaveEdit}
          className={`${SURFACE_CARD} border-blue-200 dark:border-blue-900/60 p-5 sm:p-6 space-y-4`}
        >
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              {t('Edit Camp Settings:', 'تعديل إعدادات المعسكر:')}{' '}
              <span className="font-mono text-blue-600 dark:text-blue-400">{editingCamp.code}</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label htmlFor="edit-camp-en" className={LABEL_CLASS}>
                {t('Name (English) *', 'الاسم (إنجليزي) *')}
              </label>
              <input
                id="edit-camp-en"
                type="text"
                required
                value={editNameEn}
                onChange={(e) => setEditNameEn(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="edit-camp-ar" className={LABEL_CLASS}>
                {t('Name (Arabic)', 'الاسم (عربي)')}
              </label>
              <input
                id="edit-camp-ar"
                type="text"
                value={editNameAr}
                onChange={(e) => setEditNameAr(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="edit-camp-start" className={LABEL_CLASS}>
                {t('Start Date *', 'تاريخ البداية *')}
              </label>
              <input
                id="edit-camp-start"
                type="date"
                required
                value={editStartDate}
                onChange={(e) => setEditStartDate(e.target.value)}
                className={`${INPUT_CLASS} font-mono`}
              />
            </div>
            <div>
              <label htmlFor="edit-camp-duration" className={LABEL_CLASS}>
                {t('Duration (Days)', 'المدة بالأيام')}
              </label>
              <input
                id="edit-camp-duration"
                type="number"
                min={1}
                max={60}
                value={editDurationDays}
                onChange={(e) => setEditDurationDays(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
            <div>
              <label htmlFor="edit-camp-day" className={LABEL_CLASS}>
                {t('Current Operational Day', 'اليوم التشغيلي الحالي')}
              </label>
              <input
                id="edit-camp-day"
                type="number"
                min={1}
                max={editDurationDays}
                value={editCurrentDay}
                onChange={(e) => setEditCurrentDay(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
            <div>
              <label htmlFor="edit-camp-geo" className={LABEL_CLASS}>
                {t('Geofence Radius (m)', 'النطاق الجغرافي (م)')}
              </label>
              <input
                id="edit-camp-geo"
                type="number"
                min={25}
                max={1000}
                value={editGeofence}
                onChange={(e) => setEditGeofence(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
            <div>
              <label htmlFor="edit-camp-rate" className={LABEL_CLASS}>
                {t('Default Rate (EGP)', 'الفئة الافتراضية (ج.م)')}
              </label>
              <input
                id="edit-camp-rate"
                type="number"
                min={0}
                value={editRateEgp}
                onChange={(e) => setEditRateEgp(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
            <div>
              <label htmlFor="edit-camp-max" className={LABEL_CLASS}>
                {t('Max Instructor Groups/Day', 'أقصى مجموعات باليوم')}
              </label>
              <input
                id="edit-camp-max"
                type="number"
                min={1}
                max={8}
                value={editMaxGroups}
                onChange={(e) => setEditMaxGroups(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setEditingCamp(null)}
              className={BTN_SECONDARY}
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button type="submit" disabled={isBusy} className={BTN_PRIMARY}>
              {isBusy ? t('Saving...', 'جاري الحفظ...') : t('Save Settings', 'حفظ الإعدادات')}
            </button>
          </div>
        </form>
      )}

      {filteredCamps.length === 0 ? (
        <EmptyState
          icon={Tent}
          title={t('No matching camps found', 'لم يتم العثور على معسكرات مطابقة')}
          description={t(
            'Adjust your search filter or create a new draft camp.',
            'عدّل معايير البحث أو أنشئ مسودة معسكر جديد.'
          )}
        />
      ) : (
        <div className={`${SURFACE_CARD} overflow-hidden`}>
          {/* Mobile Camp Cards */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
            {filteredCamps.map((camp) => {
              const venue = venues.find((v) => v.id === camp.venueId) || venues[0];
              return (
                <div key={camp.id} className="p-4 space-y-3 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm text-slate-900 dark:text-white">
                        {t(camp.nameEn, camp.nameAr)}
                      </p>
                      <p className="font-mono text-slate-500 mt-0.5">{camp.code}</p>
                    </div>
                    <StatusBadge
                      tone={
                        camp.status === CampStatus.ACTIVE
                          ? 'success'
                          : camp.status === CampStatus.DRAFT
                          ? 'info'
                          : 'neutral'
                      }
                    >
                      {camp.status === CampStatus.ACTIVE
                        ? t('Active', 'نشط')
                        : camp.status === CampStatus.DRAFT
                        ? t('Draft', 'مسودة')
                        : t('Archived', 'مؤرشف')}
                    </StatusBadge>
                  </div>

                  <div className="text-slate-600 dark:text-slate-400 space-y-1">
                    <p>
                      {venue ? t(venue.nameEn, venue.nameAr) : camp.venueId} ·{' '}
                      <span className="font-mono">{camp.settings.geofenceRadiusMeters}m</span>
                    </p>
                    <p className="font-mono tabular-nums">
                      {camp.startDate} → {camp.endDate} ({t(`Day ${camp.currentCampDay}/${camp.durationDays}`, `اليوم ${camp.currentCampDay}/${camp.durationDays}`)})
                    </p>
                  </div>

                  {camp.status !== CampStatus.ARCHIVED && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => startEdit(camp)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Pencil className="w-3 h-3" />
                        <span>{t('Edit', 'تعديل')}</span>
                      </button>
                      {camp.status === CampStatus.DRAFT && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleActivate(camp.id)}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold cursor-pointer"
                        >
                          {t('Activate', 'تفعيل')}
                        </button>
                      )}
                      {camp.status === CampStatus.ACTIVE && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setArchiveTarget(camp)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Archive className="w-3.5 h-3.5" />
                          <span>{t('Archive', 'أرشفة')}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop Camps Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-start border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-5 font-semibold text-start">{t('Camp', 'المعسكر')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('Venue & Geofence', 'المقر والنطاق')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('Dates & Progress', 'التواريخ والتقدم')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('Status', 'الحالة')}</th>
                  <th className="py-3 px-5 font-semibold text-end">{t('Actions', 'إجراءات')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredCamps.map((camp) => {
                  const venue = venues.find((v) => v.id === camp.venueId) || venues[0];
                  return (
                    <tr
                      key={camp.id}
                      className="odd:bg-white even:bg-slate-50/60 dark:odd:bg-slate-900 dark:even:bg-slate-900/60 hover:bg-blue-50/40 dark:hover:bg-slate-800/40"
                    >
                      <td className="py-3.5 px-5">
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {t(camp.nameEn, camp.nameAr)}
                        </p>
                        <p className="text-slate-500 font-mono tabular-nums mt-0.5">{camp.code}</p>
                      </td>
                      <td className="py-3.5 px-4">
                        <p className="text-slate-800 dark:text-slate-200">
                          {venue ? t(venue.nameEn, venue.nameAr) : camp.venueId}
                        </p>
                        <p className="text-slate-500 font-mono tabular-nums mt-0.5">
                          {camp.settings.geofenceRadiusMeters}m ·{' '}
                          {camp.settings.defaultLectureRateEgp} EGP
                        </p>
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        <div>{camp.startDate} → {camp.endDate}</div>
                        <div className="text-slate-500 mt-0.5">
                          {t(
                            `Day ${camp.currentCampDay} / ${camp.durationDays}`,
                            `اليوم ${camp.currentCampDay} / ${camp.durationDays}`
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        {camp.status === CampStatus.ACTIVE && (
                          <StatusBadge tone="success">{t('Active Camp', 'معسكر نشط')}</StatusBadge>
                        )}
                        {camp.status === CampStatus.DRAFT && (
                          <StatusBadge tone="info">{t('Draft Setup', 'مسودة')}</StatusBadge>
                        )}
                        {camp.status === CampStatus.ARCHIVED && (
                          <StatusBadge tone="neutral">
                            {t('Archived (Read-Only)', 'مؤرشف (للقراءة فقط)')}
                          </StatusBadge>
                        )}
                      </td>
                      <td className="py-3.5 px-5 text-end">
                        <div className="inline-flex items-center gap-2">
                          {camp.status !== CampStatus.ARCHIVED && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => startEdit(camp)}
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium inline-flex items-center gap-1 cursor-pointer"
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
                              onClick={() => setArchiveTarget(camp)}
                              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Archive className="w-3.5 h-3.5" />
                              <span>{t('Archive Camp', 'أرشفة المعسكر')}</span>
                            </button>
                          )}
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

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title={t('Archive Active Camp?', 'أرشفة المعسكر النشط؟')}
        description={
          archiveTarget
            ? t(
                `Archiving ${archiveTarget.code} marks all camp records permanently read-only and purges check-in selfie photos while retaining verification metadata. Proceed?`,
                `سيتم تحويل المعسكر ${archiveTarget.code} إلى وضع القراءة فقط وحذف صور التحقق مع الاحتفاظ ببيانات المراجعة المالية. هل تريد المتابعة؟`
              )
            : ''
        }
        confirmLabel={t('Archive Camp', 'تأكيد الأرشفة')}
        cancelLabel={t('Cancel', 'إلغاء')}
        tone="danger"
        isBusy={isBusy}
        onConfirm={handleConfirmArchive}
        onCancel={() => setArchiveTarget(null)}
      />
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
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<InstructorFilter>('all');
  const [isBusy, setIsBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const assignedSet = new Set(activeCamp ? campInstructorIds[activeCamp.id] || [] : []);

  const filteredInstructors = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return instructors.filter((inst) => {
      if (statusFilter === 'active' && !inst.isActive) return false;
      if (statusFilter === 'disabled' && inst.isActive) return false;
      if (!q) return true;
      return (
        inst.fullNameEn.toLowerCase().includes(q) ||
        inst.fullNameAr.toLowerCase().includes(q) ||
        inst.instructorCode.toLowerCase().includes(q) ||
        inst.username.toLowerCase().includes(q) ||
        inst.specialization.toLowerCase().includes(q)
      );
    });
  }, [instructors, searchQuery, statusFilter]);

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
        specialization: specialization.trim(),
        defaultLectureRateEgp: rateEgp,
        isActive,
        assignedToActiveCamp: assignedToCamp,
      });
      if (!res.ok) {
        setFeedback({ ok: false, text: res.error || t('Update failed.', 'تعذر حفظ البيانات.') });
      } else {
        setFeedback({
          ok: true,
          text: t(
            'Instructor settings saved. Already scheduled lectures keep their frozen rate.',
            'تم حفظ بيانات المحاضر. المحاضرات المجدولة مسبقاً تحتفظ بفئتها المثبتة.'
          ),
        });
        setEditingInst(null);
      }
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Instructors & Admin Accounts', 'المحاضرون وحسابات الإدارة')}
        subtitle={t(
          'Manage instructor credentials, camp assignments, and frozen default lecture rates.',
          'إدارة صلاحيات المحاضرين وتعيينهم بالمعسكر النشط وفئات المحاضرات.'
        )}
      />

      {feedback && (
        <InlineBanner
          type={feedback.ok ? 'success' : 'error'}
          message={feedback.text}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {/* Two Admin Accounts Policy Summary */}
      <section className={`${SURFACE_CARD} p-5 space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('Provisioned Admin Accounts (2 / 2 Cap)', 'حسابات المسؤولين المعتمدة (الحد الأقصى 2 / 2)')}
          </h2>
          <StatusBadge tone="info">
            {t('TOTP MFA Required', 'مصادقة ثنائية إلزامية')}
          </StatusBadge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {adminAccounts.map((adm) => {
            const prof = profiles.find((p) => p.id === adm.profileId);
            return (
              <div
                key={adm.id}
                className={`${SURFACE_SUBTLE} p-3.5 flex items-center justify-between gap-3 text-xs`}
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 dark:text-white truncate">
                    {prof ? t(prof.fullNameEn, prof.fullNameAr) : adm.profileId}
                  </p>
                  <p className="text-slate-500 font-mono mt-0.5 truncate">
                    {prof?.username} · {prof?.email}
                  </p>
                </div>
                <StatusBadge tone="success">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>{t(`Slot ${adm.assignedSlot}`, `منفذ ${adm.assignedSlot}`)}</span>
                </StatusBadge>
              </div>
            );
          })}
        </div>
      </section>

      {editingInst && (
        <form
          onSubmit={handleSaveInst}
          className={`${SURFACE_CARD} border-blue-200 dark:border-blue-900/60 p-5 space-y-4`}
        >
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('Edit Instructor:', 'تعديل بيانات المحاضر:')}{' '}
            {t(editingInst.fullNameEn, editingInst.fullNameAr)}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div>
              <label htmlFor="inst-spec" className={LABEL_CLASS}>
                {t('Specialization *', 'التخصص *')}
              </label>
              <input
                id="inst-spec"
                type="text"
                required
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="inst-rate" className={LABEL_CLASS}>
                {t('Default Lecture Rate (EGP)', 'فئة المحاضرة الافتراضية (ج.م)')}
              </label>
              <input
                id="inst-rate"
                type="number"
                min={0}
                value={rateEgp}
                onChange={(e) => setRateEgp(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
            <label className="flex items-center gap-2 pt-5 cursor-pointer text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded text-blue-600 focus:ring-blue-500"
              />
              <span>{t('Account Active (Can Sign In)', 'الحساب نشط')}</span>
            </label>
            {activeCamp && (
              <label className="flex items-center gap-2 pt-5 cursor-pointer text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={assignedToCamp}
                  onChange={(e) => setAssignedToCamp(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <span>{t(`Assigned to ${activeCamp.code}`, `معين في ${activeCamp.code}`)}</span>
              </label>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setEditingInst(null)}
              className={BTN_SECONDARY}
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button type="submit" disabled={isBusy} className={BTN_PRIMARY}>
              {isBusy ? t('Saving...', 'جاري الحفظ...') : t('Save Changes', 'حفظ التعديلات')}
            </button>
          </div>
        </form>
      )}

      {/* Search & Status Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('Search instructors or specialization...', 'ابحث عن محاضر أو تخصص...')}
            aria-label={t('Search instructors', 'بحث المحاضرين')}
            className={`${INPUT_CLASS} ps-9`}
          />
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          {(
            [
              { id: 'all', en: 'All', ar: 'الكل' },
              { id: 'active', en: 'Active', ar: 'نشط' },
              { id: 'disabled', en: 'Disabled', ar: 'معطل' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                statusFilter === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
              }`}
            >
              {t(tab.en, tab.ar)}
            </button>
          ))}
        </div>
      </div>

      {filteredInstructors.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('No matching instructors', 'لا يوجد محاضرون مطابقون للبحث')}
        />
      ) : (
        <div className={`${SURFACE_CARD} overflow-hidden`}>
          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
            {filteredInstructors.map((inst) => (
              <div key={inst.id} className="p-4 space-y-2.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sm text-slate-900 dark:text-white">
                      {t(inst.fullNameEn, inst.fullNameAr)}
                    </p>
                    <p className="font-mono text-slate-500 mt-0.5">
                      {inst.instructorCode} · {inst.username}
                    </p>
                  </div>
                  <StatusBadge tone={inst.isActive ? 'success' : 'danger'}>
                    {inst.isActive ? t('Active', 'نشط') : t('Disabled', 'معطل')}
                  </StatusBadge>
                </div>
                <p className="text-slate-600 dark:text-slate-400">{inst.specialization}</p>
                <div className="flex items-center justify-between pt-1">
                  <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                    {inst.defaultLectureRateEgp} EGP
                  </span>
                  <button
                    type="button"
                    onClick={() => openEdit(inst)}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-medium inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" />
                    <span>{t('Edit', 'تعديل')}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-start border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-5 font-semibold text-start">{t('Instructor', 'المحاضر')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('Account', 'الحساب')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('Specialization', 'التخصص')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('Camp Scope', 'نطاق المعسكر')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('Status', 'الحالة')}</th>
                  <th className="py-3 px-4 font-semibold text-end">{t('Default Rate', 'الفئة الافتراضية')}</th>
                  <th className="py-3 px-5 font-semibold text-end">{t('Actions', 'إجراءات')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredInstructors.map((inst) => {
                  const isAssigned = activeCamp ? assignedSet.has(inst.id) : false;
                  return (
                    <tr
                      key={inst.id}
                      className="odd:bg-white even:bg-slate-50/60 dark:odd:bg-slate-900 dark:even:bg-slate-900/60 hover:bg-blue-50/40 dark:hover:bg-slate-800/40"
                    >
                      <td className="py-3.5 px-5">
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {t(inst.fullNameEn, inst.fullNameAr)}
                        </p>
                        <p className="text-slate-500 font-mono tabular-nums mt-0.5">
                          {inst.instructorCode}
                        </p>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300">
                        <div>{inst.username}</div>
                        <div className="text-[11px] text-slate-400">{inst.email}</div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300">
                        {inst.specialization}
                      </td>
                      <td className="py-3.5 px-4">
                        {activeCamp ? (
                          <StatusBadge tone={isAssigned ? 'info' : 'neutral'}>
                            {isAssigned ? activeCamp.code : t('Unassigned', 'غير معين')}
                          </StatusBadge>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge tone={inst.isActive ? 'success' : 'danger'}>
                          {inst.isActive ? t('Active', 'نشط') : t('Disabled', 'معطل')}
                        </StatusBadge>
                      </td>
                      <td className="py-3.5 px-4 text-end font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                        {inst.defaultLectureRateEgp} EGP
                      </td>
                      <td className="py-3.5 px-5 text-end">
                        <button
                          type="button"
                          onClick={() => openEdit(inst)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>{t('Edit', 'تعديل')}</span>
                        </button>
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
  );
};

const STUDENTS_PAGE_SIZE = 12;

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
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const [importGroupId, setImportGroupId] = useState<string>(campGroups[0]?.id || '');
  const [importMode, setImportMode] = useState<'smart_update' | 'strict_insert'>('smart_update');
  const [rawBatchText, setRawBatchText] = useState<string>('');
  const [importResult, setImportResult] = useState<{
    ok: boolean;
    errors: { rowNumber: number; message: string }[];
    inserted: number;
    updated: number;
  } | null>(null);

  // Group Form state — clean empty initial fields with placeholders
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [grpCode, setGrpCode] = useState('');
  const [grpNameEn, setGrpNameEn] = useState('');
  const [grpNameAr, setGrpNameAr] = useState('');
  const [grpTrack, setGrpTrack] = useState('');
  const [grpRoomId, setGrpRoomId] = useState(rooms[0]?.id || '');
  const [grpInstId, setGrpInstId] = useState(instructors[0]?.id || '');
  const [grpCap, setGrpCap] = useState(30);

  // Single Student Form
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [stuCode, setStuCode] = useState('');
  const [stuName, setStuName] = useState('');
  const [stuUniv, setStuUniv] = useState('');
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

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedGroupId, searchQuery]);

  if (!activeCamp) {
    return (
      <EmptyState
        icon={GraduationCap}
        title={t('No active camp configured', 'لا يوجد معسكر نشط حالياً')}
        description={t(
          'Select or activate a camp first to manage training groups and student rosters.',
          'فعّل معسكراً أولاً لإدارة المجموعات وقوائم الطلاب.'
        )}
      />
    );
  }

  const allCampStudents = students.filter((s) => s.campId === activeCamp.id);
  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allCampStudents.filter((s) => {
      if (selectedGroupId !== 'all' && s.groupId !== selectedGroupId) return false;
      if (!q) return true;
      return (
        s.studentCode.toLowerCase().includes(q) ||
        s.fullName.toLowerCase().includes(q) ||
        s.university.toLowerCase().includes(q)
      );
    });
  }, [allCampStudents, selectedGroupId, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredStudents.length / STUDENTS_PAGE_SIZE));
  const pagedStudents = filteredStudents.slice(
    (currentPage - 1) * STUDENTS_PAGE_SIZE,
    currentPage * STUDENTS_PAGE_SIZE
  );
  const campTransfers = studentTransfers.filter((tr) => tr.campId === activeCamp.id);

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsBusy(true);
    setActionNotice(null);
    try {
      const res = await upsertGroup({
        code: grpCode.trim(),
        nameEn: grpNameEn.trim(),
        nameAr: grpNameAr.trim(),
        track: grpTrack.trim(),
        defaultRoomId: grpRoomId,
        primaryInstructorId: grpInstId,
        capacity: grpCap,
      });
      if (!res.ok) {
        setActionNotice({ ok: false, text: res.error || t('Failed saving group.', 'تعذر حفظ المجموعة.') });
      } else {
        setActionNotice({ ok: true, text: t('Training group created.', 'تم إنشاء المجموعة التدريبية.') });
        setGrpCode('');
        setGrpNameEn('');
        setGrpNameAr('');
        setGrpTrack('');
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
        studentCode: stuCode.trim(),
        fullName: stuName.trim(),
        university: stuUniv.trim() || 'Cairo University',
      });
      if (!res.ok) {
        setActionNotice({ ok: false, text: res.error || t('Failed adding student.', 'تعذر تسجيل الطالب.') });
      } else {
        setActionNotice({ ok: true, text: t('Student enrolled.', 'تم تسجيل الطالب بنجاح.') });
        setStuCode('');
        setStuName('');
        setStuUniv('');
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
        reason: transferReason.trim(),
      });
      if (!res.ok) {
        setActionNotice({ ok: false, text: res.error || t('Transfer failed.', 'تعذر نقل الطالب.') });
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
    if (!rawBatchText.trim()) return;
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
      if (res.ok) setRawBatchText('');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Students & Groups', 'الطلاب والمجموعات')}
        subtitle={t(
          'Students belong to one camp group without login accounts. Batch import validates every row atomically.',
          'الطلاب مسجلون في معسكر محدد دون حسابات دخول، ويتم التحقق من كل سجل قبل استيراد الدفعة.'
        )}
        actions={
          <>
            <button
              type="button"
              onClick={() => {
                setShowGroupForm((p) => !p);
                setShowStudentForm(false);
              }}
              className={BTN_SECONDARY}
            >
              <Plus className="w-3.5 h-3.5 text-blue-600" />
              <span>{t('New Group', 'مجموعة جديدة')}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowStudentForm((p) => !p);
                setShowGroupForm(false);
              }}
              className={BTN_PRIMARY}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{t('Add Student', 'إضافة طالب')}</span>
            </button>
          </>
        }
      />

      {actionNotice && (
        <InlineBanner
          type={actionNotice.ok ? 'success' : 'error'}
          message={actionNotice.text}
          onDismiss={() => setActionNotice(null)}
        />
      )}

      {showGroupForm && (
        <form onSubmit={handleSaveGroup} className={`${SURFACE_CARD} p-5 space-y-4`}>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('Create Training Group', 'إنشاء مجموعة تدريبية جديدة')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div>
              <label htmlFor="grp-code" className={LABEL_CLASS}>
                {t('Group Code *', 'كود المجموعة *')}
              </label>
              <input
                id="grp-code"
                type="text"
                required
                placeholder={t('e.g. GRP-C', 'مثال: GRP-C')}
                value={grpCode}
                onChange={(e) => setGrpCode(e.target.value)}
                className={`${INPUT_CLASS} font-mono`}
              />
            </div>
            <div>
              <label htmlFor="grp-name-en" className={LABEL_CLASS}>
                {t('Name (English) *', 'الاسم (إنجليزي) *')}
              </label>
              <input
                id="grp-name-en"
                type="text"
                required
                placeholder={t('e.g. Group Gamma — Graphs', 'اسم المجموعة بالإنجليزية')}
                value={grpNameEn}
                onChange={(e) => setGrpNameEn(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="grp-name-ar" className={LABEL_CLASS}>
                {t('Name (Arabic)', 'الاسم (عربي)')}
              </label>
              <input
                id="grp-name-ar"
                type="text"
                placeholder={t('Arabic group title', 'اسم المجموعة بالعربية')}
                value={grpNameAr}
                onChange={(e) => setGrpNameAr(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="grp-track" className={LABEL_CLASS}>
                {t('Track *', 'المسار التدريبي *')}
              </label>
              <input
                id="grp-track"
                type="text"
                required
                placeholder={t('e.g. Competitive Programming L2', 'المسار التدريبي')}
                value={grpTrack}
                onChange={(e) => setGrpTrack(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="grp-room" className={LABEL_CLASS}>
                {t('Default Room', 'القاعة الافتراضية')}
              </label>
              <select
                id="grp-room"
                value={grpRoomId}
                onChange={(e) => setGrpRoomId(e.target.value)}
                className={SELECT_CLASS}
              >
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} ({r.name})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="grp-inst" className={LABEL_CLASS}>
                {t('Primary Instructor', 'المحاضر الأساسي')}
              </label>
              <select
                id="grp-inst"
                value={grpInstId}
                onChange={(e) => setGrpInstId(e.target.value)}
                className={SELECT_CLASS}
              >
                {instructors.map((i) => (
                  <option key={i.id} value={i.id}>
                    {t(i.fullNameEn, i.fullNameAr)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="grp-cap" className={LABEL_CLASS}>
                {t('Capacity', 'السعة الاستيعابية')}
              </label>
              <input
                id="grp-cap"
                type="number"
                min={1}
                max={100}
                value={grpCap}
                onChange={(e) => setGrpCap(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setShowGroupForm(false)}
              className={BTN_SECONDARY}
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button type="submit" disabled={isBusy} className={BTN_PRIMARY}>
              {t('Create Group', 'إنشاء المجموعة')}
            </button>
          </div>
        </form>
      )}

      {showStudentForm && (
        <form onSubmit={handleCreateSingleStudent} className={`${SURFACE_CARD} p-5 space-y-4`}>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('Enroll Individual Student', 'تسجيل طالب جديد')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div>
              <label htmlFor="stu-code" className={LABEL_CLASS}>
                {t('Student Code *', 'كود الطالب *')}
              </label>
              <input
                id="stu-code"
                type="text"
                required
                placeholder={t('e.g. CITS-2615', 'مثال: CITS-2615')}
                value={stuCode}
                onChange={(e) => setStuCode(e.target.value)}
                className={`${INPUT_CLASS} font-mono`}
              />
            </div>
            <div>
              <label htmlFor="stu-name" className={LABEL_CLASS}>
                {t('Full Name *', 'الاسم الكامل *')}
              </label>
              <input
                id="stu-name"
                type="text"
                required
                placeholder={t('Student full name', 'اسم الطالب الكامل')}
                value={stuName}
                onChange={(e) => setStuName(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="stu-univ" className={LABEL_CLASS}>
                {t('University', 'الجامعة')}
              </label>
              <input
                id="stu-univ"
                type="text"
                placeholder={t('e.g. Cairo University', 'اسم الجامعة')}
                value={stuUniv}
                onChange={(e) => setStuUniv(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="stu-grp" className={LABEL_CLASS}>
                {t('Assigned Group', 'المجموعة')}
              </label>
              <select
                id="stu-grp"
                value={stuGroupId}
                onChange={(e) => setStuGroupId(e.target.value)}
                className={SELECT_CLASS}
              >
                {campGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setShowStudentForm(false)}
              className={BTN_SECONDARY}
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button type="submit" disabled={isBusy} className={BTN_PRIMARY}>
              {t('Save Student', 'حفظ الطالب')}
            </button>
          </div>
        </form>
      )}

      {transferTargetStuId && (
        <form
          onSubmit={handleSubmitTransfer}
          className={`${SURFACE_CARD} border-blue-200 dark:border-blue-900/60 p-5 space-y-4`}
        >
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-blue-600" />
            <span>
              {t(
                'Transfer Student Between Groups (Preserves Prior Day History)',
                'نقل طالب لمجموعة أخرى (مع حفظ سجل الأيام السابقة)'
              )}
            </span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label htmlFor="tr-group" className={LABEL_CLASS}>
                {t('Destination Group', 'المجموعة الجديدة')}
              </label>
              <select
                id="tr-group"
                value={transferToGroupId}
                onChange={(e) => setTransferToGroupId(e.target.value)}
                className={SELECT_CLASS}
              >
                {campGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code} · {t(g.nameEn, g.nameAr)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="tr-day" className={LABEL_CLASS}>
                {t('Effective Camp Day', 'يسري من اليوم')}
              </label>
              <input
                id="tr-day"
                type="number"
                min={1}
                max={activeCamp.durationDays}
                value={transferDay}
                onChange={(e) => setTransferDay(Number(e.target.value))}
                className={`${INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
            <div>
              <label htmlFor="tr-reason" className={LABEL_CLASS}>
                {t('Audit Reason *', 'سبب النقل *')}
              </label>
              <input
                id="tr-reason"
                type="text"
                required
                placeholder={t('e.g. Level assessment placement', 'سبب النقل التدريبي')}
                value={transferReason}
                onChange={(e) => setTransferReason(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setTransferTargetStuId(null)}
              className={BTN_SECONDARY}
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button type="submit" disabled={isBusy} className={BTN_PRIMARY}>
              {t('Confirm Transfer', 'تأكيد النقل')}
            </button>
          </div>
        </form>
      )}

      {/* Batch Import Form */}
      <form onSubmit={handleRunImport} className={`${SURFACE_CARD} p-5 space-y-4`}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Upload className="w-4 h-4 text-blue-600" />
              <span>
                {t('Batch Student Import & Smart Update', 'استيراد دفعات الطلاب والتحديث الذكي')}
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t(
                'Format per line: Full Name, Student Code, University. Any invalid line cancels the batch cleanly.',
                'الصيغة لكل سطر: الاسم الكامل، كود الطالب، الجامعة. أي خطأ يوقف الدفعة بالكامل للحفاظ على سلامة البيانات.'
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={t('Target Group for Import', 'المجموعة المستهدفة للاستيراد')}
              value={importGroupId}
              onChange={(e) => setImportGroupId(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium"
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
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium"
            >
              <option value="smart_update">{t('Smart Update Mode', 'وضع التحديث الذكي')}</option>
              <option value="strict_insert">{t('Strict New Only', 'إضافة جديدة فقط')}</option>
            </select>
          </div>
        </div>

        <textarea
          rows={3}
          aria-label={t('Student batch rows', 'بيانات دفعة الطلاب')}
          placeholder={t(
            'Example:\nSalma Hassan, CITS-2620, Cairo University\nYoussef Adel, CITS-2621, Ain Shams University',
            'مثال:\nسلمى حسن، CITS-2620، جامعة القاهرة'
          )}
          value={rawBatchText}
          onChange={(e) => setRawBatchText(e.target.value)}
          className={`${INPUT_CLASS} font-mono`}
        />

        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={isBusy || campGroups.length === 0 || !rawBatchText.trim()}
            className={BTN_PRIMARY}
          >
            {t('Validate & Import Batch', 'فحص واستيراد الدفعة')}
          </button>
        </div>

        {importResult && (
          <div
            role="status"
            className={`p-3.5 rounded-lg border text-xs ${
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
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>
                    {t(
                      'Validation failed — Zero records imported:',
                      'فشل التحقق — لم يتم استيراد أي سجل:'
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

      {/* Students Filter + Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setSelectedGroupId('all')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              selectedGroupId === 'all'
                ? 'bg-blue-600 text-white'
                : 'border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
            }`}
          >
            {t('All Groups', 'كل المجموعات')} ({allCampStudents.length})
          </button>
          {campGroups.map((grp) => (
            <button
              key={grp.id}
              type="button"
              onClick={() => setSelectedGroupId(grp.id)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                selectedGroupId === grp.id
                  ? 'bg-blue-600 text-white'
                  : 'border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
              }`}
            >
              {grp.code}
            </button>
          ))}
        </div>

        <div className="relative md:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('Search student code, name, university...', 'ابحث بالكود أو الاسم أو الجامعة...')}
            aria-label={t('Search students', 'بحث الطلاب')}
            className={`${INPUT_CLASS} ps-9`}
          />
        </div>
      </div>

      {/* Students Table + Mobile Cards + Pagination */}
      {pagedStudents.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title={t('No students found', 'لا يوجد طلاب مطابقون للبحث')}
        />
      ) : (
        <div className={`${SURFACE_CARD} overflow-hidden`}>
          {/* Mobile Student Cards */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
            {pagedStudents.map((stu) => {
              const grp = groups.find((g) => g.id === stu.groupId);
              return (
                <div key={stu.id} className="p-4 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                      {stu.studentCode}
                    </p>
                    <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                      {stu.fullName}
                    </p>
                    <p className="text-slate-500 truncate mt-0.5">
                      {grp ? grp.code : stu.groupId} · {stu.university}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={campGroups.length < 2}
                    onClick={() => {
                      const otherGroup = campGroups.find((g) => g.id !== stu.groupId);
                      setTransferTargetStuId(stu.id);
                      setTransferToGroupId(otherGroup?.id || '');
                      setTransferDay(activeCamp.currentCampDay);
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40 inline-flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <ArrowRightLeft className="w-3 h-3" />
                    <span>{t('Transfer', 'نقل')}</span>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Desktop Students Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-start border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-5 font-semibold text-start">{t('Student Code', 'كود الطالب')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('Full Name', 'اسم الطالب')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('Assigned Group', 'المجموعة')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('University', 'الجامعة')}</th>
                  <th className="py-3 px-5 font-semibold text-end">{t('Transfer', 'نقل')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {pagedStudents.map((stu) => {
                  const grp = groups.find((g) => g.id === stu.groupId);
                  return (
                    <tr
                      key={stu.id}
                      className="odd:bg-white even:bg-slate-50/60 dark:odd:bg-slate-900 dark:even:bg-slate-900/60 hover:bg-blue-50/40 dark:hover:bg-slate-800/40"
                    >
                      <td className="py-3 px-5 font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                        {stu.studentCode}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                        {stu.fullName}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {grp ? `${grp.code} · ${t(grp.nameEn, grp.nameAr)}` : stu.groupId}
                      </td>
                      <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                        {stu.university}
                      </td>
                      <td className="py-3 px-5 text-end">
                        <button
                          type="button"
                          disabled={campGroups.length < 2}
                          onClick={() => {
                            const otherGroup = campGroups.find((g) => g.id !== stu.groupId);
                            setTransferTargetStuId(stu.id);
                            setTransferToGroupId(otherGroup?.id || '');
                            setTransferDay(activeCamp.currentCampDay);
                          }}
                          className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
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

          <PaginationBar
            page={currentPage}
            totalPages={totalPages}
            totalItems={filteredStudents.length}
            pageSize={STUDENTS_PAGE_SIZE}
            onPageChange={setCurrentPage}
            labelShowing={t('Showing', 'عرض')}
          />
        </div>
      )}

      {campTransfers.length > 0 && (
        <div className={`${SURFACE_CARD} p-5 space-y-3 text-xs`}>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('Recent Group Transfer History', 'سجل نقل الطلاب بين المجموعات')}
          </h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
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
