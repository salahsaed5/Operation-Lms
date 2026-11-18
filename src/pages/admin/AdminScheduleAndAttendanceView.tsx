import React, { useState } from 'react';
import { Plus, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { AttendanceMark, AttendanceSheetStatus, CheckinStatus } from '../../types/database';

export const AdminScheduleView: React.FC = () => {
  const {
    activeCamp,
    lectures,
    groups,
    instructors,
    rooms,
    addScheduleLecture,
    t,
  } = useApp();

  const [periodNumber, setPeriodNumber] = useState<number>(2);
  const [groupId, setGroupId] = useState<string>('grp-2');
  const [instructorId, setInstructorId] = useState<string>('inst-2');
  const [roomId, setRoomId] = useState<string>('room-102');
  const [topic, setTopic] = useState<string>('Segment Trees & Lazy Propagation');
  const [feedback, setFeedback] = useState<{ ok: boolean; messages: string[] } | null>(null);

  const dayLectures = lectures
    .filter((l) => l.campId === activeCamp.id && l.campDay === activeCamp.currentCampDay)
    .sort((a, b) => a.periodNumber - b.periodNumber);

  const handleCreateSlot = (e: React.FormEvent) => {
    e.preventDefault();
    const res = addScheduleLecture({
      campDay: activeCamp.currentCampDay,
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
  };

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-200 dark:border-slate-800">
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

      {/* Add Lecture Slot Form with Conflict Validator */}
      <form
        onSubmit={handleCreateSlot}
        className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4"
      >
        <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Plus className="w-4 h-4 text-blue-500" />
          <span>
            {t(
              `Schedule New Lecture — Day ${activeCamp.currentCampDay}`,
              `إضافة محاضرة جديدة — اليوم ${activeCamp.currentCampDay}`
            )}
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
              {groups.map((g) => (
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
              // Pre-fill a conflicting slot (Period 1, inst-1, room-101) so user can test server-side conflict blocking
              setPeriodNumber(1);
              setInstructorId('inst-1');
              setRoomId('room-101');
              setGroupId('grp-2');
            }}
            className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline cursor-pointer"
          >
            {t('Test Conflict Scenario (Period 1 · Dr. Ahmed · LAB-A1)', 'اختبار سيناريو تعارض (الفترة 1)')}
          </button>

          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
          >
            {t('Validate & Add to Schedule', 'فحص التعارض وإضافة للجدول')}
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

      {/* Schedule Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
        <table className="w-full text-start border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <th className="py-3.5 px-5 font-semibold">{t('Period & Time', 'الفترة والوقت')}</th>
              <th className="py-3.5 px-4 font-semibold">{t('Group & Room', 'المجموعة والقاعة')}</th>
              <th className="py-3.5 px-4 font-semibold">{t('Topic & Instructor', 'الموضوع والمحاضر')}</th>
              <th className="py-3.5 px-4 text-right font-semibold">{t('Frozen Rate', 'الفئة المثبتة')}</th>
              <th className="py-3.5 px-5 text-right font-semibold">{t('Acknowledgment', 'تأكيد المحاضر')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {dayLectures.map((lec) => {
              const grp = groups.find((g) => g.id === lec.groupId);
              const inst = instructors.find((i) => i.id === lec.instructorId);
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
                      {inst ? t(inst.fullNameEn, inst.fullNameAr) : lec.instructorId} · Rev {lec.revisionNumber}
                    </p>
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                    {lec.frozenRateEgp} EGP
                  </td>
                  <td className="py-3.5 px-5 text-right">
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
                </tr>
              );
            })}
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
    submitAndSyncAttendanceSheet,
    t,
  } = useApp();

  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const handleForceSync = async (lectureId: string) => {
    const res = await submitAndSyncAttendanceSheet(lectureId);
    if (res.ok) {
      setSyncMessage(
        t(
          'Attendance sheet submitted & synchronized. Unmarked students were converted to absent and server-side entitlement was updated.',
          'تم اعتماد ومزامنة كشف الحضور، وتحويل الطلاب غير المحددين إلى غياب وتحديث المستحق المالي.'
        )
      );
    } else if (res.error) {
      setSyncMessage(res.error);
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
            'One sheet per lecture. Unmarked students become absent only upon submission. Offline drafts are never financially eligible until synced.',
            'كشف حضور مستقل لكل محاضرة. يتحول غير المحددين إلى غياب عند الاعتماد فقط. المسودات غير المتزامنة لا تُحتسب مالياً.'
          )}
        </p>
      </div>

      {syncMessage && (
        <div
          role="status"
          className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-xs text-emerald-800 dark:text-emerald-300 font-medium"
        >
          {syncMessage}
        </div>
      )}

      {/* Attendance Sheets Grid */}
      <div className="space-y-4">
        {attendanceSheets.map((sheet) => {
          const lec = lectures.find((l) => l.id === sheet.lectureId);
          const inst = instructors.find((i) => i.id === sheet.instructorId);
          const grp = groups.find((g) => g.id === lec?.groupId);
          const chk = checkins.find(
            (c) => c.campId === activeCamp.id && c.instructorId === sheet.instructorId && c.campDay === sheet.campDay
          );

          const presentCount = sheet.records.filter(
            (r) => r.mark === AttendanceMark.PRESENT || r.mark === AttendanceMark.LATE
          ).length;
          const unmarkedCount = sheet.records.filter((r) => r.mark === 'unmarked').length;

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

                <div className="flex items-center gap-3 text-xs">
                  {sheet.status === AttendanceSheetStatus.SUBMITTED ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{t('Submitted & Synced', 'معتمد ومتزامن')}</span>
                    </span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        <span>
                          {t(`Unverified Draft (${sheet.syncState})`, `مسودة غير موثقة (${sheet.syncState})`)}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleForceSync(sheet.lectureId)}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer"
                      >
                        {t('Submit & Sync Now', 'اعتماد ومزامنة الآن')}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800/80 font-mono tabular-nums">
                <span>
                  {t('Present/Late:', 'حاضر/متأخر:')} <strong>{presentCount}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {t('Unmarked (becomes Absent on submit):', 'غير محدد (يتحول لغياب عند الاعتماد):')}{' '}
                  <strong>{unmarkedCount}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {t('Check-in Status:', 'حالة وصول المحاضر:')}{' '}
                  {chk?.status === CheckinStatus.VERIFIED
                    ? t(`Verified (${chk.distanceFromVenueMeters}m)`, `موثق (${chk.distanceFromVenueMeters}م)`)
                    : chk?.status === CheckinStatus.LATE_FIRST_LECTURE
                    ? t(`Late First Lecture (+${chk.minutesAfterFirstLecture}m)`, `متأخر للمحاضرة الأولى (+${chk.minutesAfterFirstLecture}د)`)
                    : t('Missing', 'غير مسجل')}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
