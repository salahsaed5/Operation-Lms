import type { AttendanceRecordItem } from '../types/database';

/** Detect any local-vs-server changes to a draft before a destructive submit. */
export function compareAttendanceDraftRows(
  local: AttendanceRecordItem[],
  server: AttendanceRecordItem[]
): string[] {
  const localRows = new Map(local.map(row => [row.studentId, row]));
  const serverRows = new Map(server.map(row => [row.studentId, row]));
  const duplicates = new Set([
    ...local.filter((row, i) => local.findIndex(r => r.studentId === row.studentId) !== i).map(r => r.studentId),
    ...server.filter((row, i) => server.findIndex(r => r.studentId === row.studentId) !== i).map(r => r.studentId),
  ]);
  const ids = [...new Set([...localRows.keys(), ...serverRows.keys()])].sort();
  const different = ids.filter(id => {
    const a = localRows.get(id), b = serverRows.get(id);
    if (!a || !b || duplicates.has(id)) return true;
    return a.mark !== b.mark ||
      a.originGroupId !== b.originGroupId ||
      a.attendedGroupId !== b.attendedGroupId ||
      a.isCrossGroup !== b.isCrossGroup ||
      (a.note || '').trim() !== (b.note || '').trim();
  });
  return different;
}

/** The server persists only marked attendance. Ignore roster placeholders in CAS comparisons. */
export function persistedAttendanceRows(rows: AttendanceRecordItem[]): AttendanceRecordItem[] {
  return rows.filter(row => row.mark !== 'unmarked');
}

/** Compare the last server state the editor saw against the latest server state. */
export function compareAttendanceServerRows(
  expectedServer: AttendanceRecordItem[],
  actualServer: AttendanceRecordItem[]
): string[] {
  return compareAttendanceDraftRows(
    persistedAttendanceRows(expectedServer),
    persistedAttendanceRows(actualServer)
  );
}

/**
 * Return genuine lost-update conflicts, not intentional changes made by the
 * current editor. If their desired state already matches the live server,
 * accepting it is a safe idempotent no-op. Without an expected baseline
 * (legacy Offline drafts), fail closed whenever local and server differ.
 */
export function unsafeAttendanceDraftConflicts(
  expectedServer: AttendanceRecordItem[] | undefined,
  desiredRows: AttendanceRecordItem[],
  actualServer: AttendanceRecordItem[]
): string[] {
  const concurrentChanges = compareAttendanceServerRows(expectedServer ?? desiredRows, actualServer);
  if (concurrentChanges.length === 0) return [];
  return compareAttendanceServerRows(desiredRows, actualServer).length === 0
    ? []
    : concurrentChanges;
}
