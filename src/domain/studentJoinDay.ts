import type { Student } from '../types/database';

/** A student is never eligible for attendance before their server-recorded join day. */
export function studentEligibleForCampDay(
  student: Pick<Student, 'joinedCampDay'>,
  campDay: number
): boolean {
  const joinedDay = student.joinedCampDay ?? 1;
  return Number.isInteger(campDay) && campDay > 0 &&
    Number.isInteger(joinedDay) && joinedDay > 0 &&
    joinedDay <= campDay;
}
