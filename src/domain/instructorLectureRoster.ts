import { resolveStudentOriginGroupForDay } from './businessRules';
import { studentEligibleForCampDay } from './studentJoinDay';
import type { Lecture, Student, StudentTransfer } from '../types/database';

/**
 * The Instructor attendance roster belongs to the selected LECTURE group,
 * never the first Instructor group or the first lecture of the day.
 * Visiting students are separate and only appear when explicitly added.
 */
export function studentsForSelectedLecture(params: {
  lecture: Pick<Lecture, 'campId' | 'campDay' | 'groupId'>;
  students: Student[];
  transfers: StudentTransfer[];
}): Student[] {
  const { lecture, students, transfers } = params;
  return students.filter(student =>
    student.campId === lecture.campId &&
    student.isActive &&
    studentEligibleForCampDay(student, lecture.campDay) &&
    resolveStudentOriginGroupForDay({
      student,
      transfers,
      campDay: lecture.campDay,
    }) === lecture.groupId
  );
}
