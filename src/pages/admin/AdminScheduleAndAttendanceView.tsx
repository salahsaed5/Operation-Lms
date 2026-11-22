import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  CheckCircle2,
  Clock,
  Pencil,
  Eye,
  ShieldCheck,
  Search,
  CalendarClock,
  ClipboardCheck,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getSignedSelfieUrl } from '../../services/citsRepository';
import {
  AttendanceMark,
  AttendanceSheetStatus,
  CampStatus,
  CheckinStatus,
  Lecture,
  LectureStatus,
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

function lectureStatusLabel(
  status: LectureStatus,
  t: (en: string, ar: string) => string
): { label: string; tone: 'info' | 'warning' | 'success' | 'neutral' } {
  switch (status) {
    case LectureStatus.IN_PROGRESS:
      return { label: t('In Progress', 'قيد التنفيذ'), tone: 'warning' };
    case LectureStatus.COMPLETED:
      return { label: t('Completed', 'مكتملة'), tone: 'success' };
    case LectureStatus.CANCELLED:
      return { label: t('Cancelled', 'ملغاة'), tone: 'neutral' };
    default:
      return { label: t('Scheduled', 'مجدولة'), tone: 'info' };
  }
}

function checkinStatusDisplay(
  status: CheckinStatus,
  t: (en: string, ar: string) => string
): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  switch (status) {
    case CheckinStatus.VERIFIED:
      return { label: t('Verified', 'موثق'), tone: 'success' };
    case CheckinStatus.EXCEPTION_APPROVED:
      return { label: t('Exception Approved', 'استثناء معتمد'), tone: 'success' };
    case CheckinStatus.LATE_FIRST_LECTURE:
      return { label: t('Late (>=60m)', 'تأخير (+60د)'), tone: 'warning' };
    case CheckinStatus.EXCEPTION_PENDING:
      return { label: t('Exception Pending', 'بانتظار المراجعة'), tone: 'warning' };
    case CheckinStatus.OUTSIDE_GEOFENCE:
      return { label: t('Outside Geofence', 'خارج النطاق'), tone: 'danger' };
    case CheckinStatus.EXCEPTION_REJECTED:
      return { label: t('Exception Rejected', 'استثناء مرفوض'), tone: 'danger' };
    default:
      return { label: t('Recorded', 'مسجل'), tone: 'neutral' };
  }
}

export const AdminScheduleView: React.FC = () => {
  const {
    activeCamp,
    lectures,
    groups,
    instructors,
    rooms,
    addScheduleLecture,
    updateScheduleLecture,
    t,
  } = useApp();

  const campGroups = activeCamp ? groups.filter((g) => g.campId === activeCamp.id) : [];

  const [selectedDay, setSelectedDay] = useState<number>(activeCamp?.currentCampDay || 1);
  const [periodNumber, setPeriodNumber] = useState<number>(1);
  const [groupId, setGroupId] = useState<string>(campGroups[0]?.id || '');
  const [instructorId, setInstructorId] = useState<string>(instructors[0]?.id || '');
  const [roomId, setRoomId] = useState<string>(rooms[0]?.id || '');
  const [topic, setTopic] = useState<string>('');

  // Edit lecture inline panel state
  const [editingLec, setEditingLec] = useState<Lecture | null>(null);
  const [editSubInstId, setEditSubInstId] = useState<string>('');
  const [editRoomId, setEditRoomId] = useState<string>('');
  const [editTopic, setEditTopic] = useState<string>('');
  const [editStatus, setEditStatus] = useState<LectureStatus>(LectureStatus.SCHEDULED);

  const [isBusy, setIsBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; messages: string[] } | null>(null);

  useEffect(() => {
    if (activeCamp) setSelectedDay(activeCamp.currentCampDay);
  }, [activeCamp?.id, activeCamp?.currentCampDay]);

  useEffect(() => {
    if (!groupId && campGroups[0]?.id) setGroupId(campGroups[0].id);
    if (!instructorId && instructors[0]?.id) setInstructorId(instructors[0].id);
    if (!roomId && rooms[0]?.id) setRoomId(rooms[0].id);
  }, [campGroups, instructors, rooms, groupId, instructorId, roomId]);

  if (!activeCamp) {
    return (
      <EmptyState
        icon={CalendarClock}
        title={t('No active camp configured', 'لا يوجد معسكر نشط حالياً')}
        description={t(
          'Activate a camp first to configure daily lectures and schedules.',
          'فعّل معسكراً أولاً لجدولة المحاضرات اليومية.'
        )}
      />
    );
  }

  const dayLectures = lectures
    .filter((l) => l.campId === activeCamp.id && l.campDay === selectedDay)
    .sort((a, b) => a.periodNumber - b.periodNumber);

  const handleCreateSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) {
      setFeedback({
        ok: false,
        messages: [t('Please enter a lecture topic.', 'يرجى إدخال عنوان المحاضرة.')],
      });
      return;
    }
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await addScheduleLecture({
        campDay: selectedDay,
        periodNumber,
        groupId,
        instructorId,
        roomId,
        topic: topic.trim(),
      });
      if (!res.ok) {
        setFeedback({
          ok: false,
          messages: res.errors || [t('Schedule conflict detected.', 'تم رصد تعارض في الجدول.')],
        });
      } else {
        setTopic('');
        setFeedback({
          ok: true,
          messages: [
            t(
              'Lecture scheduled with conflict checks passed and frozen instructor rate applied.',
              'تمت جدولة المحاضرة بعد التحقق من عدم وجود تعارض وتثبيت فئة المحاضرة.'
            ),
          ],
        });
      }
    } finally {
      setIsBusy(false);
    }
  };

  const openEditLecture = (lec: Lecture) => {
    setEditingLec(lec);
    setEditSubInstId(lec.substituteInstructorId || '');
    setEditRoomId(lec.roomId);
    setEditTopic(lec.topic);
    setEditStatus(lec.status);
    setFeedback(null);
  };

  const handleSaveLectureEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLec) return;
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await updateScheduleLecture({
        lectureId: editingLec.id,
        substituteInstructorId: editSubInstId || null,
        roomId: editRoomId,
        topic: editTopic.trim(),
        status: editStatus,
      });
      if (!res.ok) {
        setFeedback({
          ok: false,
          messages: [res.error || t('Update conflict detected.', 'تم رصد تعارض أثناء التعديل.')],
        });
      } else {
        setFeedback({
          ok: true,
          messages: [
            t(
              'Schedule revision saved. Instructor schedule updates automatically; no approval required.',
              'تم حفظ تعديل الجدول، والتحديث هيظهر للمحاضر تلقائيًا من غير طلب موافقة.'
            ),
          ],
        });
        setEditingLec(null);
      }
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Schedule Management', 'إدارة الجدول اليومي')}
        subtitle={t(
          '4 periods/day · Automated room, group, and instructor conflict prevention · Max 4 groups/instructor/day.',
          '4 فترات يومياً · منع تلقائي لتعارض القاعات والمجموعات والمحاضرين · بحد أقصى 4 مجموعات للمحاضر يومياً.'
        )}
        actions={
          <div className="flex items-center gap-2 text-xs">
            <label htmlFor="sched-day-select" className="text-slate-600 dark:text-slate-300 font-medium">
              {t('Camp Day:', 'يوم المعسكر:')}
            </label>
            <select
              id="sched-day-select"
              value={selectedDay}
              onChange={(e) => setSelectedDay(Number(e.target.value))}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-semibold text-xs"
            >
              {Array.from({ length: activeCamp.durationDays }, (_, i) => i + 1).map((day) => (
                <option key={day} value={day}>
                  {t(`Day ${day}`, `اليوم ${day}`)}{' '}
                  {day === activeCamp.currentCampDay ? `(${t('Current', 'الحالي')})` : ''}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {/* Add Lecture Slot Form */}
      <form onSubmit={handleCreateSlot} className={`${SURFACE_CARD} p-5 space-y-4`}>
        <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Plus className="w-4 h-4 text-blue-600" />
          <span>
            {t(`Add Lecture — Day ${selectedDay}`, `إضافة محاضرة — اليوم ${selectedDay}`)}
          </span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          <div>
            <label htmlFor="sched-period" className={LABEL_CLASS}>
              {t('Period', 'الفترة')}
            </label>
            <select
              id="sched-period"
              value={periodNumber}
              onChange={(e) => setPeriodNumber(Number(e.target.value))}
              className={`${SELECT_CLASS} font-mono`}
            >
              {activeCamp.settings.periodSlots.map((p) => (
                <option key={p.period} value={p.period}>
                  P{p.period} ({p.start}–{p.end})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sched-group" className={LABEL_CLASS}>
              {t('Group', 'المجموعة')}
            </label>
            <select
              id="sched-group"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
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
            <label htmlFor="sched-inst" className={LABEL_CLASS}>
              {t('Instructor', 'المحاضر')}
            </label>
            <select
              id="sched-inst"
              value={instructorId}
              onChange={(e) => setInstructorId(e.target.value)}
              className={SELECT_CLASS}
            >
              {instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {t(i.fullNameEn, i.fullNameAr)} ({i.defaultLectureRateEgp} EGP)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sched-room" className={LABEL_CLASS}>
              {t('Room', 'القاعة')}
            </label>
            <select
              id="sched-room"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
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
            <label htmlFor="sched-topic" className={LABEL_CLASS}>
              {t('Lecture Topic *', 'موضوع المحاضرة *')}
            </label>
            <input
              id="sched-topic"
              type="text"
              required
              placeholder={t('e.g. Dynamic Programming', 'أدخل عنوان المحاضرة')}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="flex items-center justify-end pt-1">
          <button
            type="submit"
            disabled={isBusy || campGroups.length === 0}
            className={BTN_PRIMARY}
          >
            {isBusy ? t('Validating...', 'جاري الفحص...') : t('Validate & Add Lecture', 'فحص التعارض وإضافة المحاضرة')}
          </button>
        </div>

        {feedback && (
          <div
            role="status"
            className={`p-3.5 rounded-lg border text-xs ${
              feedback.ok
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
                : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'
            }`}
          >
            <ul className="space-y-1">
              {feedback.messages.map((m, idx) => (
                <li key={idx} className="font-medium">
                  {m}
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>

      {/* Inline Edit Lecture / Substitute Assignment */}
      {editingLec && (
        <form
          onSubmit={handleSaveLectureEdit}
          className={`${SURFACE_CARD} border-blue-200 dark:border-blue-900/60 p-5 space-y-4`}
        >
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('Edit Lecture / Assign Substitute:', 'تعديل المحاضرة أو تعيين بديل:')}{' '}
            <span className="font-mono text-blue-600 dark:text-blue-400">
              P{editingLec.periodNumber}
            </span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div>
              <label htmlFor="edit-lec-sub" className={LABEL_CLASS}>
                {t('Substitute Instructor', 'محاضر بديل')}
              </label>
              <select
                id="edit-lec-sub"
                value={editSubInstId}
                onChange={(e) => setEditSubInstId(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">{t('None (Primary Instructor)', 'لا يوجد (المحاضر الأساسي)')}</option>
                {instructors
                  .filter((i) => i.id !== editingLec.instructorId)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {t(i.fullNameEn, i.fullNameAr)}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label htmlFor="edit-lec-room" className={LABEL_CLASS}>
                {t('Room', 'القاعة')}
              </label>
              <select
                id="edit-lec-room"
                value={editRoomId}
                onChange={(e) => setEditRoomId(e.target.value)}
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
              <label htmlFor="edit-lec-topic" className={LABEL_CLASS}>
                {t('Topic *', 'الموضوع *')}
              </label>
              <input
                id="edit-lec-topic"
                type="text"
                required
                value={editTopic}
                onChange={(e) => setEditTopic(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="edit-lec-status" className={LABEL_CLASS}>
                {t('Status', 'الحالة')}
              </label>
              <select
                id="edit-lec-status"
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as LectureStatus)}
                className={SELECT_CLASS}
              >
                <option value={LectureStatus.SCHEDULED}>{t('Scheduled', 'مجدولة')}</option>
                <option value={LectureStatus.IN_PROGRESS}>{t('In Progress', 'قيد التنفيذ')}</option>
                <option value={LectureStatus.COMPLETED}>{t('Completed', 'مكتملة')}</option>
                <option value={LectureStatus.CANCELLED}>{t('Cancelled', 'ملغاة')}</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setEditingLec(null)}
              className={BTN_SECONDARY}
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button type="submit" disabled={isBusy} className={BTN_PRIMARY}>
              {t('Save Revision', 'حفظ التعديل')}
            </button>
          </div>
        </form>
      )}

      {/* Day Schedule Table & Mobile Cards */}
      {dayLectures.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={t(`No lectures scheduled for Day ${selectedDay}`, `لا توجد محاضرات مجدولة لليوم ${selectedDay}`)}
        />
      ) : (
        <div className={`${SURFACE_CARD} overflow-hidden`}>
          {/* Mobile Schedule Cards */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
            {dayLectures.map((lec) => {
              const grp = groups.find((g) => g.id === lec.groupId);
              const inst = instructors.find((i) => i.id === lec.instructorId);
              const subInst = lec.substituteInstructorId
                ? instructors.find((i) => i.id === lec.substituteInstructorId)
                : null;
              const room = rooms.find((r) => r.id === lec.roomId);
              const st = lectureStatusLabel(lec.status, t);
              return (
                <div key={lec.id} className="p-4 space-y-2.5 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                        P{lec.periodNumber} · {lec.startTime}–{lec.endTime} · {grp?.code || lec.groupId}
                      </p>
                      <p className="font-semibold text-sm text-slate-900 dark:text-white mt-0.5">
                        {lec.topic}
                      </p>
                      <p className="text-slate-500 mt-0.5">
                        {inst ? t(inst.fullNameEn, inst.fullNameAr) : lec.instructorId}
                        {subInst ? ` → ${t(subInst.fullNameEn, subInst.fullNameAr)}` : ''} · {room?.code}
                      </p>
                    </div>
                    <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                      {lec.frozenRateEgp} EGP ·{' '}
                      {t('Auto Assigned', 'إسناد تلقائي')}
                    </span>
                    <button
                      type="button"
                      onClick={() => openEditLecture(lec)}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" />
                      <span>{t('Edit', 'تعديل')}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Schedule Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-start border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-5 font-semibold text-start">{t('Period & Time', 'الفترة والوقت')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('Group & Room', 'المجموعة والقاعة')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('Topic & Instructor', 'الموضوع والمحاضر')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('Status', 'الحالة')}</th>
                  <th className="py-3 px-4 font-semibold text-end">{t('Frozen Rate', 'الفئة المثبتة')}</th>
                  <th className="py-3 px-4 font-semibold text-start">{t('Assignment', 'الإسناد')}</th>
                  <th className="py-3 px-5 font-semibold text-end">{t('Action', 'إجراء')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {dayLectures.map((lec) => {
                  const grp = groups.find((g) => g.id === lec.groupId);
                  const inst = instructors.find((i) => i.id === lec.instructorId);
                  const subInst = lec.substituteInstructorId
                    ? instructors.find((i) => i.id === lec.substituteInstructorId)
                    : null;
                  const room = rooms.find((r) => r.id === lec.roomId);
                  const st = lectureStatusLabel(lec.status, t);
                  return (
                    <tr
                      key={lec.id}
                      className="odd:bg-white even:bg-slate-50/60 dark:odd:bg-slate-900 dark:even:bg-slate-900/60 hover:bg-blue-50/40 dark:hover:bg-slate-800/40"
                    >
                      <td className="py-3.5 px-5 font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                        P{lec.periodNumber} · {lec.startTime}–{lec.endTime}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {grp?.code || lec.groupId}
                        </span>
                        <span className="text-slate-500"> · {room?.code || lec.roomId}</span>
                      </td>
                      <td className="py-3.5 px-4">
                        <p className="font-semibold text-slate-900 dark:text-white">{lec.topic}</p>
                        <p className="text-slate-500 mt-0.5">
                          {inst ? t(inst.fullNameEn, inst.fullNameAr) : lec.instructorId}
                          {subInst ? ` → ${t('Sub', 'بديل')}: ${t(subInst.fullNameEn, subInst.fullNameAr)}` : ''} ·{' '}
                          <span className="font-mono">Rev {lec.revisionNumber}</span>
                        </p>
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                      </td>
                      <td className="py-3.5 px-4 text-end font-mono tabular-nums font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                        {lec.frozenRateEgp} EGP
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge tone="info">{t('Auto Assigned', 'إسناد تلقائي')}</StatusBadge>
                      </td>
                      <td className="py-3.5 px-5 text-end">
                        <button
                          type="button"
                          onClick={() => openEditLecture(lec)}
                          className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1 cursor-pointer"
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

export const AdminAttendanceView: React.FC = () => {
  const {
    activeCamp,
    attendanceSheets,
    lectures,
    instructors,
    groups,
    checkins,
    checkinExceptions,
    submitAndSyncAttendanceSheet,
    adminCorrectAttendanceRecord,
    reviewCheckinException,
    t,
  } = useApp();

  const [expandedSheetId, setExpandedSheetId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'synced' | 'draft'>('all');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [correctionNotes, setCorrectionNotes] = useState<Record<string, string>>({});
  const [selfiePreviews, setSelfiePreviews] = useState<Record<string, string>>({});
  const [isBusy, setIsBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!activeCamp) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title={t('No active camp configured', 'لا يوجد معسكر نشط حالياً')}
      />
    );
  }

  const campSheets = attendanceSheets.filter((s) => s.campId === activeCamp.id);
  const campExceptions = checkinExceptions.filter((ex) => ex.campId === activeCamp.id);
  const campCheckins = checkins.filter((c) => c.campId === activeCamp.id);

  const cairoParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const cairoPart = (name: string) => cairoParts.find(x => x.type === name)?.value || '';
  const cairoToday = `${cairoPart('year')}-${cairoPart('month')}-${cairoPart('day')}`;
  const campAllowsFinalAttendance = activeCamp.status === CampStatus.ACTIVE;
  const finalizedSheetCount = campSheets.filter(s => s.status === AttendanceSheetStatus.SUBMITTED || s.status === AttendanceSheetStatus.LOCKED).length;
  const draftSheetCount = campSheets.length - finalizedSheetCount;
  const savedRecordCount = campSheets.reduce((n, sheet) => n + sheet.records.length, 0);

  const filteredSheets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return campSheets.filter((sheet) => {
      const isSynced =
        sheet.status === AttendanceSheetStatus.SUBMITTED ||
        sheet.status === AttendanceSheetStatus.LOCKED;
      if (statusFilter === 'synced' && !isSynced) return false;
      if (statusFilter === 'draft' && isSynced) return false;
      if (!q) return true;
      const lec = lectures.find((l) => l.id === sheet.lectureId);
      const inst = instructors.find((i) => i.id === sheet.instructorId);
      const grp = groups.find((g) => g.id === lec?.groupId);
      return (
        (lec?.topic.toLowerCase().includes(q) ?? false) ||
        (inst?.fullNameEn.toLowerCase().includes(q) ?? false) ||
        (inst?.fullNameAr.toLowerCase().includes(q) ?? false) ||
        (grp?.code.toLowerCase().includes(q) ?? false)
      );
    });
  }, [campSheets, lectures, instructors, groups, searchQuery, statusFilter]);

  const handleForceSync = async (lectureId: string) => {
    const lecture = lectures.find(l => l.id === lectureId);
    if (!campAllowsFinalAttendance || !lecture || lecture.lectureDate > cairoToday) {
      setSyncMessage({
        ok: false,
        text: t(
          'Final attendance is blocked until the camp is active and the scheduled lecture date has arrived. Local drafts are not authoritative.',
          'اعتماد كشف الحضور مقفول حتى تفعيل المعسكر وحلول موعد المحاضرة. المسودات المحلية ليست بيانات معتمدة على السيرفر.'
        ),
      });
      return;
    }
    setIsBusy(true);
    setSyncMessage(null);
    try {
      const res = await submitAndSyncAttendanceSheet(lectureId);
      if (res.ok) {
        setSyncMessage({
          ok: true,
          text: t(
            'Attendance sheet submitted & synchronized. Unmarked students were marked absent and entitlement eligibility was updated.',
            'تم اعتماد ومزامنة كشف الحضور، وتحويل الطلاب غير المحددين إلى غياب وتحديث المستحق المالي.'
          ),
        });
      } else {
        setSyncMessage({
          ok: false,
          text: res.error || t('Failed synchronizing attendance.', 'تعذر مزامنة الكشف.'),
        });
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleCorrectMark = async (
    sheetId: string,
    lectureId: string,
    studentId: string,
    mark: AttendanceMark
  ) => {
    const noteText =
      (correctionNotes[sheetId] ?? 'Verified by Admin during roster review').trim();
    if (!noteText) {
      setSyncMessage({
        ok: false,
        text: t(
          'Please provide an audit reason before correcting attendance marks.',
          'يرجى إدخال سبب التعديل في سجل التدقيق قبل تغيير حالة الحضور.'
        ),
      });
      return;
    }
    setIsBusy(true);
    try {
      const res = await adminCorrectAttendanceRecord({
        sheetId,
        lectureId,
        studentId,
        mark,
        note: noteText,
      });
      if (!res.ok) {
        setSyncMessage({ ok: false, text: res.error || t('Correction failed.', 'فشل تعديل السجل.') });
      } else {
        setSyncMessage({
          ok: true,
          text: t('Student attendance mark corrected and logged.', 'تم تعديل حالة حضور الطالب وتوثيقها.'),
        });
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleExceptionDecision = async (
    exceptionId: string,
    decision: 'approved' | 'rejected'
  ) => {
    setIsBusy(true);
    setSyncMessage(null);
    try {
      const res = await reviewCheckinException({
        exceptionId,
        decision,
        reviewNote: reviewNotes[exceptionId] || '',
      });
      if (!res.ok) {
        setSyncMessage({ ok: false, text: res.error || t('Review failed.', 'فشلت المراجعة.') });
      } else {
        setSyncMessage({
          ok: true,
          text: t(
            `Check-in exception ${decision} and entitlement triggers updated.`,
            `تم ${decision === 'approved' ? 'اعتماد' : 'رفض'} استثناء تسجيل الوصول.`
          ),
        });
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleLoadSelfie = async (checkinId: string, storagePath: string) => {
    const url = await getSignedSelfieUrl(storagePath);
    if (url) {
      setSelfiePreviews((prev) => ({ ...prev, [checkinId]: url }));
    } else {
      setSyncMessage({
        ok: false,
        text: t(
          'Signed selfie preview requires live connected file storage.',
          'معاينة الصورة الموقعة متاحة فقط عند الاتصال الفعلي بخدمة التخزين.'
        ),
      });
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Attendance & Check-in Verification', 'كشوف الحضور وتوثيق الوصول')}
        subtitle={t(
          'Inspect lecture rosters, log audited attendance corrections, and review instructor GPS/lateness exceptions.',
          'فحص كشوف المحاضرات وتعديل الحالات مع التوثيق ومراجعة استثناءات الوصول اليومي للمحاضرين.'
        )}
      />

      {syncMessage && (
        <InlineBanner
          type={syncMessage.ok ? 'success' : 'error'}
          message={syncMessage.text}
          onDismiss={() => setSyncMessage(null)}
        />
      )}

      {/* Overview: counts are server-saved records, not presumed student attendance. */}
      <section aria-label={t('Attendance overview', 'ملخص الحضور')}
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">{t('Camp attendance overview', 'ملخص حضور المعسكر')}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {t('Server-saved attendance only. Drafts are not final.', 'بيانات الحضور المحفوظة على السيرفر فقط. المسودات ليست نهائية.')}
            </p>
          </div>
          <StatusBadge tone={campAllowsFinalAttendance ? 'success' : 'warning'}>
            {campAllowsFinalAttendance ? t('Active camp', 'معسكر نشط') : t('Camp Draft', 'معسكر مسودة')}
          </StatusBadge>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: t('Lecture sheets', 'كشوف المحاضرات'), count: campSheets.length },
            { label: t('Finalized sheets', 'كشوف معتمدة'), count: finalizedSheetCount },
            { label: t('Draft sheets', 'كشوف مسودة'), count: draftSheetCount },
            { label: t('Server-saved rows', 'سجلات محفوظة'), count: savedRecordCount },
          ].map(stat => (
            <div key={stat.label} className="rounded-xl bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-800 px-3.5 py-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">{stat.label}</p>
              <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white mt-1">{stat.count}</p>
            </div>
          ))}
        </div>
      </section>
      {!campAllowsFinalAttendance && (
        <div role="status" className="flex items-start gap-2.5 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/20 p-3.5 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
          <Clock className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{t('The camp is not Active. Final submission is disabled. Local Instructor drafts might not appear in this server view.',
            'المعسكر غير مفعل؛ الاعتماد النهائي غير متاح. مسودات المحاضر المحلية ممكن متظهرش في عرض السيرفر ده.')}</span>
        </div>
      )}

      {/* Check-in Exception Reviews */}
      {campExceptions.length > 0 && (
        <section className={`${SURFACE_CARD} p-5 space-y-4`}>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-600" />
            <span>{t('Check-in Exceptions Queue', 'مراجعة استثناءات تسجيل الوصول')}</span>
          </h2>
          <div className="space-y-3 text-xs">
            {campExceptions.map((ex) => {
              const inst = instructors.find((i) => i.id === ex.instructorId);
              const chk = campCheckins.find((c) => c.id === ex.checkinId);
              const badgeTone =
                ex.status === RequestStatus.APPROVED
                  ? 'success'
                  : ex.status === RequestStatus.REJECTED
                  ? 'danger'
                  : 'warning';
              const badgeText =
                ex.status === RequestStatus.APPROVED
                  ? t('Approved', 'معتمد')
                  : ex.status === RequestStatus.REJECTED
                  ? t('Rejected', 'مرفوض')
                  : t('Pending Review', 'قيد المراجعة');
              return (
                <div key={ex.id} className={`${SURFACE_SUBTLE} p-4 space-y-3`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">
                        {inst ? t(inst.fullNameEn, inst.fullNameAr) : ex.instructorId} ·{' '}
                        <span className="font-mono">{t(`Day ${ex.campDay}`, `اليوم ${ex.campDay}`)}</span>
                      </p>
                      <p className="text-slate-600 dark:text-slate-400 mt-0.5">{ex.reason}</p>
                      {chk && (
                        <p className="font-mono text-slate-500 mt-0.5">
                          {chk.distanceFromVenueMeters}m · +{chk.minutesAfterFirstLecture}m · {chk.selfieSizeKb}KB
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {chk?.selfieStoragePath && !chk.selfieDeletedAfterArchive && (
                        <button
                          type="button"
                          onClick={() => handleLoadSelfie(chk.id, chk.selfieStoragePath!)}
                          className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium cursor-pointer"
                        >
                          {t('View Selfie', 'عرض الصورة')}
                        </button>
                      )}
                      <StatusBadge tone={badgeTone}>{badgeText}</StatusBadge>
                    </div>
                  </div>

                  {chk && selfiePreviews[chk.id] && (
                    <img
                      src={selfiePreviews[chk.id]}
                      alt={t('Check-in selfie preview', 'صورة التحقق')}
                      className="w-36 h-36 object-cover rounded-lg border border-slate-200 dark:border-slate-800"
                    />
                  )}

                  {ex.status === RequestStatus.PENDING && (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        placeholder={t('Required review note...', 'ملاحظة المراجعة الإلزامية...')}
                        value={reviewNotes[ex.id] || ''}
                        onChange={(e) =>
                          setReviewNotes((prev) => ({ ...prev, [ex.id]: e.target.value }))
                        }
                        className={`${INPUT_CLASS} flex-1 min-w-[200px]`}
                      />
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleExceptionDecision(ex.id, 'approved')}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer"
                      >
                        {t('Approve Exception', 'اعتماد الاستثناء')}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleExceptionDecision(ex.id, 'rejected')}
                        className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 font-semibold cursor-pointer"
                      >
                        {t('Reject', 'رفض')}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Search and filter are visually separate from the lecture cards. */}
      <section aria-label={t('Find lecture attendance sheets', 'البحث في كشوف الحضور')}
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div className="w-full lg:max-w-md space-y-2">
            <label htmlFor="admin-attendance-search" className="text-sm font-bold text-slate-900 dark:text-white">{t('Find a lecture', 'البحث عن محاضرة')}</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="admin-attendance-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('Topic, group or instructor', 'عنوان المحاضرة أو الجروب أو المحاضر')}
                aria-label={t('Search attendance sheets', 'بحث كشوف الحضور')}
                className={`${INPUT_CLASS} ps-9 min-h-[44px]`}
              />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t('Sheet status', 'حالة الكشف')}</p>
            <div role="group" aria-label={t('Filter attendance sheets by status', 'فلترة كشوف الحضور حسب الحالة')} className="flex flex-wrap gap-2">
              {([
                { id: 'all', en: 'All', ar: 'الكل', count: campSheets.length },
                { id: 'synced', en: 'Finalized', ar: 'معتمد', count: finalizedSheetCount },
                { id: 'draft', en: 'Drafts', ar: 'مسودات', count: draftSheetCount },
              ] as const).map(tab => (
                <button key={tab.id} type="button" aria-pressed={statusFilter === tab.id}
                  onClick={() => setStatusFilter(tab.id)}
                  className={`min-h-[40px] px-3.5 py-2 rounded-xl border inline-flex items-center gap-2 text-xs font-semibold transition-colors ${statusFilter === tab.id
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'}`}>
                  <span>{t(tab.en, tab.ar)}</span>
                  <span className={`rounded-full px-1.5 py-0.5 min-w-5 text-center tabular-nums ${statusFilter === tab.id
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-100 dark:bg-slate-700'}`}>{tab.count}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <p role="status" className="text-xs text-slate-500 dark:text-slate-400">
          {t(`Showing ${filteredSheets.length} of ${campSheets.length} lecture sheets`,
            `عرض ${filteredSheets.length} من ${campSheets.length} كشف محاضرة`)}
        </p>
      </section>

      {/* Attendance Sheets List */}
      {filteredSheets.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title={t('No attendance sheets match your filter', 'لا توجد كشوف حضور مطابقة')}
        />
      ) : (
        <div className="space-y-4">
          {filteredSheets.map((sheet) => {
            const lec = lectures.find((l) => l.id === sheet.lectureId);
            const inst = instructors.find((i) => i.id === sheet.instructorId);
            const grp = groups.find((g) => g.id === lec?.groupId);
            const chk = campCheckins.find(
              (c) => c.instructorId === sheet.instructorId && c.campDay === sheet.campDay
            );

            const presentCount = sheet.records.filter(
              (r) => r.mark === AttendanceMark.PRESENT || r.mark === AttendanceMark.LATE
            ).length;
            const absentCount = sheet.records.filter(
              (r) => r.mark === AttendanceMark.ABSENT
            ).length;
            const unmarkedCount = sheet.records.filter((r) => r.mark === 'unmarked').length;
            const isExpanded = expandedSheetId === sheet.id;
            const isSynced =
              sheet.status === AttendanceSheetStatus.SUBMITTED ||
              sheet.status === AttendanceSheetStatus.LOCKED;
            const chkDisplay = chk ? checkinStatusDisplay(chk.status, t) : null;
            const canSubmitSheet = campAllowsFinalAttendance && Boolean(lec) &&
              Boolean(lec && lec.lectureDate <= cairoToday);

            return (
              <div key={sheet.id} className={`${SURFACE_CARD} p-5 space-y-4`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                        {t(`Day ${sheet.campDay} · P${sheet.periodNumber}`, `اليوم ${sheet.campDay} · ف${sheet.periodNumber}`)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{grp?.code}</span>
                      <span aria-hidden="true">·</span>
                      <span>{inst ? t(inst.fullNameEn, inst.fullNameAr) : sheet.instructorId}</span>
                    </div>
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white mt-1">
                      {lec?.topic || sheet.lectureId}
                    </h2>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setExpandedSheetId(isExpanded ? null : sheet.id)}
                      className={BTN_SECONDARY}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>
                        {isExpanded
                          ? t('Hide Roster', 'إخفاء القائمة')
                          : t('Inspect Roster', 'فحص القائمة')}
                      </span>
                    </button>

                    {isSynced ? (
                      <StatusBadge tone="success">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{t('Submitted & Synced', 'معتمد ومتزامن')}</span>
                      </StatusBadge>
                    ) : (
                      <>
                        <StatusBadge tone="warning">
                          <Clock className="w-3.5 h-3.5" />
                          <span>{t('Server Draft — Not Finalized', 'مسودة السيرفر — غير معتمدة')}</span>
                        </StatusBadge>
                        <button
                          type="button"
                          disabled={isBusy || !canSubmitSheet}
                          onClick={() => handleForceSync(sheet.lectureId)}
                          className={BTN_PRIMARY}
                        >
                          {t('Submit & Sync Now', 'اعتماد ومزامنة الآن')}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {!isSynced && (
                  <p className="rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-900 p-3 text-xs text-amber-900 dark:text-amber-200" role="status">
                    {t(
                      canSubmitSheet
                        ? 'Showing server-saved draft only. Instructor offline edits may differ and must be reconciled before final submission.'
                        : 'Final submission is disabled until the camp is active and the lecture date has arrived. This is the server-saved draft; offline instructor edits may differ.',
                      canSubmitSheet
                        ? 'المعروض هو مسودة السيرفر فقط. ممكن تعديلات المحاضر المحلية تكون مختلفة ولازم تتراجع قبل الاعتماد.'
                        : 'الاعتماد النهائي مقفول حتى تفعيل المعسكر وحلول موعد المحاضرة. المعروض مسودة السيرفر فقط، وممكن تعديلات المحاضر المحلية تختلف.'
                    )}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-400 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 font-mono tabular-nums">
                  <span>
                    {t('Present/Late:', 'حاضر/متأخر:')}{' '}
                    <strong className="text-emerald-600 dark:text-emerald-400">{presentCount}</strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {t('Absent:', 'غائب:')}{' '}
                    <strong className="text-red-600 dark:text-red-400">{absentCount}</strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {t('Unmarked:', 'غير محدد:')} <strong>{unmarkedCount}</strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {chk && chkDisplay ? (
                      <StatusBadge tone={chkDisplay.tone}>
                        {chkDisplay.label} ({chk.distanceFromVenueMeters}m)
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">
                        {t('Check-in Missing', 'لم يسجل الوصول')}
                      </StatusBadge>
                    )}
                  </span>
                </div>

                {isExpanded && (
                  <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800 space-y-3 text-xs">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <label
                        htmlFor={`corr-note-${sheet.id}`}
                        className="font-semibold text-slate-700 dark:text-slate-300 shrink-0"
                      >
                        {t('Audit Reason for Corrections:', 'سبب التعديل للتدقيق:')}
                      </label>
                      <input
                        id={`corr-note-${sheet.id}`}
                        type="text"
                        value={
                          correctionNotes[sheet.id] ?? 'Verified by Admin during roster review'
                        }
                        onChange={(e) =>
                          setCorrectionNotes((prev) => ({
                            ...prev,
                            [sheet.id]: e.target.value,
                          }))
                        }
                        placeholder={t('Explain attendance correction reason...', 'أدخل سبب تعديل الحضور...')}
                        className={INPUT_CLASS}
                      />
                    </div>

                    {sheet.records.length === 0 ? (
                      <p className="py-3 text-slate-500">
                        {t('No student attendance rows saved on this sheet yet.', 'لا توجد سجلات طلاب محفوظة في هذا الكشف بعد.')}
                      </p>
                    ) : (
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {sheet.records.map((rec) => (
                          <div
                            key={rec.studentId}
                            className="py-2.5 flex flex-wrap items-center justify-between gap-2"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-slate-900 dark:text-white">
                                {rec.studentName}
                              </span>
                              <span className="font-mono text-slate-500">({rec.studentCode})</span>
                              {rec.isCrossGroup && (
                                <StatusBadge tone="info">
                                  {t('Cross-Group', 'حضور زائر')}
                                </StatusBadge>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              {(
                                [
                                  { mk: AttendanceMark.PRESENT, en: 'Present', ar: 'حاضر' },
                                  { mk: AttendanceMark.LATE, en: 'Late', ar: 'متأخر' },
                                  { mk: AttendanceMark.ABSENT, en: 'Absent', ar: 'غائب' },
                                ] as const
                              ).map((opt) => (
                                <button
                                  key={opt.mk}
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    handleCorrectMark(sheet.id, sheet.lectureId, rec.studentId, opt.mk)
                                  }
                                  className={`px-2.5 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                                    rec.mark === opt.mk
                                      ? 'bg-blue-600 text-white'
                                      : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                                  }`}
                                >
                                  {t(opt.en, opt.ar)}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
