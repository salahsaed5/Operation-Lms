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
