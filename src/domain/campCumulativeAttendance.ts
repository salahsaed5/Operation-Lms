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

export type CampToDateCategory = 'attended' | 'never_attended' | 'pending';

export interface CampToDateStudent {
  studentId: string;
  studentCode: string;
  fullName: string;
  homeGroupId: string;
  joinedCampDay: number;
  category: CampToDateCategory;
  daysAttended: number;
  daysAbsent: number;
  daysLate: number;
  firstAttendedDay: number | null;
  lastAttendedDay: number | null;
  eligibleFinalizedLectures: number;
}

export interface CampToDateReport {
  campId: string;
  asOfDay: number;
  enrolled: number;
  everAttended: number;
  neverAttended: number;
  noFinalizedLectureYet: number;
  scheduledLectureCount: number;
  finalizedLectureCount: number;
  pendingLectureCount: number;
  students: CampToDateStudent[];
}

/**
 * Read-only, finalized-only camp-to-date view. Never infer "Absent" from
 * unsubmitted local Draft sheets. Count a student only once across group
 * visits / multiple same-day lectures; mid-camp joiners are not considered
 * eligible on any earlier day.
 */
export function buildCampToDateReport(input: {
  campId: string;
  asOfDay: number;
  students: Student[];
  lectures: Lecture[];
  attendanceSheets: AttendanceSheet[];
  studentTransfers: StudentTransfer[];
}): CampToDateReport {
  const { campId, students, lectures, attendanceSheets, studentTransfers } = input;
  const asOfDay = Number.isInteger(input.asOfDay) && input.asOfDay >= 1 ? input.asOfDay : 1;
  const scopedLectures = lectures.filter(l =>
    l.campId === campId && l.campDay >= 1 && l.campDay <= asOfDay &&
    l.status !== 'cancelled'
  );
  const lectureById = new Map(scopedLectures.map(l => [l.id, l]));
  const finalizedSheets = attendanceSheets.filter(sh =>
    sh.campId === campId &&
    (sh.status === AttendanceSheetStatus.SUBMITTED || sh.status === AttendanceSheetStatus.LOCKED) &&
    lectureById.has(sh.lectureId)
  );
  const finalizedLectureIds = new Set(finalizedSheets.map(s => s.lectureId));
  const eligible = students.filter(st =>
    st.campId === campId && studentEligibleForCampDay(st, asOfDay)
  );
  const summaries: CampToDateStudent[] = eligible.map(st => {
    const joinedCampDay = st.joinedCampDay ?? 1;
    const dailyPresence = new Map<number, { present: boolean; late: boolean; absent: boolean }>();
    let eligibleFinalizedLectures = 0;
    for (const sh of finalizedSheets) {
      const lecture = lectureById.get(sh.lectureId);
      if (!lecture || !studentEligibleForCampDay(st, lecture.campDay)) continue;
      const row = sh.records.find(r => r.studentId === st.id);
      const homeGroup = resolveStudentOriginGroupForDay({
        student: st, transfers: studentTransfers, campDay: lecture.campDay,
      });
      const isDue = lecture.groupId === homeGroup || Boolean(row);
      if (!isDue) continue;
      eligibleFinalizedLectures += 1;
      const day = dailyPresence.get(lecture.campDay) || { present: false, late: false, absent: false };
      if (row?.mark === AttendanceMark.PRESENT) day.present = true;
      if (row?.mark === AttendanceMark.LATE) day.late = true;
      if (row?.mark === AttendanceMark.ABSENT) day.absent = true;
      dailyPresence.set(lecture.campDay, day);
    }
    const attendedDays = [...dailyPresence.entries()].filter(([,d]) => d.present || d.late).map(([day]) => day).sort((a,b) => a-b);
    const daysLate = [...dailyPresence.values()].filter(d => d.late && !d.present).length;
    const daysAbsent = [...dailyPresence.values()].filter(d => d.absent && !d.present && !d.late).length;
    const category: CampToDateCategory = attendedDays.length > 0
      ? 'attended'
      : eligibleFinalizedLectures > 0 ? 'never_attended' : 'pending';
    return {
      studentId: st.id,
      studentCode: st.studentCode,
      fullName: st.fullName,
      homeGroupId: resolveStudentOriginGroupForDay({
        student: st, transfers: studentTransfers, campDay: asOfDay,
      }),
      joinedCampDay,
      category,
      daysAttended: attendedDays.length,
      daysAbsent,
      daysLate,
      firstAttendedDay: attendedDays[0] ?? null,
      lastAttendedDay: attendedDays[attendedDays.length-1] ?? null,
      eligibleFinalizedLectures,
    };
  }).sort((a,b) => a.studentCode.localeCompare(b.studentCode));
  return {
    campId, asOfDay,
    enrolled: summaries.length,
    everAttended: summaries.filter(st => st.category === 'attended').length,
    neverAttended: summaries.filter(st => st.category === 'never_attended').length,
    noFinalizedLectureYet: summaries.filter(st => st.category === 'pending').length,
    scheduledLectureCount: scopedLectures.length,
    finalizedLectureCount: finalizedLectureIds.size,
    pendingLectureCount: scopedLectures.length - finalizedLectureIds.size,
    students: summaries,
  };
}
