import { Camp, CampStatus, Lecture, UserRole } from '../types/database';

type InstructorLecture = Pick<Lecture,'campId'|'instructorId'|'substituteInstructorId'>;
type BackupWork = { campId: string; instructorId: string };

/** Admin can select any Camp, including archived for read-only statements.
 * Instructor can select only explicitly assigned or historically worked Camps.
 * Server RLS separately enforces the same ownership rules.
 */
export function campsAvailableToUser(input: {
  camps: Camp[];
  role: UserRole;
  instructorId: string;
  campInstructorIds: Record<string,string[]>;
  lectures: InstructorLecture[];
  backupSessions: BackupWork[];
}): Camp[] {
  const { camps, role, instructorId, campInstructorIds, lectures, backupSessions } = input;
  if (role === UserRole.ADMIN) return camps;
  if (role !== UserRole.INSTRUCTOR || !instructorId) return [];

  const allowedIds = new Set<string>();
  for (const [campId, instructorIds] of Object.entries(campInstructorIds)) {
    if (instructorIds.includes(instructorId)) allowedIds.add(campId);
  }
  for (const lecture of lectures) {
    if (lecture.instructorId === instructorId ||
        lecture.substituteInstructorId === instructorId) {
      allowedIds.add(lecture.campId);
    }
  }
  for (const backup of backupSessions) {
    if (backup.instructorId === instructorId) allowedIds.add(backup.campId);
  }
  return camps.filter(camp => allowedIds.has(camp.id));
}

/** Invalid/revoked selection fails closed to an available Camp, never an
 * unrelated globally active Camp. Keep an explicit archived selection if
 * its user is still allowed to inspect old Camp Finance.
 */
export function resolveCampSelection(
  available: Camp[], selectedCampId: string
): Camp | null {
  return available.find(c => c.id === selectedCampId) ||
    available.find(c => c.status === CampStatus.ACTIVE) ||
    available.find(c => c.status === CampStatus.DRAFT) ||
    available[0] || null;
}
