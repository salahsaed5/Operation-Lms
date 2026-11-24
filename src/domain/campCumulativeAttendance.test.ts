import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampToDateReport } from './campCumulativeAttendance';
import { AttendanceMark, AttendanceSheetStatus, type Student, type Lecture, type AttendanceSheet } from '../types/database';

const campId = 'camp-qa';
const st = (id: string, groupId = 'A', joinedCampDay = 1): Student => ({
  id, campId, groupId, studentCode: id, fullName: 'Student '+id,
  university: '', isActive: true, joinedCampDay,
});
const lec = (id: string, campDay: number, groupId = 'A'): Lecture => ({
  id, campId, campDay, groupId, status: 'scheduled',
} as Lecture);
const sh = (id: string, lectureId: string, rows: Array<[string, AttendanceMark]>, status = AttendanceSheetStatus.SUBMITTED): AttendanceSheet => ({
  id, campId, lectureId, status,
  records: rows.map(([studentId, mark]) => ({
    studentId, studentCode: studentId, studentName: 'Student '+studentId,
    originGroupId: studentId === 'b' ? 'B' : 'A', attendedGroupId: 'A',
    isCrossGroup: studentId === 'b', mark,
  })),
} as AttendanceSheet);
const report = (students: Student[], lectures: Lecture[], sheets: AttendanceSheet[], asOfDay = 4) =>
  buildCampToDateReport({campId,asOfDay,students,lectures,attendanceSheets:sheets,studentTransfers:[]});

test('draft attendance is never counted as official presence or absence', () => {
  const r = report([st('a')],[lec('l',1)],[sh('s','l',[['a',AttendanceMark.PRESENT]],AttendanceSheetStatus.DRAFT)]);
  assert.equal(r.enrolled,1);
  assert.equal(r.everAttended,0);
  assert.equal(r.neverAttended,0);
  assert.equal(r.noFinalizedLectureYet,1);
  assert.equal(r.pendingLectureCount,1);
});

test('student absent from an approved lecture appears in never-attended drilldown', () => {
  const r = report([st('a')],[lec('l',1)],[sh('s','l',[['a',AttendanceMark.ABSENT]])]);
  assert.equal(r.neverAttended,1);
  assert.equal(r.students[0].daysAbsent,1);
});

test('visiting student is counted once as attended, home group unchanged', () => {
  const r = report([st('b','B')],[lec('l',1,'A')],[sh('s','l',[['b',AttendanceMark.PRESENT]])]);
  assert.equal(r.everAttended,1);
  assert.equal(r.students[0].homeGroupId,'B');
  assert.equal(r.students[0].daysAttended,1);
});

test('multiple finalized lectures on same day do not double-count days attended', () => {
  const r = report([st('a')],[lec('l1',1),lec('l2',1)],[
    sh('s1','l1',[['a',AttendanceMark.LATE]]),
    sh('s2','l2',[['a',AttendanceMark.PRESENT]]),
  ]);
  assert.equal(r.everAttended,1);
  assert.equal(r.students[0].daysAttended,1);
  assert.equal(r.students[0].daysLate,0);
});

test('joiner on Day 4 is not eligible for Day 1-3 absence or never-attended', () => {
  const l=[lec('l1',1),lec('l4',4)];
  const s=[sh('s1','l1',[['a',AttendanceMark.ABSENT]])];
  const r = report([st('a','A',4)],l,s);
  assert.equal(r.enrolled,1);
  assert.equal(r.neverAttended,0);
  assert.equal(r.noFinalizedLectureYet,1);
  assert.equal(r.students[0].daysAbsent,0);
  assert.equal(report([st('a','A',4)],l,s,3).enrolled,0);
});

test('unfinalized future lecture does not turn a student into never-attended', () => {
  const r = report([st('a')],[lec('l1',1),lec('l2',4)],[sh('s1','l1',[['a',AttendanceMark.PRESENT]])]);
  assert.equal(r.everAttended,1);
  assert.equal(r.pendingLectureCount,1);
});

test('students belong to exactly one drilldown category', () => {
  const r = report([st('a'),st('b'),st('c','C')],[lec('l',1)],[
    sh('s','l',[['a',AttendanceMark.PRESENT],['b',AttendanceMark.ABSENT]])
  ]);
  assert.equal(r.enrolled,3);
  assert.equal(r.everAttended,1);
  assert.equal(r.neverAttended,1);
  assert.equal(r.noFinalizedLectureYet,1);
  assert.equal(r.enrolled,r.everAttended+r.neverAttended+r.noFinalizedLectureYet);
});

test('missing or excused finalized rows are never classified as absent',()=>{
  const r=report([st('a'),st('b')],[lec('l',1)],[sh('s','l',[['b',AttendanceMark.EXCUSED]])]);
  assert.equal(r.neverAttended,0);
  assert.equal(r.noFinalizedLectureYet,2);
});
