import React, { useEffect, useState } from 'react';
import {
  Plus,
  CheckCircle2,
  Clock,
  Pencil,
  Eye,
  AlertCircle,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getSignedSelfieUrl } from '../../services/citsRepository';
import {
  AttendanceMark,
  AttendanceSheetStatus,
  CheckinStatus,
  Lecture,
  LectureStatus,
  RequestStatus,
} from '../../types/database';

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
  const [periodNumber, setPeriodNumber] = useState<number>(2);
  const [groupId, setGroupId] = useState<string>(campGroups[1]?.id || campGroups[0]?.id || '');
  const [instructorId, setInstructorId] = useState<string>(
    instructors[1]?.id || instructors[0]?.id || ''
  );
  const [roomId, setRoomId] = useState<string>(rooms[1]?.id || rooms[0]?.id || '');
  const [topic, setTopic] = useState<string>('Segment Trees & Lazy Propagation');

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
      <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-500">
        {t('No active camp configured.', 'لا يوجد معسكر نشط حالياً.')}
      </div>
    );
  }

  const dayLectures = lectures
    .filter((l) => l.campId === activeCamp.id && l.campDay === selectedDay)
    .sort((a, b) => a.periodNumber - b.periodNumber);

  const handleCreateSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsBusy(true);
    setFeedback(null);
    try {
      const res = await addScheduleLecture({
        campDay: selectedDay,
        periodNumber,
        groupId,
        instructorId,
        roomId,
        topic,
      });
      if (!res.ok) {
        setFeedback({ ok: false, messages: res.errors || ['Schedule conflict detected'] });
      } else {
        setFeedback({
          ok: true,
          messages: [
            t(
              'Lecture scheduled with conflict check passed and frozen instructor rate applied.',
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
        topic: editTopic,
        status: editStatus,
      });
      if (!res.ok) {
        setFeedback({ ok: false, messages: [res.error || 'Update conflict detected.'] });
      } else {
        setFeedback({
          ok: true,
          messages: [
            t(
              'Schedule revision saved. Revision incremented and instructor re-acknowledgment requested.',
              'تم حفظ تعديل الجدول ورفع رقم المراجعة للمحاضر.'
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
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {t('Schedule Management & Conflict Prevention', 'إدارة الجدول اليومي ومنع التعارض')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t(
              'Default 4 periods (09:00–12:00, 12:00–15:00, 15:00–18:00, 18:00–21:00) · 3h duration · Max 4 instructor groups/day',
              '4 فترات افتراضية · مدة المحاضرة 3 ساعات · الحد الأقصى 4 مجموعات للمحاضر يومياً'
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="sched-day-select" className="text-slate-500 font-medium">
            {t('Camp Day:', 'يوم المعسكر:')}
          </label>
          <select
            id="sched-day-select"
            value={selectedDay}
            onChange={(e) => setSelectedDay(Number(e.target.value))}
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 font-mono font-semibold"
          >
            {Array.from({ length: activeCamp.durationDays }, (_, i) => i + 1).map((day) => (
              <option key={day} value={day}>
                Day {day} {day === activeCamp.currentCampDay ? `(${t('Current', 'الحالي')})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Add Lecture Slot Form */}
      <form
        onSubmit={handleCreateSlot}
        className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4"
      >
        <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Plus className="w-4 h-4 text-blue-500" />
          <span>
            {t(`Schedule New Lecture — Day ${selectedDay}`, `إضافة محاضرة جديدة — اليوم ${selectedDay}`)}
          </span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          <div>
            <label htmlFor="sched-period" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t('Period', 'الفترة')}
            </label>
            <select
              id="sched-period"
              value={periodNumber}
              onChange={(e) => setPeriodNumber(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono"
            >
              {activeCamp.settings.periodSlots.map((p) => (
                <option key={p.period} value={p.period}>
                  P{p.period} ({p.start}–{p.end})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sched-group" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t('Group', 'المجموعة')}
            </label>
            <select
              id="sched-group"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            >
              {campGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sched-inst" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t('Instructor', 'المحاضر')}
            </label>
            <select
              id="sched-inst"
              value={instructorId}
              onChange={(e) => setInstructorId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            >
              {instructors.map((i) => (
                <option key={i.id} value={i.id}>
                  {t(i.fullNameEn, i.fullNameAr)} ({i.defaultLectureRateEgp} EGP)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sched-room" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t('Room', 'القاعة')}
            </label>
            <select
              id="sched-room"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            >
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} ({r.name})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sched-topic" className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t('Lecture Topic', 'موضوع المحاضرة')}
            </label>
            <input
              id="sched-topic"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={() => {
              setPeriodNumber(1);
              if (instructors[0]) setInstructorId(instructors[0].id);
              if (rooms[0]) setRoomId(rooms[0].id);
              if (campGroups[1]) setGroupId(campGroups[1].id);
            }}
            className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline cursor-pointer"
          >
            {t('Test Conflict Scenario (Period 1)', 'اختبار سيناريو تعارض (الفترة 1)')}
          </button>

          <button
            type="submit"
            disabled={isBusy || campGroups.length === 0}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
          >
            {isBusy ? t('Validating...', 'جاري الفحص...') : t('Validate & Add to Schedule', 'فحص التعارض وإضافة للجدول')}
          </button>
        </div>

        {feedback && (
          <div
            role="status"
            className={`p-3.5 rounded-xl border text-xs ${
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
          className="p-6 rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-white dark:bg-slate-900 space-y-4 text-xs"
        >
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('Edit Lecture / Assign Substitute:', 'تعديل المحاضرة أو تعيين محاضر بديل:')} P{editingLec.periodNumber}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block font-medium mb-1">{t('Substitute Instructor', 'محاضر بديل')}</label>
              <select
                value={editSubInstId}
                onChange={(e) => setEditSubInstId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
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
              <label className="block font-medium mb-1">{t('Room', 'القاعة')}</label>
              <select
                value={editRoomId}
                onChange={(e) => setEditRoomId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              >
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} ({r.name})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium mb-1">{t('Topic', 'الموضوع')}</label>
              <input
                type="text"
                required
                value={editTopic}
                onChange={(e) => setEditTopic(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">{t('Status', 'الحالة')}</label>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as LectureStatus)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              >
                <option value={LectureStatus.SCHEDULED}>{LectureStatus.SCHEDULED}</option>
                <option value={LectureStatus.IN_PROGRESS}>{LectureStatus.IN_PROGRESS}</option>
                <option value={LectureStatus.COMPLETED}>{LectureStatus.COMPLETED}</option>
                <option value={LectureStatus.CANCELLED}>{LectureStatus.CANCELLED}</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingLec(null)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer"
            >
              {t('Cancel', 'إلغاء')}
            </button>
            <button
              type="submit"
              disabled={isBusy}
              className="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold cursor-pointer"
            >
              {t('Save Revision', 'حفظ التعديل')}
            </button>
          </div>
        </form>
      )}

      {/* Schedule Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
        <table className="w-full text-start border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <th className="py-3.5 px-5 font-semibold">{t('Period & Time', 'الفترة والوقت')}</th>
              <th className="py-3.5 px-4 font-semibold">{t('Group & Room', 'المجموعة والقاعة')}</th>
              <th className="py-3.5 px-4 font-semibold">{t('Topic & Instructor', 'الموضوع والمحاضر')}</th>
              <th className="py-3.5 px-4 text-right font-semibold">{t('Frozen Rate', 'الفئة المثبتة')}</th>
              <th className="py-3.5 px-4 text-right font-semibold">{t('Acknowledgment', 'تأكيد المحاضر')}</th>
              <th className="py-3.5 px-5 text-right font-semibold">{t('Edit', 'تعديل')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {dayLectures.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500">
                  {t(`No lectures scheduled for Day ${selectedDay}.`, `لا توجد محاضرات لليوم ${selectedDay}.`)}
                </td>
              </tr>
            ) : (
              dayLectures.map((lec) => {
                const grp = groups.find((g) => g.id === lec.groupId);
                const inst = instructors.find((i) => i.id === lec.instructorId);
                const subInst = lec.substituteInstructorId
                  ? instructors.find((i) => i.id === lec.substituteInstructorId)
                  : null;
                const room = rooms.find((r) => r.id === lec.roomId);
                return (
                  <tr key={lec.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="py-3.5 px-5 font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                      P{lec.periodNumber} · {lec.startTime}–{lec.endTime}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {grp?.code || lec.groupId}
                      </span>
                      <span className="text-slate-500"> · {room?.code || lec.roomId}</span>
                    </td>
                    <td className="py-3.5 px-4">
                      <p className="font-semibold text-slate-900 dark:text-white">{lec.topic}</p>
                      <p className="text-slate-500 mt-0.5">
                        {inst ? t(inst.fullNameEn, inst.fullNameAr) : lec.instructorId}
                        {subInst
                          ? ` → Sub: ${t(subInst.fullNameEn, subInst.fullNameAr)}`
                          : ''}{' '}
                        · Rev {lec.revisionNumber} · {lec.status}
                      </p>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                      {lec.frozenRateEgp} EGP
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      {lec.instructorAcknowledgedAt ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          {t('Acknowledged', 'تم التأكيد')}
                        </span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          {t('Awaiting Instructor', 'بانتظار التأكيد')}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      <button
                        type="button"
                        onClick={() => openEditLecture(lec)}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Pencil className="w-3 h-3" />
                        <span>{t('Edit', 'تعديل')}</span>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
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
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [selfiePreviews, setSelfiePreviews] = useState<Record<string, string>>({});
  const [isBusy, setIsBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!activeCamp) {
    return (
      <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-500">
        {t('No active camp configured.', 'لا يوجد معسكر نشط حالياً.')}
      </div>
    );
  }

  const campSheets = attendanceSheets.filter((s) => s.campId === activeCamp.id);
  const campExceptions = checkinExceptions.filter((ex) => ex.campId === activeCamp.id);
  const campCheckins = checkins.filter((c) => c.campId === activeCamp.id);

  const handleForceSync = async (lectureId: string) => {
    setIsBusy(true);
    setSyncMessage(null);
    try {
      const res = await submitAndSyncAttendanceSheet(lectureId);
      if (res.ok) {
        setSyncMessage({
          ok: true,
          text: t(
            'Attendance sheet submitted & synchronized. Unmarked students were converted to absent and server-side entitlement was updated.',
            'تم اعتماد ومزامنة كشف الحضور، وتحويل الطلاب غير المحددين إلى غياب وتحديث المستحق المالي.'
          ),
        });
      } else {
        setSyncMessage({ ok: false, text: res.error || 'Failed synchronizing attendance.' });
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
    setIsBusy(true);
    try {
      const res = await adminCorrectAttendanceRecord({
        sheetId,
        lectureId,
        studentId,
        mark,
        note: 'Corrected by Admin during roster review',
      });
      if (!res.ok) {
        setSyncMessage({ ok: false, text: res.error || 'Correction failed.' });
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
        setSyncMessage({ ok: false, text: res.error || 'Review failed.' });
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
          'Signed selfie preview is available only when connected to live Supabase Storage.',
          'معاينة الصورة الموقعة متاحة فقط عند الاتصال بمخزن Supabase المباشر.'
        ),
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-200 dark:border-slate-800">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          {t('Attendance Sheets & Daily Check-in Verification', 'كشوف الحضور وتوثيق الوصول اليومي')}
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {t(
            'Inspect rosters, correct submitted records, and review instructor GPS/lateness check-in exceptions.',
            'فحص الكشوف وتعديل الحالات ومراجعة طلبات استثناء الوصول اليومي للمحاضرين.'
          )}
        </p>
      </div>

      {syncMessage && (
        <div
          role="status"
          className={`p-4 rounded-xl border text-xs font-medium ${
            syncMessage.ok
              ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
              : 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300'
          }`}
        >
          {syncMessage.text}
        </div>
      )}

      {/* Check-in Exception Reviews & Selfie Verification */}
      {campExceptions.length > 0 && (
        <section className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-500" />
            <span>{t('Check-in Exceptions Review Queue', 'مراجعة استثناءات تسجيل الوصول')}</span>
          </h2>
          <div className="space-y-3 text-xs">
            {campExceptions.map((ex) => {
              const inst = instructors.find((i) => i.id === ex.instructorId);
              const chk = campCheckins.find((c) => c.id === ex.checkinId);
              return (
                <div
                  key={ex.id}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">
                        {inst ? t(inst.fullNameEn, inst.fullNameAr) : ex.instructorId} · Day{' '}
                        {ex.campDay}
                      </p>
                      <p className="text-slate-600 dark:text-slate-400 mt-0.5">{ex.reason}</p>
                      {chk && (
                        <p className="font-mono text-slate-500 mt-0.5">
                          Distance: {chk.distanceFromVenueMeters}m · Late: +{chk.minutesAfterFirstLecture}m · Selfie: {chk.selfieSizeKb}KB
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {chk?.selfieStoragePath && !chk.selfieDeletedAfterArchive && (
                        <button
                          type="button"
                          onClick={() => handleLoadSelfie(chk.id, chk.selfieStoragePath!)}
                          className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 font-medium cursor-pointer"
                        >
                          {t('View Selfie', 'عرض الصورة')}
                        </button>
                      )}
                      <span className="font-mono uppercase font-semibold">{ex.status}</span>
                    </div>
                  </div>

                  {chk && selfiePreviews[chk.id] && (
                    <img
                      src={selfiePreviews[chk.id]}
                      alt="Check-in selfie preview"
                      className="w-36 h-36 object-cover rounded-xl border border-slate-200 dark:border-slate-800"
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
                        className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                      />
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleExceptionDecision(ex.id, 'approved')}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold cursor-pointer"
                      >
                        {t('Approve Exception', 'اعتماد الاستثناء')}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleExceptionDecision(ex.id, 'rejected')}
                        className="px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-900 text-red-600 dark:text-red-400 font-semibold cursor-pointer"
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

      {/* Attendance Sheets Grid */}
      <div className="space-y-4">
        {campSheets.map((sheet) => {
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

          return (
            <div
              key={sheet.id}
              className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                      Day {sheet.campDay} · Period {sheet.periodNumber}
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
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{isExpanded ? t('Hide Roster', 'إخفاء القائمة') : t('Inspect Roster', 'فحص وتعديل القائمة')}</span>
                  </button>

                  {sheet.status === AttendanceSheetStatus.SUBMITTED ||
                  sheet.status === AttendanceSheetStatus.LOCKED ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{t('Submitted & Synced', 'معتمد ومتزامن')}</span>
                    </span>
                  ) : (
                    <>
                      <span className="text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        <span>{t(`Draft (${sheet.syncState})`, `مسودة (${sheet.syncState})`)}</span>
                      </span>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleForceSync(sheet.lectureId)}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer"
                      >
                        {t('Submit & Sync Now', 'اعتماد ومزامنة الآن')}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800/80 font-mono tabular-nums">
                <span>
                  {t('Present/Late:', 'حاضر/متأخر:')} <strong>{presentCount}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {t('Absent:', 'غائب:')} <strong>{absentCount}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {t('Unmarked:', 'غير محدد:')} <strong>{unmarkedCount}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  {chk ? (
                    chk.status === CheckinStatus.VERIFIED ||
                    chk.status === CheckinStatus.EXCEPTION_APPROVED ? (
                      t(`Check-in ${chk.status} (${chk.distanceFromVenueMeters}m)`, `${chk.status} (${chk.distanceFromVenueMeters}م)`)
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400 inline-flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>
                          {chk.status} ({chk.minutesAfterFirstLecture}m)
                        </span>
                      </span>
                    )
                  ) : (
                    t('Check-in: Missing', 'غير مسجل الوصول')
                  )}
                </span>
              </div>

              {isExpanded && (
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {sheet.records.length === 0 ? (
                    <p className="py-3 text-slate-500">
                      {t('No student attendance rows saved on this sheet yet.', 'لا توجد سجلات طلاب محفوظة في هذا الكشف بعد.')}
                    </p>
                  ) : (
                    sheet.records.map((rec) => (
                      <div
                        key={rec.studentId}
                        className="py-2.5 flex flex-wrap items-center justify-between gap-2"
                      >
                        <div>
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {rec.studentName}
                          </span>{' '}
                          <span className="font-mono text-slate-500">({rec.studentCode})</span>
                          {rec.isCrossGroup && (
                            <span className="ms-2 px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-mono text-[11px]">
                              Cross-Group
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {(
                            [
                              AttendanceMark.PRESENT,
                              AttendanceMark.LATE,
                              AttendanceMark.ABSENT,
                            ] as const
                          ).map((mk) => (
                            <button
                              key={mk}
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                handleCorrectMark(sheet.id, sheet.lectureId, rec.studentId, mk)
                              }
                              className={`px-2.5 py-1 rounded-lg font-semibold capitalize cursor-pointer ${
                                rec.mark === mk
                                  ? 'bg-blue-600 text-white'
                                  : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {mk}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
