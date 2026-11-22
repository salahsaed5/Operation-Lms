import {
  AttendanceMark,
  AttendanceSheet,
  AttendanceSheetStatus,
  Lecture,
  Student,
  StudentTransfer,
} from '../types/database';
import { resolveStudentOriginGroupForDay } from './businessRules';
import { studentEligibleForCampDay } from './studentJoinDay';

export type DayAttendanceCode = 'P' | 'L' | 'A' | 'E' | 'Pending' | '—';

export interface CampAttendanceExcelRow {
  studentId: string;
  studentCode: string;
  fullName: string;
  homeGroupId: string;
  joinedCampDay: number;
  days: DayAttendanceCode[];
  presentDays: number;
  lateDays: number;
  absentDays: number;
  eligibleFinalDays: number;
}

export interface CampAttendanceExcelGrid {
  campId: string;
  dayCount: number;
  rows: CampAttendanceExcelRow[];
  scheduledLectures: number;
  finalizedLectures: number;
  pendingLectures: number;
}

/** Excel-ready daily attendance, built exclusively from Submitted/Locked sheets.
 * A day is counted once across multiple lectures or visiting another group.
 * Pending wins over a premature absence if another scheduled session is
 * unfinalized; students joining in the middle of Camp have earlier days N/A.
 */
export function buildCampAttendanceExcelGrid(input: {
  campId: string;
  durationDays: number;
  students: Student[];
  studentTransfers: StudentTransfer[];
  lectures: Lecture[];
  attendanceSheets: AttendanceSheet[];
}): CampAttendanceExcelGrid {
  const dayCount = 10; // Contract: exactly ten Day 1..Day 10 columns.
  const { campId, durationDays, students, studentTransfers, lectures, attendanceSheets } = input;
  const validLectures = lectures.filter(l =>
    l.campId === campId && l.campDay >= 1 && l.campDay <= durationDays &&
    l.campDay <= dayCount && l.status !== 'cancelled'
  );
  const allowedLectureIds = new Set(validLectures.map(l => l.id));
  const byLecture = new Map(attendanceSheets.filter(s =>
    s.campId === campId && allowedLectureIds.has(s.lectureId)
  ).map(s => [s.lectureId, s]));
  const finalizedLectureIds = new Set(validLectures.filter(l => {
    const sh = byLecture.get(l.id);
    return sh?.status === AttendanceSheetStatus.SUBMITTED || sh?.status === AttendanceSheetStatus.LOCKED;
  }).map(l => l.id));

  const rows = students.filter(s => s.campId === campId)
    .sort((a,b)=>a.studentCode.localeCompare(b.studentCode))
    .map(st => {
      const days: DayAttendanceCode[] = [];
      for (let day = 1; day <= dayCount; day++) {
        if (day > durationDays || !studentEligibleForCampDay(st, day)) {
          days.push('—');
          continue;
        }
        const home = resolveStudentOriginGroupForDay({
          student: st, transfers: studentTransfers, campDay: day,
        });
        const dueLectures = validLectures.filter(l => l.campDay === day && l.groupId === home);
        const visitorLectures = validLectures.filter(l =>
          l.campDay === day && l.groupId !== home &&
          (byLecture.get(l.id)?.records.some(r => r.studentId === st.id) ?? false)
        );
        const relevant = [...dueLectures, ...visitorLectures];
        if (!relevant.length) {
          days.push('—'); // Not scheduled, not absence.
          continue;
        }
        const finalized = relevant.filter(l => finalizedLectureIds.has(l.id));
        const marks = finalized.flatMap(l =>
          byLecture.get(l.id)?.records.filter(r => r.studentId === st.id).map(r => r.mark) ?? []
        );
        if (marks.includes(AttendanceMark.PRESENT)) { days.push('P'); continue; }
        if (marks.includes(AttendanceMark.LATE)) { days.push('L'); continue; }

        // Never classify as absent with missing or unfinalized home sessions.
        const hasPendingSession = dueLectures.some(l => !finalizedLectureIds.has(l.id));
        const finalizedHomeSessionMissingRow = finalized.some(l =>
          l.groupId === home &&
          !(byLecture.get(l.id)?.records.some(r => r.studentId === st.id) ?? false)
        );
        if (hasPendingSession || finalizedHomeSessionMissingRow || !finalized.length) {
          days.push('Pending'); continue;
        }
        if (marks.includes(AttendanceMark.EXCUSED)) { days.push('E'); continue; }
        if (marks.includes(AttendanceMark.ABSENT)) { days.push('A'); continue; }
        days.push('Pending'); // Missing record cannot be invented as absence.
      }
      const presentDays = days.filter(d => d === 'P' || d === 'L').length;
      const lateDays = days.filter(d => d === 'L').length;
      const absentDays = days.filter(d => d === 'A').length;
      return {
        studentId: st.id, studentCode: st.studentCode, fullName: st.fullName,
        homeGroupId: resolveStudentOriginGroupForDay({
          student: st, transfers: studentTransfers,
          campDay: Math.min(durationDays, dayCount),
        }),
        joinedCampDay: st.joinedCampDay ?? 1,
        days, presentDays, lateDays, absentDays,
        eligibleFinalDays: presentDays + absentDays,
      };
    });
  return {
    campId, dayCount, rows,
    scheduledLectures: validLectures.length,
    finalizedLectures: finalizedLectureIds.size,
    pendingLectures: validLectures.length - finalizedLectureIds.size,
  };
}
