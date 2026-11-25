import type { Group, Lecture } from '../types/database';

export type FixedTimetableRow = {
  id: string; groupId: string; instructorId: string; roomId: string;
  periodNumber: number; topic: string; fixed: boolean; scheduledDays: number;
};

/** The group assignment is authoritative; daily exceptions never change it.
 * Legacy sessions are shown as explicitly unconfirmed patterns, not a fixed assignment.
 */
export function fixedTimetableRows(groups: Group[], lectures: Lecture[], periods: number[]): FixedTimetableRow[] {
  const rows: FixedTimetableRow[] = [];
  for (const group of groups) {
    const own = lectures.filter(l => l.campId === group.campId && l.groupId === group.id);
    const period = group.fixedPeriodNumber;
    const isFixed = period != null && periods.includes(period) && !!group.primaryInstructorId && !!group.defaultRoomId;
    if (isFixed) {
      const matches = own.filter(l => l.periodNumber === period && l.instructorId === group.primaryInstructorId && l.roomId === group.defaultRoomId && l.status !== 'cancelled');
      rows.push({ id: group.id, groupId: group.id, instructorId: group.primaryInstructorId, roomId: group.defaultRoomId, periodNumber: period!, topic: group.track, fixed: true, scheduledDays: new Set(matches.map(l => l.campDay)).size });
      continue;
    }
    const patterns = new Map<string, Lecture[]>();
    for (const l of own) {
      if (!periods.includes(l.periodNumber)) continue;
      const key = JSON.stringify([l.periodNumber,l.instructorId,l.roomId,l.topic]);
      const list = patterns.get(key) || [];
      list.push(l); patterns.set(key,list);
    }
    for (const [key, sessions] of patterns) {
      const l = sessions[0];
      rows.push({id: group.id + ':' + key,groupId:group.id,instructorId:l.instructorId,roomId:l.roomId,periodNumber:l.periodNumber,topic:l.topic,fixed:false,scheduledDays:new Set(sessions.filter(x=>x.status !== 'cancelled').map(x=>x.campDay)).size});
    }
  }
  return rows.sort((a,b)=>a.periodNumber-b.periodNumber || a.groupId.localeCompare(b.groupId));
}
